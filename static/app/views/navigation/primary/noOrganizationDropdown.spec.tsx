import {ConfigFixture} from 'sentry-fixture/config';

import {render, screen, userEvent} from 'sentry-test/reactTestingLibrary';

import {ConfigStore} from 'sentry/stores/configStore';
import {NoOrganizationDropdown} from 'sentry/views/navigation/primary/noOrganizationDropdown';

describe('NoOrganizationDropdown', () => {
  beforeEach(() => {
    ConfigStore.loadInitialData(
      ConfigFixture({
        features: new Set(['organizations:create']),
      })
    );
  });

  it('renders a dropdown with Sentry logo', () => {
    render(<NoOrganizationDropdown />);

    expect(screen.getByRole('button', {name: 'Organization menu'})).toBeInTheDocument();
  });

  it('shows create organization link when opened', async () => {
    render(<NoOrganizationDropdown />);

    await userEvent.click(screen.getByRole('button', {name: 'Organization menu'}));

    expect(
      await screen.findByRole('menuitem', {name: 'Create a new organization'})
    ).toBeInTheDocument();
  });

  it('hides create organization link when feature is disabled', async () => {
    ConfigStore.loadInitialData(
      ConfigFixture({
        features: new Set([]),
      })
    );

    render(<NoOrganizationDropdown />);

    await userEvent.click(screen.getByRole('button', {name: 'Organization menu'}));

    expect(
      screen.queryByRole('menuitem', {name: 'Create a new organization'})
    ).not.toBeInTheDocument();
  });

  it('uses external link for multi-region', async () => {
    ConfigStore.loadInitialData(
      ConfigFixture({
        features: new Set(['organizations:create', 'system:multi-region']),
        links: {
          sentryUrl: 'https://sentry.io',
        },
      })
    );

    render(<NoOrganizationDropdown />);

    await userEvent.click(screen.getByRole('button', {name: 'Organization menu'}));

    const link = await screen.findByRole('menuitem', {name: 'Create a new organization'});
    expect(link).toHaveAttribute('href', 'https://sentry.io/organizations/new/');
  });

  it('uses internal link for non-multi-region', async () => {
    ConfigStore.loadInitialData(
      ConfigFixture({
        features: new Set(['organizations:create']),
      })
    );

    render(<NoOrganizationDropdown />);

    await userEvent.click(screen.getByRole('button', {name: 'Organization menu'}));

    const link = await screen.findByRole('menuitem', {name: 'Create a new organization'});
    expect(link).toHaveAttribute('href', '/organizations/new/');
  });
});
