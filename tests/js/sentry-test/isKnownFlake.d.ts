declare namespace jest {
  interface It {
    /**
     * When RERUN_KNOWN_FLAKY_TESTS is "true" (set by the "Frontend: Rerun Flaky
     * Tests" PR label), the test runs several times under each stress profile.
     * Otherwise it runs once, behaving identically to a normal `it()`.
     *
     * Available globally — no import needed.
     */
    isKnownFlake(name: string, fn: jest.ProvidesCallback, timeout?: number): void;
  }
}
