import { describe, it, expect, beforeEach } from 'vitest';
import { createState } from '../../../src/web/state';
import type { AppState } from '../../../src/web/state';
import type { DiscoveryResult } from '../../../src/types';

const RESULT: DiscoveryResult = {
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
    os: 'Linux',
    uptimeSeconds: 3600,
    role: 'master',
  },
};

let state: AppState;
beforeEach(() => {
  state = createState();
});

describe('initial state', () => {
  it('starts idle with empty results', () => {
    const s = state.getState();
    expect(s.status).toBe('idle');
    expect(s.results).toEqual([]);
    expect(s.error).toBeNull();
    expect(s.progress.scanTotal).toBe(0);
  });
});

describe('startScan', () => {
  it('transitions to scanning and clears previous results', () => {
    state.finishScan([RESULT]);
    state.startScan();
    const s = state.getState();
    expect(s.status).toBe('scanning');
    expect(s.results).toEqual([]);
    expect(s.progress.scanDone).toBe(0);
  });
});

describe('updateScanProgress', () => {
  it('updates scanDone and scanTotal', () => {
    state.startScan();
    state.updateScanProgress(42, 254);
    expect(state.getState().progress.scanDone).toBe(42);
    expect(state.getState().progress.scanTotal).toBe(254);
  });
});

describe('updateProbeProgress', () => {
  it('updates probeDone and probeTotal', () => {
    state.startScan();
    state.updateProbeProgress(2, 5);
    expect(state.getState().progress.probeDone).toBe(2);
    expect(state.getState().progress.probeTotal).toBe(5);
  });
});

describe('finishScan', () => {
  it('transitions to done and stores results', () => {
    state.startScan();
    state.finishScan([RESULT]);
    const s = state.getState();
    expect(s.status).toBe('done');
    expect(s.results).toHaveLength(1);
    expect(s.results[0].host).toBe('10.0.0.1');
  });
});

describe('failScan', () => {
  it('transitions to error with message', () => {
    state.startScan();
    state.failScan('connection refused');
    const s = state.getState();
    expect(s.status).toBe('error');
    expect(s.error).toBe('connection refused');
  });
});

describe('updateResult', () => {
  it('replaces a result by host+port', () => {
    state.finishScan([RESULT]);
    const updated: DiscoveryResult = {
      ...RESULT,
      authenticatedStatus: 'authenticated',
    };
    state.updateResult(updated);
    expect(state.getState().results[0].authenticatedStatus).toBe('authenticated');
  });

  it('appends when host+port not found, instead of dropping the update', () => {
    state.finishScan([RESULT]);
    state.updateResult({ ...RESULT, host: '99.99.99.99' });
    expect(state.getState().results).toHaveLength(2);
    expect(state.getState().results[0].host).toBe('10.0.0.1');
    expect(state.getState().results[1].host).toBe('99.99.99.99');
  });

  it('preserves order of other results', () => {
    const r2: DiscoveryResult = { ...RESULT, host: '10.0.0.2', port: 6380 };
    state.finishScan([RESULT, r2]);
    state.updateResult({ ...RESULT, version: '8.0.1' });
    expect(state.getState().results[0].version).toBe('8.0.1');
    expect(state.getState().results[1].host).toBe('10.0.0.2');
  });
});

describe('resetState', () => {
  it('returns to idle', () => {
    state.finishScan([RESULT]);
    state.resetState();
    expect(state.getState().status).toBe('idle');
    expect(state.getState().results).toEqual([]);
  });
});
