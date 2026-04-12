import {GitHubIntegrationProviderFixture} from 'sentry-fixture/githubIntegrationProvider';
import {OrganizationFixture} from 'sentry-fixture/organization';

import {render, screen, userEvent} from 'sentry-test/reactTestingLibrary';

import {PostMessageProvider} from 'sentry/utils/window/usePostMessage';
import {AddIntegrationButton} from 'sentry/views/settings/organizationIntegrations/addIntegrationButton';

describe('AddIntegrationButton', () => {
  const provider = GitHubIntegrationProviderFixture();

  it('Opens the setup dialog on click', async () => {
    const focus = jest.fn();
    const popup = {focus, close: jest.fn()} as unknown as Window;
    jest.spyOn(window, 'open').mockReturnValue(popup);

    render(
      <PostMessageProvider>
        <AddIntegrationButton
          provider={provider}
          onAddIntegration={jest.fn()}
          organization={OrganizationFixture()}
        />
      </PostMessageProvider>
    );

    await userEvent.click(screen.getByLabelText('Add integration'));
    expect(window.open).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(window.open).toHaveBeenCalledWith(
      expect.any(String),
      'sentryAddIntegration',
      'scrollbars=yes,width=100,height=100,top=334,left=462'
    );
  });
});
