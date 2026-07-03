import * as net from 'net';
import { describe, it, expect, afterEach } from 'vitest';
import { tcpProbe } from '../../../src/scanner/tcp';

// Helpers

function startServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      resolve({
        port,
        close: () => new Promise((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      });
    });
    server.on('error', reject);
  });
}

async function getFreePort(): Promise<number> {
  const { port, close } = await startServer();
  await close();
  return port;
}

// Tests

describe('tcpProbe — open port', () => {
  let close: () => Promise<void>;

  afterEach(async () => {
    await close?.();
  });

  it('returns open:true when a server is listening', async () => {
    ({ close } = await startServer().then((s) => ({ ...s, close: s.close })));
    const srv = await startServer();
    close = srv.close;

    const result = await tcpProbe('127.0.0.1', srv.port, 1000);
    expect(result.open).toBe(true);
    expect(result.host).toBe('127.0.0.1');
    expect(result.port).toBe(srv.port);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('records a non-negative latency', async () => {
    const srv = await startServer();
    close = srv.close;
    const result = await tcpProbe('127.0.0.1', srv.port, 1000);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe('tcpProbe — closed port', () => {
  it('returns open:false when nothing is listening', async () => {
    const port = await getFreePort();
    const result = await tcpProbe('127.0.0.1', port, 1000);
    expect(result.open).toBe(false);
  });

  it('preserves host and port in result', async () => {
    const port = await getFreePort();
    const result = await tcpProbe('127.0.0.1', port, 1000);
    expect(result.host).toBe('127.0.0.1');
    expect(result.port).toBe(port);
  });
});

describe('tcpProbe — timeout', () => {
  it('returns open:false within reasonable time on unresponsive address', async () => {
    // 192.0.2.0/24 is TEST-NET-1 (RFC 5737) — not routable, no RST expected
    const start = Date.now();
    const result = await tcpProbe('192.0.2.1', 6379, 150);
    expect(result.open).toBe(false);
    expect(Date.now() - start).toBeLessThan(3000);
  }, 5000);
});

describe('tcpProbe — concurrent calls', () => {
  it('handles multiple simultaneous probes without interference', async () => {
    const servers = await Promise.all([startServer(), startServer(), startServer()]);
    const results = await Promise.all(servers.map((s) => tcpProbe('127.0.0.1', s.port, 1000)));
    expect(results.every((r) => r.open)).toBe(true);
    await Promise.all(servers.map((s) => s.close()));
  });
});
