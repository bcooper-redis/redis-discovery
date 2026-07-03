import { describe, it, expect } from 'vitest';
import { expandPorts } from '../../../src/scanner/ports';

describe('expandPorts — string input', () => {
  it('parses a single port', () => {
    expect(expandPorts('6379')).toEqual([6379]);
  });

  it('parses comma-separated ports', () => {
    expect(expandPorts('6379,6380')).toEqual([6379, 6380]);
  });

  it('parses a range', () => {
    expect(expandPorts('6379-6382')).toEqual([6379, 6380, 6381, 6382]);
  });

  it('parses a mixed expression', () => {
    expect(expandPorts('6379,6380-6382,6390')).toEqual([6379, 6380, 6381, 6382, 6390]);
  });

  it('deduplicates overlapping values', () => {
    expect(expandPorts('6379,6379-6380')).toEqual([6379, 6380]);
  });

  it('returns ports in sorted order', () => {
    const result = expandPorts('6382,6379');
    expect(result).toEqual([6379, 6382]);
  });

  it('trims whitespace around segments', () => {
    expect(expandPorts(' 6379 , 6380 ')).toEqual([6379, 6380]);
  });

  it('throws on empty string', () => {
    expect(() => expandPorts('')).toThrow(/no valid ports/i);
  });

  it('throws on port 0', () => {
    expect(() => expandPorts('0')).toThrow(/invalid port/i);
  });

  it('throws on port > 65535', () => {
    expect(() => expandPorts('65536')).toThrow(/invalid port/i);
  });

  it('throws on range start > end', () => {
    expect(() => expandPorts('6380-6379')).toThrow(/start > end/i);
  });

  it('throws on non-numeric segment', () => {
    expect(() => expandPorts('abc')).toThrow();
  });

  it('throws on trailing garbage after a valid port number, rather than truncating', () => {
    expect(() => expandPorts('6379abc')).toThrow(/invalid port segment/i);
  });

  it('throws on trailing garbage in a range boundary, rather than truncating', () => {
    expect(() => expandPorts('6379x-6385')).toThrow(/invalid port range/i);
  });

  it('throws on a decimal port number', () => {
    expect(() => expandPorts('1.5')).toThrow();
  });
});

describe('expandPorts — array input', () => {
  it('passes through a valid array', () => {
    expect(expandPorts([6379, 6380])).toEqual([6379, 6380]);
  });

  it('deduplicates array values', () => {
    expect(expandPorts([6379, 6379, 6380])).toEqual([6379, 6380]);
  });

  it('sorts array values', () => {
    expect(expandPorts([6380, 6379])).toEqual([6379, 6380]);
  });

  it('throws on invalid port in array', () => {
    expect(() => expandPorts([0])).toThrow(/invalid port/i);
  });
});
