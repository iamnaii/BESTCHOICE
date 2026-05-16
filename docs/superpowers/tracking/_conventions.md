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

- Read the spec: `../specs/2026-05-16-bestchoice-expense-v2-tracking-design.md`
- Owner's original source: `_owner-package/`
- Master overview: `README.md`
