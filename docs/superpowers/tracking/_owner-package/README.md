# Owner Package · 2026-05-15

> **DO NOT EDIT.** This directory is a read-only copy of the 8 files owner delivered on 2026-05-15 to start Business Expense Module v2.0 work. If owner ships a v2.1 package, create `_owner-package-2026-XX-YY/` alongside this one.

## Files

| Filename | Original | Notes |
|---|---|---|
| `COVER_MESSAGE.md` | markdown | Cover note for AI Dev — explains the 4-phase workflow |
| `README_FOR_DEV.md` | markdown (v2 version) | Master Brief — Pre-flight Check + Mandatory Stops + Anti-patterns |
| `Implementation_Review_v2.0.md` | **markdown extract from HTML** (originally `Implementation_Review_v2.0.html`, ~33 KB) | Executive summary + timeline + bug fixes + 5 new flows + V16-V20 + 102 settings overview |
| `expense_module_mockup_v5.md` | **markdown extract from HTML** (originally `expense_module_mockup_v5.html`, ~235 KB · 4873 lines) | 13 UI screens · single source of truth for UI · structural extract (full styled HTML in conversation history) |
| `Settings_Audit_Index.md` | markdown | Quick overview of 102 settings, decision framework |
| `Settings_Audit_Core_v2.0.md` | **transcribed from PDF** (originally `Settings_Audit_Core_v2.0.pdf`, 12 pages) | 102 settings details with Detection Hints |
| `Settings_Audit_Change_Log.md` | markdown | v1.0 → v2.0 diff (52 → 102 items, +50 new) |
| `Dev_Action_Items_v1.0.md` | **transcribed from PDF** (originally `Dev_Action_Items_v1.0.pdf`, 32 pages) | 5 bug-fix actions with SQL queries, code patches, test cases, sign-off checklist |

## Why transcribed from PDF?

PDFs are binary — putting them in git makes them un-greppable and non-diffable. HTMLs at 235 KB are large enough to bloat the repo and slow grep. The markdown extracts preserve all text content (tables, code blocks, headings, JE examples) in form that a future Claude session can search. The original PDFs and HTML files are preserved in conversation history (2026-05-16 session); if pixel-perfect rendering is ever needed (mockup styling, voucher PDF layout), retrieve from there or re-request from owner.

## Relationship to tracking files

The detail tracking files (`A0-*.md`, `A1-*.md`, etc.) reference back to these source documents. Don't update tracking from intuition — when in doubt, read the source here.

## Original delivery context

Owner delivered these on 2026-05-15 along with a sample voucher PDF (`EXP-20260500023.pdf`) that was NOT part of the canonical 8-file package — it was a reference for voucher rendering format only and is not included here.
