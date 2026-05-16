# T0 · Tracking System Setup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold `docs/superpowers/tracking/` with master index, conventions, 11 sub-project detail files (each seeded with concrete items), and a read-only copy of 8 owner-package source files. Outcome: a fresh Claude session can read one file and know where v2.0 work stands.

**Architecture:** Pure markdown infrastructure in repo. Hub-and-spoke layout — `README.md` aggregates state across 11 detail files. Atomic-diff rule (PR changing code MUST also update tracking row in same diff). `_owner-package/` is read-only reference; tracking files are the working surface.

**Tech Stack:** Markdown only. No code, no runtime, no tests beyond grep-based verifications.

**Spec:** `docs/superpowers/specs/2026-05-16-bestchoice-expense-v2-tracking-design.md`

---

### Task 1: Bootstrap directory + `_conventions.md`

**Files:**
- Create: `docs/superpowers/tracking/_owner-package/` (directory)
- Create: `docs/superpowers/tracking/_conventions.md`

- [ ] **Step 1: Create directory tree**

```bash
mkdir -p docs/superpowers/tracking/_owner-package
```

- [ ] **Step 2: Write `_conventions.md`**

Use Write tool to create `docs/superpowers/tracking/_conventions.md` with this exact content:

```markdown
# Tracking Conventions · BESTCHOICE Expense v2.0

This file is the single reference for all `docs/superpowers/tracking/` markdown files. Every detail file (`Xn-*.md`) and the master `README.md` follow these conventions.

## Status emoji (exactly one per row)

| Emoji | Label | Meaning |
|---|---|---|
| ⬜ | Pending | Not started |
| 🟡 | In Progress | Work begun — draft/WIP PR exists |
| 🔵 | In Review | PR open for review |
| ✅ | Done | PR merged to main |
| 🚫 | Blocked | Waiting on something external |
| ⏸ | Deferred | Owner pushed to later |
| 🔒 | Locked | Dependency not yet unlocked |

## Priority labels

- **P0** — Critical / legal / production-breaking
- **P1** — High / UX-impacting
- **P2** — Medium / nice to have
- **P3** — Config / tuning

## Item ID format

`<SubProject>.<Number>` — e.g. `B1.3` is item 3 of sub-project B1.

Sub-projects with owner-supplied nested numbering (A1 uses Settings Audit's `1.4.1` style) preserve owner numbering inside, prefixed with sub-project ID: `A1.1.4.1` reads as "A1, owner's section 1.4.1".

## PR title format

`<type>(<scope>): <subject> [<ItemID>]`

Examples:
- `feat(payroll): make SSO ceiling configurable [B1.1]`
- `chore(tracking): mark A0.1 done after prod DB verify [A0.1]`
- `fix(settlement): allow multi-line adjustments [B2.3]`

This format lets `git log --grep` find every PR that touched any item ID.

## Update workflow — atomic diff rule

**The golden rule:** any PR doing work on an item **must update the tracking file in the same PR**. No separate "tracking-update" PRs.

Lifecycle per item:
1. Start work → flip `⬜ Pending` → `🟡 In Progress` and fill the `PR` column in the same WIP commit
2. Open for review → flip `🟡` → `🔵 In Review`
3. Merge to main → flip `🔵` → `✅ Done` and fill `Evidence/Notes` column in the merge commit
4. Update master `README.md` Done/Progress columns in the same PR

Rationale: a single diff tells the whole story — code change, test, spec reference, tracking update co-located. Reverting the PR also reverts the tracking entry.

## File responsibility

| File | Owner | Purpose |
|---|---|---|
| `README.md` | All sub-projects | Bird's-eye aggregate view, current focus, timeline, hard gates |
| `_conventions.md` | This file | Convention reference (rarely changes) |
| `_owner-package/` | Read-only | Owner's source documents (do NOT edit) |
| `Xn-*.md` | One sub-project each | Detail items + decision log + open questions |

## Phase gates (from owner workflow)

Some sub-projects (notably A1 Settings Audit) follow a 4-phase gate:
1. **AUDIT** — scan codebase, mark items ✅/❌/◐ — no code changes
2. **REPORT** — produce markdown summary, hand to owner
3. **WAIT** — owner reviews and approves scope (🛑 hard gate — do not skip)
4. **IMPLEMENT** — only items owner approved get coded; one PR per item

Sub-project files that follow the gate include a `## Phase` section near the top.

## When in doubt

- Read the spec: `docs/superpowers/specs/2026-05-16-bestchoice-expense-v2-tracking-design.md`
- Owner's original source: `_owner-package/`
- Master overview: `README.md`
```

- [ ] **Step 3: Verify file created**

```bash
test -d docs/superpowers/tracking/_owner-package && echo "dir OK"
wc -l docs/superpowers/tracking/_conventions.md
```
Expected: `dir OK` and line count between 50–100.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/tracking/_conventions.md
git commit -m "$(cat <<'EOF'
docs(tracking): bootstrap T0 directory + conventions [T0.1]

Scaffolds docs/superpowers/tracking/ per spec
2026-05-16-bestchoice-expense-v2-tracking-design.md section 4.

Establishes status emoji, priority labels, item ID format,
PR title format, and atomic-diff update rule.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Copy owner package source files into `_owner-package/`

**Files (all in `docs/superpowers/tracking/_owner-package/`):**
- Create: `README.md` (transcription notes + file index)
- Create: `COVER_MESSAGE.md`
- Create: `README_FOR_DEV.md`
- Create: `Implementation_Review_v2.0.html`
- Create: `expense_module_mockup_v5.html`
- Create: `Settings_Audit_Index.md`
- Create: `Settings_Audit_Core_v2.0.md` (transcribed from PDF)
- Create: `Settings_Audit_Change_Log.md`
- Create: `Dev_Action_Items_v1.0.md` (transcribed from PDF)

The source content lives in the conversation that produced this plan (system message of 2026-05-16 owner package delivery). The execution agent should retrieve content from that conversation's document attachments and write each file verbatim. Only the two PDF transcripts get the format conversion noted in the index README.

- [ ] **Step 1: Write `_owner-package/README.md` (index)**

```markdown
# Owner Package · 2026-05-15

> **DO NOT EDIT.** This directory is a read-only copy of the 8 files owner delivered on 2026-05-15 to start Business Expense Module v2.0 work. If owner ships a v2.1 package, create `_owner-package-2026-XX-YY/` alongside this one.

## Files

| Filename | Original | Notes |
|---|---|---|
| `COVER_MESSAGE.md` | markdown | Cover note for AI Dev — explains the 4-phase workflow |
| `README_FOR_DEV.md` | markdown (v2 version) | Master Brief — Pre-flight Check + Mandatory Stops + Anti-patterns |
| `Implementation_Review_v2.0.html` | HTML | Executive summary + timeline + bug fixes + 5 new flows + V16-V20 + 102 settings overview |
| `expense_module_mockup_v5.html` | HTML | 13 UI screens · single source of truth for UI |
| `Settings_Audit_Index.md` | markdown | Quick overview of 102 settings, decision framework |
| `Settings_Audit_Core_v2.0.md` | **transcribed from PDF** (originally `Settings_Audit_Core_v2.0.pdf`, 12 pages) | 102 settings details with Detection Hints |
| `Settings_Audit_Change_Log.md` | markdown | v1.0 → v2.0 diff (52 → 102 items, +50 new) |
| `Dev_Action_Items_v1.0.md` | **transcribed from PDF** (originally `Dev_Action_Items_v1.0.pdf`, 32 pages) | 5 bug-fix actions with SQL queries, code patches, test cases, sign-off checklist |

## Why transcribed from PDF?

PDFs are binary — putting them in git makes them un-greppable and non-diffable. The transcripts preserve all text content (tables, code blocks, headings) in markdown form so a future Claude session can search them. The original PDFs are preserved in conversation history (2026-05-16 session); if image fidelity is ever needed, retrieve from there.

## Relationship to tracking files

The detail tracking files (`A0-*.md`, `A1-*.md`, etc.) reference back to these source documents. Don't update tracking from intuition — when in doubt, read the source here.
```

- [ ] **Step 2: Write `_owner-package/COVER_MESSAGE.md`**

Use Write tool. Content: verbatim from the conversation's `COVER_MESSAGE_FOR_DEV.md` attachment (document index 1 in the 2026-05-16 owner package message).

- [ ] **Step 3: Write `_owner-package/README_FOR_DEV.md`**

Use Write tool. Content: verbatim from the conversation's `README_FOR_DEV_v2.md` attachment.

- [ ] **Step 4: Write `_owner-package/Implementation_Review_v2.0.html`**

Use Write tool. Content: verbatim from the conversation's `Implementation_Review_v2.0.html` attachment.

- [ ] **Step 5: Write `_owner-package/expense_module_mockup_v5.html`**

Use Write tool. Content: verbatim from the conversation's `expense_module_mockup_v5.html` attachment. (~235 KB — single large Write call.)

- [ ] **Step 6: Write `_owner-package/Settings_Audit_Index.md`**

Use Write tool. Content: verbatim from the conversation's `Settings_Audit_Index.md` attachment.

- [ ] **Step 7: Write `_owner-package/Settings_Audit_Core_v2.0.md`**

Use Write tool. Content: transcribed page-by-page from the conversation's `Settings_Audit_Core_v2.0.pdf` (12 pages). Preserve:
- Title page header
- Overview + Mission 4-phase block
- 102 items table broken into P0/P1/P2/P3 sections with all Detection Hints
- Implementation Notes section
- Quick Reference: Files to Inspect (Backend + Frontend tree diagrams)
- Communication section

Add a top-of-file note: `> **Transcribed from PDF (12 pages) on 2026-05-16.** Original PDF in 2026-05-16 conversation history.`

- [ ] **Step 8: Write `_owner-package/Settings_Audit_Change_Log.md`**

Use Write tool. Content: verbatim from the conversation's `Settings_Audit_Change_Log.md` attachment.

- [ ] **Step 9: Write `_owner-package/Dev_Action_Items_v1.0.md`**

Use Write tool. Content: transcribed page-by-page from the conversation's `Dev_Action_Items_v1.0.pdf` (32 pages). Preserve:
- Cover page (status summary: 10/12 done, 5 actions remaining)
- Table of contents
- Each of Actions #1–#5 with all SQL, code patches, examples (full fidelity)
- Appendix A (Code Patches)
- Appendix B (SQL Verification Queries)
- Appendix C (Test Cases J-04, K-07, K-08)
- Appendix D (Sign-off Checklist)

Add a top-of-file note: `> **Transcribed from PDF (32 pages) on 2026-05-16.** Original PDF in 2026-05-16 conversation history.`

- [ ] **Step 10: Verify all 9 files exist**

```bash
ls -la docs/superpowers/tracking/_owner-package/ | grep -v "^total\|^d" | wc -l
```
Expected: `9` (README + 8 source files).

- [ ] **Step 11: Commit**

```bash
git add docs/superpowers/tracking/_owner-package/
git commit -m "$(cat <<'EOF'
docs(tracking): vendor owner-package source files [T0.2]

Read-only copy of 8 files from owner's 2026-05-15 delivery.
Two PDFs (Settings Audit Core, Dev Action Items) are transcribed
to markdown for grep-ability; original PDFs preserved in
conversation history.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Master `README.md` (aggregate view)

**Files:**
- Create: `docs/superpowers/tracking/README.md`

- [ ] **Step 1: Write master `README.md`**

Use Write tool to create `docs/superpowers/tracking/README.md`:

```markdown
# Business Expense Module v2.0 · Tracking Master

**Deadline:** ก่อนปิดงวด พ.ค. 2569 (grace through 5 มิ.ย. 2569 per period_grace_days)
**Started:** 2026-05-16
**Owner:** akenarin.ak@gmail.com
**Spec:** [`../specs/2026-05-16-bestchoice-expense-v2-tracking-design.md`](../specs/2026-05-16-bestchoice-expense-v2-tracking-design.md)
**Conventions:** [`_conventions.md`](_conventions.md)

## Progress Overview

| Sub-project | Items | Done | Progress | Status | Spec | Plan |
|---|---|---|---|---|---|---|
| [T0 · Tracking System](T0-tracking-system.md) | 1 | 1 | 100% | ✅ Done | [spec](../specs/2026-05-16-bestchoice-expense-v2-tracking-design.md) | [plan](../plans/2026-05-16-bestchoice-expense-v2-tracking.md) |
| [A0 · Pre-flight Verify](A0-preflight-verify.md) | 3 | 0 | 0% | ⬜ Pending | — | — |
| [A1 · Settings Audit Phase 1+2](A1-settings-audit.md) | 102 | 0 | 0% | ⬜ Pending | — | — |
| [B1 · SSO 875 Configurable](B1-sso-875.md) | 6 | 0 | 0% | ⬜ Pending | — | — |
| [B2 · Settlement Multi-line Adj](B2-settlement-adjustment.md) | 5 | 0 | 0% | ⬜ Pending | — | — |
| [B3 · Test Suite J+K](B3-test-suite.md) | 14 | 0 | 0% | ⬜ Pending | — | — |
| [C1 · Petty Cash](C1-petty-cash.md) | 8 | 0 | 0% | ⬜ Pending | — | — |
| [C2 · Payroll Custom Income/Deduction](C2-payroll-custom.md) | 7 | 0 | 0% | ⬜ Pending | — | — |
| [C3 · Reverse Dialog + V19](C3-reverse-dialog.md) | 5 | 0 | 0% | ⬜ Pending | — | — |
| [C4 · Credit Note 2-Mode](C4-credit-note-2mode.md) | 4 | 0 | 0% | ⬜ Pending | — | — |
| [D1 · Settings Audit Phase 4](D1-settings-implement.md) | TBD | 0 | 0% | 🔒 Locked (by A1) | — | — |
| **TOTAL** | **~155** | **1** | **~1%** | | | |

## 🎯 Current Focus

- **Active:** None — T0 just shipped
- **Next:** **A0 (Pre-flight Verify)** — read-only DB checks before any code change. Critical because Action #1 in Dev_Action_Items requires verifying that `adj_underpay = 52-1104` in production before any other work
- **Then:** **B1 (SSO 875)** — deadline-critical, government rule active for May 2026 close

## 📅 Timeline

From owner's suggested timeline in `_owner-package/README_FOR_DEV.md`:

| Week | Dates (BE 2569) | Focus |
|---|---|---|
| 1 | 15–21 พ.ค. | T0 ✅ → A0 → A1 scan (no code yet) |
| 2 | 22–28 พ.ค. | B1 SSO 875 + Settings P0 critical |
| 3 | 29 พ.ค. – 4 มิ.ย. | B2 + B3 + C1 + UI updates |
| 4 | 5–11 มิ.ย. | C2 / C3 / C4 + D1 + UAT + deploy |
| Deadline | 5 มิ.ย. 2569 | period_grace_days = 5 cutoff |

## 📚 Source Documents (Owner Package · 2026-05-15)

All under [`_owner-package/`](_owner-package/):
- [Cover Message](`_owner-package/COVER_MESSAGE.md`)
- [README_FOR_DEV v2](`_owner-package/README_FOR_DEV.md`) — Pre-flight Check, Mandatory Stops, Anti-patterns
- [Implementation Review v2.0](`_owner-package/Implementation_Review_v2.0.html`) — Executive summary
- [Mockup v5](`_owner-package/expense_module_mockup_v5.html`) — 13 UI screens, single source of truth
- [Settings Audit Index](`_owner-package/Settings_Audit_Index.md`)
- [Settings Audit Core v2.0](`_owner-package/Settings_Audit_Core_v2.0.md`) — 102 items with Detection Hints
- [Settings Audit Change Log](`_owner-package/Settings_Audit_Change_Log.md`) — v1.0 → v2.0 diff
- [Dev Action Items v1.0](`_owner-package/Dev_Action_Items_v1.0.md`) — 5 bug-fix actions

## 🚫 Hard Gates (from owner workflow)

These gates MUST NOT be skipped:
- **Phase 1 AUDIT → STOP** → await owner confirm before Phase 2
- **Phase 2 REPORT → STOP** → await owner approval of scope before Phase 4
- **Phase 4 IMPLEMENT** → one PR per item, no bundling

Anti-patterns to avoid (from `_owner-package/README_FOR_DEV.md`):
1. Chaining Phase 1 → Phase 2 in the same response
2. Implementing settings while still in AUDIT
3. Bundling multiple items in one PR
4. Acting before Pre-flight Check answered
5. Assuming owner's answers

## 🔄 How to update this file

Per `_conventions.md` atomic-diff rule:
- PRs that flip a sub-project item from `🟡` → `✅` MUST update the matching row's `Done` and `Progress` columns here in the same diff
- PRs that change sub-project Status (e.g. `⬜ Pending` → `🟡 In Progress`) update the `Status` column
- Specs and Plans get linked in their columns the first PR that creates them
- TOTAL row updates on every change

If you forgot to update this file in a PR, open a follow-up `chore(tracking): backfill progress for [Xn.Y]` PR.
```

- [ ] **Step 2: Verify content + linkage**

```bash
grep -c "^|" docs/superpowers/tracking/README.md
grep "T0 · Tracking System" docs/superpowers/tracking/README.md
```
Expected: at least 13 table rows; T0 row present with ✅ Done.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/tracking/README.md
git commit -m "$(cat <<'EOF'
docs(tracking): add master README with 11-row progress overview [T0.3]

Aggregate view of T0 + 10 sub-projects, timeline,
source docs, and hard gates.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `T0-tracking-system.md` (self-referential, ships marked ✅)

**Files:**
- Create: `docs/superpowers/tracking/T0-tracking-system.md`

- [ ] **Step 1: Write file**

Use Write tool to create `docs/superpowers/tracking/T0-tracking-system.md`:

```markdown
# T0 · Tracking System

**Status:** ✅ Done  |  **Started:** 2026-05-16  |  **PRs:** (this seeding PR)
**Spec:** [2026-05-16-bestchoice-expense-v2-tracking-design.md](../specs/2026-05-16-bestchoice-expense-v2-tracking-design.md)
**Plan:** [2026-05-16-bestchoice-expense-v2-tracking.md](../plans/2026-05-16-bestchoice-expense-v2-tracking.md)

## Context

Establishes the tracking infrastructure for Business Expense Module v2.0 work — markdown hub-and-spoke in `docs/superpowers/tracking/` with master `README.md`, `_conventions.md`, 11 sub-project detail files, and `_owner-package/` read-only copy of owner's 8 source documents.

T0 is itself the first sub-project. It ships marked ✅ Done as soon as all files exist and the master `README.md` shows correct counts.

## Source

- Owner's brainstorming question: "ทำยังไงให้ไม่ลืมว่าต้องทำอะไรบ้าง" (2026-05-16)
- Brainstorming session decisions:
  - Markdown in repo (over GitHub Issues)
  - Hub-and-spoke layout (over single mega-file)
  - Atomic-diff update rule

## Items Checklist

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| T0.1 | Bootstrap directory + `_conventions.md` | P0 | ✅ Done | (seeding) | Created `_conventions.md` with status emoji, priority labels, ID format, PR title format, atomic-diff rule |
| T0.2 | Vendor owner-package source files | P0 | ✅ Done | (seeding) | 8 files in `_owner-package/` + index README; 2 PDFs transcribed |
| T0.3 | Master `README.md` with 11-row overview | P0 | ✅ Done | (seeding) | Progress table, current focus, timeline, hard gates |
| T0.4 | 11 detail files seeded with concrete items | P0 | ✅ Done | (seeding) | T0 + A0 + A1 (102 items) + B1 (6) + B2 (5) + B3 (14) + C1 (8) + C2 (7) + C3 (5) + C4 (4) + D1 (locked placeholder) |
| T0.5 | Acceptance criteria verified | P0 | ✅ Done | (seeding) | All 6 criteria from spec section "Acceptance criteria" pass |

## Decision Log

- **2026-05-16:** Picked Option A (markdown in repo) over Option B (GitHub Issues). Reasons: pattern-match with existing `specs/`+`plans/`+`memory/`, cross-session continuity via single-file `README.md` read, GitHub Actions budget block creates risk for B
- **2026-05-16:** Picked Option B (hub-and-spoke) over Option A (1 mega-file). Reasons: merge-conflict surface across 4-week parallel PR streams, fresh-session token cost
- **2026-05-16:** Decomposed v2.0 work into 10 sub-projects (T0/A0/A1/B1/B2/B3/C1/C2/C3/C4/D1) instead of one mega-spec — owner-package scope (~155 items, ~30–40 PRs) exceeded single-spec capacity
- **2026-05-16:** PDFs transcribed to `.md` in `_owner-package/` instead of vendored as binary. Binary PDFs are un-greppable and un-diffable in git

## Open Questions

(none — T0 fully specified by spec)

## What this unlocks

- A0 can start (Pre-flight Verify) — its tracking file is seeded and ready
- B1, A1 can start in parallel once A0 completes
- Every future PR has a row to mark ✅ on merge
```

- [ ] **Step 2: Verify**

```bash
grep "T0\." docs/superpowers/tracking/T0-tracking-system.md | wc -l
```
Expected: 5+ matches (T0.1 through T0.5 in the items table).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/tracking/T0-tracking-system.md
git commit -m "$(cat <<'EOF'
docs(tracking): add T0 detail file (self-referential, marked done) [T0.4]

T0 ships ✅ Done as soon as scaffolding is complete.
Decision log captures markdown-vs-issues and hub-vs-mega choices.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `A0-preflight-verify.md`

**Files:**
- Create: `docs/superpowers/tracking/A0-preflight-verify.md`

- [ ] **Step 1: Write file**

Use Write tool to create `docs/superpowers/tracking/A0-preflight-verify.md`:

```markdown
# A0 · Pre-flight Verify

**Status:** ⬜ Pending  |  **Started:** —  |  **PRs:** —
**Deadline:** before any code change in v2.0 work
**Spec:** —  ·  **Plan:** —

## Context

Three production-DB checks that MUST run before any v2.0 code change. These verify the assumed starting state of `account_role_map`, SSO historical data, and depreciation cron output. If any check fails, downstream sub-projects (B1, C2, etc.) have wrong assumptions baked in.

A0 has no code deliverable — it's `psql` queries against prod + recovery actions if discrepancies found.

## Source

- [Dev Action Items v1.0](`_owner-package/Dev_Action_Items_v1.0.md`) Action #1 (page 3), #3 (page 12), #5 (page 19)

## Items Checklist

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A0.1 | Verify `adj_underpay = 52-1104` in prod `account_role_map` | P0 | ⬜ | — | Run Dev Action #1 Step 1 SQL on prod. If row says `53-1503` (the old wrong value), run Step 2 UPDATE and create adjusting JEs per Step 3+4 |
| A0.2 | Reclassify SSO catch-up — `21-1104` rows still containing `%SSO%` or `%ประกันสังคม%` | P1 | ⬜ | — | Run Dev Action #3 Section 3.2 verification query on prod. If count > 0, apply Dev Action #3 Section 3.3 cleanup migration |
| A0.3 | Recover missing depreciation JEs for งวด มี.ค.–เม.ย. 2569 | P1 | ⬜ | — | Run Dev Action #5 Section 5.2 query on prod. If count = 0, run Option A (`POST /depreciation/run` for each missing period) per Section 5.3 |

## Phase

🟢 No phase gate — these are read-only verifications + targeted recoveries. Each item is independent and can run in any order.

## Decision Log

- **2026-05-16:** A0 placed before B1 because Action #1 (adj_underpay routing) could affect any future SETTLEMENT/EXP that uses an adjustment — must be correct before B2 lands

## Open Questions

- [ ] Q: Owner approval required to run UPDATE on prod `account_role_map` if Step 1 finds a discrepancy?
- [ ] Q: For A0.3 (depreciation recovery) — Option A (POST /depreciation/run) requires the endpoint to exist; if not, fall back to Option B manual adjusting JEs
- [ ] Q: A0.2 — does memory note "PR #810 reclassify SSO" already cover all rows? Need verification query result first

## Dependencies

- ✅ T0 (tracking infrastructure exists)
- Requires: production DB read access; OWNER_TOKEN for `POST /depreciation/run` if A0.3 falls back to API
```

- [ ] **Step 2: Verify**

```bash
grep "^| A0\." docs/superpowers/tracking/A0-preflight-verify.md | wc -l
```
Expected: `3`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/tracking/A0-preflight-verify.md
git commit -m "docs(tracking): seed A0 pre-flight verify (3 items) [T0.4]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `A1-settings-audit.md` (large file — 102 items)

**Files:**
- Create: `docs/superpowers/tracking/A1-settings-audit.md`

- [ ] **Step 1: Write file**

Use Write tool. Content structure:

```markdown
# A1 · Settings Audit Phase 1+2 (Scan + Report)

**Status:** ⬜ Pending  |  **Started:** —  |  **PRs:** —
**Spec:** —  ·  **Plan:** —

## Context

Run a read-only scan of the codebase against the 102 settings owner enumerated in `Settings_Audit_Core_v2.0`. For each item, mark ✅ Exists / ❌ Missing / ◐ Partial with a file:line evidence pointer. Phase 2 produces a markdown summary table. **Hard stop** at end of Phase 2 — owner reviews and approves which items go into D1 (Phase 4 Implement) before any code change happens.

## Source

- [Settings Audit Core v2.0](`_owner-package/Settings_Audit_Core_v2.0.md`) — 102 items with Detection Hints
- [Settings Audit Index](`_owner-package/Settings_Audit_Index.md`) — overview + decision framework
- [Settings Audit Change Log](`_owner-package/Settings_Audit_Change_Log.md`) — v1.0 → v2.0 diff

## Phase

🚦 **Phase 1: AUDIT** (not started) → Phase 2: REPORT → 🛑 **STOP** for owner approval → D1 (Phase 4: IMPLEMENT)

Anti-pattern reminder: do **not** implement settings while scanning. AUDIT is read-only.

## Decision Framework (from `_owner-package/Settings_Audit_Index.md`)

After Phase 2 produces results, owner decides per sub-section:
- ✅ APPROVE: P0 ≥ 80% missing + P1 ≥ 50% missing → implement
- ◐ DEFER: P0 ≥ 50% missing but P1 < 50% → P0 only this sprint
- ⏸ SKIP: P0 < 50% missing → system already covers

## Items Checklist

> **102 items total.** Numbering preserves owner's source format: `A1.<section>.<subsection>.<item>` maps to Settings Audit Core `<section>.<subsection>` heading.

### 1.1 Account Role Map (7 items · P0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.1.1.1 | DB table: `account_role_map` | P0 | ⬜ | — | Hint: ตรวจ migration files + schema |
| A1.1.1.2 | `GET /api/settings/role-map` | P0 | ⬜ | — | Hint: ตรวจ controller |
| A1.1.1.3 | `PUT /api/settings/role-map` | P0 | ⬜ | — | Hint: ตรวจ controller |
| A1.1.1.4 | Admin UI for role map | P0 | ⬜ | — | Hint: ตรวจ React component |
| A1.1.1.5 | Validation rules | P0 | ⬜ | — | Hint: ตรวจ validator |
| A1.1.1.6 | Audit log on change | P0 | ⬜ | — | Hint: ตรวจ audit table |
| A1.1.1.7 | Permission control (Admin only) | P0 | ⬜ | — | Hint: ตรวจ middleware |

### 1.2 Document Numbering (5 items · P0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.1.2.1 | `doc_prefix_per_type` (EXP/SET/PAY/CN/PC) | P0 | ⬜ | — | Hint: enum DocType |
| A1.1.2.2 | `doc_number_format` (YYMMNNN) | P0 | ⬜ | — | Hint: doc generator |
| A1.1.2.3 | `reset_cycle` (yearly) | P0 | ⬜ | — | Hint: sequence reset logic |
| A1.1.2.4 | `sequence_table` (doc_sequences) | P0 | ⬜ | — | Hint: schema |
| A1.1.2.5 | Admin reset capability | P0 | ⬜ | — | Hint: admin route |

### 1.3 Tax Rates (6 items · P0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.1.3.1 | `vat_rate` (7%) | P0 | ⬜ | — | Hint: tax_rates table |
| A1.1.3.2 | `wht_rates` (1/3/5/10/15) | P0 | ⬜ | — | Hint: wht_rate enum |
| A1.1.3.3 | `sso_rate` (5%) | P0 | ⬜ | — | Hint: payroll calculator |
| A1.1.3.4 | `sso_max` (refined → 1.4) | P0 | ⬜ | — | See section 1.4 |
| A1.1.3.5 | effective_date support | P0 | ⬜ | — | Hint: schema มี effective_from |
| A1.1.3.6 | Admin UI | P0 | ⬜ | — | Hint: /settings/tax-rates |

### 1.4 SSO Configurable (4 items · P0 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.1.4.1 | `sso_salary_ceiling` (17,500 ฿ default 2569) | P0 | ⬜ | — | Hint: ค้นหา `15000` hard-coded — likely ❌ |
| A1.1.4.2 | `sso_max_contribution` (875 ฿ default 2569) | P0 | ⬜ | — | Hint: ค้นหา `750` hard-coded — likely ❌ |
| A1.1.4.3 | `sso_effective_from`/`to` | P0 | ⬜ | — | Hint: ตรวจ schema |
| A1.1.4.4 | Stepped ceiling support (2569 → 2572 → 2575) | P0 | ⬜ | — | Hint: historical query |

### 1.5 Petty Cash (5 items · P0 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.1.5.1 | `petty_cash_enabled` (true default) | P0 | ⬜ | — | Hint: feature flag |
| A1.1.5.2 | `petty_cash_account` (11-1103) | P0 | ⬜ | — | Hint: CoA |
| A1.1.5.3 | `petty_cash_limit` (5,000 ฿) | P0 | ⬜ | — | Hint: V20 implementation |
| A1.1.5.4 | `petty_cash_replenish_threshold` (1,000 ฿) | P0 | ⬜ | — | Hint: alert logic |
| A1.1.5.5 | `petty_cash_custodian` (employee FK) | P0 | ⬜ | — | Hint: user assignment |

### 1.6 Adjustment Routing (3 items · P0 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.1.6.1 | `adj_underpay_account` (52-1104) | P0 | ⬜ | — | Hint: `getDefaultAdjustmentAccount()` |
| A1.1.6.2 | `adj_overpay_account` (53-1503) | P0 | ⬜ | — | Hint: direction handling |
| A1.1.6.3 | `adj_auto_route` (true) | P0 | ⬜ | — | Hint: auto-route logic |

### 2.1 Approval Workflow (6 items · P1)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.2.1.1 | `approval_enabled` | P1 | ⬜ | — | Hint: feature flag |
| A1.2.1.2 | `approval_threshold` (50,000 ฿) | P1 | ⬜ | — | Hint: amount check |
| A1.2.1.3 | `approvers_list` (user IDs) | P1 | ⬜ | — | Hint: approvers table |
| A1.2.1.4 | `approval_required_doc_types` ([PAYROLL]) | P1 | ⬜ | — | Hint: enum check |
| A1.2.1.5 | `notification_on_pending` (email + in-app) | P1 | ⬜ | — | Hint: notifier |
| A1.2.1.6 | `auto_post_on_approve` (true) | P1 | ⬜ | — | Hint: status flow |

### 2.2 Voucher Branding (7 items · P1)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.2.2.1 | `company_name` (from profile) | P1 | ⬜ | — | Hint: company table |
| A1.2.2.2 | `company_address` (from profile) | P1 | ⬜ | — | Hint: address fields |
| A1.2.2.3 | `tax_id` (from profile) | P1 | ⬜ | — | Hint: tax_id field |
| A1.2.2.4 | `logo_url` (uploaded) | P1 | ⬜ | — | Hint: assets |
| A1.2.2.5 | `theme_color` (#F87171) | P1 | ⬜ | — | Hint: theme config |
| A1.2.2.6 | `language` (th) | P1 | ⬜ | — | Hint: i18n |
| A1.2.2.7 | `show_qr_code` (true) | P1 | ⬜ | — | Hint: voucher template |

### 2.3 Display Preferences (6 items · P1)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.2.3.1 | `default_time_range` (this_month) | P1 | ⬜ | — | Hint: ListPage default |
| A1.2.3.2 | `pagination_size` (20) | P1 | ⬜ | — | Hint: table component |
| A1.2.3.3 | `date_format` (DD/MM/YYYY) | P1 | ⬜ | — | Hint: i18n |
| A1.2.3.4 | `decimal_places` (2) | P1 | ⬜ | — | Hint: formatter |
| A1.2.3.5 | `thousands_separator` (,) | P1 | ⬜ | — | Hint: formatter |
| A1.2.3.6 | `per_user_override` (true) | P1 | ⬜ | — | Hint: user_preferences |

### 2.4 Templates Management (5 items · P1)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.2.4.1 | `templates_enabled` (true) | P1 | ⬜ | — | Hint: feature flag |
| A1.2.4.2 | `max_templates_per_user` (50) | P1 | ⬜ | — | Hint: limit |
| A1.2.4.3 | `sharing_rules` (private) | P1 | ⬜ | — | Hint: ACL |
| A1.2.4.4 | `variables_support` (true) | P1 | ⬜ | — | Hint: template engine |
| A1.2.4.5 | `categories` (list) | P1 | ⬜ | — | Hint: category table |

### 2.5 Voucher Print Modes (3 items · P1 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.2.5.1 | `voucher_print_mode_default` (single) | P1 | ⬜ | — | Hint: VoucherPrintComponent |
| A1.2.5.2 | `voucher_include_adjustment` (false) | P1 | ⬜ | — | Hint: template |
| A1.2.5.3 | `voucher_show_partial_columns` (true) | P1 | ⬜ | — | Hint: partial display |

### 2.6 Date & Period Controls (4 items · P1 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.2.6.1 | `period_close_day` (31, สิ้นเดือน) | P1 | ⬜ | — | Hint: period logic |
| A1.2.6.2 | `period_grace_days` (5) | P1 | ⬜ | — | Hint: effective close date |
| A1.2.6.3 | `payment_date_warning_backdate` (30 days) | P1 | ⬜ | — | Hint: V19 warning |
| A1.2.6.4 | `payment_date_allow_future` (true) | P1 | ⬜ | — | Hint: scheduled payment |

### 2.7 Reverse Entry (4 items · P1 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.2.7.1 | `reverse_reason_required` (true) | P1 | ⬜ | — | Hint: form validation |
| A1.2.7.2 | `reverse_reasons_dropdown` (6 options) | P1 | ⬜ | — | Hint: enum/config |
| A1.2.7.3 | `reverse_manager_approval_days` (7) | P1 | ⬜ | — | Hint: approval trigger |
| A1.2.7.4 | `reverse_block_cascaded` (true) | P1 | ⬜ | — | Hint: child docs check |

### 2.8 Custom Income/Deduction (2 items · P1 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.2.8.1 | `custom_income_accounts_whitelist` (53-XXXX) | P1 | ⬜ | — | Hint: V17 implementation |
| A1.2.8.2 | `tax_exempt_warning_enabled` (true) | P1 | ⬜ | — | Hint: UI warning ม.42 |

### 3.1 Notifications (4 items · P2)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.3.1.1 | `draft_alerts_enabled` (true) | P2 | ⬜ | — | Hint: scheduled job |
| A1.3.1.2 | `ap_due_alerts` (true) | P2 | ⬜ | — | Hint: aging logic |
| A1.3.1.3 | `email_provider` (sendgrid) | P2 | ⬜ | — | Hint: config |
| A1.3.1.4 | `in_app_notifications` (true) | P2 | ⬜ | — | Hint: notification table |

### 3.2 User Permissions RBAC (4 items · P2)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.3.2.1 | `roles_defined` (Owner/Manager/Accountant/Viewer) | P2 | ⬜ | — | Hint: roles table |
| A1.3.2.2 | `settings_access_role` (Owner only) | P2 | ⬜ | — | Hint: ACL |
| A1.3.2.3 | `post_permission` (role-based) | P2 | ⬜ | — | Hint: middleware |
| A1.3.2.4 | `reverse_permission` (Manager+) | P2 | ⬜ | — | Hint: middleware |

### 3.3 Integration (4 items · P2)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.3.3.1 | `export_enabled` (CSV+Excel+PDF) | P2 | ⬜ | — | Hint: export endpoints |
| A1.3.3.2 | `bank_reconciliation` (manual) | P2 | ⬜ | — | Hint: recon module |
| A1.3.3.3 | `webhooks` (disabled) | P2 | ⬜ | — | Hint: webhook config |
| A1.3.3.4 | `api_keys` (admin only) | P2 | ⬜ | — | Hint: API key management |

### 3.4 Smart Switch (2 items · P2 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.3.4.1 | `smart_doctype_switch_enabled` (true) | P2 | ⬜ | — | Hint: EntryPage logic |
| A1.3.4.2 | `smart_switch_threshold_days` (0) | P2 | ⬜ | — | Hint: trigger condition |

### 3.5 Expense Summary (3 items · P2 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.3.5.1 | `summary_default_range` (today) | P2 | ⬜ | — | Hint: ExpenseSummary default |
| A1.3.5.2 | `summary_all_range_warning` (true) | P2 | ⬜ | — | Hint: warning UI |
| A1.3.5.3 | `summary_pagination_size` (50) | P2 | ⬜ | — | Hint: pagination |

### 3.6 Multi-bill Picker (3 items · P2 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.3.6.1 | `settlement_max_bills_per_doc` (100) | P2 | ⬜ | — | Hint: V12 limit |
| A1.3.6.2 | `settlement_default_tick_behavior` (none) | P2 | ⬜ | — | Hint: UI default |
| A1.3.6.3 | `settlement_partial_payment_enabled` (true) | P2 | ⬜ | — | Hint: partial logic |

### 4.1 UI & UX Defaults (4 items · P3)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.4.1.1 | `sidebar_collapsed` (false) | P3 | ⬜ | — | preference per user |
| A1.4.1.2 | `show_keyboard_shortcuts` (true) | P3 | ⬜ | — | help tooltip |
| A1.4.1.3 | `animation_enabled` (true) | P3 | ⬜ | — | accessibility |
| A1.4.1.4 | `dark_mode` (true) | P3 | ⬜ | — | default theme |

### 4.2 Performance Tuning (5 items · P3)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.4.2.1 | `query_timeout_seconds` (30) | P3 | ⬜ | — | long-running queries |
| A1.4.2.2 | `cache_ttl_dashboard` (60s) | P3 | ⬜ | — | dashboard counts |
| A1.4.2.3 | `cache_ttl_reports` (300s) | P3 | ⬜ | — | aggregated reports |
| A1.4.2.4 | `batch_size_import` (500) | P3 | ⬜ | — | CSV import |
| A1.4.2.5 | `max_concurrent_jobs` (5) | P3 | ⬜ | — | background queue |

### 4.3 Audit & Compliance (6 items · P3)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.4.3.1 | `audit_log_retention_days` (1825 = 5 ปี) | P3 | ⬜ | — | พ.ร.บ.บัญชี ม.7 |
| A1.4.3.2 | `audit_log_archive` (enabled) | P3 | ⬜ | — | archive ก่อนลบ |
| A1.4.3.3 | `document_retention_years` (5) | P3 | ⬜ | — | กฎหมายไทย |
| A1.4.3.4 | `data_export_format` (JSON) | P3 | ⬜ | — | compliance backup |
| A1.4.3.5 | `pii_masking` (enabled) | P3 | ⬜ | — | PDPA |
| A1.4.3.6 | `login_log` (enabled) | P3 | ⬜ | — | security |

## Item count verification

- 1.1–1.6 (P0): 7+5+6+4+5+3 = **30** ✓
- 2.1–2.8 (P1): 6+7+6+5+3+4+4+2 = **37** ✓
- 3.1–3.6 (P2): 4+4+4+2+3+3 = **20** ✓
- 4.1–4.3 (P3): 4+5+6 = **15** ✓
- **Total: 102** ✓

## Decision Log

(empty — fills during audit)

## Open Questions

(empty — fills during audit)

## Dependencies

- ✅ T0 (tracking infrastructure exists)
- A0 should complete first (Pre-flight Verify) so audit doesn't include stale data
- After Phase 2 reports, owner approves scope → D1 (Phase 4) begins
```

- [ ] **Step 2: Verify item count**

```bash
grep -c "^| A1\." docs/superpowers/tracking/A1-settings-audit.md
```
Expected: `102`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/tracking/A1-settings-audit.md
git commit -m "docs(tracking): seed A1 settings audit (102 items) [T0.4]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `B1-sso-875.md`

**Files:**
- Create: `docs/superpowers/tracking/B1-sso-875.md`

- [ ] **Step 1: Write file**

```markdown
# B1 · SSO 875 Configurable + Effective Date

**Status:** ⬜ Pending  |  **Started:** —  |  **PRs:** —
**Deadline:** ก่อนปิดงวด พ.ค. 2569 (5 มิ.ย. 2569 grace)
**Spec:** —  ·  **Plan:** —

## Context

Thai government raised SSO salary ceiling from 15,000 ฿ to 17,500 ฿ effective 1 Jan 2026 — employee SSO contribution caps at 875 ฿/month (was 750 ฿). The codebase has 750/15000 hard-coded in DTO `@Max`, payroll calculator, tests, and CoA CSV comments. Lift these to a config table with `effective_from`/`effective_to` so future ceiling changes (2572 → 1000, 2575 → 1150) don't require code edits.

**Legal urgency:** any payroll posted for May 2026 close that uses 750 cap is non-compliant with the new กฎกระทรวง.

## Source

- [Settings Audit Core](`_owner-package/Settings_Audit_Core_v2.0.md`) §1.4 (4 items)
- [Implementation Review](`_owner-package/Implementation_Review_v2.0.html`) "SSO เพดานใหม่ ปี 2569"
- [Mockup v5](`_owner-package/expense_module_mockup_v5.html`) page 02B PayrollPage Section 3

## Items Checklist

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| B1.1 | Add `sso_config` table or extend `system_config` with ceiling + max_contribution + effective_from/to | P0 | ⬜ | — | Files: `apps/api/prisma/schema.prisma` + new migration |
| B1.2 | Lift `@Max(750)` from `CreatePayrollDto` — replace with service-side check that queries config by `payment_date` | P0 | ⬜ | — | File: `apps/api/src/modules/expense-documents/dto/create-payroll.dto.ts:44` |
| B1.3 | Search-and-replace hardcoded `750`/`15000` in calculator + service. Result must come from config table | P0 | ⬜ | — | Search: `grep -rn "750\|15000" apps/api/src/modules/expense-documents apps/api/src/modules/payroll` |
| B1.4 | Migration: seed 3 config rows (2569: 17500/875, 2572: 20000/1000, 2575: 23000/1150) | P0 | ⬜ | — | Stepped ceiling support per Settings Audit §1.4.4 |
| B1.5 | Update fixtures: payroll spec files (`payroll.service.spec.ts`, `payroll-lifecycle.integration.spec.ts`, `full-lifecycle.integration.spec.ts`, `cn-lifecycle.integration.spec.ts`, `settlement-lifecycle.integration.spec.ts`, `multi-line-lifecycle.integration.spec.ts`) — replace hardcoded 750 with 875 (or compute from config) | P0 | ⬜ | — | At least 6 spec files reference `ssoEmployee: 750` |
| B1.6 | Update CoA CSV comments (`finance-coa.csv` rows 56-57 say "เพดาน 750" — change to "เพดาน 875 (ปี 2569+)") | P1 | ⬜ | — | File: `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv:56-57` |

## Phase

No phase gate — straight implementation. Each item is its own PR.

## Decision Log

(empty)

## Open Questions

- [ ] Q: Use new `sso_config` table or extend existing `system_config` key-value store?
- [ ] Q: `payment_date` lookup — pin to the payment date in DTO, or to `documentDate` of the EX_PAYROLL row?
- [ ] Q: Backward compat for in-flight payroll docs created with 750 cap before this PR lands — leave as-is or re-stamp?

## Dependencies

- ✅ T0 (tracking infrastructure exists)
- ⬜ A0.1 (verify adj_underpay) and A0.2 (SSO reclassify) should complete first to avoid mixing changes

## Related items in other sub-projects

- A1.1.4.1 / A1.1.4.2 / A1.1.4.3 / A1.1.4.4 — the Settings Audit row IDs that map to B1
- B3 Suite J — J-04 test expects `calculateSSO(20000) = 750` and J-05 expects `calculateSSO(15000) = 750`. These tests are wrong under 875 cap — must update in B3
```

- [ ] **Step 2: Verify**

```bash
grep -c "^| B1\." docs/superpowers/tracking/B1-sso-875.md
```
Expected: `6`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/tracking/B1-sso-875.md
git commit -m "docs(tracking): seed B1 SSO 875 configurable (6 items) [T0.4]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `B2-settlement-adjustment.md`

**Files:**
- Create: `docs/superpowers/tracking/B2-settlement-adjustment.md`

- [ ] **Step 1: Write file**

```markdown
# B2 · Settlement Multi-line Adjustment (V12 expansion)

**Status:** ⬜ Pending  |  **Started:** —  |  **PRs:** —
**Spec:** —  ·  **Plan:** —

## Context

V12 currently validates adjustment sums for `EXPENSE_SAMEDAY` only (`Σ adjustments = amountPaid − netExpected`). Dev Action #2 extends V12 to cover `VENDOR_SETTLEMENT` and adds adjustment lines to `VendorSettlementTemplate`. Real-world need: supplier gives a discount at settlement time, or there's a small rounding diff after WHT — both should flow through Section 5 (Multi-line Adjustment) in `ExpenseFormV4`.

## Source

- [Dev Action Items](`_owner-package/Dev_Action_Items_v1.0.md`) Action #2
- [Mockup v5](`_owner-package/expense_module_mockup_v5.html`) page 02A SettlementPage Section 5

## Items Checklist

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| B2.1 | V12 validator: extend switch to include `VENDOR_SETTLEMENT` case computing `netExpected = apTotal − wht` | P1 | ⬜ | — | File: `apps/api/src/modules/expense-documents/expense-documents.service.ts` (search for "V12") |
| B2.2 | `VendorSettlementTemplate.execute` — emit adjustment lines from `settlement.adjustments[]` after WHT line | P1 | ⬜ | — | File: `apps/api/src/modules/journal/cpa-templates/vendor-settlement.template.ts` |
| B2.3 | DB schema: ensure `expense_adjustments` table has FK to `expense_documents` that accepts `VENDOR_SETTLEMENT` rows. If a CHECK constraint restricts doc_type, relax it per Dev Action #2 §2.4 | P1 | ⬜ | — | Run `\d expense_adjustments` against dev DB to verify |
| B2.4 | Frontend: add Section 5 (Multi-line Adjustment) to SettlementForm — reuse `AdjustmentTable` component from ExpenseFormV4 | P1 | ⬜ | — | File: `apps/web/src/components/expense-form-v4/SettlementLinesSection.tsx` (add new section beneath) |
| B2.5 | K-07 test case: SETTLEMENT + adjustment results in balanced JE with `52-1104` Cr line | P1 | ⬜ | — | Tracks B3.K-07. File: `apps/api/src/modules/expense-documents/__tests__/settlement-lifecycle.integration.spec.ts` |

## Decision Log

(empty)

## Open Questions

- [ ] Q: Should the schema migration in B2.3 happen — or does the FK already allow polymorphic doc_type? Need `\d` output first
- [ ] Q: SettlementForm Section 5 — should the section appear before or after JE Preview?

## Dependencies

- ✅ T0
- B2.5 depends on test infrastructure (B3 Suite K)
```

- [ ] **Step 2: Verify**

```bash
grep -c "^| B2\." docs/superpowers/tracking/B2-settlement-adjustment.md
```
Expected: `5`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/tracking/B2-settlement-adjustment.md
git commit -m "docs(tracking): seed B2 settlement adjustment (5 items) [T0.4]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `B3-test-suite.md`

**Files:**
- Create: `docs/superpowers/tracking/B3-test-suite.md`

- [ ] **Step 1: Write file**

```markdown
# B3 · Test Suite J + K

**Status:** ⬜ Pending  |  **Started:** —  |  **PRs:** —
**Spec:** —  ·  **Plan:** —

## Context

Verify and complete two test suites covering critical accounting invariants:
- **Suite J:** SSO accounting (6 cases) — addresses Action #4 with updated J-04 expecting `875` (post-B1) instead of `750`
- **Suite K:** Critical fixes verification (8 cases including new K-07 for SETTLEMENT adjustment and K-08 for adjustment direction routing)

Some cases already exist scattered across `apps/api/src/modules/expense-documents/__tests__/` — this sub-project consolidates and adds the missing ones.

## Source

- [Dev Action Items](`_owner-package/Dev_Action_Items_v1.0.md`) Action #4 + Appendix C

## Items Checklist · Suite J (SSO Accounting)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| B3.J-01 | PAYROLL JV — `Cr 21-3105 = sso_employee_amount` | P2 | ⬜ | — | Should exist in payroll-lifecycle spec |
| B3.J-02 | PAYROLL JV — `Cr 21-3106 = sso_employer_amount` | P2 | ⬜ | — | Should exist in payroll-lifecycle spec |
| B3.J-03 | PAYROLL JV — `Dr 53-1102 = sso_employer_amount` | P2 | ⬜ | — | Should exist in payroll-lifecycle spec |
| B3.J-04 | `calculateSSO(20000)` returns **875** (ceiling, post-B1) | P2 | ⬜ | — | Currently expects 750 — must update after B1 lands |
| B3.J-05 | `calculateSSO(10000)` returns **500** (5% of base) | P2 | ⬜ | — | Below ceiling — unaffected by B1 |
| B3.J-06 | Trial Balance — `21-1104` no longer contains SSO rows | P2 | ⬜ | — | Tracks A0.2 reclassify; query asserts count = 0 |

## Items Checklist · Suite K (Critical Fixes)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| B3.K-01 | Every JV with VAT > 0 uses `Dr 11-4101` (not `11-2104`) | P2 | ⬜ | — | Anti-regression for ม.83/6 mis-routing |
| B3.K-02 | ACCRUAL JV1 with WHT > 0 throws V15 `BadRequestException` | P2 | ⬜ | — | Should already exist — verify |
| B3.K-03 | SETTLEMENT JV of an ACCRUAL with WHT — WHT lands on settlement leg | P2 | ⬜ | — | Verify routing via vendor-settlement template spec |
| B3.K-04 | ภ.พ.30 export uses `11-4101` balance for input VAT refund | P2 | ⬜ | — | Verify via tax module spec |
| B3.K-05 | Multi-line Adjustment with `diff = 0` POSTs successfully | P2 | ⬜ | — | Edge case |
| B3.K-06 | Multi-line Adjustment with `Σ amount ≠ |diff|` throws V12 | P2 | ⬜ | — | Should already exist |
| B3.K-07 | SETTLEMENT + adjustment results in balanced JE | P2 | ⬜ | — | NEW — depends on B2.5 |
| B3.K-08 | Direction routing: `diff < 0` → `52-1104` (underpay); `diff > 0` → `53-1503` (overpay) | P2 | ⬜ | — | NEW — verifies Dev Action #1 fix |

## Decision Log

(empty)

## Open Questions

- [ ] Q: Should B3 verify existing tests pass before adding new ones, or assume passing main + add new on top?
- [ ] Q: B3.J-04 — update test expectation in same PR as B1.5, or here separately?

## Dependencies

- ✅ T0
- B1.5 (fixture update) overlaps with B3.J-04 — coordinate ordering
- B2.5 maps directly to B3.K-07

## Test file paths (reference)

- `apps/api/src/modules/expense-documents/__tests__/payroll.service.spec.ts`
- `apps/api/src/modules/expense-documents/__tests__/payroll-lifecycle.integration.spec.ts`
- `apps/api/src/modules/expense-documents/__tests__/settlement-lifecycle.integration.spec.ts`
- `apps/api/src/modules/expense-documents/__tests__/full-lifecycle.integration.spec.ts`
- `apps/api/src/modules/expense-documents/__tests__/cn-lifecycle.integration.spec.ts`
- `apps/api/src/modules/expense-documents/__tests__/multi-line-lifecycle.integration.spec.ts`
- `apps/api/src/modules/expense-documents/__tests__/create-payroll.dto.spec.ts`
```

- [ ] **Step 2: Verify**

```bash
grep -c "^| B3\." docs/superpowers/tracking/B3-test-suite.md
```
Expected: `14`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/tracking/B3-test-suite.md
git commit -m "docs(tracking): seed B3 test suite J+K (14 items) [T0.4]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: `C1-petty-cash.md`

**Files:**
- Create: `docs/superpowers/tracking/C1-petty-cash.md`

- [ ] **Step 1: Write file**

```markdown
# C1 · Petty Cash Reimbursement

**Status:** ⬜ Pending  |  **Started:** —  |  **PRs:** —
**Spec:** —  ·  **Plan:** —

## Context

New `PETTY_CASH_REIMBURSEMENT` doc_type for small-cash workflow: custodian advances petty cash, employees submit multiple receipts (different suppliers, possibly different VAT rates) on one document. Existing doc_types enforce single-supplier-per-document; petty cash relaxes this with `supplier_per_line`. V20 enforces invariants (total ≤ limit, every line has supplier, Cr account = 11-1201 not 11-1103).

JE shape: Dr each `53-XXXX` per line + Dr `11-4101` for VATable lines / Cr `11-1201` (bank that replenishes petty cash float).

## Source

- [Settings Audit Core](`_owner-package/Settings_Audit_Core_v2.0.md`) §1.5
- [Mockup v5](`_owner-package/expense_module_mockup_v5.html`) page 04B Petty Cash

## Items Checklist

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| C1.1 | Add `PETTY_CASH_REIMBURSEMENT` to the expense doc type enum in `schema.prisma` + migration | P0 | ⬜ | — | File: `apps/api/prisma/schema.prisma` — verify actual enum name (likely `ExpenseDocumentType` or `DocType`) via `grep "PAYROLL.*SETTLEMENT" prisma/schema.prisma` |
| C1.2 | Schema: add `supplier_name` column to `expense_lines` (or new `petty_cash_lines` table) | P0 | ⬜ | — | Decision needed — see Open Questions |
| C1.3 | V20 validator: total ≤ `petty_cash_limit` setting, every line has `supplier_name`, doc has `cashAccountCode = 11-1201` | P0 | ⬜ | — | Add to expense-documents.service.ts |
| C1.4 | `PettyCashTemplate` JE generator — Dr per-line account + per-line VAT / Cr cashAccountCode | P0 | ⬜ | — | New file: `apps/api/src/modules/journal/cpa-templates/petty-cash.template.ts` |
| C1.5 | `PettyCashService` — limit lookup from settings, custodian assignment, replenish threshold alert | P0 | ⬜ | — | New file under `expense-documents/services/` |
| C1.6 | UI: `PettyCashFormV4` page following mockup 04B layout — header (date, custodian, account) + per-row supplier table + JE preview | P0 | ⬜ | — | New file under `apps/web/src/components/expense-form-v4/` |
| C1.7 | Settings rows: `petty_cash_enabled` / `petty_cash_account` / `petty_cash_limit` / `petty_cash_replenish_threshold` / `petty_cash_custodian` | P0 | ⬜ | — | Maps to A1.1.5.1–A1.1.5.5 |
| C1.8 | Voucher PDF template — mockup 04B layout (header + per-row supplier table, no signatures grid for petty cash) | P1 | ⬜ | — | New template under reporting/voucher templates |

## Decision Log

(empty)

## Open Questions

- [ ] Q: C1.2 — add `supplier_name` column to existing `expense_lines` table, or create separate `petty_cash_lines` polymorphic table? Existing pattern uses single `expense_lines` with nullable fields
- [ ] Q: Should petty cash allow WHT on a per-line basis (e.g. a ภ.ง.ด.3 vendor mixed in with cash receipts)?

## Dependencies

- ✅ T0
- A1 audit results may flag conflicts with existing `expense_lines` shape (A1.1.5.1–A1.1.5.5)

## Related anti-patterns

- ❌ Do NOT introduce `EMPLOYEE_REIMBURSEMENT` doc_type — owner is explicit it's `PETTY_CASH_REIMBURSEMENT`
- ❌ Do NOT enforce single supplier on petty cash docs — it's a deliberate exception to the 1-doc-1-supplier rule
```

- [ ] **Step 2: Verify**

```bash
grep -c "^| C1\." docs/superpowers/tracking/C1-petty-cash.md
```
Expected: `8`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/tracking/C1-petty-cash.md
git commit -m "docs(tracking): seed C1 petty cash (8 items) [T0.4]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: `C2-payroll-custom.md`

**Files:**
- Create: `docs/superpowers/tracking/C2-payroll-custom.md`

- [ ] **Step 1: Write file**

```markdown
# C2 · Payroll Custom Income/Deduction (V16–V18)

**Status:** ⬜ Pending  |  **Started:** —  |  **PRs:** —
**Spec:** —  ·  **Plan:** —

## Context

Extend PAYROLL doc_type with custom income lines (bonus, OT, per-diem allowances) and custom deduction lines (loan repayment, advances). Adds three validators:
- **V16** Taxable Income = base + Σ(income) − Σ(deduction); WHT computes on taxable
- **V17** Custom Income account must be in 53-XXXX (Expense) whitelist
- **V18** Σ(deduction) ≤ base + Σ(income); prevents negative taxable

UI: expandable row in PayrollFormV4 reveals two sub-sections (income / deduction). JE template emits Dr per-account income + standard payroll JE shape.

## Source

- [Settings Audit Core](`_owner-package/Settings_Audit_Core_v2.0.md`) §2.8
- [Mockup v5](`_owner-package/expense_module_mockup_v5.html`) page 02B PayrollPage

## Items Checklist

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| C2.1 | V16 validator — Taxable Income calc + WHT base override | P1 | ⬜ | — | File: `apps/api/src/modules/expense-documents/expense-documents.service.ts` (add after V15) |
| C2.2 | V17 validator — Custom Income account must match `custom_income_accounts_whitelist` setting | P1 | ⬜ | — | Same file |
| C2.3 | V18 validator — `Σ(deduction) ≤ base + Σ(income)` invariant | P1 | ⬜ | — | Same file |
| C2.4 | Schema: `payroll_custom_income[]` + `payroll_custom_deduction[]` nested under `Payroll` (Prisma) | P1 | ⬜ | — | Migration adds two new tables FK'd to payroll |
| C2.5 | `PayrollTemplate.execute` — emit Dr lines for each custom_income.account_code; Dr 53-1101 for `base + custom_income`; deductions reduce the net Cr cash leg | P1 | ⬜ | — | File: `apps/api/src/modules/journal/cpa-templates/payroll.template.ts` |
| C2.6 | UI: PayrollFormV4 expandable rows — Custom Income / Custom Deduction tables with quick-add buttons + V16 warning (ม.42 tax-exempt) | P1 | ⬜ | — | Mockup page 02B |
| C2.7 | Slip auto-generate — PDF per employee + email send (slip lists base, custom income, custom deduction, WHT, SSO, net) | P1 | ⬜ | — | Reuses voucher reporting infrastructure |

## Decision Log

(empty)

## Open Questions

- [ ] Q: Custom Income account whitelist — store in `system_config` JSON, or new `account_whitelist` table?
- [ ] Q: V16 warning "เงินได้ ม.42 ยกเว้นภาษี" is soft (warning) — UX wants a confirm prompt or just inline note?

## Dependencies

- ✅ T0
- Coexists with B1 (SSO change affects payroll); coordinate fixture updates
- Settings 2.8.1 / 2.8.2 (A1) feed C2.2's whitelist
```

- [ ] **Step 2: Verify**

```bash
grep -c "^| C2\." docs/superpowers/tracking/C2-payroll-custom.md
```
Expected: `7`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/tracking/C2-payroll-custom.md
git commit -m "docs(tracking): seed C2 payroll custom income/deduction (7 items) [T0.4]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: `C3-reverse-dialog.md`

**Files:**
- Create: `docs/superpowers/tracking/C3-reverse-dialog.md`

- [ ] **Step 1: Write file**

```markdown
# C3 · Reverse Dialog + V19 (Period Guard)

**Status:** ⬜ Pending  |  **Started:** —  |  **PRs:** —
**Spec:** —  ·  **Plan:** —

## Context

Adds a modal Reverse Dialog with required reason (dropdown of 6 + free text), date picker bounded by V19 (`payment_date ≤ period_close_date + grace_days`), cascade check (block reverse if downstream SETTLEMENT/CN exists), and extended audit log capturing reason_code + reason_detail + reverse_je_id.

## Source

- [Settings Audit Core](`_owner-package/Settings_Audit_Core_v2.0.md`) §2.6 (V19) + §2.7 (Reverse Entry)
- [Mockup v5](`_owner-package/expense_module_mockup_v5.html`) page 02E Reverse Dialog

## Items Checklist

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| C3.1 | V19 validator — reverse date ≤ period_close_date + grace_days; soft warning if backdate > 30 days | P1 | ⬜ | — | File: `expense-documents.service.ts` |
| C3.2 | ReverseDialog modal component — 6-option dropdown + free text + JE before/after preview + date picker | P1 | ⬜ | — | New file: `apps/web/src/components/expense-form-v4/ReverseDialog.tsx` |
| C3.3 | Audit log schema — add `reason_code` (enum) + `reason_detail` (text) + `reverse_je_id` (FK) columns to `audit_log` (or extend existing JSON metadata field if present) | P1 | ⬜ | — | Migration |
| C3.4 | Cascade check service method — given an EX, return list of downstream SETTLEMENT/CN that reference it; block reverse if non-empty | P1 | ⬜ | — | New method on expense-documents.service.ts |
| C3.5 | Settings rows: `reverse_reason_required` / `reverse_reasons_dropdown` (6 strings) / `reverse_manager_approval_days` / `reverse_block_cascaded` | P1 | ⬜ | — | Maps to A1.2.7.1–A1.2.7.4 |

## Decision Log

(empty)

## Open Questions

- [ ] Q: C3.3 — extend existing audit_log schema or use existing JSON metadata field?
- [ ] Q: Manager approval after 7 days — soft (warning) or hard (block)?

## Dependencies

- ✅ T0
- A1 audit may flag existing reverse capability + audit columns — coordinate with C3.3 schema
```

- [ ] **Step 2: Verify**

```bash
grep -c "^| C3\." docs/superpowers/tracking/C3-reverse-dialog.md
```
Expected: `5`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/tracking/C3-reverse-dialog.md
git commit -m "docs(tracking): seed C3 reverse dialog + V19 (5 items) [T0.4]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: `C4-credit-note-2mode.md`

**Files:**
- Create: `docs/superpowers/tracking/C4-credit-note-2mode.md`

- [ ] **Step 1: Write file**

```markdown
# C4 · Credit Note 2-Mode UI

**Status:** ⬜ Pending  |  **Started:** —  |  **PRs:** —
**Spec:** —  ·  **Plan:** —

## Context

Existing CREDIT_NOTE doc_type assumes you've already created the source EXP. Mockup adds explicit two-mode UX:
- **Mode A** — Linked to existing invoice: pick source EX, auto-load supplier/lines/VAT, edit credited amounts per line
- **Mode B** — Standalone: free-form supplier + lines (for cases like supplier refund without original invoice)

JE shape is the existing CN reversal logic — this sub-project is mostly UI + a metadata flag distinguishing modes for ภ.30 reconciliation.

## Source

- [Mockup v5](`_owner-package/expense_module_mockup_v5.html`) page 02D Credit Note Page

## Items Checklist

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| C4.1 | UI: Mode selector at top of CreditNoteForm (radio: Linked / Standalone) | P2 | ⬜ | — | New section in `apps/web/src/components/expense-form-v4/` |
| C4.2 | Mode A — auto-load source EX (supplier, lines, VAT) into editable rows; credit amount defaults to source amount | P2 | ⬜ | — | Reuses existing CN-from-EX flow if it exists |
| C4.3 | Mode B — standalone form with supplier picker + free-form lines (no source EX FK) | P2 | ⬜ | — | New form variant |
| C4.4 | Metadata field `creditNoteMode` (`LINKED` / `STANDALONE`) on `CreditNote` schema; ภ.30 export filters appropriately | P2 | ⬜ | — | Schema migration |

## Decision Log

(empty)

## Open Questions

- [ ] Q: For Mode A, when source EX is partial-paid, should the credit amount cap at remaining-AP or allow over-credit?

## Dependencies

- ✅ T0
- Existing CREDIT_NOTE template (`credit-note.template.ts`) stays unchanged — only UI + metadata changes
```

- [ ] **Step 2: Verify**

```bash
grep -c "^| C4\." docs/superpowers/tracking/C4-credit-note-2mode.md
```
Expected: `4`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/tracking/C4-credit-note-2mode.md
git commit -m "docs(tracking): seed C4 credit note 2-mode (4 items) [T0.4]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: `D1-settings-implement.md` (locked placeholder)

**Files:**
- Create: `docs/superpowers/tracking/D1-settings-implement.md`

- [ ] **Step 1: Write file**

```markdown
# D1 · Settings Audit Phase 4 (Implement Approved Scope)

**Status:** 🔒 Locked (waiting on A1 Phase 2 report + owner approval)  |  **Started:** —  |  **PRs:** —
**Spec:** —  ·  **Plan:** —

## Context

After A1 completes its 102-item audit and produces the Phase 2 report, owner picks which items go into Phase 4 (Implement). D1 hosts that approved scope. Item count is `TBD` until A1 reports.

This file exists pre-seeded with the right structure so when A1 finishes, the executor pastes the approved item subset here without redesigning.

## Source

- A1 Phase 2 output (TBD)
- [Settings Audit Index](`_owner-package/Settings_Audit_Index.md`) decision framework

## Phase

🔒 **Waiting** for A1 Phase 2 → owner approve scope → 🚦 Phase 4 begins

## Items Checklist

> _(Items populate after owner approves A1 Phase 2 scope.)_

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| D1.X | (TBD — copy from A1 approved items) | TBD | 🔒 | — | Awaiting A1 Phase 2 + owner decision |

## Decision Log

(empty — fills when D1 unlocks)

## Open Questions

- [ ] Q: When A1 completes, does the executor copy approved items verbatim, or transform into more granular tasks (split a "P0 SSO Configurable" into schema / DTO / migration / test sub-items)?

## Dependencies

- ⬜ A1 must reach Phase 2 + owner approve before D1 unlocks
- Many D1 items will likely overlap with B1 / C1 / C2 / C3 — coordinate to avoid duplicate work
```

- [ ] **Step 2: Verify**

```bash
grep "🔒 Locked" docs/superpowers/tracking/D1-settings-implement.md
```
Expected: at least 1 match.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/tracking/D1-settings-implement.md
git commit -m "docs(tracking): seed D1 settings implement placeholder (locked) [T0.4]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Verify acceptance criteria + final wrap-up

**Files:**
- Verify: all tracking files

- [ ] **Step 1: Run acceptance criteria checks**

Run each command, confirm expected output:

```bash
# Criterion 1: directory has 12 markdown files + 1 _conventions.md + _owner-package/ with 9 files (8 source + 1 index README)
find docs/superpowers/tracking -maxdepth 1 -name "*.md" | wc -l   # expect 13 (12 tracking + _conventions)
find docs/superpowers/tracking/_owner-package -type f | wc -l       # expect 9

# Criterion 2: README has 11-row Progress Overview (+ header + TOTAL = 13 table rows minimum)
grep -c "^|" docs/superpowers/tracking/README.md                    # expect ≥ 14 (incl. divider rows)

# Criterion 3: T0 row in README shows ✅ Done
grep "T0 · Tracking System" docs/superpowers/tracking/README.md | grep -q "✅ Done" && echo OK

# Criterion 4: each detail file has expected item count
grep -c "^| A0\." docs/superpowers/tracking/A0-preflight-verify.md   # expect 3
grep -c "^| A1\." docs/superpowers/tracking/A1-settings-audit.md     # expect 102
grep -c "^| B1\." docs/superpowers/tracking/B1-sso-875.md            # expect 6
grep -c "^| B2\." docs/superpowers/tracking/B2-settlement-adjustment.md  # expect 5
grep -c "^| B3\." docs/superpowers/tracking/B3-test-suite.md          # expect 14
grep -c "^| C1\." docs/superpowers/tracking/C1-petty-cash.md          # expect 8
grep -c "^| C2\." docs/superpowers/tracking/C2-payroll-custom.md      # expect 7
grep -c "^| C3\." docs/superpowers/tracking/C3-reverse-dialog.md      # expect 5
grep -c "^| C4\." docs/superpowers/tracking/C4-credit-note-2mode.md   # expect 4

# Criterion 5: _conventions.md documents status emoji, priority, ID format, PR title, atomic-diff
grep -E "Status emoji|Priority labels|Item ID format|PR title format|atomic diff" docs/superpowers/tracking/_conventions.md | wc -l   # expect ≥ 5

# Criterion 6: fresh-session simulation — README mentions "Current Focus" and lists next sub-project
grep "Current Focus" docs/superpowers/tracking/README.md && \
  grep -A 3 "Current Focus" docs/superpowers/tracking/README.md | grep -E "A0|Next:"
```

If any check fails, fix the underlying file and re-verify.

- [ ] **Step 2: Verify no stray placeholders**

```bash
grep -rn "TBD\|TODO\|FIXME" docs/superpowers/tracking/ --include="*.md" | grep -v "D1.X\|D1-settings\|TBD —\|TBD until\|TBD ("
```
Expected: no output (intentional `TBD` in D1 are excluded).

- [ ] **Step 3: Run TypeScript check to confirm no accidental code touched**

```bash
./tools/check-types.sh all
```
Expected: passes (we only touched markdown).

- [ ] **Step 4: Final summary commit (optional — if any fixes from steps 1-2)**

If steps 1 or 2 produced fixes, commit them:
```bash
git add docs/superpowers/tracking/
git commit -m "docs(tracking): T0 acceptance criteria fixes [T0.5]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

If no fixes were needed, skip this step.

- [ ] **Step 5: Update master README aggregate after all sub-projects seeded**

Confirm `docs/superpowers/tracking/README.md` shows:
- T0 row: `1 | 1 | 100% | ✅ Done`
- TOTAL row: `~155 | 1 | ~1%`

If the per-task commits left these inconsistent, fix in a single commit:
```bash
git add docs/superpowers/tracking/README.md
git commit -m "docs(tracking): finalize master README aggregate [T0.5]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Done criteria for T0

T0 is fully shipped when:

1. `git status` clean
2. `find docs/superpowers/tracking -type f | wc -l` ≥ 22 (12 tracking md + 1 conventions + 9 owner-package)
3. `T0-tracking-system.md` shows all 5 T0.x items ✅ Done
4. Master `README.md` Progress Overview shows T0 row at 100% ✅ Done
5. A fresh Claude session reading just `docs/superpowers/tracking/README.md` can identify A0 as the next sub-project to start
6. `./tools/check-types.sh all` passes (no code regressions)

When all six pass, T0 is done. Next session can prompt "start A0" and immediately read `A0-preflight-verify.md` to begin work.
