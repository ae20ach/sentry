import {DisplayType, WidgetType} from 'sentry/views/dashboards/types';
import {NODE_RUNTIME_METRICS_PREBUILT_CONFIG} from 'sentry/views/dashboards/utils/prebuiltConfigs/nodeRuntimeMetrics/nodeRuntimeMetrics';

describe('NODE_RUNTIME_METRICS_PREBUILT_CONFIG', () => {
  it('has the expected dashboard title', () => {
    expect(NODE_RUNTIME_METRICS_PREBUILT_CONFIG.title).toBe('Node.js Runtime Metrics');
  });

  it('has seven widgets matching the handover spec', () => {
    expect(NODE_RUNTIME_METRICS_PREBUILT_CONFIG.widgets).toHaveLength(7);
  });

  it('uses BIG_NUMBER display type for all KPI widgets', () => {
    const kpiWidgets = NODE_RUNTIME_METRICS_PREBUILT_CONFIG.widgets.slice(0, 3);
    kpiWidgets.forEach(widget => {
      expect(widget.displayType).toBe(DisplayType.BIG_NUMBER);
      expect(widget.widgetType).toBe(WidgetType.TRACEMETRICS);
    });
  });

  it('uses max() aggregation for event loop delay percentiles', () => {
    const eventLoopDelayWidget = NODE_RUNTIME_METRICS_PREBUILT_CONFIG.widgets.find(
      w => w.id === 'node-runtime-event-loop-delay'
    );
    expect(eventLoopDelayWidget).toBeDefined();
    expect(eventLoopDelayWidget?.queries[0]!.fields).toEqual([
      'max(value,node.runtime.event_loop.delay.p50,gauge,second)',
      'max(value,node.runtime.event_loop.delay.p99,gauge,second)',
    ]);
  });

  it('queries HTTP request duration from spans dataset', () => {
    const httpWidget = NODE_RUNTIME_METRICS_PREBUILT_CONFIG.widgets.find(
      w => w.id === 'node-runtime-http-request-duration'
    );
    expect(httpWidget).toBeDefined();
    expect(httpWidget?.widgetType).toBe(WidgetType.SPANS);
    expect(httpWidget?.queries[0]!.conditions).toBe('span.op:http.server');
    expect(httpWidget?.queries[0]!.fields).toEqual([
      'p50(span.duration)',
      'p95(span.duration)',
    ]);
  });

  it('configures custom onboarding for node-runtime-metrics', () => {
    expect(NODE_RUNTIME_METRICS_PREBUILT_CONFIG.onboarding).toEqual({
      type: 'custom',
      componentId: 'node-runtime-metrics',
      requiredProjectFlags: ['firstTransactionEvent'],
    });
  });
});
