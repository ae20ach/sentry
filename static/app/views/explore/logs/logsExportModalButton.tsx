import {Button} from '@sentry/scraps/button';

import {openModal} from 'sentry/actionCreators/modal';
import {type LogsQueryInfo} from 'sentry/components/exports/dataExport';
import {IconDownload} from 'sentry/icons';
import {t} from 'sentry/locale';
import {getExportDisabledTooltip} from 'sentry/views/explore/components/getExportDisabledTooltip';
import {LogsExportModal} from 'sentry/views/explore/logs/logsExportModal';
import type {OurLogsResponseItem} from 'sentry/views/explore/logs/types';

type LogsExportModalButtonProps = {
  estimatedRowCount: number;
  isLoading: boolean;
  queryInfo: LogsQueryInfo;
  tableData: OurLogsResponseItem[];
  error?: Error | null;
};

export function LogsExportModalButton(props: LogsExportModalButtonProps) {
  const {estimatedRowCount, isLoading, tableData, error, queryInfo} = props;
  const isDataEmpty = !tableData?.length;
  const isDataError = error !== null;

  const disabledTooltip = getExportDisabledTooltip({
    isDataEmpty,
    isDataError,
    isDataLoading: isLoading,
  });

  return (
    <Button
      disabled={!!disabledTooltip}
      size="xs"
      priority="default"
      icon={<IconDownload />}
      onClick={() => {
        openModal(deps => (
          <LogsExportModal
            {...deps}
            queryInfo={queryInfo}
            estimatedRowCount={estimatedRowCount}
            tableData={tableData}
          />
        ));
      }}
      tooltipProps={{
        title:
          disabledTooltip ?? t('Configure export options before starting your export.'),
      }}
    >
      {t('Export Data')}
    </Button>
  );
}
