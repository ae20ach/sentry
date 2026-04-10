# Flaky Test Patterns

## Lookup

| Symptom | Pattern |
|---|---|
| `datetime` off by seconds/minutes | [1] freeze time |
| `result[N].field` wrong intermittently | [2] ordering |
| `assert count == 0` but got >0 | [3] celery timing |
| Unique constraint / duplicate key | [4] hardcoded IDs |
| `HTTPConnectionPool` / `SnubaError` | [5] mock Snuba |
| Batch split unexpectedly | [6] batch timeout |
| `assert len(buckets) == N` off by ±1 | [7] bucket boundary |
| Global option/cache wrong value | [8] teardown gap |
| Snuba count too high | [9] cross-test contamination |
| `IndexError` / `KeyError` on Snuba result | [10] retention expired |
| `assert N == M` where N==M | [11] stale ORM object |
| `time.sleep` mock brittleness | [12] configurable interval |

---

## 1. Freeze time

Test depends on real clock. Use `time_machine` (faster) or `freeze_time` (older, but common in Sentry).

```python
# Method-level
@time_machine.travel("2024-01-15 12:00:00+00:00", tick=False)
def test_something(self): ...

# Class-level (use a module constant so it stays current)
_NOW = before_now(days=1).replace(hour=12, minute=0, second=0, microsecond=0)

@freeze_time(_NOW)
class MyTest(...): ...
```

Never hardcode a year ≥ current year in `freeze_time` at class/module scope — it drifts into Snuba retention. Use `before_now(...)` based constants instead.

---

## 2. Unordered results

Test indexes into a queryset or list without guaranteed ordering.

```python
# Add .order_by() when order matters
result = MyModel.objects.filter(...).order_by("id")

# Use sets when order doesn't matter
assert {r.id for r in result} == set(expected_ids)
assert result.user.id in {user1.id, user2.id}

# Check presence, not position
assert MyModel.objects.filter(foo="expected").exists()
```

---

## 3. Celery / background task timing

Test checks state that only exists after an async task runs.

```python
with self.tasks():
    response = self.client.post(url, data)
# assert post-task state here
```

Wrap the action that *triggers* the task, not just the assertion. For signal-triggered tasks, wrap the model operation that fires the signal.

---

## 4. Hardcoded IDs causing uniqueness collisions

Fixture helpers with static `event_id`/`group_id` etc. fail when run twice or by concurrent tests.

```python
from uuid import uuid4
event = {"event_id": uuid4().hex, ...}  # never a hardcoded hex string
```

Apply in shared fixture factories, not just individual tests.

---

## 5. Snuba connection / mock

`HTTPConnectionPool: Max retries exceeded` or `SnubaError` — test hits real Snuba that isn't available.

```python
from unittest.mock import patch

with patch("sentry.utils.snuba.raw_query") as mock_query:
    mock_query.return_value = {"data": [...], "meta": [...]}
    ...
```

Check for existing `@override_settings(SENTRY_SNUBA_MOCK=True)` or per-test mock helpers before writing a new patch.

---

## 6. Batch timeout too short

Consumer/strategy has `max_batch_time=1` which fires during slow CI, splitting what should be one batch.

```python
strategy = MyStrategyFactory(
    max_batch_size=6,
    max_batch_time=300,  # never time-triggered in tests
).create_with_partitions(...)
```

---

## 7. Bucket-count boundary

`statsPeriod` or time-series bucket count varies by ±1 depending on when test runs relative to an hour/day boundary.

```python
# Freeze mid-period at class level
@freeze_time(before_now(hours=3).replace(minute=30, second=0, microsecond=0))
class MyStatsTest(...): ...
```

---

## 8. Global state not restored after test

`override_settings` restores `CACHES` dict but not object references that were set from it (e.g. `default_store.cache`). Options set via `options.set(...)` persist across tests.

**try/finally for in-test mutations:**
```python
response = self.client.put(url, {"auth.allow-registration": 1})
try:
    assert response.status_code == 200
finally:
    options.delete("auth.allow-registration")
```

**Autouse fixture for deep singletons:**
```python
@pytest.fixture(autouse=True)
def reset_option_store_cache() -> Generator[None]:
    original = default_store.cache
    yield
    default_store.set_cache_impl(original)
```

---

## 9. Snuba cross-test contamination

Queries against `self.project` pick up events written by other tests in the same session (Snuba data is not rolled back between tests).

**Dedicated project:**
```python
project = self.create_project(organization=self.organization)
self.store_event(data=..., project_id=project.id)
result = query_snuba(project_ids=[project.id], ...)
```

**Tight query window** (use `hours=4` to stay outside the common `before_now(minutes=N)` range other tests use):
```python
event_time = before_now(hours=4)
self.store_event(data={..., "timestamp": event_time}, project_id=project.id)
result = query_snuba(
    start=event_time - timedelta(minutes=2),
    end=event_time + timedelta(minutes=2),
)
```

Use both together for maximum isolation.

---

## 10. Expired Snuba / ClickHouse retention

Test uses a hardcoded timestamp that is now outside the retention window (EAP: 90 days, errors: longer). Snuba returns empty results — `IndexError`, `KeyError`, or wrong count.

Signs: `datetime(year=2025, ...)` or `@freeze_time("2025-...")` in the test; `retention_days=90` on EAP item creation.

```python
# Event timestamps inside test bodies — use utcnow()
t0 = datetime.datetime.utcnow().replace(second=0, microsecond=0) - datetime.timedelta(hours=1)

# freeze_time at class/method scope — use a module constant
_FROZEN_NOW = before_now(days=1).replace(hour=0, minute=0, second=0, microsecond=0)

@freeze_time(_FROZEN_NOW)
def test_something(self): ...

# When a class already has MOCK_DATETIME = datetime.now(...) - timedelta(days=1)
base_time = MOCK_DATETIME.replace(hour=13, minute=30, second=0, microsecond=0)
```

---

## 11. Stale ORM object

`assert obj.count == new_value` fails because the in-memory object wasn't refreshed after a DB update.

```python
obj.refresh_from_db()
assert obj.count == expected
```

For cache: `cache.clear()` then re-fetch.

---

## 12. Polling loops dependent on `time.sleep`

Patching `time.sleep` is brittle — breaks when the call site moves. Add a `poll_interval` parameter instead:

```python
# Production code
def push_changes(self, run_id: int, poll_interval: float = 5.0, ...) -> ...:
    while ...:
        time.sleep(poll_interval)

# Test — no mock needed
result = client.push_changes(123, poll_interval=0)
```
