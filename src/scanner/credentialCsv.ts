export interface CredentialCsvRow {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface CredentialCsvParseResult {
  rows: CredentialCsvRow[];
  /** Human-readable, host/port-only — never includes a username or password value. */
  errors: string[];
}

/**
 * Splits one CSV line into fields, honoring double-quoted fields (which may
 * contain commas, and "" as an escaped quote). The other CSV parser in this
 * app (Dashboard's host/port upload) gets away with a naive split(',') since
 * hostnames don't contain commas — a password can be literally anything, so
 * this one needs to actually respect quoting.
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields;
}

/**
 * Parses a "host,port,username,password" CSV for Credential Scan. username
 * and password may be blank — a row with a blank password is scanned
 * anonymously (no AUTH attempted for that target). A header row is skipped
 * automatically. Malformed rows (missing host, invalid port) are collected
 * as errors rather than failing the whole file — one bad line shouldn't cost
 * every other target in the batch. Error messages never include the
 * username/password columns.
 */
export function parseCredentialCsv(text: string): CredentialCsvParseResult {
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const rows: CredentialCsvRow[] = [];
  const errors: string[] = [];

  let startIdx = 0;
  if (lines.length > 0) {
    const firstCell = parseCsvLine(lines[0])[0]?.trim() ?? '';
    if (/^(host|hostname|ip|ip ?address|target)s?$/i.test(firstCell)) {
      startIdx = 1;
    }
  }

  for (let i = startIdx; i < lines.length; i++) {
    const lineNum = i + 1;
    const [hostRaw, portRaw, usernameRaw, passwordRaw] = parseCsvLine(lines[i]).map((f) =>
      f.trim(),
    );

    if (!hostRaw) {
      errors.push(`line ${lineNum}: missing host`);
      continue;
    }

    const port = Number(portRaw);
    if (!portRaw || !Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push(`line ${lineNum} (${hostRaw}): invalid port "${portRaw ?? ''}"`);
      continue;
    }

    rows.push({
      host: hostRaw,
      port,
      username: usernameRaw || undefined,
      password: passwordRaw || undefined,
    });
  }

  return { rows, errors };
}
