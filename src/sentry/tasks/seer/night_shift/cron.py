from __future__ import annotations

import logging
import time
from collections import Counter
from collections.abc import Sequence
from datetime import timedelta

import sentry_sdk
from django.contrib.auth.models import AnonymousUser

from sentry import features, options, quotas
from sentry.constants import DataCategory, ObjectStatus
from sentry.models.group import Group
from sentry.models.organization import Organization, OrganizationStatus
from sentry.models.project import Project
from sentry.seer.autofix.autofix import trigger_autofix
from sentry.seer.autofix.autofix_agent import AutofixStep, trigger_autofix_explorer
from sentry.seer.autofix.constants import (
    AutofixAutomationTuningSettings,
    SeerAutomationSource,
)
from sentry.seer.autofix.issue_summary import (
    _apply_user_preference_upper_bound,
    auto_run_source_map,
    referrer_map,
)
from sentry.seer.autofix.utils import AutofixStoppingPoint, bulk_read_preferences
from sentry.seer.models.night_shift import SeerNightShiftRun, SeerNightShiftRunIssue
from sentry.seer.models.seer_api_models import SeerProjectPreference
from sentry.tasks.base import instrumented_task
from sentry.tasks.seer.night_shift.agentic_triage import agentic_triage_strategy
from sentry.tasks.seer.night_shift.models import TriageAction
from sentry.taskworker.namespaces import seer_tasks
from sentry.utils.iterators import chunked
from sentry.utils.query import RangeQuerySetWrapper

logger = logging.getLogger("sentry.tasks.seer.night_shift")

NIGHT_SHIFT_DISPATCH_STEP_SECONDS = 37
NIGHT_SHIFT_SPREAD_DURATION = timedelta(hours=4)

FEATURE_NAMES = [
    "organizations:seer-night-shift",
    "organizations:gen-ai-features",
    "organizations:seat-based-seer-enabled",
]


@instrumented_task(
    name="sentry.tasks.seer.night_shift.schedule_night_shift",
    namespace=seer_tasks,
    processing_deadline_duration=15 * 60,
)
def schedule_night_shift() -> None:
    """
    Nightly scheduler: iterates active orgs in batches, checks feature flags
    in bulk, and dispatches per-org worker tasks with jitter.
    """
    if not options.get("seer.night_shift.enable"):
        return

    spread_seconds = int(NIGHT_SHIFT_SPREAD_DURATION.total_seconds())
    batch_index = 0

    for org_batch in chunked(
        RangeQuerySetWrapper[Organization](
            Organization.objects.filter(status=OrganizationStatus.ACTIVE),
            step=1000,
        ),
        100,
    ):
        for org in _get_eligible_orgs_from_batch(org_batch):
            delay = (batch_index * NIGHT_SHIFT_DISPATCH_STEP_SECONDS) % spread_seconds

            run_night_shift_for_org.apply_async(
                args=[org.id],
                countdown=delay,
            )
            batch_index += 1

    sentry_sdk.metrics.count("night_shift.orgs_dispatched", batch_index)

    logger.info(
        "night_shift.schedule_complete",
        extra={"orgs_dispatched": batch_index},
    )


@instrumented_task(
    name="sentry.tasks.seer.night_shift.run_night_shift_for_org",
    namespace=seer_tasks,
    processing_deadline_duration=5 * 60,
)
def run_night_shift_for_org(
    organization_id: int,
    dry_run: bool = False,
    max_candidates: int | None = None,
) -> int | None:
    try:
        organization = Organization.objects.get(
            id=organization_id, status=OrganizationStatus.ACTIVE
        )
    except Organization.DoesNotExist:
        return None

    sentry_sdk.set_tags(
        {
            "organization_id": organization.id,
            "organization_slug": organization.slug,
        }
    )

    start_time = time.monotonic()

    run = SeerNightShiftRun.objects.create(
        organization=organization,
        triage_strategy="agentic_triage",
    )

    if not quotas.backend.check_seer_quota(
        org_id=organization.id,
        data_category=DataCategory.SEER_AUTOFIX,
    ):
        logger.info(
            "night_shift.no_seer_quota",
            extra={"organization_id": organization.id, "run_id": run.id},
        )
        run.update(error_message="No Seer quota available")
        return None

    try:
        eligible_projects, preferences = _get_eligible_projects(organization)
    except Exception:
        logger.exception(
            "night_shift.failed_to_get_eligible_projects",
            extra={"organization_id": organization_id, "run_id": run.id},
        )
        run.update(error_message="Failed to get eligible projects")
        return None

    sentry_sdk.metrics.distribution("night_shift.eligible_projects", len(eligible_projects))

    if not eligible_projects:
        logger.info(
            "night_shift.no_eligible_projects",
            extra={
                "organization_id": organization_id,
                "organization_slug": organization.slug,
                "run_id": run.id,
            },
        )
        return None

    resolved_max_candidates = (
        max_candidates
        if max_candidates is not None
        else options.get("seer.night_shift.issues_per_org")
    )

    agent_run_id = None
    try:
        candidates, agent_run_id = agentic_triage_strategy(
            eligible_projects, organization, resolved_max_candidates
        )
        if agent_run_id is not None:
            run.update(extras={**run.extras, "agent_run_id": agent_run_id})
    except Exception:
        sentry_sdk.metrics.count("night_shift.run_error", 1)
        logger.exception(
            "night_shift.run_failed",
            extra={
                "organization_id": organization_id,
                "run_id": run.id,
                "agent_run_id": agent_run_id,
            },
        )
        run.update(error_message="Night shift run failed")
        return None

    sentry_sdk.metrics.distribution("night_shift.candidates_selected", len(candidates))
    action_counts = Counter(c.action for c in candidates)
    for action, count in action_counts.items():
        sentry_sdk.metrics.count("night_shift.triage_action", count, attributes={"action": action})
    sentry_sdk.metrics.distribution("night_shift.org_run_duration", time.monotonic() - start_time)

    logger.info(
        "night_shift.candidates_selected",
        extra={
            "organization_id": organization_id,
            "organization_slug": organization.slug,
            "run_id": run.id,
            "agent_run_id": agent_run_id,
            "num_eligible_projects": len(eligible_projects),
            "num_candidates": len(candidates),
            "dry_run": dry_run,
            "candidates": [
                {
                    "group_id": c.group.id,
                    "action": c.action,
                }
                for c in candidates
            ],
        },
    )

    if dry_run:
        logger.info(
            "night_shift.dry_run_completed",
            extra={
                "organization_id": organization.id,
                "run_id": run.id,
                "num_candidates": len(candidates),
            },
        )
        return agent_run_id

    fixable_candidates = [
        c for c in candidates if c.action in (TriageAction.AUTOFIX, TriageAction.ROOT_CAUSE_ONLY)
    ]
    if not fixable_candidates:
        logger.info(
            "night_shift.no_fixable_candidates",
            extra={
                "organization_id": organization.id,
                "run_id": run.id,
                "num_candidates": len(candidates),
            },
        )
        return agent_run_id

    on_explorer = features.has("organizations:autofix-on-explorer", organization)

    issues = []
    for c in fixable_candidates:
        seer_run_id = _trigger_autofix_for_candidate(
            group=c.group,
            organization=organization,
            preference=preferences.get(c.group.project_id),
            triage_action=c.action,
            on_explorer=on_explorer,
        )
        if seer_run_id is None:
            logger.warning(
                "night_shift.autofix_trigger_returned_none",
                extra={
                    "group_id": c.group.id,
                    "organization_id": organization.id,
                    "run_id": run.id,
                },
            )
        issues.append(
            SeerNightShiftRunIssue(
                run=run,
                group=c.group,
                action=c.action,
                seer_run_id=str(seer_run_id) if seer_run_id is not None else None,
            )
        )

    SeerNightShiftRunIssue.objects.bulk_create(issues)

    triggered_count = sum(1 for i in issues if i.seer_run_id is not None)
    sentry_sdk.metrics.count("night_shift.autofix_triggered", triggered_count)

    return agent_run_id


def _get_eligible_orgs_from_batch(
    orgs: Sequence[Organization],
) -> list[Organization]:
    """
    Check feature flags for a batch of orgs using batch_has_for_organizations.
    Returns orgs that have all required feature flags enabled.
    """
    eligible = [org for org in orgs if not org.get_option("sentry:hide_ai_features")]

    for feature_name in FEATURE_NAMES:
        batch_result = features.batch_has_for_organizations(feature_name, eligible)
        if batch_result is None:
            raise RuntimeError(f"batch_has_for_organizations returned None for {feature_name}")

        eligible = [org for org in eligible if batch_result.get(f"organization:{org.id}", False)]

        if not eligible:
            return []

    return eligible


def _trigger_autofix_for_candidate(
    group: Group,
    organization: Organization,
    preference: SeerProjectPreference | None,
    triage_action: TriageAction,
    on_explorer: bool,
) -> int | None:
    """
    Trigger an autofix run for a single night shift candidate and return the Seer
    run id on success, or None if the trigger failed or was skipped.
    """
    # Triage action sets the furthest step the automated run is allowed to reach;
    # user preference may further clamp it to a more conservative stopping point.
    fixability_suggestion = (
        AutofixStoppingPoint.ROOT_CAUSE
        if triage_action == TriageAction.ROOT_CAUSE_ONLY
        else AutofixStoppingPoint.OPEN_PR
    )
    stopping_point = _apply_user_preference_upper_bound(
        fixability_suggestion,
        preference.automated_run_stopping_point if preference else None,
    )

    try:
        if on_explorer:
            return trigger_autofix_explorer(
                group=group,
                step=AutofixStep.ROOT_CAUSE,
                referrer=referrer_map[SeerAutomationSource.NIGHT_SHIFT],
                stopping_point=stopping_point,
            )

        event = group.get_latest_event()
        if not event:
            logger.warning(
                "night_shift.no_event_for_autofix",
                extra={"group_id": group.id, "organization_id": organization.id},
            )
            return None
        response = trigger_autofix(
            group=group,
            event_id=event.event_id,
            user=AnonymousUser(),
            referrer=referrer_map[SeerAutomationSource.NIGHT_SHIFT],
            auto_run_source=auto_run_source_map[SeerAutomationSource.NIGHT_SHIFT],
            stopping_point=stopping_point,
        )
        return response.data.get("run_id")
    except Exception:
        logger.exception(
            "night_shift.autofix_trigger_failed",
            extra={"group_id": group.id, "organization_id": organization.id},
        )
        return None


def _get_eligible_projects(
    organization: Organization,
) -> tuple[list[Project], dict[int, SeerProjectPreference | None]]:
    """Return active projects that have automation enabled and connected repos."""
    project_map = {
        p.id: p
        for p in Project.objects.filter(organization=organization, status=ObjectStatus.ACTIVE)
    }
    if not project_map:
        return [], {}

    preferences = bulk_read_preferences(organization, list(project_map))

    candidates = [
        project_map[pid]
        for pid, pref in preferences.items()
        if pref is not None
        and pref.repositories
        and pref.autofix_automation_tuning != AutofixAutomationTuningSettings.OFF
    ]
    if not candidates:
        return [], preferences

    flag_result = features.batch_has(["projects:seer-night-shift"], projects=candidates)
    projects = [
        p
        for p in candidates
        if (flag_result or {}).get(f"project:{p.id}", {}).get("projects:seer-night-shift", False)
    ]
    return projects, preferences
