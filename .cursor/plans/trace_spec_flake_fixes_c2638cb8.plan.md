---
name: Trace spec flake fixes
overview: Stabilize flaky trace.spec.tsx tests without lengthening RTL timeouts—use reducer-driven iterator waits instead of the debounced success icon, granular awaits between user actions, optional synchronous RAF for trace search in this file, and a scoped + button click.
todos:
  - id: search-settled-helper
    content: Replace or augment searchToSucceed to wait on trace-search-result-iterator (and loading removal if needed), not trace-search-success + default timeout
    status: pending
  - id: optional-raf-mock
    content: Optionally mock requestAnimationFrame in trace.spec search describe to drain searchInTraceTreeText without multi-frame CI drift
    status: pending
  - id: expand-scope-plus
    content: Click + within transaction-op-0 row; keep final waitFor on iterator 1/2 with default timeout once search is sync/granular
    status: pending
  - id: verify-jest-precommit
    content: Run trace.spec.tsx Jest (CI=true) and pre-commit on file
    status: pending
isProject: false
---

# Fix trace.spec.tsx CI flakes (no timeout increases)

## Constraint

Do **not** rely on longer `waitFor` / `findBy*` timeouts. Prefer **clearer synchronization points**, **mocks for async chunking**, and **scoped interactions**.

## Root causes (short)

1. **`trace-search-success`** lags reducer state by up to **`MIN_LOADING_TIME` (300ms)** in [`TraceSearchInput`](static/app/views/performance/newTraceDetails/traceSearch/traceSearchInput.tsx). `findByTestId` uses the default ~**1000ms** budget; slow CI + multi-frame search can exceed that **before** the icon appears—even when search results are already in state.

2. **Expand + re-search:** Iterator **`1/1` vs `1/2`** is a **race** (which `+` is clicked, how many `requestAnimationFrame` passes complete before assertions, stale tree when `onTraceSearch` runs).

## Strategy A — Wait on the right signal (no mock)

**Replace `searchToSucceed`** (or redefine it) to assert **search has settled** using UI that tracks **reducer state**, not the debounced leading icon:

- The iterator [`trace-search-result-iterator`](static/app/views/performance/newTraceDetails/traceSearch/traceSearchInput.tsx) reads `traceState.search` directly (counts, `no results`, etc.).
- After a paste that should yield matches, wait until the iterator matches something like **`/\d+\/\d+/`** (or a test-specific pattern e.g. **`/1\/11/`** for `transaction-op` on `searchTestSetup`).
- For flows that end with no matches, keep using **`searchToHaveResult(/no results/)`** (already in file).

This is **more granular** than “success icon eventually”: it ties the test to **the same state** that drives match counts.

**Optional refinement:** combine a **short** `waitFor` that asserts `trace-search-loading` is **not** in the document **and** iterator matches—still default timeout, but two explicit conditions.

**Extend `searchToHaveResult`** with an optional `{timeout}` only if you must; **default stays 1000ms** per your preference—primary fix is **correct predicate**, not duration.

## Strategy B — Mock the slow / chunked work (targeted)

[`searchInTraceTreeText`](static/app/views/performance/newTraceDetails/traceSearch/traceSearchEvaluator.tsx) schedules work with **`requestAnimationFrame`** and a **12ms** `performance.now()` slice per frame. On a loaded trace, many frames may be needed.

In **`describe('search')`** (or a nested `describe` wrapping only the flaky tests), add:

- `beforeEach`: `jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => { cb(0); return 0; });` (or equivalent typing).
- `afterEach`: restore the spy.

Effects:

- Each scheduled `search()` runs **immediately**; chained RAFs **drain synchronously** in one turn, reducing **multi-frame ordering flakes** on CI.
- **Scope narrowly** to avoid breaking other tests that assume real rAF timing in this large file; if needed, only wrap the two flaky `it` blocks in their own `describe` with the mock.

**Alternative (heavier):** `jest.mock` the evaluator module with a synchronous implementation—only if the spy approach is insufficient.

## Strategy C — Expand test: granular + scoped UI

1. **Scope the `+` button** to the row containing **`transaction-op-0`** (e.g. `within(row).getByRole('button', { name: '+' })`), not `findAllByRole(...)[0]`.

2. **Order assertions** (already mostly there): after expand + span visible + `spansRequest`, assert iterator **`1/2`** via **`searchToHaveResult(/1\/2/)`** once **A + B** make search completion deterministic enough for the default timeout.

## Strategy D — Product follow-up (optional, separate PR)

If **`1/2`** still flakes after A–C, defer `onTraceSearch` in [`trace.tsx`](static/app/views/performance/newTraceDetails/trace.tsx) after `fetchNodeSubTree` so it runs against the **committed** tree (e.g. `queueMicrotask` / `requestAnimationFrame` / read from `treeRef`). Not required for the “no longer timeouts” test plan.

## Files to touch

- [`static/app/views/performance/newTraceDetails/trace.spec.tsx`](static/app/views/performance/newTraceDetails/trace.spec.tsx): helpers (`searchToSucceed` / `searchToHaveResult`), optional `describe`-scoped RAF mock, roving + expand tests.

## Verification

- `CI=true pnpm exec jest static/app/views/performance/newTraceDetails/trace.spec.tsx --no-watchman`
- `.venv/bin/pre-commit run --files static/app/views/performance/newTraceDetails/trace.spec.tsx`
