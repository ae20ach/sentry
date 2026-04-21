"""Dynamic sampling per-org job: scheduling and per-org orchestration.

This is the top-level scaffold for the per-org dynamic sampling job. Unlike
``sentry.dynamic_sampling.tasks.*`` - which splits work across multiple
cron-scheduled global tasks (``boost_low_volume_projects``,
``boost_low_volume_transactions``, ``recalibrate_orgs``,
``sliding_window_org``) each fanning out over all orgs - this module runs
every calculation for a single organization in one task execution, and
relies on per-org fan-out from the scheduler.

Two tasks are registered:

- :func:`schedule_per_org_calculations` - the cron entry point. Picks the
  next bucket of active organizations and fans out per-org work.
- :func:`run_calculations_per_org_task` - the per-org task. Runs the
  ordered list of calculation steps against EAP and outcomes for one org.

Each step inside :func:`run_calculations_per_org` is a named placeholder
for now; implementations land in follow-up changes. The scaffolding
(bucketing, dispatch, task wiring, metrics hooks) is complete so the job
can be deployed and observed end-to-end before any step is filled in.
"""

from __future__ import annotations

import random
from datetime import datetime, timezone

import sentry_sdk
from django.db.models import F
from django.db.models.functions import Mod
from taskbroker_client.retry import Retry

from sentry.dynamic_sampling.rules.utils import OrganizationId, get_redis_client_for_ds
from sentry.dynamic_sampling.tasks.utils import dynamic_sampling_task
from sentry.dynamic_sampling.utils import has_dynamic_sampling
from sentry.models.organization import Organization, OrganizationStatus
from sentry.silo.base import SiloMode
from sentry.tasks.base import instrumented_task
from sentry.taskworker.namespaces import telemetry_experience_tasks
from sentry.utils import metrics
from sentry.utils.query import RangeQuerySetWrapper

BUCKET_COUNT = 10
JITTER_WINDOW_SECONDS = 60
BUCKET_CURSOR_KEY = "ds::per_org:bucket_cursor"


def run_calculations_per_org(org_id: OrganizationId) -> None:
    """Run one full cycle of dynamic-sampling calculations for a single org.

    The body is an ordered list of named steps. Each step is a no-op
    placeholder; follow-up changes add the real implementations while
    keeping this top-level shape stable.
    """
    try:
        organization = Organization.objects.get_from_cache(id=org_id)
    except Organization.DoesNotExist:
        return

    if not has_dynamic_sampling(organization):
        return

    with metrics.timer("dynamic_sampling.run_calculations_per_org.duration"):
        outcomes = _fetch_outcomes_volume(org_id, organization)
        if not _has_recent_volume(outcomes):
            metrics.incr(
                "dynamic_sampling.per_org.skipped_no_volume",
                sample_rate=1,
            )
            return

        eap = _run_eap_batch(org_id, organization)

        _apply_sliding_window(org_id, organization, eap)
        _apply_recalibration(org_id, organization, outcomes)
        _boost_low_volume_projects(org_id, organization, eap)
        _boost_low_volume_transactions(org_id, organization, eap)


def _fetch_outcomes_volume(org_id: int, organization: Organization) -> object | None:
    """Single outcomes_raw query. Returns per-project and aggregate volumes.

    Doubles as the volume gate: if the org has no outcomes in the window
    the rest of the cycle is skipped.
    """
    return None


def _has_recent_volume(outcomes: object | None) -> bool:
    return outcomes is not None


def _run_eap_batch(org_id: int, organization: Organization) -> object:
    """Fan out every EAP query for this org in a single table_rpc batch.

    Covers sliding-window volume, per-project volumes + transaction totals,
    and large/small transaction volumes.
    """
    return object()


def _apply_sliding_window(org_id: int, organization: Organization, eap: object) -> None:
    """Update the org's base sample rate from the sliding-window volume."""


def _apply_recalibration(org_id: int, organization: Organization, outcomes: object) -> None:
    """Compute the adjustment factor(s) from accepted vs. target indexed volume."""


def _boost_low_volume_projects(org_id: int, organization: Organization, eap: object) -> None:
    """Distribute the org-level sample rate across projects."""


def _boost_low_volume_transactions(org_id: int, organization: Organization, eap: object) -> None:
    """Redistribute each project's sample rate across large/small transactions."""


@instrumented_task(
    name="sentry.dynamic_sampling.per_org.run_calculations_per_org",
    namespace=telemetry_experience_tasks,
    processing_deadline_duration=20 * 60 + 5,
    retry=Retry(times=5, delay=5),
    silo_mode=SiloMode.CELL,
)
@dynamic_sampling_task
def run_calculations_per_org_task(org_id: OrganizationId) -> None:
    run_calculations_per_org(org_id)


def schedule_per_org_calculations_bucket(bucket_index: int) -> None:
    if not 0 <= bucket_index < BUCKET_COUNT:
        sentry_sdk.capture_message(
            f"bucket_index out of range: {bucket_index}, wrapping via modulo",
            level="warning",
        )
        bucket_index = bucket_index % BUCKET_COUNT

    queryset = (
        Organization.objects.filter(status=OrganizationStatus.ACTIVE)
        .annotate(_bucket=Mod(F("id"), BUCKET_COUNT))
        .filter(_bucket=bucket_index)
    )

    dispatched = 0
    for org in RangeQuerySetWrapper[Organization](
        queryset,
        step=1000,
        result_value_getter=lambda o: o.id,
    ):
        countdown = random.uniform(0, JITTER_WINDOW_SECONDS)
        run_calculations_per_org_task.apply_async(args=(org.id,), countdown=countdown)
        dispatched += 1

    metrics.gauge(
        "dynamic_sampling.schedule_per_org_calculations.bucket_size",
        dispatched,
        tags={"bucket_index": str(bucket_index)},
    )
    metrics.incr(
        "dynamic_sampling.schedule_per_org_calculations.dispatched",
        amount=dispatched,
        tags={"bucket_index": str(bucket_index)},
    )


def _next_bucket_index() -> int:
    redis_client = get_redis_client_for_ds()
    try:
        next_value = redis_client.incr(BUCKET_CURSOR_KEY)
    except Exception as e:
        sentry_sdk.capture_exception(e)
        return datetime.now(tz=timezone.utc).minute % BUCKET_COUNT
    return (int(next_value) - 1) % BUCKET_COUNT


@instrumented_task(
    name="sentry.dynamic_sampling.per_org.schedule_per_org_calculations",
    namespace=telemetry_experience_tasks,
    processing_deadline_duration=5 * 60,
    retry=Retry(times=3, delay=5),
    silo_mode=SiloMode.CELL,
)
@dynamic_sampling_task
def schedule_per_org_calculations() -> None:
    bucket_index = _next_bucket_index()
    schedule_per_org_calculations_bucket(bucket_index)
