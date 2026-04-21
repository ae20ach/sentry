# Page Frame Topbar Action Migration Plan

## Goal

Migrate pages that currently render a primary button into `TopBar.Slot name="actions"` so that, when `useHasPageFrameFeature()` is `true`, that button can instead render at a user-specified in-page location, typically closer to page filters.

The legacy behavior must remain unchanged when `useHasPageFrameFeature()` is `false`.

## Research Summary

### Where the topbar slot system lives

- Slot primitive: `static/app/components/core/slot/slot.tsx`
- Top bar slot definition: `static/app/views/navigation/topBar.tsx`
- Top bar slot provider and mounted page layout: `static/app/views/organizationLayout/index.tsx`

### How topbar slots work

`TopBar` is created with `withSlots(...)` and exposes:

- `TopBar.Slot`
- `TopBar.Slot.Provider`
- `TopBar.Slot.Outlet`
- `TopBar.Slot.Fallback`

The slot system is portal-based:

1. `TopBar.Slot.Provider` stores outlet registration and consumer counts.
2. `TopBar` renders outlets for `title`, `actions`, and `feedback`.
3. Any page rendering `<TopBar.Slot name="actions">...</TopBar.Slot>` portals its children into the top bar actions outlet.
4. If no outlet is mounted, `TopBar.Slot` renders `null`.

Important implementation details from `slot.tsx`:

- Consumers increment/decrement a slot-specific counter.
- Outlets register the actual DOM element for that slot.
- `Slot.Fallback` only renders when there are no consumers for a slot.

### Where the provider is mounted

`static/app/views/organizationLayout/index.tsx` wraps `<TopBar />` and the routed page content in `TopBar.Slot.Provider`, so routed organization pages can register content into the top bar.

### How page frame gating works

`static/app/views/navigation/useHasPageFrameFeature.tsx`

```ts
return organization?.features.includes('page-frame') ?? false;
```

This is the single gate used across the frontend to decide between:

- new page-frame behavior
- legacy header behavior

## Current Usage Pattern

Across the codebase, the standard pattern is:

- `hasPageFrameFeature === true`
  - render title and/or actions into `TopBar.Slot`
- `hasPageFrameFeature === false`
  - render the old header action area directly in `Layout.HeaderActions` or inline layout

Representative examples:

- `static/app/views/releases/detail/header/releaseHeader.tsx`
- `static/app/views/alerts/list/header.tsx`
- `static/app/views/issueList/issueViewsHeader.tsx`
- `static/app/views/replays/list.tsx`
- `static/app/views/insights/uptime/views/overview.tsx`
- `static/app/views/explore/logs/content.tsx`

## Migration Intent

The migration described in this plan is narrower than the existing pattern above.

We are not moving a legacy in-page button into the top bar.

We are doing the reverse for selected pages:

- when page frame is enabled, stop rendering the primary action in the top bar
- instead render that same action in a user-specified in-page location
- when page frame is disabled, preserve the existing non-page-frame layout and behavior

## Recommended Migration Pattern

For each target page:

1. Identify the current primary action rendered in `TopBar.Slot name="actions"`.
2. Branch on `useHasPageFrameFeature()`.
3. When `true`, copy the existing button into the requested local container near filters/content controls.
4. When `false`, keep the current legacy header action path unchanged.

Prefer direct placement over abstraction for this migration:

- do not introduce helper props just to thread the button down one level
- do not extract a shared component unless the page already needs one for another reason
- it is acceptable to render the same button JSX in both branches if that keeps the change local and obvious

### Preferred shape

```tsx
const hasPageFrameFeature = useHasPageFrameFeature();

return hasPageFrameFeature ? (
  <Fragment>
    <Layout.Header ...>
      <Layout.HeaderContent ...>{...}</Layout.HeaderContent>
      <TopBar.Slot name="feedback">{...}</TopBar.Slot>
    </Layout.Header>

    <PageFilterBar>
      ...
      <Button priority="primary" onClick={...}>
        {label}
      </Button>
    </PageFilterBar>
  </Fragment>
) : (
  <Layout.Header ...>
    <Layout.HeaderContent ...>{...}</Layout.HeaderContent>
    <Layout.HeaderActions>
      <Button priority="primary" onClick={...}>
        {label}
      </Button>
    </Layout.HeaderActions>
  </Layout.Header>
);
```

Avoid overengineering:

- do not add a temporary prop like `pageFrameAction` just to move the button
- do not refactor unrelated page structure while doing this migration
- only change placement

## Decision Rules

### Keep using `TopBar.Slot`

Keep `TopBar.Slot` for:

- title/breadcrumb content intended to live in the shared top bar
- feedback buttons that are still meant for the top-right top bar area
- small secondary controls that are intentionally part of the global top chrome

### Stop using `TopBar.Slot name="actions"`

Do not use the top bar action slot for the migrated primary CTA when:

- the requested final location is inside page content
- the CTA should sit adjacent to page filters, search, or page-specific controls
- the CTA should visually belong to the page workflow rather than the global header

## Layout Guidance

When moving the button in page-frame mode, prefer existing page layout primitives over new custom wrappers:

- `PageFilterBar`
- `PageFiltersContainer`
- `Flex`
- `Grid`
- existing page-specific filter/control containers

Avoid introducing a duplicate CTA in both places. The action should render once per feature-flag branch.

## Behavioral Constraints

These must remain true after every migration:

- `useHasPageFrameFeature() === false`
  - behavior and placement stay exactly as they are today
- `useHasPageFrameFeature() === true`
  - button label, click behavior, analytics, permissions, disabled state, tooltip, and loading state remain unchanged
- only placement changes

## Validation

For this migration, do not add tests unless the user explicitly asks for them.

Default validation should be:

1. Check that the button only moves in the `useHasPageFrameFeature() === true` branch.
2. Check that the non-page-frame branch stays structurally unchanged.
3. Keep button semantics unchanged: label, link/handler, analytics, permissions, loading, and tooltip behavior.

## Migration Checklist

For each page instance supplied later:

1. Locate the page component and the current `TopBar.Slot name="actions"` usage.
2. Confirm the target button is the primary CTA to move.
3. Identify the requested destination container near filters or controls.
4. Copy the button into the requested page-frame location.
5. Remove the page-frame `TopBar.Slot name="actions"` usage for that button.
6. Preserve the existing non-page-frame branch.
7. Keep any remaining top bar title/feedback slots intact.
8. Do a quick structural sanity check instead of adding tests unless requested.

## Notes for Follow-up Agents

- Treat `useHasPageFrameFeature()` as the only switch for this migration unless the page already has extra feature gating.
- Do not change button semantics while moving it.
- Do not convert unrelated top bar content unless explicitly requested.
- If a page already uses a custom control bar below the header, that is usually the right destination for the migrated CTA.
