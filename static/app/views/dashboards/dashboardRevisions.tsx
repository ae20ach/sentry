import {Fragment, useState} from 'react';
import {css} from '@emotion/react';
import styled from '@emotion/styled';
import {useMutation} from '@tanstack/react-query';

import {Alert} from '@sentry/scraps/alert';
import {UserAvatar} from '@sentry/scraps/avatar';
import {Tag} from '@sentry/scraps/badge';
import {Button} from '@sentry/scraps/button';
import {Flex} from '@sentry/scraps/layout';
import {Heading, Text} from '@sentry/scraps/text';
import {Tooltip} from '@sentry/scraps/tooltip';

import type {ModalRenderProps} from 'sentry/actionCreators/modal';
import {openModal} from 'sentry/actionCreators/modal';
import {DateTime} from 'sentry/components/dateTime';
import {LoadingIndicator} from 'sentry/components/loadingIndicator';
import {
  getAbsoluteSummary,
  getRelativeSummary,
} from 'sentry/components/timeRangeSelector/utils';
import {IconClock} from 'sentry/icons/iconClock';
import {IconGraph} from 'sentry/icons/iconGraph';
import {IconMarkdown} from 'sentry/icons/iconMarkdown';
import {IconNumber} from 'sentry/icons/iconNumber';
import {IconSettings} from 'sentry/icons/iconSettings';
import {IconTable} from 'sentry/icons/iconTable';
import {t} from 'sentry/locale';
import type {User} from 'sentry/types/user';
import {defined} from 'sentry/utils';
import {useApi} from 'sentry/utils/useApi';
import {useOrganization} from 'sentry/utils/useOrganization';
import {useProjects} from 'sentry/utils/useProjects';

import type {DashboardRevision} from './hooks/useDashboardRevisions';
import {
  useDashboardRevisionDetails,
  useDashboardRevisions,
} from './hooks/useDashboardRevisions';
import {NUM_DESKTOP_COLS} from './constants';
import type {DashboardDetails, Widget} from './types';
import {DashboardFilterKeys, DisplayType} from './types';

interface DashboardRevisionsButtonProps {
  dashboard: DashboardDetails;
}

export function DashboardRevisionsButton({dashboard}: DashboardRevisionsButtonProps) {
  if (
    !dashboard.id ||
    dashboard.id === 'default-overview' ||
    defined(dashboard.prebuiltId)
  ) {
    return null;
  }

  const handleClick = () => {
    openModal(
      props => (
        <DashboardRevisionsModal
          {...props}
          dashboardId={dashboard.id}
          dashboardCreatedBy={dashboard.createdBy}
        />
      ),
      {
        modalCss: css`
          [role='document'] {
            max-width: 860px;
            width: 90vw;
          }
        `,
      }
    );
  };

  return (
    <Tooltip title={t('Dashboard Revisions')}>
      <Button
        size="sm"
        icon={<IconClock />}
        aria-label={t('Dashboard Revisions')}
        onClick={handleClick}
      />
    </Tooltip>
  );
}

function DashboardRevisionsModal({
  Header,
  Body,
  closeModal,
  dashboardId,
  dashboardCreatedBy,
}: ModalRenderProps & {
  dashboardCreatedBy: User | undefined;
  dashboardId: string;
}) {
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const {data: revisions, isPending, isError} = useDashboardRevisions({dashboardId});
  const selectedRevision = revisions?.find(r => r.id === selectedRevisionId) ?? null;

  const api = useApi();
  const organization = useOrganization();
  const {
    mutate: restore,
    isPending: isRestoring,
    isError: isRestoreError,
  } = useMutation({
    mutationFn: () => {
      if (!selectedRevision) {
        return Promise.reject(new Error('No revision selected'));
      }
      return api.requestPromise(
        `/organizations/${organization.slug}/dashboards/${dashboardId}/revisions/${selectedRevision.id}/restore/`,
        {method: 'POST'}
      );
    },
    onSuccess: () => {
      closeModal();
      window.location.assign(window.location.pathname);
    },
  });

  return (
    <Fragment>
      <Header closeButton>
        <Heading as="h4">{t('Dashboard Revisions')}</Heading>
      </Header>
      <Body>
        {isPending ? (
          <LoadingIndicator />
        ) : isError ? (
          <Alert variant="danger">{t('Failed to load dashboard revisions.')}</Alert>
        ) : revisions?.length ? (
          <Flex direction="column" gap="md">
            <SideBySideLayout>
              <RevisionPreview dashboardId={dashboardId} revision={selectedRevision} />
              <EditHistoryPanel
                revisions={revisions}
                selectedRevisionId={selectedRevisionId}
                onSelect={setSelectedRevisionId}
                currentVersionCreatedBy={dashboardCreatedBy}
              />
            </SideBySideLayout>
            <ModalFooterRow>
              {isRestoreError && (
                <Alert variant="danger">{t('Failed to restore this revision.')}</Alert>
              )}
              <Flex justify="flex-end" gap="sm">
                <Button size="sm" onClick={closeModal}>
                  {t('Cancel')}
                </Button>
                <Button
                  priority="primary"
                  size="sm"
                  onClick={() => restore()}
                  busy={isRestoring}
                  disabled={!selectedRevisionId}
                >
                  {t('Revert to Selection')}
                </Button>
              </Flex>
            </ModalFooterRow>
          </Flex>
        ) : (
          <Flex align="center" justify="center" padding="xl">
            <Text variant="muted">{t('No revisions found.')}</Text>
          </Flex>
        )}
      </Body>
    </Fragment>
  );
}

function EditHistoryPanel({
  revisions,
  selectedRevisionId,
  onSelect,
  currentVersionCreatedBy,
}: {
  currentVersionCreatedBy: User | undefined;
  onSelect: (id: string) => void;
  revisions: DashboardRevision[];
  selectedRevisionId: string | null;
}) {
  return (
    <HistoryPanelContainer>
      <HistoryPanelHeader>
        <Text bold>{t('Edit History')}</Text>
      </HistoryPanelHeader>
      <HistoryScrollArea role="listbox" aria-label={t('Edit History')}>
        <CurrentVersionItem>
          <Text bold size="sm" variant="accent">
            {t('Current Version')}
          </Text>
          <Flex align="center" gap="xs">
            {currentVersionCreatedBy && (
              <UserAvatar user={currentVersionCreatedBy} size={16} />
            )}
            <Text size="sm" variant="muted">
              {currentVersionCreatedBy
                ? currentVersionCreatedBy.name || currentVersionCreatedBy.email
                : t('Unknown')}
            </Text>
          </Flex>
        </CurrentVersionItem>
        {revisions.map(revision => (
          <HistoryItem
            key={revision.id}
            role="option"
            aria-selected={revision.id === selectedRevisionId}
            onClick={() => onSelect(revision.id)}
          >
            <Text bold size="sm">
              {revision.source === 'pre-restore' ? t('Pre-restore') : t('Edit')}
            </Text>
            <DateTime date={revision.dateCreated} timeZone year />
            <Flex align="center" gap="xs">
              {revision.createdBy && (
                <UserAvatar
                  user={{
                    ...revision.createdBy,
                    ip_address: '',
                    username: revision.createdBy.email,
                  }}
                  size={16}
                />
              )}
              <Text size="sm" variant="muted">
                {revision.createdBy
                  ? revision.createdBy.name || revision.createdBy.email
                  : t('Unknown')}
              </Text>
            </Flex>
          </HistoryItem>
        ))}
      </HistoryScrollArea>
    </HistoryPanelContainer>
  );
}

function RevisionPreview({
  dashboardId,
  revision,
}: {
  dashboardId: string;
  revision: DashboardRevision | null;
}) {
  const {
    data: snapshot,
    isPending,
    isError,
  } = useDashboardRevisionDetails({dashboardId, revisionId: revision?.id ?? null});

  if (!revision) {
    return (
      <Flex justify="center" align="center" padding="xl">
        <Text variant="muted">{t('Select a revision to preview.')}</Text>
      </Flex>
    );
  }

  if (isPending) {
    return <LoadingIndicator />;
  }

  if (isError) {
    return <Alert variant="danger">{t('Failed to load revision preview.')}</Alert>;
  }

  if (!snapshot) {
    return null;
  }

  return (
    <Flex direction="column" gap="md">
      <RevisionFilterSummary snapshot={snapshot} />
      <DashboardMinimap widgets={snapshot.widgets} />
    </Flex>
  );
}

function RevisionFilterSummary({snapshot}: {snapshot: DashboardDetails}) {
  const {projects: allProjects} = useProjects();

  const timeLabel = snapshot.period
    ? getRelativeSummary(snapshot.period)
    : snapshot.start && snapshot.end
      ? getAbsoluteSummary(snapshot.start, snapshot.end, snapshot.utc)
      : null;

  const projectIds = snapshot.projects ?? [];
  const selectedProjects = allProjects.filter(p =>
    projectIds.includes(parseInt(p.id, 10))
  );
  const environments = snapshot.environment?.filter(Boolean) ?? [];
  const releases = snapshot.filters?.[DashboardFilterKeys.RELEASE]?.filter(Boolean) ?? [];
  const globalFilters = snapshot.filters?.[DashboardFilterKeys.GLOBAL_FILTER] ?? [];

  if (
    !timeLabel &&
    !selectedProjects.length &&
    !environments.length &&
    !releases.length &&
    !globalFilters.length
  ) {
    return null;
  }

  return (
    <Flex gap="sm" wrap="wrap">
      {timeLabel && <Tag variant="muted">{timeLabel}</Tag>}
      {selectedProjects.map(project => (
        <Tag key={project.id} variant="muted">
          {project.slug}
        </Tag>
      ))}
      {environments.map(env => (
        <Tag key={env} variant="muted">
          {env}
        </Tag>
      ))}
      {releases.map(release => (
        <Tag key={release} variant="muted">
          {release}
        </Tag>
      ))}
      {globalFilters.map((filter, i) => (
        <Tag key={i} variant="muted">
          {filter.value}
        </Tag>
      ))}
    </Flex>
  );
}

const DISPLAY_TYPE_ICONS: Partial<Record<DisplayType, React.ReactNode>> = {
  [DisplayType.AREA]: <IconGraph type="area" size="sm" />,
  [DisplayType.BAR]: <IconGraph type="bar" size="sm" />,
  [DisplayType.LINE]: <IconGraph type="line" size="sm" />,
  [DisplayType.TABLE]: <IconTable size="sm" />,
  [DisplayType.BIG_NUMBER]: <IconNumber size="sm" />,
  [DisplayType.CATEGORICAL_BAR]: <IconGraph type="bar" size="sm" />,
  [DisplayType.TEXT]: <IconMarkdown size="sm" />,
  [DisplayType.DETAILS]: <IconSettings size="sm" />,
};

function DashboardMinimap({widgets}: {widgets: Widget[]}) {
  return (
    <MinimapGrid>
      {widgets.map((widget, index) => {
        const {layout} = widget;
        return (
          <WidgetTile
            key={widget.id ?? String(index)}
            style={
              layout
                ? {
                    gridColumn: `${layout.x + 1} / span ${layout.w}`,
                    gridRow: `${layout.y + 1} / span ${layout.h}`,
                  }
                : undefined
            }
          >
            <WidgetTileIcon>
              {DISPLAY_TYPE_ICONS[widget.displayType as DisplayType] ?? (
                <IconGraph size="sm" />
              )}
            </WidgetTileIcon>
            <WidgetTileTitle>{widget.title}</WidgetTileTitle>
          </WidgetTile>
        );
      })}
    </MinimapGrid>
  );
}

const SideBySideLayout = styled('div')`
  display: grid;
  grid-template-columns: 1fr 260px;
  gap: ${p => p.theme.space.lg};
  align-items: stretch;
`;

const HistoryPanelContainer = styled('div')`
  display: flex;
  flex-direction: column;
  max-height: 520px;
`;

const HistoryPanelHeader = styled('div')`
  padding: ${p => p.theme.space.md};
  flex-shrink: 0;
`;

const HistoryScrollArea = styled('div')`
  overflow-y: auto;
  flex: 1;
`;

const CurrentVersionItem = styled('div')`
  padding: ${p => p.theme.space.lg} ${p => p.theme.space.md};
  display: flex;
  flex-direction: column;
  gap: ${p => p.theme.space.xs};
  border-bottom: 1px solid ${p => p.theme.tokens.border.secondary};
`;

const HistoryItem = styled('div')`
  cursor: pointer;
  padding: ${p => p.theme.space.lg} ${p => p.theme.space.md};
  display: flex;
  flex-direction: column;
  gap: ${p => p.theme.space.xs};

  &:hover {
    background-color: ${p => p.theme.tokens.background.secondary};
  }

  &[aria-selected='true'] {
    background-color: ${p => p.theme.tokens.background.transparent.accent.muted};
  }
`;

const ModalFooterRow = styled('div')`
  display: flex;
  flex-direction: column;
  gap: ${p => p.theme.space.sm};
  align-items: flex-end;
`;

const MinimapGrid = styled('div')`
  display: grid;
  grid-template-columns: repeat(${NUM_DESKTOP_COLS}, 1fr);
  grid-auto-rows: minmax(60px, auto);
  gap: ${p => p.theme.space.sm};
`;

const WidgetTile = styled('div')`
  background-color: ${p => p.theme.tokens.background.primary};
  border: 1px solid ${p => p.theme.tokens.border.secondary};
  border-radius: ${p => p.theme.radius.sm};
  padding: ${p => p.theme.space.md};
  display: flex;
  flex-direction: column;
  gap: ${p => p.theme.space.xs};
  overflow: hidden;
  min-width: 0;
`;

const WidgetTileIcon = styled('div')`
  display: flex;
  align-items: center;
  color: ${p => p.theme.tokens.content.muted};
  flex-shrink: 0;
`;

const WidgetTileTitle = styled('div')`
  font-size: ${p => p.theme.font.size.sm};
  color: ${p => p.theme.tokens.content.primary};
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
`;
