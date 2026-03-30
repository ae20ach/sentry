import styled from '@emotion/styled';

import {FeedbackButton} from 'sentry/components/feedbackButton/feedbackButton';
import {useFeedbackSDKIntegration} from 'sentry/components/feedbackButton/useFeedbackSDKIntegration';
import {t} from 'sentry/locale';
import {useHasPageFrameFeature} from 'sentry/views/navigation/useHasPageFrameFeature';

export function DynamicAlertsFeedbackButton() {
  const hasPageFrame = useHasPageFrameFeature();
  const {feedback} = useFeedbackSDKIntegration();

  if (hasPageFrame || !feedback) {
    return null;
  }

  return (
    <ButtonContainer>
      <FeedbackButton
        feedbackOptions={{
          formTitle: t('Anomaly Detection Feedback'),
          messagePlaceholder: t(
            'How can we make alerts using anomaly detection more useful?'
          ),
          tags: {
            ['feedback.source']: 'dynamic_thresholding',
            ['feedback.owner']: 'ml-ai',
          },
        }}
        size="xs"
      />
    </ButtonContainer>
  );
}

const ButtonContainer = styled('div')`
  padding: 8px 0px;
`;
