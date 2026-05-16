# BESTCHOICE Expense Module v2.0 — Tracking System Design (T0)

**Date:** 2026-05-16
**Owner:** akenarin.ak@gmail.com
**Status:** Design — awaiting approval before implementation
**Sub-project ID:** T0 (Tracking & Workflow)

## Context

Owner delivered an 8-file package on 2026-05-15 to implement Business Expense Module v2.0
(BESTCHOICE FINANCE × SHOP). The package contains 5 bug-fix actions, 102 settings to
audit, 5 new UI flows, 5 new validation rules (V16–V20), an updated SSO calculation
(875 ฿ instead of 750 ฿ per government rule effective 1 Jan 2026), and a Petty Cash
flow with its own doc_type.

Realistic scope: ~155 trackable items, ~30–40 PRs, ~4 weeks of work. This exceeds
what fits in a single implementation plan. The work is also spread across multiple
AI sessions over those 4 weeks, so cross-session continuity matters as much as the
work itself.

Owner's explicit ask: **"ทำยังไงให้ไม่ลืมว่าต้องทำอะไรบ้าง"** — a tracking system that
survives session compaction, PR cycles, and the gap between deciding something and
acting on it.

This document specifies T0: the tracking system. T0 is itself the first sub-project
to ship before any other sub-project starts. Once T0 lands, all subsequent sub-projects
(A0, A1, B1, B2, B3, C1, C2, C3, C4, D1) seed their state into the tracking files
T0 establishes.

## Goals

- **Single source of truth** for state of every trackable item in v2.0 work
- **Cross-session resumable** — a fresh Claude session reading one file knows
  where work stopped and what's next
- **PR-traceable** — every item links to the PR(s) that touched it; every PR
  title links back to an item ID
- **Hard-gate enforced** — the 4-phase workflow (AUDIT → REPORT → WAIT → IMPLEMENT)
  is visible in tracking; nothing slips past a phase without explicit owner approval
- **Zero-risk** — markdown in repo, no external dependency, no GitHub Actions
  budget consumption

## Non-goals

- Replacing GitHub PR review or git history as the actual record of code change
- Auto-sync with GitHub Issues — manual links are sufficient at this scale
- Pre-commit hooks that enforce tracking updates — relying on PR review discipline
- Mermaid Gantt charts or kanban UIs — a markdown table renders well enough
- Slack/email/push notifications — owner reads the repo directly
- Migration tooling to convert existing memory entries — memory stays as-is

## Decomposition (decided in brainstorming)

The v2.0 work splits into 10 sub-projects + this tracking sub-project. Each
sub-project gets its own spec → plan → implementation cycle.

| ID | Sub-project | Trigger / Source | Approx items |
|---|---|---|---|
| **T0** | Tracking System (this doc) | Owner ask | 1 |
| **A0** | Pre-flight Verify | Dev Action Items #1, #3, #5 | 3 |
| **A1** | Settings Audit Phase 1+2 (scan + report only) | Settings Audit Core v2.0 | 102 |
| **B1** | SSO 875 Configurable + effective_date | Government rule + Settings 1.4 | 6 |
| **B2** | Settlement Multi-line Adjustment (V12 expansion) | Dev Action Items #2 | 5 |
| **B3** | Test Suite J+K | Dev Action Items #4 + new K-07/K-08 | 14 |
| **C1** | Petty Cash Reimbursement (new doc_type + V20 + UI) | Mockup 04B + Settings 1.5 | 8 |
| **C2** | Payroll Custom Income/Deduction (V16–V18 + UI) | Mockup 02B + Settings 2.8 | 7 |
| **C3** | Reverse Dialog + V19 (period guard) | Mockup 02E + Settings 2.7 | 5 |
| **C4** | Credit Note 2-Mode UI refinement | Mockup 02D | 4 |
| **D1** | Settings Audit Phase 4 (implement approved scope) | Depends on A1 | TBD |

Order:
1. T0 ships first (this doc → plan → implementation)
2. A0 next — pre-flight verify in prod before any code change
3. B1 next — deadline-critical, gov rule already active for May 2026 close
4. A1 in parallel with B1 — read-only audit, doesn't conflict
5. B2, B3, C1, C2, C3, C4 — bounded by Week 3
6. D1 last — depends on owner approving scope from A1

## Design

### 1. File layout

All tracking files live in a new directory `docs/superpowers/tracking/`. This sits
alongside the existing `docs/superpowers/specs/` and `docs/superpowers/plans/`
directories, mirroring the established pattern of one-topic-per-file.

```
docs/superpowers/tracking/
├── README.md                       # Master index + aggregate view
├── _conventions.md                 # Status emoji, ID format, PR title rules
├── _owner-package/                 # Read-only copy of owner's 8 source files
│   ├── README.md                   # Index + transcription notes
│   ├── COVER_MESSAGE.md
│   ├── README_FOR_DEV.md
│   ├── Implementation_Review_v2.0.html
│   ├── expense_module_mockup_v5.html
│   ├── Settings_Audit_Index.md
│   ├── Settings_Audit_Core_v2.0.md  # Transcribed from PDF
│   ├── Settings_Audit_Change_Log.md
│   └── Dev_Action_Items_v1.0.md     # Transcribed from PDF
├── T0-tracking-system.md
├── A0-preflight-verify.md
├── A1-settings-audit.md
├── B1-sso-875.md
├── B2-settlement-adjustment.md
├── B3-test-suite.md
├── C1-petty-cash.md
├── C2-payroll-custom.md
├── C3-reverse-dialog.md
├── C4-credit-note-2mode.md
└── D1-settings-implement.md
```

12 markdown files + 1 conventions file + 1 owner-package subdirectory.

The `_owner-package/` subdirectory exists because owner-supplied files arrived
as PDF attachments and HTML documents in the conversation. Copying them into the
repo gives every future Claude session a stable, versioned reference; the leading
underscore signals "do not edit these — they are inputs, not outputs."

### 2. Master `README.md`

The master index has six sections:

1. **Header metadata** — Deadline, start date, owner email
2. **Progress Overview table** — one row per sub-project, with columns:
   Sub-project · Items · Done · Progress · Status · Spec link · Plan link
3. **Current Focus** — what's active right now and what's next
4. **Timeline** — 4-week schedule from owner's Suggested Timeline section
5. **Source Documents** — links to `_owner-package/` files
6. **Hard Gates** — the 4-phase workflow reminder

Aggregate columns (`Done`, `Progress`) are updated **manually** in the same PR
that changes any sub-project file. No auto-aggregation; the file is short enough
that a one-line update is trivial.

Full template is in section 6 of the brainstorming output and reproduced in
the implementation plan.

### 3. Detail file template

Every sub-project file follows the same shape:

```markdown
# Xn · Sub-project Name

**Status:** [emoji + label]  |  **Started:** YYYY-MM-DD  |  **PRs:** [#nnn](url)
**Deadline:** YYYY-MM-DD (if any)
**Spec:** [link]  ·  **Plan:** [link]

## Context
1–3 sentences: what this sub-project does, why it matters.

## Source
- Dev Action Items §n.n
- Mockup page Xn / Settings Audit §n.n.n
- (Other source links)

## Items Checklist

| ID | Item | Priority | Status | PR | Evidence/Notes |
|----|------|----------|--------|----|---------------|
| X.1 | Title | P0 | ✅ Done | [#852](url) | Migration applied |
| X.2 | Title | P0 | 🟡 In Progress | [#854](url) | WIP |
| X.3 | Title | P1 | ⬜ Pending | — | Blocked by X.2 |

## Decision Log
- **YYYY-MM-DD:** Decision + rationale

## Open Questions
- [ ] Q awaiting answer
- [x] Q answered — answer here
```

Items checklist is the working surface — most PRs flip exactly one row from
🟡 to ✅ and add the PR link.

The Decision Log captures non-obvious choices made during execution (which
option was picked over which alternative, and why) — surviving session changes
even when the conversation has compacted.

Open Questions is a parking lot for "ask owner later" so they don't get lost
across sessions.

### 4. Conventions (`_conventions.md`)

#### Status emoji (exactly one per row)
| Emoji | Label | Meaning |
|---|---|---|
| ⬜ | Pending | Not started |
| 🟡 | In Progress | Work begun (draft/WIP PR exists) |
| 🔵 | In Review | PR open for review |
| ✅ | Done | PR merged |
| 🚫 | Blocked | Waiting on something external |
| ⏸ | Deferred | Owner pushed to later |
| 🔒 | Locked | Dependency not yet unlocked |

#### Priority labels
- **P0** — Critical / legal / production-breaking
- **P1** — High / UX-impacting
- **P2** — Medium / nice to have
- **P3** — Config / tuning

#### Item ID format
`<SubProject>.<Number>` — e.g. `B1.3` is item 3 of sub-project B1.
Sub-projects with sub-sections (like A1's 102 settings using `1.4.1` numbering
from owner's doc) preserve owner's numbering inside but prefix with sub-project:
`A1.1.4.1` reads as "A1, owner's section 1.4.1".

#### PR title format
`<type>(<scope>): <subject> [<ItemID>]`

Examples:
- `feat(payroll): make SSO ceiling configurable [B1.1]`
- `chore(tracking): mark A0.1 done after prod DB verify [A0.1]`
- `fix(settlement): allow multi-line adjustments [B2.3]`

This format lets a grep on item ID find every PR that touched it.

#### Update workflow — atomic diff rule
**The golden rule:** any PR that does work on an item **must update the
tracking file in the same PR**. No separate "tracking-update" PRs.

- Start work → flip ⬜ → 🟡 and add PR number column in the same WIP commit
- Open for review → flip 🟡 → 🔵
- Merge → flip 🔵 → ✅ and fill Evidence column in the same merge commit
- Update the master `README.md` Done/Progress columns in the same PR

Rationale: a single diff tells the whole story — code change, test, spec
reference, and tracking update co-located. Reverting the PR also reverts
the tracking entry.

### 5. Initial seeding

When the implementation plan executes, it seeds the files with concrete
items (not placeholders). Sources:

- **A0-preflight-verify.md** — 3 items from Dev Action Items #1 (verify
  adj_underpay in prod DB), #3 (SSO reclassify catch-up), #5 (depreciation
  Mar–Apr 2026 recovery)
- **A1-settings-audit.md** — 102 rows imported from `Settings_Audit_Core_v2.0`
  with status all `⬜ Pending`, Detection Hint column preserved
- **B1-sso-875.md** — 6 items: schema migration, DTO `@Max` lift, hard-coded
  search-and-replace, fixture update, effective_date support, test update
- **B2-settlement-adjustment.md** — 5 items: V12 validator expansion,
  vendor-settlement template addition, ExpenseFormV4 Section 5 enable, K-07
  test, regression
- **B3-test-suite.md** — 14 items: Suite J (J-01 through J-06) + Suite K
  (K-01 through K-06 + K-07 settlement adj + K-08 direction routing)
- **C1-petty-cash.md** — 8 items: doc_type enum, schema column
  `supplier_per_line`, V20 validator, JE template, petty-cash service,
  ExpensePettyCashPage UI, settings 1.5.*, voucher 04B template
- **C2-payroll-custom.md** — 7 items: V16/V17/V18 validators, expandable
  rows in PayrollFormV4, Custom Income/Deduction schema, JE template
  update, settings 2.8.*, tax-exempt warning UI, slip auto-generate
- **C3-reverse-dialog.md** — 5 items: V19 validator, reverse reason enum,
  audit_log column extension, ReverseDialog modal, cascade check
- **C4-credit-note-2mode.md** — 4 items: Mode A auto-load, Mode B
  standalone form, ภ.30 link metadata, JE preview update
- **D1** stays unseeded until A1 finishes; the file exists as placeholder
  with `🔒 Locked` status

### 6. How T0 addresses each "forgetting" mode

| Failure mode | T0 mitigation |
|---|---|
| New session forgets where work stopped | Claude reads `README.md` (~80 lines) → sees Current Focus + every sub-project status |
| Forgets whether an item is done | Grep item ID in tracking files → status + PR + evidence |
| Forgets a deadline | `README.md` header table + Timeline section |
| Forgets which PR closed which item | PR title carries `[B1.3]`; tracking row links back to PR |
| Forgets the owner's source documents | `_owner-package/` copies the 8 files into the repo |
| Forgets that Phase 1 → Phase 2 is gated | Hard Gates section in `README.md` + every audit-style sub-project file restates the gate |
| Forgets earlier decisions | Decision Log section in each detail file |
| Forgets open questions | Open Questions parking lot in each detail file |

### 7. Update cadence & lifecycle

- **Per PR**: tracking file(s) updated in the same diff as the code change
- **End of sub-project**: detail file's Status field flips to ✅ Done;
  master README updates Done count + Progress %
- **Archive**: when v2.0 ships, the entire `docs/superpowers/tracking/`
  directory stays in repo as the historical record. No deletion. Future
  reviews of "how did we deliver v2.0" land here.

### 8. Out of scope

- Auto-sync with GitHub Issues — defer until cross-team work emerges
- Pre-commit hook validating tracking-PR atomic rule — rely on PR review
- Mermaid Gantt / kanban UI — not worth the complexity at this scale
- Per-sub-project email/Slack digest — owner reads the repo
- Migrating existing memory entries into tracking — memory keeps its role
  (cross-project, long-lived insights); tracking is project-scoped

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Tracking files drift from reality (forgot to update) | Atomic diff rule + PR review check |
| Master README aggregates fall out of sync | Manual update enforced same PR; reviewer checks |
| Owner package files might update later | `_owner-package/` is read-only by convention; new owner package = new dated subdirectory |
| Item IDs collide across sub-projects | `<SubProject>.<Number>` namespacing prevents this |
| Sub-project files balloon past 200 lines | A1 (102 settings) is the only at-risk file; split by priority section if it gets long |

## Acceptance criteria

T0 is considered done when:

1. `docs/superpowers/tracking/` directory exists with 12 markdown files + 1 `_conventions.md` + `_owner-package/` populated with 8 owner source files
2. `README.md` shows the 11-row Progress Overview table (T0 + 10 sub-projects)
3. T0 row in `README.md` shows ✅ Done after the seeding PR merges
4. Each detail file is seeded with concrete items per section 5 above (no
   placeholder rows)
5. `_conventions.md` documents status emoji, priority labels, ID format,
   PR title format, and atomic-diff update rule
6. A fresh Claude session, given only "continue v2.0 work" as a prompt,
   can read `README.md` and identify the active sub-project and next item

## What comes after T0

Once T0 ships:
- A0 begins (Pre-flight Verify) — its tracking file already exists, items
  already seeded
- Subsequent sub-project specs reference back to their tracking file as
  the working surface for status

The brainstorming → spec → plan → implementation cycle of the
`superpowers:writing-plans` and `superpowers:executing-plans` skills runs
once per sub-project. Tracking files survive across all of those cycles.
