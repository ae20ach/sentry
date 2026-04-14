import {DetectedPlatformFixture} from 'sentry-fixture/detectedPlatform';
import {OrganizationFixture} from 'sentry-fixture/organization';
import {RepositoryFixture} from 'sentry-fixture/repository';

import {render, screen, userEvent, waitFor} from 'sentry-test/reactTestingLibrary';

import {openConsoleModal, openModal} from 'sentry/actionCreators/modal';
import {ProductSolution} from 'sentry/components/onboarding/gettingStartedDoc/types';
import type {Repository} from 'sentry/types/integrations';
import type {OnboardingSelectedSDK} from 'sentry/types/onboarding';
import * as analytics from 'sentry/utils/analytics';

import {ScmPlatformFeatures} from './scmPlatformFeatures';

jest.mock('sentry/actionCreators/modal');

// Mock the virtualizer so all items render in JSDOM (no layout engine).
jest.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: jest.fn(({count}) => ({
    getVirtualItems: () =>
      Array.from({length: count}, (_, i) => ({
        key: i,
        index: i,
        start: i * 36,
        size: 36,
      })),
    getTotalSize: () => count * 36,
    measureElement: jest.fn(),
  })),
}));

// Provide a small platform list so the Select dropdown renders
// a manageable number of options in JSDOM.
jest.mock('sentry/data/platforms', () => {
  const actual = jest.requireActual('sentry/data/platforms');
  return {
    ...actual,
    platforms: actual.platforms.filter(
      (p: {id: string}) =>
        p.id === 'javascript' ||
        p.id === 'javascript-nextjs' ||
        p.id === 'python' ||
        p.id === 'python-django' ||
        p.id === 'nintendo-switch'
    ),
  };
});

const mockRepository = RepositoryFixture({
  id: '42',
  provider: {id: 'integrations:github', name: 'GitHub'},
});

const defaultProps = {
  onComplete: jest.fn(),
  onPlatformChange: jest.fn(),
  onFeaturesChange: jest.fn(),
  selectedPlatform: undefined as OnboardingSelectedSDK | undefined,
  selectedFeatures: undefined as ProductSolution[] | undefined,
  selectedRepository: undefined as Repository | undefined,
};

describe('ScmPlatformFeatures', () => {
  const organization = OrganizationFixture({
    features: ['performance-view', 'session-replay', 'profiling-view'],
  });

  function renderComponent(
    overrides?: Partial<typeof defaultProps>,
    orgOverride?: Parameters<typeof render>[1]['organization']
  ) {
    const props = {...defaultProps, ...overrides};
    return render(<ScmPlatformFeatures {...props} />, {
      organization: orgOverride ?? organization,
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    MockApiClient.clearMockResponses();
  });

  it('renders detected platforms when repository is in context', async () => {
    MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/repos/42/platforms/`,
      body: {
        platforms: [
          DetectedPlatformFixture(),
          DetectedPlatformFixture({
            platform: 'python-django',
            language: 'Python',
            priority: 2,
          }),
        ],
      },
    });

    renderComponent({selectedRepository: mockRepository});

    expect(await screen.findByText('Next.js')).toBeInTheDocument();
    expect(screen.getByText('Django')).toBeInTheDocument();
  });

  it('auto-selects first detected platform', async () => {
    MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/repos/42/platforms/`,
      body: {
        platforms: [
          DetectedPlatformFixture(),
          DetectedPlatformFixture({
            platform: 'python-django',
            language: 'Python',
            priority: 2,
          }),
        ],
      },
    });

    renderComponent({selectedRepository: mockRepository});

    expect(await screen.findByText('What do you want to set up?')).toBeInTheDocument();
  });

  it('clicking "Change platform" shows manual picker', async () => {
    MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/repos/42/platforms/`,
      body: {
        platforms: [
          DetectedPlatformFixture(),
          DetectedPlatformFixture({
            platform: 'python-django',
            language: 'Python',
            priority: 2,
          }),
        ],
      },
    });

    renderComponent({selectedRepository: mockRepository});

    const changeButton = await screen.findByRole('button', {
      name: "Doesn't look right? Change platform",
    });
    await userEvent.click(changeButton);

    expect(screen.getByRole('heading', {name: 'Select a platform'})).toBeInTheDocument();
  });

  it('falls back to manual picker when platform detection fails', async () => {
    MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/repos/42/platforms/`,
      statusCode: 500,
      body: {detail: 'Internal Error'},
    });

    renderComponent({selectedRepository: mockRepository});

    expect(
      await screen.findByRole('heading', {name: 'Select a platform'})
    ).toBeInTheDocument();
    expect(screen.queryByText('Recommended SDK')).not.toBeInTheDocument();
  });

  it('renders manual picker when no repository in context', async () => {
    renderComponent();

    expect(
      await screen.findByRole('heading', {name: 'Select a platform'})
    ).toBeInTheDocument();
    expect(screen.queryByText('Recommended SDK')).not.toBeInTheDocument();
  });

  it('continue button is disabled when no platform selected', async () => {
    renderComponent();

    // Wait for the component to fully settle (CompactSelect triggers async popper updates)
    await screen.findByRole('heading', {name: 'Select a platform'});

    expect(screen.getByRole('button', {name: 'Continue'})).toBeDisabled();
  });

  it('continue button is enabled when platform is selected', async () => {
    MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/repos/42/platforms/`,
      body: {
        platforms: [DetectedPlatformFixture()],
      },
    });

    renderComponent({selectedRepository: mockRepository});

    // Wait for auto-select of first detected platform
    await waitFor(() => {
      expect(screen.getByRole('button', {name: 'Continue'})).toBeEnabled();
    });
  });

  it('enabling profiling auto-enables tracing', async () => {
    const pythonPlatform = DetectedPlatformFixture({
      platform: 'python',
      language: 'Python',
    });

    MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/repos/42/platforms/`,
      body: {platforms: [pythonPlatform]},
    });

    const onFeaturesChange = jest.fn();

    renderComponent({
      selectedRepository: mockRepository,
      selectedFeatures: [ProductSolution.ERROR_MONITORING],
      onFeaturesChange,
    });

    // Wait for feature cards to appear
    await screen.findByText('What do you want to set up?');

    // Neither profiling nor tracing should be checked initially
    expect(screen.getByRole('checkbox', {name: /Profiling/})).not.toBeChecked();
    expect(screen.getByRole('checkbox', {name: /Tracing/})).not.toBeChecked();

    // Enable profiling — tracing should auto-enable
    await userEvent.click(screen.getByRole('checkbox', {name: /Profiling/}));

    // The component calls onFeaturesChange with both profiling and tracing enabled
    expect(onFeaturesChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        ProductSolution.ERROR_MONITORING,
        ProductSolution.PROFILING,
        ProductSolution.PERFORMANCE_MONITORING,
      ])
    );
  });

  it('shows framework suggestion modal when selecting a base language', async () => {
    const mockOpenModal = openModal as jest.Mock;

    renderComponent();

    await screen.findByRole('heading', {name: 'Select a platform'});

    // Type into the Select to search and pick a base language
    await userEvent.type(screen.getByRole('textbox'), 'JavaScript');
    await userEvent.click(await screen.findByText('Browser JavaScript'));

    await waitFor(() => {
      expect(mockOpenModal).toHaveBeenCalled();
    });
  });

  it('opens console modal when selecting a disabled gaming platform', async () => {
    const mockOpenConsoleModal = openConsoleModal as jest.Mock;

    renderComponent(
      {},
      // No enabledConsolePlatforms — all console platforms are blocked
      OrganizationFixture({
        features: ['performance-view', 'session-replay', 'profiling-view'],
      })
    );

    await screen.findByRole('heading', {name: 'Select a platform'});

    // Type into the Select to search and pick a console platform
    await userEvent.type(screen.getByRole('textbox'), 'Nintendo');
    await userEvent.click(await screen.findByText('Nintendo Switch'));

    await waitFor(() => {
      expect(mockOpenConsoleModal).toHaveBeenCalled();
    });
  });

  it('disabling tracing auto-disables profiling', async () => {
    const pythonPlatform = DetectedPlatformFixture({
      platform: 'python',
      language: 'Python',
    });

    MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/repos/42/platforms/`,
      body: {platforms: [pythonPlatform]},
    });

    const onFeaturesChange = jest.fn();

    renderComponent({
      selectedRepository: mockRepository,
      selectedPlatform: {
        key: 'python',
        name: 'Python',
        language: 'python',
        type: 'language',
        link: 'https://docs.sentry.io/platforms/python/',
        category: 'popular',
      },
      selectedFeatures: [
        ProductSolution.ERROR_MONITORING,
        ProductSolution.PERFORMANCE_MONITORING,
        ProductSolution.PROFILING,
      ],
      onFeaturesChange,
    });

    // Wait for feature cards to appear
    await screen.findByText('What do you want to set up?');

    // Both should be checked initially
    expect(screen.getByRole('checkbox', {name: /Tracing/})).toBeChecked();
    expect(screen.getByRole('checkbox', {name: /Profiling/})).toBeChecked();

    // Disable tracing — profiling should auto-disable
    await userEvent.click(screen.getByRole('checkbox', {name: /Tracing/}));

    // The component calls onFeaturesChange with both tracing and profiling removed
    expect(onFeaturesChange).toHaveBeenCalledWith([ProductSolution.ERROR_MONITORING]);
  });

  describe('analytics', () => {
    let trackAnalyticsSpy: jest.SpyInstance;

    beforeEach(() => {
      trackAnalyticsSpy = jest.spyOn(analytics, 'trackAnalytics');
    });

    it('fires step viewed event on mount', async () => {
      renderComponent();

      await screen.findByRole('heading', {name: 'Select a platform'});

      expect(trackAnalyticsSpy).toHaveBeenCalledWith(
        'onboarding.scm_platform_features_step_viewed',
        expect.objectContaining({organization})
      );
    });

    it('fires platform selected event when clicking a detected platform', async () => {
      MockApiClient.addMockResponse({
        url: `/organizations/${organization.slug}/repos/42/platforms/`,
        body: {
          platforms: [
            DetectedPlatformFixture(),
            DetectedPlatformFixture({
              platform: 'python-django',
              language: 'Python',
              priority: 2,
            }),
          ],
        },
      });

      renderComponent({selectedRepository: mockRepository});

      // Wait for detected platforms, then click the second one
      const djangoCard = await screen.findByRole('radio', {name: /Django/});
      await userEvent.click(djangoCard);

      expect(trackAnalyticsSpy).toHaveBeenCalledWith(
        'onboarding.scm_platform_selected',
        expect.objectContaining({
          platform: 'python-django',
          source: 'detected',
        })
      );
    });

    it('fires feature toggled event when toggling a feature', async () => {
      MockApiClient.addMockResponse({
        url: `/organizations/${organization.slug}/repos/42/platforms/`,
        body: {
          platforms: [DetectedPlatformFixture({platform: 'python', language: 'Python'})],
        },
      });

      renderComponent({
        selectedRepository: mockRepository,
        selectedFeatures: [ProductSolution.ERROR_MONITORING],
      });

      await screen.findByText('What do you want to set up?');

      await userEvent.click(screen.getByRole('checkbox', {name: /Tracing/}));

      expect(trackAnalyticsSpy).toHaveBeenCalledWith(
        'onboarding.scm_platform_feature_toggled',
        expect.objectContaining({
          feature: ProductSolution.PERFORMANCE_MONITORING,
          enabled: true,
          platform: 'python',
        })
      );
    });

    it('fires change platform event when clicking the link', async () => {
      MockApiClient.addMockResponse({
        url: `/organizations/${organization.slug}/repos/42/platforms/`,
        body: {platforms: [DetectedPlatformFixture()]},
      });

      renderComponent({selectedRepository: mockRepository});

      const changeButton = await screen.findByRole('button', {
        name: "Doesn't look right? Change platform",
      });
      await userEvent.click(changeButton);

      expect(trackAnalyticsSpy).toHaveBeenCalledWith(
        'onboarding.scm_platform_change_platform_clicked',
        expect.objectContaining({organization})
      );
    });
  });
});
