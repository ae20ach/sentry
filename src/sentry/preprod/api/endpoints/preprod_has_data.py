from __future__ import annotations

from rest_framework.request import Request
from rest_framework.response import Response

from sentry import features
from sentry.api.api_owners import ApiOwner
from sentry.api.api_publish_status import ApiPublishStatus
from sentry.api.base import cell_silo_endpoint
from sentry.api.bases.organization import NoProjects, OrganizationEndpoint
from sentry.models.organization import Organization
from sentry.preprod.models import PreprodArtifact, PreprodArtifactSizeMetrics
from sentry.preprod.snapshots.models import PreprodSnapshotMetrics

VALID_TYPES = {"size", "snapshots"}


@cell_silo_endpoint
class OrganizationPreprodHasDataEndpoint(OrganizationEndpoint):
    owner = ApiOwner.EMERGE_TOOLS
    publish_status = {
        "GET": ApiPublishStatus.EXPERIMENTAL,
    }

    def get(self, request: Request, organization: Organization) -> Response:
        if not features.has(
            "organizations:preprod-frontend-routes", organization, actor=request.user
        ):
            return Response(
                {"detail": "Feature organizations:preprod-frontend-routes is not enabled."},
                status=403,
            )

        requested_types = set(request.GET.getlist("type"))
        valid_requested = requested_types & VALID_TYPES
        if not valid_requested:
            return Response(
                {"detail": f"type must include at least one of: {', '.join(sorted(VALID_TYPES))}"},
                status=400,
            )

        try:
            params = self.get_filter_params(request, organization, date_filter_optional=True)
        except NoProjects:
            return Response({t: False for t in valid_requested})

        artifact_qs = PreprodArtifact.objects.filter(
            project_id__in=params["project_id"],
        )

        if params.get("start"):
            artifact_qs = artifact_qs.filter(date_added__gte=params["start"])
        if params.get("end"):
            artifact_qs = artifact_qs.filter(date_added__lte=params["end"])

        result = {}

        if "size" in valid_requested:
            result["size"] = PreprodArtifactSizeMetrics.objects.filter(
                preprod_artifact__in=artifact_qs
            ).exists()

        if "snapshots" in valid_requested:
            result["snapshots"] = PreprodSnapshotMetrics.objects.filter(
                preprod_artifact__in=artifact_qs
            ).exists()

        return Response(result)
