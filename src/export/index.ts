import { productDisplay } from '../types';
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
  'Used Memory (bytes)',
  'Max Memory Policy',
  'Connected Replicas',
  'Master Host',
  'Master Port',
  'Master Link Status',
  'Total Keys',
  'Modules',
  'Cluster State',
  'Run ID',
  'Cert Subject',
  'Cert Issuer',
  'Cert Valid To',
  'Cert Self-Signed',
  'Cert Trusted',
];

function escape(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function totalKeys(r: DiscoveryResult): string {
  if (!r.inventory) return '';
  return String(r.inventory.keyspace.reduce((sum, db) => sum + db.keys, 0));
}

function toRow(r: DiscoveryResult): string {
  return [
    r.host,
    String(r.port),
    String(r.tls),
    productDisplay(r.product),
    r.version ?? '',
    r.anonymousStatus,
    r.authenticatedStatus,
    r.inventory?.role ?? '',
    r.inventory?.mode ?? '',
    r.inventory?.os ?? '',
    r.inventory != null ? String(r.inventory.uptimeSeconds) : '',
    String(r.latency),
    r.inventory?.memory.usedMemoryBytes != null ? String(r.inventory.memory.usedMemoryBytes) : '',
    r.inventory?.memory.maxMemoryPolicy ?? '',
    r.inventory ? String(r.inventory.replication.connectedReplicas.length) : '',
    r.inventory?.replication.masterHost ?? '',
    r.inventory?.replication.masterPort != null ? String(r.inventory.replication.masterPort) : '',
    r.inventory?.replication.masterLinkStatus ?? '',
    totalKeys(r),
    r.inventory?.modules.map((m) => m.name).join(', ') ?? '',
    r.inventory?.clusterInfo?.state ?? '',
    r.inventory?.runId ?? '',
    r.tlsCertificate?.subject ?? '',
    r.tlsCertificate?.issuer ?? '',
    r.tlsCertificate?.validTo ?? '',
    r.tlsCertificate ? String(r.tlsCertificate.selfSigned) : '',
    r.tlsCertificate ? String(r.tlsCertificate.trusted) : '',
  ]
    .map(escape)
    .join(',');
}

export function toCsv(results: DiscoveryResult[]): string {
  const rows = [CSV_HEADERS.join(','), ...results.map(toRow)];
  return rows.join('\r\n') + '\r\n';
}
