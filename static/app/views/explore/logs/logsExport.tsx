import {Fragment} from 'react';

import {ExportQueryType} from 'sentry/components/dataExport';
import {DataExportWithModal} from 'sentry/components/dataExportWithModal';
import {usePageFilters} from 'sentry/components/pageFilters/usePageFilters';
import {ExploreExport} from 'sentry/views/explore/components/exploreExport';
import {downloadLogsAsCsv} from 'sentry/views/explore/logs/logsExportCsv';
import {
  canExportLogsInBrowserSession,
  hasReachedLogsBrowserExportPageLimit,
} from 'sentry/views/explore/logs/logsExportSession';
import type {OurLogFieldKey, OurLogsResponseItem} from 'sentry/views/explore/logs/types';
import {
  useQueryParamsFields,
  useQueryParamsSearch,
  useQueryParamsSortBys,
} from 'sentry/views/explore/queryParams/context';
import {TraceItemDataset} from 'sentry/views/explore/types';

type LogsExportButtonProps = {
  isLoading: boolean;
  tableData: OurLogsResponseItem[] | null | undefined;
  error?: Error | null;
};

interface LogsQueryInfo {
  dataset: 'logs';
  field: OurLogFieldKey[];
  project: number[];
  query: string;
  sort: string[];
  end?: string;
  environment?: string[];
  start?: string;
  statsPeriod?: string;
}

export function LogsExportButton(props: LogsExportButtonProps) {
  const {selection} = usePageFilters();
  const logsSearch = useQueryParamsSearch();
  const fields = useQueryParamsFields();
  const sortBys = useQueryParamsSortBys();
  const {start, end, period: statsPeriod} = selection.datetime;
  const {environments, projects} = selection;

  const queryInfo: LogsQueryInfo = {
    dataset: 'logs',
    field: [...fields],
    query: logsSearch.formatString(),
    project: projects,
    sort: sortBys.map(sort => `${sort.kind === 'desc' ? '-' : ''}${sort.field}`),
    start: start ? new Date(start).toISOString() : undefined,
    end: end ? new Date(end).toISOString() : undefined,
    statsPeriod: statsPeriod || undefined,
    environment: environments,
  };

  const disabled =
    props.isLoading ||
    props.error !== null ||
    !props.tableData ||
    props.tableData.length === 0;

  const isDataEmpty = !props.tableData || props.tableData.length === 0;
  const isDataLoading = props.isLoading;
  const isDataError = props.error !== null;

  const handleDownloadAsCsv = () => {
    if (props.tableData) {
      downloadLogsAsCsv(props.tableData, queryInfo.field, 'logs');
    }
  };

  return (
    <Fragment>
      <ExploreExport
        traceItemDataset={TraceItemDataset.LOGS}
        disabled={disabled}
        hasReachedCSVLimit={hasReachedLogsBrowserExportPageLimit(props.tableData)}
        queryInfo={queryInfo}
        isDataEmpty={isDataEmpty}
        isDataLoading={isDataLoading}
        isDataError={isDataError}
        downloadAsCsv={handleDownloadAsCsv}
      />
      <DataExportWithModal
        payload={{
          queryType: ExportQueryType.EXPLORE,
          queryInfo: {
            ...queryInfo,
            dataset: TraceItemDataset.LOGS,
          },
        }}
        sessionExport={{
          canExportInSession: canExportLogsInBrowserSession(props.tableData),
          onSessionExport: () => {
            if (props.tableData) {
              downloadLogsAsCsv(props.tableData, queryInfo.field, 'logs');
            }
          },
        }}
      />
    </Fragment>
  );
}
