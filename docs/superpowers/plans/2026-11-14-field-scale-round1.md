# Round 1 — Form Field Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make form fields in the back office look consistent within each row (corner, border, fill, label), stop menus from being clipped, and stop text from being cut mid-word — with a measurement tool that runs on the Windows workstation and proves each change against a baseline.

**Architecture:** Measure first (Tasks 1–2 add a field collector + F1–F4 rules to the existing typography-audit tool and a Playwright runner against `npm run local:preview`, then record a `baseline` on main). Then change shared primitives once (Tasks 3–7: 8px corners, `ReadOnlyField`, `LabeledField`, `NativeSelect` props, portalled account menu, guard tests). Then fix call sites per file (Tasks 8–9) and move labels to style A (Tasks 10–11). Every visual task ends with `--compare baseline <label>`.

**Tech Stack:** React 19, Vite, Tailwind 4.3, shadcn/Radix (`@radix-ui/react-popover`), vitest + Testing Library (web), Node 24 `node:test` + `@playwright/test` Chromium (tools), Git Bash on Windows 11.

**Spec:** `docs/superpowers/specs/2026-11-14-dropdown-search-field-scale-design.md` (§4, §5, §7 rows R1-1…R1-4, §8, appendix ก). Audit data: `docs/reports/field-scale-audit-2026-11-14/`.

## Global Constraints

- Field height stays 44px — the global rule in `apps/web/src/styles/admin-typography.css` is **not** edited.
- Corners: 8px (`rounded-lg`) on `Input`, `SelectTrigger`, `Textarea` (owner decision 2026-11-14).
- Field labels: style A = `formLabelClass` (`mb-3 block text-sm font-medium leading-snug text-foreground`) — owner decision 2026-11-14; scope per spec §4.3 (shadcn `FormLabel` default, the 9 `AddressForm` host forms, and forms fixed for appendix ก).
- Read-only values use `ReadOnlyField` (44px, `border-input`, `bg-muted/80`); its darker fill is intended and is excluded from F1's background check.
- `NativeSelect` skin is **not** forced in the primitive; select + same-row siblings are normalised together per file (spec §4.2 item 5).
- Semantic tokens only — no hex, `bg-white`, `text-gray-*`, `bg-gray-*` in `.tsx`; `text-warning` is not a text colour (use `text-warning-strong`); Thai text never `leading-none`.
- Thai for all user-facing copy; English identifiers.
- No new UI libraries (shadcn/Radix/cmdk/lucide only).
- Out of scope: `apps/web-shop`, documents/print/stickers/Tiptap, `BranchSelect`, Round 2 (`Combobox`).
- Windows: `npm run local:check` is not supported. Per PR run: `bash tools/check-types.sh web` · `npm run lint --workspace=apps/web` · `npm run test --workspace=apps/web` · `npm run build --workspace=apps/web` · `npm run local:preview` + `node tools/field-scale/check.mjs`. Every PR body states what ran on Windows and that `local:check` must run on Linux/CI (AGENTS.md).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push, open PRs, merge or deploy unless the owner asks.
- `.tmp/` is gitignored — never commit measurement output.

## Task order and dependencies

| Task | Spec PR | Depends on | Deliverable |
|---|---|---|---|
| 1 Field collector + F1–F4 rules | R1-1 | — | `__collectFields`, `evaluateFields`, 31 tests |
| 2 Runner + route mocks + baseline | R1-1 | 1 | `tools/field-scale/*`, `baseline` on main (menu probes fail = S2-01/S2-02 proof) |
| 3 Primitives: 8px corners, 16px mobile font | R1-2 | 2 | input/select/textarea + docs |
| 4 `ReadOnlyField` + `LabeledField` | R1-2 | 3 | two components + tests |
| 5 `NativeSelect` `leadingIcon`/`tone` | R1-2 | 3 | props + 2 call sites; Windows fix of `native-select.inventory.test.ts` |
| 6 `AccountSearchDropdown` portal | R1-2 | 2 | P1 S2-01/S2-02 fixed; menu probes pass |
| 7 Width bug + `bg-input` + guard file | R1-2 | 3 | creates `field-guards.inventory.test.ts`; S1-01, S3-02, S3-03 |
| 8 Appendix ก fixes | R1-3 | 4, 5, 7 | 13 confirmed rows |
| 9 `NativeSelect` + siblings per file + skin guard | R1-3 | 7, 8 | 110 selects + 72 siblings in 74 files |
| 10 Label style A: `FormLabel` + 9 hosts | R1-4 | 7, 9 | shadcn default + 9 forms |
| 11 Label style A in Task 8's forms | R1-3/§4.3 ค | 8, 10 | remaining touched forms |
| 12 F5 menu guard + per-component clip checks | R1-1/R1-2 (§5 F5) | 6, 7 | source-scan guard + `tools/field-scale/menu-clip-components.mjs` |

Tasks 3–7 can be one PR (R1-2) or several; tasks 8–9 and 10–11 likewise. Each task is independently revertable.

## Cross-task notes (read before starting any task)

- **Shared files.** `apps/web/src/components/ui/field-guards.inventory.test.ts` is created by Task 7; Tasks 9 and 10 append to it. `native-select.inventory.test.ts` fails on Windows today (backslash paths) — Task 5 fixes it; later tasks must not re-fix it.
- **Baseline label** is `baseline` (Task 2, Step 25). Every visual task compares with `node tools/field-scale/check.mjs --compare baseline <label>`; Task 9 additionally takes its own `t9-before` because it runs after Task 8 changed the same screens.
- **`results.json`** keeps findings under `cells[].findings` (Task 2 Interfaces). F1 finding keys start with the property (`labelFontSize@…`, `background@…`) and name one control: `<property>@<memberKey>`, where `memberKey` = `kind|name|dup` and `dup` counts controls with the same `kind|name` page-wide in DOM order. When a row is inconsistent for a property, every member of the row is reported for it (no majority vote).
  - **What is guaranteed:** with the same set of measured controls in a row or check, changing values toward agreement never adds an F1 key, and a fully consistent row has no F1 keys.
  - **Exposed, not introduced — known ways a correct change can still add F1 keys:**
    - (a) *dup renumbering.* Adding, removing, renaming or re-kinding a control renumbers every later control with the same `kind|name` page-wide (e.g. unnamed inputs `input||n`, repeated labels จำนวน / ราคา / หมายเหตุ). Their still-open findings come back under new keys — and a renamed or re-kinded control itself gets new keys while its row is still inconsistent. Clause (a) also covers an F2/F3/F4 key of a renamed or re-kinded control only when all of these hold: the same compare lists a baseline key under Fixed in the **same cell** (route, width, theme); the new key equals that baseline key after substituting the control's old `memberKey` for its new one (same rule, same partner/sub-check); the finding detail is identical; and each baseline key is paired with at most one new key. The report must show every pair with both keys and the detail.
    - (b) *row/check membership growth.* A control becomes measured (a plain `<div>` → `ReadOnlyField`), stops being `largeText`, is re-kinded out of `textarea`, gets its label moved above it (it joins the labelled checks), or a geometry change merges two rows. If the row is inconsistent for a property, every member then gets keys for it, including members that did not change.
    - (c) *derived bottom.* `bottom` = y + h. A height or labelGap fix that removes an offset which used to compensate can make `bottom` mismatch for the first time.
  - **Compare triage rule (every task's compare step).** If `--compare` exits 1, classify each NEW P1/P2 finding. It is accepted only if it is one of (a)/(b)/(c) above **and** the underlying mismatch already existed on main (for Task 9's `t9-*` compares: in the `t9-before` run) — show it with the same visual mismatch in the baseline screenshot or report. A control that was not measured at baseline has no baseline key, so for it the baseline screenshot itself must show the same mismatch; "not measured" alone is not evidence. Record each accepted finding in the task report with its finding id, which of (a)/(b)/(c) it is, and the evidence. Anything else must be fixed: a mismatch the change introduced, any `MENU` or other P1 finding (clip/probe failures are never accepted), and any F2/F3/F4 finding other than the re-key case in clause (a). Acceptance lines below that say a compare "exits 0" mean "exits 0, or every blocking line is accepted under this rule (including the MENU rule below)".
  - **MENU before and after Task 6.** `--compare` blocks on every `MENU` line of the current run, baseline or not, so it exits 1 on the baseline itself until Task 6. Tasks 3, 4, 5 (and any task run before Task 6) accept exactly the 4 known account-menu lines (`other-income-items|1440|{light,dark}|MENU|account-menu-items-card`, `other-income-override|1440|{light,dark}|MENU|account-menu-override-jv`) and only when each is marked `[byte-identical to baseline: pre-existing S2-01/S2-02, fixed by Task 6]` — a line marked `reasons differ from baseline` or `not in baseline` (e.g. `…:error`, a probe that threw) must be fixed. Record the 4 lines in the task report. From Task 6 on, MENU must pass: the compare prints `MENU failures (…): 0` and lists the 4 ids under "Fixed".
  - **Lost or emptied cells are never accepted.** A cell rendered at baseline that is `error` / `open-failed` / `skipped` now, or whose fact count fell below 50% of its baseline, blocks; fix the change or the route (its open step, a mock), never the baseline.
  - **Nondeterminism.** Two runs of the same UI on the same preview must compare with 0 new / 0 fixed (Task 2 Step 25 proves this for the baseline). A route whose findings change between identical runs is a route bug — fix it in `routes.mjs` (mock the data it reads, wait for its stable state; `trade-in-quick-buy` was fixed this way: catalog mock + wait for the model select to be enabled; `contract-customer-edit` by opening the customer card's dialog instead of the contract card's inline edit, which left a run-dependent scroll position at 390) — it is not a triage class.
  - **Refresh before every run.** The preview fingerprints `apps/`, `packages/` and `tools/`; after any source edit `check.mjs` exits 2 until `npm run local:preview` has restarted it. Every `check.mjs --label …` step below is preceded by `npm run local:preview`.
  - **Controls first measured by Task 8** (no baseline key exists for them): group A InterestConfig VAT `<div>` (S1-03, this plan ~line 6014), group C ItemsTable "ก่อนภาษี" (S2-07), group D ItemLinesSection "ก่อนภาษี" (S3-04, ~line 6843) and AdjustmentSection ยอดสุทธิ / ผลต่าง (S3-05, ~lines 6906 / 6917). Each becomes a `ReadOnlyField` with a label above it — case (b). What the baseline can list as "fixed" are the other row members' keys; the acceptance for these rows is that the row they now join is fully consistent (zero F1 keys for that row), with the screenshot comparison as the visual proof. If the row is not consistent, the new control's keys — and, for any property the row only now fails, every member's keys — show up as new. These are the rows the task sets out to fix, so the triage rule does not excuse them: fix the row.
- **Line numbers** in Tasks 8–11 are from commit `b58250bbe`; earlier tasks shift them. Every edit is anchored on an exact unique string — use the string, treat the line as a guide.
- **Account menu probe** (Task 2) finds the menu by the search box `aria-label="ค้นหารหัส หรือ ชื่อบัญชี"`; Task 6 keeps that label.
- **Known limits** (accepted in the spec): ~102 `NativeSelect` sites pass `className` through a variable and are invisible to the skin guard; F2 measures synthetic data only; some deep flows (PO payment step, payroll lines, QuickBuy seller step) are reached only where the preview can open them — the tasks say which are manual.

---

---

### Task 1: Field facts collector + F1–F4 rules (R1-1 part 1)

**Goal:** Add the measuring half of spec §5. `tools/typography-audit/collect.js` gets a second, independent in-page export, `window.__collectFields({ exclude, root })`, which returns `FieldFact[]`. `tools/typography-audit/rules.mjs` gets the pure `evaluateFields(facts, ctx)`, which returns F1–F4 `Finding[]`. Both changes only append code. Nothing in `__collectTypography`, `evaluateTypography`, `diffFindings`, `compareFacts` or any existing export changes, so the R1–R12 results stay the same. F5 is a source-scan test, not a runtime rule, and is out of scope here. The Playwright runner `tools/field-scale/check.mjs` that injects the collector is Task 2.

**How the collector is tested (same as today):** `collect.test.mjs` already launches real Chromium through `@playwright/test` from `node:test`. It serves the page and `apps/web/public/fonts` from a fake origin with `page.route`, and injects `collect.js` with `page.addScriptTag`. jsdom is not used: it has no layout, so it cannot measure boxes or canvas text. The new collector test copies that harness. No server or `local:preview` is needed.

**Files:**
- Modify: `tools/typography-audit/rules.mjs` — append after the last line (line 299, the closing `}` of `compareFacts`).
- Modify: `tools/typography-audit/collect.js` — append after the last line (line 627, `})();`). Lines 1–627 do not change.
- Create (test): `tools/typography-audit/fields.test.mjs` — pure F1–F4 rule tests with hand-made `FieldFact` fixtures.
- Create (test): `tools/typography-audit/collect-fields.test.mjs` — Chromium tests for `__collectFields`, plus end-to-end checks through `evaluateFields`.

**Interfaces:**
- Consumes: nothing new. The rules reuse `findingKey` from `rules.mjs`; the tests reuse `normalizeKeyText`. The collector test uses `@playwright/test` (already resolvable from the repo root) and `apps/web/public/fonts/noto-sans-thai/fonts.css`.
- Produces (used by Task 2 `tools/field-scale/check.mjs` and the compare mode):
  - `window.__collectFields({ exclude?: string, root?: string }) → FieldFact[]`, where `FieldFact = ControlFact | TargetFact`. Ids are unique per call: controls first, then targets, each in DOM order.
    - `ControlFact`: `{ type:'control', id, key, kind, tag, scope, ancestors, x, y, w, h, borderRadius, borderWidth, borderColor, backgroundColor, fontSize, largeText, label, contentLeft, contentRight, contentWidth, placeholderInkWidth, optionCount, longestOptionInkWidth, valueOverflowX, valueOverflowY, adornments }`
      - `kind`: `'input-wrapper'|'field-frame'|'readonly'|'select-trigger'|'combobox'|'native-select'|'textarea'|'input'`.
      - `key`: `kind|normalizeKeyText(label text || aria-label || placeholder)|dup`. Label text is the label's own words only: fields, options, buttons, `<output>`, comboboxes, `[role=listbox]`, `[role=option]`, `[role=textbox]`, `[role=searchbox]`, `[role=spinbutton]`, `[data-slot=select-value]` and editable (`[contenteditable]` other than `"false"`) subtrees inside it are skipped, because a wrapping `<label>` contains its control.
      - `scope`: `'dialog:<n>'|'main'|'page'`.
      - `ancestors`: `[{ id, layout:'flex-row'|'flex-col'|'grid'|'other' }]`, parent first, up to and including the scope root.
      - `label`: `{ fontSize, gap, above } | null`.
      - `adornments`: `[{ x, y, w, h, side:'left'|'right' }]`.
      - No values, option text or select-value text leave the page; those fields are numbers or booleans only.
    - `TargetFact`: `{ type:'target', id, key, role, scope, scroller, targetAncestors, x, y, w, h, coveredBy }`.
      - `key`: `target-<role>|normalizeKeyText(aria-label, or own text for button/tab/menuitem)|dup`. Link text is never used. Own text skips the same value subtrees as label text.
  - `evaluateFields(facts, ctx = { width, route?, theme?, role? }) → Finding[]`, with `Finding = { rule:'F1'|'F2'|'F3'|'F4', severity:'P1'|'P2', route, width, theme, role, key, text, detail }`. This is the same shape as `evaluateTypography` findings, so `findingKey` and `diffFindings` work unchanged.
    - F1 key: `<property>@<memberKey>` — one finding per member of a row that is inconsistent for that property (every member, not just the odd ones); the member's own value is `detail.value`, the whole row and its values are in `text` and `detail.members`.
    - F2 key: `placeholder|option|value@<controlKey>`.
    - F3 key: `<targetKey>~<targetKey>`.
    - F4 key: `left|right<n>@<controlKey>`.
  - Also exported: `verticalOverlapRatio`, `nearestCommonAncestor`, `sameFieldRow`, `groupFieldRows`, and the threshold constants `F1_*`, `F2_TEXT_SLACK_PX`, `F3_*`, `F4_RESERVE_SLACK_PX`.

**Rule definitions (spec §5, exactly as implemented):**
- **F1 (P2).**
  - *Control*: the outermost of `[data-slot=input-wrapper]`, `[data-field-frame]`, `[data-slot=readonly-field]`, `[data-slot=select-trigger]`, `button[role=combobox]`, `select`, `textarea`, `input`.
  - *Row*: same scope, vertical overlap ÷ shorter height ≥ 0.5, and the nearest common ancestor is `flex-row` or `grid`. Rows are the connected components of that relation.
  - `page` (outside `#main` and any dialog) is its own scope on purpose. Only `apps/web/src/components/layout/MainLayout.tsx:189` renders `id="main"`, so LIFF/public pages measured at 390 would otherwise never be measured. Page chrome is compared only with other page chrome.
  - Checks. The row decides whether a property is inconsistent (thresholds below). Then one finding is emitted for every eligible member of that row — there is no majority vote, so no member is picked as "the odd one". With the same set of measured controls in the row, changing values toward agreement never adds a key (31 / 31 / 44 → 44 / 31 / 44 still reports the same three keys; it does not swap to B), and a row that becomes consistent loses all of its keys for that property. A correct change can still add keys when the controls change (dup renumbering, row membership growth, derived bottom) — see Cross-task notes.
    - height spread > 2px
    - largest-corner radius spread > 1px
    - font spread > 0.5px
    - border colour differs (`'none'` when the top border is 0)
    - background colour differs
    - bottom-edge spread > 2px
    - label font spread > 0.5px, among members whose associated label sits above the control
    - label→control gap spread > 2px, same members
  - Excluded: `largeText` (a `text-lg`+ class or ≥ 17.5px), `textarea`. Checkbox and radio inputs are never controls.
- **F2 (P2), per control:**
  - placeholder canvas ink > content width + 1 (not textarea);
  - native select: longest option canvas ink > content width + 1;
  - `[data-slot=select-value]` `scrollWidth > clientWidth + 1` **or** `scrollHeight > clientHeight + 1`.
- **F3, per pair of targets:**
  - Fires when the overlap is > 1px on both axes. It is P1 when one target's centre hit-test (`elementFromPoint`) lands on the other, otherwise P2.
  - Pairs are skipped when one is an ancestor of the other, when they are in different scroll containers, or when they are in different dialog scopes (page and `#main` still compare).
  - A target fully contained in another is skipped unless it covers the other's centre; contained targets are F4's job.
- **F4 (P2), per absolutely positioned adornment that intersects a control:**
  - right side: `reserveShort = contentRight − adornment.left`; left side: `reserveShort = adornment.right − contentLeft`;
  - `inkOverlap` = overlap of the adornment with `[contentLeft, contentLeft + min(textInk, contentWidth)]`, where `textInk = max(placeholderInk, longestOptionInk)`;
  - fires when either value is > 0.5px.

- [ ] **Step 0: Check the branch (no commit on `main`)**

  ```bash
  git branch --show-current
  ```
  - Expected: anything except `main`. If it prints `main`, run `git switch -c feat/field-scale-r1-1`.
  - Then confirm the two existing suites are green before touching anything:

  ```bash
  node --test tools/typography-audit/rules.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"
  node --test tools/typography-audit/collect.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"
  ```
  - Expected for `rules.test.mjs`: `ℹ tests 51` / `ℹ pass 51` / `ℹ fail 0`.
  - Expected for `collect.test.mjs`: `ℹ tests 51` / `ℹ pass 51` / `ℹ fail 0`. It launches Chromium and takes about 7 s.

- [ ] **Step 1: Write the failing rule tests — create `tools/typography-audit/fields.test.mjs`**

```js
// Field scale rules (spec docs/superpowers/specs/2026-11-14-dropdown-search-field-scale-design.md §5):
// pure evaluateFields tests with hand-made FieldFact fixtures (shape: collect.js __collectFields header).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateFields,
  evaluateTypography,
  findingKey,
  groupFieldRows,
  nearestCommonAncestor,
  sameFieldRow,
  verticalOverlapRatio,
} from './rules.mjs';

const GRID = { id: 1, layout: 'grid' };
const ctl = (o = {}) => ({
  type: 'control',
  id: 0,
  key: 'input|ชื่อลูกค้า|0',
  kind: 'input',
  tag: 'input',
  scope: 'main',
  ancestors: [{ id: 10, layout: 'other' }, GRID, { id: 2, layout: 'other' }],
  x: 0,
  y: 100,
  w: 200,
  h: 44,
  borderRadius: 8,
  borderWidth: 1,
  borderColor: 'rgb(212, 212, 216)',
  backgroundColor: 'rgb(255, 255, 255)',
  fontSize: 14,
  largeText: false,
  label: { fontSize: 14, gap: 12, above: true },
  contentLeft: 13,
  contentRight: 187,
  contentWidth: 174,
  placeholderInkWidth: null,
  optionCount: null,
  longestOptionInkWidth: null,
  valueOverflowX: false,
  valueOverflowY: false,
  adornments: [],
  ...o,
});
// two controls side by side in one grid (S1-04-like row)
const pair = (a = {}, b = {}) => [
  ctl({ id: 0, ancestors: [{ id: 10, layout: 'other' }, GRID], ...a }),
  ctl({
    id: 1,
    key: 'native-select|สาขา|0',
    kind: 'native-select',
    tag: 'select',
    x: 216,
    contentLeft: 229,
    contentRight: 375,
    contentWidth: 146,
    ancestors: [{ id: 11, layout: 'other' }, GRID],
    ...b,
  }),
];
const CTX = { route: '/x', width: 1440, theme: 'light', role: 'owner' };
const rulesOf = (facts) => evaluateFields(facts, CTX).map((f) => `${f.rule}:${f.severity}`);
const f1Findings = (facts) => evaluateFields(facts, CTX).filter((f) => f.rule === 'F1');
// properties that fired (one finding per member of an inconsistent row, so a property repeats)
const f1 = (facts) => [...new Set(f1Findings(facts).map((f) => f.detail.property))];
const f1Keys = (facts) => f1Findings(facts).map((f) => f.key);
const tgt = (o = {}) => ({
  type: 'target',
  id: 0,
  key: 'target-button|บันทึก|0',
  role: 'button',
  scope: 'main',
  scroller: null,
  targetAncestors: [],
  x: 0,
  y: 0,
  w: 100,
  h: 44,
  coveredBy: null,
  ...o,
});
const two = (a = {}, b = {}) => [
  tgt({ id: 0, ...a }),
  tgt({ id: 1, key: 'target-button|ยกเลิก|0', x: 90, y: 10, ...b }),
];

test('a matched row has no findings', () => {
  assert.deepEqual(evaluateFields(pair(), CTX), []);
  assert.deepEqual(evaluateFields([], CTX), []);
});

test('row = same scope + ≥50% vertical overlap + nearest common ancestor flex-row or grid', () => {
  const [a, b] = pair();
  assert.equal(nearestCommonAncestor(a, b).id, 1);
  assert.equal(sameFieldRow(a, b), true);
  const withLayout = (layout) => {
    const common = { id: 1, layout };
    return sameFieldRow(
      { ...a, ancestors: [{ id: 10, layout: 'other' }, common] },
      { ...b, ancestors: [{ id: 11, layout: 'other' }, common] },
    );
  };
  assert.equal(withLayout('flex-row'), true);
  assert.equal(withLayout('flex-col'), false);
  assert.equal(withLayout('other'), false);
  assert.equal(sameFieldRow(a, { ...b, scope: 'dialog:0' }), false);
  assert.equal(sameFieldRow(a, { ...b, ancestors: [{ id: 99, layout: 'grid' }] }), false);
  // 22px of 44px overlap = exactly 50% ⇒ row; 21px ⇒ not
  assert.equal(verticalOverlapRatio(a, { ...b, y: 122 }), 0.5);
  assert.equal(sameFieldRow(a, { ...b, y: 122 }), true);
  assert.equal(sameFieldRow(a, { ...b, y: 123 }), false);
});

test('F1 height > 2px and bottom edge > 2px (S2-07: 31px beside 44px)', () => {
  assert.deepEqual(f1(pair({}, { h: 31 })), ['height', 'bottom']);
  assert.deepEqual(f1(pair({}, { h: 42 })), [], '2px is within tolerance');
  // same height, shifted 5px (S3-04 bottom misaligned)
  assert.deepEqual(f1(pair({}, { y: 105 })), ['bottom']);
});

test('F1 radius > 1px and font size > 0.5px', () => {
  assert.deepEqual(f1(pair({}, { borderRadius: 6 })), ['radius']);
  assert.deepEqual(f1(pair({}, { borderRadius: 7 })), []);
  assert.deepEqual(f1(pair({}, { fontSize: 13 })), ['fontSize']);
  assert.deepEqual(f1(pair({}, { fontSize: 14.5 })), []);
});

test('F1 border colour differs and background differs (S1-01 bg-input, S1-04)', () => {
  assert.deepEqual(f1(pair({}, { borderColor: 'rgb(161, 161, 170)' })), ['borderColor']);
  assert.deepEqual(f1(pair({}, { borderColor: 'none', borderWidth: 0 })), ['borderColor']);
  assert.deepEqual(f1(pair({}, { backgroundColor: 'rgba(0, 0, 0, 0)' })), ['background']);
  // ReadOnlyField's intended darker fill is not a background mismatch (its height/radius still are).
  assert.deepEqual(f1(pair({}, { kind: 'readonly', backgroundColor: 'rgb(240, 240, 240)' })), []);
});

test('F1 label font > 0.5px or label gap > 2px; labels not above or missing are skipped', () => {
  assert.deepEqual(f1(pair({}, { label: { fontSize: 12, gap: 6, above: true } })), [
    'labelFontSize',
    'labelGap',
  ]);
  assert.deepEqual(f1(pair({}, { label: { fontSize: 14, gap: 14, above: true } })), []);
  assert.deepEqual(f1(pair({}, { label: { fontSize: 12, gap: -20, above: false } })), []);
  assert.deepEqual(f1(pair({}, { label: null })), []);
});

test('F1 exclusions: text-lg+ control, textarea', () => {
  assert.deepEqual(f1(pair({}, { h: 56, fontSize: 18, largeText: true })), []);
  assert.deepEqual(f1(pair({}, { kind: 'textarea', tag: 'textarea', h: 96 })), []);
});

test('F1 groups a row; every member of an inconsistent row is reported, row context in text/detail', () => {
  const third = ctl({
    id: 2,
    key: 'field-frame|ราคา|0',
    kind: 'field-frame',
    tag: 'div',
    x: 432,
    h: 31,
    ancestors: [{ id: 12, layout: 'other' }, GRID],
  });
  const facts = [...pair(), third];
  assert.deepEqual(
    groupFieldRows(facts).map((row) => row.map((c) => c.id)),
    [[0, 1, 2]],
  );
  // 44 / 44 / 31: the row is inconsistent for height and bottom, so all three members are reported
  assert.deepEqual(f1Keys(facts), [
    'height@input|ชื่อลูกค้า|0',
    'height@native-select|สาขา|0',
    'height@field-frame|ราคา|0',
    'bottom@input|ชื่อลูกค้า|0',
    'bottom@native-select|สาขา|0',
    'bottom@field-frame|ราคา|0',
  ]);
  const heights = f1Findings(facts).filter((f) => f.detail.property === 'height');
  const height = heights[2];
  assert.equal(height.rule, 'F1');
  assert.equal(height.severity, 'P2');
  assert.equal(
    height.text,
    'field-frame|ราคา|0 (row: input|ชื่อลูกค้า|0 / native-select|สาขา|0 / field-frame|ราคา|0)',
  );
  const members = [
    { key: 'input|ชื่อลูกค้า|0', value: 44 },
    { key: 'native-select|สาขา|0', value: 44 },
    { key: 'field-frame|ราคา|0', value: 31 },
  ];
  assert.deepEqual(height.detail, {
    property: 'height',
    value: 31,
    spread: 13,
    tolerance: 2,
    members,
  });
  // a member that matches most of the row is still reported, with its own value
  assert.equal(
    heights[0].text,
    'input|ชื่อลูกค้า|0 (row: input|ชื่อลูกค้า|0 / native-select|สาขา|0 / field-frame|ราคา|0)',
  );
  assert.deepEqual(heights[0].detail, {
    property: 'height',
    value: 44,
    spread: 13,
    tolerance: 2,
    members,
  });
  assert.equal(findingKey(height), '/x|1440|light|owner|F1|height@field-frame|ราคา|0');
  // distinct checks carry the member's value and the row, no spread/tolerance
  const border = f1Findings([...pair(), { ...third, h: 44, borderColor: 'rgb(1, 2, 3)' }]);
  assert.deepEqual(
    border.map((f) => f.key),
    [
      'borderColor@input|ชื่อลูกค้า|0',
      'borderColor@native-select|สาขา|0',
      'borderColor@field-frame|ราคา|0',
    ],
  );
  assert.deepEqual(border[2].detail, {
    property: 'borderColor',
    value: 'rgb(1, 2, 3)',
    members: [
      { key: 'input|ชื่อลูกค้า|0', value: 'rgb(212, 212, 216)' },
      { key: 'native-select|สาขา|0', value: 'rgb(212, 212, 216)' },
      { key: 'field-frame|ราคา|0', value: 'rgb(1, 2, 3)' },
    ],
  });
  // a second row further down is its own group
  const lower = pair({ id: 3, y: 300 }, { id: 4, y: 300 });
  assert.equal(groupFieldRows([...facts, ...lower]).length, 2);
});

test('F1 reports every member, including members inside a tolerance cluster', () => {
  assert.deepEqual(f1Keys(pair({}, { borderRadius: 6 })), [
    'radius@input|ชื่อลูกค้า|0',
    'radius@native-select|สาขา|0',
  ]);
  // 44 / 45 / 31: the row's spread is 14px, so all three are reported (no majority vote)
  const row = [
    ...pair({}, { h: 45 }),
    ctl({
      id: 2,
      key: 'input|ราคา|0',
      x: 432,
      h: 31,
      ancestors: [{ id: 12, layout: 'other' }, GRID],
    }),
  ];
  assert.deepEqual(
    f1Keys(row).filter((k) => k.startsWith('height@')),
    ['height@input|ชื่อลูกค้า|0', 'height@native-select|สาขา|0', 'height@input|ราคา|0'],
  );
});

// One row of controls side by side in a grid; `heights` in DOM order, keys input|<name>|0.
const rowOf = (heights) =>
  heights.map((h, i) =>
    ctl({
      id: i,
      key: `input|${'ABCD'[i]}|0`,
      x: i * 216,
      h,
      ancestors: [{ id: 10 + i, layout: 'other' }, GRID],
    }),
  );
const assertNoNewKeys = (before, after) =>
  assert.deepEqual(
    after.filter((k) => !before.includes(k)),
    [],
    'a partial fix must not add F1 keys',
  );
const keysOf = (property, facts) => f1Keys(facts).filter((k) => k.startsWith(`${property}@`));

test('F1 is monotonic: fixing A in 31 / 31 / 44 adds no key; a consistent row has none', () => {
  const before = f1Keys(rowOf([31, 31, 44]));
  assert.deepEqual(keysOf('height', rowOf([31, 31, 44])), [
    'height@input|A|0',
    'height@input|B|0',
    'height@input|C|0',
  ]);
  const partial = f1Keys(rowOf([44, 31, 44]));
  assertNoNewKeys(before, partial);
  assert.ok(partial.includes('height@input|B|0'), 'B is still reported');
  assert.deepEqual(f1Keys(rowOf([44, 44, 44])), [], 'consistent row ⇒ no F1 findings');
});

test('F1 is monotonic: fixing B in 44 / 36 / 36 / 36 (a tie) adds no key; a consistent row has none', () => {
  const before = f1Keys(rowOf([44, 36, 36, 36]));
  assert.deepEqual(keysOf('height', rowOf([44, 36, 36, 36])), [
    'height@input|A|0',
    'height@input|B|0',
    'height@input|C|0',
    'height@input|D|0',
  ]);
  const partial = f1Keys(rowOf([44, 44, 36, 36]));
  assertNoNewKeys(before, partial);
  assertNoNewKeys(partial, f1Keys(rowOf([44, 44, 44, 36])));
  assert.deepEqual(f1Keys(rowOf([44, 44, 44, 44])), [], 'consistent row ⇒ no F1 findings');
});

test('F1 keys: a re-kinded, renamed or removed member changes only its own keys (--compare)', () => {
  const at = (id, x, o) =>
    ctl({ id, x, ancestors: [{ id: 10 + id, layout: 'other' }, GRID], ...o });
  // A, B match; C is a fake 31px field-frame with a light border; D is a 38px input
  const A = at(0, 0, { key: 'input|ชื่อลูกค้า|0' });
  const B = at(1, 216, { key: 'native-select|สาขา|0', kind: 'native-select', tag: 'select' });
  const C = at(2, 432, {
    key: 'field-frame|ก่อนภาษี|0',
    kind: 'field-frame',
    tag: 'div',
    h: 31,
    borderColor: 'rgb(228, 228, 231)',
  });
  const D = at(3, 648, { key: 'input|ส่วนลด|0', h: 38 });
  const all = (property, members) => members.map((m) => `${property}@${m}`);
  const names = [
    'input|ชื่อลูกค้า|0',
    'native-select|สาขา|0',
    'field-frame|ก่อนภาษี|0',
    'input|ส่วนลด|0',
  ];
  const before = f1Keys([A, B, C, D]);
  assert.deepEqual(before, [
    ...all('height', names),
    ...all('borderColor', names),
    ...all('bottom', names),
  ]);
  const others = (keys, member) => keys.filter((k) => !k.endsWith(`@${member}`));
  // renaming B's label and changing its kind replaces B's keys only
  const renamedB = {
    ...B,
    key: 'select-trigger|สาขาที่ขาย|0',
    kind: 'select-trigger',
    tag: 'button',
  };
  const renamed = f1Keys([A, renamedB, C, D]);
  assert.deepEqual(others(renamed, renamedB.key), others(before, B.key));
  // C becomes a ReadOnlyField: new kind, new key, 44px, same border. Its old keys go, the border row
  // is now consistent (all its keys go), and the height/bottom rows still differ because of D, so
  // C is reported again under its new key — the other members keep exactly the same keys.
  const fixedC = {
    ...C,
    key: 'readonly|ก่อนภาษี|0',
    kind: 'readonly',
    tag: 'input',
    h: 44,
    borderColor: A.borderColor,
    backgroundColor: 'rgb(244, 244, 245)',
  };
  const afterFix = f1Keys([A, B, fixedC, D]);
  assert.ok(!afterFix.some((k) => k.endsWith(`@${C.key}`)), "C's old keys are gone");
  assert.ok(!afterFix.some((k) => k.startsWith('borderColor@')), 'border row is consistent');
  assertNoNewKeys(before, others(afterFix, fixedC.key));
  assert.deepEqual(others(afterFix, fixedC.key), [
    ...all('height', [A.key, B.key, D.key]),
    ...all('bottom', [A.key, B.key, D.key]),
  ]);
  // removing C drops C's keys; the border row becomes consistent; nothing new appears
  assertNoNewKeys(before, f1Keys([A, B, D]));
  // fixing D too makes the row consistent: no F1 findings at all
  assert.deepEqual(f1Keys([A, B, fixedC, { ...D, h: 44 }]), []);
});

test('F2 placeholder wider than the content box (canvas ink vs content width + 1)', () => {
  const [a] = pair({ placeholderInkWidth: 180 });
  assert.deepEqual(rulesOf([a]), ['F2:P2']);
  assert.deepEqual(evaluateFields([a], CTX)[0].detail, {
    sub: 'placeholder',
    inkWidth: 180,
    contentWidth: 174,
  });
  assert.deepEqual(rulesOf([{ ...a, placeholderInkWidth: 175 }]), []);
  assert.deepEqual(rulesOf([{ ...a, kind: 'textarea', placeholderInkWidth: 500 }]), []);
});

test('F2 native select: longest option wider than the content box (numbers only)', () => {
  const [, b] = pair({}, { longestOptionInkWidth: 200, optionCount: 12 });
  const [finding] = evaluateFields([b], CTX);
  assert.equal(finding.key, 'option@native-select|สาขา|0');
  assert.deepEqual(finding.detail, {
    sub: 'option',
    inkWidth: 200,
    contentWidth: 146,
    optionCount: 12,
  });
  assert.deepEqual(rulesOf([{ ...b, longestOptionInkWidth: 147 }]), []);
  assert.deepEqual(rulesOf([{ ...b, kind: 'input' }]), [], 'only native selects');
});

test('F2 Radix select-value overflow on either axis', () => {
  const trigger = ctl({ kind: 'select-trigger', tag: 'button', key: 'select-trigger|สถานะ|0' });
  assert.deepEqual(rulesOf([{ ...trigger, valueOverflowX: true }]), ['F2:P2']);
  assert.deepEqual(rulesOf([{ ...trigger, valueOverflowY: true }]), ['F2:P2']);
  assert.deepEqual(evaluateFields([{ ...trigger, valueOverflowY: true }], CTX)[0].detail, {
    sub: 'value',
    overflowX: false,
    overflowY: true,
  });
  assert.deepEqual(rulesOf([trigger]), []);
});

test('F3 two interactive boxes overlap > 1px: P2, P1 when one covers the other centre', () => {
  assert.deepEqual(rulesOf(two()), ['F3:P2']);
  assert.deepEqual(evaluateFields(two(), CTX)[0].detail, {
    overlapX: 10,
    overlapY: 34,
    covered: false,
  });
  assert.deepEqual(rulesOf(two({ coveredBy: 1 })), ['F3:P1']);
  assert.deepEqual(rulesOf(two({}, { coveredBy: 0 })), ['F3:P1']);
  assert.deepEqual(rulesOf(two({}, { x: 99 })), [], 'exactly 1px is not an overlap');
});

test('F3 skips ancestor/descendant, other scroll containers, dialog vs page, contained boxes', () => {
  assert.deepEqual(rulesOf(two({}, { targetAncestors: [0] })), []);
  assert.deepEqual(rulesOf(two({ scroller: 3 })), []);
  assert.deepEqual(rulesOf(two({ scope: 'dialog:0' })), []);
  assert.deepEqual(rulesOf(two({ scope: 'page' })), ['F3:P2'], 'page chrome vs #main still counts');
  const inner = { x: 70, y: 10, w: 24, h: 24 };
  assert.deepEqual(rulesOf(two({}, inner)), [], 'contained: left to F4');
  assert.deepEqual(rulesOf(two({ coveredBy: 1 }, inner)), ['F3:P1'], 'contained but covering');
});

test('F4 absolute adornment inside the content box or over the text ink', () => {
  // NativeSelect geometry: pr-10 ⇒ content right at 159; chevron at 171..187 ⇒ no finding
  const select = ctl({
    kind: 'native-select',
    contentLeft: 13,
    contentRight: 159,
    contentWidth: 146,
    longestOptionInkWidth: 120,
    adornments: [{ x: 171, y: 114, w: 16, h: 16, side: 'right' }],
  });
  assert.deepEqual(rulesOf([select]), []);
  // clear button at 150..174 with pr-3 ⇒ 9px short; placeholder ink to 158 overlaps 8px
  const cleared = ctl({
    contentLeft: 13,
    contentRight: 159,
    contentWidth: 146,
    placeholderInkWidth: 145,
    adornments: [{ x: 150, y: 110, w: 24, h: 24, side: 'right' }],
  });
  const [right] = evaluateFields([cleared], CTX);
  assert.equal(right.key, 'right0@input|ชื่อลูกค้า|0');
  assert.deepEqual(right.detail, { side: 'right', reserveShort: 9, inkOverlap: 8 });
  // leading icon 12..28 with pl-9 (content from 37) ⇒ fine; with pl-3 (content from 13) ⇒ F4
  const icon = { x: 12, y: 114, w: 16, h: 16, side: 'left' };
  assert.deepEqual(rulesOf([ctl({ contentLeft: 37, adornments: [icon] })]), []);
  assert.deepEqual(evaluateFields([ctl({ contentLeft: 13, adornments: [icon] })], CTX)[0].detail, {
    side: 'left',
    reserveShort: 15,
    inkOverlap: 0,
  });
});

test('evaluateFields ignores typography facts and leaves evaluateTypography alone', () => {
  assert.deepEqual(evaluateFields([{ kind: 'text', text: 'ข้อความ' }], CTX), []);
  assert.equal(typeof evaluateTypography, 'function');
});
```

- [ ] **Step 2: Run it — expect FAIL**

  ```bash
  node --test tools/typography-audit/fields.test.mjs 2>&1 | grep -E "SyntaxError|ℹ fail"
  ```
  - Expected: `SyntaxError: The requested module './rules.mjs' does not provide an export named 'evaluateFields'` and `ℹ fail 1`.

- [ ] **Step 3: Append the F1–F4 rules to `tools/typography-audit/rules.mjs`**
  - Add after line 299 (the closing `}` of `compareFacts`, the last line of the file).
  - Leave one blank line, then paste this exact text:

```js
// ---------------------------------------------------------------------------------------------
// Field scale (spec docs/superpowers/specs/2026-11-14-dropdown-search-field-scale-design.md §5).
// Consumes FieldFact[] from window.__collectFields (collect.js documents every field) and produces
// Finding[] for F1–F4 with the same shape as evaluateTypography, so findingKey / diffFindings work.
// Keys: F1 <property>@<memberKey> (one per member of an inconsistent row) ·
// F2 placeholder|option|value@<key> · F3 <targetKey>~<targetKey> · F4 left|right<n>@<key>.
// Additive only: nothing above this line reads these exports. F5 is a source-scan unit test.

export const F1_ROW_OVERLAP_MIN = 0.5; // vertical overlap ÷ the shorter control height
export const F1_ROW_LAYOUTS = ['flex-row', 'grid']; // nearest common ancestor layouts that make a row
export const F1_EXCLUDED_KINDS = ['textarea'];
export const F1_HEIGHT_TOLERANCE_PX = 2;
export const F1_RADIUS_TOLERANCE_PX = 1;
export const F1_FONT_TOLERANCE_PX = 0.5;
export const F1_BOTTOM_TOLERANCE_PX = 2;
export const F1_LABEL_FONT_TOLERANCE_PX = 0.5;
export const F1_LABEL_GAP_TOLERANCE_PX = 2;
export const F2_TEXT_SLACK_PX = 1;
export const F3_OVERLAP_MIN_PX = 1;
export const F3_CONTAIN_SLACK_PX = 1;
export const F4_RESERVE_SLACK_PX = 0.5;

const controlFacts = (facts) => facts.filter((f) => f.type === 'control');
const targetFacts = (facts) => facts.filter((f) => f.type === 'target');
const spread = (values) => Math.max(...values) - Math.min(...values);
const round2 = (n) => Math.round(n * 100) / 100;

export function verticalOverlapRatio(a, b) {
  const overlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const shorter = Math.min(a.h, b.h);
  return shorter > 0 ? Math.max(0, overlap) / shorter : 0;
}

// first entry of a.ancestors (nearest first) that is also an ancestor of b
export function nearestCommonAncestor(a, b) {
  const ids = new Set((b.ancestors ?? []).map((n) => n.id));
  return (a.ancestors ?? []).find((n) => ids.has(n.id)) ?? null;
}

export function sameFieldRow(a, b) {
  if (a.scope !== b.scope) return false;
  if (verticalOverlapRatio(a, b) < F1_ROW_OVERLAP_MIN) return false;
  const common = nearestCommonAncestor(a, b);
  return common !== null && F1_ROW_LAYOUTS.includes(common.layout);
}

const f1Eligible = (c) => !c.largeText && !F1_EXCLUDED_KINDS.includes(c.kind);

// rows = connected components of sameFieldRow over F1-eligible controls; members keep DOM order
export function groupFieldRows(facts) {
  const controls = controlFacts(facts).filter(f1Eligible);
  const parent = controls.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      if (sameFieldRow(controls[i], controls[j])) parent[find(j)] = find(i);
    }
  }
  const rows = new Map();
  controls.forEach((c, i) => {
    const root = find(i);
    if (!rows.has(root)) rows.set(root, []);
    rows.get(root).push(c);
  });
  return [...rows.values()].filter((row) => row.length >= 2);
}

const hasLabelAbove = (c) => Boolean(c.label && c.label.above);
const F1_CHECKS = [
  { property: 'height', value: (c) => c.h, tolerance: F1_HEIGHT_TOLERANCE_PX },
  { property: 'radius', value: (c) => c.borderRadius, tolerance: F1_RADIUS_TOLERANCE_PX },
  { property: 'fontSize', value: (c) => c.fontSize, tolerance: F1_FONT_TOLERANCE_PX },
  { property: 'borderColor', value: (c) => c.borderColor, distinct: true },
  // ReadOnlyField is darker on purpose (spec §4.1) — its fill must not count as a mismatch.
  { property: 'background', value: (c) => c.backgroundColor, distinct: true, skipReadonly: true },
  { property: 'bottom', value: (c) => c.y + c.h, tolerance: F1_BOTTOM_TOLERANCE_PX },
  {
    property: 'labelFontSize',
    value: (c) => c.label.fontSize,
    tolerance: F1_LABEL_FONT_TOLERANCE_PX,
    labelled: true,
  },
  {
    property: 'labelGap',
    value: (c) => c.label.gap,
    tolerance: F1_LABEL_GAP_TOLERANCE_PX,
    labelled: true,
  },
];

// The row decides whether a property is inconsistent (spread > tolerance, or values differ); when it
// is, EVERY member of the row is reported for that property — no majority vote, so no member is
// singled out as "the odd one". Each finding is keyed by its own member only
// (`<property>@<memberKey>`, memberKey = kind|name|dup, dup counted page-wide in DOM order).
// Guarantee: with the same set of measured controls in a row/check, changing values toward
// agreement never adds a key, and a fully consistent row has no keys for that property. A correct
// change can still add keys ("exposed, not introduced"): (a) adding / removing / renaming /
// re-kinding a control renumbers later controls with the same kind|name page-wide (and the renamed /
// re-kinded control itself gets new keys while its row is inconsistent); (b) the row or
// check gains members (newly measured, no longer largeText, re-kinded out of textarea, label moved
// above, rows merged) while it is inconsistent; (c) derived bottom (y + h) newly mismatches after
// a height / labelGap fix removes a compensating offset. --compare triage: plan cross-task notes.
function evaluateF1(facts, emit) {
  for (const row of groupFieldRows(facts)) {
    for (const check of F1_CHECKS) {
      const members = (check.labelled ? row.filter(hasLabelAbove) : row).filter(
        (c) => !(check.skipReadonly && c.kind === 'readonly'),
      );
      if (members.length < 2) continue;
      const values = members.map(check.value);
      const differs = check.distinct ? new Set(values).size > 1 : spread(values) > check.tolerance;
      if (!differs) continue;
      const keys = members.map((c) => c.key);
      const rowDetail = {
        ...(check.distinct ? {} : { spread: round2(spread(values)), tolerance: check.tolerance }),
        members: members.map((c, i) => ({ key: c.key, value: values[i] })),
      };
      keys.forEach((key, i) => {
        emit('F1', 'P2', `${check.property}@${key}`, `${key} (row: ${keys.join(' / ')})`, {
          property: check.property,
          value: values[i],
          ...rowDetail,
        });
      });
    }
  }
}

function evaluateF2(facts, emit) {
  for (const c of controlFacts(facts)) {
    const room = c.contentWidth + F2_TEXT_SLACK_PX;
    const contentWidth = round2(c.contentWidth);
    if (
      c.kind !== 'textarea' &&
      Number.isFinite(c.placeholderInkWidth) &&
      c.placeholderInkWidth > room
    ) {
      emit('F2', 'P2', `placeholder@${c.key}`, c.key, {
        sub: 'placeholder',
        inkWidth: round2(c.placeholderInkWidth),
        contentWidth,
      });
    }
    if (
      c.kind === 'native-select' &&
      Number.isFinite(c.longestOptionInkWidth) &&
      c.longestOptionInkWidth > room
    ) {
      emit('F2', 'P2', `option@${c.key}`, c.key, {
        sub: 'option',
        inkWidth: round2(c.longestOptionInkWidth),
        contentWidth,
        optionCount: c.optionCount,
      });
    }
    if (c.valueOverflowX || c.valueOverflowY) {
      emit('F2', 'P2', `value@${c.key}`, c.key, {
        sub: 'value',
        overflowX: Boolean(c.valueOverflowX),
        overflowY: Boolean(c.valueOverflowY),
      });
    }
  }
}

const inDialog = (t) => String(t.scope).startsWith('dialog:');
const containsBox = (outer, inner) =>
  inner.x >= outer.x - F3_CONTAIN_SLACK_PX &&
  inner.y >= outer.y - F3_CONTAIN_SLACK_PX &&
  inner.x + inner.w <= outer.x + outer.w + F3_CONTAIN_SLACK_PX &&
  inner.y + inner.h <= outer.y + outer.h + F3_CONTAIN_SLACK_PX;

function evaluateF3(facts, emit) {
  const targets = targetFacts(facts);
  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      const a = targets[i];
      const b = targets[j];
      if ((a.scroller ?? null) !== (b.scroller ?? null)) continue;
      if (a.scope !== b.scope && (inDialog(a) || inDialog(b))) continue;
      if ((a.targetAncestors ?? []).includes(b.id) || (b.targetAncestors ?? []).includes(a.id))
        continue;
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (overlapX <= F3_OVERLAP_MIN_PX || overlapY <= F3_OVERLAP_MIN_PX) continue;
      const covered = a.coveredBy === b.id || b.coveredBy === a.id;
      // a target inside another (clear button in a field) belongs to F4 unless it covers the other
      if (!covered && (containsBox(a, b) || containsBox(b, a))) continue;
      emit('F3', covered ? 'P1' : 'P2', `${a.key}~${b.key}`, `${a.key} / ${b.key}`, {
        overlapX: round2(overlapX),
        overlapY: round2(overlapY),
        covered,
      });
    }
  }
}

function evaluateF4(facts, emit) {
  for (const c of controlFacts(facts)) {
    const textInk = Math.max(c.placeholderInkWidth ?? 0, c.longestOptionInkWidth ?? 0);
    const inkRight = c.contentLeft + Math.min(textInk, Math.max(0, c.contentWidth));
    const perSide = { left: 0, right: 0 };
    for (const ad of c.adornments ?? []) {
      const n = perSide[ad.side]++;
      const reserveShort = ad.side === 'left' ? ad.x + ad.w - c.contentLeft : c.contentRight - ad.x;
      const inkOverlap =
        textInk > 0
          ? Math.max(0, Math.min(inkRight, ad.x + ad.w) - Math.max(c.contentLeft, ad.x))
          : 0;
      if (reserveShort <= F4_RESERVE_SLACK_PX && inkOverlap <= F4_RESERVE_SLACK_PX) continue;
      emit('F4', 'P2', `${ad.side}${n}@${c.key}`, c.key, {
        side: ad.side,
        reserveShort: round2(Math.max(0, reserveShort)),
        inkOverlap: round2(inkOverlap),
      });
    }
  }
}

// ctx = { width, route?, theme?, role? } — copied onto every finding (findingKey needs them)
export function evaluateFields(facts, ctx = {}) {
  const out = [];
  const emit = (rule, severity, key, text, detail) =>
    out.push({
      rule,
      severity,
      route: ctx.route,
      width: ctx.width,
      theme: ctx.theme,
      role: ctx.role,
      key,
      text,
      detail,
    });
  evaluateF1(facts, emit);
  evaluateF2(facts, emit);
  evaluateF3(facts, emit);
  evaluateF4(facts, emit);
  return out;
}
```

- [ ] **Step 4: Run the new and the existing rule tests — expect PASS**

  ```bash
  node --test tools/typography-audit/fields.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"
  node --test tools/typography-audit/rules.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"
  ```
  - Expected: `ℹ tests 19` / `ℹ pass 19` / `ℹ fail 0`.
  - Then `ℹ tests 51` / `ℹ pass 51` / `ℹ fail 0`, which shows R1–R12 are unchanged.

- [ ] **Step 5: Commit**

```bash
git add tools/typography-audit/rules.mjs tools/typography-audit/fields.test.mjs && git commit -F - <<'EOF'
feat(tools): field-scale rules F1-F4 (evaluateFields) for the typography audit

Pure rules over FieldFact[]: F1 row mismatch (height, radius, font, border,
background, bottom edge, label font/gap), F2 clipped placeholder / native option /
select-value, F3 overlapping click targets (P1 when covered), F4 adornment over
text. Existing R1-R12 exports untouched.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 6: Write the failing collector tests — create `tools/typography-audit/collect-fields.test.mjs`**

```js
// Field scale collector tests (real Chromium, real Noto Sans Thai files) — same harness as
// collect.test.mjs: the page and apps/web/public/fonts are served from a fake http origin.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { evaluateFields, normalizeKeyText } from './rules.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '../../apps/web/public');
const COLLECT_TAG = { path: path.join(HERE, 'collect.js') };
const ORIGIN = 'http://fields.test';
// Global Constraints exclude list, verbatim (same as collect.test.mjs).
const EXCLUDE =
  '.voucher-sheet, .document-sheet, .bc-document, .document-landscape, .document-print-dialog, .template-paper, .font-sarabun, .mobile-receipt, .sticker, .print-stickers, .tiptap, .parcel-label, .contract-body, iframe, svg';
const CONTROL_FIELDS = [
  'type',
  'id',
  'key',
  'kind',
  'tag',
  'scope',
  'ancestors',
  'x',
  'y',
  'w',
  'h',
  'borderRadius',
  'borderWidth',
  'borderColor',
  'backgroundColor',
  'fontSize',
  'largeText',
  'label',
  'contentLeft',
  'contentRight',
  'contentWidth',
  'placeholderInkWidth',
  'optionCount',
  'longestOptionInkWidth',
  'valueOverflowX',
  'valueOverflowY',
  'adornments',
];
const TARGET_FIELDS = [
  'type',
  'id',
  'key',
  'role',
  'scope',
  'scroller',
  'targetAncestors',
  'x',
  'y',
  'w',
  'h',
  'coveredBy',
];
// Tailwind preflight equivalent + one shared 44px field look (.f) and label look (.lab).
const BASE_STYLE = `body{margin:0;font-family:"Noto Sans Thai",sans-serif;font-size:16px;line-height:24px}
button,input,select,textarea{font-family:inherit;font-size:inherit;font-weight:inherit;line-height:inherit}
*,*::before,*::after{box-sizing:border-box}
.f{display:block;height:44px;width:200px;margin:0;padding:0 12px;border:1px solid rgb(212,212,216);border-radius:8px;background:rgb(255,255,255);font-size:14px}
.lab{display:block;margin:0 0 12px;font-size:14px;line-height:20px}`;
const html = (body) => `<!doctype html><html lang="th"><head><meta charset="utf-8">
<link rel="stylesheet" href="/fonts/noto-sans-thai/fonts.css"><style>${BASE_STYLE}</style></head><body>${body}</body></html>`;

let browser;
before(async () => {
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
});

async function openPage(body) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route(`${ORIGIN}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/')
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html(body) });
    const file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
    if (pathname.startsWith('/fonts/') && file.startsWith(PUBLIC + path.sep)) {
      const contentType = file.endsWith('.css') ? 'text/css; charset=utf-8' : 'font/woff2';
      return route.fulfill({ status: 200, contentType, body: await readFile(file) });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(async () => {
    void document.body.offsetHeight;
    await document.fonts.ready;
  });
  await page.addScriptTag(COLLECT_TAG);
  return page;
}

async function collect(body, options = {}) {
  const page = await openPage(body);
  try {
    return await page.evaluate((o) => window.__collectFields(o), { exclude: EXCLUDE, ...options });
  } finally {
    await page.close();
  }
}

const controls = (facts) => facts.filter((f) => f.type === 'control');
const targets = (facts) => facts.filter((f) => f.type === 'target');
const byKey = (facts, key) => {
  const found = facts.filter((f) => f.key === key);
  assert.equal(found.length, 1, `expected one fact with key ${key}, got ${found.length}`);
  return found[0];
};
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const CTX = { route: '/fixture', width: 1280, theme: 'light', role: 'owner' };

test('one control per outermost field, with its kind; non-field inputs are not controls', async () => {
  const facts = await collect(`
    <div data-slot="input-wrapper" class="f" style="display:flex;align-items:center"><input data-slot="input" placeholder="ค้นหา" style="border:0;padding:0;flex:1;min-width:0"></div>
    <div data-field-frame class="f"><input placeholder="แท็ก" style="border:0;padding:0;width:100%"></div>
    <input data-slot="readonly-field" class="f" readonly tabindex="-1" value="1,234.00">
    <button type="button" role="combobox" data-slot="select-trigger" class="f"><span data-slot="select-value">ทั้งหมด</span></button>
    <button type="button" role="combobox" aria-label="ผู้ติดต่อ" class="f">เลือก</button>
    <span style="position:relative;display:block"><select class="f" aria-label="สาขา"><option>ลาดพร้าว</option></select></span>
    <textarea class="f" style="height:96px" placeholder="หมายเหตุ"></textarea>
    <input class="f" placeholder="ชื่อ">
    <input type="checkbox"><input type="radio"><input type="hidden" value="x"><input type="file"><input type="submit" value="ส่ง">`);
  assert.deepEqual(
    controls(facts).map((f) => [f.id, f.kind, f.tag, f.key]),
    [
      [0, 'input-wrapper', 'div', 'input-wrapper|ค้นหา|0'],
      [1, 'field-frame', 'div', 'field-frame|แท็ก|0'],
      [2, 'readonly', 'input', 'readonly||0'],
      [3, 'select-trigger', 'button', 'select-trigger||0'],
      [4, 'combobox', 'button', 'combobox|ผู้ติดต่อ|0'],
      [5, 'native-select', 'select', 'native-select|สาขา|0'],
      [6, 'textarea', 'textarea', 'textarea|หมายเหตุ|0'],
      [7, 'input', 'input', 'input|ชื่อ|0'],
    ],
  );
  for (const f of controls(facts)) assert.deepEqual(Object.keys(f).sort(), [...CONTROL_FIELDS].sort());
  for (const f of targets(facts)) assert.deepEqual(Object.keys(f).sort(), [...TARGET_FIELDS].sort());
  assert.deepEqual(
    facts.map((f) => f.id),
    facts.map((_, i) => i),
    'ids are unique and dense: controls first, then targets',
  );
});

test('values never leave the page: typed value, option text, select-value text', async () => {
  const facts = await collect(`
    <input class="f" placeholder="ค้นหาลูกค้า" value="นายสมชาย 0812345678">
    <input data-slot="readonly-field" class="f" readonly value="ยอดลับ 9,999">
    <select class="f" aria-label="สาขา"><option>ลาดพร้าวลับ</option><option>บางนาลับ</option></select>
    <button type="button" role="combobox" data-slot="select-trigger" class="f"><span data-slot="select-value">สาขาลับ</span></button>`);
  const json = JSON.stringify(facts);
  for (const secret of ['สมชาย', '0812345678', 'ยอดลับ', '9,999', 'ลาดพร้าวลับ', 'บางนาลับ', 'สาขาลับ'])
    assert.ok(!json.includes(secret), secret);
  const select = byKey(facts, 'native-select|สาขา|0');
  assert.equal(select.optionCount, 2);
  assert.equal(typeof select.longestOptionInkWidth, 'number');
});

test('wrapping labels name controls by their own words only: no option, value or chip text', async () => {
  const facts = await collect(`
    <label style="display:block">สาขา <select class="f"><option>ลาดพร้าวลับ</option><option>บางนาลับ</option></select></label>
    <label style="display:block">หมายเหตุ <textarea class="f" style="height:96px">ข้อความลับในช่อง</textarea></label>
    <label style="display:block">สถานะ <button type="button" role="combobox" data-slot="select-trigger" class="f"><span data-slot="select-value">สถานะลับ</span></button></label>
    <label style="display:block">แท็ก <div data-field-frame class="f" style="display:flex;align-items:center"><span>แท็กลับ</span><input style="border:0;padding:0;flex:1;min-width:0"></div></label>
    <label style="display:block">ธนาคาร <input class="f"><div role="listbox"><div role="option">กสิกรลับ</div><div role="option">ไทยพาณิชย์ลับ</div></div><span role="spinbutton">ค่าพิมพ์ลับ</span><span role="searchbox">ค่าพิมพ์ลับ</span><output>ค่าพิมพ์ลับ</output></label>
    <button type="button">เลือกบัญชี <span data-slot="select-value">บัญชีลับ</span></button>`);
  const json = JSON.stringify(facts);
  const secrets = [
    'ลาดพร้าวลับ',
    'บางนาลับ',
    'ข้อความลับในช่อง',
    'สถานะลับ',
    'แท็กลับ',
    'กสิกรลับ',
    'ไทยพาณิชย์ลับ',
    'ค่าพิมพ์ลับ',
    'บัญชีลับ',
  ];
  for (const secret of secrets) assert.ok(!json.includes(secret), secret);
  assert.deepEqual(
    controls(facts).map((f) => f.key),
    [
      'native-select|สาขา|0',
      'textarea|หมายเหตุ|0',
      'select-trigger|สถานะ|0',
      'field-frame|แท็ก|0',
      'input|ธนาคาร|0',
    ],
  );
  assert.ok(byKey(facts, 'target-button|เลือกบัญชี|0'), 'a button is named by its own words');
  const findings = JSON.stringify(evaluateFields(facts, CTX));
  assert.ok(!findings.includes('ลับ'), 'findings carry no values');
});

test('box, radius, border, background, font, content box and largeText', async () => {
  const facts = await collect(`
    <input class="f" placeholder="ชื่อ" style="padding:0 40px 0 12px">
    <input class="f" placeholder="ไร้ขอบ" style="border:0;background:transparent;border-radius:6px 6px 0 0">
    <input class="f text-lg" placeholder="ยอดเงินใหญ่">
    <input class="f" placeholder="ตัวใหญ่" style="font-size:18px">`);
  const a = byKey(facts, 'input|ชื่อ|0');
  assert.deepEqual([a.x, a.y, a.w, a.h], [0, 0, 200, 44]);
  assert.equal(a.borderRadius, 8);
  assert.equal(a.borderWidth, 1);
  assert.equal(a.borderColor, 'rgb(212, 212, 216)');
  assert.equal(a.backgroundColor, 'rgb(255, 255, 255)');
  assert.equal(a.fontSize, 14);
  assert.deepEqual([a.contentLeft, a.contentRight, a.contentWidth], [13, 159, 146]);
  assert.equal(a.largeText, false);
  const bare = byKey(facts, 'input|ไร้ขอบ|0');
  assert.deepEqual([bare.borderWidth, bare.borderColor], [0, 'none']);
  assert.equal(bare.backgroundColor, 'rgba(0, 0, 0, 0)');
  assert.equal(bare.borderRadius, 6, 'largest corner');
  assert.equal(byKey(facts, 'input|ยอดเงินใหญ่|0').largeText, true, 'text-lg class');
  assert.equal(byKey(facts, 'input|ตัวใหญ่|0').largeText, true, '18px font');
});

test('scope and ancestors: page / #main / dialog, layout of every ancestor up to the scope root', async () => {
  const facts = await collect(`
    <div style="display:flex;gap:8px"><input class="f" placeholder="หน้า"></div>
    <div id="main">
      <div style="display:grid;grid-template-columns:200px 200px;gap:16px"><div><input class="f" placeholder="ก"></div><div><input class="f" placeholder="ข"></div></div>
      <div style="display:flex;flex-direction:column"><input class="f" placeholder="ค"></div>
    </div>
    <div role="dialog"><input class="f" placeholder="ในกล่อง"></div>`);
  const layouts = (f) => f.ancestors.map((x) => x.layout);
  const pg = byKey(facts, 'input|หน้า|0');
  const a = byKey(facts, 'input|ก|0');
  const b = byKey(facts, 'input|ข|0');
  const c = byKey(facts, 'input|ค|0');
  const dialog = byKey(facts, 'input|ในกล่อง|0');
  assert.deepEqual([pg.scope, a.scope, c.scope, dialog.scope], ['page', 'main', 'main', 'dialog:0']);
  assert.deepEqual(layouts(pg), ['flex-row'], 'stops before body');
  assert.deepEqual(layouts(a), ['other', 'grid', 'other']);
  assert.deepEqual(layouts(c), ['flex-col', 'other']);
  assert.deepEqual(layouts(dialog), ['other'], 'stops at the dialog');
  assert.notEqual(a.ancestors[0].id, b.ancestors[0].id);
  assert.equal(a.ancestors[1].id, b.ancestors[1].id, 'shared grid');
  assert.equal(a.ancestors[2].id, c.ancestors[1].id, 'shared #main');
});

test('label: for= above with its gap, aria-labelledby, wrapping label, sr-only label ignored', async () => {
  const facts = await collect(`
    <label for="a" class="lab">ชื่อลูกค้า</label><input id="a" class="f">
    <span id="lb" class="lab" style="font-size:12px;margin-bottom:6px">เบอร์โทร</span><button type="button" role="combobox" aria-labelledby="lb" class="f"></button>
    <label style="display:block">ที่อยู่ <input class="f" placeholder="บ้านเลขที่"></label>
    <label for="d" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">ซ่อน</label><input id="d" class="f" placeholder="ป้ายซ่อน">`);
  assert.deepEqual(byKey(facts, 'input|ชื่อลูกค้า|0').label, { fontSize: 14, gap: 12, above: true });
  assert.deepEqual(byKey(facts, 'combobox|เบอร์โทร|0').label, { fontSize: 12, gap: 6, above: true });
  assert.equal(byKey(facts, 'input|ที่อยู่|0').label.above, false, 'a wrapping label is not above');
  assert.equal(byKey(facts, 'input|ป้ายซ่อน|0').label, null);
});

test('placeholder and longest native option are canvas-measured against the content box (F2)', async () => {
  const PH = 'ค้นหาด้วยชื่อลูกค้า เบอร์โทร หรือเลขสัญญา';
  const page = await openPage(`
    <input class="f" style="width:120px" placeholder="${PH}">
    <input class="f" placeholder="ชื่อ">
    <select class="f" style="width:160px;padding-right:40px" aria-label="บัญชี"><option>สั้น</option><option>ธนาคาร - กสิกรไทย ออมทรัพย์ - 2031165209</option></select>
    <select class="f" aria-label="สถานะ"><option>เปิด</option><option>ปิด</option></select>
    <span id="probe" style="font-size:14px;white-space:nowrap">${PH}</span>`);
  try {
    const facts = await page.evaluate((o) => window.__collectFields(o), { exclude: EXCLUDE });
    const rendered = await page.evaluate(
      () => document.getElementById('probe').getBoundingClientRect().width,
    );
    const long = byKey(facts, `input|${normalizeKeyText(PH)}|0`);
    near(long.placeholderInkWidth, rendered, 0.5, 'placeholder ink vs rendered span');
    assert.equal(long.contentWidth, 94);
    assert.ok(long.placeholderInkWidth > long.contentWidth + 1);
    const short = byKey(facts, 'input|ชื่อ|0');
    assert.ok(short.placeholderInkWidth > 0 && short.placeholderInkWidth < short.contentWidth);
    const account = byKey(facts, 'native-select|บัญชี|0');
    assert.equal(account.optionCount, 2);
    assert.equal(account.contentWidth, 106);
    assert.ok(account.longestOptionInkWidth > account.contentWidth + 1);
    const status = byKey(facts, 'native-select|สถานะ|0');
    assert.ok(status.longestOptionInkWidth < status.contentWidth);
    assert.ok(!JSON.stringify(facts).includes('กสิกรไทย'), 'option text is never recorded');
    assert.deepEqual(
      evaluateFields(facts, CTX)
        .filter((f) => f.rule === 'F2')
        .map((f) => f.key),
      [`placeholder@input|${normalizeKeyText(PH)}|0`, 'option@native-select|บัญชี|0'],
    );
  } finally {
    await page.close();
  }
});

test('Radix select-value overflow on either axis (F2 value)', async () => {
  const VALUE = 'ผู้จัดการ สาขา ลาดพร้าว ที่มี ชื่อ ยาวมาก';
  const clamp =
    'min-width:0;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:1';
  const facts = await collect(`
    <button type="button" role="combobox" aria-label="แคบตัดบรรทัด" data-slot="select-trigger" class="f" style="width:120px;display:flex;align-items:center"><span data-slot="select-value" style="${clamp}">${VALUE}</span></button>
    <button type="button" role="combobox" aria-label="แคบจุดไข่ปลา" data-slot="select-trigger" class="f" style="width:120px;display:flex;align-items:center"><span data-slot="select-value" style="min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${VALUE}</span></button>
    <button type="button" role="combobox" aria-label="พอดี" data-slot="select-trigger" class="f" style="display:flex;align-items:center"><span data-slot="select-value" style="${clamp}">ทั้งหมด</span></button>`);
  const pick = (name) => byKey(facts, `select-trigger|${name}|0`);
  assert.equal(pick('แคบตัดบรรทัด').valueOverflowY, true, 'line-clamp-1 hides the wrapped lines');
  assert.deepEqual(
    [pick('แคบจุดไข่ปลา').valueOverflowX, pick('แคบจุดไข่ปลา').valueOverflowY],
    [true, false],
  );
  assert.deepEqual([pick('พอดี').valueOverflowX, pick('พอดี').valueOverflowY], [false, false]);
  assert.deepEqual(
    evaluateFields(facts, CTX)
      .filter((f) => f.rule === 'F2')
      .map((f) => f.key),
    ['value@select-trigger|แคบตัดบรรทัด|0', 'value@select-trigger|แคบจุดไข่ปลา|0'],
  );
});

test('adornments: NativeSelect chevron, clear button, leading icon two levels up (F4)', async () => {
  const facts = await collect(`
    <span style="position:relative;display:block;width:200px"><select class="f" style="padding-right:40px" aria-label="สาขา"><option>ลาดพร้าว</option></select><svg aria-hidden="true" style="position:absolute;right:13px;top:14px;width:16px;height:16px"></svg></span>
    <div style="position:relative;width:200px"><input class="f" placeholder="ค้นหาสินค้า"><button type="button" aria-label="ล้าง" style="position:absolute;right:4px;top:10px;width:24px;height:24px;padding:0;border:0"></button></div>
    <div style="position:relative;width:200px"><svg aria-hidden="true" style="position:absolute;left:12px;top:14px;width:16px;height:16px;z-index:1"></svg><span style="position:relative;display:block"><select class="f" style="padding-left:36px" aria-label="ผู้รับมอบหมาย"><option>ทั้งหมด</option></select></span></div>
    <div style="position:relative;width:200px"><svg aria-hidden="true" style="position:absolute;left:12px;top:14px;width:16px;height:16px"></svg><input class="f" placeholder="ค้นหางาน"></div>`);
  assert.deepEqual(byKey(facts, 'native-select|สาขา|0').adornments, [
    { x: 171, y: 14, w: 16, h: 16, side: 'right' },
  ]);
  assert.deepEqual(byKey(facts, 'input|ค้นหาสินค้า|0').adornments, [
    { x: 172, y: 54, w: 24, h: 24, side: 'right' },
  ]);
  assert.deepEqual(byKey(facts, 'native-select|ผู้รับมอบหมาย|0').adornments, [
    { x: 12, y: 102, w: 16, h: 16, side: 'left' },
  ]);
  const findings = evaluateFields(facts, CTX);
  assert.deepEqual(
    findings
      .filter((f) => f.rule === 'F4')
      .map((f) => [f.key, f.detail.side, f.detail.reserveShort, f.detail.inkOverlap]),
    [
      ['right0@input|ค้นหาสินค้า|0', 'right', 15, 0],
      ['left0@input|ค้นหางาน|0', 'left', 15, 15],
    ],
  );
  assert.deepEqual(
    findings.filter((f) => f.rule === 'F3'),
    [],
    'a clear button inside its field is F4, not F3',
  );
});

test('targets: role, ancestors, scroller, coveredBy (F3 P2 and P1)', async () => {
  const facts = await collect(`
    <div style="position:relative;height:60px">
      <button style="position:absolute;left:0;top:0;width:120px;height:44px">บันทึก</button>
      <button style="position:absolute;left:100px;top:8px;width:120px;height:44px">ยกเลิก</button>
    </div>
    <div style="position:relative;height:60px">
      <a href="#x" style="position:absolute;left:0;top:0;width:120px;height:44px;display:block">ดูรายละเอียดลูกค้า</a>
      <button style="position:absolute;left:30px;top:0;width:60px;height:44px">ลบ</button>
    </div>
    <a href="#card" style="display:block;width:200px;padding:8px"><button type="button">ซ้อนในลิงก์</button></a>
    <div style="overflow:auto;height:60px;position:relative"><button style="position:absolute;left:0;top:0;width:120px;height:44px">ในกล่องเลื่อน</button></div>`);
  const save = byKey(facts, 'target-button|บันทึก|0');
  const cancel = byKey(facts, 'target-button|ยกเลิก|0');
  const link = byKey(facts, 'target-link||0');
  const removeButton = byKey(facts, 'target-button|ลบ|0');
  const card = byKey(facts, 'target-link||1');
  const inner = byKey(facts, 'target-button|ซ้อนในลิงก์|0');
  const scrolled = byKey(facts, 'target-button|ในกล่องเลื่อน|0');
  assert.equal(save.role, 'button');
  assert.equal(link.role, 'link');
  assert.equal(save.coveredBy, null);
  assert.equal(cancel.coveredBy, null);
  assert.equal(link.coveredBy, removeButton.id, 'the delete button sits on the link centre');
  assert.deepEqual(inner.targetAncestors, [card.id]);
  assert.equal(save.scroller, null);
  assert.equal(typeof scrolled.scroller, 'number');
  assert.ok(!JSON.stringify(facts).includes('ดูรายละเอียดลูกค้า'), 'link text is never a key');
  assert.deepEqual(
    evaluateFields(facts, CTX)
      .filter((f) => f.rule === 'F3')
      .map((f) => [f.key, f.severity]),
    [
      ['target-button|บันทึก|0~target-button|ยกเลิก|0', 'P2'],
      ['target-link||0~target-button|ลบ|0', 'P1'],
    ],
  );
});

test('hidden, aria-hidden, sr-only, display:none and excluded subtrees are skipped', async () => {
  const facts = await collect(`
    <input class="f" placeholder="เห็น">
    <input class="f" placeholder="ซ่อน1" style="visibility:hidden">
    <div aria-hidden="true"><input class="f" placeholder="ซ่อน2"></div>
    <input class="f" placeholder="ซ่อน3" hidden>
    <input class="f" placeholder="ซ่อน4" style="display:none">
    <input placeholder="ซ่อน5" style="position:absolute;width:1px;height:1px;padding:0;border:0;overflow:hidden">
    <div class="sticker"><input class="f" placeholder="ซ่อน6"></div>`);
  assert.deepEqual(
    facts.map((f) => f.key),
    ['input|เห็น|0', 'target-field||0'],
  );
});

test('root option, missing root, determinism, no DOM residue, __collectTypography unchanged', async () => {
  const page = await openPage(
    '<div id="scope"><input class="f" placeholder="ใน"></div><input class="f" placeholder="นอก">',
  );
  try {
    const typoBefore = await page.evaluate(
      (exclude) => window.__collectTypography({ exclude }),
      EXCLUDE,
    );
    const htmlBefore = await page.evaluate(() => document.body.innerHTML);
    const a = await page.evaluate((exclude) => window.__collectFields({ exclude }), EXCLUDE);
    const b = await page.evaluate((exclude) => window.__collectFields({ exclude }), EXCLUDE);
    assert.deepEqual(a, b);
    assert.equal(await page.evaluate(() => document.body.innerHTML), htmlBefore);
    const typoAfter = await page.evaluate(
      (exclude) => window.__collectTypography({ exclude }),
      EXCLUDE,
    );
    assert.deepEqual(typoAfter, typoBefore);
    const scoped = await page.evaluate(() => window.__collectFields({ root: '#scope' }));
    assert.deepEqual(
      scoped.filter((f) => f.type === 'control').map((f) => f.key),
      ['input|ใน|0'],
    );
    await assert.rejects(
      page.evaluate(() => window.__collectFields({ root: '#missing' })),
      /root not found/,
    );
  } finally {
    await page.close();
  }
});
```

- [ ] **Step 7: Run it — expect FAIL**

  ```bash
  node --test tools/typography-audit/collect-fields.test.mjs 2>&1 | grep -E "__collectFields is not a function|^ℹ (tests|fail)" | head -4
  ```
  - Expected: four lines. First the summary, `ℹ tests 12` and `ℹ fail 12`. Then two lines `page.evaluate: TypeError: window.__collectFields is not a function`.

- [ ] **Step 8: Append the collector to `tools/typography-audit/collect.js`**
  - Add after line 627 (`})();`, the last line of the file). Leave one blank line, then paste this exact text.
  - Do not edit lines 1–627.

```js
/* Field scale collector (spec docs/superpowers/specs/2026-11-14-dropdown-search-field-scale-design.md §5).
 *
 * A second, independent export: window.__collectFields({ exclude, root }) → FieldFact[]. It shares no
 * state with __collectTypography above, so R1–R12 facts and keys cannot change. Values never leave the
 * page: no input value, no option text, no select-value text — only numbers and booleans (Ruling Q).
 * Label text, aria-label and placeholder are UI copy and only feed the key.
 *
 * Two fact types, ids unique per call (controls first, then targets, each in DOM order):
 *
 * ControlFact { type: 'control', id, key, kind, tag, scope, ancestors, x, y, w, h, borderRadius,
 *   borderWidth, borderColor, backgroundColor, fontSize, largeText, label, contentLeft, contentRight,
 *   contentWidth, placeholderInkWidth, optionCount, longestOptionInkWidth, valueOverflowX,
 *   valueOverflowY, adornments }
 *   - one per visible OUTERMOST [data-slot=input-wrapper] | [data-field-frame] |
 *     [data-slot=readonly-field] | [data-slot=select-trigger] | button[role=combobox] | select |
 *     textarea | input (not hidden/checkbox/radio/file/range/color/button/submit/reset/image)
 *   - kind: 'input-wrapper' | 'field-frame' | 'readonly' | 'select-trigger' | 'combobox' |
 *     'native-select' | 'textarea' | 'input'
 *   - key: kind|normalizeKeyText(label text || aria-label || placeholder)|dup — label text is the
 *     label's own words only: fields, options, buttons, <output>, comboboxes, listboxes, ARIA
 *     options, textboxes, searchboxes and spinbuttons, [data-slot=select-value] and editable
 *     (contenteditable ≠ "false") subtrees inside it are skipped (a wrapping label contains its
 *     control)
 *   - scope: 'dialog:<n>' (n = index among [role=dialog],[role=alertdialog] in DOM order) | 'main'
 *     (inside #main) | 'page'
 *   - ancestors: [{ id, layout: 'flex-row' | 'flex-col' | 'grid' | 'other' }] parent first, up to and
 *     including the scope root (body/html never); ids are per-call container ids
 *   - x/y/w/h: page-absolute border box · borderRadius: largest corner px · borderWidth: top px ·
 *     borderColor: computed top colour, 'none' when the top border is 0 or style none
 *   - fontSize / content box / placeholder / options come from the text control: the element itself,
 *     or for wrappers/frames its first inner input/select/textarea (button triggers use themselves)
 *   - largeText: a text-lg+ class (text-lg, text-xl, text-2xl…, text-[18px+]) or font ≥ 17.5px
 *   - label: { fontSize, gap, above } of the associated label (labels[0], else the first
 *     aria-labelledby id) — gap = control top − label bottom; above = label ends at or above the
 *     control top (+1px) and does not wrap it · null when none is visible
 *   - placeholderInkWidth: canvas width of the placeholder (null when there is none)
 *   - optionCount / longestOptionInkWidth: native select only (canvas, select font), else null
 *   - valueOverflowX/Y: [data-slot=select-value] scroll extent > client + 1 (false when absent)
 *   - adornments: [{ x, y, w, h, side: 'left' | 'right' }] position:absolute elements found within
 *     the control and up to 3 ancestor levels that intersect the control box (> 0.5px both axes),
 *     ignoring boxes that cover ≥ 90% of it on both axes
 *
 * TargetFact { type: 'target', id, key, role, scope, scroller, targetAncestors, x, y, w, h, coveredBy }
 *   - one per visible interactive element: a[href], button, input (not hidden), select, textarea,
 *     summary, [role=button|combobox|tab|switch|checkbox|radio|link|menuitem]
 *   - role: the role attribute, else 'link' (a) | 'field' (input/select/textarea) | 'button'
 *   - key: target-<role>|normalizeKeyText(aria-label, or own text for button/tab/menuitem)|dup —
 *     own text skips the same value subtrees as label text
 *   - scroller: container id of the nearest ancestor with overflow auto/scroll, null = the document
 *   - targetAncestors: ids of target facts that contain this element
 *   - coveredBy: id of another, unrelated target that elementFromPoint returns at this element centre
 *     (a <label> resolves to its control) — only when the centre is inside the viewport, else null
 */
(function () {
  'use strict';

  var FIELD_SELECTOR =
    '[data-slot=input-wrapper],[data-field-frame],[data-slot=readonly-field],' +
    '[data-slot=select-trigger],button[role=combobox],select,textarea,input';
  var INNER_TEXT_SELECTOR =
    'input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea';
  var TARGET_SELECTOR =
    'a[href],button,input,select,textarea,summary,[role=button],[role=combobox],[role=tab],' +
    '[role=switch],[role=checkbox],[role=radio],[role=link],[role=menuitem]';
  var NON_FIELD_INPUT_TYPES = {
    hidden: true,
    checkbox: true,
    radio: true,
    file: true,
    range: true,
    color: true,
    button: true,
    submit: true,
    reset: true,
    image: true,
  };
  var LARGE_TEXT_CLASS_RE = /(^|:)text-(?:lg|xl|[2-9]xl|\[(?:1[89]|[2-9]\d)px\])$/;
  var LARGE_TEXT_MIN_PX = 17.5;
  var ADORNMENT_LEVELS = 3;
  var ADORNMENT_MIN_OVERLAP_PX = 0.5;
  var ADORNMENT_OVERLAY_RATIO = 0.9;
  var NAMED_BY_TEXT_ROLES = { button: true, tab: true, menuitem: true };
  // Subtrees that hold values, not UI copy: never read for a name (a wrapping <label> contains its
  // control; a trigger button contains its select-value; a tag frame contains chips; an inline
  // listbox holds option text; an ARIA textbox, searchbox, spinbutton, an <output> or an editable
  // region holds typed or computed values).
  var VALUE_SUBTREE_SELECTOR =
    FIELD_SELECTOR +
    ',option,button,output,[role=combobox],[role=listbox],[role=option],[role=textbox],' +
    '[role=searchbox],[role=spinbutton],[data-slot=select-value],' +
    '[contenteditable]:not([contenteditable="false"])';

  function px(value) {
    var n = parseFloat(value);
    return isFinite(n) ? n : 0;
  }
  function collapse(text) {
    return String(text == null ? '' : text)
      .replace(/\s+/g, ' ')
      .trim();
  }
  // = rules.mjs normalizeKeyText
  function normalizeKeyText(text) {
    return collapse(text).replace(/[0-9]/g, '#').slice(0, 40);
  }
  // el's own words: text nodes below el, skipping every VALUE_SUBTREE_SELECTOR descendant (el itself
  // is read even when it matches — a button's own text is its name). Reads the DOM, never edits it.
  function ownText(el) {
    var out = '';
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) out += n.nodeValue;
      else if (n.nodeType === 1 && !n.matches(VALUE_SUBTREE_SELECTOR)) out += ownText(n);
    }
    return collapse(out);
  }

  function collectFields(options) {
    var opts = options || {};
    var exclude = typeof opts.exclude === 'string' ? opts.exclude.trim() : '';
    var rootSelector = typeof opts.root === 'string' && opts.root.trim() ? opts.root : 'body';
    var rootEl = document.querySelector(rootSelector);
    if (!rootEl) throw new Error('__collectFields: root not found: ' + rootSelector);

    var scrollX = window.scrollX;
    var scrollY = window.scrollY;
    var htmlEl = document.documentElement;
    var bodyEl = document.body;
    var styles = new Map();
    var containerIds = new Map();
    var dialogs = Array.prototype.slice.call(
      document.querySelectorAll('[role=dialog],[role=alertdialog]'),
    );
    var dupCounts = new Map();
    var canvasCtx = null;

    function style(el) {
      var cs = styles.get(el);
      if (!cs) {
        cs = getComputedStyle(el);
        styles.set(el, cs);
      }
      return cs;
    }
    function containerId(el) {
      var id = containerIds.get(el);
      if (id === undefined) {
        id = containerIds.size;
        containerIds.set(el, id);
      }
      return id;
    }
    function box(el) {
      var r = el.getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
    }
    // laid out, not 1×1 (sr-only), not visibility:hidden / opacity 0
    function rendered(el) {
      var r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return false;
      var cs = style(el);
      return cs.visibility !== 'hidden' && cs.opacity !== '0';
    }
    function visible(el) {
      return rendered(el) && !el.closest('[aria-hidden=true],[hidden]');
    }
    function excluded(el) {
      return exclude !== '' && el.closest(exclude) !== null;
    }
    function keyed(prefix, name) {
      var base = prefix + '|' + normalizeKeyText(name);
      var dup = dupCounts.get(base) || 0;
      dupCounts.set(base, dup + 1);
      return base + '|' + dup;
    }
    function isField(el) {
      if (!el.matches(FIELD_SELECTOR)) return false;
      if (el.localName === 'input' && NON_FIELD_INPUT_TYPES[String(el.type).toLowerCase()])
        return false;
      return !(el.parentElement && el.parentElement.closest(FIELD_SELECTOR));
    }
    function isTarget(el) {
      if (!el.matches(TARGET_SELECTOR)) return false;
      return !(el.localName === 'input' && String(el.type).toLowerCase() === 'hidden');
    }
    function kindOf(el) {
      if (el.matches('[data-slot=input-wrapper]')) return 'input-wrapper';
      if (el.matches('[data-field-frame]')) return 'field-frame';
      if (el.matches('[data-slot=readonly-field]')) return 'readonly';
      if (el.matches('[data-slot=select-trigger]')) return 'select-trigger';
      if (el.localName === 'button') return 'combobox';
      if (el.localName === 'select') return 'native-select';
      if (el.localName === 'textarea') return 'textarea';
      return 'input';
    }
    function scopeOf(el) {
      var dialog = el.closest('[role=dialog],[role=alertdialog]');
      if (dialog) return { name: 'dialog:' + dialogs.indexOf(dialog), root: dialog };
      var main = el.closest('#main');
      if (main) return { name: 'main', root: main };
      return { name: 'page', root: null };
    }
    function layoutOf(el) {
      var cs = style(el);
      if (cs.display === 'grid' || cs.display === 'inline-grid') return 'grid';
      if (cs.display === 'flex' || cs.display === 'inline-flex') {
        return cs.flexDirection === 'column' || cs.flexDirection === 'column-reverse'
          ? 'flex-col'
          : 'flex-row';
      }
      return 'other';
    }
    function ancestry(el, scopeRoot) {
      var out = [];
      for (var n = el.parentElement; n && n !== htmlEl && n !== bodyEl; n = n.parentElement) {
        out.push({ id: containerId(n), layout: layoutOf(n) });
        if (n === scopeRoot) break;
      }
      return out;
    }
    function hasLargeTextClass(el) {
      for (var i = 0; i < el.classList.length; i++) {
        if (LARGE_TEXT_CLASS_RE.test(el.classList[i])) return true;
      }
      return false;
    }
    function labelOf(control, textEl) {
      var sources = [textEl, control];
      var lab = null;
      for (var i = 0; i < sources.length && !lab; i++) {
        if (sources[i].labels && sources[i].labels.length) lab = sources[i].labels[0];
      }
      if (!lab) {
        var ref = textEl.getAttribute('aria-labelledby') || control.getAttribute('aria-labelledby');
        if (ref) lab = document.getElementById(ref.trim().split(/\s+/)[0]);
      }
      return lab && visible(lab) ? lab : null;
    }
    function canvas() {
      if (!canvasCtx) {
        canvasCtx =
          typeof OffscreenCanvas !== 'undefined'
            ? new OffscreenCanvas(1, 1).getContext('2d')
            : document.createElement('canvas').getContext('2d');
      }
      return canvasCtx;
    }
    // canvas mirrors rendering: font-style/weight/size/family, letter-spacing, upper/lower case
    function inkWidth(cs, text) {
      if (text === '') return 0;
      var ctx = canvas();
      ctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      if ('letterSpacing' in ctx) {
        ctx.letterSpacing = '0px';
        ctx.letterSpacing =
          cs.letterSpacing && cs.letterSpacing !== 'normal' ? cs.letterSpacing : '0px';
      }
      var shown =
        cs.textTransform === 'uppercase'
          ? text.toUpperCase()
          : cs.textTransform === 'lowercase'
            ? text.toLowerCase()
            : text;
      return ctx.measureText(shown).width;
    }
    function adornmentsOf(control, b) {
      var out = [];
      var seen = new Set();
      var host = control;
      for (
        var level = 0;
        level <= ADORNMENT_LEVELS && host && host !== bodyEl && host !== htmlEl;
        level++
      ) {
        var all = host.querySelectorAll('*');
        for (var i = 0; i < all.length; i++) {
          var el = all[i];
          if (seen.has(el)) continue;
          seen.add(el);
          if (el.contains(control) || style(el).position !== 'absolute' || !rendered(el)) continue;
          var a = box(el);
          var overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          var overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          if (overlapX <= ADORNMENT_MIN_OVERLAP_PX || overlapY <= ADORNMENT_MIN_OVERLAP_PX) continue;
          if (a.w >= b.w * ADORNMENT_OVERLAY_RATIO && a.h >= b.h * ADORNMENT_OVERLAY_RATIO) continue;
          out.push({
            x: a.x,
            y: a.y,
            w: a.w,
            h: a.h,
            side: a.x + a.w / 2 < b.x + b.w / 2 ? 'left' : 'right',
          });
        }
        host = host.parentElement;
      }
      return out;
    }

    function controlFact(el, id) {
      var kind = kindOf(el);
      var textEl = el.matches('input,select,textarea')
        ? el
        : el.querySelector(INNER_TEXT_SELECTOR) || el;
      var cs = style(el);
      var tcs = style(textEl);
      var b = box(el);
      var scope = scopeOf(el);
      var lab = labelOf(el, textEl);
      var labelBox = lab ? box(lab) : null;
      var placeholder = collapse(textEl.getAttribute('placeholder'));
      // an aria-labelledby target that is itself a field or trigger holds a value, not a name
      var name =
        (lab && !lab.matches(VALUE_SUBTREE_SELECTOR) && ownText(lab)) ||
        collapse(el.getAttribute('aria-label') || textEl.getAttribute('aria-label')) ||
        placeholder;
      var tr = textEl.getBoundingClientRect();
      var contentLeft = tr.left + scrollX + px(tcs.borderLeftWidth) + px(tcs.paddingLeft);
      var contentRight = tr.right + scrollX - px(tcs.borderRightWidth) - px(tcs.paddingRight);
      var isSelect = textEl.localName === 'select';
      var longest = null;
      if (isSelect) {
        longest = 0;
        for (var i = 0; i < textEl.options.length; i++) {
          var option = textEl.options[i];
          longest = Math.max(longest, inkWidth(tcs, collapse(option.label || option.text)));
        }
      }
      var valueEl = el.querySelector('[data-slot=select-value]');
      var borderWidth = px(cs.borderTopWidth);
      var fontSize = px(tcs.fontSize);
      return {
        type: 'control',
        id: id,
        key: keyed(kind, name),
        kind: kind,
        tag: el.localName,
        scope: scope.name,
        ancestors: ancestry(el, scope.root),
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        borderRadius: Math.max(
          px(cs.borderTopLeftRadius),
          px(cs.borderTopRightRadius),
          px(cs.borderBottomRightRadius),
          px(cs.borderBottomLeftRadius),
        ),
        borderWidth: borderWidth,
        borderColor: borderWidth > 0 && cs.borderTopStyle !== 'none' ? cs.borderTopColor : 'none',
        backgroundColor: cs.backgroundColor,
        fontSize: fontSize,
        largeText: fontSize >= LARGE_TEXT_MIN_PX || hasLargeTextClass(el) || hasLargeTextClass(textEl),
        label: lab
          ? {
              fontSize: px(style(lab).fontSize),
              gap: b.y - (labelBox.y + labelBox.h),
              above: labelBox.y + labelBox.h <= b.y + 1 && !lab.contains(el),
            }
          : null,
        contentLeft: contentLeft,
        contentRight: contentRight,
        contentWidth: contentRight - contentLeft,
        placeholderInkWidth: placeholder === '' ? null : inkWidth(tcs, placeholder),
        optionCount: isSelect ? textEl.options.length : null,
        longestOptionInkWidth: longest,
        valueOverflowX: Boolean(valueEl) && valueEl.scrollWidth > valueEl.clientWidth + 1,
        valueOverflowY: Boolean(valueEl) && valueEl.scrollHeight > valueEl.clientHeight + 1,
        adornments: adornmentsOf(el, b),
      };
    }

    function targetRole(el) {
      var role = el.getAttribute('role');
      if (role) return role;
      if (el.localName === 'a') return 'link';
      if (el.matches('input,select,textarea')) return 'field';
      return 'button';
    }
    function scrollerOf(el) {
      for (var n = el.parentElement; n && n !== htmlEl && n !== bodyEl; n = n.parentElement) {
        var cs = style(n);
        if (/^(auto|scroll)$/.test(cs.overflowX) || /^(auto|scroll)$/.test(cs.overflowY))
          return containerId(n);
      }
      return null;
    }
    function targetAt(node, targetIds) {
      for (var n = node; n && n.nodeType === 1; n = n.parentElement) {
        if (targetIds.has(n)) return n;
        if (n.localName === 'label' && n.control && targetIds.has(n.control)) return n.control;
      }
      return null;
    }
    function targetFact(el, targetIds) {
      var role = targetRole(el);
      var b = box(el);
      var name =
        collapse(el.getAttribute('aria-label')) || (NAMED_BY_TEXT_ROLES[role] ? ownText(el) : '');
      var ancestors = [];
      for (var n = el.parentElement; n; n = n.parentElement) {
        if (targetIds.has(n)) ancestors.push(targetIds.get(n));
      }
      var r = el.getBoundingClientRect();
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var coveredBy = null;
      if (cx >= 0 && cy >= 0 && cx < window.innerWidth && cy < window.innerHeight) {
        var hit = document.elementFromPoint(cx, cy);
        var other = hit ? targetAt(hit, targetIds) : null;
        if (other && other !== el && !el.contains(other) && !other.contains(el))
          coveredBy = targetIds.get(other);
      }
      return {
        type: 'target',
        id: targetIds.get(el),
        key: keyed('target-' + role, name),
        role: role,
        scope: scopeOf(el).name,
        scroller: scrollerOf(el),
        targetAncestors: ancestors,
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        coveredBy: coveredBy,
      };
    }

    var elements = [rootEl].concat(Array.prototype.slice.call(rootEl.querySelectorAll('*')));
    var controlEls = [];
    var targetEls = [];
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      var field = isField(el);
      var target = isTarget(el);
      if ((!field && !target) || excluded(el) || !visible(el)) continue;
      if (field) controlEls.push(el);
      if (target) targetEls.push(el);
    }
    var facts = [];
    for (var c = 0; c < controlEls.length; c++) facts.push(controlFact(controlEls[c], facts.length));
    var targetIds = new Map();
    for (var t = 0; t < targetEls.length; t++) targetIds.set(targetEls[t], controlEls.length + t);
    for (var k = 0; k < targetEls.length; k++) facts.push(targetFact(targetEls[k], targetIds));
    return facts;
  }

  window.__collectFields = collectFields;
})();
```

- [ ] **Step 9: Run the new collector tests and both regression suites — expect PASS**

  ```bash
  node --test tools/typography-audit/collect-fields.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"
  node --test tools/typography-audit/collect.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"
  node --test tools/typography-audit/fields.test.mjs tools/typography-audit/rules.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"
  ```
  - Expected: `ℹ tests 12` / `ℹ pass 12` / `ℹ fail 0`. Chromium, about 2 s.
  - Expected: `ℹ tests 51` / `ℹ pass 51` / `ℹ fail 0`. `__collectTypography` is unchanged.
  - Expected: `ℹ tests 70` / `ℹ pass 70` / `ℹ fail 0`.
  - If a geometry number is off by sub-pixels on another machine, the `.f` field is fixed at 200×44 with a 1px border. Check that `apps/web/public/fonts/noto-sans-thai/fonts.css` loaded. The harness does not assert this; it only waits for `document.fonts.ready`.

- [ ] **Step 10: Commit**

```bash
git add tools/typography-audit/collect.js tools/typography-audit/collect-fields.test.mjs && git commit -F - <<'EOF'
feat(tools): window.__collectFields field facts collector for the field-scale audit

Second in-page export next to __collectTypography (untouched): control facts
(kind, box, radius, border/background, label font/gap, row ancestry, content box,
placeholder and longest native option ink, select-value overflow, absolute
adornments) and interactive target facts (overlap scope, scroller, hit-test
coverage). Numbers and booleans only - no values or option text leave the page.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: tools/field-scale/check.mjs runner + route mocks + baseline (R1-1 part 2)

Spec §5 + §7 R1-1: a field-scale checker that **runs on this Windows machine** against `npm run local:preview`, the route list (every screen in appendix ก + the 9 AddressForm hosts in §4.3) with `page.route` mocks for the GET endpoints the preview answers 501/404, the Playwright check that the account menu is clipped (S2-01 / S2-02, recorded as rule `MENU` P1), a `--compare` mode, and the **baseline on main's UI** (this branch has no app-code changes yet). The baseline numbers go into the R1-1 PR description, not into the repo (`.tmp/` is gitignored — `.gitignore:23`).

**Files:**
- Create: `tools/field-scale/lib.mjs` — pure layer: CLI parsing, finding identity, allow-list, compare, Markdown report
- Create: `tools/field-scale/coa.mjs` — chart of accounts from `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv` in the shapes of `GET /chart-of-accounts`, `/grouped`, `/by-codes` (mirrors `apps/api/src/modules/chart-of-accounts/chart-of-accounts.service.ts:66-98` and the CSV rules of `apps/api/src/modules/journal/__tests__/csv-fixture-loader.ts:50-75,125-142`)
- Create: `tools/field-scale/menu-clip.mjs` — in-page menu geometry reader + pure clip verdict
- Create: `tools/field-scale/routes.mjs` — `ROUTES` (28 entries) + `COMMON_MOCKS` + probes
- Create: `tools/field-scale/allow.json` — empty allow-list
- Create: `tools/field-scale/check.mjs` — Playwright runner (pattern of `tools/check-admin-typography.mjs:8-13,97-104`)
- Test: `tools/field-scale/check.test.mjs` — `node:test` (pure parts + CLI exit codes; no browser, no preview)
- Read-only references: `tools/local-preview.mjs:9-10,160-166` (`repo`, `previewStatus()` → `{state.port, info.documentUrl, info.sourceRevision, running, current}`), `apps/api/e2e/support/chat-credit-preview.ts:637-711` (preview rewrites `/api/admin`→`/api`, serves an allow-list, everything else `501 LOCAL_PREVIEW_UNSUPPORTED`; actor is a fixed OWNER — **no login step exists in any `tools/check-local-*.mjs`**, `GET /api/admin/auth/me` just answers), `tools/check-mobile-density.mjs:50` (dark theme = `localStorage.setItem('theme', 'dark')` in an init script)

**Interfaces:**
- Consumes (Task 1): `window.__collectFields({ exclude, root })` injected from `tools/typography-audit/collect.js` (via `page.addScriptTag({ path })`) → `FieldFact[]`; `evaluateFields(facts, { width })` exported from `tools/typography-audit/rules.mjs` → `Finding[]`. This task relies on each Finding having `rule` (`'F1'|'F2'|'F3'|'F4'`), `severity` (`'P1'|'P2'|'P3'`) and a run-stable string `key`; `detail` is optional (used only as an identity fallback when `key` is missing). F1 keys name one control (`<property>@<memberKey>`, `memberKey` = `kind|name|dup`) and every member of an inconsistent row is reported. Guarantee: with the same set of measured controls in a row or check, changing values toward agreement never adds an F1 key, and a fully consistent row has no F1 keys. A correct change can still add keys (exposed, not introduced): (a) dup renumbering when a control is added, removed, renamed or re-kinded; (b) row/check membership growth (newly measured control, no longer `largeText`, re-kinded out of `textarea`, label moved above, rows merged); (c) derived `bottom` newly mismatching after a height/labelGap fix. Later tasks triage such findings with the compare triage rule in the cross-task notes.
- Consumes (R1-2 contract for the probe): `AccountSearchDropdown` keeps its search box `aria-label="ค้นหารหัส หรือ ชื่อบัญชี"` and its trigger keeps the selected account's name as text.
- Produces:
  - CLI `node tools/field-scale/check.mjs --label <name> [--routes <id,id>] [--widths 1440,1024,390] [--themes light,dark]` → `.tmp/field-scale/<name>/{results.json, report.md, <route>-<width>-<theme>.png, <route>-<width>-<theme>-<probe>.png}`; exit 0 (report, not a gate), 2 on usage error / preview not running or not current. The preview fingerprints `apps/`, `packages/` and `tools/`, so **every** measuring run must be preceded by `npm run local:preview` (it restarts a stale preview). A cell is `rendered` only when the open step did not throw, the final pathname equals the requested pathname (the query may differ — the shell adds `?zone=`), no error fallback is visible (root `ErrorBoundary`, `QueryBoundary` alert) and at least one field fact was collected (`screenProblem` in `lib.mjs`); otherwise it is `error` with that reason.
  - CLI `node tools/field-scale/check.mjs --compare <baselineLabel> <label>` → prints new/fixed findings, a MENU section, lost cells and fact drops; exit 1 when (a) a new non-MENU P1/P2 appears, (b) **any** `MENU` finding is in the current run, even one the baseline had (each line says `byte-identical to baseline` / `reasons differ from baseline` / `not in baseline`; a probe that threw is keyed `<probe>:error`, apart from a clip), (c) a cell rendered at baseline is not rendered now, or (d) a compared cell's `factCount` fell below 50% of its baseline; 0 otherwise; 2 when a run is missing. Baseline cells absent from a `--routes` / `--widths` / `--themes` subset run are listed as "not run" and do not block. Because of (b) the baseline compared with itself exits 1 until Task 6 fixes S2-01/S2-02 (cross-task notes, "MENU before and after Task 6").
  - `results.json`: `{ label, startedAt, finishedAt, origin, sourceRevision, widths, themes, routes: string[], routeMeta: [{id, path, appendix}], cells: Cell[] }` where `Cell = { route, path, width, theme, status: 'rendered'|'open-failed'|'skipped'|'error', finalPath, openError, error, factCount, screenshot, mocked: string[], apiErrors: [{method, path, status}], findings: (Finding & {route, width, theme, allowed, allowReason?})[], probes: [{id, ok, reasons, geometry}] }`.
  - Finding id (used by `allow.json` and compare): `route|width|theme|rule|key`.
  - `tools/field-scale/allow.json`: `{ "entries": [{ "id": "<finding id>", "reason": "<Thai, ≥ 10 chars>" }] }`.
  - `routes.mjs` exports `ROUTES`, `COMMON_MOCKS`, `ADDRESS_FORM_HOSTS`, `COLLECT_EXCLUDE`, `MENU_SEARCH_LABEL`, `viewportFor`, `mock`, `journalTable`; route entry = `{ id, path: string | (ctx) => string|null, appendix: string[], open?: async (page) => void, mocks: {path: RegExp, json(url, ctx)}[], probes?: {id, widths, trigger(page) => Locator}[] }`.

---

- [ ] **Step 1: Write the failing tests for the pure layer**

Create `tools/field-scale/check.test.mjs`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  UsageError,
  applyAllow,
  compareRuns,
  findingId,
  formatCompare,
  menuFinding,
  parseAllow,
  parseArgs,
  renderReport,
  screenProblem,
  selectRoutes,
  summarize,
} from './lib.mjs';

const cell = (route, width, theme, findings, status = 'rendered', extra = {}) => ({
  route, width, theme, status, findings, probes: [], apiErrors: [], ...extra,
});
const f = (route, width, theme, rule, severity, key) => ({ route, width, theme, rule, severity, key, detail: {} });

test('parseArgs: defaults', () => {
  assert.deepEqual(parseArgs(['--label', 'baseline']), {
    mode: 'run', label: 'baseline', routes: null, widths: [1440, 1024, 390], themes: ['light', 'dark'],
  });
});

test('parseArgs: options, de-duplicated', () => {
  assert.deepEqual(
    parseArgs(['--label', 'r1-2', '--routes', 'a,b,a', '--widths', '390,1440,390', '--themes', 'dark']),
    { mode: 'run', label: 'r1-2', routes: ['a', 'b'], widths: [390, 1440], themes: ['dark'] },
  );
});

test('parseArgs: rejects bad input with a UsageError', () => {
  for (const argv of [
    [], ['--label'], ['--label', 'a/b'], ['--label', 'x', '--widths', '100'], ['--label', 'x', '--widths', '14.5'],
    ['--label', 'x', '--themes', 'sepia'], ['--label', 'x', '--routes'], ['--label', 'x', '--routes', '--widths'],
    ['--label', 'x', '--bogus', '1'], ['--compare', 'a'], ['--compare', 'a', 'b', '--widths', '390'],
    ['--label', 'x', '--compare', 'a', 'b'],
  ]) {
    assert.throws(() => parseArgs(argv), UsageError, JSON.stringify(argv));
  }
});

test('parseArgs: compare mode', () => {
  assert.deepEqual(parseArgs(['--compare', 'baseline', 'r1-2']), { mode: 'compare', baseline: 'baseline', label: 'r1-2' });
});

test('selectRoutes keeps the asked order and names unknown ids', () => {
  const routes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(selectRoutes(null, routes), routes);
  assert.deepEqual(selectRoutes(['c', 'a'], routes).map((r) => r.id), ['c', 'a']);
  assert.throws(
    () => selectRoutes(['a', 'zz'], routes),
    (e) => e instanceof UsageError && /zz/.test(e.message) && /known: a, b, c/.test(e.message),
  );
});

test('findingId uses the key, falling back to the detail', () => {
  assert.equal(findingId(f('dunning', 1440, 'light', 'F1', 'P2', 'row:3')), 'dunning|1440|light|F1|row:3');
  assert.equal(findingId({ route: 'x', width: 390, theme: 'dark', rule: 'F2', detail: { a: 1 } }), 'x|390|dark|F2|{"a":1}');
});

test('parseAllow validates entries; applyAllow marks matches', () => {
  const reason = 'ตั้งใจให้ต่าง: ช่องยอดเงินใหญ่';
  assert.throws(() => parseAllow({}), /entries/);
  assert.throws(() => parseAllow({ entries: [{ id: 'x', reason }] }), /finding id/);
  assert.throws(() => parseAllow({ entries: [{ id: 'a|1|light|F1|k', reason: 'short' }] }), /reason/);
  assert.throws(
    () => parseAllow({ entries: [{ id: 'a|1|light|F1|k', reason }, { id: 'a|1|light|F1|k', reason }] }),
    /duplicate/,
  );
  const allow = parseAllow({ entries: [{ id: 'a|1440|light|F1|k1', reason }] });
  const [kept, open] = applyAllow([f('a', 1440, 'light', 'F1', 'P2', 'k1'), f('a', 1440, 'light', 'F1', 'P2', 'k2')], allow);
  assert.equal(kept.allowed, true);
  assert.equal(kept.allowReason, reason);
  assert.equal(open.allowed, false);
});

test('compareRuns: new, fixed and blocking findings over cells rendered in both runs', () => {
  const baseline = { cells: [
    cell('a', 1440, 'light', [f('a', 1440, 'light', 'F1', 'P2', 'old'), f('a', 1440, 'light', 'F3', 'P1', 'kept')]),
    cell('b', 1440, 'light', [f('b', 1440, 'light', 'F1', 'P2', 'x')], 'error'),
    cell('c', 1440, 'light', [f('c', 1440, 'light', 'F2', 'P2', 'gone')]),
  ] };
  const current = { cells: [
    cell('a', 1440, 'light', [
      f('a', 1440, 'light', 'F3', 'P1', 'kept'), f('a', 1440, 'light', 'F4', 'P2', 'new'),
      f('a', 1440, 'light', 'F1', 'P3', 'minor'), { ...f('a', 1440, 'light', 'F1', 'P2', 'ok'), allowed: true },
    ]),
    cell('b', 1440, 'light', [f('b', 1440, 'light', 'F1', 'P2', 'y')]),
    cell('d', 390, 'dark', [f('d', 390, 'dark', 'F1', 'P2', 'z')]),
  ] };
  const r = compareRuns(baseline, current);
  assert.equal(r.comparedCells, 1);
  assert.deepEqual(r.newFindings.map((x) => x.key), ['new', 'minor']);
  assert.deepEqual(r.blocking.map((x) => x.key), ['new']);
  assert.deepEqual(r.fixed.map((x) => x.key), ['old']);
  assert.deepEqual(r.notCompared.sort(), ['b|1440|light', 'd|390|dark']);
  assert.deepEqual(r.notRun, ['c|1440|light']);
  assert.equal(r.failed, true);
  const text = formatCompare(r, 'baseline', 'r1-2');
  assert.match(text, /Compared 1 cells/);
  assert.match(text, /\+ P2 F4 a 1440 light new/);
  assert.match(text, /- P2 F1 a 1440 light old/);
  assert.match(text, /Not run in "r1-2" \(subset run — not blocking\): 1 cells/);
  assert.match(text, /FAIL: new P1\/P2 findings/);
  const same = compareRuns(baseline, baseline);
  assert.equal(same.failed, false);
  assert.match(formatCompare(same, 'baseline', 'baseline'), /PASS: no new P1\/P2 findings/);
});

test('compareRuns: every MENU failure blocks, even one the baseline already had', () => {
  const clip = (route, key, reasons) => ({ ...f(route, 1440, 'light', 'MENU', 'P1', key), detail: { reasons } });
  const baseline = { cells: [
    cell('m', 1440, 'light', [clip('m', 'menu-a', ['ถูกตัดโดย <div class="x">']), clip('m', 'menu-b', ['ถูกตัดโดย <div class="y">'])]),
    cell('n', 1440, 'light', [clip('n', 'menu-c', ['ถูกตัดโดย <div class="z">'])]),
  ] };
  const current = { cells: [
    cell('m', 1440, 'light', [
      clip('m', 'menu-a', ['ถูกตัดโดย <div class="x">']), clip('m', 'menu-b', ['ถูกตัดโดย <div class="other">']),
    ]),
    cell('n', 1440, 'light', [clip('n', 'menu-c:error', ['probe error: locator.click: Timeout 15000ms exceeded'])]),
  ] };
  const r = compareRuns(baseline, current);
  assert.deepEqual(r.newFindings, [], 'MENU is reported in its own section, not as a new finding');
  assert.deepEqual(r.blocking, []);
  assert.deepEqual(
    r.menuFailures.map((x) => [x.key, x.vsBaseline]),
    [['menu-a', 'identical'], ['menu-b', 'changed'], ['menu-c:error', 'new']],
  );
  assert.deepEqual(r.fixed.map((x) => x.key), ['menu-c'], 'the clip finding is gone, replaced by a probe error');
  assert.equal(r.failed, true);
  const text = formatCompare(r, 'baseline', 'r1-2');
  assert.match(text, /MENU failures \(account-menu probes — never accepted from the baseline\): 3/);
  assert.match(text, /! P1 MENU m 1440 light menu-a — ถูกตัดโดย <div class="x"> \[byte-identical to baseline: pre-existing S2-01\/S2-02, fixed by Task 6\]/);
  assert.match(text, /! P1 MENU m 1440 light menu-b — .* \[reasons differ from baseline\]/);
  assert.match(text, /! P1 MENU n 1440 light menu-c:error — probe error: .* \[not in baseline\]/);
  assert.match(text, /FAIL: 3 MENU failures \(1 byte-identical to baseline/);
  const self = compareRuns(baseline, baseline);
  assert.equal(self.failed, true, 'a baseline with MENU failures fails against itself until Task 6');
  assert.ok(self.menuFailures.every((x) => x.vsBaseline === 'identical'));
  const menuFixed = compareRuns(baseline, { cells: [cell('m', 1440, 'light', []), cell('n', 1440, 'light', [])] });
  assert.equal(menuFixed.failed, false);
  assert.deepEqual(menuFixed.fixed.map((x) => x.key), ['menu-a', 'menu-b', 'menu-c']);
  assert.match(formatCompare(menuFixed, 'baseline', 't6'), /MENU failures \(account-menu probes — never accepted from the baseline\): 0/);
});

test('compareRuns: a cell rendered at baseline that stops rendering blocks; one left out of a subset run does not', () => {
  const baseline = { cells: [
    cell('a', 1440, 'light', [f('a', 1440, 'light', 'F1', 'P2', 'k')], 'rendered', { factCount: 20 }),
    cell('b', 1440, 'light', [], 'rendered', { factCount: 20 }),
    cell('c', 390, 'dark', [], 'rendered', { factCount: 20 }),
  ] };
  const current = { cells: [
    cell('a', 1440, 'light', [], 'error', { error: 'landed on /?zone=shop instead of /todos', factCount: 0 }),
    cell('b', 1440, 'light', [], 'open-failed', { openError: 'locator.click: Timeout 15000ms exceeded', factCount: 18 }),
  ] };
  const r = compareRuns(baseline, current);
  assert.equal(r.comparedCells, 0);
  assert.deepEqual(r.fixed, [], 'findings of a cell that stopped rendering are not "fixed"');
  assert.deepEqual(r.lostCells, [
    { cell: 'a|1440|light', status: 'error', reason: 'landed on /?zone=shop instead of /todos' },
    { cell: 'b|1440|light', status: 'open-failed', reason: 'locator.click: Timeout 15000ms exceeded' },
  ]);
  assert.deepEqual(r.notRun, ['c|390|dark']);
  assert.deepEqual(r.notCompared, []);
  assert.equal(r.failed, true);
  const text = formatCompare(r, 'baseline', 'r1-2');
  assert.match(text, /Cells rendered in "baseline" but not in "r1-2" \(blocking\): 2/);
  assert.match(text, /! a\|1440\|light — error: landed on \/\?zone=shop instead of \/todos/);
  assert.match(text, /FAIL: 2 cells stopped rendering/);
  const subset = compareRuns(baseline, { cells: [baseline.cells[0]] });
  assert.equal(subset.failed, false);
  assert.deepEqual(subset.notRun, ['b|1440|light', 'c|390|dark']);
});

test('compareRuns: a fact count below half of the baseline cell blocks', () => {
  const baseline = { cells: [
    cell('a', 1440, 'light', [], 'rendered', { factCount: 64 }),
    cell('b', 1440, 'light', [], 'rendered', { factCount: 40 }),
  ] };
  const current = { cells: [
    cell('a', 1440, 'light', [], 'rendered', { factCount: 31 }),
    cell('b', 1440, 'light', [], 'rendered', { factCount: 20 }),
  ] };
  const r = compareRuns(baseline, current);
  assert.deepEqual(r.factDrops, [{ cell: 'a|1440|light', before: 64, after: 31 }], 'exactly half is not a drop');
  assert.equal(r.failed, true);
  assert.match(formatCompare(r, 'baseline', 'r1-2'), /! a\|1440\|light — facts 64 → 31/);
  assert.match(formatCompare(r, 'baseline', 'r1-2'), /FAIL: 1 cells lost over half their measured fields/);
});

test('screenProblem: a redirect, an error fallback or an empty screen is not the screen that was asked for', () => {
  const ok = { requestedPath: '/stock/transfers?view=history', finalPath: '/stock/transfers?view=history&zone=shop', factCount: 20, fallbackText: null };
  assert.equal(screenProblem(ok), null, 'the app may add query parameters');
  assert.equal(
    screenProblem({ ...ok, requestedPath: '/todos', finalPath: '/?zone=shop' }),
    'landed on /?zone=shop instead of /todos',
  );
  assert.equal(screenProblem({ ...ok, fallbackText: 'เกิดข้อผิดพลาด' }), 'error fallback visible: เกิดข้อผิดพลาด');
  assert.equal(screenProblem({ ...ok, factCount: 0 }), 'no form fields measured (facts 0)');
});

test('menuFinding: a clipped menu and a probe that errored get different keys', () => {
  const where = { route: 'r', width: 1440, theme: 'dark' };
  assert.equal(menuFinding({ id: 'menu-a', ok: true, reasons: [] }, where), null);
  assert.deepEqual(menuFinding({ id: 'menu-a', ok: false, reasons: ['ถูกตัดโดย <div>'] }, where), {
    rule: 'MENU', severity: 'P1', key: 'menu-a', detail: { reasons: ['ถูกตัดโดย <div>'] }, ...where,
  });
  assert.equal(menuFinding({ id: 'menu-a', ok: false, error: true, reasons: ['probe error: x'] }, where).key, 'menu-a:error');
});

test('parseAllow refuses MENU findings — a clipped menu is never kept on purpose', () => {
  assert.throws(
    () => parseAllow({ entries: [{ id: 'other-income-items|1440|light|MENU|account-menu-items-card', reason: 'ตั้งใจให้เมนูถูกตัด' }] }),
    /MENU/,
  );
});

test('renderReport: totals, probes, api errors and unfinished cells', () => {
  const results = {
    label: 'baseline', startedAt: 's', finishedAt: 'e', sourceRevision: 'abc123', origin: 'http://localhost:5195',
    widths: [1440], themes: ['light'], routes: ['a', 'b'],
    routeMeta: [{ id: 'a', appendix: ['S2-01'] }, { id: 'b', appendix: [] }],
    cells: [
      cell('a', 1440, 'light', [
        f('a', 1440, 'light', 'MENU', 'P1', 'account-menu-items-card'), f('a', 1440, 'light', 'F1', 'P2', 'k'),
        { ...f('a', 1440, 'light', 'F1', 'P2', 'ok'), allowed: true },
      ], 'rendered', {
        probes: [{ id: 'account-menu-items-card', ok: false, reasons: ['เมนู [0,0 → 1,1] ถูกตัดโดย <div class="a|b"> x'] }],
        apiErrors: [{ method: 'GET', path: '/purchase-orders/summary', status: 501 }],
      }),
      cell('b', 1440, 'light', [], 'open-failed', {
        openError: 'locator timed out',
        apiErrors: [{ method: 'GET', path: '/purchase-orders/summary', status: 501 }],
      }),
    ],
  };
  const s = summarize(results);
  assert.deepEqual(s.bySeverity, { P1: 1, P2: 1, P3: 0 });
  assert.equal(s.allowed, 1);
  assert.deepEqual(s.apiErrors, [{ method: 'GET', path: '/purchase-orders/summary', status: 501, routes: ['a', 'b'] }]);
  const report = renderReport(results);
  assert.match(report, /ข้อพบที่ยังเปิด: 2 \(P1 1 · P2 1 · P3 0\) · ยกเว้นตาม allow.json: 1/);
  assert.match(report, /\| a \| account-menu-items-card \| 1440 \| light \| FAIL \| .*a\\\|b/);
  assert.match(report, /\| a \| S2-01 \| 1 \| 1 \| 1 \| 1 \| 0 \| 1 \|/);
  assert.match(report, /- b\|1440\|light — open-failed: locator timed out/);
  assert.match(report, /\| GET \| \/purchase-orders\/summary \| 501 \| a, b \|/);
});
```

- [ ] **Step 2: Run the tests — expect FAIL (module missing)**

Run (Git Bash, repo root): `node --test tools/field-scale/check.test.mjs`
Expected: the file fails to load with `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…\tools\field-scale\lib.mjs' imported from …\tools\field-scale\check.test.mjs`, summary `ℹ fail 1`.

- [ ] **Step 3: Implement the pure layer**

Create `tools/field-scale/lib.mjs`:

```js
// Field-scale check — pure layer (no browser, no preview): CLI parsing, finding identity, the
// allow-list, comparing two runs and the Markdown report. tools/field-scale/check.mjs drives the
// browser; tools/field-scale/check.test.mjs tests this file.

export const DEFAULT_WIDTHS = [1440, 1024, 390];
export const THEMES = ['light', 'dark'];
export const SEVERITIES = ['P1', 'P2', 'P3'];
export const BLOCKING_SEVERITIES = ['P1', 'P2'];
export const COMPARABLE_STATUS = 'rendered';
export const MENU_RULE = 'MENU';
export const FACT_DROP_RATIO = 0.5;
export const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const REPORT_FINDINGS_MAX = 300;
export const USAGE = [
  'usage: node tools/field-scale/check.mjs --label <name> [--routes <id,id>] [--widths 1440,1024,390] [--themes light,dark]',
  '       node tools/field-scale/check.mjs --compare <baselineLabel> <label>',
].join('\n');

export class UsageError extends Error {}

function listValue(argv, i, flag) {
  const value = argv[i];
  if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} needs a value`);
  const items = [...new Set(value.split(',').map((s) => s.trim()).filter(Boolean))];
  if (!items.length) throw new UsageError(`${flag} needs a value`);
  return items;
}

function labelValue(value, flag) {
  if (value === undefined || !LABEL_RE.test(value)) {
    throw new UsageError(`${flag} needs a name made of letters, digits, ".", "-" or "_" (got ${value ?? 'nothing'})`);
  }
  return value;
}

function widthValue(w) {
  if (!/^\d+$/.test(w) || Number(w) < 320 || Number(w) > 3840) {
    throw new UsageError(`--widths: "${w}" is not a whole number between 320 and 3840`);
  }
  return Number(w);
}

function themeValue(t) {
  if (!THEMES.includes(t)) throw new UsageError(`--themes: "${t}" is not light or dark`);
  return t;
}

export function parseArgs(argv) {
  if (argv[0] === '--compare') {
    if (argv.length !== 3) throw new UsageError('--compare takes exactly two labels and no other options');
    return { mode: 'compare', baseline: labelValue(argv[1], '--compare'), label: labelValue(argv[2], '--compare') };
  }
  const out = { mode: 'run', label: null, routes: null, widths: [...DEFAULT_WIDTHS], themes: [...THEMES] };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (flag === '--label') out.label = labelValue(argv[i + 1], flag);
    else if (flag === '--routes') out.routes = listValue(argv, i + 1, flag);
    else if (flag === '--widths') out.widths = listValue(argv, i + 1, flag).map(widthValue);
    else if (flag === '--themes') out.themes = listValue(argv, i + 1, flag).map(themeValue);
    else if (flag === '--compare') throw new UsageError('--compare must be the first argument');
    else throw new UsageError(`unknown argument "${flag}"`);
  }
  if (!out.label) throw new UsageError('--label is required');
  return out;
}

export function selectRoutes(ids, routes) {
  if (!ids) return routes;
  const byId = new Map(routes.map((r) => [r.id, r]));
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length) {
    throw new UsageError(`unknown route id(s): ${unknown.join(', ')} — known: ${routes.map((r) => r.id).join(', ')}`);
  }
  return ids.map((id) => byId.get(id));
}

export const cellId = (c) => `${c.route}|${c.width}|${c.theme}`;

// A cell whose open step did not throw can still show the wrong screen: the app redirected (role
// menu, missing record), an error fallback replaced the page, or nothing measurable is on it.
// Query parameters may differ (the shell adds ?zone=); the pathname may not.
export function screenProblem({ requestedPath, finalPath, factCount, fallbackText }) {
  const pathname = (p) => new URL(p, 'http://preview.invalid').pathname;
  if (!finalPath || pathname(finalPath) !== pathname(requestedPath)) {
    return `landed on ${finalPath ?? '(nothing)'} instead of ${requestedPath}`;
  }
  if (fallbackText) return `error fallback visible: ${fallbackText}`;
  if (!factCount) return 'no form fields measured (facts 0)';
  return null;
}

// A failed account-menu probe is a MENU P1 finding; a probe that threw is keyed apart from a clip so
// the two never stand in for each other in a compare.
export function menuFinding(probe, where) {
  if (probe.ok) return null;
  return {
    rule: MENU_RULE, severity: 'P1', key: probe.error ? `${probe.id}:error` : probe.id,
    detail: { reasons: probe.reasons }, ...where,
  };
}

export function findingId(f) {
  const key = typeof f.key === 'string' && f.key !== '' ? f.key : JSON.stringify(f.detail ?? null);
  return `${cellId(f)}|${f.rule}|${key}`;
}

export function parseAllow(json) {
  const entries = json?.entries;
  if (!Array.isArray(entries)) throw new Error('allow.json: "entries" must be an array');
  const byId = new Map();
  entries.forEach((e, i) => {
    if (typeof e?.id !== 'string' || e.id.split('|').length < 5) {
      throw new Error(`allow.json entries[${i}]: "id" must be a finding id (route|width|theme|rule|key)`);
    }
    if (e.id.split('|')[3] === MENU_RULE) {
      throw new Error(`allow.json entries[${i}]: MENU findings (a clipped or broken account menu) cannot be allowed`);
    }
    if (typeof e.reason !== 'string' || e.reason.trim().length < 10) {
      throw new Error(`allow.json entries[${i}]: "reason" must say why the finding is kept (at least 10 characters)`);
    }
    if (byId.has(e.id)) throw new Error(`allow.json entries[${i}]: duplicate id ${e.id}`);
    byId.set(e.id, e.reason.trim());
  });
  return byId;
}

export function applyAllow(findings, allow) {
  return findings.map((f) => {
    const reason = allow.get(findingId(f));
    return reason ? { ...f, allowed: true, allowReason: reason } : { ...f, allowed: false };
  });
}

const openFindings = (cells) => cells.flatMap((c) => c.findings).filter((f) => !f.allowed);
const sameReasons = (a, b) => JSON.stringify(a.detail?.reasons ?? null) === JSON.stringify(b.detail?.reasons ?? null);

// Findings are compared only over cells rendered in BOTH runs: an errored / unopened / skipped cell has
// no findings, which would otherwise read as "everything fixed". So the compare also blocks on
//   - every MENU finding of the current run (a clipped or broken account menu is never accepted from the
//     baseline; `vsBaseline` says whether the baseline had the same id with byte-identical reasons),
//   - every cell rendered at baseline that is not rendered now (lostCells),
//   - every compared cell whose fact count fell below FACT_DROP_RATIO of its baseline (factDrops).
// Baseline cells the current run did not measure (--routes / --widths / --themes subset) are notRun.
export function compareRuns(baseline, current) {
  const base = new Map(baseline.cells.map((c) => [cellId(c), c]));
  const curr = new Map(current.cells.map((c) => [cellId(c), c]));
  const rendered = (map, id) => map.get(id)?.status === COMPARABLE_STATUS;
  const compared = [...curr.keys()].filter((id) => rendered(base, id) && rendered(curr, id));
  const comparedSet = new Set(compared);
  const pick = (run) =>
    new Map(openFindings(run.cells.filter((c) => comparedSet.has(cellId(c)))).map((f) => [findingId(f), f]));
  const before = pick(baseline);
  const after = pick(current);
  const newFindings = [...after].filter(([id, f]) => !before.has(id) && f.rule !== MENU_RULE).map(([, f]) => f);
  const fixed = [...before].filter(([id]) => !after.has(id)).map(([, f]) => f);
  const baseMenu = new Map(
    baseline.cells.flatMap((c) => c.findings).filter((f) => f.rule === MENU_RULE).map((f) => [findingId(f), f]),
  );
  const menuFailures = current.cells
    .flatMap((c) => c.findings)
    .filter((f) => f.rule === MENU_RULE)
    .map((f) => {
      const was = baseMenu.get(findingId(f));
      return { ...f, vsBaseline: !was ? 'new' : sameReasons(was, f) ? 'identical' : 'changed' };
    });
  const lostCells = [...curr.keys()]
    .filter((id) => rendered(base, id) && !rendered(curr, id))
    .map((id) => {
      const c = curr.get(id);
      return { cell: id, status: c.status, reason: c.error ?? c.openError ?? '' };
    });
  const factDrops = compared
    .filter((id) => base.get(id).factCount > 0 && curr.get(id).factCount < base.get(id).factCount * FACT_DROP_RATIO)
    .map((id) => ({ cell: id, before: base.get(id).factCount, after: curr.get(id).factCount }));
  const notRun = [...base.keys()].filter((id) => !curr.has(id));
  const lostSet = new Set(lostCells.map((c) => c.cell));
  const notCompared = [...curr.keys()].filter((id) => !comparedSet.has(id) && !lostSet.has(id));
  const blocking = newFindings.filter((f) => BLOCKING_SEVERITIES.includes(f.severity));
  return {
    comparedCells: compared.length,
    notCompared,
    notRun,
    newFindings,
    fixed,
    blocking,
    menuFailures,
    lostCells,
    factDrops,
    failed: blocking.length + menuFailures.length + lostCells.length + factDrops.length > 0,
  };
}

const findingLine = (f) =>
  `${f.severity} ${f.rule} ${f.route} ${f.width} ${f.theme} ${f.key ?? JSON.stringify(f.detail ?? null)}`;

const MENU_VS_BASELINE = {
  identical: 'byte-identical to baseline: pre-existing S2-01/S2-02, fixed by Task 6',
  changed: 'reasons differ from baseline',
  new: 'not in baseline',
};

function failReasons(result) {
  const identical = result.menuFailures.filter((f) => f.vsBaseline === 'identical').length;
  return [
    ...(result.blocking.length ? ['new P1/P2 findings'] : []),
    ...(result.menuFailures.length
      ? [`${result.menuFailures.length} MENU failures (${identical} byte-identical to baseline — the known S2-01/S2-02 clip, acceptable only before Task 6)`]
      : []),
    ...(result.lostCells.length ? [`${result.lostCells.length} cells stopped rendering`] : []),
    ...(result.factDrops.length ? [`${result.factDrops.length} cells lost over half their measured fields`] : []),
  ];
}

export function formatCompare(result, baselineLabel, label) {
  const reasons = failReasons(result);
  return [
    `Compared ${result.comparedCells} cells (route × width × theme) of "${baselineLabel}" → "${label}"`,
    `New findings: ${result.newFindings.length} (blocking P1/P2: ${result.blocking.length})`,
    ...result.newFindings.map((f) => `  + ${findingLine(f)}`),
    `Fixed: ${result.fixed.length}`,
    ...result.fixed.map((f) => `  - ${findingLine(f)}`),
    `MENU failures (account-menu probes — never accepted from the baseline): ${result.menuFailures.length}`,
    ...result.menuFailures.map(
      (f) => `  ! ${findingLine(f)} — ${(f.detail?.reasons ?? []).join('; ')} [${MENU_VS_BASELINE[f.vsBaseline]}]`,
    ),
    ...(result.lostCells.length
      ? [
          `Cells rendered in "${baselineLabel}" but not in "${label}" (blocking): ${result.lostCells.length}`,
          ...result.lostCells.map((c) => `  ! ${c.cell} — ${c.status}: ${c.reason}`),
        ]
      : []),
    ...(result.factDrops.length
      ? [
          `Cells whose fact count fell below ${FACT_DROP_RATIO * 100}% of "${baselineLabel}" (blocking): ${result.factDrops.length}`,
          ...result.factDrops.map((c) => `  ! ${c.cell} — facts ${c.before} → ${c.after}`),
        ]
      : []),
    ...(result.notCompared.length
      ? [
          `Not compared (not rendered in "${baselineLabel}", or new in "${label}"): ${result.notCompared.length}`,
          ...result.notCompared.map((id) => `  ? ${id}`),
        ]
      : []),
    ...(result.notRun.length
      ? [`Not run in "${label}" (subset run — not blocking): ${result.notRun.length} cells`]
      : []),
    reasons.length
      ? `FAIL: ${reasons.join('; ')}`
      : 'PASS: no new P1/P2 findings, no MENU failures, no cell lost or emptied',
  ].join('\n');
}

const countBy = (findings) =>
  Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length]));

export function summarize(results) {
  const cells = results.cells;
  const all = cells.flatMap((c) => c.findings);
  const open = all.filter((f) => !f.allowed);
  const byRule = {};
  for (const f of open) {
    byRule[f.rule] ??= { P1: 0, P2: 0, P3: 0 };
    byRule[f.rule][f.severity] = (byRule[f.rule][f.severity] ?? 0) + 1;
  }
  const routes = [...new Set(cells.map((c) => c.route))].map((route) => {
    const rc = cells.filter((c) => c.route === route);
    return {
      route,
      appendix: (results.routeMeta ?? []).find((m) => m.id === route)?.appendix ?? [],
      cells: rc.length,
      rendered: rc.filter((c) => c.status === COMPARABLE_STATUS).length,
      ...countBy(open.filter((f) => f.route === route)),
      allowed: all.filter((f) => f.route === route && f.allowed).length,
    };
  });
  const probes = cells.flatMap((c) =>
    (c.probes ?? []).map((p) => ({ ...p, route: c.route, width: c.width, theme: c.theme })),
  );
  const api = new Map();
  for (const c of cells) {
    for (const e of c.apiErrors ?? []) {
      const k = `${e.method} ${e.path} ${e.status}`;
      const entry = api.get(k) ?? { method: e.method, path: e.path, status: e.status, routes: new Set() };
      entry.routes.add(c.route);
      api.set(k, entry);
    }
  }
  const apiErrors = [...api.values()]
    .map((e) => ({ ...e, routes: [...e.routes].sort() }))
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  const problems = cells
    .filter((c) => c.status !== COMPARABLE_STATUS)
    .map((c) => ({ cell: cellId(c), status: c.status, message: c.openError ?? c.error ?? '' }));
  return {
    total: open.length,
    allowed: all.length - open.length,
    bySeverity: countBy(open),
    byRule,
    routes,
    probes,
    apiErrors,
    problems,
  };
}

const md = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function renderReport(results) {
  const s = summarize(results);
  const open = results.cells
    .flatMap((c) => c.findings)
    .filter((f) => !f.allowed)
    .sort(
      (a, b) =>
        a.severity.localeCompare(b.severity) || a.route.localeCompare(b.route) || a.rule.localeCompare(b.rule) ||
        b.width - a.width,
    );
  return [
    `# Field scale — ${results.label}`,
    '',
    `- เวลา: ${results.startedAt} → ${results.finishedAt}`,
    `- source revision: ${results.sourceRevision ?? 'unknown'} · preview: ${results.origin}`,
    `- ความกว้าง: ${results.widths.join(', ')} · ธีม: ${results.themes.join(', ')} · หน้า: ${results.routes.length} · cell: ${results.cells.length}`,
    `- ข้อพบที่ยังเปิด: ${s.total} (P1 ${s.bySeverity.P1} · P2 ${s.bySeverity.P2} · P3 ${s.bySeverity.P3}) · ยกเว้นตาม allow.json: ${s.allowed}`,
    '',
    '## ข้อพบตามกฎ',
    '',
    '| กฎ | P1 | P2 | P3 |',
    '|---|---|---|---|',
    ...Object.keys(s.byRule).sort().map((r) => `| ${r} | ${s.byRule[r].P1} | ${s.byRule[r].P2} | ${s.byRule[r].P3} |`),
    '',
    '## เมนูบัญชีถูกตัด (S2-01 / S2-02)',
    '',
    ...(s.probes.length
      ? [
          '| หน้า | probe | กว้าง | ธีม | ผล | เหตุ |',
          '|---|---|---|---|---|---|',
          ...s.probes.map(
            (p) => `| ${p.route} | ${p.id} | ${p.width} | ${p.theme} | ${p.ok ? 'PASS' : 'FAIL'} | ${md(p.reasons.join('; '))} |`,
          ),
        ]
      : ['ไม่ได้รัน probe ในรอบนี้']),
    '',
    '## รายหน้า',
    '',
    '| หน้า | ภาคผนวก ก | cell | วัดได้ | P1 | P2 | P3 | ยกเว้น |',
    '|---|---|---|---|---|---|---|---|',
    ...s.routes.map(
      (r) => `| ${r.route} | ${r.appendix.join(', ') || '—'} | ${r.cells} | ${r.rendered} | ${r.P1} | ${r.P2} | ${r.P3} | ${r.allowed} |`,
    ),
    '',
    '## cell ที่วัดไม่ครบ',
    '',
    ...(s.problems.length ? s.problems.map((p) => `- ${p.cell} — ${p.status}: ${md(p.message)}`) : ['ไม่มี']),
    '',
    '## API ที่ตอบ error (ยังไม่มี mock)',
    '',
    ...(s.apiErrors.length
      ? [
          '| method | path | status | หน้า |',
          '|---|---|---|---|',
          ...s.apiErrors.map((e) => `| ${e.method} | ${md(e.path)} | ${e.status} | ${e.routes.join(', ')} |`),
        ]
      : ['ไม่มี']),
    '',
    '## ข้อพบทั้งหมด (ยังเปิด)',
    '',
    ...open.slice(0, REPORT_FINDINGS_MAX).map((f) => `- ${md(findingLine(f))}`),
    ...(open.length > REPORT_FINDINGS_MAX ? [`- … อีก ${open.length - REPORT_FINDINGS_MAX} ข้อ — ดู results.json`] : []),
    '',
  ].join('\n');
}
```

- [ ] **Step 4: Run the tests — expect PASS**

Run: `node --test tools/field-scale/check.test.mjs`
Expected (tail): `ℹ tests 15` · `ℹ pass 15` · `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add tools/field-scale/lib.mjs tools/field-scale/check.test.mjs && git commit -F - <<'EOF'
feat(tools): field-scale pure layer — args, allow-list, compare, report

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 6: Add failing tests for the chart-of-accounts fixture and the menu clip verdict**

In `tools/field-scale/check.test.mjs` replace

```js
  summarize,
} from './lib.mjs';
```

with

```js
  summarize,
} from './lib.mjs';
import { ACCOUNT_CODE_RE, coaByCodes, coaGrouped, coaList, loadCoa, parseCsvLine } from './coa.mjs';
import { menuClipVerdict } from './menu-clip.mjs';
```

and replace the last two lines of the file

```js
  assert.match(report, /\| GET \| \/purchase-orders\/summary \| 501 \| a, b \|/);
});
```

with

```js
  assert.match(report, /\| GET \| \/purchase-orders\/summary \| 501 \| a, b \|/);
});

test('coa: parseCsvLine keeps quoted commas', () => {
  assert.deepEqual(parseCsvLine('11-1101,"ชื่อ, มีจุลภาค",สินทรัพย์'), ['11-1101', 'ชื่อ, มีจุลภาค', 'สินทรัพย์']);
});

test('coa: the CPA CSV loads into the API shapes', () => {
  const rows = loadCoa();
  assert.ok(rows.length > 100, `${rows.length} accounts`);
  assert.ok(rows.every((r) => ACCOUNT_CODE_RE.test(r.code)));
  assert.equal(rows.find((r) => r.code === '42-1102')?.name, 'ดอกเบี้ยเงินฝาก');
  const flat = coaGrouped(rows, {}).groups.flatMap((g) => g.accounts);
  assert.equal(flat.length, rows.filter((r) => r.status === 'ใช้งาน').length);
  assert.ok(flat.length < rows.length, 'inactive accounts are left out');
  assert.ok(flat.some((a) => a.code === '42-1102'));
  assert.deepEqual(Object.keys(flat[0]).sort(), ['code', 'name', 'normalBalance', 'notes', 'vatApplicable']);
  const expense = coaGrouped(rows, { type: 'ค่าใช้จ่าย' }).groups.flatMap((g) => g.accounts);
  assert.ok(expense.length > 0 && expense.every((a) => rows.find((r) => r.code === a.code).type === 'ค่าใช้จ่าย'));
  assert.deepEqual(coaByCodes(rows, ['11-1201', ' 11-1101', '99-9999']).map((r) => r.code), ['11-1101', '11-1201']);
  assert.ok(coaList(rows, { status: 'ใช้งาน' }).every((r) => r.status === 'ใช้งาน' && r.id === `coa-${r.code}`));
});

test('menuClipVerdict: fully visible menu passes; clipped or off-screen fails', () => {
  const viewport = { width: 1440, height: 900 };
  const menu = { top: 300, left: 100, bottom: 620, right: 500 };
  assert.deepEqual(menuClipVerdict({ found: false }), { ok: false, reasons: ['ไม่พบเมนูบัญชีหลังกดเปิด'] });
  assert.deepEqual(
    menuClipVerdict({ found: true, menu, viewport, clippers: [{ tag: 'main', className: 'x', rect: { top: 0, left: 0, bottom: 900, right: 1440 } }] }),
    { ok: true, reasons: [] },
  );
  assert.equal(menuClipVerdict({ found: true, menu: { ...menu, bottom: 900.8 }, viewport, clippers: [] }).ok, true, '1px tolerance');
  const clipped = menuClipVerdict({
    found: true, menu, viewport,
    clippers: [{ tag: 'div', className: 'rounded-lg border bg-card overflow-hidden', rect: { top: 200, left: 90, bottom: 450, right: 700 } }],
  });
  assert.equal(clipped.ok, false);
  assert.match(clipped.reasons[0], /ถูกตัดโดย <div class="rounded-lg border bg-card overflow-hidden">/);
  const offscreen = menuClipVerdict({ found: true, menu: { ...menu, bottom: 950 }, viewport, clippers: [] });
  assert.equal(offscreen.ok, false);
  assert.match(offscreen.reasons[0], /ล้นจอ 1440×900/);
});
```

- [ ] **Step 7: Run the tests — expect FAIL**

Run: `node --test tools/field-scale/check.test.mjs`
Expected: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…\tools\field-scale\coa.mjs' imported from …\tools\field-scale\check.test.mjs`, `ℹ fail 1`.

- [ ] **Step 8: Implement the chart-of-accounts fixture**

Create `tools/field-scale/coa.mjs`:

```js
// Field-scale check — synthetic chart of accounts for the route mocks (spec §5), read from the CPA CSV
// that prisma/seed-coa-finance.ts seeds from. Same column rules as
// apps/api/src/modules/journal/__tests__/csv-fixture-loader.ts (loadCoaFromCsv / parseCsvLine); response
// shapes mirror ChartOfAccountsService.findAll / findByCodes / findGrouped.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ACCOUNT_CODE_RE = /^S?\d{2}-\d{4}$/;
export const ACTIVE_STATUS = 'ใช้งาน';
export const defaultCoaCsv = () =>
  fileURLToPath(
    new URL('../../apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv', import.meta.url),
  );

export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuote = false;
  for (const ch of line) {
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ',' && !inQuote) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const byCode = (a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

export function parseCoaCsv(text) {
  return text
    .split(/\r?\n/)
    .map(parseCsvLine)
    .filter((c) => ACCOUNT_CODE_RE.test((c[0] ?? '').trim()))
    .map((c) => ({
      id: `coa-${c[0].trim()}`,
      code: c[0].trim(),
      name: (c[1] ?? '').trim(),
      type: (c[2] ?? '').trim(),
      normalBalance: (c[3] ?? '').trim(),
      category: (c[4] ?? '').trim() || null,
      vatApplicable: (c[5] ?? '').trim() === 'ใช่',
      notes: (c[6] ?? '').trim() || null,
      status: (c[7] ?? '').trim() || ACTIVE_STATUS,
    }))
    .sort(byCode);
}

export const loadCoa = (file = defaultCoaCsv()) => parseCoaCsv(readFileSync(file, 'utf8'));

// GET /chart-of-accounts/grouped?type&codePrefix&category → { groups: [{ category, accounts }] } (active only)
export function coaGrouped(rows, { type, codePrefix, category } = {}) {
  const groups = new Map();
  for (const r of rows) {
    if (r.status !== ACTIVE_STATUS) continue;
    if (type && r.type !== type) continue;
    if (codePrefix && !r.code.startsWith(codePrefix)) continue;
    if (category && r.category !== category) continue;
    const key = r.category ?? 'อื่นๆ';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      code: r.code, name: r.name, normalBalance: r.normalBalance, vatApplicable: r.vatApplicable, notes: r.notes,
    });
  }
  return { groups: [...groups].map(([group, accounts]) => ({ category: group, accounts })) };
}

// GET /chart-of-accounts/by-codes?codes=a,b → [{ code, name }] ordered by code
export function coaByCodes(rows, codes) {
  const wanted = new Set(codes.map((c) => c.trim()).filter(Boolean));
  return rows.filter((r) => wanted.has(r.code)).map((r) => ({ code: r.code, name: r.name }));
}

// GET /chart-of-accounts?type&status&q → rows ordered by code
export function coaList(rows, { type, status, q } = {}) {
  const needle = (q ?? '').trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!type || r.type === type) &&
      (!status || r.status === status) &&
      (!needle || r.code.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle)),
  );
}
```

- [ ] **Step 9: Implement the menu clip check**

Create `tools/field-scale/menu-clip.mjs`:

```js
// Field-scale check — "is the account menu clipped?" (appendix ก S2-01 / S2-02; spec §7 R1-2 acceptance
// "เมนูบัญชีเปิดอยู่ในการ์ดรายการและตาราง Override JV ที่ 1440").
// readMenuGeometry runs INSIDE the page (Playwright serialises its source — no imports, no outer
// variables). It finds the visible account-search box by its aria-label, walks up to the menu panel
// (first absolutely/fixed positioned ancestor — the old absolute dropdown, or Radix's fixed popper
// wrapper after R1-2), then lists every overflow-clipping ancestor at or above the panel's containing
// block. menuClipVerdict is the pure decision (tested in check.test.mjs).

export const MENU_TOLERANCE_PX = 1;

export function readMenuGeometry(searchLabel) {
  const inputs = Array.from(document.querySelectorAll('input')).filter(
    (el) => el.getAttribute('aria-label') === searchLabel && el.checkVisibility(),
  );
  const input = inputs[inputs.length - 1];
  if (!input) return { found: false };
  let panel = input.parentElement;
  while (panel && panel !== document.body) {
    const position = getComputedStyle(panel).position;
    if (position === 'absolute' || position === 'fixed') break;
    panel = panel.parentElement;
  }
  if (!panel || panel === document.body) return { found: false };
  const box = (r) => ({ top: r.top, left: r.left, bottom: r.bottom, right: r.right });
  const fixed = getComputedStyle(panel).position === 'fixed';
  const containsFixed = (s) =>
    s.transform !== 'none' || s.filter !== 'none' || /paint|layout|strict|content/.test(s.contain);
  const clippers = [];
  let inScope = false;
  for (let el = panel.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    const s = getComputedStyle(el);
    if (!inScope) inScope = fixed ? containsFixed(s) : s.position !== 'static' || containsFixed(s);
    if (!inScope || (s.overflowX === 'visible' && s.overflowY === 'visible')) continue;
    const r = el.getBoundingClientRect();
    const top = r.top + el.clientTop;
    const left = r.left + el.clientLeft;
    clippers.push({
      tag: el.tagName.toLowerCase(),
      className: String(el.getAttribute('class') ?? '').slice(0, 120),
      rect: { top, left, bottom: top + el.clientHeight, right: left + el.clientWidth },
    });
  }
  return {
    found: true,
    position: fixed ? 'fixed' : 'absolute',
    menu: box(panel.getBoundingClientRect()),
    viewport: { width: innerWidth, height: innerHeight },
    clippers,
  };
}

const fmt = (r) => `[${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)}]`;

export function menuClipVerdict(geo) {
  if (!geo?.found) return { ok: false, reasons: ['ไม่พบเมนูบัญชีหลังกดเปิด'] };
  const t = MENU_TOLERANCE_PX;
  const m = geo.menu;
  const reasons = [];
  if (m.top < -t || m.left < -t || m.bottom > geo.viewport.height + t || m.right > geo.viewport.width + t) {
    reasons.push(`เมนู ${fmt(m)} ล้นจอ ${geo.viewport.width}×${geo.viewport.height}`);
  }
  for (const c of geo.clippers) {
    const r = c.rect;
    if (m.top < r.top - t || m.left < r.left - t || m.bottom > r.bottom + t || m.right > r.right + t) {
      reasons.push(`เมนู ${fmt(m)} ถูกตัดโดย <${c.tag} class="${c.className}"> ${fmt(r)}`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}
```

- [ ] **Step 10: Run the tests — expect PASS**

Run: `node --test tools/field-scale/check.test.mjs`
Expected (tail): `ℹ tests 18` · `ℹ pass 18` · `ℹ fail 0`.

- [ ] **Step 11: Commit**

```bash
git add tools/field-scale/coa.mjs tools/field-scale/menu-clip.mjs tools/field-scale/check.test.mjs && git commit -F - <<'EOF'
feat(tools): field-scale chart-of-accounts fixture + account-menu clip check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 12: Add failing tests for the route list**

In `tools/field-scale/check.test.mjs` replace

```js
import { menuClipVerdict } from './menu-clip.mjs';
```

with

```js
import { menuClipVerdict } from './menu-clip.mjs';
import { ADDRESS_FORM_HOSTS, COMMON_MOCKS, ROUTES } from './routes.mjs';
```

and replace the last two lines of the file

```js
  assert.match(offscreen.reasons[0], /ล้นจอ 1440×900/);
});
```

with

```js
  assert.match(offscreen.reasons[0], /ล้นจอ 1440×900/);
});

test('routes: ids, paths, mocks and probes are well formed', () => {
  const ids = ROUTES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  for (const r of ROUTES) {
    assert.match(r.id, /^[a-z0-9-]+$/);
    assert.ok(typeof r.path === 'function' || (typeof r.path === 'string' && r.path.startsWith('/')), r.id);
    assert.ok(Array.isArray(r.mocks) && Array.isArray(r.appendix), r.id);
    assert.ok(r.open === undefined || typeof r.open === 'function', r.id);
    for (const m of [...COMMON_MOCKS, ...r.mocks]) {
      assert.ok(m.path instanceof RegExp && m.path.source.startsWith('^') && m.path.source.endsWith('$'), `${r.id}: ${m.path}`);
      assert.equal(typeof m.json, 'function', `${r.id}: ${m.path}`);
    }
  }
});

test('routes: cover appendix ก, the 9 AddressForm hosts and both account-menu probes', () => {
  const appendix = new Set(ROUTES.flatMap((r) => r.appendix));
  for (const code of ['S1-01', 'S1-02', 'S1-03', 'S1-04', 'S1-05', 'S1-06', 'S2-01', 'S2-02', 'S2-03', 'S2-04', 'S2-05',
    'S2-07', 'S2-08', 'S3-02', 'S3-03', 'S3-04', 'S3-05', 'S3-07', 'S3-09', 'S3-10', 'S3-12']) {
    assert.ok(appendix.has(code), code);
  }
  const ids = new Set(ROUTES.map((r) => r.id));
  assert.equal(ADDRESS_FORM_HOSTS.length, 9);
  for (const id of ADDRESS_FORM_HOSTS) assert.ok(ids.has(id), id);
  const probes = ROUTES.flatMap((r) => (r.probes ?? []).map((p) => [r.id, p.id, p.widths]));
  assert.deepEqual(probes, [
    ['other-income-items', 'account-menu-items-card', [1440]],
    ['other-income-override', 'account-menu-override-jv', [1440]],
  ]);
});

test('routes: the deep screens later tasks measure, and a fixed buy-back catalog', async () => {
  const byId = new Map(ROUTES.map((r) => [r.id, r]));
  for (const id of ['company-entity-edit', 'company-entity-create', 'purchase-order-wizard', 'interest-config-form',
    'finance-knowledge-form', 'todo-form', 'stock-transfers-outgoing', 'other-income-items', 'expense-new', 'payroll-new',
    'recurring-bill-dialog', 'trade-in-quick-buy', 'pos-sale-form']) {
    assert.ok(byId.has(id), id);
  }
  assert.equal(typeof byId.get('company-entity-create').open, 'function');
  assert.ok(byId.get('company-entity-create').appendix.includes('S1-02'));
  assert.equal(typeof byId.get('payroll-new').open, 'function', 'S3-07 needs an expanded line');
  assert.ok(byId.get('purchase-order-wizard').appendix.includes('S2-08'));
  const poSuppliers = await byId.get('purchase-order-wizard').mocks.find((m) => m.path.test('/suppliers')).json();
  assert.equal(poSuppliers.data.length, 1, 'the wizard draft names the one mocked supplier');
  const catalogMock = byId.get('trade-in-quick-buy').mocks.find((m) => m.path.test('/trade-ins/quick-buy/catalog'));
  assert.ok(catalogMock, 'the catalog is mocked so the selects do not depend on preview data or timing');
  const catalog = await catalogMock.json();
  assert.ok(catalog.models.length > 0 && catalog.models.every((m) => m.storages.length > 0));
});

test('routes: common mocks answer from the CPA chart of accounts and the preview user', async () => {
  const find = (path) => COMMON_MOCKS.find((m) => m.path.test(path));
  const grouped = await find('/chart-of-accounts/grouped').json(new URL('http://x/api/admin/chart-of-accounts/grouped'), {});
  assert.ok(grouped.groups.flatMap((g) => g.accounts).some((a) => a.code === '42-1102' && a.name === 'ดอกเบี้ยเงินฝาก'));
  const byCodes = await find('/chart-of-accounts/by-codes').json(
    new URL('http://x/api/admin/chart-of-accounts/by-codes?codes=11-1101,11-1201'), {},
  );
  assert.deepEqual(byCodes.map((r) => r.code), ['11-1101', '11-1201']);
  assert.equal(find('/chart-of-accounts/grouped/x'), undefined, 'anchored');
  const perms = await find('/accounting-permissions/me').json(new URL('http://x/'), {
    me: { id: 'u1', name: 'ผู้ทดสอบ', role: 'OWNER' },
  });
  assert.deepEqual(perms.user, { id: 'u1', name: 'ผู้ทดสอบ', role: 'OWNER', branchId: null });
  assert.ok(perms.permissions.includes('INCOME_POST'));
  const roleMap = ROUTES.find((r) => r.id === 'account-role-edit').mocks[0].json();
  assert.ok(roleMap.every((row) => row.accountName), 'role-map names come from the CSV');
});
```

- [ ] **Step 13: Run the tests — expect FAIL**

Run: `node --test tools/field-scale/check.test.mjs`
Expected: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…\tools\field-scale\routes.mjs' imported from …\tools\field-scale\check.test.mjs`, `ℹ fail 1`.

- [ ] **Step 14: Implement the route list and mocks**

Endpoints below were found by reading each page (verified against the preview allow-list in `apps/api/e2e/support/chat-credit-preview.ts:690-711` — everything not listed there answers 501; `products/*` and `interest-configs` are allow-listed but have no handler for these sub-paths, so they 404). Shapes: `DunningSettingsPage.tsx:31-45,215-286` · `AuditLogsPage.tsx:37-42,142-145` · `ChatbotFinanceKnowledgePage.tsx:15-25,63-68,83,416` · `RepossessionsPage.tsx:144-180,686-707` · `StockTransfersPage.tsx:85-139,218-219` · `ExpenseFavoritesPage.tsx:49-55` · `lib/api/ssoConfig.ts:3-8` · `lib/api/employees.ts:91-96` · `InterestConfigPage.tsx:137-191` · `SuppliersPage/index.tsx:60-75` · `PurchaseOrdersPage/hooks/usePurchaseOrdersData.ts:119-120` · `AccountRolesPage.tsx:34-50,68,226` · `lib/otherIncome.ts:89-131` · `hooks/useAccountingPermissions.ts:6-20` · `hooks/useCoa.ts:33-60`. Open triggers: `DunningSettingsPage.tsx:378-383` ("เพิ่ม กฎ"), `SmsTemplatesPage.tsx:102`, `OtherIncomeEntryPage.tsx:1068-1111` + `OverrideConfirmDialog.tsx:38-51`, `EditableJournalTable.tsx:104-125,173`, `ItemsTable.tsx:72,95-100` (card `rounded-lg border bg-card overflow-hidden`, default item 42-1102 at `OtherIncomeEntryPage.tsx:190-192`), `CompanySettingsPage.tsx:636-639`, `ChatbotFinanceKnowledgePage.tsx:154-157`, `ExpenseFavoritesPage.tsx:126`, `TradeInPage/index.tsx:272-277`, `InterestConfigPage.tsx:307-309`, `BranchesPage.tsx:195-198`, `TodosPage/index.tsx:189-194`, `PurchaseOrdersPage/index.tsx:206-210`, `AccountRolesPage.tsx:192,276-282`, `CustomersPage/index.tsx:278`, `CustomerDetailPage/components/DetailHeader.tsx:140`, `ContractCreatePage/components/CustomerSelectStep.tsx:155-162`, `ContractDetailPage.tsx:1361-1367`, `SuppliersPage/index.tsx:263-265`, `SettingsPage/tabs/ContactsTab.tsx:117-122` (rendered by `/contacts`, `ContactsPage.tsx:2`). Paths: `App.tsx:362-1308`, `config/settings-registry.tsx:108,117,140,162,164`. `/expenses/new?type=PR` → PAYROLL (`ExpenseDocumentNewPage.tsx:16-26`).

Create `tools/field-scale/routes.mjs`:

```js
// Field-scale check — what to measure (spec §5 "หน้าที่วัด"): every screen in appendix ก plus the 9 forms
// that embed AddressForm (spec §4.3), as { id, path, appendix, open?, mocks, probes? }.
//   path      string, or (ctx) => string | null (null = the preview has no sample record → cell "skipped")
//   open      clicks that open the dialog / tab / mode to measure — never save, never pick a value that saves
//   mocks     GET endpoints the local preview answers 501/404 for, or answers from data that varies between
//             preview starts: { path: /^\/api-path$/, json(url, ctx) }. path is matched against the request
//             pathname WITHOUT /api or /api/admin; GET only; route mocks after COMMON_MOCKS, first match wins.
//   probes    account-menu clipping check (S2-01 / S2-02): { id, widths, trigger(page) → Locator }
// COMMON_MOCKS apply to every route. ctx = { origin, me (GET /auth/me), customerId, contractPath }.
import { coaByCodes, coaGrouped, coaList, loadCoa } from './coa.mjs';

const COA = loadCoa();
const accountName = (code) => COA.find((r) => r.code === code)?.name ?? null;

// Same paper/document exclusions as the typography audit (apps/api/e2e/documents/uxui-pages.browser.docs-spec.ts:40)
export const COLLECT_EXCLUDE = [
  '.voucher-sheet', '.document-sheet', '.bc-document', '.document-landscape', '.document-print-dialog',
  '.template-paper', '.font-sarabun', '.mobile-receipt', '.sticker', '.print-stickers', '.tiptap',
  '.parcel-label', '.contract-body', 'iframe', 'svg', '[data-sonner-toaster]',
].join(', ');
export const MENU_SEARCH_LABEL = 'ค้นหารหัส หรือ ชื่อบัญชี';
export const viewportFor = (width) => ({ width, height: width <= 430 ? 844 : 900 });

export const mock = (path, json) => ({ path, json: typeof json === 'function' ? json : () => json });

export const ACCOUNTING_PERMISSIONS = [
  'EXPENSE_POST', 'EXPENSE_APPROVE', 'EXPENSE_CANCEL', 'INCOME_POST', 'INCOME_APPROVE', 'INCOME_CANCEL',
];

export const COMMON_MOCKS = [
  mock(/^\/chart-of-accounts\/grouped$/, (url) => coaGrouped(COA, Object.fromEntries(url.searchParams))),
  mock(/^\/chart-of-accounts\/by-codes$/, (url) => coaByCodes(COA, (url.searchParams.get('codes') ?? '').split(','))),
  mock(/^\/chart-of-accounts$/, (url) => coaList(COA, Object.fromEntries(url.searchParams))),
  mock(/^\/accounting-permissions\/me$/, (url, ctx) => ({
    user: { id: ctx.me.id, name: ctx.me.name, role: ctx.me.role, branchId: ctx.me.branchId ?? null },
    permissions: ACCOUNTING_PERMISSIONS,
  })),
  mock(/^\/settings$/, []),
];

const DUNNING_RULES = [
  {
    id: 'preview-dunning-1', name: 'เตือนก่อนครบกำหนด 3 วัน', triggerDay: -3, eventTrigger: null, channel: 'LINE',
    messageTemplate: 'เรียนคุณ {customerName} ค่างวดที่ {installmentNo} ครบกำหนดวันที่ {dueDate}', templateName: null,
    includePaymentLink: true, autoExecute: true, escalateTo: null, isActive: true, sortOrder: 1,
  },
  {
    id: 'preview-dunning-2', name: 'ค้างชำระ 7 วัน โทรติดตาม', triggerDay: 7, eventTrigger: null, channel: 'CALL_TASK',
    messageTemplate: 'โทรติดตามลูกค้าที่ค้างชำระ 7 วัน', templateName: null, includePaymentLink: false,
    autoExecute: false, escalateTo: 'BRANCH_MANAGER', isActive: true, sortOrder: 2,
  },
];

const ROLE_MAP_ROWS = [
  ['payroll_expense', '53-1101', true],
  ['payroll_sso_expense', '53-1102', true],
  ['wht_payroll', '21-3101', false],
].map(([role, accountCode, required], i) => ({
  id: `preview-role-${i + 1}`, role, accountCode, accountName: accountName(accountCode),
  priority: 1, isActive: true, note: null, required,
}));

const EMPTY_PAGE = { data: [], total: 0, page: 1, limit: 50 };

const PO_SUPPLIER = {
  id: 'preview-supplier-1', name: 'ผู้จัดจำหน่ายตัวอย่าง', contactName: null, phone: '020000000', hasVat: true,
  isActive: true,
  paymentMethods: [
    { paymentMethod: 'BANK_TRANSFER', bankName: 'กสิกรไทย', bankAccountNumber: '0000000000', isDefault: true },
  ],
};

const M = {
  dunningRules: mock(/^\/overdue\/dunning-rules$/, DUNNING_RULES),
  smsTemplates: mock(/^\/sms-templates$/, []),
  otherIncome: [
    mock(/^\/other-income\/maker-checker-enabled$/, { enabled: false }),
    mock(/^\/other-income\/config\/attachment-threshold$/, { threshold: 1000 }),
    mock(/^\/other-income\/templates$/, []),
  ],
  auditStats: mock(/^\/audit\/stats$/, { todayCount: 12, weekCount: 86, totalCount: 1240, recentErrors: 0 }),
  knowledge: [
    mock(/^\/chatbot\/finance\/admin\/knowledge$/, []),
    mock(/^\/chatbot\/finance\/admin\/kb-suggestions$/, { items: [], total: 0, page: 1, limit: 50 }),
  ],
  repossessions: [
    mock(/^\/repossessions$/, { ...EMPTY_PAGE, limit: 200 }),
    mock(/^\/repossessions\/profit-loss$/, {
      summary: { count: 0, totalAppraisal: 0, totalRepairCost: 0, totalResellPrice: 0, totalProfit: 0 },
      data: [],
    }),
    mock(/^\/device-returns\/awaiting-repossession$/, { data: [], total: 0 }),
    // DeviceReturnList.tsx:61-65 — without it the list's QueryBoundary shows its error panel
    mock(/^\/device-returns$/, { data: [], total: 0, page: 1, limit: 100 }),
  ],
  transfers: [
    mock(/^\/products\/transfers\/(pending|in-transit)$/, []),
    mock(/^\/products\/transfers\/history$/, EMPTY_PAGE),
    mock(/^\/branch-receiving\/pending-deliveries$/, []),
    mock(/^\/branch-receiving$/, EMPTY_PAGE),
  ],
  expense: [
    mock(/^\/expense-templates$/, []),
    mock(/^\/employees\/pickable$/, []),
    mock(/^\/sso-config\/effective$/, {
      salaryCeiling: '17500', maxContribution: '875', effectiveFrom: '2026-01-01', rate: 0.05,
    }),
  ],
  interestConfigs: mock(/^\/interest-configs$/, []),
  suppliers: mock(/^\/suppliers$/, { data: [], total: 0, page: 1, totalPages: 1 }),
  // the one supplier the purchase wizard's draft names (openPurchasePayment)
  poSuppliers: mock(/^\/suppliers$/, { data: [PO_SUPPLIER], total: 1, page: 1, totalPages: 1 }),
  // The preview answers this from its own data and the model select stays disabled until it lands
  // (QuickBuyModal.tsx:188-196,895) — a fixed catalog keeps both selects in the same state every run.
  buybackCatalog: mock(/^\/trade-ins\/quick-buy\/catalog$/, {
    models: [
      { model: 'iPhone 15', storages: [{ storage: '128GB', maxPrice: '14500' }, { storage: '256GB', maxPrice: '16500' }] },
      { model: 'iPhone 15 Pro', storages: [{ storage: '256GB', maxPrice: '21500' }] },
    ],
  }),
  purchaseOrders: mock(/^\/purchase-orders$/, EMPTY_PAGE),
  roleMap: mock(/^\/settings\/role-map$/, ROLE_MAP_ROWS),
  // The preview's GET /branches is a bare findMany without `_count` — BranchesPage.tsx:158 reads
  // b._count.users and the page crashes ("Cannot read properties of undefined (reading 'users')").
  branches: mock(/^\/branches$/, [
    {
      id: 'preview-branch-1', name: 'สาขาตัวอย่าง (คลังหลัก)', location: 'กรุงเทพมหานคร', phone: '020000000',
      isActive: true, isMainWarehouse: true, shopCashAccountCode: 'S11-1101', shopCashFloat: '2000',
      _count: { users: 5, products: 120, contracts: 30 },
    },
    {
      id: 'preview-branch-2', name: 'สาขาตัวอย่าง 2', location: null, phone: null,
      isActive: true, isMainWarehouse: false, shopCashAccountCode: null, shopCashFloat: '0',
      _count: { users: 2, products: 40, contracts: 8 },
    },
  ]),
  // The preview's fixed actor is OWNER, and /todos is not in OWNER's menu (config/menu.ts OWNER_CONFIG) —
  // MainLayout redirects it to "/". Present the actor as BRANCH_MANAGER (whose menu has /todos) to the
  // web app only; the preview API still answers as OWNER.
  branchManagerActor: mock(/^\/auth\/me$/, (url, ctx) => ({ ...ctx.me, role: 'BRANCH_MANAGER' })),
};

const clickButton = (name) => async (page) => {
  await page.getByRole('button', { name, exact: true }).first().click();
};

export const journalTable = (page) =>
  page.locator('table').filter({ has: page.getByRole('columnheader', { name: 'รหัสบัญชี' }) }).first();

// "ปรับรายการเอง" → acknowledge → "เปิดโหมดแก้ไข": local form state only (nothing is saved).
async function openOverrideJournal(page) {
  await page.getByText('ปรับรายการเอง', { exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox').click();
  await dialog.getByRole('button', { name: 'เปิดโหมดแก้ไข' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await journalTable(page).waitFor();
  // The "รวม" totals row also lives in <tbody> (EditableJournalTable.tsx) — count only editable lines,
  // i.e. rows whose first cell holds the account-menu trigger.
  if ((await journalTable(page).locator('tbody tr td:first-child button').count()) === 0) {
    await page.getByRole('button', { name: 'เพิ่มบรรทัด' }).click();
  }
}

// S2-08 lives in PaymentSection, which the purchase wizard's summary renders only in "ของถึงแล้ว"
// (receive) mode (StepSummary.tsx:193), and its file / URL row only once the status is a paid one
// (PaymentSection.tsx:77,200). Local wizard state only: the draft is the wizard's own localStorage
// draft (useCreatePoWizard.ts:17,78-105) naming the mocked supplier and one accessory line (no IMEI to
// inspect — direct-receive.util.ts:26, receiving-flow.util.ts:55-75); nothing is submitted.
async function openPurchasePayment(page) {
  await page.evaluate((supplierId) => {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
    localStorage.setItem('bestchoice-po-draft', JSON.stringify({
      step: 0,
      mode: 'receive',
      form: {
        supplierId, orderDate: today, expectedDate: '', notes: '', discount: '', discountAfterVat: '',
        paymentStatus: 'UNPAID', paymentMethod: '', paidAmount: '', paymentNotes: '',
      },
      items: [{
        brand: '', category: 'ACCESSORY', model: 'ฟิล์มกระจก', color: '', storage: '', quantity: '1', unitPrice: '35',
        accessoryType: 'ฟิล์ม', accessoryBrand: 'iStar',
      }],
      savedAt: new Date().toISOString(),
    }));
  }, PO_SUPPLIER.id);
  await clickButton('+ ซื้อสินค้า')(page);
  await clickButton('ถัดไป: ตรวจรับ 1 ชิ้น')(page);
  await page.locator('#group-cash').fill('59');
  await clickButton('ถัดไป: สรุป + จ่ายเงิน')(page);
  await page.locator('#po-payment-status').selectOption('FULLY_PAID');
  // the S2-08 row into view for the screenshot, after the "draft recovered" toast (5 s) has gone
  await page.getByRole('button', { name: '+ เพิ่ม', exact: true }).scrollIntoViewIfNeeded();
  await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 10000 });
}

const ACCOUNT_MENU_ITEMS_CARD = {
  id: 'account-menu-items-card',
  widths: [1440],
  // item #1 defaults to 42-1102 — the trigger shows its name (role-agnostic: R1-2 may add role=combobox)
  trigger: (page) => page.locator('button', { hasText: 'ดอกเบี้ยเงินฝาก' }).first(),
};
const ACCOUNT_MENU_OVERRIDE_JV = {
  id: 'account-menu-override-jv',
  widths: [1440],
  trigger: (page) => journalTable(page).locator('tbody tr').first().locator('td').first().locator('button').first(),
};

export const ADDRESS_FORM_HOSTS = [
  'company-entity-edit', 'customer-create-dialog', 'contract-customer-create', 'contract-customer-edit',
  'customer-edit-dialog', 'supplier-form', 'trade-in-quick-buy', 'branch-create', 'contact-create',
];

export const ROUTES = [
  { id: 'dunning-rule-dialog', path: '/settings/comms/dunning', appendix: ['S1-01'], open: clickButton('เพิ่ม กฎ'),
    mocks: [M.dunningRules, M.smsTemplates] },
  { id: 'sms-template-form', path: '/settings/comms/sms', appendix: ['§4.2 ข้อ 8'], open: clickButton('เพิ่มแม่แบบ'),
    mocks: [M.smsTemplates] },
  { id: 'other-income-items', path: '/other-income/new', appendix: ['S2-01', 'S2-07'], mocks: M.otherIncome,
    probes: [ACCOUNT_MENU_ITEMS_CARD] },
  { id: 'other-income-override', path: '/other-income/new', appendix: ['S2-02'], open: openOverrideJournal,
    mocks: M.otherIncome, probes: [ACCOUNT_MENU_OVERRIDE_JV] },
  { id: 'company-entity-edit', path: '/settings/company/entities', appendix: ['S1-02', 'S3-12'],
    open: clickButton('แก้ไข'), mocks: [] },
  { id: 'company-entity-create', path: '/settings/company/entities', appendix: ['S1-02'],
    open: clickButton('เพิ่มนิติบุคคล'), mocks: [] },
  { id: 'audit-logs', path: '/audit-logs', appendix: ['S1-04'], mocks: [M.auditStats] },
  { id: 'finance-knowledge-form', path: '/chatbot-finance/knowledge', appendix: ['S1-05'],
    open: clickButton('+ เพิ่ม คำถามที่พบบ่อย'), mocks: M.knowledge },
  { id: 'repossessions', path: '/repossessions', appendix: ['S2-03'], mocks: M.repossessions },
  { id: 'stock-transfers-outgoing', path: '/stock/transfers?view=outgoing', appendix: ['S2-04'], mocks: M.transfers },
  { id: 'stock-transfers-incoming', path: '/stock/transfers?view=incoming', appendix: ['S2-04'], mocks: M.transfers },
  { id: 'stock-transfers-history', path: '/stock/transfers?view=history', appendix: ['S2-04'], mocks: M.transfers },
  { id: 'expense-new', path: '/expenses/new', appendix: ['S3-02', 'S3-04', 'S3-05'], mocks: M.expense },
  // S3-07 is the account select of a line's "รายได้พิเศษ" sub-table, rendered only when the line is expanded
  // (PayrollLinesSection.tsx:475,535-540,639-652,808) — local form state, nothing is saved.
  { id: 'payroll-new', path: '/expenses/new?type=PR', appendix: ['S3-07'], mocks: M.expense,
    open: async (page) => {
      await clickButton('เพิ่มพนักงาน')(page);
      await clickButton('ขยาย')(page);
      await clickButton('เพิ่มรายได้พิเศษ')(page);
    } },
  { id: 'recurring-bill-dialog', path: '/expenses/favorites', appendix: ['S3-09'], open: clickButton('+ บิลประจำ'),
    mocks: M.expense },
  { id: 'trade-in-quick-buy', path: '/trade-in', appendix: ['S3-10', 'S3-12'], mocks: [M.buybackCatalog],
    open: async (page) => {
      await clickButton('รับซื้อเครื่อง')(page);
      await page.locator('#quick-buy-model:not([disabled])').waitFor();
    } },
  { id: 'interest-config-form', path: '/settings/finance/interest', appendix: ['S1-03'],
    open: clickButton('+ สร้าง การตั้งค่า'), mocks: [M.interestConfigs] },
  { id: 'branch-create', path: '/branches', appendix: ['S1-06', 'S3-12'], open: clickButton('+ เพิ่มสาขา'),
    mocks: [M.branches] },
  { id: 'todo-form', path: '/todos', appendix: ['S2-05'], open: clickButton('เพิ่มงาน'), mocks: [M.branchManagerActor] },
  { id: 'purchase-order-wizard', path: '/purchase-orders', appendix: ['S2-08'], open: openPurchasePayment,
    mocks: [M.purchaseOrders, M.poSuppliers] },
  { id: 'account-role-edit', path: '/settings/access/account-roles', appendix: ['S3-03'], mocks: [M.roleMap],
    open: async (page) => {
      await page.getByRole('button', { name: /^แก้ไข / }).first().click();
      await page.locator('#ar-coa-trigger').click();
    } },
  { id: 'customer-create-dialog', path: '/customers', appendix: ['S3-12'], mocks: [],
    open: async (page) => {
      await page.getByRole('button', { name: /^\+ เพิ่ม(ลูกค้า|ผู้สนใจ)ใหม่$/ }).first().click();
    } },
  { id: 'customer-edit-dialog', path: (ctx) => (ctx.customerId ? `/customers/${ctx.customerId}` : null),
    appendix: ['S3-12'], open: clickButton('แก้ไขข้อมูล'), mocks: [] },
  // Step 1 (เลือกสินค้า) must have a product before "ถัดไป" reaches the customer step — local wizard state only
  // (useContractCreateData.ts writes only on the final submit).
  { id: 'contract-customer-create', path: '/contracts/create', appendix: ['S3-12'], mocks: [],
    open: async (page) => {
      await page.locator('div.cursor-pointer').filter({ hasText: 'สาขา:' }).first().click();
      await clickButton('ถัดไป')(page);
      await clickButton('เพิ่มลูกค้าใหม่')(page);
    } },
  // The customer card's own "แก้ไข" opens CustomerEditModal (ContractDetailPage.tsx:1354-1368,1584); the first
  // "แก้ไข" on the page is the contract card's inline edit, which is not an AddressForm host.
  { id: 'contract-customer-edit', path: (ctx) => ctx.contractPath, appendix: ['S3-12'], mocks: [],
    open: async (page) => {
      await page.locator('div.rounded-xl')
        .filter({ has: page.getByRole('heading', { name: 'ข้อมูลลูกค้า', exact: true }) })
        .getByRole('button', { name: 'แก้ไข', exact: true }).click();
      await page.getByRole('dialog').waitFor();
    } },
  { id: 'supplier-form', path: '/suppliers', appendix: ['S3-12'], open: clickButton('เพิ่มผู้จัดจำหน่าย'),
    mocks: [M.suppliers] },
  // shadcn FormLabel callers whose labels R1-4 moves to style A (SaleDetailsForm renders without a product)
  { id: 'pos-sale-form', path: '/pos', appendix: ['R1-4 FormLabel'], mocks: [] },
  { id: 'contact-create', path: '/contacts', appendix: ['S3-12'], mocks: [],
    open: async (page) => {
      await page.getByRole('button', { name: 'เพิ่มผู้ติดต่อ' }).click();
      await page.getByRole('menuitem', { name: 'เพิ่มลูกค้า' }).click();
    } },
];
```

- [ ] **Step 15: Create the empty allow-list**

Create `tools/field-scale/allow.json`:

```json
{
  "$comment": "Findings kept on purpose (spec §5 เกณฑ์รับ: จุดที่ตั้งใจคงไว้บันทึกเหตุผล). id = route|width|theme|rule|key copied from .tmp/field-scale/<label>/results.json; reason in Thai, at least 10 characters. Editing this file changes the preview fingerprint — rerun npm run local:preview before the next check.",
  "entries": []
}
```

- [ ] **Step 16: Run the tests — expect PASS**

Run: `node --test tools/field-scale/check.test.mjs`
Expected (tail): `ℹ tests 22` · `ℹ pass 22` · `ℹ fail 0`.

- [ ] **Step 17: Commit**

```bash
git add tools/field-scale/routes.mjs tools/field-scale/allow.json tools/field-scale/check.test.mjs && git commit -F - <<'EOF'
feat(tools): field-scale route list — appendix ก screens, 9 AddressForm hosts, preview mocks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 18: Add failing CLI tests**

In `tools/field-scale/check.test.mjs` replace

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
```

with

```js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
```

and replace the last two lines of the file

```js
  assert.ok(roleMap.every((row) => row.accountName), 'role-map names come from the CSV');
});
```

with

```js
  assert.ok(roleMap.every((row) => row.accountName), 'role-map names come from the CSV');
});

const CHECK = fileURLToPath(new URL('./check.mjs', import.meta.url));
const runCheck = (...args) => spawnSync(process.execPath, [CHECK, ...args], { encoding: 'utf8' });

test('check.mjs: usage errors exit 2 before touching the preview', () => {
  const noLabel = runCheck();
  assert.equal(noLabel.status, 2, noLabel.stderr);
  assert.match(noLabel.stderr, /--label is required/);
  assert.match(noLabel.stderr, /usage: node tools\/field-scale\/check\.mjs --label <name>/);
  const badRoute = runCheck('--label', 'x', '--routes', 'no-such-route');
  assert.equal(badRoute.status, 2, badRoute.stderr);
  assert.match(badRoute.stderr, /unknown route id\(s\): no-such-route/);
});

test('check.mjs: --compare needs both runs on disk', () => {
  const r = runCheck('--compare', 'field-scale-test-missing-a', 'field-scale-test-missing-b');
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /no results for "field-scale-test-missing-a"/);
});
```

- [ ] **Step 19: Run the tests — expect FAIL**

Run: `node --test tools/field-scale/check.test.mjs`
Expected: `✖ check.mjs: usage errors exit 2 before touching the preview` and `✖ check.mjs: --compare needs both runs on disk`, each with `AssertionError [ERR_ASSERTION]: … Cannot find module '…\tools\field-scale\check.mjs'` (status 1 ≠ 2); tail `ℹ pass 22` · `ℹ fail 2`.

- [ ] **Step 20: Implement the runner**

Create `tools/field-scale/check.mjs`:

```js
// Field-scale check (spec docs/superpowers/specs/2026-11-14-dropdown-search-field-scale-design.md §5).
// Runs the field collector (tools/typography-audit/collect.js → window.__collectFields) and evaluateFields
// (rules F1–F4, tools/typography-audit/rules.mjs) on every screen in tools/field-scale/routes.mjs against
// this checkout's local preview, at each width × theme. On the other-income screens it also opens the
// account menu and records whether it is clipped (S2-01 / S2-02 → rule MENU, P1).
//   node tools/field-scale/check.mjs --label <name> [--routes <id,id>] [--widths 1440,1024,390] [--themes light,dark]
//     → .tmp/field-scale/<name>/{results.json, report.md, <route>-<width>-<theme>.png}
//   node tools/field-scale/check.mjs --compare <baselineLabel> <label>
//     → prints new / fixed findings; exit 1 when a new P1/P2 finding appears, when any MENU probe fails
//       (even one the baseline had), or when a cell rendered at baseline is lost or emptied (lib.mjs compareRuns)
// A report, not a CI gate (spec §3): a measuring run exits 0 even with findings. A cell counts as rendered
// only when it shows the asked-for path, no error fallback and at least one measured field (screenProblem).
// Prerequisite: npm run local:preview before EVERY measuring run — the preview fingerprints apps/, packages/
// and tools/, so any source edit makes it stale and a stale preview is refused (exit 2); local:preview
// restarts it. Read-only: mocks answer GETs; open steps never save.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { previewStatus, repo } from '../local-preview.mjs';
import { evaluateFields } from '../typography-audit/rules.mjs';
import {
  USAGE,
  UsageError,
  applyAllow,
  compareRuns,
  formatCompare,
  menuFinding,
  parseAllow,
  parseArgs,
  renderReport,
  screenProblem,
  selectRoutes,
  summarize,
} from './lib.mjs';
import { menuClipVerdict, readMenuGeometry } from './menu-clip.mjs';
import { COLLECT_EXCLUDE, COMMON_MOCKS, MENU_SEARCH_LABEL, ROUTES, viewportFor } from './routes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT_ROOT = join(repo, '.tmp', 'field-scale');
const ALLOW_PATH = join(HERE, 'allow.json');
const COLLECT_JS = join(HERE, '..', 'typography-audit', 'collect.js');

const firstLine = (error) => String(error?.message ?? error).split('\n')[0].slice(0, 300);
const loadAllow = () => parseAllow(JSON.parse(readFileSync(ALLOW_PATH, 'utf8')));
const apiPathOf = (url) => url.pathname.replace(/^\/api(?:\/admin)?(?=\/|$)/, '');

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.waitForTimeout(250);
}

// The preview has no login: a fixed OWNER actor answers every request (chat-credit-preview.ts).
async function previewContext(port, info) {
  const base = `http://127.0.0.1:${port}/api/admin`;
  const get = async (path) => {
    const res = await fetch(base + path, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
    return res.json();
  };
  const me = await get('/auth/me');
  // by name, not the default newest-first: a stable pick across preview restarts
  const customers = await get('/customers?limit=1&sortBy=name&sortOrder=asc');
  return {
    origin: `http://localhost:${port}`,
    me,
    customerId: customers?.data?.[0]?.id ?? null,
    contractPath: info?.documentUrl ? new URL(info.documentUrl).pathname : null,
  };
}

async function installNetwork(page, route, ctx, cell) {
  const mocks = [...COMMON_MOCKS, ...route.mocks];
  const mocked = new Set();
  const errors = new Map();
  await page.routeWebSocket('**/socket.io/**', (socket) => socket.close());
  await page.route((url) => url.pathname.startsWith('/api/'), async (r) => {
    const request = r.request();
    const url = new URL(request.url());
    const path = apiPathOf(url);
    const found = request.method() === 'GET' ? mocks.find((m) => m.path.test(path)) : undefined;
    if (!found) return r.fallback();
    mocked.add(path);
    return r.fulfill({ json: await found.json(url, ctx) });
  });
  page.on('response', (res) => {
    const url = new URL(res.url());
    if (!url.pathname.startsWith('/api/') || res.status() < 400) return;
    const entry = { method: res.request().method(), path: apiPathOf(url), status: res.status() };
    errors.set(`${entry.method} ${entry.path} ${entry.status}`, entry);
  });
  return () => {
    cell.mocked = [...mocked].sort();
    cell.apiErrors = [...errors.values()];
  };
}

async function runMenuProbe(page, probe, screenshotPath) {
  try {
    const trigger = probe.trigger(page);
    await trigger.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await trigger.click();
    await page.waitForTimeout(300);
    const geometry = await page.evaluate(readMenuGeometry, MENU_SEARCH_LABEL);
    await page.screenshot({ path: screenshotPath, animations: 'disabled' });
    await page.keyboard.press('Escape');
    return { id: probe.id, ...menuClipVerdict(geometry), geometry };
  } catch (error) {
    return { id: probe.id, ok: false, error: true, reasons: [`probe error: ${firstLine(error)}`], geometry: null };
  }
}

// In the page: the heading of a visible error fallback — the root ErrorBoundary (ErrorBoundary.tsx:76,
// which replaces .app-shell) or a QueryBoundary error (QueryBoundary.tsx:65-70) — or null.
function readErrorFallback() {
  const shown = (el) => !!el && el.getClientRects().length > 0;
  if (!shown(document.querySelector('.app-shell'))) {
    const h1 = [...document.querySelectorAll('h1')].find(shown);
    return h1?.textContent.trim() || 'the app shell is gone';
  }
  const h2 = [...document.querySelectorAll('[role="alert"] > h2')].find(shown);
  return h2 ? h2.textContent.trim() : null;
}

async function measureCell(browser, route, width, theme, ctx, outDir) {
  const cell = {
    route: route.id, path: null, width, theme, status: 'rendered', finalPath: null, openError: null, error: null,
    factCount: 0, screenshot: null, mocked: [], apiErrors: [], findings: [], probes: [],
  };
  const context = await browser.newContext({ viewport: viewportFor(width), reducedMotion: 'reduce' });
  await context.addInitScript((value) => {
    try {
      localStorage.setItem('theme', value);
    } catch {
      // storage blocked — the page falls back to its default theme
    }
  }, theme);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const flushNetwork = await installNetwork(page, route, ctx, cell);
  try {
    cell.path = typeof route.path === 'function' ? await route.path(ctx) : route.path;
    if (!cell.path) {
      cell.status = 'skipped';
      cell.error = 'preview has no sample record for this screen';
      return cell;
    }
    await page.goto(ctx.origin + cell.path, { waitUntil: 'domcontentloaded' });
    await page.locator('.app-shell').first().waitFor({ state: 'visible', timeout: 20000 });
    await settle(page);
    if (route.open) {
      try {
        await route.open(page);
        await settle(page);
      } catch (error) {
        cell.status = 'open-failed';
        cell.openError = firstLine(error);
      }
    }
    const url = new URL(page.url());
    cell.finalPath = url.pathname + url.search;
    cell.screenshot = `${route.id}-${width}-${theme}.png`;
    await page.screenshot({ path: join(outDir, cell.screenshot), fullPage: true, animations: 'disabled' });
    if (!(await page.evaluate(() => typeof window.__collectFields === 'function'))) {
      await page.addScriptTag({ path: COLLECT_JS });
    }
    const facts = await page.evaluate((exclude) => {
      if (typeof window.__collectFields !== 'function') {
        throw new Error('tools/typography-audit/collect.js has no window.__collectFields — land Task 1 first');
      }
      return window.__collectFields({ exclude, root: 'body' });
    }, COLLECT_EXCLUDE);
    cell.factCount = facts.length;
    const problem = screenProblem({
      requestedPath: cell.path, finalPath: cell.finalPath, factCount: cell.factCount,
      fallbackText: await page.evaluate(readErrorFallback),
    });
    if (problem) throw new Error(problem);
    cell.findings = evaluateFields(facts, { width }).map((f) => ({ ...f, route: route.id, width, theme }));
    for (const probe of route.probes ?? []) {
      if (!probe.widths.includes(width)) continue;
      const result = await runMenuProbe(page, probe, join(outDir, `${route.id}-${width}-${theme}-${probe.id}.png`));
      cell.probes.push(result);
      const finding = menuFinding(result, { route: route.id, width, theme });
      if (finding) cell.findings.push(finding);
    }
  } catch (error) {
    cell.status = 'error';
    cell.error = firstLine(error);
  } finally {
    flushNetwork();
    await context.close();
  }
  return cell;
}

async function run(args) {
  const routes = selectRoutes(args.routes, ROUTES);
  const allow = loadAllow();
  const status = await previewStatus();
  if (!status.running || !status.current) {
    console.error(
      'Local preview is not running for this checkout, or is older than the source (any edit under apps/, packages/ ' +
        'or tools/ makes it stale). Run: npm run local:preview — it restarts a stale preview — then run this command again.',
    );
    process.exitCode = 2;
    return;
  }
  const ctx = await previewContext(status.state.port, status.info);
  const outDir = join(OUTPUT_ROOT, args.label);
  mkdirSync(outDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const cells = [];
  const browser = await chromium.launch();
  try {
    for (const route of routes) {
      for (const width of args.widths) {
        for (const theme of args.themes) {
          const cell = await measureCell(browser, route, width, theme, ctx, outDir);
          cell.findings = applyAllow(cell.findings, allow);
          cells.push(cell);
          const probes = cell.probes.map((p) => ` · ${p.id} ${p.ok ? 'PASS' : 'FAIL'}`).join('');
          const open = cell.findings.filter((f) => !f.allowed).length;
          const why = cell.error ?? cell.openError;
          console.log(
            `${route.id} ${width} ${theme}: ${cell.status}${why ? ` (${why})` : ''} · facts ${cell.factCount} · findings ${open}${probes}`,
          );
        }
      }
    }
  } finally {
    await browser.close();
  }
  const results = {
    label: args.label,
    startedAt,
    finishedAt: new Date().toISOString(),
    origin: ctx.origin,
    sourceRevision: status.info.sourceRevision ?? null,
    widths: args.widths,
    themes: args.themes,
    routes: routes.map((r) => r.id),
    routeMeta: routes.map((r) => ({
      id: r.id, path: typeof r.path === 'string' ? r.path : '(from preview data)', appendix: r.appendix,
    })),
    cells,
  };
  writeFileSync(join(outDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  writeFileSync(join(outDir, 'report.md'), renderReport(results));
  const s = summarize(results);
  console.log(`\nopen findings: ${s.total} (P1 ${s.bySeverity.P1} · P2 ${s.bySeverity.P2} · P3 ${s.bySeverity.P3}) · allowed ${s.allowed}`);
  console.log(`menu probes: ${s.probes.filter((p) => p.ok).length} pass · ${s.probes.filter((p) => !p.ok).length} fail`);
  console.log(`cells not fully measured: ${s.problems.length} · API errors without a mock: ${s.apiErrors.length}`);
  console.log(`wrote ${join(outDir, 'results.json')} and report.md`);
}

function readRun(label) {
  const file = join(OUTPUT_ROOT, label, 'results.json');
  if (!existsSync(file)) {
    throw new UsageError(`no results for "${label}" — run: node tools/field-scale/check.mjs --label ${label}`);
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

// The current allow.json is applied to both runs, so an entry added in a PR covers its own compare.
function compare(args) {
  const baseline = readRun(args.baseline);
  const current = readRun(args.label);
  const allow = loadAllow();
  const reapply = (r) => ({ ...r, cells: r.cells.map((c) => ({ ...c, findings: applyAllow(c.findings, allow) })) });
  const result = compareRuns(reapply(baseline), reapply(current));
  console.log(formatCompare(result, args.baseline, args.label));
  process.exitCode = result.failed ? 1 : 0;
}

async function main(argv) {
  try {
    const args = parseArgs(argv);
    if (args.mode === 'compare') compare(args);
    else await run(args);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`${error.message}\n${USAGE}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 21: Run the tests — expect PASS**

Run: `node --test tools/field-scale/check.test.mjs`
Expected (tail): `ℹ tests 24` · `ℹ pass 24` · `ℹ fail 0`.
(If the two CLI tests fail with `does not provide an export named 'evaluateFields'`, Task 1 is not merged into this branch yet — merge it first; nothing in this task works without it.)

- [ ] **Step 22: Commit**

```bash
git add tools/field-scale/check.mjs tools/field-scale/check.test.mjs && git commit -F - <<'EOF'
feat(tools): field-scale runner — Playwright on local:preview, report, compare mode

Measures every appendix ก screen + the 9 AddressForm hosts at 1440/1024/390 x light/dark with
__collectFields + evaluateFields, records the account-menu clip check (S2-01/S2-02) as rule MENU P1,
writes .tmp/field-scale/<label>/{results.json,report.md,*.png}; --compare exits 1 on new P1/P2, on any
MENU failure (even one already in the baseline), and on a baseline-rendered cell that is lost or emptied.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 23: Start (or restart) the local preview**

The preview fingerprints `apps/`, `packages/`, `tools/` (`tools/local-preview.mjs:22-32`), so the files just created make any running preview stale; `local:preview` restarts it.
Run: `npm run local:preview`
Expected: last lines `Started http://localhost:5195/inbox` (or `Reused http://localhost:5195/inbox`), `Workspace: D:\BESTCHOICE APP\BESTCHOICE`. A first Windows start boots the Docker database and can take up to 7 minutes. Then `npm run local:status` → JSON with `"running": true` and `"current": true`.

- [ ] **Step 24: Smoke-run one screen**

Run: `node tools/field-scale/check.mjs --label smoke --routes other-income-items,other-income-override --widths 1440 --themes light`
Expected output shape:
```
other-income-items 1440 light: rendered · facts <n> · findings <k> · account-menu-items-card FAIL
other-income-override 1440 light: rendered · facts <n> · findings <k> · account-menu-override-jv FAIL

open findings: … · allowed 0
menu probes: 0 pass · 2 fail
cells not fully measured: 0 · API errors without a mock: <m>
wrote D:\BESTCHOICE APP\BESTCHOICE\.tmp\field-scale\smoke\results.json and report.md
```
Then open `.tmp/field-scale/smoke/report.md`, section "เมนูบัญชีถูกตัด (S2-01 / S2-02)": both rows must be `FAIL` with a reason containing `ถูกตัดโดย` (item card: `<div class="rounded-lg border bg-card overflow-hidden">`; Override JV: the table's `overflow-x-auto` wrapper or ScreenTable's scroll viewport). This is the expected result on main — the defect is real (spec appendix ก S2-01/S2-02). If a reason says `probe error:` or `ไม่พบเมนูบัญชีหลังกดเปิด`, or a cell is `open-failed`, open the PNGs `.tmp/field-scale/smoke/other-income-*-1440-light*.png` and fix the locator in `tools/field-scale/routes.mjs` before going on (then repeat Steps 21-24; commit the fix with `fix(tools): field-scale <route> locator`).

- [ ] **Step 25: Run the baseline (main's UI)**

Run `npm run local:preview` first (Step 23 — any edit under `tools/` since then makes the preview stale and the runner exits 2). Then (takes roughly 10–40 minutes for 28 routes × 3 widths × 2 themes = 168 cells):
`mkdir -p .tmp/field-scale && node tools/field-scale/check.mjs --label baseline 2>&1 | tee .tmp/field-scale/baseline.log`
Expected: 168 progress lines, then
```
open findings: <N> (P1 <a> · P2 <b> · P3 <c>) · allowed 0
menu probes: 0 pass · 4 fail
cells not fully measured: <x> · API errors without a mock: <y>
wrote D:\BESTCHOICE APP\BESTCHOICE\.tmp\field-scale\baseline\results.json and report.md
```
`menu probes: 0 pass · 4 fail` (2 probes × 1440 × 2 themes) is the recorded proof of S2-01/S2-02 on main. The runner's own exit status: run `echo "exit=${PIPESTATUS[0]}"` as the very next command (a plain `echo $?` reports `tee`'s status) → `exit=0`.

Then prove the run is repeatable — the compare gate is only as good as two runs of the same UI agreeing. Run `node tools/field-scale/check.mjs --label det-a` and `--label det-b` (same preview, no source edits in between), then `node tools/field-scale/check.mjs --compare baseline det-a` and `--compare det-a det-b`. Expected for both: `New findings: 0`, `Fixed: 0`, no "Cells rendered … but not in …" and no "fact count fell" section, `MENU failures (account-menu probes — never accepted from the baseline): 4` with every line marked `[byte-identical to baseline: pre-existing S2-01/S2-02, fixed by Task 6]`, and exit 1 (`echo "exit=$?"` → `exit=1`) — the 4 MENU failures block on purpose until Task 6. Any other difference is nondeterminism in a route: fix it in `routes.mjs` (mock the data the screen reads, wait for the stable state in the open step), commit, and rerun this step from `npm run local:preview`.

- [ ] **Step 26: Check the baseline is usable**

Open `.tmp/field-scale/baseline/report.md` and confirm:
1. "ข้อพบตามกฎ" has a `MENU` row with P1 = 4.
2. "รายหน้า": every route has `cell` = 6; note every route whose `วัดได้` < 6.
3. "cell ที่วัดไม่ครบ": for each `open-failed` / `error` cell look at its PNG (`<route>-<width>-<theme>.png`). An `error` reason `landed on … instead of …` is a redirect (role menu, missing record), `error fallback visible: …` an error boundary, `no form fields measured (facts 0)` an empty screen — each means the screen the later tasks fix was not measured. An `open-failed` at 390 where the button is hidden in a mobile menu is acceptable (record it in the PR); an `open-failed`/`error` at 1440 or 1024 means a wrong locator or a missing mock — fix `routes.mjs` (add a `mock(/^\/path$/, <shape read from the page's code>)` for an endpoint in "API ที่ตอบ error" that blocks rendering), commit, rerun Steps 23 and 25.
4. `git status --short` shows nothing under `.tmp/` (gitignored, `.gitignore:23`).

- [ ] **Step 27: Put the baseline summary into the R1-1 PR description (not the repo)**

Do not commit anything from `.tmp/`. When the R1-1 PR is opened (not in this task — do not push), its description must contain a section "Baseline บน main (UI ยังไม่เปลี่ยน)" with: the header bullets of `.tmp/field-scale/baseline/report.md` (revision, widths, themes, open findings by severity), the tables "ข้อพบตามกฎ", "เมนูบัญชีถูกตัด (S2-01 / S2-02)" and "รายหน้า", the counts of "cell ที่วัดไม่ครบ" and "API ที่ตอบ error", plus the Windows note required by spec §8: "รันบน Windows: `node --test tools/field-scale/check.test.mjs` (24 pass), `npm run local:preview`, `node tools/field-scale/check.mjs --label baseline`; `npm run local:check` ไม่รองรับ Windows — ต้องรันบน Linux/CI". Also add the repeatability result of Step 25 (both compares: 0 new / 0 fixed, only the 4 byte-identical MENU failures, exit 1 by design until Task 6). Save that text now as `.tmp/field-scale/baseline/pr-summary.md` (gitignored) so the PR author can paste it. Later PRs prove "ไม่เพิ่มจาก baseline" with `npm run local:preview`, then `node tools/field-scale/check.mjs --label <pr-label>`, then `node tools/field-scale/check.mjs --compare baseline <pr-label>` (exit 0 = nothing blocks; a PR may also pass when the compare exits 1 and every blocking line is accepted under the compare triage rule in the cross-task notes, with each accepted finding and its evidence listed in the PR — never a lost/emptied cell, and a `MENU` line only before Task 6 and only when byte-identical to the baseline).

---

### Task 3: Primitives: 8px radius + 16px mobile font outside the shell (R1-2, §4.1, S3-23)

Spec: `docs/superpowers/specs/2026-11-14-dropdown-search-field-scale-design.md` §4.1 (rows "ตัวอักษรนอกหลังบ้าน" and "มุมโค้ง") and §4.2 item 1. Audit finding S3-23 (`docs/reports/field-scale-audit-2026-11-14/audit.json` id `S3-23`).

Background for a zero-context implementer:
- `rounded-lg` = `var(--radius)` = `0.5rem` = **8px** (`apps/web/src/index.css:131` and `:306`). `rounded-md` = 6px (`index.css:132`).
- Inside the back office (`body:has(.app-shell)`), `apps/web/src/styles/admin-typography.css` forces controls to 44px tall and 14px text (16px when the screen is under 1024px). It is imported outside any `@layer`, so it beats Tailwind utilities. It sets **no** `border-radius`, and its 14px rules skip inputs that carry `.text-lg`, `.text-xl`, `.text-2xl`, `.text-3xl`, `.text-4xl`, `.text-[18px]`, `.text-[20px]` or `.text-[24px]` (`admin-typography.css:35` and `:49` — deliberate large-amount inputs). So inside the shell this task changes the corner radius of normal fields, and outside the shell (LIFF, auth pages, public pages) the new `text-base lg:text-sm` on `Input` md becomes the real font size.
- **Caller font size is the exception (Steps 6a–6b).** tailwind-merge 3.6 merges only classes with the same variant prefix, so `cn('… text-base lg:text-sm …', 'text-2xl font-bold')` drops `text-base` but **keeps** `lg:text-sm`, which then wins at ≥ 1024px. Before this task a caller's size replaced `text-[0.8125rem]` completely. Without a fix, a caller's `text-xs` grows to 14px on desktop outside the shell, and a large input (e.g. the 18px emoji field `RichMenuPage.tsx:266`, `text-lg`) shrinks to 14px on desktop even **inside** the shell, because `admin-typography.css` deliberately leaves `.text-lg…` inputs alone. So `Input`, `InputWrapper` and `NumberInput` drop the variant's `lg:text-sm` when the caller's `className` carries a bare font-size utility (`withCallerFontSize`). The `inputVariants` md string itself and `formControlClass` do not change. A scan of `<Input>`/`<NumberInput>`/`<FormNumberInput>`/`<InputWrapper>` md call sites (no `variant`, not `unstyled`) found 15 `<Input>` sites whose literal `className` has a bare size: 7 `text-xs`, 6 `text-sm`, 1 `text-base` (`StockListTab.tsx:282`), 1 `text-lg` (`RichMenuPage.tsx:266`). Sites that pass `className` through a variable are not covered by that scan; the primitive fix covers them anyway.
- No existing test asserts `rounded-md`, `text-[0.8125rem]` or `h-[34px]`. A grep over every `*.test.*`/`*.spec.*` file under `apps/web` found nothing, so you only add one new test file.
- `InputGroup`/`InputWrapper` are not used anywhere outside `input.tsx` and `admin-typography.css`. Their corner rules (`[&_[data-slot=input-addon]:has(+[data-slot=input])]:rounded-r-none`, …) are parent-scoped selectors. They are more specific than a single `.rounded-lg` class, and `cn()`/tailwind-merge only merges classes on the same element. So they still square off the joined corners after `rounded-md` becomes `rounded-lg`, and they need no change.
- `SelectContent` (`select.tsx:123`, the dropdown menu panel) keeps `rounded-md` on purpose, because it is a menu, not a field.

**Files:**
- Modify: `apps/web/src/components/ui/input.tsx` lines 18–20 (`inputVariants`), lines 34–36 (`inputAddonVariants`), the import block, `Input` (original lines 109–116) and `InputWrapper` (original lines 131–143)
- Create: `apps/web/src/components/ui/caller-font-size.ts` (`callerSetsFontSize`, `withCallerFontSize`)
- Modify: `apps/web/src/components/ui/NumberInput.tsx` (import block and the `className` line, original line 86)
- Modify: `apps/web/src/components/ui/select.tsx` lines 54–56 (`selectTriggerVariants`)
- Modify: `apps/web/src/components/ui/textarea.tsx` lines 14–16 (`textareaVariants`)
- Modify: `DESIGN.md` lines 155–156 (§4.1 Radius)
- Modify: `docs/guides/form-field-qa.md` after line 5
- Create (test): `apps/web/src/components/ui/primitives-radius.test.tsx`
- Create (test): `apps/web/src/components/ui/caller-font-size.test.ts`
- Unchanged but verified: `apps/web/src/components/ui/form-styles.ts`. The `formControlClass` output stays the same: with tailwind-merge 3.6.0 it ends in `… px-3 file:pr-3 file:mr-3 h-11 min-h-11 min-w-0 rounded-lg py-2 text-base font-normal leading-normal lg:text-sm`.

**Interfaces:**
- Consumes: nothing from other tasks. This task is independent of Tasks 1–2 and can run in parallel with them.
- Produces (later tasks rely on this):
  - `inputVariants` variant `md` = `'h-[34px] px-3 text-base lg:text-sm leading-snug rounded-lg file:pr-3 file:mr-3'`. Variants `lg`/`sm` use `rounded-lg`, and their font sizes are unchanged.
  - `inputAddonVariants` `sm`/`md`/`lg` use `rounded-lg`. Font sizes are unchanged.
  - `selectTriggerVariants` `sm`/`md`/`lg` use `rounded-lg`. Font sizes are unchanged.
  - `textareaVariants` `sm`/`md`/`lg` use `rounded-lg`. Font sizes are unchanged.
  - `ReadOnlyField` (wraps `<Input readOnly>`), `NumberInput` and `formControlClass` all build on `inputVariants`, so they get the 8px radius and the mobile-safe font automatically.
  - Behaviour: `Input`, `InputWrapper` and `NumberInput` (not `unstyled`) render `cn(withCallerFontSize(inputVariants({ variant }), className), …, className)`. With no `className`, or one without a bare font-size utility, the classes are exactly as before. With a bare size (`text-xs|2xs|2sm|sm|base|lg|xl|2xl…9xl`, optional `/line-height` or `!`, or `text-[<length>]`), the variant's `lg:text-sm` is dropped so the caller's size holds at every width. Colour/alignment classes (`text-muted-foreground`, `text-primary`, `text-[hsl(…)]`, `text-[#…]`, `text-right`) and prefixed sizes (`lg:text-2xl`) do not count. `className={formControlClass}` still renders exactly `cn(inputVariants(), formControlClass)`, because `formControlClass` carries its own `lg:text-sm`.
  - `callerSetsFontSize(className?: string | null): boolean` and `withCallerFontSize(variantClasses: string, className?: string | null): string` are exported from `apps/web/src/components/ui/caller-font-size.ts`. Any later component that renders `inputVariants` md together with a caller `className` without going through `Input` must use `withCallerFontSize` the same way.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/ui/primitives-radius.test.tsx` with exactly this content:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input, InputAddon, InputWrapper, inputVariants } from './input';
import { NumberInput } from './NumberInput';
import { Select, SelectTrigger, SelectValue } from './select';
import { Textarea } from './textarea';
import { formControlClass } from './form-styles';
import { cn } from '@/lib/utils';

const SIZES = ['sm', 'md', 'lg'] as const;

// Spec 2026-11-14 §4.1: every form primitive uses the 8px radius (rounded-lg = var(--radius)).
describe('form primitives — 8px radius (§4.1)', () => {
  it.each(SIZES)('Input variant %s ใช้ rounded-lg', (variant) => {
    render(<Input aria-label="ชื่อ" variant={variant} />);
    const input = screen.getByRole('textbox', { name: 'ชื่อ' });
    expect(input).toHaveClass('rounded-lg');
    expect(input).not.toHaveClass('rounded-md');
  });

  it.each(SIZES)('InputAddon variant %s ใช้ rounded-lg', (variant) => {
    render(
      <InputAddon data-testid="addon" variant={variant}>
        บาท
      </InputAddon>,
    );
    const addon = screen.getByTestId('addon');
    expect(addon).toHaveClass('rounded-lg');
    expect(addon).not.toHaveClass('rounded-md');
  });

  it.each(SIZES)('SelectTrigger size %s ใช้ rounded-lg', (size) => {
    render(
      <Select>
        <SelectTrigger aria-label="สาขา" size={size}>
          <SelectValue placeholder="เลือกสาขา" />
        </SelectTrigger>
      </Select>,
    );
    const trigger = screen.getByRole('combobox', { name: 'สาขา' });
    expect(trigger).toHaveClass('rounded-lg');
    expect(trigger).not.toHaveClass('rounded-md');
  });

  it.each(SIZES)('Textarea variant %s ใช้ rounded-lg', (variant) => {
    render(<Textarea aria-label="หมายเหตุ" variant={variant} />);
    const textarea = screen.getByRole('textbox', { name: 'หมายเหตุ' });
    expect(textarea).toHaveClass('rounded-lg');
    expect(textarea).not.toHaveClass('rounded-md');
  });
});

// S3-23: outside .app-shell the global 14/16px rule does not apply, so the primitive itself
// must be 16px below lg (iOS Safari zooms into inputs smaller than 16px).
describe('Input md — 16px below lg outside the app shell (S3-23)', () => {
  it('Input ค่าตั้งต้นใช้ text-base และ lg:text-sm แทน 13px', () => {
    render(<Input aria-label="อีเมล" />);
    const input = screen.getByRole('textbox', { name: 'อีเมล' });
    expect(input).toHaveClass('text-base', 'lg:text-sm', 'leading-snug');
    expect(input).not.toHaveClass('text-[0.8125rem]');
  });

  it('formControlClass (สร้างจาก inputVariants) ยังมีมุมและตัวอักษรชุดเดียว', () => {
    const classes = formControlClass.split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining(['rounded-lg', 'text-base', 'lg:text-sm', 'h-11']),
    );
    expect(classes).not.toContain('rounded-md');
    expect(classes.filter((c) => /^text-(base|sm|xs|\[)/.test(c))).toEqual(['text-base']);
  });
});

// tailwind-merge keeps `lg:text-sm` next to a bare caller size (`text-2xl`), so on >= 1024px
// the variant's 14px would beat the caller's own size. admin-typography.css leaves
// .text-lg/.text-xl/.text-2xl… inputs alone, so inside the shell nothing else fixes it.
describe('Input md — caller font size wins at every width', () => {
  it('Input className="text-2xl" ไม่มี lg:text-sm ของ variant', () => {
    render(<Input aria-label="ยอดเงิน" className="text-2xl font-bold" />);
    const input = screen.getByRole('textbox', { name: 'ยอดเงิน' });
    expect(input).toHaveClass('text-2xl');
    expect(input).not.toHaveClass('lg:text-sm');
    expect(input).not.toHaveClass('text-base');
  });

  it('Input className="text-xs" ไม่ขยายเป็น 14px บนจอใหญ่', () => {
    render(<Input aria-label="รหัส" className="text-xs" />);
    expect(screen.getByRole('textbox', { name: 'รหัส' })).not.toHaveClass('lg:text-sm');
  });

  it('Input ค่าตั้งต้นยังเป็น text-base lg:text-sm', () => {
    render(<Input aria-label="อีเมล" />);
    expect(screen.getByRole('textbox', { name: 'อีเมล' })).toHaveClass('text-base', 'lg:text-sm');
  });

  it('className สี (text-muted-foreground) ไม่ตัด lg:text-sm', () => {
    render(<Input aria-label="หมายเหตุ" className="text-muted-foreground" />);
    expect(screen.getByRole('textbox', { name: 'หมายเหตุ' })).toHaveClass(
      'text-base',
      'lg:text-sm',
      'text-muted-foreground',
    );
  });

  it('Input className={formControlClass} ได้คลาสเท่าเดิมทุกตัวอักษร', () => {
    render(<Input aria-label="ชื่อร้าน" className={formControlClass} />);
    const input = screen.getByRole('textbox', { name: 'ชื่อร้าน' });
    expect(input.className).toBe(cn(inputVariants(), formControlClass));
    expect(input).toHaveClass('text-base', 'lg:text-sm');
  });

  it('NumberInput className="text-2xl" ไม่มี lg:text-sm ของ variant', () => {
    render(<NumberInput aria-label="รับเงิน" className="text-2xl" />);
    const input = screen.getByRole('spinbutton', { name: 'รับเงิน' });
    expect(input).toHaveClass('text-2xl');
    expect(input).not.toHaveClass('lg:text-sm');
  });

  it('NumberInput ค่าตั้งต้นยังเป็น text-base lg:text-sm', () => {
    render(<NumberInput aria-label="จำนวน" />);
    expect(screen.getByRole('spinbutton', { name: 'จำนวน' })).toHaveClass('text-base', 'lg:text-sm');
  });

  it('InputWrapper className="text-lg" ไม่มี lg:text-sm ของ variant', () => {
    render(<InputWrapper data-testid="wrapper" className="text-lg" />);
    const wrapper = screen.getByTestId('wrapper');
    expect(wrapper).toHaveClass('text-lg');
    expect(wrapper).not.toHaveClass('lg:text-sm');
  });
});
```

Create `apps/web/src/components/ui/caller-font-size.test.ts` with exactly this content:

```ts
import { describe, it, expect } from 'vitest';
import { callerSetsFontSize, withCallerFontSize } from './caller-font-size';
import { inputVariants } from './input';
import { formControlClass } from './form-styles';

// Input md is `text-base lg:text-sm`. tailwind-merge does not treat a bare caller size
// (`text-2xl`) and the responsive `lg:text-sm` as a conflict, so the variant's 14px
// would win at >= 1024px over the caller's own size. These helpers detect a caller size.
describe('callerSetsFontSize', () => {
  it.each([
    'text-2xs',
    'text-xs',
    'text-2sm',
    'text-sm',
    'text-base',
    'text-lg',
    'text-xl',
    'text-2xl',
    'text-5xl',
    'text-9xl',
    'text-lg/7',
    'text-xl!',
    '!text-xl',
    'tabular-nums text-right text-2xl font-bold',
  ])('ขนาดตัวอักษร "%s" = ผู้เรียกกำหนดขนาดเอง', (className) => {
    expect(callerSetsFontSize(className)).toBe(true);
  });

  it.each([
    'text-[13px]',
    'text-[0.8125rem]',
    'text-[1.5em]',
    'text-[length:var(--field-size)]',
    'text-[clamp(1rem,2vw,1.5rem)]',
  ])('ขนาดแบบ arbitrary length "%s" = ผู้เรียกกำหนดขนาดเอง', (className) => {
    expect(callerSetsFontSize(className)).toBe(true);
  });

  it.each([
    'text-muted-foreground',
    'text-primary',
    'text-foreground',
    'text-destructive',
    'text-warning-strong',
    'text-[hsl(var(--primary))]',
    'text-[#1e3a5f]',
    'text-[var(--brand)]',
    'text-[color:var(--brand)]',
    'text-right text-center text-left',
    'text-ellipsis text-nowrap text-wrap',
    'lg:text-2xl',
    'md:text-base sm:text-lg',
    'h-11 w-full rounded-lg',
    '',
  ])('สี/จัดแนว/ขนาดตามจอ "%s" ไม่นับเป็นขนาดของผู้เรียก', (className) => {
    expect(callerSetsFontSize(className)).toBe(false);
  });

  it('ไม่มี className = false', () => {
    expect(callerSetsFontSize(undefined)).toBe(false);
    expect(callerSetsFontSize(null)).toBe(false);
  });

  it('formControlClass มี text-base จึงนับเป็นขนาดของผู้เรียก', () => {
    expect(callerSetsFontSize(formControlClass)).toBe(true);
  });
});

describe('withCallerFontSize', () => {
  const md = inputVariants();

  it('ไม่มีขนาดของผู้เรียก = คืนคลาสของ variant เหมือนเดิมทุกตัวอักษร', () => {
    expect(withCallerFontSize(md, undefined)).toBe(md);
    expect(withCallerFontSize(md, 'text-muted-foreground')).toBe(md);
  });

  it('ผู้เรียกกำหนดขนาด = ตัด lg:text-sm ของ variant ออก (ส่วนอื่นคงเดิม)', () => {
    const out = withCallerFontSize(md, 'text-2xl');
    expect(out.split(/\s+/)).not.toContain('lg:text-sm');
    expect(out.split(/\s+/)).toEqual(md.split(/\s+/).filter((c) => c && c !== 'lg:text-sm'));
  });

  it('formControlClass: ผลลัพธ์รวมยังมี lg:text-sm ของ formControlClass เอง', () => {
    const merged = withCallerFontSize(md, formControlClass) + ' ' + formControlClass;
    expect(merged.split(/\s+/)).toContain('lg:text-sm');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

From the repo root in Git Bash:

```bash
npm run test --workspace=apps/web -- src/components/ui/primitives-radius.test.tsx src/components/ui/caller-font-size.test.ts
```

Expected: the run FAILS. `caller-font-size.test.ts` cannot load (its module is created in Step 6a). In `primitives-radius.test.tsx` the `formControlClass` test already passes, because it guards against regressions rather than driving the change. The caller-font-size component tests that assert "no `lg:text-sm`" and the `formControlClass` identity also pass now, because the old md variant has no `lg:text-sm`; they start failing after Step 3 and pass again after Step 6b (Step 3 alone gives `4 failed` there). The output includes:

```
 FAIL  src/components/ui/caller-font-size.test.ts [ src/components/ui/caller-font-size.test.ts ]
Error: Failed to resolve import "./caller-font-size" from "src/components/ui/caller-font-size.test.ts". Does the file exist?
...
 FAIL  src/components/ui/primitives-radius.test.tsx > form primitives — 8px radius (§4.1) > Input variant sm ใช้ rounded-lg
Error: expect(element).toHaveClass("rounded-lg")

Expected the element to have class:
  rounded-lg
Received:
  flex w-full bg-background border border-input ... rounded-md ...
...
 FAIL  ... > Input md — 16px below lg outside the app shell (S3-23) > Input ค่าตั้งต้นใช้ text-base และ lg:text-sm แทน 13px
Error: expect(element).toHaveClass("text-base lg:text-sm leading-snug")
...
 FAIL  ... > Input md — caller font size wins at every width > NumberInput ค่าตั้งต้นยังเป็น text-base lg:text-sm
Error: expect(element).toHaveClass("text-base lg:text-sm")
...
 Test Files  2 failed (2)
      Tests  16 failed | 6 passed (22)
```

- [ ] **Step 3: Change `inputVariants` in `apps/web/src/components/ui/input.tsx`**

Replace lines 18–20:

```ts
        lg: 'h-10 px-4 text-sm leading-snug rounded-md file:pr-4 file:mr-4',
        md: 'h-[34px] px-3 text-[0.8125rem] leading-snug rounded-md file:pr-3 file:mr-3',
        sm: 'h-7 px-2.5 text-xs leading-snug rounded-md file:pr-2.5 file:mr-2.5',
```

with:

```ts
        lg: 'h-10 px-4 text-sm leading-snug rounded-lg file:pr-4 file:mr-4',
        // S3-23: 16px below lg so iOS Safari does not zoom on focus outside the app shell
        // (LIFF, auth pages, public pages). Inside .app-shell admin-typography.css sets 14px,
        // except on .text-lg/.text-xl/… inputs. A caller's own size drops lg:text-sm
        // (withCallerFontSize in Input/InputWrapper/NumberInput).
        md: 'h-[34px] px-3 text-base lg:text-sm leading-snug rounded-lg file:pr-3 file:mr-3',
        sm: 'h-7 px-2.5 text-xs leading-snug rounded-lg file:pr-2.5 file:mr-2.5',
```

Keep `leading-snug` **after** `text-base`. tailwind-merge drops a `leading-*` class that comes before a font-size class, and Thai text must stay `leading-snug`.

- [ ] **Step 4: Change `inputAddonVariants` in the same file**

Replace the original lines 34–36. After Step 3 added four comment lines, they are now lines 38–40:

```ts
        sm: 'rounded-md h-7 min-w-[28px] text-xs leading-snug px-2.5 [&_svg:not([class*=size-])]:size-3.5',
        md: 'rounded-md h-[34px] min-w-[34px] px-3 text-[0.8125rem] leading-snug [&_svg:not([class*=size-])]:size-[18px]',
        lg: 'rounded-md h-10 min-w-[40px] px-4 text-sm leading-snug [&_svg:not([class*=size-])]:size-[18px]',
```

with:

```ts
        sm: 'rounded-lg h-7 min-w-[28px] text-xs leading-snug px-2.5 [&_svg:not([class*=size-])]:size-3.5',
        md: 'rounded-lg h-[34px] min-w-[34px] px-3 text-[0.8125rem] leading-snug [&_svg:not([class*=size-])]:size-[18px]',
        lg: 'rounded-lg h-10 min-w-[40px] px-4 text-sm leading-snug [&_svg:not([class*=size-])]:size-[18px]',
```

Leave `inputGroupVariants` (original lines 50–67) unchanged. Its `rounded-r-none`/`rounded-l-none` rules are parent-scoped, so they override `rounded-lg` the same way they overrode `rounded-md`.

- [ ] **Step 5: Change `selectTriggerVariants` in `apps/web/src/components/ui/select.tsx`**

Replace lines 54–56:

```ts
        sm: 'h-7 px-2.5 text-xs leading-snug gap-1 rounded-md',
        md: 'h-[34px] px-3 text-[0.8125rem] leading-snug gap-1 rounded-md',
        lg: 'h-10 px-4 text-sm leading-snug gap-1.5 rounded-md',
```

with:

```ts
        sm: 'h-7 px-2.5 text-xs leading-snug gap-1 rounded-lg',
        md: 'h-[34px] px-3 text-[0.8125rem] leading-snug gap-1 rounded-lg',
        lg: 'h-10 px-4 text-sm leading-snug gap-1.5 rounded-lg',
```

Do **not** touch the `rounded-md` in `SelectContent` (line 123). That is the menu panel.

- [ ] **Step 6: Change `textareaVariants` in `apps/web/src/components/ui/textarea.tsx`**

Replace lines 14–16:

```ts
        sm: 'px-2.5 py-2.5 text-xs rounded-md',
        md: 'px-3 py-3 text-sm rounded-md',
        lg: 'px-4 py-4 text-sm rounded-md',
```

with:

```ts
        sm: 'px-2.5 py-2.5 text-xs rounded-lg',
        md: 'px-3 py-3 text-sm rounded-lg',
        lg: 'px-4 py-4 text-sm rounded-lg',
```

- [ ] **Step 6a: Create `apps/web/src/components/ui/caller-font-size.ts`**

Create the file with exactly this content:

```ts
// Input md is `text-base lg:text-sm` (16px below lg so iOS Safari does not zoom, S3-23).
// tailwind-merge only merges classes with the same variant prefix, so a bare caller size
// such as `text-2xl` replaces `text-base` but keeps `lg:text-sm`, and the variant's 14px
// would win at >= 1024px. When the caller sets its own size, drop the variant's
// responsive size so the caller's size holds at every width.

/** Bare theme sizes, including this app's `2xs`/`2sm`; optional `/line-height` and `!`. */
const THEME_SIZE = /^!?text-(?:2xs|xs|2sm|sm|base|lg|xl|[2-9]xl)(?:\/[^\s!]+)?!?$/;
/** `text-[13px]`, `text-[0.8125rem]`, `text-[length:…]`, `text-[clamp(…)]` — not colours. */
const ARBITRARY_SIZE =
  /^!?text-\[(?:length:[^\]]+|-?\d*\.?\d+(?:px|rem|em|%|vw|vh|vmin|vmax|svh|dvh|lvh|ch|ex|pt|pc|cm|mm|in|lh|rlh|cqw|cqh)|(?:calc|clamp|min|max)\([^\]]*\))\](?:\/[^\s!]+)?!?$/;

/** The variant classes this helper may drop. Only Input md carries one today. */
const RESPONSIVE_VARIANT_SIZES = new Set(['lg:text-sm']);

/** True when `className` has an unprefixed font-size utility (colour classes do not count). */
export function callerSetsFontSize(className?: string | null): boolean {
  if (!className) return false;
  return className
    .split(/\s+/)
    .some((token) => THEME_SIZE.test(token) || ARBITRARY_SIZE.test(token));
}

/**
 * `variantClasses` unchanged, or without its responsive font size when the caller
 * sets its own size. Use as `cn(withCallerFontSize(inputVariants({ variant }), className), className)`.
 */
export function withCallerFontSize(variantClasses: string, className?: string | null): string {
  if (!callerSetsFontSize(className)) return variantClasses;
  return variantClasses
    .split(/\s+/)
    .filter((token) => token && !RESPONSIVE_VARIANT_SIZES.has(token))
    .join(' ');
}
```

`RESPONSIVE_VARIANT_SIZES` lists the only responsive font size a variant carries today (Input md). Keep `inputVariants` md as it is: `formControlClass`, `appointmentControlClass` and later tasks depend on that exact string.

- [ ] **Step 6b: Use it in `Input`, `InputWrapper` and `NumberInput`**

In `apps/web/src/components/ui/input.tsx`, add this import after the `class-variance-authority` import (line 3):

```ts
import { withCallerFontSize } from './caller-font-size';
```

Replace the `Input` body (original line 115):

```tsx
  return <input data-slot="input" type={type} className={cn(inputVariants({ variant }), className)} {...props} />;
```

with:

```tsx
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(withCallerFontSize(inputVariants({ variant }), className), className)}
      {...props}
    />
  );
```

In `InputWrapper`, replace:

```tsx
      className={cn(inputVariants({ variant }), inputWrapperVariants({ variant }), className)}
```

with:

```tsx
      className={cn(
        withCallerFontSize(inputVariants({ variant }), className),
        inputWrapperVariants({ variant }),
        className,
      )}
```

In `apps/web/src/components/ui/NumberInput.tsx`, add `import { withCallerFontSize } from './caller-font-size';` after `import { inputVariants } from './input';`, and replace:

```tsx
        className={cn(!unstyled && inputVariants({ variant }), 'tabular-nums', className)}
```

with:

```tsx
        className={cn(!unstyled && withCallerFontSize(inputVariants({ variant }), className), 'tabular-nums', className)}
```

`FormNumberInput` renders `NumberInput`, so it is covered. `formControlClass` (`form-styles.ts`) and `appointmentControlClass` (`components/appointments/field-styles.ts`) are fixed class strings that already end in `lg:text-sm`; they need no change.

- [ ] **Step 7: Run the new tests and see them pass**

```bash
npm run test --workspace=apps/web -- src/components/ui/primitives-radius.test.tsx src/components/ui/caller-font-size.test.ts
```

Expected:

```
 Test Files  2 passed (2)
      Tests  61 passed (61)
```

- [ ] **Step 8: Run the neighbouring primitive tests (regression)**

```bash
npm run test --workspace=apps/web -- src/components/ui
```

Expected: every test file passes, with 0 failed. If no other task has added ui tests yet, that is `Test Files  10 passed (10)`: the 8 existing ui test files plus the two new ones. A higher count is fine as long as nothing fails. NumberInput, NativeSelect, form, SearchableSelect and NameAutocomplete all render `inputVariants`/`formControlClass`.

- [ ] **Step 9: Type check and lint**

```bash
bash tools/check-types.sh web
cd apps/web && npx eslint src/components/ui/input.tsx src/components/ui/select.tsx src/components/ui/textarea.tsx src/components/ui/NumberInput.tsx src/components/ui/caller-font-size.ts src/components/ui/caller-font-size.test.ts src/components/ui/primitives-radius.test.tsx; cd ../..
```

Expected:
- The first command ends with `Web: OK`.
- The eslint command prints nothing and exits 0.

Running the full `npm run lint --workspace=apps/web` instead is also fine, as long as it reports no new errors.

- [ ] **Step 10: Commit the code change**

```bash
git add apps/web/src/components/ui/input.tsx apps/web/src/components/ui/select.tsx apps/web/src/components/ui/textarea.tsx apps/web/src/components/ui/NumberInput.tsx apps/web/src/components/ui/caller-font-size.ts apps/web/src/components/ui/caller-font-size.test.ts apps/web/src/components/ui/primitives-radius.test.tsx && git commit -m "$(cat <<'EOF'
fix(web): ตัวกลางช่องกรอกมุม 8px + ตัวอักษร 16px บนมือถือนอก app shell (S3-23)

Input / InputAddon / SelectTrigger / Textarea: rounded-md -> rounded-lg ทุก variant (spec 2026-11-14 §4.1)
Input md: text-[0.8125rem] -> text-base lg:text-sm (iPhone ไม่ซูมเมื่อแตะช่องนอกหลังบ้าน)
ขนาดตัวอักษรที่ผู้เรียกใส่เองใน className ตัด lg:text-sm ของ variant (withCallerFontSize — Input/InputWrapper/NumberInput)
ภายใน .app-shell ขนาดตัวอักษร/ความสูงยังมาจาก admin-typography.css เหมือนเดิม

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 11: Update `DESIGN.md` §4.1 Radius**

Replace lines 155–156:

```md
- `rounded-md` — 6px (inputs, small buttons)
- `rounded-lg` — 8px (cards, buttons — **default**)
```

with:

```md
- `rounded-md` — 6px (small buttons, menu panels)
- `rounded-lg` — 8px (cards, buttons, **all form fields** — `Input`, `SelectTrigger`, `Textarea`, `NativeSelect`/`formControlClass`, `NumberInput` — **default**)
```

- [ ] **Step 12: Add one line to `docs/guides/form-field-qa.md`**

Line 5 is the paragraph that starts with `มาตรฐานช่องกรอกและตัวกรองใน app shell อยู่ที่`. After it, insert a blank line and then this paragraph:

```md
ตัวกลาง `Input` / `SelectTrigger` / `Textarea` ใช้มุม 8 px (`rounded-lg`) ทุก variant และ `Input` ค่าตั้งต้น (`md`) ใช้ตัวอักษร 16 px บนจอ < 1024 px / 14 px จอใหญ่ (`text-base lg:text-sm`) จึงไม่ซูมบน iPhone แม้อยู่นอก app shell (LIFF, หน้าเข้าสู่ระบบ, หน้าสาธารณะ) (spec 2026-11-14 §4.1, S3-23) — ยกเว้นเมื่อผู้เรียกใส่ขนาดตัวอักษรเองใน `className` (เช่น `text-lg`, `text-xs`, `text-[13px]`; คลาสสีอย่าง `text-muted-foreground` ไม่นับ): `Input` / `NumberInput` / `InputWrapper` ตัด `lg:text-sm` ของ variant ออก (`withCallerFontSize` ใน `components/ui/caller-font-size.ts`) ขนาดของผู้เรียกจึงใช้ทุกความกว้างจอ — ภายใน app shell ช่องที่ไม่ใช่ขนาดใหญ่ (`text-lg` ขึ้นไป) ยังถูก `admin-typography.css` ตั้ง 14 px ตามเดิม
```

- [ ] **Step 13: Commit the docs**

```bash
git add DESIGN.md docs/guides/form-field-qa.md && git commit -m "$(cat <<'EOF'
docs: มุมช่องกรอก 8px + ตัวอักษร Input 16px บนมือถือ (DESIGN §4.1, form-field-qa)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 14: Manual check in the preview (390 and 1440, outside and inside the shell)**

1. **Start the preview.** From the repo root, run `npm run local:preview`. Wait until it prints `Started http://localhost:5195/inbox` (or `Reused …`).

2. **Check a page outside the shell.**
   - Use `/forgot-password`. It is a public route with no auth redirect (`apps/web/src/App.tsx:296`). It renders `AuthLayout` with no `.app-shell` and `<Input id="email" className={formControlClass}>` (`ForgotPasswordPage.tsx:72-74`).
   - Do **not** use `/login` in the preview session. `App.tsx:286` redirects signed-in users away from it. It only works in a signed-out or fresh browser context.
   - Tool options: Playwright MCP (`browser_resize` 390×844, then `browser_navigate` to `http://localhost:5195/forgot-password`, then `browser_evaluate`), or Chrome DevTools device mode at 390px with the Console.
   - Evaluate:

   ```js
   () => {
     const i = document.querySelector('#email');
     if (!i) return { error: 'no #email — check the URL is /forgot-password' };
     const s = getComputedStyle(i);
     return { shell: !!document.querySelector('.app-shell'), fontSize: s.fontSize, radius: s.borderTopLeftRadius, height: s.height };
   }
   ```

   - Expected at 390: `{ shell: false, fontSize: '16px', radius: '8px', height: '44px' }`.
   - Then resize to 1440×900 and evaluate again. Expected: `fontSize: '14px'` and `radius: '8px'`.

3. **Check inside the shell for regressions.** At 390×844, open `http://localhost:5195/inbox` and evaluate:

   ```js
   () => [...document.querySelectorAll('[data-slot=input],[data-slot=select-trigger],[data-slot=textarea]')]
     .filter((e) => e.offsetParent)
     .map((e) => ({ slot: e.dataset.slot, fontSize: getComputedStyle(e).fontSize, radius: getComputedStyle(e).borderTopLeftRadius, ownRounded: (e.className.match(/(?:^|\s)rounded-\S+/g) || []).join(' ') }))
   ```

   Expected:
   - Every entry whose `ownRounded` is `rounded-lg` shows `radius: '8px'`.
   - Any entry with a different radius must carry a caller-supplied `rounded-*` class other than `-lg`. Note these entries but do not fix them here; they are out of scope.
   - Input and select-trigger `fontSize` is `'16px'` at 390 and `'14px'` after resizing to 1440, the same as before this task.

4. **Screenshots (optional).** Take 390px screenshots of `/forgot-password` and `/inbox` for the PR (`browser_take_screenshot`).

5. **Stop the preview.** Run `node tools/local-preview.mjs stop`.

---

### Task 4: ReadOnlyField + LabeledField components (R1-2, §4.2 items 2-3)

Two new shared field primitives. **No call site is migrated in this task** (appendix ก migrations happen in R1-3). Spec: `docs/superpowers/specs/2026-11-14-dropdown-search-field-scale-design.md` §4.1 row "ค่าอ่านอย่างเดียว", §4.2 items 2 and 3.

**Files:**
- Create: `apps/web/src/components/ui/readonly-field.tsx`
- Create: `apps/web/src/components/ui/readonly-field.test.tsx`
- Create: `apps/web/src/components/ui/labeled-field.tsx`
- Create: `apps/web/src/components/ui/labeled-field.test.tsx`
- Read only (no edits): `apps/web/src/components/ui/input.tsx:6-32` (`inputVariants`, note line 11 `[[readonly]]:bg-muted/80 [[readonly]]:cursor-not-allowed`), `apps/web/src/components/ui/input.tsx:114-128` (`Input`, spreads `...props` after `data-slot="input"`, so our `data-slot` wins; a caller `className` with a bare font size drops the variant's `lg:text-sm` — Task 3 Step 6b), `apps/web/src/components/ui/form-styles.ts:5-8` (`formControlClass`), `apps/web/src/components/ui/form-styles.ts:13` (`formLabelClass`), `apps/web/src/lib/utils.ts` (`cn` = `twMerge(clsx(...))`).

**Interfaces:**
- Consumes:
  - `Input` from `apps/web/src/components/ui/input.tsx`
  - `formControlClass`, `formLabelClass` from `apps/web/src/components/ui/form-styles.ts`
  - `cn` from `@/lib/utils`
  - Colour tokens that already exist: `--color-success` (`index.css:86`, `admin-colors.css:59`), `--color-warning` (`index.css:93`), `--color-warning-strong` (`index.css:96`, `admin-colors.css:63`). Same pairs the current fake box uses at `components/expense-form-v4/AdjustmentSection.tsx:146-148` (`bg-success/10 text-success`, `bg-warning/10 text-warning-strong`). `text-warning` is never used as a text colour (frontend.md rule).
- Produces (shared contract — later tasks use these exact names):
  - `ReadOnlyField` and `type ReadOnlyFieldProps` from `apps/web/src/components/ui/readonly-field.tsx`:
    `Omit<React.ComponentProps<'input'>, 'readOnly' | 'onChange' | 'type' | 'value' | 'defaultValue'> & { value: string | number; align?: 'start' | 'end'; tone?: 'default' | 'success' | 'warning' }` (the contract's `React.ReactNode extends never ? never : string | number` evaluates to `string | number`; `value`/`defaultValue` are also omitted from the base so the only value is ours).
    Renders `<Input readOnly tabIndex={-1} data-slot="readonly-field" value={String(value)} />` with classes `cn(formControlClass, 'bg-muted/80 [[readonly]]:cursor-default', align==='end' && 'text-right tabular-nums', TONE_CLASS[tone], className)`.
    **Tone classes (final):** `default` → none (keeps `[[readonly]]:bg-muted/80` + `text-foreground`); `success` → `[[readonly]]:bg-success/10 text-success`; `warning` → `[[readonly]]:bg-warning/10 text-warning-strong`.
    Why the `[[readonly]]:` prefix: Tailwind 4 compiles `[[readonly]]:x` to `.x:is([readonly])` (specificity 0,2,0), which beats a plain `bg-*`/`cursor-*` utility (0,1,0). tailwind-merge treats `[[readonly]]:` as a modifier, so `[[readonly]]:bg-success/10` replaces `[[readonly]]:bg-muted/80` and `[[readonly]]:cursor-default` replaces `[[readonly]]:cursor-not-allowed`. (Checked with `node -e` against the installed tailwind-merge: output `bg-muted/80 [[readonly]]:cursor-default [[readonly]]:bg-success/10 text-success`.)
  - `LabeledField`, `type LabeledFieldProps`, `labeledFieldIds` from `apps/web/src/components/ui/labeled-field.tsx`:
    props `{ label: React.ReactNode; htmlFor: string; required?: boolean; hint?: React.ReactNode; error?: React.ReactNode; className?: string; children: React.ReactNode }`.
    `labeledFieldIds(htmlFor)` → `{ labelId: `${htmlFor}-label`, hintId: `${htmlFor}-hint`, errorId: `${htmlFor}-error` }`. This is how a `Combobox` (Task for R2) gets the label id for `aria-labelledby` (spec §4.2 item 3 "คืน labelId").
    Renders `<div data-slot="labeled-field">` → `<label id={labelId} htmlFor={htmlFor} className={formLabelClass}>` (+ `<span aria-hidden="true" className="ml-0.5 text-destructive">*</span>` when `required`) → the child → optional `<p id={hintId}>` → optional `<p id={errorId} role="alert" className="… text-destructive">`.
    When the child is a single React element (not a Fragment), it is cloned with `aria-describedby` = existing ids + hint id + error id, `aria-invalid={true}` when `error`, `aria-required={true}` when `required`.
    Required marker follows the existing codebase pattern `components/expense-templates/RecurringBillDialog.tsx:273` (`aria-hidden` red asterisk). No sr-only "จำเป็น" text: it would become part of the label's accessible name (spec §6.1 says the name must be the label only, and existing tests query `getByRole('combobox', { name: 'สาขา' })`); required-ness reaches assistive tech through `aria-required` on the control instead.

- [ ] **Step 1: Write the failing ReadOnlyField test**

Create `apps/web/src/components/ui/readonly-field.test.tsx` with exactly:

```tsx
import { createRef } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReadOnlyField } from './readonly-field';

describe('ReadOnlyField', () => {
  it('renders a read-only, unfocusable input that a <label htmlFor> can name', () => {
    render(
      <>
        <label htmlFor="vat">VAT %</label>
        <ReadOnlyField id="vat" value={7} />
      </>,
    );
    const field = screen.getByLabelText('VAT %');
    expect(field.tagName).toBe('INPUT');
    expect(field).toHaveAttribute('readonly');
    expect(field).toHaveAttribute('tabindex', '-1');
    expect(field).toHaveAttribute('data-slot', 'readonly-field');
    expect(field).toHaveValue('7');
  });

  it('uses the shared 44px form-control classes with the read-only surface', () => {
    render(<ReadOnlyField aria-label="ยอดสุทธิ" value="1,234.00" />);
    const field = screen.getByRole('textbox', { name: 'ยอดสุทธิ' });
    for (const cls of [
      'h-11',
      'min-h-11',
      'rounded-lg',
      'text-base',
      'lg:text-sm',
      'leading-normal',
      'border-input',
      'bg-muted/80',
      '[[readonly]]:bg-muted/80',
      '[[readonly]]:cursor-default',
      'text-foreground',
    ]) {
      expect(field).toHaveClass(cls);
    }
    expect(field).not.toHaveClass('[[readonly]]:cursor-not-allowed');
    expect(field).not.toHaveClass('text-right');
    expect(field).toHaveValue('1,234.00');
  });

  it('right-aligns numbers with tabular figures when align="end"', () => {
    render(<ReadOnlyField aria-label="ก่อนภาษี" value="500.00" align="end" />);
    expect(screen.getByRole('textbox', { name: 'ก่อนภาษี' })).toHaveClass('text-right', 'tabular-nums');
  });

  it('keeps status colours through tone, overriding the read-only background', () => {
    render(
      <>
        <ReadOnlyField aria-label="จ่ายเกิน" value="+10.00" tone="success" />
        <ReadOnlyField aria-label="จ่ายน้อย" value="-10.00" tone="warning" />
      </>,
    );
    const success = screen.getByRole('textbox', { name: 'จ่ายเกิน' });
    expect(success).toHaveClass('[[readonly]]:bg-success/10', 'text-success');
    expect(success).not.toHaveClass('[[readonly]]:bg-muted/80');
    expect(success).not.toHaveClass('text-foreground');

    const warning = screen.getByRole('textbox', { name: 'จ่ายน้อย' });
    expect(warning).toHaveClass('[[readonly]]:bg-warning/10', 'text-warning-strong');
    expect(warning).not.toHaveClass('text-warning');
    expect(warning).not.toHaveClass('[[readonly]]:bg-muted/80');
  });

  it('forwards ref and appends the caller className last', () => {
    const ref = createRef<HTMLInputElement>();
    render(<ReadOnlyField ref={ref} aria-label="VAT" value="7" className="w-28" />);
    const field = screen.getByRole('textbox', { name: 'VAT' });
    expect(ref.current).toBe(field);
    expect(field).toHaveClass('w-28');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run from repo root in Git Bash:

```bash
npm run test --workspace=apps/web -- src/components/ui/readonly-field.test.tsx
```

Expected: FAIL — vitest reports `Failed to resolve import "./readonly-field" from "src/components/ui/readonly-field.test.tsx". Does the file exist?` and `Test Files  1 failed (1)`.

- [ ] **Step 3: Write ReadOnlyField**

Create `apps/web/src/components/ui/readonly-field.tsx` with exactly:

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';
import { Input } from './input';
import { formControlClass } from './form-styles';

type ReadOnlyFieldTone = 'default' | 'success' | 'warning';

type ReadOnlyFieldProps = Omit<
  React.ComponentProps<'input'>,
  'readOnly' | 'onChange' | 'type' | 'value' | 'defaultValue'
> & {
  value: string | number;
  /** `end` = numbers: right-aligned with tabular figures. */
  align?: 'start' | 'end';
  /** Status colour some cards show on a computed value — no className override needed. */
  tone?: ReadOnlyFieldTone;
};

// `inputVariants` styles read-only inputs with `[[readonly]]:bg-muted/80` and
// `[[readonly]]:cursor-not-allowed`. Tailwind compiles those to `:is([readonly])`, which
// beats a plain utility, so tone backgrounds and the cursor must use the same variant;
// tailwind-merge then drops the base ones.
const TONE_CLASS: Record<ReadOnlyFieldTone, string> = {
  default: '',
  success: '[[readonly]]:bg-success/10 text-success',
  warning: '[[readonly]]:bg-warning/10 text-warning-strong',
};

/**
 * A computed/display value that sits in a form row: same 44px frame as the editable
 * controls next to it (formControlClass), the read-only surface of `inputVariants`,
 * labelable with `<label htmlFor>` and skipped by Tab.
 */
function ReadOnlyField({
  value,
  align = 'start',
  tone = 'default',
  className,
  ...props
}: ReadOnlyFieldProps) {
  return (
    <Input
      {...props}
      readOnly
      tabIndex={-1}
      data-slot="readonly-field"
      value={String(value)}
      className={cn(
        formControlClass,
        'bg-muted/80 [[readonly]]:cursor-default',
        align === 'end' && 'text-right tabular-nums',
        TONE_CLASS[tone],
        className,
      )}
    />
  );
}

export { ReadOnlyField, type ReadOnlyFieldProps };
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npm run test --workspace=apps/web -- src/components/ui/readonly-field.test.tsx
```

Expected: PASS — `Test Files  1 passed (1)` and `Tests  5 passed (5)`.

- [ ] **Step 5: Commit ReadOnlyField**

```bash
git add apps/web/src/components/ui/readonly-field.tsx apps/web/src/components/ui/readonly-field.test.tsx && git commit -F - <<'EOF'
feat(web): add ReadOnlyField for read-only values in form rows

Wraps Input readOnly tabIndex=-1 with formControlClass so computed values
match the 44px editable controls beside them (spec 2026-11-14 §4.2 item 2).
align="end" gives right-aligned tabular numbers; tone success/warning keeps
status colours via [[readonly]]: variants that beat inputVariants' read-only
background.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: one commit created on the current branch; `git status --short` shows nothing for these two files.

- [ ] **Step 6: Write the failing LabeledField test**

Create `apps/web/src/components/ui/labeled-field.test.tsx` with exactly:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LabeledField, labeledFieldIds } from './labeled-field';
import { formLabelClass } from './form-styles';

describe('LabeledField', () => {
  it('names the control with a formLabelClass label that has a stable id', () => {
    const { container } = render(
      <LabeledField label="ชื่อบัญชี" htmlFor="acc" className="md:col-span-2">
        <input id="acc" />
      </LabeledField>,
    );
    const input = screen.getByLabelText('ชื่อบัญชี');
    expect(input).toHaveAttribute('id', 'acc');
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(input).not.toHaveAttribute('aria-invalid');

    const label = container.querySelector('#acc-label');
    expect(label?.tagName).toBe('LABEL');
    expect(label).toHaveAttribute('for', 'acc');
    expect(label?.className).toBe(formLabelClass);

    const wrapper = container.querySelector('[data-slot="labeled-field"]');
    expect(wrapper).toHaveClass('md:col-span-2');
    expect(labeledFieldIds('acc')).toEqual({
      labelId: 'acc-label',
      hintId: 'acc-hint',
      errorId: 'acc-error',
    });
  });

  it('marks required with a decorative red asterisk and aria-required, keeping the name clean', () => {
    render(
      <LabeledField label="ชื่อ" htmlFor="name" required>
        <input id="name" required />
      </LabeledField>,
    );
    const input = screen.getByRole('textbox', { name: 'ชื่อ' });
    expect(input).toHaveAttribute('aria-required', 'true');
    const star = screen.getByText('*');
    expect(star).toHaveAttribute('aria-hidden', 'true');
    expect(star).toHaveClass('text-destructive');
  });

  it('links hint and error through aria-describedby, flags invalid and announces the error', () => {
    render(
      <LabeledField label="ยอด" htmlFor="amt" hint="ไม่รวม VAT" error="กรุณาระบุยอด">
        <input id="amt" aria-describedby="amt-extra" />
      </LabeledField>,
    );
    const input = screen.getByRole('textbox', { name: 'ยอด' });
    expect(input).toHaveAttribute('aria-describedby', 'amt-extra amt-hint amt-error');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('ไม่รวม VAT กรุณาระบุยอด');
    expect(screen.getByText('ไม่รวม VAT')).toHaveAttribute('id', 'amt-hint');

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('กรุณาระบุยอด');
    expect(alert).toHaveAttribute('id', 'amt-error');
    expect(alert).toHaveClass('text-destructive');
  });

  it('renders no hint or error nodes when absent and leaves fragment children untouched', () => {
    const { container } = render(
      <LabeledField label="ป้าย" htmlFor="x" hint="" error={null}>
        <>
          <input id="x" />
        </>
      </LabeledField>,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.querySelector('#x-hint')).toBeNull();
    expect(container.querySelector('#x-error')).toBeNull();
    expect(screen.getByLabelText('ป้าย')).not.toHaveAttribute('aria-describedby');
  });

  it('lets a combobox trigger reuse the label id through aria-labelledby', () => {
    const { labelId } = labeledFieldIds('branch');
    render(
      <LabeledField label="สาขา" htmlFor="branch">
        <button type="button" role="combobox" id="branch" aria-labelledby={labelId} aria-expanded={false}>
          สาขาทดสอบ
        </button>
      </LabeledField>,
    );
    expect(screen.getByRole('combobox', { name: 'สาขา' })).toHaveAttribute('id', 'branch');
  });
});
```

- [ ] **Step 7: Run it and watch it fail**

```bash
npm run test --workspace=apps/web -- src/components/ui/labeled-field.test.tsx
```

Expected: FAIL — `Failed to resolve import "./labeled-field" from "src/components/ui/labeled-field.test.tsx". Does the file exist?` and `Test Files  1 failed (1)`.

- [ ] **Step 8: Write LabeledField**

Create `apps/web/src/components/ui/labeled-field.tsx` with exactly:

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';
import { formLabelClass } from './form-styles';

type LabeledFieldProps = {
  label: React.ReactNode;
  /** id of the control; also the prefix of the label/hint/error ids. */
  htmlFor: string;
  required?: boolean;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
};

type ControlAriaProps = {
  'aria-describedby'?: string;
  'aria-invalid'?: React.AriaAttributes['aria-invalid'];
  'aria-required'?: React.AriaAttributes['aria-required'];
};

/** Stable ids so a Combobox trigger can point `aria-labelledby` at the label. */
function labeledFieldIds(htmlFor: string) {
  return {
    labelId: `${htmlFor}-label`,
    hintId: `${htmlFor}-hint`,
    errorId: `${htmlFor}-error`,
  };
}

function hasContent(node: React.ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

/**
 * Label + control + hint/error for forms that do not use react-hook-form
 * (shadcn's FormField name is taken). Label style = formLabelClass.
 * A single element child gets aria-describedby / aria-invalid / aria-required;
 * other children (fragments, text, arrays) are rendered as-is — wire them with
 * labeledFieldIds().
 */
function LabeledField({
  label,
  htmlFor,
  required = false,
  hint,
  error,
  className,
  children,
}: LabeledFieldProps) {
  const { labelId, hintId, errorId } = labeledFieldIds(htmlFor);
  const showHint = hasContent(hint);
  const showError = hasContent(error);
  const describedBy = [showHint ? hintId : null, showError ? errorId : null]
    .filter(Boolean)
    .join(' ');

  let control = children;
  if (
    React.isValidElement<ControlAriaProps>(children) &&
    children.type !== React.Fragment &&
    (describedBy || showError || required)
  ) {
    const existing = children.props['aria-describedby'];
    control = React.cloneElement(children, {
      'aria-describedby': [existing, describedBy].filter(Boolean).join(' ') || undefined,
      ...(showError ? { 'aria-invalid': true } : {}),
      ...(required ? { 'aria-required': true } : {}),
    });
  }

  return (
    <div data-slot="labeled-field" className={cn('min-w-0', className)}>
      <label id={labelId} htmlFor={htmlFor} className={formLabelClass}>
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-destructive">
            *
          </span>
        ) : null}
      </label>
      {control}
      {showHint ? (
        <p id={hintId} className="mt-1.5 text-xs leading-snug text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {showError ? (
        <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium leading-snug text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export { LabeledField, labeledFieldIds, type LabeledFieldProps };
```

- [ ] **Step 9: Run the test and watch it pass**

```bash
npm run test --workspace=apps/web -- src/components/ui/labeled-field.test.tsx
```

Expected: PASS — `Test Files  1 passed (1)` and `Tests  5 passed (5)`.

- [ ] **Step 10: Run both new tests plus the neighbouring ui tests together**

```bash
npm run test --workspace=apps/web -- src/components/ui/readonly-field.test.tsx src/components/ui/labeled-field.test.tsx src/components/ui/native-select.test.tsx src/components/ui/form.test.tsx
```

Expected: `Test Files  4 passed (4)`, no failures.

- [ ] **Step 11: Type check and lint the new files**

```bash
bash tools/check-types.sh web
```

Expected: ends with `Web: OK`.

```bash
cd apps/web && npx eslint src/components/ui/readonly-field.tsx src/components/ui/readonly-field.test.tsx src/components/ui/labeled-field.tsx src/components/ui/labeled-field.test.tsx; cd ../..
```

Expected: no output (0 errors, 0 warnings). (The whole-app equivalent is `npm run lint --workspace=apps/web`; it must report 0 errors.)

- [ ] **Step 12: Commit LabeledField**

```bash
git add apps/web/src/components/ui/labeled-field.tsx apps/web/src/components/ui/labeled-field.test.tsx && git commit -F - <<'EOF'
feat(web): add LabeledField for non react-hook-form fields

Label (formLabelClass, id `${htmlFor}-label`) + control + hint/error
(spec 2026-11-14 §4.2 item 3). Required shows an aria-hidden red asterisk and
sets aria-required on the control; hint/error ids are merged into the
control's aria-describedby, error renders role="alert". labeledFieldIds()
exposes the label id for Combobox aria-labelledby.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: one commit created; do not push.

---

### Task 5: NativeSelect leadingIcon + tone, migrate TodoFilters and PeakMappingSettings (R1-2, §4.2 item 5)

Spec §4.2 item 5: the shared `NativeSelect` does **not** force a look on its callers. It gets two props instead. `leadingIcon`: the primitive owns the icon and its left padding. `tone: 'default' | 'warning'`: the warning border. The two call sites that fake these move to the props: `TodoFilters.tsx` (absolute `UserIcon` + `pl-9`) and `PeakMappingSettings.tsx:465` (`isDirty ? 'border-warning'`). The scan test that bans `rounded-*`/`border-border`/`bg-*`/`px-*`/`pl-*` in `NativeSelect` className is **not** part of this task (it turns on in R1-3).

**Files:**
- Modify: `apps/web/src/components/ui/native-select.tsx` (whole file, 36 lines → full replacement in Step 3)
- Test: `apps/web/src/components/ui/native-select.test.tsx` (append a new `describe` after line 57)
- Modify: `apps/web/src/pages/TodosPage/components/TodoFilters.tsx` lines 79-87 (assignee filter block)
- Create test: `apps/web/src/pages/TodosPage/components/TodoFilters.test.tsx`
- Modify: `apps/web/src/pages/SettingsPage/components/PeakMappingSettings.tsx` lines 464-465
- Test: `apps/web/src/pages/SettingsPage/components/__tests__/PeakMappingSettings.test.tsx` (insert after line 199)
- Modify (Windows-only fix, see Step 12): `apps/web/src/components/ui/native-select.inventory.test.ts` lines 2, 21-22, 72-73

**Interfaces:**
- Consumes: `formControlClass` from `apps/web/src/components/ui/form-styles.ts` (unchanged; it contains `border-input` via `inputVariants`), and `cn` from `@/lib/utils` (plain `twMerge(clsx(...))`; later classes win). Checked: `twMerge('px-3 border border-input rounded-xl pl-9 pr-8','peer pr-10','pl-10','border-warning')` → `px-3 border rounded-xl peer pr-10 pl-10 border-warning`.
- Produces (SHARED CONTRACT, exact names):
  ```ts
  type NativeSelectProps = Omit<React.ComponentProps<'select'>, 'multiple' | 'size'> & {
    wrapperClassName?: string;          // unchanged
    leadingIcon?: React.ReactNode;      // NEW — absolutely positioned at the left, pointer-events-none; select gets pl-10
    tone?: 'default' | 'warning';       // NEW — 'warning' → border-warning (appended last, wins)
  };
  ```
  It also produces the DOM hook `data-slot="native-select-leading-icon"` on the icon wrapper. The icon wrapper is rendered **after** the `<select>` so that `peer-disabled:opacity-50` works. `className` and `wrapperClassName` work as before. `pl-10` and `border-warning` go after the caller `className`, in the same class list as the existing fixed group, so they win over caller padding and border colour.

---

- [ ] **Step 1: Write the failing NativeSelect tests**

The current file `apps/web/src/components/ui/native-select.test.tsx` ends (lines 55-57) with:

```tsx
    expect(submit).toHaveBeenCalledWith({ branch: 'b' });
  });
});
```

Append the following after line 57. The file already imports `render`, `screen`, `describe`, `it`, `expect` and `NativeSelect`, and defines `options` on line 7.

```tsx

describe('NativeSelect leadingIcon and tone', () => {
  it('renders a decorative leading icon and owns the left padding over the caller className', () => {
    render(
      <NativeSelect
        aria-label="ผู้รับมอบหมาย"
        leadingIcon={<svg data-testid="lead-icon" />}
        className="pl-9 rounded-xl"
      >
        {options}
      </NativeSelect>,
    );
    const select = screen.getByRole('combobox', { name: 'ผู้รับมอบหมาย' });
    expect(select).toHaveClass('pl-10');
    expect(select).not.toHaveClass('pl-9');
    const slot = screen.getByTestId('lead-icon').parentElement as HTMLElement;
    expect(slot).toHaveAttribute('data-slot', 'native-select-leading-icon');
    expect(slot).toHaveAttribute('aria-hidden', 'true');
    expect(slot).toHaveClass(
      'pointer-events-none',
      'absolute',
      'left-3',
      'top-1/2',
      '-translate-y-1/2',
      'size-4',
      'text-muted-foreground',
    );
  });

  it('places the icon after the select so the disabled state dims it too', () => {
    render(
      <NativeSelect aria-label="ผู้รับมอบหมาย" disabled leadingIcon={<svg data-testid="lead-icon" />}>
        {options}
      </NativeSelect>,
    );
    const select = screen.getByRole('combobox', { name: 'ผู้รับมอบหมาย' });
    const slot = screen.getByTestId('lead-icon').parentElement as HTMLElement;
    expect(slot).toHaveClass('peer-disabled:opacity-50');
    expect(select.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('adds no icon slot and no extra left padding without leadingIcon', () => {
    const { container } = render(<NativeSelect aria-label="สาขา">{options}</NativeSelect>);
    expect(container.querySelector('[data-slot="native-select-leading-icon"]')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'สาขา' })).not.toHaveClass('pl-10');
  });

  it('tone="warning" appends border-warning last so it beats border-input and caller border colours', () => {
    render(
      <NativeSelect aria-label="แหล่งรหัสย่อย" tone="warning" className="border-border">
        {options}
      </NativeSelect>,
    );
    const select = screen.getByRole('combobox', { name: 'แหล่งรหัสย่อย' });
    expect(select).toHaveClass('border-warning');
    expect(select).not.toHaveClass('border-input');
    expect(select).not.toHaveClass('border-border');
    expect(select).not.toHaveAttribute('tone');
  });

  it('tone="default" keeps the standard border', () => {
    render(
      <NativeSelect aria-label="แหล่งรหัสย่อย" tone="default">
        {options}
      </NativeSelect>,
    );
    const select = screen.getByRole('combobox', { name: 'แหล่งรหัสย่อย' });
    expect(select).toHaveClass('border-input');
    expect(select).not.toHaveClass('border-warning');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run from the repo root in Git Bash:
```bash
npm run test --workspace=apps/web -- src/components/ui/native-select.test.tsx
```
Expected: FAIL with `Tests  3 failed | 6 passed (9)`. The failures are:
- the leading-icon test: `Expected the element to have class:` … `pl-10`
- the disabled-dimming test: `Unable to find an element by: [data-testid="lead-icon"]`. The old component spreads `leadingIcon` onto `<select>` as an unknown attribute, so the svg is never rendered, and React logs an unknown-prop warning.
- the `tone="warning"` test: `Expected the element to have class:` … `border-warning`

- [ ] **Step 3: Implement `leadingIcon` and `tone` in NativeSelect**

Replace the whole content of `apps/web/src/components/ui/native-select.tsx` (currently 36 lines) with:

```tsx
import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formControlClass } from './form-styles';

type NativeSelectProps = Omit<React.ComponentProps<'select'>, 'multiple' | 'size'> & {
  /** Width, margin, flex and grid placement belong to the wrapper. */
  wrapperClassName?: string;
  /**
   * Decorative icon at the start of the field (e.g. a user icon on an assignee filter).
   * The primitive owns the left padding (`pl-10`), so callers must not pass `pl-*` for it.
   */
  leadingIcon?: React.ReactNode;
  /** `warning` = attention border (e.g. an unsaved row); it wins over any caller border colour. */
  tone?: 'default' | 'warning';
};

/** Keep native selection, form validation, refs and change events with a consistent arrow. */
export function NativeSelect({
  className,
  wrapperClassName,
  disabled,
  leadingIcon,
  tone = 'default',
  ...props
}: NativeSelectProps) {
  const hasLeadingIcon = Boolean(leadingIcon);
  return (
    <span data-slot="native-select-wrapper" className={cn('relative block min-w-0 w-full max-w-full', wrapperClassName)}>
      <select
        data-slot="native-select"
        {...props}
        disabled={disabled}
        className={cn(
          formControlClass,
          className,
          'peer h-11 min-h-11 w-full min-w-0 max-w-full appearance-none overflow-hidden pr-10 text-base leading-normal md:text-base lg:text-sm',
          hasLeadingIcon && 'pl-10',
          tone === 'warning' && 'border-warning',
        )}
      />
      {hasLeadingIcon && (
        <span
          data-slot="native-select-leading-icon"
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center text-muted-foreground peer-disabled:opacity-50 [&_svg]:size-4"
        >
          {leadingIcon}
        </span>
      )}
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-[calc(0.75rem+1px)] top-1/2 size-4 -translate-y-1/2 text-muted-foreground peer-disabled:opacity-50"
      />
    </span>
  );
}
```

Notes for the implementer:
- The icon `<span>` must come **after** `<select>`. Tailwind's `peer-*` only matches later siblings, and an absolutely positioned later sibling paints above the select without a `z-index`.
- `[&_svg]:size-4` makes a bare `<UserIcon />` (lucide's default is 24px) fit the 16px slot. Callers do not need to size the icon.
- The only colour tokens used are `text-muted-foreground` and `border-warning` (`--color-warning`, `apps/web/src/index.css:93`). No hex values.

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npm run test --workspace=apps/web -- src/components/ui/native-select.test.tsx
```
Expected: PASS, `Test Files  1 passed (1)` and `Tests  9 passed (9)`.

- [ ] **Step 5: Commit the primitive**

```bash
git add apps/web/src/components/ui/native-select.tsx apps/web/src/components/ui/native-select.test.tsx && git commit -F - <<'EOF'
feat(web): NativeSelect leadingIcon + tone props

The primitive owns the leading icon slot (pl-10, pointer-events-none,
dimmed when disabled) and a warning border tone, so callers stop
overriding padding/border through className (spec §4.2 item 5).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 6: Write the failing TodoFilters test**

Create `apps/web/src/pages/TodosPage/components/TodoFilters.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TodoFilters } from './TodoFilters';
import type { TodoView } from '../types';

const counts: Record<TodoView, number> = {
  all: 0,
  today: 0,
  upcoming: 0,
  priority: 0,
  cancelled: 0,
  completed: 0,
};

describe('TodoFilters assignee filter', () => {
  it('lets NativeSelect own the user icon and its left padding', () => {
    const onAssignee = vi.fn();
    render(
      <TodoFilters
        view="all"
        onViewChange={vi.fn()}
        search=""
        onSearchChange={vi.fn()}
        tabCounts={counts}
        staffUsers={[{ id: 'u1', name: 'สมชาย ใจดี', nickname: 'ชาย' }]}
        assigneeFilter=""
        onAssigneeFilterChange={onAssignee}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'ผู้รับมอบหมาย' });
    expect(select).toHaveClass('pl-10');
    expect(select).not.toHaveClass('pl-9');

    const wrapper = select.closest('[data-slot="native-select-wrapper"]') as HTMLElement;
    const slot = wrapper.querySelector('[data-slot="native-select-leading-icon"]');
    expect(slot?.querySelector('svg')).not.toBeNull();
    // No hand-positioned icon left outside the primitive.
    expect((wrapper.parentElement as HTMLElement).querySelectorAll(':scope > svg')).toHaveLength(0);

    fireEvent.change(select, { target: { value: 'me' } });
    expect(onAssignee).toHaveBeenCalledWith('me');
  });
});
```

- [ ] **Step 7: Run it and confirm it fails**

```bash
npm run test --workspace=apps/web -- src/pages/TodosPage/components/TodoFilters.test.tsx
```
Expected: FAIL `Tests  1 failed (1)` with `Expected the element to have class:` … `pl-10`. The select still gets `pl-9` from the caller className, and TodoFilters does not pass `leadingIcon` yet.

- [ ] **Step 8: Migrate TodoFilters to `leadingIcon`**

In `apps/web/src/pages/TodosPage/components/TodoFilters.tsx` replace lines 79-87:

```tsx
        {onAssigneeFilterChange && (
          <div className="relative min-w-0 w-full sm:w-auto">
            <UserIcon className="absolute z-10 left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <NativeSelect wrapperClassName="max-w-full w-auto"
              aria-label="ผู้รับมอบหมาย"
              value={assigneeFilter}
              onChange={(e) => onAssigneeFilterChange(e.target.value)}
              className="pl-9 pr-8 py-2.5 border border-input bg-card rounded-xl text-sm focus-visible:ring-2 focus-visible:ring-primary/20 focus:border-primary/50 outline-hidden transition-colors appearance-none cursor-pointer"
            >
```

with:

```tsx
        {onAssigneeFilterChange && (
          <div className="min-w-0 w-full sm:w-auto">
            <NativeSelect wrapperClassName="max-w-full w-auto"
              aria-label="ผู้รับมอบหมาย"
              leadingIcon={<UserIcon />}
              value={assigneeFilter}
              onChange={(e) => onAssigneeFilterChange(e.target.value)}
              className="py-2.5 border border-input bg-card rounded-xl text-sm focus-visible:ring-2 focus-visible:ring-primary/20 focus:border-primary/50 outline-hidden transition-colors cursor-pointer"
            >
```

This removes the outer `relative`, the hand-placed `<UserIcon …>`, and `pl-9 pr-8 appearance-none`. The primitive already applies `pr-10` and `appearance-none`, and its own wrapper span is `relative`. `rounded-xl`, `bg-card` and `py-2.5` stay because the look is normalised file by file in R1-3, not here. Lines 88-97 (options and closing tags) and the `UserIcon` import on line 2 do not change; `UserIcon` is still used.

- [ ] **Step 9: Run it and confirm it passes**

```bash
npm run test --workspace=apps/web -- src/pages/TodosPage
```
Expected: PASS, `Test Files  2 passed (2)` (the new `TodoFilters.test.tsx` and the existing `home-link.test.tsx`), 0 failed.

- [ ] **Step 10: Add a PeakMappingSettings characterization test for the dirty warning border**

Dirty rows render with `border-warning` both before and after the migration, so this test **passes on the current code**. Its job is to pin that behaviour through the refactor in Step 11. In `apps/web/src/pages/SettingsPage/components/__tests__/PeakMappingSettings.test.tsx`, after these existing lines (196-199):

```tsx
    expect(apiPut).toHaveBeenCalledWith('/chart-of-accounts/peak-mapping', {
      mappings: [{ id: 'n1', peakCode: '530215', peakSubCode: 'trn001', peakSubCodeSource: 'fixed' }],
    });
  });
```

insert:

```tsx

  it('marks only the changed row source select with the warning border', async () => {
    apiGet.mockResolvedValueOnce({ data: rows });
    wrap(<PeakMappingSettings canEdit />);
    await screen.findByText('53-1306');
    const name = 'แหล่งรหัสย่อย สำหรับ 53-1306';
    expect(screen.getByRole('combobox', { name })).not.toHaveClass('border-warning');
    fireEvent.change(screen.getByRole('combobox', { name }), { target: { value: 'fixed' } });
    expect(screen.getByRole('combobox', { name })).toHaveClass('border-warning');
    expect(screen.getByRole('combobox', { name })).not.toHaveClass('border-input');
    expect(screen.getByRole('combobox', { name: 'แหล่งรหัสย่อย สำหรับ 11-2101' })).not.toHaveClass('border-warning');
  });
```

Run:
```bash
npm run test --workspace=apps/web -- src/pages/SettingsPage/components/__tests__/PeakMappingSettings.test.tsx
```
Expected: PASS, 0 failed (the new test is included).

- [ ] **Step 11: Migrate PeakMappingSettings to `tone`**

In `apps/web/src/pages/SettingsPage/components/PeakMappingSettings.tsx` replace lines 464-465:

```tsx
                            aria-label={`แหล่งรหัสย่อย สำหรับ ${row.code}`}
                            className={isDirty ? 'border-warning' : ''}
```

with:

```tsx
                            aria-label={`แหล่งรหัสย่อย สำหรับ ${row.code}`}
                            tone={isDirty ? 'warning' : 'default'}
```

Only the `NativeSelect` changes. The two `<Input … className={… 'border-warning' …}>` at lines 456 and 485 stay as they are: `Input` has no `tone` prop, and they are outside this task.

Run:
```bash
npm run test --workspace=apps/web -- src/pages/SettingsPage/components/__tests__/PeakMappingSettings.test.tsx
```
Expected: PASS, 0 failed.

- [ ] **Step 12: Commit the migrations**

```bash
git add apps/web/src/pages/TodosPage/components/TodoFilters.tsx apps/web/src/pages/TodosPage/components/TodoFilters.test.tsx apps/web/src/pages/SettingsPage/components/PeakMappingSettings.tsx apps/web/src/pages/SettingsPage/components/__tests__/PeakMappingSettings.test.tsx && git commit -F - <<'EOF'
refactor(web): use NativeSelect leadingIcon/tone in TodoFilters and PEAK mapping

TodoFilters drops the hand-positioned UserIcon + pl-9; PeakMappingSettings
passes tone="warning" for dirty rows instead of a border-warning className.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 13: Confirm the native-select inventory guard fails on Windows (baseline)**

Skip Steps 13-16 if another task in this plan has already applied the same separator fix to this file. To check, run the command below: if it passes, skip.

```bash
npm run test --workspace=apps/web -- src/components/ui/native-select.inventory.test.ts
```
Expected on Windows: FAIL `Tests  1 failed (1)` at `native-select.inventory.test.ts:76`. The diff shows the expected `"apps/web/src/components/ui/native-select.tsx"` against received `"apps\\web\\src\\components\\ui\\native-select.tsx"`: `path.relative` returns `\` on Windows, but the allow-list uses `/`. Linux CI is unaffected. This failure existed before this task.

- [ ] **Step 14: Normalise path separators in the inventory guard**

In `apps/web/src/components/ui/native-select.inventory.test.ts`:

Line 2, replace:
```ts
import { resolve, relative } from 'node:path';
```
with:
```ts
import { resolve, relative, sep } from 'node:path';
```

After lines 19-21:
```ts
// The scan is still I/O over the whole frontend tree; keep a generous ceiling so a
// busy runner cannot turn a guard test into a deploy blocker.
const SCAN_TIMEOUT_MS = 30_000;
```
add:
```ts
// Allow-list paths use `/`; `path.relative` returns `\` on Windows.
const repoPath = (file: string) => relative(ROOT, file).split(sep).join('/');
```

Lines 72-73, replace:
```ts
          if (tag === 'select') found.push(relative(ROOT, file));
          if (tag === 'datalist') datalists.push(relative(ROOT, file));
```
with:
```ts
          if (tag === 'select') found.push(repoPath(file));
          if (tag === 'datalist') datalists.push(repoPath(file));
```

- [ ] **Step 15: Run it and confirm it passes**

```bash
npm run test --workspace=apps/web -- src/components/ui/native-select.inventory.test.ts
```
Expected: PASS, `Tests  1 passed (1)`. This also confirms that `native-select.tsx` is still the only raw `<select>` in `apps/web` after Steps 3, 8 and 11.

- [ ] **Step 16: Commit the guard fix**

```bash
git add apps/web/src/components/ui/native-select.inventory.test.ts && git commit -F - <<'EOF'
test(web): normalise path separators in native-select inventory guard

path.relative returns backslashes on Windows, so the allow-list comparison
failed locally while passing on Linux CI.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 17: Full verification**

```bash
npm run test --workspace=apps/web -- src/components/ui/native-select.test.tsx src/components/ui/native-select.inventory.test.ts src/pages/TodosPage src/pages/SettingsPage/components/__tests__/PeakMappingSettings.test.tsx
```
Expected: `Test Files  5 passed (5)`, 0 failed.

```bash
bash tools/check-types.sh web
```
Expected: ends with `Web: OK` and `TypeScript check passed!`. Test files are inside `apps/web/tsconfig.json` `include: ["src"]`, so the new `leadingIcon`/`tone` usages in the tests are type-checked too.

```bash
npm run lint --workspace=apps/web
```
Expected: exit code 0, no errors in the touched files.

Optional visual check: run `npm run local:preview` and open http://localhost:5195. On the Todos page, check the assignee filter: icon at the left, text not overlapping it, icon dimmed when disabled. On Chart of Accounts → PEAK mapping, change a row's sub-code source; that row's select should get the yellow border. Check both light and dark themes. Stop the preview afterwards.

---

### Task 6: AccountSearchDropdown → portalled Popover with keyboard (R1-2, §4.2 item 6, P1 S2-01/S2-02)

**Why:** The account menu is an `absolute z-30` panel (`AccountSearchDropdown.tsx:85-88`). It is not portalled, so the card in `ItemsTable.tsx:72` (`overflow-hidden`) and the table box in `EditableJournalTable.tsx:104` (`overflow-x-auto`) cut it off. These are the P1 findings S2-01 and S2-02. Spec §4.2 item 6 fixes this in **one file**: the panel becomes a Radix `Popover`/`PopoverContent`, which portals to `document.body`. The props stay the same, so all 4 consumers are fixed at once and none of them is edited: `ItemsTable.tsx:95`, `EditableJournalTable.tsx:119`, `AdjustmentTable.tsx:60` and `PettyCashLinesSection.tsx:106`. R2-3a moves the internals to `Combobox` later. This task does **not** use cmdk.

**Files:**
- Modify (full rewrite, current lines 1-147): `apps/web/src/pages/other-income/components/AccountSearchDropdown.tsx`
- Create (test): `apps/web/src/pages/other-income/components/__tests__/AccountSearchDropdown.test.tsx`
- No change (verified consumers; the `Props` shape stays the same): `apps/web/src/pages/other-income/components/ItemsTable.tsx:95`, `apps/web/src/pages/other-income/components/EditableJournalTable.tsx:119`, `apps/web/src/pages/other-income/components/AdjustmentTable.tsx:60`, `apps/web/src/components/expense-form-v4/PettyCashLinesSection.tsx:106`
- Conditional modify (only if Task 1/another R1-2 task already created it with an allow-list entry for this component): `apps/web/src/components/ui/field-guards.inventory.test.ts`

**Interfaces:**
- Consumes:
  - `Popover`, `PopoverTrigger`, `PopoverContent` from `@/components/ui/popover`. `PopoverContent` already wraps `PopoverPrimitive.Portal`, and its default classes include `z-50 w-72 p-4`. tailwind-merge 3.6.0 resolves `w-72 p-4` + `w-(--radix-popover-trigger-width) min-w-64 p-0` to the new width and `p-0`.
  - `useCoaGroups` from `@/hooks/useCoa`, returning `{ data?: { groups: { accounts: { code; name }[] }[] }, isLoading }`.
  - `accountDisplayName` from `@/utils/accountName`.
  - `cn` from `@/lib/utils`.
  - T2 runner `tools/field-scale/check.mjs` and its account-menu assertion (verification step only).
- Produces:
  - Unchanged export `AccountSearchDropdown(props: { value: string; onChange: (code: string) => void; filter?: (a: {code: string; name: string}) => boolean; placeholder?: string; disabled?: boolean; blockedCodes?: string[]; blockedReason?: string; 'aria-label'?: string; 'aria-labelledby'?: string })` (the last two are additive: the trigger's accessible name; default `aria-label="บัญชี"` when neither is passed, and `aria-labelledby` suppresses the default).
  - New DOM contract, for T2's account-menu assertion and later tests:
    - trigger = `button[type=button][role=combobox][data-slot=select-trigger][aria-haspopup=listbox][aria-expanded]`, with an accessible name (`aria-label`, default `บัญชี`, overridable; `role=combobox` does not take its name from content)
    - open menu = `[data-slot=popover-content]`, a direct child of the Radix portal in `document.body`, containing:
      - search `input[aria-label="ค้นหารหัส หรือ ชื่อบัญชี"]` with `aria-controls`, `aria-activedescendant` and `aria-autocomplete=list`
      - `[role=listbox][aria-label="รายการบัญชี"]` (class `max-h-64 overflow-y-auto overscroll-contain`) containing `[role=option]` rows with `aria-selected`, `aria-disabled` on blocked rows, and `data-active` on the highlighted row.

---

- [ ] **Step 1: Write the failing test file**

Create `apps/web/src/pages/other-income/components/__tests__/AccountSearchDropdown.test.tsx` with exactly:

```tsx
import { useState, type ComponentProps } from 'react';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useCoa', () => ({
  useCoaGroups: () => ({
    isLoading: false,
    data: {
      groups: [
        {
          category: 'รายได้อื่น',
          accounts: [
            { code: '42-1101', name: 'รายได้ค่าบริการ' },
            { code: '42-1102', name: 'รายได้ค่าเช่า' },
            { code: '42-1104', name: 'รายได้หักเงินเดือน' },
            { code: '42-1105', name: 'รายได้ดอกเบี้ยธนาคาร' },
          ],
        },
        {
          category: 'ค่าใช้จ่าย',
          accounts: [{ code: '53-1301', name: 'ค่าเช่า (สำนักงาน)' }],
        },
      ],
    },
  }),
}));

import { AccountSearchDropdown } from '../AccountSearchDropdown';

type HarnessProps = Omit<ComponentProps<typeof AccountSearchDropdown>, 'value' | 'onChange'> & {
  initialValue?: string;
  onPick?: (code: string) => void;
};

/** Controlled wrapper inside an overflow-hidden box — the clipping parent of S2-01. */
function Harness({ initialValue = '', onPick, ...rest }: HarnessProps) {
  const [value, setValue] = useState(initialValue);
  return (
    <div data-testid="clip" className="overflow-hidden">
      <AccountSearchDropdown
        {...rest}
        value={value}
        onChange={(code) => {
          setValue(code);
          onPick?.(code);
        }}
      />
    </div>
  );
}

const only42 = (a: { code: string }) => a.code.startsWith('42-');
const SEARCH = 'ค้นหารหัส หรือ ชื่อบัญชี';

beforeAll(() => {
  // jsdom has no scrollIntoView; the dropdown scrolls the highlighted option into view.
  HTMLElement.prototype.scrollIntoView ??= () => {};
});

describe('AccountSearchDropdown — portalled menu (S2-01/S2-02)', () => {
  it('renders the list in document.body, not inside the overflow-hidden parent', async () => {
    const user = userEvent.setup();
    render(<Harness filter={only42} />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveAttribute('data-slot', 'select-trigger');
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const listbox = screen.getByRole('listbox', { name: 'รายการบัญชี' });
    expect(screen.getByTestId('clip')).not.toContainElement(listbox);
    expect(document.body).toContainElement(listbox);
    expect(listbox).toHaveClass('overscroll-contain');
    expect(within(listbox).getAllByRole('option')).toHaveLength(4);
    expect(within(listbox).queryByText('ค่าเช่า')).toBeNull(); // 53-1301 filtered out
  });

  it('stops wheel/touchmove inside the menu from reaching ancestors (modal scroll-lock escape)', async () => {
    const user = userEvent.setup();
    const parentScroll = vi.fn();
    render(
      <div onWheel={parentScroll} onTouchMove={parentScroll}>
        <Harness filter={only42} />
      </div>,
    );
    await user.click(screen.getByRole('combobox'));
    const listbox = screen.getByRole('listbox');
    fireEvent.wheel(listbox);
    fireEvent.touchMove(listbox);
    expect(parentScroll).not.toHaveBeenCalled();
  });
});

describe('AccountSearchDropdown — keyboard', () => {
  it.each([['{Tab}'], ['{Shift>}{Tab}{/Shift}']])(
    'Tab (%s) in the search box closes the menu without picking and keeps focus on the trigger',
    async (keys) => {
      const user = userEvent.setup();
      const onPick = vi.fn();
      render(<Harness filter={only42} initialValue="42-1105" onPick={onPick} />);
      const trigger = screen.getByRole('combobox');
      await user.click(trigger);
      expect(screen.getByRole('textbox', { name: SEARCH })).toHaveFocus();

      await user.keyboard(keys);

      expect(screen.queryByRole('listbox')).toBeNull();
      expect(onPick).not.toHaveBeenCalled();
      expect(trigger).toHaveTextContent('รายได้ดอกเบี้ยธนาคาร');
      await waitFor(() => expect(document.activeElement).toBe(trigger));
    },
  );

  it('ArrowDown/ArrowUp move the active option (skipping blocked), Enter selects, focus returns', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness filter={only42} blockedCodes={['42-1104']} onPick={onPick} />);
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    const search = screen.getByRole('textbox', { name: SEARCH });
    expect(search).toHaveFocus();
    const idOf = (name: RegExp) => screen.getByRole('option', { name }).id;
    expect(search).toHaveAttribute('aria-activedescendant', idOf(/^รายได้ค่าบริการ$/));

    await user.keyboard('{ArrowDown}');
    expect(search).toHaveAttribute('aria-activedescendant', idOf(/^รายได้ค่าเช่า$/));
    await user.keyboard('{ArrowDown}'); // 42-1104 is blocked → skipped
    expect(search).toHaveAttribute('aria-activedescendant', idOf(/^รายได้ดอกเบี้ยธนาคาร$/));
    await user.keyboard('{ArrowUp}');
    expect(search).toHaveAttribute('aria-activedescendant', idOf(/^รายได้ค่าเช่า$/));

    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith('42-1102');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger).toHaveTextContent('รายได้ค่าเช่า');
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('opens on ArrowDown from the trigger and highlights the current value', async () => {
    const user = userEvent.setup();
    render(<Harness filter={only42} initialValue="42-1105" />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('รายได้ดอกเบี้ยธนาคาร');
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    const current = screen.getByRole('option', { name: /^รายได้ดอกเบี้ยธนาคาร$/ });
    expect(current).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: SEARCH })).toHaveAttribute(
      'aria-activedescendant',
      current.id,
    );
  });

  it('Escape closes the menu and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Harness filter={only42} />);
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe('AccountSearchDropdown — trigger accessible name', () => {
  it("defaults to 'บัญชี'", () => {
    render(<Harness filter={only42} />);
    expect(screen.getByRole('combobox', { name: 'บัญชี' })).toHaveAttribute('data-slot', 'select-trigger');
  });

  it('uses a custom aria-label', () => {
    render(<Harness filter={only42} aria-label="บัญชีรายได้" />);
    expect(screen.getByRole('combobox', { name: 'บัญชีรายได้' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'บัญชี' })).toBeNull();
  });

  it('aria-labelledby wins over the default label', () => {
    render(
      <>
        <span id="acc-label">บัญชีที่ใช้</span>
        <Harness filter={only42} aria-labelledby="acc-label" />
      </>,
    );
    const trigger = screen.getByRole('combobox', { name: 'บัญชีที่ใช้' });
    expect(trigger).not.toHaveAttribute('aria-label');
  });
});

describe('AccountSearchDropdown — blocked codes', () => {
  it('shows the blocked reason as text and ignores clicks on the blocked row', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(
      <Harness
        filter={only42}
        blockedCodes={['42-1104']}
        blockedReason="ยังไม่รองรับ — รอ payroll module"
        onPick={onPick}
      />,
    );
    await user.click(screen.getByRole('combobox'));
    const blocked = screen.getByRole('option', { name: /รายได้หักเงินเดือน/ });
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    expect(within(blocked).getByText('ยังไม่รองรับ — รอ payroll module')).toBeVisible();

    await user.click(blocked);
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('a mouse click on a blocked row does not call onChange and keeps the menu open', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness filter={only42} blockedCodes={['42-1104']} onPick={onPick} />);
    await user.click(screen.getByRole('combobox'));
    fireEvent.mouseDown(screen.getByRole('option', { name: /รายได้หักเงินเดือน/ }));
    fireEvent.click(screen.getByRole('option', { name: /รายได้หักเงินเดือน/ }));
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true');
  });

  it('does not open when disabled', async () => {
    const user = userEvent.setup();
    render(<Harness disabled />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('AccountSearchDropdown — search', () => {
  it('filters by code and by name, highlights the first result, shows ไม่พบบัญชี', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('combobox'));
    const search = screen.getByRole('textbox', { name: SEARCH });

    await user.type(search, '42-1105');
    let options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['รายได้ดอกเบี้ยธนาคาร']);

    await user.clear(search);
    await user.type(search, 'ค่าเช่า');
    options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['รายได้ค่าเช่า', 'ค่าเช่า']);
    expect(search).toHaveAttribute('aria-activedescendant', options[0].id);

    await user.clear(search);
    await user.type(search, 'ไม่มีบัญชีนี้');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('ไม่พบบัญชี')).toBeInTheDocument();
    expect(search).not.toHaveAttribute('aria-activedescendant');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run from the repo root (Git Bash):

```bash
npm run test --workspace=apps/web -- src/pages/other-income/components/__tests__/AccountSearchDropdown.test.tsx
```

Expected: FAIL. Every test errors with
`TestingLibraryElementError: Unable to find an accessible element with the role "combobox"`
(today the trigger is a plain `<button>`), and the summary line reads `Tests  8 failed (8)`.

- [ ] **Step 3: Replace the component with the portalled Popover implementation**

Overwrite `apps/web/src/pages/other-income/components/AccountSearchDropdown.tsx` (all of current lines 1-147) with:

```tsx
import { useEffect, useId, useRef, useState } from 'react';
import { Search, CheckCircle2, ChevronUp, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCoaGroups } from '@/hooks/useCoa';
import { cn } from '@/lib/utils';
import { accountDisplayName } from '@/utils/accountName';

interface CoaItem {
  code: string;
  name: string;
}

interface Props {
  value: string;
  onChange: (code: string) => void;
  /** CSS classes filter for which CoA codes to show. */
  filter?: (a: CoaItem) => boolean;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Account codes that should be shown in the list (so users can see they exist)
   * but cannot be selected. Server-side validation (V4) still rejects these, but
   * surfacing them up-front avoids the surprise round-trip.
   */
  blockedCodes?: string[];
  /** Reason shown as secondary text (and tooltip) on blocked rows. */
  blockedReason?: string;
  /** Accessible name of the trigger. Defaults to 'บัญชี' unless aria-labelledby is given. */
  'aria-label'?: string;
  /** Id(s) of the element(s) that label the trigger; wins over the default aria-label. */
  'aria-labelledby'?: string;
}

const DEFAULT_BLOCKED_REASON = 'บัญชีนี้ยังไม่รองรับในระบบ';
const DEFAULT_TRIGGER_LABEL = 'บัญชี';

/**
 * Searchable account-code dropdown — used by ItemsTable (42-XXXX), AdjustmentTable,
 * EditableJournalTable (Override JV) and PettyCashLinesSection (53-XXXX).
 *
 * The menu is a portalled Radix Popover (spec 2026-11-14 §4.2 item 6, R1-2) so the
 * card (`overflow-hidden`) / table box (`overflow-x-auto`) around it no longer clips
 * it (S2-01, S2-02). Keyboard: ArrowDown on the button opens; in the search box
 * ArrowUp/ArrowDown move the highlighted row (aria-activedescendant), Enter picks it,
 * Escape closes (Radix), Tab closes without picking and keeps focus on the button.
 * The button is a combobox, so it takes its name from aria-label / aria-labelledby
 * (default 'บัญชี'), not from its content. Blocked codes stay listed with their reason as text and are
 * skipped by the keyboard. wheel/touchmove stop at the menu so it scrolls inside a
 * modal Dialog (same escape as WizardStackedOverlay). R2-3a replaces the internals
 * with the shared Combobox.
 */
export function AccountSearchDropdown({
  value,
  onChange,
  filter,
  placeholder = '— เลือกบัญชี —',
  disabled,
  blockedCodes,
  blockedReason,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const { data: groups, isLoading } = useCoaGroups({});

  const isBlocked = (code: string) => blockedCodes?.includes(code) ?? false;
  const optionId = (code: string) => `${listboxId}-${code}`;

  const allAccounts: CoaItem[] = (groups?.groups ?? []).flatMap((g) => g.accounts);
  const term = search.toLowerCase();
  const filtered = allAccounts
    .filter((a) => (filter ? filter(a) : true))
    .filter((a) =>
      term ? a.code.toLowerCase().includes(term) || a.name.toLowerCase().includes(term) : true,
    );
  const selectable = filtered.filter((a) => !isBlocked(a.code));
  const selected = allAccounts.find((a) => a.code === value);

  const isOpen = open && !disabled;
  // Highlight: the row the user moved to; otherwise the current value (when not
  // searching) or the first selectable result.
  const fallback = (search ? undefined : selectable.find((a) => a.code === value)) ?? selectable[0];
  const active = selectable.find((a) => a.code === activeCode) ?? fallback;
  const activeId = isOpen && active ? optionId(active.code) : undefined;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  const changeOpen = (next: boolean) => {
    if (next && disabled) return;
    setOpen(next);
    if (!next) {
      setSearch('');
      setActiveCode(null);
    }
  };

  const choose = (a: CoaItem) => {
    if (isBlocked(a.code)) return;
    onChange(a.code);
    changeOpen(false);
  };

  const move = (step: 1 | -1) => {
    if (selectable.length === 0) return;
    const from = active ? selectable.indexOf(active) : -1;
    const next = Math.min(selectable.length - 1, Math.max(0, from + step));
    setActiveCode(selectable[next].code);
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      // Keep focus on the trigger: Radix treats Tab-out as focus-outside and would not
      // return it, dropping focus to the end of the document.
      e.preventDefault();
      changeOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active) choose(active);
    }
  };

  // A modal Dialog's scroll lock preventDefault()s wheel/touchmove that bubble out of
  // its content — the portalled menu is outside it, so stop them here.
  const stopScrollLock = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <Popover open={isOpen} onOpenChange={changeOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          ref={triggerRef}
          data-slot="select-trigger"
          type="button"
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-label={ariaLabelledby ? undefined : (ariaLabel ?? DEFAULT_TRIGGER_LABEL)}
          aria-labelledby={ariaLabelledby}
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && !isOpen) {
              e.preventDefault();
              changeOpen(true);
            }
          }}
          className="w-full text-left px-3 py-2 rounded-md border bg-background text-sm flex items-center justify-between gap-2 hover:bg-accent disabled:opacity-50"
        >
          {selected ? (
            <span className="flex items-baseline gap-2 truncate">
              <span className="truncate">{accountDisplayName(selected.name)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          {isOpen ? (
            <ChevronUp aria-hidden="true" className="size-3.5 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground flex-shrink-0" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-(--radix-popover-trigger-width) min-w-64 flex-col p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          searchRef.current?.focus();
        }}
        onWheel={stopScrollLock}
        onTouchMove={stopScrollLock}
      >
        <div className="border-b p-2">
          <div className="relative">
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              ref={searchRef}
              aria-label="ค้นหารหัส หรือ ชื่อบัญชี"
              aria-controls={listboxId}
              aria-activedescendant={activeId}
              aria-autocomplete="list"
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setActiveCode(null);
              }}
              onKeyDown={onSearchKeyDown}
              placeholder="ค้นหารหัส หรือ ชื่อบัญชี"
              className="w-full rounded border bg-background py-2 pl-7 pr-2 text-xs"
            />
          </div>
        </div>
        {isLoading ? (
          <p className="p-3 text-center text-xs leading-snug text-muted-foreground">กำลังโหลด...</p>
        ) : filtered.length === 0 ? (
          <p className="p-3 text-center text-xs leading-snug text-muted-foreground">ไม่พบบัญชี</p>
        ) : null}
        <div
          id={listboxId}
          role="listbox"
          aria-label="รายการบัญชี"
          className="max-h-64 overflow-y-auto overscroll-contain"
        >
          {!isLoading &&
            filtered.map((a) => {
              const isSel = a.code === value;
              const blocked = isBlocked(a.code);
              const reason = blocked ? (blockedReason ?? DEFAULT_BLOCKED_REASON) : undefined;
              const isActive = !blocked && active?.code === a.code;
              return (
                <div
                  key={a.code}
                  id={optionId(a.code)}
                  role="option"
                  aria-selected={isSel}
                  aria-disabled={blocked || undefined}
                  data-active={isActive || undefined}
                  title={reason}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => {
                    if (!blocked && !isActive) setActiveCode(a.code);
                  }}
                  onClick={() => choose(a)}
                  className={cn(
                    'flex w-full items-center gap-2 border-b px-3 py-2 text-left text-xs leading-snug',
                    blocked
                      ? 'cursor-not-allowed bg-muted/40 text-muted-foreground'
                      : 'cursor-pointer data-[active]:bg-accent data-[active]:text-accent-foreground',
                    isSel && !blocked && 'font-medium',
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{accountDisplayName(a.name)}</span>
                    {reason && <span className="text-muted-foreground">{reason}</span>}
                  </span>
                  {isSel && !blocked && (
                    <CheckCircle2 size={12} aria-hidden="true" className="shrink-0 text-primary" />
                  )}
                </div>
              );
            })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

Notes for the implementer (they hold for the code above, so do not "fix" them):
- The trigger keeps the old `className` byte-for-byte. It already matched the central 44px rule through `[data-slot=select-trigger]` in `styles/admin-typography.css`, so adding `role=combobox` changes nothing visually. Changing the trigger's look belongs to R1-3/R2-3a.
- Radix `Slot` merges props with the child's props winning. So `aria-haspopup="listbox"` and `data-slot="select-trigger"` override Radix's `dialog` and `popover-trigger`, while `aria-controls` (the content id) and `data-state` come from Radix.
- `React.KeyboardEvent` / `React.SyntheticEvent` are global UMD types, used without import exactly like `src/components/WizardStackedOverlay.tsx:33`.
- Behaviour changes from the old panel:
  - The search text is cleared on every close. Before, it was cleared only after picking.
  - The blocked row shows the reason text itself instead of the fixed "ยังไม่รองรับ" at `text-[10px]`, following the spec §6.1 rule that the reason is visible text, not a tooltip.
  - The search icon is vertically centred, because the input is 44px under the app shell.

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npm run test --workspace=apps/web -- src/pages/other-income/components/__tests__/AccountSearchDropdown.test.tsx
```

Expected: `Test Files  1 passed (1)` and `Tests  8 passed (8)`.

- [ ] **Step 5: Run the neighbouring other-income + expense-form tests (no regressions)**

```bash
npm run test --workspace=apps/web -- src/pages/other-income src/components/expense-form-v4
```

Expected: every file passes, with 0 failed. None of the existing tests render `AccountSearchDropdown`. `EditableJournalTable.test.ts` imports only `getJournalIssues`.

- [ ] **Step 6: F5 allow-list (only if the guard file already exists)**

```bash
grep -n "AccountSearchDropdown" apps/web/src/components/ui/field-guards.inventory.test.ts
```

- If this prints a line inside an allow-list array, delete that single array entry (the line containing `'AccountSearchDropdown'` / its path), because this component no longer renders an `absolute` menu.
- If it prints nothing, or the file does not exist yet, do nothing.

Then run the guard file if it exists:

```bash
npm run test --workspace=apps/web -- src/components/ui/field-guards.inventory.test.ts
```

Expected: pass, or `No test files found` if the file is not there yet.

- [ ] **Step 7: Type check + lint**

```bash
bash tools/check-types.sh web
npm run lint --workspace=apps/web
```

Expected:
- The type check reports 0 errors for web.
- ESLint reports no **errors**. Pre-existing warnings elsewhere are allowed. There should be no new `no-restricted-syntax` warning, because the file uses only semantic tokens: `bg-accent`, `bg-muted/40`, `text-muted-foreground`, `text-primary`, `text-accent-foreground`.

- [ ] **Step 8: Verify in the browser with the T2 field-scale runner (expect the account-menu assertion to pass now)**

1. Run `npm run local:preview` (it restarts the preview, which is stale after this task's source edits) and wait for `Started http://localhost:5195/inbox`.
2. The account-menu probes live on two route ids in `tools/field-scale/routes.mjs`: `other-income-items` (probe `account-menu-items-card`, the other-income entry card — S2-01) and `other-income-override` (probe `account-menu-override-jv`, the Override JV table — S2-02). Run the runner on those ids at 1440, in both themes:

   ```bash
   node tools/field-scale/check.mjs --label t6-account-menu --routes other-income-items,other-income-override --widths 1440 --themes light,dark
   ```

   Expected: the run prints `menu probes: 4 pass · 0 fail`, and `.tmp/field-scale/t6-account-menu/report.md` section "เมนูบัญชีถูกตัด (S2-01 / S2-02)" lists all 4 rows as `PASS`. That means the menu found by its search box `aria-label="ค้นหารหัส หรือ ชื่อบัญชี"` has no clipping ancestor and lies inside the viewport (`tools/field-scale/menu-clip.mjs`).

   On `main` (the baseline) the same probes failed. Also open `.tmp/field-scale/t6-account-menu/*-1440-light-account-menu-*.png` and check that the menu is drawn over the card or table edge.
3. Compare against the baseline:

   ```bash
   node tools/field-scale/check.mjs --compare baseline t6-account-menu
   echo "exit=$?"
   ```

   Expected: `MENU failures (account-menu probes — never accepted from the baseline): 0`, the 4 MENU ids (`…|MENU|account-menu-items-card`, `…|MENU|account-menu-override-jv`, light and dark) listed under **Fixed**, no "Cells rendered … but not in …" or "fact count fell" section (the other 164 baseline cells are reported only as "Not run … (subset run — not blocking)"), and `exit=0` — or every remaining blocking line is a new F1 P2 accepted under the compare triage rule (cross-task notes). A `MENU` line of any kind (`byte-identical to baseline` included — from this task on MENU must pass) or a `:error` probe key means the fix is incomplete.
4. Leave the verified preview running (AGENTS.md); `npm run local:stop` stops it when you are done for the day.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/pages/other-income/components/AccountSearchDropdown.tsx apps/web/src/pages/other-income/components/__tests__/AccountSearchDropdown.test.tsx
# also add the guard file only if Step 6 changed it:
# git add apps/web/src/components/ui/field-guards.inventory.test.ts
git commit -F - <<'EOF'
fix(web): portal AccountSearchDropdown menu + keyboard (R1-2 S2-01/S2-02)

The account menu was an absolute panel that the other-income item card
(overflow-hidden) and the Override JV table box (overflow-x-auto) clipped.
It is now a Radix Popover portalled to body, as wide as the trigger
(min-w-64), with role=combobox/listbox/option, ArrowUp/Down via
aria-activedescendant, Enter to pick, Escape to close, blocked codes
shown with their reason and skipped by the keyboard, and wheel/touch
stopped so it scrolls inside modal dialogs. Props unchanged, so all four
callers are fixed without edits.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: one commit on the current branch. Do not push.

---

### Task 7: Width-class bug + bg-input fields + guard tests (R1-2, §4.2 items 7-8, S1-01, S3-02, S3-03)

**Why:** Tailwind 4.3 reads `w-[--radix-popover-trigger-width]` (the Tailwind 3 way of writing a bare CSS variable) as an invalid value, so the class has no effect. The dropdown menu then falls back to the `w-72` that `PopoverContent` sets by default (`apps/web/src/components/ui/popover.tsx:28`). The result is that the contact, supplier, employee and account-role menus are not as wide as their fields (S3-02, S3-03). In Tailwind 4 you write the same variable as `w-(--x)`.

Separately, `bg-input` is the **border** token (`--input: 34 12% 88%` light / `230 4% 22%` dark, `apps/web/src/index.css:304,368`). Used as a field background, it makes the dunning-rule dialog and the SMS template form look mid-grey and disabled, and the placeholder text is hard to read (S1-01).

This task adds two source-scan guards first, watches them fail, then fixes the files they list.

**Files:**
- Create: `apps/web/src/components/ui/field-guards.inventory.test.ts`. This is the shared guard file from the contract. If an earlier task already created it, keep its `describe` and helpers and add only the two `it()` blocks and the constants from Step 1.
- Modify: `apps/web/src/components/contacts/ContactCombobox.tsx:134`
- Modify: `apps/web/src/components/employees/EmployeeCombobox.tsx:70`
- Modify: `apps/web/src/pages/AccountRolesPage.tsx:288`
- Modify: `apps/web/src/pages/DunningSettingsPage.tsx`: the imports at lines 1-3, plus the 7 controls at lines 643, 659, 670, 691, 733, 748 and 762
- Modify: `apps/web/src/pages/SmsTemplatesPage/components/SmsTemplateForm.tsx`: the imports at lines 1-2, plus the controls at lines 87, 97, 131 and 157
- Test (existing, re-run): `apps/web/src/components/contacts/ContactCombobox.test.tsx`, `apps/web/src/components/employees/__tests__/EmployeeCombobox.test.tsx`

**Interfaces:**
- Consumes:
  - `formControlClass` and `formTextareaClass` from `apps/web/src/components/ui/form-styles.ts:5,10`.
  - `NativeSelect` from `apps/web/src/components/ui/native-select.tsx`. It already applies `formControlClass` at line 25, so removing the caller's `className` leaves exactly `formControlClass`.
  - `cn` from `@/lib/utils`.
  - `NumberInput` with `unstyled` from `apps/web/src/components/ui/NumberInput.tsx`. `unstyled` keeps only the caller's classes plus `tabular-nums`.
- Produces: `apps/web/src/components/ui/field-guards.inventory.test.ts`, containing `describe('field guards (source scan)')` with two `it()` blocks. Later tasks (for example the §4.2 item 5 NativeSelect guard in R1-3) add more `it()` blocks to this same file and reuse `listSourceFiles`, `repoPath` and `filesMatching`. No runtime exports change.
- Facts verified for the implementer:
  - `tailwind-merge` resolves `cn('z-50 w-72 … p-4', 'w-(--radix-popover-trigger-width) min-w-64 p-0')` to the new width. `w-72` is dropped.
  - `apps/web/src` contains 1,295 production source files, so the `> 500` sanity check holds.
  - The existing `native-select.inventory.test.ts` uses `path.relative()` without normalising, so it returns backslash paths on Windows. The new file normalises paths to `/` so that it passes on both Windows and Linux CI.

- [ ] **Step 1: Write the failing guard tests**

Create `apps/web/src/components/ui/field-guards.inventory.test.ts` with exactly this content:

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// Repo root, derived from this file (apps/web/src/components/ui) so the scan does
// not depend on the directory vitest was launched from.
const ROOT = resolve(__dirname, '../../../../..');
const WEB_SRC = resolve(ROOT, 'apps/web/src');
const SKIP_DIRS = new Set(['__tests__', 'test', 'tests', 'node_modules', 'dist']);
const SOURCE_FILE = /\.[jt]sx?$/;
const TEST_FILE = /[.-](test|spec|docs-spec)\.[jt]sx?$/;
// Plain text scan over the whole frontend tree; keep a generous ceiling so a busy
// CI runner cannot turn a guard test into a deploy blocker.
const SCAN_TIMEOUT_MS = 30_000;

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) listSourceFiles(file, out);
    } else if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      out.push(file);
    }
  }
  return out;
}

/** Repo-relative path with forward slashes — `relative()` returns backslashes on Windows. */
function repoPath(file: string): string {
  return relative(ROOT, file).split(sep).join('/');
}

/** Production files under apps/web/src whose text matches `pattern`, sorted. */
function filesMatching(pattern: RegExp): string[] {
  const files = listSourceFiles(WEB_SRC);
  // Guard against the scan silently walking the wrong tree and passing vacuously.
  expect(files.length).toBeGreaterThan(500);
  return files
    .filter((file) => pattern.test(readFileSync(file, 'utf8')))
    .map(repoPath)
    .sort();
}

// Tailwind 3 spelled a bare CSS variable as `w-[--x]`. Tailwind 4 reads that as the
// literal value `--x` (invalid CSS) and the class silently does nothing — popover menus
// fell back to w-72 instead of matching their trigger. Write `w-(--x)` (or `w-[var(--x)]`).
const BARE_CSS_VAR_ARBITRARY = /-\[--[a-z]/;

// `--input` is the border token. As a field background it renders mid-grey, so an
// editable field looks disabled. Fields use formControlClass (bg-background) instead.
const BG_INPUT = /(?<![\w-])bg-input\b/;
const BG_INPUT_ALLOWED = new Set([
  'apps/web/src/components/ui/switch.tsx', // switch track (unchecked state)
  'apps/web/src/components/ui/input-otp.tsx', // dark:bg-input/30 on the OTP slot
]);

describe('field guards (source scan)', () => {
  it(
    'never uses a Tailwind 3 bare CSS-variable arbitrary value such as w-[--x]',
    () => {
      expect(filesMatching(BARE_CSS_VAR_ARBITRARY)).toEqual([]);
    },
    SCAN_TIMEOUT_MS,
  );

  it(
    'uses bg-input only for the switch track and the OTP slot, never as a field background',
    () => {
      const offenders = filesMatching(BG_INPUT).filter((file) => !BG_INPUT_ALLOWED.has(file));
      expect(offenders).toEqual([]);
    },
    SCAN_TIMEOUT_MS,
  );
});
```

- [ ] **Step 2: Run the guards and watch them fail**

Run from the repo root in Git Bash:

```bash
npm run test --workspace=apps/web -- src/components/ui/field-guards.inventory.test.ts
```

Expected: `Tests  2 failed (2)`. Each test prints a diff that lists the offending files:

```
 FAIL  src/components/ui/field-guards.inventory.test.ts > field guards (source scan) > never uses a Tailwind 3 bare CSS-variable arbitrary value such as w-[--x]
- Expected
+ Received
- []
+ [
+   "apps/web/src/components/contacts/ContactCombobox.tsx",
+   "apps/web/src/components/employees/EmployeeCombobox.tsx",
+   "apps/web/src/pages/AccountRolesPage.tsx",
+ ]
 FAIL  … > uses bg-input only for the switch track and the OTP slot, never as a field background
+ [
+   "apps/web/src/pages/DunningSettingsPage.tsx",
+   "apps/web/src/pages/SmsTemplatesPage/components/SmsTemplateForm.tsx",
+ ]
```

A scan has already confirmed that these are the only matches. In particular, `pages/BookingsPage/components/CustomerCombobox.tsx:89` uses the valid form `w-[var(--radix-popover-trigger-width)]`, so it is not reported.

- [ ] **Step 3: Fix the menu width in ContactCombobox**

In `apps/web/src/components/contacts/ContactCombobox.tsx` at line 134, replace:

```tsx
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="ค้นหาผู้ติดต่อ / เลขภาษี..."
```

with:

```tsx
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="ค้นหาผู้ติดต่อ / เลขภาษี..."
```

- [ ] **Step 4: Fix the menu width in EmployeeCombobox**

In `apps/web/src/components/employees/EmployeeCombobox.tsx` at line 70, replace:

```tsx
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="ค้นหาพนักงาน (ชื่อ / ชื่อเล่น / รหัส)"
```

with:

```tsx
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="ค้นหาพนักงาน (ชื่อ / ชื่อเล่น / รหัส)"
```

- [ ] **Step 5: Fix the menu width in AccountRolesPage**

In `apps/web/src/pages/AccountRolesPage.tsx` at line 288, replace:

```tsx
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                <Command>
                  <CommandInput placeholder="ค้นหารหัส/ชื่อบัญชี..." />
```

with:

```tsx
              <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0">
                <Command>
                  <CommandInput placeholder="ค้นหารหัส/ชื่อบัญชี..." />
```

- [ ] **Step 6: Re-run the guards. Test (a) should now pass and test (b) should still fail**

```bash
npm run test --workspace=apps/web -- src/components/ui/field-guards.inventory.test.ts
```

Expected: `Tests  1 failed | 1 passed (2)`. The failing test is the `bg-input` one, and it still lists `DunningSettingsPage.tsx` and `SmsTemplateForm.tsx`.

- [ ] **Step 7: DunningSettingsPage (part 1 of 3): imports**

In `apps/web/src/pages/DunningSettingsPage.tsx` at lines 1-3, replace:

```tsx
import { NumberInput } from '@/components/ui/NumberInput';
import { NativeSelect } from '@/components/ui/native-select';
import { useId as useUiFieldId, useState, useRef } from 'react';
```

with:

```tsx
import { NumberInput } from '@/components/ui/NumberInput';
import { NativeSelect } from '@/components/ui/native-select';
import { formControlClass, formTextareaClass } from '@/components/ui/form-styles';
import { cn } from '@/lib/utils';
import { useId as useUiFieldId, useState, useRef } from 'react';
```

The steps below quote the original line numbers. After this step, every later line in this file is 2 lines further down.

- [ ] **Step 8: DunningSettingsPage (part 2 of 3): the rule name, trigger day and channel fields (original lines 638-671)**

Replace the rule-name input (original line 643):

```tsx
              placeholder="เช่น ทวงหนี้วันที่ 3"
              className="w-full px-3 py-2 rounded-md border border-border bg-input text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
```

with:

```tsx
              placeholder="เช่น ทวงหนี้วันที่ 3"
              className={formControlClass}
            />
```

Replace the trigger-day NumberInput (original lines 656-660):

```tsx
                onChange={(e) =>
                  handleFormChange('triggerDay', parseInt(e.target.value, 10) || 0)
                }
                className="w-full px-3 py-2 rounded-md border border-border bg-input text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
```

with:

```tsx
                onChange={(e) =>
                  handleFormChange('triggerDay', parseInt(e.target.value, 10) || 0)
                }
                className={formControlClass}
              />
```

Replace the channel NativeSelect (original lines 667-671). `NativeSelect` already applies `formControlClass`, so remove the `className` override entirely. The width stays on `wrapperClassName`.

```tsx
              <NativeSelect wrapperClassName="max-w-full w-full" id={`${uiFieldId}-3`}
                value={form.channel}
                onChange={(e) => handleFormChange('channel', e.target.value as DunningChannel)}
                className="px-3 py-2 rounded-md border border-border bg-input text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              >
```

with:

```tsx
              <NativeSelect wrapperClassName="max-w-full w-full" id={`${uiFieldId}-3`}
                value={form.channel}
                onChange={(e) => handleFormChange('channel', e.target.value as DunningChannel)}
              >
```

- [ ] **Step 9: DunningSettingsPage (part 3 of 3): the template, message, escalate and sort-order fields (original lines 688-763)**

Replace the SMS-template NativeSelect (original lines 688-692):

```tsx
              <NativeSelect wrapperClassName="max-w-full w-full" id={`${uiFieldId}-4`}
                value={form.templateName}
                onChange={(e) => handleFormChange('templateName', e.target.value)}
                className="px-3 py-2 rounded-md border border-border bg-input text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              >
```

with:

```tsx
              <NativeSelect wrapperClassName="max-w-full w-full" id={`${uiFieldId}-4`}
                value={form.templateName}
                onChange={(e) => handleFormChange('templateName', e.target.value)}
              >
```

Replace the message textarea (original lines 732-734). Keep `resize-none` and switch to the textarea style:

```tsx
              placeholder="ระบุข้อความ เช่น สวัสดีคุณ {{customerName}} ..."
              className="w-full px-3 py-2 rounded-md border border-border bg-input text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
```

with:

```tsx
              placeholder="ระบุข้อความ เช่น สวัสดีคุณ {{customerName}} ..."
              className={cn(formTextareaClass, 'resize-none')}
            />
```

Replace the escalate input (original lines 747-749):

```tsx
              placeholder="UUID ของ rule ปลายทาง"
              className="w-full px-3 py-2 rounded-md border border-border bg-input text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
```

with:

```tsx
              placeholder="UUID ของ rule ปลายทาง"
              className={formControlClass}
            />
```

Replace the sort-order NumberInput (original lines 759-763):

```tsx
              onChange={(e) =>
                handleFormChange('sortOrder', parseInt(e.target.value, 10) || 0)
              }
              className="w-full px-3 py-2 rounded-md border border-border bg-input text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
```

with:

```tsx
              onChange={(e) =>
                handleFormChange('sortOrder', parseInt(e.target.value, 10) || 0)
              }
              className={formControlClass}
            />
```

Check that no `bg-input` is left in this file:

```bash
grep -n "bg-input" apps/web/src/pages/DunningSettingsPage.tsx
```

Expected: no output, and exit code 1.

- [ ] **Step 10: SmsTemplateForm (all four fields)**

The file is `apps/web/src/pages/SmsTemplatesPage/components/SmsTemplateForm.tsx`.

Imports (lines 1-2). Replace:

```tsx
import { NativeSelect } from '@/components/ui/native-select';
import { useId as useUiFieldId, useEffect, useState } from 'react';
```

with:

```tsx
import { NativeSelect } from '@/components/ui/native-select';
import { formControlClass, formTextareaClass } from '@/components/ui/form-styles';
import { cn } from '@/lib/utils';
import { useId as useUiFieldId, useEffect, useState } from 'react';
```

Template name input (original lines 86-88). Replace:

```tsx
          placeholder="เช่น เตือนค่างวด D-3"
          className="w-full px-3 py-2 rounded-md border border-border bg-input text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
```

with:

```tsx
          placeholder="เช่น เตือนค่างวด D-3"
          className={formControlClass}
        />
```

Channel NativeSelect (original lines 94-98). Replace:

```tsx
          <NativeSelect wrapperClassName="max-w-full w-full" id={`${uiFieldId}-2`}
            value={channel}
            onChange={(e) => setChannel(e.target.value as SmsChannel)}
            className="px-3 py-2 rounded-md border border-border bg-input text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          >
```

with:

```tsx
          <NativeSelect wrapperClassName="max-w-full w-full" id={`${uiFieldId}-2`}
            value={channel}
            onChange={(e) => setChannel(e.target.value as SmsChannel)}
          >
```

Subject input (original lines 130-132). Replace:

```tsx
          placeholder="หัวข้อ (ใช้กับ SMS / ข้อความเกริ่น LINE)"
          className="w-full px-3 py-2 rounded-md border border-border bg-input text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
```

with:

```tsx
          placeholder="หัวข้อ (ใช้กับ SMS / ข้อความเกริ่น LINE)"
          className={formControlClass}
        />
```

Body textarea (original lines 156-158). Replace:

```tsx
          placeholder="สวัสดีคุณ {{customerName}} ค่างวด {{installmentNo}} ยอด {{amount}} บาท..."
          className="w-full px-3 py-2 rounded-md border border-border bg-input text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
        />
```

with:

```tsx
          placeholder="สวัสดีคุณ {{customerName}} ค่างวด {{installmentNo}} ยอด {{amount}} บาท..."
          className={cn(formTextareaClass, 'resize-none')}
        />
```

- [ ] **Step 11: Run the guards. Both should pass**

```bash
npm run test --workspace=apps/web -- src/components/ui/field-guards.inventory.test.ts
```

Expected: `Test Files  1 passed (1)` and `Tests  2 passed (2)`.

- [ ] **Step 12: Re-run the combobox tests that render the changed popovers**

```bash
npm run test --workspace=apps/web -- src/components/contacts/ContactCombobox.test.tsx src/components/employees/__tests__/EmployeeCombobox.test.tsx
```

Expected: `Test Files  2 passed (2)` and `Tests  5 passed (5)`. These are the same counts as the baseline run before the change.

- [ ] **Step 13: Type check and lint**

```bash
bash tools/check-types.sh web
npm run lint --workspace=apps/web
```

Expected: the type check prints `Web: OK`. ESLint exits 0, with no new errors in the 6 touched files.

- [ ] **Step 14: Check the result in the preview (light and dark)**

```bash
npm run local:preview
```

Open http://localhost:5195 and log in as `admin@bestchoice.com` / `admin1234`. Then make these checks:

1. Go to `/settings/comms/dunning` and click "เพิ่ม กฎ". The dialog "เพิ่ม กฎ ทวงหนี้" opens.
   - The seven fields are all the same height (44 px, `h-11`).
   - They use the normal field background (`bg-background`), not grey.
   - The placeholder "เช่น ทวงหนี้วันที่ 3" is readable.
   - The message box is taller (at least 96 px) and cannot be resized.

   Then switch to dark mode and check again.
2. Go to `/settings/comms/sms` and open the template form. The four fields should look the same as the fields in check 1.
3. Check the menu widths:
   - Go to `/expenses/new` and open the vendor picker (ContactCombobox, inside VendorCombobox). The menu should be exactly as wide as its field, and never narrower than 16rem (`min-w-64`).
   - On the same page, pick a payroll category so that the payroll lines appear. Open the employee picker (EmployeeCombobox) and check the same thing.
   - Go to `/settings/access/account-roles` and open the account picker (`#ar-coa-trigger`). Check the same thing.

When you are done, stop the preview with `npm run local:stop`.

- [ ] **Step 15: Commit**

```bash
git add apps/web/src/components/ui/field-guards.inventory.test.ts \
  apps/web/src/components/contacts/ContactCombobox.tsx \
  apps/web/src/components/employees/EmployeeCombobox.tsx \
  apps/web/src/pages/AccountRolesPage.tsx \
  apps/web/src/pages/DunningSettingsPage.tsx \
  apps/web/src/pages/SmsTemplatesPage/components/SmsTemplateForm.tsx
git commit -F - <<'EOF'
fix(web): popover menus match trigger width + fields stop using bg-input (R1-2)

- w-[--radix-popover-trigger-width] (Tailwind 3 syntax) is a no-op in Tailwind 4;
  ContactCombobox / EmployeeCombobox / AccountRolesPage now use
  w-(--radix-popover-trigger-width) min-w-64 (S3-02, S3-03)
- Dunning rule dialog (7 controls) and SMS template form use formControlClass /
  formTextareaClass instead of the border token bg-input (S1-01)
- field-guards.inventory.test.ts: source-scan guards for /-\[--[a-z]/ and
  bg-input outside ui/switch.tsx + ui/input-otp.tsx (§4.2 items 7-8)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: one new commit on `docs/dropdown-search-field-scale` that touches 6 files. Do not push.

**Gaps (not covered here):**
- The runtime checks for S1-01 (F1, field background colour) and S3-02 (menu width) need the field-scale runner, `tools/field-scale/check.mjs`, which another task builds. This task covers them only with the source-scan guards and the manual check in Step 14. The F1/F2 baseline comparison belongs in the runner task.
- On the NativeSelects, the caller's `className` is removed instead of being set to `className={formControlClass}`. The result is the same, because NativeSelect already applies `formControlClass` (`native-select.tsx:25`). The width classes stay on `wrapperClassName`.
- `native-select.inventory.test.ts` does not normalise the backslash paths it gets on Windows. That fix belongs to its own task.
- AccountSearchDropdown (§4.2 item 6, S2-01/S2-02) belongs to a different R1-2 task. It contains no `-[--` today, so these guards will not block that task.

---

### Task 8: Appendix ก confirmed fixes (R1-3 part 1)

Fixes the 13 rows of spec appendix ก that belong to PR R1-3 (S1-02, S1-03, S1-04, S1-05, S2-03, S2-04, S2-05, S2-07, S2-08, S3-04, S3-05, S3-07, S3-09). The work is split into four screen groups: A settings/admin, B operations, C other income, D expenses. Each group follows the same loop: failing test, minimal edit, the group's tests pass, the field-scale runner is compared against the baseline, commit.

This task does **not** clean every `NativeSelect className` in the touched files. That 62-point sweep and the scan guard in `field-guards.inventory.test.ts` belong to R1-3 part 2. Here we only remove a `className` when that select is part of the row being fixed. Labels are not moved to style A (`formLabelClass`) except in ChatbotFinanceKnowledge (S1-05), where the spec asks for the whole form. CompanySettings labels are left for R1-4, which owns the 9 forms that embed `AddressForm`.

**Files:**
- Modify: `apps/web/src/pages/CompanySettingsPage.tsx:226-231` and `:504-509` (S1-02)
- Modify: `apps/web/src/pages/InterestConfigPage.tsx:1` and `:557-565` (S1-03)
- Modify: `apps/web/src/pages/AuditLogsPage.tsx:2`, `:303-344` (S1-04)
- Modify: `apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx:3`, `:222-336` (S1-05)
- Modify: `apps/web/src/pages/RepossessionsPage.tsx:758-762` (S2-03)
- Modify: `apps/web/src/pages/StockTransfersPage.tsx:379-383`, `:539-543`, `:656-660` (S2-04)
- Modify: `apps/web/src/pages/TodosPage/components/TodoForm.tsx:475`, `:491` (S2-05)
- Modify: `apps/web/src/pages/PurchaseOrdersPage/components/wizard/PaymentSection.tsx:209`, `:244` (S2-08)
- Modify: `apps/web/src/pages/other-income/components/ItemsTable.tsx:1-3`, `:30-32`, `:109-195` (S2-07)
- Modify: `apps/web/src/components/expense-form-v4/ItemLinesSection.tsx:3`, `:113-118` (S3-04)
- Modify: `apps/web/src/components/expense-form-v4/AdjustmentSection.tsx:4`, `:131-157` (S3-05)
- Modify: `apps/web/src/components/expense-form-v4/PayrollLinesSection.tsx:712` (S3-07)
- Modify: `apps/web/src/components/expense-templates/RecurringBillDialog.tsx:263`, `:321-324`, `:351` (S3-09)
- Test (modify): `apps/web/src/pages/InterestConfigPage.vat.test.tsx:69-71`
- Test (modify): `apps/web/src/pages/RepossessionsPage.awaiting-repossession.test.tsx` (append describe at end, file is 221 lines)
- Test (modify): `apps/web/src/components/expense-form-v4/__tests__/PayrollLinesSection.test.tsx` (insert before line 383 `it('M3: ...`)
- Test (modify): `apps/web/src/components/expense-templates/RecurringBillDialog.test.tsx` (insert before line 196 `it('ผู้จัดการสาขาสร้างใหม่...`)
- Test (create): `apps/web/src/pages/CompanySettingsPage.vat-row.test.tsx`
- Test (create): `apps/web/src/pages/AuditLogsPage.filters.test.tsx`
- Test (create): `apps/web/src/pages/ChatbotFinanceKnowledgePage.form-fields.test.tsx`
- Test (create): `apps/web/src/pages/StockTransfersPage.filter-width.test.tsx`
- Test (create): `apps/web/src/pages/TodosPage/components/TodoForm.tags-frame.test.tsx`
- Test (create): `apps/web/src/pages/PurchaseOrdersPage/components/wizard/PaymentSection.test.tsx`
- Test (create): `apps/web/src/pages/other-income/components/__tests__/ItemsTable.fields.test.tsx`
- Test (create): `apps/web/src/components/expense-form-v4/__tests__/ItemLinesSection.readonly.test.tsx`
- Test (create): `apps/web/src/components/expense-form-v4/__tests__/AdjustmentSection.readonly.test.tsx`

**Interfaces:**
- Consumes:
  - `ReadOnlyField` from `apps/web/src/components/ui/readonly-field.tsx` (R1-2 task, shared contract). It renders `<Input readOnly tabIndex={-1} data-slot="readonly-field">`, and its props pass through to the `<input>` (`id`, `data-testid`, `className`). It accepts `value: string | number`, `align?: 'start'|'end'` (where `end` adds `text-right tabular-nums`) and `tone?: 'default'|'success'|'warning'`.
  - `formControlClass`, `formLabelClass`, `formTextareaClass` from `apps/web/src/components/ui/form-styles.ts` (existing).
  - `NativeSelect` `wrapperClassName` (existing).
  - `data-field-frame` / `data-field-embedded`, the attribute pair that `QtyStepper.tsx:19/23` already uses. The CSS in `styles/admin-typography.css:64-67` gives the embedded input `height:100%; min-height:0`, so the frame decides the height.
  - The field-scale runner `tools/field-scale/check.mjs` (`--label`, `--routes`, `--widths`, `--themes`, `--compare <baseline> <label>`) and the baseline at `.tmp/field-scale/baseline`, both from the R1-1 tasks.
- Produces: no new exports. Two user-facing copy changes, both in RecurringBillDialog:
  - Payment method option: "ไม่ตั้ง", with the helper below it "ไม่ตั้ง = ร่างลงเป็นตั้งหนี้ ต้องทำใบจ่ายเจ้าหนี้ต่อ".
  - Quarterly month options: "เดือนที่ N ของไตรมาส", with the helper "เดือนที่ 1 = ม.ค./เม.ย./ก.ค./ต.ค. · เดือนที่ 2 = ก.พ./พ.ค./ส.ค./พ.ย. · เดือนที่ 3 = มี.ค./มิ.ย./ก.ย./ธ.ค.".

**Route ids for the runner.** These are the ids defined in `tools/field-scale/routes.mjs` (Task 2); every command below uses them. Screenshots are `.tmp/field-scale/<label>/<route id>-<width>-<theme>.png`.

| Group | Route id | Path / opening step (`routes.mjs`) | Rows |
|---|---|---|---|
| A | `company-entity-edit` | `/settings/company/entities`, clicks "แก้ไข" (EditCompanyDialog) | S1-02 |
| A | `company-entity-create` | `/settings/company/entities`, clicks "เพิ่มนิติบุคคล" (AddCompanyDialog) | S1-02 |
| A | `interest-config-form` | `/settings/finance/interest`, clicks "+ สร้าง การตั้งค่า" — the same Modal/form as "แก้ไข" (`InterestConfigPage.tsx:477`; the mock returns no configs, so there is no "แก้ไข" row) | S1-03 |
| A | `audit-logs` | `/audit-logs` | S1-04 |
| A | `finance-knowledge-form` | `/chatbot-finance/knowledge`, clicks "+ เพิ่ม คำถามที่พบบ่อย" | S1-05 |
| B | `repossessions` | `/repossessions` | S2-03 |
| B | `stock-transfers-outgoing`, `stock-transfers-incoming`, `stock-transfers-history` | `/stock/transfers?view=outgoing\|incoming\|history` | S2-04 |
| B | `todo-form` | `/todos` (actor shown as BRANCH_MANAGER), clicks "เพิ่มงาน" | S2-05 |
| B | `purchase-order-wizard` | `/purchase-orders`: seeds the wizard's own localStorage draft (mocked supplier + one accessory line, "ของถึงแล้ว" mode), "+ ซื้อสินค้า" → "ถัดไป: ตรวจรับ 1 ชิ้น" → cash price → "ถัดไป: สรุป + จ่ายเงิน" → status "จ่ายครบแล้ว"; the PaymentSection file / URL / "+ เพิ่ม" row is scrolled into view. PaymentSection renders only in that mode's summary (`StepSummary.tsx:193`); nothing is submitted | S2-08 |
| C | `other-income-items` | `/other-income/new` (item card; also runs the account-menu probe) | S2-07 |
| D | `expense-new` | `/expenses/new` | S3-04, S3-05 |
| D | `payroll-new` | `/expenses/new?type=PR`, clicks "เพิ่มพนักงาน" → "ขยาย" → "เพิ่มรายได้พิเศษ" (first line expanded, one extra-income row) | S3-07 |
| D | `recurring-bill-dialog` | `/expenses/favorites`, clicks "+ บิลประจำ" | S3-09 |

Run all commands from the repo root in Git Bash. The web test script is `vitest run`. Test paths after `--` are relative to `apps/web`, and each one is a substring filter. Each `check.mjs --label …` command below must be preceded by `npm run local:preview` in the same step: this task's source edits make the preview stale and the runner then exits 2 (cross-task notes, "Refresh before every run"). `local:preview` restarts it (http://localhost:5195) and leaves it running.

---

#### Group A: settings and admin screens (S1-02, S1-03, S1-04, S1-05)

- [ ] **Step 1: Write the failing tests for group A**

Create `apps/web/src/pages/CompanySettingsPage.vat-row.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({
  default: { get: apiGet, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-owner', name: 'เจ้าของ', role: 'OWNER', branchId: null }, isLoading: false }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import CompanySettingsPage from './CompanySettingsPage';

const company = {
  id: 'co-1', nameTh: 'บริษัท ทดสอบ จำกัด', nameEn: null, taxId: null, companyCode: 'FINANCE',
  address: null, phone: null, vatRegistered: true, vatRate: 0.07, bankName: null,
  bankAccountName: null, bankAccountNumber: null, directorName: null, directorPosition: null, branches: [],
};

function open() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <CompanySettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// S1-02: ป้าย "สถานะ VAT" ต่ำกว่า "อัตรา VAT (%)" ~11px เพราะแถวเป็น items-center
function expectVatRowAligned() {
  const checkbox = screen.getByRole('checkbox', { name: 'จดทะเบียน VAT' });
  expect(checkbox.closest('label')).toHaveClass('min-h-11', 'items-center');
  const row = screen.getByText('สถานะ VAT').closest('div')?.parentElement;
  expect(row).toHaveClass('items-start');
  expect(row).not.toHaveClass('items-center');
}

describe('CompanySettingsPage — S1-02 แถว "สถานะ VAT / อัตรา VAT" ป้ายตรงแนว', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url: string) => ({ data: url === '/companies' ? [company] : [] }));
  });

  it('กล่องแก้ไขนิติบุคคล', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'แก้ไข' }));
    await screen.findByRole('dialog');
    expectVatRowAligned();
  });

  it('กล่องเพิ่มนิติบุคคล', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'เพิ่มนิติบุคคล' }));
    await screen.findByRole('dialog');
    expectVatRowAligned();
  });
});
```

Create `apps/web/src/pages/AuditLogsPage.filters.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ default: { get: apiGet }, getErrorMessage: (e: unknown) => String(e) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AuditLogsPage from './AuditLogsPage';

describe('AuditLogsPage — S1-04 ช่องกรองหน้าตาเดียวกัน', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url: string) => ({
      data: url === '/audit/logs'
        ? { data: [], total: 0 }
        : { todayCount: 0, weekCount: 0, totalCount: 0, recentErrors: 0 },
    }));
  });

  it('ช่อง "รายการ" ใช้ formControlClass (ขอบ border-input พื้น bg-background) · ช่องวันที่เว้นที่ให้ไอคอนปฏิทิน', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <AuditLogsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const entity = await screen.findByLabelText('รายการ');
    expect(entity).toHaveClass('rounded-lg', 'border-input', 'bg-background');
    // className เดิม "px-3" ทับ "pr-9" ของ ThaiDateInput (tailwind-merge) ⇒ ไอคอนทับตัวอักษร (F4)
    for (const label of ['จากวันที่', 'ถึงวันที่']) {
      expect(screen.getByLabelText(label)).toHaveClass('pr-9');
    }
  });
});
```

Create `apps/web/src/pages/ChatbotFinanceKnowledgePage.form-fields.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({
  default: { get: apiGet, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ChatbotFinanceKnowledgePage from './ChatbotFinanceKnowledgePage';

describe('ChatbotFinanceKnowledgePage — S1-05 ทั้งฟอร์มใช้ formControlClass + formLabelClass', () => {
  it('ทุกช่องหน้าตาเดียวกัน ป้ายแบบ A', async () => {
    apiGet.mockResolvedValue({ data: [] });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <ChatbotFinanceKnowledgePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /เพิ่ม คำถามที่พบบ่อย/ }));

    const single = [
      'รหัสความต้องการลูกค้า (ภาษาอังกฤษ)',
      'หมวดหมู่',
      'คำค้นที่ใช้จับคู่ (คั่นด้วยจุลภาค)',
      'ช่องทางที่ใช้ คำถามที่พบบ่อย นี้',
      'รูปแบบคำตอบ',
      'ลำดับความสำคัญ',
    ];
    for (const name of single) {
      const control = screen.getByLabelText(name);
      expect(control).toHaveClass('h-11', 'rounded-lg', 'border-input', 'bg-background');
      expect(document.querySelector(`label[for="${control.id}"]`)).toHaveClass('text-sm', 'font-medium', 'text-foreground', 'mb-3');
    }
    for (const name of ['ตัวอย่างคำถาม (บรรทัดละ 1 คำถาม)', 'แม่แบบคำตอบ']) {
      const area = screen.getByLabelText(name);
      expect(area).toHaveClass('min-h-24', 'rounded-lg', 'border-input', 'font-mono');
      expect(document.querySelector(`label[for="${area.id}"]`)).toHaveClass('mb-3');
    }
  });
});
```

In `apps/web/src/pages/InterestConfigPage.vat.test.tsx`, replace lines 69-71:

```tsx
    const vat = await screen.findByTestId('interest-vat-readonly');
    expect(vat).toHaveTextContent('7%');
    expect(screen.queryByLabelText('VAT (%)')).not.toBeInTheDocument();
```

with:

```tsx
    const vat = await screen.findByTestId('interest-vat-readonly');
    // S1-03 (R1-3): กล่อง VAT เตี้ยกว่าช่องข้าง ๆ → ReadOnlyField (input readOnly 44px) ผูกป้าย "VAT (%)" — ยังแก้ไม่ได้
    expect(vat).toHaveAttribute('data-slot', 'readonly-field');
    expect(vat).toHaveAttribute('readonly');
    expect(vat).toHaveValue('7%');
    expect(screen.getByLabelText('VAT (%)')).toBe(vat);
```

- [ ] **Step 2: Run the group A tests and confirm they fail**

```bash
npm run test --workspace=apps/web -- src/pages/CompanySettingsPage.vat-row.test.tsx src/pages/AuditLogsPage.filters.test.tsx src/pages/ChatbotFinanceKnowledgePage.form-fields.test.tsx src/pages/InterestConfigPage.vat.test.tsx
```

Expected: FAIL. The summary reads `Test Files  4 failed (4)` and `Tests  5 failed | 1 passed (6)`. The failures come from jest-dom:
- CompanySettings (both tests): `Expected the element to have class:` `min-h-11 items-center`, then `Received:` `flex items-center gap-2 cursor-pointer`.
- AuditLogs: `Expected the element to have class:` `rounded-lg border-input bg-background`, then `Received:` `w-full border rounded-lg px-3 py-2 text-sm`.
- ChatbotFinance: `Expected the element to have class:` `h-11 rounded-lg border-input bg-background`, then `Received:` `w-full px-3 py-2 border rounded-lg text-sm mt-1`.
- InterestConfig: `Expected the element to have attribute:` `data-slot="readonly-field"`, then `Received:` `null`.

The InterestConfig test `default card shows the FINANCE VAT...` still PASSES. It is the 1 passed.

- [ ] **Step 3: Make the group A edits**

**S1-02, `apps/web/src/pages/CompanySettingsPage.tsx` (edit dialog, lines 226-235).** Replace:

```tsx
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  สถานะ VAT
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.vatRegistered}
                    onChange={(e) => set('vatRegistered', e.target.checked)}
```

with:

```tsx
            <div className="flex items-start gap-4">
              <div className="flex-1">
                <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  สถานะ VAT
                </label>
                <label className="flex min-h-11 items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.vatRegistered}
                    onChange={(e) => set('vatRegistered', e.target.checked)}
```

**S1-02, same file (add dialog, lines 504-513).** Replace:

```tsx
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  สถานะ VAT
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.vatRegistered}
                    onChange={(e) => {
```

with:

```tsx
            <div className="flex items-start gap-4">
              <div className="flex-1">
                <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  สถานะ VAT
                </label>
                <label className="flex min-h-11 items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.vatRegistered}
                    onChange={(e) => {
```

**S1-03, `apps/web/src/pages/InterestConfigPage.tsx`.** After line 1 (`import { NumberInput } from '@/components/ui/NumberInput';`) add:

```tsx
import { ReadOnlyField } from '@/components/ui/readonly-field';
```

Then replace lines 557-565:

```tsx
                {/* #22 — อ่านอย่างเดียว: VAT ของการผ่อนมาจากบริษัท FINANCE (ช่องนี้ไม่ถูกบันทึก) */}
                <span className="block text-sm font-medium text-foreground mb-1">VAT (%)</span>
                <div
                  data-testid="interest-vat-readonly"
                  aria-readonly="true"
                  className={`${inputClass} border-input bg-muted text-muted-foreground`}
                >
                  {vat.percentText}
                </div>
```

with:

```tsx
                {/* #22 — อ่านอย่างเดียว: VAT ของการผ่อนมาจากบริษัท FINANCE (ช่องนี้ไม่ถูกบันทึก) · S1-03 สูงเท่าช่องข้าง ๆ */}
                <label htmlFor={`${uiFieldId}-vat`} className="block text-sm font-medium text-foreground mb-1">VAT (%)</label>
                <ReadOnlyField
                  id={`${uiFieldId}-vat`}
                  data-testid="interest-vat-readonly"
                  value={vat.percentText}
                />
```

**S1-04, `apps/web/src/pages/AuditLogsPage.tsx`.** Change four places:

1. After line 2 (`import { NativeSelect } from '@/components/ui/native-select';`) add:

   ```tsx
   import { formControlClass } from '@/components/ui/form-styles';
   ```

2. At lines 307-308, replace:

   ```tsx
                 placeholder="เช่น products, contracts..."
                 className="w-full border rounded-lg px-3 py-2 text-sm"
   ```

   with:

   ```tsx
                 placeholder="เช่น products, contracts..."
                 className={formControlClass}
   ```

3. At lines 315-317, replace:

   ```tsx
                 onChange={(e) => { setAction(e.target.value); setPage(1); }}
                 className="border rounded-lg px-3 py-2 text-sm"
               >
   ```

   with:

   ```tsx
                 onChange={(e) => { setAction(e.target.value); setPage(1); }}
               >
   ```

4. At lines 334-335, replace:

   ```tsx
                 onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                 className="w-full border rounded-lg px-3 py-2 text-sm"
   ```

   with:

   ```tsx
                 onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
   ```

   At lines 342-343, replace:

   ```tsx
                 onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                 className="w-full border rounded-lg px-3 py-2 text-sm"
   ```

   with:

   ```tsx
                 onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
   ```

   Without the override, `ThaiDateInput`'s own defaults (`border-input`, `rounded-lg`, `bg-background`, `pr-9`) apply.

**S1-05, `apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx`.**

1. After line 3 (`import { NativeSelect } from '@/components/ui/native-select';`) add:

   ```tsx
   import { formControlClass, formLabelClass, formTextareaClass } from '@/components/ui/form-styles';
   ```

2. Edit with `replace_all: true`. This changes the 7 form labels (lines 222, 233, 246, 257, 268, 300, 312). The leading `` `} `` keeps it from also matching the `<p>` at line 183.
   - old: `` `} className="text-xs text-muted-foreground">``
   - new: `` `} className={formLabelClass}>``

3. Edit with `replace_all: true`. This changes inputs at 227, 238, 251 and the `NumberInput` at 316. The closing quote keeps the `font-mono` textareas out.
   - old: `className="w-full px-3 py-2 border rounded-lg text-sm mt-1"`
   - new: `className={formControlClass}`

4. Edit with `replace_all: true`. This changes the textareas at 261 and 272.
   - old: `className="w-full px-3 py-2 border rounded-lg text-sm mt-1 font-mono"`
   - new: ``className={`${formTextareaClass} font-mono`}``

5. At lines 279-283, replace:

   ```tsx
                   <label htmlFor={`${uiFieldId}-6`} className="block text-sm font-medium text-foreground mb-1 leading-snug">
                     ช่องทางที่ใช้ คำถามที่พบบ่อย นี้
                   </label>
                   <NativeSelect wrapperClassName="max-w-full w-full" id={`${uiFieldId}-6`}
                     className="rounded-md border border-border bg-background px-3 py-2 text-sm"
   ```

   with:

   ```tsx
                   <label htmlFor={`${uiFieldId}-6`} className={formLabelClass}>
                     ช่องทางที่ใช้ คำถามที่พบบ่อย นี้
                   </label>
                   <NativeSelect wrapperClassName="max-w-full w-full" id={`${uiFieldId}-6`}
   ```

6. At lines 301-305, replace:

   ```tsx
                     <NativeSelect wrapperClassName="max-w-full w-full mt-1" id={`${uiFieldId}-7`}
                       value={form.responseType}
                       onChange={(e) => setForm({ ...form, responseType: e.target.value })}
                       className="px-3 py-2 border rounded-lg text-sm"
                     >
   ```

   with:

   ```tsx
                     <NativeSelect wrapperClassName="max-w-full w-full" id={`${uiFieldId}-7`}
                       value={form.responseType}
                       onChange={(e) => setForm({ ...form, responseType: e.target.value })}
                     >
   ```

7. At lines 319-320, replace:

   ```tsx
                   <div className="flex flex-col text-xs text-muted-foreground mt-1">
                     <label className="flex items-center gap-2 mt-2">
   ```

   with:

   ```tsx
                   <div className="flex flex-col justify-end gap-2 text-sm leading-snug text-foreground">
                     <label className="flex items-center gap-2">
   ```

8. At lines 328-331, replace:

   ```tsx
                     <label className="flex items-center gap-2 mt-1">
                       <input
                         type="checkbox"
                         checked={form.requiresAuth}
   ```

   with:

   ```tsx
                     <label className="flex items-center gap-2">
                       <input
                         type="checkbox"
                         checked={form.requiresAuth}
   ```

- [ ] **Step 4: Run the group A tests and the field-scale comparison**

```bash
npm run test --workspace=apps/web -- src/pages/CompanySettingsPage.vat-row.test.tsx src/pages/AuditLogsPage.filters.test.tsx src/pages/ChatbotFinanceKnowledgePage.form-fields.test.tsx src/pages/InterestConfigPage.vat.test.tsx
```

Expected: `Test Files  4 passed (4)` and `Tests  6 passed (6)`.

Refresh the preview (this group's edits made it stale), then measure:

```bash
npm run local:preview
node tools/field-scale/check.mjs --label t8-a --routes company-entity-edit,company-entity-create,interest-config-form,audit-logs,finance-knowledge-form --widths 1440,1024,390 --themes light,dark
node tools/field-scale/check.mjs --compare baseline t8-a
```

Expected:
- The compare exits 0, or every new P1/P2 is accepted under the compare triage rule (cross-task notes), and lists the baseline F1 findings for these files under "fixed":
  - CompanySettings VAT row label/bottom offset
  - AuditLogs "รายการ" border and background
  - ChatbotFinance 3-column row
- InterestConfig VAT (S1-03): the plain `<div>` was not measured at baseline, so there is no baseline key for it and nothing to list as fixed. It is measured for the first time as a `ReadOnlyField`. Acceptance: the row it now joins is fully consistent — zero F1 keys for that row in `.tmp/field-scale/t8-a/results.json` — and `interest-config-form-1440-light.png` compared with the baseline screenshot shows the VAT box at the same height as its neighbours.
- Open `.tmp/field-scale/t8-a/interest-config-form-1440-dark.png` and confirm the read-only VAT value is readable in dark mode (spec §9).

If the compare exits 1, triage the new findings under the compare triage rule (cross-task notes): fix every finding the rule does not accept, re-run, and record the accepted ones in the task report.

- [ ] **Step 5: Commit group A**

```bash
git add apps/web/src/pages/CompanySettingsPage.tsx apps/web/src/pages/InterestConfigPage.tsx apps/web/src/pages/AuditLogsPage.tsx apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx apps/web/src/pages/CompanySettingsPage.vat-row.test.tsx apps/web/src/pages/AuditLogsPage.filters.test.tsx apps/web/src/pages/ChatbotFinanceKnowledgePage.form-fields.test.tsx apps/web/src/pages/InterestConfigPage.vat.test.tsx && git commit -m "$(cat <<'EOF'
fix(web): field scale appendix ก — settings/admin rows (S1-02..S1-05)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

#### Group B: operations screens (S2-03, S2-04, S2-05, S2-08)

- [ ] **Step 6: Write the failing tests for group B**

Append to the end of `apps/web/src/pages/RepossessionsPage.awaiting-repossession.test.tsx`. Replace the final lines:

```tsx
    expect(screen.getByTestId('repo-overlay')).toHaveTextContent(
      'overlay:dr-1:TEST-20260919-001:สมชาย ใจดี',
    );
  });
});
```

with:

```tsx
    expect(screen.getByTestId('repo-overlay')).toHaveTextContent(
      'overlay:dr-1:TEST-20260919-001:สมชาย ใจดี',
    );
  });
});

describe('RepossessionsPage — S2-03 ตัวกรองสถานะไม่ยืดเต็มหน้า', () => {
  it('dropdown สถานะ: wrapper w-full บนมือถือ และ sm:w-56 ตั้งแต่จอ sm', async () => {
    routeApi([]);
    render(<RepossessionsPage />, { wrapper });
    const status = await screen.findByRole('combobox', { name: 'สถานะ' });
    const wrap = status.closest('[data-slot="native-select-wrapper"]');
    expect(wrap).toHaveClass('w-full', 'sm:w-56');
    expect(wrap).not.toHaveClass('w-auto');
  });
});
```

Create `apps/web/src/pages/StockTransfersPage.filter-width.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({
  default: { get: apiGet, post: vi.fn(), patch: vi.fn() },
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import StockTransfersPage from './StockTransfersPage';

describe('StockTransfersPage — S2-04 ตัวกรองไม่ยืดเต็มจอ ทั้ง 3 แท็บ', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue({ data: [] });
  });

  it.each([
    ['outgoing', 'สถานะ'],
    ['incoming', 'สาขา'],
    ['history', 'สาขา'],
  ])('แท็บ %s: dropdown "%s" wrapper = w-full sm:w-56', async (view, name) => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/stock/transfers?view=${view}`]}>
          <StockTransfersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const select = await screen.findByRole('combobox', { name });
    const wrap = select.closest('[data-slot="native-select-wrapper"]');
    expect(wrap).toHaveClass('w-full', 'sm:w-56');
    expect(wrap).not.toHaveClass('w-auto');
  });
});
```

Create `apps/web/src/pages/TodosPage/components/TodoForm.tags-frame.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({
  default: { get: apiGet, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TodoForm } from './TodoForm';

describe('TodoForm — S2-05 ช่องแท็กสูงเท่าช่องอื่น (44px)', () => {
  it('กรอบแท็กเป็น data-field-frame min-h-11 py-1 และช่องพิมพ์ข้างในเป็น data-field-embedded', () => {
    apiGet.mockResolvedValue({ data: [] });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <TodoForm open onOpenChange={() => {}} editing={null} staffUsers={[]} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const input = screen.getByLabelText('แท็ก');
    expect(input).toHaveAttribute('data-field-embedded');
    const frame = input.closest('[data-field-frame]');
    expect(frame).not.toBeNull();
    expect(frame).toHaveClass('min-h-11', 'py-1');
    expect(frame).not.toHaveClass('py-2');
  });
});
```

Create `apps/web/src/pages/PurchaseOrdersPage/components/wizard/PaymentSection.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PaymentSection } from './PaymentSection';

describe('PaymentSection — S2-08 ปุ่มเลือกรูป/เพิ่ม สูงเท่าช่องข้าง ๆ (44px)', () => {
  it('ปุ่ม "เลือกรูป" และ "+ เพิ่ม" ใช้ h-11', () => {
    render(
      <PaymentSection
        payment={{ paymentStatus: 'FULLY_PAID', paymentMethod: 'BANK_TRANSFER', paidAmount: '100', paymentNotes: '' }}
        onChange={() => {}}
        netAmount={100}
        attachmentUrl=""
        setAttachmentUrl={() => {}}
        attachments={[]}
        setAttachments={() => {}}
      />,
    );
    expect(screen.getByText('เลือกรูป').closest('label')).toHaveClass('h-11');
    expect(screen.getByRole('button', { name: '+ เพิ่ม' })).toHaveClass('h-11');
  });
});
```

- [ ] **Step 7: Run the group B tests and confirm they fail**

```bash
npm run test --workspace=apps/web -- src/pages/RepossessionsPage.awaiting-repossession.test.tsx src/pages/StockTransfersPage.filter-width.test.tsx src/pages/TodosPage/components/TodoForm.tags-frame.test.tsx src/pages/PurchaseOrdersPage/components/wizard/PaymentSection.test.tsx
```

Expected: FAIL, with 6 failing tests. All pre-existing Repossessions tests still pass. The failures come from jest-dom:
- The new S2-03 test and the 3 StockTransfers cases: `Expected the element to have class:` `w-full sm:w-56`, then `Received:` a class list that ends in `max-w-full w-auto`. Before the fix, tailwind-merge lets `w-auto` win over `w-full`.
- TodoForm: `Expected the element to have attribute:` `data-field-embedded`, then `Received:` `null`.
- PaymentSection: `Expected the element to have class:` `h-11`, then `Received:` a class list that contains `h-10`.

- [ ] **Step 8: Make the group B edits**

**S2-03, `apps/web/src/pages/RepossessionsPage.tsx` lines 758-762.** Replace:

```tsx
        <NativeSelect wrapperClassName="max-w-full w-auto" aria-label="สถานะ"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm bg-background focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
        >
```

with:

```tsx
        <NativeSelect wrapperClassName="w-full sm:w-56" aria-label="สถานะ"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
```

**S2-04, `apps/web/src/pages/StockTransfersPage.tsx` lines 379-383.** Replace:

```tsx
            <NativeSelect wrapperClassName="max-w-full w-auto" aria-label="สถานะ"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
            >
```

with:

```tsx
            <NativeSelect wrapperClassName="w-full sm:w-56" aria-label="สถานะ"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
```

**S2-04, same file, lines 539-543 and 656-660.** These two blocks are identical, so use one Edit with `replace_all: true`. Replace:

```tsx
            <NativeSelect wrapperClassName="max-w-full w-auto" aria-label="สาขา"
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="px-3 py-2 border border-input rounded-lg text-sm"
            >
```

with:

```tsx
            <NativeSelect wrapperClassName="w-full sm:w-56" aria-label="สาขา"
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
            >
```

**S2-05, `apps/web/src/pages/TodosPage/components/TodoForm.tsx`.**

At line 475, replace:

```tsx
              <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border border-input rounded-xl bg-card focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/50 transition-colors">
```

with:

```tsx
              <div data-field-frame className="flex min-h-11 flex-wrap items-center gap-1.5 px-3 py-1 border border-input rounded-xl bg-card focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/50 transition-colors">
```

At line 491, replace:

```tsx
                <input id={`${uiFieldId}-5`}
```

with:

```tsx
                <input id={`${uiFieldId}-5`} data-field-embedded
```

**S2-08, `apps/web/src/pages/PurchaseOrdersPage/components/wizard/PaymentSection.tsx`.** Spec ก gives `min-h-11`. These two controls have a fixed `h-10`, so the edit swaps `h-10` for `h-11` instead of adding a second height class. The result is the same 44px.

At line 209, replace:

```tsx
            <label className="inline-flex h-10 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-primary/30 bg-primary/10 px-3 text-sm text-primary hover:bg-primary/15 dark:bg-primary/15 dark:hover:bg-primary/20">
```

with:

```tsx
            <label className="inline-flex h-11 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-primary/30 bg-primary/10 px-3 text-sm text-primary hover:bg-primary/15 dark:bg-primary/15 dark:hover:bg-primary/20">
```

At line 244, replace:

```tsx
              className="h-10 whitespace-nowrap rounded-lg bg-secondary px-3 text-sm hover:bg-muted/50"
```

with:

```tsx
              className="h-11 whitespace-nowrap rounded-lg bg-secondary px-3 text-sm hover:bg-muted/50"
```

- [ ] **Step 9: Run the group B tests, the area's existing tests, and the field-scale comparison**

```bash
npm run test --workspace=apps/web -- src/pages/RepossessionsPage src/pages/StockTransfersPage.filter-width.test.tsx src/pages/TodosPage src/pages/PurchaseOrdersPage/components/wizard src/pages/PurchaseOrdersPage/components/ApprovePODialog.test.tsx
```

Expected: every file passes. This run covers:
- `RepossessionsPage.*.test.tsx` (3 files)
- `TodosPage/home-link.test.tsx`
- `StepItems`, `StepSummary` and `StepSupplier` tests, plus `ApprovePODialog.test.tsx`
- the 4 new test files

```bash
npm run local:preview
node tools/field-scale/check.mjs --label t8-b --routes repossessions,stock-transfers-outgoing,stock-transfers-incoming,stock-transfers-history,todo-form,purchase-order-wizard --widths 1440,1024,390 --themes light,dark
node tools/field-scale/check.mjs --compare baseline t8-b
```

Expected:
- The compare exits 0, or every new P1/P2 is accepted under the compare triage rule (cross-task notes). S2-05 (TodoForm tag) and S2-08 (PaymentSection 40px beside 44px) have no baseline F1 key: the tag input and the PaymentSection text input are each the only F1-eligible control in their row (the file `<label>` and the `+ เพิ่ม` button are not measured fields), and S2-05 also re-kinds the control to `field-frame`. Prove them with this group's vitest tests plus the screenshot comparison, not with the compare "fixed" list: `.tmp/field-scale/t8-b/purchase-order-wizard-1440-light.png` against `.tmp/field-scale/baseline/purchase-order-wizard-1440-light.png` (the route opens the receive-mode summary with status "จ่ายครบแล้ว" and scrolls the "เลือกรูป" / URL / "+ เพิ่ม" row into view — "เลือกรูป" and "+ เพิ่ม" now as tall as the URL input), and `todo-form-1440-light.png` likewise for the tag field.
- In `.tmp/field-scale/t8-b/repossessions-1440-light.png` and the `stock-transfers*-1440-light.png` screenshots, the filter dropdown is 224px wide, not page-wide.
- At 390 it is full width.

- [ ] **Step 10: Commit group B**

```bash
git add apps/web/src/pages/RepossessionsPage.tsx apps/web/src/pages/StockTransfersPage.tsx apps/web/src/pages/TodosPage/components/TodoForm.tsx apps/web/src/pages/PurchaseOrdersPage/components/wizard/PaymentSection.tsx apps/web/src/pages/RepossessionsPage.awaiting-repossession.test.tsx apps/web/src/pages/StockTransfersPage.filter-width.test.tsx apps/web/src/pages/TodosPage/components/TodoForm.tags-frame.test.tsx apps/web/src/pages/PurchaseOrdersPage/components/wizard/PaymentSection.test.tsx && git commit -m "$(cat <<'EOF'
fix(web): field scale appendix ก — filters, todo tags, PO slip buttons (S2-03/04/05/08)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

#### Group C: other income items (S2-07)

- [ ] **Step 11: Write the failing test for group C**

Create `apps/web/src/pages/other-income/components/__tests__/ItemsTable.fields.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import type { OtherIncomeFormValues } from '@/lib/otherIncome.schema';

vi.mock('../AccountSearchDropdown', () => ({ AccountSearchDropdown: () => <div data-testid="account-dropdown" /> }));

import { ItemsTable } from '../ItemsTable';

function Harness() {
  const { control, register, watch, setValue } = useForm<OtherIncomeFormValues>({
    defaultValues: {
      priceType: 'EXCLUSIVE',
      items: [{ accountCode: '42-1102', quantity: 2, unitAmount: 100, discountAmount: 0, vatPct: 0, whtPct: 1, description: '' }],
    } as unknown as OtherIncomeFormValues,
  });
  return <ItemsTable control={control} register={register} watch={watch} setValue={setValue} />;
}

describe('ItemsTable — S2-07 แถวตัวเลขหน้าตาเดียวกัน', () => {
  it('"ก่อนภาษี" เป็น ReadOnlyField ผูกป้าย · ช่องตัวเลขและคำอธิบายใช้ formControlClass', () => {
    render(<Harness />);
    const before = screen.getByLabelText('ก่อนภาษี');
    expect(before).toHaveAttribute('data-slot', 'readonly-field');
    expect(before).toHaveAttribute('readonly');
    expect(before).toHaveValue('200.00');
    expect(before).toHaveClass('text-right', 'tabular-nums');
    for (const name of ['จำนวน', 'ราคา/หน่วย', 'ส่วนลด']) {
      expect(screen.getByLabelText(name)).toHaveClass('h-11', 'rounded-lg', 'border-input', 'bg-background', 'text-right');
    }
    expect(screen.getByLabelText('คำอธิบาย')).toHaveClass('rounded-lg', 'border-input');
  });
});
```

Run:

```bash
npm run test --workspace=apps/web -- src/pages/other-income/components/__tests__/ItemsTable.fields.test.tsx
```

Expected: FAIL with `Found a label with the text of: ก่อนภาษี, however no form control was found associated to that label.`

- [ ] **Step 12: Make the group C edit and run the tests**

In `apps/web/src/pages/other-income/components/ItemsTable.tsx`:

1. At line 2, replace:

   ```tsx
   import { NativeSelect } from '@/components/ui/native-select';
   ```

   with:

   ```tsx
   import { NativeSelect } from '@/components/ui/native-select';
   import { ReadOnlyField } from '@/components/ui/readonly-field';
   import { formControlClass } from '@/components/ui/form-styles';
   import { cn } from '@/lib/utils';
   ```

2. At lines 30-32, replace:

   ```tsx
   function fmt(n: number) {
     return formatNumberDecimal(n, 2);
   }
   ```

   with:

   ```tsx
   function fmt(n: number) {
     return formatNumberDecimal(n, 2);
   }

   /** S2-07 — ช่องตัวเลขทั้งแถวใช้หน้าตาเดียวกับ dropdown ข้าง ๆ (formControlClass) ชิดขวา */
   const numberControlClass = cn(formControlClass, 'mt-1 text-right font-mono tabular-nums');
   ```

3. Edit with `replace_all: true`. This changes 3 occurrences (quantity, unitAmount, discountAmount).
   - old: `className="mt-1 w-full border rounded px-2 py-1.5 text-right font-mono bg-background"`
   - new: `className={numberControlClass}`

4. Edit with `replace_all: true`. This changes 2 occurrences (VAT% and WHT% `NativeSelect`).
   - old: `className="border rounded px-2 py-1.5 text-xs font-mono bg-background"`
   - new: `className="font-mono"`

5. At lines 181-184, replace:

   ```tsx
                     <label className="text-muted-foreground font-medium">ก่อนภาษี</label>
                     <div className="mt-1 w-full border rounded px-2 py-1.5 text-right font-mono bg-muted/40 text-foreground font-semibold">
                       {fmt(row?.amountBeforeVat ?? 0)}
                     </div>
   ```

   with:

   ```tsx
                     <label htmlFor={`${uiExtraFieldId}-7-${idx}`} className="text-muted-foreground font-medium">ก่อนภาษี</label>
                     <ReadOnlyField
                       id={`${uiExtraFieldId}-7-${idx}`}
                       align="end"
                       value={fmt(row?.amountBeforeVat ?? 0)}
                       className="mt-1 font-mono font-semibold"
                     />
   ```

6. At line 192, replace:

   ```tsx
                     className="mt-1 w-full border rounded px-2 py-1.5 text-xs bg-background"
   ```

   with:

   ```tsx
                     className={cn(formControlClass, 'mt-1')}
   ```

Run:

```bash
npm run test --workspace=apps/web -- src/pages/other-income
```

Expected: every file under `src/pages/other-income` passes. That includes the new `ItemsTable.fields.test.tsx`, `OtherIncomeDailySheetPage.test.tsx`, `AuditJournalTable.test.tsx`, `DateRangeChips.test.tsx`, `EditableJournalTable.test.ts`, `AutoJournalPreview.test.tsx` and `OverrideConfirmDialog.test.tsx`.

```bash
npm run local:preview
node tools/field-scale/check.mjs --label t8-c --routes other-income-items --widths 1440,1024,390 --themes light,dark
node tools/field-scale/check.mjs --compare baseline t8-c
```

Expected:
- The compare exits 0, or every new P1/P2 is accepted under the compare triage rule (cross-task notes). The S2-07 F1 findings of the measured controls are listed as fixed: the number inputs' light border next to the select's dark border.
- "ก่อนภาษี" (S2-07) was a plain `<div>` at baseline — not measured, so it has no baseline key and its height/font size cannot be listed as fixed. Acceptance: the item row it now joins as a `ReadOnlyField` is fully consistent — zero F1 keys for that row in `.tmp/field-scale/t8-c/results.json` — and `other-income-items-1440-light.png` compared with the baseline screenshot shows "ก่อนภาษี" at the same height and font size as the inputs beside it.
- In `.tmp/field-scale/t8-c/other-income-items-1440-dark.png` the read-only value is readable.

- [ ] **Step 13: Commit group C**

```bash
git add apps/web/src/pages/other-income/components/ItemsTable.tsx apps/web/src/pages/other-income/components/__tests__/ItemsTable.fields.test.tsx && git commit -m "$(cat <<'EOF'
fix(web): field scale appendix ก — other income item row uses ReadOnlyField + formControlClass (S2-07)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

#### Group D: expenses, payroll, recurring bills (S3-04, S3-05, S3-07, S3-09)

- [ ] **Step 14: Write the failing tests for group D**

Create `apps/web/src/components/expense-form-v4/__tests__/ItemLinesSection.readonly.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useCoa', () => ({ useCoaGroups: () => ({ data: { groups: [] } }) }));
vi.mock('@/hooks/useUiFlags', () => ({ useUiFlags: () => ({ whtRates: [] }) }));

import { ItemLinesSection } from '../ItemLinesSection';
import { newLine } from '../types';

describe('ItemLinesSection — S3-04 "ก่อนภาษี" สูงเท่าช่องข้าง ๆ', () => {
  it('เป็น ReadOnlyField ผูกป้าย ค่าชิดขวา ข้ามด้วย Tab', () => {
    render(
      <ItemLinesSection
        lines={[newLine({ quantity: '2', unitPrice: '150', discount: '0' })]}
        onChange={() => {}}
        priceTypeLabel="ไม่รวม VAT"
      />,
    );
    const before = screen.getByLabelText('ก่อนภาษี');
    expect(before).toHaveAttribute('data-slot', 'readonly-field');
    expect(before).toHaveAttribute('readonly');
    expect(before).toHaveAttribute('tabindex', '-1');
    expect(before).toHaveValue('300.00');
    expect(before).toHaveClass('text-right', 'tabular-nums');
  });
});
```

Create `apps/web/src/components/expense-form-v4/__tests__/AdjustmentSection.readonly.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useUiFlags', () => ({
  useUiFlags: () => ({ adjustmentCodes: { overpay: '53-1503', underpay: '52-1104' } }),
}));

import { AdjustmentSection } from '../AdjustmentSection';

describe('AdjustmentSection — S3-05 กล่องค่าสองกล่องเป็นช่องอ่านอย่างเดียวหน้าตาเดียวกับช่องจริง', () => {
  it('ยอดสุทธิ + ผลต่าง เป็น ReadOnlyField ผูกป้าย', () => {
    render(
      <AdjustmentSection
        diff="1.50"
        amountPaid=""
        onAmountPaidChange={() => {}}
        adjustments={[]}
        onChange={() => {}}
        netExpected="1234.50"
      />,
    );
    const net = screen.getByLabelText('ยอดสุทธิหลังหักภาษี ณ ที่จ่าย');
    expect(net).toHaveAttribute('data-slot', 'readonly-field');
    expect(net).toHaveValue('1,234.50');
    const diff = screen.getByLabelText('ผลต่างที่ต้องปรับ');
    expect(diff).toHaveAttribute('data-slot', 'readonly-field');
    expect(diff).toHaveValue('+1.50 (จ่ายเกิน → Cr)');
  });
});
```

In `apps/web/src/components/expense-form-v4/__tests__/PayrollLinesSection.test.tsx`, replace:

```tsx
  it('M3: the OT chip counts only attendance rows', () => {
```

with:

```tsx
  it('S3-07: คอลัมน์บัญชีของรายได้พิเศษกว้างอย่างน้อย 224px (min-w-56) — ชื่อบัญชีไม่ขาดกลางคำ', async () => {
    const user = userEvent.setup();
    const v = stored();
    v.lines[0].customIncome = [{ uid: 'c1', accountCode: 'S52-1204', name: 'เบี้ยขยัน', amount: '500', isTaxable: true, isAdjustment: false }];
    wrap(<Harness initial={v} />);
    await user.click(screen.getByRole('button', { name: 'ขยาย' }));
    const box = screen.getByText('+ รายได้พิเศษ (โบนัส / OT / เบี้ยเลี้ยง) — กรอกเอง').parentElement as HTMLElement;
    const header = within(box).getByRole('columnheader', { name: 'บัญชี' });
    expect(header).toHaveClass('min-w-56');
    expect(header).not.toHaveClass('w-40');
  });

  it('M3: the OT chip counts only attendance rows', () => {
```

In `apps/web/src/components/expense-templates/RecurringBillDialog.test.tsx`, replace:

```tsx
  it('ผู้จัดการสาขาสร้างใหม่: สาขาถูกล็อกเป็นสาขาตนเอง', async () => {
```

with:

```tsx
  it('S3-09: ตัวเลือก "วิธีจ่าย"/"เดือน" สั้น ไม่ถูกตัด — คำอธิบายอยู่ใต้ช่อง', async () => {
    const u = userEvent.setup();
    mount();
    await screen.findByRole('dialog');
    const pay = field('วิธีจ่าย') as HTMLSelectElement;
    expect(pay.options[0].textContent).toBe('ไม่ตั้ง');
    expect(screen.getByText('ไม่ตั้ง = ร่างลงเป็นตั้งหนี้ ต้องทำใบจ่ายเจ้าหนี้ต่อ')).toBeInTheDocument();
    await u.selectOptions(field('ความถี่'), 'QUARTERLY');
    const month = field('เดือน') as HTMLSelectElement;
    expect(Array.from(month.options).map((o) => o.textContent)).toEqual([
      '— เลือก —',
      'เดือนที่ 1 ของไตรมาส',
      'เดือนที่ 2 ของไตรมาส',
      'เดือนที่ 3 ของไตรมาส',
    ]);
    expect(
      screen.getByText('เดือนที่ 1 = ม.ค./เม.ย./ก.ค./ต.ค. · เดือนที่ 2 = ก.พ./พ.ค./ส.ค./พ.ย. · เดือนที่ 3 = มี.ค./มิ.ย./ก.ย./ธ.ค.'),
    ).toBeInTheDocument();
  });

  it('ผู้จัดการสาขาสร้างใหม่: สาขาถูกล็อกเป็นสาขาตนเอง', async () => {
```

The existing RecurringBillDialog tests select options by **value** (`'QUARTERLY'`, `'BANK_TRANSFER'`, `'br-1'`, `'br-2'`, `'53-1302'`, `'11-1201'`), not by option text, so no existing expectation changes. Line 75 asserts the validation error text, which still renders in place of the hint.

Run:

```bash
npm run test --workspace=apps/web -- src/components/expense-form-v4/__tests__/ItemLinesSection.readonly.test.tsx src/components/expense-form-v4/__tests__/AdjustmentSection.readonly.test.tsx src/components/expense-form-v4/__tests__/PayrollLinesSection.test.tsx src/components/expense-templates/RecurringBillDialog.test.tsx
```

Expected: FAIL, with exactly 4 failing tests and every pre-existing test passing:
- ItemLines: `Found a label with the text of: ก่อนภาษี, however no form control was found associated to that label.`
- Adjustment: the same message for `ยอดสุทธิหลังหักภาษี ณ ที่จ่าย`.
- S3-07 (jest-dom): `Expected the element to have class:` `min-w-56`, then `Received:` `text-left px-2 py-1 w-40`.
- S3-09: `expected 'ไม่ตั้ง — ร่างจะลงเป็นตั้งหนี้ ต้องทำใบจ่ายเจ้าหนี้ต่อ' to be 'ไม่ตั้ง'`.

- [ ] **Step 15: Make the group D edits**

**S3-04, `apps/web/src/components/expense-form-v4/ItemLinesSection.tsx`.**

At line 3, replace:

```tsx
import { formControlClass } from '@/components/ui/form-styles';
```

with:

```tsx
import { formControlClass } from '@/components/ui/form-styles';
import { ReadOnlyField } from '@/components/ui/readonly-field';
```

At lines 113-118, replace:

```tsx
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">ก่อนภาษี</label>
                <div className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-right font-mono text-sm">
                  {formatNumberDecimal(computeBeforeVat(line))}
                </div>
              </div>
```

with:

```tsx
              <div>
                <label htmlFor={`${fieldId}-${line.uid}-before-vat`} className="mb-1 block text-xs font-medium">ก่อนภาษี</label>
                <ReadOnlyField
                  id={`${fieldId}-${line.uid}-before-vat`}
                  align="end"
                  value={formatNumberDecimal(computeBeforeVat(line))}
                  className="font-mono"
                />
              </div>
```

**S3-05, `apps/web/src/components/expense-form-v4/AdjustmentSection.tsx`.**

At line 4, replace:

```tsx
import { formControlClass } from '@/components/ui/form-styles';
```

with:

```tsx
import { formControlClass } from '@/components/ui/form-styles';
import { ReadOnlyField } from '@/components/ui/readonly-field';
```

At lines 131-157, replace:

```tsx
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            ยอดสุทธิหลังหักภาษี ณ ที่จ่าย
          </label>
          <div className="rounded-md bg-muted px-3 py-2 text-sm font-mono tabular-nums text-foreground">
            {formatNumericText(netExpected || '0.00')}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            ผลต่างที่ต้องปรับ
          </label>
          <div
            className={`rounded-md px-3 py-2 text-sm font-mono tabular-nums ${
              Math.abs(diffNum) < 0.005
                ? 'bg-muted text-muted-foreground'
                : diffNum > 0
                  ? 'bg-success/10 text-success'
                  : 'bg-warning/10 text-warning-strong'
            }`}
          >
            {diffNum >= 0 ? '+' : ''}
            {formatNumericText(diffNum.toFixed(2))}
            {diffNum > 0.005 && ' (จ่ายเกิน → Cr)'}
            {diffNum < -0.005 && ' (จ่ายน้อย → Dr)'}
          </div>
        </div>
```

with:

```tsx
        <div>
          <label htmlFor={`${fieldId}-net`} className="block text-xs font-medium text-muted-foreground mb-1">
            ยอดสุทธิหลังหักภาษี ณ ที่จ่าย
          </label>
          <ReadOnlyField
            id={`${fieldId}-net`}
            value={formatNumericText(netExpected || '0.00')}
            className="font-mono tabular-nums"
          />
        </div>
        <div>
          <label htmlFor={`${fieldId}-diff`} className="block text-xs font-medium text-muted-foreground mb-1">
            ผลต่างที่ต้องปรับ
          </label>
          {/* S3-05 — สีบอกทิศผลต่างคงไว้ด้วย tone (ไม่ override className สีพื้น) */}
          <ReadOnlyField
            id={`${fieldId}-diff`}
            tone={Math.abs(diffNum) < 0.005 ? 'default' : diffNum > 0 ? 'success' : 'warning'}
            value={diffText}
            title={diffText}
            className="font-mono tabular-nums"
          />
        </div>
```

(Fix round 1, review of S3-05: at `md`/1024 a large amount clips the direction suffix inside the input, so the full text is also the `title`. `diffText` is a `const` declared after `adjustmentsActive`: the same template string `` `${diffNum >= 0 ? '+' : ''}${formatNumericText(diffNum.toFixed(2))}${diffNum > 0.005 ? ' (จ่ายเกิน → Cr)' : ''}${diffNum < -0.005 ? ' (จ่ายน้อย → Dr)' : ''}` ``. Test: "ผลต่าง มี title เท่าค่าเต็ม" in `AdjustmentSection.readonly.test.tsx`.)

**S3-07, `apps/web/src/components/expense-form-v4/PayrollLinesSection.tsx` line 712.** Replace:

```tsx
            <th className="text-left px-2 py-1 w-40">บัญชี</th>
```

with:

```tsx
            <th className="text-left px-2 py-1 min-w-56">บัญชี</th>
```

**S3-09, `apps/web/src/components/expense-templates/RecurringBillDialog.tsx`.**

At line 263, replace:

```tsx
      ? QUARTER_MONTHS_TH.map((months, i) => ({ value: String(i + 1), label: `เดือนที่ ${i + 1} ของไตรมาส (${months.join('/')})` }))
```

with:

```tsx
      ? QUARTER_MONTHS_TH.map((_months, i) => ({ value: String(i + 1), label: `เดือนที่ ${i + 1} ของไตรมาส` }))
```

At lines 321-324, replace:

```tsx
                <option value="">ไม่ตั้ง — ร่างจะลงเป็นตั้งหนี้ ต้องทำใบจ่ายเจ้าหนี้ต่อ</option>
                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </NativeSelect>
              {err('payment')}
```

with:

```tsx
                <option value="">ไม่ตั้ง</option>
                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </NativeSelect>
              {err('payment') ?? hint('ไม่ตั้ง = ร่างลงเป็นตั้งหนี้ ต้องทำใบจ่ายเจ้าหนี้ต่อ')}
```

At line 351, replace:

```tsx
              {err('recurringMonth') ?? hint('เปิดเมื่อเลือก ราย 3 เดือน (เดือนที่ 1/2/3 ของไตรมาส) หรือ รายปี (ม.ค.–ธ.ค.)')}
```

with:

```tsx
              {err('recurringMonth') ?? hint(
                form.recurrence === 'QUARTERLY'
                  ? QUARTER_MONTHS_TH.map((months, i) => `เดือนที่ ${i + 1} = ${months.join('/')}`).join(' · ')
                  : 'เปิดเมื่อเลือก ราย 3 เดือน (เดือนที่ 1/2/3 ของไตรมาส) หรือ รายปี (ม.ค.–ธ.ค.)',
              )}
```

(`_months` follows the ESLint `argsIgnorePattern: '^_'` in `apps/web/eslint.config.mjs`, so it gives no unused-var warning.)

(Fix round 1, review of S3-09: the hint `<p>` now carries the meaning, so it is linked to its control. In the shipped code `hint(key, text)` takes the `ErrorKey` first and renders `<p id={`${FIELD_IDS[key]}-hint`}>`, and `a11y(key, hinted = false)` sets `aria-describedby` to the error id and/or the hint id (hint id only while the hint is shown, i.e. no error). The `hint('…')` calls above therefore read `hint('payment', '…')` and `hint('recurringMonth', …)` in the file. New test: "คำอธิบายใต้ช่อง วิธีจ่าย/เดือน ผูกกับ select" using `toHaveAccessibleDescription`.)

- [ ] **Step 16: Run the group D tests, the area's existing tests, and the field-scale comparison**

```bash
npm run test --workspace=apps/web -- src/components/expense-form-v4 src/components/expense-templates src/pages/RecurringBillsPage
```

Expected: every file passes. This includes:
- the 2 new test files
- `PayrollLinesSection.test.tsx` (1 new test), `RecurringBillDialog.test.tsx` (2 new tests) and `AdjustmentSection.readonly.test.tsx` (2 tests in total)
- `ExpenseFormV4.payroll.test.tsx`, `DocTypePicker.payroll.test.tsx`, `PayrollReviewPanel.test.tsx`, `payroll-lines.test.ts`, `VendorCombobox.test.tsx`, `ApproverSection.test.tsx` and `RecurringBillsPage.test.tsx`

```bash
npm run local:preview
node tools/field-scale/check.mjs --label t8-d --routes expense-new,payroll-new,recurring-bill-dialog --widths 1440,1024,390 --themes light,dark
node tools/field-scale/check.mjs --compare baseline t8-d
```

Expected:
- The compare exits 0, or every new P1/P2 is accepted under the compare triage rule (cross-task notes). These findings are listed as fixed:
  - S3-07: F2 truncation of the payroll account select.
  - S3-09: F2 longest-option truncation on "วิธีจ่าย"/"เดือน".
- S3-04 ("ก่อนภาษี" 38px with a bottom offset) and S3-05 (ยอดสุทธิ / ผลต่าง value boxes with a different height, radius and border) were plain `<div>`s at baseline — not measured, so there are no baseline keys for them to list as fixed. Acceptance: each row they now join as `ReadOnlyField`s is fully consistent — zero F1 keys for those rows in `.tmp/field-scale/t8-d/results.json` — and `expense-new-1440-light.png` compared with the baseline screenshot shows the boxes at the same height, radius and border as their neighbours, bottoms aligned.
- Check `.tmp/field-scale/t8-d/expense-new-1440-dark.png` and confirm the S3-05 success/warning tones are readable in dark mode.

- [ ] **Step 17: Commit group D**

```bash
git add apps/web/src/components/expense-form-v4/ItemLinesSection.tsx apps/web/src/components/expense-form-v4/AdjustmentSection.tsx apps/web/src/components/expense-form-v4/PayrollLinesSection.tsx apps/web/src/components/expense-templates/RecurringBillDialog.tsx apps/web/src/components/expense-form-v4/__tests__/ItemLinesSection.readonly.test.tsx apps/web/src/components/expense-form-v4/__tests__/AdjustmentSection.readonly.test.tsx apps/web/src/components/expense-form-v4/__tests__/PayrollLinesSection.test.tsx apps/web/src/components/expense-templates/RecurringBillDialog.test.tsx && git commit -m "$(cat <<'EOF'
fix(web): field scale appendix ก — expense read-only boxes, payroll account column, recurring bill short options (S3-04/05/07/09)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

- [ ] **Step 18: Whole-task verification (Windows; `local:check` is not supported here)**

```bash
bash tools/check-types.sh web
npm run lint --workspace=apps/web
npm run test --workspace=apps/web
npm run local:preview
node tools/field-scale/check.mjs --label t8-all --routes company-entity-edit,company-entity-create,interest-config-form,audit-logs,finance-knowledge-form,repossessions,stock-transfers-outgoing,stock-transfers-incoming,stock-transfers-history,todo-form,purchase-order-wizard,other-income-items,expense-new,payroll-new,recurring-bill-dialog
node tools/field-scale/check.mjs --compare baseline t8-all
```

Expected:
- The type check reports 0 errors.
- Lint reports 0 errors. In particular, there are no unused imports: `formControlClass` in AuditLogs, `formTextareaClass` in ChatbotFinance, and `cn` in ItemsTable are all used.
- Every vitest file passes, including `native-select.inventory.test.ts`. No new raw `<select>` was added. That test skips test files and `__tests__`.
- The compare exits 0, or every new P1/P2 is accepted under the compare triage rule (cross-task notes). All 13 appendix rows are fixed: rows whose controls were measured at baseline are listed under "fixed"; S2-05 and S2-08 are proven by their vitest tests plus screenshots (no baseline F1 key — group B); S1-03, S2-07 "ก่อนภาษี", S3-04 and S3-05 (controls first measured in this task) are proven by zero F1 keys for their rows plus the screenshot comparison, as in the group A, C and D expectations.

If a finding is intentionally kept, add it with a Thai reason to `tools/field-scale/allow.json` and commit that file using the same commit format as above.

Record in the PR body what ran on Windows, and that the full `local:check` must run on Linux/CI. Do not push.

---

### Task 9: NativeSelect + sibling normalization per file + skin guard (R1-3 part 2)

Spec: `docs/superpowers/specs/2026-11-14-dropdown-search-field-scale-design.md` §4.2 item 5 (bullets 2-3) · §7 row R1-3 · §8.

**Why:** `NativeSelect` renders `cn(formControlClass, className, '<size tail>')` (`apps/web/src/components/ui/native-select.tsx:24-28`). A caller's `rounded-*`, `border-border`, `bg-*` or padding therefore overrides the shared skin. This task removes those overrides at every call site, file by file. Inputs in the same row that use the same old skin move to `formControlClass` (`apps/web/src/components/ui/form-styles.ts:5-8`). A third guard test then stops the pattern from coming back.

**The real inventory is bigger than the spec's estimate.** The spec says "62 sites, 26 with siblings". A read-only TypeScript-AST scan of the current tree (run while drafting this task) found **128 `NativeSelect` sites in 84 files** whose literal `className` carries skin tokens, plus **78 same-row sibling controls in 23 files** with the same skin. No `NativeSelect` site passes skin through `cn()` or a template literal; all 128 are plain string literals. There are 7 area steps (A, B, C1, C2, D, E, OWNED), and no step goes over ~17 files (spec §7: "แบ่งตามพื้นที่ถ้าเกิน ~15 ไฟล์").

**Rules the codemod applies (decided while drafting — review them, do not re-decide):**
- *Forbidden on NativeSelect* (the same regex as the guard): `rounded`, `rounded-*`, `border-border`, `bg-*`, `p-*`, `px-*`, `py-*`, `pl-*`, `pr-*`, with or without a variant prefix such as `hover:`.
- *Redundant, dropped with them:* `w-full`, `border`, `border-input`, `text-xs|sm|base|foreground`, `leading-snug|normal|tight`, `h-*`, `min-h-*`, `outline-hidden|none`, `shadow*`, `transition*`, `focus:*`, `focus-visible:*`, `hover:border-*`, `disabled:opacity-*`, `appearance-none`, `cursor-pointer`. These are either supplied by `formControlClass` or overridden by the NativeSelect tail (`h-11 min-h-11 … text-base lg:text-sm`).
- *Width on the select:* `w-*`, `min-w-*` and `max-w-*` in the select `className` are dropped, not moved. The tail already forces `w-full min-w-0 max-w-full` and tailwind-merge keeps the last value, so they had no effect. Moving them to `wrapperClassName` would change today's layout. Width that matters already lives on `wrapperClassName`, which this task does not touch. S2-03/S2-04 wrapper widths belong to T8.
- If nothing is left, the `className` attribute is removed. Otherwise the leftover tokens stay (only `font-medium` and `font-mono` are left anywhere).
- *Same-row sibling* = an `input`, `Input`, `NumberInput` or `ThaiDateInput` with a string-literal `className`. Its forbidden-token set must equal the select's, and it must sit inside the nearest grid or flex-row element at most 3 JSX elements above the select. Checkbox, radio, file, range, color and hidden inputs are skipped.
  - `input`, `Input` and `NumberInput` get `className={formControlClass}`, or `className={cn(formControlClass, '<kept tokens>')}`. Kept tokens: layout and typography (`text-right`, `font-mono`, `mt-1`, `flex-1`, `md:col-span-2`, `min-w-[260px]`…) plus icon gutters `pl-*`/`pr-*`.
  - `ThaiDateInput` only loses its overrides. Its base skin already equals the standard skin and carries the `pr-9` icon gutter that `formControlClass`'s `px-3` would destroy (`ThaiDateInput.tsx:204-207`). The 44px height comes from the central CSS (`styles/admin-typography.css:49-51`).
- *Imports:* when the file already has a named import from `…/form-styles` (e.g. `import { formLabelClass } from '@/components/ui/form-styles';`), `formControlClass` is added to it. Otherwise these lines are added after the last import: `import { formControlClass } from '@/components/ui/form-styles';` and, when `cn` is used and not imported, `import { cn } from '@/lib/utils';`.

**Ownership (T5/T7/T8 normalize their own files; the OWNED sweep in Step 7 only picks up what they left at HEAD):**
- **T5** owns `pages/TodosPage/components/TodoFilters.tsx` (`leadingIcon`) and `pages/SettingsPage/components/PeakMappingSettings.tsx` (`tone`). PeakMappingSettings has no forbidden tokens: `'border-warning'` is allowed.
- **T7** owns `pages/DunningSettingsPage.tsx` and `pages/SmsTemplatesPage/components/SmsTemplateForm.tsx` (§4.2 item 8, the `bg-input` guard).
- **T8** owns the appendix ก R1-3 files: `pages/CompanySettingsPage.tsx`, `pages/AuditLogsPage.tsx`, `pages/ChatbotFinanceKnowledgePage.tsx`, `pages/RepossessionsPage.tsx`, `pages/StockTransfersPage.tsx`, `pages/other-income/components/ItemsTable.tsx`, `components/expense-form-v4/ItemLinesSection.tsx`, `components/expense-form-v4/AdjustmentSection.tsx`, `components/expense-form-v4/PayrollLinesSection.tsx`, `components/expense-templates/RecurringBillDialog.tsx`, `pages/InterestConfigPage.tsx`, `pages/TodosPage/components/TodoForm.tsx` and `pages/PurchaseOrdersPage/components/wizard/PaymentSection.tsx`. Of the 10 OWNED files, only `PayrollLinesSection.tsx` (355, 372, 734), `RepossessionsPage.tsx` (1129), `TodoForm.tsx` (457, plus its same-row `<input>` at 446) and `TodoFilters.tsx` (86) still contain NativeSelect skin at HEAD (6 sites, 1 sibling, 4 files). AuditLogsPage, ChatbotFinanceKnowledgePage, StockTransfersPage, ItemsTable, DunningSettingsPage and SmsTemplateForm are clean (`ItemsTable` keeps only `font-mono`, lines 144/166).

**Files:**
- Create (throwaway, git-ignored by `.gitignore:23-24`): `.tmp/t9-normalize.cjs`, `.tmp/t9-areas.sh`
- Modify (74 files, all under `apps/web/src/`; exact lines in the per-area tables in Steps 8–25):
  - area A, inbox/chat: 8 files
  - area B, sales/stock/products/trade-in/suppliers: 17
  - area C1, accounting/closing/equity/reports: 12
  - area C2, payments/expenses/cash: 12
  - area D, settings/admin/editors: 10
  - area E, customers/contracts/collections/credit: 15
- Modify (Step 7, 4 files): `pages/TodosPage/components/TodoFilters.tsx`, `pages/RepossessionsPage.tsx`, `components/expense-form-v4/PayrollLinesSection.tsx`, `pages/TodosPage/components/TodoForm.tsx` (all under `apps/web/src/`)
- Test (modify, created by T7): `apps/web/src/components/ui/field-guards.inventory.test.ts`. This task appends the third guard (a new `describe` at the end of the file).

**Interfaces:**
- Consumes:
  - `formControlClass` (`apps/web/src/components/ui/form-styles.ts:5`) and `cn` (`@/lib/utils`).
  - `NativeSelect` (`apps/web/src/components/ui/native-select.tsx`, public API unchanged; T5 adds `leadingIcon`/`tone`).
  - From T7's `field-guards.inventory.test.ts`: `ROOT`, `listSourceFiles`, `SCAN_TIMEOUT_MS`, with the same meaning as `native-select.inventory.test.ts:8-33`.
  - From T2: the CLI `node tools/field-scale/check.mjs --label <name>` and `--compare <baselineLabel> <label>` (exit 1 when new P1/P2 findings appear).
- Produces:
  - Guard `describe('NativeSelect skin guard')`: no `NativeSelect` `className` (string literal, `cn()`/`clsx()` string args, `?:`/`&&`/`||` operands, template-literal text) may contain `rounded*`, `border-border`, `bg-*`, `p-*`, `px-*`, `py-*`, `pl-*` or `pr-*`.
  - All 128 sites and 78 siblings normalized.

#### Inventory (scan of the current tree; line = the `className=` line; "area" T5/T7/T8 = owned by that task)

| # | area | file (under `apps/web/src/`) | NativeSelect `className=` line → offending tokens | same-row siblings sharing the skin (line `<tag>`) |
|---|---|---|---|---|
| 1 | A | `pages/RichMenuPage.tsx` | 201 `rounded-lg bg-background px-3 py-2` | — |
| 2 | A | `pages/UnifiedInboxPage/components/ChatLibraryPicker.tsx` | 288 `rounded-md bg-background px-2` | — |
| 3 | A | `pages/UnifiedInboxPage/components/FacebookCommentLink.tsx` | 106 `rounded-md bg-background px-2` | — |
| 4 | A | `pages/UnifiedInboxPage/components/FacebookCommentPageSettings.tsx` | 168 `rounded-md bg-background px-2` | — |
| 5 | A | `pages/UnifiedInboxPage/components/FacebookCommentPanel.tsx` | 110 `rounded-md bg-background px-3` | — |
| 6 | A | `pages/UnifiedInboxPage/components/SalesDispositionControl.tsx` | 97 `rounded-md bg-background px-3` | — |
| 7 | A | `pages/canned-response-admin/QuickReplyEditor.tsx` | 60 `border-border rounded px-2 py-1 bg-background`<br>88 `border-border rounded px-2 py-1 bg-background` | — |
| 8 | A | `pages/canned-response-admin/bubble-editors/CardBubbleEditor.tsx` | 74 `border-border rounded px-1.5 py-1 bg-background` | — |
| 9 | B | `components/trade-in/TradeInCreditPicker.tsx` | 26 `rounded-lg bg-background px-3` | — |
| 10 | B | `pages/AfterSalesPage.tsx` | 173 `rounded-lg bg-background px-3` | — |
| 11 | B | `pages/ImportedSalesPage.tsx` | 65 `border-border bg-background rounded-md px-3 py-2` | — |
| 12 | B | `pages/InspectionPage.tsx` | 130 `px-4 py-2.5 rounded-lg bg-background` | — |
| 13 | B | `pages/PricingTemplatesPage.tsx` | 306 `px-3 py-2 rounded-lg`<br>312 `px-3 py-2 rounded-lg`<br>406 `rounded-lg bg-background p-2`<br>450 `px-3 py-2 rounded-lg` | 324 `<input>`, 442 `<input>` |
| 14 | B | `pages/ProductDetailPage/components/EditProductModal.tsx` | 106 `px-3 py-2 rounded-lg`<br>118 `px-3 py-2 rounded-lg`<br>261 `px-3 py-2 rounded-lg` | 277 `<NumberInput>` |
| 15 | B | `pages/ProductDetailPage/components/OnlineListingPanel.tsx` | 350 `rounded-lg bg-background px-3` | — |
| 16 | B | `pages/ProductDetailPage/index.tsx` | 608 `px-3 py-2 rounded-lg` | — |
| 17 | B | `pages/PromotionsPage.tsx` | 348 `rounded-md bg-background px-3` | — |
| 18 | B | `pages/StockAlertsPage.tsx` | 444, 455, 592, 604, 624, 639, 654 — each `px-3 py-2 rounded-lg` | — |
| 19 | B | `pages/StockCountPage.tsx` | 187 `px-3 py-2 rounded-lg` | — |
| 20 | B | `pages/StockPage/components/BulkTransferModal.tsx` | 63 `px-3 py-2 rounded-lg` | — |
| 21 | B | `pages/SuppliersPage/components/SupplierForm.tsx` | 263 `px-3 rounded-lg bg-background`<br>533 `px-3 rounded-lg bg-background` | 284, 298, 312, 321, 331, 346, 365 `<input>`, 554 `<NumberInput>`, 568, 581, 595 `<input>` |
| 22 | B | `pages/TradeInPage/components/AcceptModal.tsx` | 159 `rounded-lg bg-background px-3` | — |
| 23 | B | `pages/TradeInPage/components/QuestionnaireTab.tsx` | 243 `rounded-lg bg-background px-2` | — |
| 24 | B | `pages/TradeInPage/components/ReferenceQuestionnaire.tsx` | 40 `rounded-lg bg-background px-3` | — |
| 25 | B | `pages/TradeInPage/components/ValuationsTab.tsx` | 198 `rounded-lg bg-background px-3` | — |
| 26 | C1 | `components/accounting/ReverseConfirmDialog.tsx` | 170 `rounded-md bg-background px-3 py-2` | — |
| 27 | C1 | `pages/CommissionsPage.tsx` | 561 `px-3 py-2 rounded-lg`<br>608 `px-3 py-2 rounded-lg` | 554 `<input>`, 601 `<input>` |
| 28 | C1 | `pages/MonthlyClosePage.tsx` | 383 `px-3 py-2 rounded-lg` | — |
| 29 | C1 | `pages/PeakSyncPage.tsx` | 143 `rounded-lg px-3 py-2 bg-background` | — |
| 30 | C1 | `pages/ReportsPage.tsx` | 542 `px-3 border-border rounded-lg bg-background` | — |
| 31 | C1 | `pages/YearEndClosingPage.tsx` | 210 `rounded-md bg-background px-3` | — |
| 32 | C1 | `pages/accounting/PeriodClosePage.tsx` | 194 `border-border rounded-md px-3 py-1.5 bg-background` | — |
| 33 | C1 | `pages/accounting/TaxDisallowedSummaryPage.tsx` | 75 `rounded-lg bg-background px-3 py-2` | — |
| 34 | C1 | `pages/equity/DividendRegisterPage.tsx` | 71, 83 — each `border-border rounded-md px-3 py-2 bg-background` | — |
| 35 | C1 | `pages/equity/EquityEntryPage.tsx` | 258 `border-border rounded-md px-3 py-2 bg-background`<br>292 `border-border rounded-md px-2 py-2 bg-background`<br>385 `border-border rounded-md px-3 py-2 bg-background` | 219, 227, 237, 247 `<input>`, 306, 313, 325, 337 `<NumberInput>`, 397 `<input>`, 406 `<NumberInput>` |
| 36 | C1 | `pages/equity/EquityListPage.tsx` | 80, 200 — each `border-border rounded-md px-3 py-2 bg-background` | 68 `<input>`, 74 `<input>` |
| 37 | C1 | `pages/interco/CreateBatchDialog.tsx` | 225, 239 — each `rounded-md bg-background px-3` | — |
| 38 | C2 | `components/expense-form-v4/PettyCashLinesSection.tsx` | 136 `rounded-md bg-background px-2 py-1` | — |
| 39 | C2 | `components/expense-form-v4/SettlementLinesSection.tsx` | 183 `px-3 py-2 rounded-lg bg-background` | 194 `<NumberInput>` |
| 40 | C2 | `components/payment/SlipReviewTab.tsx` | 641 `rounded-lg px-3 py-2` | 618 `<NumberInput>`, 629 `<NumberInput>` |
| 41 | C2 | `pages/ExpenseDailySummaryPage.tsx` | 180 `px-3 py-2 rounded-lg bg-background` | — |
| 42 | C2 | `pages/ExpenseFavoritesPage.tsx` | 116 `px-3 py-2 rounded-lg bg-background` | — |
| 43 | C2 | `pages/FinanceReceivablePage/FinanceContactLogDialog.tsx` | 80 `px-3 py-2 rounded-lg bg-background` | — |
| 44 | C2 | `pages/PaymentsPage/components/PaymentModals.tsx` | 368 `px-3 py-2 rounded-lg` | — |
| 45 | C2 | `pages/PaymentsPage/components/ReceiptsTab.tsx` | 346 `px-3 py-2 rounded-lg` | 341 `<input>`, 358 `<ThaiDateInput>`, 364 `<ThaiDateInput>` |
| 46 | C2 | `pages/PaymentsPage/components/RecordPaymentWizard.tsx` | 1062 `rounded-lg border-border bg-background px-2 py-1.5` | — |
| 47 | C2 | `pages/ShopDailyCashPage.tsx` | 177 `rounded-lg bg-background px-3` | — |
| 48 | C2 | `pages/ShopPettyCashPage/components/MovementsTable.tsx` | 90 `rounded-lg bg-background px-3` | — |
| 49 | C2 | `pages/other-income/OtherIncomeEntryPage.tsx` | 808 `rounded-md px-3 py-2 bg-background` | 786 `<input>`, 801 `<input>` |
| 50 | D | `components/CompanyFilter.tsx` | 43 `px-3 py-2 rounded-lg` | — |
| 51 | D | `components/template-editor/editor/BlockEditModal.tsx` | 94 `px-3 py-2.5 rounded-lg` | 111 `<input>`, 121 `<input>` |
| 52 | D | `components/template-editor/layout/HeaderBar.tsx` | 109 `px-3 py-2 rounded-lg bg-background` | — |
| 53 | D | `components/ui/RichTextEditor.tsx` | 272, 286 — each `px-1.5 py-1 border-border rounded bg-card hover:bg-muted` | — |
| 54 | D | `pages/DocumentDashboardPage.tsx` | 110 `rounded-lg px-3 py-2 bg-background` | — |
| 55 | D | `pages/NotificationsPage/components/NotificationLogTable.tsx` | 117, 127 — each `px-3 py-2 rounded-lg` | — |
| 56 | D | `pages/NotificationsPage/components/TemplateForm.tsx` | 515, 529, 545 — each `px-3 py-2 rounded-lg` | — |
| 57 | D | `pages/NotificationsPage/components/TemplateManager.tsx` | 97 `px-3 py-2 rounded-lg` | — |
| 58 | D | `pages/PDPAPage.tsx` | 328, 418 — each `px-3 py-2 rounded-lg` | — |
| 59 | D | `pages/settings/SettingsLayout.tsx` | 116 `rounded-lg border-border bg-background py-2 px-3` | — |
| 60 | E | `components/contacts/CreateContactModal.tsx` | 264 `rounded-lg bg-background px-2` (was `rounded-md` at `b58250bbe`; Task 3 fix round 1 made it `rounded-lg` to match the 8px name `Input` — still forbidden, so still normalised here) | — |
| 61 | E | `components/contract/CreditCheckPanel.tsx` | 306 `px-3 py-1.5 rounded-lg` | 319 `<input>` |
| 62 | E | `components/contract/CustomerEditModal.tsx` | 319 `px-3 py-2 rounded-lg bg-background`<br>445 `px-3 py-2 rounded-lg`<br>758 `px-3 py-2 rounded-lg bg-background`<br>825 `px-3 py-2 rounded-lg bg-background` | 341, 357 `<input>`, 371 `<ThaiDateInput>`, 472, 514, 530, 545, 560, 582, 597, 612, 655, 670, 685 `<input>`, 700 `<NumberInput>`, 780, 795, 810 `<input>` |
| 63 | E | `components/credit-check/CreditCheckCreateModal.tsx` | 358 `px-3 py-2 rounded-lg` | — |
| 64 | E | `components/credit-check/CreditCheckOverrideDialog.tsx` | 185, 223, 242 — each `px-3 rounded-lg bg-background` | — |
| 65 | E | `pages/CollectionsPage/components/CollectionsFilters.tsx` | 52 `px-3 py-2 bg-card rounded-lg` | 46 `<input>` |
| 66 | E | `pages/CollectionsPage/components/LegalCaseDialog.tsx` | 228 `rounded-md border-border bg-background px-2 py-2` | — |
| 67 | E | `pages/CollectionsPage/components/SendLineAdHocDialog.tsx` | 130 `px-3 py-2 rounded-lg` | — |
| 68 | E | `pages/CollectionsPage/components/StuckContractsSection.tsx` | 219 `px-3 rounded-md bg-background` | — |
| 69 | E | `pages/CollectionsPage/tabs/AllTab.tsx` | 283, 292 — each `px-3 py-2 rounded-lg` | 229 `<input>` |
| 70 | E | `pages/ContractCreatePage/components/CustomerCreateModal.tsx` | 202 `px-3 py-2 rounded-lg bg-background`<br>584 `px-3 py-2 rounded-lg`<br>688 `px-3 py-2 rounded-lg bg-background`<br>755 `px-3 py-2 rounded-lg bg-background` | 569 `<input>`, 615 `<input>`, 630 `<NumberInput>` |
| 71 | E | `pages/ContractCreatePage/components/PlanDetailsStep.tsx` | 204, 233 — each `px-3 py-2 rounded-lg` | — |
| 72 | E | `pages/ContractDetailPage.tsx` | 1132 `px-3 py-2 rounded-lg` | 1063, 1080, 1097, 1115 `<NumberInput>` |
| 73 | E | `pages/ContractsPage.tsx` | 301 `rounded-md bg-background px-2` | — |
| 74 | E | `pages/CustomerDetailPage/components/EditCustomerDialog.tsx` | 245, 669, 736 — each `px-3 rounded-lg bg-background` | 267, 283 `<input>`, 297 `<ThaiDateInput>`, 691, 706, 721 `<input>` |
| 75 | T8 | `components/expense-form-v4/PayrollLinesSection.tsx` | 355, 372 — each `px-3 py-2 rounded-lg bg-background`<br>734 `px-1.5 py-1 rounded bg-background` | — |
| 76 | T8 | `pages/AuditLogsPage.tsx` | 316 `rounded-lg px-3 py-2` | 308 `<input>`, 335 `<ThaiDateInput>`, 343 `<ThaiDateInput>` |
| 77 | T8 | `pages/ChatbotFinanceKnowledgePage.tsx` | 283 `rounded-md border-border bg-background px-3 py-2`<br>304 `px-3 py-2 rounded-lg` | 316 `<NumberInput>` |
| 78 | T7 | `pages/DunningSettingsPage.tsx` | 670, 691 — each `px-3 py-2 rounded-md border-border bg-input` | 659 `<NumberInput>` |
| 79 | T8 | `pages/RepossessionsPage.tsx` | ~~761~~ (done by T8)<br>1129 `px-3 py-2 rounded-lg` | — |
| 80 | T7 | `pages/SmsTemplatesPage/components/SmsTemplateForm.tsx` | 97 `px-3 py-2 rounded-md border-border bg-input` | — |
| 81 | T8 | `pages/StockTransfersPage.tsx` | 382, 542, 659 — each `px-3 py-2 rounded-lg` | — |
| 82 | T5 | `pages/TodosPage/components/TodoFilters.tsx` | 86 `py-2.5 bg-card rounded-xl` (`pl-9 pr-8` went to `leadingIcon`) | — |
| 83 | T8 | `pages/TodosPage/components/TodoForm.tsx` | 457 `px-4 py-2.5 rounded-xl bg-card` | 446 `<input>` |
| 84 | T8 | `pages/other-income/components/ItemsTable.tsx` | ~~138, 160~~ (done by T8; only `font-mono` is left, lines 144/166) | — |

Totals at drafting: 128 NativeSelect sites · 78 same-row siblings · 84 files. Owned (T5/T7/T8): 18 sites and 6 siblings in 10 files. This task's areas: 110 sites and 72 siblings in 74 files.

**At HEAD** (codemod dry-run over every file that renders `<NativeSelect`): 116 sites · 73 siblings · 78 files. The areas A–E are unchanged (110 / 72 / 74). T5/T7/T8 already normalized 12 of their 18 sites (rows 76, 77, 78, 80, 81, 84 and `RepossessionsPage` 761 are clean). What is left in the owned files is 6 sites and 1 sibling in 4 files (rows 75, 79, 82, 83), handled in Step 7.

---

- [ ] **Step 1: Preflight — confirm the tasks this one depends on have landed**

Run from the repo root in Git Bash:
```bash
git branch --show-current
ls apps/web/src/components/ui/field-guards.inventory.test.ts tools/field-scale/check.mjs
grep -n "leadingIcon" apps/web/src/components/ui/native-select.tsx apps/web/src/pages/TodosPage/components/TodoFilters.tsx
grep -n "bg-input" apps/web/src/pages/DunningSettingsPage.tsx apps/web/src/pages/SmsTemplatesPage/components/SmsTemplateForm.tsx
```
Expected:
- A branch name. Create a branch if you are on `main`.
- Both files listed (T7 and T2 done).
- `leadingIcon` found in both files (T5 done).
- No `bg-input` matches (T7 done).

If any check fails, STOP. This task must run after T2, T5, T7 and T8.

- [ ] **Step 2: Create the codemod `.tmp/t9-normalize.cjs` (throwaway, not committed)**

```js
// Task 9 codemod: NativeSelect + same-row sibling skin normalization.
// Usage (from repo root, Git Bash):
//   node .tmp/t9-normalize.cjs --dry  <file> [<file> ...]   # print planned edits, write nothing
//   node .tmp/t9-normalize.cjs --write <file> [<file> ...]  # apply edits
//   node .tmp/t9-normalize.cjs --md <file> [<file> ...]     # planned edits as a markdown table
// <file> paths are relative to apps/web/src (forward slashes).
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
const ts = require(path.join(ROOT, 'node_modules/typescript'));
const SRC = path.join(ROOT, 'apps/web/src');
const mode = process.argv[2];
const targets = process.argv.slice(3);
if (!['--dry', '--write', '--md'].includes(mode) || targets.length === 0) {
  console.error('usage: node .tmp/t9-normalize.cjs --dry|--write|--md <file...>');
  process.exit(2);
}

// Skin tokens NativeSelect may not receive (same list as the field-guards test).
const FORBID = /^(?:[a-z0-9-]+:)*(?:rounded(?:-.+)?|border-border|bg-.+|p-.+|px-.+|py-.+|pl-.+|pr-.+)$/;
// Tokens formControlClass / the NativeSelect tail already supply (or override), so they carry no meaning.
const REDUNDANT =
  /^(?:w-full|border|border-input|text-(?:xs|sm|base|foreground)|leading-(?:snug|normal|tight)|h-.+|min-h-.+|outline-(?:hidden|none)|shadow(?:-.+)?|transition(?:-.+)?|(?:[a-z-]+:)*focus(?:-visible)?:.+|hover:border-.+|disabled:opacity-.+|appearance-none|cursor-pointer)$/;
// Width utilities are dead on the <select> (tail forces w-full min-w-0 max-w-full) — drop them there only.
const SELECT_DEAD = /^(?:w-.+|min-w-.+|max-w-.+)$/;
// On text inputs keep icon gutters.
const ICON_PAD = /^(?:pl-.+|pr-.+)$/;
const CONTROL_TAGS = new Set(['input', 'Input', 'NumberInput', 'ThaiDateInput']);

const sig = (t) => t.split(/\s+/).filter((x) => FORBID.test(x)).sort().join(' ');
function classLiteral(opening, sf) {
  for (const a of opening.attributes.properties) {
    if (ts.isJsxAttribute(a) && a.name.getText(sf) === 'className' && a.initializer && ts.isStringLiteral(a.initializer)) return a;
  }
  return null;
}
function isRow(cls) {
  if (!cls) return false;
  if (/\bgrid\b|grid-cols-/.test(cls)) return true;
  if (/\bflex\b/.test(cls)) return !/\bflex-col\b/.test(cls) || /(sm|md|lg|xl):flex-row/.test(cls);
  return false;
}
function rowAncestor(opening, sf) {
  let p = opening.parent; // JsxElement of the control itself (or its parent for self-closing)
  if (ts.isJsxElement(p) && p.openingElement === opening) p = p.parent;
  // A "row" is a grid / flex-row element at most 3 JSX elements above the control
  // (control → field wrapper → optional label wrapper → row). Further up is layout, not a row.
  let depth = 0;
  while (p && depth < 3) {
    if (ts.isJsxElement(p)) {
      depth++;
      const a = classLiteral(p.openingElement, sf);
      if (a && isRow(a.initializer.text)) return p;
    }
    p = p.parent;
  }
  return null;
}

let total = { sites: 0, sibs: 0, files: 0 };
const md = [];
for (const rel of targets) {
  const file = path.join(SRC, rel);
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const controls = [];
  const visit = (n) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = n.tagName.getText(sf);
      if (tag === 'NativeSelect' || CONTROL_TAGS.has(tag)) {
        const attr = classLiteral(n, sf);
        if (attr) controls.push({ tag, opening: n, attr, text: attr.initializer.text, line: sf.getLineAndCharacterOfPosition(attr.getStart(sf)).line + 1 });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  const edits = []; // {start, end, text, line, tag, old, kind}
  const sites = controls.filter((c) => c.tag === 'NativeSelect' && sig(c.text));
  const sibSet = new Set();
  for (const s of sites) {
    const keep = s.text.split(/\s+/).filter((t) => t && !FORBID.test(t) && !REDUNDANT.test(t) && !SELECT_DEAD.test(t));
    const start = s.attr.getStart(sf);
    let end = s.attr.getEnd();
    let repl;
    if (keep.length === 0) {
      // remove the attribute plus the whitespace in front of it
      let b = start;
      while (b > 0 && /[ \t\r\n]/.test(src[b - 1])) b--;
      edits.push({ start: b, end, text: '', line: s.line, tag: s.tag, old: s.text, neu: '(className removed)', kind: 'select' });
    } else {
      repl = `className="${keep.join(' ')}"`;
      edits.push({ start, end, text: repl, line: s.line, tag: s.tag, old: s.text, neu: repl, kind: 'select' });
    }
    const row = rowAncestor(s.opening, sf);
    if (!row) continue;
    for (const c of controls) {
      if (c.tag === 'NativeSelect' || sibSet.has(c) || sig(c.text) !== sig(s.text)) continue;
      const typeAttr = c.opening.attributes.properties.find((a) => ts.isJsxAttribute(a) && a.name.getText(sf) === 'type');
      if (typeAttr && /checkbox|radio|file|range|color|hidden/.test(typeAttr.getText(sf))) continue;
      if (c.opening.pos < row.pos || c.opening.end > row.end) continue;
      sibSet.add(c);
    }
  }
  let needFcc = false, needCn = false;
  for (const c of sibSet) {
    const tokens = c.text.split(/\s+/).filter(Boolean);
    let repl;
    if (c.tag === 'ThaiDateInput') {
      // ThaiDateInput already renders the standard skin + pr-9 for its icon: only strip the overrides.
      const keep = tokens.filter((t) => !FORBID.test(t) && !REDUNDANT.test(t));
      repl = keep.length ? `className="${keep.join(' ')}"` : '';
    } else {
      const keep = tokens.filter((t) => (!FORBID.test(t) || ICON_PAD.test(t)) && !REDUNDANT.test(t));
      needFcc = true;
      if (keep.length) { needCn = true; repl = `className={cn(formControlClass, '${keep.join(' ')}')}`; }
      else repl = 'className={formControlClass}';
    }
    let start = c.attr.getStart(sf);
    if (repl === '') while (start > 0 && /[ \t\r\n]/.test(src[start - 1])) start--;
    edits.push({ start, end: c.attr.getEnd(), text: repl, line: c.line, tag: c.tag, old: c.text, neu: repl || '(className removed)', kind: 'sibling' });
  }
  if (!edits.length) { console.log(`${rel}: no change`); continue; }

  // imports
  const hasFcc = /import\s*\{[^}]*\bformControlClass\b[^}]*\}\s*from\s*['"][^'"]*form-styles['"]/.test(src);
  const hasCn = /import\s*\{[^}]*\bcn\b[^}]*\}\s*from\s*['"]@\/lib\/utils['"]/.test(src);
  const imports = [];
  if (needFcc && !hasFcc) {
    // Prefer extending an existing `import { … } from '…/form-styles'` over a second import line.
    const styles = sf.statements.find(
      (s) =>
        ts.isImportDeclaration(s) &&
        /form-styles['"]$/.test(s.moduleSpecifier.getText(sf)) &&
        s.importClause && !s.importClause.isTypeOnly &&
        s.importClause.namedBindings && ts.isNamedImports(s.importClause.namedBindings) &&
        s.importClause.namedBindings.elements.length > 0,
    );
    if (styles) {
      const at = styles.importClause.namedBindings.elements[0].getStart(sf);
      const ln = sf.getLineAndCharacterOfPosition(at).line + 1;
      edits.push({ start: at, end: at, text: 'formControlClass, ', line: ln, kind: 'import', old: '', neu: 'formControlClass added to the existing form-styles import' });
    } else imports.push("import { formControlClass } from '@/components/ui/form-styles';");
  }
  if (needCn && !hasCn) imports.push("import { cn } from '@/lib/utils';");
  if (imports.length) {
    const lastImport = [...sf.statements].filter(ts.isImportDeclaration).pop();
    const at = lastImport.getEnd();
    edits.push({ start: at, end: at, text: '\n' + imports.join('\n'), line: 0, kind: 'import', old: '', neu: imports.join(' ') });
  }

  total.files++;
  total.sites += edits.filter((e) => e.kind === 'select').length;
  total.sibs += edits.filter((e) => e.kind === 'sibling').length;
  edits.sort((a, b) => b.start - a.start);
  let next = src;
  for (const e of edits) next = next.slice(0, e.start) + e.text + next.slice(e.end);

  const ordered = [...edits].sort((a, b) => a.line - b.line);
  if (mode === '--md') {
    md.push(`\n**\`apps/web/src/${rel}\`**\n`);
    md.push('| line | control | old `className` | new |');
    md.push('|---|---|---|---|');
    for (const e of ordered) {
      if (e.kind === 'import') { md.push(`| ${e.line || 'top'} | import | — | \`${e.neu}\` |`); continue; }
      md.push(`| ${e.line} | ${e.kind === 'select' ? 'NativeSelect' : '`<' + e.tag + '>` (same row)'} | \`${e.old}\` | ${e.neu === '(className removed)' ? '*(remove attribute)*' : '`' + e.neu + '`'} |`);
    }
  } else {
    console.log(`== ${rel}`);
    for (const e of ordered) console.log(`  ${e.kind === 'import' ? 'import' : 'L' + e.line} ${e.tag || ''}: "${e.old}" -> ${e.neu}`);
  }
  if (mode === '--write') fs.writeFileSync(file, next);
}
if (mode === '--md') console.log(md.join('\n'));
console.log(`\nselect sites: ${total.sites} · same-row siblings: ${total.sibs} · files changed: ${total.files}`);
```
Verify that git ignores it:
```bash
git check-ignore -v .tmp/t9-normalize.cjs
```
Expected: `.gitignore:24:*.tmp	.tmp/t9-normalize.cjs` (or the `.tmp/` rule on line 23).

- [ ] **Step 3: Create the area lists `.tmp/t9-areas.sh` (throwaway)**

```bash
# Task 9 area lists — paths relative to apps/web/src
A=(
  pages/UnifiedInboxPage/components/ChatLibraryPicker.tsx
  pages/UnifiedInboxPage/components/FacebookCommentLink.tsx
  pages/UnifiedInboxPage/components/FacebookCommentPageSettings.tsx
  pages/UnifiedInboxPage/components/FacebookCommentPanel.tsx
  pages/UnifiedInboxPage/components/SalesDispositionControl.tsx
  pages/canned-response-admin/bubble-editors/CardBubbleEditor.tsx
  pages/canned-response-admin/QuickReplyEditor.tsx
  pages/RichMenuPage.tsx
)
B=(
  components/trade-in/TradeInCreditPicker.tsx
  pages/AfterSalesPage.tsx
  pages/ImportedSalesPage.tsx
  pages/InspectionPage.tsx
  pages/PricingTemplatesPage.tsx
  pages/ProductDetailPage/components/EditProductModal.tsx
  pages/ProductDetailPage/components/OnlineListingPanel.tsx
  pages/ProductDetailPage/index.tsx
  pages/PromotionsPage.tsx
  pages/StockAlertsPage.tsx
  pages/StockCountPage.tsx
  pages/StockPage/components/BulkTransferModal.tsx
  pages/TradeInPage/components/AcceptModal.tsx
  pages/TradeInPage/components/QuestionnaireTab.tsx
  pages/TradeInPage/components/ReferenceQuestionnaire.tsx
  pages/TradeInPage/components/ValuationsTab.tsx
  pages/SuppliersPage/components/SupplierForm.tsx
)
C1=(
  components/accounting/ReverseConfirmDialog.tsx
  pages/accounting/PeriodClosePage.tsx
  pages/accounting/TaxDisallowedSummaryPage.tsx
  pages/equity/DividendRegisterPage.tsx
  pages/equity/EquityEntryPage.tsx
  pages/equity/EquityListPage.tsx
  pages/interco/CreateBatchDialog.tsx
  pages/MonthlyClosePage.tsx
  pages/PeakSyncPage.tsx
  pages/YearEndClosingPage.tsx
  pages/ReportsPage.tsx
  pages/CommissionsPage.tsx
)
C2=(
  components/expense-form-v4/PettyCashLinesSection.tsx
  components/expense-form-v4/SettlementLinesSection.tsx
  pages/ExpenseDailySummaryPage.tsx
  pages/ExpenseFavoritesPage.tsx
  pages/FinanceReceivablePage/FinanceContactLogDialog.tsx
  pages/other-income/OtherIncomeEntryPage.tsx
  pages/PaymentsPage/components/PaymentModals.tsx
  pages/PaymentsPage/components/ReceiptsTab.tsx
  pages/PaymentsPage/components/RecordPaymentWizard.tsx
  pages/ShopDailyCashPage.tsx
  pages/ShopPettyCashPage/components/MovementsTable.tsx
  components/payment/SlipReviewTab.tsx
)
D=(
  components/CompanyFilter.tsx
  pages/settings/SettingsLayout.tsx
  pages/NotificationsPage/components/NotificationLogTable.tsx
  pages/NotificationsPage/components/TemplateForm.tsx
  pages/NotificationsPage/components/TemplateManager.tsx
  pages/PDPAPage.tsx
  pages/DocumentDashboardPage.tsx
  components/template-editor/editor/BlockEditModal.tsx
  components/template-editor/layout/HeaderBar.tsx
  components/ui/RichTextEditor.tsx
)
E=(
  components/contacts/CreateContactModal.tsx
  components/contract/CreditCheckPanel.tsx
  components/contract/CustomerEditModal.tsx
  components/credit-check/CreditCheckCreateModal.tsx
  components/credit-check/CreditCheckOverrideDialog.tsx
  pages/CollectionsPage/components/CollectionsFilters.tsx
  pages/CollectionsPage/components/LegalCaseDialog.tsx
  pages/CollectionsPage/components/SendLineAdHocDialog.tsx
  pages/CollectionsPage/components/StuckContractsSection.tsx
  pages/CollectionsPage/tabs/AllTab.tsx
  pages/ContractCreatePage/components/CustomerCreateModal.tsx
  pages/ContractCreatePage/components/PlanDetailsStep.tsx
  pages/ContractDetailPage.tsx
  pages/ContractsPage.tsx
  pages/CustomerDetailPage/components/EditCustomerDialog.tsx
)
OWNED=(
  pages/TodosPage/components/TodoFilters.tsx
  pages/DunningSettingsPage.tsx
  pages/SmsTemplatesPage/components/SmsTemplateForm.tsx
  pages/AuditLogsPage.tsx
  pages/ChatbotFinanceKnowledgePage.tsx
  pages/RepossessionsPage.tsx
  pages/StockTransfersPage.tsx
  pages/other-income/components/ItemsTable.tsx
  components/expense-form-v4/PayrollLinesSection.tsx
  pages/TodosPage/components/TodoForm.tsx
)
```
Check that it loads:
```bash
source .tmp/t9-areas.sh && echo "${#A[@]} ${#B[@]} ${#C1[@]} ${#C2[@]} ${#D[@]} ${#E[@]} ${#OWNED[@]}"
```
Expected: `8 17 12 12 10 15 10`

- [ ] **Step 4: Capture a pre-change field-scale run (the comparison base for every area)**

```bash
npm run local:preview
```
Expected: `Started http://localhost:5195` (or `Reused http://localhost:5195`) and a `Workspace:` line. The command starts the preview in the background and returns. Every later `check.mjs --label t9-*` run is preceded by `npm run local:preview` again, because each area's source edits make the preview stale (the runner exits 2 on a stale preview); the preview keeps running until `npm run local:stop` in Step 27.

```bash
node tools/field-scale/check.mjs --label t9-before
ls .tmp/field-scale/t9-before
```
Expected: `results.json`, `report.md` and `<route>-<width>-<theme>.png` files.

- [ ] **Step 5: Write the failing guard test (third guard in `field-guards.inventory.test.ts`)**

First open `apps/web/src/components/ui/field-guards.inventory.test.ts` (created by T7). Confirm it defines `ROOT`, `listSourceFiles` and `SCAN_TIMEOUT_MS` like `native-select.inventory.test.ts:8-33`, and imports `readFileSync` (`node:fs`), `relative`/`resolve` (`node:path`), `ts` (`typescript`) and `describe`/`expect`/`it` (`vitest`).
- If `sep` is not in the `node:path` import, add it. For example, change `import { resolve, relative } from 'node:path';` to `import { relative, resolve, sep } from 'node:path';`.
- If any of `ROOT`, `listSourceFiles` or `SCAN_TIMEOUT_MS` is missing, copy lines 6-33 of `apps/web/src/components/ui/native-select.inventory.test.ts` into the top of the file (keep `TEST_FILE` and `SKIP_DIRS`).

Then append this block at the very end of the file:
```ts
// --- NativeSelect owns its skin (spec 2026-11-14 §4.2 item 5) -------------------------------
// NativeSelect renders cn(formControlClass, className, <size tail>), so a caller's radius,
// border colour, fill or padding silently replaces the shared skin (the 2026-11-14 scan found
// 128 such call sites). Width belongs on wrapperClassName, icon gutters on leadingIcon and the
// warning outline on tone. Only literal class text is inspected: string literals, cn()/clsx()
// arguments, both branches of ?:, &&/|| operands and template-literal text. A class held in a
// variable (className={inputClass}) is not resolved.
const NATIVE_SELECT_SKIN =
  /^(?:[a-z0-9-]+:)*(?:rounded(?:-\S+)?|border-border|bg-\S+|p-\S+|px-\S+|py-\S+|pl-\S+|pr-\S+)$/;
const NATIVE_SELECT_CANDIDATE = /<NativeSelect\b/;

function collectClassStrings(node: ts.Node, out: string[]): void {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    out.push(node.text);
    return;
  }
  if (ts.isTemplateExpression(node)) {
    out.push(node.head.text);
    for (const span of node.templateSpans) {
      collectClassStrings(span.expression, out);
      out.push(span.literal.text);
    }
    return;
  }
  if (ts.isJsxExpression(node)) {
    if (node.expression) collectClassStrings(node.expression, out);
    return;
  }
  if (ts.isCallExpression(node)) {
    for (const arg of node.arguments) collectClassStrings(arg, out);
    return;
  }
  if (ts.isConditionalExpression(node)) {
    collectClassStrings(node.whenTrue, out);
    collectClassStrings(node.whenFalse, out);
    return;
  }
  if (ts.isBinaryExpression(node)) {
    collectClassStrings(node.left, out);
    collectClassStrings(node.right, out);
    return;
  }
  if (ts.isParenthesizedExpression(node)) collectClassStrings(node.expression, out);
}

function nativeSelectSkinViolations(file: string, source: string): string[] {
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const where = relative(ROOT, file).split(sep).join('/');
  const found: string[] = [];
  const inspect = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(ast) === 'NativeSelect'
    ) {
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || attribute.name.getText(ast) !== 'className') continue;
        if (!attribute.initializer) continue;
        const strings: string[] = [];
        collectClassStrings(attribute.initializer, strings);
        const skin = strings
          .flatMap((text) => text.split(/\s+/))
          .filter((token) => NATIVE_SELECT_SKIN.test(token));
        if (skin.length) {
          const line = ast.getLineAndCharacterOfPosition(attribute.getStart(ast)).line + 1;
          found.push(`${where}:${line} ${skin.join(' ')}`);
        }
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(ast);
  return found;
}

describe('NativeSelect skin guard', () => {
  it(
    'NativeSelect className never carries radius, border colour, fill or padding',
    () => {
      // The detector itself: cn() args and template text are read; tone/width classes pass.
      const sample = resolve(ROOT, 'apps/web/src/__guard-sample__.tsx');
      const caught = nativeSelectSkinViolations(
        sample,
        '<NativeSelect className={cn("rounded-md", ok && `px-2 ${extra}`)} />',
      );
      expect(caught).toHaveLength(1);
      expect(caught[0]).toMatch(/:1 rounded-md px-2$/);
      expect(
        nativeSelectSkinViolations(
          sample,
          '<NativeSelect className={isDirty ? "border-warning" : ""} wrapperClassName="sm:w-56" />',
        ),
      ).toEqual([]);

      const files = listSourceFiles(resolve(ROOT, 'apps/web/src'));
      expect(files.length).toBeGreaterThan(500);
      const found: string[] = [];
      for (const file of files) {
        const source = readFileSync(file, 'utf8');
        if (!NATIVE_SELECT_CANDIDATE.test(source)) continue;
        found.push(...nativeSelectSkinViolations(file, source));
      }
      expect(found).toEqual([]);
    },
    SCAN_TIMEOUT_MS,
  );
});
```

- [ ] **Step 6: Run the guard — it must fail**

```bash
npm run test --workspace=apps/web -- src/components/ui/field-guards.inventory.test.ts
```
Expected:
- FAIL in `NativeSelect skin guard > NativeSelect className never carries radius, border colour, fill or padding` with `AssertionError: expected [ …(116) ] to deeply equal []`. The count at HEAD is 116: 110 in this task's 74 files plus 6 left in `TodoFilters` (1), `PayrollLinesSection` (3), `RepossessionsPage` (1) and `TodoForm` (1). It drops to 110 after Step 7.
- The `+ Received` diff lists entries such as `apps/web/src/components/CompanyFilter.tsx:43 px-3 py-2 rounded-lg`.
- T7's guards in the same file still pass.

Do not commit yet. The test file is committed in Step 27, once it passes.

- [ ] **Step 7: Normalize the skin still left in the OWNED files (T5/T8)**

```bash
source .tmp/t9-areas.sh && node .tmp/t9-normalize.cjs --dry "${OWNED[@]}"
```
Expected: edits are listed for exactly four files and the other six print `no change` (`DunningSettingsPage`, `SmsTemplateForm`, `AuditLogsPage`, `ChatbotFinanceKnowledgePage`, `StockTransfersPage`, `ItemsTable`). The last line is:

`select sites: 6 · same-row siblings: 1 · files changed: 4`

The four files and their edits (these are the only ones the codemod touches):

**`apps/web/src/pages/TodosPage/components/TodoFilters.tsx`** (T5; `leadingIcon` is already on this select, so the icon gutter is safe)

| line | control | old `className` | new |
|---|---|---|---|
| 86 | NativeSelect | `py-2.5 border border-input bg-card rounded-xl text-sm focus-visible:ring-2 focus-visible:ring-primary/20 focus:border-primary/50 outline-hidden transition-colors cursor-pointer` | *(remove attribute)* |

**`apps/web/src/pages/RepossessionsPage.tsx`** (T8; the select at 761 is already clean)

| line | control | old `className` | new |
|---|---|---|---|
| 1129 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden` | *(remove attribute)* |

**`apps/web/src/components/expense-form-v4/PayrollLinesSection.tsx`** (T8)

| line | control | old `className` | new |
|---|---|---|---|
| 355 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm bg-background` | *(remove attribute)* |
| 372 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm bg-background` | *(remove attribute)* |
| 734 | NativeSelect | `px-1.5 py-1 border border-input rounded text-xs bg-background` | *(remove attribute)* |

**`apps/web/src/pages/TodosPage/components/TodoForm.tsx`** (T8)

| line | control | old `className` | new |
|---|---|---|---|
| top | import | — | `import { formControlClass } from '@/components/ui/form-styles';` |
| 446 | `<input>` (same row) | `w-full px-4 py-2.5 border border-input rounded-xl text-sm bg-card focus-visible:ring-2 focus-visible:ring-primary/20 focus:border-primary/50 outline-hidden transition-colors` | `className={formControlClass}` |
| 457 | NativeSelect | `px-4 py-2.5 border border-input rounded-xl text-sm bg-card focus-visible:ring-2 focus-visible:ring-primary/20 focus:border-primary/50 outline-hidden transition-colors` | *(remove attribute)* |

If the dry run lists a different set (for example `TodoFilters.tsx` without `leadingIcon` on the select, which Step 1 checks), stop and compare with the tables above. Never run `--write` on `TodoFilters.tsx` unless Step 1 showed `leadingIcon` in it: removing the gutter without `leadingIcon` puts the icon over the text.

Apply the codemod to those four files and commit them on their own:
```bash
LEFT=(pages/TodosPage/components/TodoFilters.tsx pages/RepossessionsPage.tsx components/expense-form-v4/PayrollLinesSection.tsx pages/TodosPage/components/TodoForm.tsx)
node .tmp/t9-normalize.cjs --write "${LEFT[@]}"
git add $(printf 'apps/web/src/%s ' "${LEFT[@]}") && git commit -F - <<'EOF'
style(web): finish NativeSelect skin cleanup in TodoFilters, Repossessions, Payroll lines, TodoForm

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
Expected: the codemod prints the edits above, then one commit containing only those four files. Re-run the dry run; it must now print `select sites: 0 · same-row siblings: 0 · files changed: 0`.

---

**Areas.** Each area has three steps:
1. Apply: dry-run, compare with the table, then write.
2. Verify: type-check, lint, related tests, guard count, field-scale compare.
3. Commit.

Line numbers below are from the current tree. The codemod finds sites by AST, not by line number, so earlier edits in the same file do not break it.

- [ ] **Step 8: Area A (inbox/chat) — apply**

```bash
source .tmp/t9-areas.sh && node .tmp/t9-normalize.cjs --dry "${A[@]}"
```
Expected: every edit in the table below, then `select sites: 9 · same-row siblings: 0 · files changed: 8`. If a line differs from the table, stop and investigate. Then:
```bash
source .tmp/t9-areas.sh && node .tmp/t9-normalize.cjs --write "${A[@]}" && git diff --stat
```
Expected: 8 files changed.

**`apps/web/src/pages/UnifiedInboxPage/components/ChatLibraryPicker.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 288 | NativeSelect | `h-10 rounded-md border border-input bg-background px-2 text-sm` | *(remove attribute)* |

**`apps/web/src/pages/UnifiedInboxPage/components/FacebookCommentLink.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 106 | NativeSelect | `h-11 rounded-md border bg-background px-2` | *(remove attribute)* |

**`apps/web/src/pages/UnifiedInboxPage/components/FacebookCommentPageSettings.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 168 | NativeSelect | `h-11 rounded-md border bg-background px-2` | *(remove attribute)* |

**`apps/web/src/pages/UnifiedInboxPage/components/FacebookCommentPanel.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 110 | NativeSelect | `h-11 rounded-md border bg-background px-3` | *(remove attribute)* |

**`apps/web/src/pages/UnifiedInboxPage/components/SalesDispositionControl.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 97 | NativeSelect | `min-h-11 rounded-md border border-input bg-background px-3` | *(remove attribute)* |

**`apps/web/src/pages/canned-response-admin/bubble-editors/CardBubbleEditor.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 74 | NativeSelect | `text-xs border border-border rounded px-1.5 py-1 bg-background` | *(remove attribute)* |

**`apps/web/src/pages/canned-response-admin/QuickReplyEditor.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 60 | NativeSelect | `text-xs border border-border rounded px-2 py-1 bg-background` | *(remove attribute)* |
| 88 | NativeSelect | `text-xs border border-border rounded px-2 py-1 bg-background` | *(remove attribute)* |

**`apps/web/src/pages/RichMenuPage.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 201 | NativeSelect | `w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring` | *(remove attribute)* |

- [ ] **Step 9: Area A — verify**

```bash
bash tools/check-types.sh web
source .tmp/t9-areas.sh && (cd apps/web && npx eslint $(printf 'src/%s ' "${A[@]}"))
source .tmp/t9-areas.sh && (cd apps/web && npx vitest related --run --passWithNoTests $(printf 'src/%s ' "${A[@]}"))
npm run test --workspace=apps/web -- src/components/ui/field-guards.inventory.test.ts
npm run local:preview
node tools/field-scale/check.mjs --label t9-a
node tools/field-scale/check.mjs --compare t9-before t9-a; echo "exit=$?"
```
Expected:
- `Web: OK`.
- eslint prints nothing.
- vitest: every test file passes, 0 failed.
- Guard: still FAIL, now `expected [ …(101) ] to deeply equal []`.
- Compare: `exit=0`, or every new P1/P2 is accepted under the compare triage rule (cross-task notes). F1 findings on inbox, canned-response and rich-menu pages may go down.

- [ ] **Step 10: Area A — commit**

```bash
source .tmp/t9-areas.sh && git add $(printf 'apps/web/src/%s ' "${A[@]}") && git commit -F - <<'EOF'
style(web): let NativeSelect keep the shared skin — inbox & chat

Drop radius/border/fill/padding overrides from NativeSelect className so
formControlClass shows (spec 2026-11-14 §4.2 item 5, R1-3).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 11: Area B (sales, stock, products, trade-in, suppliers) — apply**

```bash
source .tmp/t9-areas.sh && node .tmp/t9-normalize.cjs --dry "${B[@]}"
```
Expected: the table below, then `select sites: 29 · same-row siblings: 14 · files changed: 17`. Then:
```bash
source .tmp/t9-areas.sh && node .tmp/t9-normalize.cjs --write "${B[@]}" && git diff --stat
```
Expected: 17 files changed.

**`apps/web/src/components/trade-in/TradeInCreditPicker.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 26 | NativeSelect | `h-10 rounded-lg border bg-background px-3 text-sm` | *(remove attribute)* |

**`apps/web/src/pages/AfterSalesPage.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 173 | NativeSelect | `h-11 rounded-lg border border-input bg-background px-3 text-sm` | *(remove attribute)* |

**`apps/web/src/pages/ImportedSalesPage.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 65 | NativeSelect | `border border-border bg-background text-foreground rounded-md px-3 py-2 text-sm` | *(remove attribute)* |

**`apps/web/src/pages/InspectionPage.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 130 | NativeSelect | `px-4 py-2.5 rounded-lg border border-input bg-background text-sm focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30` | *(remove attribute)* |

**`apps/web/src/pages/PricingTemplatesPage.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| top | import | — | `import { formControlClass } from '@/components/ui/form-styles'; import { cn } from '@/lib/utils';` |
| 306 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm` | *(remove attribute)* |
| 312 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm` | *(remove attribute)* |
| 324 | `<input>` (same row) | `px-3 py-2 border border-input rounded-lg text-sm flex-1 max-w-xs` | `className={cn(formControlClass, 'flex-1 max-w-xs')}` |
| 406 | NativeSelect | `rounded-lg border border-input bg-background p-2` | *(remove attribute)* |
| 442 | `<input>` (same row) | `w-full px-3 py-2 border border-input rounded-lg text-sm` | `className={formControlClass}` |
| 450 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm` | *(remove attribute)* |

**`apps/web/src/pages/ProductDetailPage/components/EditProductModal.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| top | import | — | `import { formControlClass } from '@/components/ui/form-styles';` |
| 106 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm` | *(remove attribute)* |
| 118 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm disabled:opacity-60` | *(remove attribute)* |
| 261 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm` | *(remove attribute)* |
| 277 | `<NumberInput>` (same row) | `w-full px-3 py-2 border border-input rounded-lg text-sm` | `className={formControlClass}` |

**`apps/web/src/pages/ProductDetailPage/components/OnlineListingPanel.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 350 | NativeSelect | `h-10 rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-50` | *(remove attribute)* |

**`apps/web/src/pages/ProductDetailPage/index.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 608 | NativeSelect | `px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden` | *(remove attribute)* |

**`apps/web/src/pages/PromotionsPage.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 348 | NativeSelect | `h-10 rounded-md border border-input bg-background px-3 text-sm` | *(remove attribute)* |

**`apps/web/src/pages/StockAlertsPage.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 444 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden` | *(remove attribute)* |
| 455 | NativeSelect | same as 444 | *(remove attribute)* |
| 592 | NativeSelect | `w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden` | *(remove attribute)* |
| 604 | NativeSelect | same as 592 | *(remove attribute)* |
| 624 | NativeSelect | same as 592 | *(remove attribute)* |
| 639 | NativeSelect | same as 592 | *(remove attribute)* |
| 654 | NativeSelect | same as 592 | *(remove attribute)* |

**`apps/web/src/pages/StockCountPage.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 187 | NativeSelect | `min-h-11 px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden` | *(remove attribute)* |

**`apps/web/src/pages/StockPage/components/BulkTransferModal.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 63 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden` | *(remove attribute)* |

**`apps/web/src/pages/TradeInPage/components/AcceptModal.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 159 | NativeSelect | `h-10 rounded-lg border border-input bg-background px-3 text-sm` | *(remove attribute)* |

**`apps/web/src/pages/TradeInPage/components/QuestionnaireTab.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 243 | NativeSelect | `h-8 rounded-lg border border-input bg-background px-2 text-sm` | *(remove attribute)* |

**`apps/web/src/pages/TradeInPage/components/ReferenceQuestionnaire.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 40 | NativeSelect | `min-h-11 rounded-lg border border-input bg-background px-3` | *(remove attribute)* |

**`apps/web/src/pages/TradeInPage/components/ValuationsTab.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 198 | NativeSelect | `h-10 rounded-lg border border-input bg-background px-3 text-sm` | *(remove attribute)* |

**`apps/web/src/pages/SuppliersPage/components/SupplierForm.tsx`**

The old sibling skin in this file is always `w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20` ("skin S" below). Line 365 also has `font-mono`. The file already imports `formLabelClass` from form-styles (line 7) and `cn` (line 8). The codemod adds `formControlClass` to the line 7 import instead of a second import line.

| line | control | old `className` | new |
|---|---|---|---|
| 7 | import | `import { formLabelClass } from '@/components/ui/form-styles';` | `import { formControlClass, formLabelClass } from '@/components/ui/form-styles';` |
| 263 | NativeSelect | skin S | *(remove attribute)* |
| 284 | `<input>` (same row) | skin S | `className={formControlClass}` |
| 298 | `<input>` (same row) | skin S | `className={formControlClass}` |
| 312 | `<input>` (same row) | skin S | `className={formControlClass}` |
| 321 | `<input>` (same row) | skin S | `className={formControlClass}` |
| 331 | `<input>` (same row) | skin S | `className={formControlClass}` |
| 346 | `<input>` (same row) | skin S | `className={formControlClass}` |
| 365 | `<input>` (same row) | `w-full h-10 px-3 rounded-lg border border-input bg-background text-sm font-mono transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20` | `className={cn(formControlClass, 'font-mono')}` |
| 533 | NativeSelect | skin S | *(remove attribute)* |
| 554 | `<NumberInput>` (same row) | skin S | `className={formControlClass}` |
| 568 | `<input>` (same row) | skin S | `className={formControlClass}` |
| 581 | `<input>` (same row) | skin S | `className={formControlClass}` |
| 595 | `<input>` (same row) | skin S | `className={formControlClass}` |

- [ ] **Step 12: Area B — verify**

```bash
bash tools/check-types.sh web
source .tmp/t9-areas.sh && (cd apps/web && npx eslint $(printf 'src/%s ' "${B[@]}"))
source .tmp/t9-areas.sh && (cd apps/web && npx vitest related --run --passWithNoTests $(printf 'src/%s ' "${B[@]}"))
npm run test --workspace=apps/web -- src/components/ui/field-guards.inventory.test.ts
npm run local:preview
node tools/field-scale/check.mjs --label t9-b
node tools/field-scale/check.mjs --compare t9-before t9-b; echo "exit=$?"
```
Expected:
- `Web: OK`, no eslint output, every related test passes.
- Guard: FAIL with `expected [ …(72) ] to deeply equal []`.
- Compare: `exit=0`, or every new P1/P2 is accepted under the compare triage rule (cross-task notes).

- [ ] **Step 13: Area B — commit**

```bash
source .tmp/t9-areas.sh && git add $(printf 'apps/web/src/%s ' "${B[@]}") && git commit -F - <<'EOF'
style(web): one field skin for NativeSelect rows — sales, stock, trade-in, suppliers

Remove NativeSelect skin overrides; same-row inputs that shared the old skin now
use formControlClass (spec 2026-11-14 §4.2 item 5, R1-3).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 14: Area C1 (accounting, closing, equity, reports, commissions) — apply**

```bash
source .tmp/t9-areas.sh && node .tmp/t9-normalize.cjs --dry "${C1[@]}"
```
Expected: the table below, then `select sites: 18 · same-row siblings: 14 · files changed: 12`. Then:
```bash
source .tmp/t9-areas.sh && node .tmp/t9-normalize.cjs --write "${C1[@]}" && git diff --stat
```

**`apps/web/src/components/accounting/ReverseConfirmDialog.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 170 | NativeSelect | `rounded-md border border-input bg-background px-3 py-2 text-sm leading-snug focus:outline-none focus:ring-2 focus:ring-ring` | *(remove attribute)* |

**`apps/web/src/pages/accounting/PeriodClosePage.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 194 | NativeSelect | `border border-border rounded-md px-3 py-1.5 text-sm bg-background` | *(remove attribute)* |

**`apps/web/src/pages/accounting/TaxDisallowedSummaryPage.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 75 | NativeSelect | `rounded-lg border border-input bg-background px-3 py-2 text-sm` | *(remove attribute)* |

**`apps/web/src/pages/equity/DividendRegisterPage.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 71 | NativeSelect | `border border-border rounded-md px-3 py-2 text-sm bg-background` | *(remove attribute)* |
| 83 | NativeSelect | `border border-border rounded-md px-3 py-2 text-sm bg-background` | *(remove attribute)* |

**`apps/web/src/pages/equity/EquityEntryPage.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| top | import | — | `import { formControlClass } from '@/components/ui/form-styles'; import { cn } from '@/lib/utils';` |
| 219 | `<input>` (same row) | `w-full border border-border rounded-md px-3 py-2 bg-background` | `className={formControlClass}` |
| 227 | `<input>` (same row) | `w-full border border-border rounded-md px-3 py-2 bg-background` | `className={formControlClass}` |
| 237 | `<input>` (same row) | `w-full border border-border rounded-md px-3 py-2 bg-background` | `className={formControlClass}` |
| 247 | `<input>` (same row) | `w-full border border-border rounded-md px-3 py-2 bg-background` | `className={formControlClass}` |
| 258 | NativeSelect | `border border-border rounded-md px-3 py-2 bg-background` | *(remove attribute)* |
| 292 | NativeSelect | `border border-border rounded-md px-2 py-2 text-sm bg-background` | *(remove attribute)* |
| 306 | `<NumberInput>` (same row) | `w-full border border-border rounded-md px-2 py-2 text-sm bg-background text-right font-mono` | `className={cn(formControlClass, 'text-right font-mono')}` |
| 313 | `<NumberInput>` (same row) | same as 306 | `className={cn(formControlClass, 'text-right font-mono')}` |
| 325 | `<NumberInput>` (same row) | same as 306 | `className={cn(formControlClass, 'text-right font-mono')}` |
| 337 | `<NumberInput>` (same row) | same as 306 | `className={cn(formControlClass, 'text-right font-mono')}` |
| 385 | NativeSelect | `border border-border rounded-md px-3 py-2 bg-background` | *(remove attribute)* |
| 397 | `<input>` (same row) | `w-full border border-border rounded-md px-3 py-2 bg-background font-mono` | `className={cn(formControlClass, 'font-mono')}` |
| 406 | `<NumberInput>` (same row) | `w-full border border-border rounded-md px-3 py-2 bg-background text-right font-mono` | `className={cn(formControlClass, 'text-right font-mono')}` |

**`apps/web/src/pages/equity/EquityListPage.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| top | import | — | `import { formControlClass } from '@/components/ui/form-styles'; import { cn } from '@/lib/utils';` |
| 68 | `<input>` (same row) | `border border-border rounded-md px-3 py-2 text-sm bg-background md:col-span-2` | `className={cn(formControlClass, 'md:col-span-2')}` |
| 74 | `<input>` (same row) | `border border-border rounded-md px-3 py-2 text-sm bg-background` | `className={formControlClass}` |
| 80 | NativeSelect | `border border-border rounded-md px-3 py-2 text-sm bg-background` | *(remove attribute)* |
| 200 | NativeSelect | `border border-border rounded-md px-3 py-2 text-sm bg-background` | *(remove attribute)* |

**`apps/web/src/pages/interco/CreateBatchDialog.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 225 | NativeSelect | `h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30` | *(remove attribute)* |
| 239 | NativeSelect | same as 225 | *(remove attribute)* |

**`apps/web/src/pages/MonthlyClosePage.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 383 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden` | *(remove attribute)* |

**`apps/web/src/pages/PeakSyncPage.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 143 | NativeSelect | `text-sm border border-input rounded-lg px-3 py-2 bg-background` | *(remove attribute)* |

**`apps/web/src/pages/YearEndClosingPage.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 210 | NativeSelect | `h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30` | *(remove attribute)* |

**`apps/web/src/pages/ReportsPage.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 542 | NativeSelect | `h-9 px-3 text-sm border border-border rounded-lg bg-background` | *(remove attribute)* |

**`apps/web/src/pages/CommissionsPage.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| top | import | — | `import { formControlClass } from '@/components/ui/form-styles';` |
| 554 | `<input>` (same row) | `px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background focus:border-transparent` | `className={formControlClass}` |
| 561 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm` | *(remove attribute)* |
| 601 | `<input>` (same row) | same as 554 | `className={formControlClass}` |
| 608 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm` | *(remove attribute)* |

- [ ] **Step 15: Area C1 — verify**

```bash
bash tools/check-types.sh web
source .tmp/t9-areas.sh && (cd apps/web && npx eslint $(printf 'src/%s ' "${C1[@]}"))
source .tmp/t9-areas.sh && (cd apps/web && npx vitest related --run --passWithNoTests $(printf 'src/%s ' "${C1[@]}"))
npm run test --workspace=apps/web -- src/components/ui/field-guards.inventory.test.ts
npm run local:preview
node tools/field-scale/check.mjs --label t9-c1
node tools/field-scale/check.mjs --compare t9-before t9-c1; echo "exit=$?"
```
Expected:
- `Web: OK`, no eslint output, related tests pass.
- Guard: FAIL with `expected [ …(54) ] to deeply equal []`.
- Compare: `exit=0`, or every new P1/P2 is accepted under the compare triage rule (cross-task notes).

- [ ] **Step 16: Area C1 — commit**

```bash
source .tmp/t9-areas.sh && git add $(printf 'apps/web/src/%s ' "${C1[@]}") && git commit -F - <<'EOF'
style(web): one field skin for NativeSelect rows — accounting, equity, reports

Remove NativeSelect skin overrides; same-row inputs that shared the old skin now
use formControlClass (spec 2026-11-14 §4.2 item 5, R1-3).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 17: Area C2 (payments, expenses, cash) — apply**

```bash
source .tmp/t9-areas.sh && node .tmp/t9-normalize.cjs --dry "${C2[@]}"
```
Expected: the table below, then `select sites: 12 · same-row siblings: 8 · files changed: 12`. Then:
```bash
source .tmp/t9-areas.sh && node .tmp/t9-normalize.cjs --write "${C2[@]}" && git diff --stat
```

**`apps/web/src/components/expense-form-v4/PettyCashLinesSection.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 136 | NativeSelect | `rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary` | *(remove attribute)* |

**`apps/web/src/components/expense-form-v4/SettlementLinesSection.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| top | import | — | `import { formControlClass } from '@/components/ui/form-styles'; import { cn } from '@/lib/utils';` |
| 183 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm bg-background` | *(remove attribute)* |
| 194 | `<NumberInput>` (same row) | `flex-1 px-3 py-2 border border-input rounded-lg text-sm bg-background text-right font-mono` | `className={cn(formControlClass, 'flex-1 text-right font-mono')}` |

**`apps/web/src/pages/ExpenseDailySummaryPage.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 180 | NativeSelect | `min-h-11 px-3 py-2 border border-input rounded-lg text-sm bg-background` | *(remove attribute)* |

**`apps/web/src/pages/ExpenseFavoritesPage.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 116 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm bg-background` | *(remove attribute)* |

**`apps/web/src/pages/FinanceReceivablePage/FinanceContactLogDialog.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 80 | NativeSelect | `px-3 py-2 border border-input rounded-lg bg-background` | *(remove attribute)* |

**`apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| top | import | — | `import { formControlClass } from '@/components/ui/form-styles'; import { cn } from '@/lib/utils';` |
| 786 | `<input>` (same row) | `mt-1 w-full border rounded-md px-3 py-2 text-sm bg-background` | `className={cn(formControlClass, 'mt-1')}` |
| 801 | `<input>` (same row) | `mt-1 w-full border rounded-md px-3 py-2 text-sm bg-background` | `className={cn(formControlClass, 'mt-1')}` |
| 808 | NativeSelect | `border rounded-md px-3 py-2 text-sm bg-background` | *(remove attribute)* |

**`apps/web/src/pages/PaymentsPage/components/PaymentModals.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 368 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm` | *(remove attribute)* |

**`apps/web/src/pages/PaymentsPage/components/ReceiptsTab.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| top | import | — | `import { formControlClass } from '@/components/ui/form-styles'; import { cn } from '@/lib/utils';` |
| 341 | `<input>` (same row) | `px-3 py-2 border border-input rounded-lg text-sm md:col-span-1` | `className={cn(formControlClass, 'md:col-span-1')}` |
| 346 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm` | *(remove attribute)* |
| 358 | `<ThaiDateInput>` (same row) | `px-3 py-2 border border-input rounded-lg text-sm` | *(remove attribute)* |
| 364 | `<ThaiDateInput>` (same row) | `px-3 py-2 border border-input rounded-lg text-sm` | *(remove attribute)* |

**`apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 1062 | NativeSelect | `rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground leading-snug` | *(remove attribute)* |

**`apps/web/src/pages/ShopDailyCashPage.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 177 | NativeSelect | `h-11 rounded-lg border border-input bg-background px-3 text-sm` | *(remove attribute)* |

**`apps/web/src/pages/ShopPettyCashPage/components/MovementsTable.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 90 | NativeSelect | `h-11 rounded-lg border border-input bg-background px-3 text-sm` | *(remove attribute)* |

**`apps/web/src/components/payment/SlipReviewTab.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| top | import | — | `import { formControlClass } from '@/components/ui/form-styles';` |
| 618 | `<NumberInput>` (same row) | `w-full border rounded-lg px-3 py-2` | `className={formControlClass}` |
| 629 | `<NumberInput>` (same row) | `w-full border rounded-lg px-3 py-2` | `className={formControlClass}` |
| 641 | NativeSelect | `border rounded-lg px-3 py-2` | *(remove attribute)* |

- [ ] **Step 18: Area C2 — verify**

```bash
bash tools/check-types.sh web
source .tmp/t9-areas.sh && (cd apps/web && npx eslint $(printf 'src/%s ' "${C2[@]}"))
source .tmp/t9-areas.sh && (cd apps/web && npx vitest related --run --passWithNoTests $(printf 'src/%s ' "${C2[@]}"))
npm run test --workspace=apps/web -- src/components/ui/field-guards.inventory.test.ts
npm run local:preview
node tools/field-scale/check.mjs --label t9-c2
node tools/field-scale/check.mjs --compare t9-before t9-c2; echo "exit=$?"
```
Expected:
- `Web: OK`, no eslint output, related tests pass.
- Guard: FAIL with `expected [ …(42) ] to deeply equal []`.
- Compare: `exit=0`, or every new P1/P2 is accepted under the compare triage rule (cross-task notes).

- [ ] **Step 19: Area C2 — commit**

```bash
source .tmp/t9-areas.sh && git add $(printf 'apps/web/src/%s ' "${C2[@]}") && git commit -F - <<'EOF'
style(web): one field skin for NativeSelect rows — payments, expenses, cash

Remove NativeSelect skin overrides; same-row inputs that shared the old skin now
use formControlClass (spec 2026-11-14 §4.2 item 5, R1-3).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 20: Area D (settings, admin, editors) — apply**

```bash
source .tmp/t9-areas.sh && node .tmp/t9-normalize.cjs --dry "${D[@]}"
```
Expected: the table below, then `select sites: 15 · same-row siblings: 2 · files changed: 10`. Then:
```bash
source .tmp/t9-areas.sh && node .tmp/t9-normalize.cjs --write "${D[@]}" && git diff --stat
```

**`apps/web/src/components/CompanyFilter.tsx`** (`min-w-[150px]` was dead under the tail's `min-w-0`; dropping it keeps today's width)

| line | control | old `className` | new |
|---|---|---|---|
| 43 | NativeSelect | `w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden min-w-[150px]` | *(remove attribute)* |

**`apps/web/src/pages/settings/SettingsLayout.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 116 | NativeSelect | `rounded-lg border border-border bg-background py-2 px-3 text-sm` | *(remove attribute)* |

**`apps/web/src/pages/NotificationsPage/components/NotificationLogTable.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 117 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden` | *(remove attribute)* |
| 127 | NativeSelect | same as 117 | *(remove attribute)* |

**`apps/web/src/pages/NotificationsPage/components/TemplateForm.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 515 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden` | *(remove attribute)* |
| 529 | NativeSelect | same as 515 | *(remove attribute)* |
| 545 | NativeSelect | same as 515 | *(remove attribute)* |

**`apps/web/src/pages/NotificationsPage/components/TemplateManager.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 97 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden` | *(remove attribute)* |

**`apps/web/src/pages/PDPAPage.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 328 | NativeSelect | `px-3 py-2 border rounded-lg text-sm` | *(remove attribute)* |
| 418 | NativeSelect | `px-3 py-2 border rounded-lg text-sm` | *(remove attribute)* |

**`apps/web/src/pages/DocumentDashboardPage.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 110 | NativeSelect | `border border-input rounded-lg px-3 py-2 text-sm bg-background focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden` | *(remove attribute)* |

**`apps/web/src/components/template-editor/editor/BlockEditModal.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| top | import | — | `import { formControlClass } from '@/components/ui/form-styles';` |
| 94 | NativeSelect | `px-3 py-2.5 border border-input rounded-lg text-base focus:ring-2 focus:ring-primary focus:border-primary` | *(remove attribute)* |
| 111 | `<input>` (same row) | `w-full px-3 py-2.5 border border-input rounded-lg text-base focus:ring-2 focus:ring-primary` | `className={formControlClass}` |
| 121 | `<input>` (same row) | same as 111 | `className={formControlClass}` |

**`apps/web/src/components/template-editor/layout/HeaderBar.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 109 | NativeSelect | `min-h-11 px-3 py-2 text-base font-medium border border-input rounded-lg bg-background focus:ring-2 focus:ring-primary focus:border-primary disabled:opacity-50` | `className="font-medium"` |

**`apps/web/src/components/ui/RichTextEditor.tsx`** (toolbar selects were already forced to 44px by the NativeSelect tail; only radius, fill and padding change)

| line | control | old `className` | new |
|---|---|---|---|
| 272 | NativeSelect | `px-1.5 py-1 text-xs border border-border rounded bg-card hover:bg-muted` | *(remove attribute)* |
| 286 | NativeSelect | same as 272 | *(remove attribute)* |

- [ ] **Step 21: Area D — verify**

```bash
bash tools/check-types.sh web
source .tmp/t9-areas.sh && (cd apps/web && npx eslint $(printf 'src/%s ' "${D[@]}"))
source .tmp/t9-areas.sh && (cd apps/web && npx vitest related --run --passWithNoTests $(printf 'src/%s ' "${D[@]}"))
npm run test --workspace=apps/web -- src/components/ui/field-guards.inventory.test.ts
npm run local:preview
node tools/field-scale/check.mjs --label t9-d
node tools/field-scale/check.mjs --compare t9-before t9-d; echo "exit=$?"
```
Expected:
- `Web: OK`, no eslint output, related tests pass.
- Guard: FAIL with `expected [ …(27) ] to deeply equal []`.
- Compare: `exit=0`, or every new P1/P2 is accepted under the compare triage rule (cross-task notes).

- [ ] **Step 22: Area D — commit**

```bash
source .tmp/t9-areas.sh && git add $(printf 'apps/web/src/%s ' "${D[@]}") && git commit -F - <<'EOF'
style(web): one field skin for NativeSelect rows — settings, notifications, editors

Remove NativeSelect skin overrides; same-row inputs that shared the old skin now
use formControlClass (spec 2026-11-14 §4.2 item 5, R1-3).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 23: Area E (customers, contracts, collections, credit checks) — apply**

```bash
source .tmp/t9-areas.sh && node .tmp/t9-normalize.cjs --dry "${E[@]}"
```
Expected: the table below, then `select sites: 27 · same-row siblings: 34 · files changed: 15`. Then:
```bash
source .tmp/t9-areas.sh && node .tmp/t9-normalize.cjs --write "${E[@]}" && git diff --stat
```

**`apps/web/src/components/contacts/CreateContactModal.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 264 | NativeSelect | `h-9 rounded-lg border border-input bg-background px-2 text-sm outline-hidden focus:ring-2 focus:ring-ring/30` | *(remove attribute)* |

**`apps/web/src/components/contract/CreditCheckPanel.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| top | import | — | `import { formControlClass } from '@/components/ui/form-styles'; import { cn } from '@/lib/utils';` |
| 306 | NativeSelect | `px-3 py-1.5 border border-input rounded-lg text-sm` | *(remove attribute)* |
| 319 | `<input>` (same row) | `min-w-0 flex-1 px-3 py-1.5 border border-input rounded-lg text-sm` | `className={cn(formControlClass, 'min-w-0 flex-1')}` |

**`apps/web/src/components/contract/CustomerEditModal.tsx`** (skin P = `w-full px-3 py-2 border border-input rounded-lg text-sm`)

| line | control | old `className` | new |
|---|---|---|---|
| top | import | — | `import { formControlClass } from '@/components/ui/form-styles';` |
| 319 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm bg-background` | *(remove attribute)* |
| 341 | `<input>` (same row) | skin P | `className={formControlClass}` |
| 357 | `<input>` (same row) | skin P | `className={formControlClass}` |
| 371 | `<ThaiDateInput>` (same row) | skin P | *(remove attribute)* |
| 445 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm` | *(remove attribute)* |
| 472 | `<input>` (same row) | skin P | `className={formControlClass}` |
| 514 | `<input>` (same row) | skin P | `className={formControlClass}` |
| 530 | `<input>` (same row) | skin P | `className={formControlClass}` |
| 545 | `<input>` (same row) | skin P | `className={formControlClass}` |
| 560 | `<input>` (same row) | skin P | `className={formControlClass}` |
| 582 | `<input>` (same row) | skin P | `className={formControlClass}` |
| 597 | `<input>` (same row) | skin P | `className={formControlClass}` |
| 612 | `<input>` (same row) | skin P | `className={formControlClass}` |
| 655 | `<input>` (same row) | skin P | `className={formControlClass}` |
| 670 | `<input>` (same row) | skin P | `className={formControlClass}` |
| 685 | `<input>` (same row) | skin P | `className={formControlClass}` |
| 700 | `<NumberInput>` (same row) | skin P | `className={formControlClass}` |
| 758 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm bg-background` | *(remove attribute)* |
| 780 | `<input>` (same row) | skin P | `className={formControlClass}` |
| 795 | `<input>` (same row) | skin P | `className={formControlClass}` |
| 810 | `<input>` (same row) | skin P | `className={formControlClass}` |
| 825 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm bg-background` | *(remove attribute)* |

**`apps/web/src/components/credit-check/CreditCheckCreateModal.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 358 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm` | *(remove attribute)* |

**`apps/web/src/components/credit-check/CreditCheckOverrideDialog.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 185 | NativeSelect | `h-10 px-3 rounded-lg border border-input bg-background text-sm` | *(remove attribute)* |
| 223 | NativeSelect | same as 185 | *(remove attribute)* |
| 242 | NativeSelect | same as 185 | *(remove attribute)* |

**`apps/web/src/pages/CollectionsPage/components/CollectionsFilters.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| top | import | — | `import { formControlClass } from '@/components/ui/form-styles'; import { cn } from '@/lib/utils';` |
| 46 | `<input>` (same row) | `px-3 py-2 border border-input bg-card rounded-lg text-sm min-w-[260px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[2px] focus-visible:ring-offset-background focus-visible:border-transparent leading-snug` | `className={cn(formControlClass, 'min-w-[260px]')}` |
| 52 | NativeSelect | `px-3 py-2 border border-input bg-card rounded-lg text-sm leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30` | *(remove attribute)* |

**`apps/web/src/pages/CollectionsPage/components/LegalCaseDialog.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 228 | NativeSelect | `rounded-md border border-border bg-background px-2 py-2 text-sm` | *(remove attribute)* |

**`apps/web/src/pages/CollectionsPage/components/SendLineAdHocDialog.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 130 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm leading-snug` | *(remove attribute)* |

**`apps/web/src/pages/CollectionsPage/components/StuckContractsSection.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 219 | NativeSelect | `h-9 px-3 text-sm rounded-md border border-input bg-background` | *(remove attribute)* |

**`apps/web/src/pages/CollectionsPage/tabs/AllTab.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| top | import | — | `import { formControlClass } from '@/components/ui/form-styles'; import { cn } from '@/lib/utils';` |
| 229 | `<input>` (same row) | `px-3 py-2 border border-input rounded-lg text-sm min-w-[250px] focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background focus:border-transparent` | `className={cn(formControlClass, 'min-w-[250px]')}` |
| 283 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm` | *(remove attribute)* |
| 292 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm` | *(remove attribute)* |

**`apps/web/src/pages/ContractCreatePage/components/CustomerCreateModal.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| top | import | — | `import { formControlClass } from '@/components/ui/form-styles';` |
| 202 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm bg-background` | *(remove attribute)* |
| 569 | `<input>` (same row) | `w-full px-3 py-2 border border-input rounded-lg text-sm` | `className={formControlClass}` |
| 584 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm` | *(remove attribute)* |
| 615 | `<input>` (same row) | `w-full px-3 py-2 border border-input rounded-lg text-sm` | `className={formControlClass}` |
| 630 | `<NumberInput>` (same row) | `w-full px-3 py-2 border border-input rounded-lg text-sm` | `className={formControlClass}` |
| 688 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm bg-background` | *(remove attribute)* |
| 755 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm bg-background` | *(remove attribute)* |

**`apps/web/src/pages/ContractCreatePage/components/PlanDetailsStep.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 204 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm` | *(remove attribute)* |
| 233 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm` | *(remove attribute)* |

**`apps/web/src/pages/ContractDetailPage.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| top | import | — | `import { formControlClass } from '@/components/ui/form-styles';` |
| 1063 | `<NumberInput>` (same row) | `w-full px-3 py-2 border border-input rounded-lg text-sm` | `className={formControlClass}` |
| 1080 | `<NumberInput>` (same row) | same as 1063 | `className={formControlClass}` |
| 1097 | `<NumberInput>` (same row) | same as 1063 | `className={formControlClass}` |
| 1115 | `<NumberInput>` (same row) | same as 1063 | `className={formControlClass}` |
| 1132 | NativeSelect | `px-3 py-2 border border-input rounded-lg text-sm` | *(remove attribute)* |

**`apps/web/src/pages/ContractsPage.tsx`**

| line | control | old `className` | new |
|---|---|---|---|
| 301 | NativeSelect | `rounded-md border border-input bg-background px-2 text-sm` | *(remove attribute)* |

**`apps/web/src/pages/CustomerDetailPage/components/EditCustomerDialog.tsx`** (skin Q = `w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20`; the selects carry Q without the leading `w-full`)

| line | control | old `className` | new |
|---|---|---|---|
| top | import | — | `import { formControlClass } from '@/components/ui/form-styles';` |
| 245 | NativeSelect | `h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20` | *(remove attribute)* |
| 267 | `<input>` (same row) | skin Q | `className={formControlClass}` |
| 283 | `<input>` (same row) | skin Q | `className={formControlClass}` |
| 297 | `<ThaiDateInput>` (same row) | skin Q | *(remove attribute)* |
| 669 | NativeSelect | same as 245 | *(remove attribute)* |
| 691 | `<input>` (same row) | skin Q | `className={formControlClass}` |
| 706 | `<input>` (same row) | skin Q | `className={formControlClass}` |
| 721 | `<input>` (same row) | skin Q | `className={formControlClass}` |
| 736 | NativeSelect | same as 245 | *(remove attribute)* |

- [ ] **Step 24: Area E — verify (guard turns green)**

```bash
bash tools/check-types.sh web
source .tmp/t9-areas.sh && (cd apps/web && npx eslint $(printf 'src/%s ' "${E[@]}"))
source .tmp/t9-areas.sh && (cd apps/web && npx vitest related --run --passWithNoTests $(printf 'src/%s ' "${E[@]}"))
npm run test --workspace=apps/web -- src/components/ui/field-guards.inventory.test.ts
npm run local:preview
node tools/field-scale/check.mjs --label t9-e
node tools/field-scale/check.mjs --compare t9-before t9-e; echo "exit=$?"
```
Expected:
- `Web: OK`, no eslint output, related tests pass. `CreateContactModal`, `CustomerEditModal`, `CustomerCreateModal` and `EditCustomerDialog` are among R1-4's 9 forms; their tests must still pass.
- Guard: **PASS**, every test in `field-guards.inventory.test.ts` green.
- Compare: `exit=0`, or every new P1/P2 is accepted under the compare triage rule (cross-task notes).

- [ ] **Step 25: Area E — commit**

```bash
source .tmp/t9-areas.sh && git add $(printf 'apps/web/src/%s ' "${E[@]}") && git commit -F - <<'EOF'
style(web): one field skin for NativeSelect rows — customers, contracts, collections

Remove NativeSelect skin overrides; same-row inputs that shared the old skin now
use formControlClass (spec 2026-11-14 §4.2 item 5, R1-3).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 26: Full web check**

```bash
npm run test --workspace=apps/web
bash tools/check-types.sh web
npm run lint --workspace=apps/web
source .tmp/t9-areas.sh && node .tmp/t9-normalize.cjs --dry "${A[@]}" "${B[@]}" "${C1[@]}" "${C2[@]}" "${D[@]}" "${E[@]}" "${OWNED[@]}" | tail -1
```
Expected:
- The full vitest run passes. One known pre-existing Windows-only failure is acceptable: `native-select.inventory.test.ts > shared native dropdown inventory > only renders raw single-choice selects inside the two app primitives`, which compares `apps\\web\\src\\…` against `apps/web/src/…` (backslash paths; it fails the same way before this task). Report it in the PR; do not fix it here unless T7 already did.
- `Web: OK`, and eslint exits 0.
- Codemod re-run: `select sites: 0 · same-row siblings: 0 · files changed: 0`. This confirms the whole set is clean, including OWNED.

Visual spot-check: open `.tmp/field-scale/t9-e/report.md` and the PNGs of three busy pages (customer edit dialog, equity entry, stock alerts) at 1440 and 390, light and dark. Inputs and selects in a row now share radius, border, fill and height. Attach before/after shots (`t9-before` vs `t9-e`) to the PR (spec §8).

- [ ] **Step 27: Commit the guard**

```bash
git add apps/web/src/components/ui/field-guards.inventory.test.ts && git commit -F - <<'EOF'
test(web): guard NativeSelect className against skin overrides

Fails when a NativeSelect className carries rounded*, border-border, bg-*, or
p/px/py/pl/pr-* (string literals, cn() args, ?: / && branches, template text).
Spec 2026-11-14 §4.2 item 5 — enabled after R1-3 normalized all 128 sites.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
npm run local:stop
```
Expected: the commit succeeds, and `npm run local:stop` prints `Managed local preview stopped; test data retained.` `.tmp/t9-normalize.cjs` and `.tmp/t9-areas.sh` stay untracked (git-ignored). Do not push.

---

### Task 10: Label style A: FormLabel/FormItem + 9 AddressForm hosts (R1-4, §4.3)

**Goal:** every field label in the shadcn Form callers and in the 9 forms that embed `AddressForm` uses `formLabelClass` (14px · `font-medium` · `text-foreground` · `mb-3` · `block` · `leading-snug`). Control margins that only existed to make up for inline/compact labels are removed. Afterwards the F1 label rule reports 0 findings on these forms, and dialogs that are almost as tall as the screen do not get a second scrollbar.

**Depends on:** R1-2 (the guard file `apps/web/src/components/ui/field-guards.inventory.test.ts` must already exist) and on Task 2 (`tools/field-scale/check.mjs` plus the `baseline` label recorded on main). Line numbers below come from the tree at `b58250bbe`. R1-3 may have shifted them. Every edit is anchored on an exact string, so use the strings and treat the line numbers as a guide only. All touched files use CRLF line endings; the Edit tool handles that, so write the old/new strings with plain newlines as shown.

**Files:**
- Modify: `apps/web/src/components/ui/form.tsx` (import `:12` · `:60` FormItem · `:72-76` FormLabel · `:120` FormMessage)
- Test: `apps/web/src/components/ui/form.test.tsx` (append one `it` after `:33`)
- Test: `apps/web/src/components/ui/field-guards.inventory.test.ts` (append one `describe` at end of file)
- Modify (FormLabel overrides, 3 files / 27 FormLabel):
  - `apps/web/src/components/customer/CustomerCreateDialog.tsx` (17 × `<FormLabel className="text-xs font-medium">` at :530 :563 :588 :782 :810 :833 :870 :899 :1054 :1074 :1096 :1118 :1138 :1196 :1216 :1251 :1271)
  - `apps/web/src/pages/ContractCreatePage/components/PlanDetailsStep.tsx` (:166 :194 :222 :256, plus hint divs :183 :240)
  - `apps/web/src/pages/POSPage/components/SaleDetailsForm.tsx` (:118-121 :143 :206 :232 :255 :301)
- Modify (9 AddressForm hosts plus 2 trade-in children):
  - `apps/web/src/pages/CompanySettingsPage.tsx` (import :26 · 26 labels · span :460)
  - `apps/web/src/components/customer/CustomerCreateDialog.tsx` (import :4 · 9 raw labels)
  - `apps/web/src/pages/ContractCreatePage/components/CustomerCreateModal.tsx` (import :6 · 24 labels)
  - `apps/web/src/components/contract/CustomerEditModal.tsx` (import :8-13 · 23 labels)
  - `apps/web/src/pages/CustomerDetailPage/components/EditCustomerDialog.tsx` (import :5-10 · 22 labels)
  - `apps/web/src/pages/SuppliersPage/components/SupplierForm.tsx` (import already at :7 · 5 labels)
  - `apps/web/src/components/trade-in/QuickBuyModal.tsx` (import :43-47 · :629 · 13 Labels · margins :784 :817 :835 :973 :999 :1023 :1037)
  - `apps/web/src/components/trade-in/PurchaseSelect.tsx` (:40, used only by QuickBuyModal)
  - `apps/web/src/components/trade-in/SellerPaymentFields.tsx` (:4 · :40 :46 :51; rendered in QuickBuyModal step 4 and in AcceptModal)
  - `apps/web/src/pages/BranchesPage.tsx` (import :2 · 4 labels)
  - `apps/web/src/components/contacts/CreateContactModal.tsx` (import :19-23 · :254-257 :294-297 :311-312 :318-321 :336)
- Create (not committed, `.tmp/` is gitignored): `.tmp/r1-4-scroll-check.mjs`

**Interfaces:**
- Consumes: `formLabelClass` from `apps/web/src/components/ui/form-styles.ts:13` (existing: `'mb-3 block text-sm font-medium leading-snug text-foreground'`). Also consumes `field-guards.inventory.test.ts` (shared contract, created in R1-2), the CLI of `tools/field-scale/check.mjs` (`--label`, `--routes`, `--widths`, `--themes`, `--compare`; Task 2), and `npm run local:preview` (http://localhost:5195).
- Produces:
  - New defaults in `form.tsx`: `FormItem` = `min-w-0` with no stacked gap. `FormLabel` = `cn(formLabelClass, error && 'text-destructive', className)`. `FormMessage` gains `mt-1.5`, because the gap it used to get from `space-y-1.5` is gone.
  - A guard `describe('label style A (R1-4, §4.3)')` with three `it`s. Later tasks must keep it green: no FormLabel size or spacing overrides, every `htmlFor` label in the hosts uses `formLabelClass`, and QuickBuyModal has no compensating margins.

**Label inventory (enumerated with a read-only node scan of `<label`/`<Label` in each file; field labels only; checkbox/radio/inline labels and section headings excluded):**

| File | Field labels → `formLabelClass` | Old className | Excluded (kept) | Margin / wrapper changes |
|---|---|---|---|---|
| CompanySettingsPage.tsx | 26: edit dialog :156 :167 :177 :191 :202 :213 :228 :242 :263 :273 :283 :297 :307 · add dialog :436 :447 :457 :474 :488 :494 :506 :527 :543 :553 :563 :574 :585 | `block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5` | :231 :509 (checkbox) | none · span :460 `normal-case tracking-normal` → `font-normal` |
| CustomerCreateDialog.tsx | 17 FormLabel (list above) + 9 raw :982 :1012 :1153 :1287 :1322 :1344 :1360 :1376 :1392 | FormLabel `text-xs font-medium` · raw `block text-xs font-medium text-foreground mb-1.5` | :971 (checkbox) | none (`<div className="mt-2">` :1286 is a section gap, kept) |
| CustomerCreateModal.tsx | 24: :191 :213 :229 :245 :260 :279 :379 :421 :437 :452 :468 :484 :500 :515 :558 :573 :604 :619 :636 :677 :699 :714 :729 :744 | `block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2` | :361 (checkbox) | none (:635 section gap kept) |
| CustomerEditModal.tsx | 23: :308 :330 :346 :361 :434 :461 :503 :519 :534 :549 :571 :586 :601 :644 :659 :674 :689 :706 :747 :769 :784 :799 :814 | `block text-xs text-muted-foreground mb-1` | :423 (checkbox) | none (:705 section gap kept) |
| EditCustomerDialog.tsx | 22: :234 :256 :272 :287 :371 :414 :431 :446 :461 :482 :497 :512 :555 :570 :585 :600 :617 :658 :680 :695 :710 :725 | `block text-xs font-medium text-foreground mb-1.5` | :352 `customer-edit-5` (checkbox) | none (:616 section gap kept) |
| SupplierForm.tsx | 5: :527 :544 :560 :572 :585 (11 others already `formLabelClass`) | `block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2` | :373 :505 (checkbox) | none (`mt-1` hint :368 is below its control, kept) |
| QuickBuyModal.tsx | 13 `<Label>`: :725 :783 :794 :802 :814 :834 :891 :913 :930 :970 :996 :1020 :1034 | none (shadcn `Label` is inline; :725 had `text-sm font-semibold`) | :1190 :1201 (radio cards) · :1223 section heading "ลายเซ็นผู้ขาย" | S3-10: DialogContent `[&_[data-slot=input]]:mt-2` (:629) removed · `<div className="mt-2">` :784 → `<div>` · `mt-1` on Inputs :817 :973 :999 :1023 :1037 removed · dropzone `mt-2` :835 removed · PurchaseSelect.tsx:40 `mt-2` removed |
| SellerPaymentFields.tsx (QuickBuyModal step 4) | 3: :40 :46 :51 | none (inline Label) | :27 (radio) | none. Its inputs lose the parent's `mt-2`, so they need the label `mb-3` |
| BranchesPage.tsx | 4: :241 :252 :263 :286 | `block text-xs font-medium text-foreground mb-1.5` | :305 (toggle row) | none (`mt-1.5` hints :273 :277 :297 below their control, kept) |
| CreateContactModal.tsx | 3: :255 :295 :319 | `leading-snug` (inline Label) | :228 (inline segmented "ประเภท"), :357 (checkbox `ccm-hasvat`) | `space-y-1.5` wrappers :254 :294 :318 → `<div>` · error `<p>` :312 :336 gain `mt-1.5` |
| PlanDetailsStep.tsx | 4 FormLabel :166 :194 :222 :256 | `text-sm font-medium text-foreground` | none | hint divs :183 :240 gain `mt-1.5` (FormItem lost `space-y-1.5`) |
| SaleDetailsForm.tsx | 6 FormLabel :118-121 :143 :206 :232 :255 :301 | `block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2` | :77 raw price-picker group label (not a FormLabel, out of scope) | none (`FormItem className="mt-3"` :300 is a section gap, kept; `flex gap-1 mt-1` under :142's control already has its own margin) |

Totals: 132 raw labels plus 27 FormLabel. (The spec's "~170" counts checkbox/inline labels and AddressForm's own labels as well.)

---

- [ ] **Step 1: Pre-flight: confirm the dependencies and current form-styles imports**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
ls apps/web/src/components/ui/field-guards.inventory.test.ts tools/field-scale/check.mjs
grep -n "form-styles" apps/web/src/pages/CompanySettingsPage.tsx apps/web/src/components/customer/CustomerCreateDialog.tsx apps/web/src/pages/ContractCreatePage/components/CustomerCreateModal.tsx apps/web/src/components/contract/CustomerEditModal.tsx apps/web/src/pages/CustomerDetailPage/components/EditCustomerDialog.tsx apps/web/src/pages/SuppliersPage/components/SupplierForm.tsx apps/web/src/components/trade-in/QuickBuyModal.tsx apps/web/src/components/trade-in/SellerPaymentFields.tsx apps/web/src/pages/BranchesPage.tsx apps/web/src/components/contacts/CreateContactModal.tsx
```
Expected: both `ls` paths exist. If either is missing, STOP: R1-2 or Task 2 has not landed. On `b58250bbe` the grep printed only `CustomerCreateDialog.tsx:4` and `BranchesPage.tsx:2` (`formControlClass`) and `SupplierForm.tsx:7` (`formLabelClass`). **Import rule for every later step:** if a file already has `import { … } from '@/components/ui/form-styles';`, add `formLabelClass` inside those braces (for example `import { formControlClass, formLabelClass } from '@/components/ui/form-styles';`) instead of adding a second import line.

- [ ] **Step 2: Write the failing FormItem/FormLabel test**

In `apps/web/src/components/ui/form.test.tsx`, replace the last two lines of the file:
```tsx
  });
});
```
(the closing of the existing `it` at :33 and of `describe` at :34) with:
```tsx
  });

  it('uses label style A: FormLabel = formLabelClass and FormItem has no stacked gap', async () => {
    const user = userEvent.setup();
    render(<Example title="ลูกค้า" />);
    const label = screen.getByText('ชื่อ', { selector: 'label' });
    expect(label).toHaveClass('mb-3', 'block', 'text-sm', 'font-medium', 'leading-snug', 'text-foreground');
    expect(label).not.toHaveClass('text-xs');
    const item = label.closest('[data-slot="form-item"]');
    expect(item).toHaveClass('min-w-0');
    expect(item).not.toHaveClass('space-y-1.5');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    const message = await screen.findByText('กรุณากรอกชื่อ');
    expect(message).toHaveClass('mt-1.5');
    expect(label).toHaveClass('text-destructive');
    expect(label).not.toHaveClass('text-foreground');
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE" && npm run test --workspace=apps/web -- src/components/ui/form.test.tsx
```
Expected: `Tests  1 failed | 1 passed (2)`, with output containing
`expect(element).toHaveClass("mb-3", "block", "text-sm", "font-medium", "leading-snug", "text-foreground")` / `Expected the element to have class:`. The label currently receives `text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-50 text-xs font-medium` (no `mb-3`/`block`/`leading-snug`).

- [ ] **Step 4: Change the defaults in `form.tsx`**

Edit `apps/web/src/components/ui/form.tsx`:

(a) Import (:12). Old:
```tsx
import { Label } from '@/components/ui/label';
```
New:
```tsx
import { Label } from '@/components/ui/label';
import { formLabelClass } from '@/components/ui/form-styles';
```
(b) FormItem (:60). Old:
```tsx
      <div data-slot="form-item" className={cn('min-w-0 space-y-1.5', className)} {...props} />
```
New:
```tsx
      <div data-slot="form-item" className={cn('min-w-0', className)} {...props} />
```
(c) FormLabel (:72-76). Old:
```tsx
      className={cn(
        'text-xs font-medium',
        error && 'text-destructive',
        className,
      )}
```
New:
```tsx
      className={cn(
        formLabelClass,
        error && 'text-destructive',
        className,
      )}
```
(d) FormMessage (:120). Old:
```tsx
      className={cn('text-2xs font-medium text-destructive animate-in fade-in-0 slide-in-from-top-1 duration-200', className)}
```
New:
```tsx
      className={cn('mt-1.5 text-2xs font-medium text-destructive animate-in fade-in-0 slide-in-from-top-1 duration-200', className)}
```

- [ ] **Step 5: Run the test and see it pass**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE" && npm run test --workspace=apps/web -- src/components/ui/form.test.tsx
```
Expected: `Test Files  1 passed (1)` · `Tests  2 passed (2)`.

- [ ] **Step 6: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE" && git add apps/web/src/components/ui/form.tsx apps/web/src/components/ui/form.test.tsx && git commit -m "$(cat <<'EOF'
feat(web): FormLabel/FormItem default to label style A (R1-4)

FormLabel uses formLabelClass (14px, mb-3); FormItem drops space-y-1.5;
FormMessage gets mt-1.5 so errors keep their gap below the control.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Append the failing FormLabel-override guard**

Append this block at the very end of `apps/web/src/components/ui/field-guards.inventory.test.ts`. vitest `globals: true` is on (`apps/web/vitest.config.ts`) and the file already uses `describe`/`it`/`expect`. The block imports node modules dynamically, so it does not collide with helper names declared earlier in that file.
```ts

// ── R1-4 · §4.3 — ป้ายแบบ A (label style A) ─────────────────────────────────────
// Self-contained on purpose: local helpers + dynamic node imports, so this block does not
// depend on (or clash with) the helpers declared earlier in this file.
describe('label style A (R1-4, §4.3)', () => {
  const REPO_ROOT_FROM_UI = '../../../../..';

  it(
    'no FormLabel caller overrides the default label size or spacing',
    async () => {
      const { readFileSync, readdirSync } = await import('node:fs');
      const { resolve, relative } = await import('node:path');
      const root = resolve(__dirname, REPO_ROOT_FROM_UI);
      const walk = (dir: string, out: string[] = []): string[] => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const file = resolve(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== 'dist') walk(file, out);
          } else if (/\.tsx?$/.test(entry.name) && !/[.-](test|spec)\.tsx?$/.test(entry.name)) {
            out.push(file);
          }
        }
        return out;
      };
      const files = walk(resolve(root, 'apps/web/src'));
      // Guard against walking the wrong tree and passing vacuously (~1.3k files today).
      expect(files.length).toBeGreaterThan(500);
      const OVERRIDE = /<FormLabel\b[^>]*?className="([^"]*)"/g;
      const SIZE_OR_SPACING =
        /(?:^|\s)(?:text-(?:2xs|xs|sm|base|lg)|uppercase|tracking-\S+|m[tbyx]?-\S+|block)(?=\s|$)/;
      const offenders: string[] = [];
      for (const file of files) {
        const source = readFileSync(file, 'utf8');
        if (!source.includes('<FormLabel')) continue;
        for (const match of source.matchAll(OVERRIDE)) {
          if (SIZE_OR_SPACING.test(match[1])) {
            offenders.push(`${relative(root, file)}: "${match[1]}"`);
          }
        }
      }
      expect(offenders).toEqual([]);
    },
    30_000,
  );

  // R1-4 host checks (Task 10 step 14) go here.
});
```

- [ ] **Step 8: Run the guard and watch it fail**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE" && npm run test --workspace=apps/web -- src/components/ui/field-guards.inventory.test.ts -t "label style A"
```
Expected: FAIL in `no FormLabel caller overrides the default label size or spacing` with an `AssertionError: expected [ 'apps/web/src/components/customer/CustomerCreateDialog.tsx: "text-xs font-medium"', …(more) ] to deeply equal []`. The diff lists 27 entries: 17 from `CustomerCreateDialog.tsx` (`"text-xs font-medium"`), 4 from `PlanDetailsStep.tsx` and 6 from `SaleDetailsForm.tsx`. (On Windows the paths print with `\` separators.) Other tests in the file show as skipped.

- [ ] **Step 9: Remove the overrides in `PlanDetailsStep.tsx` and keep the hint gap**

`apps/web/src/pages/ContractCreatePage/components/PlanDetailsStep.tsx`:
(a) Edit with **replace_all: true**. Old: ` className="text-sm font-medium text-foreground">` New: `>` (4 occurrences, all on FormLabel at :166 :194 :222 :256).
(b) Old (:183):
```tsx
              <div className="text-xs text-muted-foreground">เงินสด/โอนขั้นต่ำเพิ่ม
```
New:
```tsx
              <div className="mt-1.5 text-xs text-muted-foreground">เงินสด/โอนขั้นต่ำเพิ่ม
```
(c) Old (:239-241):
```tsx
              </FormControl>
              <div className="text-xs text-muted-foreground">
                {selectedCustomer?.salaryPayDay
```
New:
```tsx
              </FormControl>
              <div className="mt-1.5 text-xs text-muted-foreground">
                {selectedCustomer?.salaryPayDay
```

- [ ] **Step 10: Remove the overrides in `SaleDetailsForm.tsx`**

`apps/web/src/pages/POSPage/components/SaleDetailsForm.tsx`:
(a) Old (:118-121):
```tsx
                  <FormLabel
                    htmlFor={sellingPriceId}
                    className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2"
                  >
```
New:
```tsx
                  <FormLabel htmlFor={sellingPriceId}>
```
(b) Edit with **replace_all: true**. Old: `<FormLabel className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">` New: `<FormLabel>` (5 occurrences: :143 :206 :232 :255 :301).

- [ ] **Step 11: Remove the overrides in `CustomerCreateDialog.tsx`**

`apps/web/src/components/customer/CustomerCreateDialog.tsx`: Edit with **replace_all: true**. Old: `<FormLabel className="text-xs font-medium">` New: `<FormLabel>` (17 occurrences).

- [ ] **Step 12: Run the guard and the affected tests and see them pass**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE" && npm run test --workspace=apps/web -- src/components/ui/field-guards.inventory.test.ts src/components/ui/form.test.tsx src/pages/ContractCreatePage/components/PlanDetailsStep.payday.test.tsx src/components/customer/CustomerCreateDialog.test.tsx src/components/customer/CustomerCreateDialog.financeLine.test.tsx src/pages/POSPage/POSPage.test.tsx
```
Expected: every file passes (`Test Files  6 passed (6)`). The `label style A` describe shows 1 passed. (`POSPage.test.tsx` renders `SaleDetailsForm` unmocked; it had 12 passing tests before this task.)

- [ ] **Step 13: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE" && git add apps/web/src/components/ui/field-guards.inventory.test.ts apps/web/src/pages/ContractCreatePage/components/PlanDetailsStep.tsx apps/web/src/pages/POSPage/components/SaleDetailsForm.tsx apps/web/src/components/customer/CustomerCreateDialog.tsx && git commit -m "$(cat <<'EOF'
refactor(web): drop FormLabel size overrides in shadcn Form callers (R1-4)

27 FormLabel in CustomerCreateDialog, PlanDetailsStep and SaleDetailsForm now use the
style-A default; PlanDetailsStep hints keep a 6px gap below the control. Guard test
blocks new size/spacing overrides on FormLabel.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 14: Add the failing host guards**

In `apps/web/src/components/ui/field-guards.inventory.test.ts`, replace the old text:
```ts
  // R1-4 host checks (Task 10 step 14) go here.
});
```
with:
```ts
  const STYLE_A_HOSTS = [
    'apps/web/src/pages/CompanySettingsPage.tsx',
    'apps/web/src/components/customer/CustomerCreateDialog.tsx',
    'apps/web/src/pages/ContractCreatePage/components/CustomerCreateModal.tsx',
    'apps/web/src/components/contract/CustomerEditModal.tsx',
    'apps/web/src/pages/CustomerDetailPage/components/EditCustomerDialog.tsx',
    'apps/web/src/pages/SuppliersPage/components/SupplierForm.tsx',
    'apps/web/src/components/trade-in/QuickBuyModal.tsx',
    // Rendered inside QuickBuyModal step 4 (and TradeInPage AcceptModal).
    'apps/web/src/components/trade-in/SellerPaymentFields.tsx',
    'apps/web/src/pages/BranchesPage.tsx',
    'apps/web/src/components/contacts/CreateContactModal.tsx',
  ];
  // Checkbox labels sit beside their box (inline) — they are not field labels.
  const INLINE_LABEL_FOR = new Set(['"customer-edit-5"', '"ccm-hasvat"']);
  const LEGACY_LABEL_RECIPES = [
    'block text-2xs font-medium text-muted-foreground uppercase tracking-wider',
    'block text-xs font-medium text-foreground mb-1.5',
    'block text-xs text-muted-foreground mb-1',
  ];
  const FIELD_LABEL = /<(?:label|Label)\s+htmlFor=(\{`[^`]*`\}|\{[^}]*\}|"[^"]*")([^>]*)>/g;

  async function readRepoFile(rel: string): Promise<string> {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    return readFileSync(resolve(__dirname, REPO_ROOT_FROM_UI, rel), 'utf8');
  }

  it('every field label in the 9 AddressForm hosts uses formLabelClass', async () => {
    const offenders: string[] = [];
    for (const rel of STYLE_A_HOSTS) {
      const source = await readRepoFile(rel);
      for (const recipe of LEGACY_LABEL_RECIPES) {
        if (source.includes(recipe)) offenders.push(`${rel}: legacy label "${recipe}"`);
      }
      for (const match of source.matchAll(FIELD_LABEL)) {
        if (INLINE_LABEL_FOR.has(match[1])) continue;
        if (!match[2].includes('formLabelClass')) offenders.push(`${rel}: label htmlFor=${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('QuickBuyModal controls no longer carry margins that compensated for inline labels', async () => {
    const modal = await readRepoFile('apps/web/src/components/trade-in/QuickBuyModal.tsx');
    const select = await readRepoFile('apps/web/src/components/trade-in/PurchaseSelect.tsx');
    expect(modal).not.toContain('[&_[data-slot=input]]:mt-2');
    expect(modal).not.toMatch(/className="mt-1(?: font-mono)?"/);
    expect(modal).not.toContain('<div className="mt-2">');
    expect(modal).not.toContain('className="mt-2 flex min-h-16');
    expect(modal).not.toContain('<Label>');
    expect(select).not.toContain('className="mt-2 h-12');
  });
});
```

- [ ] **Step 15: Run the host guards and watch them fail**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE" && npm run test --workspace=apps/web -- src/components/ui/field-guards.inventory.test.ts -t "label style A"
```
Expected: `2 failed | 1 passed` (other tests in the file skipped).
- `every field label in the 9 AddressForm hosts uses formLabelClass` fails with an `AssertionError: expected [ … ] to deeply equal []`. On `b58250bbe` the diff lists 129 entries: 7 `legacy label` entries plus 122 `label htmlFor=` entries. The exact number may differ if R1-3 already touched a host.
- `QuickBuyModal controls …` fails on `[&_[data-slot=input]]:mt-2`.

- [ ] **Step 16: CompanySettingsPage.tsx (26 labels)**

(a) Import. Old: `} from '@/components/ui/AddressForm';` New (two lines; see the import rule in Step 1):
```tsx
} from '@/components/ui/AddressForm';
import { formLabelClass } from '@/components/ui/form-styles';
```
(b) Edit with **replace_all: true**. Old: `className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5"` New: `className={formLabelClass}` (26 occurrences).
(c) Old (:460): `<span className="ml-1 text-muted-foreground normal-case tracking-normal">` New: `<span className="ml-1 font-normal text-muted-foreground">`

- [ ] **Step 17: CustomerCreateDialog.tsx (9 raw labels)**

(a) Old (:4): `import { formControlClass } from '@/components/ui/form-styles';` New: `import { formControlClass, formLabelClass } from '@/components/ui/form-styles';`
(b) Edit with **replace_all: true**. Old: `className="block text-xs font-medium text-foreground mb-1.5"` New: `className={formLabelClass}` (9 occurrences).

- [ ] **Step 18: CustomerCreateModal.tsx (24 labels)**

(a) Old (:6): `import AddressForm, { AddressData } from '@/components/ui/AddressForm';` New:
```tsx
import AddressForm, { AddressData } from '@/components/ui/AddressForm';
import { formLabelClass } from '@/components/ui/form-styles';
```
(b) Edit with **replace_all: true**. Old: `className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2"` New: `className={formLabelClass}` (24 occurrences).

- [ ] **Step 19: CustomerEditModal.tsx (23 labels)**

(a) Old: `} from '@/components/ui/AddressForm';` New:
```tsx
} from '@/components/ui/AddressForm';
import { formLabelClass } from '@/components/ui/form-styles';
```
(b) Edit with **replace_all: true**. Old: `className="block text-xs text-muted-foreground mb-1"` New: `className={formLabelClass}` (23 occurrences).

- [ ] **Step 20: EditCustomerDialog.tsx (22 labels)**

(a) Old: `} from '@/components/ui/AddressForm';` New:
```tsx
} from '@/components/ui/AddressForm';
import { formLabelClass } from '@/components/ui/form-styles';
```
(b) Edit with **replace_all: true**. Old: `className="block text-xs font-medium text-foreground mb-1.5"` New: `className={formLabelClass}` (22 occurrences; the checkbox label `customer-edit-5` uses `flex items-center gap-2 cursor-pointer` and is not matched).

- [ ] **Step 21: SupplierForm.tsx (5 labels, import already present at :7)**

Edit with **replace_all: true**. Old: `className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2"` New: `className={formLabelClass}` (5 occurrences: :527 :544 :560 :572 :585).

- [ ] **Step 22: BranchesPage.tsx (4 labels)**

(a) Old (:2): `import { formControlClass } from '@/components/ui/form-styles';` New: `import { formControlClass, formLabelClass } from '@/components/ui/form-styles';`
(b) Edit with **replace_all: true**. Old: `className="block text-xs font-medium text-foreground mb-1.5"` New: `className={formLabelClass}` (4 occurrences).

- [ ] **Step 23: CreateContactModal.tsx (3 labels, drop `space-y-1.5`, keep error gap)**

(a) Old: `} from '@/components/ui/AddressForm';` New:
```tsx
} from '@/components/ui/AddressForm';
import { formLabelClass } from '@/components/ui/form-styles';
```
(b) Old:
```tsx
            <div className="space-y-1.5">
              <Label htmlFor="ccm-name" className="leading-snug">
```
New:
```tsx
            <div>
              <Label htmlFor="ccm-name" className={formLabelClass}>
```
(c) Old:
```tsx
              <div className="space-y-1.5">
                <Label htmlFor="ccm-idnumber" className="leading-snug">
```
New:
```tsx
              <div>
                <Label htmlFor="ccm-idnumber" className={formLabelClass}>
```
(d) Old:
```tsx
                  <p className="text-xs text-destructive leading-snug">
                    ต้องเป็นตัวเลขครบ 13 หลัก
```
New:
```tsx
                  <p className="mt-1.5 text-xs text-destructive leading-snug">
                    ต้องเป็นตัวเลขครบ 13 หลัก
```
(e) Old:
```tsx
              <div className="space-y-1.5">
                <Label htmlFor="ccm-phone" className="leading-snug">
```
New:
```tsx
              <div>
                <Label htmlFor="ccm-phone" className={formLabelClass}>
```
(f) Old:
```tsx
                  <p className="text-xs text-destructive leading-snug">
                    เบอร์โทรต้องเป็นเลข 10 หลัก
```
New:
```tsx
                  <p className="mt-1.5 text-xs text-destructive leading-snug">
                    เบอร์โทรต้องเป็นเลข 10 หลัก
```

- [ ] **Step 24: QuickBuyModal.tsx: import, global input margin, Labels (S3-10)**

`apps/web/src/components/trade-in/QuickBuyModal.tsx`:
(a) Old: `} from '@/components/ui/AddressForm';` New:
```tsx
} from '@/components/ui/AddressForm';
import { formLabelClass } from '@/components/ui/form-styles';
```
(b) DialogContent className (:629). Old: `[&_[data-slot=input]]:mt-2 [&_[data-slot=input]]:h-11` New: `[&_[data-slot=input]]:h-11`
(c) Old: `<Label htmlFor="quick-buy-branch" className="text-sm font-semibold">` New: `<Label htmlFor="quick-buy-branch" className={formLabelClass}>`
(d) Old:
```tsx
                  <Label>ผู้ขาย *</Label>
                  <div className="mt-2">
```
New:
```tsx
                  <Label className={formLabelClass}>ผู้ขาย *</Label>
                  <div>
```
(e) Ten single-line edits, each old → new (`X` = the exact id shown):
`<Label htmlFor="X">` → `<Label htmlFor="X" className={formLabelClass}>` for X = `buy-seller-name`, `buy-seller-phone`, `buy-seller-id`, `quick-buy-model`, `quick-buy-storage`, `quick-buy-color`, `quick-buy-imei`, `quick-buy-serial`, `buy-imei-reason`, `buy-serial-reason`. (Each old string occurs exactly once.)
(f) Old:
```tsx
                  <Label>แนบรูปบัตรประชาชน</Label>
                  <label className="mt-2 flex min-h-16
```
New:
```tsx
                  <Label className={formLabelClass}>แนบรูปบัตรประชาชน</Label>
                  <label className="flex min-h-16
```

- [ ] **Step 25: QuickBuyModal.tsx: remove the Input `mt-1`s; PurchaseSelect `mt-2`; SellerPaymentFields labels**

(a) QuickBuyModal, edit with **replace_all: true**. Old: `className="mt-1 font-mono"` New: `className="font-mono"` (3 occurrences: :817 :973 :999).
(b) Old:
```tsx
                          id="buy-imei-reason"
                          className="mt-1"
```
New:
```tsx
                          id="buy-imei-reason"
```
(c) Old:
```tsx
                          id="buy-serial-reason"
                          className="mt-1"
```
New:
```tsx
                          id="buy-serial-reason"
```
(d) `apps/web/src/components/trade-in/PurchaseSelect.tsx:40`. Old: `className="mt-2 h-12 min-w-0` New: `className="h-12 min-w-0`
(e) `apps/web/src/components/trade-in/SellerPaymentFields.tsx`. Old (:4): `import { Label } from '@/components/ui/label';` New:
```tsx
import { Label } from '@/components/ui/label';
import { formLabelClass } from '@/components/ui/form-styles';
```
Then three edits:
- `<Label htmlFor={`${id}-bank`}>` → `<Label htmlFor={`${id}-bank`} className={formLabelClass}>`
- `<Label htmlFor={`${id}-account`}>` → `<Label htmlFor={`${id}-account`} className={formLabelClass}>`
- `<Label htmlFor={`${id}-name`}>` → `<Label htmlFor={`${id}-name`} className={formLabelClass}>`

- [ ] **Step 26: Run the guard and see it pass**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE" && npm run test --workspace=apps/web -- src/components/ui/field-guards.inventory.test.ts
```
Expected: the whole file passes. The `label style A (R1-4, §4.3)` describe shows 3 passed. (A dry run of Steps 16–25 against `b58250bbe` leaves 0 offenders for both host checks.)

- [ ] **Step 27: Run every test that renders a touched form**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE" && npm run test --workspace=apps/web -- src/components/ui/form.test.tsx src/components/ui/field-guards.inventory.test.ts src/components/customer/CustomerCreateDialog.test.tsx src/components/customer/CustomerCreateDialog.financeLine.test.tsx src/pages/ContractCreatePage/components/PlanDetailsStep.payday.test.tsx src/pages/ContractCreatePage/components/CustomerCreateModal.financeLine.test.tsx src/components/contract/CustomerEditModal.fallback.test.tsx src/pages/CustomerDetailPage/__tests__/EditCustomerDialog.test.tsx src/pages/CustomerDetailPage/__tests__/EditCustomerDialog.financeLine.test.tsx src/components/contacts/CreateContactModal.test.tsx src/components/trade-in/TradeInFlow.test.tsx src/components/trade-in/SellerPaymentFields.test.tsx src/pages/settings/__tests__/company-access-system-migration.test.tsx src/pages/__tests__/ContactsPage.test.tsx src/pages/BookingsPage/__tests__/CreateBookingDialog.test.tsx src/pages/POSPage/POSPage.test.tsx
```
Expected: `Test Files  16 passed (16)`. Before this task, the 15 non-guard files gave `Tests  150 passed (150)` (verified on `b58250bbe`). Now you get 150 plus the 1 new form test plus the guard file's tests. None of these tests query by class, so a failure means a label lost its `htmlFor` association. Fix it; do not change the test.

- [ ] **Step 28: Type check + lint**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE" && bash tools/check-types.sh web && npm run lint --workspace=apps/web
```
Expected: the type check reports 0 errors, and eslint exits 0 with no `no-duplicate-imports`/unused warnings in the touched files.

- [ ] **Step 29: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE" && git add apps/web/src/components/ui/field-guards.inventory.test.ts apps/web/src/pages/CompanySettingsPage.tsx apps/web/src/components/customer/CustomerCreateDialog.tsx apps/web/src/pages/ContractCreatePage/components/CustomerCreateModal.tsx apps/web/src/components/contract/CustomerEditModal.tsx apps/web/src/pages/CustomerDetailPage/components/EditCustomerDialog.tsx apps/web/src/pages/SuppliersPage/components/SupplierForm.tsx apps/web/src/components/trade-in/QuickBuyModal.tsx apps/web/src/components/trade-in/PurchaseSelect.tsx apps/web/src/components/trade-in/SellerPaymentFields.tsx apps/web/src/pages/BranchesPage.tsx apps/web/src/components/contacts/CreateContactModal.tsx && git commit -m "$(cat <<'EOF'
feat(web): label style A in the 9 AddressForm hosts (R1-4, §4.3)

132 field labels move to formLabelClass so they match AddressForm's own labels (S3-12).
QuickBuyModal drops the margins that compensated for inline labels: global input mt-2,
Input mt-1, ContactCombobox/dropzone/PurchaseSelect mt-2 (S3-10). CreateContactModal
drops space-y-1.5 wrappers; error text keeps mt-1.5. Guard test pins all of it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 30: Field-scale check: F1 (label) = 0 on these forms, nothing new compared with the baseline (except findings accepted under the compare triage rule)**

Start (restart) the preview — this task's source edits made it stale (it detaches and returns):
```bash
cd "/d/BESTCHOICE APP/BESTCHOICE" && npm run local:preview
```
Expected output: `Started http://localhost:5195` (or `Reused http://localhost:5195`).

The route ids Task 2 registered for these forms (`tools/field-scale/routes.mjs`): CompanySettings edit / add company = `company-entity-edit`, `company-entity-create`; customer create = `customer-create-dialog`; contract-create customer modal = `contract-customer-create`; contract customer edit = `contract-customer-edit`; customer detail edit = `customer-edit-dialog`; supplier form = `supplier-form`; trade-in quick buy = `trade-in-quick-buy`; branches = `branch-create`; contacts create = `contact-create`; POS (SaleDetailsForm) = `pos-sale-form`. **The contract-create plan step (PlanDetailsStep) is not measured**: reaching step 3 needs a customer whose credit check is approved and a blacklist result (`useContractCreateData.ts:659-668`, fail-closed), and the preview has no credit-approved sample customer and answers `GET /customers/:id/blacklist` 501. PlanDetailsStep is proven by `PlanDetailsStep.payday.test.tsx` + the Step 7 guard, and listed in the PR as "not measured". Run the check with those ids and compare against the `baseline` label created in Task 2 (`.tmp/field-scale/baseline/`).
```bash
node tools/field-scale/check.mjs --label r1-4 --routes company-entity-edit,company-entity-create,customer-create-dialog,contract-customer-create,contract-customer-edit,customer-edit-dialog,supplier-form,trade-in-quick-buy,branch-create,contact-create,pos-sale-form --widths 1440,1024,390 --themes light,dark
node tools/field-scale/check.mjs --compare baseline r1-4
node -e "const j=require('./.tmp/field-scale/r1-4/results.json');const all=j.cells.flatMap(c=>c.findings.filter(f=>!f.allowed));const f1=all.filter(f=>f.rule==='F1'&&/^label(FontSize|Gap)@/.test(f.key));console.log('F1 label findings:',f1.length);for(const f of f1)console.log(f.route,f.width,f.theme,JSON.stringify(f.detail??f));"
```
Expected:
- `--compare` exits 0, or every new P1/P2 is accepted under the compare triage rule (cross-task notes).
- The last command prints `F1 label findings: 0`.
- F1 height/radius/border findings may remain on these forms. Those belong to the control normalisation in R1-3/R2, but they must not exceed the baseline, except for findings accepted under the compare triage rule (cross-task notes).

If any label finding remains, open `.tmp/field-scale/r1-4/<route>-<width>-<theme>.png`, find the label in the table above, fix it, then repeat Steps 26–30.

- [ ] **Step 31: Check that near-full-height dialogs have no nested scrollbars (390×844 and 1440×900)**

Create `.tmp/r1-4-scroll-check.mjs`. `.tmp/` is gitignored, so do not commit this file. The Quick Buy path copies the selectors of `tools/check-local-trade-in.mjs` up to step 3 (seller step, the tallest step and the one whose labels changed). It requests a price quote only and saves nothing.
```js
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const origin = process.env.PREVIEW_ORIGIN ?? 'http://localhost:5195';
const out = '.tmp/field-scale/r1-4-scroll';
mkdirSync(out, { recursive: true });
assert.equal((await fetch(`${origin}/api/admin/preview/info`)).status, 200, 'Run `npm run local:preview` first');

// Elements inside the open dialog that actually scroll vertically (incl. the dialog itself).
const scrollers = () =>
  [...document.querySelectorAll('[role="dialog"], [role="dialog"] *')]
    .filter((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1)
    .map((el) => el.getAttribute('data-testid') || `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 4).join('.')}`);

async function openCustomerCreate(page) {
  await page.goto(new URL('/customers', origin).href, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /เพิ่ม(ลูกค้า|ผู้สนใจ)ใหม่/ }).first().click();
  await page.getByRole('dialog').first().waitFor();
}

async function openQuickBuySellerStep(page) {
  await page.goto(new URL('/trade-in?zone=shop', origin).href, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'รับซื้อเครื่อง', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('ขั้นที่ 1 / 4', { exact: true }).waitFor();
  await dialog.getByRole('combobox', { name: 'รุ่น iPhone *', exact: true }).click();
  await page.getByRole('option', { name: 'iPhone 15', exact: true }).click();
  const questionsResponse = page.waitForResponse(
    (r) => r.url().includes('/trade-ins/quick-buy/questions') && r.request().method() === 'GET',
  );
  await dialog.getByRole('combobox', { name: 'ความจุ *', exact: true }).click();
  await page.getByRole('option', { name: '128GB', exact: true }).click();
  const questionnaire = await (await questionsResponse).json();
  await dialog.getByLabel('IMEI', { exact: true }).fill(`99${Date.now()}`);
  await dialog.getByLabel('Serial Number', { exact: true }).fill(`R14-SN-${Date.now()}`);
  await dialog.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await dialog.getByText('ขั้นที่ 2 / 4', { exact: true }).waitFor();
  const priced = page.waitForResponse(
    (r) => r.url().includes('/trade-ins/quick-buy/preview') && r.request().method() === 'POST',
  );
  if (questionnaire.eligibilityRequired) {
    await dialog.getByRole('checkbox', { name: 'ยืนยันเครื่องผ่านเงื่อนไขรับซื้อ', exact: true }).check();
  }
  for (const question of questionnaire.questions) {
    const group = dialog.getByRole('group', { name: new RegExp(question.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
    if (question.selectType === 'MULTI') {
      await group.getByRole('checkbox', { name: 'ตรวจแล้ว ไม่พบปัญหา', exact: true }).check();
    } else {
      const choice = question.choices.find((c) => Number(c.deductValue) === 0) ?? question.choices[0];
      await group.getByRole('radio', { name: choice.label, exact: true }).check();
    }
  }
  assert.equal((await priced).status(), 201, 'Quick Buy price preview failed');
  await dialog.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await dialog.getByText('ขั้นที่ 3 / 4', { exact: true }).waitFor();
}

const cases = [
  { name: 'customer-create', open: openCustomerCreate },
  { name: 'quick-buy-seller', open: openQuickBuySellerStep },
];
const failures = [];
const browser = await chromium.launch();
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    for (const c of cases) {
      // Fresh context per case: no Escape/close handling between multi-step dialogs.
      const context = await browser.newContext({ viewport });
      await context.routeWebSocket('**/socket.io/**', (socket) => socket.close());
      const page = await context.newPage();
      await c.open(page);
      // Measure the tallest state: expand every collapsible section in the dialog.
      await page.evaluate(() => document.querySelectorAll('[role="dialog"] details').forEach((d) => { d.open = true; }));
      const found = await page.evaluate(scrollers);
      await page.screenshot({ path: `${out}/${c.name}-${viewport.width}x${viewport.height}.png` });
      console.log(c.name, `${viewport.width}x${viewport.height}`, 'scrollers:', found);
      if (found.length > 1) failures.push(`${c.name} ${viewport.width}x${viewport.height}: ${found.join(' | ')}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
}
assert.deepEqual(failures, []);
console.log('PASS: CustomerCreateDialog and QuickBuyModal (seller step) have at most one scroll container at 390x844 and 1440x900');
```
Run:
```bash
cd "/d/BESTCHOICE APP/BESTCHOICE" && node .tmp/r1-4-scroll-check.mjs
```
Expected: four lines, each listing **at most one** scroller. When the content overflows, that scroller is `form.flex.min-h-0.flex-1…` for customer-create (CustomerCreateDialog.tsx:640) and `quick-buy-body` for quick-buy-seller. When the content fits, the list is `[]`. Then `PASS: …`.

If a second scroller appears, remove the inner `overflow-y-auto`/`max-h-*` that caused it, keep the dialog body as the only scroll area, and repeat Steps 27–31. If the Quick Buy path times out on a selector, compare it with `tools/check-local-trade-in.mjs`. That script is the source of truth for the flow.

- [ ] **Step 32: Review the screenshots (S3-10 / S3-12)**

Open the 4 PNGs in `.tmp/field-scale/r1-4-scroll/` and check:
- `quick-buy-seller-1440x900.png`: the "เบอร์โทรผู้ขาย *" and "เลขบัตรประชาชน *" inputs share one row with equal top edges (S3-10: the old `mt-1` misaligned them by 4px).
- `quick-buy-seller-390x844.png`: those two fields stack (the grid is `sm:grid-cols-2`), and each label sits 12px above its control.
- Both quick-buy shots: the AddressForm block "ที่อยู่ตามบัตร" has the same 12px label → control gap as the fields above it (S3-12).
- `customer-create-*.png`: labels are 14px with a 12px gap. At 390 the footer (submit button) stays reachable inside the single scroll area.

Note the result (pass, or what you fixed) for the PR description.

- [ ] **Step 33: Stop the preview; commit only if Steps 30–32 required a fix**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE" && npm run local:stop && git status --short
```
Expected: `Managed local preview stopped; test data retained.`, then a working tree that is clean or contains only fixes made in Steps 30–32. Commit any fixes with `git add <files> && git commit -m "fix(web): <what> (R1-4)"` using the same `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` heredoc body. Do not push.

---

**Gaps / notes:**
- Route ids for `tools/field-scale/check.mjs --routes` are defined by Task 2 and do not exist yet (`tools/field-scale/` is absent on `b58250bbe`). Step 30 finds them with grep instead of naming them. The 'F1 label' filter relies on the Task 1 shape: the rule id is in `rule` and label findings are keyed `labelFontSize@<controlKey>` / `labelGap@<controlKey>`, one per labelled member of a row whose label font or gap is inconsistent (every member of that row, not only the odd one). Adjust the one-liner if T2 changes the results.json shape.
- Step 31 drives QuickBuyModal to step 3 with the same selectors as `tools/check-local-trade-in.mjs`. It requests a price quote (`POST /trade-ins/quick-buy/preview`) but saves nothing. If a later change renames those controls, update both scripts. Step 4 (payment, SellerPaymentFields) is not screenshotted; the guard test and the T2 runner cover it.
- Controls themselves are not normalised in this task, and F1 height/radius/background findings may remain on these forms. Examples: PurchaseSelect h-12/rounded-xl, CreateContactModal NativeSelect h-9 rounded-lg, and the local inputClass in CompanySettingsPage/CustomerCreateModal/SaleDetailsForm/PlanDetailsStep. That work belongs to R1-3/R2. This task only drives the F1 *label* sub-check to 0.
- Group-heading `<label>`s with no associated control are restyled with `formLabelClass` for visual consistency next to AddressForm's 14px labels: CompanySettingsPage 'ที่อยู่' and 'สถานะ VAT', the work-address headings in the 4 customer forms, and BranchesPage's cash-drawer label. Their element type is left unchanged. Converting them to `LabeledField` or a heading was not requested.
- SellerPaymentFields.tsx and PurchaseSelect.tsx are outside the 9-file list. They are touched because removing QuickBuyModal's global `[&_[data-slot=input]]:mt-2` would otherwise collapse their label→input gap. The SellerPaymentFields change also restyles TradeInPage AcceptModal.
- Not converted: CreateContactModal :228 'ประเภท' (an inline label beside the segmented buttons), SaleDetailsForm :77 (raw price-picker group label, not a FormLabel), QuickBuyModal :1223 (signature section heading).
- Dark theme is only covered by the T2 runner (Step 30). The nested-scroll script (Step 31) runs in the default theme.

---

### Task 11: Label style A in the forms Task 8 edits (R1-3, §4.3 ค)

**Goal:** Every field label in the forms Task 8 edits uses `formLabelClass` (`mb-3 block text-sm font-medium leading-snug text-foreground`). The 12 px gap from `mb-3` is the only space between a label and its control. This follows the owner's decision in spec §4.1 (label row) and §4.3 (ค): "forms touched in round 1 adopt style A".

**Runs after:** Task 8 (controls → `formControlClass` / `ReadOnlyField` / Appendix ก fixes in these files) and Task 10 (shadcn `FormLabel`/`FormItem` default = style A).

**Scope:**
- **Skipped here:** `ChatbotFinanceKnowledgePage.tsx` (Task 8 already converts all its labels) and `CompanySettingsPage.tsx` (Task 10).
- **No `FormLabel` sites:** none of the files below has one (checked with grep at HEAD `b58250bbe`). No overrides need removing.
- **No ID changes:** do not add or remove any `htmlFor`/`id`.

**Files** (line numbers are from HEAD `b58250bbe`, before Task 8 runs. Task 8 shifts them, so every edit below is anchored on an exact unique string, not on a line number):
- Modify: `apps/web/src/pages/InterestConfigPage.tsx` (labels :481 :494 :517 :529 :545 :558 :573 :583; import block :1-13)
- Modify: `apps/web/src/pages/AuditLogsPage.tsx` (labels :302 :312 :330 :339; imports :1-20)
- Modify: `apps/web/src/pages/RepossessionsPage.tsx` (labels :843 :853 :913 :923 :1042-1045 :1060-1063 :1126 :1160 :1171 :1188; imports :1-29)
- Modify: `apps/web/src/pages/StockTransfersPage.tsx` (labels :911 :951; imports :1-16)
- Modify: `apps/web/src/pages/TodosPage/components/TodoForm.tsx` (labels :336 :352 :374 :402 :438 :450 :471; imports :1-44)
- Verify only (no edit): `apps/web/src/pages/PurchaseOrdersPage/components/wizard/PaymentSection.tsx` (:91 :112 :145 :186 already use `labelCls` = `formLabelClass` from `wizard/chrome.tsx:11`)
- Modify: `apps/web/src/pages/other-income/components/ItemsTable.tsx` (labels :93 :111 :119 :127 :135 :145-148 :181 :188; control margins :94 :115 :123 :131 :136 :157 :182 :192; imports :1-14)
- Modify: `apps/web/src/components/expense-form-v4/ItemLinesSection.tsx` (labels :69 :114 :121 :180 :205 :240; import :3)
- Modify: `apps/web/src/components/expense-form-v4/AdjustmentSection.tsx` (labels :119 :132 :140 :169 :193 :206 :216; delete-button cell :225; import :4)
- Modify: `apps/web/src/components/expense-form-v4/PayrollLinesSection.tsx` (labels :290 :351 :368 :383; imports :1-44)
- Modify: `apps/web/src/components/expense-templates/RecurringBillDialog.tsx` (`err`/`hint` helpers :270 :272; wrappers :286-358; labels :287 :292 :297 :306 :314 :319 :327 :332 :341 :346 :354 :359; imports :21-23)

**Interfaces:**
- Consumes `formLabelClass` from `apps/web/src/components/ui/form-styles.ts:13`.
- Consumes `cn` from `@/lib/utils` (tailwind-merge). `cn(formLabelClass, 'flex items-center gap-1.5')` drops `block` and keeps `flex`. Use it only where a label must stay flex because it holds an icon or a chip.
- Consumes Task 8's edits. Task 8 may:
  - add `import { formControlClass } from '@/components/ui/form-styles';` to these files;
  - turn the read-only boxes (InterestConfig VAT, ItemsTable/ItemLinesSection "ก่อนภาษี", Adjustment "ยอดสุทธิ…"/"ผลต่าง…") into `ReadOnlyField`, possibly with `htmlFor`;
  - rewrite control `className`s.

  So this task anchors on **label `className` strings + label text**, never on the opening `<label htmlFor=…`.
- Consumes Task 10: shadcn `FormLabel` is style A by default (nothing in these files uses it).
- Produces no new exports.

**Import rule (applies to every "add import" below):**
- If the file already has an import from `'@/components/ui/form-styles'` (Task 8 may have added one), add `formLabelClass` to that import's braces. Example: `import { formControlClass } from '@/components/ui/form-styles';` becomes `import { formControlClass, formLabelClass } from '@/components/ui/form-styles';`.
- Otherwise insert the exact line given in the step.

**Label inventory** (read-only enumeration at HEAD with `grep -nE '<(label|Label|FormLabel)\b|formLabelClass|form-styles'` per file, plus manual reads of `<span>` captions). "convert" = use `formLabelClass`.

| file:line | label text | current classes | action |
|---|---|---|---|
| InterestConfigPage.tsx:348 | `{item.label}` (defaults editor) | `min-w-0 flex-1 text-sm text-foreground` | **skip**: label sits inline left of control (`sm:flex-row`), no `htmlFor` |
| InterestConfigPage.tsx:481 | ชื่อ | `block text-sm font-medium text-foreground mb-1` | convert |
| InterestConfigPage.tsx:494 | ประเภทสินค้า (caption of category toggle-button group) | same | convert: caption fills a field slot in this form |
| InterestConfigPage.tsx:517 / 529 / 545 | ดอกเบี้ย (%) / ดาวน์ขั้นต่ำ (%) / ค่าคอมหน้าร้าน (%) | same | convert |
| InterestConfigPage.tsx:558 | VAT (%) (`<span>` at HEAD; Task 8 may make it `<label>` for `ReadOnlyField`) | same | convert (either element) |
| InterestConfigPage.tsx:573 / 583 | งวดต่ำสุด (เดือน) / งวดสูงสุด (เดือน) | same | convert |
| AuditLogsPage.tsx:302 / 312 / 330 / 339 | รายการ / จัดการ / จากวันที่ / ถึงวันที่ | `block text-xs font-medium text-muted-foreground mb-1` | convert: labels are stacked above controls in a grid (not inline-left) |
| RepossessionsPage.tsx:843 | บัญชีรับเงิน (FINANCE) * (over `CashAccountSelect`, no `htmlFor`) | `block text-sm font-medium text-foreground mb-1` | convert |
| RepossessionsPage.tsx:853 | จำนวนเงินที่รับโอน * | same | convert |
| RepossessionsPage.tsx:913 | บัญชีจ่ายเงิน * (over `CashAccountSelect`, no `htmlFor`) | same | convert |
| RepossessionsPage.tsx:923 | จำนวนเงินที่จ่ายคืน * | same | convert |
| RepossessionsPage.tsx:1042 / 1060 | ราคาเงินสด (บาท) * / ราคาผ่อน BESTCHOICE (บาท) * | same (multi-line JSX) | convert |
| RepossessionsPage.tsx:1126 / 1160 / 1171 / 1188 | สถานะ / ค่าซ่อม (บาท) / ราคาขายต่อ (บาท) / หมายเหตุ | same | convert |
| RepossessionsPage.tsx:758 | status filter | `aria-label` only | n/a (no visible label) |
| StockTransfersPage.tsx:911 / 951 | หมายเหตุรวม / หมายเหตุการจัดส่ง (ถ้ามี) | `block text-sm font-medium text-foreground mb-1` | convert |
| StockTransfersPage.tsx:379 / 539 / 656, 864-898 | filter selects; per-item IMEI/notes inputs | `aria-label` / placeholder only | n/a |
| TodoForm.tsx:336 / 352 | ชื่องาน * / รายละเอียด (icon + text) | `flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5` | convert with `cn(formLabelClass, 'flex items-center gap-1.5')` |
| TodoForm.tsx:374 / 402 | ความสำคัญ / สถานะ (captions of button groups) | same but `mb-2` | convert, same `cn` (caption fills a field slot in a 2-col grid) |
| TodoForm.tsx:438 / 450 / 471 | ครบกำหนด / ผู้รับมอบหมาย / แท็ก | same as 336 | convert, same `cn` |
| TodoForm.tsx:510 / 572 | รายการตรวจสอบ / ไฟล์แนบ | same without `mb-*`, inside `flex justify-between` header row with an action button | **skip**: section heading (no single control below) |
| TodoForm.tsx:584 | upload drop zone | dashed box wrapping a hidden file input | **skip**: the label *is* the control |
| TodoForm.tsx:679 | ความคิดเห็น (`htmlFor` → comment input after the comment list) | `… mb-2` | **skip**: section heading; the control is not directly below |
| PaymentSection.tsx:91 / 112 / 145 / 186 | สถานะการจ่าย / วิธีจ่ายเงิน / จำนวนที่จ่าย (บาท) / บันทึกการจ่าย | `labelCls` (= `formLabelClass`) | **already style A**: verify only |
| PaymentSection.tsx:206 | แนบสลิป/หลักฐาน (`<p>`) | `cn(labelCls, 'mt-3')` | already style A |
| PaymentSection.tsx:209 | เลือกรูป | file-picker button styled as `<label>` | **skip**: button control |
| ItemsTable.tsx:93 | บัญชีรายได้ (over `AccountSearchDropdown`, no `htmlFor`) | `text-xs text-muted-foreground font-medium` + wrapper `mt-1` | convert; remove wrapper `mt-1` |
| ItemsTable.tsx:111 / 119 / 127 / 135 | จำนวน / ราคา/หน่วย / ส่วนลด / VAT% | `text-muted-foreground font-medium` (inherits `text-xs`); controls `mt-1` | convert; remove control `mt-1`. Card layout, not a dense table |
| ItemsTable.tsx:145 | WHT% (+ suggestion chip) | `text-muted-foreground font-medium inline-flex items-center gap-1` | convert with `cn(formLabelClass, 'flex items-center gap-1')`; remove control `mt-1` |
| ItemsTable.tsx:181 | ก่อนภาษี (Task 8 → `ReadOnlyField`) | `text-muted-foreground font-medium` | convert; remove `mt-1` if still on the field |
| ItemsTable.tsx:188 | คำอธิบาย | `text-xs text-muted-foreground font-medium` | convert; remove input `mt-1` |
| ItemLinesSection.tsx:69 / 121 / 180 / 205 / 240 | บัญชีค่าใช้จ่าย / คำอธิบาย / `Field` label (จำนวน, ราคา/หน่วย, ส่วนลด) / `SelectField` (VAT%) / `SelectFieldLabeled` (WHT%) | `mb-1 block text-xs font-medium` | convert |
| ItemLinesSection.tsx:114 | ก่อนภาษี (Task 8 → `ReadOnlyField`) | `mb-1 block text-xs font-medium` (Task 8 dropped `text-muted-foreground`) | convert |
| ItemLinesSection.tsx:138 | ค่าใช้จ่ายต้องห้าม (checkbox) | `flex items-start gap-2 text-xs …` | **skip**: checkbox inline label |
| AdjustmentSection.tsx:119 / 132 / 140 | ยอดที่จ่ายจริง / ยอดสุทธิหลังหักภาษี ณ ที่จ่าย / ผลต่างที่ต้องปรับ | `block text-xs font-medium text-muted-foreground mb-1` | convert |
| AdjustmentSection.tsx:169 / 193 / 206 / 216 | บัญชี #n / Dr/Cr / จำนวน / หมายเหตุ | `block text-xs text-muted-foreground mb-1` | convert (bordered card rows that stack on mobile, not a table); the delete-button cell `md:pt-5` becomes `md:self-stretch` so it stays bottom-aligned |
| PayrollLinesSection.tsx:290 | กลุ่มพนักงาน (caption of SHOP/FINANCE toggle group) | `block text-xs font-medium mb-1` | convert |
| PayrollLinesSection.tsx:351 / 368 | ปี (พ.ศ.) / เดือน | same | convert |
| PayrollLinesSection.tsx:383 | วันที่จ่ายเงิน (`<span>` caption over info box, same grid row as ปี/เดือน) | same | convert: otherwise the row misaligns by about 11 px |
| PayrollLinesSection.tsx:396-408, 712-717, 848-851 | `<th>` headers | — | **skip**: table column headers |
| PayrollLinesSection.tsx employee rows (`aria-label` เงินเดือนพื้นฐาน / ประกันสังคมพนักงาน / ภาษีหัก ณ ที่จ่าย) and ScreenTable sub-tables (`aria-label` บัญชี / คำอธิบาย / จำนวนเงิน) | — | `aria-label` only | **skip, intentional**: dense ScreenTable cells (`text-xs`, `py-1`). A visible 14 px label with a 12 px gap would break the table rows, and the `<th>` already names each column |
| PayrollLinesSection.tsx:762 / 779 | เสีย / รายการปรับปรุงงวดก่อน (checkbox) | inline-flex | **skip**: checkbox inline labels inside table cells |
| RecurringBillDialog.tsx:292 / 306 / 314 / 319 / 327 / 354 / 359 | ผู้รับเงิน / เจ้าหนี้; บัญชีค่าใช้จ่าย; ยอดประมาณ (บาท); วิธีจ่าย; บัญชีที่จ่าย; เตือนล่วงหน้า (วัน); เริ่มนับงวดแรกตั้งแต่ | shadcn `<Label>` default (`text-sm font-medium leading-snug text-foreground`); wrapper `space-y-1` | convert (`className={formLabelClass}`); drop `space-y-1` |
| RecurringBillDialog.tsx:287 / 297 / 332 / 341 / 346 | ชื่อบิล* / สาขา* / ความถี่* / วันครบกำหนด* / เดือน(*) | `<Label>` inside `<div className="flex items-center">` + `req` star | `mb-3` on the flex wrapper (Label default classes = `formLabelClass` minus `mb-3 block`); drop `space-y-1`. The star stays outside `<Label>` so `getByLabelText('ชื่อบิล')` still matches exactly |
| RecurringBillDialog.tsx:370 | เปิดใช้บิลประจำ (checkbox) | `<Label>` | **skip**: checkbox inline label |

Totals: 68 label sites converted in 10 files. PaymentSection already uses style A. 10 `<label>`/`<Label>` elements are skipped by rule:
- InterestConfig :348
- TodoForm :510, :572, :584, :679
- ItemLinesSection :138
- Payroll :762, :779
- RecurringBillDialog :370
- PaymentSection :209

The skip rule also covers the `<th>` headers and the `aria-label`-only table cells, which have no label element.

- [ ] **Step 1: Re-run the read-only inventory after Tasks 8 and 10 and check the anchor counts**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE/apps/web/src"
c() { printf '%-55s %s\n' "$1" "$(grep -cF -- "$2" "$1")"; }
c pages/InterestConfigPage.tsx 'className="block text-sm font-medium text-foreground mb-1"'            # expect 8
c pages/AuditLogsPage.tsx 'className="block text-xs font-medium text-muted-foreground mb-1"'          # expect 4
c pages/RepossessionsPage.tsx 'className="block text-sm font-medium text-foreground mb-1"'            # expect 10
c pages/StockTransfersPage.tsx 'className="block text-sm font-medium text-foreground mb-1"'           # expect 2
c pages/TodosPage/components/TodoForm.tsx 'text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5"'  # expect 5
c pages/other-income/components/ItemsTable.tsx 'className="text-muted-foreground font-medium">'       # expect 5
c pages/other-income/components/ItemsTable.tsx 'className="text-xs text-muted-foreground font-medium">'  # expect 2
c components/expense-form-v4/ItemLinesSection.tsx 'className="mb-1 block text-xs font-medium">'       # expect 6 (Task 8 rewrote the ก่อนภาษี label without text-muted-foreground, so it now matches too)
c components/expense-form-v4/AdjustmentSection.tsx 'className="block text-xs font-medium text-muted-foreground mb-1"'  # expect 3
c components/expense-form-v4/AdjustmentSection.tsx 'className="block text-xs text-muted-foreground mb-1"'  # expect 4
c components/expense-form-v4/PayrollLinesSection.tsx 'className="block text-xs font-medium mb-1"'      # expect 4
c components/expense-templates/RecurringBillDialog.tsx '<div className="flex items-center"><Label'    # expect 5
grep -rn "FormLabel" pages/InterestConfigPage.tsx pages/AuditLogsPage.tsx pages/RepossessionsPage.tsx pages/StockTransfersPage.tsx pages/TodosPage/components/TodoForm.tsx pages/other-income/components/ItemsTable.tsx components/expense-form-v4/ItemLinesSection.tsx components/expense-form-v4/AdjustmentSection.tsx components/expense-form-v4/PayrollLinesSection.tsx components/expense-templates/RecurringBillDialog.tsx   # expect no output
```

Expected: the counts in the comments, and no `FormLabel` hits.

The only allowed deviations are the read-only boxes Task 8 rebuilt:
- InterestConfig 7 (VAT caption restyled by Task 8);
- ItemsTable 4 (ก่อนภาษี restyled by Task 8);
- Adjustment first count 1 (ยอดสุทธิ…/ผลต่าง… restyled by Task 8).

In those cases, open the label Task 8 wrote for that `ReadOnlyField` and set its `className` to `{formLabelClass}`, keeping its `htmlFor`. Any other deviation means Task 8 touched labels: stop and report BLOCKED with the diff. Do not improvise.

- [ ] **Step 2: InterestConfigPage — convert 8 labels**

Edit (replace_all, 8 occurrences: 7 `<label>` + the VAT caption, whether Task 8 left it a `<span>` or made it a `<label>`):
```tsx
// old
className="block text-sm font-medium text-foreground mb-1"
// new
className={formLabelClass}
```
Import (per the import rule). If there is no form-styles import, insert after `import { NumberInput } from '@/components/ui/NumberInput';`:
```tsx
import { formLabelClass } from '@/components/ui/form-styles';
```
Control margins: none at HEAD. Controls under these labels carry no `mt-*`, and the error `<p … mt-1>` lines sit *below* controls, so keep them. Line :348 (defaults editor, inline-left) is untouched.

Run:
```bash
npm run test --workspace=apps/web -- src/pages/InterestConfigPage.vat.test.tsx src/pages/__tests__/touchTargets.test.ts
```
Expected: PASS. The test asserts `expect(screen.getByLabelText('VAT (%)')).toBe(vat)` (`InterestConfigPage.vat.test.tsx:74`). It depends on the `htmlFor`/`id` pairing and the element type, and this step changes neither (only `className`).

- [ ] **Step 3: AuditLogsPage — convert 4 filter labels**

Edit (replace_all, 4):
```tsx
// old
className="block text-xs font-medium text-muted-foreground mb-1"
// new
className={formLabelClass}
```
Import. If there is no form-styles import, insert after `import { NativeSelect } from '@/components/ui/native-select';`:
```tsx
import { formLabelClass } from '@/components/ui/form-styles';
```
Control margins: none.

Run:
```bash
npm run test --workspace=apps/web -- src/pages/AuditLogsPage.filters.test.tsx
```
(added by Task 8). Expected: PASS; it queries by label text.

- [ ] **Step 4: RepossessionsPage — convert 10 labels**

Edit (replace_all, 10, including the two multi-line `<label htmlFor="ready-for-sale-…"` blocks whose `className=` line is identical):
```tsx
// old
className="block text-sm font-medium text-foreground mb-1"
// new
className={formLabelClass}
```
Import. If there is no form-styles import, insert after `import { NativeSelect } from '@/components/ui/native-select';`:
```tsx
import { formLabelClass } from '@/components/ui/form-styles';
```
Control margins: none. `CashAccountSelect`/`NumberInput`/`NativeSelect`/`textarea` have no `mt-*`. The `<p className="col-span-2 … mt-1">` at :1182 is a note below the controls; keep it.

Run:
```bash
npm run test --workspace=apps/web -- src/pages/RepossessionsPage.awaiting-repossession.test.tsx src/pages/RepossessionsPage.journal-button.test.tsx src/pages/RepossessionsPage.settlement-button.test.tsx
```
Expected: PASS.

- [ ] **Step 5: StockTransfersPage — convert 2 labels**

Edit (replace_all, 2):
```tsx
// old
className="block text-sm font-medium text-foreground mb-1"
// new
className={formLabelClass}
```
Import. If there is no form-styles import, insert after `import { NativeSelect } from '@/components/ui/native-select';`:
```tsx
import { formLabelClass } from '@/components/ui/form-styles';
```

Run:
```bash
npm run test --workspace=apps/web -- src/pages/StockTransfersPage.filter-width.test.tsx
```
(added by Task 8). Expected: PASS.

- [ ] **Step 6: TodoForm — convert 7 labels (icons kept)**

Edit A (replace_all, 5: ชื่องาน, รายละเอียด, ครบกำหนด, ผู้รับมอบหมาย, แท็ก):
```tsx
// old
className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5"
// new
className={cn(formLabelClass, 'flex items-center gap-1.5')}
```
Edit B (single):
```tsx
// old
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  <Flag className="size-3.5" />
// new
                <label className={cn(formLabelClass, 'flex items-center gap-1.5')}>
                  <Flag className="size-3.5" />
```
Edit C (single):
```tsx
// old
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  <CheckCircle2 className="size-3.5" />
// new
                <label className={cn(formLabelClass, 'flex items-center gap-1.5')}>
                  <CheckCircle2 className="size-3.5" />
```
Leave :510 รายการตรวจสอบ, :572 ไฟล์แนบ and :679 ความคิดเห็น (`… mb-2">` + `<MessageSquare`) unchanged. They are section headings.

Imports. TodoForm does not import `cn` at HEAD. Insert after `import { NativeSelect } from '@/components/ui/native-select';`, applying the import rule for form-styles:
```tsx
import { formLabelClass } from '@/components/ui/form-styles';
import { cn } from '@/lib/utils';
```
Control margins: none. The tags frame (Task 8 `data-field-frame`) has no `mt-*`.

Run:
```bash
npm run test --workspace=apps/web -- src/pages/TodosPage
```
This runs `components/TodoForm.tags-frame.test.tsx` (Task 8), the only test that renders the real `TodoForm`. `home-link.test.tsx` and `UnifiedInboxPage/components/RoomDossier.test.tsx` both `vi.mock` TodoForm, so they do not cover this edit. Expected: PASS. `getByLabelText('แท็ก')` still matches because whitespace is normalised and the icon `<svg>` has no text.

- [ ] **Step 7: PaymentSection — verify only, no edit**

```bash
grep -n "labelCls" "d:/BESTCHOICE APP/BESTCHOICE/apps/web/src/pages/PurchaseOrdersPage/components/wizard/chrome.tsx"
```
Expected: `export const labelCls = formLabelClass;`. The four field labels and the attachment caption already use `labelCls`. The "เลือกรูป" `<label>` is a file-picker button (skip).

Run:
```bash
npm run test --workspace=apps/web -- src/pages/PurchaseOrdersPage/components/wizard
```
This covers `PaymentSection.test.tsx` (Task 8) and `StepSummary`/`StepItems`/`StepSupplier`. Expected: PASS.

- [ ] **Step 8: other-income ItemsTable — convert 8 labels and drop control `mt-1`**

Edit A (replace_all, 5: จำนวน, ราคา/หน่วย, ส่วนลด, VAT%, ก่อนภาษี):
```tsx
// old
className="text-muted-foreground font-medium">
// new
className={formLabelClass}>
```
Edit B (replace_all, 2: บัญชีรายได้, คำอธิบาย):
```tsx
// old
className="text-xs text-muted-foreground font-medium">
// new
className={formLabelClass}>
```
Edit C (WHT% label, single):
```tsx
// old
                    className="text-muted-foreground font-medium inline-flex items-center gap-1"
// new
                    className={cn(formLabelClass, 'flex items-center gap-1')}
```
Edit D (account wrapper, single):
```tsx
// old
                <div className="mt-1">
                  <AccountSearchDropdown
// new
                <div>
                  <AccountSearchDropdown
```
Edit E: control margins. Task 8 (S2-07) already rewrote the number controls, so three of the old anchors are gone. The current `mt-1` sites (`grep -n "mt-1"` on `ItemsTable.tsx` at HEAD) are:
```tsx
// single: numberControlClass (:38, shared by จำนวน / ราคา/หน่วย / ส่วนลด)
// old
const numberControlClass = cn(formControlClass, 'mt-1 text-right font-mono tabular-nums');
// new
const numberControlClass = cn(formControlClass, 'text-right font-mono tabular-nums');

// replace_all, 2 (VAT% :142 / WHT% :163)
// old
wrapperClassName="max-w-full mt-1 w-full"
// new
wrapperClassName="max-w-full w-full"

// single: the "ก่อนภาษี" ReadOnlyField (:192)
// old
className="mt-1 font-mono font-semibold"
// new
className="font-mono font-semibold"

// single: the คำอธิบาย input (:201)
// old
className={cn(formControlClass, 'mt-1')}
// new
className={formControlClass}
```
If `cn` is then unused in the file, keep the import (`numberControlClass` still calls it).

End state of that grep: exactly one hit, the WHT suggestion `<p className="mt-1 text-[10px] text-muted-foreground inline-flex items-center gap-1">`.

Imports. ItemsTable already imports `cn` (`ItemsTable.tsx:5`) and `formControlClass` (`:4`, `import { formControlClass } from '@/components/ui/form-styles';`). Only add `formLabelClass` to that existing import:
```tsx
// old
import { formControlClass } from '@/components/ui/form-styles';
// new
import { formControlClass, formLabelClass } from '@/components/ui/form-styles';
```

Run:
```bash
npm run test --workspace=apps/web -- src/pages/other-income
```
This covers `components/__tests__/ItemsTable.fields.test.tsx` (Task 8) and the existing other-income tests. Expected: PASS.

- [ ] **Step 9: ItemLinesSection — convert 6 label sites**

Edit A (replace_all, 6: :69, :114 ก่อนภาษี, :121, `Field`, `SelectField`, `SelectFieldLabeled`). At HEAD the ก่อนภาษี label (Task 8) is `className="mb-1 block text-xs font-medium"` too, so the one anchor covers all six:
```tsx
// old
className="mb-1 block text-xs font-medium">
// new
className={formLabelClass}>
```
Import:
```tsx
// old
import { formControlClass } from '@/components/ui/form-styles';
// new
import { formControlClass, formLabelClass } from '@/components/ui/form-styles';
```
If Task 8 already extended that line, just add `formLabelClass` to the braces. Control margins: none (controls use `formControlClass`). The checkbox label :138 is untouched.

Run:
```bash
npm run test --workspace=apps/web -- src/components/expense-form-v4 src/pages/ExpenseDocumentNewPage.test.tsx src/pages/ExpensesPage.ux.test.tsx
```
This covers `__tests__/ItemLinesSection.readonly.test.tsx` (Task 8). Expected: PASS.

- [ ] **Step 10: AdjustmentSection — convert 7 labels and realign the delete button**

Edit A (replace_all, 3: ยอดที่จ่ายจริง, ยอดสุทธิหลังหักภาษี ณ ที่จ่าย, ผลต่างที่ต้องปรับ):
```tsx
// old
className="block text-xs font-medium text-muted-foreground mb-1"
// new
className={formLabelClass}
```
Edit B (replace_all, 4: บัญชี #n, Dr/Cr, จำนวน, หมายเหตุ):
```tsx
// old
className="block text-xs text-muted-foreground mb-1"
// new
className={formLabelClass}
```
Edit C (delete-button cell; `md:pt-5` was sized for the old 12 px label + `mb-1`):
```tsx
// old
                <div className="col-span-12 flex items-end justify-end md:col-span-1 md:pt-5">
// new
                <div className="col-span-12 flex items-end justify-end md:col-span-1 md:self-stretch">
```
Import:
```tsx
// old
import { formControlClass } from '@/components/ui/form-styles';
// new
import { formControlClass, formLabelClass } from '@/components/ui/form-styles';
```
Control margins: none. The `<p className="mt-1 …">เว้นว่างเพื่อใช้ยอด…` is a hint below the control; keep it.

Run:
```bash
npm run test --workspace=apps/web -- src/components/expense-form-v4 src/pages/__tests__/tabsButtonRowsNowrap.test.ts
```
This covers `__tests__/AdjustmentSection.readonly.test.tsx` (Task 8); `tabsButtonRowsNowrap` scans this file. Expected: PASS.

- [ ] **Step 11: PayrollLinesSection — convert 4 captions; leave every table cell alone**

Edit (replace_all, 4: กลุ่มพนักงาน, ปี (พ.ศ.), เดือน, and the วันที่จ่ายเงิน `<span>`):
```tsx
// old
className="block text-xs font-medium mb-1"
// new
className={formLabelClass}
```
Import. If there is no form-styles import, insert after `import { NativeSelect } from '@/components/ui/native-select';`:
```tsx
import { formLabelClass } from '@/components/ui/form-styles';
```
Intentionally skipped:
- every `<th>`;
- the employee-row and ScreenTable sub-table cells (`aria-label` บัญชี / คำอธิบาย / จำนวนเงิน / เงินเดือนพื้นฐาน / ประกันสังคมพนักงาน / ภาษีหัก ณ ที่จ่าย). These are dense `text-xs py-1` table rows; adding a 14 px label with a 12 px gap would break them, and the `<th>` already names the column;
- the checkbox labels "เสีย" and "รายการปรับปรุงงวดก่อน".

Run:
```bash
npm run test --workspace=apps/web -- src/components/expense-form-v4/__tests__/PayrollLinesSection.test.tsx src/components/expense-form-v4/__tests__/ExpenseFormV4.payroll.test.tsx
```
Expected: PASS. `getByLabelText('ปี (พ.ศ.)')` (test :355) and `getByLabelText('เดือน')` (test :343) are unchanged.

- [ ] **Step 12: RecurringBillDialog — style A on 12 fields; remove `space-y-1`**

Edit A (helpers get their own 4 px now that `space-y-1` goes):
```tsx
// old
      <p id={`${FIELD_IDS[key]}-error`} className="text-xs text-destructive" role="alert">{errors[key]}</p>
// new
      <p id={`${FIELD_IDS[key]}-error`} className="mt-1 text-xs text-destructive" role="alert">{errors[key]}</p>
```
```tsx
// old
  const hint = (text: string) => <p className="text-xs text-muted-foreground">{text}</p>;
// new
  const hint = (text: string) => <p className="mt-1 text-xs text-muted-foreground">{text}</p>;
```
Edit B (replace_all, 2):
```tsx
// old
<div className="space-y-1 md:col-span-2">
// new
<div className="md:col-span-2">
```
Edit C (replace_all; 10 at HEAD; every `space-y-1` wrapper in this file is a field wrapper):
```tsx
// old
<div className="space-y-1">
// new
<div>
```
Edit D (replace_all, 5: the label + star rows ชื่อบิล, สาขา, ความถี่, วันครบกำหนด, เดือน):
```tsx
// old
<div className="flex items-center"><Label
// new
<div className="mb-3 flex items-center"><Label
```
Edit E: 7 single edits, one per label without a star.
```tsx
<Label htmlFor="rb-vendor">    →  <Label htmlFor="rb-vendor" className={formLabelClass}>
<Label htmlFor="rb-category">  →  <Label htmlFor="rb-category" className={formLabelClass}>
<Label htmlFor="rb-amount">    →  <Label htmlFor="rb-amount" className={formLabelClass}>
<Label htmlFor="rb-payment">   →  <Label htmlFor="rb-payment" className={formLabelClass}>
<Label htmlFor="rb-deposit">   →  <Label htmlFor="rb-deposit" className={formLabelClass}>
<Label htmlFor="rb-lead">      →  <Label htmlFor="rb-lead" className={formLabelClass}>
<Label htmlFor="rb-starts">    →  <Label htmlFor="rb-starts" className={formLabelClass}>
```
`<Label htmlFor="rb-enabled">` (checkbox) is untouched. Its hint now has `mt-1`, which is intended.

Import. Insert after `import { Label } from '@/components/ui/label';`:
```tsx
import { formLabelClass } from '@/components/ui/form-styles';
```
Check that no wrapper gap remains:
```bash
grep -n "space-y-1" "d:/BESTCHOICE APP/BESTCHOICE/apps/web/src/components/expense-templates/RecurringBillDialog.tsx"
```
Expected: no output.

Run:
```bash
npm run test --workspace=apps/web -- src/components/expense-templates/RecurringBillDialog.test.tsx
```
Expected: PASS (9 tests at HEAD, plus Task 8 additions). `field('ชื่อบิล')` etc. still match exactly because the star stays outside `<Label>`. `ExpenseFavoritesPage.test.tsx` and `RecurringBillsPage.test.tsx` `vi.mock` this dialog, so they do not cover this edit.

- [ ] **Step 13: Whole-scope check (tests, types, lint)**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
npm run test --workspace=apps/web -- src/pages/InterestConfigPage.vat.test.tsx src/pages/AuditLogsPage.filters.test.tsx src/pages/RepossessionsPage src/pages/StockTransfersPage.filter-width.test.tsx src/pages/TodosPage src/pages/PurchaseOrdersPage/components/wizard src/pages/other-income src/components/expense-form-v4 src/components/expense-templates src/pages/ExpenseDocumentNewPage.test.tsx src/pages/ExpensesPage.ux.test.tsx src/pages/__tests__
bash tools/check-types.sh web
cd "d:/BESTCHOICE APP/BESTCHOICE/apps/web" && npx eslint src/pages/InterestConfigPage.tsx src/pages/AuditLogsPage.tsx src/pages/RepossessionsPage.tsx src/pages/StockTransfersPage.tsx src/pages/TodosPage/components/TodoForm.tsx src/pages/other-income/components/ItemsTable.tsx src/components/expense-form-v4/ItemLinesSection.tsx src/components/expense-form-v4/AdjustmentSection.tsx src/components/expense-form-v4/PayrollLinesSection.tsx src/components/expense-templates/RecurringBillDialog.tsx
```
Expected:
- tests: all PASS;
- type check: `Web: OK`;
- eslint: exit 0 with **0 errors**. Only the 9 warnings already present at HEAD remain:
  - PayrollLinesSection `ThaiDateInput` and `taxExemptWarningEnabled`;
  - AuditLogsPage `CardHeader`/`CardTitle`/`CardToolbar`/`CardContent`;
  - InterestConfigPage `defaultsChanged`;
  - StockTransfersPage `rejectMutation`;
  - TodoForm unused eslint-disable.

  Any new warning, such as an unused `cn` or `formLabelClass`, must be fixed.

Then check that no old label strings remain:
```bash
cd "d:/BESTCHOICE APP/BESTCHOICE/apps/web/src" && grep -nE 'text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1\.5|block text-sm font-medium text-foreground mb-1|block text-xs (font-medium )?text-muted-foreground mb-1|mb-1 block text-xs font-medium|block text-xs font-medium mb-1' pages/InterestConfigPage.tsx pages/AuditLogsPage.tsx pages/RepossessionsPage.tsx pages/StockTransfersPage.tsx pages/TodosPage/components/TodoForm.tsx components/expense-form-v4/ItemLinesSection.tsx components/expense-form-v4/AdjustmentSection.tsx components/expense-form-v4/PayrollLinesSection.tsx
```
Expected: no output.

- [ ] **Step 14: Field-scale compare against the baseline**

The route ids (`tools/field-scale/routes.mjs`, Task 2) for the forms this task edits: `/settings/finance/interest` = `interest-config-form` (opens the create/edit modal) · `/audit-logs` = `audit-logs` · `/repossessions` = `repossessions` · `/stock/transfers` = `stock-transfers-outgoing`, `stock-transfers-incoming`, `stock-transfers-history` · `/todos` = `todo-form` (opens the new-task dialog) · `/purchase-orders` = `purchase-order-wizard` (receive-mode summary with PaymentSection) · `/other-income/new` = `other-income-items` · `/expenses/new` = `expense-new`, `payroll-new` (first payroll line expanded) · `/expenses/favorites` = `recurring-bill-dialog` (opens RecurringBillDialog). There is no route for `/expenses/recurring-bills`; RecurringBillDialog is measured through `recurring-bill-dialog`. Refresh the preview (this task's edits made it stale), then:
```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
npm run local:preview
node tools/field-scale/check.mjs --label r1-3-labels --routes interest-config-form,audit-logs,repossessions,stock-transfers-outgoing,stock-transfers-incoming,stock-transfers-history,todo-form,purchase-order-wizard,other-income-items,expense-new,payroll-new,recurring-bill-dialog
node tools/field-scale/check.mjs --compare baseline r1-3-labels
```
Expected:
- the compare exits 0, or every new P1/P2 compared with baseline on these routes is accepted under the compare triage rule (cross-task notes);
- F1 `labelFontSize` / `labelGap` findings on these routes are gone. Remaining label findings may only come from the intentionally skipped labels in the table (checkbox labels, `<th>`, payroll table cells, Todo section headings) or from routes whose steps do not open the dialog.

List any dialog the route steps do not open (e.g. Repossessions settlement/refund/ready-for-sale/update modals, StockTransfers receive/ship modals, the AuditLogs detail dialog) in the PR as "not measured" — the Todo dialog (`todo-form`), RecurringBillDialog (`recurring-bill-dialog`), the InterestConfig modal and the PO PaymentSection are opened by their routes. Label-only changes must not create F2–F4 findings. If one appears, investigate before committing.

- [ ] **Step 15: Commit**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
git add apps/web/src/pages/InterestConfigPage.tsx apps/web/src/pages/AuditLogsPage.tsx apps/web/src/pages/RepossessionsPage.tsx apps/web/src/pages/StockTransfersPage.tsx apps/web/src/pages/TodosPage/components/TodoForm.tsx apps/web/src/pages/other-income/components/ItemsTable.tsx apps/web/src/components/expense-form-v4/ItemLinesSection.tsx apps/web/src/components/expense-form-v4/AdjustmentSection.tsx apps/web/src/components/expense-form-v4/PayrollLinesSection.tsx apps/web/src/components/expense-templates/RecurringBillDialog.tsx
git commit -F - <<'EOF'
style(web): ป้ายชื่อแบบ A ในฟอร์มที่ R1-3 แตะ (§4.3 ค)

ป้ายชื่อช่องใช้ formLabelClass (14px · font-medium · foreground · mb-3) ใน
ตั้งค่าดอกเบี้ย · ประวัติการใช้งาน · รับเครื่องคืน · โอนสินค้า · ฟอร์มงาน ·
รายได้อื่น · บรรทัดรายจ่าย · บัญชีปรับผลต่าง · ใบเงินเดือน · ตั้งบิลประจำ
ตัดระยะชดเชยเดิม (mt-1 ที่ช่อง, space-y-1 ที่กล่อง) ให้ mb-3 เป็นระยะเดียว
ไม่แตะ: ป้าย checkbox, หัวคอลัมน์, เซลล์ตารางใบเงินเดือน, หัวข้อส่วนในฟอร์มงาน
PaymentSection ใช้แบบ A อยู่แล้ว (labelCls)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
Expected: one commit with 10 files changed.

---

### Task 12: F5 — non-portalled menu guard + per-component clip checks (R1-1/R1-2, spec §5)

Spec §5 row F5 and §2 bullet "เมนูถูกตัด". This task adds two things:

1. A static guard: a self-contained `describe` block appended to `apps/web/src/components/ui/field-guards.inventory.test.ts`. It fails when any `.tsx` file renders an inline `absolute` menu panel that is not portalled and the file is not on the allow-list.
2. One browser case per allow-listed component, in the standalone script `tools/field-scale/menu-clip-components.mjs`. Each case opens the menu on `npm run local:preview` and checks that the list box sits inside the viewport and inside every ancestor that clips overflow.

**Files:**
- Modify (append only): `apps/web/src/components/ui/field-guards.inventory.test.ts` (created by Task 7, extended by Tasks 9–10)
- Create: `tools/field-scale/menu-clip-components.mjs`

**Interfaces:**
- `findInlineMenuPanels(fileName: string, source: string): number[]` is module-local to the test file. It returns the 1-based line of every inline menu panel in the file.
- `F5_NON_PORTAL_MENU_ALLOW: Record<repoRelativePath, { panels: number; reason: string }>` must match the scan exactly, in both directions.
- In the block, everything is prefixed `f5*`/`F5_*`. `node:fs`, `node:path` and `typescript` are imported as `f5Fs`/`f5Path`/`f5Ts`, which cannot collide with Task 7's imports. `describe`/`it`/`expect` are vitest globals (`vitest.config.ts` has `globals: true`, tsconfig has `types: ["vitest/globals"]`). The block uses none of Task 7's helper names.
- Script contract:
  - Exit code 0 = no unexpected clipping. Exit code 1 = a failure or an error.
  - Setting `MENU_CLIP_STRICT=1` turns KNOWN entries into failures.
  - Output goes to `.tmp/field-scale/menu-clip-components/{results.json,<Component>-<width>.png}`.
  - It needs the current-checkout preview: `previewStatus().current`, the same check as `tools/check-admin-typography.mjs`.

**Current offenders (found by running the detector below on HEAD, 2026-11-14): 16 panels in 14 files**

| File:line (under `apps/web/src/`) | Panels | What it is | After this plan |
|---|---|---|---|
| `components/ui/SearchableSelect.tsx:150,181` | 2 | address listbox + "no results" box | allow-listed: R2-2 replaces it |
| `components/ui/NameAutocomplete.tsx:89` | 1 | name suggestions | allow-listed (spec) |
| `pages/other-income/components/TemplatePickerCombobox.tsx:48` | 1 | "ใช้แม่แบบ" command menu | allow-listed (spec) |
| `pages/PurchaseOrdersPage/components/wizard/items/CatalogPicker.tsx:166` | 1 | model search results | allow-listed (spec) |
| `pages/UnifiedInboxPage/components/NoteMentionInput.tsx:250` | 1 | @mention list | allow-listed (spec) |
| `pages/other-income/components/AccountSearchDropdown.tsx:85` | 1 | account menu | **not on the list.** Task 6 replaces it with `PopoverContent`, and the detector then finds 0 panels in the file (fixture "after Task 6" below) |
| `components/bundle/BundleSearch.tsx:155` | 1 | free-gift search | allow-listed: extra, not in spec |
| `components/template-editor/editor/VariableAutocomplete.tsx:99` | 1 | caret variable list | allow-listed: extra |
| `pages/CollectionsPage/components/InstallmentPickerPopover.tsx:54` | 1 | installment picker (`if (!open) return null`) | allow-listed: extra |
| `pages/ExpensesPage.tsx:668` | 1 | "สร้างเอกสารใหม่" menu | allow-listed: extra |
| `pages/POSPage/components/CustomerSearch.tsx:154` | 1 | POS customer search | allow-listed: extra |
| `pages/settings/SettingsLayout.tsx:91` | 1 | settings search results | allow-listed: extra |
| `pages/UnifiedInboxPage/components/Customer360Panel.tsx:1062` | 1 | @mention in customer note | allow-listed: extra |
| `pages/UnifiedInboxPage/components/SessionActions.tsx:139,203` | 2 | "โอนให้พนักงาน" / "สร้างสัญญา" `role=menu` | allow-listed: extra |

Detector checks that were run (read-only):
- Ordinary absolute icons, badges, tooltips, clear buttons, `inset-*` overlays and positioned wrappers of Radix `DropdownMenu` are not flagged. The closest miss in the whole tree, `BookingDetailSheet.tsx:274` (`absolute right-14 top-2` wrapping a Radix `DropdownMenu`), is correctly ignored.
- With the allow-list below plus `AccountSearchDropdown.tsx: 1`, the block type-checked against the full web program with 0 diagnostics, and all its tests passed on HEAD. On HEAD the whole-tree scan took 293 ms.

- [ ] **Step 1: Confirm the prerequisites (Task 6 and Task 7 have landed)**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
test -f apps/web/src/components/ui/field-guards.inventory.test.ts && echo "Task 7 file present"
grep -n "absolute z-30 w-full mt-1" apps/web/src/pages/other-income/components/AccountSearchDropdown.tsx || echo "Task 6 done: no inline account panel"
grep -n "PopoverContent" apps/web/src/pages/other-income/components/AccountSearchDropdown.tsx
```

Expected output:
- `Task 7 file present`
- `Task 6 done: no inline account panel`
- at least one `PopoverContent` line

If the grep still prints the `absolute z-30` line, stop and finish Task 6 first.

- [ ] **Step 2: Append the F5 block with an EMPTY allow-list (red first)**

Append this text to the end of `apps/web/src/components/ui/field-guards.inventory.test.ts`. Do not touch anything above it.

```ts

// ─── F5 (spec 2026-11-14 §5, Task 12): no non-portalled menu outside the allow-list ───
// Self-contained on purpose: this block re-declares everything it needs under f5*/F5_*
// names, so it does not depend on (or collide with) the helpers above it in this file.
// `describe`/`it`/`expect` are vitest globals (vitest.config.ts `globals: true`).
import * as f5Fs from 'node:fs';
import * as f5Path from 'node:path';
import f5Ts from 'typescript';

const F5_ROOT = f5Path.resolve(__dirname, '../../../../..');
const F5_SCAN_TIMEOUT_MS = 30_000;
const F5_SKIP_DIRS = new Set(['__tests__', 'test', 'tests', 'node_modules', 'dist']);
const F5_TEST_FILE = /[.-](test|spec|docs-spec)\.[jt]sx?$/;
const F5_MENU_ROLES = new Set(['listbox', 'menu']);
const F5_ITEM_ROLES = new Set(['option', 'menuitem', 'listbox', 'menu']);
const F5_INTERACTIVE_TAGS = new Set(['button', 'a', 'input', 'Button', 'CommandItem']);
const F5_PORTAL_TAG = /Portal$|^PopoverContent$|^DropdownMenuContent$/;

/**
 * Files allowed to keep an inline (non-portalled) `absolute` menu, with how many such
 * panels each renders. Exact match both ways: a new menu fails, and so does an entry
 * whose menu was removed or portalled (delete the entry in the same PR).
 * Browser clip checks for the spec's allow-list: tools/field-scale/menu-clip-components.mjs
 */
const F5_NON_PORTAL_MENU_ALLOW: Record<string, { panels: number; reason: string }> = {};

function f5ListTsx(dir: string, out: string[] = []): string[] {
  for (const entry of f5Fs.readdirSync(dir, { withFileTypes: true })) {
    const file = f5Path.resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (!F5_SKIP_DIRS.has(entry.name)) f5ListTsx(file, out);
    } else if (entry.name.endsWith('.tsx') && !F5_TEST_FILE.test(entry.name)) {
      out.push(file);
    }
  }
  return out;
}

/**
 * 1-based lines of every inline menu panel in a .tsx source. A panel is a JSX element
 * whose className has `absolute` (any variant, resolving same-file `const` strings) and
 * no `inset-*`, that
 *   (a) is placed against a trigger — `top-full` / `bottom-full` / `mt-*` / `mb-*`, a
 *       `style` with `top`/`bottom`, or role listbox/menu;
 *   (b) holds items — role listbox/menu, or a descendant button/a/input/Button/
 *       CommandItem, role option/menuitem, or onClick/onMouseDown;
 *   (c) is rendered on demand — right side of `&&`, a branch of `?:`, or the `return`
 *       after an `if (…) return null`;
 *   (d) is not inside *Portal / PopoverContent / DropdownMenuContent / createPortal().
 * Icons and clear buttons fail (a)/(c), badges and tooltips fail (b), image overlays use
 * `inset-*`, and Radix/cmdk menus are portalled (d).
 */
function findInlineMenuPanels(fileName: string, source: string): number[] {
  const ast = f5Ts.createSourceFile(fileName, source, f5Ts.ScriptTarget.Latest, true, f5Ts.ScriptKind.TSX);
  const consts = new Map<string, f5Ts.Expression>();
  const collect = (node: f5Ts.Node): void => {
    if (f5Ts.isVariableDeclaration(node) && f5Ts.isIdentifier(node.name) && node.initializer) {
      consts.set(node.name.text, node.initializer);
    }
    f5Ts.forEachChild(node, collect);
  };
  collect(ast);

  const strings = (node: f5Ts.Node, out: string[], seen: Set<string>): string[] => {
    if (f5Ts.isIdentifier(node)) {
      const init = consts.get(node.text);
      if (init && !seen.has(node.text)) {
        seen.add(node.text);
        strings(init, out, seen);
      }
    } else if (f5Ts.isStringLiteral(node) || f5Ts.isNoSubstitutionTemplateLiteral(node)) {
      out.push(node.text);
    } else if (f5Ts.isTemplateExpression(node)) {
      out.push(node.head.text);
      for (const span of node.templateSpans) {
        strings(span.expression, out, seen);
        out.push(span.literal.text);
      }
    } else {
      // forEachChild stops at the first truthy return value — keep this callback void.
      f5Ts.forEachChild(node, (child) => {
        strings(child, out, seen);
      });
    }
    return out;
  };

  type Opening = f5Ts.JsxOpeningElement | f5Ts.JsxSelfClosingElement;
  const attr = (el: Opening, name: string) =>
    el.attributes.properties.find(
      (a): a is f5Ts.JsxAttribute => f5Ts.isJsxAttribute(a) && a.name.getText(ast) === name,
    );
  const roleOf = (el: Opening): string => {
    const init = attr(el, 'role')?.initializer;
    return init && f5Ts.isStringLiteral(init) ? init.text : '';
  };
  const classTokens = (el: Opening): string[] => {
    const init = attr(el, 'className')?.initializer;
    if (!init) return [];
    return strings(init, [], new Set())
      .join(' ')
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => token.split(':').pop() ?? token);
  };
  const styleSetsTopOrBottom = (el: Opening): boolean => {
    const init = attr(el, 'style')?.initializer;
    const expr = init && f5Ts.isJsxExpression(init) ? init.expression : undefined;
    return (
      !!expr &&
      f5Ts.isObjectLiteralExpression(expr) &&
      expr.properties.some((p) => !!p.name && ['top', 'bottom'].includes(p.name.getText(ast)))
    );
  };
  const renderedOnDemand = (el: f5Ts.Node): boolean => {
    let node = el;
    while (node.parent && f5Ts.isParenthesizedExpression(node.parent)) node = node.parent;
    const parent = node.parent;
    if (!parent) return false;
    if (f5Ts.isBinaryExpression(parent)) {
      return parent.operatorToken.kind === f5Ts.SyntaxKind.AmpersandAmpersandToken && parent.right === node;
    }
    if (f5Ts.isConditionalExpression(parent)) return parent.whenTrue === node || parent.whenFalse === node;
    if (f5Ts.isReturnStatement(parent) && f5Ts.isBlock(parent.parent)) {
      const body = parent.parent.statements;
      return body
        .slice(0, body.indexOf(parent))
        .some((s) => f5Ts.isIfStatement(s) && /\breturn\s+null\b/.test(s.thenStatement.getText(ast)));
    }
    return false;
  };
  const insidePortal = (el: f5Ts.Node): boolean => {
    for (let node: f5Ts.Node | undefined = el.parent; node; node = node.parent) {
      if (f5Ts.isJsxElement(node) && F5_PORTAL_TAG.test(node.openingElement.tagName.getText(ast))) return true;
      if (f5Ts.isCallExpression(node) && /createPortal$/.test(node.expression.getText(ast))) return true;
    }
    return false;
  };
  const holdsItems = (el: f5Ts.JsxElement): boolean => {
    let found = false;
    const visit = (node: f5Ts.Node): void => {
      if (found) return;
      if (
        (f5Ts.isJsxOpeningElement(node) || f5Ts.isJsxSelfClosingElement(node)) &&
        (F5_INTERACTIVE_TAGS.has(node.tagName.getText(ast)) ||
          F5_ITEM_ROLES.has(roleOf(node)) ||
          !!attr(node, 'onClick') ||
          !!attr(node, 'onMouseDown'))
      ) {
        found = true;
        return;
      }
      f5Ts.forEachChild(node, visit);
    };
    el.children.forEach(visit);
    return found;
  };

  const lines: number[] = [];
  const visit = (node: f5Ts.Node): void => {
    if (f5Ts.isJsxElement(node) || f5Ts.isJsxSelfClosingElement(node)) {
      const opening = f5Ts.isJsxElement(node) ? node.openingElement : node;
      const tokens = classTokens(opening);
      if (tokens.includes('absolute') && !tokens.some((t) => /^-?inset-/.test(t))) {
        const menuRole = F5_MENU_ROLES.has(roleOf(opening));
        const placed =
          menuRole ||
          styleSetsTopOrBottom(opening) ||
          tokens.some((t) => t === 'top-full' || t === 'bottom-full' || /^-?m[tb]-/.test(t));
        const items = menuRole || (f5Ts.isJsxElement(node) && holdsItems(node));
        if (placed && items && renderedOnDemand(node) && !insidePortal(node)) {
          lines.push(ast.getLineAndCharacterOfPosition(opening.getStart(ast)).line + 1);
        }
      }
    }
    f5Ts.forEachChild(node, visit);
  };
  visit(ast);
  return lines;
}

const F5_POSITIVE: [string, string][] = [
  [
    'listbox via cn() + same-file const (SearchableSelect)',
    `export function A({ open, up }: { open: boolean; up: boolean }) {
      const menuPos = up ? 'bottom-full mb-1' : 'mt-1';
      return <div className="relative"><input role="combobox" aria-expanded={open} />
        {open && (<div role="listbox" className={cn('absolute z-50 w-full', menuPos)}><button role="option">ก</button></div>)}
      </div>;
    }`,
  ],
  [
    'early return null (InstallmentPickerPopover)',
    `export function B({ open }: { open: boolean }) {
      if (!open) return null;
      return (<div className="absolute z-50 mt-1 w-full rounded-xl border bg-card shadow-lg"><button type="button">งวด 1</button></div>);
    }`,
  ],
  [
    'AccountSearchDropdown panel as of HEAD 2026-11-14 (Task 6 replaces it with PopoverContent)',
    `export function C({ open, disabled }: { open: boolean; disabled: boolean }) {
      return <div className="relative"><button data-slot="select-trigger" type="button">เลือก</button>
        {open && !disabled && (
          <div className="absolute z-30 w-full mt-1 rounded-md border shadow-lg bg-popover" style={{ maxHeight: 320 }}>
            <input aria-label="ค้นหา" /><button type="button">42-1102</button>
          </div>
        )}</div>;
    }`,
  ],
  [
    'role=menu in a ternary, template-literal className',
    'export function D({ show }: { show: boolean }) { return show ? (<div role="menu" className={`absolute left-0 top-full mt-1 ${show ? "block" : ""}`}><span>รายการ</span></div>) : null; }',
  ],
  [
    'caret-positioned autocomplete (style top/left)',
    `export function E({ show, pos }: { show: boolean; pos: { top: number; left: number } }) {
      return <div className="relative"><textarea />{show && (<div className="absolute z-50 w-80 bg-card shadow-xl" style={{ top: pos.top + 30, left: pos.left }}><button type="button">ตัวแปร</button></div>)}</div>;
    }`,
  ],
];

const F5_NEGATIVE: [string, string][] = [
  ['leading icon', '<div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" /><input /></div>'],
  ['count badge', '<div className="relative">{count > 0 && <span className="absolute -top-1 -right-1 rounded-full bg-destructive">{count}</span>}</div>'],
  ['hover tooltip', '<div className="relative">{hover && <div className="absolute bottom-full mb-2 rounded bg-popover px-2 text-xs shadow">คำอธิบาย</div>}</div>'],
  ['clear button', '<div className="relative">{query && (<button type="button" className="absolute right-2 top-1/2 -translate-y-1/2"><X className="size-4" /></button>)}</div>'],
  ['image overlay', '<div className="relative">{hover && (<div className="absolute inset-0 flex bg-background/80"><button type="button">ลบรูป</button></div>)}</div>'],
  [
    'positioned wrapper of a Radix DropdownMenu (BookingDetailSheet)',
    '<div>{showMenu && (<div className="absolute right-14 top-2"><DropdownMenu><DropdownMenuTrigger asChild><Button aria-label="เพิ่มเติม" /></DropdownMenuTrigger></DropdownMenu></div>)}</div>',
  ],
  [
    'AccountSearchDropdown after Task 6 (PopoverContent portal)',
    `<Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><button type="button" role="combobox">เลือกบัญชี</button></PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0">
        <Search className="absolute left-2 top-2.5 size-3.5" />
        {open && (<div className="absolute mt-1 w-full"><button type="button">42-1102</button></div>)}
      </PopoverContent>
    </Popover>`,
  ],
];

describe('F5 — inline (non-portalled) menus (spec 2026-11-14 §5)', () => {
  it.each(F5_POSITIVE)('detector flags: %s', (_label, source) => {
    expect(findInlineMenuPanels('fixture.tsx', source)).toHaveLength(1);
  });

  it.each(F5_NEGATIVE)('detector ignores: %s', (_label, source) => {
    expect(findInlineMenuPanels('fixture.tsx', source)).toEqual([]);
  });

  it('every allow-list entry says why it may stay', () => {
    const weak = Object.entries(F5_NON_PORTAL_MENU_ALLOW)
      .filter(([, { panels, reason }]) => panels < 1 || reason.trim().length < 10)
      .map(([file]) => file);
    expect(weak).toEqual([]);
  });

  it(
    'only allow-listed files render an absolute menu outside a portal',
    () => {
      const files = f5ListTsx(f5Path.resolve(F5_ROOT, 'apps/web/src'));
      // Guard against the scan silently walking the wrong tree and passing vacuously.
      expect(files.length).toBeGreaterThan(500);
      const found: Record<string, number> = {};
      for (const file of files) {
        const source = f5Fs.readFileSync(file, 'utf8');
        if (!/\babsolute\b/.test(source)) continue;
        const panels = findInlineMenuPanels(file, source);
        if (panels.length) found[f5Path.relative(F5_ROOT, file).split(f5Path.sep).join('/')] = panels.length;
      }
      const allowed = Object.fromEntries(
        Object.entries(F5_NON_PORTAL_MENU_ALLOW).map(([file, { panels }]) => [file, panels]),
      );
      expect(found).toEqual(allowed);
    },
    F5_SCAN_TIMEOUT_MS,
  );
});
```

- [ ] **Step 3: Run the guard and watch it fail (red)**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
npm run test --workspace=apps/web -- src/components/ui/field-guards.inventory.test.ts
```

Expected result:
- The 12 `detector flags:` / `detector ignores:` tests pass.
- `every allow-list entry says why it may stay` passes.
- Tasks 7/9/10's existing tests pass.
- Exactly one test fails:

```
FAIL  src/components/ui/field-guards.inventory.test.ts > F5 — inline (non-portalled) menus (spec 2026-11-14 §5) > only allow-listed files render an absolute menu outside a portal
AssertionError: expected { …(13) } to deeply equal {}
+ {
+   "apps/web/src/components/bundle/BundleSearch.tsx": 1,
+   "apps/web/src/components/template-editor/editor/VariableAutocomplete.tsx": 1,
+   "apps/web/src/components/ui/NameAutocomplete.tsx": 1,
+   "apps/web/src/components/ui/SearchableSelect.tsx": 2,
+   "apps/web/src/pages/CollectionsPage/components/InstallmentPickerPopover.tsx": 1,
+   "apps/web/src/pages/ExpensesPage.tsx": 1,
+   "apps/web/src/pages/POSPage/components/CustomerSearch.tsx": 1,
+   "apps/web/src/pages/PurchaseOrdersPage/components/wizard/items/CatalogPicker.tsx": 1,
+   "apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx": 1,
+   "apps/web/src/pages/UnifiedInboxPage/components/NoteMentionInput.tsx": 1,
+   "apps/web/src/pages/UnifiedInboxPage/components/SessionActions.tsx": 2,
+   "apps/web/src/pages/other-income/components/TemplatePickerCombobox.tsx": 1,
+   "apps/web/src/pages/settings/SettingsLayout.tsx": 1
+ }
```

Check the list before going on:
- If `AccountSearchDropdown.tsx` appears, Task 6 is not done. Stop.
- If one of the 13 is missing, an earlier task already removed that menu. Leave it out of Step 4.
- If a file is listed that is not in the table above, a new inline menu was added. Portal it, do not allow-list it.

- [ ] **Step 4: Fill the allow-list with exactly the remaining set (green)**

In the same file, replace this line:

```ts
const F5_NON_PORTAL_MENU_ALLOW: Record<string, { panels: number; reason: string }> = {};
```

with:

```ts
const F5_NON_PORTAL_MENU_ALLOW: Record<string, { panels: number; reason: string }> = {
  // spec §5 F5 allow-list + SearchableSelect (until R2-2) — each has a case in menu-clip-components.mjs
  'apps/web/src/components/ui/SearchableSelect.tsx': {
    panels: 2,
    reason: 'R2-2 replaces it — AddressForm ย้ายไป Combobox แล้วลบไฟล์นี้ (listbox + กล่อง "ไม่พบผลลัพธ์")',
  },
  'apps/web/src/components/ui/NameAutocomplete.tsx': {
    panels: 1,
    reason: 'allow-list ใน spec §5 F5 — ช่องพิมพ์ชื่ออิสระ ไม่แปลงเป็น Combobox (§6.4)',
  },
  'apps/web/src/pages/other-income/components/TemplatePickerCombobox.tsx': {
    panels: 1,
    reason: 'allow-list ใน spec §5 F5 — เมนูคำสั่ง ไม่ใช่ตัวเลือก (§6.4) · เลยขอบขวาจอที่ 1024/390 (KNOWN ในสคริปต์)',
  },
  'apps/web/src/pages/PurchaseOrdersPage/components/wizard/items/CatalogPicker.tsx': {
    panels: 1,
    reason: 'allow-list ใน spec §5 F5 — อยู่ในกล่องเลื่อนของหน้าต่างโดยตั้งใจ เลื่อนลงดูผลได้',
  },
  'apps/web/src/pages/UnifiedInboxPage/components/NoteMentionInput.tsx': {
    panels: 1,
    reason: 'allow-list ใน spec §5 F5 — รายชื่อ @แจ้งเตือนเปิดขึ้นเหนือช่องในแผงโน้ต',
  },
  // Found by this scan, NOT in the spec's allow-list, no browser case yet — owner decides portal vs keep.
  'apps/web/src/components/bundle/BundleSearch.tsx': {
    panels: 1,
    reason: 'มีอยู่ก่อนงานนี้ (ค้นของแถม) · นอก allow-list ของ spec — รอเจ้าของตัดสิน',
  },
  'apps/web/src/components/template-editor/editor/VariableAutocomplete.tsx': {
    panels: 1,
    reason: 'มีอยู่ก่อนงานนี้ (ตัวแปรในแม่แบบเอกสาร วางตามตำแหน่งเคอร์เซอร์) · นอก allow-list ของ spec — รอเจ้าของตัดสิน',
  },
  'apps/web/src/pages/CollectionsPage/components/InstallmentPickerPopover.tsx': {
    panels: 1,
    reason: 'มีอยู่ก่อนงานนี้ (เลือกงวดที่นัดจ่าย) · นอก allow-list ของ spec — รอเจ้าของตัดสิน',
  },
  'apps/web/src/pages/ExpensesPage.tsx': {
    panels: 1,
    reason: 'มีอยู่ก่อนงานนี้ (เมนู "สร้างเอกสารใหม่") · นอก allow-list ของ spec — รอเจ้าของตัดสิน',
  },
  'apps/web/src/pages/POSPage/components/CustomerSearch.tsx': {
    panels: 1,
    reason: 'มีอยู่ก่อนงานนี้ (ค้นลูกค้าหน้า POS) · นอก allow-list ของ spec — รอเจ้าของตัดสิน',
  },
  'apps/web/src/pages/settings/SettingsLayout.tsx': {
    panels: 1,
    reason: 'มีอยู่ก่อนงานนี้ (ผลค้นหาการตั้งค่า) · นอก allow-list ของ spec — รอเจ้าของตัดสิน',
  },
  'apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx': {
    panels: 1,
    reason: 'มีอยู่ก่อนงานนี้ (@แท็กในโน้ตลูกค้า) · นอก allow-list ของ spec — รอเจ้าของตัดสิน',
  },
  'apps/web/src/pages/UnifiedInboxPage/components/SessionActions.tsx': {
    panels: 2,
    reason: 'มีอยู่ก่อนงานนี้ (เมนู "โอนให้พนักงาน" + "สร้างสัญญา") · นอก allow-list ของ spec — รอเจ้าของตัดสิน',
  },
};
```

(Remove any entry that Step 3 did not list.)

```bash
npm run test --workspace=apps/web -- src/components/ui/field-guards.inventory.test.ts
```

Expected: every test in the file passes. That includes all 14 F5 tests: 5 `detector flags:`, 7 `detector ignores:`, `every allow-list entry says why it may stay`, and `only allow-listed files render an absolute menu outside a portal`. Exit code 0.

- [ ] **Step 5: Lint and type-check the web app**

```bash
npm run lint --workspace=apps/web
bash tools/check-types.sh web
```

Expected: no new errors from `field-guards.inventory.test.ts`. The drafted block was linted through `eslint --stdin` with 0 problems, and type-checked against the full web program with 0 diagnostics.

- [ ] **Step 6: Create the browser clip script `tools/field-scale/menu-clip-components.mjs`**

```js
// F5 (spec 2026-11-14 §5): one browser case per component that the static guard
// (apps/web/src/components/ui/field-guards.inventory.test.ts) lets keep an inline,
// non-portalled menu. Opens each menu on the local preview and checks the list box is
// inside the viewport and inside every ancestor that clips overflow. Saves nothing:
// mutating requests on mocked routes are aborted, and no form is submitted.
//
// Run: npm run local:preview (once) → node tools/field-scale/menu-clip-components.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { previewStatus, repo } from '../local-preview.mjs';

const WIDTHS = [1440, 1024, 390];
// MENU_CLIP_STRICT=1 treats KNOWN entries as failures (see every clipped menu).
const STRICT = process.env.MENU_CLIP_STRICT === '1';

/** Runs in the page. Scroll containers the user can scroll (auto/scroll) are scrolled so
 * the list is as visible as it can get — reachable by scrolling is not "cut". Ancestors
 * with overflow hidden/clip are never scrolled: what they hide stays hidden. */
function revealInScrollers(el) {
  for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    const s = getComputedStyle(a);
    const r = el.getBoundingClientRect();
    const b = a.getBoundingClientRect();
    if (/auto|scroll/.test(s.overflowY)) {
      const top = b.top + a.clientTop;
      const bottom = top + a.clientHeight;
      if (r.bottom > bottom) a.scrollTop += Math.min(r.bottom - bottom, r.top - top);
      else if (r.top < top) a.scrollTop -= top - r.top;
    }
    if (/auto|scroll/.test(s.overflowX)) {
      const left = b.left + a.clientLeft;
      const right = left + a.clientWidth;
      if (r.right > right) a.scrollLeft += Math.min(r.right - right, r.left - left);
      else if (r.left < left) a.scrollLeft -= left - r.left;
    }
  }
  const r = el.getBoundingClientRect();
  if (r.bottom > innerHeight) scrollBy(0, Math.min(r.bottom - innerHeight, r.top));
  else if (r.top < 0) scrollBy(0, r.top);
}

/** Runs in the page. Every way the list box is cut: by the viewport, or by an ancestor
 * whose overflow is not `visible` (its padding box is the clip rectangle). 1px tolerance. */
function clipIssues(el) {
  const r = el.getBoundingClientRect();
  const rect = [r.left, r.top, r.right, r.bottom].map(Math.round);
  const issues = [];
  if (r.width < 1 || r.height < 1) issues.push({ by: 'empty', rect });
  if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1)
    issues.push({ by: 'viewport', rect, clip: [0, 0, innerWidth, innerHeight] });
  for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    const s = getComputedStyle(a);
    const clipX = s.overflowX !== 'visible';
    const clipY = s.overflowY !== 'visible';
    if (!clipX && !clipY) continue;
    const b = a.getBoundingClientRect();
    const left = b.left + a.clientLeft;
    const top = b.top + a.clientTop;
    const right = left + a.clientWidth;
    const bottom = top + a.clientHeight;
    const cut =
      (clipX && (r.left < left - 1 || r.right > right + 1)) ||
      (clipY && (r.top < top - 1 || r.bottom > bottom + 1));
    if (cut)
      issues.push({
        by: `${a.tagName.toLowerCase()}.${String(a.className).trim().split(/\s+/).slice(0, 5).join('.')}`,
        overflow: `${s.overflowX}/${s.overflowY}`,
        rect,
        clip: [left, top, right, bottom].map(Math.round),
      });
  }
  return issues;
}

const nextFrame = (page) =>
  page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

/** GET → synthetic JSON; anything else → aborted, so a stray click can never write. */
async function mockGet(page, pattern, json) {
  await page.route(pattern, (route) => {
    if (route.request().resourceType() === 'document') return route.continue();
    return route.request().method() === 'GET' ? route.fulfill({ json: json(new URL(route.request().url())) }) : route.abort();
  });
}

const CASES = [
  {
    name: 'NoteMentionInput',
    where: '/inbox/<chatWorkRooms.SHOP> → โน้ตภายใน → ช่อง "แจ้งเตือนเพื่อนร่วมทีม"',
    async open(page, origin, info) {
      await page.goto(`${origin}/inbox/${info.chatWorkRooms.SHOP}?zone=shop`);
      if (page.viewportSize().width < 1024) {
        await page.getByRole('button', { name: 'เลือกโหมดช่องพิมพ์', exact: true }).click();
        await page.getByRole('menuitemradio', { name: 'โน้ตภายใน · ลูกค้าไม่เห็น', exact: true }).click();
      } else {
        await page.getByRole('radio', { name: 'โน้ตภายใน', exact: true }).click();
      }
      await page.getByRole('combobox', { name: 'แจ้งเตือนเพื่อนร่วมทีม', exact: true }).click();
      const list = page.getByRole('listbox', { name: 'เพื่อนร่วมทีมที่มีสิทธิ์ในห้องนี้', exact: true });
      await expect(list.getByRole('option').first()).toBeVisible();
      return list;
    },
  },
  {
    name: 'SearchableSelect',
    where: '/customers → "+ เพิ่มลูกค้าใหม่" → ที่อยู่ → จังหวัด (ที่อยู่ตามบัตร)',
    async open(page, origin) {
      await page.goto(`${origin}/customers`);
      await page.getByRole('button', { name: /^\+ เพิ่ม(ลูกค้า|ผู้สนใจ)ใหม่$/ }).click();
      const dialog = page.getByRole('dialog', { name: 'เพิ่มลูกค้าใหม่' });
      await dialog.getByRole('heading', { name: 'ที่อยู่', exact: true }).click();
      const province = dialog.getByRole('combobox', { name: 'จังหวัด *', exact: true }).first();
      await province.evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await province.click();
      const list = page.getByRole('listbox', { name: '-- เลือกจังหวัด --', exact: true });
      await expect(list.getByRole('option').first()).toBeVisible();
      return list;
    },
  },
  {
    name: 'NameAutocomplete',
    where: '/canned-responses → หมวดทดสอบ 01 → แม่แบบทดสอบเมนู 01 → ช่อง "หมวด"',
    // The page puts a fixed 384px tree beside the editor, so at 390px the editor (and
    // every field in it) is 0px wide — a page-layout problem, not the menu's.
    skip: { 390: 'หน้า /canned-responses ไม่มีเลย์เอาต์มือถือ (ต้นไม้หมวดกว้าง 384px ตายตัว แผงแก้ไขเหลือ 0px)' },
    async open(page, origin) {
      const templates = Array.from({ length: 12 }, (_, i) => {
        const n = String(i + 1).padStart(2, '0');
        return {
          id: `f5-template-${n}`,
          shortcut: `/f5-${n}`,
          title: `แม่แบบทดสอบเมนู ${n}`,
          content: '',
          category: `หมวดทดสอบ ${n}`,
          sortOrder: i + 1,
          isActive: true,
          hideFromChat: false,
          verifiedOnly: false,
          createdAt: '2026-11-14T00:00:00.000Z',
        };
      });
      await mockGet(page, /\/staff-chat\/canned-responses(?:\/[^/?]+\/(?:bubbles|quick-replies))?(?:\?|$)/, (url) =>
        /\/(?:bubbles|quick-replies)$/.test(url.pathname) ? [] : templates,
      );
      await page.goto(`${origin}/canned-responses`);
      await page.getByText('หมวดทดสอบ 01', { exact: true }).click();
      await page.getByText('แม่แบบทดสอบเมนู 01', { exact: true }).click();
      await page.getByRole('combobox', { name: 'หมวด', exact: true }).fill('หมวดทดสอบ');
      const list = page.getByRole('listbox', { name: 'รายชื่อที่แนะนำ', exact: true });
      await expect(list.getByRole('option')).toHaveCount(12);
      return list.locator('xpath=..');
    },
  },
  {
    name: 'TemplatePickerCombobox',
    where: '/other-income/new → ส่วน 2 → ปุ่ม "ใช้แม่แบบ"',
    // Measured 2026-11-14 on the local preview: the w-72 panel is left-aligned to a
    // right-aligned button, so it runs past the right edge of the screen.
    known: {
      1024: { by: 'viewport', note: 'กล่องกว้าง 288px ชิดซ้ายของปุ่มที่อยู่ขวาสุด → เลยขอบขวาจอ (856→1144 บนจอ 1024)' },
      390: { by: 'viewport', note: 'เลยขอบขวาจอ (258→546 บนจอ 390)' },
    },
    async open(page, origin) {
      const templates = Array.from({ length: 8 }, (_, i) => ({
        id: `f5-other-income-${i + 1}`,
        name: `แม่แบบรายได้ทดสอบ ${i + 1}`,
        itemsJson: [{}],
        useCount: i,
      }));
      await mockGet(page, /\/other-income\/templates(?:\?|$)/, () => templates);
      await page.goto(`${origin}/other-income/new`);
      const trigger = page.getByRole('button', { name: 'ใช้แม่แบบ', exact: true });
      await trigger.evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await trigger.click();
      const panel = trigger.locator('xpath=following-sibling::div[1]');
      await expect(panel.getByText('แม่แบบรายได้ทดสอบ 8', { exact: true })).toBeVisible();
      return panel;
    },
  },
  {
    name: 'CatalogPicker',
    where: '/purchase-orders → "+ ซื้อสินค้า" → ช่อง "ค้นหารุ่น" พิมพ์ iphone',
    async open(page, origin) {
      await mockGet(page, /\/(?:purchase-orders|suppliers)(?:\/summary)?(?:\?|$)/, (url) =>
        url.pathname.endsWith('/summary') ? {} : url.pathname.endsWith('/suppliers') ? { data: [], total: 0 } : [],
      );
      await page.goto(`${origin}/purchase-orders`);
      await page.getByRole('button', { name: '+ ซื้อสินค้า', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'ซื้อสินค้า' });
      const search = dialog.getByRole('combobox', { name: 'ค้นหารุ่น' });
      await search.evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await search.fill('iphone');
      const list = dialog.getByRole('listbox');
      await expect(list.getByRole('option').first()).toBeVisible();
      return list.locator('xpath=..');
    },
  },
];

const status = await previewStatus();
assert.ok(status.running && status.current, 'Run npm run local:preview in this checkout first');
const origin = `http://localhost:${status.state.port}`;
const info = await (await fetch(`${origin}/api/admin/preview/info`)).json();
assert.equal(info.isolated, true, 'Only run against the isolated local preview');
// Other local checks switch the synthetic actor; these pages need OWNER.
assert.equal((await fetch(`${origin}/api/preview/actor/owner`, { method: 'POST' })).status, 201);

const artifacts = join(repo, '.tmp/field-scale/menu-clip-components');
mkdirSync(artifacts, { recursive: true });
const results = [];
const failures = [];
const browser = await chromium.launch();
try {
  for (const width of WIDTHS) {
    for (const c of CASES) {
      const label = `${c.name} ${width}px`;
      if (c.skip?.[width]) {
        results.push({ component: c.name, width, status: 'SKIP', reason: c.skip[width] });
        console.log(`SKIP ${label}: ${c.skip[width]}`);
        continue;
      }
      const context = await browser.newContext({
        viewport: { width, height: width < 1024 ? 844 : 900 },
        reducedMotion: 'reduce',
      });
      await context.routeWebSocket('**/socket.io/**', (socket) => socket.close());
      const page = await context.newPage();
      try {
        const list = await c.open(page, origin, info);
        await nextFrame(page);
        await list.evaluate(revealInScrollers);
        await nextFrame(page);
        const issues = await list.evaluate(clipIssues);
        await page.screenshot({ path: join(artifacts, `${c.name}-${width}.png`) });
        const known = STRICT ? undefined : c.known?.[width];
        if (known && issues.some((i) => i.by === known.by)) {
          results.push({ component: c.name, width, status: 'KNOWN', note: known.note, issues });
          console.log(`KNOWN ${label}: ${known.note}`);
        } else if (known) {
          failures.push(`${label}: known issue "${known.note}" no longer reproduces — remove it from KNOWN`);
          results.push({ component: c.name, width, status: 'FAIL', issues });
        } else if (issues.length) {
          failures.push(`${label} (${c.where}): list box is cut ${JSON.stringify(issues)}`);
          results.push({ component: c.name, width, status: 'FAIL', issues });
        } else {
          results.push({ component: c.name, width, status: 'PASS' });
          console.log(`PASS ${label}`);
        }
      } catch (error) {
        failures.push(`${label} (${c.where}): ${error.message.split('\n')[0]}`);
        results.push({ component: c.name, width, status: 'ERROR', error: error.message.split('\n')[0] });
        await page.screenshot({ path: join(artifacts, `${c.name}-${width}-error.png`) }).catch(() => {});
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ origin, results, failures }, null, 2) + '\n');
}
const count = (s) => results.filter((r) => r.status === s).length;
if (failures.length) {
  console.error(`\nFAIL menu clip:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`\nPASS menu clip: ${count('PASS')} passed · ${count('KNOWN')} known · ${count('SKIP')} skipped → ${artifacts}`);
}
```

How each case reaches its component. All are open-only: no save button is pressed, and every mocked route aborts non-GET requests.

| Component | Page (preview) | Open action | Locator of the measured box | Mocks (preview answers 501 or empty) |
|---|---|---|---|---|
| NoteMentionInput | `/inbox/<info.chatWorkRooms.SHOP>?zone=shop` | radio `โน้ตภายใน` (on mobile: button `เลือกโหมดช่องพิมพ์` → menuitemradio `โน้ตภายใน · ลูกค้าไม่เห็น`), then click combobox `แจ้งเตือนเพื่อนร่วมทีม` | listbox `เพื่อนร่วมทีมที่มีสิทธิ์ในห้องนี้` | none (eligible-staff is real in preview) |
| SearchableSelect | `/customers` | button `+ เพิ่มลูกค้าใหม่`/`+ เพิ่มผู้สนใจใหม่` → heading `ที่อยู่` (`<details>`) → first combobox `จังหวัด *` scrolled to the centre → click | listbox `-- เลือกจังหวัด --` (opens upwards) | none (address data is a bundled chunk) |
| NameAutocomplete | `/canned-responses` | text `หมวดทดสอบ 01` (expand) → text `แม่แบบทดสอบเมนู 01` → fill combobox `หมวด` with `หมวดทดสอบ` | parent of listbox `รายชื่อที่แนะนำ` (the `absolute` div) | `GET /staff-chat/canned-responses?includeHidden=true` → `CannedResponse[]` (`id, shortcut, title, content, category, sortOrder, isActive, hideFromChat, verifiedOnly, createdAt`) · `GET …/:id/bubbles` and `…/:id/quick-replies` → `[]` |
| TemplatePickerCombobox | `/other-income/new` | button `ใช้แม่แบบ` | the trigger's following-sibling `div` (no role on this panel) | `GET /other-income/templates` → `[{ id, name, itemsJson: [{}], useCount }]` |
| CatalogPicker | `/purchase-orders` | button `+ ซื้อสินค้า` → in dialog `ซื้อสินค้า` fill combobox `ค้นหารุ่น` with `iphone` | parent of the cmdk `listbox` (the `absolute` panel, including its footer) | `GET /purchase-orders` → `[]` · `/purchase-orders/summary` → `{}` · `/suppliers?limit=200&isActive=true` → `{ data: [], total: 0 }` |

- [ ] **Step 7: Run the script in strict mode and watch it fail (red)**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
npm run local:preview
MENU_CLIP_STRICT=1 node tools/field-scale/menu-clip-components.mjs; echo "exit $?"
```

Run `npm run local:preview` first. It restarts the preview when the source fingerprint changed, and `previewStatus().current` must be true.

Expected output, measured on the preview on 2026-11-14:

```
FAIL menu clip:
- TemplatePickerCombobox 1024px (/other-income/new → ส่วน 2 → ปุ่ม "ใช้แม่แบบ"): list box is cut [{"by":"viewport","rect":[856,476,1144,764],"clip":[0,0,1024,900]}]
- TemplatePickerCombobox 390px (/other-income/new → ส่วน 2 → ปุ่ม "ใช้แม่แบบ"): list box is cut [{"by":"viewport","rect":[258,448,546,736],"clip":[0,0,390,844]}]
exit 1
```

The y values may shift slightly. The `by: "viewport"` part must not change.

- [ ] **Step 8: Run the script normally (green)**

```bash
node tools/field-scale/menu-clip-components.mjs; echo "exit $?"
```

Expected output (ran in about 36 s):

```
PASS NoteMentionInput 1440px
PASS SearchableSelect 1440px
PASS NameAutocomplete 1440px
PASS TemplatePickerCombobox 1440px
PASS CatalogPicker 1440px
PASS NoteMentionInput 1024px
PASS SearchableSelect 1024px
PASS NameAutocomplete 1024px
KNOWN TemplatePickerCombobox 1024px: กล่องกว้าง 288px ชิดซ้ายของปุ่มที่อยู่ขวาสุด → เลยขอบขวาจอ (856→1144 บนจอ 1024)
PASS CatalogPicker 1024px
PASS NoteMentionInput 390px
PASS SearchableSelect 390px
SKIP NameAutocomplete 390px: หน้า /canned-responses ไม่มีเลย์เอาต์มือถือ (ต้นไม้หมวดกว้าง 384px ตายตัว แผงแก้ไขเหลือ 0px)
KNOWN TemplatePickerCombobox 390px: เลยขอบขวาจอ (258→546 บนจอ 390)
PASS CatalogPicker 390px

PASS menu clip: 12 passed · 2 known · 1 skipped → D:\BESTCHOICE APP\BESTCHOICE\.tmp\field-scale\menu-clip-components
exit 0
```

Look at the 15 PNGs in `.tmp/field-scale/menu-clip-components/`. Each must show the open list.

If someone fixes the TemplatePickerCombobox panel (for example `right-0` instead of left alignment, or portalling it), the KNOWN entries start failing with "no longer reproduces — remove it from KNOWN". Delete them in that PR.

- [ ] **Step 9: Commit**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
git add apps/web/src/components/ui/field-guards.inventory.test.ts tools/field-scale/menu-clip-components.mjs
git commit -F - <<'EOF'
test(field-scale): F5 guard for non-portalled menus + per-component clip checks

- field-guards.inventory.test.ts: self-contained F5 block — TS-AST detector for inline
  `absolute` menu panels (placed against a trigger, holding items, rendered on demand,
  not portalled), 12 fixture tests (icons/badges/tooltips/overlays/Radix wrappers and the
  post-Task-6 PopoverContent are ignored), exact-match allow-list: the spec's four +
  SearchableSelect (R2-2 replaces it) + 8 pre-existing menus pending an owner decision.
  AccountSearchDropdown is not allow-listed (portalled by Task 6).
- tools/field-scale/menu-clip-components.mjs: opens NoteMentionInput, SearchableSelect,
  NameAutocomplete, TemplatePickerCombobox and CatalogPicker on the local preview at
  1440/1024/390 and asserts the list box is inside the viewport and every clipping
  ancestor (after scrolling user-scrollable ancestors). Records TemplatePickerCombobox
  running past the right edge at 1024/390 as KNOWN; MENU_CLIP_STRICT=1 shows it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: one commit with 2 files changed. `git status --short` no longer shows those two files.
