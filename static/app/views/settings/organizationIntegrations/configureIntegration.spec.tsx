import {OpsgenieIntegrationFixture} from 'sentry-fixture/opsgenieIntegration';
import {OpsgenieIntegrationProviderFixture} from 'sentry-fixture/opsgenieIntegrationProvider';
import {OrganizationFixture} from 'sentry-fixture/organization';
import {VercelProviderFixture} from 'sentry-fixture/vercelIntegration';
import {VercelOrganizationIntegrationFixture} from 'sentry-fixture/vercelOrganizationIntegration';

import {
  render,
  renderGlobalModal,
  screen,
  userEvent,
  waitFor,
} from 'sentry-test/reactTestingLibrary';

import ConfigureIntegration from 'sentry/views/settings/organizationIntegrations/configureIntegration';

describe('OpsgenieMigrationButton', () => {
  const org = OrganizationFixture({
    access: ['org:integrations', 'org:write'],
  });
  const integrationId = '1';
  it('Migrate Plugin button hits migration endpoint', async () => {
    MockApiClient.addMockResponse({
      url: `/organizations/${org.slug}/config/integrations/`,
      body: {
        providers: [OpsgenieIntegrationProviderFixture()],
      },
    });

    MockApiClient.addMockResponse({
      url: `/organizations/${org.slug}/integrations/${integrationId}/`,
      body: OpsgenieIntegrationFixture(),
    });

    MockApiClient.addMockResponse({
      url: `/organizations/${org.slug}/plugins/configs/`,
      body: [
        {
          id: 'opsgenie',
          name: 'Opsgenie',
          slug: 'opsgenie',
          projectList: [
            {
              projectId: 2,
              projectSlug: 'python',
              projectName: 'python',
              enabled: true,
              configured: true,
              projectPlatform: 'python',
            },
          ],
        },
      ],
    });

    const onConfirmCall = MockApiClient.addMockResponse({
      url: `/organizations/${org.slug}/integrations/${integrationId}/migrate-opsgenie/`,
      method: 'PUT',
    });

    render(<ConfigureIntegration />, {
      organization: org,
      initialRouterConfig: {
        location: {
          pathname: `/settings/${org.slug}/integrations/opsgenie/${integrationId}/`,
          query: {},
        },
        route: '/settings/:orgId/integrations/:providerKey/:integrationId/',
      },
    });
    renderGlobalModal();
    expect(await screen.findByRole('button', {name: 'Migrate Plugin'})).toBeEnabled();

    await userEvent.click(screen.getByRole('button', {name: 'Migrate Plugin'}));

    expect(screen.getByRole('button', {name: 'Confirm'})).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', {name: 'Confirm'}));

    expect(onConfirmCall).toHaveBeenCalled();
  });
});

describe('VercelRotateApiKeyButton', () => {
  const org = OrganizationFixture({
    access: ['org:integrations', 'org:write'],
  });
  const integrationId = '1';

  function setupMocks() {
    MockApiClient.addMockResponse({
      url: `/organizations/${org.slug}/config/integrations/`,
      body: {providers: [VercelProviderFixture()]},
    });
    MockApiClient.addMockResponse({
      url: `/organizations/${org.slug}/integrations/${integrationId}/`,
      body: VercelOrganizationIntegrationFixture(),
    });
    MockApiClient.addMockResponse({
      url: `/organizations/${org.slug}/plugins/configs/`,
      body: [],
    });
  }

  function renderConfigureIntegration() {
    render(<ConfigureIntegration />, {
      organization: org,
      initialRouterConfig: {
        location: {
          pathname: `/settings/${org.slug}/integrations/vercel/${integrationId}/`,
          query: {},
        },
        route: '/settings/:orgId/integrations/:providerKey/:integrationId/',
      },
    });
  }

  it('shows the Rotate API Key button for Vercel and confirms before posting', async () => {
    setupMocks();
    const rotateRequest = MockApiClient.addMockResponse({
      url: `/organizations/${org.slug}/integrations/${integrationId}/vercel/rotate-api-key/`,
      method: 'POST',
      body: {projectMappingsSynced: 2},
    });

    renderConfigureIntegration();
    renderGlobalModal();

    expect(await screen.findByRole('button', {name: 'Rotate API Key'})).toBeEnabled();

    await userEvent.click(screen.getByRole('button', {name: 'Rotate API Key'}));

    expect(screen.getByRole('button', {name: 'Confirm'})).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', {name: 'Confirm'}));

    await waitFor(() => expect(rotateRequest).toHaveBeenCalled());
  });

  it('still calls the endpoint when the user confirms', async () => {
    setupMocks();
    const rotateRequest = MockApiClient.addMockResponse({
      url: `/organizations/${org.slug}/integrations/${integrationId}/vercel/rotate-api-key/`,
      method: 'POST',
      body: {detail: 'Cannot rotate: project foo has no enabled DSN.'},
      statusCode: 400,
    });

    renderConfigureIntegration();
    renderGlobalModal();

    await userEvent.click(await screen.findByRole('button', {name: 'Rotate API Key'}));
    await userEvent.click(screen.getByRole('button', {name: 'Confirm'}));

    await waitFor(() => expect(rotateRequest).toHaveBeenCalled());
  });
});
