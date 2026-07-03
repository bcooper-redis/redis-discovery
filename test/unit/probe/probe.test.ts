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

/** Minimal RESP command name extractor from a raw buffer. */
function parseCommandName(data: Buffer): string {
  // RESP array: *N\r\n$L\r\nCMD\r\n...
  const lines = data.toString().split('\r\n');
  const dollarIdx = lines.findIndex((l) => l.startsWith('$'));
  return (lines[dollarIdx + 1] ?? '').toLowerCase();
}

/** Write a RESP bulk string response. */
function bulkString(s: string): string {
  return `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
}

const MINIMAL_INFO =
  '# Server\r\nredis_version:8.0.0\r\nserver_name:redis\r\nredis_mode:standalone\r\nos:Test\r\nuptime_in_seconds:100\r\n# Replication\r\nrole:master\r\n';

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
