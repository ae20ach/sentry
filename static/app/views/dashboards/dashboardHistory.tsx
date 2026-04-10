import {Fragment, useCallback, useEffect, useMemo, useState} from 'react';
import {css} from '@emotion/react';
import styled from '@emotion/styled';

import {Badge} from '@sentry/scraps/badge';
import {Button} from '@sentry/scraps/button';
import {Flex} from '@sentry/scraps/layout';
import {Text} from '@sentry/scraps/text';
import {Tooltip} from '@sentry/scraps/tooltip';

import {makeDashboardHistoryQueryKey} from 'sentry/actionCreators/dashboards';
import {addErrorMessage, addSuccessMessage} from 'sentry/actionCreators/indicator';
import {openModal} from 'sentry/actionCreators/modal';
import type {ModalRenderProps} from 'sentry/actionCreators/modal';
import {LoadingIndicator} from 'sentry/components/loadingIndicator';
import {IconClock} from 'sentry/icons/iconClock';
import {t, tn} from 'sentry/locale';
import {MEPSettingProvider} from 'sentry/utils/performance/contexts/metricsEnhancedSetting';
import {fetchMutation, useMutation, useQueryClient} from 'sentry/utils/queryClient';
import type {RequestError} from 'sentry/utils/requestError/requestError';
import {useLocation} from 'sentry/utils/useLocation';
import {useNavigate} from 'sentry/utils/useNavigate';
import {useOrganization} from 'sentry/utils/useOrganization';

import {useDashboardHistory} from './hooks/useDashboardHistory';
import {useDashboardHistorySnapshot} from './hooks/useDashboardHistorySnapshot';
import {Dashboard} from './dashboard';
import type {DashboardDetails} from './types';
import {WidgetLegendSelectionState} from './widgetLegendSelectionState';

const NOOP = () => {};

interface DashboardHistoryButtonProps {
  dashboard: DashboardDetails;
  onRestore: (restoredDashboard: DashboardDetails) => void;
}

export function DashboardHistoryButton({
  dashboard,
  onRestore,
}: DashboardHistoryButtonProps) {
  const organization = useOrganization();

  const isValidDashboard =
    !!dashboard.id && dashboard.id !== 'default-overview' && !dashboard.prebuiltId;

  const {data: history} = useDashboardHistory({
    dashboardId: dashboard.id,
    enabled: isValidDashboard,
  });

  const hasHistory = (history?.length ?? 0) > 0;

  const handleClick = useCallback(() => {
    openModal(
      props => (
        <DashboardHistoryModal
          {...props}
          dashboardId={dashboard.id}
          orgSlug={organization.slug}
          onRestore={restoredDashboard => {
            onRestore(restoredDashboard);
            props.closeModal();
          }}
        />
      ),
      {
        modalCss: css`
          width: min(90vw, 1400px);
        `,
      }
    );
  }, [dashboard.id, organization.slug, onRestore]);

  if (!isValidDashboard) {
    return null;
  }

  return (
    <Tooltip
      title={
        hasHistory
          ? t('Dashboard History')
          : t('No history yet. History is recorded when the dashboard is edited.')
      }
    >
      <Button
        size="sm"
        icon={<IconClock />}
        aria-label={t('Dashboard History')}
        onClick={handleClick}
        disabled={!hasHistory}
      />
    </Tooltip>
  );
}

function DashboardHistoryModal({
  Header,
  Body,
  dashboardId,
  orgSlug,
  onRestore,
}: ModalRenderProps & {
  dashboardId: string;
  onRestore: (restoredDashboard: DashboardDetails) => void;
  orgSlug: string;
}) {
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const organization = useOrganization();
  const location = useLocation();
  const navigate = useNavigate();

  const {data: history, isPending: isHistoryPending} = useDashboardHistory({dashboardId});
  const {data: snapshotDashboard, isPending: isSnapshotPending} =
    useDashboardHistorySnapshot({
      dashboardId,
      historyId: selectedHistoryId,
    });

  useEffect(() => {
    if (history?.length && selectedHistoryId === null) {
      setSelectedHistoryId(history[0]!.id);
    }
  }, [history, selectedHistoryId]);

  const selectedEntry = history?.find(e => e.id === selectedHistoryId);

  const widgetLegendState = useMemo(
    () =>
      new WidgetLegendSelectionState({
        dashboard: snapshotDashboard ?? null,
        location,
        navigate,
        organization,
      }),
    [snapshotDashboard, location, navigate, organization]
  );

  const {mutate: restoreSnapshot, isPending: isRestoring} = useMutation<
    DashboardDetails,
    RequestError,
    {historyId: string}
  >({
    mutationFn: ({historyId}) =>
      fetchMutation({
        url: `/organizations/${orgSlug}/dashboards/${dashboardId}/history/${historyId}/restore/`,
        method: 'POST',
      }),
    onSuccess: restored => {
      queryClient.invalidateQueries({
        queryKey: makeDashboardHistoryQueryKey(orgSlug, dashboardId),
      });
      addSuccessMessage(t('Dashboard restored successfully'));
      onRestore(restored);
    },
    onError: () => {
      addErrorMessage(t('Unable to restore dashboard'));
    },
  });

  return (
    <Fragment>
      <Header closeButton>{t('Dashboard History')}</Header>
      <Body>
        <ModalLayout>
          <VersionsPanel>
            <VersionsPanelHeader>
              <Text size="sm" bold>
                {t('Versions')}
              </Text>
            </VersionsPanelHeader>
            <VersionsPanelDescription>
              <Text size="sm" variant="muted">
                {t(
                  'Up to 10 snapshots stored, newest first. Oldest deleted when limit reached.'
                )}
              </Text>
            </VersionsPanelDescription>
            {isHistoryPending ? (
              <LoadingIndicator />
            ) : (
              <VersionList>
                {history?.map(entry => (
                  <VersionItem
                    key={entry.id}
                    $isSelected={entry.id === selectedHistoryId}
                    onClick={() => setSelectedHistoryId(entry.id)}
                  >
                    <Text size="sm">{new Date(entry.dateAdded).toLocaleString()}</Text>
                    <Flex align="center" gap="sm">
                      <Text size="xs" variant="muted">
                        {tn('%s widget', '%s widgets', entry.widgetCount)}
                      </Text>
                      {entry.source === 'restore' && (
                        <Badge variant="warning">{t('pre-restore')}</Badge>
                      )}
                    </Flex>
                    {entry.createdBy && (
                      <Text size="xs" variant="muted">
                        {entry.createdBy.name || entry.createdBy.email}
                      </Text>
                    )}
                  </VersionItem>
                ))}
              </VersionList>
            )}
          </VersionsPanel>

          <PreviewPanel>
            {selectedEntry && (
              <PreviewToolbar>
                <div>
                  <Text size="md" bold>
                    {selectedEntry.title}
                  </Text>
                  <Text size="sm" variant="muted">
                    {new Date(selectedEntry.dateAdded).toLocaleString()}
                  </Text>
                </div>
                <Button
                  size="sm"
                  priority="primary"
                  onClick={() => restoreSnapshot({historyId: selectedEntry.id})}
                  disabled={isRestoring}
                >
                  {t('Restore this version')}
                </Button>
              </PreviewToolbar>
            )}
            <PreviewScroll>
              {selectedHistoryId ? (
                isSnapshotPending ? (
                  <LoadingIndicator />
                ) : snapshotDashboard ? (
                  <MEPSettingProvider>
                    <Dashboard
                      dashboard={snapshotDashboard}
                      isEditingDashboard={false}
                      isPreview
                      widgetLegendState={widgetLegendState}
                      widgetLimitReached={false}
                      handleAddCustomWidget={NOOP}
                      handleUpdateWidgetList={NOOP}
                      onUpdate={NOOP}
                    />
                  </MEPSettingProvider>
                ) : null
              ) : (
                <Flex align="center" justify="center" style={{height: '100%'}}>
                  <Text variant="muted">{t('Select a version to preview')}</Text>
                </Flex>
              )}
            </PreviewScroll>
          </PreviewPanel>
        </ModalLayout>
      </Body>
    </Fragment>
  );
}

const ModalLayout = styled('div')`
  display: flex;
  gap: ${p => p.theme.space.xl};
  height: 65vh;
  margin-top: ${p => p.theme.space.md};
`;

const VersionsPanel = styled('div')`
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid ${p => p.theme.tokens.border.primary};
  padding-right: ${p => p.theme.space.xl};
  overflow: hidden;
`;

const VersionsPanelHeader = styled('div')`
  margin-bottom: ${p => p.theme.space.sm};
`;

const VersionsPanelDescription = styled('div')`
  margin-bottom: ${p => p.theme.space.md};
`;

const VersionList = styled('ul')`
  list-style: none;
  padding: 0;
  margin: 0;
  overflow-y: auto;
  flex: 1;
`;

const VersionItem = styled('li')<{$isSelected: boolean}>`
  display: flex;
  flex-direction: column;
  gap: ${p => p.theme.space.xs};
  padding: ${p => p.theme.space.md};
  border-radius: ${p => p.theme.radius.md};
  cursor: pointer;
  background: ${p =>
    p.$isSelected ? p.theme.tokens.background.secondary : 'transparent'};
  border: 1px solid ${p => (p.$isSelected ? p.theme.tokens.border.accent : 'transparent')};

  &:hover {
    background: ${p => p.theme.tokens.background.secondary};
  }
`;

const PreviewPanel = styled('div')`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const PreviewToolbar = styled('div')`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${p => p.theme.space.md};
  margin-bottom: ${p => p.theme.space.md};
  flex-shrink: 0;
`;

const PreviewScroll = styled('div')`
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
`;
