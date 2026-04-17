from __future__ import annotations

import os
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, ClassVar

__all__ = (
    "HashPartition",
    "ListPartition",
    "PartitionConfig",
    "PartitionStrategy",
    "RangePartition",
    "get_partitioned_model_class",
    "is_partitioning_enabled",
)


class PartitionStrategy(Enum):
    RANGE = "RANGE"
    LIST = "LIST"
    HASH = "HASH"


@dataclass(frozen=True)
class PartitionConfig:
    """Configuration for how a table should be partitioned."""

    strategy: PartitionStrategy
    key: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.key:
            raise ValueError("PartitionConfig.key must contain at least one column name")

    def sql_clause(self, model: Any) -> str:
        """Generate the PARTITION BY SQL clause."""
        columns = ", ".join(self._resolve_column_names(model))
        return f"PARTITION BY {self.strategy.value} ({columns})"

    def _resolve_column_names(self, model: Any) -> list[str]:
        """Resolve model field names to database column names."""
        columns = []
        for field_name in self.key:
            try:
                model_field = model._meta.get_field(field_name)
                column = getattr(model_field, "column", None)
                columns.append(column if column else field_name)
            except Exception:
                columns.append(field_name)
        return columns


@dataclass(frozen=True)
class RangePartition:
    """Defines a RANGE partition with FROM/TO bounds."""

    name: str
    from_values: str
    to_values: str

    def sql_bound_clause(self) -> str:
        return f"FOR VALUES FROM ({self.from_values}) TO ({self.to_values})"


@dataclass(frozen=True)
class ListPartition:
    """Defines a LIST partition with explicit values."""

    name: str
    values: list[str | int] = field(default_factory=list)

    def sql_bound_clause(self) -> str:
        formatted = ", ".join(f"'{v}'" if isinstance(v, str) else str(v) for v in self.values)
        return f"FOR VALUES IN ({formatted})"


@dataclass(frozen=True)
class HashPartition:
    """Defines a HASH partition with modulus and remainder."""

    name: str
    modulus: int
    remainder: int

    def sql_bound_clause(self) -> str:
        return f"FOR VALUES WITH (MODULUS {self.modulus}, REMAINDER {self.remainder})"


# Union type for all partition kinds
Partition = RangePartition | ListPartition | HashPartition


def is_partitioning_enabled(model_or_table: Any) -> bool:
    """
    Check if partitioning is enabled for a given model in this environment.

    Controlled by the SENTRY_PARTITIONED_MODELS environment variable:
    - Empty or unset: partitioning disabled for all models (default)
    - "__all__": partitioning enabled for all models that define it
    - Comma-separated db_table names: enabled only for those models
    """
    env_value = os.environ.get("SENTRY_PARTITIONED_MODELS", "")
    if not env_value:
        return False
    if env_value == "__all__":
        return True
    enabled_tables = {t.strip() for t in env_value.split(",")}
    if isinstance(model_or_table, str):
        table_name = model_or_table
    else:
        table_name = model_or_table._meta.db_table
    return table_name in enabled_tables


def _get_partitioned_model_base():
    """Lazy import to avoid circular dependency with sentry.db.models.base."""
    from sentry.db.models.base import Model

    class PartitionedModel(Model):
        """
        Abstract base for models backed by PostgreSQL partitioned tables.

        Subclasses must define a `partitioning` class variable:

            class MyModel(PartitionedModel):
                partitioning = PartitionConfig(
                    strategy=PartitionStrategy.RANGE,
                    key=["date_added"],
                )
                ...
        """

        partitioning: ClassVar[PartitionConfig]

        class Meta:
            abstract = True

    return PartitionedModel


# Lazily initialized on first access
_PartitionedModel: type | None = None


def get_partitioned_model_class():
    """Get the PartitionedModel base class, creating it on first access."""
    global _PartitionedModel
    if _PartitionedModel is None:
        _PartitionedModel = _get_partitioned_model_base()
    return _PartitionedModel


def get_partitions(connection, parent_table: str) -> list[str]:
    """
    Discover all child partition table names for a given parent table
    by querying pg_inherits.
    """
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT c.relname
            FROM pg_inherits i
            JOIN pg_class c ON c.oid = i.inhrelid
            JOIN pg_class p ON p.oid = i.inhparent
            JOIN pg_namespace n ON n.oid = p.relnamespace
            WHERE p.relname = %s AND n.nspname = 'public'
            ORDER BY c.relname
            """,
            [parent_table],
        )
        return [row[0] for row in cursor.fetchall()]
