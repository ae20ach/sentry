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

Read the test file and the full `longrepr` traceback. Use `references/common-patterns.md` to classify. You must be able to state: *"This fails because X."*

**Skip and note** if: fix requires production code changes, root cause is unclear, test needs real network/external services.

## 3. Fix, verify, commit — one test at a time

```bash
.venv/bin/pytest -xvs "<testid>" --reuse-db          # must pass
.venv/bin/pytest -xvs "<test_file>" --reuse-db        # no regressions
.venv/bin/pre-commit run --files <changed_files>
```

Commit with the `commit` skill, type `test`:
```
test(<module>): Fix flaky <TestClass>::<test_method>

<why it was flaky> / <what the fix does>
```

## 4. Report

- **Fixed**: node ID + root cause + commit SHA
- **Skipped**: node ID + reason
- **Pollution**: list for `fix-test-pollution`
