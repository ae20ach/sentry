import {type LogsQueryInfo} from 'sentry/components/useDataExport';
import {ExploreExport} from 'sentry/views/explore/components/exploreExport';
import {QUERY_PAGE_LIMIT} from 'sentry/views/explore/logs/constants';
import {downloadLogsAsCsv} from 'sentry/views/explore/logs/downloadLogsAsCsv';
import type {OurLogsResponseItem} from 'sentry/views/explore/logs/types';
import {TraceItemDataset} from 'sentry/views/explore/types';

type LogsExportButtonProps = {
  isLoading: boolean;
  queryInfo: LogsQueryInfo;
  tableData: OurLogsResponseItem[] | null | undefined;
  /** Passed through from LogsExportSwitch for the modal path only */
  downloadLocally?: boolean;
  error?: Error | null;
  threshold?: number;
};

export function LogsExportButton({
  isLoading,
  tableData,
  error,
  queryInfo,
}: LogsExportButtonProps) {
  const isDataEmpty = !tableData?.length;
  const isDataError = error !== null;

  const handleDownloadAsCsv = () => {
    if (tableData) {
      downloadLogsAsCsv(tableData, queryInfo.field, 'logs');
    }
  };

  const isMoreThanOnePage = !!tableData && tableData.length > QUERY_PAGE_LIMIT - 1;

  return (
    <ExploreExport
      traceItemDataset={TraceItemDataset.LOGS}
      hasReachedCSVLimit={isMoreThanOnePage}
      queryInfo={queryInfo}
      isDataEmpty={isDataEmpty}
      isDataLoading={isLoading}
      isDataError={isDataError}
      downloadAsCsv={handleDownloadAsCsv}
    />
  );
}
