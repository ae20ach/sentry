import * as Sentry from '@sentry/react';
import {OrganizationFixture} from 'sentry-fixture/organization';
import {PageFilterStateFixture} from 'sentry-fixture/pageFilters';

import {render, screen} from 'sentry-test/reactTestingLibrary';

jest.mock('@sentry/react', () => ({
  ...jest.requireActual('@sentry/react'),
  captureMessage: jest.fn(),
}));

import {usePageFilters} from 'sentry/components/pageFilters/usePageFilters';
import {DisplayType, WidgetType} from 'sentry/views/dashboards/types';
import {VisualizationWidget} from 'sentry/views/dashboards/widgetCard/visualizationWidget';
import {WidgetCardDataLoader} from 'sentry/views/dashboards/widgetCard/widgetCardDataLoader';

jest.mock('sentry/components/pageFilters/usePageFilters');
jest.mock('sentry/views/dashboards/widgetCard/widgetCardDataLoader');
jest.mock(
  'sentry/views/dashboards/widgets/timeSeriesWidget/timeSeriesWidgetVisualization',
  () => ({
    TimeSeriesWidgetVisualization: jest.fn(() => <div data-testid="chart" />),
  })
);

const spansBreakdownWidget = {
  title: 'Cache Miss Rate',
  description: '',
  interval: '5m',
  displayType: DisplayType.LINE,
  widgetType: WidgetType.SPANS,
  legendType: 'breakdown' as const,
  queries: [
    {
      name: '',
      conditions: 'span.op:[cache.get,cache.get_item]',
      fields: ['transaction', 'count()'],
      aggregates: ['count()'],
      columns: ['transaction'],
      orderby: '',
    },
  ],
};

const selection = PageFilterStateFixture().selection;

// Series name format for a grouped SPANS query: "<groupValue> : <aggregate>"
const timeseriesResults = [
  {
    seriesName: 'my_transaction : count()',
    data: [{name: 1_000_000, value: 10}],
    color: '#000',
  },
];

// tableResults must be non-empty to trigger showBreakdownData
const tableResults = [
  {
    title: '',
    data: [{transaction: 'my_transaction', 'count()': 10}],
    meta: {fields: {transaction: 'string', 'count()': 'integer'}, units: {}},
  },
];

beforeEach(() => {
  jest.mocked(usePageFilters).mockReturnValue(PageFilterStateFixture());
  MockApiClient.addMockResponse({
    url: '/organizations/org-slug/releases/stats/',
    body: [],
  });
  jest.mocked(WidgetCardDataLoader).mockImplementation(({children}: any) =>
    children({
      timeseriesResults,
      tableResults,
      loading: false,
      errorMessage: undefined,
      confidence: undefined,
      dataScanned: undefined,
      isSampled: undefined,
      sampleCount: undefined,
    })
  );
});

describe('VisualizationWidget error handling', () => {
  it('captures a Sentry message when errorMessage is returned from the data loader', () => {
    jest.mocked(WidgetCardDataLoader).mockImplementationOnce(({children}: any) =>
      children({
        timeseriesResults: undefined,
        tableResults: undefined,
        loading: false,
        errorMessage: 'Internal server error',
        confidence: undefined,
        dataScanned: undefined,
        isSampled: undefined,
        sampleCount: undefined,
      })
    );

    render(<VisualizationWidget widget={spansBreakdownWidget} selection={selection} />, {
      organization: OrganizationFixture(),
    });

    expect(
      screen.getByText('There was an error loading this widget.')
    ).toBeInTheDocument();
    expect(Sentry.captureMessage).toHaveBeenCalledWith('Dashboard widget query error', {
      level: 'error',
      extra: {
        widget_title: spansBreakdownWidget.title,
        error_message: 'Internal server error',
      },
    });
  });
});

describe('VisualizationWidget breakdown series labels', () => {
  it('renders series labels as plain text without visibility-explore-view', () => {
    render(<VisualizationWidget widget={spansBreakdownWidget} selection={selection} />, {
      organization: OrganizationFixture({features: []}),
    });

    expect(screen.queryByRole('link', {name: 'my_transaction'})).not.toBeInTheDocument();
    expect(screen.getByText('my_transaction')).toBeInTheDocument();
  });

  it('renders series labels as explore links with visibility-explore-view', () => {
    render(<VisualizationWidget widget={spansBreakdownWidget} selection={selection} />, {
      organization: OrganizationFixture({features: ['visibility-explore-view']}),
    });

    expect(screen.getByRole('link', {name: 'my_transaction'})).toBeInTheDocument();
  });
});
