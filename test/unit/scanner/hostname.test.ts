import { describe, it, expect } from 'vitest';
import { resolveHosts } from '../../../src/scanner/hostname';

describe('resolveHosts — CIDRs and bare IPs', () => {
  it('expands a CIDR entry', async () => {
    expect(await resolveHosts(['10.0.0.0/31'], 2000)).toEqual(['10.0.0.0', '10.0.0.1']);
  });

  it('passes through a bare IPv4 address unchanged, without a DNS lookup', async () => {
    expect(await resolveHosts(['192.168.1.50'], 2000)).toEqual(['192.168.1.50']);
  });

  it('rejects an invalid CIDR the same way expandCidr does', async () => {
    await expect(resolveHosts(['999.0.0.0/24'], 2000)).rejects.toThrow(/invalid ip/i);
  });
});

describe('resolveHosts — hostnames', () => {
  it('resolves a real hostname (localhost) to an IPv4 address', async () => {
    const result = await resolveHosts(['localhost'], 2000);
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('127.0.0.1');
  });

  it('rejects a hostname that cannot be resolved, with a clear error', async () => {
    // .invalid is reserved by RFC 2606 and guaranteed to never resolve.
    await expect(resolveHosts(['this-does-not-exist.invalid'], 2000)).rejects.toThrow(
      /could not resolve hostname "this-does-not-exist\.invalid"/i,
    );
  });

  it('resolves a mix of CIDRs, bare IPs, and hostnames in one call', async () => {
    const result = await resolveHosts(['10.0.0.5', 'localhost', '10.0.0.0/31'], 2000);
    expect(result).toContain('10.0.0.5');
    expect(result).toContain('127.0.0.1');
    expect(result).toContain('10.0.0.0');
    expect(result).toContain('10.0.0.1');
    expect(result).toHaveLength(4);
  });

  it('rejects the whole batch if any one hostname fails to resolve', async () => {
    await expect(resolveHosts(['localhost', 'this-does-not-exist.invalid'], 2000)).rejects.toThrow(
      /could not resolve hostname/i,
    );
  });
});
