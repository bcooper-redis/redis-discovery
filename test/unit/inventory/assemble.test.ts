import { describe, it, expect } from 'vitest';
import { assembleResult } from '../../../src/inventory/assemble';
import type { TcpProbeResult } from '../../../src/scanner/tcp';
import type { ProbeResult } from '../../../src/probe/index';

const BASE_TCP: TcpProbeResult = { host: '10.0.0.1', port: 6379, open: true, latencyMs: 5 };

const NO_REPLICATION = {
  connectedReplicas: [],
  masterHost: null,
  masterPort: null,
  masterLinkStatus: null,
};
const NO_MEMORY = { usedMemoryBytes: null, maxMemoryBytes: null, maxMemoryPolicy: null };

const OPEN_PROBE: ProbeResult = {
  isRedis: true,
  authRequired: false,
  wrongPassword: false,
  tls: false,
  product: 'redis',
  version: '8.0.0',
  mode: 'standalone',
  os: 'Linux',
  uptimeSeconds: 3600,
  role: 'master',
  replication: {
    connectedReplicas: [{ ip: '127.0.0.1', port: 6380, state: 'online', offset: 14, lag: 0 }],
    masterHost: null,
    masterPort: null,
    masterLinkStatus: null,
  },
  memory: { usedMemoryBytes: 1048576, maxMemoryBytes: null, maxMemoryPolicy: 'noeviction' },
  keyspace: [{ db: 0, keys: 5, expires: 1, avgTtlMs: 0 }],
  modules: [{ name: 'search', version: 20811, path: '/usr/lib/redis/modules/redisearch.so' }],
  clusterInfo: null,
  rawInfo: '# Server\nredis_version:8.0.0\n',
};

const AUTH_PROBE: ProbeResult = {
  isRedis: true,
  authRequired: true,
  wrongPassword: false,
  tls: false,
  product: 'unknown',
  version: null,
  mode: null,
  os: null,
  uptimeSeconds: null,
  role: null,
  replication: NO_REPLICATION,
  memory: NO_MEMORY,
  keyspace: [],
  modules: [],
  clusterInfo: null,
  rawInfo: null,
};

const WRONG_PASS_PROBE: ProbeResult = { ...AUTH_PROBE, wrongPassword: true };

const NOT_REDIS_PROBE: ProbeResult = {
  isRedis: false,
  authRequired: false,
  wrongPassword: false,
  tls: false,
  product: 'unknown',
  version: null,
  mode: null,
  os: null,
  uptimeSeconds: null,
  role: null,
  replication: NO_REPLICATION,
  memory: NO_MEMORY,
  keyspace: [],
  modules: [],
  clusterInfo: null,
  rawInfo: null,
};

// ---------------------------------------------------------------------------
// host / port / latency pass-through
// ---------------------------------------------------------------------------

describe('assembleResult — identity fields', () => {
  it('copies host, port, latency from TCP result', () => {
    const r = assembleResult(BASE_TCP, OPEN_PROBE, false);
    expect(r.host).toBe('10.0.0.1');
    expect(r.port).toBe(6379);
    expect(r.latency).toBe(5);
  });

  it('copies tls, product, version from probe result', () => {
    const r = assembleResult(BASE_TCP, OPEN_PROBE, false);
    expect(r.tls).toBe(false);
    expect(r.product).toBe('redis');
    expect(r.version).toBe('8.0.0');
  });

  it('reflects tls:true from TLS probe', () => {
    const r = assembleResult(BASE_TCP, { ...OPEN_PROBE, tls: true }, false);
    expect(r.tls).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// anonymousStatus derivation
// ---------------------------------------------------------------------------

describe('assembleResult — anonymousStatus', () => {
  it("'open' when Redis is reachable without auth", () => {
    expect(assembleResult(BASE_TCP, OPEN_PROBE, false).anonymousStatus).toBe('open');
  });

  it("'auth_required' when auth is needed", () => {
    expect(assembleResult(BASE_TCP, AUTH_PROBE, false).anonymousStatus).toBe('auth_required');
  });

  it("'auth_required' when wrong password (server is Redis but locked)", () => {
    expect(assembleResult(BASE_TCP, WRONG_PASS_PROBE, true).anonymousStatus).toBe('auth_required');
  });

  it("'error' when TCP was open but probe says not Redis", () => {
    expect(assembleResult(BASE_TCP, NOT_REDIS_PROBE, false).anonymousStatus).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// authenticatedStatus derivation
// ---------------------------------------------------------------------------

describe('assembleResult — authenticatedStatus', () => {
  it("'not_attempted' when no credentials given", () => {
    expect(assembleResult(BASE_TCP, OPEN_PROBE, false).authenticatedStatus).toBe('not_attempted');
  });

  it("'authenticated' when credentials provided and accepted", () => {
    expect(assembleResult(BASE_TCP, OPEN_PROBE, true).authenticatedStatus).toBe('authenticated');
  });

  it("'auth_failed' when credentials provided but wrongPassword:true", () => {
    expect(assembleResult(BASE_TCP, WRONG_PASS_PROBE, true).authenticatedStatus).toBe(
      'auth_failed',
    );
  });

  it("'not_attempted' still when credentials absent even if authRequired", () => {
    expect(assembleResult(BASE_TCP, AUTH_PROBE, false).authenticatedStatus).toBe('not_attempted');
  });
});

// ---------------------------------------------------------------------------
// inventory population
// ---------------------------------------------------------------------------

describe('assembleResult — inventory', () => {
  it('populates full inventory for open Redis', () => {
    const { inventory } = assembleResult(BASE_TCP, OPEN_PROBE, false);
    expect(inventory).not.toBeNull();
    expect(inventory!.redisVersion).toBe('8.0.0');
    expect(inventory!.mode).toBe('standalone');
    expect(inventory!.os).toBe('Linux');
    expect(inventory!.uptimeSeconds).toBe(3600);
    expect(inventory!.role).toBe('master');
  });

  it('passes through replication, memory, keyspace, modules, and clusterInfo unchanged', () => {
    const { inventory } = assembleResult(BASE_TCP, OPEN_PROBE, false);
    expect(inventory!.replication).toBe(OPEN_PROBE.replication);
    expect(inventory!.memory).toBe(OPEN_PROBE.memory);
    expect(inventory!.keyspace).toBe(OPEN_PROBE.keyspace);
    expect(inventory!.modules).toBe(OPEN_PROBE.modules);
    expect(inventory!.clusterInfo).toBe(OPEN_PROBE.clusterInfo);
  });

  it('inventory is null when authRequired', () => {
    expect(assembleResult(BASE_TCP, AUTH_PROBE, false).inventory).toBeNull();
  });

  it('inventory is null when not Redis', () => {
    expect(assembleResult(BASE_TCP, NOT_REDIS_PROBE, false).inventory).toBeNull();
  });

  it('inventory is null when version is null (partial parse)', () => {
    const partial: ProbeResult = { ...OPEN_PROBE, version: null };
    expect(assembleResult(BASE_TCP, partial, false).inventory).toBeNull();
  });

  it("defaults null mode to 'standalone'", () => {
    const r = assembleResult(BASE_TCP, { ...OPEN_PROBE, mode: null }, false);
    expect(r.inventory!.mode).toBe('standalone');
  });

  it("defaults null role to 'unknown'", () => {
    const r = assembleResult(BASE_TCP, { ...OPEN_PROBE, role: null }, false);
    expect(r.inventory!.role).toBe('unknown');
  });

  it('defaults null os to empty string', () => {
    const r = assembleResult(BASE_TCP, { ...OPEN_PROBE, os: null }, false);
    expect(r.inventory!.os).toBe('');
  });

  it('defaults null uptimeSeconds to 0', () => {
    const r = assembleResult(BASE_TCP, { ...OPEN_PROBE, uptimeSeconds: null }, false);
    expect(r.inventory!.uptimeSeconds).toBe(0);
  });

  it('populates inventory after successful auth (authRequired:false + credentials)', () => {
    const authedProbe: ProbeResult = { ...OPEN_PROBE };
    const r = assembleResult(BASE_TCP, authedProbe, true);
    expect(r.inventory).not.toBeNull();
    expect(r.authenticatedStatus).toBe('authenticated');
  });
});
