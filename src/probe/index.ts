import Redis from 'ioredis';
import { parseInfo, parseModuleList, parseClusterInfo, refineProductWithModules } from './info';
import type { ParsedInfo } from './info';
import type { AuthCredentials, ModuleInfo, ClusterInfo } from '../types';

export { parseInfo };
export type { ParsedInfo };

export interface ProbeOptions {
  /** Attempt TLS first; fall back to plain if TLS handshake fails. */
  tls?: boolean;
  /** Skip TLS certificate verification (for self-signed certs). */
  tlsSkipVerify?: boolean;
  /** If provided, authenticate after connecting. */
  credentials?: AuthCredentials;
}

export interface ProbeResult {
  isRedis: boolean;
  authRequired: boolean;
  /** True when credentials were provided but rejected by the server. */
  wrongPassword: boolean;
  tls: boolean;
  product: ParsedInfo['product'];
  version: string | null;
  mode: ParsedInfo['mode'];
  os: string | null;
  uptimeSeconds: number | null;
  role: ParsedInfo['role'];
  replication: ParsedInfo['replication'];
  memory: ParsedInfo['memory'];
  keyspace: ParsedInfo['keyspace'];
  modules: ModuleInfo[];
  clusterInfo: ClusterInfo | null;
  rawInfo: string | null;
}

const UNKNOWN_INFO: Omit<ProbeResult, 'isRedis' | 'authRequired' | 'wrongPassword' | 'tls'> = {
  product: 'unknown',
  version: null,
  mode: null,
  os: null,
  uptimeSeconds: null,
  role: null,
  replication: {
    connectedReplicas: [],
    masterHost: null,
    masterPort: null,
    masterLinkStatus: null,
  },
  memory: { usedMemoryBytes: null, maxMemoryBytes: null, maxMemoryPolicy: null },
  keyspace: [],
  modules: [],
  clusterInfo: null,
  rawInfo: null,
};

/**
 * Single connection attempt — plain or TLS as specified.
 * Always resolves. Returns null if the connection itself failed (not Redis or unreachable).
 */
async function attemptProbe(
  host: string,
  port: number,
  timeoutMs: number,
  useTls: boolean,
  skipVerify: boolean,
  credentials?: AuthCredentials,
): Promise<ProbeResult | null> {
  const redis = new Redis({
    host,
    port,
    connectTimeout: timeoutMs,
    commandTimeout: timeoutMs,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    enableReadyCheck: false,
    retryStrategy: () => null,
    ...(useTls ? { tls: { rejectUnauthorized: !skipVerify } } : {}),
  });

  redis.on('error', () => {});

  try {
    try {
      await redis.connect();
    } catch {
      return null;
    }

    if (credentials) {
      try {
        if (credentials.username) {
          // Redis 6+ ACL: AUTH username password
          await redis.call('AUTH', credentials.username, credentials.password);
        } else {
          await redis.auth(credentials.password);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('WRONGPASS')) {
          return {
            isRedis: true,
            authRequired: true,
            wrongPassword: true,
            tls: useTls,
            ...UNKNOWN_INFO,
          };
        }
        // Non-WRONGPASS: server has no auth configured — connection still valid,
        // fall through so we can still fetch INFO.
      }
    }

    try {
      await redis.ping();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('NOAUTH')) {
        return {
          isRedis: true,
          authRequired: true,
          wrongPassword: false,
          tls: useTls,
          ...UNKNOWN_INFO,
        };
      }
      if (!message.includes('NOPERM')) {
        return null;
      }
      // NOPERM: authenticated but this user's ACL denies PING — still a live
      // Redis instance, not "not Redis". Fall through and try INFO, which may
      // be permitted separately (the INFO catch below already handles denial).
    }

    try {
      const rawInfo = await redis.info();
      const parsed = parseInfo(rawInfo);

      // MODULE LIST and CLUSTER INFO are separate round-trips beyond the base
      // INFO call. Neither failing should sink the whole probe — a restricted
      // ACL or an older Redis build may not support one or the other.
      let modules: ModuleInfo[] = [];
      try {
        modules = parseModuleList(await redis.call('MODULE', 'LIST'));
      } catch {
        // leave empty
      }

      let clusterInfo: ClusterInfo | null = null;
      if (parsed.mode === 'cluster') {
        try {
          clusterInfo = parseClusterInfo((await redis.call('CLUSTER', 'INFO')) as string);
        } catch {
          // leave null — some deployments (e.g. Redis Enterprise) reject
          // CLUSTER INFO outright even in cluster mode; the rest of the
          // probe result is still valid.
        }
      }

      const product = refineProductWithModules(parsed.product, modules);

      return {
        isRedis: true,
        authRequired: false,
        wrongPassword: false,
        tls: useTls,
        rawInfo,
        ...parsed,
        product,
        modules,
        clusterInfo,
      };
    } catch {
      return {
        isRedis: true,
        authRequired: false,
        wrongPassword: false,
        tls: useTls,
        ...UNKNOWN_INFO,
      };
    }
  } finally {
    try {
      redis.disconnect();
    } catch {
      // ignore
    }
  }
}

/**
 * Probe a host:port to determine whether it is Redis, whether authentication
 * is required, and (if accessible) its basic server info.
 *
 * When options.tls is true, TLS is attempted first. If the TLS handshake
 * fails the probe falls back to a plain connection automatically.
 *
 * When options.credentials are provided, AUTH is sent after connecting so
 * inventory can be retrieved from auth-required servers.
 *
 * Always resolves — never rejects. Unreachable or non-Redis targets return
 * isRedis:false so callers can continue past failures.
 */
export async function probeHost(
  host: string,
  port: number,
  timeoutMs: number,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const skipVerify = options.tlsSkipVerify ?? false;
  const { credentials } = options;

  if (options.tls) {
    const tlsResult = await attemptProbe(host, port, timeoutMs, true, skipVerify, credentials);
    if (tlsResult !== null) return tlsResult;
    // TLS failed — fall through to plain attempt
  }

  const plainResult = await attemptProbe(host, port, timeoutMs, false, false, credentials);
  return (
    plainResult ?? {
      isRedis: false,
      authRequired: false,
      wrongPassword: false,
      tls: false,
      ...UNKNOWN_INFO,
    }
  );
}
