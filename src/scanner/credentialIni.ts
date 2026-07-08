import type { CredentialCsvRow, CredentialCsvParseResult } from './credentialCsv';

/**
 * Parses the INI format toIni() (src/export/index.ts) produces: one
 * `[host:port]` section per target, each with `host`/`port`/`username`/
 * `password` (and commented-out `ca_cert`/`client_cert`/`client_key`
 * placeholders this tool doesn't use — mTLS isn't supported) `key = value`
 * lines. The intended workflow is Export INI -> fill in username/password
 * per host in a text editor -> upload here.
 *
 * The section header itself (`[host:port]`) is never parsed for host/port —
 * only the explicit `host = `/`port = ` lines inside it are, same as the
 * fields osstats' own configparser-based reader would use. This also avoids
 * ambiguity for IPv6 addresses, whose own colons would make "split on the
 * last colon" unreliable.
 *
 * Both `;` and `#` start a comment line (configparser, which this format is
 * designed to interoperate with, accepts either by default) — trailing/
 * inline comments after a value are not stripped, since a password could
 * legitimately contain either character.
 */
export function parseCredentialIni(text: string): CredentialCsvParseResult {
  const lines = text.split(/\r\n|\r|\n/);

  const rows: CredentialCsvRow[] = [];
  const errors: string[] = [];

  let sectionNum = 0;
  let inSection = false;
  let host: string | undefined;
  let port: string | undefined;
  let username: string | undefined;
  let password: string | undefined;

  function finalizeSection(): void {
    if (!inSection) return;
    sectionNum++;
    if (!host) {
      errors.push(`section ${sectionNum}: missing host`);
    } else {
      const portNum = Number(port);
      if (!port || !Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        errors.push(`section ${sectionNum} (${host}): invalid port "${port ?? ''}"`);
      } else {
        rows.push({
          host,
          port: portNum,
          username: username || undefined,
          password: password || undefined,
        });
      }
    }
    inSection = false;
    host = undefined;
    port = undefined;
    username = undefined;
    password = undefined;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;

    if (line.startsWith('[') && line.endsWith(']')) {
      finalizeSection();
      inSection = true;
      continue;
    }

    if (!inSection) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();

    if (key === 'host') host = value;
    else if (key === 'port') port = value;
    else if (key === 'username') username = value;
    else if (key === 'password') password = value;
  }
  finalizeSection();

  return { rows, errors };
}
