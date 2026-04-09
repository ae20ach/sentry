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


CACHED_REPOS = [_make_cached_repo(i, f"repo-{i}", f"Example/repo-{i}") for i in range(1, 6)]


class OrganizationIntegrationReposPaginatedGitHubTest(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.login_as(user=self.user)
        self.org = self.create_organization(owner=self.user, name="baz")
        self.project = self.create_project(organization=self.org)
        self.integration = self.create_integration(
            organization=self.org, provider="github", name="Example", external_id="github:1"
        )
        self.path = (
            f"/api/0/organizations/{self.org.slug}"
            f"/integrations/{self.integration.id}/repos-paginated/"
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
        # next cursor should indicate no more results
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
        response = self.client.get(self.path, format="json")

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

        response = self.client.get(self.path, data={"installableOnly": "true"}, format="json")

        assert response.status_code == 200, response.content
        repos = response.data["repos"]
        assert len(repos) == 1
        assert repos[0]["identifier"] == "Example/available-repo"
        assert repos[0]["isInstalled"] is False

    @patch(
        "sentry.integrations.github.client.GitHubBaseClient.get_accessible_repos_cached",
    )
    def test_is_installed_field(self, mock_cache: MagicMock) -> None:
        mock_cache.return_value = [
            _make_cached_repo(1, "installed-repo", "Example/installed-repo"),
            _make_cached_repo(2, "other-repo", "Example/other-repo"),
        ]
        self.create_repo(
            project=self.project,
            integration_id=self.integration.id,
            name="Example/installed-repo",
        )

        response = self.client.get(self.path, format="json")

        assert response.status_code == 200, response.content
        repos = response.data["repos"]
        assert repos[0]["isInstalled"] is True
        assert repos[1]["isInstalled"] is False

    @patch(
        "sentry.integrations.github.client.GitHubBaseClient.get_accessible_repos_cached",
    )
    def test_cache_used_on_second_request(self, mock_cache: MagicMock) -> None:
        mock_cache.return_value = CACHED_REPOS
        self.client.get(self.path, format="json")
        self.client.get(self.path, format="json")
        assert mock_cache.call_count == 2

    @patch(
        "sentry.integrations.github.client.GitHubBaseClient.get_accessible_repos_cached",
    )
    def test_no_cursor_on_single_page(self, mock_cache: MagicMock) -> None:
        """When all repos fit in one page, no Link header is added."""
        mock_cache.return_value = [
            _make_cached_repo(1, "repo-1", "Example/repo-1"),
        ]
        response = self.client.get(self.path, data={"per_page": "100"}, format="json")

        assert response.status_code == 200, response.content
        assert "Link" not in response


class OrganizationIntegrationReposPaginatedNonGitHubTest(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.login_as(user=self.user)
        self.org = self.create_organization(owner=self.user, name="baz")
        self.integration = self.create_integration(
            organization=self.org, provider="bitbucket", name="Example", external_id="bitbucket:1"
        )
        self.path = (
            f"/api/0/organizations/{self.org.slug}"
            f"/integrations/{self.integration.id}/repos-paginated/"
        )

    @patch(
        "sentry.integrations.bitbucket.integration.BitbucketIntegration.get_repositories",
    )
    def test_non_github_returns_full_list(self, mock_get_repos: MagicMock) -> None:
        mock_get_repos.return_value = [
            {
                "name": "repo-1",
                "identifier": "Example/repo-1",
                "default_branch": "main",
            },
            {
                "name": "repo-2",
                "identifier": "Example/repo-2",
                "default_branch": "develop",
            },
        ]
        response = self.client.get(self.path, format="json")

        assert response.status_code == 200, response.content
        assert len(response.data["repos"]) == 2
        assert "Link" not in response


class OrganizationIntegrationReposPaginatedEdgeCasesTest(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.login_as(user=self.user)
        self.org = self.create_organization(owner=self.user, name="baz")

    def test_non_repository_integration(self) -> None:
        integration = self.create_integration(
            organization=self.org, provider="jira", name="Jira", external_id="jira:1"
        )
        path = (
            f"/api/0/organizations/{self.org.slug}/integrations/{integration.id}/repos-paginated/"
        )
        response = self.client.get(path, format="json")
        assert response.status_code == 400

    def test_disabled_integration(self) -> None:
        integration = self.create_integration(
            organization=self.org,
            provider="github",
            name="Disabled",
            external_id="github:disabled",
            status=1,  # ObjectStatus.DISABLED
        )
        path = (
            f"/api/0/organizations/{self.org.slug}/integrations/{integration.id}/repos-paginated/"
        )
        response = self.client.get(path, format="json")
        assert response.status_code == 200
        assert response.data == {"repos": []}
