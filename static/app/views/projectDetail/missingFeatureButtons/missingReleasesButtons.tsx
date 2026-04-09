import commitImage from 'sentry-images/spot/releases-tour-commits.svg';
import emailImage from 'sentry-images/spot/releases-tour-email.svg';
import resolutionImage from 'sentry-images/spot/releases-tour-resolution.svg';
import statsImage from 'sentry-images/spot/releases-tour-stats.svg';

import {Button, LinkButton} from '@sentry/scraps/button';
import {Flex, Grid} from '@sentry/scraps/layout';

import {openModal, type ModalRenderProps} from 'sentry/actionCreators/modal';
import {FeatureShowcase, useShowcaseContext} from 'sentry/components/featureShowcase';
import {releaseHealth} from 'sentry/data/platformCategories';
import {t} from 'sentry/locale';
import {ConfigStore} from 'sentry/stores/configStore';
import type {Organization} from 'sentry/types/organization';
import type {PlatformKey} from 'sentry/types/project';
import {trackAnalytics} from 'sentry/utils/analytics';

const DOCS_URL = 'https://docs.sentry.io/product/releases/';
const DOCS_HEALTH_URL = 'https://docs.sentry.io/product/releases/health/';

function SetupFooter() {
  const {close} = useShowcaseContext();
  return (
    <Flex justify="end">
      <LinkButton
        external
        href={DOCS_URL}
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
  <LinkButton external href={DOCS_URL}>
    {t('Setup')}
  </LinkButton>
);

type Props = {
  organization: Organization;
  health?: boolean;
  platform?: PlatformKey;
  projectId?: string;
};

interface ReleasesShowcaseProps extends Props, ModalRenderProps {}

function ReleasesShowcase(props: ReleasesShowcaseProps) {
  const {organization, projectId, ...deps} = props;
  function handleFeatureShowcaseAdvance(step: number) {
    trackAnalytics('project_detail.releases_tour.advance', {
      organization,
      project_id: projectId ?? '',
      step,
    });
  }

  function handleClose(step: number) {
    trackAnalytics('project_detail.releases_tour.close', {
      organization,
      project_id: projectId ?? '',
      step,
    });
  }

  return (
    <FeatureShowcase
      {...deps}
      onStepChange={handleFeatureShowcaseAdvance}
      onClose={handleClose}
    >
      <FeatureShowcase.Step>
        <FeatureShowcase.Image src={commitImage} alt={t('Suspect Commits')} />
        <FeatureShowcase.StepTitle>{t('Suspect Commits')}</FeatureShowcase.StepTitle>
        <FeatureShowcase.StepContent>
          {t(
            'Sentry suggests which commit caused an issue and who is likely responsible so you can triage.'
          )}
        </FeatureShowcase.StepContent>
        <FeatureShowcase.StepActions>{docsLink}</FeatureShowcase.StepActions>
      </FeatureShowcase.Step>
      <FeatureShowcase.Step>
        <FeatureShowcase.Image src={statsImage} alt={t('Release Stats')} />
        <FeatureShowcase.StepTitle>{t('Release Stats')}</FeatureShowcase.StepTitle>
        <FeatureShowcase.StepContent>
          {t(
            'Get an overview of the commits in each release, and which issues were introduced or fixed.'
          )}
        </FeatureShowcase.StepContent>
        <FeatureShowcase.StepActions>{docsLink}</FeatureShowcase.StepActions>
      </FeatureShowcase.Step>
      <FeatureShowcase.Step>
        <FeatureShowcase.Image src={resolutionImage} alt={t('Easily Resolve')} />
        <FeatureShowcase.StepTitle>{t('Easily Resolve')}</FeatureShowcase.StepTitle>
        <FeatureShowcase.StepContent>
          {t(
            'Automatically resolve issues by including the issue number in your commit message.'
          )}
        </FeatureShowcase.StepContent>
        <FeatureShowcase.StepActions>{docsLink}</FeatureShowcase.StepActions>
      </FeatureShowcase.Step>
      <FeatureShowcase.Step>
        <FeatureShowcase.Image src={emailImage} alt={t('Deploy Emails')} />
        <FeatureShowcase.StepTitle>{t('Deploy Emails')}</FeatureShowcase.StepTitle>
        <FeatureShowcase.StepContent>
          {t(
            'Receive email notifications about when your code gets deployed. This can be customized in settings.'
          )}
        </FeatureShowcase.StepContent>
        <SetupFooter />
      </FeatureShowcase.Step>
    </FeatureShowcase>
  );
}

export function MissingReleasesButtons({
  organization,
  health,
  projectId,
  platform,
}: Props) {
  const isSelfHostedErrorsOnly = ConfigStore.get('isSelfHostedErrorsOnly');
  const setupDisabled =
    (health && platform && !releaseHealth.includes(platform)) || isSelfHostedErrorsOnly;
  const setupDisabledTooltip = isSelfHostedErrorsOnly
    ? t('Release health is not available for errors only self-hosted.')
    : t('Release Health is not yet supported on this platform.');

  return (
    <Grid flow="column" align="center" gap="md">
      <LinkButton
        size="sm"
        priority="primary"
        external
        href={health ? DOCS_HEALTH_URL : DOCS_URL}
        disabled={setupDisabled}
        tooltipProps={{title: setupDisabled ? setupDisabledTooltip : undefined}}
        analyticsEventKey="project_detail.releases_setup_clicked"
        analyticsEventName="Project Detail: Releases Start Setup Clicked"
      >
        {t('Start Setup')}
      </LinkButton>
      {!health && (
        <Button
          size="sm"
          analyticsEventKey="project_detail.releases_tour_clicked"
          analyticsEventName="Project Detail: Releases Get Tour Clicked"
          onClick={() => {
            openModal(deps => (
              <ReleasesShowcase
                {...deps}
                organization={organization}
                projectId={projectId}
              />
            ));
          }}
        >
          {t('Get Tour')}
        </Button>
      )}
    </Grid>
  );
}
