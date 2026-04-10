from unittest.mock import patch

from sentry.integrations.messaging.metrics import SeerSlackHaltReason
from sentry.models.organization import Organization
from sentry.testutils.asserts import assert_halt_metric

from . import SEER_EXPLORER_FEATURES, BaseEventTest

APP_MENTION_EVENT = {
    "type": "app_mention",
    "channel": "C1234567890",
    "user": "U1234567890",
    "text": "<@U0BOT> What is causing this issue? https://testserver/organizations/test-org/issues/123/",
    "ts": "1234567890.123456",
    "event_ts": "1234567890.123456",
}

AUTHORIZATIONS_DATA = {
    "authorizations": [{"user_id": "U0BOT", "is_bot": True}],
}

THREADED_APP_MENTION_EVENT = {
    **APP_MENTION_EVENT,
    "thread_ts": "1234567890.000001",
}


class AppMentionEventTest(BaseEventTest):
    @patch("sentry.seer.entrypoints.slack.tasks.process_mention_for_slack.apply_async")
    def test_app_mention_dispatches_task(self, mock_apply_async):
        self.link_identity()
        with self.feature(SEER_EXPLORER_FEATURES):
            resp = self.post_webhook(
                event_data=THREADED_APP_MENTION_EVENT, data=AUTHORIZATIONS_DATA
            )

        assert resp.status_code == 200
        mock_apply_async.assert_called_once()
        kwargs = mock_apply_async.call_args[1]["kwargs"]
        assert kwargs["integration_id"] == self.integration.id
        assert kwargs["organization_id"] == self.organization.id
        assert kwargs["channel_id"] == "C1234567890"
        assert kwargs["ts"] == "1234567890.123456"
        assert kwargs["thread_ts"] == "1234567890.000001"
        assert kwargs["text"] == THREADED_APP_MENTION_EVENT["text"]
        assert kwargs["slack_user_id"] == "U1234567890"
        assert kwargs["bot_user_id"] == "U0BOT"

    @patch("sentry.seer.entrypoints.slack.tasks.process_mention_for_slack.apply_async")
    def test_app_mention_dispatches_task_no_authorizations(self, mock_apply_async):
        self.link_identity()
        with self.feature(SEER_EXPLORER_FEATURES):
            resp = self.post_webhook(event_data=THREADED_APP_MENTION_EVENT)

        assert resp.status_code == 200
        mock_apply_async.assert_called_once()
        kwargs = mock_apply_async.call_args[1]["kwargs"]
        assert kwargs["bot_user_id"] == ""

    @patch("sentry.seer.entrypoints.slack.tasks.process_mention_for_slack.apply_async")
    def test_app_mention_non_threaded_dispatches_task(self, mock_apply_async):
        """Non-threaded mentions dispatch with ts set and thread_ts as None."""
        self.link_identity()
        with self.feature(SEER_EXPLORER_FEATURES):
            resp = self.post_webhook(event_data=APP_MENTION_EVENT)

        assert resp.status_code == 200
        mock_apply_async.assert_called_once()
        kwargs = mock_apply_async.call_args[1]["kwargs"]
        assert kwargs["ts"] == APP_MENTION_EVENT["ts"]
        assert kwargs["thread_ts"] is None

    @patch("sentry.integrations.utils.metrics.EventLifecycle.record_event")
    @patch("sentry.integrations.slack.webhooks.event.send_identity_link_prompt")
    @patch("sentry.seer.entrypoints.slack.tasks.process_mention_for_slack.apply_async")
    def test_app_mention_identity_not_linked(self, mock_apply_async, mock_send_link, mock_record):
        """When no Slack identity is linked, send a link prompt and halt."""
        with self.feature(SEER_EXPLORER_FEATURES):
            resp = self.post_webhook(event_data=APP_MENTION_EVENT)

        assert resp.status_code == 200
        mock_apply_async.assert_not_called()
        mock_send_link.assert_called_once()
        assert mock_send_link.call_args[1]["slack_user_id"] == "U1234567890"
        assert mock_send_link.call_args[1]["is_welcome_message"] is False
        assert_halt_metric(mock_record, SeerSlackHaltReason.IDENTITY_NOT_LINKED)

    @patch("sentry.integrations.utils.metrics.EventLifecycle.record_event")
    @patch("sentry.seer.entrypoints.slack.tasks.process_mention_for_slack.apply_async")
    def test_app_mention_feature_flag_disabled(self, mock_apply_async, mock_record):
        self.link_identity()
        resp = self.post_webhook(event_data=APP_MENTION_EVENT)

        assert resp.status_code == 200
        mock_apply_async.assert_not_called()
        assert_halt_metric(mock_record, SeerSlackHaltReason.NO_VALID_ORGANIZATION)

    @patch("sentry.integrations.utils.metrics.EventLifecycle.record_event")
    @patch("sentry.seer.entrypoints.slack.tasks.process_mention_for_slack.apply_async")
    def test_app_mention_empty_text(self, mock_apply_async, mock_record):
        self.link_identity()
        event_data = {**APP_MENTION_EVENT, "text": ""}
        with self.feature(SEER_EXPLORER_FEATURES):
            resp = self.post_webhook(event_data=event_data)

        assert resp.status_code == 200
        mock_apply_async.assert_not_called()
        assert_halt_metric(mock_record, SeerSlackHaltReason.MISSING_EVENT_DATA)

    @patch("sentry.integrations.utils.metrics.EventLifecycle.record_event")
    @patch("sentry.seer.entrypoints.slack.tasks.process_mention_for_slack.apply_async")
    def test_app_mention_no_integration(self, mock_apply_async, mock_record):
        """When the integration has no org integrations, we should not dispatch."""
        self.link_identity()
        with patch(
            "sentry.integrations.slack.webhooks.event.integration_service.get_organization_integrations",
            return_value=[],
        ):
            with self.feature(SEER_EXPLORER_FEATURES):
                resp = self.post_webhook(event_data=APP_MENTION_EVENT)

        assert resp.status_code == 200
        mock_apply_async.assert_not_called()
        assert_halt_metric(mock_record, SeerSlackHaltReason.NO_VALID_INTEGRATION)

    @patch("sentry.integrations.utils.metrics.EventLifecycle.record_event")
    @patch("sentry.seer.entrypoints.slack.tasks.process_mention_for_slack.apply_async")
    def test_app_mention_org_not_found(self, mock_apply_async, mock_record):
        self.link_identity()
        with patch.object(
            Organization.objects,
            "get_from_cache",
            side_effect=Organization.DoesNotExist,
        ):
            with self.feature(SEER_EXPLORER_FEATURES):
                resp = self.post_webhook(event_data=APP_MENTION_EVENT)

        assert resp.status_code == 200
        mock_apply_async.assert_not_called()
        assert_halt_metric(mock_record, SeerSlackHaltReason.NO_VALID_ORGANIZATION)

    @patch("sentry.integrations.utils.metrics.EventLifecycle.record_event")
    @patch("sentry.seer.entrypoints.slack.tasks.process_mention_for_slack.apply_async")
    def test_app_mention_linked_user_not_org_member(self, mock_apply_async, mock_record):
        """When the Slack user has a linked identity but is not a member of the
        org with Seer access, the task should not be dispatched."""
        other_user = self.create_user()
        self.link_identity(user=other_user)

        with self.feature(SEER_EXPLORER_FEATURES):
            resp = self.post_webhook(event_data=APP_MENTION_EVENT)

        assert resp.status_code == 200
        mock_apply_async.assert_not_called()
        assert_halt_metric(mock_record, SeerSlackHaltReason.NO_VALID_ORGANIZATION)
