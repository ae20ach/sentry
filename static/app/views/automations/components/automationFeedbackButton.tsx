import {FeedbackButton} from 'sentry/components/feedbackButton/feedbackButton';
import {t} from 'sentry/locale';
import {useHasPageFrameFeature} from 'sentry/views/navigation/useHasPageFrameFeature';

export function AutomationFeedbackButton() {
  const hasPageFrame = useHasPageFrameFeature();
  if (hasPageFrame) return null;
  return (
    <FeedbackButton
      size="sm"
      feedbackOptions={{
        messagePlaceholder: t('How can we improve the alerts experience?'),
        tags: {
          ['feedback.source']: 'automations',
          ['feedback.owner']: 'aci',
        },
      }}
    >
      {t('Feedback')}
    </FeedbackButton>
  );
}
