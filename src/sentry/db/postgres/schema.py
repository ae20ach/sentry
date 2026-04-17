from django.contrib.postgres.constraints import ExclusionConstraint
from django.db.backends.postgresql.schema import (
    DatabaseSchemaEditor as PostgresDatabaseSchemaEditor,
)
from django.db.models import Field, Model
from django.db.models.base import ModelBase
from django.db.models.constraints import BaseConstraint
from django_zero_downtime_migrations.backends.postgres.schema import (
    DatabaseSchemaEditorMixin,
    Unsafe,
    UnsafeOperationException,
)

unsafe_mapping = {
    Unsafe.ADD_COLUMN_NOT_NULL: (
        "Adding {}.{} as a not null column with no default is unsafe. Provide a default using db_default. \n"
        "More info: https://develop.sentry.dev/api-server/application-domains/database-migrations/#adding-columns-with-a-default"
    ),
    Unsafe.ALTER_COLUMN_TYPE: (
        "Altering the type of column {}.{} in this way is unsafe\n"
        "More info here: https://develop.sentry.dev/database-migrations/#altering-column-types"
    ),
    # TODO: If we use > 3.0 we can add tests to verify this
    Unsafe.ADD_CONSTRAINT_EXCLUDE: (
        "Adding an exclusion constraint is unsafe\n"
        "We don't use these at Sentry currently, bring this up in #discuss-backend"
    ),
    Unsafe.ALTER_TABLE_SET_TABLESPACE: (
        "Changing the tablespace for a table is unsafe\n"
        "There's probably no reason to do this via a migration. Bring this up in #discuss-backend"
    ),
    Unsafe.ALTER_TABLE_RENAME_COLUMN: (
        "Renaming column {}.{} to {} is unsafe.\n"
        "More info here: https://develop.sentry.dev/database-migrations/#renaming-columns"
    ),
}


def value_translator(value):
    if isinstance(value, Field):
        return value.name
    if isinstance(value, ModelBase):
        return value.__name__
    return value


def translate_unsafeoperation_exception(func):
    def inner(self, *args, **kwargs):
        try:
            func(self, *args, **kwargs)
        except UnsafeOperationException as e:
            exc_str = unsafe_mapping.get(str(e))
            if exc_str is None:
                raise

            formatted_args = [value_translator(arg) for arg in args]

            raise UnsafeOperationException(exc_str.format(*formatted_args))

    return inner


def _get_partition_config(model: type[Model]):
    """Get the partition config for a model, if it has one and partitioning is enabled."""
    from sentry.db.models.partitioned import PartitionConfig, is_partitioning_enabled

    config = getattr(model, "partitioning", None)
    if (
        config is not None
        and isinstance(config, PartitionConfig)
        and is_partitioning_enabled(model)
    ):
        return config
    return None


class PartitionAwareSchemaEditorMixin:
    """
    Mixin that modifies table creation to support PostgreSQL partitioned tables.

    When a model has a `partitioning` attribute (a PartitionConfig) and partitioning
    is enabled for that model in the current environment, this mixin:
    1. Appends a PARTITION BY clause to the CREATE TABLE statement
    2. Strips auto-generated indexes from deferred_sql (indexes should be managed
       per-partition, not on the parent table)
    """

    def table_sql(self, model: type[Model]) -> tuple[str, list]:
        sql, params = super().table_sql(model)  # type: ignore[misc]
        config = _get_partition_config(model)
        if config is not None:
            sql += " " + config.sql_clause(model)
        return sql, params

    def create_model(self, model: type[Model]) -> None:
        config = _get_partition_config(model)
        if config is None:
            super().create_model(model)  # type: ignore[misc]
            return

        # Track deferred_sql before create_model adds indexes
        pre_create_deferred = list(self.deferred_sql)  # type: ignore[attr-defined]

        super().create_model(model)  # type: ignore[misc]

        # Strip index-creation SQL that was added for the parent table.
        # Partitioned parent tables cannot have indexes directly; indexes
        # must be created on individual partitions for CONCURRENTLY support.
        # We keep non-index deferred SQL (FK constraints, unique_together, etc.)
        table_name = model._meta.db_table
        filtered = []
        for stmt in self.deferred_sql:  # type: ignore[attr-defined]
            if stmt in pre_create_deferred:
                filtered.append(stmt)
                continue
            stmt_str = str(stmt)
            if "CREATE INDEX" in stmt_str.upper() and table_name in stmt_str:
                continue
            filtered.append(stmt)
        self.deferred_sql[:] = filtered  # type: ignore[attr-defined]


class MakeBtreeGistSchemaEditor(PartitionAwareSchemaEditorMixin, PostgresDatabaseSchemaEditor):
    """workaround for https://code.djangoproject.com/ticket/36374"""

    def create_model(self, model: type[Model]) -> None:
        if any(isinstance(c, ExclusionConstraint) for c in model._meta.constraints):
            self.execute("CREATE EXTENSION IF NOT EXISTS btree_gist;")
        super().create_model(model)

    def add_constraint(self, model: type[Model], constraint: BaseConstraint) -> None:
        if isinstance(constraint, ExclusionConstraint):
            self.execute("CREATE EXTENSION IF NOT EXISTS btree_gist;")
        super().add_constraint(model, constraint)


class SafePostgresDatabaseSchemaEditor(
    DatabaseSchemaEditorMixin, PartitionAwareSchemaEditorMixin, PostgresDatabaseSchemaEditor
):
    add_field = translate_unsafeoperation_exception(PostgresDatabaseSchemaEditor.add_field)
    alter_field = translate_unsafeoperation_exception(PostgresDatabaseSchemaEditor.alter_field)
    alter_db_tablespace = translate_unsafeoperation_exception(
        PostgresDatabaseSchemaEditor.alter_db_tablespace
    )

    def alter_db_table(self, model, old_db_table, new_db_table):
        """
        This didn't work correctly in  django_zero_downtime_migrations, so implementing here. This
        method is only used to modify table name, so we just need to raise.
        """
        raise UnsafeOperationException(
            f"Renaming table for model {model.__name__} from {old_db_table} to {new_db_table} is unsafe.\n"
            "More info here: https://develop.sentry.dev/database-migrations/#renaming-tables"
        )

    def delete_model(self, model, is_safe=False):
        """
        It's never safe to delete a model using the standard migration process
        """
        if not is_safe:
            raise UnsafeOperationException(
                f"Deleting the {model.__name__} model is unsafe.\n"
                "More info here: https://develop.sentry.dev/database-migrations/#deleting-tables"
            )
        super(DatabaseSchemaEditorMixin, self).delete_model(model)

    def remove_field(self, model, field, is_safe=False):
        """
        It's never safe to remove a field using the standard migration process
        """
        if not is_safe:
            raise UnsafeOperationException(
                f"Removing the {model.__name__}.{field.name} field is unsafe.\n"
                "More info here: https://develop.sentry.dev/database-migrations/#deleting-columns"
            )
        super(DatabaseSchemaEditorMixin, self).remove_field(model, field)


class DatabaseSchemaEditorProxy:
    """
    Wrapper that allows us to use either the `SafePostgresDatabaseSchemaEditor` or
    `PostgresDatabaseSchemaEditor`. Can be configured by setting the `safe` property
    before using to edit the schema. If already in use, attempts to modify `safe` will
    fail.
    """

    class AlreadyInUse(Exception):
        pass

    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs
        self._safe = False
        self._schema_editor = None

    @property
    def safe(self):
        return self._safe

    @safe.setter
    def safe(self, safe):
        if self._schema_editor is not None:
            raise self.AlreadyInUse("Schema editor already in use, can't set `safe`")

        self._safe = safe

    @property
    def schema_editor(self):
        if self._schema_editor is None:
            schema_editor_cls = (
                SafePostgresDatabaseSchemaEditor if self.safe else MakeBtreeGistSchemaEditor
            )
            schema_editor = schema_editor_cls(*self.args, **self.kwargs)
            schema_editor.__enter__()
            self._schema_editor = schema_editor
        return self._schema_editor

    def __getattr__(self, name):
        return getattr(self.schema_editor, name)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.schema_editor.__exit__(exc_type, exc_val, exc_tb)
