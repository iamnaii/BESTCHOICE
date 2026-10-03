# Flex, receiving payloads and LIFF simplification — 2026-10-03

Completed the three agreed refactors in the existing checkout. Shared code replaces duplicate implementations while retaining each caller's behavior.

## Changes

- `apps/web/src/lib/line-flex.ts` owns Flex types, the three templates and JSON generation. `components/line-message/FlexPreviewCard.tsx` owns the preview shared by Greeting and Broadcast. Broadcast's existing exports remain available. Greeting retains its separate `altText` and save payload.
- `pages/PurchaseOrdersPage/receiving-item.ts` owns the common inspection, photo, warranty and selling-price fields. PO receiving adds `poItemId`; direct receiving adds product identity, quantity and cost. Existing null/undefined/empty-string handling, PASS/REJECT conditions and money conversions are unchanged.
- `pages/liff/components/LiffLayout.tsx` shares the shell and top bar across History, Profile, Payment and Early Payoff. The four original palettes, 430px content width, profile status dot, back button and loading/error layout variants are preserved.
- Production code is about 240 lines shorter across these files, including the new shared modules. No API, schema, payment calculation or external integration changes were made in this pass.

## Verification

- Added 11 regression cases; all passed against the original implementations before refactoring. Flex tests cover three templates, Greeting save/alt text, generated JSON and invalid JSON fallback. Receiving tests cover all category/status combinations and empty/zero/warranty cases through both real mutation hooks.
- Focused suite: 224 tests across 25 files passed after refactoring, including existing Broadcast and purchasing UI tests.
- Full frontend/shared suite: 2,944 tests passed (admin 2,784, shared 128, storefront 32). API and Web types and lint passed.
- `LOCAL_PREVIEW_PORT=5207 npm run local:check`: PASS at 21:50 Bangkok, including builds, managed preview refresh and its browser smoke flows at desktop/mobile sizes. Source fingerprint: `c0bf2a9c3386a9ed7bab7e04c26c8197f3811c7a94a9049a41843b0f658aeae1`.
- Web TypeScript passed after correcting the new test fixture's inferred union type. The first complete local check correctly stopped on that test-only type error; it was not a production runtime failure.
- Read-only reviewer compared the eight original production files against the saved baseline and found no actionable issues.
- Browser checks: all four real LIFF pages at 390px and 900px; exact before/after computed layout, colors, gradients and classes; profile-only status dot; back navigation; no horizontal overflow or page errors. Screenshots saved for all eight combinations.
- Browser checks: full Greeting page renders and saves all three templates, preserving the exact PUT body and edited alt text. Broadcast preview renders all three templates.
- Browser checks: real receiving hooks and API client issue 12 POST requests across three categories and two statuses. Exact serialized payloads retain flow identifiers, warranty/inspection conditions, omitted fields, nulls and satang amounts.

The changed-flow browser checks use synthetic LIFF identity and intercepted synthetic API responses/writes. Receiving transport is exercised through a browser hook harness; the full receiving wizard is covered by the existing automated tests. These checks do not validate real LINE login/delivery, payment processing or warehouse database persistence.

Artifacts: `.tmp/flex-receiving-liff-before.json`, `.tmp/flex-receiving-liff/`, `.tmp/check-liff-shell.mjs`, `.tmp/check-flex-receiving.mjs`, `.tmp/flex-receiving-liff-focused-tests.log`, `.tmp/flex-receiving-browser.log`, `.tmp/local-preview/check.json`.

Local preview: <http://localhost:5207/inbox>. No commit, merge, deployment or external message send was performed.
