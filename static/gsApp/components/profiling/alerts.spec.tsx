import {OrganizationFixture} from 'sentry-fixture/organization';
import {ProjectFixture} from 'sentry-fixture/project';

import {MetricHistoryFixture} from 'getsentry-test/fixtures/metricHistory';
import {SubscriptionFixture} from 'getsentry-test/fixtures/subscription';
import {render, screen} from 'sentry-test/reactTestingLibrary';

import {DataCategory} from 'sentry/types/core';

import {ContinuousProfilingBillingRequirementBanner} from 'getsentry/components/profiling/alerts';
import {UNLIMITED_RESERVED} from 'getsentry/constants';
import {SubscriptionStore} from 'getsentry/stores/subscriptionStore';
import {PlanTier} from 'getsentry/types';

describe('ContinuousProfilingBillingRequirementBanner', () => {
  beforeEach(() => {
    SubscriptionStore.init();
  });

  it('renders null when profileDuration has unlimited reserved quota', () => {
    const organization = OrganizationFixture();
    const subscription = SubscriptionFixture({
      organization,
      plan: 'am3_t_ent',
      planTier: PlanTier.AM3,
    });
    subscription.categories.profileDuration = MetricHistoryFixture({
      category: DataCategory.PROFILE_DURATION,
      reserved: UNLIMITED_RESERVED,
      prepaid: UNLIMITED_RESERVED,
    });
    subscription.onDemandMaxSpend = 0;
    SubscriptionStore.set(organization.slug, subscription);

    const project = ProjectFixture({platform: 'python'});
    render(<ContinuousProfilingBillingRequirementBanner project={project} />, {
      organization,
    });

    expect(
      screen.queryByRole('heading', {name: 'Try Sentry Business for Free'})
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', {name: /Pay-As-You-Go/i})
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', {name: /On-Demand/i})).not.toBeInTheDocument();
  });

  it('renders null on non-AM2/AM3 plans', () => {
    const organization = OrganizationFixture();
    const subscription = SubscriptionFixture({
      organization,
      plan: 'am1_f',
      planTier: PlanTier.AM1,
    });
    SubscriptionStore.set(organization.slug, subscription);

    const project = ProjectFixture({platform: 'python'});
    render(<ContinuousProfilingBillingRequirementBanner project={project} />, {
      organization,
    });

    expect(
      screen.queryByRole('heading', {name: 'Try Sentry Business for Free'})
    ).not.toBeInTheDocument();
  });

  it('renders null when project platform is not profile-duration-compatible', () => {
    const organization = OrganizationFixture();
    const subscription = SubscriptionFixture({
      organization,
      plan: 'am3_t_ent',
      planTier: PlanTier.AM3,
    });
    SubscriptionStore.set(organization.slug, subscription);

    const project = ProjectFixture({platform: 'other'});
    render(<ContinuousProfilingBillingRequirementBanner project={project} />, {
      organization,
    });

    expect(
      screen.queryByRole('heading', {name: 'Try Sentry Business for Free'})
    ).not.toBeInTheDocument();
  });

  it('renders the business-trial banner when profileDuration budget is unavailable', () => {
    const organization = OrganizationFixture();
    const subscription = SubscriptionFixture({
      organization,
      plan: 'am3_t_ent',
      planTier: PlanTier.AM3,
    });
    // Default planCategories.profileDuration.events is 0 for am3_t_ent, so
    // reserved/prepaid are already 0. SubscriptionFixture defaults set
    // onDemandMaxSpend=0 and canTrial=true, so BusinessTrialBanner should
    // render.
    SubscriptionStore.set(organization.slug, subscription);

    const project = ProjectFixture({platform: 'python'});
    render(<ContinuousProfilingBillingRequirementBanner project={project} />, {
      organization,
    });

    expect(
      screen.getByRole('heading', {name: 'Try Sentry Business for Free'})
    ).toBeInTheDocument();
  });

  it('renders null when budget is exceeded (EXCEEDED path)', () => {
    const organization = OrganizationFixture();
    const subscription = SubscriptionFixture({
      organization,
      plan: 'am3_t_ent',
      planTier: PlanTier.AM3,
    });
    subscription.categories.profileDuration = MetricHistoryFixture({
      category: DataCategory.PROFILE_DURATION,
      reserved: 1_000_000,
      prepaid: 1_000_000,
      usageExceeded: true,
    });
    SubscriptionStore.set(organization.slug, subscription);

    const project = ProjectFixture({platform: 'python'});
    render(<ContinuousProfilingBillingRequirementBanner project={project} />, {
      organization,
    });

    expect(
      screen.queryByRole('heading', {name: 'Try Sentry Business for Free'})
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', {name: /On-Demand/i})).not.toBeInTheDocument();
  });
});
