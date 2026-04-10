from __future__ import annotations

import logging

from slack_sdk.models.blocks import ActionsBlock, ButtonElement, LinkButtonElement, MarkdownBlock
from taskbroker_client.retry import Retry

from sentry.constants import ObjectStatus
from sentry.identity.services.identity import identity_service
from sentry.integrations.services.integration import integration_service
from sentry.integrations.services.integration.model import RpcIntegration
from sentry.integrations.slack.views.link_identity import build_linking_url
from sentry.models.organization import Organization
from sentry.notifications.platform.slack.provider import SlackRenderable
from sentry.seer.entrypoints.cache import SeerOperatorExplorerCache
from sentry.seer.entrypoints.metrics import (
    SlackEntrypointEventLifecycleMetric,
    SlackEntrypointInteractionType,
)
from sentry.seer.entrypoints.operator import SeerExplorerOperator
from sentry.seer.entrypoints.slack.entrypoint import EntrypointSetupError, SlackExplorerEntrypoint
from sentry.seer.entrypoints.slack.mention import build_thread_context, extract_prompt
from sentry.seer.entrypoints.slack.metrics import (
    ProcessMentionFailureReason,
    ProcessMentionHaltReason,
)
from sentry.seer.entrypoints.types import SeerEntrypointKey
from sentry.tasks.base import instrumented_task
from sentry.taskworker.namespaces import integrations_tasks
from sentry.users.services.user import RpcUser
from sentry.users.services.user.service import user_service

logger = logging.getLogger(__name__)

# How often to refresh the Slack thread status (seconds).
# Slack auto-clears the status after 2 minutes of no message, so we refresh
# before that window expires.
THREAD_STATUS_REFRESH_INTERVAL_SECS = 90

# Maximum number of status refreshes to schedule. 6 refreshes at 90s intervals
# gives ~9 min of refresh coverage, plus the initial 2-min window = ~11 min total.
MAX_STATUS_REFRESHES = 6


@instrumented_task(
    name="sentry.seer.entrypoints.slack.process_mention_for_slack",
    namespace=integrations_tasks,
    processing_deadline_duration=30,
    retry=Retry(times=2, delay=30),
)
def process_mention_for_slack(
    *,
    integration_id: int,
    organization_id: int,
    channel_id: str,
    ts: str,
    thread_ts: str | None = None,
    text: str,
    slack_user_id: str,
    bot_user_id: str,
) -> None:
    """
    Process a Slack @mention for Seer Explorer.

    Parses the mention, extracts thread context,
    and triggers an Explorer run via SeerExplorerOperator.

    ``ts`` is the message's own timestamp (always present).
    ``thread_ts`` is the parent thread's timestamp (None for top-level messages).

    Authorization: Access is gated by the org-level ``seer-slack-workflows``
    feature flag and ``has_explorer_access()``.  The incoming webhook is
    verified by ``SlackDMRequest.validate()``.  The Slack user must have a
    linked Sentry identity; if not, an ephemeral prompt to link is sent.
    """

    with SlackEntrypointEventLifecycleMetric(
        interaction_type=SlackEntrypointInteractionType.PROCESS_MENTION,
        integration_id=integration_id,
        organization_id=organization_id,
    ).capture() as lifecycle:
        lifecycle.add_extras(
            {
                "channel_id": channel_id,
                "ts": ts,
                "thread_ts": thread_ts,
                "slack_user_id": slack_user_id,
            },
        )

        try:
            organization = Organization.objects.get_from_cache(id=organization_id)
        except Organization.DoesNotExist:
            lifecycle.record_failure(failure_reason=ProcessMentionFailureReason.ORG_NOT_FOUND)
            return

        if not SlackExplorerEntrypoint.has_access(organization):
            lifecycle.record_failure(failure_reason=ProcessMentionFailureReason.NO_EXPLORER_ACCESS)
            return

        try:
            entrypoint = SlackExplorerEntrypoint(
                integration_id=integration_id,
                organization_id=organization_id,
                channel_id=channel_id,
                thread_ts=thread_ts or ts,
                slack_user_id=slack_user_id,
            )
        except (ValueError, EntrypointSetupError) as e:
            lifecycle.record_failure(failure_reason=e)
            return

        user = _resolve_user(
            integration=entrypoint.integration,
            slack_user_id=slack_user_id,
        )
        if not user:
            lifecycle.record_halt(ProcessMentionHaltReason.IDENTITY_NOT_LINKED)
            # In a thread, show the prompt in the thread; top-level, show in the channel.
            _send_link_identity_prompt(
                entrypoint=entrypoint,
                thread_ts=thread_ts if thread_ts else "",
            )
            entrypoint.install.set_thread_status(
                channel_id=channel_id,
                thread_ts=thread_ts or ts,
                status="",
            )
            return

        if not organization.has_access(user):
            lifecycle.record_halt(ProcessMentionHaltReason.USER_NOT_ORG_MEMBER)
            _send_not_org_member_message(
                entrypoint=entrypoint,
                thread_ts=thread_ts if thread_ts else "",
                org_name=organization.name,
            )
            entrypoint.install.set_thread_status(
                channel_id=channel_id,
                thread_ts=thread_ts or ts,
                status="",
            )
            return

        prompt = extract_prompt(text, bot_user_id)

        # Only fetch thread context when actually in a thread.
        thread_context: str | None = None
        if thread_ts:
            messages = entrypoint.install.get_thread_history(
                channel_id=channel_id, thread_ts=thread_ts
            )
            thread_context = build_thread_context(messages) or None

        operator = SeerExplorerOperator(entrypoint=entrypoint)
        run_id = operator.trigger_explorer(
            organization=organization,
            user=user,
            prompt=prompt,
            on_page_context=thread_context,
            category_key="slack_thread",
            category_value=f"{channel_id}:{entrypoint.thread_ts}",
        )

        if run_id is not None:
            refresh_slack_thread_status.apply_async(
                kwargs={
                    "integration_id": integration_id,
                    "organization_id": organization_id,
                    "channel_id": channel_id,
                    "thread_ts": entrypoint.thread_ts,
                    "run_id": run_id,
                },
                countdown=THREAD_STATUS_REFRESH_INTERVAL_SECS,
            )


def _resolve_user(
    *,
    integration: RpcIntegration,
    slack_user_id: str,
) -> RpcUser | None:
    """Resolve the Sentry user from a Slack user ID via linked identity."""
    provider = identity_service.get_provider(
        provider_type=integration.provider,
        provider_ext_id=integration.external_id,
    )
    if not provider:
        return None

    identity = identity_service.get_identity(
        filter={
            "provider_id": provider.id,
            "identity_ext_id": slack_user_id,
        }
    )
    if not identity:
        return None

    return user_service.get_user(identity.user_id)


def _send_link_identity_prompt(
    *,
    entrypoint: SlackExplorerEntrypoint,
    thread_ts: str,
) -> None:
    """Send an ephemeral message prompting the user to link their Slack identity to Sentry."""
    associate_url = build_linking_url(
        integration=entrypoint.integration,
        slack_id=entrypoint.slack_user_id,
        channel_id=entrypoint.channel_id,
        response_url=None,
    )
    renderable = _build_link_identity_renderable(associate_url)
    entrypoint.install.send_threaded_ephemeral_message(
        slack_user_id=entrypoint.slack_user_id,
        channel_id=entrypoint.channel_id,
        renderable=renderable,
        thread_ts=thread_ts,
    )


def _build_link_identity_renderable(associate_url: str) -> SlackRenderable:
    """Build a SlackRenderable prompting the user to link their Slack identity to Sentry."""
    message = "Link your Slack identity to Sentry to use Seer Explorer in Slack."
    return SlackRenderable(
        blocks=[
            MarkdownBlock(text=message),
            ActionsBlock(
                elements=[
                    LinkButtonElement(text="Link", url=associate_url),
                    ButtonElement(text="Cancel", value="ignore"),
                ]
            ),
        ],
        text=message,
    )


def _send_not_org_member_message(
    *,
    entrypoint: SlackExplorerEntrypoint,
    thread_ts: str,
    org_name: str,
) -> None:
    """Send an ephemeral message informing the user they are not a member of the organization."""
    message = f"You must be a member of the *{org_name}* Sentry organization to use Seer Explorer in Slack."
    renderable = SlackRenderable(
        blocks=[MarkdownBlock(text=message)],
        text=message,
    )
    entrypoint.install.send_threaded_ephemeral_message(
        slack_user_id=entrypoint.slack_user_id,
        channel_id=entrypoint.channel_id,
        renderable=renderable,
        thread_ts=thread_ts,
    )


@instrumented_task(
    name="sentry.seer.entrypoints.slack.refresh_slack_thread_status",
    namespace=integrations_tasks,
    processing_deadline_duration=30,
    retry=None,
)
def refresh_slack_thread_status(
    *,
    integration_id: int,
    organization_id: int,
    channel_id: str,
    thread_ts: str,
    run_id: int,
    remaining_refreshes: int = MAX_STATUS_REFRESHES,
) -> None:
    """
    Refresh the Slack thread status indicator to prevent it from auto-clearing.

    Slack's assistant_threads.setStatus auto-clears after 2 minutes of no message.
    This task re-sends the status and chains another delayed task until the Explorer
    run completes (explorer cache deleted) or the refresh budget is exhausted.
    """
    from sentry.integrations.slack.integration import SlackIntegration
    from sentry.integrations.slack.webhooks.event import SEER_LOADING_MESSAGES
    from sentry.seer.entrypoints.slack.entrypoint import SlackExplorerCachePayload

    cache_payload = SeerOperatorExplorerCache[SlackExplorerCachePayload].get(
        entrypoint_key=str(SeerEntrypointKey.SLACK),
        run_id=run_id,
    )
    if not cache_payload:
        return

    integration = integration_service.get_integration(
        integration_id=integration_id,
        organization_id=organization_id,
        status=ObjectStatus.ACTIVE,
    )
    if not integration:
        return

    install = SlackIntegration(model=integration, organization_id=organization_id)
    install.set_thread_status(
        channel_id=channel_id,
        thread_ts=thread_ts,
        status="Thinking...",
        loading_messages=SEER_LOADING_MESSAGES,
    )

    if remaining_refreshes > 1:
        refresh_slack_thread_status.apply_async(
            kwargs={
                "integration_id": integration_id,
                "organization_id": organization_id,
                "channel_id": channel_id,
                "thread_ts": thread_ts,
                "run_id": run_id,
                "remaining_refreshes": remaining_refreshes - 1,
            },
            countdown=THREAD_STATUS_REFRESH_INTERVAL_SECS,
        )
