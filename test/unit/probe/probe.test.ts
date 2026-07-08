import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import * as tls from 'tls';
import { describe, it, expect } from 'vitest';
import { probeHost } from '../../../src/probe/index';

// ---------------------------------------------------------------------------
// Mock server helpers
// ---------------------------------------------------------------------------

const FIXTURES = path.join(__dirname, '../../fixtures/tls');

/** Write a RESP bulk string response. */
function bulkString(s: string): string {
  return `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
}

/** Encode a JS value (string, number, or nested array) as a RESP2 reply. */
function respEncode(value: string | number | unknown[]): string {
  if (typeof value === 'number') return `:${value}\r\n`;
  if (typeof value === 'string') return bulkString(value);
  return (
    `*${value.length}\r\n` + value.map((v) => respEncode(v as string | number | unknown[])).join('')
  );
}

/** An empty RESP array — the reply for MODULE LIST when no modules are loaded. */
const EMPTY_ARRAY = '*0\r\n';

const MINIMAL_INFO =
  '# Server\r\nredis_version:8.0.0\r\nserver_name:redis\r\nredis_mode:standalone\r\nos:Test\r\nuptime_in_seconds:100\r\n# Replication\r\nrole:master\r\n# Memory\r\nused_memory:1048576\r\nmaxmemory:0\r\nmaxmemory_policy:noeviction\r\n# Keyspace\r\ndb0:keys=3,expires=0,avg_ttl=0\r\n';

/**
 * Parse all RESP commands from a raw buffer. Handles TCP coalescing (multiple
 * commands in one segment) and returns each command's argv.
 */
function parseAllRespCommands(data: Buffer): string[][] {
  if (data[0] === 0x16) return [['__tls_handshake__']];
  const str = data.toString();
  const commands: string[][] = [];
  const re = /\*(\d+)\r\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    const n = parseInt(m[1], 10);
    const args: string[] = [];
    let pos = m.index + m[0].length;
    for (let i = 0; i < n; i++) {
      const lenMatch = /\$(\d+)\r\n/.exec(str.slice(pos));
      if (!lenMatch) break;
      pos += lenMatch.index + lenMatch[0].length;
      const len = parseInt(lenMatch[1], 10);
      args.push(str.slice(pos, pos + len));
      pos += len + 2; // skip \r\n
    }
    commands.push(args);
  }
  return commands;
}

/**
 * Extract all command names from a data buffer that may contain multiple
 * pipelined RESP commands (e.g. when TCP coalesces writes into one segment).
 */
function parseAllCommands(data: Buffer): string[] {
  return parseAllRespCommands(data).map((args) => (args[0] ?? '').toLowerCase());
}

/** Handler for a password-protected server (password = 'secret'). */
function authRequiredHandler(socket: net.Socket | tls.TLSSocket): void {
  let authenticated = false;
  socket.on('data', (data) => {
    for (const args of parseAllRespCommands(data)) {
      const cmd = (args[0] ?? '').toLowerCase();
      if (cmd === '__tls_handshake__') {
        socket.write("-ERR Protocol error: expected '*', got '\\x16'\r\n");
      } else if (cmd === 'client') {
        socket.write('-NOAUTH Authentication required\r\n');
      } else if (cmd === 'auth') {
        const pass = args[args.length - 1] ?? '';
        if (pass === 'secret') {
          authenticated = true;
          socket.write('+OK\r\n');
        } else {
          socket.write('-WRONGPASS invalid username-password pair or user is disabled.\r\n');
        }
      } else if (cmd === 'ping') {
        socket.write(authenticated ? '+PONG\r\n' : '-NOAUTH Authentication required\r\n');
      } else if (cmd === 'info') {
        if (authenticated) {
          socket.write(bulkString(MINIMAL_INFO));
        } else {
          socket.write('-NOAUTH Authentication required\r\n');
        }
      } else if (cmd === 'module') {
        socket.write(authenticated ? EMPTY_ARRAY : '-NOAUTH Authentication required\r\n');
      }
    }
  });
}

/** Handler that speaks just enough RESP to satisfy ioredis during a probe. */
function openRedisHandler(socket: net.Socket | tls.TLSSocket): void {
  socket.on('data', (data) => {
    for (const cmd of parseAllCommands(data)) {
      if (cmd === '__tls_handshake__') {
        // Mimic how plain Redis rejects TLS data — triggers a fast TLS parse error
        socket.write("-ERR Protocol error: expected '*', got '\\x16'\r\n");
      } else if (cmd === 'client') {
        socket.write('+OK\r\n');
      } else if (cmd === 'ping') {
        socket.write('+PONG\r\n');
      } else if (cmd === 'info') {
        socket.write(bulkString(MINIMAL_INFO));
      } else if (cmd === 'module') {
        socket.write(EMPTY_ARRAY);
      }
    }
  });
}

/** Handler that returns NOAUTH for every command (no auth accepted). */
function noauthHandler(socket: net.Socket | tls.TLSSocket): void {
  socket.on('data', (data) => {
    for (const _cmd of parseAllCommands(data)) {
      socket.write('-NOAUTH Authentication required\r\n');
    }
  });
}

/** Handler simulating a restricted ACL user: PING is denied (NOPERM) but INFO is allowed. */
function nopermPingHandler(socket: net.Socket | tls.TLSSocket): void {
  socket.on('data', (data) => {
    for (const cmd of parseAllCommands(data)) {
      if (cmd === '__tls_handshake__') {
        socket.write("-ERR Protocol error: expected '*', got '\\x16'\r\n");
      } else if (cmd === 'client') {
        socket.write('+OK\r\n');
      } else if (cmd === 'ping') {
        socket.write("-NOPERM User default has no permissions to run the 'ping' command\r\n");
      } else if (cmd === 'info') {
        socket.write(bulkString(MINIMAL_INFO));
      } else if (cmd === 'module') {
        socket.write(EMPTY_ARRAY);
      }
    }
  });
}

function startPlainServer(
  handler: (s: net.Socket) => void,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer(handler);
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      resolve({
        port,
        close: () => new Promise((res, rej) => server.close((e) => (e ? rej(e) : res()))),
      });
    });
    server.on('error', reject);
  });
}

function startTlsServer(
  handler: (s: tls.TLSSocket) => void,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = tls.createServer(
    {
      key: fs.readFileSync(path.join(FIXTURES, 'server.key')),
      cert: fs.readFileSync(path.join(FIXTURES, 'server.crt')),
    },
    handler,
  );
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      resolve({
        port,
        close: () => new Promise((res, rej) => server.close((e) => (e ? rej(e) : res()))),
      });
    });
    server.on('error', reject);
  });
}

async function getFreePort(): Promise<number> {
  const server = net.createServer();
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port));
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

// ---------------------------------------------------------------------------
// Tests — plain connections (non-TLS)
// ---------------------------------------------------------------------------

describe('probeHost — not Redis / unreachable', () => {
  it('returns isRedis:false for a closed port', async () => {
    const port = await getFreePort();
    const result = await probeHost('127.0.0.1', port, 500);
    expect(result.isRedis).toBe(false);
    expect(result.tls).toBe(false);
  });

  it('returns isRedis:false when server sends non-RESP data', async () => {
    const mock = await startPlainServer((s) => {
      s.on('data', () => s.write('HTTP/1.1 200 OK\r\n\r\n'));
    });
    const result = await probeHost('127.0.0.1', mock.port, 1000);
    await mock.close();
    expect(result.isRedis).toBe(false);
  });
});

describe('probeHost — plain open Redis', () => {
  it('detects an open plain Redis instance', async () => {
    const mock = await startPlainServer(openRedisHandler);
    const result = await probeHost('127.0.0.1', mock.port, 1000);
    await mock.close();
    expect(result.isRedis).toBe(true);
    expect(result.authRequired).toBe(false);
    expect(result.tls).toBe(false);
    expect(result.version).toBe('8.0.0');
    expect(result.role).toBe('master');
  });

  it('also fetches memory, keyspace, and an empty module list', async () => {
    const mock = await startPlainServer(openRedisHandler);
    const result = await probeHost('127.0.0.1', mock.port, 1000);
    await mock.close();
    expect(result.memory.usedMemoryBytes).toBe(1048576);
    expect(result.memory.maxMemoryPolicy).toBe('noeviction');
    expect(result.keyspace).toEqual([{ db: 0, keys: 3, expires: 0, avgTtlMs: 0 }]);
    expect(result.modules).toEqual([]);
    expect(result.clusterInfo).toBeNull();
  });
});

describe('probeHost — modules', () => {
  it('parses a non-empty MODULE LIST reply, including the real name/ver/path/args shape', async () => {
    const mock = await startPlainServer((socket) => {
      socket.on('data', (data) => {
        for (const cmd of parseAllCommands(data)) {
          if (cmd === 'client') socket.write('+OK\r\n');
          else if (cmd === 'ping') socket.write('+PONG\r\n');
          else if (cmd === 'info') socket.write(bulkString(MINIMAL_INFO));
          else if (cmd === 'module') {
            socket.write(
              respEncode([
                [
                  'name',
                  'search',
                  'ver',
                  20811,
                  'path',
                  '/usr/lib/redis/modules/redisearch.so',
                  'args',
                  [],
                ],
                [
                  'name',
                  'ReJSON',
                  'ver',
                  20609,
                  'path',
                  '/usr/lib/redis/modules/rejson.so',
                  'args',
                  [],
                ],
              ]),
            );
          }
        }
      });
    });
    const result = await probeHost('127.0.0.1', mock.port, 1000);
    await mock.close();
    expect(result.modules).toEqual([
      { name: 'search', version: 20811, path: '/usr/lib/redis/modules/redisearch.so' },
      { name: 'ReJSON', version: 20609, path: '/usr/lib/redis/modules/rejson.so' },
    ]);
    expect(result.product).toBe('redis');
  });

  it("classifies as 'enterprise' when a module reports the enterprise-managed path, even though maxmemory is present", async () => {
    // Verbatim structure from a live Redis Cloud instance. server_name is
    // absent (as on any pre-7.4-style INFO) but maxmemory IS present here —
    // a case the maxmemory-absence heuristic alone would miss — so this
    // specifically proves the module-path signal catches what the other one
    // doesn't.
    const info =
      '# Server\r\nredis_version:8.6.2\r\nredis_mode:standalone\r\nrole:master\r\n# Memory\r\nused_memory:2484368\r\nmaxmemory:0\r\nmaxmemory_policy:volatile-lru\r\n';
    const mock = await startPlainServer((socket) => {
      socket.on('data', (data) => {
        for (const cmd of parseAllCommands(data)) {
          if (cmd === 'client') socket.write('+OK\r\n');
          else if (cmd === 'ping') socket.write('+PONG\r\n');
          else if (cmd === 'info') socket.write(bulkString(info));
          else if (cmd === 'module') {
            socket.write(
              respEncode([
                ['name', 'search', 'ver', 80606, 'path', '/enterprise-managed', 'args', []],
              ]),
            );
          }
        }
      });
    });
    const result = await probeHost('127.0.0.1', mock.port, 1000);
    await mock.close();
    expect(result.product).toBe('enterprise');
  });
});

describe('probeHost — cluster mode', () => {
  it('fetches CLUSTER INFO when redis_mode is cluster', async () => {
    const clusterInfoText =
      'cluster_enabled:1\r\ncluster_state:ok\r\ncluster_slots_assigned:16384\r\ncluster_known_nodes:6\r\ncluster_size:3\r\n';
    const mock = await startPlainServer((socket) => {
      socket.on('data', (data) => {
        for (const cmd of parseAllCommands(data)) {
          if (cmd === 'client') socket.write('+OK\r\n');
          else if (cmd === 'ping') socket.write('+PONG\r\n');
          else if (cmd === 'info') {
            socket.write(
              bulkString('redis_version:7.2.0\r\nredis_mode:cluster\r\nrole:master\r\n'),
            );
          } else if (cmd === 'module') socket.write(EMPTY_ARRAY);
          else if (cmd === 'cluster') socket.write(bulkString(clusterInfoText));
        }
      });
    });
    const result = await probeHost('127.0.0.1', mock.port, 1000);
    await mock.close();
    expect(result.mode).toBe('cluster');
    expect(result.clusterInfo).toEqual({
      enabled: true,
      state: 'ok',
      slotsAssigned: 16384,
      knownNodes: 6,
      size: 3,
    });
  });

  it('does not attempt CLUSTER INFO in standalone mode', async () => {
    const mock = await startPlainServer(openRedisHandler);
    const result = await probeHost('127.0.0.1', mock.port, 1000);
    await mock.close();
    expect(result.mode).toBe('standalone');
    expect(result.clusterInfo).toBeNull();
  });

  it('resolves with clusterInfo:null (not a failed probe) when CLUSTER INFO is rejected', async () => {
    // Observed on a live Redis Cloud instance: CLUSTER INFO returns an error
    // even though redis_mode reports cluster. The rest of the probe must
    // still succeed.
    const mock = await startPlainServer((socket) => {
      socket.on('data', (data) => {
        for (const cmd of parseAllCommands(data)) {
          if (cmd === 'client') socket.write('+OK\r\n');
          else if (cmd === 'ping') socket.write('+PONG\r\n');
          else if (cmd === 'info') {
            socket.write(
              bulkString('redis_version:8.6.2\r\nredis_mode:cluster\r\nrole:master\r\n'),
            );
          } else if (cmd === 'module') socket.write(EMPTY_ARRAY);
          else if (cmd === 'cluster')
            socket.write('-ERR This instance has cluster support disabled\r\n');
        }
      });
    });
    const result = await probeHost('127.0.0.1', mock.port, 1000);
    await mock.close();
    expect(result.isRedis).toBe(true);
    expect(result.mode).toBe('cluster');
    expect(result.clusterInfo).toBeNull();
  });
});

describe('probeHost — auth required (plain)', () => {
  it('detects NOAUTH and marks authRequired:true', async () => {
    const mock = await startPlainServer(noauthHandler);
    const result = await probeHost('127.0.0.1', mock.port, 1000);
    await mock.close();
    expect(result.isRedis).toBe(true);
    expect(result.authRequired).toBe(true);
    expect(result.tls).toBe(false);
    expect(result.version).toBeNull();
  });
});

describe('probeHost — NOPERM on PING', () => {
  it('still detects Redis when PING is denied by ACL but INFO is allowed', async () => {
    const mock = await startPlainServer(nopermPingHandler);
    const result = await probeHost('127.0.0.1', mock.port, 1000);
    await mock.close();
    expect(result.isRedis).toBe(true);
    expect(result.authRequired).toBe(false);
    expect(result.version).toBe('8.0.0');
  });
});

// ---------------------------------------------------------------------------
// Tests — TLS connections
// ---------------------------------------------------------------------------

describe('probeHost — TLS open Redis', () => {
  it('detects a TLS Redis instance when tls:true', async () => {
    const mock = await startTlsServer(openRedisHandler);
    const result = await probeHost('127.0.0.1', mock.port, 2000, {
      tls: true,
      tlsSkipVerify: true,
    });
    await mock.close();
    expect(result.isRedis).toBe(true);
    expect(result.tls).toBe(true);
    expect(result.authRequired).toBe(false);
    expect(result.version).toBe('8.0.0');
    expect(result.tlsCertificate).not.toBeNull();
    expect(result.tlsCertificate!.subject).toBe('localhost');
    expect(result.tlsCertificate!.selfSigned).toBe(true);
    // Connected with tlsSkipVerify:true, so Node never validated the chain.
    expect(result.tlsCertificate!.trusted).toBe(false);
  });

  it('returns tlsCertificate:null for a plain (non-TLS) connection', async () => {
    const mock = await startPlainServer(openRedisHandler);
    const result = await probeHost('127.0.0.1', mock.port, 1000);
    await mock.close();
    expect(result.isRedis).toBe(true);
    expect(result.tls).toBe(false);
    expect(result.tlsCertificate).toBeNull();
  });

  it('returns tls:false when connecting to a plain server with tls:true (fallback)', async () => {
    const mock = await startPlainServer(openRedisHandler);
    const result = await probeHost('127.0.0.1', mock.port, 2000, {
      tls: true,
      tlsSkipVerify: true,
    });
    await mock.close();
    // TLS attempt fails on a plain socket, probe falls back to plain
    expect(result.isRedis).toBe(true);
    expect(result.tls).toBe(false);
  });

  it('fails cert verification when tlsSkipVerify:false (self-signed)', async () => {
    const mock = await startTlsServer(openRedisHandler);
    const result = await probeHost('127.0.0.1', mock.port, 2000, {
      tls: true,
      tlsSkipVerify: false,
    });
    await mock.close();
    // Self-signed cert rejected → TLS fails → plain fallback also fails (TLS-only server)
    expect(result.isRedis).toBe(false);
  });

  it('detects NOAUTH over TLS', async () => {
    const mock = await startTlsServer(noauthHandler);
    const result = await probeHost('127.0.0.1', mock.port, 2000, {
      tls: true,
      tlsSkipVerify: true,
    });
    await mock.close();
    expect(result.isRedis).toBe(true);
    expect(result.authRequired).toBe(true);
    expect(result.tls).toBe(true);
  });

  it('reads the certificate even when auth is required — the whole point of the field', async () => {
    const mock = await startTlsServer(noauthHandler);
    const result = await probeHost('127.0.0.1', mock.port, 2000, {
      tls: true,
      tlsSkipVerify: true,
    });
    await mock.close();
    expect(result.authRequired).toBe(true);
    expect(result.tlsCertificate).not.toBeNull();
    expect(result.tlsCertificate!.subject).toBe('localhost');
  });

  it('reads the certificate even when the provided password is wrong', async () => {
    const mock = await startTlsServer(authRequiredHandler);
    const result = await probeHost('127.0.0.1', mock.port, 2000, {
      tls: true,
      tlsSkipVerify: true,
      credentials: { password: 'definitely-not-secret' },
    });
    await mock.close();
    expect(result.wrongPassword).toBe(true);
    expect(result.tlsCertificate).not.toBeNull();
    expect(result.tlsCertificate!.subject).toBe('localhost');
  });
});

describe('probeHost — tls:false ignores TLS servers', () => {
  it('returns isRedis:false when connecting without TLS to a TLS-only server', async () => {
    const mock = await startTlsServer(openRedisHandler);
    const result = await probeHost('127.0.0.1', mock.port, 1000);
    await mock.close();
    expect(result.isRedis).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — authentication (P6)
// ---------------------------------------------------------------------------

describe('probeHost — authentication', () => {
  it('retrieves full inventory with correct password', async () => {
    const mock = await startPlainServer(authRequiredHandler);
    const result = await probeHost('127.0.0.1', mock.port, 1000, {
      credentials: { password: 'secret' },
    });
    await mock.close();
    expect(result.isRedis).toBe(true);
    expect(result.authRequired).toBe(false);
    expect(result.wrongPassword).toBe(false);
    expect(result.version).toBe('8.0.0');
    expect(result.role).toBe('master');
  });

  it('marks wrongPassword:true when credentials are rejected', async () => {
    const mock = await startPlainServer(authRequiredHandler);
    const result = await probeHost('127.0.0.1', mock.port, 1000, {
      credentials: { password: 'wrong' },
    });
    await mock.close();
    expect(result.isRedis).toBe(true);
    expect(result.authRequired).toBe(true);
    expect(result.wrongPassword).toBe(true);
    expect(result.version).toBeNull();
  });

  it('retrieves full inventory with correct password over TLS', async () => {
    const mock = await startTlsServer(authRequiredHandler);
    const result = await probeHost('127.0.0.1', mock.port, 2000, {
      tls: true,
      tlsSkipVerify: true,
      credentials: { password: 'secret' },
    });
    await mock.close();
    expect(result.isRedis).toBe(true);
    expect(result.tls).toBe(true);
    expect(result.authRequired).toBe(false);
    expect(result.wrongPassword).toBe(false);
    expect(result.version).toBe('8.0.0');
  });

  it('marks wrongPassword:true when credentials are rejected over TLS', async () => {
    const mock = await startTlsServer(authRequiredHandler);
    const result = await probeHost('127.0.0.1', mock.port, 2000, {
      tls: true,
      tlsSkipVerify: true,
      credentials: { password: 'wrong' },
    });
    await mock.close();
    expect(result.isRedis).toBe(true);
    expect(result.tls).toBe(true);
    expect(result.authRequired).toBe(true);
    expect(result.wrongPassword).toBe(true);
  });
});
