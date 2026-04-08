import moment from 'moment-timezone';

const TRACE_DATA_RETENTION_DAYS = 30;

/**
 * Converts a timestamp to milliseconds for moment.js consumption.
 * Expects Unix epoch seconds, Unix epoch milliseconds, or ISO 8601 strings.
 * Pure numeric strings like "20250801" will be misinterpreted as epoch values.
 */
function normalizeTimestamp(timestamp: string | number): string | number {
  if (typeof timestamp === 'number') {
    return timestamp < 1e12 ? timestamp * 1000 : timestamp;
  }

  const numericTimestamp = Number(timestamp);
  if (timestamp.trim() !== '' && Number.isFinite(numericTimestamp)) {
    return numericTimestamp < 1e12 ? numericTimestamp * 1000 : numericTimestamp;
  }

  return timestamp;
}

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
  const timestampDate = moment(normalizeTimestamp(timestamp));
  if (!timestampDate.isValid()) {
    return false;
  }
  return now.diff(timestampDate, 'days') >= TRACE_DATA_RETENTION_DAYS;
}
