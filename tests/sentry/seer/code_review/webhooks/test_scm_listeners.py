from collections.abc import Generator
from typing import Any
from unittest.mock import MagicMock, patch
from uuid import uuid4

import orjson
import pytest

from sentry.integrations.types import IntegrationProviderSlug
from sentry.scm.types import (
    PullRequestBranch,
    PullRequestEvent,
    PullRequestEventData,
    SubscriptionEvent,
)
from sentry.seer.code_review.webhooks.scm_listeners import (
    WEBHOOK_SEEN_KEY_PREFIX,
    handle_pull_request_via_scm_stream,
)
from sentry.testutils.cases import TestCase
from sentry.utils.redis import redis_clusters


def _make_subscription_event(
    raw_event: dict[str, Any], delivery_id: str | None = None
) -> SubscriptionEvent:
    return {
        "received_at": 0,
        "type": "github",
        "event_type_hint": "pull_request",
        "event": orjson.dumps(raw_event).decode(),
        "extra": {"github_delivery_id": delivery_id},
        "sentry_meta": None,
    }


def _make_pr_event(raw_event: dict[str, Any], delivery_id: str | None = None) -> PullRequestEvent:
    return PullRequestEvent(
        action="opened",
        pull_request=PullRequestEventData(
            id=str(raw_event.get("pull_request", {}).get("number", 1)),
            title="Test PR",
            description=None,
            head=PullRequestBranch(ref="feature", sha="abc123"),
            base=PullRequestBranch(ref="main", sha="def456"),
            is_private_repo=False,
            author=None,
        ),
        subscription_event=_make_subscription_event(raw_event, delivery_id),
    )


class TestScmListeners(TestCase):
    """Unit tests for scm_listeners.py — the SCM stream equivalent of test_handlers.py."""

    INSTALLATION_ID = "99999"
    REPO_EXTERNAL_ID = "12345"

    def setUp(self) -> None:
        super().setUp()
        self.repo = self.create_repo(
            project=self.project,
            provider="integrations:github",
            external_id=self.REPO_EXTERNAL_ID,
        )

        self.mock_integration = MagicMock()
        self.mock_integration.id = 123
        self.mock_integration.provider = IntegrationProviderSlug.GITHUB

        self.mock_org_integration = MagicMock()
        self.mock_org_integration.organization_id = self.organization.id

        self.mock_contexts = MagicMock()
        self.mock_contexts.integration = self.mock_integration
        self.mock_contexts.organization_integrations = [self.mock_org_integration]

        self.raw_event = {
            "action": "opened",
            "installation": {"id": int(self.INSTALLATION_ID)},
            "repository": {"id": int(self.REPO_EXTERNAL_ID)},
            "pull_request": {"number": 1, "draft": False, "user": {"id": 42}},
        }

    @pytest.fixture(autouse=True)
    def mock_preflight_allowed(self) -> Generator[None]:
        with patch(
            "sentry.seer.code_review.webhooks.scm_listeners.CodeReviewPreflightService"
        ) as mock_preflight:
            mock_preflight.return_value.check.return_value.allowed = True
            mock_preflight.return_value.check.return_value.denial_reason = None
            mock_preflight.return_value.check.return_value.settings = None
            yield

    @patch("sentry.seer.code_review.webhooks.scm_listeners.integration_service")
    @patch("sentry.seer.code_review.webhooks.scm_listeners.CodeReviewPreflightService")
    def test_skips_github_enterprise_on_prem(
        self, mock_preflight: MagicMock, mock_integration_service: MagicMock
    ) -> None:
        """GitHub Enterprise on-prem webhooks must be skipped — code review is Cloud-only."""
        self.mock_integration.provider = IntegrationProviderSlug.GITHUB_ENTERPRISE
        mock_integration_service.organization_contexts.return_value = self.mock_contexts

        handle_pull_request_via_scm_stream(_make_pr_event(self.raw_event))

        mock_preflight.assert_not_called()

    @patch("sentry.seer.code_review.webhooks.scm_listeners.integration_service")
    @patch("sentry.seer.code_review.webhooks.scm_listeners.CodeReviewPreflightService")
    def test_skips_when_no_integration(
        self, mock_preflight: MagicMock, mock_integration_service: MagicMock
    ) -> None:
        """When no integration is found for the installation ID, nothing is processed."""
        mock_contexts = MagicMock()
        mock_contexts.integration = None
        mock_contexts.organization_integrations = []
        mock_integration_service.organization_contexts.return_value = mock_contexts

        handle_pull_request_via_scm_stream(_make_pr_event(self.raw_event))

        mock_preflight.assert_not_called()

    @patch("sentry.seer.code_review.webhooks.scm_listeners.integration_service")
    @patch("sentry.seer.code_review.webhooks.scm_listeners.CodeReviewPreflightService")
    def test_processes_github_com(
        self, mock_preflight: MagicMock, mock_integration_service: MagicMock
    ) -> None:
        """GitHub Cloud webhooks trigger a preflight check."""
        mock_integration_service.organization_contexts.return_value = self.mock_contexts
        mock_preflight.return_value.check.return_value.allowed = False
        mock_preflight.return_value.check.return_value.denial_reason = None

        handle_pull_request_via_scm_stream(_make_pr_event(self.raw_event))

        mock_preflight.assert_called_once()

    @patch("sentry.seer.code_review.webhooks.scm_listeners.handle_pull_request_event")
    @patch("sentry.seer.code_review.webhooks.scm_listeners.integration_service")
    def test_webhook_first_time_seen_handler_invoked(
        self, mock_integration_service: MagicMock, mock_handler: MagicMock
    ) -> None:
        """A delivery ID seen for the first time is processed normally."""
        delivery_id = f"seen-success-{uuid4()}"
        mock_integration_service.organization_contexts.return_value = self.mock_contexts

        handle_pull_request_via_scm_stream(_make_pr_event(self.raw_event, delivery_id))

        mock_handler.assert_called_once()

    @patch("sentry.seer.code_review.webhooks.scm_listeners.handle_pull_request_event")
    @patch("sentry.seer.code_review.webhooks.scm_listeners.integration_service")
    def test_same_delivery_id_second_seen_skipped(
        self, mock_integration_service: MagicMock, mock_handler: MagicMock
    ) -> None:
        """A duplicate delivery ID within the TTL window is dropped after the first."""
        delivery_id = f"seen-sequential-{uuid4()}"
        mock_integration_service.organization_contexts.return_value = self.mock_contexts
        event = _make_pr_event(self.raw_event, delivery_id)

        handle_pull_request_via_scm_stream(event)
        handle_pull_request_via_scm_stream(event)

        assert mock_handler.call_count == 1

    @patch("sentry.seer.code_review.webhooks.scm_listeners.handle_pull_request_event")
    @patch("sentry.seer.code_review.webhooks.scm_listeners.integration_service")
    def test_same_delivery_id_after_ttl_expires_handler_invoked_twice(
        self, mock_integration_service: MagicMock, mock_handler: MagicMock
    ) -> None:
        """After TTL expiry the same delivery ID is treated as new and processed again."""
        delivery_id = f"seen-after-ttl-{uuid4()}"
        mock_integration_service.organization_contexts.return_value = self.mock_contexts
        event = _make_pr_event(self.raw_event, delivery_id)

        handle_pull_request_via_scm_stream(event)
        assert mock_handler.call_count == 1

        # Simulate TTL expiry by manually deleting the key
        cluster = redis_clusters.get("default")
        cluster.delete(f"{WEBHOOK_SEEN_KEY_PREFIX}{delivery_id}")

        handle_pull_request_via_scm_stream(event)
        assert mock_handler.call_count == 2

    @patch("sentry.seer.code_review.webhooks.scm_listeners.handle_pull_request_event")
    @patch("sentry.seer.code_review.webhooks.scm_listeners.integration_service")
    def test_missing_delivery_id_handler_invoked(
        self, mock_integration_service: MagicMock, mock_handler: MagicMock
    ) -> None:
        """When delivery_id is absent the dedup check is skipped and the event is processed."""
        mock_integration_service.organization_contexts.return_value = self.mock_contexts

        handle_pull_request_via_scm_stream(_make_pr_event(self.raw_event, delivery_id=None))

        mock_handler.assert_called_once()
