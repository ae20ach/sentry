# Common Flakiness Patterns in Sentry Tests

## 1. Time-Dependent Tests

**Symptoms:** Off-by-one-second/minute assertions, `datetime.now()` comparisons, scheduled time calculations that differ between test runs.

**Diagnosis:** Traceback shows a datetime comparison where expected and actual differ by a small amount (1 second, 1 minute, etc.), or the test passes when run quickly but fails when the system is slow.

**Fix:** Freeze time with `time_machine`:

```python
import time_machine

@time_machine.travel("2024-01-15 12:00:00+00:00", tick=False)
def test_something(self):
    ...

# or as a context manager
def test_something(self):
    with time_machine.travel("2024-01-15 12:00:00+00:00", tick=False):
        ...
```

Use `tick=False` (default) to freeze time completely. Use `tick=True` only if the test requires time to advance. Choose an arbitrary fixed timestamp that doesn't coincide with DST transitions or year boundaries.

`freeze_time` (from `freezegun`) is the older pattern — prefer `time_machine` for new fixes as it's faster and supports more stdlib paths.

---

## 2. Unordered Queryset Assumptions

**Symptoms:** `assert result[0].foo == "expected"` fails intermittently because the queryset returns rows in different order.

**Diagnosis:** Test accesses a specific index of a queryset or list result without enforcing ordering.

**Fix — option A:** Add `.order_by()` to the queryset in the test:
```python
result = MyModel.objects.filter(...).order_by("id")
assert result[0].foo == "expected"
```

**Fix — option B:** If ordering is irrelevant, use `assertCountEqual` or a set comparison:
```python
self.assertCountEqual(
    [r.foo for r in result],
    ["expected_a", "expected_b"],
)
```

**Fix — option C:** If testing that a specific object is present, filter for it directly:
```python
assert MyModel.objects.filter(foo="expected").exists()
```

---

## 3. Celery / Background Task Timing

**Symptoms:** `assert count == 0` after triggering a deletion or async operation, but the count is still non-zero. Or an object that should be created/updated after an async operation isn't there yet.

**Diagnosis:** The test triggers an action that spawns a Celery task but doesn't wait for it to complete.

**Fix:** Wrap the triggering call in `self.tasks()` to execute tasks synchronously inline:

```python
with self.tasks():
    response = self.client.post(url, data)

# Now assert post-task state
assert MyModel.objects.count() == 0
```

Or for lower-level task calls, use `.apply()` instead of `.delay()` / `.apply_async()` in the test.

If tasks are triggered by signals (e.g., post_delete), make sure `self.tasks()` wraps the model operation that fires the signal.

---

## 4. Missing Database Cleanup / Test Isolation

**Symptoms:** Count-based assertions fail (`assert count == 1` but got 2), unique constraint errors on insert, objects present that should have been deleted.

**Diagnosis:** A previous test in the session left rows in the database that weren't cleaned up. Look for `TransactionTestCase` mixing with regular `TestCase`, or tests that use `bulk_create` without cleanup.

**Fix — in the flaky test:** Add `setUp`/`tearDown` cleanup, or use `@pytest.fixture(autouse=True)` with `yield` + cleanup:

```python
def setUp(self):
    super().setUp()
    MyModel.objects.filter(org=self.organization).delete()
```

**Fix — prefer fixtures:** If the test is creating shared state without proper scoping, switch to `TestCase.setUp` / Django's `@isolate_apps` / `APITestCase` which wraps each test in a transaction.

**Note:** If many tests are contaminating this one, this is test pollution — use the `fix-test-pollution` skill instead.

---

## 5. External Service / Snuba Timing

**Symptoms:** `HTTPConnectionPool: Max retries exceeded`, `SnubaError`, connection refused on port 1218/1219/etc.

**Diagnosis:** Test makes a real HTTP call to Snuba (or another service) that is flaky in CI.

**Fix:** Mock the Snuba call at the right layer. In Sentry, Snuba queries go through `sentry.utils.snuba`:

```python
from unittest.mock import patch

with patch("sentry.utils.snuba.raw_query") as mock_query:
    mock_query.return_value = {"data": [...], "meta": [...]}
    # test code
```

Or use existing test helpers:
```python
# For EAP/spans queries
with self.feature("organizations:performance-use-metrics"):
    ...
```

Check if there's an existing `@override_settings(SENTRY_SNUBA_MOCK=True)` or similar.

---

## 6. Async Iterator / Streaming Response Timing

**Symptoms:** `assert len(rows) == 3` but got 2, or assertions on streaming/paginated results fail intermittently.

**Diagnosis:** The test reads from an async generator or streaming response that may not have flushed all data.

**Fix:** Consume the full iterator explicitly before asserting:

```python
rows = list(response.streaming_content)  # consume fully
assert len(rows) == 3
```

Or wait for all background writes to complete before reading.

---

## 7. `assert X != Y` Where X == Y (Race / Stale Cache)

**Symptoms:** Assertion `assert actual != expected` fails when both values are equal — the "changed" value wasn't actually changed.

**Diagnosis:** Test checks that a value changed (e.g., counter incremented, status updated) but the update didn't propagate by the time the assertion runs. Common with cache invalidation, signals, or ORM objects fetched before an update.

**Fix:** Refresh the object from the database before asserting:

```python
obj.refresh_from_db()
assert obj.count == expected_new_count
```

Or explicitly invalidate caches if the test is checking a cached value:

```python
cache.clear()
# then re-fetch
```

---

## 8. Floating Point / Imprecise Numeric Comparisons

**Symptoms:** `assert 0.1 + 0.2 == 0.3` style failures, or timestamp comparisons that differ by microseconds.

**Fix:** Use `pytest.approx` or `assertAlmostEqual`:

```python
assert result == pytest.approx(expected, abs=1e-6)
# or
self.assertAlmostEqual(result, expected, places=5)
```

For datetime comparisons that should be "roughly equal", compare with a tolerance:

```python
assert abs((result - expected).total_seconds()) < 1
```

---

## 9. Snuba Data Cross-Test Contamination

**Symptoms:** Count or content assertions on Snuba queries fail when tests run concurrently or in a shuffled order — e.g. `assert len(result["data"]) == 2` gets 3 or 4.

**Diagnosis:** The test queries `self.project` which accumulates Snuba data written by other tests in the same session. Because Snuba data is not rolled back between tests (unlike DB rows inside transactions), any test that stores events in `self.project` contaminates queries made by later tests.

**Fix A — dedicated project:** Create a fresh project inside the test and use it for all stores and queries:

```python
def test_something(self):
    project = self.create_project(organization=self.organization)
    self.store_event(data=..., project_id=project.id)

    result = query_snuba(project_ids=[project.id], ...)
    assert len(result) == 1
```

**Fix B — tight query window:** Center the query window on the event timestamp instead of using a broad absolute window. This prevents events from other tests stored at different `before_now()` offsets from leaking in:

```python
event_time = before_now(hours=4)
self.store_event(data={..., "timestamp": event_time}, project_id=project.id)

result = query_snuba(
    start=event_time - timedelta(minutes=2),
    end=event_time + timedelta(minutes=2),
)
```

Use `hours=4` (or any value well outside what other tests use) to prevent overlap with the common `before_now(minutes=N)` range.

---

## 10. Expired Snuba / ClickHouse Retention Window

**Symptoms:** `IndexError: list index out of range`, `assert len(rows) == N` with fewer rows, `KeyError` on a key that should be present — all from queries that look correct.

**Diagnosis:** The test uses a hardcoded timestamp from a year or more ago. ClickHouse/Snuba has a retention window (typically 90 days for EAP, longer for some datasets). Data stored with old timestamps is purged before the test runs.

Look for:
- `datetime(year=2025, ...)` or similar hardcoded dates in function bodies
- `@freeze_time("2025-...")` at class/method level where the frozen date is now old
- `retention_days=90` on EAP item creation

**Fix:** Replace hardcoded old dates with relative ones. For event timestamps inside a test body:
```python
# Before
t0 = datetime.datetime(year=2025, month=1, day=1)

# After
t0 = datetime.datetime.utcnow().replace(second=0, microsecond=0) - datetime.timedelta(hours=1)
```

For `@freeze_time` decorators, use a module-level constant so the frozen date stays recent:
```python
from sentry.testutils.helpers.datetime import before_now, freeze_time

_FROZEN_NOW = before_now(days=1).replace(hour=0, minute=0, second=0, microsecond=0)

class MyTest(...):
    @freeze_time(_FROZEN_NOW)
    def test_something(self):
        ...
```

If the class already has a `MOCK_DATETIME = datetime.now(tz=timezone.utc) - timedelta(days=1)`, derive test timestamps from it:
```python
base_time = MOCK_DATETIME.replace(hour=13, minute=30, second=0, microsecond=0)
```

---

## 11. Global State Leaked Through Override / Teardown Gap

**Symptoms:** Tests pass individually but fail in sequence. The failing test makes assertions about some global registry, cache, or option that was mutated and not restored by a previous test.

**Diagnosis:** `override_settings` restores Django's `CACHES` dict but does **not** restore object references that were set from it (e.g. `default_store.cache` pointing to a now-stale `ConnectionProxy`). Similarly, `options.set(...)` in a test body without cleanup leaves the option set for subsequent tests.

**Fix A — try/finally cleanup for in-test mutations:**
```python
response = self.client.put(self.url, {"auth.allow-registration": 1})
try:
    assert response.status_code == 200
finally:
    options.delete("auth.allow-registration")
```

**Fix B — autouse fixture for deep state restoration:**

Add to `conftest.py` (or the relevant test module):
```python
@pytest.fixture(autouse=True)
def reset_option_store_cache() -> Generator[None]:
    """Restore the option store's cache reference after each test.

    override_settings() restores CACHES but leaves the option store
    holding a stale ConnectionProxy reference.
    """
    original = default_store.cache
    yield
    default_store.set_cache_impl(original)
```

---

## 12. Hardcoded Test Data IDs Causing Uniqueness Collisions

**Symptoms:** `IntegrityError: duplicate key value violates unique constraint` on successive runs of a test, or cross-test failures when the same hardcoded ID is inserted by two tests in the same session.

**Diagnosis:** A test fixture or helper function uses a hardcoded ID string (e.g. `"event_id": "56b08cf7852c42cbb95e4a6998c66ad6"`) that must be unique within the database or Snuba. When that test runs more than once (reruns, parametrize) or another test imports the same fixture, the second insertion fails.

**Fix:** Use `uuid4().hex` instead of any hardcoded ID:
```python
from uuid import uuid4

# Before
event = {"event_id": "56b08cf7852c42cbb95e4a6998c66ad6", ...}

# After
event = {"event_id": uuid4().hex, ...}
```

Apply this in any shared fixture factory, not just individual test bodies.

---

## 13. Bucket-Count Flakiness at Time Boundaries

**Symptoms:** `assert len(buckets) == 14` gets 13 or 15. Affects tests that use `statsPeriod` or fixed time spans where the result is divided into hourly or daily buckets.

**Diagnosis:** The number of buckets returned by a time-series query depends on the current time at execution. A `statsPeriod="14d"` query run at `23:59:59` produces a different bucket count than the same query run at `00:00:01` the next day.

**Fix:** Freeze time at the class level to a fixed point mid-period (not at a boundary):

```python
from sentry.testutils.helpers.datetime import before_now, freeze_time

# Pick a time mid-hour to avoid boundary ambiguity
@freeze_time(before_now(hours=3).replace(minute=30, second=0, microsecond=0))
class MyStatsEndpointTest(TestBase):
    ...
```

---

## 14. Batch Timeout Causing Premature Partial Flush

**Symptoms:** `assert batch_size == N` gets a smaller value, or batch-processing assertions fail intermittently. The test creates N items expecting them to be processed as one batch, but gets two smaller batches.

**Diagnosis:** A consumer or strategy has a `max_batch_time` (in seconds) that expires during the test if the system is under load, causing a flush before all N items are added.

**Fix:** Set `max_batch_time` to a large value in the test so only `max_batch_size` triggers the flush:

```python
strategy = MyStrategyFactory(
    max_batch_size=6,
    max_batch_time=300,  # large enough that time never triggers a flush in tests
).create_with_partitions(...)
```

---

## 15. Polling Loops That Rely on `time.sleep`

**Symptoms:** Tests that mock `time.sleep` are brittle — the production code changes its sleep call site or adds new ones, breaking the mock. Or tests take real wall-clock time because sleep isn't mocked at all.

**Diagnosis:** A polling loop in production code uses `time.sleep(N)` where `N` is hardcoded rather than configurable.

**Fix:** Add a `poll_interval` parameter to the polling function and default it to a sensible value. In tests, pass `poll_interval=0`:

```python
# Production code
def push_changes(self, run_id: int, poll_interval: float = 5.0, ...) -> ...:
    while ...:
        time.sleep(poll_interval)

# Test — no mock needed
result = client.push_changes(123, poll_interval=0)
```

This eliminates the need to `@patch("module.time.sleep")` and makes the test insensitive to where exactly `sleep` is called inside the function.

---

## Lookup Checklist

When reading a traceback, map the error to a pattern:

| Error | Most likely pattern |
|---|---|
| `datetime` off by seconds/minutes | Time-dependent (#1) |
| `assert result[N].field == X` fails intermittently | Ordering (#2) or contamination (#9) |
| `assert count == 0` but got >0 | Celery timing (#3) or cleanup (#4) |
| `KeyError: '<integer>'` on dict access | Retention expired (#10) or async create (#3) |
| `IndexError: list index out of range` | Retention expired (#10) or empty result (#6) |
| `assert N == M` where N==M | Stale ORM object (#7) |
| `HTTPConnectionPool` / `SnubaError` | External service mock (#5) |
| `IntegrityError: duplicate key` | Hardcoded IDs (#12) or missing cleanup (#4) |
| `assert len(buckets) == N` off by ±1 | Bucket boundary (#13) |
| Count too high from Snuba query | Cross-test contamination (#9) |
| Global option / cache wrong value | Teardown gap (#11) |
| Batch split unexpectedly | Batch timeout too short (#14) |
