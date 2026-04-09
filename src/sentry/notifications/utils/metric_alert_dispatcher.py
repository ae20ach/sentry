from __future__ import annotations

import logging
from functools import cached_property
from typing import TYPE_CHECKING

import sentry_sdk

from sentry import features
from sentry.incidents.charts import build_metric_alert_chart
from sentry.incidents.endpoints.serializers.alert_rule import AlertRuleSerializerResponse
from sentry.incidents.endpoints.serializers.incident import DetailedIncidentSerializerResponse
from sentry.incidents.grouptype import MetricIssueEvidenceData
from sentry.incidents.models.incident import IncidentStatus, TriggerStatus
from sentry.incidents.typings.metric_detector import (
    AlertContext,
    MetricIssueContext,
    NotificationContext,
    OpenPeriodContext,
)
from sentry.integrations.metric_alerts import incident_attachment_info
from sentry.models.group import GroupStatus
from sentry.models.groupopenperiod import GroupOpenPeriod
from sentry.models.organization import Organization
from sentry.models.project import Project
from sentry.notifications.platform.service import NotificationService
from sentry.notifications.platform.target import IntegrationNotificationTarget
from sentry.notifications.platform.templates.metric_alert import MetricAlertNotificationData
from sentry.notifications.platform.threading import ThreadingOptions, ThreadKey
from sentry.notifications.platform.types import (
    NotificationProviderKey,
    NotificationSource,
    NotificationTargetResourceType,
)
from sentry.services.eventstore.models import GroupEvent
from sentry.workflow_engine.endpoints.serializers.detector_serializer import (
    DetectorSerializerResponse,
)
from sentry.workflow_engine.models import Detector
from sentry.workflow_engine.types import ActionInvocation, DetectorPriorityLevel

if TYPE_CHECKING:
    from sentry.models.activity import Activity

logger = logging.getLogger(__name__)


class MetricAlertNotificationContextBuilder:
    """
    Builds all context objects needed for metric alert notifications from an ActionInvocation.

    Takes an ActionInvocation in its constructor and lazily computes all derived data
    (contexts, serialized responses, DB fetches) via cached_property.
    """

    def __init__(self, invocation: ActionInvocation) -> None:
        self._invocation = invocation

    # --- Evidence extraction ---

    @cached_property
    def _evidence_data_and_priority(self) -> tuple[MetricIssueEvidenceData, DetectorPriorityLevel]:
        from sentry.models.activity import Activity

        event = self._invocation.event_data.event
        if isinstance(event, GroupEvent):
            return self._extract_from_group_event(event)
        elif isinstance(event, Activity):
            return self._extract_from_activity(event)
        else:
            raise ValueError(
                "WorkflowEventData.event must be a GroupEvent or Activity to invoke metric alert dispatcher"
            )

    @staticmethod
    def _extract_from_group_event(
        event: GroupEvent,
    ) -> tuple[MetricIssueEvidenceData, DetectorPriorityLevel]:
        if event.occurrence is None:
            raise ValueError("Event occurrence is required for alert context")
        if event.occurrence.priority is None:
            raise ValueError("Event occurrence priority is required for alert context")
        evidence_data = MetricIssueEvidenceData(**event.occurrence.evidence_data)
        priority = DetectorPriorityLevel(event.occurrence.priority)
        return evidence_data, priority

    @staticmethod
    def _extract_from_activity(
        event: Activity,
    ) -> tuple[MetricIssueEvidenceData, DetectorPriorityLevel]:
        from sentry.types.activity import ActivityType

        if event.type != ActivityType.SET_RESOLVED.value:
            raise ValueError("Activity type must be SET_RESOLVED to invoke metric alert dispatcher")
        if event.data is None or not event.data:
            raise ValueError("Activity data is required for alert context")
        evidence_data = MetricIssueEvidenceData(**dict(event.data))
        priority = DetectorPriorityLevel.OK
        return evidence_data, priority

    # --- Context properties ---

    @cached_property
    def notification_context(self) -> NotificationContext:
        return NotificationContext.from_action_model(self._invocation.action)

    @cached_property
    def alert_context(self) -> AlertContext:
        evidence_data, priority = self._evidence_data_and_priority
        return AlertContext.from_workflow_engine_models(
            self._invocation.detector,
            evidence_data,
            self._invocation.event_data.group.status,
            priority,
        )

    @cached_property
    def metric_issue_context(self) -> MetricIssueContext:
        evidence_data, priority = self._evidence_data_and_priority
        return MetricIssueContext.from_group_event(
            self._invocation.event_data.group, evidence_data, priority
        )

    @cached_property
    def open_period_context(self) -> OpenPeriodContext:
        return OpenPeriodContext.from_group(self._invocation.event_data.group)

    @cached_property
    def trigger_status(self) -> TriggerStatus:
        group = self._invocation.event_data.group
        if group.status in (GroupStatus.RESOLVED, GroupStatus.IGNORED):
            return TriggerStatus.RESOLVED
        return TriggerStatus.ACTIVE

    # --- DB fetches and serializers ---

    @cached_property
    def detector(self) -> Detector:
        return Detector.objects.get(id=self.alert_context.action_identifier_id)

    @cached_property
    def open_period(self) -> GroupOpenPeriod:
        return GroupOpenPeriod.objects.get(id=self.open_period_context.id)

    @cached_property
    def alert_rule_serialized_response(self) -> AlertRuleSerializerResponse:
        from sentry.notifications.notification_action.metric_alert_registry.handlers.utils import (
            get_alert_rule_serializer,
        )

        return get_alert_rule_serializer(self.detector)

    @cached_property
    def detector_serialized_response(self) -> DetectorSerializerResponse:
        from sentry.notifications.notification_action.metric_alert_registry.handlers.utils import (
            get_detector_serializer,
        )

        return get_detector_serializer(self.detector)

    @cached_property
    def incident_serialized_response(self) -> DetailedIncidentSerializerResponse:
        from sentry.notifications.notification_action.metric_alert_registry.handlers.utils import (
            get_detailed_incident_serializer,
        )

        return get_detailed_incident_serializer(self.open_period)

    # --- Convenience accessors ---

    @property
    def organization(self) -> Organization:
        return self._invocation.detector.project.organization

    @property
    def project(self) -> Project:
        return self._invocation.detector.project

    @property
    def notification_uuid(self) -> str:
        return self._invocation.notification_uuid


class MetricAlertNotificationDispatcher:
    """
    Dispatches metric alert notifications via the notification platform.

    Takes a MetricAlertNotificationContextBuilder and uses its pre-computed
    context objects to build and send notifications.
    """

    def __init__(self, ctx: MetricAlertNotificationContextBuilder) -> None:
        self._ctx = ctx

    # --- Notification platform dispatch ---

    def send_via_notification_platform(
        self,
        provider_key: NotificationProviderKey,
        referrer: str = "metric_alert",
        resource_type: NotificationTargetResourceType = NotificationTargetResourceType.CHANNEL,
    ) -> None:
        if self._ctx.notification_context.integration_id is None:
            raise ValueError("Integration ID is None")

        if self._ctx.notification_context.target_identifier is None:
            raise ValueError("Target identifier is None")

        attachment_info = incident_attachment_info(
            organization=self._ctx.organization,
            alert_context=self._ctx.alert_context,
            metric_issue_context=self._ctx.metric_issue_context,
            notification_uuid=self._ctx.notification_uuid,
            referrer=referrer,
        )

        chart_url = self._build_chart_url()

        data = MetricAlertNotificationData(
            group_id=self._ctx.metric_issue_context.id,
            organization_id=self._ctx.organization.id,
            notification_uuid=self._ctx.notification_uuid,
            action_id=self._ctx.notification_context.id,
            open_period_context=self._ctx.open_period_context,
            new_status=self._ctx.metric_issue_context.new_status.value,
            title=attachment_info["title"],
            title_link=attachment_info["title_link"],
            text=attachment_info["text"],
            chart_url=chart_url,
        )

        target = IntegrationNotificationTarget(
            provider_key=provider_key,
            resource_type=resource_type,
            resource_id=self._ctx.notification_context.target_identifier,
            integration_id=self._ctx.notification_context.integration_id,
            organization_id=self._ctx.organization.id,
        )

        threading_options = ThreadingOptions(
            thread_key=ThreadKey(
                key_type=NotificationSource.METRIC_ALERT,
                key_data={
                    "action_id": self._ctx.notification_context.id,
                    "group_id": self._ctx.metric_issue_context.id,
                    "open_period_start": self._ctx.open_period_context.date_started.isoformat(),
                },
            ),
            reply_broadcast=(self._ctx.metric_issue_context.new_status == IncidentStatus.CRITICAL),
        )

        NotificationService[MetricAlertNotificationData](data=data).notify_sync(
            targets=[target], threading_options=threading_options
        )

    def _build_chart_url(self) -> str | None:
        if not (
            features.has("organizations:metric-alert-chartcuterie", self._ctx.organization)
            and self._ctx.alert_rule_serialized_response
            and self._ctx.incident_serialized_response
        ):
            return None
        try:
            return build_metric_alert_chart(
                organization=self._ctx.organization,
                alert_rule_serialized_response=self._ctx.alert_rule_serialized_response,
                snuba_query=self._ctx.metric_issue_context.snuba_query,
                alert_context=self._ctx.alert_context,
                open_period_context=self._ctx.open_period_context,
                selected_incident_serialized=self._ctx.incident_serialized_response,
                subscription=self._ctx.metric_issue_context.subscription,
                detector_serialized_response=self._ctx.detector_serialized_response,
            )
        except Exception as e:
            sentry_sdk.capture_exception(e)
            return None
