import { describe, it, expect } from 'vitest';
import { parseCsvLine, parseCredentialCsv } from '../../../src/scanner/credentialCsv';

describe('parseCsvLine', () => {
  it('splits a plain comma-separated line', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('keeps a comma inside a quoted field intact', () => {
    expect(parseCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd']);
  });

  it('unescapes a doubled quote inside a quoted field', () => {
    expect(parseCsvLine('a,"b""c",d')).toEqual(['a', 'b"c', 'd']);
  });

  it('handles an entirely empty field', () => {
    expect(parseCsvLine('a,,c')).toEqual(['a', '', 'c']);
  });

  it('handles a quoted field with no special characters the same as unquoted', () => {
    expect(parseCsvLine('a,"b",c')).toEqual(['a', 'b', 'c']);
  });
});

describe('parseCredentialCsv', () => {
  it('parses host, port, username, password', () => {
    const { rows, errors } = parseCredentialCsv('10.0.0.1,6379,alice,secret');
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ host: '10.0.0.1', port: 6379, username: 'alice', password: 'secret' }]);
  });

  it('treats a blank username and password as undefined, not empty strings', () => {
    const { rows } = parseCredentialCsv('10.0.0.1,6379,,');
    expect(rows).toEqual([{ host: '10.0.0.1', port: 6379, username: undefined, password: undefined }]);
  });

  it('supports a password containing a comma when quoted', () => {
    const { rows } = parseCredentialCsv('10.0.0.1,6379,alice,"p@ss,word!"');
    expect(rows[0].password).toBe('p@ss,word!');
  });

  it('supports a password containing a literal double quote', () => {
    const { rows } = parseCredentialCsv('10.0.0.1,6379,,"has""quote"');
    expect(rows[0].password).toBe('has"quote');
  });

  it('skips a header row', () => {
    const { rows } = parseCredentialCsv('host,port,username,password\n10.0.0.1,6379,,secret');
    expect(rows).toHaveLength(1);
    expect(rows[0].host).toBe('10.0.0.1');
  });

  it('works without a header row', () => {
    const { rows } = parseCredentialCsv('10.0.0.1,6379,,secret\n10.0.0.2,6380,,secret2');
    expect(rows).toHaveLength(2);
  });

  it('skips blank lines', () => {
    const { rows } = parseCredentialCsv('10.0.0.1,6379,,secret\n\n\n10.0.0.2,6380,,secret2');
    expect(rows).toHaveLength(2);
  });

  it('flags a missing host as an error and skips that row, without dropping the rest of the batch', () => {
    const { rows, errors } = parseCredentialCsv(',6379,,secret\n10.0.0.2,6380,,secret2');
    expect(rows).toHaveLength(1);
    expect(rows[0].host).toBe('10.0.0.2');
    expect(errors).toEqual(['line 1: missing host']);
  });

  it('flags a non-numeric port as an error', () => {
    const { rows, errors } = parseCredentialCsv('10.0.0.1,notaport,,secret');
    expect(rows).toEqual([]);
    expect(errors).toEqual(['line 1 (10.0.0.1): invalid port "notaport"']);
  });

  it('flags a port outside 1-65535 as an error', () => {
    const { errors } = parseCredentialCsv('10.0.0.1,0,,secret\n10.0.0.2,65536,,secret');
    expect(errors).toHaveLength(2);
  });

  it('never includes username or password in an error message', () => {
    const { errors } = parseCredentialCsv('10.0.0.1,bad,verysecretuser,verysecretpassword');
    expect(errors[0]).not.toContain('verysecretuser');
    expect(errors[0]).not.toContain('verysecretpassword');
  });

  it('trims whitespace around fields', () => {
    const { rows } = parseCredentialCsv(' 10.0.0.1 , 6379 , alice , secret ');
    expect(rows).toEqual([{ host: '10.0.0.1', port: 6379, username: 'alice', password: 'secret' }]);
  });

  it('returns no rows and no errors for empty input', () => {
    expect(parseCredentialCsv('')).toEqual({ rows: [], errors: [] });
  });
});
