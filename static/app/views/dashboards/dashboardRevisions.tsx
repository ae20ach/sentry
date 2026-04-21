import {Fragment, useState} from 'react';
import {css} from '@emotion/react';
import styled from '@emotion/styled';
import {useMutation} from '@tanstack/react-query';

import {Alert} from '@sentry/scraps/alert';
import {Tag} from '@sentry/scraps/badge';
import {Button} from '@sentry/scraps/button';
import {Flex} from '@sentry/scraps/layout';
import {Heading, Text} from '@sentry/scraps/text';
import {Tooltip} from '@sentry/scraps/tooltip';

import type {ModalRenderProps} from 'sentry/actionCreators/modal';
import {openModal} from 'sentry/actionCreators/modal';
import {LoadingIndicator} from 'sentry/components/loadingIndicator';
import {SimpleTable} from 'sentry/components/tables/simpleTable';
import {
  getAbsoluteSummary,
  getRelativeSummary,
} from 'sentry/components/timeRangeSelector/utils';
import {TimeSince} from 'sentry/components/timeSince';
import {IconClock} from 'sentry/icons/iconClock';
import {IconGraph} from 'sentry/icons/iconGraph';
import {IconMarkdown} from 'sentry/icons/iconMarkdown';
import {IconNumber} from 'sentry/icons/iconNumber';
import {IconSettings} from 'sentry/icons/iconSettings';
import {IconTable} from 'sentry/icons/iconTable';
import {t} from 'sentry/locale';
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
      props => <DashboardRevisionsModal {...props} dashboardId={dashboard.id} />,
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
}: ModalRenderProps & {
  dashboardId: string;
}) {
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const {data: revisions, isPending, isError} = useDashboardRevisions({dashboardId});
  const selectedRevision = revisions?.find(r => r.id === selectedRevisionId) ?? null;

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
          <SideBySideLayout>
            <RevisionList
              revisions={revisions}
              selectedRevisionId={selectedRevisionId}
              onSelect={setSelectedRevisionId}
            />
            <RevisionPreview
              dashboardId={dashboardId}
              revision={selectedRevision}
              closeModal={closeModal}
            />
          </SideBySideLayout>
        ) : (
          <Flex align="center" justify="center" padding="xl">
            <Text variant="muted">{t('No revisions found.')}</Text>
          </Flex>
        )}
      </Body>
    </Fragment>
  );
}

function RevisionList({
  revisions,
  selectedRevisionId,
  onSelect,
}: {
  onSelect: (id: string) => void;
  revisions: DashboardRevision[];
  selectedRevisionId: string | null;
}) {
  return (
    <RevisionsTable>
      <SimpleTable.Header>
        <SimpleTable.HeaderCell>{t('Date')}</SimpleTable.HeaderCell>
        <SimpleTable.HeaderCell>{t('Author')}</SimpleTable.HeaderCell>
      </SimpleTable.Header>
      {revisions.map(revision => (
        <SelectableRow
          key={revision.id}
          onClick={() => onSelect(revision.id)}
          aria-selected={revision.id === selectedRevisionId}
        >
          <SimpleTable.RowCell>
            <Flex direction="column" gap="xs">
              <TimeSince date={revision.dateCreated} />
              {revision.source === 'pre-restore' && (
                <Tag variant="muted">{t('pre-restore')}</Tag>
              )}
            </Flex>
          </SimpleTable.RowCell>
          <SimpleTable.RowCell>
            <Text size="sm" variant="muted">
              {revision.createdBy
                ? revision.createdBy.name || revision.createdBy.email
                : t('Unknown')}
            </Text>
          </SimpleTable.RowCell>
        </SelectableRow>
      ))}
    </RevisionsTable>
  );
}

function RevisionPreview({
  dashboardId,
  revision,
  closeModal,
}: {
  closeModal: () => void;
  dashboardId: string;
  revision: DashboardRevision | null;
}) {
  const api = useApi();
  const organization = useOrganization();
  const {
    data: snapshot,
    isPending,
    isError,
  } = useDashboardRevisionDetails({dashboardId, revisionId: revision?.id ?? null});

  const {
    mutate: restore,
    isPending: isRestoring,
    isError: isRestoreError,
  } = useMutation({
    mutationFn: () => {
      if (!revision) {
        return Promise.reject(new Error('No revision selected'));
      }
      return api.requestPromise(
        `/organizations/${organization.slug}/dashboards/${dashboardId}/revisions/${revision.id}/restore/`,
        {method: 'POST'}
      );
    },
    onSuccess: () => {
      closeModal();
      window.location.reload();
    },
  });

  if (!revision) {
    return (
      <Flex justify="center" padding="xl">
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
      <Text bold>{snapshot.title}</Text>
      <RevisionFilterSummary snapshot={snapshot} />
      <DashboardMinimap widgets={snapshot.widgets} />
      {isRestoreError && (
        <Alert variant="danger">{t('Failed to restore this revision.')}</Alert>
      )}
      <Flex justify="flex-end">
        <Button priority="primary" size="sm" onClick={() => restore()} busy={isRestoring}>
          {t('Restore this version')}
        </Button>
      </Flex>
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
  grid-template-columns: minmax(260px, 2fr) minmax(300px, 3fr);
  gap: ${p => p.theme.space.lg};
  align-items: start;
`;

const RevisionsTable = styled(SimpleTable)`
  grid-template-columns: 1fr 1fr;
`;

const SelectableRow = styled(SimpleTable.Row)`
  cursor: pointer;

  &:hover {
    background-color: ${p => p.theme.tokens.background.secondary};
  }

  &[aria-selected='true'] {
    background-color: ${p => p.theme.tokens.background.secondary};
  }
`;

const MinimapGrid = styled('div')`
  display: grid;
  grid-template-columns: repeat(${NUM_DESKTOP_COLS}, 1fr);
  grid-auto-rows: minmax(60px, auto);
  gap: ${p => p.theme.space.sm};
  padding: ${p => p.theme.space.md};
  background-color: ${p => p.theme.tokens.background.secondary};
  border: 1px solid ${p => p.theme.tokens.border.primary};
  border-radius: ${p => p.theme.radius.md};
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
