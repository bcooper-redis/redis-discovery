import { describe, it, expect } from 'vitest';
import { createLimiter } from '../../../src/scanner/concurrency';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('createLimiter', () => {
  it('throws on concurrency < 1', () => {
    expect(() => createLimiter(0)).toThrow();
    expect(() => createLimiter(-1)).toThrow();
  });

  it('throws on non-integer concurrency', () => {
    expect(() => createLimiter(1.5)).toThrow();
  });

  it('all tasks complete', async () => {
    const limit = createLimiter(3);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => limit(async () => i * 2)),
    );
    expect(results.sort((a, b) => a - b)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
  });

  it('never exceeds the concurrency limit', async () => {
    const limit = createLimiter(3);
    let active = 0;
    let maxActive = 0;

    const tasks = Array.from({ length: 10 }, () =>
      limit(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await delay(10);
        active--;
      }),
    );

    await Promise.all(tasks);
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it('concurrency=1 runs tasks serially', async () => {
    const limit = createLimiter(1);
    const order: number[] = [];

    await Promise.all(
      [1, 2, 3].map((n) =>
        limit(async () => {
          await delay(5);
          order.push(n);
        }),
      ),
    );

    expect(order).toEqual([1, 2, 3]);
  });

  it('propagates rejections without blocking the queue', async () => {
    const limit = createLimiter(2);
    const results: Array<'ok' | 'err'> = [];

    await Promise.all([
      limit(async () => {
        throw new Error('boom');
      }).catch(() => results.push('err')),
      limit(async () => results.push('ok')),
      limit(async () => results.push('ok')),
    ]);

    expect(results.filter((r) => r === 'ok')).toHaveLength(2);
    expect(results.filter((r) => r === 'err')).toHaveLength(1);
  });
});
