import { describe, it, expect } from 'vitest';
import { toCsv } from '../../../src/export/index';
import type { DiscoveryResult } from '../../../src/types';

const OPEN: DiscoveryResult = {
  host: '10.0.0.1',
  port: 6379,
  tls: false,
  product: 'redis',
  version: '8.0.0',
  authRequired: false,
  anonymousStatus: 'open',
  authenticatedStatus: 'not_attempted',
  latency: 5,
  inventory: {
    redisVersion: '8.0.0',
    mode: 'standalone',
    os: 'Linux x86_64',
    uptimeSeconds: 3600,
    role: 'master',
  },
};

const AUTH_REQUIRED: DiscoveryResult = {
  ...OPEN,
  host: '10.0.0.2',
  authRequired: true,
  anonymousStatus: 'auth_required',
  authenticatedStatus: 'not_attempted',
  version: null,
  inventory: null,
};

describe('toCsv', () => {
  it('includes header row as first line', () => {
    const lines = toCsv([OPEN]).split('\r\n');
    expect(lines[0]).toContain('Host');
    expect(lines[0]).toContain('Port');
    expect(lines[0]).toContain('Product');
    expect(lines[0]).toContain('Version');
  });

  it('includes a data row for each result', () => {
    const lines = toCsv([OPEN, AUTH_REQUIRED]).split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(3); // header + 2 rows
  });

  it('populates host, port, product, version for open result', () => {
    const csv = toCsv([OPEN]);
    expect(csv).toContain('10.0.0.1');
    expect(csv).toContain('6379');
    expect(csv).toContain('redis');
    expect(csv).toContain('8.0.0');
    expect(csv).toContain('open');
    expect(csv).toContain('master');
    expect(csv).toContain('3600');
  });

  it('leaves inventory fields empty when inventory is null', () => {
    const csv = toCsv([AUTH_REQUIRED]);
    const dataRow = csv.split('\r\n')[1];
    // version, role, mode, os, uptime should be empty
    expect(dataRow).toContain(',,');
  });

  it('quotes values containing commas', () => {
    const tricky: DiscoveryResult = {
      ...OPEN,
      inventory: { ...OPEN.inventory!, os: 'Linux, x86_64' },
    };
    expect(toCsv([tricky])).toContain('"Linux, x86_64"');
  });

  it('escapes double quotes inside quoted values', () => {
    const tricky: DiscoveryResult = {
      ...OPEN,
      inventory: { ...OPEN.inventory!, os: 'say "hello"' },
    };
    expect(toCsv([tricky])).toContain('"say ""hello"""');
  });

  it('returns only the header row for empty results', () => {
    const lines = toCsv([]).split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Host');
  });

  it('uses CRLF line endings', () => {
    expect(toCsv([OPEN])).toContain('\r\n');
  });
});
