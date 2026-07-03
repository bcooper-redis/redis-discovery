import type { DiscoveryResult } from '../types';

export type ScanStatus = 'idle' | 'scanning' | 'done' | 'error';

export interface ScanProgress {
  scanDone: number;
  scanTotal: number;
  probeDone: number;
  probeTotal: number;
}

export interface ScanState {
  status: ScanStatus;
  progress: ScanProgress;
  results: DiscoveryResult[];
  error: string | null;
}

function emptyState(): ScanState {
  return {
    status: 'idle',
    progress: { scanDone: 0, scanTotal: 0, probeDone: 0, probeTotal: 0 },
    results: [],
    error: null,
  };
}

/** Create an isolated, in-memory scan state manager. */
export function createState() {
  let s = emptyState();

  return {
    getState(): Readonly<ScanState> {
      return s;
    },
    resetState(): void {
      s = emptyState();
    },
    startScan(): void {
      s = { ...emptyState(), status: 'scanning' };
    },
    updateScanProgress(done: number, total: number): void {
      s.progress.scanDone = done;
      s.progress.scanTotal = total;
    },
    updateProbeProgress(done: number, total: number): void {
      s.progress.probeDone = done;
      s.progress.probeTotal = total;
    },
    finishScan(results: DiscoveryResult[]): void {
      s.status = 'done';
      s.results = results;
    },
    failScan(message: string): void {
      s.status = 'error';
      s.error = message;
    },
    /**
     * Upsert a result entry matched by host+port. Appends rather than dropping
     * the update when not found, so a result from a concurrently-completing
     * scan (which replaces `results` wholesale) is never silently lost.
     */
    updateResult(updated: DiscoveryResult): void {
      const idx = s.results.findIndex((r) => r.host === updated.host && r.port === updated.port);
      if (idx !== -1) {
        s.results = [...s.results.slice(0, idx), updated, ...s.results.slice(idx + 1)];
      } else {
        s.results = [...s.results, updated];
      }
    },
  };
}

export type AppState = ReturnType<typeof createState>;
