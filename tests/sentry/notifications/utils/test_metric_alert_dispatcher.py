import uuid
from dataclasses import asdict

from sentry.incidents.models.alert_rule import AlertRuleThresholdType
from sentry.incidents.typings.metric_detector import AlertContext, NotificationContext
from sentry.models.groupopenperiod import GroupOpenPeriod
from sentry.notifications.models.notificationaction import ActionTarget
from sentry.notifications.utils.metric_alert_dispatcher import (
    MetricAlertNotificationContextBuilder,
)
from sentry.seer.anomaly_detection.types import AnomalyDetectionThresholdType
from sentry.testutils.skips import requires_snuba
from sentry.types.group import PriorityLevel
from sentry.workflow_engine.models import Action
from sentry.workflow_engine.types import ActionInvocation, WorkflowEventData
from tests.sentry.notifications.notification_action.test_metric_alert_registry_handlers import (
    MetricAlertHandlerBase,
)

pytestmark = [requires_snuba]


class TestMetricAlertNotificationContextBuilder(MetricAlertHandlerBase):
    def setUp(self) -> None:
        self.create_models()
        self.action = self.create_action(
            type=Action.Type.DISCORD,
            integration_id="1234567890",
            config={"target_identifier": "channel456", "target_type": ActionTarget.SPECIFIC},
            data={"tags": "environment,user,my_tag"},
        )

    def _make_invocation(self, event_data: WorkflowEventData | None = None) -> ActionInvocation:
        return ActionInvocation(
            event_data=event_data or self.event_data,
            action=self.action,
            detector=self.detector,
            notification_uuid=str(uuid.uuid4()),
        )

    def test_build_notification_context(self) -> None:
        builder = MetricAlertNotificationContextBuilder(self._make_invocation())
        notification_context = builder.notification_context
        assert isinstance(notification_context, NotificationContext)
        assert notification_context.target_identifier == "channel456"
        assert notification_context.integration_id == "1234567890"
        assert notification_context.sentry_app_config is None

    def test_build_alert_context(self) -> None:
        builder = MetricAlertNotificationContextBuilder(self._make_invocation())
        alert_context = builder.alert_context
        assert isinstance(alert_context, AlertContext)
        assert alert_context.name == self.detector.name
        assert alert_context.action_identifier_id == self.detector.id
        assert alert_context.threshold_type == AlertRuleThresholdType.ABOVE
        assert alert_context.comparison_delta is None

    def test_build_alert_context_anomaly_detection(self) -> None:
        group, _, group_event = self.create_group_event(
            occurrence=self.create_issue_occurrence(
                priority=PriorityLevel.HIGH.value,
                level="error",
                evidence_data=asdict(self.anomaly_detection_evidence_data),
            ),
        )
        GroupOpenPeriod.objects.get_or_create(
            group=group,
            project=self.project,
            date_started=group.first_seen,
        )
        event_data = WorkflowEventData(
            event=group_event,
            workflow_env=self.workflow.environment,
            group=group,
        )
        builder = MetricAlertNotificationContextBuilder(self._make_invocation(event_data))
        alert_context = builder.alert_context
        assert isinstance(alert_context, AlertContext)
        assert alert_context.name == self.detector.name
        assert alert_context.action_identifier_id == self.detector.id
        assert alert_context.threshold_type == AnomalyDetectionThresholdType.ABOVE_AND_BELOW
        assert alert_context.comparison_delta is None
        assert alert_context.alert_threshold == 0
        assert alert_context.resolve_threshold == 0
