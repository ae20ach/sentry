import {type LogsQueryInfo} from 'sentry/components/dataExport';
import {usePageFilters} from 'sentry/components/pageFilters/usePageFilters';
import {useLocation} from 'sentry/utils/useLocation';
import {useOrganization} from 'sentry/utils/useOrganization';
import {LogsExportButton} from 'sentry/views/explore/logs/logsExportButton';
import {LogsExportModalButton} from 'sentry/views/explore/logs/logsExportModalButton';
import type {OurLogsResponseItem} from 'sentry/views/explore/logs/types';
import {
  useQueryParamsFields,
  useQueryParamsSearch,
  useQueryParamsSortBys,
} from 'sentry/views/explore/queryParams/context';

type LogsExportSwitchProps = {
  downloadLocally: boolean;
  isLoading: boolean;
  tableData: OurLogsResponseItem[] | null | undefined;
  threshold: number;
  error?: Error | null;
};

export function LogsExportSwitch({
  isLoading,
  tableData,
  error,
  downloadLocally,
  threshold,
}: LogsExportSwitchProps) {
  const organization = useOrganization();
  const location = useLocation();
  const showModalExport =
    organization.features.includes('ourlogs-modal-export') ||
    location.query.logsModalExport === 'true';

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

  const ButtonComponent = showModalExport ? LogsExportModalButton : LogsExportButton;

  return (
    <ButtonComponent
      queryInfo={queryInfo}
      isLoading={isLoading}
      error={error}
      tableData={tableData}
      downloadLocally={downloadLocally}
      threshold={threshold}
    />
  );
}
