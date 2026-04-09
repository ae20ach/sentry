from unittest.mock import MagicMock, patch

from sentry.integrations.github.client import CachedRepo
from sentry.testutils.cases import APITestCase


def _make_cached_repo(
    id: int,
    name: str,
    full_name: str,
    default_branch: str | None = "main",
    archived: bool = False,
) -> CachedRepo:
    return {
        "id": id,
        "name": name,
        "full_name": full_name,
        "default_branch": default_branch,
        "archived": archived,
    }


class OrganizationIntegrationReposTest(APITestCase):
    def setUp(self) -> None:
        super().setUp()

        self.login_as(user=self.user)
        self.org = self.create_organization(owner=self.user, name="baz")
        self.project = self.create_project(organization=self.org)
        self.integration = self.create_integration(
            organization=self.org, provider="github", name="Example", external_id="github:1"
        )
        self.path = (
            f"/api/0/organizations/{self.org.slug}/integrations/{self.integration.id}/repos/"
        )

    @patch(
        "sentry.integrations.github.integration.GitHubIntegration.get_repositories", return_value=[]
    )
    def test_simple(self, get_repositories: MagicMock) -> None:
        get_repositories.return_value = [
            {
                "name": "rad-repo",
                "identifier": "Example/rad-repo",
                "default_branch": "main",
                "external_id": "rad-repo",
            },
            {"name": "cool-repo", "identifier": "Example/cool-repo", "external_id": "cool-repo"},
        ]
        response = self.client.get(self.path, format="json")

        assert response.status_code == 200, response.content
        assert response.data == {
            "repos": [
                {
                    "name": "rad-repo",
                    "identifier": "Example/rad-repo",
                    "defaultBranch": "main",
                    "isInstalled": False,
                    "externalId": "rad-repo",
                },
                {
                    "name": "cool-repo",
                    "identifier": "Example/cool-repo",
                    "defaultBranch": None,
                    "isInstalled": False,
                    "externalId": "cool-repo",
                },
            ],
            "searchable": True,
        }

    @patch(
        "sentry.integrations.github.integration.GitHubIntegration.get_repositories", return_value=[]
    )
    def test_hide_hidden_repos(self, get_repositories: MagicMock) -> None:
        get_repositories.return_value = [
            {
                "name": "rad-repo",
                "identifier": "Example/rad-repo",
                "default_branch": "main",
                "external_id": "rad-repo",
            },
            {"name": "cool-repo", "identifier": "Example/cool-repo", "external_id": "cool-repo"},
        ]

        self.create_repo(
            project=self.project,
            integration_id=self.integration.id,
            name="Example/rad-repo",
        )

        response = self.client.get(self.path, format="json", data={"installableOnly": "true"})

        assert response.status_code == 200, response.content
        assert response.data == {
            "repos": [
                {
                    "name": "cool-repo",
                    "identifier": "Example/cool-repo",
                    "defaultBranch": None,
                    "isInstalled": False,
                    "externalId": "cool-repo",
                },
            ],
            "searchable": True,
        }

    @patch(
        "sentry.integrations.github.integration.GitHubIntegration.get_repositories", return_value=[]
    )
    def test_installable_only(self, get_repositories: MagicMock) -> None:
        get_repositories.return_value = [
            {
                "name": "rad-repo",
                "identifier": "Example/rad-repo",
                "default_branch": "main",
                "external_id": "rad-repo",
            },
            {
                "name": "cool-repo",
                "identifier": "Example/cool-repo",
                "default_branch": "dev",
                "external_id": "cool-repo",
            },
            {
                "name": "awesome-repo",
                "identifier": "Example/awesome-repo",
                "external_id": "awesome-repo",
            },
        ]

        self.create_repo(
            project=self.project,
            integration_id=self.integration.id,
            name="Example/rad-repo",
        )

        response = self.client.get(self.path, format="json", data={"installableOnly": "true"})
        assert response.status_code == 200, response.content
        assert response.data == {
            "repos": [
                {
                    "name": "cool-repo",
                    "identifier": "Example/cool-repo",
                    "defaultBranch": "dev",
                    "isInstalled": False,
                    "externalId": "cool-repo",
                },
                {
                    "name": "awesome-repo",
                    "identifier": "Example/awesome-repo",
                    "defaultBranch": None,
                    "isInstalled": False,
                    "externalId": "awesome-repo",
                },
            ],
            "searchable": True,
        }

    @patch(
        "sentry.integrations.github.integration.GitHubIntegration.get_repositories", return_value=[]
    )
    def test_is_installed_field(self, get_repositories: MagicMock) -> None:
        get_repositories.return_value = [
            {
                "name": "rad-repo",
                "identifier": "Example/rad-repo",
                "default_branch": "main",
                "external_id": "rad-repo",
            },
            {
                "name": "rad-repo",
                "identifier": "Example2/rad-repo",
                "default_branch": "dev",
                "external_id": "rad-repo",
            },
        ]

        self.create_repo(
            project=self.project,
            integration_id=self.integration.id,
            name="Example/rad-repo",
        )

        response = self.client.get(self.path, format="json")

        assert response.status_code == 200, response.content
        assert response.data == {
            "repos": [
                {
                    "name": "rad-repo",
                    "identifier": "Example/rad-repo",
                    "defaultBranch": "main",
                    "isInstalled": True,
                    "externalId": "rad-repo",
                },
                {
                    "name": "rad-repo",
                    "identifier": "Example2/rad-repo",
                    "defaultBranch": "dev",
                    "externalId": "rad-repo",
                    "isInstalled": False,
                },
            ],
            "searchable": True,
        }

    @patch(
        "sentry.integrations.github.integration.GitHubIntegration.get_repositories", return_value=[]
    )
    def test_repo_installed_by_other_org_not_excluded(self, get_repositories: MagicMock) -> None:
        """
        When two organizations share the same integration, a repo installed by
        one organization should not affect the available repos for the other.
        """
        get_repositories.return_value = [
            {
                "name": "shared-repo",
                "identifier": "Example/shared-repo",
                "default_branch": "main",
                "external_id": "shared-repo",
            },
        ]

        other_org = self.create_organization(owner=self.user, name="other-org")
        other_project = self.create_project(organization=other_org)
        self.create_repo(
            project=other_project,
            integration_id=self.integration.id,
            name="Example/shared-repo",
        )

        response = self.client.get(self.path, format="json")

        assert response.status_code == 200, response.content
        assert response.data == {
            "repos": [
                {
                    "name": "shared-repo",
                    "identifier": "Example/shared-repo",
                    "defaultBranch": "main",
                    "isInstalled": False,
                    "externalId": "shared-repo",
                },
            ],
            "searchable": True,
        }

    @patch(
        "sentry.integrations.github.integration.GitHubIntegration.get_repositories", return_value=[]
    )
    def test_accessible_only_passes_param(self, get_repositories: MagicMock) -> None:
        """When accessibleOnly=true, passes accessible_only to get_repositories."""
        get_repositories.return_value = [
            {
                "name": "rad-repo",
                "identifier": "Example/rad-repo",
                "default_branch": "main",
                "external_id": "rad-repo",
            },
        ]
        response = self.client.get(
            self.path, format="json", data={"search": "rad", "accessibleOnly": "true"}
        )

        assert response.status_code == 200, response.content
        get_repositories.assert_called_once_with("rad", accessible_only=True, use_cache=True)
        assert response.data == {
            "repos": [
                {
                    "name": "rad-repo",
                    "identifier": "Example/rad-repo",
                    "defaultBranch": "main",
                    "isInstalled": False,
                    "externalId": "rad-repo",
                },
            ],
            "searchable": True,
        }

    @patch(
        "sentry.integrations.github.integration.GitHubIntegration.get_repositories", return_value=[]
    )
    def test_accessible_only_without_search(self, get_repositories: MagicMock) -> None:
        """When accessibleOnly=true but no search, passes both params through."""
        get_repositories.return_value = [
            {
                "name": "rad-repo",
                "identifier": "Example/rad-repo",
                "default_branch": "main",
                "external_id": "rad-repo",
            },
        ]
        response = self.client.get(self.path, format="json", data={"accessibleOnly": "true"})

        assert response.status_code == 200, response.content
        get_repositories.assert_called_once_with(None, accessible_only=True, use_cache=False)

    @patch(
        "sentry.integrations.github.integration.GitHubIntegration.get_repositories", return_value=[]
    )
    def test_accessible_only_with_installable_only(self, get_repositories: MagicMock) -> None:
        """Both filters compose: accessible scopes the fetch, installable excludes installed repos."""
        get_repositories.return_value = [
            {
                "name": "rad-repo",
                "identifier": "Example/rad-repo",
                "default_branch": "main",
                "external_id": "rad-repo",
            },
            {
                "name": "cool-repo",
                "identifier": "Example/cool-repo",
                "default_branch": "dev",
                "external_id": "cool-repo",
            },
        ]

        self.create_repo(
            project=self.project,
            integration_id=self.integration.id,
            name="Example/rad-repo",
        )

        response = self.client.get(
            self.path,
            format="json",
            data={"search": "Example", "accessibleOnly": "true", "installableOnly": "true"},
        )

        assert response.status_code == 200, response.content
        get_repositories.assert_called_once_with("Example", accessible_only=True, use_cache=True)
        assert response.data == {
            "repos": [
                {
                    "name": "cool-repo",
                    "identifier": "Example/cool-repo",
                    "defaultBranch": "dev",
                    "isInstalled": False,
                    "externalId": "cool-repo",
                },
            ],
            "searchable": True,
        }

    def test_no_repository_method(self) -> None:
        integration = self.create_integration(
            organization=self.org, provider="jira", name="Example", external_id="example:1"
        )
        path = f"/api/0/organizations/{self.org.slug}/integrations/{integration.id}/repos/"
        response = self.client.get(path, format="json")

        assert response.status_code == 400


CACHED_REPOS = [_make_cached_repo(i, f"repo-{i}", f"Example/repo-{i}") for i in range(1, 6)]


class OrganizationIntegrationReposPaginatedTest(APITestCase):
    """Tests for cursor-based pagination triggered by sending per_page."""

    def setUp(self) -> None:
        super().setUp()
        self.login_as(user=self.user)
        self.org = self.create_organization(owner=self.user, name="baz")
        self.project = self.create_project(organization=self.org)
        self.integration = self.create_integration(
            organization=self.org, provider="github", name="Example", external_id="github:1"
        )
        self.path = (
            f"/api/0/organizations/{self.org.slug}/integrations/{self.integration.id}/repos/"
        )

    @patch(
        "sentry.integrations.github.client.GitHubBaseClient.get_accessible_repos_cached",
    )
    def test_first_page(self, mock_cache: MagicMock) -> None:
        mock_cache.return_value = CACHED_REPOS
        response = self.client.get(self.path, data={"per_page": "2"}, format="json")

        assert response.status_code == 200, response.content
        repos = response.data["repos"]
        assert len(repos) == 2
        assert repos[0]["identifier"] == "Example/repo-1"
        assert repos[1]["identifier"] == "Example/repo-2"
        assert response.data["searchable"] is True
        assert 'rel="next"' in response["Link"]
        assert 'results="true"' in response["Link"].split("next")[1]

    @patch(
        "sentry.integrations.github.client.GitHubBaseClient.get_accessible_repos_cached",
    )
    def test_second_page(self, mock_cache: MagicMock) -> None:
        mock_cache.return_value = CACHED_REPOS
        response = self.client.get(
            self.path, data={"per_page": "2", "cursor": "0:2:0"}, format="json"
        )

        assert response.status_code == 200, response.content
        repos = response.data["repos"]
        assert len(repos) == 2
        assert repos[0]["identifier"] == "Example/repo-3"
        assert repos[1]["identifier"] == "Example/repo-4"

    @patch(
        "sentry.integrations.github.client.GitHubBaseClient.get_accessible_repos_cached",
    )
    def test_last_page(self, mock_cache: MagicMock) -> None:
        mock_cache.return_value = CACHED_REPOS
        response = self.client.get(
            self.path, data={"per_page": "2", "cursor": "0:4:0"}, format="json"
        )

        assert response.status_code == 200, response.content
        repos = response.data["repos"]
        assert len(repos) == 1
        assert repos[0]["identifier"] == "Example/repo-5"
        link = response["Link"]
        next_part = link.split("next")[1]
        assert 'results="false"' in next_part

    @patch(
        "sentry.integrations.github.client.GitHubBaseClient.get_accessible_repos_cached",
    )
    def test_excludes_archived(self, mock_cache: MagicMock) -> None:
        mock_cache.return_value = [
            _make_cached_repo(1, "active", "Example/active"),
            _make_cached_repo(2, "archived", "Example/archived", archived=True),
        ]
        response = self.client.get(self.path, data={"per_page": "100"}, format="json")

        assert response.status_code == 200, response.content
        repos = response.data["repos"]
        assert len(repos) == 1
        assert repos[0]["identifier"] == "Example/active"

    @patch(
        "sentry.integrations.github.client.GitHubBaseClient.get_accessible_repos_cached",
    )
    def test_installable_only(self, mock_cache: MagicMock) -> None:
        mock_cache.return_value = [
            _make_cached_repo(1, "installed-repo", "Example/installed-repo"),
            _make_cached_repo(2, "available-repo", "Example/available-repo"),
        ]
        self.create_repo(
            project=self.project,
            integration_id=self.integration.id,
            name="Example/installed-repo",
        )
        response = self.client.get(
            self.path, data={"per_page": "100", "installableOnly": "true"}, format="json"
        )

        assert response.status_code == 200, response.content
        repos = response.data["repos"]
        assert len(repos) == 1
        assert repos[0]["identifier"] == "Example/available-repo"
        assert repos[0]["isInstalled"] is False

    @patch(
        "sentry.integrations.github.client.GitHubBaseClient.get_accessible_repos_cached",
    )
    def test_no_cursor_on_single_page(self, mock_cache: MagicMock) -> None:
        """When all repos fit in one page, no Link header is added."""
        mock_cache.return_value = [_make_cached_repo(1, "repo-1", "Example/repo-1")]
        response = self.client.get(self.path, data={"per_page": "100"}, format="json")

        assert response.status_code == 200, response.content
        assert "Link" not in response

    @patch(
        "sentry.integrations.github.integration.GitHubIntegration.get_repositories",
    )
    def test_without_per_page_uses_full_list(self, get_repositories: MagicMock) -> None:
        """Without per_page, existing behavior: full list, no pagination."""
        get_repositories.return_value = [
            {"name": "repo-1", "identifier": "Example/repo-1", "default_branch": "main"},
        ]
        response = self.client.get(self.path, format="json")

        assert response.status_code == 200, response.content
        get_repositories.assert_called_once_with(None, accessible_only=False)
        assert "Link" not in response

    @patch(
        "sentry.integrations.github.integration.GitHubIntegration.get_repositories",
    )
    def test_search_with_per_page_uses_full_list(self, get_repositories: MagicMock) -> None:
        """When search is present, per_page is ignored -- full list returned."""
        get_repositories.return_value = [
            {"name": "repo-1", "identifier": "Example/repo-1", "default_branch": "main"},
        ]
        response = self.client.get(
            self.path, data={"search": "repo", "per_page": "2"}, format="json"
        )

        assert response.status_code == 200, response.content
        get_repositories.assert_called_once_with("repo", accessible_only=False)
        assert "Link" not in response

    @patch(
        "sentry.integrations.github.client.GitHubBaseClient.get_accessible_repos_cached",
    )
    def test_per_page_zero_clamped_to_one(self, mock_cache: MagicMock) -> None:
        mock_cache.return_value = CACHED_REPOS
        response = self.client.get(self.path, data={"per_page": "0"}, format="json")

        assert response.status_code == 200, response.content
        assert len(response.data["repos"]) == 1

    @patch(
        "sentry.integrations.github.client.GitHubBaseClient.get_accessible_repos_cached",
    )
    def test_per_page_negative_clamped_to_one(self, mock_cache: MagicMock) -> None:
        mock_cache.return_value = CACHED_REPOS
        response = self.client.get(self.path, data={"per_page": "-1"}, format="json")

        assert response.status_code == 200, response.content
        assert len(response.data["repos"]) == 1

    @patch(
        "sentry.integrations.github.client.GitHubBaseClient.get_accessible_repos_cached",
    )
    def test_per_page_non_numeric_defaults_to_100(self, mock_cache: MagicMock) -> None:
        mock_cache.return_value = CACHED_REPOS
        response = self.client.get(self.path, data={"per_page": "abc"}, format="json")

        assert response.status_code == 200, response.content
        assert len(response.data["repos"]) == 5

    @patch(
        "sentry.integrations.github.client.GitHubBaseClient.get_accessible_repos_cached",
    )
    def test_per_page_over_max_clamped_to_100(self, mock_cache: MagicMock) -> None:
        mock_cache.return_value = CACHED_REPOS
        response = self.client.get(self.path, data={"per_page": "200"}, format="json")

        assert response.status_code == 200, response.content
        assert len(response.data["repos"]) == 5

    @patch(
        "sentry.integrations.github.client.GitHubBaseClient.get_accessible_repos_cached",
    )
    def test_negative_cursor_offset_clamped_to_zero(self, mock_cache: MagicMock) -> None:
        mock_cache.return_value = CACHED_REPOS
        response = self.client.get(
            self.path, data={"per_page": "2", "cursor": "0:-5:0"}, format="json"
        )

        assert response.status_code == 200, response.content
        repos = response.data["repos"]
        assert len(repos) == 2
        assert repos[0]["identifier"] == "Example/repo-1"

    @patch(
        "sentry.integrations.github.client.GitHubBaseClient.get_accessible_repos_cached",
    )
    def test_integration_error_returns_400(self, mock_cache: MagicMock) -> None:
        from sentry.shared_integrations.exceptions import IntegrationError

        mock_cache.side_effect = IntegrationError("token revoked")
        response = self.client.get(self.path, data={"per_page": "2"}, format="json")

        assert response.status_code == 400
        assert response.data["detail"] == "token revoked"
