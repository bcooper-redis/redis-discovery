import { describe, it, expect } from 'vitest';
import { createScanController } from '../../../src/scanner/control';

describe('createScanController', () => {
  it('starts running and lets waitUntilRunnable resolve immediately', async () => {
    const controller = createScanController();
    expect(controller.getState()).toBe('running');
    await expect(controller.waitUntilRunnable()).resolves.toBeUndefined();
    expect(controller.isStopped()).toBe(false);
  });

  it('pause blocks waitUntilRunnable until resume', async () => {
    const controller = createScanController();
    controller.pause();
    expect(controller.getState()).toBe('paused');

    let resolved = false;
    const waiting = controller.waitUntilRunnable().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);

    controller.resume();
    await waiting;
    expect(resolved).toBe(true);
    expect(controller.getState()).toBe('running');
  });

  it('resume without a prior pause is a no-op', () => {
    const controller = createScanController();
    controller.resume();
    expect(controller.getState()).toBe('running');
  });

  it('stop releases any waiters and marks isStopped', async () => {
    const controller = createScanController();
    controller.pause();

    const waiting = controller.waitUntilRunnable();
    controller.stop();

    await expect(waiting).resolves.toBeUndefined();
    expect(controller.getState()).toBe('stopped');
    expect(controller.isStopped()).toBe(true);
  });

  it('stop from running (no pause) still marks isStopped', () => {
    const controller = createScanController();
    controller.stop();
    expect(controller.isStopped()).toBe(true);
  });

  it('pause after stop is a no-op — stopped is terminal', () => {
    const controller = createScanController();
    controller.stop();
    controller.pause();
    expect(controller.getState()).toBe('stopped');
  });

  it('resume after stop is a no-op — stopped is terminal', () => {
    const controller = createScanController();
    controller.stop();
    controller.resume();
    expect(controller.getState()).toBe('stopped');
  });

  it('releases multiple concurrent waiters on resume', async () => {
    const controller = createScanController();
    controller.pause();

    const waiters = [
      controller.waitUntilRunnable(),
      controller.waitUntilRunnable(),
      controller.waitUntilRunnable(),
    ];

    controller.resume();
    await expect(Promise.all(waiters)).resolves.toEqual([undefined, undefined, undefined]);
  });
});
