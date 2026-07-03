type AsyncFn<T> = () => Promise<T>;

/**
 * Returns a wrapper that limits how many async operations run simultaneously.
 * All queued work still completes — the limit controls concurrency, not capacity.
 */
export function createLimiter(concurrency: number) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`Concurrency must be a positive integer, got ${concurrency}`);
  }

  let active = 0;
  const queue: Array<() => void> = [];

  function next(): void {
    if (active < concurrency && queue.length > 0) {
      active++;
      queue.shift()!();
    }
  }

  return function limit<T>(fn: AsyncFn<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}
