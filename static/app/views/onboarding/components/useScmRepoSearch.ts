import {useMemo, useState} from 'react';

import type {IntegrationRepository, Repository} from 'sentry/types/integrations';
import {getApiUrl} from 'sentry/utils/api/getApiUrl';
import {fetchDataQuery, useInfiniteApiQuery, useQuery} from 'sentry/utils/queryClient';
import {useDebouncedValue} from 'sentry/utils/useDebouncedValue';
import {useOrganization} from 'sentry/utils/useOrganization';

interface ScmRepoSearchResult {
  repos: IntegrationRepository[];
}

export function useScmRepoSearch(integrationId: string, selectedRepo?: Repository) {
  const organization = useOrganization();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);

  const reposUrl = getApiUrl(
    `/organizations/$organizationIdOrSlug/integrations/$integrationId/repos/`,
    {
      path: {
        organizationIdOrSlug: organization.slug,
        integrationId,
      },
    }
  );

  // Browse: paginated, fires on mount. Additional pages are fetched on
  // demand when the user scrolls near the bottom of the dropdown.
  const browseResult = useInfiniteApiQuery<ScmRepoSearchResult>({
    queryKey: [
      {infinite: true, version: 'v1' as const},
      reposUrl,
      {method: 'GET', query: {accessibleOnly: true, paginate: true}},
    ],
    staleTime: 20_000,
  });

  // Search: non-paginated, fires when user types. Uses server-side filtering
  // with accessibleOnly=true to guarantee accurate results.
  const searchResult = useQuery({
    queryKey: [
      reposUrl,
      {method: 'GET', query: {search: debouncedSearch, accessibleOnly: true}},
    ] as const,
    queryFn: async context => {
      return fetchDataQuery<ScmRepoSearchResult>(context);
    },
    retry: 0,
    staleTime: 20_000,
    placeholderData: previousData => previousData,
    enabled: !!debouncedSearch,
  });

  const isSearching = !!debouncedSearch;

  const repos = useMemo(() => {
    if (isSearching) {
      return searchResult.data?.[0]?.repos ?? [];
    }
    return browseResult.data?.pages.flatMap(([data]) => data?.repos ?? []) ?? [];
  }, [isSearching, searchResult.data, browseResult.data]);

  const selectedRepoSlug = selectedRepo?.externalSlug;

  const {reposByIdentifier, dropdownItems} = useMemo(
    () =>
      repos.reduce<{
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
    [repos, selectedRepoSlug]
  );

  return {
    reposByIdentifier,
    dropdownItems,
    isFetching: isSearching ? searchResult.isFetching : browseResult.isFetching,
    isFetchingNextPage: browseResult.isFetchingNextPage,
    isError: isSearching ? searchResult.isError : browseResult.isError,
    hasNextPage: browseResult.hasNextPage,
    fetchNextPage: browseResult.fetchNextPage,
    debouncedSearch,
    setSearch,
  };
}
