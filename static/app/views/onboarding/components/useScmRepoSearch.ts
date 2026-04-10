import {useMemo, useState} from 'react';

import type {IntegrationRepository, Repository} from 'sentry/types/integrations';
import {getApiUrl} from 'sentry/utils/api/getApiUrl';
import {fetchDataQuery, useInfiniteApiQuery, useQuery} from 'sentry/utils/queryClient';
import {useDebouncedValue} from 'sentry/utils/useDebouncedValue';
import {useOrganization} from 'sentry/utils/useOrganization';

interface ScmRepoSearchResult {
  repos: IntegrationRepository[];
}

const PER_PAGE = 100;

export function useScmRepoSearch(integrationId: string, selectedRepo?: Repository) {
  const organization = useOrganization();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);

  const reposUrl = getApiUrl(
    '/organizations/$organizationIdOrSlug/integrations/$integrationId/repos/',
    {
      path: {
        organizationIdOrSlug: organization.slug,
        integrationId,
      },
    }
  );

  // Browse: paginated fetch that fires on mount, pre-populates the dropdown
  const browseQuery = useInfiniteApiQuery<ScmRepoSearchResult>({
    queryKey: [{infinite: true, version: 'v1'}, reposUrl, {query: {per_page: PER_PAGE}}],
    staleTime: 30_000,
  });

  // Search: fires when user types, returns full filtered result set
  const searchQuery = useQuery({
    queryKey: [
      reposUrl,
      {method: 'GET', query: {search: debouncedSearch, accessibleOnly: true}},
    ] as const,
    queryFn: async context => {
      return fetchDataQuery<ScmRepoSearchResult>(context);
    },
    retry: 0,
    staleTime: 20_000,
    placeholderData: previousData => (debouncedSearch ? previousData : undefined),
    enabled: !!debouncedSearch,
  });

  const isSearching = !!debouncedSearch;

  // Flatten paginated browse results into a single list
  const browseRepos = useMemo(
    () => browseQuery.data?.pages.flatMap(page => page[0].repos) ?? [],
    [browseQuery.data]
  );

  const searchRepos = useMemo(
    () => searchQuery.data?.[0]?.repos ?? [],
    [searchQuery.data]
  );

  const activeRepos = isSearching ? searchRepos : browseRepos;

  const selectedRepoSlug = selectedRepo?.externalSlug;

  const {reposByIdentifier, dropdownItems} = useMemo(
    () =>
      activeRepos.reduce<{
        dropdownItems: Array<{
          disabled: boolean;
          label: string;
          value: string;
        }>;
        reposByIdentifier: Map<string, IntegrationRepository>;
      }>(
        (acc, repo) => {
          acc.reposByIdentifier.set(repo.identifier, repo);
          acc.dropdownItems.push({
            value: repo.identifier,
            label: repo.name,
            disabled: repo.identifier === selectedRepoSlug,
          });
          return acc;
        },
        {
          reposByIdentifier: new Map(),
          dropdownItems: [],
        }
      ),
    [activeRepos, selectedRepoSlug]
  );

  return {
    reposByIdentifier,
    dropdownItems,
    isFetching: isSearching ? searchQuery.isFetching : browseQuery.isFetching,
    isError: isSearching ? searchQuery.isError : browseQuery.isError,
    debouncedSearch,
    setSearch,
    // Infinite scroll support
    hasNextPage: !isSearching && (browseQuery.hasNextPage ?? false),
    fetchNextPage: browseQuery.fetchNextPage,
    isFetchingNextPage: browseQuery.isFetchingNextPage,
  };
}
