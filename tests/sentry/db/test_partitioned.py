from __future__ import annotations

import os
from unittest import mock

import pytest
from django.db import connection

from sentry.db.models.partitioned import (
    HashPartition,
    ListPartition,
    PartitionConfig,
    PartitionStrategy,
    RangePartition,
    get_partitions,
    is_partitioning_enabled,
)
from sentry.testutils.cases import TestCase


class PartitionConfigTest(TestCase):
    def test_requires_key(self):
        with pytest.raises(ValueError, match="must contain at least one column name"):
            PartitionConfig(strategy=PartitionStrategy.RANGE, key=[])

    def test_sql_clause_range(self):
        config = PartitionConfig(strategy=PartitionStrategy.RANGE, key=["date_added"])

        class FakeField:
            column = "date_added"

        class FakeMeta:
            def get_field(self, name):
                return FakeField()

        class FakeModel:
            _meta = FakeMeta()

        assert config.sql_clause(FakeModel) == "PARTITION BY RANGE (date_added)"

    def test_sql_clause_list(self):
        config = PartitionConfig(strategy=PartitionStrategy.LIST, key=["region"])

        class FakeField:
            column = "region"

        class FakeMeta:
            def get_field(self, name):
                return FakeField()

        class FakeModel:
            _meta = FakeMeta()

        assert config.sql_clause(FakeModel) == "PARTITION BY LIST (region)"

    def test_sql_clause_hash(self):
        config = PartitionConfig(strategy=PartitionStrategy.HASH, key=["id"])

        class FakeField:
            column = "id"

        class FakeMeta:
            def get_field(self, name):
                return FakeField()

        class FakeModel:
            _meta = FakeMeta()

        assert config.sql_clause(FakeModel) == "PARTITION BY HASH (id)"

    def test_sql_clause_multi_key(self):
        config = PartitionConfig(
            strategy=PartitionStrategy.RANGE, key=["organization_id", "date_added"]
        )

        fields = {
            "organization_id": type("F", (), {"column": "organization_id"})(),
            "date_added": type("F", (), {"column": "date_added"})(),
        }

        class FakeMeta:
            def get_field(self, name):
                return fields[name]

        class FakeModel:
            _meta = FakeMeta()

        assert config.sql_clause(FakeModel) == "PARTITION BY RANGE (organization_id, date_added)"


class PartitionBoundClauseTest(TestCase):
    def test_range_partition(self):
        p = RangePartition(name="p_2024_01", from_values="'2024-01-01'", to_values="'2024-02-01'")
        assert p.sql_bound_clause() == "FOR VALUES FROM ('2024-01-01') TO ('2024-02-01')"

    def test_list_partition(self):
        p = ListPartition(name="p_us", values=["us-east-1", "us-west-2"])
        assert p.sql_bound_clause() == "FOR VALUES IN ('us-east-1', 'us-west-2')"

    def test_list_partition_integers(self):
        p = ListPartition(name="p_1", values=[1, 2, 3])
        assert p.sql_bound_clause() == "FOR VALUES IN (1, 2, 3)"

    def test_hash_partition(self):
        p = HashPartition(name="p_0", modulus=4, remainder=0)
        assert p.sql_bound_clause() == "FOR VALUES WITH (MODULUS 4, REMAINDER 0)"


class IsPartitioningEnabledTest(TestCase):
    def test_disabled_by_default(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            os.environ.pop("SENTRY_PARTITIONED_MODELS", None)
            assert is_partitioning_enabled("sentry_testmodel") is False

    def test_enabled_all(self):
        with mock.patch.dict(os.environ, {"SENTRY_PARTITIONED_MODELS": "__all__"}):
            assert is_partitioning_enabled("sentry_testmodel") is True

    def test_enabled_specific(self):
        with mock.patch.dict(os.environ, {"SENTRY_PARTITIONED_MODELS": "sentry_foo,sentry_bar"}):
            assert is_partitioning_enabled("sentry_foo") is True
            assert is_partitioning_enabled("sentry_bar") is True
            assert is_partitioning_enabled("sentry_baz") is False

    def test_enabled_with_model_class(self):
        class FakeMeta:
            db_table = "sentry_mymodel"

        class FakeModel:
            _meta = FakeMeta()

        with mock.patch.dict(os.environ, {"SENTRY_PARTITIONED_MODELS": "sentry_mymodel"}):
            assert is_partitioning_enabled(FakeModel) is True

    def test_empty_string_means_disabled(self):
        with mock.patch.dict(os.environ, {"SENTRY_PARTITIONED_MODELS": ""}):
            assert is_partitioning_enabled("sentry_testmodel") is False


class SchemaEditorPartitionTest(TestCase):
    """Tests that the schema editor correctly generates PARTITION BY clauses."""

    def _create_test_table(self, table_name, partitioned=True):
        """Create a test partitioned table using raw SQL to verify schema editor behavior."""
        with connection.cursor() as cursor:
            cursor.execute(f"DROP TABLE IF EXISTS {table_name} CASCADE")

        if partitioned:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"CREATE TABLE {table_name} ("
                    f"  id BIGSERIAL NOT NULL,"
                    f"  date_added TIMESTAMP WITH TIME ZONE NOT NULL,"
                    f"  data TEXT,"
                    f"  PRIMARY KEY (id, date_added)"
                    f") PARTITION BY RANGE (date_added)"
                )
        else:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"CREATE TABLE {table_name} ("
                    f"  id BIGSERIAL PRIMARY KEY,"
                    f"  date_added TIMESTAMP WITH TIME ZONE NOT NULL,"
                    f"  data TEXT"
                    f")"
                )

    def _cleanup_table(self, table_name):
        with connection.cursor() as cursor:
            cursor.execute(f"DROP TABLE IF EXISTS {table_name} CASCADE")

    def test_partition_by_range_table_creation(self):
        table_name = "_test_partition_range"
        try:
            self._create_test_table(table_name, partitioned=True)

            with connection.cursor() as cursor:
                cursor.execute("SELECT relkind FROM pg_class WHERE relname = %s", [table_name])
                row = cursor.fetchone()
                assert row is not None
                # 'p' = partitioned table
                assert row[0] == "p"
        finally:
            self._cleanup_table(table_name)

    def test_add_range_partition(self):
        table_name = "_test_partition_parent"
        partition_name = "_test_partition_p202401"
        try:
            self._create_test_table(table_name, partitioned=True)

            with connection.cursor() as cursor:
                cursor.execute(
                    f"CREATE TABLE {partition_name} PARTITION OF {table_name} "
                    f"FOR VALUES FROM ('2024-01-01') TO ('2024-02-01')"
                )

            partitions = get_partitions(connection, table_name)
            assert partition_name in partitions
        finally:
            self._cleanup_table(table_name)

    def test_add_list_partition(self):
        table_name = "_test_partition_list_parent"
        partition_name = "_test_partition_list_p_us"
        try:
            with connection.cursor() as cursor:
                cursor.execute(f"DROP TABLE IF EXISTS {table_name} CASCADE")
                cursor.execute(
                    f"CREATE TABLE {table_name} ("
                    f"  id BIGSERIAL NOT NULL,"
                    f"  region TEXT NOT NULL,"
                    f"  data TEXT,"
                    f"  PRIMARY KEY (id, region)"
                    f") PARTITION BY LIST (region)"
                )
                cursor.execute(
                    f"CREATE TABLE {partition_name} PARTITION OF {table_name} "
                    f"FOR VALUES IN ('us-east-1', 'us-west-2')"
                )

            partitions = get_partitions(connection, table_name)
            assert partition_name in partitions
        finally:
            self._cleanup_table(table_name)

    def test_add_hash_partition(self):
        table_name = "_test_partition_hash_parent"
        partition_name = "_test_partition_hash_p0"
        try:
            with connection.cursor() as cursor:
                cursor.execute(f"DROP TABLE IF EXISTS {table_name} CASCADE")
                cursor.execute(
                    f"CREATE TABLE {table_name} ("
                    f"  id BIGSERIAL NOT NULL,"
                    f"  data TEXT,"
                    f"  PRIMARY KEY (id)"
                    f") PARTITION BY HASH (id)"
                )
                cursor.execute(
                    f"CREATE TABLE {partition_name} PARTITION OF {table_name} "
                    f"FOR VALUES WITH (MODULUS 4, REMAINDER 0)"
                )

            partitions = get_partitions(connection, table_name)
            assert partition_name in partitions
        finally:
            self._cleanup_table(table_name)

    def test_get_partitions_empty(self):
        table_name = "_test_partition_empty"
        try:
            self._create_test_table(table_name, partitioned=True)
            partitions = get_partitions(connection, table_name)
            assert partitions == []
        finally:
            self._cleanup_table(table_name)

    def test_get_partitions_nonexistent_table(self):
        partitions = get_partitions(connection, "_nonexistent_table_xyz")
        assert partitions == []

    def test_partition_index_on_partition(self):
        """Verify indexes can be created on individual partitions."""
        table_name = "_test_pidx_parent"
        partition_name = "_test_pidx_p202401"
        try:
            self._create_test_table(table_name, partitioned=True)

            with connection.cursor() as cursor:
                cursor.execute(
                    f"CREATE TABLE {partition_name} PARTITION OF {table_name} "
                    f"FOR VALUES FROM ('2024-01-01') TO ('2024-02-01')"
                )
                # Create index on partition only
                cursor.execute(f"CREATE INDEX {partition_name}_data_idx ON {partition_name} (data)")

                # Verify index exists on partition
                cursor.execute(
                    "SELECT indexname FROM pg_indexes WHERE tablename = %s",
                    [partition_name],
                )
                index_names = [row[0] for row in cursor.fetchall()]
                assert f"{partition_name}_data_idx" in index_names

                # Verify index does NOT exist on parent
                cursor.execute(
                    "SELECT indexname FROM pg_indexes WHERE tablename = %s",
                    [table_name],
                )
                parent_index_names = [row[0] for row in cursor.fetchall()]
                assert f"{partition_name}_data_idx" not in parent_index_names
        finally:
            self._cleanup_table(table_name)


class MigrationOperationTest(TestCase):
    """Tests for the partition migration operations."""

    def _cleanup_table(self, table_name):
        with connection.cursor() as cursor:
            cursor.execute(f"DROP TABLE IF EXISTS {table_name} CASCADE")

    def test_add_partition_operation_with_range(self):
        from sentry.new_migrations.monkey.partitioned import AddPartition

        table_name = "_test_op_range_parent"
        partition = RangePartition(
            name="_test_op_range_p202401",
            from_values="'2024-01-01'",
            to_values="'2024-02-01'",
        )

        try:
            # Create parent table
            with connection.cursor() as cursor:
                cursor.execute(f"DROP TABLE IF EXISTS {table_name} CASCADE")
                cursor.execute(
                    f"CREATE TABLE {table_name} ("
                    f"  id BIGSERIAL NOT NULL,"
                    f"  date_added TIMESTAMP WITH TIME ZONE NOT NULL,"
                    f"  PRIMARY KEY (id, date_added)"
                    f") PARTITION BY RANGE (date_added)"
                )

            # Create a minimal fake model for the operation
            class FakeMeta:
                db_table = table_name
                app_label = "sentry"
                label_lower = "sentry.fakemodel"

            class FakeModel:
                _meta = FakeMeta()

            class FakeState:
                class apps:
                    @staticmethod
                    def get_model(app_label, model_name):
                        return FakeModel

                models = {}

            op = AddPartition(model_name="FakeModel", partition=partition)

            with mock.patch.dict(os.environ, {"SENTRY_PARTITIONED_MODELS": table_name}):
                with mock.patch.object(op, "allow_migrate_model", return_value=True):
                    with connection.schema_editor() as schema_editor:
                        op.database_forwards("sentry", schema_editor, FakeState, FakeState)

            partitions = get_partitions(connection, table_name)
            assert "_test_op_range_p202401" in partitions
        finally:
            self._cleanup_table(table_name)

    def test_add_partition_noop_when_disabled(self):
        from sentry.new_migrations.monkey.partitioned import AddPartition

        partition = RangePartition(
            name="_test_noop_p202401",
            from_values="'2024-01-01'",
            to_values="'2024-02-01'",
        )
        op = AddPartition(model_name="FakeModel", partition=partition)

        class FakeMeta:
            db_table = "_test_noop_parent"
            app_label = "sentry"
            label_lower = "sentry.fakemodel"

        class FakeModel:
            _meta = FakeMeta()

        class FakeState:
            class apps:
                @staticmethod
                def get_model(app_label, model_name):
                    return FakeModel

            models = {}

        with mock.patch.dict(os.environ, {"SENTRY_PARTITIONED_MODELS": ""}):
            with mock.patch.object(op, "allow_migrate_model", return_value=True):
                with connection.schema_editor() as schema_editor:
                    # Should not raise even though parent table doesn't exist
                    op.database_forwards("sentry", schema_editor, FakeState, FakeState)

    def test_remove_partition_operation(self):
        from sentry.new_migrations.monkey.partitioned import RemovePartition

        table_name = "_test_op_rm_parent"
        partition = RangePartition(
            name="_test_op_rm_p202401",
            from_values="'2024-01-01'",
            to_values="'2024-02-01'",
        )

        try:
            with connection.cursor() as cursor:
                cursor.execute(f"DROP TABLE IF EXISTS {table_name} CASCADE")
                cursor.execute(
                    f"CREATE TABLE {table_name} ("
                    f"  id BIGSERIAL NOT NULL,"
                    f"  date_added TIMESTAMP WITH TIME ZONE NOT NULL,"
                    f"  PRIMARY KEY (id, date_added)"
                    f") PARTITION BY RANGE (date_added)"
                )
                cursor.execute(
                    f"CREATE TABLE _test_op_rm_p202401 PARTITION OF {table_name} "
                    f"FOR VALUES FROM ('2024-01-01') TO ('2024-02-01')"
                )

            assert "_test_op_rm_p202401" in get_partitions(connection, table_name)

            class FakeMeta:
                db_table = table_name
                app_label = "sentry"
                label_lower = "sentry.fakemodel"

            class FakeModel:
                _meta = FakeMeta()

            class FakeState:
                class apps:
                    @staticmethod
                    def get_model(app_label, model_name):
                        return FakeModel

                models = {}

            op = RemovePartition(model_name="FakeModel", partition=partition)

            with mock.patch.dict(os.environ, {"SENTRY_PARTITIONED_MODELS": table_name}):
                with mock.patch.object(op, "allow_migrate_model", return_value=True):
                    with connection.schema_editor() as schema_editor:
                        op.database_forwards("sentry", schema_editor, FakeState, FakeState)

            assert "_test_op_rm_p202401" not in get_partitions(connection, table_name)
        finally:
            self._cleanup_table(table_name)

    def test_partition_index_name_truncation(self):
        from sentry.new_migrations.monkey.partitioned import _partition_index_name

        name = _partition_index_name("very_long_partition_table_name", "very_long_index_name")
        assert len(name) <= 63

        short_name = _partition_index_name("p1", "idx1")
        assert short_name == "p1_idx1"

    def test_operation_deconstruct(self):
        from sentry.new_migrations.monkey.partitioned import (
            AddPartition,
            RemovePartition,
        )

        partition = RangePartition(
            name="p_202401",
            from_values="'2024-01-01'",
            to_values="'2024-02-01'",
        )

        add_op = AddPartition(model_name="MyModel", partition=partition)
        name, args, kwargs = add_op.deconstruct()
        assert "AddPartition" in name
        assert kwargs["model_name"] == "MyModel"
        assert kwargs["partition"] == partition

        rm_op = RemovePartition(model_name="MyModel", partition=partition)
        name, args, kwargs = rm_op.deconstruct()
        assert "RemovePartition" in name
        assert kwargs["model_name"] == "MyModel"
        assert kwargs["partition"] == partition
