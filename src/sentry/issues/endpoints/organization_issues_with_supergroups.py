from __future__ import annotations

import logging
from typing import Any

from rest_framework.request import Request
from rest_framework.response import Response

from sentry import features
from sentry.api.api_owners import ApiOwner
from sentry.api.api_publish_status import ApiPublishStatus
from sentry.api.base import cell_silo_endpoint
from sentry.api.bases import OrganizationEventPermission
from sentry.api.bases.organization import OrganizationEndpoint
from sentry.api.helpers.group_index import calculate_stats_period
from sentry.api.helpers.group_index.validators import ValidationError
from sentry.api.utils import get_date_range_from_stats_period, handle_query_errors
from sentry.issues.endpoints.organization_group_index import (
    ERR_INVALID_STATS_PERIOD,
    search_and_serialize_issues,
)
from sentry.models.organization import Organization
from sentry.seer.models import SeerApiError
from sentry.seer.signed_seer_api import SupergroupsByGroupIdsResponse
from sentry.seer.supergroups.by_group import get_supergroups_by_group_ids

logger = logging.getLogger(__name__)

DEFAULT_PAGE_SIZE = 25
# Overfetch raw groups so collapsing supergroup members rarely starves the page.
OVERFETCH_MULTIPLIER = 2


@cell_silo_endpoint
class OrganizationIssuesWithSupergroupsEndpoint(OrganizationEndpoint):
    publish_status = {
        "GET": ApiPublishStatus.EXPERIMENTAL,
    }
    owner = ApiOwner.ISSUES
    permission_classes = (OrganizationEventPermission,)
    enforce_rate_limit = True

    def get(self, request: Request, organization: Organization) -> Response:
        if not features.has("organizations:top-issues-ui", organization, actor=request.user):
            return Response({"detail": "Feature not available"}, status=403)

        stats_period = request.GET.get("groupStatsPeriod")
        if stats_period not in (None, "", "24h", "14d", "auto"):
            return Response({"detail": ERR_INVALID_STATS_PERIOD}, status=400)

        try:
            client_limit = int(request.GET.get("limit", DEFAULT_PAGE_SIZE))
        except ValueError:
            return Response({"detail": "invalid limit"}, status=400)

        start, end = get_date_range_from_stats_period(request.GET)
        stats_period, stats_period_start, stats_period_end = calculate_stats_period(
            stats_period, start, end
        )

        environments = self.get_environments(request, organization)
        projects = self.get_projects(request, organization)
        if not projects:
            return Response([])

        try:
            with handle_query_errors():
                groups, cursor_result, _ = search_and_serialize_issues(
                    request,
                    organization,
                    projects,
                    environments,
                    stats_period=stats_period,
                    stats_period_start=stats_period_start,
                    stats_period_end=stats_period_end,
                    start=start,
                    end=end,
                    expand=request.GET.getlist("expand", []),
                    collapse=request.GET.getlist("collapse", []),
                    limit=client_limit * OVERFETCH_MULTIPLIER,
                )
        except ValidationError as exc:
            return Response({"detail": str(exc)}, status=400)

        group_ids = [int(g["id"]) for g in groups]
        supergroup_data = _fetch_supergroup_data(organization, request.user.id, group_ids)
        rows = _blend_rows(groups, supergroup_data)

        response = Response(rows)
        self.add_cursor_headers(request, response, cursor_result)
        return response


def _fetch_supergroup_data(
    organization: Organization,
    user_id: int | None,
    group_ids: list[int],
) -> SupergroupsByGroupIdsResponse | None:
    if not group_ids:
        return None
    try:
        return get_supergroups_by_group_ids(organization, group_ids, user_id=user_id)
    except SeerApiError:
        # The issue stream must keep working even if Seer is down; fall back to plain issues.
        logger.exception("issues_with_supergroups.seer_fetch_failed")
        return None


def _blend_rows(
    groups: list[dict[str, Any]],
    supergroup_data: SupergroupsByGroupIdsResponse | None,
) -> list[dict[str, Any]]:
    if supergroup_data is None:
        return [{"type": "issue", "group": g} for g in groups]

    sg_by_group_id: dict[int, dict[str, Any]] = {}
    for sg in supergroup_data["data"]:
        for gid in sg["group_ids"]:
            sg_by_group_id[gid] = sg

    # Walk groups in stream order. A supergroup row is positioned where its
    # first matching member appears; subsequent matching members fold into it.
    rows: list[dict[str, Any]] = []
    sg_rows: dict[int, dict[str, Any]] = {}
    for g in groups:
        sg = sg_by_group_id.get(int(g["id"]))
        if sg is None:
            rows.append({"type": "issue", "group": g})
            continue
        existing = sg_rows.get(sg["id"])
        if existing is not None:
            existing["matchingGroups"].append(g)
            continue
        row: dict[str, Any] = {"type": "supergroup", "supergroup": sg, "matchingGroups": [g]}
        sg_rows[sg["id"]] = row
        rows.append(row)

    # Demote supergroup rows that ended up with a single visible member — the
    # search's filter (status, query, etc.) left nothing to collapse.
    for i, row in enumerate(rows):
        if row["type"] == "supergroup" and len(row["matchingGroups"]) == 1:
            rows[i] = {"type": "issue", "group": row["matchingGroups"][0]}
    return rows
