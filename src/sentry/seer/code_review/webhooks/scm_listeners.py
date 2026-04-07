from __future__ import annotations

import logging
from collections.abc import Iterator
from typing import Any

import orjson
import sentry_sdk

from sentry.constants import ObjectStatus
from sentry.integrations.github.webhook_types import GithubWebhookType
from sentry.integrations.services.integration.model import RpcIntegration
from sentry.integrations.services.integration.service import integration_service
from sentry.integrations.types import IntegrationProviderSlug
from sentry.models.organization import Organization
from sentry.models.repository import Repository
from sentry.scm.private.event_stream import scm_event_stream
from sentry.scm.types import CheckRunEvent, CommentEvent, PullRequestEvent, SubscriptionEvent
from sentry.utils.redis import redis_clusters

from ..metrics import record_webhook_filtered
from ..preflight import CodeReviewPreflightResult, CodeReviewPreflightService
from ..utils import get_pr_author_id, get_tags
from .check_run import handle_check_run_event
from .issue_comment import handle_issue_comment_event
from .pull_request import handle_pull_request_event

logger = logging.getLogger(__name__)

WEBHOOK_SEEN_TTL_SECONDS = 20
WEBHOOK_SEEN_KEY_PREFIX = "webhook:github:delivery:"


def _is_first_delivery(delivery_id: str) -> bool:
    """Return True if this delivery ID has not been seen within the TTL window."""
    try:
        cluster = redis_clusters.get("default")
        key = f"{WEBHOOK_SEEN_KEY_PREFIX}{delivery_id}"
        return bool(cluster.set(key, "1", ex=WEBHOOK_SEEN_TTL_SECONDS, nx=True))
    except Exception as e:
        sentry_sdk.set_tag("error", str(e))
        logger.warning("github.webhook.code_review.mark_seen_failed")
        # Keep going if error (e.g. Redis down) since we'd rather process twice than never
        return True


def _find_allowed_repo(
    subscription_event: SubscriptionEvent,
    github_event: GithubWebhookType,
) -> Iterator[
    tuple[RpcIntegration, Organization, Repository, dict[str, Any], CodeReviewPreflightResult]
]:
    """
    Parse the raw GitHub event, resolve org/repo from the installation ID, run preflight,
    and yield one entry per (org, repo) pair that should be processed.
    """
    raw_event: dict[str, Any] = orjson.loads(subscription_event["event"])

    installation_id = str(raw_event.get("installation", {}).get("id", ""))
    if not installation_id:
        logger.warning("github.scm_listener.missing_installation_id")
        return

    result = integration_service.organization_contexts(
        external_id=installation_id,
        provider=IntegrationProviderSlug.GITHUB.value,
    )
    integration = result.integration
    installs = result.organization_integrations

    if integration is None or not installs:
        logger.info(
            "github.scm_listener.missing_integration",
            extra={"installation_id": installation_id},
        )
        return

    # Code review is only supported on GitHub Cloud, not GitHub Enterprise on-prem.
    if integration.provider == IntegrationProviderSlug.GITHUB_ENTERPRISE:
        return

    if "repository" not in raw_event:
        return

    orgs = {
        org.id: org
        for org in Organization.objects.filter(
            id__in=[install.organization_id for install in installs]
        )
    }
    repos = Repository.objects.filter(
        organization_id__in=orgs.keys(),
        provider=f"integrations:{IntegrationProviderSlug.GITHUB.value}",
        external_id=str(raw_event["repository"]["id"]),
    ).exclude(status=ObjectStatus.HIDDEN)

    for repo in repos:
        org = orgs.get(repo.organization_id)
        if org is None:
            continue

        preflight = CodeReviewPreflightService(
            organization=org,
            repo=repo,
            integration_id=integration.id,
            pr_author_external_id=get_pr_author_id(raw_event),
        ).check()

        if not preflight.allowed:
            if preflight.denial_reason:
                record_webhook_filtered(
                    github_event=github_event,
                    github_event_action=raw_event.get("action", "unknown"),
                    reason=preflight.denial_reason,
                )
                if org.slug == "sentry":
                    sentry_sdk.set_tag("denial_reason", preflight.denial_reason)
                    logger.info("github.scm_listener.denied")
            continue

        yield integration, org, repo, raw_event, preflight


def _set_tags(
    raw_event: dict[str, Any],
    github_event: GithubWebhookType,
    org: Organization,
    integration: RpcIntegration,
    delivery_id: str | None,
) -> dict[str, str]:
    tags: dict[str, str] = {}
    try:
        tags = get_tags(
            raw_event,
            github_event=github_event.value,
            organization_id=org.id,
            organization_slug=org.slug,
            integration_id=integration.id,
        )
        sentry_sdk.set_tags(tags)
        sentry_sdk.set_context("code_review_context", tags)
        if delivery_id:
            sentry_sdk.set_tag("github_delivery_id", delivery_id)
    except Exception:
        logger.warning("github.scm_listener.failed_to_set_tags")
    return tags


@scm_event_stream.listen_for_check_run
def handle_check_run_via_scm_stream(e: CheckRunEvent) -> None:
    delivery_id = e.subscription_event["extra"].get("github_delivery_id")
    assert delivery_id is None or isinstance(delivery_id, str)
    if delivery_id and not _is_first_delivery(delivery_id):
        logger.warning("github.scm_listener.duplicate_delivery_skipped")
        return

    for integration, org, repo, raw_event, _preflight in _find_allowed_repo(
        e.subscription_event, GithubWebhookType.CHECK_RUN
    ):
        tags = _set_tags(raw_event, GithubWebhookType.CHECK_RUN, org, integration, delivery_id)
        handle_check_run_event(
            github_event=GithubWebhookType.CHECK_RUN,
            event=raw_event,
            tags=tags,
        )


@scm_event_stream.listen_for_comment
def handle_comment_via_scm_stream(e: CommentEvent) -> None:
    delivery_id = e.subscription_event["extra"].get("github_delivery_id")
    assert delivery_id is None or isinstance(delivery_id, str)
    if delivery_id and not _is_first_delivery(delivery_id):
        logger.warning("github.scm_listener.duplicate_delivery_skipped")
        return

    for integration, org, repo, raw_event, _preflight in _find_allowed_repo(
        e.subscription_event, GithubWebhookType.ISSUE_COMMENT
    ):
        tags = _set_tags(raw_event, GithubWebhookType.ISSUE_COMMENT, org, integration, delivery_id)
        handle_issue_comment_event(
            github_event=GithubWebhookType.ISSUE_COMMENT,
            event=raw_event,
            organization=org,
            repo=repo,
            tags=tags,
            integration=integration,
        )


@scm_event_stream.listen_for_pull_request
def handle_pull_request_via_scm_stream(e: PullRequestEvent) -> None:
    delivery_id = e.subscription_event["extra"].get("github_delivery_id")
    assert delivery_id is None or isinstance(delivery_id, str)
    if delivery_id and not _is_first_delivery(delivery_id):
        logger.warning("github.scm_listener.duplicate_delivery_skipped")
        return

    for integration, org, repo, raw_event, preflight in _find_allowed_repo(
        e.subscription_event, GithubWebhookType.PULL_REQUEST
    ):
        tags = _set_tags(raw_event, GithubWebhookType.PULL_REQUEST, org, integration, delivery_id)
        handle_pull_request_event(
            github_event=GithubWebhookType.PULL_REQUEST,
            event=raw_event,
            organization=org,
            repo=repo,
            tags=tags,
            integration=integration,
            org_code_review_settings=preflight.settings,
        )
