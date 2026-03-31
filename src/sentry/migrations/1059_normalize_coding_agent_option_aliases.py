"""
Normalize legacy coding agent option values to canonical form.

Two organization option rows in prod have unvalidated alias values
("cursor") stored in sentry:seer_default_coding_agent. The write-path
validator now prevents new aliases, but these existing rows need fixing.
"""

import logging

from django.db import migrations, router
from django.db.backends.base.schema import BaseDatabaseSchemaEditor
from django.db.migrations.state import StateApps

from sentry.new_migrations.migrations import CheckedMigration
from sentry.silo.safety import unguarded_write

logger = logging.getLogger(__name__)

CODING_AGENT_ALIASES: dict[str, str] = {
    "cursor": "cursor_background_agent",
    "claude_code": "claude_code_agent",
}


def normalize_coding_agent_aliases(
    apps: StateApps, schema_editor: BaseDatabaseSchemaEditor
) -> None:
    OrganizationOption = apps.get_model("sentry", "OrganizationOption")

    for alias, canonical in CODING_AGENT_ALIASES.items():
        rows = OrganizationOption.objects.filter(
            key="sentry:seer_default_coding_agent", value=alias
        )
        for row in rows:
            with unguarded_write(using=router.db_for_write(OrganizationOption)):
                row.value = canonical
                row.save(update_fields=["value"])


class Migration(CheckedMigration):
    is_post_deployment = False

    dependencies = [
        ("sentry", "1058_change_code_mapping_unique_constraint"),
    ]

    operations = [
        migrations.RunPython(
            normalize_coding_agent_aliases,
            migrations.RunPython.noop,
            hints={"tables": ["sentry_organizationoptions"]},
        ),
    ]
