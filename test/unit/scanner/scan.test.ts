import * as net from 'net';
import { describe, it, expect } from 'vitest';
import { buildTargets, scanTargets } from '../../../src/scanner/scan';
import { createScanController } from '../../../src/scanner/control';

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
  const srv = await startServer();
  await srv.close();
  return srv.port;
}

describe('buildTargets', () => {
  it('cross-joins hosts and shared ports when hosts have no explicit port', () => {
    const targets = buildTargets(
      [
        { host: '10.0.0.1', port: null },
        { host: '10.0.0.2', port: null },
      ],
      [6379, 6380],
    );
    expect(targets).toEqual([
      { host: '10.0.0.1', port: 6379 },
      { host: '10.0.0.1', port: 6380 },
      { host: '10.0.0.2', port: 6379 },
      { host: '10.0.0.2', port: 6380 },
    ]);
  });

  it('returns empty array for empty hosts', () => {
    expect(buildTargets([], [6379])).toEqual([]);
  });

  it('returns empty array for empty shared ports when no host has its own explicit port', () => {
    expect(buildTargets([{ host: '10.0.0.1', port: null }], [])).toEqual([]);
  });

  it('gives a host with an explicit port exactly one target, ignoring the shared ports list', () => {
    const targets = buildTargets([{ host: '10.0.0.1', port: 6380 }], [6379, 6381, 6382]);
    expect(targets).toEqual([{ host: '10.0.0.1', port: 6380 }]);
  });

  it('does not cross-join an explicit-port host even when the shared ports list is empty', () => {
    expect(buildTargets([{ host: '10.0.0.1', port: 6380 }], [])).toEqual([
      { host: '10.0.0.1', port: 6380 },
    ]);
  });

  it('handles a mix of explicit-port and shared-port hosts in one call — the exact CSV-upload scenario', () => {
    const targets = buildTargets(
      [
        { host: '10.0.0.1', port: 6380 },
        { host: '10.0.0.2', port: null },
        { host: '10.0.0.3', port: 6381 },
      ],
      [6379],
    );
    expect(targets).toEqual([
      { host: '10.0.0.1', port: 6380 },
      { host: '10.0.0.2', port: 6379 },
      { host: '10.0.0.3', port: 6381 },
    ]);
  });

  it('dedupes an identical (host, port) pair produced by two resolved-host entries — the auto-detect double-subnet bug', () => {
    // e.g. detectLocalCidrs() returning the same /24 twice before its own fix
    // (Wi-Fi and Ethernet on the same subnet), or a literal IP that's also
    // covered by an overlapping CIDR.
    const targets = buildTargets(
      [
        { host: '10.0.0.1', port: null },
        { host: '10.0.0.1', port: null },
        { host: '10.0.0.2', port: null },
      ],
      [6379],
    );
    expect(targets).toEqual([
      { host: '10.0.0.1', port: 6379 },
      { host: '10.0.0.2', port: 6379 },
    ]);
  });

  it('dedupes across explicit-port and shared-port entries that collide on the same (host, port)', () => {
    const targets = buildTargets(
      [
        { host: '10.0.0.1', port: 6379 },
        { host: '10.0.0.1', port: null },
      ],
      [6379],
    );
    expect(targets).toEqual([{ host: '10.0.0.1', port: 6379 }]);
  });
});

describe('scanTargets', () => {
  it('returns empty array for no targets', async () => {
    expect(await scanTargets([])).toEqual([]);
  });

  it('detects open ports', async () => {
    const srv = await startServer();
    const results = await scanTargets([{ host: '127.0.0.1', port: srv.port }]);
    await srv.close();

    expect(results).toHaveLength(1);
    expect(results[0].open).toBe(true);
  });

  it('detects closed ports', async () => {
    const port = await getFreePort();
    const results = await scanTargets([{ host: '127.0.0.1', port }]);
    expect(results[0].open).toBe(false);
  });

  it('handles mixed open and closed ports', async () => {
    const [srv1, srv2] = await Promise.all([startServer(), startServer()]);
    const closedPort = await getFreePort();

    const results = await scanTargets([
      { host: '127.0.0.1', port: srv1.port },
      { host: '127.0.0.1', port: closedPort },
      { host: '127.0.0.1', port: srv2.port },
    ]);

    await Promise.all([srv1.close(), srv2.close()]);

    expect(results.filter((r) => r.open)).toHaveLength(2);
    expect(results.filter((r) => !r.open)).toHaveLength(1);
  });

  it('preserves result order matching input order', async () => {
    const [srv1, srv2] = await Promise.all([startServer(), startServer()]);
    const targets = [
      { host: '127.0.0.1', port: srv1.port },
      { host: '127.0.0.1', port: srv2.port },
    ];

    const results = await scanTargets(targets);
    await Promise.all([srv1.close(), srv2.close()]);

    expect(results[0].port).toBe(srv1.port);
    expect(results[1].port).toBe(srv2.port);
  });

  it('calls onProgress for every target', async () => {
    const [srv1, srv2] = await Promise.all([startServer(), startServer()]);
    const calls: Array<{ done: number; total: number }> = [];

    await scanTargets(
      [
        { host: '127.0.0.1', port: srv1.port },
        { host: '127.0.0.1', port: srv2.port },
      ],
      { onProgress: (_r, done, total) => calls.push({ done, total }) },
    );

    await Promise.all([srv1.close(), srv2.close()]);

    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.total === 2)).toBe(true);
    expect(calls.map((c) => c.done).sort()).toEqual([1, 2]);
  });

  it('respects concurrency option', async () => {
    const servers = await Promise.all(Array.from({ length: 5 }, () => startServer()));
    const targets = servers.map((s) => ({ host: '127.0.0.1', port: s.port }));

    const results = await scanTargets(targets, { concurrency: 2 });
    await Promise.all(servers.map((s) => s.close()));

    expect(results).toHaveLength(5);
    expect(results.every((r) => r.open)).toBe(true);
  });

  it('a stopped controller skips targets as not-open without connecting', async () => {
    const srv = await startServer();
    const controller = createScanController();
    controller.stop();

    const results = await scanTargets([{ host: '127.0.0.1', port: srv.port }], { controller });
    await srv.close();

    expect(results).toEqual([{ host: '127.0.0.1', port: srv.port, open: false, latencyMs: 0 }]);
  });

  it('a paused controller holds targets until resumed', async () => {
    const srv = await startServer();
    const controller = createScanController();
    controller.pause();

    const promise = scanTargets([{ host: '127.0.0.1', port: srv.port }], { controller });
    let settled = false;
    void promise.then(() => {
      settled = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    controller.resume();
    const results = await promise;
    await srv.close();

    expect(results[0].open).toBe(true);
  });
});
