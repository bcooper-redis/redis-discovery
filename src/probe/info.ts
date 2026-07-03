import type { RedisProduct, RedisMode, RedisRole } from '../types';

export interface ParsedInfo {
  product: RedisProduct;
  version: string | null;
  mode: RedisMode | null;
  os: string | null;
  uptimeSeconds: number | null;
  role: RedisRole | null;
}

/**
 * Parse the raw string returned by `INFO server` into typed fields.
 * All fields are optional — absent or unrecognised values become null.
 */
export function parseInfoServer(raw: string): ParsedInfo {
  const fields = parseFields(raw);
  return {
    product: detectProduct(fields),
    version: fields.get('redis_version') ?? null,
    mode: normaliseMode(fields.get('redis_mode')),
    os: fields.get('os') ?? null,
    uptimeSeconds: parseOptionalInt(fields.get('uptime_in_seconds')),
    role: normaliseRole(fields.get('role')),
  };
}

function parseFields(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    map.set(trimmed.slice(0, colon).trim(), trimmed.slice(colon + 1).trim());
  }
  return map;
}

function detectProduct(fields: Map<string, string>): RedisProduct {
  const name = fields.get('server_name')?.toLowerCase();
  // server_name was added in Redis 7.4+ and Valkey forks.
  // Absent on Redis 6.x and early 7.x — default to 'redis'.
  // KeyDB detection via server_name:'keydb' is unverified against a live
  // KeyDB instance — may need a different signal if it doesn't hold up.
  if (name === 'valkey') return 'valkey';
  if (name === 'keydb') return 'keydb';
  if (!name || name === 'redis') return 'redis';
  return 'unknown';
}

function normaliseMode(raw: string | undefined): RedisMode | null {
  if (raw === 'standalone') return 'standalone';
  if (raw === 'cluster') return 'cluster';
  if (raw === 'sentinel') return 'sentinel';
  return null;
}

function normaliseRole(raw: string | undefined): RedisRole | null {
  if (raw === 'master') return 'master';
  // Redis INFO uses 'slave'; Valkey may use 'replica'
  if (raw === 'slave' || raw === 'replica') return 'replica';
  return null;
}

function parseOptionalInt(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}
