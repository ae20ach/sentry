import {Button} from '@sentry/scraps/button';

import {openModal} from 'sentry/actionCreators/modal';
import {type LogsQueryInfo} from 'sentry/components/exports/dataExport';
import {IconDownload} from 'sentry/icons';
import {t} from 'sentry/locale';
import {trackAnalytics} from 'sentry/utils/analytics';
import {useOrganization} from 'sentry/utils/useOrganization';
import {getExportDisabledTooltip} from 'sentry/views/explore/components/getExportDisabledTooltip';
import {LogsExportModal} from 'sentry/views/explore/logs/logsExportModal';
import type {OurLogsResponseItem} from 'sentry/views/explore/logs/types';

const GLOBAL_MODAL_DISMISS_TO_CLOSE_REASON = {
  'backdrop-click': 'backdrop_click',
  'close-button': 'close_button',
  'escape-key': 'escape_key',
} as const;

type LogsExportModalButtonProps = {
  estimatedRowCount: number;
  isLoading: boolean;
  queryInfo: LogsQueryInfo;
  tableData: OurLogsResponseItem[];
  error?: Error | null;
};

export function LogsExportModalButton({
  error,
  estimatedRowCount,
  isLoading,
  queryInfo,
  tableData,
}: LogsExportModalButtonProps) {
  const organization = useOrganization();
  const disabledTooltip = getExportDisabledTooltip({
    isDataEmpty: !tableData?.length,
    isDataError: error !== null,
    isDataLoading: isLoading,
  });

  return (
    <Button
      disabled={!!disabledTooltip}
      size="xs"
      priority="default"
      icon={<IconDownload />}
      onClick={() => {
        trackAnalytics('logs.export_modal', {
          organization,
          action: 'open',
        });
        openModal(
          deps => (
            <LogsExportModal
              {...deps}
              queryInfo={queryInfo}
              estimatedRowCount={estimatedRowCount}
              tableData={tableData}
            />
          ),
          {
            onClose: reason => {
              if (reason) {
                trackAnalytics('logs.export_modal', {
                  organization,
                  action: 'cancel',
                  close_reason: GLOBAL_MODAL_DISMISS_TO_CLOSE_REASON[reason],
                });
              }
            },
          }
        );
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
