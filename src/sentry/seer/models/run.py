from __future__ import annotations

from uuid import uuid4

from django.db import models

from sentry.backup.scopes import RelocationScope
from sentry.db.models import FlexibleForeignKey, cell_silo_model, sane_repr
from sentry.db.models.base import DefaultFieldsModel


class SeerRunType(models.TextChoices):
    EXPLORER = "explorer"
    AUTOFIX = "autofix"
    PR_REVIEW = "pr_review"
    ASSISTED_QUERY = "assisted_query"


@cell_silo_model
class SeerRun(DefaultFieldsModel):
    """
    Sentry-side mirror of Seer's DbRunState. One row per run regardless of
    type. Conversation content (DbRunState.value JSON) intentionally stays in
    Seer and is not mirrored here.
    """

    __relocation_scope__ = RelocationScope.Excluded

    organization = FlexibleForeignKey("sentry.Organization", on_delete=models.CASCADE)

    # External id so we don't leak seer run count.
    uuid = models.UUIDField(default=uuid4, unique=True, editable=False)

    # FK value from Seer's DbRunState.id.
    seer_run_state_id = models.TextField()

    # Null for system runs (e.g. Night Shift).
    user_id = models.BigIntegerField(null=True)

    type = models.CharField(max_length=32, choices=SeerRunType.choices)

    last_triggered_at = models.DateTimeField()
    extras = models.JSONField(db_default={}, default=dict)

    class Meta:
        app_label = "seer"
        db_table = "seer_seerrun"
        constraints = [
            models.UniqueConstraint(
                fields=["seer_run_state_id"], name="seerrun_unique_seer_run_state_id"
            ),
        ]
        indexes = [
            models.Index(fields=["user_id"]),
            models.Index(fields=["organization", "-last_triggered_at"]),
            models.Index(fields=["organization", "type", "-last_triggered_at"]),
            models.Index(fields=["last_triggered_at"]),
        ]

    __repr__ = sane_repr("organization_id", "seer_run_state_id", "type")


@cell_silo_model
class SeerAgentRun(DefaultFieldsModel):
    """
    Sibling of SeerRun for runs that appear in the Explorer session-history UI.
    Mirrors Seer's DbExplorerRun table.
    """

    __relocation_scope__ = RelocationScope.Excluded

    run = models.OneToOneField("seer.SeerRun", on_delete=models.CASCADE, related_name="agent")
    title = models.CharField(max_length=256)
    project = FlexibleForeignKey(
        "sentry.Project", on_delete=models.CASCADE, db_constraint=False, null=True
    )
    group = FlexibleForeignKey(
        "sentry.Group", on_delete=models.CASCADE, db_constraint=False, null=True
    )
    # What feature/surface invoked this run: "autofix", "night_shift",
    # "slack_thread", "dashboard_generate", "bug-fixer", "chat", etc.
    source = models.CharField(max_length=64)
    # Source-specific payload. Keys are owned per source, e.g.:
    #   source="slack_thread" -> {"thread_ts": "..."}
    #   source="dashboard_generate" -> {"dashboard_id": "..."}
    extras = models.JSONField(db_default={}, default=dict)

    class Meta:
        app_label = "seer"
        db_table = "seer_seeragentrun"
        indexes = [
            models.Index(fields=["source"]),
            models.Index(fields=["group"]),
        ]

    __repr__ = sane_repr("run_id", "source", "group_id")
