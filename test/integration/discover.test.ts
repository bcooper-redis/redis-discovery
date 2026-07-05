import { describe, it, expect } from 'vitest';
import { discover } from '../../src/inventory/discover';
import { createScanController } from '../../src/scanner/control';
import type { ScanConfig } from '../../src/types';

const BASE_CONFIG: ScanConfig = {
  cidrs: ['127.0.0.1/32'],
  ports: [6379, 6380],
  timeoutMs: 3000,
  tls: false,
  tlsSkipVerify: false,
  concurrency: 10,
};

const REDIS_8_PORT = parseInt(process.env.REDIS_8_PORT ?? '6379', 10);
const VALKEY_PORT = parseInt(process.env.VALKEY_PORT ?? '6380', 10);
const REDIS_AUTH_PORT = process.env.REDIS_AUTH_PORT
  ? parseInt(process.env.REDIS_AUTH_PORT, 10)
  : null;
const REDIS_AUTH_PASSWORD = process.env.REDIS_AUTH_PASSWORD ?? 'testpassword';

const describeIf = (condition: boolean) => (condition ? describe : describe.skip);

describe('discover — end-to-end pipeline', () => {
  it('finds Redis 8.x and Valkey on local containers', async () => {
    const results = await discover(BASE_CONFIG);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('results are sorted by host then port', async () => {
    const results = await discover(BASE_CONFIG);
    for (let i = 1; i < results.length; i++) {
      const prev = results[i - 1];
      const curr = results[i];
      const hostOrder = prev.host.localeCompare(curr.host);
      if (hostOrder === 0) {
        expect(prev.port).toBeLessThanOrEqual(curr.port);
      } else {
        expect(hostOrder).toBeLessThanOrEqual(0);
      }
    }
  });

  it('Redis 8.x result has expected shape', async () => {
    const results = await discover({
      ...BASE_CONFIG,
      ports: [REDIS_8_PORT],
    });
    expect(results.length).toBe(1);
    const r = results[0];
    expect(r.host).toBe('127.0.0.1');
    expect(r.port).toBe(REDIS_8_PORT);
    expect(r.product).toBe('redis');
    expect(r.version).toMatch(/^8\./);
    expect(r.authRequired).toBe(false);
    expect(r.anonymousStatus).toBe('open');
    expect(r.authenticatedStatus).toBe('not_attempted');
    expect(r.inventory).not.toBeNull();
    expect(r.inventory!.redisVersion).toMatch(/^8\./);
    expect(r.latency).toBeGreaterThanOrEqual(0);
    expect(r.inventory!.memory.usedMemoryBytes).toBeGreaterThan(0);
    expect(r.inventory!.memory.maxMemoryPolicy).not.toBeNull();
    expect(r.inventory!.replication.connectedReplicas).toEqual([]);
    expect(Array.isArray(r.inventory!.keyspace)).toBe(true);
    expect(Array.isArray(r.inventory!.modules)).toBe(true);
    expect(r.inventory!.clusterInfo).toBeNull(); // standalone container, not cluster mode
  });

  it('Valkey result has expected shape', async () => {
    const results = await discover({
      ...BASE_CONFIG,
      ports: [VALKEY_PORT],
    });
    expect(results.length).toBe(1);
    const r = results[0];
    expect(r.product).toBe('valkey');
    expect(r.anonymousStatus).toBe('open');
    expect(r.inventory).not.toBeNull();
  });

  it('skips closed ports and returns no results for unreachable CIDR', async () => {
    const results = await discover({
      ...BASE_CONFIG,
      ports: [19999], // nothing listening here
    });
    expect(results).toEqual([]);
  });

  it('fires onScanProgress and onProbeProgress callbacks', async () => {
    const scanTicks: number[] = [];
    const probeTicks: number[] = [];

    await discover(BASE_CONFIG, {
      onScanProgress: (done, _total) => scanTicks.push(done),
      onProbeProgress: (done, _total) => probeTicks.push(done),
    });

    expect(scanTicks.length).toBeGreaterThan(0);
    expect(scanTicks[scanTicks.length - 1]).toBe(2); // 127.0.0.1 × 2 ports
    expect(probeTicks.length).toBeGreaterThan(0);
  });

  it('fires onResult for each found Redis instance', async () => {
    const found: string[] = [];
    await discover(BASE_CONFIG, {
      onResult: (r) => found.push(`${r.host}:${r.port}`),
    });
    expect(found).toContain(`127.0.0.1:${REDIS_8_PORT}`);
    expect(found).toContain(`127.0.0.1:${VALKEY_PORT}`);
  });
});

describe('discover — hostname targets', () => {
  it('resolves a hostname target and finds the same instances as its IP', async () => {
    const results = await discover({ ...BASE_CONFIG, cidrs: ['localhost'] });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.host === '127.0.0.1')).toBe(true);
  });

  it('rejects the scan with a clear error when a hostname cannot be resolved', async () => {
    await expect(
      discover({ ...BASE_CONFIG, cidrs: ['this-does-not-exist.invalid'] }),
    ).rejects.toThrow(/could not resolve hostname/i);
  });
});

describe('discover — scan control', () => {
  it('a pre-stopped controller finds nothing', async () => {
    const controller = createScanController();
    controller.stop();
    const results = await discover(BASE_CONFIG, { controller });
    expect(results).toEqual([]);
  });

  it('pausing holds the scan until resumed, then it completes normally', async () => {
    const controller = createScanController();
    controller.pause();

    const promise = discover(BASE_CONFIG, { controller });
    let settled = false;
    void promise.then(() => {
      settled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(settled).toBe(false);

    controller.resume();
    const results = await promise;
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});

describeIf(REDIS_AUTH_PORT !== null)(
  `discover — auth-required server on port ${REDIS_AUTH_PORT}`,
  () => {
    const authConfig: ScanConfig = {
      ...BASE_CONFIG,
      ports: [REDIS_AUTH_PORT!],
    };

    it('returns result with anonymousStatus:auth_required without credentials', async () => {
      const results = await discover(authConfig);
      expect(results.length).toBe(1);
      expect(results[0].anonymousStatus).toBe('auth_required');
      expect(results[0].authenticatedStatus).toBe('not_attempted');
      expect(results[0].inventory).toBeNull();
    });

    it('retrieves inventory with correct credentials', async () => {
      const results = await discover(authConfig, {
        credentials: { password: REDIS_AUTH_PASSWORD },
      });
      expect(results.length).toBe(1);
      expect(results[0].anonymousStatus).toBe('open');
      expect(results[0].authenticatedStatus).toBe('authenticated');
      expect(results[0].inventory).not.toBeNull();
    });

    it('marks auth_failed with wrong credentials', async () => {
      const results = await discover(authConfig, {
        credentials: { password: 'definitelywrong' },
      });
      expect(results.length).toBe(1);
      expect(results[0].authenticatedStatus).toBe('auth_failed');
      expect(results[0].inventory).toBeNull();
    });
  },
);
