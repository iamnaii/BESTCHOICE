# Position-first Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make position setup the starting point of owner access management.

**Architecture:** Reuse the current console and server contracts. Change navigation order and explanatory copy, preserving all mutation/review behavior.

**Tech Stack:** React, TypeScript, Radix Tabs, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-24-position-first-access-design.md`

## Global Constraints

Owner-only; existing URL; no business-rule, schema or live-account changes. Use the existing isolated worktree/preview. Run `local:check` before handoff.

## Review Focus

Existing bookmarks, owner-only entry, assignment/history reachability, explicit scope guidance, and mobile tab overflow are covered by existing registry/route/component tests and the feature browser flow. No additional uncovered input classes for this copy/order change.

### Task 1: Reorient the console around positions

**Files:** `apps/web/src/config/settings-registry.tsx`; `apps/web/src/pages/EmployeeAccessPage/{index,PositionsTab,EmployeesTab}.tsx`; their existing component/registry/route tests; `tools/check-local-employee-access-ui.mjs`.

**Interfaces:** Keep route, tab values, component signatures, and API payloads. Visible title is ตำแหน่งและสิทธิ์; tabs are ตำแหน่ง, มอบหมายพนักงาน, ประวัติการเปลี่ยนแปลง. Default value is positions.

- [x] Adapt existing component test to require positions selected on entry; employee tests explicitly select assignment tab. Update existing registry/route/browser checks for new labels; browser asserts default selection before any tab click.
- [x] Run the focused first-entry component test; expect failure because positions is not selected yet.
- [x] Update labels/order/default and concise guidance in the existing components.
- [x] Run existing feature/registry/route tests; expect all pass. Review this incremental change with a fresh reviewer.
- [x] Run `NODE_OPTIONS=--max-old-space-size=8192 LOCAL_PREVIEW_PORT=5216 npm run local:check`, then `node tools/check-local-employee-access-ui.mjs http://localhost:5216`; expect PASS, inspect screenshots, keep own preview running.
- [x] Record evidence and commit the scoped change; no merge/push/deploy.
