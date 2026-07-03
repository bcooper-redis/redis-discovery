import * as http from 'http';
import * as net from 'net';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp, createState } from '../../src/web/index';
import type { AppState } from '../../src/web/index';
import type { ScanState } from '../../src/web/state';
import type { DiscoveryResult } from '../../src/types';

const REDIS_8_PORT = parseInt(process.env.REDIS_8_PORT ?? '6379', 10);
const VALKEY_PORT = parseInt(process.env.VALKEY_PORT ?? '6380', 10);

// ---------------------------------------------------------------------------
// Test server helpers
// ---------------------------------------------------------------------------

async function startTestServer(state: AppState): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const app = createApp(state);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))),
  };
}

async function poll(url: string, maxMs = 15000): Promise<ScanState> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const r = await fetch(`${url}/api/results`);
    const state = (await r.json()) as ScanState;
    if (state.status === 'done' || state.status === 'error') return state;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Scan did not complete within timeout');
}

// ---------------------------------------------------------------------------
// Fixture results for stateless endpoint tests
// ---------------------------------------------------------------------------

const FIXTURE: DiscoveryResult = {
  host: '127.0.0.1',
  port: REDIS_8_PORT,
  tls: false,
  product: 'redis',
  version: '8.0.0',
  authRequired: false,
  anonymousStatus: 'open',
  authenticatedStatus: 'not_attempted',
  latency: 2,
  inventory: {
    redisVersion: '8.0.0',
    mode: 'standalone',
    os: 'Linux',
    uptimeSeconds: 3600,
    role: 'master',
  },
};

// Each test gets its own isolated state — prevents background scans from one
// test calling finishScan() into the state of a subsequent test.
let state: AppState;
let server: { url: string; close: () => Promise<void> };

beforeEach(async () => {
  state = createState();
  server = await startTestServer(state);
});

afterEach(async () => {
  await server.close();
});

// ---------------------------------------------------------------------------
// GET /api/results — initial state
// ---------------------------------------------------------------------------

describe('GET /api/results', () => {
  it('returns idle state initially', async () => {
    const r = await fetch(`${server.url}/api/results`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as ScanState;
    expect(body.status).toBe('idle');
    expect(body.results).toEqual([]);
    expect(body.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// POST /api/scan
// ---------------------------------------------------------------------------

describe('POST /api/scan', () => {
  it('returns 202 and starts a scan', async () => {
    const r = await fetch(`${server.url}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cidrs: ['127.0.0.1/32'],
        ports: [REDIS_8_PORT],
        timeoutMs: 3000,
      }),
    });
    expect(r.status).toBe(202);
    const body = await r.json();
    expect(body.status).toBe('scanning');
  });

  it('returns 409 when a scan is already running', async () => {
    // Start first scan
    await fetch(`${server.url}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cidrs: ['127.0.0.1/32'], ports: [REDIS_8_PORT] }),
    });
    // Second scan immediately
    const r = await fetch(`${server.url}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cidrs: ['127.0.0.1/32'], ports: [REDIS_8_PORT] }),
    });
    expect(r.status).toBe(409);
  });

  it('finds Redis 8.x when scan completes', async () => {
    await fetch(`${server.url}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cidrs: ['127.0.0.1/32'],
        ports: [REDIS_8_PORT],
        timeoutMs: 3000,
      }),
    });
    const scanState = await poll(server.url);
    expect(scanState.status).toBe('done');
    expect(scanState.results.length).toBeGreaterThanOrEqual(1);
    const redis = scanState.results.find((r) => r.port === REDIS_8_PORT);
    expect(redis?.product).toBe('redis');
    expect(redis?.version).toMatch(/^8\./);
    expect(redis?.anonymousStatus).toBe('open');
  }, 20000);

  it('finds both Redis and Valkey in a multi-port scan', async () => {
    await fetch(`${server.url}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cidrs: ['127.0.0.1/32'],
        ports: [REDIS_8_PORT, VALKEY_PORT],
        timeoutMs: 3000,
      }),
    });
    const scanState = await poll(server.url);
    expect(scanState.status).toBe('done');
    expect(scanState.results.length).toBeGreaterThanOrEqual(2);
    const products = scanState.results.map((r) => r.product);
    expect(products).toContain('redis');
    expect(products).toContain('valkey');
  }, 20000);

  it('returns 400 for invalid port spec', async () => {
    const r = await fetch(`${server.url}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cidrs: ['127.0.0.1/32'], ports: 'notaport' }),
    });
    expect(r.status).toBe(400);
  });

  it('returns 400 for a CIDR range that is too large to scan', async () => {
    const r = await fetch(`${server.url}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cidrs: ['0.0.0.0/8'], ports: [REDIS_8_PORT] }),
    });
    expect(r.status).toBe(400);
  });

  it('reports progress in GET /api/results during scan', async () => {
    await fetch(`${server.url}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cidrs: ['127.0.0.1/32'],
        ports: [REDIS_8_PORT],
        timeoutMs: 3000,
      }),
    });
    const scanState = await poll(server.url);
    expect(scanState.progress.scanTotal).toBeGreaterThan(0);
    expect(scanState.progress.probeDone).toBeGreaterThanOrEqual(0);
  }, 20000);
});

// ---------------------------------------------------------------------------
// POST /api/authenticate
// ---------------------------------------------------------------------------

describe('POST /api/authenticate', () => {
  it('returns authenticated:true for open (no-auth) Redis', async () => {
    const r = await fetch(`${server.url}/api/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '127.0.0.1', port: REDIS_8_PORT, password: 'anypass' }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    // Open Redis: no auth required, any credentials accepted (ERR → treated as open)
    expect(body.host).toBe('127.0.0.1');
    expect(body.port).toBe(REDIS_8_PORT);
    expect(typeof body.authenticated).toBe('boolean');
    expect(typeof body.wrongPassword).toBe('boolean');
  });

  it('returns 400 when host is missing', async () => {
    const r = await fetch(`${server.url}/api/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: REDIS_8_PORT, password: 'x' }),
    });
    expect(r.status).toBe(400);
  });

  it('returns 400 when password is missing', async () => {
    const r = await fetch(`${server.url}/api/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '127.0.0.1', port: REDIS_8_PORT }),
    });
    expect(r.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/inventory
// ---------------------------------------------------------------------------

describe('POST /api/inventory', () => {
  it('returns a DiscoveryResult with inventory for open Redis', async () => {
    const r = await fetch(`${server.url}/api/inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '127.0.0.1', port: REDIS_8_PORT, password: 'anypass' }),
    });
    expect(r.status).toBe(200);
    const result = (await r.json()) as DiscoveryResult;
    expect(result.host).toBe('127.0.0.1');
    expect(result.port).toBe(REDIS_8_PORT);
    expect(result.product).toBe('redis');
    // Open Redis with any password: treated as authenticated (no auth needed)
    expect(result.inventory).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /api/export/csv
// ---------------------------------------------------------------------------

describe('GET /api/export/csv', () => {
  it('returns a CSV with the correct Content-Type', async () => {
    state.finishScan([FIXTURE]);
    const r = await fetch(`${server.url}/api/export/csv`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/csv');
  });

  it('includes header row', async () => {
    state.finishScan([FIXTURE]);
    const text = await (await fetch(`${server.url}/api/export/csv`)).text();
    expect(text).toContain('Host');
    expect(text).toContain('Product');
  });

  it('includes result data', async () => {
    state.finishScan([FIXTURE]);
    const text = await (await fetch(`${server.url}/api/export/csv`)).text();
    expect(text).toContain('127.0.0.1');
    expect(text).toContain('redis');
  });

  it('returns only header when results are empty', async () => {
    const text = await (await fetch(`${server.url}/api/export/csv`)).text();
    const rows = text.split('\r\n').filter(Boolean);
    expect(rows).toHaveLength(1);
  });

  it('includes Content-Disposition attachment header', async () => {
    const r = await fetch(`${server.url}/api/export/csv`);
    expect(r.headers.get('content-disposition')).toContain('attachment');
  });
});

// ---------------------------------------------------------------------------
// Web UI static pages
// ---------------------------------------------------------------------------

describe('Web UI static pages', () => {
  it('serves the Dashboard at the root path', async () => {
    const r = await fetch(`${server.url}/`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    expect(await r.text()).toContain('New scan');
  });

  it('serves the Results page', async () => {
    const r = await fetch(`${server.url}/results.html`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('Scan results');
  });

  it('serves the Settings page', async () => {
    const r = await fetch(`${server.url}/settings.html`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('Default scan settings');
  });

  it('serves the About page', async () => {
    const r = await fetch(`${server.url}/about.html`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('Redis Scanner');
  });

  it('serves each page-controller script', async () => {
    for (const file of ['dashboard.js', 'results.js', 'settings.js']) {
      const r = await fetch(`${server.url}/${file}`);
      expect(r.status, `${file} should be served`).toBe(200);
      expect(r.headers.get('content-type')).toContain('javascript');
    }
  });

  it('sets a Referrer-Policy header', async () => {
    const r = await fetch(`${server.url}/`);
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('serves the shared stylesheet', async () => {
    const r = await fetch(`${server.url}/styles.css`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/css');
  });
});
