export type RedisProduct = 'redis' | 'valkey' | 'keydb' | 'unknown';

export type AnonymousStatus = 'open' | 'auth_required' | 'unreachable' | 'error';

export type AuthenticatedStatus = 'authenticated' | 'auth_failed' | 'not_attempted';

export type RedisMode = 'standalone' | 'cluster' | 'sentinel';

export type RedisRole = 'master' | 'replica' | 'unknown';

export interface Inventory {
  redisVersion: string;
  mode: RedisMode;
  os: string;
  uptimeSeconds: number;
  role: RedisRole;
}

export interface DiscoveryResult {
  host: string;
  port: number;
  tls: boolean;
  product: RedisProduct;
  version: string | null;
  authRequired: boolean;
  anonymousStatus: AnonymousStatus;
  authenticatedStatus: AuthenticatedStatus;
  latency: number;
  inventory: Inventory | null;
}

export interface ScanConfig {
  cidrs: string[];
  ports: number[];
  timeoutMs: number;
  tls: boolean;
  tlsSkipVerify: boolean;
  concurrency: number;
}

export interface AuthCredentials {
  username?: string;
  password: string;
}
