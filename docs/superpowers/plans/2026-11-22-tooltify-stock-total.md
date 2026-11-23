# Tooltify Stock Total Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Reconcile the real stock export using its explicit extended costs.

**Architecture:** Correct the summary reader in the existing cutover input boundary. Keep the original detail parser and transactional importer unchanged.

**Tech Stack:** TypeScript, ExcelJS, Prisma Decimal, existing Jest/PostgreSQL test harness.

**Spec:** `docs/superpowers/specs/2026-11-22-tooltify-stock-total-design.md`

## Global Constraints

- Preserve original source workbooks and all existing source verification gates.
- No production writes, deployments or credential access from implementation workers.
- Use Decimal for money; no rounding away an unexplained difference.
- Keep old reports without an explicit extended-total column supported through their existing evidence-bound choice.
- Use isolated PostgreSQL harnesses for database-backed tests.

## Review Focus

- Mixed unit costs in a group must use the explicit group total.
- An invalid explicit total must not silently select the other cost column.
- Duplicate explicit total headers must prevent verification.
- An old report still requires its existing cost-basis evidence.
- A valid but inconsistent group total must remain a reconciliation failure.

### Task 1: Read explicit extended stock costs

**Files:**
- Modify: `apps/api/src/cli/tooltify-cutover/source-input.ts`
- Test: `apps/api/src/cli/tooltify-cutover/__tests__/source-review.integration.spec.ts`
- Modify if needed for fixture construction only: `apps/api/src/cli/tooltify-cutover/__tests__/preflight-fixtures.ts`

**Interfaces:**
- Consumes: `loadSourceInputs(path, decisionsPath, codeRevision, expectedDbIdentity)` and existing stock summary/reconciliation types.
- Produces: the same interface with an accurately summed `sourceSummary.reported.cost` for reports containing `รวมต้นทุน`.

- [x] Add synthetic regression tests: a two-unit group with displayed cost `13800.00`, explicit total `26300.00`, and detail costs `13800.00`/`12500.00` must report `26300.00` and reconcile. Cover both `summaryCostBasis` choices and absent basis when explicit total is present. Verify invalid/blank/duplicate totals block, and a wrong valid total remains a mismatch. Preserve legacy no-total-column cases.
- [x] Run the focused suite through the repository's isolated PostgreSQL harness and record the expected failing assertions before implementation.
- [x] Update only `stockHeader` and necessary fixture construction. Prefer a unique explicit extended-total column; never infer from numeric coincidence or replace source detail values.
- [x] Re-run the focused suite and related parser/source-input tests; run API type checks. Save full logs privately and report counts and commands.
- [x] Self-review, commit the task changes with the plan/spec, and write a full report including RED/GREEN evidence. The controller will perform independent review and the required final `local:check` plus live feature preview after all migration compatibility work.
