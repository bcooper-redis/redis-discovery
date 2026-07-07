import { describe, it, expect } from 'vitest';
import { resolveHosts } from '../../../src/scanner/hostname';

describe('resolveHosts — CIDRs and bare IPs', () => {
  it('expands a CIDR entry', async () => {
    expect(await resolveHosts(['10.0.0.0/31'], 2000)).toEqual([
      { host: '10.0.0.0', port: null },
      { host: '10.0.0.1', port: null },
    ]);
  });

  it('passes through a bare IPv4 address unchanged, without a DNS lookup', async () => {
    expect(await resolveHosts(['192.168.1.50'], 2000)).toEqual([
      { host: '192.168.1.50', port: null },
    ]);
  });

  it('rejects an invalid CIDR the same way expandCidr does', async () => {
    await expect(resolveHosts(['999.0.0.0/24'], 2000)).rejects.toThrow(/invalid ip/i);
  });
});

describe('resolveHosts — hostnames', () => {
  it('resolves a real hostname (localhost) to an IPv4 address', async () => {
    const result = await resolveHosts(['localhost'], 2000);
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContainEqual({ host: '127.0.0.1', port: null });
  });

  it('rejects a hostname that cannot be resolved, with a clear error', async () => {
    // .invalid is reserved by RFC 2606 and guaranteed to never resolve.
    await expect(resolveHosts(['this-does-not-exist.invalid'], 2000)).rejects.toThrow(
      /could not resolve hostname "this-does-not-exist\.invalid"/i,
    );
  });

  it('resolves a mix of CIDRs, bare IPs, and hostnames in one call', async () => {
    const result = await resolveHosts(['10.0.0.5', 'localhost', '10.0.0.0/31'], 2000);
    expect(result).toContainEqual({ host: '10.0.0.5', port: null });
    expect(result).toContainEqual({ host: '127.0.0.1', port: null });
    expect(result).toContainEqual({ host: '10.0.0.0', port: null });
    expect(result).toContainEqual({ host: '10.0.0.1', port: null });
    expect(result).toHaveLength(4);
  });

  it('rejects the whole batch if any one hostname fails to resolve', async () => {
    await expect(resolveHosts(['localhost', 'this-does-not-exist.invalid'], 2000)).rejects.toThrow(
      /could not resolve hostname/i,
    );
  });
});

describe('resolveHosts — explicit ":port" suffix', () => {
  it('pairs a bare IP with its explicit port', async () => {
    expect(await resolveHosts(['192.168.1.50:6380'], 2000)).toEqual([
      { host: '192.168.1.50', port: 6380 },
    ]);
  });

  it('pairs a hostname with its explicit port', async () => {
    const result = await resolveHosts(['localhost:6380'], 2000);
    expect(result).toContainEqual({ host: '127.0.0.1', port: 6380 });
  });

  it('tags every address a CIDR expands to with the same explicit port', async () => {
    expect(await resolveHosts(['10.0.0.0/31:6380'], 2000)).toEqual([
      { host: '10.0.0.0', port: 6380 },
      { host: '10.0.0.1', port: 6380 },
    ]);
  });

  it('leaves entries without a suffix as port:null, even alongside paired entries', async () => {
    const result = await resolveHosts(['10.0.0.5:6380', '10.0.0.6'], 2000);
    expect(result).toEqual([
      { host: '10.0.0.5', port: 6380 },
      { host: '10.0.0.6', port: null },
    ]);
  });

  it('rejects a port outside 1-65535 and falls back to treating the whole entry as the host', async () => {
    // 99999 makes the string an invalid hostname, so this surfaces as a DNS failure —
    // an honest failure mode, since a real hostname can't contain a colon anyway.
    await expect(resolveHosts(['192.168.1.50:99999'], 2000)).rejects.toThrow(
      /could not resolve hostname "192\.168\.1\.50:99999"/i,
    );
  });
});
