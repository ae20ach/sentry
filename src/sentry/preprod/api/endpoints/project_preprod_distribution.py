from __future__ import annotations

import logging
from typing import Any, cast

from pydantic import BaseModel, Field
from rest_framework.request import Request
from rest_framework.response import Response

from sentry.api.api_owners import ApiOwner
from sentry.api.api_publish_status import ApiPublishStatus
from sentry.api.base import internal_cell_silo_endpoint
from sentry.models.project import Project
from sentry.preprod.api.bases.preprod_artifact_endpoint import PreprodArtifactEndpoint
from sentry.preprod.api.endpoints.project_preprod_size import parse_request_with_pydantic
from sentry.preprod.authentication import (
    LaunchpadRpcPermission,
    LaunchpadRpcSignatureAuthentication,
)
from sentry.preprod.build_distribution_webhooks import send_build_distribution_webhook
from sentry.preprod.models import PreprodArtifact

logger = logging.getLogger(__name__)


_MAX_ERROR_CODE = max(int(c) for c in PreprodArtifact.InstallableAppErrorCode)


class PutDistribution(BaseModel):
    error_code: int = Field(ge=0, le=_MAX_ERROR_CODE)
    error_message: str


# Launchpad historically encoded specific reasons inside the free-form
# error_message field (e.g. error_code=SKIPPED + error_message="invalid_signature").
# Translate those legacy payloads to the new granular enum values so the frontend
# can work purely off error_code. Remove once all launchpad deployments emit the
# new codes directly.
_LEGACY_MESSAGE_TO_CODE: dict[
    tuple[PreprodArtifact.InstallableAppErrorCode, str],
    PreprodArtifact.InstallableAppErrorCode,
] = {
    (
        PreprodArtifact.InstallableAppErrorCode.SKIPPED,
        "invalid_signature",
    ): PreprodArtifact.InstallableAppErrorCode.INVALID_CODE_SIGNATURE,
    (
        PreprodArtifact.InstallableAppErrorCode.SKIPPED,
        "simulator",
    ): PreprodArtifact.InstallableAppErrorCode.SIMULATOR_BUILD,
    (
        PreprodArtifact.InstallableAppErrorCode.PROCESSING_ERROR,
        "Unsupported artifact type",
    ): PreprodArtifact.InstallableAppErrorCode.UNSUPPORTED_ARTIFACT_TYPE,
}


def _translate_legacy_payload(error_code: int, error_message: str) -> tuple[int, str | None]:
    try:
        code = PreprodArtifact.InstallableAppErrorCode(error_code)
    except ValueError:
        return error_code, error_message
    translated = _LEGACY_MESSAGE_TO_CODE.get((code, error_message))
    if translated is None:
        return error_code, error_message
    return int(translated), None


@internal_cell_silo_endpoint
class ProjectPreprodDistributionEndpoint(PreprodArtifactEndpoint):
    owner = ApiOwner.EMERGE_TOOLS
    publish_status = {
        "PUT": ApiPublishStatus.PRIVATE,
    }
    authentication_classes = (LaunchpadRpcSignatureAuthentication,)
    permission_classes = (LaunchpadRpcPermission,)

    def put(
        self,
        request: Request,
        project: Project,
        head_artifact_id: int,
        head_artifact: PreprodArtifact,
    ) -> Response:
        put: PutDistribution = parse_request_with_pydantic(request, cast(Any, PutDistribution))

        error_code, error_message = _translate_legacy_payload(put.error_code, put.error_message)
        head_artifact.installable_app_error_code = error_code
        head_artifact.installable_app_error_message = error_message
        head_artifact.save(
            update_fields=[
                "installable_app_error_code",
                "installable_app_error_message",
                "date_updated",
            ]
        )

        send_build_distribution_webhook(
            artifact=head_artifact,
            organization_id=project.organization_id,
        )

        return Response({"artifactId": str(head_artifact.id)})
