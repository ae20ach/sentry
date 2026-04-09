import {invokeProvidesCallback} from './flakeStressUtils';

const memoryPressureBytes = 8 * 1024 * 1024;

/**
 * Simulates low available memory by retaining a large buffer of bytes data.
 */
export function withMemoryPressure(fn: jest.ProvidesCallback): jest.ProvidesCallback {
  return function wrapped(this: unknown) {
    return (async () => {
      const hog = new Uint8Array(memoryPressureBytes);
      hog[0] = 1;

      try {
        await invokeProvidesCallback(fn, this);
      } finally {
        hog.fill(0);
      }
    })();
  };
}
