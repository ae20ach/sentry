#!/usr/bin/env python3
"""Aggregate per-shard failure artifacts, write a job summary, and upsert GitHub issues.

Called by the 'report' job after all shuffle-tests-across-shards matrix shards finish.
Each shard uploads a failure.json on failure; this script collects them all, deduplicates
by test node ID, writes a consolidated markdown summary, and creates or comments on issues.

Usage:
    python3 report_shuffle_failures.py [failures-dir]

Arguments:
    failures-dir  Directory containing failure-N/ subdirs each with a failure.json.
                  Defaults to ./failures.

Failure JSON schema:
    type            "flaky" | "pollution"
    testid          pytest node ID of the failing test
    sha             git SHA of the sentry commit under test
    run_url         URL of the GitHub Actions workflow run
    longrepr        (flaky only) pytest long traceback string
    polluting_testid  (pollution only) node ID of the test that caused pollution
    pollution_body  (pollution only) pre-formatted issue body text

Environment:
    GITHUB_STEP_SUMMARY  Path to the step summary file (set by GitHub Actions).
    GH_TOKEN             GitHub token (consumed by the gh CLI).
    GH_REPO              owner/repo (consumed by the gh CLI).
    RUN_URL              Workflow run URL for the summary header.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

MAX_TRACEBACK_LINES = 50


def load_failures(failures_dir: Path) -> list[dict]:
    """Find and parse all failure.json files under failures_dir."""
    if not failures_dir.is_dir():
        return []
    failures = []
    for path in sorted(failures_dir.rglob("failure.json")):
        try:
            data = json.loads(path.read_text())
        except Exception as e:
            print(f"WARNING: skipping {path}: {e}", file=sys.stderr)
            continue
        if "testid" not in data or "type" not in data:
            print(f"WARNING: skipping {path}: missing required fields", file=sys.stderr)
            continue
        failures.append(data)
    return failures


def deduplicate(failures: list[dict]) -> list[dict]:
    """Remove duplicate testids, keeping the first occurrence."""
    seen: set[str] = set()
    result = []
    for f in failures:
        if f["testid"] not in seen:
            seen.add(f["testid"])
            result.append(f)
    return result


def truncate_traceback(text: str, max_lines: int = MAX_TRACEBACK_LINES) -> str:
    lines = text.splitlines()
    if len(lines) <= max_lines:
        return text
    return "\n".join(lines[:max_lines]) + f"\n... ({len(lines) - max_lines} more lines)"


def build_summary(failures: list[dict], run_url: str) -> str:
    """Return a markdown string suitable for appending to GITHUB_STEP_SUMMARY."""
    flaky = [f for f in failures if f["type"] == "flaky"]
    pollution = [f for f in failures if f["type"] == "pollution"]

    lines: list[str] = [
        "## Shuffle Test Failures",
        "",
        f"Run: {run_url}",
        "",
    ]
    if flaky:
        lines.append(f"**{len(flaky)} flaky test(s)**")
    if pollution:
        lines.append(f"**{len(pollution)} test pollution case(s)**")
    lines.append("")

    for f in pollution:
        lines += [
            f"<details><summary><code>{f['testid']}</code>"
            f" — polluted by <code>{f['polluting_testid']}</code></summary>",
            "",
            f.get("pollution_body", ""),
            "",
            "</details>",
            "",
        ]

    for f in flaky:
        tb = truncate_traceback(f.get("longrepr") or "No traceback available")
        lines += [
            f"<details><summary><code>{f['testid']}</code></summary>",
            "",
            "```",
            tb,
            "```",
            "",
            "</details>",
            "",
        ]

    return "\n".join(lines)


def build_issue_body(failure: dict) -> str:
    if failure["type"] == "pollution":
        return failure.get("pollution_body", "")
    tb = failure.get("longrepr") or "no failure detail available"
    return (
        f"Failing test: `{failure['testid']}`\n"
        f"Sentry sha: {failure['sha']}\n"
        f"Run: {failure['run_url']}\n"
        f"\n"
        f"```\n{tb}\n```"
    )


def _gh(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["gh", *args], capture_output=True, text=True)


def find_existing_issue(label: str, title: str) -> int | None:
    """Return the issue number of an open issue with the exact title, or None."""
    r = _gh(
        "issue",
        "list",
        "--label",
        label,
        "--state",
        "open",
        "--search",
        f'"{title}" in:title',
        "--json",
        "number,title",
    )
    if r.returncode != 0 or not r.stdout.strip():
        return None
    try:
        for issue in json.loads(r.stdout):
            if issue.get("title") == title:
                return issue["number"]
    except (json.JSONDecodeError, KeyError):
        pass
    return None


def comment_on_issue(number: int, body: str) -> None:
    r = _gh("issue", "comment", str(number), "--body", body)
    if r.returncode != 0:
        print(
            f"WARNING: failed to comment on issue #{number}: {r.stderr.strip()}",
            file=sys.stderr,
        )


def create_issue(title: str, label: str, body: str) -> None:
    r = _gh("issue", "create", "--title", title, "--label", label, "--body", body)
    if r.returncode != 0:
        print(
            f"WARNING: failed to create issue '{title}': {r.stderr.strip()}",
            file=sys.stderr,
        )


def upsert_issue(failure: dict) -> None:
    is_flaky = failure["type"] == "flaky"
    label = "flaky-test" if is_flaky else "test-pollution"
    prefix = "Flaky test" if is_flaky else "Test pollution"
    title = f"{prefix}: {failure['testid']}"
    body = build_issue_body(failure)

    existing = find_existing_issue(label, title)
    if existing is not None:
        comment_on_issue(existing, body)
        print(f"Commented on issue #{existing}: {title}")
    else:
        create_issue(title, label, body)
        print(f"Created issue: {title}")


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    failures_dir = Path(args[0]) if args else Path("failures")

    raw = load_failures(failures_dir)
    if not raw:
        msg = "No failure artifacts found (job may have failed before tests ran).\n"
        summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary_path:
            with open(summary_path, "a") as fh:
                fh.write(msg)
        else:
            print(msg)
        return 0

    failures = deduplicate(raw)
    run_url = os.environ.get("RUN_URL", "")
    summary = build_summary(failures, run_url)

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a") as fh:
            fh.write(summary)
    else:
        print(summary)

    for failure in failures:
        upsert_issue(failure)

    return 0


if __name__ == "__main__":
    sys.exit(main())
