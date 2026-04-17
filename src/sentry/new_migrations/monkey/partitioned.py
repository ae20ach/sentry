from __future__ import annotations

from django.db.migrations.operations.models import (
    CreateModel,
    IndexOperation,
    ModelOperation,
)

from sentry.db.models.partitioned import (
    Partition,
    PartitionConfig,
    get_partitions,
    is_partitioning_enabled,
)


class CreatePartitionedModel(CreateModel):
    """
    Creates a partitioned table when partitioning is enabled for the model,
    otherwise falls back to creating a regular table.

    The PARTITION BY clause is handled by the PartitionAwareSchemaEditorMixin
    in the schema editor, which inspects the model's `partitioning` attribute.
    This operation additionally stores the partition config for serialization.
    """

    def __init__(self, *args, partitioning: PartitionConfig, **kwargs):
        super().__init__(*args, **kwargs)
        self.partitioning = partitioning

    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        model = to_state.apps.get_model(app_label, self.name)
        if self.allow_migrate_model(schema_editor.connection.alias, model):
            # The schema editor's PartitionAwareSchemaEditorMixin checks
            # is_partitioning_enabled() and appends PARTITION BY if enabled.
            # We need to ensure the model carries the partitioning attribute
            # so the schema editor can detect it.
            if not hasattr(model, "partitioning"):
                model.partitioning = self.partitioning
            schema_editor.create_model(model)

    def deconstruct(self):
        name, args, kwargs = super().deconstruct()
        kwargs["partitioning"] = self.partitioning
        return (self.__class__.__qualname__, args, kwargs)

    def describe(self):
        return f"Create partitioned model {self.name}"

    @property
    def migration_name_fragment(self):
        return self.name_lower


class AddPartition(ModelOperation):
    """
    Creates a partition of a partitioned table.

    When partitioning is disabled for the model in the current environment,
    this operation is a no-op (the table is a regular non-partitioned table).
    """

    def __init__(self, model_name: str, partition: Partition):
        self.partition = partition
        super().__init__(model_name)

    def state_forwards(self, app_label, state):
        pass

    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        model = to_state.apps.get_model(app_label, self.name)
        if not self.allow_migrate_model(schema_editor.connection.alias, model):
            return
        if not is_partitioning_enabled(model):
            return

        parent_table = model._meta.db_table
        partition_table = self.partition.name
        bound_clause = self.partition.sql_bound_clause()

        schema_editor.execute(
            f"CREATE TABLE {schema_editor.quote_name(partition_table)} "
            f"PARTITION OF {schema_editor.quote_name(parent_table)} "
            f"{bound_clause}"
        )

    def database_backwards(self, app_label, schema_editor, from_state, to_state):
        model = from_state.apps.get_model(app_label, self.name)
        if not self.allow_migrate_model(schema_editor.connection.alias, model):
            return
        if not is_partitioning_enabled(model):
            return

        partition_table = self.partition.name
        schema_editor.execute(f"DROP TABLE IF EXISTS {schema_editor.quote_name(partition_table)}")

    def deconstruct(self):
        return (
            self.__class__.__qualname__,
            [],
            {
                "model_name": self.name,
                "partition": self.partition,
            },
        )

    def describe(self):
        return f"Create partition {self.partition.name} on model {self.name}"

    @property
    def migration_name_fragment(self):
        return f"{self.name_lower}_{self.partition.name}"


class RemovePartition(ModelOperation):
    """
    Detaches and drops a partition from a partitioned table.

    When partitioning is disabled, this is a no-op.
    """

    def __init__(self, model_name: str, partition: Partition):
        self.partition = partition
        super().__init__(model_name)

    def state_forwards(self, app_label, state):
        pass

    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        model = from_state.apps.get_model(app_label, self.name)
        if not self.allow_migrate_model(schema_editor.connection.alias, model):
            return
        if not is_partitioning_enabled(model):
            return

        parent_table = model._meta.db_table
        partition_table = self.partition.name

        schema_editor.execute(
            f"ALTER TABLE {schema_editor.quote_name(parent_table)} "
            f"DETACH PARTITION {schema_editor.quote_name(partition_table)}"
        )
        schema_editor.execute(f"DROP TABLE IF EXISTS {schema_editor.quote_name(partition_table)}")

    def database_backwards(self, app_label, schema_editor, from_state, to_state):
        # Reverse of RemovePartition is AddPartition
        model = to_state.apps.get_model(app_label, self.name)
        if not self.allow_migrate_model(schema_editor.connection.alias, model):
            return
        if not is_partitioning_enabled(model):
            return

        parent_table = model._meta.db_table
        partition_table = self.partition.name
        bound_clause = self.partition.sql_bound_clause()

        schema_editor.execute(
            f"CREATE TABLE {schema_editor.quote_name(partition_table)} "
            f"PARTITION OF {schema_editor.quote_name(parent_table)} "
            f"{bound_clause}"
        )

    def deconstruct(self):
        return (
            self.__class__.__qualname__,
            [],
            {
                "model_name": self.name,
                "partition": self.partition,
            },
        )

    def describe(self):
        return f"Remove partition {self.partition.name} from model {self.name}"

    @property
    def migration_name_fragment(self):
        return f"{self.name_lower}_remove_{self.partition.name}"


def _execute_outside_transaction(schema_editor, sql: str) -> None:
    """
    Execute SQL outside of a transaction, required for CONCURRENTLY operations.

    CONCURRENTLY DDL cannot run inside a transaction block. In production,
    CheckedMigration sets atomic=False so we're already outside a transaction.
    In tests, we may be inside a transaction — in that case, fall back to
    the non-CONCURRENTLY variant to avoid errors.
    """
    conn = schema_editor.connection
    if conn.in_atomic_block:
        # Inside a transaction (e.g., test runner) — CONCURRENTLY would fail.
        # Fall back to the non-concurrent variant.
        sql = sql.replace(" CONCURRENTLY", "", 1)
        schema_editor.execute(sql)
    else:
        schema_editor.execute(sql)


def _partition_index_name(partition_table: str, index_name: str, max_length: int = 63) -> str:
    """
    Generate a unique index name scoped to a partition table.
    Truncates to max_length (PostgreSQL's 63-char limit).
    """
    name = f"{partition_table}_{index_name}"
    if len(name) > max_length:
        name = name[:max_length]
    return name


class AddPartitionIndex(IndexOperation):
    """
    Creates an index on all existing physical partitions of a partitioned table.

    When partitioning is disabled, falls back to creating a regular index
    on the (non-partitioned) table directly.
    """

    def __init__(self, model_name: str, index):
        self.model_name = model_name
        if not index.name:
            raise ValueError(
                "Indexes passed to AddPartitionIndex require a name argument. "
                f"{index!r} doesn't have one."
            )
        self.index = index

    def state_forwards(self, app_label, state):
        state.add_index(app_label, self.model_name_lower, self.index)

    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        model = to_state.apps.get_model(app_label, self.model_name)
        if not self.allow_migrate_model(schema_editor.connection.alias, model):
            return

        if not is_partitioning_enabled(model):
            schema_editor.add_index(model, self.index)
            return

        parent_table = model._meta.db_table
        partitions = get_partitions(schema_editor.connection, parent_table)

        for partition_table in partitions:
            idx_name = _partition_index_name(partition_table, self.index.name)
            cloned_index = self.index.clone()
            cloned_index.name = idx_name
            sql_str = self._create_index_sql(schema_editor, model, cloned_index, partition_table)
            _execute_outside_transaction(schema_editor, sql_str)

    def _create_index_sql(self, schema_editor, model, index, table_name):
        """Generate CREATE INDEX CONCURRENTLY SQL targeting a specific partition table."""
        sql = index.create_sql(model, schema_editor)
        parent_table = model._meta.db_table
        sql_str = str(sql)
        # Add CONCURRENTLY after CREATE INDEX
        sql_str = sql_str.replace("CREATE INDEX", "CREATE INDEX CONCURRENTLY", 1)
        # Replace the parent table name with the partition table name
        sql_str = sql_str.replace(
            schema_editor.quote_name(parent_table),
            schema_editor.quote_name(table_name),
            1,  # Only replace the first occurrence (the ON clause)
        )
        return sql_str

    def database_backwards(self, app_label, schema_editor, from_state, to_state):
        model = from_state.apps.get_model(app_label, self.model_name)
        if not self.allow_migrate_model(schema_editor.connection.alias, model):
            return

        if not is_partitioning_enabled(model):
            schema_editor.remove_index(model, self.index)
            return

        parent_table = model._meta.db_table
        partitions = get_partitions(schema_editor.connection, parent_table)

        for partition_table in partitions:
            idx_name = _partition_index_name(partition_table, self.index.name)
            _execute_outside_transaction(
                schema_editor,
                f"DROP INDEX CONCURRENTLY IF EXISTS {schema_editor.quote_name(idx_name)}",
            )

    def deconstruct(self):
        return (
            self.__class__.__qualname__,
            [],
            {
                "model_name": self.model_name,
                "index": self.index,
            },
        )

    def describe(self):
        if self.index.expressions:
            return "Create partition index %s on %s on model %s" % (
                self.index.name,
                ", ".join([str(expression) for expression in self.index.expressions]),
                self.model_name,
            )
        return "Create partition index %s on field(s) %s of model %s" % (
            self.index.name,
            ", ".join(self.index.fields),
            self.model_name,
        )

    @property
    def migration_name_fragment(self):
        return f"{self.model_name_lower}_{self.index.name.lower()}"


class RemovePartitionIndex(IndexOperation):
    """
    Removes an index from all existing physical partitions of a partitioned table.

    When partitioning is disabled, falls back to removing a regular index.
    """

    def __init__(self, model_name: str, name: str):
        self.model_name = model_name
        self.name = name

    def state_forwards(self, app_label, state):
        state.remove_index(app_label, self.model_name_lower, self.name)

    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        model = from_state.apps.get_model(app_label, self.model_name)
        if not self.allow_migrate_model(schema_editor.connection.alias, model):
            return

        if not is_partitioning_enabled(model):
            from_model_state = from_state.models[app_label, self.model_name_lower]
            index = from_model_state.get_index_by_name(self.name)
            schema_editor.remove_index(model, index)
            return

        parent_table = model._meta.db_table
        partitions = get_partitions(schema_editor.connection, parent_table)

        for partition_table in partitions:
            idx_name = _partition_index_name(partition_table, self.name)
            _execute_outside_transaction(
                schema_editor,
                f"DROP INDEX CONCURRENTLY IF EXISTS {schema_editor.quote_name(idx_name)}",
            )

    def database_backwards(self, app_label, schema_editor, from_state, to_state):
        model = to_state.apps.get_model(app_label, self.model_name)
        if not self.allow_migrate_model(schema_editor.connection.alias, model):
            return

        if not is_partitioning_enabled(model):
            to_model_state = to_state.models[app_label, self.model_name_lower]
            index = to_model_state.get_index_by_name(self.name)
            schema_editor.add_index(model, index)
            return

        parent_table = model._meta.db_table
        partitions = get_partitions(schema_editor.connection, parent_table)
        to_model_state = to_state.models[app_label, self.model_name_lower]
        index = to_model_state.get_index_by_name(self.name)

        for partition_table in partitions:
            idx_name = _partition_index_name(partition_table, self.name)
            cloned_index = index.clone()
            cloned_index.name = idx_name
            sql_str = self._create_index_sql(schema_editor, model, cloned_index, partition_table)
            _execute_outside_transaction(schema_editor, sql_str)

    def _create_index_sql(self, schema_editor, model, index, table_name):
        sql = index.create_sql(model, schema_editor)
        parent_table = model._meta.db_table
        sql_str = str(sql)
        sql_str = sql_str.replace("CREATE INDEX", "CREATE INDEX CONCURRENTLY", 1)
        sql_str = sql_str.replace(
            schema_editor.quote_name(parent_table),
            schema_editor.quote_name(table_name),
            1,
        )
        return sql_str

    def deconstruct(self):
        return (
            self.__class__.__qualname__,
            [],
            {
                "model_name": self.model_name,
                "name": self.name,
            },
        )

    def describe(self):
        return f"Remove partition index {self.name} from model {self.model_name}"

    @property
    def migration_name_fragment(self):
        return f"{self.model_name_lower}_remove_{self.name.lower()}"


# Re-export for convenience when writing migrations
__all__ = [
    "AddPartition",
    "AddPartitionIndex",
    "CreatePartitionedModel",
    "RemovePartition",
    "RemovePartitionIndex",
]
