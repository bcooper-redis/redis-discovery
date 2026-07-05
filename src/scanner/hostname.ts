import * as dns from 'dns';
import { expandCidr } from './cidr';

function isBareIPv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
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
 */
export async function resolveHosts(entries: string[], timeoutMs: number): Promise<string[]> {
  const results = await Promise.all(
    entries.map((entry) => {
      if (entry.includes('/')) return expandCidr(entry);
      if (isBareIPv4(entry)) return [entry];
      return resolveHostname(entry, timeoutMs);
    }),
  );
  return results.flat();
}
