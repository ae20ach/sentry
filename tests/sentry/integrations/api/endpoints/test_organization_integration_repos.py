from unittest.mock import MagicMock, patch

from sentry.testutils.cases import APITestCase


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
            {"name": "rad-repo", "identifier": "Example/rad-repo", "default_branch": "main"},
            {"name": "cool-repo", "identifier": "Example/cool-repo"},
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
                },
                {
                    "name": "cool-repo",
                    "identifier": "Example/cool-repo",
                    "defaultBranch": None,
                    "isInstalled": False,
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
            },
            {"name": "cool-repo", "identifier": "Example/cool-repo"},
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
                },
            ],
            "searchable": True,
        }

    @patch(
        "sentry.integrations.github.integration.GitHubIntegration.get_repositories", return_value=[]
    )
    def test_installable_only(self, get_repositories: MagicMock) -> None:
        get_repositories.return_value = [
            {"name": "rad-repo", "identifier": "Example/rad-repo", "default_branch": "main"},
            {"name": "cool-repo", "identifier": "Example/cool-repo", "default_branch": "dev"},
            {"name": "awesome-repo", "identifier": "Example/awesome-repo"},
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
                },
                {
                    "name": "awesome-repo",
                    "identifier": "Example/awesome-repo",
                    "defaultBranch": None,
                    "isInstalled": False,
                },
            ],
            "searchable": True,
        }

    @patch(
        "sentry.integrations.github.integration.GitHubIntegration.get_repositories", return_value=[]
    )
    def test_is_installed_field(self, get_repositories: MagicMock) -> None:
        get_repositories.return_value = [
            {"name": "rad-repo", "identifier": "Example/rad-repo", "default_branch": "main"},
            {"name": "rad-repo", "identifier": "Example2/rad-repo", "default_branch": "dev"},
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
                },
                {
                    "name": "rad-repo",
                    "identifier": "Example2/rad-repo",
                    "defaultBranch": "dev",
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
            {"name": "shared-repo", "identifier": "Example/shared-repo", "default_branch": "main"},
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
            {"name": "rad-repo", "identifier": "Example/rad-repo", "default_branch": "main"},
        ]
        response = self.client.get(
            self.path, format="json", data={"search": "rad", "accessibleOnly": "true"}
        )

        assert response.status_code == 200, response.content
        get_repositories.assert_called_once_with("rad", accessible_only=True)
        assert response.data == {
            "repos": [
                {
                    "name": "rad-repo",
                    "identifier": "Example/rad-repo",
                    "defaultBranch": "main",
                    "isInstalled": False,
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
            {"name": "rad-repo", "identifier": "Example/rad-repo", "default_branch": "main"},
        ]
        response = self.client.get(self.path, format="json", data={"accessibleOnly": "true"})

        assert response.status_code == 200, response.content
        get_repositories.assert_called_once_with(None, accessible_only=True)

    @patch(
        "sentry.integrations.github.integration.GitHubIntegration.get_repositories", return_value=[]
    )
    def test_accessible_only_with_installable_only(self, get_repositories: MagicMock) -> None:
        """Both filters compose: accessible scopes the fetch, installable excludes installed repos."""
        get_repositories.return_value = [
            {"name": "rad-repo", "identifier": "Example/rad-repo", "default_branch": "main"},
            {"name": "cool-repo", "identifier": "Example/cool-repo", "default_branch": "dev"},
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
        get_repositories.assert_called_once_with("Example", accessible_only=True)
        assert response.data == {
            "repos": [
                {
                    "name": "cool-repo",
                    "identifier": "Example/cool-repo",
                    "defaultBranch": "dev",
                    "isInstalled": False,
                },
            ],
            "searchable": True,
        }

    @patch(
        "sentry.integrations.github.integration.GitHubIntegration.get_repositories_page",
        return_value=([], False),
    )
    def test_paginate_first_page(self, get_repositories_page: MagicMock) -> None:
        """paginate=true uses get_repositories_page for single-page fetching."""
        get_repositories_page.return_value = (
            [
                {"name": "repo-a", "identifier": "Example/repo-a", "default_branch": "main"},
                {"name": "repo-b", "identifier": "Example/repo-b", "default_branch": "main"},
            ],
            True,
        )
        response = self.client.get(self.path, format="json", data={"paginate": "true"})

        assert response.status_code == 200, response.content
        get_repositories_page.assert_called_once_with(page=1, per_page=25)
        assert response.data == {
            "repos": [
                {
                    "name": "repo-a",
                    "identifier": "Example/repo-a",
                    "defaultBranch": "main",
                    "isInstalled": False,
                },
                {
                    "name": "repo-b",
                    "identifier": "Example/repo-b",
                    "defaultBranch": "main",
                    "isInstalled": False,
                },
            ],
            "searchable": True,
        }
        assert 'results="true"' in response["Link"]

    @patch(
        "sentry.integrations.github.integration.GitHubIntegration.get_repositories_page",
        return_value=([], False),
    )
    def test_paginate_second_page(self, get_repositories_page: MagicMock) -> None:
        """Passing a cursor fetches the corresponding page."""
        get_repositories_page.return_value = (
            [{"name": "repo-c", "identifier": "Example/repo-c", "default_branch": "main"}],
            False,
        )
        response = self.client.get(
            self.path, format="json", data={"paginate": "true", "cursor": "0:25:0"}
        )

        assert response.status_code == 200, response.content
        get_repositories_page.assert_called_once_with(page=2, per_page=25)
        # next cursor should indicate no more results
        assert 'rel="next"; results="false"' in response["Link"]
        # prev cursor should indicate results exist
        assert 'rel="previous"; results="true"' in response["Link"]

    @patch(
        "sentry.integrations.github.integration.GitHubIntegration.get_repositories",
        return_value=[],
    )
    def test_paginate_with_search_falls_through(self, get_repositories: MagicMock) -> None:
        """paginate=true with search uses the non-paginated path."""
        get_repositories.return_value = [
            {"name": "rad-repo", "identifier": "Example/rad-repo", "default_branch": "main"},
        ]
        response = self.client.get(
            self.path, format="json", data={"paginate": "true", "search": "rad"}
        )

        assert response.status_code == 200, response.content
        get_repositories.assert_called_once()
        assert "Link" not in response

    @patch(
        "sentry.integrations.github.integration.GitHubIntegration.get_repositories",
        return_value=[],
    )
    def test_no_paginate_param_uses_existing_path(self, get_repositories: MagicMock) -> None:
        """Without paginate=true, get_repositories is called (not get_repositories_page)."""
        get_repositories.return_value = [
            {"name": "rad-repo", "identifier": "Example/rad-repo", "default_branch": "main"},
        ]
        response = self.client.get(self.path, format="json")

        assert response.status_code == 200, response.content
        get_repositories.assert_called_once()
        assert "Link" not in response

    @patch(
        "sentry.integrations.github.integration.GitHubIntegration.get_repositories_page",
        return_value=([], False),
    )
    def test_paginate_installable_only(self, get_repositories_page: MagicMock) -> None:
        """installableOnly filter works with the paginated path."""
        get_repositories_page.return_value = (
            [
                {"name": "installed", "identifier": "Example/installed", "default_branch": "main"},
                {"name": "new-repo", "identifier": "Example/new-repo", "default_branch": "main"},
            ],
            False,
        )
        self.create_repo(
            project=self.project,
            integration_id=self.integration.id,
            name="Example/installed",
        )
        response = self.client.get(
            self.path,
            format="json",
            data={"paginate": "true", "installableOnly": "true"},
        )

        assert response.status_code == 200, response.content
        assert len(response.data["repos"]) == 1
        assert response.data["repos"][0]["identifier"] == "Example/new-repo"

    def test_no_repository_method(self) -> None:
        integration = self.create_integration(
            organization=self.org, provider="jira", name="Example", external_id="example:1"
        )
        path = f"/api/0/organizations/{self.org.slug}/integrations/{integration.id}/repos/"
        response = self.client.get(path, format="json")

        assert response.status_code == 400
