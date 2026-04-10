from unittest.mock import patch

from sentry.integrations.messaging.metrics import SeerSlackHaltReason
from sentry.testutils.asserts import assert_halt_metric

from . import SEER_EXPLORER_FEATURES, BaseEventTest

ASSISTANT_THREAD_STARTED_EVENT = {
    "type": "assistant_thread_started",
    "assistant_thread": {
        "user_id": "U1234567890",
        "context": {
            "channel_id": "C1234567890",
            "team_id": "T07XY8FPJ5C",
            "enterprise_id": "E480293PS82",
        },
        "channel_id": "D1234567890",
        "thread_ts": "1729999327.187299",
    },
    "event_ts": "1715873754.429808",
}


class AssistantThreadStartedEventTest(BaseEventTest):
    @patch("sentry.integrations.slack.integration.SlackIntegration.set_suggested_prompts")
    def test_sends_suggested_prompts(self, mock_set_prompts):
        self.link_identity()
        with self.feature(SEER_EXPLORER_FEATURES):
            resp = self.post_webhook(event_data=ASSISTANT_THREAD_STARTED_EVENT)

        assert resp.status_code == 200
        mock_set_prompts.assert_called_once()
        kwargs = mock_set_prompts.call_args[1]
        assert kwargs["channel_id"] == "D1234567890"
        assert kwargs["thread_ts"] == "1729999327.187299"
        assert len(kwargs["prompts"]) == 4
        assert kwargs["title"]

    @patch("sentry.integrations.slack.integration.SlackIntegration.set_suggested_prompts")
    def test_prompt_titles_and_messages(self, mock_set_prompts):
        self.link_identity()
        with self.feature(SEER_EXPLORER_FEATURES):
            self.post_webhook(event_data=ASSISTANT_THREAD_STARTED_EVENT)

        prompts = mock_set_prompts.call_args[1]["prompts"]
        for prompt in prompts:
            assert "title" in prompt
            assert "message" in prompt
            assert prompt["title"]
            assert prompt["message"]

    @patch("sentry.integrations.utils.metrics.EventLifecycle.record_event")
    @patch("sentry.integrations.slack.webhooks.event.send_identity_link_prompt")
    @patch("sentry.integrations.slack.integration.SlackIntegration.set_suggested_prompts")
    def test_identity_not_linked(self, mock_set_prompts, mock_send_link, mock_record):
        """When no identity is linked, send a welcome link prompt and halt."""
        resp = self.post_webhook(event_data=ASSISTANT_THREAD_STARTED_EVENT)

        assert resp.status_code == 200
        mock_set_prompts.assert_not_called()
        mock_send_link.assert_called_once()
        assert mock_send_link.call_args[1]["is_welcome_message"] is True
        assert_halt_metric(mock_record, SeerSlackHaltReason.IDENTITY_NOT_LINKED)

    @patch("sentry.integrations.utils.metrics.EventLifecycle.record_event")
    @patch("sentry.integrations.slack.integration.SlackIntegration.set_suggested_prompts")
    def test_feature_flag_disabled(self, mock_set_prompts, mock_record):
        self.link_identity()
        resp = self.post_webhook(event_data=ASSISTANT_THREAD_STARTED_EVENT)

        assert resp.status_code == 200
        mock_set_prompts.assert_not_called()
        assert_halt_metric(mock_record, SeerSlackHaltReason.NO_VALID_ORGANIZATION)

    @patch("sentry.integrations.utils.metrics.EventLifecycle.record_event")
    @patch("sentry.integrations.slack.integration.SlackIntegration.set_suggested_prompts")
    def test_no_integration(self, mock_set_prompts, mock_record):
        self.link_identity()
        with patch(
            "sentry.integrations.slack.webhooks.event.integration_service.get_organization_integrations",
            return_value=[],
        ):
            with self.feature(SEER_EXPLORER_FEATURES):
                resp = self.post_webhook(event_data=ASSISTANT_THREAD_STARTED_EVENT)

        assert resp.status_code == 200
        mock_set_prompts.assert_not_called()
        assert_halt_metric(mock_record, SeerSlackHaltReason.NO_VALID_INTEGRATION)

    @patch("sentry.integrations.utils.metrics.EventLifecycle.record_event")
    @patch("sentry.integrations.slack.integration.SlackIntegration.set_suggested_prompts")
    def test_missing_channel_id(self, mock_set_prompts, mock_record):
        self.link_identity()
        event_data = {
            "type": "assistant_thread_started",
            "assistant_thread": {
                "user_id": "U1234567890",
                "thread_ts": "1729999327.187299",
            },
        }
        with self.feature(SEER_EXPLORER_FEATURES):
            resp = self.post_webhook(event_data=event_data)

        assert resp.status_code == 200
        mock_set_prompts.assert_not_called()
        assert_halt_metric(mock_record, SeerSlackHaltReason.MISSING_EVENT_DATA)

    @patch("sentry.integrations.utils.metrics.EventLifecycle.record_event")
    @patch("sentry.integrations.slack.integration.SlackIntegration.set_suggested_prompts")
    def test_missing_thread_ts(self, mock_set_prompts, mock_record):
        self.link_identity()
        event_data = {
            "type": "assistant_thread_started",
            "assistant_thread": {
                "user_id": "U1234567890",
                "channel_id": "D1234567890",
            },
        }
        with self.feature(SEER_EXPLORER_FEATURES):
            resp = self.post_webhook(event_data=event_data)

        assert resp.status_code == 200
        mock_set_prompts.assert_not_called()
        assert_halt_metric(mock_record, SeerSlackHaltReason.MISSING_EVENT_DATA)

    @patch(
        "sentry.integrations.slack.integration.SlackIntegration.set_suggested_prompts",
        side_effect=Exception("API error"),
    )
    def test_set_prompts_failure_does_not_raise(self, mock_set_prompts):
        """If set_suggested_prompts fails, we still return 200."""
        self.link_identity()
        with self.feature(SEER_EXPLORER_FEATURES):
            resp = self.post_webhook(event_data=ASSISTANT_THREAD_STARTED_EVENT)

        assert resp.status_code == 200
        mock_set_prompts.assert_called_once()
