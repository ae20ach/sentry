import {Fragment, useMemo} from 'react';
import {useTheme} from '@emotion/react';
import styled from '@emotion/styled';
import {AnimatePresence, motion, type MotionNodeAnimationOptions} from 'framer-motion';

import {Alert} from '@sentry/scraps/alert';
import {ProjectAvatar} from '@sentry/scraps/avatar';
import {Checkbox} from '@sentry/scraps/checkbox';
import {Container, Flex} from '@sentry/scraps/layout';
import {Text} from '@sentry/scraps/text';

import {bulkDelete, bulkUpdate, mergeGroups} from 'sentry/actionCreators/group';
import {
  addErrorMessage,
  addLoadingMessage,
  clearIndicators,
} from 'sentry/actionCreators/indicator';
import {IconCellSignal} from 'sentry/components/badge/iconCellSignal';
import {CMDKAction} from 'sentry/components/commandPalette/ui/cmdk';
import {CommandPaletteSlot} from 'sentry/components/commandPalette/ui/commandPaletteSlot';
import {ErrorLevel} from 'sentry/components/events/errorLevel';
import {IssueStreamHeaderLabel} from 'sentry/components/IssueStreamHeaderLabel';
import {Sticky} from 'sentry/components/sticky';
import {TimeSince} from 'sentry/components/timeSince';
import {
  IconCheckmark,
  IconIssues,
  IconMerge,
  IconMute,
  IconSliders,
  IconSort,
  IconStack,
} from 'sentry/icons';
import {t, tct, tn} from 'sentry/locale';
import {GroupStore} from 'sentry/stores/groupStore';
import {ProjectsStore} from 'sentry/stores/projectsStore';
import type {PageFilters} from 'sentry/types/core';
import type {Group} from 'sentry/types/group';
import {GroupStatus, GroupSubstatus, PriorityLevel} from 'sentry/types/group';
import {defined} from 'sentry/utils';
import {trackAnalytics} from 'sentry/utils/analytics';
import {uniq} from 'sentry/utils/array/uniq';
import {useQueryClient} from 'sentry/utils/queryClient';
import {decodeScalar} from 'sentry/utils/queryString';
import {useApi} from 'sentry/utils/useApi';
import {useLocation} from 'sentry/utils/useLocation';
import {useMedia} from 'sentry/utils/useMedia';
import {useNavigate} from 'sentry/utils/useNavigate';
import {useOrganization} from 'sentry/utils/useOrganization';
import {useSyncedLocalStorageState} from 'sentry/utils/useSyncedLocalStorageState';
import {
  useIssueSelectionActions,
  useIssueSelectionSummary,
} from 'sentry/views/issueList/issueSelectionContext';
import type {IssueUpdateData} from 'sentry/views/issueList/types';
import {
  DEFAULT_ISSUE_STREAM_SORT,
  FOR_REVIEW_QUERIES,
  getSortLabel,
  IssueSortOptions,
  SAVED_SEARCHES_SIDEBAR_OPEN_LOCALSTORAGE_KEY,
} from 'sentry/views/issueList/utils';

import {ActionSet} from './actionSet';
import {Headers} from './headers';
import {BULK_LIMIT, BULK_LIMIT_STR, ConfirmAction} from './utils';

type IssueListActionsProps = {
  allResultsVisible: boolean;
  displayReprocessingActions: boolean;
  groupIds: string[];
  onDelete: () => void;
  onSelectStatsPeriod: (period: string) => void;
  query: string;
  queryCount: number;
  selection: PageFilters;
  statsPeriod: string;
  onActionTaken?: (itemIds: string[], data: IssueUpdateData) => void;
};

const animationProps: MotionNodeAnimationOptions = {
  initial: {translateY: 8, opacity: 0},
  animate: {translateY: 0, opacity: 1},
  exit: {translateY: -8, opacity: 0},
  transition: {duration: 0.1},
};

function ActionsBarPriority({
  anySelected,
  narrowViewport,
  displayReprocessingActions,
  pageSelected,
  queryCount,
  selectedIdsSet,
  multiSelected,
  allInQuerySelected,
  query,
  handleDelete,
  handleMerge,
  handleUpdate,
  toggleSelectAllVisible,
  selectedProjectSlug,
  onSelectStatsPeriod,
  isSavedSearchesOpen,
  statsPeriod,
  selection,
}: {
  allInQuerySelected: boolean;
  anySelected: boolean;
  displayReprocessingActions: boolean;
  handleDelete: () => void;
  handleMerge: () => void;
  handleUpdate: (data: IssueUpdateData) => void;
  isSavedSearchesOpen: boolean;
  multiSelected: boolean;
  narrowViewport: boolean;
  onSelectStatsPeriod: (period: string) => void;
  pageSelected: boolean;
  query: string;
  queryCount: number;
  selectedIdsSet: Set<string>;
  selectedProjectSlug: string | undefined;
  selection: PageFilters;
  statsPeriod: string;
  toggleSelectAllVisible: () => void;
}) {
  const shouldDisplayActions = anySelected && !narrowViewport;

  return (
    <ActionsBarContainer>
      {!narrowViewport && (
        <Checkbox
          onChange={toggleSelectAllVisible}
          checked={pageSelected || (anySelected ? 'indeterminate' : false)}
          aria-label={pageSelected ? t('Deselect all') : t('Select all')}
          disabled={displayReprocessingActions}
        />
      )}
      {!displayReprocessingActions && (
        <AnimatePresence initial={false} mode="wait">
          {shouldDisplayActions ? (
            <HeaderButtonsWrapper key="actions" {...animationProps}>
              <ActionSet
                queryCount={queryCount}
                query={query}
                issues={selectedIdsSet}
                allInQuerySelected={allInQuerySelected}
                anySelected={anySelected}
                multiSelected={multiSelected}
                selectedProjectSlug={selectedProjectSlug}
                onShouldConfirm={action =>
                  shouldConfirm(action, {pageSelected, selectedIdsSet})
                }
                onDelete={handleDelete}
                onMerge={handleMerge}
                onUpdate={handleUpdate}
              />
            </HeaderButtonsWrapper>
          ) : (
            <IssueStreamHeaderLabel hideDivider>{t('Issue')}</IssueStreamHeaderLabel>
          )}
        </AnimatePresence>
      )}
      <AnimatePresence initial={false} mode="wait">
        {anySelected ? null : (
          <AnimatedHeaderItemsContainer key="headers" {...animationProps}>
            <Headers
              onSelectStatsPeriod={onSelectStatsPeriod}
              selection={selection}
              statsPeriod={statsPeriod}
              isReprocessingQuery={displayReprocessingActions}
              isSavedSearchesOpen={isSavedSearchesOpen}
            />
          </AnimatedHeaderItemsContainer>
        )}
      </AnimatePresence>
    </ActionsBarContainer>
  );
}

export function IssueListActions({
  allResultsVisible,
  displayReprocessingActions,
  groupIds,
  onActionTaken,
  onDelete,
  onSelectStatsPeriod,
  queryCount,
  query,
  selection,
  statsPeriod,
}: IssueListActionsProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const organization = useOrganization();
  const location = useLocation();
  const navigate = useNavigate();
  const sort = decodeScalar(
    location.query.sort,
    DEFAULT_ISSUE_STREAM_SORT
  ) as IssueSortOptions;
  const {setAllInQuerySelected, deselectAll, toggleSelectAllVisible} =
    useIssueSelectionActions();
  const {pageSelected, multiSelected, anySelected, allInQuerySelected, selectedIdsSet} =
    useIssueSelectionSummary();
  const selectedProjectSlug = useMemo(() => {
    const projects = [...selectedIdsSet]
      .map(id => GroupStore.get(id))
      .filter((group): group is Group => !!group?.project)
      .map(group => group.project.slug);
    const uniqProjects = uniq(projects);
    return uniqProjects.length === 1 ? uniqProjects[0] : undefined;
  }, [selectedIdsSet]);
  const [isSavedSearchesOpen] = useSyncedLocalStorageState(
    SAVED_SEARCHES_SIDEBAR_OPEN_LOCALSTORAGE_KEY,
    false
  );
  const theme = useTheme();

  const disableActions = useMedia(
    `(width < ${isSavedSearchesOpen ? theme.breakpoints.xl : theme.breakpoints.md})`
  );

  const numIssues = selectedIdsSet.size;

  function actionSelectedGroups(callback: (itemIds: string[] | undefined) => void) {
    const selectedIds = allInQuerySelected
      ? undefined // undefined means "all"
      : groupIds.filter(itemId => selectedIdsSet.has(itemId));

    callback(selectedIds);

    deselectAll();
  }

  // TODO: Remove issue.category:error filter when merging/deleting performance issues is supported
  // This silently avoids performance issues for bulk actions
  const queryExcludingPerformanceIssues = `${query ?? ''} issue.category:error`;

  function handleDelete() {
    actionSelectedGroups(itemIds => {
      bulkDelete(
        api,
        {
          orgId: organization.slug,
          itemIds,
          query: queryExcludingPerformanceIssues,
          project: selection.projects,
          environment: selection.environments,
          ...selection.datetime,
        },
        {
          complete: () => {
            onDelete();
          },
        }
      );
    });
  }

  function handleMerge() {
    actionSelectedGroups(itemIds => {
      mergeGroups(
        api,
        {
          orgId: organization.slug,
          itemIds,
          query: queryExcludingPerformanceIssues,
          project: selection.projects,
          environment: selection.environments,
          ...selection.datetime,
        },
        {}
      );
      if (selection.projects[0]) {
        const trackProject = ProjectsStore.getById(`${selection.projects[0]}`);
        trackAnalytics('issues_stream.merged', {
          organization,
          project_id: trackProject?.id,
          platform: trackProject?.platform,
          items_merged: allInQuerySelected ? 'all_in_query' : itemIds?.length,
        });
      }
    });
  }

  // If all selected groups are from the same project, return the project ID.
  // Otherwise, return the global selection projects. This is important because
  // resolution in release requires that a project is specified, but the global
  // selection may not have that information if My Projects is selected.
  function getSelectedProjectIds(selectedGroupIds: string[] | undefined) {
    if (!selectedGroupIds) {
      return selection.projects;
    }

    const groups = selectedGroupIds.map(id => GroupStore.get(id));

    const projectIds = new Set(groups.map(group => group?.project?.id).filter(defined));

    if (projectIds.size === 1) {
      return [...projectIds];
    }

    return selection.projects;
  }

  function handleUpdateForItems(itemIds: string[], data: IssueUpdateData) {
    if ('status' in data && data.status === 'ignored') {
      const statusDetails =
        'ignoreCount' in data.statusDetails
          ? 'ignoreCount'
          : 'ignoreDuration' in data.statusDetails
            ? 'ignoreDuration'
            : 'ignoreUserCount' in data.statusDetails
              ? 'ignoreUserCount'
              : undefined;
      trackAnalytics('issues_stream.archived', {
        action_status_details: statusDetails,
        action_substatus: data.substatus,
        organization,
      });
    }
    if ('priority' in data) {
      trackAnalytics('issues_stream.updated_priority', {
        organization,
        priority: data.priority,
      });
    }
    addLoadingMessage(t('Saving changes\u2026'));
    bulkUpdate(
      api,
      {
        orgId: organization.slug,
        itemIds,
        data,
        query,
        environment: selection.environments,
        failSilently: true,
        project: getSelectedProjectIds(itemIds),
        ...selection.datetime,
      },
      {
        success: () => {
          clearIndicators();
          onActionTaken?.(itemIds, data);
          for (const itemId of itemIds) {
            queryClient.invalidateQueries({
              queryKey: [`/organizations/${organization.slug}/issues/${itemId}/`],
              exact: false,
            });
          }
        },
        error: () => {
          clearIndicators();
          addErrorMessage(t('Unable to update issues'));
        },
      }
    );
  }

  function handleUpdate(data: IssueUpdateData) {
    if ('status' in data && data.status === 'ignored') {
      const statusDetails =
        'ignoreCount' in data.statusDetails
          ? 'ignoreCount'
          : 'ignoreDuration' in data.statusDetails
            ? 'ignoreDuration'
            : 'ignoreUserCount' in data.statusDetails
              ? 'ignoreUserCount'
              : undefined;
      trackAnalytics('issues_stream.archived', {
        action_status_details: statusDetails,
        action_substatus: data.substatus,
        organization,
      });
    }

    if ('priority' in data) {
      trackAnalytics('issues_stream.updated_priority', {
        organization,
        priority: data.priority,
      });
    }

    actionSelectedGroups(itemIds => {
      // If `itemIds` is undefined then it means we expect to bulk update all items
      // that match the query.
      //
      // We need to always respect the projects selected in the global selection header:
      // * users with no global views requires a project to be specified
      // * users with global views need to be explicit about what projects the query will run against
      const projectConstraints = {project: getSelectedProjectIds(itemIds)};

      if (itemIds?.length) {
        addLoadingMessage(t('Saving changes\u2026'));
      }

      bulkUpdate(
        api,
        {
          orgId: organization.slug,
          itemIds,
          data,
          query,
          environment: selection.environments,
          failSilently: true,
          ...projectConstraints,
          ...selection.datetime,
        },
        {
          success: () => {
            clearIndicators();
            onActionTaken?.(itemIds ?? [], data);

            // Prevents stale data on issue details
            if (itemIds?.length) {
              for (const itemId of itemIds) {
                queryClient.invalidateQueries({
                  queryKey: [`/organizations/${organization.slug}/issues/${itemId}/`],
                  exact: false,
                });
              }
            } else {
              // If we're doing a full query update we invalidate all issue queries to be safe
              queryClient.invalidateQueries({
                predicate: apiQuery =>
                  typeof apiQuery.queryKey[0] === 'string' &&
                  apiQuery.queryKey[0].startsWith(
                    `/organizations/${organization.slug}/issues/`
                  ),
              });
            }
          },
          error: () => {
            clearIndicators();
            addErrorMessage(t('Unable to update issues'));
          },
        }
      );
    });
  }

  return (
    <Fragment>
      <CommandPaletteSlot name="task">
        <CMDKAction display={{label: t('Issue Feed'), icon: <IconIssues />}} limit={6}>
          <CMDKAction
            display={{label: t('Select all'), icon: <IconStack />}}
            onAction={() => {
              if (!allInQuerySelected) {
                toggleSelectAllVisible();
                setAllInQuerySelected(true);
              }
            }}
          >
            <CMDKAction
              display={{label: t('Resolve'), icon: <IconCheckmark />}}
              onAction={() =>
                handleUpdate({status: GroupStatus.RESOLVED, statusDetails: {}})
              }
            />
            <CMDKAction
              display={{label: t('Archive'), icon: <IconMute />}}
              onAction={() =>
                handleUpdate({
                  status: GroupStatus.IGNORED,
                  statusDetails: {},
                  substatus: GroupSubstatus.ARCHIVED_UNTIL_ESCALATING,
                })
              }
            />
            <CMDKAction display={{label: t('Set Priority'), icon: <IconSliders />}}>
              <CMDKAction
                display={{label: t('High'), icon: <IconCellSignal bars={3} />}}
                onAction={() => handleUpdate({priority: PriorityLevel.HIGH})}
              />
              <CMDKAction
                display={{label: t('Medium'), icon: <IconCellSignal bars={2} />}}
                onAction={() => handleUpdate({priority: PriorityLevel.MEDIUM})}
              />
              <CMDKAction
                display={{label: t('Low'), icon: <IconCellSignal bars={1} />}}
                onAction={() => handleUpdate({priority: PriorityLevel.LOW})}
              />
            </CMDKAction>
            {groupIds.length > 1 && (
              <CMDKAction
                display={{label: t('Merge'), icon: <IconMerge />}}
                onAction={handleMerge}
              />
            )}
          </CMDKAction>
          <CMDKAction display={{label: t('Sort by'), icon: <IconSort />}}>
            {[
              ...(FOR_REVIEW_QUERIES.includes(query || '')
                ? [IssueSortOptions.INBOX]
                : []),
              IssueSortOptions.DATE,
              IssueSortOptions.NEW,
              IssueSortOptions.TRENDS,
              IssueSortOptions.FREQ,
              IssueSortOptions.USER,
            ].map(sortOption => (
              <CMDKAction
                key={sortOption}
                display={{
                  label: getSortLabel(sortOption),
                  icon: sortOption === sort ? <IconCheckmark /> : undefined,
                }}
                onAction={() => {
                  trackAnalytics('issues_stream.sort_changed', {
                    organization,
                    sort: sortOption,
                  });
                  navigate({...location, query: {...location.query, sort: sortOption}});
                }}
              />
            ))}
          </CMDKAction>
        </CMDKAction>
        <CMDKAction display={{label: t('Issues'), icon: <IconIssues />}} limit={6}>
          {groupIds.map(id => {
            const group = GroupStore.get(id);
            if (!group) return null;

            const errorType = group.metadata.type;
            const errorValue = group.metadata.value;
            const labelText = errorType
              ? `${errorType}: ${errorValue ?? ''}`
              : group.title;
            const detailsText = [
              group.project.slug,
              group.assignedTo ? `assigned to ${group.assignedTo.name}` : 'unassigned',
              group.substatus,
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <CMDKAction
                key={id}
                display={{
                  label: (
                    <Container paddingBottom="xs">
                      <Flex align="center" gap="xs">
                        <ErrorLevel level={group.level} />
                        <Text as="span" size="sm" ellipsis>
                          {errorType ? (
                            <Fragment>
                              <Text as="span" size="sm" bold>
                                {errorType}
                              </Text>
                              {errorValue ? `: ${errorValue}` : null}
                            </Fragment>
                          ) : (
                            group.title
                          )}
                        </Text>
                      </Flex>
                    </Container>
                  ),
                  searchableLabel: labelText,
                  details: (
                    <Flex align="center" gap="xs">
                      <ProjectAvatar project={group.project} size={12} />
                      <Text as="span" size="xs" variant="muted" ellipsis>
                        {group.project.slug},{' '}
                        {group.assignedTo
                          ? tct('assigned to: [name]', {name: group.assignedTo.name})
                          : t('Unassigned')}
                        {', '}
                        <TimeSince
                          date={group.lastSeen}
                          disabledAbsoluteTooltip
                          unitStyle="extraShort"
                        />
                        {(group.substatus === GroupSubstatus.ESCALATING ||
                          group.substatus === GroupSubstatus.ONGOING ||
                          group.substatus === GroupSubstatus.REGRESSED) &&
                          `, ${group.substatus}`}
                      </Text>
                    </Flex>
                  ),
                  searchableDetails: detailsText,
                }}
              >
                <CMDKAction
                  display={{label: t('Resolve'), icon: <IconCheckmark />}}
                  onAction={() =>
                    handleUpdateForItems([id], {
                      status: GroupStatus.RESOLVED,
                      statusDetails: {},
                    })
                  }
                />
                <CMDKAction
                  display={{label: t('Archive'), icon: <IconMute />}}
                  onAction={() =>
                    handleUpdateForItems([id], {
                      status: GroupStatus.IGNORED,
                      statusDetails: {},
                      substatus: GroupSubstatus.ARCHIVED_UNTIL_ESCALATING,
                    })
                  }
                />
                <CMDKAction display={{label: t('Set Priority'), icon: <IconSliders />}}>
                  <CMDKAction
                    display={{label: t('High'), icon: <IconCellSignal bars={3} />}}
                    onAction={() =>
                      handleUpdateForItems([id], {priority: PriorityLevel.HIGH})
                    }
                  />
                  <CMDKAction
                    display={{label: t('Medium'), icon: <IconCellSignal bars={2} />}}
                    onAction={() =>
                      handleUpdateForItems([id], {priority: PriorityLevel.MEDIUM})
                    }
                  />
                  <CMDKAction
                    display={{label: t('Low'), icon: <IconCellSignal bars={1} />}}
                    onAction={() =>
                      handleUpdateForItems([id], {priority: PriorityLevel.LOW})
                    }
                  />
                </CMDKAction>
              </CMDKAction>
            );
          })}
        </CMDKAction>
      </CommandPaletteSlot>
      <StickyActions>
        <ActionsBarPriority
          query={query}
          queryCount={queryCount}
          selection={selection}
          statsPeriod={statsPeriod}
          allInQuerySelected={allInQuerySelected}
          pageSelected={pageSelected}
          selectedIdsSet={selectedIdsSet}
          displayReprocessingActions={displayReprocessingActions}
          handleDelete={handleDelete}
          handleMerge={handleMerge}
          handleUpdate={handleUpdate}
          toggleSelectAllVisible={toggleSelectAllVisible}
          multiSelected={multiSelected}
          narrowViewport={disableActions}
          selectedProjectSlug={selectedProjectSlug}
          isSavedSearchesOpen={isSavedSearchesOpen}
          anySelected={anySelected}
          onSelectStatsPeriod={onSelectStatsPeriod}
        />
        {!allResultsVisible && pageSelected && (
          <Alert system variant="warning" showIcon={false}>
            <Flex justify="center" wrap="wrap" gap="md">
              {allInQuerySelected ? (
                queryCount >= BULK_LIMIT ? (
                  tct(
                    'Selected up to the first [count] issues that match this search query.',
                    {
                      count: BULK_LIMIT_STR,
                    }
                  )
                ) : (
                  tct('Selected all [count] issues that match this search query.', {
                    count: queryCount,
                  })
                )
              ) : (
                <Fragment>
                  {tn(
                    '%s issue on this page selected.',
                    '%s issues on this page selected.',
                    numIssues
                  )}

                  <a onClick={() => setAllInQuerySelected(true)}>
                    {queryCount >= BULK_LIMIT
                      ? tct(
                          'Select the first [count] issues that match this search query.',
                          {
                            count: BULK_LIMIT_STR,
                          }
                        )
                      : tct('Select all [count] issues that match this search query.', {
                          count: queryCount,
                        })}
                  </a>
                </Fragment>
              )}
            </Flex>
          </Alert>
        )}
      </StickyActions>
    </Fragment>
  );
}

function shouldConfirm(
  action: ConfirmAction,
  {pageSelected, selectedIdsSet}: {pageSelected: boolean; selectedIdsSet: Set<string>}
) {
  switch (action) {
    case ConfirmAction.RESOLVE:
    case ConfirmAction.UNRESOLVE:
    case ConfirmAction.ARCHIVE:
    case ConfirmAction.SET_PRIORITY:
    case ConfirmAction.UNBOOKMARK: {
      return pageSelected && selectedIdsSet.size > 1;
    }
    case ConfirmAction.BOOKMARK:
      return selectedIdsSet.size > 1;
    case ConfirmAction.MERGE:
    case ConfirmAction.DELETE:
    default:
      return true; // By default, should confirm ...
  }
}

const StickyActions = styled(Sticky)`
  z-index: ${p => p.theme.zIndex.issuesList.stickyHeader};

  /* Remove border radius from the action bar when stuck. Without this there is
   * a small gap where color can peek through. */
  &[data-stuck] > div {
    border-radius: 0;
  }

  border-bottom: 1px solid ${p => p.theme.tokens.border.primary};
  border-top: none;
  border-radius: ${p => p.theme.radius.md} ${p => p.theme.radius.md} 0 0;
`;

const ActionsBarContainer = styled('div')`
  display: grid;
  grid-template-columns: max-content 1fr max-content;
  gap: ${p => p.theme.space.md};
  min-height: 36px;
  padding-top: ${p => p.theme.space.xs};
  padding-bottom: ${p => p.theme.space.xs};
  padding-left: ${p => p.theme.space.xl};
  align-items: center;
  background: ${p => p.theme.tokens.background.secondary};
  border-radius: 6px 6px 0 0;
`;

const HeaderButtonsWrapper = styled(motion.div)`
  @media (min-width: ${p => p.theme.breakpoints.lg}) {
    width: 50%;
  }
  grid-column: 2 / -1;
  display: grid;
  gap: ${p => p.theme.space.xs};
  grid-auto-flow: column;
  justify-content: flex-start;
  white-space: nowrap;
`;

const AnimatedHeaderItemsContainer = styled(motion.div)`
  grid-column: -1;
  display: flex;
  align-items: center;
`;
