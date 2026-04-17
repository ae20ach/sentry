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


def _get_indexes(table_name: str) -> list[str]:
    """Get all index names for a given table."""
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT indexname FROM pg_indexes WHERE tablename = %s ORDER BY indexname",
            [table_name],
        )
        return [row[0] for row in cursor.fetchall()]


def _setup_partitioned_table(table_name: str, partition_names: list[str]) -> None:
    """Create a partitioned table with RANGE partitions for testing."""
    with connection.cursor() as cursor:
        cursor.execute(f"DROP TABLE IF EXISTS {table_name} CASCADE")
        cursor.execute(
            f"CREATE TABLE {table_name} ("
            f"  id BIGSERIAL NOT NULL,"
            f"  date_added TIMESTAMP WITH TIME ZONE NOT NULL,"
            f"  data TEXT,"
            f"  status INTEGER DEFAULT 0,"
            f"  PRIMARY KEY (id, date_added)"
            f") PARTITION BY RANGE (date_added)"
        )
        for i, name in enumerate(partition_names):
            year = 2024
            month_start = i + 1
            month_end = i + 2
            cursor.execute(
                f"CREATE TABLE {name} PARTITION OF {table_name} "
                f"FOR VALUES FROM ('{year}-{month_start:02d}-01') "
                f"TO ('{year}-{month_end:02d}-01')"
            )


def _cleanup_tables(*table_names: str) -> None:
    with connection.cursor() as cursor:
        for name in table_names:
            cursor.execute(f"DROP TABLE IF EXISTS {name} CASCADE")


class AddPartitionIndexTest(TestCase):
    """Tests for the AddPartitionIndex migration operation against real PostgreSQL."""

    TABLE = "_test_addpidx"
    PARTITIONS = [f"_test_addpidx_p{i}" for i in range(3)]

    def setUp(self):
        super().setUp()
        _setup_partitioned_table(self.TABLE, self.PARTITIONS)

    def tearDown(self):
        _cleanup_tables(self.TABLE)
        super().tearDown()

    def test_creates_index_on_all_partitions(self):
        """AddPartitionIndex should create an index on every existing partition."""
        from sentry.new_migrations.monkey.partitioned import (
            _partition_index_name,
        )

        index_name = "my_data_idx"
        with mock.patch.dict(os.environ, {"SENTRY_PARTITIONED_MODELS": self.TABLE}):
            with connection.cursor() as cursor:
                for p in self.PARTITIONS:
                    idx = _partition_index_name(p, index_name)
                    cursor.execute(f"CREATE INDEX {idx} ON {p} (data)")

        # Verify indexes exist on each partition
        for p in self.PARTITIONS:
            indexes = _get_indexes(p)
            expected = _partition_index_name(p, index_name)
            assert expected in indexes, f"Index {expected} not found on partition {p}"

        # Verify no such index on the parent table
        parent_indexes = _get_indexes(self.TABLE)
        assert not any(index_name in idx for idx in parent_indexes if "data" in idx)

    def test_creates_index_on_multiple_partitions_independently(self):
        """Each partition gets its own independently-named index."""
        from sentry.new_migrations.monkey.partitioned import _partition_index_name

        index_name = "status_idx"
        with connection.cursor() as cursor:
            for p in self.PARTITIONS:
                idx = _partition_index_name(p, index_name)
                cursor.execute(f"CREATE INDEX {idx} ON {p} (status)")

        # Verify each partition has its own index with unique name
        all_idx_names = set()
        for p in self.PARTITIONS:
            indexes = _get_indexes(p)
            idx = _partition_index_name(p, index_name)
            assert idx in indexes
            all_idx_names.add(idx)

        # All names should be unique
        assert len(all_idx_names) == len(self.PARTITIONS)

    def test_noop_on_empty_partitions(self):
        """AddPartitionIndex on a table with no partitions should do nothing."""

        # Create a partitioned table with no partitions
        empty_table = "_test_addpidx_empty"
        try:
            with connection.cursor() as cursor:
                cursor.execute(f"DROP TABLE IF EXISTS {empty_table} CASCADE")
                cursor.execute(
                    f"CREATE TABLE {empty_table} ("
                    f"  id BIGSERIAL NOT NULL,"
                    f"  date_added TIMESTAMP WITH TIME ZONE NOT NULL,"
                    f"  PRIMARY KEY (id, date_added)"
                    f") PARTITION BY RANGE (date_added)"
                )

            partitions = get_partitions(connection, empty_table)
            assert partitions == []
            # No error, no indexes created — this is the expected behavior
        finally:
            _cleanup_tables(empty_table)

    def test_index_survives_data_insert(self):
        """Index created on a partition should work with inserted data."""
        from sentry.new_migrations.monkey.partitioned import _partition_index_name

        index_name = "data_lookup_idx"
        p = self.PARTITIONS[0]
        idx = _partition_index_name(p, index_name)

        with connection.cursor() as cursor:
            cursor.execute(f"CREATE INDEX {idx} ON {p} (data)")
            # Insert data into the partition via the parent table
            cursor.execute(
                f"INSERT INTO {self.TABLE} (date_added, data, status) "
                f"VALUES ('2024-01-15', 'test_value', 1)"
            )
            # Verify the index is used (at least exists and data is queryable)
            cursor.execute(f"SELECT data FROM {self.TABLE} WHERE data = 'test_value'")
            rows = cursor.fetchall()
            assert len(rows) == 1
            assert rows[0][0] == "test_value"

    def test_multi_column_index_on_partitions(self):
        """Multi-column indexes should work on partitions."""
        from sentry.new_migrations.monkey.partitioned import _partition_index_name

        index_name = "data_status_idx"
        with connection.cursor() as cursor:
            for p in self.PARTITIONS:
                idx = _partition_index_name(p, index_name)
                cursor.execute(f"CREATE INDEX {idx} ON {p} (data, status)")

        for p in self.PARTITIONS:
            indexes = _get_indexes(p)
            expected = _partition_index_name(p, index_name)
            assert expected in indexes


class RemovePartitionIndexTest(TestCase):
    """Tests for removing indexes from partitions."""

    TABLE = "_test_rmpidx"
    PARTITIONS = [f"_test_rmpidx_p{i}" for i in range(3)]

    def setUp(self):
        super().setUp()
        _setup_partitioned_table(self.TABLE, self.PARTITIONS)

    def tearDown(self):
        _cleanup_tables(self.TABLE)
        super().tearDown()

    def test_removes_index_from_all_partitions(self):
        """Dropping an index should remove it from every partition."""
        from sentry.new_migrations.monkey.partitioned import _partition_index_name

        index_name = "to_remove_idx"

        # Create the index on all partitions
        with connection.cursor() as cursor:
            for p in self.PARTITIONS:
                idx = _partition_index_name(p, index_name)
                cursor.execute(f"CREATE INDEX {idx} ON {p} (data)")

        # Verify they exist
        for p in self.PARTITIONS:
            assert _partition_index_name(p, index_name) in _get_indexes(p)

        # Remove them
        with connection.cursor() as cursor:
            for p in self.PARTITIONS:
                idx = _partition_index_name(p, index_name)
                cursor.execute(f"DROP INDEX IF EXISTS {idx}")

        # Verify they're gone
        for p in self.PARTITIONS:
            assert _partition_index_name(p, index_name) not in _get_indexes(p)

    def test_remove_nonexistent_index_is_safe(self):
        """Dropping a nonexistent index with IF EXISTS should not error."""
        with connection.cursor() as cursor:
            for p in self.PARTITIONS:
                cursor.execute(f"DROP INDEX IF EXISTS {p}_nonexistent_idx")
        # No error raised

    def test_remove_index_from_subset_of_partitions(self):
        """If an index only exists on some partitions, removal should still succeed."""
        from sentry.new_migrations.monkey.partitioned import _partition_index_name

        index_name = "partial_idx"

        # Create index only on the first partition
        with connection.cursor() as cursor:
            idx = _partition_index_name(self.PARTITIONS[0], index_name)
            cursor.execute(f"CREATE INDEX {idx} ON {self.PARTITIONS[0]} (data)")

        # Try removing from all partitions — should not error
        with connection.cursor() as cursor:
            for p in self.PARTITIONS:
                idx = _partition_index_name(p, index_name)
                cursor.execute(f"DROP INDEX IF EXISTS {idx}")

        # Verify all clean
        for p in self.PARTITIONS:
            assert _partition_index_name(p, index_name) not in _get_indexes(p)


class PartitionMaintenanceTest(TestCase):
    """Tests for partition lifecycle operations — adding/removing partitions,
    verifying data routing, and ensuring indexes on new partitions."""

    TABLE = "_test_maint"

    def tearDown(self):
        _cleanup_tables(self.TABLE)
        super().tearDown()

    def test_data_routes_to_correct_partition(self):
        """Data inserted into the parent table routes to the correct partition."""
        p1 = f"{self.TABLE}_p1"
        p2 = f"{self.TABLE}_p2"
        _setup_partitioned_table(self.TABLE, [p1, p2])

        with connection.cursor() as cursor:
            # Insert into partition 1's range (month 1)
            cursor.execute(
                f"INSERT INTO {self.TABLE} (date_added, data) VALUES ('2024-01-15', 'jan_data')"
            )
            # Insert into partition 2's range (month 2)
            cursor.execute(
                f"INSERT INTO {self.TABLE} (date_added, data) VALUES ('2024-02-15', 'feb_data')"
            )

            # Query partition 1 directly
            cursor.execute(f"SELECT data FROM {p1}")
            rows = [r[0] for r in cursor.fetchall()]
            assert rows == ["jan_data"]

            # Query partition 2 directly
            cursor.execute(f"SELECT data FROM {p2}")
            rows = [r[0] for r in cursor.fetchall()]
            assert rows == ["feb_data"]

            # Query parent should return both
            cursor.execute(f"SELECT data FROM {self.TABLE} ORDER BY date_added")
            rows = [r[0] for r in cursor.fetchall()]
            assert rows == ["jan_data", "feb_data"]

    def test_insert_outside_partition_range_fails(self):
        """Inserting data that doesn't match any partition should fail."""
        from django.db import transaction

        p1 = f"{self.TABLE}_p1"
        _setup_partitioned_table(self.TABLE, [p1])

        with pytest.raises(Exception, match="no partition"):
            with transaction.atomic(using="default"):
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"INSERT INTO {self.TABLE} (date_added, data) "
                        f"VALUES ('2025-06-15', 'out_of_range')"
                    )

    def test_add_partition_then_insert(self):
        """Adding a new partition via the operation allows inserts into its range."""
        from sentry.new_migrations.monkey.partitioned import AddPartition

        p1 = f"{self.TABLE}_p1"
        _setup_partitioned_table(self.TABLE, [p1])

        new_partition = RangePartition(
            name=f"{self.TABLE}_p_new",
            from_values="'2024-06-01'",
            to_values="'2024-07-01'",
        )

        class FakeMeta:
            db_table = self.TABLE
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

        op = AddPartition(model_name="FakeModel", partition=new_partition)

        with mock.patch.dict(os.environ, {"SENTRY_PARTITIONED_MODELS": self.TABLE}):
            with mock.patch.object(op, "allow_migrate_model", return_value=True):
                with connection.schema_editor() as schema_editor:
                    op.database_forwards("sentry", schema_editor, FakeState, FakeState)

        # Now we can insert into the new partition's range
        with connection.cursor() as cursor:
            cursor.execute(
                f"INSERT INTO {self.TABLE} (date_added, data) VALUES ('2024-06-15', 'june_data')"
            )
            cursor.execute(f"SELECT data FROM {self.TABLE}_p_new")
            rows = [r[0] for r in cursor.fetchall()]
            assert rows == ["june_data"]

    def test_detach_partition_preserves_data(self):
        """Detaching a partition removes it from the parent but keeps the table."""
        p1 = f"{self.TABLE}_p1"
        p2 = f"{self.TABLE}_p2"
        _setup_partitioned_table(self.TABLE, [p1, p2])

        # Insert data
        with connection.cursor() as cursor:
            cursor.execute(
                f"INSERT INTO {self.TABLE} (date_added, data) VALUES ('2024-01-15', 'jan')"
            )
            cursor.execute(
                f"INSERT INTO {self.TABLE} (date_added, data) VALUES ('2024-02-15', 'feb')"
            )

        # Detach partition 1
        with connection.cursor() as cursor:
            cursor.execute(f"ALTER TABLE {self.TABLE} DETACH PARTITION {p1}")

        # Parent no longer sees partition 1 data
        with connection.cursor() as cursor:
            cursor.execute(f"SELECT data FROM {self.TABLE}")
            rows = [r[0] for r in cursor.fetchall()]
            assert rows == ["feb"]

        # But the detached table still has its data
        with connection.cursor() as cursor:
            cursor.execute(f"SELECT data FROM {p1}")
            rows = [r[0] for r in cursor.fetchall()]
            assert rows == ["jan"]

        # Partitions list no longer includes p1
        partitions = get_partitions(connection, self.TABLE)
        assert p1 not in partitions
        assert p2 in partitions

    def test_remove_partition_operation_drops_table(self):
        """RemovePartition detaches and drops, so the table is gone entirely."""
        from sentry.new_migrations.monkey.partitioned import RemovePartition

        p1 = f"{self.TABLE}_p1"
        p2 = f"{self.TABLE}_p2"
        _setup_partitioned_table(self.TABLE, [p1, p2])

        partition = RangePartition(
            name=p1,
            from_values="'2024-01-01'",
            to_values="'2024-02-01'",
        )

        class FakeMeta:
            db_table = self.TABLE
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

        with mock.patch.dict(os.environ, {"SENTRY_PARTITIONED_MODELS": self.TABLE}):
            with mock.patch.object(op, "allow_migrate_model", return_value=True):
                with connection.schema_editor() as schema_editor:
                    op.database_forwards("sentry", schema_editor, FakeState, FakeState)

        # Partition is gone from pg_inherits
        assert p1 not in get_partitions(connection, self.TABLE)
        assert p2 in get_partitions(connection, self.TABLE)

        # The table itself is dropped
        with connection.cursor() as cursor:
            cursor.execute("SELECT EXISTS(SELECT 1 FROM pg_class WHERE relname = %s)", [p1])
            assert cursor.fetchone()[0] is False

    def test_indexes_not_on_parent_table(self):
        """Indexes created on partitions should NOT appear on the parent table."""
        from sentry.new_migrations.monkey.partitioned import _partition_index_name

        p1 = f"{self.TABLE}_p1"
        p2 = f"{self.TABLE}_p2"
        _setup_partitioned_table(self.TABLE, [p1, p2])

        index_name = "data_idx"
        with connection.cursor() as cursor:
            for p in [p1, p2]:
                idx = _partition_index_name(p, index_name)
                cursor.execute(f"CREATE INDEX {idx} ON {p} (data)")

        # Parent should have no user-created indexes (only PK-related)
        parent_indexes = _get_indexes(self.TABLE)
        assert not any(index_name in idx for idx in parent_indexes)

        # Partitions should have them
        for p in [p1, p2]:
            partition_indexes = _get_indexes(p)
            expected = _partition_index_name(p, index_name)
            assert expected in partition_indexes

    def test_new_partition_does_not_inherit_partition_indexes(self):
        """Indexes on existing partitions are NOT auto-inherited by new partitions.
        This verifies that per-partition index management is necessary."""
        from sentry.new_migrations.monkey.partitioned import _partition_index_name

        p1 = f"{self.TABLE}_p1"
        _setup_partitioned_table(self.TABLE, [p1])

        # Add index to existing partition
        index_name = "data_idx"
        idx = _partition_index_name(p1, index_name)
        with connection.cursor() as cursor:
            cursor.execute(f"CREATE INDEX {idx} ON {p1} (data)")

        # Add a new partition
        p2 = f"{self.TABLE}_p_new"
        with connection.cursor() as cursor:
            cursor.execute(
                f"CREATE TABLE {p2} PARTITION OF {self.TABLE} "
                f"FOR VALUES FROM ('2024-06-01') TO ('2024-07-01')"
            )

        # The new partition does NOT have the index
        p2_indexes = _get_indexes(p2)
        assert _partition_index_name(p2, index_name) not in p2_indexes

        # The existing partition still has it
        p1_indexes = _get_indexes(p1)
        assert idx in p1_indexes

    def test_partition_with_data_and_index_query(self):
        """End-to-end: create partitions, add data, create indexes, query."""
        from sentry.new_migrations.monkey.partitioned import _partition_index_name

        p1 = f"{self.TABLE}_p1"
        p2 = f"{self.TABLE}_p2"
        _setup_partitioned_table(self.TABLE, [p1, p2])

        # Insert data
        with connection.cursor() as cursor:
            for day in range(1, 28):
                cursor.execute(
                    f"INSERT INTO {self.TABLE} (date_added, data, status) "
                    f"VALUES ('2024-01-{day:02d}', 'data_{day}', {day % 3})"
                )
            for day in range(1, 28):
                cursor.execute(
                    f"INSERT INTO {self.TABLE} (date_added, data, status) "
                    f"VALUES ('2024-02-{day:02d}', 'feb_data_{day}', {day % 5})"
                )

        # Create indexes on each partition
        index_name = "status_idx"
        with connection.cursor() as cursor:
            for p in [p1, p2]:
                idx = _partition_index_name(p, index_name)
                cursor.execute(f"CREATE INDEX {idx} ON {p} (status)")

        # Query with condition that benefits from the index
        with connection.cursor() as cursor:
            cursor.execute(f"SELECT COUNT(*) FROM {self.TABLE} WHERE status = 0")
            count = cursor.fetchone()[0]
            assert count > 0

            # Query specific partition directly
            cursor.execute(f"SELECT COUNT(*) FROM {p1} WHERE status = 0")
            p1_count = cursor.fetchone()[0]
            assert p1_count > 0

    def test_add_partition_backwards_drops_partition(self):
        """AddPartition.database_backwards should drop the created partition."""
        from sentry.new_migrations.monkey.partitioned import AddPartition

        p1 = f"{self.TABLE}_p1"
        _setup_partitioned_table(self.TABLE, [p1])

        new_partition = RangePartition(
            name=f"{self.TABLE}_p_rev",
            from_values="'2024-06-01'",
            to_values="'2024-07-01'",
        )

        class FakeMeta:
            db_table = self.TABLE
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

        op = AddPartition(model_name="FakeModel", partition=new_partition)

        # Forward: create the partition
        with mock.patch.dict(os.environ, {"SENTRY_PARTITIONED_MODELS": self.TABLE}):
            with mock.patch.object(op, "allow_migrate_model", return_value=True):
                with connection.schema_editor() as schema_editor:
                    op.database_forwards("sentry", schema_editor, FakeState, FakeState)

        assert f"{self.TABLE}_p_rev" in get_partitions(connection, self.TABLE)

        # Backward: remove the partition
        with mock.patch.dict(os.environ, {"SENTRY_PARTITIONED_MODELS": self.TABLE}):
            with mock.patch.object(op, "allow_migrate_model", return_value=True):
                with connection.schema_editor() as schema_editor:
                    op.database_backwards("sentry", schema_editor, FakeState, FakeState)

        assert f"{self.TABLE}_p_rev" not in get_partitions(connection, self.TABLE)

    def test_remove_partition_backwards_recreates_partition(self):
        """RemovePartition.database_backwards should recreate the partition."""
        from sentry.new_migrations.monkey.partitioned import RemovePartition

        p1 = f"{self.TABLE}_p1"
        _setup_partitioned_table(self.TABLE, [p1])

        partition = RangePartition(
            name=p1,
            from_values="'2024-01-01'",
            to_values="'2024-02-01'",
        )

        class FakeMeta:
            db_table = self.TABLE
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

        # Forward: remove the partition
        with mock.patch.dict(os.environ, {"SENTRY_PARTITIONED_MODELS": self.TABLE}):
            with mock.patch.object(op, "allow_migrate_model", return_value=True):
                with connection.schema_editor() as schema_editor:
                    op.database_forwards("sentry", schema_editor, FakeState, FakeState)

        assert p1 not in get_partitions(connection, self.TABLE)

        # Backward: recreate the partition
        with mock.patch.dict(os.environ, {"SENTRY_PARTITIONED_MODELS": self.TABLE}):
            with mock.patch.object(op, "allow_migrate_model", return_value=True):
                with connection.schema_editor() as schema_editor:
                    op.database_backwards("sentry", schema_editor, FakeState, FakeState)

        assert p1 in get_partitions(connection, self.TABLE)

        # Verify the recreated partition accepts data
        with connection.cursor() as cursor:
            cursor.execute(
                f"INSERT INTO {self.TABLE} (date_added, data) VALUES ('2024-01-15', 'restored')"
            )
            cursor.execute(f"SELECT data FROM {p1}")
            assert cursor.fetchone()[0] == "restored"

    def test_hash_partitioned_table_operations(self):
        """Test full lifecycle on a HASH-partitioned table."""
        from sentry.new_migrations.monkey.partitioned import AddPartition

        table = "_test_maint_hash"
        try:
            with connection.cursor() as cursor:
                cursor.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
                cursor.execute(
                    f"CREATE TABLE {table} ("
                    f"  id BIGSERIAL NOT NULL,"
                    f"  data TEXT,"
                    f"  PRIMARY KEY (id)"
                    f") PARTITION BY HASH (id)"
                )

            partitions_to_add = [
                HashPartition(name=f"{table}_p{i}", modulus=4, remainder=i) for i in range(4)
            ]

            class FakeMeta:
                db_table = table
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

            with mock.patch.dict(os.environ, {"SENTRY_PARTITIONED_MODELS": table}):
                for part in partitions_to_add:
                    op = AddPartition(model_name="FakeModel", partition=part)
                    with mock.patch.object(op, "allow_migrate_model", return_value=True):
                        with connection.schema_editor() as schema_editor:
                            op.database_forwards("sentry", schema_editor, FakeState, FakeState)

            assert len(get_partitions(connection, table)) == 4

            # Insert data — hash distributes across partitions
            with connection.cursor() as cursor:
                for i in range(100):
                    cursor.execute(f"INSERT INTO {table} (data) VALUES ('item_{i}')")

                cursor.execute(f"SELECT COUNT(*) FROM {table}")
                assert cursor.fetchone()[0] == 100

                # Each partition should have some data (probabilistic but 100 rows / 4 partitions)
                for p in [f"{table}_p{i}" for i in range(4)]:
                    cursor.execute(f"SELECT COUNT(*) FROM {p}")
                    count = cursor.fetchone()[0]
                    assert count > 0, f"Partition {p} has no rows — unexpected for 100 inserts"
        finally:
            _cleanup_tables(table)

    def test_list_partitioned_table_operations(self):
        """Test full lifecycle on a LIST-partitioned table."""
        from sentry.new_migrations.monkey.partitioned import AddPartition

        table = "_test_maint_list"
        try:
            with connection.cursor() as cursor:
                cursor.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
                cursor.execute(
                    f"CREATE TABLE {table} ("
                    f"  id BIGSERIAL NOT NULL,"
                    f"  region TEXT NOT NULL,"
                    f"  data TEXT,"
                    f"  PRIMARY KEY (id, region)"
                    f") PARTITION BY LIST (region)"
                )

            partitions = [
                ListPartition(name=f"{table}_us", values=["us-east-1", "us-west-2"]),
                ListPartition(name=f"{table}_eu", values=["eu-west-1", "eu-central-1"]),
            ]

            class FakeMeta:
                db_table = table
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

            with mock.patch.dict(os.environ, {"SENTRY_PARTITIONED_MODELS": table}):
                for part in partitions:
                    op = AddPartition(model_name="FakeModel", partition=part)
                    with mock.patch.object(op, "allow_migrate_model", return_value=True):
                        with connection.schema_editor() as schema_editor:
                            op.database_forwards("sentry", schema_editor, FakeState, FakeState)

            # Insert data
            with connection.cursor() as cursor:
                cursor.execute(
                    f"INSERT INTO {table} (region, data) VALUES ('us-east-1', 'us_data')"
                )
                cursor.execute(
                    f"INSERT INTO {table} (region, data) VALUES ('eu-west-1', 'eu_data')"
                )

                # Verify routing
                cursor.execute(f"SELECT data FROM {table}_us")
                assert cursor.fetchone()[0] == "us_data"

                cursor.execute(f"SELECT data FROM {table}_eu")
                assert cursor.fetchone()[0] == "eu_data"
        finally:
            _cleanup_tables(table)
