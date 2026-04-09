from typing import Any

from rest_framework.request import Request
from rest_framework.response import Response

from sentry.api.api_owners import ApiOwner
from sentry.api.api_publish_status import ApiPublishStatus
from sentry.api.base import cell_silo_endpoint
from sentry.auth.exceptions import IdentityNotValid
from sentry.constants import ObjectStatus
from sentry.integrations.api.bases.organization_integrations import (
    CellOrganizationIntegrationBaseEndpoint,
)
from sentry.integrations.api.endpoints.organization_integration_repos import (
    IntegrationRepository,
)
from sentry.integrations.source_code_management.repository import RepositoryIntegration
from sentry.models.organization import Organization
from sentry.models.repository import Repository
from sentry.shared_integrations.exceptions import IntegrationError
from sentry.utils.cursors import Cursor, CursorResult


@cell_silo_endpoint
class OrganizationIntegrationReposPaginatedEndpoint(CellOrganizationIntegrationBaseEndpoint):
    publish_status = {
        "GET": ApiPublishStatus.PRIVATE,
    }
    owner = ApiOwner.ISSUES

    def get(
        self,
        request: Request,
        organization: Organization,
        integration_id: int,
        **kwds: Any,
    ) -> Response:
        """
        Paginated list of repositories for an integration.

        Providers that implement ``get_repositories_paginated()`` return
        cursor-paginated results. All others fall back to the full list
        from ``get_repositories()``.

        For search, use the existing ``/repos/`` endpoint with
        ``search`` and ``accessibleOnly`` params.
        """
        integration = self.get_integration(organization.id, integration_id)

        if integration.status == ObjectStatus.DISABLED:
            return self.respond({"repos": []})

        install = integration.get_installation(organization_id=organization.id)

        if not isinstance(install, RepositoryIntegration):
            return self.respond({"detail": "Repositories not supported"}, status=400)

        per_page = min(int(request.GET.get("per_page", 100)), 100)
        cursor = self._parse_cursor(request)
        installable_only = request.GET.get("installableOnly", "false").lower() == "true"

        installed_repos = Repository.objects.filter(
            integration_id=integration.id, organization_id=organization.id
        ).exclude(status=ObjectStatus.HIDDEN)
        installed_repo_names = {repo.name for repo in installed_repos}

        try:
            paginated = install.get_repositories_paginated(offset=cursor.offset, per_page=per_page)
            if paginated is not None:
                repositories, has_next = paginated
            else:
                repositories = install.get_repositories()
                has_next = False
        except (IntegrationError, IdentityNotValid) as e:
            return self.respond({"detail": str(e)}, status=400)

        serialized = [
            IntegrationRepository(
                name=repo["name"],
                identifier=repo["identifier"],
                defaultBranch=repo.get("default_branch"),
                isInstalled=repo["identifier"] in installed_repo_names,
            )
            for repo in repositories
            if not installable_only or repo["identifier"] not in installed_repo_names
        ]

        response = self.respond({"repos": serialized, "searchable": install.repo_search})

        if has_next or cursor.offset > 0:
            cursor_result = CursorResult(
                results=[],
                prev=Cursor(0, max(0, cursor.offset - per_page), True, cursor.offset > 0),
                next=Cursor(0, cursor.offset + per_page, False, has_next),
            )
            self.add_cursor_headers(request, response, cursor_result)

        return response

    def _parse_cursor(self, request: Request) -> Cursor:
        cursor_param = request.GET.get("cursor", "")
        if not cursor_param:
            return Cursor(0, 0, False)
        try:
            return Cursor.from_string(cursor_param)
        except (ValueError, TypeError):
            return Cursor(0, 0, False)
