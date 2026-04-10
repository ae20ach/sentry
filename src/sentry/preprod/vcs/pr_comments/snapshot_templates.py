from __future__ import annotations

from collections import Counter
from enum import IntEnum

from django.utils.translation import gettext_lazy as _

from sentry.preprod.models import PreprodArtifact, PreprodComparisonApproval
from sentry.preprod.snapshots.models import PreprodSnapshotComparison, PreprodSnapshotMetrics
from sentry.preprod.url_utils import get_preprod_artifact_comparison_url, get_preprod_artifact_url

_HEADER = "## Sentry Snapshot Testing"
PROCESSING_STATUS = "⏳ Processing"
COMPARISON_TABLE_HEADER = (
    "| Name | Added | Removed | Modified | Renamed | Unchanged | Status |\n"
    "| :--- | :---: | :---: | :---: | :---: | :---: | :---: |\n"
)


class _ArtifactStatus(IntEnum):
    """Per-artifact status, ordered by display priority (failures first)."""

    FAILED = 0
    NEEDS_APPROVAL = 1
    PROCESSING = 2
    UPLOADED_NO_BASE = 3
    UNCHANGED = 4
    APPROVED = 5


_STATUS_DISPLAY: dict[_ArtifactStatus, str] = {
    _ArtifactStatus.FAILED: "❌ Comparison failed",
    _ArtifactStatus.NEEDS_APPROVAL: "⏳ Needs approval",
    _ArtifactStatus.PROCESSING: PROCESSING_STATUS,
    _ArtifactStatus.UNCHANGED: "✅ Unchanged",
    _ArtifactStatus.APPROVED: "✅ Approved",
    # UPLOADED_NO_BASE is special-cased with the image count
}

_SUMMARY_LABELS: dict[_ArtifactStatus, str] = {
    _ArtifactStatus.FAILED: "❌ {count} failed",
    _ArtifactStatus.NEEDS_APPROVAL: "⏳ {count} needs approval",
    _ArtifactStatus.PROCESSING: "⏳ {count} processing",
    _ArtifactStatus.UPLOADED_NO_BASE: "✅ {count} uploaded",
    _ArtifactStatus.UNCHANGED: "✅ {count} unchanged",
    _ArtifactStatus.APPROVED: "✅ {count} approved",
}


def _compute_artifact_status(
    artifact: PreprodArtifact,
    snapshot_metrics_map: dict[int, PreprodSnapshotMetrics],
    comparisons_map: dict[int, PreprodSnapshotComparison],
    base_artifact_map: dict[int, PreprodArtifact],
    changes_map: dict[int, bool],
    approvals_map: dict[int, PreprodComparisonApproval] | None = None,
) -> _ArtifactStatus:
    metrics = snapshot_metrics_map.get(artifact.id)
    if not metrics:
        return _ArtifactStatus.PROCESSING

    comparison = comparisons_map.get(metrics.id)
    has_base = artifact.id in base_artifact_map

    if not comparison and not has_base:
        return _ArtifactStatus.UPLOADED_NO_BASE

    if not comparison:
        return _ArtifactStatus.PROCESSING

    if comparison.state in (
        PreprodSnapshotComparison.State.PENDING,
        PreprodSnapshotComparison.State.PROCESSING,
    ):
        return _ArtifactStatus.PROCESSING

    if comparison.state == PreprodSnapshotComparison.State.FAILED:
        return _ArtifactStatus.FAILED

    has_changes = changes_map.get(artifact.id, False)
    is_approved = approvals_map is not None and artifact.id in approvals_map
    if has_changes and is_approved:
        return _ArtifactStatus.APPROVED
    elif has_changes:
        return _ArtifactStatus.NEEDS_APPROVAL

    return _ArtifactStatus.UNCHANGED


def _format_summary_line(status_counts: Counter[_ArtifactStatus]) -> str:
    parts = []
    for status in _ArtifactStatus:
        count = status_counts.get(status, 0)
        if count > 0:
            parts.append(_SUMMARY_LABELS[status].format(count=count))
    return " · ".join(parts)


def format_snapshot_pr_comment(
    artifacts: list[PreprodArtifact],
    snapshot_metrics_map: dict[int, PreprodSnapshotMetrics],
    comparisons_map: dict[int, PreprodSnapshotComparison],
    base_artifact_map: dict[int, PreprodArtifact],
    changes_map: dict[int, bool],
    approvals_map: dict[int, PreprodComparisonApproval] | None = None,
) -> str:
    """Format a PR comment for snapshot comparisons."""
    if not artifacts:
        raise ValueError("Cannot format PR comment for empty artifact list")

    # Compute status for each artifact and sort by priority (failures first)
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
        name_cell = _name_cell(artifact, snapshot_metrics_map, base_artifact_map)
        metrics = snapshot_metrics_map.get(artifact.id)

        if status == _ArtifactStatus.UPLOADED_NO_BASE:
            image_count = metrics.image_count if metrics else 0
            table_rows.append(f"| {name_cell} | - | - | - | - | - | ✅ {image_count} uploaded |")
        elif status in (
            _ArtifactStatus.PROCESSING,
            _ArtifactStatus.FAILED,
        ):
            table_rows.append(f"| {name_cell} | - | - | - | - | - | {_STATUS_DISPLAY[status]} |")
        else:
            # SUCCESS states: UNCHANGED, NEEDS_APPROVAL, APPROVED
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
                f"| {name_cell}"
                f" | {_section_cell(comparison.images_added, 'added', artifact_url) if comparison else '0'}"
                f" | {_section_cell(comparison.images_removed, 'removed', artifact_url) if comparison else '0'}"
                f" | {_section_cell(comparison.images_changed, 'changed', artifact_url) if comparison else '0'}"
                f" | {_section_cell(comparison.images_renamed, 'renamed', artifact_url) if comparison else '0'}"
                f" | {_section_cell(comparison.images_unchanged, 'unchanged', artifact_url) if comparison else '0'}"
                f" | {_STATUS_DISPLAY[status]} |"
            )

    return f"{_HEADER}\n\n{summary_line}\n\n{COMPARISON_TABLE_HEADER}" + "\n".join(table_rows)


def _name_cell(
    artifact: PreprodArtifact,
    snapshot_metrics_map: dict[int, PreprodSnapshotMetrics],
    base_artifact_map: dict[int, PreprodArtifact],
) -> str:
    app_display, app_id = _app_display_info(artifact)
    metrics = snapshot_metrics_map.get(artifact.id)
    base_artifact = base_artifact_map.get(artifact.id)

    if base_artifact and metrics:
        artifact_url = get_preprod_artifact_comparison_url(
            artifact, base_artifact, comparison_type="snapshots"
        )
    else:
        artifact_url = get_preprod_artifact_url(artifact, view_type="snapshots")

    return _format_name_cell(app_display, app_id, artifact_url)


def _app_display_info(artifact: PreprodArtifact) -> tuple[str, str]:
    mobile_app_info = getattr(artifact, "mobile_app_info", None)
    app_name = mobile_app_info.app_name if mobile_app_info else None
    app_display = app_name or artifact.app_id or str(_("Unknown App"))
    app_id = artifact.app_id or ""
    return app_display, app_id


def _format_name_cell(app_display: str, app_id: str, url: str) -> str:
    if app_id:
        return f"[{app_display}]({url})<br>`{app_id}`"
    return f"[{app_display}]({url})"


def _section_cell(count: int, section: str, artifact_url: str) -> str:
    if count > 0:
        return f"[{count}]({artifact_url}?section={section})"
    return str(count)
