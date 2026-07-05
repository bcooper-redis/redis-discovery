export type ControlState = 'running' | 'paused' | 'stopped';

/**
 * A cooperative pause/stop signal shared by every in-flight scan task.
 * Nothing is forcibly interrupted — each task checks in at its own start
 * (via waitUntilRunnable + isStopped) before doing real work, so already
 * in-flight I/O always runs to its natural completion or timeout.
 */
export interface ScanController {
  getState(): ControlState;
  pause(): void;
  resume(): void;
  stop(): void;
  isStopped(): boolean;
  /** Resolves immediately unless paused, in which case it waits for resume() or stop(). */
  waitUntilRunnable(): Promise<void>;
}

export function createScanController(): ScanController {
  let state: ControlState = 'running';
  let waiters: Array<() => void> = [];

  function releaseWaiters(): void {
    const pending = waiters;
    waiters = [];
    pending.forEach((resolve) => resolve());
  }

  return {
    getState(): ControlState {
      return state;
    },
    pause(): void {
      if (state === 'running') state = 'paused';
    },
    resume(): void {
      if (state === 'paused') {
        state = 'running';
        releaseWaiters();
      }
    },
    stop(): void {
      state = 'stopped';
      releaseWaiters();
    },
    isStopped(): boolean {
      return state === 'stopped';
    },
    waitUntilRunnable(): Promise<void> {
      if (state !== 'paused') return Promise.resolve();
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}
