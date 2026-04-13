from __future__ import annotations

import logging
from collections.abc import Callable
from functools import wraps
from typing import Any, Iterator

from google.protobuf.timestamp_pb2 import Timestamp
from sentry_protos.snuba.v1.endpoint_trace_items_pb2 import ExportTraceItemsResponse
from sentry_protos.snuba.v1.request_common_pb2 import TraceItemType
from sentry_protos.snuba.v1.trace_item_pb2 import AnyValue, TraceItem
from sentry.data_export.base import ExportError
from sentry.search.eap.types import SupportedTraceItemType
from sentry.search.eap.utils import can_expose_attribute
from sentry.search.events.constants import TIMEOUT_ERROR_MESSAGE
from sentry.snuba import discover
from sentry.utils import metrics, snuba
from sentry.utils.sdk import capture_exception
from sentry.utils.snuba_rpc import SnubaRPCRateLimitExceeded


TRACE_ITEM_EXPORT_TOP_LEVEL_PUBLIC_KEYS: dict[str, str] = {
    "organization_id": "organization.id",
    "project_id": "project.id",
    "trace_id": "trace",
    "item_id": "id",
}

# Adapted into decorator from 'src/sentry/api/endpoints/organization_events.py'
def handle_snuba_errors(
    logger: logging.Logger,
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    def wrapper(func: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(func)
        def wrapped(*args: Any, **kwargs: Any) -> Any:
            try:
                return func(*args, **kwargs)
            except discover.InvalidSearchQuery as error:
                metrics.incr("dataexport.error", tags={"error": str(error)}, sample_rate=1.0)
                logger.warning("dataexport.error: %s", str(error))
                capture_exception(error)
                raise ExportError("Invalid query. Please fix the query and try again.")
            except snuba.QueryOutsideRetentionError as error:
                metrics.incr("dataexport.error", tags={"error": str(error)}, sample_rate=1.0)
                logger.warning("dataexport.error: %s", str(error))
                capture_exception(error)
                raise ExportError("Invalid date range. Please try a more recent date range.")
            except snuba.QueryIllegalTypeOfArgument as error:
                metrics.incr("dataexport.error", tags={"error": str(error)}, sample_rate=1.0)
                logger.warning("dataexport.error: %s", str(error))
                capture_exception(error)
                raise ExportError("Invalid query. Argument to function is wrong type.")
            except snuba.SnubaError as error:
                metrics.incr("dataexport.error", tags={"error": str(error)}, sample_rate=1.0)
                logger.warning("dataexport.error: %s", str(error))
                capture_exception(error)
                message = "Internal error. Please try again."
                recoverable = False
                delay_retry = False
                if isinstance(
                    error,
                    (
                        snuba.RateLimitExceeded,
                        snuba.QueryMemoryLimitExceeded,
                        snuba.QueryExecutionTimeMaximum,
                        snuba.QueryTooManySimultaneous,
                        SnubaRPCRateLimitExceeded,
                    ),
                ):
                    message = TIMEOUT_ERROR_MESSAGE
                    recoverable = True

                    if isinstance(
                        error,
                        (
                            snuba.RateLimitExceeded,
                            snuba.QueryTooManySimultaneous,
                            SnubaRPCRateLimitExceeded,
                        ),
                    ):
                        delay_retry = True
                elif isinstance(
                    error,
                    (
                        snuba.DatasetSelectionError,
                        snuba.QueryConnectionFailed,
                        snuba.QuerySizeExceeded,
                        snuba.QueryExecutionError,
                        snuba.SchemaValidationError,
                        snuba.UnqualifiedQueryError,
                    ),
                ):
                    message = "Internal error. Your query failed to run."
                raise ExportError(message, recoverable=recoverable, delay_retry=delay_retry)

        return wrapped

    return wrapper


def anyvalue_to_python(av: AnyValue) -> Any:
    which = av.WhichOneof("value")
    if which is None:
        return None
    val = getattr(av, which)
    if which == "array_value":
        return [anyvalue_to_python(x) for x in val.values]
    if which == "kvlist_value":
        return {kv.key: anyvalue_to_python(kv.value) for kv in val.values}
    return val


def _ts_to_epoch(ts: Timestamp) -> float:
    return ts.seconds + ts.nanos / 1e9


def apply_public_names_to_trace_export_row(
    row: dict[str, Any],
    *,
    rename_map: dict[str, str],
    item_type: SupportedTraceItemType,
) -> dict[str, Any]:
    """
    Rename known internal columns to EAP public aliases, keep extra/user attributes that are
    exposable, and drop private or internal-only keys.
    """
    ordered_keys = [
        *[k for k in TRACE_ITEM_EXPORT_TOP_LEVEL_PUBLIC_KEYS if k in row],
        *[k for k in row if k not in TRACE_ITEM_EXPORT_TOP_LEVEL_PUBLIC_KEYS],
    ]

    out: dict[str, Any] = {}
    for key in ordered_keys:
        value = row[key]
        if key in TRACE_ITEM_EXPORT_TOP_LEVEL_PUBLIC_KEYS:
            new_key = TRACE_ITEM_EXPORT_TOP_LEVEL_PUBLIC_KEYS[key]
        elif key in rename_map:
            new_key = rename_map[key]
        else:
            if not can_expose_attribute(key, item_type, include_internal=False):
                continue
            new_key = key
        if new_key not in out:
            out[new_key] = value
        elif out[new_key] is None and value is not None:
            out[new_key] = value
    return out


def trace_item_to_row(
    item: TraceItem,
    *,
    rename_mapping: dict[str, str],
    item_type: SupportedTraceItemType,
) -> dict[str, Any]:
    row: dict[str, Any] = {}
    for key, av in item.attributes.items():
        row[key] = None if av.WhichOneof("value") is None else anyvalue_to_python(av)
    row["organization_id"] = item.organization_id
    row["project_id"] = item.project_id
    row["trace_id"] = item.trace_id
    row["item_id"] = item.item_id.hex() if item.item_id else None
    row["item_type"] = TraceItemType.Name(item.item_type)
    if item.HasField("timestamp"):
        row["timestamp"] = _ts_to_epoch(item.timestamp)
    if item.HasField("received"):
        row["received"] = _ts_to_epoch(item.received)
    row["client_sample_rate"] = item.client_sample_rate
    row["server_sample_rate"] = item.server_sample_rate
    row["retention_days"] = item.retention_days
    row["downsampled_retention_days"] = item.downsampled_retention_days
    return apply_public_names_to_trace_export_row(
        row, rename_map=rename_mapping, item_type=item_type
    )


def iter_export_trace_items_rows(
    resp: ExportTraceItemsResponse,
    rename_mapping: dict[str, str],
    item_type: SupportedTraceItemType,
) -> Iterator[dict[str, Any]]:
    for item in resp.trace_items:
        yield trace_item_to_row(item, rename_mapping=rename_mapping, item_type=item_type)
