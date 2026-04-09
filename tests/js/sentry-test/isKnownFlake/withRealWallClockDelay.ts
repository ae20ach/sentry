import {delay, invokeProvidesCallback} from './flakeStressUtils';

const wallClockTickDelayMs = 3;
const wallClockPaddingMs = 5;

/**
 * Simulates a slow machine with many timers by continuously running no-op async delays.
 */
export function withRealWallClockDelay(fn: jest.ProvidesCallback): jest.ProvidesCallback {
  return function wrapped(this: unknown) {
    return (async () => {
      const abortController = new AbortController();

      const background = (async () => {
        while (!abortController.signal.aborted) {
          await delay(wallClockTickDelayMs);
        }
      })();

      try {
        await delay(wallClockPaddingMs);
        await invokeProvidesCallback(fn, this);
        await delay(wallClockPaddingMs);
      } finally {
        abortController.abort();
        await background.catch(() => {});
      }
    })();
  };
}
