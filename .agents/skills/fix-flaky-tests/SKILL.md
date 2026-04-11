---
name: fix-flaky-tests
description: Fix flaky tests identified by the shuffle-tests-across-shards workflow. Takes a GitHub Actions run URL, downloads per-shard failure artifacts, and fixes each flaky test with an individual commit. Use when given a shuffle-tests run URL, asked to "fix flaky tests", or working from a list of test node IDs with tracebacks.
---

# Fix Flaky Tests

## 1. Extract failures

```bash
RUN_ID=<id from URL>
mkdir -p /tmp/shuffle-failures
gh run download "$RUN_ID" --repo getsentry/sentry --pattern "failure-*" --dir /tmp/shuffle-failures/
python3 -c "
import json, pathlib
for p in sorted(pathlib.Path('/tmp/shuffle-failures').rglob('failure.json')):
    d = json.loads(p.read_text())
    print(f'[{d[\"type\"]}] {d[\"testid\"]}')
    print('  ' + d.get('longrepr','')[-300:])
"
```

If no URL: `gh run list --repo getsentry/sentry --workflow shuffle-tests-across-shards.yml --limit 5`

If artifacts expired: `gh run view "$RUN_ID" --repo getsentry/sentry --log | grep -A2 "Created issue\|Commented on"`

**Only fix `type: "flaky"`.** Route `type: "pollution"` to the `fix-test-pollution` skill.

## 2. Triage each failure

Read the test file and the full `longrepr` traceback. Use `references/common-patterns.md` to classify. You must be able to state: _"This fails because X."_

**Skip and note** if: fix requires production code changes, root cause is unclear, test needs real network/external services.

## 3. Fix, verify, commit — one test at a time

**Verification is mandatory before every commit. Do not skip it.**

```bash
.venv/bin/pytest -xvs "<testid>" --reuse-db          # MUST pass — stop if it doesn't
.venv/bin/pytest -xvs "<test_file>" --reuse-db        # MUST pass — no regressions
.venv/bin/pre-commit run --files <changed_files>      # fix lint before committing
```

If the isolated test passes but the module run fails, your fix introduced a regression — revert and rethink before committing.

Commit with the `commit` skill, type `test`:

```
test(<module>): Fix flaky <TestClass>::<test_method>

<why it was flaky> / <what the fix does>
```

## 4. Report

- **Fixed**: node ID + root cause + commit SHA
- **Skipped**: node ID + reason
- **Pollution**: list for `fix-test-pollution`

## TODO — Known Unfixed Flakes

Keep this list updated. Add entries when a test is skipped with no fix; remove when fixed.

| Test                                                                                                            | Symptom                                                                                                         | Notes                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/snuba/api/endpoints/test_organization_events_stats.py::OrganizationEventsStatsEndpointTest::test_simple` | `CrossTransactionAssertionError: Transaction opened for db {'default'}, but command running against db control` | Order-dependent; `simulated_transaction_watermarks` state leaks from a prior test. The fixture resets it correctly on paper — root cause unclear without reproduction. Debug instrumentation added to the test to capture watermark state on failure.                                         |
| `tests/sentry/conduit/test_tasks.py::StreamDemoDataTest::test_stream_demo_data_sends_all_phases`                | `assert mock_sleep.call_count == NUM_DELTAS` fails with `1274 == 100`                                           | The sleep count is ≈12× `NUM_DELTAS`. Seen once — likely a prior test left a non-cleaned-up patch of `sentry.conduit.tasks.time.sleep`, or a background thread accumulated calls. Mock patches `sentry.conduit.tasks.time.sleep` — check if any concurrent test also patches the same symbol. |
| `tests/sentry/core/endpoints/test_organization_index.py::OrganizationsCreateTest::test_data_consent`            | HTTP 500 response instead of 2xx                                                                                | Single occurrence. Likely a DB constraint or unhandled exception triggered by order-dependent state from a prior test. Check for missing teardown of org/user fixtures.                                                                                                                       |
| `tests/sentry/sentry_metrics/test_all_indexers.py::test_rate_limited[UseCaseID.SESSIONS-PGStringIndexerV2]`     | `{'z': 4} != {'z': None}` — string `z` indexed when it should be rate-limited                                   | Redis `flushdb()` clears the rate limiter counter between the first and second `bulk_record` call, allowing `z` to be indexed (rate limit resets). Fix: use a unique Redis key prefix per test run, or increase the rate limit window so one flushdb cannot reset it within the test.         |
| `tests/sentry/preprod/api/endpoints/test_builds.py::BuildsEndpointTest::test_free_text_search_by_build_id`      | `assert 2 == 1` — returns 2 builds matching search when only 1 expected                                         | Test pollution: another test's build record visible in the same DB transaction scope. Look for test class using `TransactionTestCase` (no rollback) or a missing `flush=False` on outbox.                                                                                                     |
