import { describe, it, expect } from 'vitest';
import { parseInfoServer } from '../../../src/probe/info';

// Minimal but realistic INFO server fixtures for each version range

const REDIS_6X = `
# Server
redis_version:6.2.14
redis_git_sha1:00000000
redis_git_dirty:0
redis_mode:standalone
os:Linux 5.15.0 x86_64
arch_bits:64
process_id:1
uptime_in_seconds:3600
uptime_in_days:0
hz:10
role:master
`.trim();

// Redis 7.4+ added server_name
const REDIS_7X = `
# Server
redis_version:7.4.0
server_name:redis
redis_mode:standalone
os:Linux 6.1.0 x86_64
uptime_in_seconds:86400
uptime_in_days:1
role:master
`.trim();

const REDIS_8X = `
# Server
redis_version:8.2.2
server_name:redis
redis_mode:standalone
os:Linux 6.10.14-linuxkit aarch64
uptime_in_seconds:1745
uptime_in_days:0
role:master
`.trim();

const VALKEY = `
# Server
redis_version:8.0.0
server_name:valkey
redis_mode:standalone
os:Linux 5.15.0 x86_64
uptime_in_seconds:7200
role:master
`.trim();

const CLUSTER_NODE = `
# Server
redis_version:7.2.0
server_name:redis
redis_mode:cluster
os:Linux 5.15.0 x86_64
uptime_in_seconds:43200
role:master
`.trim();

const REPLICA = `
# Server
redis_version:7.2.0
server_name:redis
redis_mode:standalone
os:Linux 5.15.0 x86_64
uptime_in_seconds:43200
role:slave
`.trim();

const EMPTY = '';

describe('parseInfoServer — product detection', () => {
  it('detects redis on 6.x (no server_name field)', () => {
    expect(parseInfoServer(REDIS_6X).product).toBe('redis');
  });

  it('detects redis on 7.4+ (server_name:redis)', () => {
    expect(parseInfoServer(REDIS_7X).product).toBe('redis');
  });

  it('detects redis on 8.x', () => {
    expect(parseInfoServer(REDIS_8X).product).toBe('redis');
  });

  it('detects valkey', () => {
    expect(parseInfoServer(VALKEY).product).toBe('valkey');
  });
});

describe('parseInfoServer — version', () => {
  it('parses 6.x version', () => {
    expect(parseInfoServer(REDIS_6X).version).toBe('6.2.14');
  });

  it('parses 7.x version', () => {
    expect(parseInfoServer(REDIS_7X).version).toBe('7.4.0');
  });

  it('parses 8.x version', () => {
    expect(parseInfoServer(REDIS_8X).version).toBe('8.2.2');
  });

  it('returns null for empty input', () => {
    expect(parseInfoServer(EMPTY).version).toBeNull();
  });
});

describe('parseInfoServer — mode', () => {
  it('parses standalone', () => {
    expect(parseInfoServer(REDIS_6X).mode).toBe('standalone');
  });

  it('parses cluster', () => {
    expect(parseInfoServer(CLUSTER_NODE).mode).toBe('cluster');
  });

  it('returns null for empty input', () => {
    expect(parseInfoServer(EMPTY).mode).toBeNull();
  });
});

describe('parseInfoServer — role', () => {
  it('parses master role', () => {
    expect(parseInfoServer(REDIS_8X).role).toBe('master');
  });

  it('normalises slave → replica', () => {
    expect(parseInfoServer(REPLICA).role).toBe('replica');
  });

  it('returns null for missing role', () => {
    expect(parseInfoServer(EMPTY).role).toBeNull();
  });
});

describe('parseInfoServer — uptime and os', () => {
  it('parses uptime as integer', () => {
    expect(parseInfoServer(REDIS_8X).uptimeSeconds).toBe(1745);
  });

  it('parses os string', () => {
    expect(parseInfoServer(REDIS_8X).os).toBe('Linux 6.10.14-linuxkit aarch64');
  });

  it('returns null for missing fields', () => {
    const result = parseInfoServer(EMPTY);
    expect(result.uptimeSeconds).toBeNull();
    expect(result.os).toBeNull();
  });
});

describe('parseInfoServer — resilience', () => {
  it('ignores comment lines', () => {
    const result = parseInfoServer('# Server\nredis_version:7.0.0\n# comment\nrole:master');
    expect(result.version).toBe('7.0.0');
    expect(result.role).toBe('master');
  });

  it('handles Windows-style CRLF line endings', () => {
    const result = parseInfoServer('redis_version:7.0.0\r\nrole:master\r\n');
    expect(result.version).toBe('7.0.0');
  });

  it('handles values that contain colons (os field)', () => {
    const result = parseInfoServer('os:Linux 5.15.0-1045-aws x86_64\nredis_version:7.0.0');
    expect(result.os).toBe('Linux 5.15.0-1045-aws x86_64');
  });
});
