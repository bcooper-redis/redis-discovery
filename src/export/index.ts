import type { DiscoveryResult } from '../types';

const CSV_HEADERS = [
  'Host',
  'Port',
  'TLS',
  'Product',
  'Version',
  'Auth Status',
  'Authenticated Status',
  'Role',
  'Mode',
  'OS',
  'Uptime (s)',
  'Latency (ms)',
];

function escape(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function toRow(r: DiscoveryResult): string {
  return [
    r.host,
    String(r.port),
    String(r.tls),
    r.product,
    r.version ?? '',
    r.anonymousStatus,
    r.authenticatedStatus,
    r.inventory?.role ?? '',
    r.inventory?.mode ?? '',
    r.inventory?.os ?? '',
    r.inventory != null ? String(r.inventory.uptimeSeconds) : '',
    String(r.latency),
  ]
    .map(escape)
    .join(',');
}

export function toCsv(results: DiscoveryResult[]): string {
  const rows = [CSV_HEADERS.join(','), ...results.map(toRow)];
  return rows.join('\r\n') + '\r\n';
}
