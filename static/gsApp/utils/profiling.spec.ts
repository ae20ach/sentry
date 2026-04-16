import {OrganizationFixture} from 'sentry-fixture/organization';

import {MetricHistoryFixture} from 'getsentry-test/fixtures/metricHistory';
import {SubscriptionFixture} from 'getsentry-test/fixtures/subscription';

import {DataCategory} from 'sentry/types/core';

import {UNLIMITED_RESERVED} from 'getsentry/constants';
import type {Subscription} from 'getsentry/types';
import {PlanTier} from 'getsentry/types';
import {BudgetUsage, checkBudgetUsageFor} from 'getsentry/utils/profiling';

describe('checkBudgetUsageFor', () => {
  const organization = OrganizationFixture();
  let subscription: Subscription;

  beforeEach(() => {
    subscription = SubscriptionFixture({
      organization,
      plan: 'am3_t_ent',
      planTier: PlanTier.AM3,
    });
    subscription.onDemandMaxSpend = 0;
  });

  it('returns UNKNOWN when the category is missing from subscription.categories', () => {
    delete subscription.categories.profileDuration;
    expect(checkBudgetUsageFor(subscription, DataCategory.PROFILE_DURATION)).toBe(
      BudgetUsage.UNKNOWN
    );
  });

  it('returns AVAILABLE when reserved > 0 and not exceeded', () => {
    subscription.categories.profileDuration = MetricHistoryFixture({
      category: DataCategory.PROFILE_DURATION,
      reserved: 1000,
      prepaid: 1000,
    });
    expect(checkBudgetUsageFor(subscription, DataCategory.PROFILE_DURATION)).toBe(
      BudgetUsage.AVAILABLE
    );
  });

  it('returns AVAILABLE when reserved === UNLIMITED_RESERVED', () => {
    subscription.categories.profileDuration = MetricHistoryFixture({
      category: DataCategory.PROFILE_DURATION,
      reserved: UNLIMITED_RESERVED,
      prepaid: UNLIMITED_RESERVED,
      free: 0,
      onDemandBudget: 0,
      onDemandQuantity: 0,
    });
    expect(checkBudgetUsageFor(subscription, DataCategory.PROFILE_DURATION)).toBe(
      BudgetUsage.AVAILABLE
    );
  });

  it('returns EXCEEDED when reserved > 0 and usageExceeded=true', () => {
    subscription.categories.profileDuration = MetricHistoryFixture({
      category: DataCategory.PROFILE_DURATION,
      reserved: 1000,
      prepaid: 1000,
      usageExceeded: true,
    });
    expect(checkBudgetUsageFor(subscription, DataCategory.PROFILE_DURATION)).toBe(
      BudgetUsage.EXCEEDED
    );
  });

  it('returns EXCEEDED when reserved === UNLIMITED_RESERVED and usageExceeded=true', () => {
    subscription.categories.profileDuration = MetricHistoryFixture({
      category: DataCategory.PROFILE_DURATION,
      reserved: UNLIMITED_RESERVED,
      prepaid: UNLIMITED_RESERVED,
      usageExceeded: true,
    });
    expect(checkBudgetUsageFor(subscription, DataCategory.PROFILE_DURATION)).toBe(
      BudgetUsage.EXCEEDED
    );
  });

  it('returns AVAILABLE when reserved=0 but free > 0', () => {
    subscription.categories.profileDuration = MetricHistoryFixture({
      category: DataCategory.PROFILE_DURATION,
      reserved: 0,
      prepaid: 0,
      free: 500,
    });
    expect(checkBudgetUsageFor(subscription, DataCategory.PROFILE_DURATION)).toBe(
      BudgetUsage.AVAILABLE
    );
  });

  it('returns AVAILABLE when reserved=0 but onDemandBudget > 0', () => {
    subscription.categories.profileDuration = MetricHistoryFixture({
      category: DataCategory.PROFILE_DURATION,
      reserved: 0,
      prepaid: 0,
      onDemandBudget: 1000,
    });
    expect(checkBudgetUsageFor(subscription, DataCategory.PROFILE_DURATION)).toBe(
      BudgetUsage.AVAILABLE
    );
  });

  it('returns AVAILABLE when reserved=0 but onDemandQuantity > 0', () => {
    subscription.categories.profileDuration = MetricHistoryFixture({
      category: DataCategory.PROFILE_DURATION,
      reserved: 0,
      prepaid: 0,
      onDemandQuantity: 100,
    });
    expect(checkBudgetUsageFor(subscription, DataCategory.PROFILE_DURATION)).toBe(
      BudgetUsage.AVAILABLE
    );
  });

  it('returns AVAILABLE when category has no quota but subscription.onDemandMaxSpend > 0', () => {
    subscription.categories.profileDuration = MetricHistoryFixture({
      category: DataCategory.PROFILE_DURATION,
      reserved: 0,
      prepaid: 0,
    });
    subscription.onDemandMaxSpend = 5000;
    expect(checkBudgetUsageFor(subscription, DataCategory.PROFILE_DURATION)).toBe(
      BudgetUsage.AVAILABLE
    );
  });

  it('returns EXCEEDED when category has no quota, onDemandMaxSpend > 0, and usageExceeded', () => {
    subscription.categories.profileDuration = MetricHistoryFixture({
      category: DataCategory.PROFILE_DURATION,
      reserved: 0,
      prepaid: 0,
      usageExceeded: true,
    });
    subscription.onDemandMaxSpend = 5000;
    expect(checkBudgetUsageFor(subscription, DataCategory.PROFILE_DURATION)).toBe(
      BudgetUsage.EXCEEDED
    );
  });

  it('returns UNAVAILABLE when reserved=0 and no free/onDemandBudget/onDemandQuantity and no onDemandMaxSpend', () => {
    subscription.categories.profileDuration = MetricHistoryFixture({
      category: DataCategory.PROFILE_DURATION,
      reserved: 0,
      prepaid: 0,
    });
    expect(checkBudgetUsageFor(subscription, DataCategory.PROFILE_DURATION)).toBe(
      BudgetUsage.UNAVAILABLE
    );
  });

  it.each([DataCategory.PROFILE_DURATION, DataCategory.PROFILE_DURATION_UI] as const)(
    'returns AVAILABLE for UNLIMITED_RESERVED on %s',
    dataCategory => {
      subscription.categories[dataCategory] = MetricHistoryFixture({
        category: dataCategory,
        reserved: UNLIMITED_RESERVED,
        prepaid: UNLIMITED_RESERVED,
      });
      expect(checkBudgetUsageFor(subscription, dataCategory)).toBe(BudgetUsage.AVAILABLE);
    }
  );
});
