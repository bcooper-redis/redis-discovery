const PORT_MIN = 1;
const PORT_MAX = 65535;

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
    throw new Error(`Invalid port number: ${port} (must be ${PORT_MIN}–${PORT_MAX})`);
  }
}

/** Parses a string as an integer only if every character is a digit — rejects trailing garbage that parseInt would silently ignore (e.g. "6379abc"). */
function parseStrictInt(s: string): number {
  return /^\d+$/.test(s) ? parseInt(s, 10) : NaN;
}

/**
 * Parse a port specification string into a sorted, deduplicated array of port numbers.
 *
 * Accepts comma-separated values and inclusive ranges: "6379,6380-6382,6390"
 */
export function expandPorts(input: string | number[]): number[] {
  if (Array.isArray(input)) {
    input.forEach(validatePort);
    return [...new Set(input)].sort((a, b) => a - b);
  }

  const ports = new Set<number>();

  for (const segment of input.split(',')) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    const dashIdx = trimmed.indexOf('-');

    if (dashIdx === -1) {
      const port = parseStrictInt(trimmed);
      if (isNaN(port)) throw new Error(`Invalid port segment: "${trimmed}"`);
      validatePort(port);
      ports.add(port);
    } else {
      const start = parseStrictInt(trimmed.slice(0, dashIdx));
      const end = parseStrictInt(trimmed.slice(dashIdx + 1));
      if (isNaN(start) || isNaN(end)) throw new Error(`Invalid port range: "${trimmed}"`);
      if (start > end) throw new Error(`Port range start > end: "${trimmed}"`);
      validatePort(start);
      validatePort(end);
      for (let p = start; p <= end; p++) ports.add(p);
    }
  }

  if (ports.size === 0) throw new Error('No valid ports found in input');

  return [...ports].sort((a, b) => a - b);
}
