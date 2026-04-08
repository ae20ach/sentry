import type {LocationDescriptorObject} from 'history';

import {normalizeDateTimeParams} from 'sentry/components/pageFilters/parse';
import {usePageFilters} from 'sentry/components/pageFilters/usePageFilters';
import {isPartialSpanOrTraceData} from 'sentry/utils/trace/isOlderThan30Days';
import {useLocation} from 'sentry/utils/useLocation';
import {useOrganization} from 'sentry/utils/useOrganization';
import type {AITraceSpanNode} from 'sentry/views/insights/pages/agents/utils/types';
import type {TraceViewSources} from 'sentry/views/performance/newTraceDetails/traceHeader/breadcrumbs';
import {getTraceDetailsUrl} from 'sentry/views/performance/traceDetails/utils';

export function useNodeDetailsLink({
  node,
  traceSlug,
  source,
}: {
  node: AITraceSpanNode | undefined;
  source: TraceViewSources;
  traceSlug: string;
}): {isDisabled: boolean; url: LocationDescriptorObject} {
  const organization = useOrganization();
  const {selection} = usePageFilters();
  const location = useLocation();

  const spanId = node?.id;
  const targetId = node?.transactionId;
  const timestamp = node?.startTimestamp;

  const isDisabled = isPartialSpanOrTraceData(timestamp);

  const url = getTraceDetailsUrl({
    source,
    organization,
    location: {
      ...location,
      // Do not forward all query params to the trace view
      query: {},
    },
    traceSlug,
    spanId,
    targetId,
    timestamp,
    dateSelection: normalizeDateTimeParams(selection),
  });

  return {url, isDisabled};
}
