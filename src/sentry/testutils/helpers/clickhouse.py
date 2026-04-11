"""
Helpers for interacting with ClickHouse directly in tests.
"""

from __future__ import annotations

import os

import requests


def optimize_snuba_table(table: str) -> None:
    """Run ``OPTIMIZE TABLE <table> FINAL`` against ClickHouse.

    This forces ClickHouse's ReplacingMergeTree to immediately deduplicate rows
    rather than waiting for its background merge.  Useful in tests that need to
    assert on post-merge/post-delete event counts without spinning in a retry
    loop waiting for the background process to catch up.

    The ClickHouse HTTP API is available at localhost:8123 in both local dev
    (devservices exposes the container port) and CI (same pattern).  Override
    via CLICKHOUSE_HOST / CLICKHOUSE_HTTP_PORT environment variables if needed.
    """
    host = os.environ.get("CLICKHOUSE_HOST", "localhost")
    # bootstrap-snuba.py sets CLICKHOUSE_HTTP_PORT=8123; fall back to that default.
    port = int(os.environ.get("CLICKHOUSE_HTTP_PORT", "8123"))
    url = f"http://{host}:{port}"

    resp = requests.post(url, data=f"OPTIMIZE TABLE {table} FINAL", timeout=60)
    if resp.status_code != 200:
        raise RuntimeError(
            f"ClickHouse OPTIMIZE TABLE {table} FINAL failed ({resp.status_code}): {resp.text}"
        )
