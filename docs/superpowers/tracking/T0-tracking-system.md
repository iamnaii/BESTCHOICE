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
| T0.2 | Vendor owner-package source files | P0 | ✅ Done | (seeding) | 8 files in `_owner-package/` + index README; 2 PDFs transcribed, 2 HTMLs extracted to markdown |
| T0.3 | Master `README.md` with 11-row overview | P0 | ✅ Done | (seeding) | Progress table, current focus, timeline, hard gates |
| T0.4 | 11 detail files seeded with concrete items | P0 | ✅ Done | (seeding) | T0 + A0 + A1 (102 items) + B1 (6) + B2 (5) + B3 (14) + C1 (8) + C2 (7) + C3 (5) + C4 (4) + D1 (locked placeholder) |
| T0.5 | Acceptance criteria verified | P0 | ✅ Done | (seeding) | All 6 criteria from spec section "Acceptance criteria" pass |

## Decision Log

- **2026-05-16:** Picked Option A (markdown in repo) over Option B (GitHub Issues). Reasons: pattern-match with existing `specs/`+`plans/`+`memory/`, cross-session continuity via single-file `README.md` read, GitHub Actions budget block creates risk for B
- **2026-05-16:** Picked Option B (hub-and-spoke) over Option A (1 mega-file). Reasons: merge-conflict surface across 4-week parallel PR streams, fresh-session token cost
- **2026-05-16:** Decomposed v2.0 work into 10 sub-projects (T0/A0/A1/B1/B2/B3/C1/C2/C3/C4/D1) instead of one mega-spec — owner-package scope (~155 items, ~30–40 PRs) exceeded single-spec capacity
- **2026-05-16:** PDFs transcribed to `.md` in `_owner-package/` instead of vendored as binary. Binary PDFs are un-greppable and un-diffable in git
- **2026-05-16:** HTMLs (Implementation_Review + mockup_v5) extracted as markdown summaries instead of verbatim copies. Trade-off: lossless searchability in git vs full HTML/CSS rendering. Full originals preserved in 2026-05-16 conversation history

## Open Questions

(none — T0 fully specified by spec)

## What this unlocks

- A0 can start (Pre-flight Verify) — its tracking file is seeded and ready
- B1, A1 can start in parallel once A0 completes
- Every future PR has a row to mark ✅ on merge
