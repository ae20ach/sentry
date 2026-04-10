---
name: fix-flaky-tests
description: Fix flaky tests identified by the shuffle-tests-across-shards workflow. Takes a GitHub Actions run URL, downloads per-shard failure artifacts, and fixes each flaky test with an individual commit. Use when given a shuffle-tests run URL, asked to "fix flaky tests", or working from a list of test node IDs with tracebacks.
---

# Fix Flaky Tests from Shuffle Run

## Input

A GitHub Actions run URL from the shuffle-tests-across-shards workflow:
`https://github.com/getsentry/sentry/actions/runs/<RUN_ID>`

If no URL is given, check for a recent run:
```bash
gh run list --repo getsentry/sentry --workflow shuffle-tests-across-shards.yml --limit 5
```

## Phase 1: Extract Failures

Parse the run ID from the URL. Download all per-shard failure artifacts:

```bash
RUN_ID=<id>
mkdir -p /tmp/shuffle-failures
gh run download "$RUN_ID" --repo getsentry/sentry --pattern "failure-*" --dir /tmp/shuffle-failures/
```

Read each artifact and collect failures:

```bash
python3 - <<'EOF'
import json, pathlib, sys
failures = []
for p in sorted(pathlib.Path("/tmp/shuffle-failures").rglob("failure.json")):
    d = json.loads(p.read_text())
    failures.append(d)
    print(f"[{d['type']}] {d['testid']}")
EOF
```

**Focus only on `type: "flaky"` entries.** Entries with `type: "pollution"` need the `fix-test-pollution` skill instead — note them and skip.

If artifact download fails (run too old, artifacts expired), fall back to reading the "Report failures" job log:
```bash
gh run view "$RUN_ID" --repo getsentry/sentry --log | grep -A2 "Created issue\|Commented on"
```

## Phase 2: Triage Each Failure

For each flaky test, before touching anything:

1. **Read the test** — open the full test file, understand what it is testing.
2. **Read the traceback** — the `longrepr` field contains the full pytest output. Identify the exact failing assertion or exception and the line it occurs on.
3. **Classify the root cause** using `references/common-patterns.md`.
4. **State your diagnosis** — you must be able to say: "This fails because X." If you cannot, look harder before attempting a fix.

**Skip and note** the test if:
- The fix requires changing production code (open a separate issue instead).
- The root cause cannot be determined from the traceback and test alone.
- The test is inherently environment-dependent (e.g., requires real network I/O, external service).

## Phase 3: Fix and Commit Each Test

Fix **one test at a time**. After each fix:

### Verify

```bash
# Run the failing test in isolation
.venv/bin/pytest -xvs "<testid>" --reuse-db

# Run the full test class/module to catch regressions
.venv/bin/pytest -xvs "<test_file>" --reuse-db
```

If the test passes in isolation but the fix doesn't address the root cause, reconsider — isolation passing is necessary but not sufficient for a shuffle-detected flake.

### Pre-commit lint

```bash
.venv/bin/pre-commit run --files <changed_files>
```

Fix any lint errors before committing.

### Commit

Use the `commit` skill. Each fix is its own commit with type `test`:

```
test(<module>): Fix flaky <TestClass>::<test_method>

<What made it flaky — e.g., "relied on real clock", "assumed queryset
ordering", "expected celery task to run synchronously">

<What the fix does — e.g., "Freeze time with time_machine.travel()",
"add .order_by() to queryset", "wrap assertion in self.tasks()">
```

Do not batch multiple test fixes into one commit.

## Phase 4: Summary

After processing all failures, report:
- **Fixed**: test node ID + one-line description of the flake + commit SHA
- **Skipped**: test node ID + reason (production change needed / unclear cause / environment-dependent)
- **Pollution cases**: list of `type: "pollution"` entries to address separately
