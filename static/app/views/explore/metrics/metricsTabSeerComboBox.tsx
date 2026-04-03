import {useCallback, useMemo} from 'react';

import {usePageFilters} from 'sentry/components/pageFilters/usePageFilters';
import {AskSeerComboBox} from 'sentry/components/searchQueryBuilder/askSeerCombobox/askSeerComboBox';
import {AskSeerPollingComboBox} from 'sentry/components/searchQueryBuilder/askSeerCombobox/askSeerPollingComboBox';
import {useSearchQueryBuilder} from 'sentry/components/searchQueryBuilder/context';
import {parseQueryBuilderValue} from 'sentry/components/searchQueryBuilder/utils';
import {Token} from 'sentry/components/searchSyntax/parser';
import {stringifyToken} from 'sentry/components/searchSyntax/utils';
import {ConfigStore} from 'sentry/stores/configStore';
import type {DateString} from 'sentry/types/core';
import {trackAnalytics} from 'sentry/utils/analytics';
import {getFieldDefinition} from 'sentry/utils/fields';
import {fetchMutation, mutationOptions} from 'sentry/utils/queryClient';
import {useLocation} from 'sentry/utils/useLocation';
import {useNavigate} from 'sentry/utils/useNavigate';
import {useOrganization} from 'sentry/utils/useOrganization';
import {useProjects} from 'sentry/utils/useProjects';
import type {TraceMetric} from 'sentry/views/explore/metrics/metricQuery';
import type {WritableAggregateField} from 'sentry/views/explore/queryParams/aggregateField';
import {
  useQueryParams,
  useSetQueryParams,
} from 'sentry/views/explore/queryParams/context';
import {isGroupBy} from 'sentry/views/explore/queryParams/groupBy';
import {Mode} from 'sentry/views/explore/queryParams/mode';
import {isVisualize} from 'sentry/views/explore/queryParams/visualize';
import type {ChartType} from 'sentry/views/insights/common/components/chart';

interface MetricsTabSeerComboBoxProps {
  traceMetric: TraceMetric;
}

interface Visualization {
  chartType: ChartType;
  yAxes: string[];
}

interface AskSeerSearchQuery {
  end: string | null;
  groupBys: string[];
  mode: string;
  query: string;
  sort: string;
  start: string | null;
  statsPeriod: string;
  visualizations: Visualization[];
}

interface MetricsAskSeerTranslateResponse {
  responses: Array<{
    end: string | null;
    group_by: string[];
    mode: string;
    query: string;
    sort: string;
    start: string | null;
    stats_period: string;
    visualization: Array<{
      chart_type: number;
      y_axes: string[];
    }>;
  }>;
  unsupported_reason: string | null;
}

export function MetricsTabSeerComboBox({traceMetric}: MetricsTabSeerComboBoxProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const {projects} = useProjects();
  const pageFilters = usePageFilters();
  const organization = useOrganization();
  const queryParams = useQueryParams();
  const setQueryParams = useSetQueryParams();
  const {
    currentInputValueRef,
    query,
    committedQuery,
    askSeerSuggestedQueryRef,
    enableAISearch,
  } = useSearchQueryBuilder();

  let initialSeerQuery = '';
  const queryDetails = useMemo(() => {
    const queryToUse = committedQuery.length > 0 ? committedQuery : query;
    const parsedQuery = parseQueryBuilderValue(queryToUse, getFieldDefinition);
    return {parsedQuery, queryToUse};
  }, [committedQuery, query]);

  const inputValue = currentInputValueRef.current.trim();

  // Only filter out FREE_TEXT tokens if there's actual input value to filter by
  const filteredCommittedQuery = queryDetails.parsedQuery
    ?.filter(
      token =>
        !(token.type === Token.FREE_TEXT && inputValue && token.text.includes(inputValue))
    )
    .map(token => stringifyToken(token))
    .join(' ')
    .trim();

  // Use filteredCommittedQuery if it exists and has content, otherwise fall back to queryToUse
  if (filteredCommittedQuery && filteredCommittedQuery.length > 0) {
    initialSeerQuery = filteredCommittedQuery;
  } else if (queryDetails.queryToUse) {
    initialSeerQuery = queryDetails.queryToUse;
  }

  if (inputValue) {
    initialSeerQuery =
      initialSeerQuery === '' ? inputValue : `${initialSeerQuery} ${inputValue}`;
  }

  const metricsTabAskSeerMutationOptions = mutationOptions({
    mutationFn: async (queryToSubmit: string) => {
      const selectedProjects =
        pageFilters.selection.projects?.length > 0 &&
        pageFilters.selection.projects?.[0] !== -1
          ? pageFilters.selection.projects
          : projects.filter(p => p.isMember).map(p => p.id);

      const user = ConfigStore.get('user');
      const data = await fetchMutation<MetricsAskSeerTranslateResponse>({
        url: `/organizations/${organization.slug}/search-agent/translate/`,
        method: 'POST',
        data: {
          org_id: organization.id,
          org_slug: organization.slug,
          natural_language_query: queryToSubmit,
          project_ids: selectedProjects,
          strategy: 'Metrics',
          user_email: user?.email,
          options: {
            metric_context: {
              metric_name: traceMetric.name,
              metric_type: traceMetric.type,
              metric_unit: traceMetric.unit ?? 'none',
            },
          },
        },
      });

      return {
        status: 'ok',
        unsupported_reason: data.unsupported_reason,
        queries: data.responses.map(r => ({
          visualizations: r.visualization.map(v => ({
            chartType: v.chart_type,
            yAxes: v.y_axes,
          })),
          query: r.query,
          sort: r.sort,
          groupBys: r.group_by,
          statsPeriod: r.stats_period,
          start: r.start,
          end: r.end,
          mode: r.mode,
        })),
      };
    },
  });

  const applySeerSearchQuery = useCallback(
    (result: AskSeerSearchQuery) => {
      if (!result) return;
      const {
        query: queryToUse,
        groupBys,
        statsPeriod,
        start: resultStart,
        end: resultEnd,
        visualizations,
      } = result;

      let start: DateString = null;
      let end: DateString = null;

      if (resultStart && resultEnd) {
        // Strip 'Z' suffix to treat UTC dates as local time
        const startLocal = resultStart.endsWith('Z')
          ? resultStart.slice(0, -1)
          : resultStart;
        const endLocal = resultEnd.endsWith('Z') ? resultEnd.slice(0, -1) : resultEnd;
        start = new Date(startLocal).toISOString();
        end = new Date(endLocal).toISOString();
      } else {
        start = pageFilters.selection.datetime.start;
        end = pageFilters.selection.datetime.end;
      }

      // Update mode based on groupBys or response mode
      const mode =
        groupBys.length > 0
          ? Mode.AGGREGATE
          : result.mode === 'aggregates'
            ? Mode.AGGREGATE
            : Mode.SAMPLES;

      // Build aggregateFields array (same merge logic as LogsTabSeerComboBox)
      // This combines groupBys with existing visualizations
      let seenVisualizes = false;
      let groupByAfterVisualizes = false;

      for (const aggregateField of queryParams.aggregateFields) {
        if (isGroupBy(aggregateField) && seenVisualizes) {
          groupByAfterVisualizes = true;
          break;
        } else if (isVisualize(aggregateField)) {
          seenVisualizes = true;
        }
      }

      const aggregateFields: WritableAggregateField[] = [];
      const iter = groupBys[Symbol.iterator]();

      for (const aggregateField of queryParams.aggregateFields) {
        if (isVisualize(aggregateField)) {
          if (!groupByAfterVisualizes) {
            // Insert group bys before visualizes
            for (const groupBy of iter) {
              aggregateFields.push({groupBy});
            }
          }
          aggregateFields.push(aggregateField.serialize());
        } else if (isGroupBy(aggregateField)) {
          const {value: groupBy, done} = iter.next();
          if (!done) {
            aggregateFields.push({groupBy});
          }
        }
      }

      // Add any remaining group bys
      for (const groupBy of iter) {
        aggregateFields.push({groupBy});
      }

      // Update per-query state atomically (query, aggregateFields, mode)
      setQueryParams({query: queryToUse, aggregateFields, mode});

      // Update global time range via navigation
      const selection = {
        ...pageFilters.selection,
        datetime: {
          start,
          end,
          utc: pageFilters.selection.datetime.utc,
          period:
            resultStart && resultEnd
              ? null
              : statsPeriod || pageFilters.selection.datetime.period,
        },
      };

      askSeerSuggestedQueryRef.current = JSON.stringify({
        selection,
        query: queryToUse,
        groupBys,
        mode,
      });

      trackAnalytics('metrics.ai_query_applied', {
        organization,
        query: queryToUse,
        group_by_count: groupBys.length,
        visualize_count: visualizations?.length ?? 0,
      });

      // Navigate to update global time range params
      navigate(
        {
          ...location,
          query: {
            ...location.query,
            start: selection.datetime.start,
            end: selection.datetime.end,
            statsPeriod: selection.datetime.period,
            utc: selection.datetime.utc,
          },
        },
        {replace: true, preventScrollReset: true}
      );
    },
    [
      askSeerSuggestedQueryRef,
      location,
      navigate,
      organization,
      pageFilters.selection,
      queryParams.aggregateFields,
      setQueryParams,
    ]
  );

  const usePollingEndpoint = organization.features.includes(
    'gen-ai-explore-metrics-search'
  );

  // Get selected project IDs for the polling variant
  const selectedProjectIds = useMemo(() => {
    if (
      pageFilters.selection.projects?.length > 0 &&
      pageFilters.selection.projects?.[0] !== -1
    ) {
      return pageFilters.selection.projects;
    }
    return projects.filter(p => p.isMember).map(p => parseInt(p.id, 10));
  }, [pageFilters.selection.projects, projects]);

  // Transform the final_response from Seer to match the expected format
  const transformResponse = useCallback(
    (response: AskSeerSearchQuery): AskSeerSearchQuery[] => {
      const seerResponse = response as unknown as {
        responses?: Array<{
          end: string | null;
          group_by: string[];
          mode: string;
          query: string;
          sort: string;
          start: string | null;
          stats_period: string;
          visualization: Array<{
            chart_type: number;
            y_axes: string[];
          }>;
        }>;
      };

      if (seerResponse.responses && Array.isArray(seerResponse.responses)) {
        return seerResponse.responses.map(r => ({
          visualizations: r.visualization.map(v => ({
            chartType: v.chart_type,
            yAxes: v.y_axes,
          })),
          query: r.query,
          sort: r.sort,
          groupBys: r.group_by,
          statsPeriod: r.stats_period,
          start: r.start,
          end: r.end,
          mode: r.mode,
        }));
      }

      return [response];
    },
    []
  );

  if (!enableAISearch) {
    return null;
  }

  if (usePollingEndpoint) {
    return (
      <AskSeerPollingComboBox<AskSeerSearchQuery>
        initialQuery={initialSeerQuery}
        projectIds={selectedProjectIds}
        strategy="Metrics"
        options={{
          metric_context: {
            metric_name: traceMetric.name,
            metric_type: traceMetric.type,
            metric_unit: traceMetric.unit ?? 'none',
          },
        }}
        applySeerSearchQuery={applySeerSearchQuery}
        transformResponse={transformResponse}
        analyticsSource="metrics"
        feedbackSource="metrics_ai_query"
        fallbackMutationOptions={metricsTabAskSeerMutationOptions}
      />
    );
  }

  return (
    <AskSeerComboBox
      initialQuery={initialSeerQuery}
      askSeerMutationOptions={metricsTabAskSeerMutationOptions}
      applySeerSearchQuery={applySeerSearchQuery}
      analyticsSource="metrics"
      feedbackSource="metrics_ai_query"
    />
  );
}
