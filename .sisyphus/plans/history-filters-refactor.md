# History filters refactor plan

## Goal

Refactor `src/app/[locale]/dashboard/history/page.tsx` so the filters are compact, readable, and complete while preserving the existing history table behavior: edit sheet, delete confirmation, bulk selection, CSV export, undo, TanStack Table, lucide icons, and shadcn/ui primitives.

## Current findings

- `HistoryFilters` already supports `subscriptionId` and `clientId`, and `useAnalyticsHistory` forwards both to `/api/analytics/history`.
- The page already loads `useSubscriptions()` and `useClients()`, but the filter UI only exposes type, platform, plan, search, and date range.
- Existing analytics page patterns use single-row compact `Select` controls with `h-8 text-xs` and simple clear buttons.
- Existing shadcn components available for this task include `Button`, `Input`, `Select`, `Badge`, and `DropdownMenu`.
- There is no installed `Pagination` shadcn component, so numbered pagination should be implemented with existing `Button`s.

## Implementation steps

1. Add small local helpers/types inside the same page file:
   - quick date range metadata and date formatting helpers.
   - page number window helper for compact pagination.
   - option label lookup for active chips.
2. Replace the current three-row filter card with a compact filter bar:
   - search input.
   - type/platform/plan/subscription/client selects.
   - date-from/date-to inputs.
   - labeled Quick Range dropdown with Today, Yesterday, Last 7/30/90 days, This Month, Last Month.
   - clear button only when filters are active.
3. Add active filter chips below the bar using `Badge`:
   - include search, type, platform, plan, subscription, client, date from/to.
   - each chip removes its own filter and resets pagination to page 1.
4. Replace arrow-only pagination with numbered pagination:
   - keep previous/next arrow buttons.
   - show a compact page window and ellipsis when needed.
   - preserve total count text.
5. Verify:
   - run LSP diagnostics on the changed page.
   - run `bunx tsc --noEmit`; if `bunx` is unavailable, run the project-equivalent command with available tooling and report honestly.

## QA scenarios

1. Static filter wiring — tool: TypeScript compiler. Steps: run `bunx tsc --noEmit`. Expected: `HistoryFilters` updates for type, platform, plan, subscription, client, search, and dates compile without type errors.
2. Quick ranges — tool: code review plus TypeScript compiler. Steps: inspect the quick range map and run `bunx tsc --noEmit`. Expected: Today, Yesterday, Last 7, Last 30, Last 90, This Month, and Last Month all set `dateFrom`, `dateTo`, and reset `page` to 1.
3. Active chips — tool: code review plus TypeScript compiler. Steps: inspect chip definitions and run `bunx tsc --noEmit`. Expected: every non-default filter produces a visible chip and each chip removal clears only its own filter while resetting `page` to 1.
4. Numbered pagination — tool: code review plus TypeScript compiler. Steps: inspect page-window helper and run `bunx tsc --noEmit`. Expected: previous/next remain bounded, numbered buttons jump to valid pages, and ellipses appear only for skipped page ranges.
5. UI smoke check — tool: browser if the app can run locally. Steps: start the dev server, open `/dashboard/history`, exercise search/select/date/quick-range/chip removal/pagination. Expected: controls are visible in one responsive filter bar, no console errors, and table interactions still open the edit sheet.

## Non-goals

- Do not change API routes or hooks unless a type mismatch blocks compilation.
- Do not add new dependencies.
- Do not alter table columns, edit sheet behavior, mutation flows, export logic, or delete/undo behavior.
