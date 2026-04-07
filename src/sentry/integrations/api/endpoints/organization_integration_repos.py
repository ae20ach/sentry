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
            paginate = request.GET.get("paginate", "false").lower() == "true"

            # Paginated path: opt-in via paginate=true, only when not
            # searching, and only for integrations that support it.
            if paginate and not search:
                result = self._get_paginated_repos(request, install, installed_repo_names)
                if result is not None:
                    return result

            try:
                repositories = install.get_repositories(search, accessible_only=accessible_only)
            except (IntegrationError, IdentityNotValid) as e:
                return self.respond({"detail": str(e)}, status=400)

            return self.respond(
                {
                    "repos": self._serialize_repos(repositories, installed_repo_names, request),
                    "searchable": install.repo_search,
                }
            )

        return self.respond({"detail": "Repositories not supported"}, status=400)

    def _get_paginated_repos(
        self,
        request: Request,
        install: RepositoryIntegration,
        installed_repo_names: set[str],
    ) -> Response | None:
        cursor_param = request.GET.get("cursor")
        try:
            cursor = Cursor.from_string(cursor_param) if cursor_param else Cursor(0, 0, False)
            per_page = min(int(request.GET.get("per_page", 25)), 100)
        except (ValueError, TypeError):
            return self.respond({"detail": "Invalid cursor or per_page parameter."}, status=400)
        page_number = (cursor.offset // per_page) + 1

        try:
            result = install.get_repositories_page(page=page_number, per_page=per_page)
        except (IntegrationError, IdentityNotValid) as e:
            return self.respond({"detail": str(e)}, status=400)

        if result is None:
            return None

        repositories, has_next = result

        response = self.respond(
            {
                "repos": self._serialize_repos(repositories, installed_repo_names, request),
                "searchable": install.repo_search,
            }
        )
        cursor_result = CursorResult(
            results=[],
            prev=Cursor(0, max(0, cursor.offset - per_page), True, cursor.offset > 0),
            next=Cursor(0, cursor.offset + per_page, False, has_next),
        )
        self.add_cursor_headers(request, response, cursor_result)
        return response

    @staticmethod
    def _serialize_repos(
        repositories: list[dict[str, Any]],
        installed_repo_names: set[str],
        request: Request,
    ) -> list[IntegrationRepository]:
        installable_only = request.GET.get("installableOnly", "false").lower() == "true"
        return [
            IntegrationRepository(
                name=repo["name"],
                identifier=repo["identifier"],
                defaultBranch=repo.get("default_branch"),
                isInstalled=repo["identifier"] in installed_repo_names,
            )
            for repo in repositories
            if not installable_only or repo["identifier"] not in installed_repo_names
        ]
