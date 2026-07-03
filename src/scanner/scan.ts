import { tcpProbe, TcpProbeResult } from './tcp';
import { createLimiter } from './concurrency';

export { TcpProbeResult };

export interface ScanTarget {
  host: string;
  port: number;
}

export interface ScanOptions {
  timeoutMs?: number;
  concurrency?: number;
  onProgress?: (result: TcpProbeResult, done: number, total: number) => void;
}

const DEFAULT_TIMEOUT_MS = 1000;
const DEFAULT_CONCURRENCY = 100;

/**
 * Build a flat list of (host, port) pairs from expanded host and port lists.
 */
export function buildTargets(hosts: string[], ports: number[]): ScanTarget[] {
  return hosts.flatMap((host) => ports.map((port) => ({ host, port })));
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

  return Promise.all(
    targets.map((target) =>
      limit(async () => {
        const result = await tcpProbe(target.host, target.port, timeoutMs);
        options.onProgress?.(result, ++done, total);
        return result;
      }),
    ),
  );
}
