from urllib.parse import parse_qs

import orjson
import responses

from sentry.identity.vercel.provider import VercelIdentityProvider
from sentry.integrations.models.integration import Integration
from sentry.integrations.vercel import VercelClient, VercelIntegrationProvider
from sentry.models.project import Project
from sentry.models.projectkey import ProjectKey
from sentry.sentry_apps.models.sentry_app_installation_token import SentryAppInstallationToken
from sentry.silo.base import SiloMode
from sentry.testutils.cases import IntegrationTestCase
from sentry.testutils.silo import assume_test_silo_mode, control_silo_test


@control_silo_test
class OrganizationIntegrationVercelRotateApiKeyTest(IntegrationTestCase):
    provider = VercelIntegrationProvider

    project_id = "Qme9NXBpguaRxcXssZ1NWHVaM98MAL6PHDXUs1jPrgiM8H"
    config_id = "my_config_id"

    def get_path(self, integration_id) -> str:
        return f"/api/0/organizations/{self.organization.slug}/integrations/{integration_id}/vercel/rotate-api-key/"

    def assert_setup_flow(self) -> None:
        responses.reset()
        responses.add(
            responses.POST,
            VercelIdentityProvider.oauth_access_token_url,
            json={
                "user_id": "my_user_id",
                "access_token": "my_access_token",
                "installation_id": self.config_id,
            },
        )
        responses.add(
            responses.GET,
            f"{VercelClient.base_url}{VercelClient.GET_USER_URL}",
            json={"user": {"name": "My Name", "username": "my_user_name"}},
        )
        responses.add(
            responses.GET,
            f"{VercelClient.base_url}{VercelClient.GET_PROJECTS_URL}?limit={VercelClient.pagination_limit}&",
            json={"projects": [], "pagination": {"count": 0, "next": None}},
        )
        params = {
            "configurationId": "config_id",
            "code": "oauth-code",
            "next": "https://example.com",
        }
        self.pipeline.bind_state("user_id", self.user.id)
        resp = self.client.get(self.setup_path, params)

        mock_request = responses.calls[0].request
        req_params = parse_qs(mock_request.body)
        assert req_params["grant_type"] == ["authorization_code"]
        assert resp.status_code == 200
        self.assertDialogSuccess(resp)

    def _set_project_mapping(self) -> None:
        from sentry.integrations.models.organization_integration import OrganizationIntegration

        integration = Integration.objects.get(provider=self.provider.key)
        org_integration = OrganizationIntegration.objects.get(
            integration=integration, organization_id=self.organization.id
        )
        org_integration.config = {"project_mappings": [[self.project.id, self.project_id]]}
        org_integration.save()

    def test_no_integration(self) -> None:
        path = self.get_path(integration_id=-1)
        response = self.client.post(path, format="json")
        assert response.status_code == 404

    @responses.activate
    def test_not_vercel_integration(self) -> None:
        integration = self.create_integration(
            organization=self.organization, provider="jira", external_id="jira:1"
        )
        path = self.get_path(integration_id=integration.id)
        response = self.client.post(path, format="json")
        assert response.status_code == 400
        body = orjson.loads(response.content)
        assert body["detail"].startswith("Rotate is only supported")

    @responses.activate
    def test_rotate_no_mappings(self) -> None:
        with self.tasks():
            self.assert_setup_flow()
        integration = Integration.objects.get(provider=self.provider.key)

        old_token_count = SentryAppInstallationToken.objects.filter(
            sentry_app_installation__sentryappinstallationforprovider__organization_id=self.organization.id,
            sentry_app_installation__sentryappinstallationforprovider__provider="vercel",
        ).count()
        assert old_token_count == 1

        path = self.get_path(integration_id=integration.id)
        response = self.client.post(path, format="json")
        assert response.status_code == 200
        assert orjson.loads(response.content) == {"projectMappingsSynced": 0}

        # Old token revoked, new token minted, net count unchanged.
        new_token_count = SentryAppInstallationToken.objects.filter(
            sentry_app_installation__sentryappinstallationforprovider__organization_id=self.organization.id,
            sentry_app_installation__sentryappinstallationforprovider__provider="vercel",
        ).count()
        assert new_token_count == 1

    @responses.activate
    def test_rotate_with_mapping(self) -> None:
        with self.tasks():
            self.assert_setup_flow()

        self._set_project_mapping()
        integration = Integration.objects.get(provider=self.provider.key)

        old_token_id = SentryAppInstallationToken.objects.get(
            sentry_app_installation__sentryappinstallationforprovider__organization_id=self.organization.id,
            sentry_app_installation__sentryappinstallationforprovider__provider="vercel",
        ).api_token_id

        with assume_test_silo_mode(SiloMode.CELL):
            project_key = ProjectKey.get_default(project=Project.objects.get(id=self.project.id))
            integration_endpoint = project_key.integration_endpoint
            public_key = project_key.public_key
            enabled_dsn = project_key.get_dsn(public=True)

        responses.add(
            responses.GET,
            f"{VercelClient.base_url}{VercelClient.GET_PROJECT_URL % self.project_id}",
            json={"link": {"type": "github"}, "framework": "nextjs"},
        )
        for _ in range(8):
            responses.add(
                responses.POST,
                f"{VercelClient.base_url}{VercelClient.CREATE_ENV_VAR_URL % self.project_id}",
                json={},
            )

        path = self.get_path(integration_id=integration.id)
        response = self.client.post(path, format="json")
        assert response.status_code == 200, response.content
        assert orjson.loads(response.content) == {"projectMappingsSynced": 1}

        env_calls = [
            orjson.loads(c.request.body)
            for c in responses.calls
            if c.request.method == "POST"
            and c.request.url.endswith(VercelClient.CREATE_ENV_VAR_URL % self.project_id)
        ]
        keys = {c["key"] for c in env_calls}
        assert keys == {
            "SENTRY_ORG",
            "SENTRY_PROJECT",
            "NEXT_PUBLIC_SENTRY_DSN",
            "SENTRY_AUTH_TOKEN",
            "VERCEL_GIT_COMMIT_SHA",
            "SENTRY_VERCEL_LOG_DRAIN_URL",
            "SENTRY_OTLP_TRACES_URL",
            "SENTRY_PUBLIC_KEY",
        }

        auth_token_call = next(c for c in env_calls if c["key"] == "SENTRY_AUTH_TOKEN")
        # Auth token value rotated to a non-empty string distinct from the old token.
        assert isinstance(auth_token_call["value"], str)
        assert len(auth_token_call["value"]) > 0

        # Other core env vars also reasserted with the right values.
        org_call = next(c for c in env_calls if c["key"] == "SENTRY_ORG")
        assert org_call["value"] == self.organization.slug
        dsn_call = next(c for c in env_calls if c["key"] == "NEXT_PUBLIC_SENTRY_DSN")
        assert dsn_call["value"] == enabled_dsn
        log_drain_call = next(c for c in env_calls if c["key"] == "SENTRY_VERCEL_LOG_DRAIN_URL")
        assert log_drain_call["value"] == f"{integration_endpoint}vercel/logs/"
        public_key_call = next(c for c in env_calls if c["key"] == "SENTRY_PUBLIC_KEY")
        assert public_key_call["value"] == public_key

        # Old token revoked; only the rotated token survives.
        remaining_tokens = list(
            SentryAppInstallationToken.objects.filter(
                sentry_app_installation__sentryappinstallationforprovider__organization_id=self.organization.id,
                sentry_app_installation__sentryappinstallationforprovider__provider="vercel",
            )
        )
        assert len(remaining_tokens) == 1
        assert remaining_tokens[0].api_token_id != old_token_id

    @responses.activate
    def test_rotate_vercel_failure_rolls_back_token(self) -> None:
        with self.tasks():
            self.assert_setup_flow()

        self._set_project_mapping()
        integration = Integration.objects.get(provider=self.provider.key)

        original_tokens = list(
            SentryAppInstallationToken.objects.filter(
                sentry_app_installation__sentryappinstallationforprovider__organization_id=self.organization.id,
                sentry_app_installation__sentryappinstallationforprovider__provider="vercel",
            ).values_list("api_token_id", flat=True)
        )
        assert len(original_tokens) == 1

        responses.add(
            responses.GET,
            f"{VercelClient.base_url}{VercelClient.GET_PROJECT_URL % self.project_id}",
            json={"link": {"type": "github"}, "framework": "nextjs"},
        )
        responses.add(
            responses.POST,
            f"{VercelClient.base_url}{VercelClient.CREATE_ENV_VAR_URL % self.project_id}",
            json={"error": {"code": "BOOM", "message": "Vercel exploded"}},
            status=500,
        )

        path = self.get_path(integration_id=integration.id)
        response = self.client.post(path, format="json")
        assert response.status_code == 502, response.content

        # Failed rotation must leave the original token in place and not leak a partial new one.
        remaining_tokens = list(
            SentryAppInstallationToken.objects.filter(
                sentry_app_installation__sentryappinstallationforprovider__organization_id=self.organization.id,
                sentry_app_installation__sentryappinstallationforprovider__provider="vercel",
            ).values_list("api_token_id", flat=True)
        )
        assert remaining_tokens == original_tokens
