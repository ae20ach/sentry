import {useMemo} from 'react';

import {useFeedbackQueryKeys} from 'sentry/components/feedback/useFeedbackQueryKeys';
import type {Organization} from 'sentry/types/organization';
import {getApiUrl} from 'sentry/utils/api/getApiUrl';
import {coaleseIssueStatsPeriodQuery} from 'sentry/utils/feedback/coaleseIssueStatsPeriodQuery';
import {useApiQuery, type UseApiQueryResult} from 'sentry/utils/queryClient';
import {decodeScalar} from 'sentry/utils/queryString';
import type {RequestError} from 'sentry/utils/requestError/requestError';
import {
  useListQueryState,
  useSearchQueryState,
} from 'sentry/utils/url/useSentryQueryState';
import {useLocation} from 'sentry/utils/useLocation';

interface Props {
  organization: Organization;
}

// The keys here are the different search terms that we're using:
type ApiReturnType = Record<string, number>;

// This is what the hook consumer gets:
type HookReturnType = {
  ignored: number;
  resolved: number;
  unresolved: number;
};

export function useMailboxCounts({
  organization,
}: Props): UseApiQueryResult<HookReturnType, RequestError> {
  const location = useLocation();
  const locationQuery = decodeScalar(location.query.query, '');
  const {listHeadTime} = useFeedbackQueryKeys();

  // We should fetch the counts while taking the query into account
  const MAILBOX: Record<keyof HookReturnType, keyof ApiReturnType> = {
    unresolved: 'issue.category:feedback is:unassigned is:unresolved ' + locationQuery,
    resolved: 'issue.category:feedback is:unassigned is:resolved ' + locationQuery,
    ignored: 'issue.category:feedback is:unassigned is:ignored ' + locationQuery,
  };

  const mailboxQuery = Object.values(MAILBOX);

  const listQueryState = useListQueryState();
  const searchQueryState = useSearchQueryState();

  const queryViewWithStatsPeriod = useMemo(
    () => ({
      ...listQueryState,
      ...searchQueryState,
      queryReferrer: 'feedback_mailbox_count',
      query: mailboxQuery,
      ...coaleseIssueStatsPeriodQuery({
        listHeadTime,
        prefetch: false,
        statsPeriod: listQueryState.statsPeriod,
      }),
    }),
    [listHeadTime, listQueryState, searchQueryState, mailboxQuery]
  );

  const result = useApiQuery<ApiReturnType>(
    [
      getApiUrl('/organizations/$organizationIdOrSlug/issues-count/', {
        path: {
          organizationIdOrSlug: organization.slug,
        },
      }),
      {query: queryViewWithStatsPeriod},
    ],
    {
      staleTime: 1_000,
      refetchInterval: 30_000,
    }
  );

  return useMemo(
    () =>
      ({
        ...result,
        data: result.data
          ? {
              unresolved: result.data[MAILBOX.unresolved],
              resolved: result.data[MAILBOX.resolved],
              ignored: result.data[MAILBOX.ignored],
            }
          : undefined,
      }) as UseApiQueryResult<HookReturnType, RequestError>,
    [result, MAILBOX.ignored, MAILBOX.resolved, MAILBOX.unresolved]
  );
}
