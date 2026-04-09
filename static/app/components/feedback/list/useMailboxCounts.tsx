import {useMemo} from 'react';

import {useFeedbackQueryKeys} from 'sentry/components/feedback/useFeedbackQueryKeys';
import type {Organization} from 'sentry/types/organization';
import {getApiUrl} from 'sentry/utils/api/getApiUrl';
import {coaleseIssueStatsPeriodQuery} from 'sentry/utils/feedback/coaleseIssueStatsPeriodQuery';
import {useApiQuery, type UseApiQueryResult} from 'sentry/utils/queryClient';
import type {RequestError} from 'sentry/utils/requestError/requestError';
import {
  useListQueryState,
  useSearchQueryState,
} from 'sentry/utils/url/useSentryQueryState';

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
  const {listHeadTime} = useFeedbackQueryKeys();

  const listQueryState = useListQueryState();
  const searchQueryState = useSearchQueryState();

  const MAILBOX = useMemo(
    () => ({
      unresolved:
        'issue.category:feedback is:unassigned is:unresolved ' + searchQueryState.query,
      resolved:
        'issue.category:feedback is:unassigned is:resolved ' + searchQueryState.query,
      ignored:
        'issue.category:feedback is:unassigned is:ignored ' + searchQueryState.query,
    }),
    [searchQueryState.query]
  );

  const queryViewWithStatsPeriod = useMemo(() => {
    // We should fetch the counts while taking the query into account
    const mailboxQuery = Object.values(MAILBOX);

    return {
      ...listQueryState,
      ...searchQueryState,
      queryReferrer: 'feedback_mailbox_count',
      query: mailboxQuery,
      ...coaleseIssueStatsPeriodQuery({
        listHeadTime,
        prefetch: false,
        statsPeriod: listQueryState.statsPeriod,
      }),
    };
  }, [listHeadTime, listQueryState, searchQueryState, MAILBOX]);

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
