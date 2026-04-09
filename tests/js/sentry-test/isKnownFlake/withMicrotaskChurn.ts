import {invokeProvidesCallback} from './flakeStressUtils';

const microtaskIntervalMs = 5;
const microtasksPerTick = 50;

/**
 * Simulates a busy machine by continuously queueing microtasks.
 */
export function withMicrotaskChurn(fn: jest.ProvidesCallback): jest.ProvidesCallback {
  return function wrapped(this: unknown) {
    const id = setInterval(() => {
      for (let i = 0; i < microtasksPerTick; i++) {
        queueMicrotask(() => {});
      }
    }, microtaskIntervalMs);

    return (async () => {
      try {
        await invokeProvidesCallback(fn, this);
      } finally {
        clearInterval(id);
      }
    })();
  };
}
