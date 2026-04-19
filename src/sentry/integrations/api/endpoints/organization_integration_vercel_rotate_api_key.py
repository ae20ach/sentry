from __future__ import annotations

import logging
from typing import Any

import sentry_sdk
from django.contrib.auth.models import AnonymousUser
from rest_framework.request import Request
from rest_framework.response import Response

from sentry import audit_log
from sentry.api.api_owners import ApiOwner
from sentry.api.api_publish_status import ApiPublishStatus
from sentry.api.base import control_silo_endpoint
from sentry.integrations.api.bases.organization_integrations import (
    OrganizationIntegrationBaseEndpoint,
)
from sentry.integrations.vercel.integration import VercelIntegration
from sentry.organizations.services.organization import RpcUserOrganizationContext
from sentry.shared_integrations.exceptions import ApiError, IntegrationError
from sentry.utils import metrics
from sentry.utils.audit import create_audit_entry

logger = logging.getLogger(__name__)


@control_silo_endpoint
class OrganizationIntegrationVercelRotateApiKeyEndpoint(OrganizationIntegrationBaseEndpoint):
    publish_status = {
        "POST": ApiPublishStatus.PRIVATE,
    }
    owner = ApiOwner.ECOSYSTEM

    def post(
        self,
        request: Request,
        organization_context: RpcUserOrganizationContext,
        integration_id: int,
        **kwds: Any,
    ) -> Response:
        """
        Rotate the SENTRY_AUTH_TOKEN used by a Vercel integration.

        Mints a new internal-integration token, pushes it (along with the
        other core Sentry env vars) to every Vercel project mapped through
        this installation, and revokes the prior token(s).
        """
        organization = organization_context.organization
        integration = self.get_integration(organization.id, integration_id)

        installation = integration.get_installation(organization_id=organization.id)
        if not isinstance(installation, VercelIntegration):
            return Response(
                {"detail": "Rotate is only supported for the Vercel integration."},
                status=400,
            )

        if isinstance(request.user, AnonymousUser):
            return Response({"detail": "Authentication required."}, status=401)

        metrics.incr("vercel.rotate_api_key_attempt", skip_internal=False)

        try:
            mappings_synced = installation.rotate_auth_tokens(user=request.user)
        except IntegrationError as e:
            logger.warning(
                "vercel.rotate_api_key.integration_error",
                extra={
                    "organization_id": organization.id,
                    "integration_id": integration.id,
                    "error": str(e),
                },
            )
            return Response({"detail": str(e)}, status=400)
        except ApiError as e:
            sentry_sdk.capture_exception(e)
            return Response(
                {"detail": "Vercel rejected the rotate request. Please try again."},
                status=502,
            )

        create_audit_entry(
            request=request,
            organization_id=organization.id,
            target_object=integration.id,
            event=audit_log.get_event_id("INTEGRATION_ROTATE_API_KEY"),
            data={"provider": integration.provider, "name": integration.name},
        )
        metrics.incr("vercel.rotate_api_key_success", skip_internal=False)

        return Response({"projectMappingsSynced": mappings_synced}, status=200)
