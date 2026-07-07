import * as dns from 'dns';
import { expandCidr } from './cidr';

export interface ResolvedHost {
  host: string;
  /**
   * Explicit port parsed from a "host:port" entry. When set, this address
   * should be scanned only on this port, not cross-joined with the shared
   * ports list — otherwise a target line that pairs one specific host with
   * one specific port would silently also get scanned on every other port
   * in the same batch.
   */
  port: number | null;
}

function isBareIPv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/** Splits a trailing ":port" off an entry, e.g. "redis.example.com:6380". */
function splitPort(entry: string): { target: string; port: number | null } {
  const idx = entry.lastIndexOf(':');
  if (idx === -1) return { target: entry, port: null };
  const portStr = entry.slice(idx + 1);
  const port = Number(portStr);
  if (!/^\d+$/.test(portStr) || port < 1 || port > 65535) {
    return { target: entry, port: null };
  }
  return { target: entry.slice(0, idx), port };
}

async function resolveHostname(host: string, timeoutMs: number): Promise<string[]> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('DNS lookup timed out')), timeoutMs);
  });
  try {
    const addresses = await Promise.race([
      dns.promises.lookup(host, { all: true, family: 4 }),
      timeout,
    ]);
    return addresses.map((a) => a.address);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not resolve hostname "${host}": ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Expands a mixed list of CIDRs, bare IPv4 addresses, and hostnames into a
 * flat list of scannable IPv4 addresses. CIDRs and bare IPs expand
 * synchronously; hostnames are resolved via DNS (all A records — this tool
 * is IPv4-only throughout, so AAAA records are not requested).
 *
 * Any entry may carry an explicit ":port" suffix (e.g. "host:6380" or
 * "10.0.0.0/24:6380"); every address it resolves to is tagged with that
 * port so it can be scanned on exactly that port instead of the caller's
 * shared ports list.
 */
export async function resolveHosts(
  entries: string[],
  timeoutMs: number,
): Promise<ResolvedHost[]> {
  const results = await Promise.all(
    entries.map(async (entry) => {
      const { target, port } = splitPort(entry);
      const addresses = target.includes('/')
        ? expandCidr(target)
        : isBareIPv4(target)
          ? [target]
          : await resolveHostname(target, timeoutMs);
      return addresses.map((host) => ({ host, port }));
    }),
  );
  return results.flat();
}
