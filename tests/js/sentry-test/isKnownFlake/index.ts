/* eslint-disable jest/no-export -- setup helper: only imported by tests/js/setup.ts */
import {flakeStressProfiles} from './flakeStress';

const flakyRunsTotal = 50;

const flakyRunsPerProfile = flakyRunsTotal / flakeStressProfiles.length;

/**
 * it.isKnownFlake — wraps a known-flaky test for stress-testing in CI.
 *
 * When RERUN_KNOWN_FLAKY_TESTS is "true" (set by the "Frontend: Rerun Flaky
 * Tests" PR label), the test runs several times under each stress profile.
 * Otherwise it runs once, behaving identically to a normal `it()`.
 */
export function isKnownFlake(name: string, fn: jest.ProvidesCallback, timeout?: number) {
  /* eslint-disable jest/valid-title -- describe titles include dynamic profile labels */
  if (process.env.RERUN_KNOWN_FLAKY_TESTS !== 'true') {
    it(name, fn, timeout);
    return;
  }

  for (const [label, wrapper] of flakeStressProfiles) {
    describe(`[flaky rerun ${label} x${flakyRunsPerProfile}] ${name}`, () => {
      for (let i = 1; i <= flakyRunsPerProfile; i++) {
        it(`run ${i}/${flakyRunsPerProfile}`, wrapper(fn), timeout);
      }
    });
  }
  /* eslint-enable jest/valid-title */
}
