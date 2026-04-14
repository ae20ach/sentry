import {Button} from '@sentry/scraps/button';

import {openModal} from 'sentry/actionCreators/modal';
import {type LogsQueryInfo} from 'sentry/components/dataExport';
import {IconDownload} from 'sentry/icons';
import {t} from 'sentry/locale';
import {getExportDisabledTooltip} from 'sentry/views/explore/components/getExportDisabledTooltip';
import {LogsExportModal} from 'sentry/views/explore/logs/logsExportModal';
import type {OurLogsResponseItem} from 'sentry/views/explore/logs/types';

type LogsExportModalButtonProps = {
  downloadLocally: boolean;
  isLoading: boolean;
  queryInfo: LogsQueryInfo;
  tableData: OurLogsResponseItem[] | null | undefined;
  threshold: number;
  error?: Error | null;
};

export function LogsExportModalButton(props: LogsExportModalButtonProps) {
  const {isLoading, tableData, error, queryInfo, downloadLocally, threshold} = props;
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
            tableData={tableData}
            downloadLocally={downloadLocally}
            threshold={threshold}
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
