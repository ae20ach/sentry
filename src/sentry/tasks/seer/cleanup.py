from __future__ import annotations

from sentry.seer.autofix.utils import (
    bulk_cleanup_seer_repository_preferences,
    cleanup_seer_repository_preferences,
)
from sentry.silo.base import SiloMode
from sentry.tasks.base import instrumented_task
from sentry.taskworker.namespaces import seer_tasks


@instrumented_task(
    name="sentry.tasks.seer.cleanup_seer_repository_preferences",
    namespace=seer_tasks,
    processing_deadline_duration=60 * 5,
    silo_mode=SiloMode.CELL,
)
def cleanup_seer_repository_preferences_task(
    organization_id: int, repo_external_id: str, repo_provider: str
) -> None:
    """Task wrapper for cleaning up Seer preferences for a single repository."""
    cleanup_seer_repository_preferences(
        organization_id=organization_id,
        repo_external_id=repo_external_id,
        repo_provider=repo_provider,
    )


@instrumented_task(
    name="sentry.tasks.seer.bulk_cleanup_seer_repository_preferences",
    namespace=seer_tasks,
    processing_deadline_duration=60 * 10,
    silo_mode=SiloMode.CELL,
)
def bulk_cleanup_seer_repository_preferences_task(
    organization_id: int, repos: list[dict[str, str]]
) -> None:
    """Task wrapper for removing multiple repositories from Seer project preferences."""
    bulk_cleanup_seer_repository_preferences(organization_id=organization_id, repos=repos)
