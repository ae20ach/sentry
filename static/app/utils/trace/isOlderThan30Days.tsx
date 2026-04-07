import moment from 'moment-timezone';

const TRACE_DATA_RETENTION_DAYS = 30;

/**
 * Returns true if the given timestamp is older than 30 days, indicating
 * that the trace/span data may no longer be available.
 *
 * Handles timestamps in seconds, milliseconds, or ISO string format.
 */
export function isPartialSpanOrTraceData(
  timestamp: string | number | undefined
): boolean {
  if (timestamp === undefined) {
    return false;
  }
  const now = moment();
  // Numbers < 1e12 are likely seconds (epoch), not milliseconds.
  // e.g. 1712002518 is seconds, 1712002518000 is milliseconds.
  const normalizedTimestamp =
    typeof timestamp === 'number' && timestamp < 1e12 ? timestamp * 1000 : timestamp;
  const timestampDate = moment(normalizedTimestamp);
  return now.diff(timestampDate, 'days') > TRACE_DATA_RETENTION_DAYS;
}
