import {DashboardFixture} from 'sentry-fixture/dashboard';
import {OrganizationFixture} from 'sentry-fixture/organization';
import {ProjectFixture} from 'sentry-fixture/project';

import {
  render,
  renderGlobalModal,
  screen,
  userEvent,
  waitFor,
} from 'sentry-test/reactTestingLibrary';

import {ProjectsStore} from 'sentry/stores/projectsStore';

import {DashboardRevisionsButton} from './dashboardRevisions';

const REVISIONS_URL = '/organizations/org-slug/dashboards/1/revisions/';
const REVISION_DETAILS_URL = '/organizations/org-slug/dashboards/1/revisions/1/';
const RESTORE_URL = '/organizations/org-slug/dashboards/1/revisions/1/restore/';

function makeRevision(overrides = {}) {
  return {
    id: '1',
    title: 'My Dashboard',
    source: 'edit' as const,
    createdBy: {id: '42', name: 'Alice', email: 'alice@example.com'},
    dateCreated: '2024-01-15T10:00:00Z',
    ...overrides,
  };
}

function makeSnapshot(overrides = {}) {
  return {
    id: '1',
    title: 'My Dashboard',
    dateCreated: '2024-01-15T10:00:00Z',
    widgets: [
      {
        id: '10',
        title: 'Error Chart',
        displayType: 'line',
        queries: [],
        interval: '1h',
      },
      {
        id: '11',
        title: 'Transactions',
        displayType: 'bar',
        queries: [],
        interval: '1h',
      },
    ],
    filters: {},
    projects: [],
    ...overrides,
  };
}

function renderButton(dashboardOverrides = {}) {
  const organization = OrganizationFixture({features: ['dashboards-revisions']});
  const dashboard = DashboardFixture([], {
    id: '1',
    title: 'My Dashboard',
    ...dashboardOverrides,
  });
  render(<DashboardRevisionsButton dashboard={dashboard} />, {organization});
}

// Clicks the first data row in the revision list (skipping the header row).
async function clickFirstRevisionRow() {
  const [, firstRow] = await screen.findAllByRole('row');
  await userEvent.click(firstRow!);
}

describe('DashboardRevisionsButton', () => {
  afterEach(() => {
    MockApiClient.clearMockResponses();
  });

  it('renders the button', () => {
    MockApiClient.addMockResponse({url: REVISIONS_URL, body: []});
    renderButton();
    expect(screen.getByRole('button', {name: 'Dashboard Revisions'})).toBeInTheDocument();
  });

  it('renders nothing for the default-overview dashboard', () => {
    renderButton({id: 'default-overview'});
    expect(
      screen.queryByRole('button', {name: 'Dashboard Revisions'})
    ).not.toBeInTheDocument();
  });

  it('renders nothing for a prebuilt dashboard', () => {
    renderButton({prebuiltId: 'default-overview'});
    expect(
      screen.queryByRole('button', {name: 'Dashboard Revisions'})
    ).not.toBeInTheDocument();
  });

  it('does not call the revisions endpoint until the button is clicked', () => {
    const revisionsRequest = MockApiClient.addMockResponse({
      url: REVISIONS_URL,
      body: [],
    });
    renderButton();
    expect(revisionsRequest).not.toHaveBeenCalled();
  });

  it('opens the modal and renders revision rows when clicked', async () => {
    const revisionsRequest = MockApiClient.addMockResponse({
      url: REVISIONS_URL,
      body: [makeRevision()],
    });

    renderButton();
    renderGlobalModal();
    await userEvent.click(screen.getByRole('button', {name: 'Dashboard Revisions'}));

    expect(revisionsRequest).toHaveBeenCalledTimes(1);
    // header row + 1 data row
    expect(await screen.findAllByRole('row')).toHaveLength(2);
  });

  it('shows the pre-restore badge for revisions with source pre-restore', async () => {
    MockApiClient.addMockResponse({
      url: REVISIONS_URL,
      body: [
        makeRevision({source: 'pre-restore' as const}),
        makeRevision({id: '2', source: 'edit' as const}),
      ],
    });

    renderButton();
    renderGlobalModal();
    await userEvent.click(screen.getByRole('button', {name: 'Dashboard Revisions'}));

    expect(await screen.findByText('pre-restore')).toBeInTheDocument();
    expect(screen.getAllByText('pre-restore')).toHaveLength(1);
  });

  it('shows the empty state when no revisions exist', async () => {
    MockApiClient.addMockResponse({url: REVISIONS_URL, body: []});

    renderButton();
    renderGlobalModal();
    await userEvent.click(screen.getByRole('button', {name: 'Dashboard Revisions'}));

    expect(await screen.findByText('No revisions found.')).toBeInTheDocument();
  });

  it('shows an error state when the revisions API request fails', async () => {
    MockApiClient.addMockResponse({url: REVISIONS_URL, statusCode: 500, body: {}});

    renderButton();
    renderGlobalModal();
    await userEvent.click(screen.getByRole('button', {name: 'Dashboard Revisions'}));

    expect(
      await screen.findByText('Failed to load dashboard revisions.')
    ).toBeInTheDocument();
  });

  it('shows a prompt to select a revision when the list loads', async () => {
    MockApiClient.addMockResponse({url: REVISIONS_URL, body: [makeRevision()]});

    renderButton();
    renderGlobalModal();
    await userEvent.click(screen.getByRole('button', {name: 'Dashboard Revisions'}));

    expect(await screen.findByText('Select a revision to preview.')).toBeInTheDocument();
  });

  it('does not fetch revision details until a row is clicked', async () => {
    MockApiClient.addMockResponse({url: REVISIONS_URL, body: [makeRevision()]});
    const detailsRequest = MockApiClient.addMockResponse({
      url: REVISION_DETAILS_URL,
      body: makeSnapshot(),
    });

    renderButton();
    renderGlobalModal();
    await userEvent.click(screen.getByRole('button', {name: 'Dashboard Revisions'}));
    await screen.findAllByRole('row');

    expect(detailsRequest).not.toHaveBeenCalled();
  });

  it('fetches and shows a preview when a revision row is clicked', async () => {
    MockApiClient.addMockResponse({url: REVISIONS_URL, body: [makeRevision()]});
    const detailsRequest = MockApiClient.addMockResponse({
      url: REVISION_DETAILS_URL,
      body: makeSnapshot(),
    });

    renderButton();
    renderGlobalModal();
    await userEvent.click(screen.getByRole('button', {name: 'Dashboard Revisions'}));
    await clickFirstRevisionRow();

    expect(detailsRequest).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Error Chart')).toBeInTheDocument();
    expect(screen.getByText('Transactions')).toBeInTheDocument();
  });

  it('shows the author name in the revision list', async () => {
    MockApiClient.addMockResponse({url: REVISIONS_URL, body: [makeRevision()]});

    renderButton();
    renderGlobalModal();
    await userEvent.click(screen.getByRole('button', {name: 'Dashboard Revisions'}));

    expect(await screen.findByText('Alice')).toBeInTheDocument();
  });

  it('falls back to email when createdBy has no name', async () => {
    MockApiClient.addMockResponse({
      url: REVISIONS_URL,
      body: [makeRevision({createdBy: {id: '42', name: '', email: 'alice@example.com'}})],
    });

    renderButton();
    renderGlobalModal();
    await userEvent.click(screen.getByRole('button', {name: 'Dashboard Revisions'}));

    expect(await screen.findByText('alice@example.com')).toBeInTheDocument();
  });

  it('shows "Unknown" when createdBy is null', async () => {
    MockApiClient.addMockResponse({
      url: REVISIONS_URL,
      body: [makeRevision({createdBy: null})],
    });

    renderButton();
    renderGlobalModal();
    await userEvent.click(screen.getByRole('button', {name: 'Dashboard Revisions'}));

    expect(await screen.findByText('Unknown')).toBeInTheDocument();
  });

  it('shows an error when the revision details request fails', async () => {
    MockApiClient.addMockResponse({url: REVISIONS_URL, body: [makeRevision()]});
    MockApiClient.addMockResponse({
      url: REVISION_DETAILS_URL,
      statusCode: 500,
      body: {},
    });

    renderButton();
    renderGlobalModal();
    await userEvent.click(screen.getByRole('button', {name: 'Dashboard Revisions'}));
    await clickFirstRevisionRow();

    expect(
      await screen.findByText('Failed to load revision preview.')
    ).toBeInTheDocument();
  });

  it('shows the dashboard title above the minimap preview', async () => {
    MockApiClient.addMockResponse({url: REVISIONS_URL, body: [makeRevision()]});
    MockApiClient.addMockResponse({
      url: REVISION_DETAILS_URL,
      body: makeSnapshot({title: 'Snapshot Dashboard'}),
    });

    renderButton();
    renderGlobalModal();
    await userEvent.click(screen.getByRole('button', {name: 'Dashboard Revisions'}));
    await clickFirstRevisionRow();

    expect(await screen.findByText('Snapshot Dashboard')).toBeInTheDocument();
  });

  it('shows filter pills for period, environments, and releases', async () => {
    MockApiClient.addMockResponse({url: REVISIONS_URL, body: [makeRevision()]});
    MockApiClient.addMockResponse({
      url: REVISION_DETAILS_URL,
      body: makeSnapshot({
        period: '14d',
        environment: ['production', 'staging'],
        filters: {release: ['v1.0.0']},
      }),
    });

    renderButton();
    renderGlobalModal();
    await userEvent.click(screen.getByRole('button', {name: 'Dashboard Revisions'}));
    await clickFirstRevisionRow();

    expect(await screen.findByText('Last 14 days')).toBeInTheDocument();
    expect(screen.getByText('production')).toBeInTheDocument();
    expect(screen.getByText('staging')).toBeInTheDocument();
    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
  });

  it('shows project slugs resolved from the projects store', async () => {
    ProjectsStore.loadInitialData([
      ProjectFixture({id: '10', slug: 'backend'}),
      ProjectFixture({id: '11', slug: 'frontend'}),
    ]);
    MockApiClient.addMockResponse({url: REVISIONS_URL, body: [makeRevision()]});
    MockApiClient.addMockResponse({
      url: REVISION_DETAILS_URL,
      body: makeSnapshot({projects: [10, 11]}),
    });

    renderButton();
    renderGlobalModal();
    await userEvent.click(screen.getByRole('button', {name: 'Dashboard Revisions'}));
    await clickFirstRevisionRow();

    expect(await screen.findByText('backend')).toBeInTheDocument();
    expect(screen.getByText('frontend')).toBeInTheDocument();
  });

  it('shows no filter pills when no explicit filters are set', async () => {
    MockApiClient.addMockResponse({url: REVISIONS_URL, body: [makeRevision()]});
    MockApiClient.addMockResponse({
      url: REVISION_DETAILS_URL,
      body: makeSnapshot({period: undefined, environment: [], filters: {}}),
    });

    renderButton();
    renderGlobalModal();
    await userEvent.click(screen.getByRole('button', {name: 'Dashboard Revisions'}));
    await clickFirstRevisionRow();

    await screen.findByText('Error Chart');
    expect(screen.queryByText('Last 14 days')).not.toBeInTheDocument();
    expect(screen.queryByText('production')).not.toBeInTheDocument();
  });

  it('calls the restore endpoint when the Restore button is clicked', async () => {
    MockApiClient.addMockResponse({url: REVISIONS_URL, body: [makeRevision()]});
    MockApiClient.addMockResponse({url: REVISION_DETAILS_URL, body: makeSnapshot()});
    const restoreRequest = MockApiClient.addMockResponse({
      url: RESTORE_URL,
      method: 'POST',
      body: {},
    });

    renderButton();
    renderGlobalModal();
    await userEvent.click(screen.getByRole('button', {name: 'Dashboard Revisions'}));
    await clickFirstRevisionRow();

    await userEvent.click(
      await screen.findByRole('button', {name: 'Restore this version'})
    );

    await waitFor(() => expect(restoreRequest).toHaveBeenCalledTimes(1));
  });

  it('shows an error when the restore request fails', async () => {
    MockApiClient.addMockResponse({url: REVISIONS_URL, body: [makeRevision()]});
    MockApiClient.addMockResponse({url: REVISION_DETAILS_URL, body: makeSnapshot()});
    MockApiClient.addMockResponse({
      url: RESTORE_URL,
      method: 'POST',
      statusCode: 500,
      body: {},
    });

    renderButton();
    renderGlobalModal();
    await userEvent.click(screen.getByRole('button', {name: 'Dashboard Revisions'}));
    await clickFirstRevisionRow();

    await userEvent.click(
      await screen.findByRole('button', {name: 'Restore this version'})
    );

    expect(
      await screen.findByText('Failed to restore this revision.')
    ).toBeInTheDocument();
  });
});
