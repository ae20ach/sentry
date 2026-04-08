import {useMailbox} from 'sentry/components/feedback/useMailbox';
import type {Organization} from 'sentry/types/organization';
import {apiOptions} from 'sentry/utils/api/apiOptions';
import {coaleseIssueStatsPeriodQuery} from 'sentry/utils/feedback/coaleseIssueStatsPeriodQuery';
import type {FeedbackIssueListItem} from 'sentry/utils/feedback/types';
import {
  useListQueryState,
  useSearchQueryState,
} from 'sentry/utils/url/useSentryQueryState';

interface Props {
  listHeadTime: number;
  organization: Organization;
}

const PER_PAGE = 25;

export function usePrefetchFeedbackListQueryOptions({listHeadTime, organization}: Props) {
  const [mailbox] = useMailbox();

  const listQueryState = useListQueryState();
  const searchQueryState = useSearchQueryState();

  const query = {
    ...listQueryState,
    ...searchQueryState,
    queryReferrer: 'feedback_list_page' as const,
    ...coaleseIssueStatsPeriodQuery({
      listHeadTime,
      prefetch: true,
      statsPeriod: listQueryState.statsPeriod,
    }),
    expand: [],
    collapse: ['stats', 'unhandled'],
    shortIdLookup: 0,
    query: `issue.category:feedback status:${mailbox} ${searchQueryState.query}`,
  };

  return apiOptions.as<FeedbackIssueListItem[]>()(
    '/organizations/$organizationIdOrSlug/issues/',
    {
      path: {organizationIdOrSlug: organization.slug},
      staleTime: 0,
      query,
    }
  );
}

export function useInfiniteFeedbackListQueryOptions({listHeadTime, organization}: Props) {
  const [mailbox] = useMailbox();

  const listQueryState = useListQueryState();
  const searchQueryState = useSearchQueryState();

  const query = {
    ...listQueryState,
    ...searchQueryState,
    limit: PER_PAGE,
    queryReferrer: 'feedback_list_page' as const,
    ...coaleseIssueStatsPeriodQuery({
      listHeadTime,
      prefetch: false,
      statsPeriod: listQueryState.statsPeriod,
    }),
    expand: [
      'pluginActions', // Gives us plugin actions available
      'pluginIssues', // Gives us plugin issues available
      'integrationIssues', // Gives us integration issues available
      'sentryAppIssues', // Gives us Sentry app issues available
      'latestEventHasAttachments', // Gives us whether the feedback has screenshots
    ],
    shortIdLookup: 0,
    query: `issue.category:feedback status:${mailbox} ${searchQueryState.query}`,
  };

  return apiOptions.asInfinite<FeedbackIssueListItem[]>()(
    '/organizations/$organizationIdOrSlug/issues/',
    {
      path: {organizationIdOrSlug: organization.slug},
      staleTime: 0,
      query,
    }
  );
}
