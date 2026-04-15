import type {LogsQueryInfo} from 'sentry/components/exports/dataExport';
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
  estimatedRowCount: number;
  isLoading: boolean;
  tableData: OurLogsResponseItem[];
  error?: Error | null;
};

export function LogsExportSwitch({
  isLoading,
  tableData,
  error,
  estimatedRowCount,
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

  const exportButtonProps = {
    queryInfo,
    isLoading,
    error,
    tableData,
  };

  return showModalExport ? (
    <LogsExportModalButton {...exportButtonProps} estimatedRowCount={estimatedRowCount} />
  ) : (
    <LogsExportButton {...exportButtonProps} />
  );
}
