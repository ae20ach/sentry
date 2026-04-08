import {resetMockDate, setMockDate} from 'sentry-test/utils';

import {isPartialSpanOrTraceData} from 'sentry/utils/trace/isOlderThan30Days';

describe('isPartialSpanOrTraceData', () => {
  // 2025-10-06T00:00:00Z
  beforeEach(() => {
    setMockDate(new Date('2025-10-06T00:00:00Z').getTime());
  });

  afterEach(() => {
    resetMockDate();
  });

  it('returns false for undefined', () => {
    expect(isPartialSpanOrTraceData(undefined)).toBe(false);
  });

  it('returns false for invalid timestamps', () => {
    expect(isPartialSpanOrTraceData('not-a-timestamp')).toBe(false);
  });

  it('handles ISO date strings', () => {
    expect(isPartialSpanOrTraceData('2025-08-01T00:00:00Z')).toBe(true);
    expect(isPartialSpanOrTraceData('2025-10-05T00:00:00Z')).toBe(false);
  });

  it('handles unix timestamps in seconds as strings', () => {
    // 2025-07-01 — clearly old
    expect(isPartialSpanOrTraceData('1751328000')).toBe(true);
  });

  it('handles unix timestamps in milliseconds as strings', () => {
    // 2025-07-01 — clearly old
    expect(isPartialSpanOrTraceData('1751328000000')).toBe(true);
  });

  it('handles numeric timestamps in seconds', () => {
    // 2025-07-01 — clearly old
    expect(isPartialSpanOrTraceData(1751328000)).toBe(true);
  });

  it('handles numeric timestamps in milliseconds', () => {
    // 2025-07-01 — clearly old
    expect(isPartialSpanOrTraceData(1751328000000)).toBe(true);
  });

  it('marks data as old at exactly 30 days', () => {
    // Exactly 30 days before 2025-10-06T00:00:00Z
    expect(isPartialSpanOrTraceData('2025-09-06T00:00:00Z')).toBe(true);
  });

  it('does not mark data as old at 29 days', () => {
    expect(isPartialSpanOrTraceData('2025-09-07T00:00:00Z')).toBe(false);
  });

  it('returns false for future timestamps', () => {
    expect(isPartialSpanOrTraceData('2025-12-01T00:00:00Z')).toBe(false);
  });
});
