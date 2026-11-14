# Audit tooling & prior findings reusable for a "field scale" check

Read-only survey; nothing was edited, built or run (only `git log`/`git show` and directory listings). All paths are repo-relative.

## 0. Correction to the established facts — verify before planning

The brief says a 44px NativeSelect beside a 34px `<Input>`, `<SelectTrigger>` or SearchableSelect is a visible mismatch. Inside the back-office shell that is mostly not what renders, because two global stylesheets override the Tailwind heights. I read the CSS but did not measure it in a browser.

- **`apps/web/src/styles/admin-typography.css:49-57`** (imported at `apps/web/src/main.tsx:20`) is unlayered and scoped to `body:has(.app-shell)`, so it beats Tailwind's layered utilities.
  - It forces `height: 2.75rem; min-height: 2.75rem; font-size: 0.875rem; line-height: 1.5` on every `input` (except checkbox/radio/range/color/hidden/file), `select`, `[data-slot=select-trigger]`, `button[role=combobox]`, `[data-slot=input-wrapper]` and `[data-slot=input-addon]`.
  - Lines 206-218 raise the font to `1rem` below 1024px.
  - Exemptions: controls carrying `.text-lg … .text-4xl` or `.text-[18px|20px|24px]`, inputs inside `[data-slot=input-wrapper]` or `[data-field-frame]`, textareas, and document/paper subtrees.
- **`apps/web/src/styles/admin-controls.css:11-13`** (`main.tsx:21`) applies at `body` level, so it also covers public/LIFF pages. It sets `min-height: 2.75rem` on `[data-slot=input]`, `input-wrapper`, `input-addon` and `select-trigger` only — not on a bare `<select>`, a raw `<input>`, or `data-slot="searchable-select-input"`.

Consequences for the plan:

- **In-shell:** default `<Input>`, `<SelectTrigger>` (all sizes) and the SearchableSelect `<input>` should already render 44px / 14px (16px on mobile). The remaining differences are:
  - border radius (`rounded-md` vs `rounded-lg` is not normalised);
  - padding and arrow inset;
  - controls exempted by a `text-lg+` class;
  - textareas;
  - custom triggers that are plain `<button>`/`<div>` without `role=combobox` or a `data-slot`. Past reports found a 39px account dropdown and a 28px button on the other-income editor, and a 40px PO model picker (`docs/reports/control-size-followup-2026-10-18.md:12-13`).
- **Out-of-shell (login, LIFF, public, kiosk):** class heights apply. SearchableSelect stays at `h-[34px] text-sm` (`apps/web/src/components/ui/SearchableSelect.tsx:144`). This is the class of defect in `docs/reports/auth-field-scale-2026-10-17/README.md:3` (production login inputs 34px / 13px).
- **New searchable dropdown:** its trigger gets 44px in-shell only if it is an `input`, a `button[role=combobox]` or carries `data-slot="select-trigger"`. To be right outside the shell it must use `formControlClass` itself or carry a `data-slot` that `admin-controls.css` matches.

## 1. What the collector measures today

### Files

| File | Role |
|---|---|
| `tools/typography-audit/collect.js` | In-page script; exposes `window.__collectTypography({ exclude, root })` and returns `Fact[]` |
| `tools/typography-audit/rules.mjs` | Pure rules: `evaluateTypography`, `diffFindings`, `compareFacts` |
| `tools/typography-audit/routes.mjs` | Route inventory builder (App.tsx + settings registry + storefront) |
| `tools/typography-audit/report.mjs` | BEFORE/AFTER pairing; writes `summary.md`, `findings.json`, contact sheet |
| `tools/typography-audit/*.test.mjs` | `node:test` suites; `collect.test.mjs` launches real Chromium |
| `apps/api/e2e/documents/uxui-pages.browser.docs-spec.ts` | Admin + LIFF harness; injects the collector when `UXUI_TYPOGRAPHY=1` |
| `apps/web-shop/e2e/typography-audit.spec.ts` | Storefront harness (`TYPOGRAPHY_AUDIT=1`) |
| `tools/check-admin-typography.mjs` | Separate fixed check: 6 routes × 4 widths against a running `local:preview`; not referenced by `package.json`, `tools/`, CI or `AGENTS.md` |

### Fact model

- One fact per visible text element, plus one per visible form control.
- Controls are matched by `CONTROL_SELECTOR = 'input,select,textarea,[role=combobox],[data-slot=select-trigger]'` (`collect.js:23`), outermost only (`collect.js:605-608`). NativeSelect, SelectTrigger and the SearchableSelect input are all collected as `kind: 'input'`.
- Control facts (`collect.js:552-596`) carry `tag`, `x/y/w/h` (page-absolute border box), `fontSize`, `lineHeight`, `fontWeight`, `fontFamily`, `overflowClip`, `iconRatios` and placeholder-based ink metrics.
- By design they never record the value: text is `placeholder || aria-label`, and `scrollOverflowX/Y` and `truncation` are hard-coded off (Rulings Q/U, `collect.js:587-593`).
- Not recorded: border radius, padding, adornments, wrapper/row membership, popup state.

### Rules that touch fields

| Rule | Applies to | Check | Source |
|---|---|---|---|
| R6 | `button, badge, th, nav, tab, label` | horizontal clip with `scrollOverflowX` | `rules.mjs:66,169-175` |
| R7 | `button, input` | `h < 44` at width ≤430; `h < 32` at width ≥768; nothing between | `rules.mjs:67,177-185` |
| R7b | `input` | `fontSize < 16` at width ≤430 | `rules.mjs:186-188` |
| D2 | `button, badge, input, tab` | ink centre offset >1.5px and worse than before; BEFORE/AFTER only | `rules.mjs:283-296` |
| R3, R8, R9 | all facts incl. controls | line-height ratio, font family, weight | `rules.mjs:133-197` |

R6 does not include `input`, and control facts force `scrollOverflowX = false`, so a control's own text can never raise R6.

The harness also records per-theme `fields[]` and `buttons[]` geometry for `#main` in `<out>/uxui-pages/inventory-results.json` (`uxui-pages.browser.docs-spec.ts:252-262`). That is enough raw data for a row-mismatch check, but it excludes dialogs.

### Not covered

- **Sibling height/radius/font mismatch in a row** — no rule groups controls.
- **Overlap between elements** — no rule. The report records a miss: on `/stock/products` at 1440 the sort arrow overlapped header text, and "the tool only counts text that overflows and is hidden; this overflowed and showed on top, so it was not counted (found from the screenshot)" (`docs/reports/typography-ui-fixes-2026-11/summary.md:59`).
- **Control value or placeholder clipped** — excluded by design.
- **Popover/listbox clipping** — the collector never opens anything; only the first paint of each route is measured. Dialogs, tabs and wizard steps are not opened.
- **Select vs input mismatch** — not compared.
- **Roles:** only `owner` and `salesA`; FINANCE_MANAGER, ACCOUNTANT and BRANCH_MANAGER are unmeasured (`report.mjs:60`).
- **Widths:** 1440/390/320 only, so R7 never evaluates 431–767px.

### A second, field-specific suite already exists

`apps/api/e2e/ui-fields/*.audit-spec.ts` runs on the same disposable harness (added in #1707; guide in `docs/guides/form-field-qa.md`).

- **`fields.audit-spec.ts`** — 25 cases × 320/390/768/1440 × light/dark.
  - Opens create dialogs and tabs.
  - Asserts no body overflow, correct font, every field labelled, no field outside the viewport, and no field under 43.9px below 1024px (`:109`).
  - Asserts exactly 44px for non-textarea fields on 11 "full-size" forms (`:137-144`).
- **`shared-controls.audit-spec.ts`** — NativeSelect geometry: height `2.75 × root`, arrow width, inset and vertical centring, `padding-right ≥ 2.5rem`, `appearance: none` (`:42-59`). It also asserts the date popover is fully inside the viewport (`:135-140`) and runs an axe contrast check.
- **Others:** `dialogs`, `pagination`, `po-filters`, `report-controls`, `reports-data` and `system-e2e` specs, plus `system-fixtures.ts` (the `seedSystemUi` used by `UXUI_POPULATED=1`).

### Unit guards on control sizing

- `apps/web/src/components/ui/native-select.inventory.test.ts` — bans raw `<select>`/`<datalist>`.
- `apps/web/src/pages/__tests__/touchTargets.test.ts` and `apps/web/src/components/ui/__tests__/touchTargets.test.tsx` — source-reading tests that pin `max-lg:min-h-11` + `lg:min-h-8` on about 25 named buttons/links.
- `apps/web/src/styles/admin-typography.test.ts` — pins the document-exclusion lists only.
- `native-select.test.tsx` and `form.test.tsx` — behaviour and a11y only.
- No vitest asserts `formControlClass`, `h-11` on fields, or the 2.75rem CSS rule; grep of `*.test.*` for `formControlClass` returned nothing.

## 2. Recorded findings about fields and dropdowns

### Typography audit (3,186 route × width × theme × role sets; 2,043 rendered and paired)

| Rule | Before fixes (`typography-scale-audit-2026-11/summary.md:264-269`) | After round 3 (`typography-ui-fixes-2026-11/summary.md:64-72`) | Round 4, latest (`findings-round4.json`) |
|---|---|---|---|
| R7 height | 396 (220 mobile <44, 176 desktop <32) on 41 routes | 24, all intentionally skipped | 24 (12 mobile + 12 desktop) |
| R7b mobile font <16 | 8 on 1 route | 8 | 8 |
| R6 horizontal clip | 30 on 1 route | 33 (+3 storefront badge at 320) | 33 |
| D2 ink off-centre | 3,449, all upward, median −2.3px | owner decided not to fix (`summary.md:459`) | — |

- **R7:** every example in the reports is a button or link, none a text field. That fits the global 44px rule covering fields.
- **R7b:** the only field-kind finding still open. It is the IMEI input on `/after-sales/new` at 390/320, both themes, both roles.
  - Source: `apps/web/src/pages/AfterSalesNewPage.tsx:243` has `${inputClass} h-14 min-h-14 … text-lg`.
  - Probable cause, not verified: `text-lg` exempts it from the global rule while a smaller size class in `inputClass` wins the cascade.
- **R6:** the 30 back-office hits are all `/expenses/new` — account option labels such as "ธนาคาร - กสิกรไทย ออมทรัพย์ - 203116520…" (3 at 1440, 6 at 390/320). I did not identify which component renders them.

Report files: `docs/reports/typography-scale-audit-2026-11/{summary.md,findings.json,admin-inventory.json}` and `docs/reports/typography-ui-fixes-2026-11/{summary.md,round4.md,findings.json,findings-round4.json}`.

### October field and dropdown reports

- **`docs/reports/dropdown-inventory-2026-10-17/README.md`** — 206 legacy native selects in 122 files, with a per-file table and routes.
- **`docs/reports/dropdown-migration-2026-10-17/README.md`** — 209 sites migrated to NativeSelect (239 usages after). It warns that NativeSelect adds a wrapper and defaults to full width, which can change filter and table-cell sizing. Three review warnings were fixed: auto-width flex items, inconsistent compact height, tablet font size.
- **`docs/reports/form-fields-2026-10-16.md`** — concrete sibling mismatches found by hand:
  - bookings: customer 40px vs branch 34px;
  - products: select 43px vs input 39px;
  - IMEI field collapsed to 25px when flex turned vertical;
  - 1,556 field measurements in the final pass.
- **`docs/reports/po-field-layout-2026-10-17.md`**:
  - PO search shrank to 37px wide at 390;
  - an unlayered `min-width: 0` defeated page utilities;
  - a table column collapsed to 0px;
  - a payment form's fields were 496px wide in a 320px screen;
  - label gaps of 4–6px were normalised to 12px;
  - note: "Long native-select values can truncate".
- **`docs/reports/auth-field-scale-2026-10-17/README.md`** — login/reset at 34px / 13px, invite at 40px; fixed with `formControlClass`.
- **`docs/reports/control-size-audit-2026-10-18.md` and `control-size-followup-2026-10-18.md`** — 158 routes × 2 widths, 3,754 controls; PO and stock action groups overflowed their cells.
- **`docs/reports/uxui-closure-2026-10-17/README.md`**, `mobile-small-controls.json`, `residual-controls.json`, and `docs/reports/system-uxui-plan-2026-10-17.md` (§5 criteria table, plus `native-select-review.csv`).

The evidence JSONs for most October reports lived in `.tmp/` and are not in the repo. Locally `.tmp/` holds only `applehouse` and `local-preview`, so there are no typography run folders to re-analyse.

## 3. Running the harness

### Prerequisites

- **Dependencies** installed. The script builds `@installment/shared` and generates both Prisma clients unless `DOCS_QA_SKIP_PREPARE=1`.
- **PostgreSQL 16 with pgvector.** `tools/docs-integration.sh` needs `initdb`, `pg_ctl` and `createdb`. It resolves them from `DOCS_PG_BIN`, then `CREDIT_PG_BIN`, then standard Linux/macOS paths, then `pg_config --bindir`. Each run creates a throwaway cluster under `/tmp/bc-docs.XXXXXX` on a private unix socket (port 55477, `listen_addresses=''`) and deletes it afterwards.
- **Chromium.** Resolved from `PUPPETEER_EXECUTABLE_PATH`, puppeteer or Playwright; `DOCS_QA_INSTALL_CHROMIUM=1` installs it.
- **`bash` and `openssl`.**
- **Windows caveat (not tested):** this machine has `initdb.exe` on PATH at `C:\Users\what_\pgsql\bin`, and both `DOCS_PG_BIN` and `CREDIT_PG_BIN` are unset. The script's unix-socket-only cluster and `?host=<socket dir>` Prisma URL are untested under Git Bash here, and there is no `.tmp/docs-integration` folder, so `docs:check` has apparently not been run in this checkout. Treat a first run as a prerequisite check; WSL may be needed.

### Small subset (admin + LIFF)

`npm run docs:check` runs `bash tools/docs-integration.sh`; trailing args go to Jest, whose config `apps/api/e2e/jest-documents.json` matches `e2e/documents/.*\.docs-spec\.ts$`.

```bash
UXUI_TYPOGRAPHY=1 UXUI_POPULATED=1 UXUI_ROLE=owner \
UXUI_INVENTORY=docs/reports/typography-scale-audit-2026-11/admin-inventory.json \
UXUI_ROWS=87,50,72,79,57,53 UXUI_WIDTHS=1440,390 \
DOCS_QA_OUTPUT=$PWD/.tmp/field-scale/after-owner \
npm run docs:check -- uxui-pages.browser.docs-spec
```

- **Row ids** come from `admin-inventory.json`: 87 `/expenses/new`, 50 `/products/create`, 72 `/customers`, 79 `/contracts/create`, 57 `/after-sales/new`, 53 `/pos`, 34 `/purchase-orders`, 38 `/stock/products`, 120 `/users/new`, 18 `/liff/contract`. Without `UXUI_INVENTORY` the spec uses `docs/reports/uxui-2026-10-14/acceptance-routes.json` and its `no` values.
- **Flags** (`uxui-pages.browser.docs-spec.ts:32-54`):
  - `UXUI_TYPOGRAPHY=1` — opt-in, never set on CI;
  - `UXUI_ROLE=owner|salesA`;
  - `UXUI_WIDTHS` — default `1440,390,320`, any 320–3840;
  - `UXUI_CONCURRENCY` — 1–4 widths in parallel;
  - `UXUI_POPULATED=1` — seeds detail records;
  - `UXUI_UI_FONT`.
- **Themes:** light and dark are always both captured, by toggling `.dark` on `<html>`.
- **Navigation:** `history.pushState` on one long-lived page, then wait for skeletons and fonts; one viewport screenshot per theme.
- **LIFF rows** get a seeded synthetic session and mocked API.

### Field-audit suite

Command from `docs/guides/form-field-qa.md:12-17`:

```bash
DOCS_QA_SKIP_PREPARE=1 bash tools/docs-integration.sh \
  --roots "$PWD/apps/api/e2e/ui-fields" --testRegex 'fields\.audit-spec\.ts$' \
  --globals '{"ts-jest":{"isolatedModules":true,"diagnostics":false}}' --runInBand
```

Swap the regex for `shared-controls\.audit-spec\.ts$` (it honours `SHARED_WIDTHS`).

### Storefront

Header of `apps/web-shop/e2e/typography-audit.spec.ts:5-9`:

```bash
PRERENDER_API_BASE=http://127.0.0.1:9 npm --prefix apps/web-shop run build:prerender
cd apps/web-shop && TYPOGRAPHY_AUDIT=1 TYPOGRAPHY_OUT=$PWD/../../.tmp/field-scale/shop \
  TYPOGRAPHY_ONLY=/products,/sell/quote TYPOGRAPHY_WIDTHS=390 \
  npx playwright test -c e2e/typography-audit.config.ts
```

It needs this checkout's `dist` served on `127.0.0.1:5281`. That step requires a build, which this audit did not run.

### Duration

- **Plan estimate** (`docs/superpowers/plans/2026-11-08-typography-scale-audit.md:57`): one admin round of about 270 routes × 3 widths × 2 themes × 2 roles takes roughly 60–90 minutes with `UXUI_CONCURRENCY=3`.
- **Actual volume:** 1,674 JSON files per role (279 rows × 3 × 2).
- **Hard bound:** each width batch is one Jest `it` with a 30-minute timeout (`:314`).
- **BEFORE/AFTER:** a comparison doubles the time and needs a temporary worktree at the old commit (plan Step 5).
- **Field suites:** each `ui-fields` spec has a 10-minute timeout.
- **Measured wall-clock times:** none recorded in the repo.

### Output

Default location is `.tmp/docs-integration/<runId>/`, or `DOCS_QA_OUTPUT` if set:

- `typography/route-<no>-<width>-<theme>-<role>.json` — status + facts;
- `uxui-pages/route-<no>-<width>-<theme>.png`;
- `uxui-pages/inventory-results.json` — includes `fields[]` and `buttons[]`;
- `run.json`, `summary.md`, `jest-results.json`, Vite logs;
- field suites write `fields/results.json`, `shared-controls/results.json`, screenshots and traces.

Build the report with:

```bash
node tools/typography-audit/report.mjs --admin-before-owner … --admin-after-owner … \
  --admin-before-sales … --admin-after-sales … --shop-before … --shop-after … \
  --out docs/reports/<name> --sheet .tmp/…/contact-sheet.html [--revision <label>=<sha>]
```

Missing folders are reported, never fatal. Only `summary.md` and `findings.json` are committed.

`npm run local:check` (`docs/guides/local-check.md`) is a different, limited preview (Inbox, customers, finance portfolio at 1440/390; unsupported endpoints answer 501). It is not suitable for a field sweep.

## 4. Proposed new field-scale rules

Keep the existing split: `collect.js` records facts, `rules.mjs` decides. Add a flag-gated second export (for example `window.__collectFields({ exclude })`) so the R1–R12 facts and BEFORE/AFTER keys stay byte-stable. Reuse `visible()`, `box()`, `clipChain()`, `measure()` and the same exclude list.

Each `FieldFact` would hold: `key`, `tag`, `primitive` (from `data-slot`, `role`, `data-inline-combobox`), `x/y/w/h`, `fontSize`, `borderRadius`, `paddingLeft/Right`, `borderLeft/Right`, `rowId`, `inDialog`.

### F1 — sibling controls in one row differ (P2)

- **Row:** controls sharing the nearest common ancestor that is a flex-row or grid container, or simply controls whose vertical ranges overlap ≥50% within the same dialog/`main` scope and sit within about 48px horizontally.
- **Members:** `input`, `select`, `[data-slot=select-trigger]`, `[role=combobox]`, plus adjacent `button`/`[data-ui-control=button]`. Exclude textareas, checkbox/radio, and controls exempted by a `text-lg+` class.
- **Checks:**
  - `max(h) − min(h) > 2px`;
  - F1b: border radius differs by more than 1px;
  - F1c: font size differs by more than 0.5px;
  - F1d: tops or bottoms misaligned by more than 2px at equal height.
- **Cost:** the height part needs no collector change. Existing `kind: 'input'` facts already carry `x/y/w/h`, and `inventory-results.json` already has `fields[]`. Only `borderRadius` and the row id need new fields.

### F2 — control text clipped (P2; value-independent parts P1 at ≤430)

- **Content width:** `clientWidth − paddingLeft − paddingRight`.
- **F2a, placeholder:** canvas-measure the placeholder with the control's font and flag `placeholderInk > contentWidth + 1`. Today's `inkWidth` may be the `aria-label`, so it needs its own field.
- **F2b, native select:** measure the selected option's label against the content width. Record only the two numbers and a boolean, not the text, which keeps Ruling Q.
- **F2c, Radix trigger:** `[data-slot=select-value]` with `scrollWidth > clientWidth + 1`.
- **F2d, narrow field:** `w < 140` at width ≤430 (the bar `fields.audit-spec.ts:143` already uses), or `w < 4 × fontSize`.

### F3 — two interactive elements intersect (P1 if a click target is covered, else P2)

- **Candidates:** visible `a[href]`, `button`, `input`, `select`, `textarea`, and `[role=button|combobox|tab|switch|checkbox]`. Pairs must not be ancestor/descendant and must share a scroll container.
- **Geometry:** flag an intersection larger than 2px in both axes.
- **Occlusion:** for elements inside the viewport, `document.elementFromPoint(centre)` must return the element, a descendant, or its label. If it returns a different interactive element, that is the P1 case.
- **Whitelist:** an adornment button fully inside its control's padding zone is F4's job.
- **Cost:** O(n²) with n in the low hundreds per page.

### F4 — absolutely positioned adornment overlaps text ink (P2)

- **F4a, reserve check (deterministic):** for each control, find `position: absolute` elements in its positioned wrapper that intersect its border box (chevron, clear button, unit suffix, leading icon). Require `paddingRight ≥ control.right − adornment.left` on the right and the mirror on the left. This generalises what `shared-controls.audit-spec.ts:45-55` asserts for NativeSelect only.
- **F4b, ink check:** the placeholder or selected-option ink span must not intersect the adornment rect.
- **F4c, text facts:** for `th`/`button`/`tab` anchors, compare each direct text rect with each child `svg` rect and flag a horizontal intersection over 1px. `collect.js` already has `textRects()` and already walks child svgs for `iconRatios` (`collect.js:421-431`). This catches the `/stock/products` sort-arrow overlap the audit missed.

### F5 — popover or listbox clipped by an overflow ancestor (P1)

- **F5a, static risk:** for comboboxes whose list is not portalled (SearchableSelect marks itself with `data-inline-combobox="true"`, `SearchableSelect.tsx:93`), walk ancestors for the nearest `overflow-y` of hidden/clip/auto/scroll. Record `spaceBelow` and `spaceAbove`. Flag when both are smaller than the menu height: `max-h-60` is 240px, or option count × 44px.
- **F5b, open pass (new harness flag, e.g. `UXUI_FIELDS_OPEN=1`):** for each `[role=combobox]`/`[data-slot=select-trigger]` that is not a native select:
  1. click it and wait for `[role=listbox]` or `[data-slot=select-content|popover-content]`;
  2. assert the rect is inside the viewport;
  3. assert it is not cut by any clipping ancestor;
  4. assert `elementFromPoint` at the first and last option lands in the listbox;
  5. assert listbox width ≥ trigger width;
  6. press Escape.
- **Native selects:** the popup is drawn by the OS and cannot be measured; record it as "not measurable".
- **Precedents:** `shared-controls.audit-spec.ts:130-140` and `po-modern.json` in the dropdown-migration report.

### Harness gaps to close first

- **Dialogs and tabs** are not opened by the route inventory; reuse the `cases[]` pattern (`open`, `tab`, `expand`) from `fields.audit-spec.ts:18-44`.
- **Widths:** add 768 and 1024/1280 so F1 runs at the desktop-first breakpoint.
- **Roles:** still owner and salesA only.

## 5. Why NativeSelect was standardised to 44px

I found no dated owner quote of the form "fields must be 44px" in the repo. What is documented is a sequence of requests, criteria and PRs.

### Timeline

1. **2026-10-14, #1699 (`c26cf0091`)** — first field rule in `admin-typography.css`: below 1024px, inputs/selects/triggers get `font-size: 1rem; min-height: 2.75rem`, with the comment "iOS keeps the viewport steady when focusing a 16px text control". Acceptance item F14 reads "ปุ่มร่วมและ input มือถือเป้าหมาย 44px" (`docs/reports/uxui-2026-10-14/IMPLEMENTATION-REPORT.md:64`).
2. **2026-10-16, `docs/reports/form-fields-2026-10-16.md`** — the hand audit found sibling mismatches (40 vs 34, 43 vs 39). `formControlClass` was applied to specific forms only: "ไม่เปลี่ยน compact controls ทั้งระบบ" (`:21`).
3. **2026-10-17, #1707 (`e5b2d27a3`)** — "fix(ui): unify dropdowns and close audited mobile/form regressions". This is the first commit of `form-styles.ts`, `native-select.tsx` (web and web-shop), `native-select.inventory.test.ts` and the `ui-fields` audit specs. It also made the 2.75rem height apply at all widths in-shell.
   - The migration report states the spec: "2.75rem (44px at normal root size) controls in both apps; 16px text below 1024px and 14px desktop … Width/margins/flex/grid placement belong to the wrapper" (`dropdown-migration-2026-10-17/README.md:17-19`).
   - A code review found "inconsistent compact height" and fixed it (`:49`). That is the likely reason `native-select.tsx:27` appends `h-11 min-h-11` after the caller's `className`; no document states this as the reason.
4. **2026-10-17, `docs/reports/system-uxui-plan-2026-10-17.md:98`** — the shared criterion: "Fields: กลุ่ม control ปกติสูง 2.75rem (44px ที่ root 16px), desktop 14px/mobile 16px ตามระบบปัจจุบัน; textarea, editor, ช่องจำนวนใน table และยอดเงินใหญ่บันทึกข้อยกเว้นตามหน้าที่". Line 99 adds: shared Select uses a 16px icon with a 12px inset, and labels leave room for the focus ring (hence `formLabelClass` `mb-3`).
5. **2026-10-17, #1708 (`f819c1bf5`)** — auth pages moved to `formControlClass` after production login measured 34px / 13px.
6. **2026-10-18, #1711 (`b1f6d8438`)** — `admin-controls.css` added. The recorded request: "make ordinary buttons visually consistent throughout the program, including the company selector and previous/next-year buttons on Monthly Close" (`control-size-audit-2026-10-18.md:3`). Buttons and tab triggers joined "the 44px field scale", which was then extended to public/LIFF and storefront.
7. **2026-11-08, Ruling AF / canvas item 5** — the only explicitly dated owner decision on control height. It sets audit thresholds, not the field scale: R7 passes desktop controls ≥32px, mobile stays 44px (`rules.mjs:34-40`, `report.mjs:59`).

### What a new searchable dropdown must match

- **Trigger:** 2.75rem tall (rem-based; reports measured 55px at a 20px root), `rounded-lg`, 14px text on desktop and 16px below 1024px, line-height 1.5/normal.
- **Arrow:** one 16px arrow inset `0.75rem + 1px`, with `pr-10` text reserve.
- **Layout:** width and placement live on a wrapper; default is full width with `min-w-0 max-w-full`.
- **Label:** `formLabelClass` (`mb-3`).
- **Options:** rows at least 44px (`min-h-11`, as in `select.tsx:164` and `SearchableSelect.tsx:170`).
- **Form behaviour kept by the migration:** id/name/ref/required/disabled, label association, and Escape closing the list before the dialog.
- **Documented exceptions:** textareas, editors/paper, quantity inputs inside tables, large money inputs.
- **Guards it must keep passing:** `native-select.inventory.test.ts`, the 44px assertions in `fields.audit-spec.ts`, and the arrow geometry in `shared-controls.audit-spec.ts`.
