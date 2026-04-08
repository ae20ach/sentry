import {useMemo} from 'react';
import {parseAsArrayOf, parseAsString, useQueryStates} from 'nuqs';

import {usePageFilters} from 'sentry/components/pageFilters/usePageFilters';

interface Props {
  staticState?: Record<string, unknown>;
}

/**
 * Provides typical query state for list pages.
 *
 * You can add your own extra or static state
 */
export function useListQueryState({staticState}: Props = {}) {
  const {selection} = usePageFilters();
  const queryState = useMemo(
    () => ({
      end: selection.datetime.end,
      environment: selection.environments,
      project: selection.projects,
      start: selection.datetime.start,
      statsPeriod: selection.datetime.period,
      utc: selection.datetime.utc,
      ...staticState,
    }),
    [selection, staticState]
  );

  return queryState;
}

export function useSearchQueryState() {
  const [queryParams] = useQueryStates({
    field: parseAsArrayOf(parseAsString).withDefault([]),
    query: parseAsString.withDefault(''),
  });
  return queryParams;
}
