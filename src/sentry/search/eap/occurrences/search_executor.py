import logging
from collections.abc import Sequence
from datetime import datetime

from sentry.api.event_search import SearchFilter
from sentry.utils import metrics

logger = logging.getLogger(__name__)


# Filters that must be skipped because they have no EAP equivalent.
# These would silently become dynamic tag lookups in the EAP SearchResolver
# (resolver.py:1026-1060) and produce incorrect results.
SKIP_FILTERS: frozenset[str] = frozenset(
    {
        # event.type is added internally by _query_params_for_error(), not from user filters.
        # EAP occurrences don't use event.type — they're pre-typed.
        "event.type",
        # Require Postgres Release table lookups (semver matching, stage resolution).
        "release.stage",
        "release.version",
        "release.package",
        "release.build",
        # Virtual alias that expands to coalesce(user.email, user.username, ...).
        # No EAP equivalent.
        "user.display",
        # Requires team context lookup.
        "team_key_transaction",
        # Requires Snuba-specific status code translation.
        "transaction.status",
    }
)

# Filters that need key name translation from legacy Snuba names to EAP attribute names.
# TODO: instead of translating this key, maybe we should just set the public alias for this attribute to "error.main_thread"?
TRANSLATE_KEYS: dict[str, str] = {
    "error.main_thread": "exception_main_thread",
}

# Legacy aggregation field names → EAP aggregate function syntax.
# In the legacy path these become HAVING clauses (e.g. times_seen:>100 → HAVING count() > 100).
# The EAP SearchResolver parses function syntax like count():>100 as AggregateFilter objects
# and routes them to the aggregation_filter field on the RPC request.
AGGREGATION_FIELD_TO_EAP_FUNCTION: dict[str, str] = {
    "times_seen": "count()",
    "last_seen": "last_seen()",
    "user_count": "count_unique(user.id)",
}


def search_filters_to_query_string(
    search_filters: Sequence[SearchFilter],
) -> str:
    """Convert Snuba-relevant SearchFilter objects to an EAP query string.

    Expects filters that have already been stripped of postgres-only fields
    (status, assigned_to, bookmarked_by, etc.) by the caller.

    Returns a query string like: 'level:error platform:python message:"foo bar"'
    compatible with the EAP SearchResolver's parse_search_query().
    """
    parts: list[str] = []
    for sf in search_filters:
        part = _convert_single_filter(sf)
        if part is not None:
            parts.append(part)
    return " ".join(parts)


def _convert_single_filter(sf: SearchFilter) -> str | None:
    key = sf.key.name
    op = sf.operator
    raw_value = sf.value.raw_value

    if key in AGGREGATION_FIELD_TO_EAP_FUNCTION:
        return _convert_aggregation_filter(sf)

    if key in SKIP_FILTERS:
        metrics.incr(
            "eap.search_executor.filter_skipped",
            tags={"key": key},
        )
        return None

    # error.unhandled requires special inversion logic.
    # Legacy uses notHandled() Snuba function; EAP has error.handled attribute.
    if key == "error.unhandled":
        return _convert_error_unhandled(sf)

    if key in TRANSLATE_KEYS:
        key = TRANSLATE_KEYS[key]

    # has / !has filters: empty string value with = or !=
    if raw_value == "" and op in ("=", "!="):
        if op == "!=":
            return f"has:{key}"
        else:
            return f"!has:{key}"

    formatted_value = _format_value(raw_value)

    if op == "=":
        return f"{key}:{formatted_value}"
    elif op == "!=":
        return f"!{key}:{formatted_value}"
    elif op in (">", ">=", "<", "<="):
        return f"{key}:{op}{formatted_value}"
    elif op == "IN":
        return f"{key}:{formatted_value}"
    elif op == "NOT IN":
        return f"!{key}:{formatted_value}"

    logger.warning(
        "eap.search_executor.unknown_operator",
        extra={"key": key, "operator": op},
    )
    return None


def _convert_error_unhandled(sf: SearchFilter) -> str | None:
    """Convert error.unhandled filter to the EAP error.handled attribute.

    error.unhandled:1 (or true)  → !error.handled:1
    error.unhandled:0 (or false) → error.handled:1
    !error.unhandled:1           → error.handled:1
    """
    raw_value = sf.value.raw_value
    op = sf.operator

    # Determine if the user is looking for unhandled errors
    is_looking_for_unhandled = (op == "=" and raw_value in ("1", 1, True, "true")) or (
        op == "!=" and raw_value in ("0", 0, False, "false")
    )

    if is_looking_for_unhandled:
        return "!error.handled:1"
    else:
        return "error.handled:1"


def _convert_aggregation_filter(sf: SearchFilter) -> str | None:
    """Convert a legacy aggregation field filter to EAP function syntax.

    e.g. times_seen:>100 → count():>100
         last_seen:>2024-01-01 → last_seen():>2024-01-01T00:00:00+00:00
         user_count:>5 → count_unique(user.id):>5
    """
    eap_function = AGGREGATION_FIELD_TO_EAP_FUNCTION[sf.key.name]
    formatted_value = _format_value(sf.value.raw_value)

    if sf.operator in (">", ">=", "<", "<="):
        return f"{eap_function}:{sf.operator}{formatted_value}"
    elif sf.operator == "=":
        return f"{eap_function}:{formatted_value}"
    elif sf.operator == "!=":
        return f"!{eap_function}:{formatted_value}"

    return None


def _format_value(
    raw_value: str | int | float | datetime | Sequence[str] | Sequence[float],
) -> str:
    if isinstance(raw_value, (list, tuple)):
        parts = ", ".join(_format_single_value(v) for v in raw_value)
        return f"[{parts}]"
    if isinstance(raw_value, datetime):
        return raw_value.isoformat()
    if isinstance(raw_value, (int, float)):
        return str(raw_value)
    return _format_string_value(str(raw_value))


def _format_single_value(value: str | int | float | datetime) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, (int, float)):
        return str(value)
    return _format_string_value(str(value))


def _format_string_value(s: str) -> str:
    # Wildcard values pass through as-is for the SearchResolver to handle
    if "*" in s:
        return s

    # Quote strings containing spaces or special characters
    if " " in s or '"' in s or "," in s or "(" in s or ")" in s:
        escaped = s.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'

    return s
