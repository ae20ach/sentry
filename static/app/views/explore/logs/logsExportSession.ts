import {QUERY_PAGE_LIMIT} from 'sentry/views/explore/logs/constants';
import type {OurLogsResponseItem} from 'sentry/views/explore/logs/types';

/**
 * Whether the loaded logs table has more rows than a single UI page fetch, so the
 * user must use async export instead of downloading CSV from in-memory table data.
 * Mirrors the condition used by {@link ExploreExport} for `hasReachedCSVLimit`.
 */
export function hasReachedLogsBrowserExportPageLimit(
  tableData: OurLogsResponseItem[] | null | undefined
): boolean {
  return !!tableData && tableData.length > QUERY_PAGE_LIMIT - 1;
}

/**
 * Whether we can export the current result set entirely in the browser from data
 * already loaded in the table (same threshold as the primary Export button’s
 * direct CSV download).
 */
export function canExportLogsInBrowserSession(
  tableData: OurLogsResponseItem[] | null | undefined
): boolean {
  return !!tableData && tableData.length > 0 && tableData.length <= QUERY_PAGE_LIMIT - 1;
}
