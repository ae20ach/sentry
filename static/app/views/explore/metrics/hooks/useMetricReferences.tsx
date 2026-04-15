import {useMemo} from 'react';

import {useMultiMetricsQueryParams} from 'sentry/views/explore/metrics/multiMetricsQueryParams';
import {getMetricReferences} from 'sentry/views/explore/metrics/referenceMap';

export function useMetricReferences() {
  const metricQueries = useMultiMetricsQueryParams();

  return useMemo(() => getMetricReferences(metricQueries), [metricQueries]);
}
