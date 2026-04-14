import {useCallback, useMemo} from 'react';
import {
  skipToken,
  useInfiniteQuery,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import {ALL_ACCESS_PROJECTS} from 'sentry/components/pageFilters/constants';
import {useFetchAllPages} from 'sentry/utils/api/apiFetch';
import {apiOptions} from 'sentry/utils/api/apiOptions';
import {DiscoverDatasets} from 'sentry/utils/discover/types';
import type {FeedbackEvent} from 'sentry/utils/feedback/types';
import {useFeedbackEvents} from 'sentry/utils/replays/hooks/useFeedbackEvents';
import {useReplayProjectSlug} from 'sentry/utils/replays/hooks/useReplayProjectSlug';
import {mapResponseToReplayRecord} from 'sentry/utils/replays/replayDataUtils';
import type {RawReplayError} from 'sentry/utils/replays/types';
import type {RequestError} from 'sentry/utils/requestError/requestError';
import type {ReplayRecord} from 'sentry/views/replays/types';

type Options = {
  /**
   * The organization slug
   */
  orgSlug: string;

  /**
   * The replayId
   */
  replayId: string | undefined;

  /**
   * Default: 50
   * You can override this for testing
   */
  errorsPerPage?: number;

  /**
   * Default: 100
   * You can override this for testing
   */
  segmentsPerPage?: number;
};

interface Result {
  attachmentError: undefined | RequestError[];
  attachments: unknown[];
  errors: RawReplayError[];
  fetchError: undefined | RequestError;
  isError: boolean;
  isPending: boolean;
  onRetry: () => void;
  projectSlug: string | null;
  replayRecord: ReplayRecord | undefined;
  status: 'pending' | 'error' | 'success';
  feedbackEvents?: FeedbackEvent[];
}

/**
 * A react hook to load core replay data over the network.
 *
 * Core replay data includes:
 * 1. The root replay EventTransaction object
 *    - This includes `startTimestamp`, and `tags`
 * 2. RRWeb, Breadcrumb, and Span attachment data
 *    - We make an API call to get a list of segments, each segment contains a
 *      list of attachments
 *    - There may be a few large segments, or many small segments. It depends!
 *      ie: If the replay has many events/errors then there will be many small segments,
 *      or if the page changes rapidly across each pageload, then there will be
 *      larger segments, but potentially fewer of them.
 * 3. Related Event data
 *    - Event details are not part of the attachments payload, so we have to
 *      request them separately
 *
 * This function should stay focused on loading data over the network.
 * Front-end processing, filtering and re-mixing of the different data streams
 * must be delegated to the `ReplayReader` class.
 *
 * @param {orgSlug, replayId} Where to find the root replay event
 * @returns An object representing a unified result of the network requests. Either a single `ReplayReader` data object or fetch errors.
 */
export function useReplayData({
  replayId,
  orgSlug,
  errorsPerPage = 50,
  segmentsPerPage = 100,
}: Options): Result {
  const queryClient = useQueryClient();

  const replayQuery = useQuery({
    ...apiOptions.as<{data: unknown}>()(
      '/organizations/$organizationIdOrSlug/replays/$replayId/',
      {
        path: replayId ? {organizationIdOrSlug: orgSlug, replayId} : skipToken,
        staleTime: Infinity,
      }
    ),
    retry: false,
  });

  const replayRecord = useMemo(
    () =>
      replayQuery.data?.data
        ? mapResponseToReplayRecord(replayQuery.data.data)
        : undefined,
    [replayQuery.data?.data]
  );

  const projectSlug = useReplayProjectSlug({replayRecord});

  // Fetch recording segments in parallel via useQueries.
  // We know the total count upfront (count_segments), so we can compute all
  // cursors and fire requests concurrently.
  const enableAttachments =
    !replayQuery.error &&
    Boolean(replayId) &&
    Boolean(projectSlug) &&
    Boolean(replayRecord);

  const attachmentCursors = useMemo(() => {
    const count = replayRecord?.count_segments ?? 0;
    return new Array(Math.ceil(count / segmentsPerPage))
      .fill(0)
      .map((_, i) => `0:${segmentsPerPage * i}:0`);
  }, [replayRecord?.count_segments, segmentsPerPage]);

  const attachmentsResult = useQueries({
    queries: enableAttachments
      ? attachmentCursors.map(cursor =>
          apiOptions.as<unknown[]>()(
            '/projects/$organizationIdOrSlug/$projectIdOrSlug/replays/$replayId/recording-segments/',
            {
              path: {
                organizationIdOrSlug: orgSlug,
                projectIdOrSlug: projectSlug!,
                replayId: replayId!,
              },
              query: {download: true, per_page: segmentsPerPage, cursor},
              staleTime: Infinity,
            }
          )
        )
      : [],
    combine: results => ({
      attachments: results.flatMap(r => r.data ?? []).flat(),
      errors: results.filter(r => r.error).map(r => r.error as RequestError),
      status: results.some(r => r.status === 'error')
        ? ('error' as const)
        : results.some(r => r.status === 'pending')
          ? ('pending' as const)
          : ('success' as const),
    }),
  });

  // Fetch error events. Uses useInfiniteQuery + useFetchAllPages to
  // automatically paginate through all results.
  const enableErrors = Boolean(replayRecord) && Boolean(projectSlug);

  // Bump finished_at by one second because the ms portion is truncated,
  // while replays-events-meta operates on timestamps with ms.
  const finishedAt = useMemo(() => {
    if (!replayRecord?.finished_at) {
      return '';
    }
    const clone = new Date(replayRecord.finished_at);
    clone.setSeconds(clone.getSeconds() + 1);
    return clone.toISOString();
  }, [replayRecord?.finished_at]);

  const errorsResult = useInfiniteQuery({
    ...apiOptions.asInfinite<{data: RawReplayError[]}>()(
      '/organizations/$organizationIdOrSlug/replays-events-meta/',
      {
        path: enableErrors ? {organizationIdOrSlug: orgSlug} : skipToken,
        query: {
          referrer: 'replay_details',
          dataset: DiscoverDatasets.DISCOVER,
          start: replayRecord?.started_at?.toISOString() ?? '',
          end: finishedAt,
          project: ALL_ACCESS_PROJECTS,
          query: `replayId:[${replayRecord?.id ?? ''}]`,
          per_page: errorsPerPage,
        },
        staleTime: Infinity,
      }
    ),
  });
  useFetchAllPages({result: errorsResult});

  const platformErrorsResult = useInfiniteQuery({
    ...apiOptions.asInfinite<{data: RawReplayError[]}>()(
      '/organizations/$organizationIdOrSlug/replays-events-meta/',
      {
        path: enableErrors ? {organizationIdOrSlug: orgSlug} : skipToken,
        query: {
          referrer: 'replay_details',
          dataset: DiscoverDatasets.ISSUE_PLATFORM,
          start: replayRecord?.started_at?.toISOString() ?? '',
          end: finishedAt,
          project: ALL_ACCESS_PROJECTS,
          query: `replayId:[${replayRecord?.id ?? ''}]`,
          per_page: errorsPerPage,
        },
        staleTime: Infinity,
      }
    ),
  });
  useFetchAllPages({result: platformErrorsResult});

  const {allErrors, feedbackEventIds} = useMemo(() => {
    const discoverErrors = errorsResult.data?.pages.flatMap(page => page.json.data) ?? [];
    const platformErrors =
      platformErrorsResult.data?.pages.flatMap(page => page.json.data) ?? [];
    const errors = discoverErrors.concat(platformErrors);

    const feedbackIds = errors
      ?.filter(error => error?.title.includes('User Feedback'))
      .map(error => error.id);

    return {allErrors: errors, feedbackEventIds: feedbackIds};
  }, [errorsResult.data, platformErrorsResult.data]);

  const {
    feedbackEvents: rawFeedbackEvents,
    isPending: feedbackEventsPending,
    isError: feedbackEventsError,
  } = useFeedbackEvents({
    feedbackEventIds: feedbackEventIds ?? [],
    projectId: replayRecord?.project_id,
  });

  // Stabilize feedbackEvents to prevent unnecessary re-renders.
  // Feedback events can't be updated; only new submissions increase the length.
  const feedbackEvents = useMemo(() => {
    return rawFeedbackEvents;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawFeedbackEvents?.length]);

  const clearQueryCache = useCallback(() => {
    queryClient.invalidateQueries({
      predicate: query => {
        const url = query.queryKey[1];
        if (typeof url !== 'string') {
          return false;
        }
        if (replayId && url.includes(`/replays/${replayId}/`)) {
          return true;
        }
        return url.includes('/replays-events-meta/');
      },
    });
  }, [replayId, queryClient]);

  const allStatuses = [
    replayId ? replayQuery.status : undefined,
    enableAttachments ? attachmentsResult.status : undefined,
    enableErrors ? errorsResult.status : undefined,
    enableErrors ? platformErrorsResult.status : undefined,
  ];

  const isError = allStatuses.includes('error') || feedbackEventsError;
  const isPending = allStatuses.includes('pending') || feedbackEventsPending;
  const status = isError ? 'error' : isPending ? 'pending' : 'success';

  return useMemo(
    () => ({
      attachments: attachmentsResult.attachments,
      errors: allErrors,
      fetchError: (replayQuery.error as RequestError | null) ?? undefined,
      attachmentError:
        attachmentsResult.errors.length > 0 ? attachmentsResult.errors : undefined,
      feedbackEvents,
      isError,
      isPending,
      status,
      onRetry: clearQueryCache,
      projectSlug,
      replayRecord,
    }),
    [
      attachmentsResult.attachments,
      attachmentsResult.errors,
      allErrors,
      replayQuery.error,
      feedbackEvents,
      isError,
      isPending,
      status,
      clearQueryCache,
      projectSlug,
      replayRecord,
    ]
  );
}
