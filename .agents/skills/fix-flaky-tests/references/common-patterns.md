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

## Lookup Checklist

When reading a traceback, map the error to a pattern:

| Error | Most likely pattern |
|---|---|
| `datetime` off by seconds/minutes | Time-dependent (#1) |
| `assert result[N].field == X` fails | Ordering (#2) |
| `assert count == 0` but got >0 | Celery timing (#3) or cleanup (#4) |
| `KeyError: '<integer>'` on dict access | Async creation not complete (#3) |
| `IndexError: list index out of range` | Empty result from async write (#3 or #6) |
| `assert N == M` where N==M | Stale ORM object (#7) |
| `HTTPConnectionPool` / `SnubaError` | External service mock (#5) |
| `IntegrityError: duplicate key` | Missing cleanup (#4) |
