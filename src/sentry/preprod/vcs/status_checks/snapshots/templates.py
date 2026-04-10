from __future__ import annotations

from django.utils.translation import gettext_lazy as _
from django.utils.translation import ngettext

from sentry.integrations.source_code_management.status_check import StatusCheckStatus
from sentry.preprod.models import PreprodArtifact, PreprodComparisonApproval
from sentry.preprod.snapshots.models import PreprodSnapshotComparison, PreprodSnapshotMetrics
from sentry.preprod.url_utils import get_preprod_artifact_comparison_url, get_preprod_artifact_url
from sentry.preprod.vcs.pr_comments.snapshot_templates import (
    _STATUS_DISPLAY,
    COMPARISON_TABLE_HEADER,
    PROCESSING_STATUS,
    _app_display_info,
    _ArtifactStatus,
    _compute_artifact_status,
    _format_name_cell,
    _format_summary_line,
    _name_cell,
    _section_cell,
)

_SNAPSHOT_TITLE_BASE = _("Snapshot Testing")


def format_snapshot_status_check_messages(
    artifacts: list[PreprodArtifact],
    snapshot_metrics_map: dict[int, PreprodSnapshotMetrics],
    comparisons_map: dict[int, PreprodSnapshotComparison],
    overall_status: StatusCheckStatus,
    base_artifact_map: dict[int, PreprodArtifact],
    changes_map: dict[int, bool],
    approvals_map: dict[int, PreprodComparisonApproval] | None = None,
) -> tuple[str, str, str]:
    if not artifacts:
        raise ValueError("Cannot format messages for empty artifact list")

    title = _SNAPSHOT_TITLE_BASE

    total_changed = 0
    total_added = 0
    total_removed = 0
    total_renamed = 0
    total_unchanged = 0

    for artifact in artifacts:
        metrics = snapshot_metrics_map.get(artifact.id)
        if not metrics:
            continue

        comparison = comparisons_map.get(metrics.id)
        if not comparison:
            continue

        if comparison.state == PreprodSnapshotComparison.State.FAILED:
            subtitle = str(_("We had trouble comparing snapshots, our team is investigating."))
            return str(title), str(subtitle), ""

        if comparison.state == PreprodSnapshotComparison.State.SUCCESS:
            total_changed += comparison.images_changed
            total_added += comparison.images_added
            total_removed += comparison.images_removed
            total_renamed += comparison.images_renamed
            total_unchanged += comparison.images_unchanged

    if overall_status == StatusCheckStatus.IN_PROGRESS:
        subtitle = str(_("Comparing snapshots..."))
    elif total_changed == 0 and total_added == 0 and total_removed == 0 and total_renamed == 0:
        subtitle = str(_("No changes detected"))
    else:
        parts = []
        if total_changed > 0:
            parts.append(
                ngettext(
                    "%(count)d modified",
                    "%(count)d modified",
                    total_changed,
                )
                % {"count": total_changed}
            )
        if total_added > 0:
            parts.append(
                ngettext(
                    "%(count)d added",
                    "%(count)d added",
                    total_added,
                )
                % {"count": total_added}
            )
        if total_removed > 0:
            parts.append(
                ngettext(
                    "%(count)d removed",
                    "%(count)d removed",
                    total_removed,
                )
                % {"count": total_removed}
            )
        if total_renamed > 0:
            parts.append(
                ngettext(
                    "%(count)d renamed",
                    "%(count)d renamed",
                    total_renamed,
                )
                % {"count": total_renamed}
            )
        if total_unchanged > 0:
            parts.append(
                ngettext(
                    "%(count)d unchanged",
                    "%(count)d unchanged",
                    total_unchanged,
                )
                % {"count": total_unchanged}
            )
        subtitle = ", ".join(str(p) for p in parts)

    summary = _format_snapshot_summary(
        artifacts,
        snapshot_metrics_map,
        comparisons_map,
        base_artifact_map,
        changes_map,
        approvals_map=approvals_map,
    )

    return str(title), str(subtitle), str(summary)


def format_first_snapshot_status_check_messages(
    artifacts: list[PreprodArtifact],
    snapshot_metrics_map: dict[int, PreprodSnapshotMetrics],
) -> tuple[str, str, str]:
    if not artifacts:
        raise ValueError("Cannot format messages for empty artifact list")

    title = _SNAPSHOT_TITLE_BASE

    total_images = 0
    for artifact in artifacts:
        metrics = snapshot_metrics_map.get(artifact.id)
        if metrics:
            total_images += metrics.image_count

    subtitle = ngettext(
        "%(count)d snapshot uploaded",
        "%(count)d snapshots uploaded",
        total_images,
    ) % {"count": total_images}

    summary = _format_solo_snapshot_summary(artifacts, snapshot_metrics_map)
    summary += "\n\nThis looks like your first snapshot upload. Snapshot diffs will appear when we have a base upload to compare against. Make sure to upload snapshots from your main branch."

    return str(title), str(subtitle), str(summary)


def format_generated_snapshot_status_check_messages(
    artifacts: list[PreprodArtifact],
    snapshot_metrics_map: dict[int, PreprodSnapshotMetrics],
) -> tuple[str, str, str]:
    if not artifacts:
        raise ValueError("Cannot format messages for empty artifact list")

    title = _SNAPSHOT_TITLE_BASE

    total_images = 0
    for artifact in artifacts:
        metrics = snapshot_metrics_map.get(artifact.id)
        if metrics:
            total_images += metrics.image_count

    subtitle = ngettext(
        "Generated %(count)d snapshot",
        "Generated %(count)d snapshots",
        total_images,
    ) % {"count": total_images}

    summary = _format_solo_snapshot_summary(artifacts, snapshot_metrics_map)

    return str(title), str(subtitle), str(summary)


def format_missing_base_snapshot_status_check_messages(
    artifacts: list[PreprodArtifact],
    snapshot_metrics_map: dict[int, PreprodSnapshotMetrics],
) -> tuple[str, str, str]:
    if not artifacts:
        raise ValueError("Cannot format messages for empty artifact list")

    title = _SNAPSHOT_TITLE_BASE
    subtitle = str(_("No base snapshots found"))

    summary = _format_solo_snapshot_summary(artifacts, snapshot_metrics_map)
    summary += "\n\nNo base snapshots found to compare against. Make sure snapshots are uploaded from your main branch."

    return str(title), str(subtitle), str(summary)


def _format_solo_snapshot_summary(
    artifacts: list[PreprodArtifact],
    snapshot_metrics_map: dict[int, PreprodSnapshotMetrics],
) -> str:
    table_rows = []

    for artifact in artifacts:
        app_display, app_id = _app_display_info(artifact)
        artifact_url = get_preprod_artifact_url(artifact, view_type="snapshots")
        name = _format_name_cell(app_display, app_id, artifact_url)

        metrics = snapshot_metrics_map.get(artifact.id)
        if not metrics:
            table_rows.append(f"| {name} | - | {PROCESSING_STATUS} |")
            continue

        table_rows.append(f"| {name} | {metrics.image_count} | ✅ Uploaded |")

    table_header = "| Name | Snapshots | Status |\n| :--- | :---: | :---: |\n"

    return table_header + "\n".join(table_rows)


def _format_snapshot_summary(
    artifacts: list[PreprodArtifact],
    snapshot_metrics_map: dict[int, PreprodSnapshotMetrics],
    comparisons_map: dict[int, PreprodSnapshotComparison],
    base_artifact_map: dict[int, PreprodArtifact],
    changes_map: dict[int, bool],
    approvals_map: dict[int, PreprodComparisonApproval] | None = None,
) -> str:
    from collections import Counter

    artifact_statuses = [
        (
            artifact,
            _compute_artifact_status(
                artifact,
                snapshot_metrics_map,
                comparisons_map,
                base_artifact_map,
                changes_map,
                approvals_map,
            ),
        )
        for artifact in artifacts
    ]
    artifact_statuses.sort(key=lambda pair: (pair[1].value, _app_display_info(pair[0])[0]))

    status_counts: Counter[_ArtifactStatus] = Counter(s for _, s in artifact_statuses)
    summary_line = _format_summary_line(status_counts)

    table_rows = []
    for artifact, status in artifact_statuses:
        name = _name_cell(artifact, snapshot_metrics_map, base_artifact_map)
        metrics = snapshot_metrics_map.get(artifact.id)

        if status == _ArtifactStatus.UPLOADED_NO_BASE:
            image_count = metrics.image_count if metrics else 0
            table_rows.append(f"| {name} | - | - | - | - | - | ✅ {image_count} uploaded |")
        elif status in (_ArtifactStatus.PROCESSING, _ArtifactStatus.FAILED):
            table_rows.append(f"| {name} | - | - | - | - | - | {_STATUS_DISPLAY[status]} |")
        else:
            base_artifact = base_artifact_map.get(artifact.id)
            comparison = comparisons_map.get(metrics.id) if metrics else None
            artifact_url = (
                get_preprod_artifact_comparison_url(
                    artifact, base_artifact, comparison_type="snapshots"
                )
                if base_artifact
                else get_preprod_artifact_url(artifact, view_type="snapshots")
            )

            table_rows.append(
                f"| {name}"
                f" | {_section_cell(comparison.images_added, 'added', artifact_url) if comparison else '0'}"
                f" | {_section_cell(comparison.images_removed, 'removed', artifact_url) if comparison else '0'}"
                f" | {_section_cell(comparison.images_changed, 'changed', artifact_url) if comparison else '0'}"
                f" | {_section_cell(comparison.images_renamed, 'renamed', artifact_url) if comparison else '0'}"
                f" | {_section_cell(comparison.images_unchanged, 'unchanged', artifact_url) if comparison else '0'}"
                f" | {_STATUS_DISPLAY[status]} |"
            )

    return f"{summary_line}\n\n{COMPARISON_TABLE_HEADER}" + "\n".join(table_rows)
