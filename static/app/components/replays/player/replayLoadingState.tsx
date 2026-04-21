import {LoadingIndicator} from 'sentry/components/loadingIndicator';
import {ArchivedReplayAlert} from 'sentry/components/replays/alerts/archivedReplayAlert';
import {MissingReplayAlert} from 'sentry/components/replays/alerts/missingReplayAlert';
import {ReplayRequestsThrottledAlert} from 'sentry/components/replays/alerts/replayRequestsThrottledAlert';
import {ReplayProcessingError} from 'sentry/components/replays/replayProcessingError';
import type {useLoadReplayReader} from 'sentry/utils/replays/hooks/useLoadReplayReader';
import type {ReplayReader} from 'sentry/utils/replays/replayReader';
import {useOrganization} from 'sentry/utils/useOrganization';

type ReplayReaderResult = ReturnType<typeof useLoadReplayReader>;

export function ReplayLoadingState({
  children,
  readerResult,
  renderArchived,
  renderError,
  renderThrottled,
  renderLoading,
  renderMissing,
  renderProcessingError,
}: {
  children: (props: {replay: ReplayReader}) => React.ReactNode;
  readerResult: ReplayReaderResult;
  renderArchived?: (results: ReplayReaderResult) => React.ReactNode;
  renderError?: (results: ReplayReaderResult) => React.ReactNode;
  renderLoading?: (results: ReplayReaderResult) => React.ReactNode;
  renderMissing?: (results: ReplayReaderResult) => React.ReactNode;
  renderProcessingError?: (results: ReplayReaderResult) => React.ReactNode;
  renderThrottled?: (results: ReplayReaderResult) => React.ReactNode;
}) {
  const organization = useOrganization();

  const throttledErrorExists =
    readerResult.fetchError?.status === 429 ||
    readerResult.attachmentError?.find(error => error.status === 429);

  if (throttledErrorExists) {
    return renderThrottled ? (
      renderThrottled(readerResult)
    ) : (
      <ReplayRequestsThrottledAlert />
    );
  }
  if (readerResult.fetchError) {
    return renderError ? (
      renderError(readerResult)
    ) : (
      <MissingReplayAlert orgSlug={organization.slug} />
    );
  }
  if (readerResult.replayRecord?.is_archived) {
    return renderArchived ? renderArchived(readerResult) : <ArchivedReplayAlert />;
  }
  if (readerResult.isPending) {
    return renderLoading ? renderLoading(readerResult) : <LoadingIndicator />;
  }
  if (!readerResult.replay) {
    return renderMissing ? (
      renderMissing(readerResult)
    ) : (
      <MissingReplayAlert orgSlug={organization.slug} />
    );
  }

  if (readerResult.replay.hasProcessingErrors()) {
    return renderProcessingError ? (
      renderProcessingError(readerResult)
    ) : (
      <ReplayProcessingError />
    );
  }
  return children({replay: readerResult.replay});
}
