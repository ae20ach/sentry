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
        # Aggregation fields — legacy routes these to HAVING clauses.
        # Not EAP attributes; would silently become tag lookups.
        "times_seen",
        "last_seen",
        "user_count",
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
TRANSLATE_KEYS: dict[str, str] = {
    "error.main_thread": "exception_main_thread",
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
