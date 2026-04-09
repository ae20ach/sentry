import tourAlert from 'sentry-images/spot/performance-tour-alert.svg';
import tourCorrelate from 'sentry-images/spot/performance-tour-correlate.svg';
import tourMetrics from 'sentry-images/spot/performance-tour-metrics.svg';
import tourTrace from 'sentry-images/spot/performance-tour-trace.svg';

import {LinkButton} from '@sentry/scraps/button';
import {Flex} from '@sentry/scraps/layout';

import type {ModalRenderProps} from 'sentry/actionCreators/modal';
import {FeatureShowcase, useShowcaseContext} from 'sentry/components/featureShowcase';
import {t} from 'sentry/locale';

export const PERFORMANCE_SETUP_DOCS_URL =
  'https://docs.sentry.io/performance-monitoring/getting-started/';

function SetupFooter() {
  const {close} = useShowcaseContext();
  return (
    <Flex justify="end">
      <LinkButton
        external
        href={PERFORMANCE_SETUP_DOCS_URL}
        onClick={close}
        priority="primary"
        aria-label={t('Complete tour')}
      >
        {t('Start Setup')}
      </LinkButton>
    </Flex>
  );
}

const docsLink = (
  <LinkButton external href={PERFORMANCE_SETUP_DOCS_URL}>
    {t('Setup')}
  </LinkButton>
);

interface PerformanceFeatureShowcaseProps extends ModalRenderProps {
  onClose?: (step: number) => void;
  onStepChange?: (step: number) => void;
}

export function PerformanceFeatureShowcase({
  onStepChange,
  onClose,
  ...deps
}: PerformanceFeatureShowcaseProps) {
  return (
    <FeatureShowcase {...deps} onStepChange={onStepChange} onClose={onClose}>
      <FeatureShowcase.Step>
        <FeatureShowcase.Image src={tourMetrics} alt={t('Track Application Metrics')} />
        <FeatureShowcase.StepTitle>
          {t('Track Application Metrics')}
        </FeatureShowcase.StepTitle>
        <FeatureShowcase.StepContent>
          {t(
            'Monitor your slowest pageloads and APIs to see which users are having the worst time.'
          )}
        </FeatureShowcase.StepContent>
        <FeatureShowcase.StepActions>{docsLink}</FeatureShowcase.StepActions>
      </FeatureShowcase.Step>
      <FeatureShowcase.Step>
        <FeatureShowcase.Image
          src={tourCorrelate}
          alt={t('Correlate Errors and Traces')}
        />
        <FeatureShowcase.StepTitle>
          {t('Correlate Errors and Traces')}
        </FeatureShowcase.StepTitle>
        <FeatureShowcase.StepContent>
          {t(
            'See what errors occurred within a transaction and the impact of those errors.'
          )}
        </FeatureShowcase.StepContent>
        <FeatureShowcase.StepActions>{docsLink}</FeatureShowcase.StepActions>
      </FeatureShowcase.Step>
      <FeatureShowcase.Step>
        <FeatureShowcase.Image src={tourAlert} alt={t('Watch and Alert')} />
        <FeatureShowcase.StepTitle>{t('Watch and Alert')}</FeatureShowcase.StepTitle>
        <FeatureShowcase.StepContent>
          {t(
            'Highlight mission-critical pages and APIs and set latency alerts to notify you before things go wrong.'
          )}
        </FeatureShowcase.StepContent>
        <FeatureShowcase.StepActions>{docsLink}</FeatureShowcase.StepActions>
      </FeatureShowcase.Step>
      <FeatureShowcase.Step>
        <FeatureShowcase.Image src={tourTrace} alt={t('Trace Across Systems')} />
        <FeatureShowcase.StepTitle>{t('Trace Across Systems')}</FeatureShowcase.StepTitle>
        <FeatureShowcase.StepContent>
          {t(
            "Follow a trace from a user's session and drill down to identify any bottlenecks that occur."
          )}
        </FeatureShowcase.StepContent>
        <SetupFooter />
      </FeatureShowcase.Step>
    </FeatureShowcase>
  );
}
