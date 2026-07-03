import { describe, it, expect } from 'vitest';
import { probeHost } from '../../src/probe/index';

// Configurable via env so containers can be added without editing test code
const REDIS_8_HOST = process.env.REDIS_8_HOST ?? '127.0.0.1';
const REDIS_8_PORT = parseInt(process.env.REDIS_8_PORT ?? '6379', 10);

const REDIS_AUTH_HOST = process.env.REDIS_AUTH_HOST ?? '127.0.0.1';
const REDIS_AUTH_PORT = process.env.REDIS_AUTH_PORT
  ? parseInt(process.env.REDIS_AUTH_PORT, 10)
  : null;
const REDIS_AUTH_PASSWORD = process.env.REDIS_AUTH_PASSWORD ?? 'testpassword';

const VALKEY_HOST = process.env.VALKEY_HOST ?? '127.0.0.1';
const VALKEY_PORT = parseInt(process.env.VALKEY_PORT ?? '6380', 10);

const REDIS_7_HOST = process.env.REDIS_7_HOST ?? '127.0.0.1';
const REDIS_7_PORT = process.env.REDIS_7_PORT ? parseInt(process.env.REDIS_7_PORT, 10) : null;

const REDIS_TLS_HOST = process.env.REDIS_TLS_HOST ?? '127.0.0.1';
const REDIS_TLS_PORT = process.env.REDIS_TLS_PORT ? parseInt(process.env.REDIS_TLS_PORT, 10) : null;

describe(`Redis 8.x — ${REDIS_8_HOST}:${REDIS_8_PORT}`, () => {
  it('identifies as Redis', async () => {
    const result = await probeHost(REDIS_8_HOST, REDIS_8_PORT, 3000);
    expect(result.isRedis).toBe(true);
  });

  it('reports no auth required', async () => {
    const result = await probeHost(REDIS_8_HOST, REDIS_8_PORT, 3000);
    expect(result.authRequired).toBe(false);
  });

  it('detects product as redis', async () => {
    const result = await probeHost(REDIS_8_HOST, REDIS_8_PORT, 3000);
    expect(result.product).toBe('redis');
  });

  it('parses a version string starting with 8.', async () => {
    const result = await probeHost(REDIS_8_HOST, REDIS_8_PORT, 3000);
    expect(result.version).toMatch(/^8\./);
  });

  it('reports standalone mode', async () => {
    const result = await probeHost(REDIS_8_HOST, REDIS_8_PORT, 3000);
    expect(result.mode).toBe('standalone');
  });

  it('reports master role', async () => {
    const result = await probeHost(REDIS_8_HOST, REDIS_8_PORT, 3000);
    expect(result.role).toBe('master');
  });

  it('reports a non-negative uptime', async () => {
    const result = await probeHost(REDIS_8_HOST, REDIS_8_PORT, 3000);
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('includes raw INFO in result', async () => {
    const result = await probeHost(REDIS_8_HOST, REDIS_8_PORT, 3000);
    expect(result.rawInfo).toContain('redis_version');
  });
});

describe(`Valkey — ${VALKEY_HOST}:${VALKEY_PORT}`, () => {
  it('identifies as Redis-compatible', async () => {
    const result = await probeHost(VALKEY_HOST, VALKEY_PORT, 3000);
    expect(result.isRedis).toBe(true);
  });

  it('reports no auth required', async () => {
    const result = await probeHost(VALKEY_HOST, VALKEY_PORT, 3000);
    expect(result.authRequired).toBe(false);
  });

  it('detects product as valkey', async () => {
    const result = await probeHost(VALKEY_HOST, VALKEY_PORT, 3000);
    expect(result.product).toBe('valkey');
  });

  it('parses a version string', async () => {
    const result = await probeHost(VALKEY_HOST, VALKEY_PORT, 3000);
    expect(result.version).toMatch(/^\d+\.\d+/);
  });

  it('reports master role', async () => {
    const result = await probeHost(VALKEY_HOST, VALKEY_PORT, 3000);
    expect(result.role).toBe('master');
  });

  it('reports a non-negative uptime', async () => {
    const result = await probeHost(VALKEY_HOST, VALKEY_PORT, 3000);
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});

// Conditional describe helper — skips suites when the required container isn't running
const describeIf = (condition: boolean) => (condition ? describe : describe.skip);

describeIf(REDIS_TLS_PORT !== null)(`Redis TLS — ${REDIS_TLS_HOST}:${REDIS_TLS_PORT}`, () => {
  it('detects Redis over TLS with skip-verify', async () => {
    const result = await probeHost(REDIS_TLS_HOST, REDIS_TLS_PORT!, 3000, {
      tls: true,
      tlsSkipVerify: true,
    });
    expect(result.isRedis).toBe(true);
    expect(result.tls).toBe(true);
  });

  it('reports no auth required', async () => {
    const result = await probeHost(REDIS_TLS_HOST, REDIS_TLS_PORT!, 3000, {
      tls: true,
      tlsSkipVerify: true,
    });
    expect(result.authRequired).toBe(false);
  });

  it('returns isRedis:false without tls:true option', async () => {
    const result = await probeHost(REDIS_TLS_HOST, REDIS_TLS_PORT!, 3000);
    expect(result.isRedis).toBe(false);
  });
});

// Redis 7.x tests — only run when REDIS_7_PORT is configured

describeIf(REDIS_7_PORT !== null)(`Redis 7.x — ${REDIS_7_HOST}:${REDIS_7_PORT}`, () => {
  it('identifies as Redis', async () => {
    const result = await probeHost(REDIS_7_HOST, REDIS_7_PORT!, 3000);
    expect(result.isRedis).toBe(true);
  });

  it('parses a version string starting with 7.', async () => {
    const result = await probeHost(REDIS_7_HOST, REDIS_7_PORT!, 3000);
    expect(result.version).toMatch(/^7\./);
  });

  it('detects product as redis', async () => {
    const result = await probeHost(REDIS_7_HOST, REDIS_7_PORT!, 3000);
    expect(result.product).toBe('redis');
  });
});

// Auth tests — only run when REDIS_AUTH_PORT is configured
// Start a password-protected Redis with: docker run -p <port>:6379 redis redis-server --requirepass testpassword

describeIf(REDIS_AUTH_PORT !== null)(
  `Redis (auth required) — ${REDIS_AUTH_HOST}:${REDIS_AUTH_PORT}`,
  () => {
    it('reports authRequired:true when probing anonymously', async () => {
      const result = await probeHost(REDIS_AUTH_HOST, REDIS_AUTH_PORT!, 3000);
      expect(result.isRedis).toBe(true);
      expect(result.authRequired).toBe(true);
      expect(result.wrongPassword).toBe(false);
    });

    it('retrieves full inventory with correct credentials', async () => {
      const result = await probeHost(REDIS_AUTH_HOST, REDIS_AUTH_PORT!, 3000, {
        credentials: { password: REDIS_AUTH_PASSWORD },
      });
      expect(result.isRedis).toBe(true);
      expect(result.authRequired).toBe(false);
      expect(result.wrongPassword).toBe(false);
      expect(result.version).toMatch(/^\d+\./);
      expect(result.rawInfo).toContain('redis_version');
    });

    it('marks wrongPassword:true with incorrect credentials', async () => {
      const result = await probeHost(REDIS_AUTH_HOST, REDIS_AUTH_PORT!, 3000, {
        credentials: { password: 'definitelywrong' },
      });
      expect(result.isRedis).toBe(true);
      expect(result.authRequired).toBe(true);
      expect(result.wrongPassword).toBe(true);
    });
  },
);
