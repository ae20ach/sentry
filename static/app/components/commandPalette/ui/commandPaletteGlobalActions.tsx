import {Fragment, useState} from 'react';
import {SentryGlobalSearch} from '@sentry-internal/global-search';
import DOMPurify from 'dompurify';

import {ProjectAvatar} from '@sentry/scraps/avatar';

import {addLoadingMessage, addSuccessMessage} from 'sentry/actionCreators/indicator';
import {openInviteMembersModal} from 'sentry/actionCreators/modal';
import type {
  CMDKQueryOptions,
  CommandPaletteAsyncResult,
} from 'sentry/components/commandPalette/types';
import {
  DSN_PATTERN,
  getDsnNavTargets,
} from 'sentry/components/search/sources/dsnLookupUtils';
import type {DsnLookupResponse} from 'sentry/components/search/sources/dsnLookupUtils';
import {
  IconAdd,
  IconCompass,
  IconDashboard,
  IconDiscord,
  IconDocs,
  IconGithub,
  IconGraph,
  IconIssues,
  IconLock,
  IconOpen,
  IconPanel,
  IconSearch,
  IconSettings,
  IconStar,
  IconUser,
} from 'sentry/icons';
import {t} from 'sentry/locale';
import {apiOptions} from 'sentry/utils/api/apiOptions';
import {queryOptions} from 'sentry/utils/queryClient';
import {useMutateUserOptions} from 'sentry/utils/useMutateUserOptions';
import {useOrganization} from 'sentry/utils/useOrganization';
import {useProjects} from 'sentry/utils/useProjects';
import {useGetStarredDashboards} from 'sentry/views/dashboards/hooks/useGetStarredDashboards';
import {AGENTS_LANDING_SUB_PATH} from 'sentry/views/insights/pages/agents/settings';
import {BACKEND_LANDING_SUB_PATH} from 'sentry/views/insights/pages/backend/settings';
import {FRONTEND_LANDING_SUB_PATH} from 'sentry/views/insights/pages/frontend/settings';
import {MCP_LANDING_SUB_PATH} from 'sentry/views/insights/pages/mcp/settings';
import {MOBILE_LANDING_SUB_PATH} from 'sentry/views/insights/pages/mobile/settings';
import {ISSUE_TAXONOMY_CONFIG} from 'sentry/views/issueList/taxonomies';
import {useStarredIssueViews} from 'sentry/views/navigation/secondary/sections/issues/issueViews/useStarredIssueViews';
import {useSecondaryNavigation} from 'sentry/views/navigation/secondaryNavigationContext';
import {getUserOrgNavigationConfiguration} from 'sentry/views/settings/organization/userOrgNavigationConfiguration';

import {CMDKAction, CMDKGroup} from './cmdk';
import {CommandPaletteSlot} from './commandPalette';

const DSN_ICONS: React.ReactElement[] = [
  <IconIssues key="issues" />,
  <IconSettings key="settings" />,
];

const helpSearch = new SentryGlobalSearch(['docs', 'develop']);

function dsnLookupResource(organizationSlug: string) {
  return (query: string): CMDKQueryOptions =>
    queryOptions({
      ...apiOptions.as<DsnLookupResponse>()(
        '/organizations/$organizationIdOrSlug/dsn-lookup/',
        {
          path: {organizationIdOrSlug: organizationSlug},
          query: {dsn: query},
          staleTime: 30_000,
        }
      ),
      enabled: DSN_PATTERN.test(query),
      select: data =>
        getDsnNavTargets(data.json).map((target, i) => ({
          to: target.to,
          display: {
            label: target.label,
            details: target.description,
            icon: DSN_ICONS[i],
          },
          keywords: [query],
        })),
    });
}

function helpSearchResource(search: SentryGlobalSearch) {
  return (query: string): CMDKQueryOptions =>
    queryOptions({
      queryKey: ['command-palette-help-search', query, search],
      queryFn: () =>
        search.query(
          query,
          {searchAllIndexes: true},
          {analyticsTags: ['source:command-palette']}
        ),
      select: data => {
        const results: CommandPaletteAsyncResult[] = [];
        for (const index of data) {
          for (const hit of index.hits.slice(0, 3)) {
            results.push({
              display: {
                label: DOMPurify.sanitize(hit.title ?? '', {ALLOWED_TAGS: []}),
                details: DOMPurify.sanitize(
                  hit.context?.context1 ?? hit.context?.context2 ?? '',
                  {ALLOWED_TAGS: []}
                ),
                icon: <IconDocs />,
              },
              keywords: [hit.context?.context1, hit.context?.context2].filter(
                (v): v is string => typeof v === 'string'
              ),
              onAction: () => window.open(hit.url, '_blank', 'noreferrer'),
            });
          }
        }
        return results;
      },
    });
}

function renderAsyncResult(item: CommandPaletteAsyncResult, index: number) {
  if ('to' in item) {
    return <CMDKAction key={index} display={item.display} to={item.to} />;
  }
  if ('onAction' in item) {
    return <CMDKAction key={index} display={item.display} onAction={item.onAction} />;
  }
  return null;
}

/**
 * Registers globally-available actions into the CMDK collection via JSX.
 * Must be mounted inside CMDKProvider (which requires CommandPaletteStateProvider).
 */
export function GlobalCommandPaletteActions() {
  const organization = useOrganization();
  const hasDsnLookup = organization.features.includes('cmd-k-dsn-lookup');
  const {projects} = useProjects();
  const {mutateAsync: mutateUserOptions} = useMutateUserOptions();
  const {starredViews} = useStarredIssueViews();
  const {data: starredDashboards = []} = useGetStarredDashboards();
  const {view, setView} = useSecondaryNavigation();
  const [search] = useState(() => helpSearch);

  const slug = organization.slug;
  const prefix = `/organizations/${slug}`;

  return (
    <CommandPaletteSlot name="global">
      <Fragment>
        {/* ── Navigation ── */}
        <CMDKGroup display={{label: t('Go to...')}}>
          <CMDKGroup display={{label: t('Issues'), icon: <IconIssues />}}>
            <CMDKAction display={{label: t('Feed')}} to={`${prefix}/issues/`} />
            {Object.values(ISSUE_TAXONOMY_CONFIG).map(config => (
              <CMDKAction
                key={config.key}
                display={{label: config.label}}
                to={`${prefix}/issues/${config.key}/`}
              />
            ))}
            <CMDKAction
              display={{label: t('User Feedback')}}
              to={`${prefix}/issues/feedback/`}
            />
            <CMDKAction
              display={{label: t('All Views')}}
              to={`${prefix}/issues/views/`}
            />
            {starredViews.map(starredView => (
              <CMDKAction
                key={starredView.id}
                display={{label: starredView.label, icon: <IconStar />}}
                to={`${prefix}/issues/views/${starredView.id}/`}
              />
            ))}
          </CMDKGroup>

          <CMDKGroup display={{label: t('Explore'), icon: <IconCompass />}}>
            <CMDKAction display={{label: t('Traces')}} to={`${prefix}/explore/traces/`} />
            {organization.features.includes('ourlogs-enabled') && (
              <CMDKAction display={{label: t('Logs')}} to={`${prefix}/explore/logs/`} />
            )}
            <CMDKAction
              display={{label: t('Discover')}}
              to={`${prefix}/explore/discover/homepage/`}
            />
            {organization.features.includes('profiling') && (
              <CMDKAction
                display={{label: t('Profiles')}}
                to={`${prefix}/explore/profiling/`}
              />
            )}
            {organization.features.includes('session-replay-ui') && (
              <CMDKAction
                display={{label: t('Replays')}}
                to={`${prefix}/explore/replays/`}
              />
            )}
            <CMDKAction
              display={{label: t('Releases')}}
              to={`${prefix}/explore/releases/`}
            />
            <CMDKAction
              display={{label: t('All Queries')}}
              to={`${prefix}/explore/saved-queries/`}
            />
          </CMDKGroup>

          <CMDKGroup display={{label: t('Dashboards'), icon: <IconDashboard />}}>
            <CMDKAction
              display={{label: t('All Dashboards')}}
              to={`${prefix}/dashboards/`}
            />
            <CMDKGroup display={{label: t('Starred Dashboards'), icon: <IconStar />}}>
              {starredDashboards.map(dashboard => (
                <CMDKAction
                  key={dashboard.id}
                  display={{label: dashboard.title, icon: <IconStar />}}
                  to={`${prefix}/dashboard/${dashboard.id}/`}
                />
              ))}
            </CMDKGroup>
          </CMDKGroup>

          {organization.features.includes('performance-view') && (
            <CMDKGroup display={{label: t('Insights'), icon: <IconGraph type="area" />}}>
              <CMDKAction
                display={{label: t('Frontend')}}
                to={`${prefix}/insights/${FRONTEND_LANDING_SUB_PATH}/`}
              />
              <CMDKAction
                display={{label: t('Backend')}}
                to={`${prefix}/insights/${BACKEND_LANDING_SUB_PATH}/`}
              />
              <CMDKAction
                display={{label: t('Mobile')}}
                to={`${prefix}/insights/${MOBILE_LANDING_SUB_PATH}/`}
              />
              <CMDKAction
                display={{label: t('Agents')}}
                to={`${prefix}/insights/${AGENTS_LANDING_SUB_PATH}/`}
              />
              <CMDKAction
                display={{label: t('MCP')}}
                to={`${prefix}/insights/${MCP_LANDING_SUB_PATH}/`}
              />
              <CMDKAction
                display={{label: t('Crons')}}
                to={`${prefix}/insights/crons/`}
              />
              {organization.features.includes('uptime') && (
                <CMDKAction
                  display={{label: t('Uptime')}}
                  to={`${prefix}/insights/uptime/`}
                />
              )}
              <CMDKAction
                display={{label: t('All Projects')}}
                to={`${prefix}/insights/projects/`}
              />
            </CMDKGroup>
          )}

          <CMDKGroup display={{label: t('Settings'), icon: <IconSettings />}}>
            {getUserOrgNavigationConfiguration().flatMap(section =>
              section.items.map(item => (
                <CMDKAction
                  key={item.path}
                  display={{label: item.title}}
                  to={item.path}
                />
              ))
            )}
          </CMDKGroup>

          <CMDKGroup display={{label: t('Project Settings'), icon: <IconSettings />}}>
            {projects.map(project => (
              <CMDKAction
                key={project.id}
                display={{
                  label: project.name,
                  icon: <ProjectAvatar project={project} size={16} />,
                }}
                to={`/settings/${slug}/projects/${project.slug}/`}
              />
            ))}
          </CMDKGroup>
        </CMDKGroup>

        {/* ── Add / Create ── */}
        <CMDKGroup display={{label: t('Add')}}>
          <CMDKAction
            display={{label: t('Create Dashboard'), icon: <IconAdd />}}
            keywords={[t('add dashboard')]}
            to={`${prefix}/dashboards/new/`}
          />
          <CMDKAction
            display={{label: t('Create Alert'), icon: <IconAdd />}}
            keywords={[t('add alert')]}
            to={`${prefix}/issues/alerts/wizard/`}
          />
          <CMDKAction
            display={{label: t('Create Project'), icon: <IconAdd />}}
            keywords={[t('add project')]}
            to={`${prefix}/projects/new/`}
          />
          <CMDKAction
            display={{label: t('Invite Members'), icon: <IconUser />}}
            keywords={[t('team invite')]}
            onAction={openInviteMembersModal}
          />
        </CMDKGroup>

        {/* ── DSN Lookup ── */}
        <CMDKGroup display={{label: t('DSN')}} keywords={[t('client keys')]}>
          <CMDKGroup
            display={{label: t('Project DSN Keys'), icon: <IconLock locked />}}
            keywords={[t('client keys'), t('dsn keys')]}
          >
            {projects.map(project => (
              <CMDKAction
                key={project.id}
                display={{
                  label: project.name,
                  icon: <ProjectAvatar project={project} size={16} />,
                }}
                keywords={[`dsn ${project.name}`, `dsn ${project.slug}`]}
                to={`/settings/${slug}/projects/${project.slug}/keys/`}
              />
            ))}
          </CMDKGroup>
          {hasDsnLookup && (
            <CMDKGroup
              display={{
                label: t('Reverse DSN lookup'),
                details: t(
                  'Paste a DSN into the search bar to find the project it belongs to.'
                ),
                icon: <IconSearch />,
              }}
              resource={dsnLookupResource(slug)}
            >
              {(data: CommandPaletteAsyncResult[]) =>
                data.map((item, i) => renderAsyncResult(item, i))
              }
            </CMDKGroup>
          )}
        </CMDKGroup>

        {/* ── Help ── */}
        <CMDKGroup display={{label: t('Help')}}>
          <CMDKAction
            display={{label: t('Open Documentation'), icon: <IconDocs />}}
            onAction={() => window.open('https://docs.sentry.io', '_blank', 'noreferrer')}
          />
          <CMDKAction
            display={{label: t('Join Discord'), icon: <IconDiscord />}}
            onAction={() =>
              window.open('https://discord.gg/sentry', '_blank', 'noreferrer')
            }
          />
          <CMDKAction
            display={{label: t('Open GitHub Repository'), icon: <IconGithub />}}
            onAction={() =>
              window.open('https://github.com/getsentry/sentry', '_blank', 'noreferrer')
            }
          />
          <CMDKAction
            display={{label: t('View Changelog'), icon: <IconOpen />}}
            onAction={() =>
              window.open('https://sentry.io/changelog/', '_blank', 'noreferrer')
            }
          />
          <CMDKGroup
            display={{label: t('Search Results')}}
            resource={helpSearchResource(search)}
          >
            {(data: CommandPaletteAsyncResult[]) =>
              data.map((item, i) => renderAsyncResult(item, i))
            }
          </CMDKGroup>
        </CMDKGroup>

        {/* ── Interface ── */}
        <CMDKGroup display={{label: t('Interface')}}>
          <CMDKAction
            display={{
              label:
                view === 'expanded'
                  ? t('Collapse Navigation Sidebar')
                  : t('Expand Navigation Sidebar'),
              icon: <IconPanel direction={view === 'expanded' ? 'left' : 'right'} />,
            }}
            onAction={() => setView(view === 'expanded' ? 'collapsed' : 'expanded')}
          />
          <CMDKGroup display={{label: t('Change Color Theme'), icon: <IconSettings />}}>
            <CMDKAction
              display={{label: t('System')}}
              onAction={async () => {
                addLoadingMessage(t('Saving…'));
                await mutateUserOptions({theme: 'system'});
                addSuccessMessage(t('Theme preference saved: System'));
              }}
            />
            <CMDKAction
              display={{label: t('Light')}}
              onAction={async () => {
                addLoadingMessage(t('Saving…'));
                await mutateUserOptions({theme: 'light'});
                addSuccessMessage(t('Theme preference saved: Light'));
              }}
            />
            <CMDKAction
              display={{label: t('Dark')}}
              onAction={async () => {
                addLoadingMessage(t('Saving…'));
                await mutateUserOptions({theme: 'dark'});
                addSuccessMessage(t('Theme preference saved: Dark'));
              }}
            />
          </CMDKGroup>
        </CMDKGroup>
      </Fragment>
    </CommandPaletteSlot>
  );
}
