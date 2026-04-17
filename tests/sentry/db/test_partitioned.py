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
from sentry.new_migrations.monkey.partitioned import (
    AddPartition,
    AddPartitionIndex,
    RemovePartition,
    RemovePartitionIndex,
    _partition_index_name,
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


# ---------------------------------------------------------------------------
# Helpers for operation-based tests
# ---------------------------------------------------------------------------


def _get_indexes(table_name: str) -> list[str]:
    """Get all index names for a given table."""
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT indexname FROM pg_indexes WHERE tablename = %s ORDER BY indexname",
            [table_name],
        )
        return [row[0] for row in cursor.fetchall()]


def _table_exists(table_name: str) -> bool:
    with connection.cursor() as cursor:
        cursor.execute("SELECT EXISTS(SELECT 1 FROM pg_class WHERE relname = %s)", [table_name])
        return cursor.fetchone()[0]


def _create_parent_table(table_name: str, strategy: str, columns_sql: str) -> None:
    """Create a partitioned parent table.

    Parent table creation uses raw SQL because CreatePartitionedModel requires
    a real Django model. All partition and index operations use the migration
    operation classes.
    """
    with connection.cursor() as cursor:
        cursor.execute(f"DROP TABLE IF EXISTS {table_name} CASCADE")
        cursor.execute(f"CREATE TABLE {table_name} ({columns_sql}) PARTITION BY {strategy}")


def _cleanup_tables(*table_names: str) -> None:
    with connection.cursor() as cursor:
        for name in table_names:
            cursor.execute(f"DROP TABLE IF EXISTS {name} CASCADE")


def _make_fake_model_and_state(table_name: str):
    """Create a FakeModel and FakeState for use with migration operations.

    For operations that need Django's full model introspection (e.g.
    AddPartitionIndex which calls Index.create_sql), use _make_real_model_and_state
    instead.
    """

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

    return FakeModel, FakeState


import warnings

# Cache for dynamically created models keyed by table name
_real_model_cache: dict[str, type] = {}


def _make_real_model_and_state(table_name: str):
    """Create a real Django model and FakeState for index operations.

    Index.create_sql() needs a real Django model with proper _meta to resolve
    field names to columns. We dynamically create a model pointing at the
    given table name, and cache it to avoid Django's re-registration warning.
    """
    if table_name not in _real_model_cache:
        from django.db import models as dj_models

        # Use a unique class name per table to avoid Django registration conflicts
        class_name = f"TestPart_{''.join(c for c in table_name if c.isalnum())}"
        attrs = {
            "__module__": __name__,
            "id": dj_models.BigAutoField(primary_key=True),
            "date_added": dj_models.DateTimeField(),
            "data": dj_models.TextField(null=True),
            "status": dj_models.IntegerField(default=0),
            "region": dj_models.TextField(null=True),
            "Meta": type(
                "Meta", (), {"app_label": "sentry", "db_table": table_name, "managed": False}
            ),
        }
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            _real_model_cache[table_name] = type(class_name, (dj_models.Model,), attrs)

    RealModel = _real_model_cache[table_name]

    class FakeState:
        class apps:
            @staticmethod
            def get_model(app_label, model_name):
                return RealModel

        models = {}

    return RealModel, FakeState


def _run_op_forwards(op, table_name: str, real_model: bool = False) -> None:
    """Run a migration operation forwards with partitioning enabled."""
    factory = _make_real_model_and_state if real_model else _make_fake_model_and_state
    _, State = factory(table_name)
    with mock.patch.dict(os.environ, {"SENTRY_PARTITIONED_MODELS": table_name}):
        with mock.patch.object(op, "allow_migrate_model", return_value=True):
            with connection.schema_editor() as schema_editor:
                op.database_forwards("sentry", schema_editor, State, State)


def _run_op_backwards(op, table_name: str, real_model: bool = False) -> None:
    """Run a migration operation backwards with partitioning enabled."""
    factory = _make_real_model_and_state if real_model else _make_fake_model_and_state
    _, State = factory(table_name)
    with mock.patch.dict(os.environ, {"SENTRY_PARTITIONED_MODELS": table_name}):
        with mock.patch.object(op, "allow_migrate_model", return_value=True):
            with connection.schema_editor() as schema_editor:
                op.database_backwards("sentry", schema_editor, State, State)


# Standard RANGE-partitioned table schema used by most tests
RANGE_COLUMNS = (
    "id BIGSERIAL NOT NULL, "
    "date_added TIMESTAMP WITH TIME ZONE NOT NULL, "
    "data TEXT, "
    "status INTEGER DEFAULT 0, "
    "PRIMARY KEY (id, date_added)"
)


def _range_partitions(table: str, count: int) -> list[RangePartition]:
    """Generate count RangePartition objects for consecutive months."""
    return [
        RangePartition(
            name=f"{table}_p{i}",
            from_values=f"'2024-{i + 1:02d}-01'",
            to_values=f"'2024-{i + 2:02d}-01'",
        )
        for i in range(count)
    ]


def _setup_range_table(table: str, num_partitions: int) -> list[RangePartition]:
    """Create a RANGE-partitioned parent table and add partitions via operations."""
    _create_parent_table(table, "RANGE (date_added)", RANGE_COLUMNS)
    partitions = _range_partitions(table, num_partitions)
    for p in partitions:
        _run_op_forwards(AddPartition(model_name="FakeModel", partition=p), table)
    return partitions


# ---------------------------------------------------------------------------
# Operation tests
# ---------------------------------------------------------------------------


class AddPartitionOperationTest(TestCase):
    """Tests for the AddPartition migration operation."""

    TABLE = "_test_addpart"

    def tearDown(self):
        _cleanup_tables(self.TABLE)
        super().tearDown()

    def test_adds_range_partition(self):
        _create_parent_table(self.TABLE, "RANGE (date_added)", RANGE_COLUMNS)
        partition = RangePartition(
            name=f"{self.TABLE}_p0", from_values="'2024-01-01'", to_values="'2024-02-01'"
        )
        _run_op_forwards(AddPartition(model_name="FakeModel", partition=partition), self.TABLE)
        assert f"{self.TABLE}_p0" in get_partitions(connection, self.TABLE)

    def test_adds_list_partition(self):
        _create_parent_table(
            self.TABLE,
            "LIST (region)",
            "id BIGSERIAL NOT NULL, region TEXT NOT NULL, data TEXT, PRIMARY KEY (id, region)",
        )
        partition = ListPartition(name=f"{self.TABLE}_us", values=["us-east-1", "us-west-2"])
        _run_op_forwards(AddPartition(model_name="FakeModel", partition=partition), self.TABLE)
        assert f"{self.TABLE}_us" in get_partitions(connection, self.TABLE)

    def test_adds_hash_partition(self):
        _create_parent_table(
            self.TABLE,
            "HASH (id)",
            "id BIGSERIAL NOT NULL, data TEXT, PRIMARY KEY (id)",
        )
        partition = HashPartition(name=f"{self.TABLE}_p0", modulus=4, remainder=0)
        _run_op_forwards(AddPartition(model_name="FakeModel", partition=partition), self.TABLE)
        assert f"{self.TABLE}_p0" in get_partitions(connection, self.TABLE)

    def test_noop_when_disabled(self):
        partition = RangePartition(
            name="_test_noop_p0", from_values="'2024-01-01'", to_values="'2024-02-01'"
        )
        op = AddPartition(model_name="FakeModel", partition=partition)
        _, FakeState = _make_fake_model_and_state("_test_noop_parent")

        with mock.patch.dict(os.environ, {"SENTRY_PARTITIONED_MODELS": ""}):
            with mock.patch.object(op, "allow_migrate_model", return_value=True):
                with connection.schema_editor() as schema_editor:
                    # No error even though parent doesn't exist
                    op.database_forwards("sentry", schema_editor, FakeState, FakeState)

    def test_backwards_drops_partition(self):
        _create_parent_table(self.TABLE, "RANGE (date_added)", RANGE_COLUMNS)
        partition = RangePartition(
            name=f"{self.TABLE}_p0", from_values="'2024-01-01'", to_values="'2024-02-01'"
        )
        op = AddPartition(model_name="FakeModel", partition=partition)

        _run_op_forwards(op, self.TABLE)
        assert f"{self.TABLE}_p0" in get_partitions(connection, self.TABLE)

        _run_op_backwards(op, self.TABLE)
        assert f"{self.TABLE}_p0" not in get_partitions(connection, self.TABLE)


class RemovePartitionOperationTest(TestCase):
    """Tests for the RemovePartition migration operation."""

    TABLE = "_test_rmpart"

    def tearDown(self):
        _cleanup_tables(self.TABLE)
        super().tearDown()

    def test_detaches_and_drops_partition(self):
        partitions = _setup_range_table(self.TABLE, 2)
        op = RemovePartition(model_name="FakeModel", partition=partitions[0])
        _run_op_forwards(op, self.TABLE)

        assert f"{self.TABLE}_p0" not in get_partitions(connection, self.TABLE)
        assert f"{self.TABLE}_p1" in get_partitions(connection, self.TABLE)
        assert not _table_exists(f"{self.TABLE}_p0")

    def test_noop_when_disabled(self):
        partitions = _setup_range_table(self.TABLE, 1)
        op = RemovePartition(model_name="FakeModel", partition=partitions[0])
        _, FakeState = _make_fake_model_and_state(self.TABLE)

        with mock.patch.dict(os.environ, {"SENTRY_PARTITIONED_MODELS": ""}):
            with mock.patch.object(op, "allow_migrate_model", return_value=True):
                with connection.schema_editor() as schema_editor:
                    op.database_forwards("sentry", schema_editor, FakeState, FakeState)

        # Partition still exists
        assert f"{self.TABLE}_p0" in get_partitions(connection, self.TABLE)

    def test_backwards_recreates_partition(self):
        partitions = _setup_range_table(self.TABLE, 1)
        op = RemovePartition(model_name="FakeModel", partition=partitions[0])

        _run_op_forwards(op, self.TABLE)
        assert f"{self.TABLE}_p0" not in get_partitions(connection, self.TABLE)

        _run_op_backwards(op, self.TABLE)
        assert f"{self.TABLE}_p0" in get_partitions(connection, self.TABLE)

        # Recreated partition accepts data
        with connection.cursor() as cursor:
            cursor.execute(
                f"INSERT INTO {self.TABLE} (date_added, data) VALUES ('2024-01-15', 'restored')"
            )
            cursor.execute(f"SELECT data FROM {self.TABLE}_p0")
            assert cursor.fetchone()[0] == "restored"


class AddPartitionIndexOperationTest(TestCase):
    """Tests for the AddPartitionIndex migration operation."""

    TABLE = "_test_addpidx"

    def setUp(self):
        super().setUp()
        self.partitions = _setup_range_table(self.TABLE, 3)

    def tearDown(self):
        _cleanup_tables(self.TABLE)
        super().tearDown()

    def _make_index(self, name="test_data_idx", fields=("data",)):
        from django.db.models import Index

        return Index(fields=list(fields), name=name)

    def _run_add_index(self, index):
        op = AddPartitionIndex(model_name="FakeModel", index=index)
        _run_op_forwards(op, self.TABLE, real_model=True)
        return op

    def test_creates_index_on_all_partitions(self):
        index = self._make_index("data_idx")
        self._run_add_index(index)

        for p in self.partitions:
            idx_name = _partition_index_name(p.name, "data_idx")
            assert idx_name in _get_indexes(p.name), f"Index not found on {p.name}"

    def test_index_not_on_parent_table(self):
        index = self._make_index("data_idx")
        self._run_add_index(index)

        parent_indexes = _get_indexes(self.TABLE)
        assert not any("data_idx" in idx for idx in parent_indexes)

    def test_each_partition_gets_unique_index_name(self):
        index = self._make_index("status_idx", fields=("status",))
        self._run_add_index(index)

        names = set()
        for p in self.partitions:
            idx_name = _partition_index_name(p.name, "status_idx")
            assert idx_name in _get_indexes(p.name)
            names.add(idx_name)
        assert len(names) == len(self.partitions)

    def test_multi_column_index(self):
        index = self._make_index("data_status_idx", fields=("data", "status"))
        self._run_add_index(index)

        for p in self.partitions:
            idx_name = _partition_index_name(p.name, "data_status_idx")
            assert idx_name in _get_indexes(p.name)

    def test_noop_on_empty_partitions(self):
        """No error when the table has zero partitions."""
        empty_table = "_test_addpidx_empty"
        try:
            _create_parent_table(empty_table, "RANGE (date_added)", RANGE_COLUMNS)
            index = self._make_index("data_idx")
            op = AddPartitionIndex(model_name="FakeModel", index=index)
            _run_op_forwards(op, empty_table)
            # No partitions → nothing to index → no error
        finally:
            _cleanup_tables(empty_table)

    def test_fallback_to_regular_index_when_disabled(self):
        """When partitioning is disabled, creates a regular index on the table."""
        regular_table = "_test_addpidx_regular"
        try:
            with connection.cursor() as cursor:
                cursor.execute(f"DROP TABLE IF EXISTS {regular_table} CASCADE")
                cursor.execute(
                    f"CREATE TABLE {regular_table} ("
                    f"  id BIGSERIAL PRIMARY KEY, data TEXT, status INTEGER DEFAULT 0)"
                )

            index = self._make_index("data_idx")
            op = AddPartitionIndex(model_name="FakeModel", index=index)
            _, State = _make_real_model_and_state(regular_table)

            with mock.patch.dict(os.environ, {"SENTRY_PARTITIONED_MODELS": ""}):
                with mock.patch.object(op, "allow_migrate_model", return_value=True):
                    with connection.schema_editor() as schema_editor:
                        op.database_forwards("sentry", schema_editor, State, State)

            assert "data_idx" in _get_indexes(regular_table)
        finally:
            _cleanup_tables(regular_table)

    def test_index_works_with_data(self):
        """Indexes created via the operation work with inserted data."""
        index = self._make_index("data_lookup_idx")
        self._run_add_index(index)

        with connection.cursor() as cursor:
            cursor.execute(
                f"INSERT INTO {self.TABLE} (date_added, data, status) "
                f"VALUES ('2024-01-15', 'test_value', 1)"
            )
            cursor.execute(f"SELECT data FROM {self.TABLE} WHERE data = 'test_value'")
            rows = cursor.fetchall()
            assert len(rows) == 1
            assert rows[0][0] == "test_value"

    def test_backwards_drops_index_from_all_partitions(self):
        index = self._make_index("data_idx")
        op = self._run_add_index(index)
        _run_op_backwards(op, self.TABLE, real_model=True)

        for p in self.partitions:
            idx_name = _partition_index_name(p.name, "data_idx")
            assert idx_name not in _get_indexes(p.name)

    def test_new_partition_does_not_inherit_indexes(self):
        """Indexes on existing partitions are NOT auto-inherited by new partitions."""
        index = self._make_index("data_idx")
        self._run_add_index(index)

        # Add a new partition
        new_part = RangePartition(
            name=f"{self.TABLE}_p_new", from_values="'2024-06-01'", to_values="'2024-07-01'"
        )
        _run_op_forwards(AddPartition(model_name="FakeModel", partition=new_part), self.TABLE)

        # New partition does NOT have the index
        new_idx_name = _partition_index_name(f"{self.TABLE}_p_new", "data_idx")
        assert new_idx_name not in _get_indexes(f"{self.TABLE}_p_new")

        # Existing partitions still have it
        for p in self.partitions:
            assert _partition_index_name(p.name, "data_idx") in _get_indexes(p.name)


class RemovePartitionIndexOperationTest(TestCase):
    """Tests for the RemovePartitionIndex migration operation."""

    TABLE = "_test_rmpidx"

    def setUp(self):
        super().setUp()
        self.partitions = _setup_range_table(self.TABLE, 3)
        # Pre-create indexes on all partitions via AddPartitionIndex
        self.index_name = "data_idx"
        index = self._make_index(self.index_name)
        op = AddPartitionIndex(model_name="FakeModel", index=index)
        _run_op_forwards(op, self.TABLE, real_model=True)

    def tearDown(self):
        _cleanup_tables(self.TABLE)
        super().tearDown()

    def _make_index(self, name="data_idx", fields=("data",)):
        from django.db.models import Index

        return Index(fields=list(fields), name=name)

    def test_removes_index_from_all_partitions(self):
        op = RemovePartitionIndex(model_name="FakeModel", name=self.index_name)
        _run_op_forwards(op, self.TABLE, real_model=True)

        for p in self.partitions:
            idx_name = _partition_index_name(p.name, self.index_name)
            assert idx_name not in _get_indexes(p.name)

    def test_remove_nonexistent_index_is_safe(self):
        """Removing an index that doesn't exist on partitions should not error."""
        op = RemovePartitionIndex(model_name="FakeModel", name="nonexistent_idx")
        _run_op_forwards(op, self.TABLE, real_model=True)

    def test_remove_with_partial_coverage(self):
        """If an index only exists on some partitions, removal still succeeds."""
        # Drop index from first partition manually, then remove all via operation
        first_idx = _partition_index_name(self.partitions[0].name, self.index_name)
        with connection.cursor() as cursor:
            cursor.execute(f"DROP INDEX IF EXISTS {first_idx}")

        op = RemovePartitionIndex(model_name="FakeModel", name=self.index_name)
        _run_op_forwards(op, self.TABLE, real_model=True)

        for p in self.partitions:
            idx_name = _partition_index_name(p.name, self.index_name)
            assert idx_name not in _get_indexes(p.name)


class OperationDeconstructTest(TestCase):
    """Tests for migration operation serialization."""

    def test_add_partition_deconstruct(self):
        partition = RangePartition(
            name="p_202401", from_values="'2024-01-01'", to_values="'2024-02-01'"
        )
        op = AddPartition(model_name="MyModel", partition=partition)
        name, _, kwargs = op.deconstruct()
        assert "AddPartition" in name
        assert kwargs["model_name"] == "MyModel"
        assert kwargs["partition"] == partition

    def test_remove_partition_deconstruct(self):
        partition = RangePartition(
            name="p_202401", from_values="'2024-01-01'", to_values="'2024-02-01'"
        )
        op = RemovePartition(model_name="MyModel", partition=partition)
        name, _, kwargs = op.deconstruct()
        assert "RemovePartition" in name
        assert kwargs["model_name"] == "MyModel"
        assert kwargs["partition"] == partition

    def test_add_partition_index_deconstruct(self):
        from django.db.models import Index

        index = Index(fields=["data"], name="data_idx")
        op = AddPartitionIndex(model_name="MyModel", index=index)
        name, _, kwargs = op.deconstruct()
        assert "AddPartitionIndex" in name
        assert kwargs["model_name"] == "MyModel"
        assert kwargs["index"] == index

    def test_remove_partition_index_deconstruct(self):
        op = RemovePartitionIndex(model_name="MyModel", name="data_idx")
        name, _, kwargs = op.deconstruct()
        assert "RemovePartitionIndex" in name
        assert kwargs["model_name"] == "MyModel"
        assert kwargs["name"] == "data_idx"

    def test_partition_index_name_truncation(self):
        name = _partition_index_name("very_long_partition_table_name", "very_long_index_name")
        assert len(name) <= 63
        assert _partition_index_name("p1", "idx1") == "p1_idx1"


class PartitionDataRoutingTest(TestCase):
    """Tests for data routing across partitions."""

    TABLE = "_test_routing"

    def tearDown(self):
        _cleanup_tables(self.TABLE)
        super().tearDown()

    def test_range_data_routes_to_correct_partition(self):
        partitions = _setup_range_table(self.TABLE, 2)

        with connection.cursor() as cursor:
            cursor.execute(
                f"INSERT INTO {self.TABLE} (date_added, data) VALUES ('2024-01-15', 'jan_data')"
            )
            cursor.execute(
                f"INSERT INTO {self.TABLE} (date_added, data) VALUES ('2024-02-15', 'feb_data')"
            )

            cursor.execute(f"SELECT data FROM {partitions[0].name}")
            assert [r[0] for r in cursor.fetchall()] == ["jan_data"]

            cursor.execute(f"SELECT data FROM {partitions[1].name}")
            assert [r[0] for r in cursor.fetchall()] == ["feb_data"]

            cursor.execute(f"SELECT data FROM {self.TABLE} ORDER BY date_added")
            assert [r[0] for r in cursor.fetchall()] == ["jan_data", "feb_data"]

    def test_insert_outside_partition_range_fails(self):
        from django.db import transaction

        _setup_range_table(self.TABLE, 1)

        with pytest.raises(Exception, match="no partition"):
            with transaction.atomic(using="default"):
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"INSERT INTO {self.TABLE} (date_added, data) "
                        f"VALUES ('2025-06-15', 'out_of_range')"
                    )

    def test_add_partition_then_insert(self):
        _setup_range_table(self.TABLE, 1)

        new_partition = RangePartition(
            name=f"{self.TABLE}_p_new", from_values="'2024-06-01'", to_values="'2024-07-01'"
        )
        _run_op_forwards(AddPartition(model_name="FakeModel", partition=new_partition), self.TABLE)

        with connection.cursor() as cursor:
            cursor.execute(
                f"INSERT INTO {self.TABLE} (date_added, data) VALUES ('2024-06-15', 'june_data')"
            )
            cursor.execute(f"SELECT data FROM {self.TABLE}_p_new")
            assert cursor.fetchone()[0] == "june_data"

    def test_detach_partition_preserves_data(self):
        partitions = _setup_range_table(self.TABLE, 2)

        with connection.cursor() as cursor:
            cursor.execute(
                f"INSERT INTO {self.TABLE} (date_added, data) VALUES ('2024-01-15', 'jan')"
            )
            cursor.execute(
                f"INSERT INTO {self.TABLE} (date_added, data) VALUES ('2024-02-15', 'feb')"
            )

        # Remove partition 0 via operation (detach + drop)
        op = RemovePartition(model_name="FakeModel", partition=partitions[0])
        _run_op_forwards(op, self.TABLE)

        # Parent no longer sees partition 0 data
        with connection.cursor() as cursor:
            cursor.execute(f"SELECT data FROM {self.TABLE}")
            assert [r[0] for r in cursor.fetchall()] == ["feb"]

        assert partitions[0].name not in get_partitions(connection, self.TABLE)
        assert partitions[1].name in get_partitions(connection, self.TABLE)

    def test_hash_partition_data_distribution(self):
        table = "_test_routing_hash"
        try:
            _create_parent_table(
                table, "HASH (id)", "id BIGSERIAL NOT NULL, data TEXT, PRIMARY KEY (id)"
            )

            hash_parts = [
                HashPartition(name=f"{table}_p{i}", modulus=4, remainder=i) for i in range(4)
            ]
            for hp in hash_parts:
                _run_op_forwards(AddPartition(model_name="FakeModel", partition=hp), table)

            assert len(get_partitions(connection, table)) == 4

            with connection.cursor() as cursor:
                for i in range(100):
                    cursor.execute(f"INSERT INTO {table} (data) VALUES ('item_{i}')")

                cursor.execute(f"SELECT COUNT(*) FROM {table}")
                assert cursor.fetchone()[0] == 100

                for hp in hash_parts:
                    cursor.execute(f"SELECT COUNT(*) FROM {hp.name}")
                    assert cursor.fetchone()[0] > 0
        finally:
            _cleanup_tables(table)

    def test_list_partition_data_routing(self):
        table = "_test_routing_list"
        try:
            _create_parent_table(
                table,
                "LIST (region)",
                "id BIGSERIAL NOT NULL, region TEXT NOT NULL, data TEXT, PRIMARY KEY (id, region)",
            )

            list_parts = [
                ListPartition(name=f"{table}_us", values=["us-east-1", "us-west-2"]),
                ListPartition(name=f"{table}_eu", values=["eu-west-1", "eu-central-1"]),
            ]
            for lp in list_parts:
                _run_op_forwards(AddPartition(model_name="FakeModel", partition=lp), table)

            with connection.cursor() as cursor:
                cursor.execute(
                    f"INSERT INTO {table} (region, data) VALUES ('us-east-1', 'us_data')"
                )
                cursor.execute(
                    f"INSERT INTO {table} (region, data) VALUES ('eu-west-1', 'eu_data')"
                )

                cursor.execute(f"SELECT data FROM {table}_us")
                assert cursor.fetchone()[0] == "us_data"

                cursor.execute(f"SELECT data FROM {table}_eu")
                assert cursor.fetchone()[0] == "eu_data"
        finally:
            _cleanup_tables(table)

    def test_end_to_end_partitions_data_indexes(self):
        """Full lifecycle: create partitions, insert data, add indexes, query."""
        partitions = _setup_range_table(self.TABLE, 2)

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
                    f"VALUES ('2024-02-{day:02d}', 'feb_{day}', {day % 5})"
                )

        # Add indexes via operation
        from django.db.models import Index

        index = Index(fields=["status"], name="status_idx")
        op = AddPartitionIndex(model_name="FakeModel", index=index)
        _run_op_forwards(op, self.TABLE, real_model=True)

        # Verify indexes on partitions
        for p in partitions:
            assert _partition_index_name(p.name, "status_idx") in _get_indexes(p.name)

        # Query benefits from index
        with connection.cursor() as cursor:
            cursor.execute(f"SELECT COUNT(*) FROM {self.TABLE} WHERE status = 0")
            assert cursor.fetchone()[0] > 0
