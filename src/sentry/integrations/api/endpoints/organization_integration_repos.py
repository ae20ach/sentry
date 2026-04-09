from typing import Any, TypedDict

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
from sentry.integrations.source_code_management.repository import RepositoryIntegration
from sentry.models.organization import Organization
from sentry.models.repository import Repository
from sentry.shared_integrations.exceptions import IntegrationError
from sentry.utils.cursors import Cursor, CursorResult


class IntegrationRepository(TypedDict):
    name: str
    identifier: str
    isInstalled: bool
    defaultBranch: str | None
    externalId: str


@cell_silo_endpoint
class OrganizationIntegrationReposEndpoint(CellOrganizationIntegrationBaseEndpoint):
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
        Get the list of repositories available in an integration
        ````````````````````````````````````````````````````````

        Gets all repositories that an integration makes available,
        and indicates whether or not you can search repositories
        by name.

        :qparam string search: Name fragment to search repositories by.
        :qparam bool installableOnly: If true, return only repositories that can be installed.
                                      If false or not provided, return all repositories.
        :qparam bool accessibleOnly: If true, only return repositories that the integration
                                     installation has access to, filtering locally instead of
                                     using the provider's search API which may return results
                                     beyond the installation's scope.
        :qparam int per_page: When present (without ``search``), enables cursor-based
                              pagination. Providers that support paginated browsing return
                              one page of results with ``Link`` headers. Providers that
                              don't support it fall back to returning the full list.
        :qparam string cursor: Pagination cursor (only used when ``per_page`` is set).
        """
        integration = self.get_integration(organization.id, integration_id)

        if integration.status == ObjectStatus.DISABLED:
            return self.respond({"repos": []})

        installed_repos = Repository.objects.filter(
            integration_id=integration.id, organization_id=organization.id
        ).exclude(status=ObjectStatus.HIDDEN)
        installed_repo_names = {installed_repo.name for installed_repo in installed_repos}

        install = integration.get_installation(organization_id=organization.id)

        if isinstance(install, RepositoryIntegration):
            search = request.GET.get("search")
            accessible_only = request.GET.get("accessibleOnly", "false").lower() == "true"

            # When per_page is present and there's no search query,
            # try the paginated path. This lets pagination-aware callers
            # (e.g. the SCM onboarding repo selector) get fast page-at-a-time
            # results, while existing callers that don't send per_page
            # continue to receive the full list.
            paginate = "per_page" in request.GET and not search
            if paginate:
                per_page = max(1, min(int(request.GET.get("per_page", 100)), 100))
                cursor = self._parse_cursor(request)
                paginated = install.get_repositories_paginated(
                    offset=cursor.offset, per_page=per_page
                )
            else:
                paginated = None

            if paginated is not None:
                repositories, has_next = paginated
            else:
                try:
                    repositories = install.get_repositories(
                        search,
                        accessible_only=accessible_only,
                        use_cache=accessible_only and bool(search),
                    )
                except (IntegrationError, IdentityNotValid) as e:
                    return self.respond({"detail": str(e)}, status=400)
                has_next = False

            installable_only = request.GET.get("installableOnly", "false").lower() == "true"

            serialized_repositories = [
                IntegrationRepository(
                    name=repo["name"],
                    identifier=repo["identifier"],
                    defaultBranch=repo.get("default_branch"),
                    isInstalled=repo["identifier"] in installed_repo_names,
                    externalId=repo["external_id"],
                )
                for repo in repositories
                if not installable_only or repo["identifier"] not in installed_repo_names
            ]

            response = self.respond(
                {"repos": serialized_repositories, "searchable": install.repo_search}
            )

            if paginated is not None and (has_next or cursor.offset > 0):
                cursor_result = CursorResult(
                    results=[],
                    prev=Cursor(0, max(0, cursor.offset - per_page), True, cursor.offset > 0),
                    next=Cursor(0, cursor.offset + per_page, False, has_next),
                )
                self.add_cursor_headers(request, response, cursor_result)

            return response

        return self.respond({"detail": "Repositories not supported"}, status=400)

    def _parse_cursor(self, request: Request) -> Cursor:
        cursor_param = request.GET.get("cursor", "")
        if not cursor_param:
            return Cursor(0, 0, False)
        try:
            return Cursor.from_string(cursor_param)
        except (ValueError, TypeError):
            return Cursor(0, 0, False)
