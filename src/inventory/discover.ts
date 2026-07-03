import { expandCidr, assertScanSize } from '../scanner/cidr';
import { buildTargets, scanTargets } from '../scanner/scan';
import { createLimiter } from '../scanner/concurrency';
import { probeHost } from '../probe/index';
import type { ProbeOptions } from '../probe/index';
import { assembleResult } from './assemble';
import type { ScanConfig, AuthCredentials, DiscoveryResult } from '../types';

export interface DiscoverOptions {
  credentials?: AuthCredentials;
  /** Fired after each TCP target is scanned. */
  onScanProgress?: (done: number, total: number) => void;
  /** Fired after each open port is probed (Redis or not). */
  onProbeProgress?: (done: number, total: number) => void;
  /** Fired each time a Redis instance is confirmed. */
  onResult?: (result: DiscoveryResult) => void;
}

/**
 * Run the full discovery pipeline: expand CIDRs → TCP scan → Redis probe →
 * assemble DiscoveryResults. Returns only hosts that responded as Redis.
 * Results are sorted by host then port for deterministic output.
 */
export async function discover(
  config: ScanConfig,
  options: DiscoverOptions = {},
): Promise<DiscoveryResult[]> {
  assertScanSize(config.cidrs);
  const hosts = config.cidrs.flatMap((cidr) => expandCidr(cidr));
  const targets = buildTargets(hosts, config.ports);

  const tcpResults = await scanTargets(targets, {
    timeoutMs: config.timeoutMs,
    concurrency: config.concurrency,
    onProgress: options.onScanProgress
      ? (_, done, total) => options.onScanProgress!(done, total)
      : undefined,
  });

  const openPorts = tcpResults.filter((r) => r.open);
  if (openPorts.length === 0) return [];

  const probeOpts: ProbeOptions = {
    tls: config.tls,
    tlsSkipVerify: config.tlsSkipVerify,
    credentials: options.credentials,
  };
  const credentialsProvided = options.credentials !== undefined;
  const limit = createLimiter(config.concurrency);

  const results: DiscoveryResult[] = [];
  let probeDone = 0;
  const probeTotal = openPorts.length;

  await Promise.all(
    openPorts.map((tcp) =>
      limit(async () => {
        // probeHost is documented to always resolve, but a single bad target
        // throwing here would otherwise collapse Promise.all and drop every
        // already-accumulated result in `results`. Contain failures per-target.
        let probe;
        try {
          probe = await probeHost(tcp.host, tcp.port, config.timeoutMs, probeOpts);
        } catch {
          options.onProbeProgress?.(++probeDone, probeTotal);
          return;
        }
        options.onProbeProgress?.(++probeDone, probeTotal);
        if (!probe.isRedis) return;
        try {
          const result = assembleResult(tcp, probe, credentialsProvided);
          results.push(result);
          options.onResult?.(result);
        } catch {
          // one bad target shouldn't drop the rest of the batch
        }
      }),
    ),
  );

  return results.sort((a, b) => a.host.localeCompare(b.host) || a.port - b.port);
}
