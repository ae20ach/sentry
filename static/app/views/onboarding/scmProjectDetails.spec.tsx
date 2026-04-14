import {OrganizationFixture} from 'sentry-fixture/organization';
import {ProjectFixture} from 'sentry-fixture/project';
import {TeamFixture} from 'sentry-fixture/team';

import {render, screen, userEvent, waitFor} from 'sentry-test/reactTestingLibrary';

import type {ProductSolution} from 'sentry/components/onboarding/gettingStartedDoc/types';
import {TeamStore} from 'sentry/stores/teamStore';
import type {OnboardingSelectedSDK} from 'sentry/types/onboarding';
import * as analytics from 'sentry/utils/analytics';

import {ScmProjectDetails} from './scmProjectDetails';

const mockPlatform: OnboardingSelectedSDK = {
  key: 'javascript-nextjs',
  name: 'Next.js',
  language: 'javascript',
  category: 'browser',
  link: 'https://docs.sentry.io/platforms/javascript/guides/nextjs/',
  type: 'framework',
};

describe('ScmProjectDetails', () => {
  const organization = OrganizationFixture();
  const teamWithAccess = TeamFixture({slug: 'my-team', access: ['team:admin']});

  const defaultProps = {
    onComplete: jest.fn(),
    onProjectCreated: jest.fn(),
    selectedPlatform: mockPlatform as OnboardingSelectedSDK | undefined,
    selectedFeatures: undefined as ProductSolution[] | undefined,
  };

  function renderComponent(overrides?: Partial<typeof defaultProps>) {
    const props = {...defaultProps, ...overrides};
    return render(<ScmProjectDetails {...props} />, {organization});
  }

  beforeEach(() => {
    TeamStore.loadInitialData([teamWithAccess]);

    // useCreateNotificationAction queries messaging integrations on mount
    MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/integrations/`,
      body: [],
      match: [MockApiClient.matchQuery({integrationType: 'messaging'})],
    });
    // SetupMessagingIntegrationButton queries integration config
    MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/config/integrations/`,
      body: {providers: []},
    });
  });

  afterEach(() => {
    MockApiClient.clearMockResponses();
    jest.restoreAllMocks();
  });

  it('renders step header with heading', async () => {
    renderComponent();

    expect(await screen.findByText('Project details')).toBeInTheDocument();
  });

  it('renders section headers with icons', async () => {
    renderComponent();

    expect(await screen.findByText('Give your project a name')).toBeInTheDocument();
    expect(screen.getByText('Assign a team')).toBeInTheDocument();
    expect(screen.getByText('Alert frequency')).toBeInTheDocument();
    expect(screen.getByText('Get notified when things go wrong')).toBeInTheDocument();
  });

  it('renders project name defaulted from platform key', async () => {
    renderComponent();

    const input = await screen.findByPlaceholderText('project-name');
    expect(input).toHaveValue('javascript-nextjs');
  });

  it('uses platform key as default name even when repository was connected', async () => {
    renderComponent();

    const input = await screen.findByPlaceholderText('project-name');
    expect(input).toHaveValue('javascript-nextjs');
  });

  it('renders card-style alert frequency options', async () => {
    renderComponent();

    expect(await screen.findByText('High priority issues')).toBeInTheDocument();
    expect(screen.getByText('Custom')).toBeInTheDocument();
    expect(screen.getByText("I'll create my own alerts later")).toBeInTheDocument();
  });

  it('create project button is disabled without platform', async () => {
    renderComponent({selectedPlatform: undefined});

    expect(await screen.findByRole('button', {name: 'Create project'})).toBeDisabled();
  });

  it('create project button calls API and completes on success', async () => {
    const onComplete = jest.fn();

    const projectCreationRequest = MockApiClient.addMockResponse({
      url: `/teams/${organization.slug}/${teamWithAccess.slug}/projects/`,
      method: 'POST',
      body: ProjectFixture({slug: 'javascript-nextjs', name: 'javascript-nextjs'}),
    });

    // Mocks for the post-creation organization refetch triggered by ProjectsStore.onCreateSuccess
    MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/`,
      body: organization,
    });
    MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/projects/`,
      body: [],
    });
    MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/teams/`,
      body: [teamWithAccess],
    });

    renderComponent({onComplete});

    const createButton = await screen.findByRole('button', {name: 'Create project'});
    await userEvent.click(createButton);

    await waitFor(() => {
      expect(projectCreationRequest).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it('defaults team selector to first admin team', async () => {
    renderComponent();

    // TeamSelector renders the team slug as the selected value
    expect(await screen.findByText(`#${teamWithAccess.slug}`)).toBeInTheDocument();
  });

  it('calls onProjectCreated with project slug after creation', async () => {
    const createdProject = ProjectFixture({
      slug: 'my-custom-project',
      name: 'my-custom-project',
    });

    MockApiClient.addMockResponse({
      url: `/teams/${organization.slug}/${teamWithAccess.slug}/projects/`,
      method: 'POST',
      body: createdProject,
    });
    MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/`,
      body: organization,
    });
    MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/projects/`,
      body: [],
    });
    MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/teams/`,
      body: [teamWithAccess],
    });

    const onComplete = jest.fn();
    const onProjectCreated = jest.fn();

    renderComponent({onComplete, onProjectCreated});

    await userEvent.click(await screen.findByRole('button', {name: 'Create project'}));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });

    expect(onProjectCreated).toHaveBeenCalledWith('my-custom-project');
  });

  it('shows error message on project creation failure', async () => {
    const onComplete = jest.fn();

    MockApiClient.addMockResponse({
      url: `/teams/${organization.slug}/${teamWithAccess.slug}/projects/`,
      method: 'POST',
      statusCode: 500,
      body: {detail: 'Internal Error'},
    });

    renderComponent({onComplete});

    const createButton = await screen.findByRole('button', {name: 'Create project'});
    await userEvent.click(createButton);

    await waitFor(() => {
      expect(onComplete).not.toHaveBeenCalled();
    });
  });

  it('fires step viewed analytics on mount', async () => {
    const trackAnalyticsSpy = jest.spyOn(analytics, 'trackAnalytics');

    renderComponent();

    await screen.findByText('Project details');

    expect(trackAnalyticsSpy).toHaveBeenCalledWith(
      'onboarding.scm_project_details_step_viewed',
      expect.objectContaining({organization})
    );
  });

  it('fires create analytics on successful project creation', async () => {
    const trackAnalyticsSpy = jest.spyOn(analytics, 'trackAnalytics');

    MockApiClient.addMockResponse({
      url: `/teams/${organization.slug}/${teamWithAccess.slug}/projects/`,
      method: 'POST',
      body: ProjectFixture({slug: 'javascript-nextjs', name: 'javascript-nextjs'}),
    });
    MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/`,
      body: organization,
    });
    MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/projects/`,
      body: [],
    });
    MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/teams/`,
      body: [teamWithAccess],
    });

    const onComplete = jest.fn();

    renderComponent({onComplete});

    await userEvent.click(await screen.findByRole('button', {name: 'Create project'}));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });

    const eventKeys = trackAnalyticsSpy.mock.calls.map(call => call[0]);
    expect(eventKeys).toContain('onboarding.scm_project_details_create_clicked');
    expect(eventKeys).toContain('onboarding.scm_project_details_create_succeeded');
  });
});
