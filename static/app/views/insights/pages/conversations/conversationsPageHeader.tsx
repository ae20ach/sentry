import {Fragment} from 'react';

import {FeatureBadge} from '@sentry/scraps/badge';

import {Breadcrumbs} from 'sentry/components/breadcrumbs';
import {normalizeUrl} from 'sentry/utils/url/normalizeUrl';
import {useOrganization} from 'sentry/utils/useOrganization';
import {
  CONVERSATIONS_LANDING_SUB_PATH,
  CONVERSATIONS_LANDING_TITLE,
  CONVERSATIONS_SIDEBAR_LABEL,
} from 'sentry/views/insights/pages/conversations/settings';
import {
  DomainViewHeader,
  type Props as HeaderProps,
} from 'sentry/views/insights/pages/domainViewHeader';
import {useHasPageFrameFeature} from 'sentry/views/navigation/useHasPageFrameFeature';

type Props = {
  breadcrumbs?: HeaderProps['additionalBreadCrumbs'];
  headerActions?: HeaderProps['additonalHeaderActions'];
  headerTitle?: HeaderProps['headerTitle'];
  hideDefaultTabs?: HeaderProps['hideDefaultTabs'];
};

export function ConversationsPageHeader({
  headerActions,
  headerTitle: headerTitleProp,
  breadcrumbs,
  hideDefaultTabs,
}: Props) {
  const organization = useOrganization();
  const hasPageFrameFeature = useHasPageFrameFeature();

  const conversationsBaseUrl = normalizeUrl(
    `/organizations/${organization.slug}/explore/${CONVERSATIONS_LANDING_SUB_PATH}/`
  );

  // When the page frame is active and additional breadcrumbs are provided (e.g. on a
  // detail page), render them inside the title slot so they appear in the top bar
  // instead of the legacy header content area.
  const crumbsForTitle = breadcrumbs?.length
    ? [
        {
          label: CONVERSATIONS_SIDEBAR_LABEL,
          to: conversationsBaseUrl,
          preservePageFilters: true as const,
        },
        ...breadcrumbs,
      ]
    : null;

  const headerTitle =
    hasPageFrameFeature && crumbsForTitle ? (
      <Breadcrumbs crumbs={crumbsForTitle} />
    ) : (
      (headerTitleProp ?? (
        <Fragment>
          {CONVERSATIONS_LANDING_TITLE}
          <FeatureBadge type="alpha" />
        </Fragment>
      ))
    );

  return (
    <DomainViewHeader
      domainBaseUrl={conversationsBaseUrl}
      domainTitle={CONVERSATIONS_SIDEBAR_LABEL}
      headerTitle={headerTitle}
      modules={[]}
      selectedModule={undefined}
      additonalHeaderActions={headerActions}
      additionalBreadCrumbs={hasPageFrameFeature && crumbsForTitle ? [] : breadcrumbs}
      hideDefaultTabs={hideDefaultTabs}
      hasOverviewPage={false}
      unified
    />
  );
}
