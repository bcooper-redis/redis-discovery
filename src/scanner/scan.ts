import { tcpProbe, TcpProbeResult } from './tcp';
import { createLimiter } from './concurrency';
import type { ScanController } from './control';
import type { ResolvedHost } from './hostname';

export { TcpProbeResult };

export interface ScanTarget {
  host: string;
  port: number;
}

export interface ScanOptions {
  timeoutMs?: number;
  concurrency?: number;
  onProgress?: (result: TcpProbeResult, done: number, total: number) => void;
  /** When provided, each not-yet-started target waits on pause and skips entirely on stop. */
  controller?: ScanController;
}

const DEFAULT_TIMEOUT_MS = 1000;
const DEFAULT_CONCURRENCY = 100;

/**
 * Build a flat list of (host, port) pairs. A resolved host that carries its
 * own explicit port (from a "host:port" target) produces a single target on
 * that port; every other resolved host is cross-joined against sharedPorts.
 */
export function buildTargets(hosts: ResolvedHost[], sharedPorts: number[]): ScanTarget[] {
  return hosts.flatMap(({ host, port }) =>
    port !== null ? [{ host, port }] : sharedPorts.map((p) => ({ host, port: p })),
  );
}

/**
 * Probe all targets for open TCP ports, respecting the concurrency limit.
 * Always resolves — individual probe failures are captured as open:false results.
 */
export async function scanTargets(
  targets: ScanTarget[],
  options: ScanOptions = {},
): Promise<TcpProbeResult[]> {
  if (targets.length === 0) return [];

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const limit = createLimiter(concurrency);

  let done = 0;
  const total = targets.length;
  const controller = options.controller;

  return Promise.all(
    targets.map((target) =>
      limit(async () => {
        await controller?.waitUntilRunnable();
        const result = controller?.isStopped()
          ? { host: target.host, port: target.port, open: false, latencyMs: 0 }
          : await tcpProbe(target.host, target.port, timeoutMs);
        options.onProgress?.(result, ++done, total);
        return result;
      }),
    ),
  );
}
