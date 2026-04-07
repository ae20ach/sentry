import {useMemo} from 'react';

import {usePageFilters} from 'sentry/components/pageFilters/usePageFilters';
import type {TagCollection} from 'sentry/types/group';
import {defined} from 'sentry/utils';
import {keepPreviousData, useQuery} from 'sentry/utils/queryClient';
import {
  makeTraceItemAttributeKeysQueryOptions,
  useGetTraceItemAttributeKeys,
} from 'sentry/views/explore/hooks/useGetTraceItemAttributeKeys';
import type {UseTraceItemAttributeBaseProps} from 'sentry/views/explore/types';

interface UseTraceItemAttributeKeysProps extends UseTraceItemAttributeBaseProps {
  enabled?: boolean;
  projectIds?: Array<string | number>;
  query?: string;
  search?: string;
}

export function useTraceItemAttributeKeys({
  enabled,
  type,
  traceItemType,
  projects,
  projectIds: explicitProjectIds,
  query,
  search,
}: UseTraceItemAttributeKeysProps) {
  const {selection} = usePageFilters();
  const normalizedSearch = search || undefined;

  const projectIds =
    explicitProjectIds ??
    (defined(projects) ? projects.map(project => project.id) : selection.projects);

  const queryOptions = useMemo(() => {
    return makeTraceItemAttributeKeysQueryOptions({
      traceItemType,
      type,
      datetime: selection.datetime,
      projectIds,
      query,
    });
  }, [selection, traceItemType, type, projectIds, query]);

  const queryKey = useMemo(
    () => ['use-trace-item-attribute-keys', queryOptions],
    [queryOptions]
  );

  const getTraceItemAttributeKeys = useGetTraceItemAttributeKeys({
    traceItemType,
    type,
    projectIds,
    query,
  });

  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const {data, isFetching, isPending, error} = useQuery({
    enabled,
    placeholderData: keepPreviousData,
    queryKey: [...queryKey, normalizedSearch],
    queryFn: () => getTraceItemAttributeKeys(normalizedSearch),
  });

  return {
    attributes: data,
    error,
    isLoading: isFetching && (isPending || normalizedSearch !== undefined),
  };
}

/**
 * We want to remove attributes that have tag wrapper in some cases (eg. datascrubbing attribute field)
 * As they are not valid in some contexts (eg. relay event selectors).
 */
export function elideTagBasedAttributes(attributes: TagCollection) {
  return Object.fromEntries(
    Object.entries(attributes).filter(([key]) => !key.startsWith('tags['))
  );
}
