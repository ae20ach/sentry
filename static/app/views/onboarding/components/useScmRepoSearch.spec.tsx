import {OrganizationFixture} from 'sentry-fixture/organization';
import {RepositoryFixture} from 'sentry-fixture/repository';

import {act, renderHookWithProviders, waitFor} from 'sentry-test/reactTestingLibrary';

import {useScmRepoSearch} from './useScmRepoSearch';

function makeRepos(count: number, prefix = 'org/repo') {
  return Array.from({length: count}, (_, i) => ({
    identifier: `${prefix}-${i}`,
    name: `${prefix.split('/')[1]}-${i}`,
    defaultBranch: 'main',
    isInstalled: false,
  }));
}

describe('useScmRepoSearch', () => {
  const organization = OrganizationFixture();
  const reposUrl = `/organizations/${organization.slug}/integrations/1/repos/`;

  afterEach(() => {
    MockApiClient.clearMockResponses();
  });

  it('fires browse request on mount without requiring search', async () => {
    const browseRequest = MockApiClient.addMockResponse({
      url: reposUrl,
      body: {repos: makeRepos(3), searchable: true},
      match: [MockApiClient.matchQuery({accessibleOnly: true, paginate: true})],
    });

    const {result} = renderHookWithProviders(() => useScmRepoSearch('1'), {
      organization,
    });

    await waitFor(() => expect(result.current.dropdownItems).toHaveLength(3));
    expect(browseRequest).toHaveBeenCalled();
    expect(result.current.dropdownItems[0]!.value).toBe('org/repo-0');
  });

  it('uses server-side search when user types', async () => {
    MockApiClient.addMockResponse({
      url: reposUrl,
      body: {repos: makeRepos(5), searchable: true},
      match: [MockApiClient.matchQuery({accessibleOnly: true, paginate: true})],
    });

    const searchRequest = MockApiClient.addMockResponse({
      url: reposUrl,
      body: {
        repos: [{identifier: 'org/match', name: 'match', isInstalled: false}],
        searchable: true,
      },
      match: [MockApiClient.matchQuery({search: 'match', accessibleOnly: true})],
    });

    const {result} = renderHookWithProviders(() => useScmRepoSearch('1'), {
      organization,
    });

    // Wait for browse results first
    await waitFor(() => expect(result.current.dropdownItems).toHaveLength(5));

    // Type a search query
    act(() => {
      result.current.setSearch('match');
    });

    await waitFor(() => expect(searchRequest).toHaveBeenCalled());
    await waitFor(() => expect(result.current.dropdownItems).toHaveLength(1));
    expect(result.current.dropdownItems[0]!.value).toBe('org/match');
  });

  it('returns to browse results when search is cleared', async () => {
    MockApiClient.addMockResponse({
      url: reposUrl,
      body: {repos: makeRepos(3), searchable: true},
      match: [MockApiClient.matchQuery({accessibleOnly: true, paginate: true})],
    });

    MockApiClient.addMockResponse({
      url: reposUrl,
      body: {
        repos: [{identifier: 'org/x', name: 'x', isInstalled: false}],
        searchable: true,
      },
      match: [MockApiClient.matchQuery({search: 'x', accessibleOnly: true})],
    });

    const {result} = renderHookWithProviders(() => useScmRepoSearch('1'), {
      organization,
    });

    await waitFor(() => expect(result.current.dropdownItems).toHaveLength(3));

    // Search
    act(() => {
      result.current.setSearch('x');
    });
    await waitFor(() => expect(result.current.dropdownItems).toHaveLength(1));

    // Clear search -- should return to browse results
    act(() => {
      result.current.setSearch('');
    });
    await waitFor(() => expect(result.current.dropdownItems).toHaveLength(3));
  });

  it('marks the selected repo as disabled in dropdown items', async () => {
    MockApiClient.addMockResponse({
      url: reposUrl,
      body: {
        repos: [
          {identifier: 'org/selected', name: 'selected', isInstalled: false},
          {identifier: 'org/other', name: 'other', isInstalled: false},
        ],
        searchable: true,
      },
      match: [MockApiClient.matchQuery({accessibleOnly: true, paginate: true})],
    });

    const selectedRepo = RepositoryFixture({
      name: 'org/selected',
      externalSlug: 'org/selected',
    });

    const {result} = renderHookWithProviders(() => useScmRepoSearch('1', selectedRepo), {
      organization,
    });

    await waitFor(() => expect(result.current.dropdownItems).toHaveLength(2));

    const selectedItem = result.current.dropdownItems.find(
      item => item.value === 'org/selected'
    );
    const otherItem = result.current.dropdownItems.find(
      item => item.value === 'org/other'
    );
    expect(selectedItem!.disabled).toBe(true);
    expect(otherItem!.disabled).toBe(false);
  });
});
