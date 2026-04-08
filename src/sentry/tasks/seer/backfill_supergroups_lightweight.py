import logging
from datetime import UTC, datetime, timedelta

from sentry import features, options
from sentry.api.serializers import EventSerializer, serialize
from sentry.eventstore import backend as eventstore
from sentry.models.group import DEFAULT_TYPE_ID, Group
from sentry.models.organization import Organization
from sentry.models.project import Project
from sentry.seer.signed_seer_api import (
    LightweightRCAClusterRequest,
    SeerViewerContext,
    make_lightweight_rca_cluster_request,
)
from sentry.tasks.base import instrumented_task
from sentry.taskworker.namespaces import seer_tasks
from sentry.types.group import GroupSubStatus
from sentry.utils import metrics

logger = logging.getLogger(__name__)

BACKFILL_LAST_SEEN_DAYS = 90
BATCH_SIZE = 50
INTER_BATCH_DELAY_S = 5


@instrumented_task(
    name="sentry.tasks.seer.backfill_supergroups_lightweight.backfill_supergroups_lightweight_for_org",
    namespace=seer_tasks,
    processing_deadline_duration=15 * 60,
)
def backfill_supergroups_lightweight_for_org(
    organization_id: int,
    last_project_id: int = 0,
    last_group_id: int = 0,
    **kwargs,
) -> None:
    if options.get("seer.supergroups_backfill_lightweight.killswitch"):
        logger.info("supergroups_backfill_lightweight.killswitch_enabled")
        return

    try:
        organization = Organization.objects.get(id=organization_id)
    except Organization.DoesNotExist:
        return

    if not features.has("organizations:supergroups-lightweight-rca-clustering-write", organization):
        logger.info(
            "supergroups_backfill_lightweight.feature_not_enabled",
            extra={"organization_id": organization_id},
        )
        return

    project_ids = list(
        Project.objects.filter(
            organization_id=organization_id,
            id__gte=last_project_id,
        )
        .order_by("id")
        .values_list("id", flat=True)
    )

    if not project_ids:
        logger.info(
            "supergroups_backfill_lightweight.org_completed",
            extra={"organization_id": organization_id},
        )
        return

    cutoff = datetime.now(UTC) - timedelta(days=BACKFILL_LAST_SEEN_DAYS)

    group_filter = Group.objects.filter(
        project_id__in=project_ids,
        type=DEFAULT_TYPE_ID,
        last_seen__gte=cutoff,
        substatus__in=[
            GroupSubStatus.ONGOING,
            GroupSubStatus.NEW,
            GroupSubStatus.ESCALATING,
            GroupSubStatus.REGRESSED,
        ],
    )

    if last_group_id > 0:
        group_filter = group_filter.filter(
            project_id=last_project_id, id__gt=last_group_id
        ) | group_filter.filter(project_id__gt=last_project_id)
    else:
        group_filter = group_filter.filter(project_id__gte=last_project_id)

    groups = list(
        group_filter.select_related("project", "project__organization").order_by(
            "project_id", "id"
        )[:BATCH_SIZE]
    )

    if not groups:
        logger.info(
            "supergroups_backfill_lightweight.org_completed",
            extra={"organization_id": organization_id},
        )
        return

    # Phase 1: Batch fetch event data
    group_event_pairs: list[tuple[Group, dict]] = []
    for group in groups:
        event = group.get_latest_event()
        if not event:
            continue

        ready_event = eventstore.get_event_by_id(
            group.project_id, event.event_id, group_id=group.id
        )
        if not ready_event:
            continue

        serialized_event = serialize(ready_event, None, EventSerializer())
        group_event_pairs.append((group, serialized_event))

    # Phase 2: Send to Seer (per-group for now, bulk-ready)
    failure_count = 0
    success_count = 0
    viewer_context = SeerViewerContext(organization_id=organization_id)

    for group, serialized_event in group_event_pairs:
        try:
            body = LightweightRCAClusterRequest(
                group_id=group.id,
                issue={
                    "id": group.id,
                    "title": group.title,
                    "short_id": group.qualified_short_id,
                    "events": [serialized_event],
                },
                organization_slug=organization.slug,
                organization_id=organization_id,
                project_id=group.project_id,
            )
            response = make_lightweight_rca_cluster_request(
                body, timeout=30, viewer_context=viewer_context
            )
            if response.status >= 400:
                logger.warning(
                    "supergroups_backfill_lightweight.seer_error",
                    extra={
                        "group_id": group.id,
                        "project_id": group.project_id,
                        "status": response.status,
                    },
                )
                failure_count += 1
            else:
                success_count += 1
        except Exception:
            logger.exception(
                "supergroups_backfill_lightweight.group_failed",
                extra={"group_id": group.id, "project_id": group.project_id},
            )
            failure_count += 1

    metrics.incr(
        "seer.supergroups_backfill_lightweight.groups_processed",
        amount=success_count,
    )
    metrics.incr(
        "seer.supergroups_backfill_lightweight.groups_failed",
        amount=failure_count,
    )

    # Self-chain if there are more groups to process
    if len(groups) == BATCH_SIZE:
        last_group = groups[-1]
        backfill_supergroups_lightweight_for_org.apply_async(
            args=[organization_id],
            kwargs={
                "last_project_id": last_group.project_id,
                "last_group_id": last_group.id,
            },
            countdown=INTER_BATCH_DELAY_S,
            headers={"sentry-propagate-traces": False},
        )
    else:
        logger.info(
            "supergroups_backfill_lightweight.org_completed",
            extra={"organization_id": organization_id},
        )
