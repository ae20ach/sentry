import {t} from 'sentry/locale';
import {FieldKind} from 'sentry/utils/fields';
import {DisplayType, WidgetType} from 'sentry/views/dashboards/types';
import type {Widget} from 'sentry/views/dashboards/types';
import type {PrebuiltDashboard} from 'sentry/views/dashboards/utils/prebuiltConfigs';
import {SpanFields} from 'sentry/views/insights/types';

const TRANSACTION_OP_CONDITION = `${SpanFields.TRANSACTION_OP}:[ui.load,navigation]`;
const COLD_START_CONDITION = `has:${SpanFields.APP_VITALS_START_COLD_VALUE}`;
const WARM_START_CONDITION = `has:${SpanFields.APP_VITALS_START_WARM_VALUE}`;
const TTID_CONDITION = `has:${SpanFields.APP_VITALS_TTID_VALUE}`;
const TTFD_CONDITION = `has:${SpanFields.APP_VITALS_TTFD_VALUE}`;

const COLD_START_BIG_NUMBER_WIDGET: Widget = {
  id: 'cold-start-big-number',
  title: t('Avg. Cold App Start'),
  description: 'Average cold app start duration',
  displayType: DisplayType.BIG_NUMBER,
  widgetType: WidgetType.SPANS,
  interval: '1h',
  thresholds: {
    max_values: {
      max1: 3000,
      max2: 5000,
    },
    unit: null,
  },
  queries: [
    {
      name: '',
      fields: [`avg(${SpanFields.APP_VITALS_START_COLD_VALUE})`],
      aggregates: [`avg(${SpanFields.APP_VITALS_START_COLD_VALUE})`],
      columns: [],
      conditions: COLD_START_CONDITION,
      orderby: '',
    },
  ],
  layout: {
    h: 1,
    x: 0,
    y: 0,
    w: 1,
    minH: 1,
  },
};

const WARM_START_BIG_NUMBER_WIDGET: Widget = {
  id: 'warm-start-big-number',
  title: t('Avg. Warm App Start'),
  description: 'Average warm app start duration',
  displayType: DisplayType.BIG_NUMBER,
  widgetType: WidgetType.SPANS,
  interval: '1h',
  thresholds: {
    max_values: {
      max1: 1000,
      max2: 2000,
    },
    unit: null,
  },
  queries: [
    {
      name: '',
      fields: [`avg(${SpanFields.APP_VITALS_START_WARM_VALUE})`],
      aggregates: [`avg(${SpanFields.APP_VITALS_START_WARM_VALUE})`],
      columns: [],
      conditions: WARM_START_CONDITION,
      orderby: '',
    },
  ],
  layout: {
    h: 1,
    x: 1,
    y: 0,
    w: 1,
    minH: 1,
  },
};

const AVG_TTID_BIG_NUMBER_WIDGET: Widget = {
  id: 'avg-ttid-big-number',
  title: t('Avg. TTID'),
  description: 'Average time to initial display',
  displayType: DisplayType.BIG_NUMBER,
  widgetType: WidgetType.SPANS,
  interval: '1h',
  thresholds: null,
  queries: [
    {
      name: '',
      fields: [`avg(${SpanFields.APP_VITALS_TTID_VALUE})`],
      aggregates: [`avg(${SpanFields.APP_VITALS_TTID_VALUE})`],
      columns: [],
      conditions: TTID_CONDITION,
      orderby: '',
    },
  ],
  layout: {
    h: 1,
    x: 2,
    y: 0,
    w: 1,
    minH: 1,
  },
};

const AVG_TTFD_BIG_NUMBER_WIDGET: Widget = {
  id: 'avg-ttfd-big-number',
  title: t('Avg. TTFD'),
  description: 'Average time to full display',
  displayType: DisplayType.BIG_NUMBER,
  widgetType: WidgetType.SPANS,
  interval: '1h',
  thresholds: null,
  queries: [
    {
      name: '',
      fields: [`avg(${SpanFields.APP_VITALS_TTFD_VALUE})`],
      aggregates: [`avg(${SpanFields.APP_VITALS_TTFD_VALUE})`],
      columns: [],
      conditions: TTFD_CONDITION,
      orderby: '',
    },
  ],
  layout: {
    h: 1,
    x: 3,
    y: 0,
    w: 1,
    minH: 1,
  },
};

const SLOW_FRAME_RATE_WIDGET: Widget = {
  id: 'slow-frame-rate-big-number',
  title: t('Slow Frame Rate'),
  description: 'The percentage of frames that were slow',
  displayType: DisplayType.BIG_NUMBER,
  widgetType: WidgetType.SPANS,
  interval: '1h',
  thresholds: null,
  queries: [
    {
      name: '',
      fields: [
        `sum(${SpanFields.APP_VITALS_FRAMES_SLOW_COUNT})`,
        `sum(${SpanFields.APP_VITALS_FRAMES_TOTAL_COUNT})`,
        `equation|sum(${SpanFields.APP_VITALS_FRAMES_SLOW_COUNT}) / sum(${SpanFields.APP_VITALS_FRAMES_TOTAL_COUNT})`,
      ],
      aggregates: [
        `sum(${SpanFields.APP_VITALS_FRAMES_SLOW_COUNT})`,
        `sum(${SpanFields.APP_VITALS_FRAMES_TOTAL_COUNT})`,
        `equation|sum(${SpanFields.APP_VITALS_FRAMES_SLOW_COUNT}) / sum(${SpanFields.APP_VITALS_FRAMES_TOTAL_COUNT})`,
      ],
      fieldMeta: [
        null,
        null,
        {
          valueType: 'percentage',
          valueUnit: null,
        },
      ],
      selectedAggregate: 2,
      columns: [],
      conditions: TRANSACTION_OP_CONDITION,
      orderby: '',
    },
  ],
  layout: {
    h: 1,
    x: 0,
    y: 1,
    w: 2,
    minH: 1,
  },
};

const FROZEN_FRAME_RATE_WIDGET: Widget = {
  id: 'frozen-frame-rate-big-number',
  title: t('Frozen Frame Rate'),
  description: 'The percentage of frames that were frozen',
  displayType: DisplayType.BIG_NUMBER,
  widgetType: WidgetType.SPANS,
  interval: '1h',
  thresholds: null,
  queries: [
    {
      name: '',
      fields: [
        `sum(${SpanFields.APP_VITALS_FRAMES_FROZEN_COUNT})`,
        `sum(${SpanFields.APP_VITALS_FRAMES_TOTAL_COUNT})`,
        `equation|sum(${SpanFields.APP_VITALS_FRAMES_FROZEN_COUNT}) / sum(${SpanFields.APP_VITALS_FRAMES_TOTAL_COUNT})`,
      ],
      aggregates: [
        `sum(${SpanFields.APP_VITALS_FRAMES_FROZEN_COUNT})`,
        `sum(${SpanFields.APP_VITALS_FRAMES_TOTAL_COUNT})`,
        `equation|sum(${SpanFields.APP_VITALS_FRAMES_FROZEN_COUNT}) / sum(${SpanFields.APP_VITALS_FRAMES_TOTAL_COUNT})`,
      ],
      fieldMeta: [
        null,
        null,
        {
          valueType: 'percentage',
          valueUnit: null,
        },
      ],
      selectedAggregate: 2,
      columns: [],
      conditions: TRANSACTION_OP_CONDITION,
      orderby: '',
    },
  ],
  layout: {
    h: 1,
    x: 2,
    y: 1,
    w: 2,
    minH: 1,
  },
};

const AVG_FRAME_DELAY_WIDGET: Widget = {
  id: 'avg-frame-delay-big-number',
  title: t('Avg. Frame Delay'),
  description: 'Average frame delay',
  displayType: DisplayType.BIG_NUMBER,
  widgetType: WidgetType.SPANS,
  interval: '1h',
  thresholds: null,
  queries: [
    {
      name: '',
      fields: [`avg(${SpanFields.APP_VITALS_FRAMES_DELAY_VALUE})`],
      aggregates: [`avg(${SpanFields.APP_VITALS_FRAMES_DELAY_VALUE})`],
      columns: [],
      conditions: TRANSACTION_OP_CONDITION,
      orderby: '',
    },
  ],
  layout: {
    h: 1,
    x: 4,
    y: 1,
    w: 2,
    minH: 1,
  },
};

const APP_START_TABLE: Widget = {
  id: 'app-start-table',
  title: t('App Starts'),
  description: '',
  displayType: DisplayType.TABLE,
  widgetType: WidgetType.SPANS,
  interval: '1h',
  thresholds: null,
  queries: [
    {
      name: '',
      fields: [
        SpanFields.TRANSACTION,
        `avg(${SpanFields.APP_VITALS_START_COLD_VALUE})`,
        `avg(${SpanFields.APP_VITALS_START_WARM_VALUE})`,
        `count(${SpanFields.SPAN_DURATION})`,
      ],
      aggregates: [
        `avg(${SpanFields.APP_VITALS_START_COLD_VALUE})`,
        `avg(${SpanFields.APP_VITALS_START_WARM_VALUE})`,
        `count(${SpanFields.SPAN_DURATION})`,
      ],
      columns: [SpanFields.TRANSACTION],
      fieldAliases: ['Screen', 'Cold Start', 'Warm Start', 'Screen Loads'],
      conditions: COLD_START_CONDITION,
      orderby: '-count(span.duration)',
      linkedDashboards: [
        {
          field: 'transaction',
          dashboardId: '-1',
          staticDashboardId: 9,
        },
      ],
    },
  ],
  layout: {
    h: 3,
    x: 0,
    y: 2,
    w: 6,
    minH: 2,
  },
};

const SCREEN_RENDERING_TABLE: Widget = {
  id: 'screen-rendering-table',
  title: t('Screen Rendering'),
  description: '',
  displayType: DisplayType.TABLE,
  widgetType: WidgetType.SPANS,
  interval: '1h',
  thresholds: null,
  queries: [
    {
      name: '',
      fields: [
        SpanFields.TRANSACTION,
        `equation|sum(${SpanFields.APP_VITALS_FRAMES_SLOW_COUNT})/sum(${SpanFields.APP_VITALS_FRAMES_TOTAL_COUNT})`,
        `equation|sum(${SpanFields.APP_VITALS_FRAMES_FROZEN_COUNT})/sum(${SpanFields.APP_VITALS_FRAMES_TOTAL_COUNT})`,
        `count(${SpanFields.SPAN_DURATION})`,
      ],
      aggregates: [
        `equation|sum(${SpanFields.APP_VITALS_FRAMES_SLOW_COUNT})/sum(${SpanFields.APP_VITALS_FRAMES_TOTAL_COUNT})`,
        `equation|sum(${SpanFields.APP_VITALS_FRAMES_FROZEN_COUNT})/sum(${SpanFields.APP_VITALS_FRAMES_TOTAL_COUNT})`,
        `count(${SpanFields.SPAN_DURATION})`,
      ],
      columns: [SpanFields.TRANSACTION],
      fieldAliases: ['Transaction', 'Slow Frame %', 'Frozen Frame %', 'Screen Loads'],
      fieldMeta: [
        null,
        {valueType: 'percentage', valueUnit: null},
        {valueType: 'percentage', valueUnit: null},
        null,
      ],
      conditions: TRANSACTION_OP_CONDITION,
      orderby: `-count(${SpanFields.SPAN_DURATION})`,
      linkedDashboards: [
        {
          field: 'transaction',
          dashboardId: '-1',
          staticDashboardId: 11,
        },
      ],
    },
  ],
  layout: {
    h: 3,
    x: 0,
    y: 8,
    w: 6,
    minH: 2,
  },
};

const SCREEN_LOAD_TABLE: Widget = {
  id: 'screen-load-table',
  title: t('Screen Loads'),
  description: '',
  displayType: DisplayType.TABLE,
  widgetType: WidgetType.SPANS,
  interval: '1h',
  thresholds: null,
  queries: [
    {
      name: '',
      fields: [
        SpanFields.TRANSACTION,
        `avg(${SpanFields.APP_VITALS_TTID_VALUE})`,
        `avg(${SpanFields.APP_VITALS_TTFD_VALUE})`,
        `count(${SpanFields.SPAN_DURATION})`,
      ],
      aggregates: [
        `avg(${SpanFields.APP_VITALS_TTID_VALUE})`,
        `avg(${SpanFields.APP_VITALS_TTFD_VALUE})`,
        `count(${SpanFields.SPAN_DURATION})`,
      ],
      columns: [SpanFields.TRANSACTION],
      fieldAliases: ['Screen', 'TTID', 'TTFD', 'Screen Loads'],
      conditions: TTID_CONDITION,
      orderby: '-count(span.duration)',
      linkedDashboards: [
        {
          field: 'transaction',
          dashboardId: '-1',
          staticDashboardId: 10,
        },
      ],
    },
  ],
  layout: {
    h: 3,
    x: 0,
    y: 5,
    w: 6,
    minH: 2,
  },
};

const FIRST_ROW_WIDGETS: Widget[] = [
  COLD_START_BIG_NUMBER_WIDGET,
  WARM_START_BIG_NUMBER_WIDGET,
  AVG_TTID_BIG_NUMBER_WIDGET,
  AVG_TTFD_BIG_NUMBER_WIDGET,
];

const SECOND_ROW_WIDGETS: Widget[] = [
  SLOW_FRAME_RATE_WIDGET,
  FROZEN_FRAME_RATE_WIDGET,
  AVG_FRAME_DELAY_WIDGET,
];

export const MOBILE_VITALS_PREBUILT_CONFIG: PrebuiltDashboard = {
  dateCreated: '',
  title: t('Mobile Vitals as a Dashboard'),
  projects: [],
  widgets: [
    ...FIRST_ROW_WIDGETS,
    ...SECOND_ROW_WIDGETS,
    APP_START_TABLE,
    SCREEN_LOAD_TABLE,
    SCREEN_RENDERING_TABLE,
  ],
  filters: {
    globalFilter: [
      {
        dataset: WidgetType.SPANS,
        tag: {
          key: 'os.name',
          name: 'os.name',
          kind: FieldKind.TAG,
        },
        value: '',
      },
      {
        dataset: WidgetType.SPANS,
        tag: {
          key: 'transaction',
          name: 'transaction',
          kind: FieldKind.TAG,
        },
        value: '',
      },
    ],
  },
};
