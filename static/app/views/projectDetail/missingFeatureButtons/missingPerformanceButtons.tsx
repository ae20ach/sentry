import {Button} from '@sentry/scraps/button';
import {Grid} from '@sentry/scraps/layout';

import {openModal} from 'sentry/actionCreators/modal';
import {navigateTo} from 'sentry/actionCreators/navigation';
import Feature from 'sentry/components/acl/feature';
import {usePageFilters} from 'sentry/components/pageFilters/usePageFilters';
import {t} from 'sentry/locale';
import type {Organization} from 'sentry/types/organization';
import {trackAnalytics} from 'sentry/utils/analytics';
import {useLocation} from 'sentry/utils/useLocation';
import {useNavigate} from 'sentry/utils/useNavigate';
import {useProjects} from 'sentry/utils/useProjects';
import {PerformanceFeatureShowcase} from 'sentry/views/performance/performanceFeatureShowcase';
import {
  getPerformanceBaseUrl,
  platformToDomainView,
} from 'sentry/views/performance/utils';

type Props = {
  organization: Organization;
};

export function MissingPerformanceButtons({organization}: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const {projects} = useProjects();
  const {
    selection: {projects: selectedProjects},
  } = usePageFilters();

  const domainView = platformToDomainView(projects, selectedProjects);

  return (
    <Feature
      hookName="feature-disabled:project-performance-score-card"
      features="performance-view"
      organization={organization}
    >
      <Grid flow="column" align="center" gap="md">
        <Button
          size="sm"
          priority="primary"
          analyticsEventKey="project_detail.performance_setup_clicked"
          analyticsEventName="Project Detail: Performance Start Setup Clicked"
          onClick={event => {
            event.preventDefault();
            navigateTo(
              `${getPerformanceBaseUrl(organization.slug, domainView)}/?project=:project#performance-sidequest`,
              navigate,
              location
            );
          }}
        >
          {t('Start Setup')}
        </Button>

        <Button
          size="sm"
          analyticsEventKey="project_detail.performance_tour_clicked"
          analyticsEventName="Project Detail: Performance Get Tour Clicked"
          onClick={() => {
            openModal(deps => (
              <PerformanceFeatureShowcase
                {...deps}
                onStepChange={step => {
                  trackAnalytics('project_detail.performance_tour.advance', {
                    organization,
                    step,
                  });
                }}
                onClose={step => {
                  trackAnalytics('project_detail.performance_tour.close', {
                    organization,
                    step,
                  });
                }}
              />
            ));
          }}
        >
          {t('Get Tour')}
        </Button>
      </Grid>
    </Feature>
  );
}
