import {useEffect} from 'react';
import styled from '@emotion/styled';

import {Alert} from '@sentry/scraps/alert';

import {NotFound} from 'sentry/components/errors/notFound';
import {getEventTimestampInSeconds} from 'sentry/components/events/interfaces/utils';
import {LoadingError} from 'sentry/components/loadingError';
import {LoadingIndicator} from 'sentry/components/loadingIndicator';
import {normalizeDateTimeParams} from 'sentry/components/pageFilters/parse';
import {t} from 'sentry/locale';
import type {Event} from 'sentry/types/event';
import {getApiUrl} from 'sentry/utils/api/getApiUrl';
import {useApiQuery} from 'sentry/utils/queryClient';
import {isPartialSpanOrTraceData} from 'sentry/utils/trace/isOlderThan30Days';
import {useLocation} from 'sentry/utils/useLocation';
import {useNavigate} from 'sentry/utils/useNavigate';
import {useOrganization} from 'sentry/utils/useOrganization';
import {useParams} from 'sentry/utils/useParams';
import {getTraceDetailsUrl} from 'sentry/views/performance/traceDetails/utils';

export default function EventDetails() {
  const organization = useOrganization();
  const location = useLocation();
  const params = useParams<{eventSlug: string}>();
  const eventSlug = typeof params.eventSlug === 'string' ? params.eventSlug.trim() : '';
  const datetimeSelection = normalizeDateTimeParams(location.query);
  const navigate = useNavigate();

  const [projectSlug, eventId] = eventSlug.split(':');
  const {
    data: event,
    isPending,
    error,
  } = useApiQuery<Event>(
    [
      getApiUrl(
        '/organizations/$organizationIdOrSlug/events/$projectIdOrSlug:$eventId/',
        {
          path: {
            organizationIdOrSlug: organization.slug,
            projectIdOrSlug: projectSlug!,
            eventId: eventId!,
          },
        }
      ),
    ],
    {staleTime: 2 * 60 * 1000} // 2 minutes in milliseonds
  );

  const traceTimestamp = getEventTimestampInSeconds(event);
  const isOldTrace = isPartialSpanOrTraceData(traceTimestamp);
  const willRedirectToIssueEvent = !!event?.groupID && !!event?.eventID;

  useEffect(() => {
    if (!event) return;

    if (willRedirectToIssueEvent) {
      navigate({
        pathname: `/organizations/${organization.slug}/issues/${event.groupID}/events/${event.eventID}`,
      });

      return;
    }

    const traceId = event.contexts?.trace?.trace_id;
    if (traceId && !isOldTrace) {
      navigate(
        getTraceDetailsUrl({
          organization,
          traceSlug: traceId,
          dateSelection: datetimeSelection,
          timestamp: traceTimestamp,
          eventId: event.eventID,
          location,
        })
      );
    }
  }, [
    event,
    organization,
    datetimeSelection,
    isOldTrace,
    location,
    navigate,
    traceTimestamp,
    willRedirectToIssueEvent,
  ]);

  if (error) {
    const notFound = error.status === 404;
    const permissionDenied = error.status === 403;

    if (notFound) {
      return <NotFound />;
    }

    if (permissionDenied) {
      return (
        <LoadingError message={t('You do not have permission to view that event.')} />
      );
    }

    return (
      <Alert.Container>
        <Alert variant="danger">{error.message}</Alert>
      </Alert.Container>
    );
  }

  if (event && isOldTrace && !willRedirectToIssueEvent) {
    return (
      <LoadingError message={t('Trace data is only available for the last 30 days')} />
    );
  }

  if (
    isPending ||
    (!isPending && event) // Prevents flash of loading error below once event is loaded successfully
  ) {
    return (
      <LoadingWrapper>
        <LoadingIndicator />
      </LoadingWrapper>
    );
  }

  // This is only reachable if the event hasn't loaded for an unknown reason or
  // we haven't been able to re-route to the correct page
  return <LoadingError message={t('Failed to load the details for the event')} />;
}

const LoadingWrapper = styled('div')`
  display: flex;
  justify-content: center;
  align-items: center;
  margin: auto;
  height: 100%;
`;
