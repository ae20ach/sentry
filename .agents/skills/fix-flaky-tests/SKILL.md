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

| Test                                                                                                                                | Symptom                                                                                                         | Notes                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/snuba/api/endpoints/test_organization_events_stats.py::OrganizationEventsStatsEndpointTest::test_simple`                     | `CrossTransactionAssertionError: Transaction opened for db {'default'}, but command running against db control` | Order-dependent; `simulated_transaction_watermarks` state leaks from a prior test. The fixture resets it correctly on paper — root cause unclear without reproduction.                                                                                                                                                                               |
| `tests/sentry/web/frontend/test_auth_oauth2.py::AuthOAuth2Test::test_oauth2_flow_customer_domain`                                   | `assert '/auth/login/' == 'http://albertos-apples.testserver/auth/login/'`                                      | OAuth pipeline state (subdomain) stored in Redis via `PipelineSessionStore`; a concurrent xdist `flushdb()` between `initiate_oauth_flow` POST and `initiate_callback` GET clears it. Fix requires storing subdomain in the Django session (DB) as a fallback — production code change.                                                              |
| `tests/sentry/integrations/github_enterprise/test_integration.py::GitHubEnterpriseIntegrationTest::test_update_organization_config` | `TypeError: 'NoneType' object is not subscriptable` in `build_integration(self.state.data)`                     | Multi-step OAuth flow in `assert_setup_flow` makes 4+ HTTP requests. The `_callTestMethod` guard protects the setUp→body gap, but `flushdb()` from a concurrent xdist worker can clear the pipeline Redis state mid-flow (between requests 3 and 4). Fix requires per-pipeline-request state persistence in the DB session — production code change. |
