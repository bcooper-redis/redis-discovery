import type { DiscoveryResult, ScanConfig } from '../types';
import type { ScanController } from '../scanner/control';

export type ScanStatus = 'idle' | 'scanning' | 'paused' | 'done' | 'error' | 'stopped';

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
  /** CIDRs, IPs, or hostnames as submitted (or auto-detected) for the current/last scan. */
  targets: string[];
  /** True when `targets` came from local subnet auto-detection rather than user input. */
  autoDetected: boolean;
  /** Milliseconds of active (non-paused) scan time so far; null before any scan has run. */
  elapsedMs: number | null;
}

function emptyState(): ScanState {
  return {
    status: 'idle',
    progress: { scanDone: 0, scanTotal: 0, probeDone: 0, probeTotal: 0 },
    results: [],
    error: null,
    targets: [],
    autoDetected: false,
    elapsedMs: null,
  };
}

/** Create an isolated, in-memory scan state manager. */
export function createState() {
  let s = emptyState();
  // Server-only — never part of ScanState, so they never round-trip to the
  // client. Kept here (not module scope) so each createState() instance
  // stays isolated, matching every other per-app piece of scan state.
  let lastConfig: ScanConfig | null = null;
  let controller: ScanController | null = null;
  // Bumped on every startScan(). A discover() run's background callbacks
  // capture the generation they were launched under and must ignore
  // themselves once it's stale — e.g. Stop returns immediately while
  // in-flight work is still draining, and a Restart can begin before that
  // drain finishes; without this a late callback from the stopped run could
  // clobber the new run's live progress.
  let generation = 0;

  // Timing — kept out of `s` itself; elapsedMs is derived fresh on every
  // getState() read rather than stored, so it's always accurate for
  // whichever instant it's actually read at (in particular while scanning,
  // where "now" keeps moving between polls).
  let startedAt: number | null = null;
  let pausedAtTs: number | null = null;
  let endedAt: number | null = null;
  let accumulatedPauseMs = 0;

  // Folds any open pause gap into accumulatedPauseMs. Called on resume and on
  // every terminal transition, so a scan stopped/finished while still paused
  // doesn't count that trailing paused stretch as elapsed active time.
  function flushPauseGap(): void {
    if (pausedAtTs !== null) {
      accumulatedPauseMs += Date.now() - pausedAtTs;
      pausedAtTs = null;
    }
  }

  function computeElapsedMs(): number | null {
    if (startedAt === null) return null;
    const endPoint = endedAt ?? pausedAtTs ?? Date.now();
    return endPoint - startedAt - accumulatedPauseMs;
  }

  return {
    getState(): Readonly<ScanState> {
      return { ...s, elapsedMs: computeElapsedMs() };
    },
    getLastConfig(): ScanConfig | null {
      return lastConfig;
    },
    getController(): ScanController | null {
      return controller;
    },
    getGeneration(): number {
      return generation;
    },
    resetState(): void {
      s = emptyState();
      lastConfig = null;
      controller = null;
      generation++;
      startedAt = null;
      pausedAtTs = null;
      endedAt = null;
      accumulatedPauseMs = 0;
    },
    startScan(
      targets: string[],
      autoDetected: boolean,
      config: ScanConfig,
      ctrl: ScanController,
    ): number {
      s = { ...emptyState(), status: 'scanning', targets, autoDetected };
      lastConfig = config;
      controller = ctrl;
      startedAt = Date.now();
      pausedAtTs = null;
      endedAt = null;
      accumulatedPauseMs = 0;
      return ++generation;
    },
    updateScanProgress(done: number, total: number): void {
      s.progress.scanDone = done;
      s.progress.scanTotal = total;
    },
    updateProbeProgress(done: number, total: number): void {
      s.progress.probeDone = done;
      s.progress.probeTotal = total;
    },
    pauseScan(): void {
      if (s.status === 'scanning') {
        s.status = 'paused';
        pausedAtTs = Date.now();
      }
    },
    resumeScan(): void {
      if (s.status === 'paused') {
        s.status = 'scanning';
        flushPauseGap();
      }
    },
    /** Marks the current run as stopped; results already streamed in via updateResult. */
    markStopped(): void {
      if (s.status === 'scanning' || s.status === 'paused') {
        flushPauseGap();
        s.status = 'stopped';
        endedAt = Date.now();
      }
    },
    finishScan(results: DiscoveryResult[]): void {
      // A stop requested just as the scan was finishing naturally shouldn't
      // flip a user-visible "stopped" back to "done" — stopped wins.
      if (s.status === 'stopped') return;
      flushPauseGap();
      s.status = 'done';
      s.results = results;
      endedAt = Date.now();
    },
    failScan(message: string): void {
      flushPauseGap();
      s.status = 'error';
      s.error = message;
      endedAt = Date.now();
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
