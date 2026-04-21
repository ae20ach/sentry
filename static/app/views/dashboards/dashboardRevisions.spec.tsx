import {DashboardFixture} from 'sentry-fixture/dashboard';
import {OrganizationFixture} from 'sentry-fixture/organization';
import {ProjectFixture} from 'sentry-fixture/project';
import {UserFixture} from 'sentry-fixture/user';

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
    createdBy: UserFixture({name: 'Dashboard Owner', email: 'owner@example.com'}),
    ...dashboardOverrides,
  });
  render(<DashboardRevisionsButton dashboard={dashboard} />, {organization});
}

// Clicks the first item in the Edit History list.
async function clickFirstRevisionItem() {
  const [firstItem] = await screen.findAllByRole('option');
  await userEvent.click(firstItem!);
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

  it('opens the modal and renders revision items when clicked', async () => {
    const revisionsRequest = MockApiClient.addMockResponse({
      url: REVISIONS_URL,
      body: [makeRevision()],
    });

    renderButton();
    renderGlobalModal();
    await userEvent.click(screen.getByRole('button', {name: 'Dashboard Revisions'}));

    expect(revisionsRequest).toHaveBeenCalledTimes(1);
    expect(await screen.findAllByRole('option')).toHaveLength(1);
  });

  it('shows the source label for each revision in the list', async () => {
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

    expect(await screen.findByText('Pre-restore')).toBeInTheDocument();
    expect(screen.getByText('Edit')).toBeInTheDocument();
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

  it('shows a non-selectable Current Version item at the top of the list', async () => {
    MockApiClient.addMockResponse({url: REVISIONS_URL, body: [makeRevision()]});

    renderButton();
    renderGlobalModal();
    await userEvent.click(screen.getByRole('button', {name: 'Dashboard Revisions'}));

    expect(await screen.findByText('Current Version')).toBeInTheDocument();
    // Current Version item is not a listbox option
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(1);
  });

  it('shows a prompt to select a revision when the list loads', async () => {
    MockApiClient.addMockResponse({url: REVISIONS_URL, body: [makeRevision()]});

    renderButton();
    renderGlobalModal();
    await userEvent.click(screen.getByRole('button', {name: 'Dashboard Revisions'}));

    expect(await screen.findByText('Select a revision to preview.')).toBeInTheDocument();
  });

  it('does not fetch revision details until an item is clicked', async () => {
    MockApiClient.addMockResponse({url: REVISIONS_URL, body: [makeRevision()]});
    const detailsRequest = MockApiClient.addMockResponse({
      url: REVISION_DETAILS_URL,
      body: makeSnapshot(),
    });

    renderButton();
    renderGlobalModal();
    await userEvent.click(screen.getByRole('button', {name: 'Dashboard Revisions'}));
    await screen.findAllByRole('option');

    expect(detailsRequest).not.toHaveBeenCalled();
  });

  it('fetches and shows a preview when a revision item is clicked', async () => {
    MockApiClient.addMockResponse({url: REVISIONS_URL, body: [makeRevision()]});
    const detailsRequest = MockApiClient.addMockResponse({
      url: REVISION_DETAILS_URL,
      body: makeSnapshot(),
    });

    renderButton();
    renderGlobalModal();
    await userEvent.click(screen.getByRole('button', {name: 'Dashboard Revisions'}));
    await clickFirstRevisionItem();

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
    await clickFirstRevisionItem();

    expect(
      await screen.findByText('Failed to load revision preview.')
    ).toBeInTheDocument();
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
    await clickFirstRevisionItem();

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
    await clickFirstRevisionItem();

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
    await clickFirstRevisionItem();

    await screen.findByText('Error Chart');
    expect(screen.queryByText('Last 14 days')).not.toBeInTheDocument();
    expect(screen.queryByText('production')).not.toBeInTheDocument();
  });

  it('calls the restore endpoint when Revert to Selection is clicked', async () => {
    // jsdom doesn't implement navigation; suppress the expected console.error
    jest.spyOn(console, 'error').mockImplementation(() => {});
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
    await clickFirstRevisionItem();

    await userEvent.click(
      await screen.findByRole('button', {name: 'Revert to Selection'})
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
    await clickFirstRevisionItem();

    await userEvent.click(
      await screen.findByRole('button', {name: 'Revert to Selection'})
    );

    expect(
      await screen.findByText('Failed to restore this revision.')
    ).toBeInTheDocument();
  });
});
