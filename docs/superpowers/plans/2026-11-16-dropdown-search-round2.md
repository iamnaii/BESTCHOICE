# Round 2 — Searchable Dropdowns (`Combobox`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Long dropdowns in the back office become one searchable `Combobox` (cmdk + Radix Popover) with Thai-aware search, the 6 existing combobox-like pickers move onto the same core, and the address form drops `SearchableSelect` — without changing field height, values sent to the API, or any form's behaviour.

**Architecture:** Measure first (Task 1 extends the Round 1 field-scale tool with routes for every Round 2 screen and records `baseline-r2` on main). The owner approves a mockup (Task 2) before code. Then build the core once (Task 3 `thai-search`, Task 4 `Combobox` + test helpers), migrate in the spec's PR order behind characterization tests (Tasks 5–6 address, 7–8 accounts, 9–10 existing comboboxes, 11–14 the 23 appendix ค fields), and fix the one known menu overflow (Task 15). Every visual task ends with `--compare baseline-r2 <label>`.

**Tech Stack:** React 19.2, Vite, Tailwind 4.3, shadcn/Radix (`@radix-ui/react-popover` 1.1.15), cmdk 1.1.1, vitest 4.1 + Testing Library (jsdom 25), Node 24 `node:test` + Playwright Chromium (tools), Git Bash on Windows 11.

**Spec:** `docs/superpowers/specs/2026-11-14-dropdown-search-field-scale-design.md` §6, §7 rows R2-0…R2-4d, §8, §9 (incl. §9.1 account codes), appendix ค. Round 1 plan (format, tools, guards): `docs/superpowers/plans/2026-11-14-field-scale-round1.md`.

**Starts after Round 1 is merged** (PR #1780, squash commit `6e79e6eb4` on main, 2026-11-16). Work on a new branch `feat/dropdown-search-round2` from that main.

**Tasks 7, 8 and 13 also wait for the expense-create PEAK-layout work.** That work (branch `feat/expense-create-peak-layout`, spec `docs/superpowers/specs/2026-11-16-expense-create-peak-layout-design.md`; commits seen up to `5e44c303f`; Tasks 7, 8 and 13 were checked against `7b67db27c`, Tasks 7 and 13 again against `5e44c303f` — Appendix B) changes `AccountSearchDropdown` (rows and trigger `<code> - <name>`, CoA group headings — owner 2026-11-16, Round 2 spec §9.1) and moves `ItemLinesSection`'s account field (expense and credit-note lines) from `NativeSelect` onto `AccountSearchDropdown`. Tasks 7, 8 and 13 run only after that branch is merged to main, or after `feat/dropdown-search-round2` is rebased onto it; Tasks 1–6, 9–12, 14 and 15 do not wait. Task 1 Step 1 records whether it is on main: `grep -rln "AccountSearchDropdown" apps/web/src --include=*.tsx` lists `components/expense-form-v4/ItemLinesSection.tsx` once it has landed. Task 7 Step 0 repeats that grep and stops if the line is missing.

## Global Constraints

- Field height stays 44px; `apps/web/src/styles/admin-typography.css` is **not** edited (it already sizes `button[role=combobox]` under `.app-shell`: 44px, 14px at ≥1024px, 16px below).
- Searchable only for long lists (owner 2026-11-14): only the fields named in this plan become `Combobox`; short lists stay `NativeSelect`. Not converted: branch selects (1 branch — no `BranchSelect`), days 1–31, product statuses, template block types, ≤ 7 options, months, mobile nav menus (`ReportsPage`, `SettingsLayout`), `NameAutocomplete`, `CatalogPicker`, `NoteMentionInput`, `CommandPalette`, `CashAccountSelect`, `TemplatePickerCombobox` as a picker (Task 15 only fixes its overflow), and the ~15 other account/cash pickers the spec does not list (asset, equity, payroll, interco, petty cash movements…).
- `Combobox` look: trigger = raw `<button type="button" role="combobox">` with `formControlClass` (8px corners, `border-input`, `bg-background`) — never `<Button>`; content = portalled `PopoverContent` `w-(--radix-popover-trigger-width) min-w-64`; Thai default copy exactly: placeholder `เลือก…`, search placeholder `พิมพ์เพื่อค้นหา…`, empty `ไม่พบรายการ`, loading `กำลังโหลด…`, error `โหลดรายการไม่สำเร็จ` + button `ลองใหม่`.
- Labels: a converted field keeps (or gets) a real `<label htmlFor>` / `LabeledField`; the trigger's accessible name = its label only (spec §6.1) — the component never sets its own `aria-label` (a caller passes `aria-label` only where the field has no visible label, e.g. a toolbar filter). **One label rule for every task:** labels in one row or one form never mix styles. (1) Filter rows and toolbars: the converted field keeps the class its sibling labels use (ChatAnalytics' plain labels), or its `aria-label` when the row has no visible labels (SalesHistory, POListTab, `/expenses`, TodoFilters, ProspectFilterBar). (2) A form whose other labels the task does not touch keeps its existing label class on the converted field too (Task 12: ProductCreate, StockAlerts, ReferenceQuestionnaire; Task 14: QuickReplyEditor, UserProfile). (3) Style A `formLabelClass` (Round 1) is applied to a whole form at once, never to one label among others: forms already style A (TodoForm, QuickBuyModal), a form with a single label (ChannelFilter, StuckContractsSection), or Task 11's three inbox forms (ChatFollowUpDialog, ChatServiceRequestDialog, the ChatServiceRequestCard edit form), which Task 11 moves wholesale to style A (spec §4.3 ค) — a scope widening listed in Appendix A for the owner.
- Values sent to the API and every `onChange` side effect stay byte-for-byte the same (sentinels converted back before sending, immediate-save fields save only on pick, never on open/search).
- Semantic tokens only; `text-warning` is not a text colour (use `text-warning-strong`); Thai text never `leading-none` (use `leading-snug`).
- Thai for all user-facing copy; English identifiers. No new UI libraries (shadcn/Radix/cmdk/lucide only).
- Out of scope: `apps/web-shop`, documents/print/stickers/Tiptap, multi-select, free-text entry, `name`/hidden inputs, `container`/`modal` props, changing field height.
- Windows: `npm run local:check` is not supported. Per task run: `bash tools/check-types.sh web` · `npm run lint --workspace=apps/web` · the task's vitest files (and the full `npm run test --workspace=apps/web` before each PR) · `npm run build --workspace=apps/web` · `npm run local:preview` + `node tools/field-scale/check.mjs`. Known Windows-only failures not caused by this work: `headerNowrap`, `tabsButtonRowsNowrap`, `RecordPaymentWizard.preview-params` (CRLF source regexes; pass on Linux CI) and `TradeInFlow` / `ProductsPage` timeouts under full-suite load (pass alone). Every PR body states what ran on Windows and that `local:check` must run on Linux/CI (AGENTS.md).
- AGENTS.md preview rules: never kill processes by port or process name; only `npm run local:preview` / `local:status` / `local:stop`; leave a verified preview running; report what was not verified.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push, open PRs, merge or deploy unless the owner asks. `.tmp/` is gitignored — never commit measurement output.

## Shared contracts (later tasks use these exact names)

### `apps/web/src/lib/thai-search.ts` (Task 3)

```ts
export function normalizeThai(s: string): string;
export type MatchRank = 1 | 2 | 3 | 4;
export interface Searchable { label: string; keywords?: readonly string[] }
export function rankMatch(item: Searchable, query: string): MatchRank | null;
export function filterAndRank<T extends Searchable>(items: readonly T[], query: string): T[];
```

- `normalizeThai`: NFC → remove U+200B–U+200D and U+FEFF → `/ํ([่-๋]?)า/g` → `'$1ำ'` → `เเ` → `แ` → lowercase → trim → Thai digits ๐–๙ → 0–9.
- `rankMatch` on normalized label/query: 1 = label starts with query · 2 = label starts with query after skipping one leading vowel `[เแโใไ]`, or any word (split on whitespace/punctuation) starts with query (also after skipping one leading vowel) · 3 = label contains query · 4 = any keyword starts with or contains query · otherwise `null`. Empty query → every item rank 1.
- `filterAndRank`: drops `null`, sorts by rank, stable within a rank (original order).

### `apps/web/src/components/ui/combobox.tsx` (Task 4)

```ts
export type ComboOption<M = unknown> = {
  value: string;            // '' allowed — cmdk gets the internal key `opt:${index}`
  label: string;
  keywords?: string[];
  description?: string;
  group?: string;
  disabled?: boolean;
  disabledReason?: string;
  meta?: M;
};

export interface ComboboxProps<M = unknown> {
  value: string | null;
  onChange: (value: string, option: ComboOption<M> | null) => void; // null only when cleared
  options: ComboOption<M>[];
  selectedOption?: ComboOption<M> | null;   // current value not in `options`
  placeholder?: string;                     // 'เลือก…'
  searchable?: boolean;                     // default true
  searchPlaceholder?: string;               // 'พิมพ์เพื่อค้นหา…'
  searchLabel?: string;                     // accessible name of the search box (cmdk <Command label>), default 'ค้นหา'
  listLabel?: string;                       // accessible name of the listbox, default 'ตัวเลือก'
  emptyText?: string;                       // 'ไม่พบรายการ'
  filter?: (options: ComboOption<M>[], query: string) => ComboOption<M>[]; // default filterAndRank
  onSearchChange?: (term: string) => void;  // server mode: caller owns useQuery/useDebounce; forces searchable
  loading?: boolean;                        // 'กำลังโหลด…'
  error?: boolean | string;                 // 'โหลดรายการไม่สำเร็จ'
  onRetry?: () => void;                     // button 'ลองใหม่'
  onCreate?: (term: string) => void;
  createLabel?: (term: string) => string;
  createOnEnter?: boolean;                  // Enter with no exact label match calls onCreate
  footer?: React.ReactNode;                 // rendered OUTSIDE <Command> (cmdk steals Enter from buttons inside it)
  clearable?: boolean;                      // separate clear button, calls onChange('', null)
  clearLabel?: string;                      // accessible name of the clear button, default 'ล้างค่า'
  pending?: boolean | string;               // keeps the menu open and shows one pending row ('กำลังเพิ่ม…' or the string)
  closeOnSelect?: boolean;                  // default true · false = a pick only calls onChange; the menu stays open until the caller sets `open` to false, or Esc / outside click
  renderOption?: (option: ComboOption<M>, state: { selected: boolean }) => React.ReactNode;
  renderValue?: (option: ComboOption<M>) => React.ReactNode;
  id?: string;
  required?: boolean;                       // aria-required only — never blocks submit
  disabled?: boolean;
  invalid?: boolean;                        // aria-invalid + destructive border
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: React.AriaAttributes['aria-invalid'];   // from shadcn FormControl / LabeledField; `invalid` wins when true
  'aria-required'?: React.AriaAttributes['aria-required']; // from LabeledField; `required` wins when true
  onBlur?: React.FocusEventHandler<HTMLButtonElement>;
  className?: string;                       // trigger
  wrapperClassName?: string;
  contentClassName?: string;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}
export const Combobox: <M = unknown>(props: ComboboxProps<M> & { ref?: React.Ref<HTMLButtonElement> }) => React.ReactElement;
```

DOM contract: trigger `button[type=button][role=combobox][data-slot="combobox-trigger"][aria-haspopup="listbox"][aria-expanded]`; open content `[data-slot="combobox-content"]` (portalled) holding the search `input` (accessible name = `searchLabel`) and `[role=listbox]` (name = `listLabel`) of `[role=option]` rows (`aria-selected`, `aria-disabled`). Keyboard: on the trigger ArrowDown / Enter / Space open; a printable key (length 1, not space, no ctrl/meta/alt, not composing) opens and seeds the search; Esc closes only the menu (inside Dialog / Sheet / AlertDialog too); on open the search box gets focus with the caret at the end; on a coarse pointer (`matchMedia('(pointer: coarse)')`) the list gets focus instead. `onWheel` / `onTouchMove` on the content stop propagation; the list is `overscroll-contain`.

Behaviour (final — every later task relies on it; Task 4 implements and tests each line):
- **Selected / trigger:** a row is selected iff `option.value === value` (plain equality; several rows may be selected; `renderOption`'s `state.selected` uses the same rule). The trigger shows the first selected option, else `selectedOption` when `selectedOption.value === value`, else `placeholder` (muted). `selectedOption` is display-only — never a row. `value: null` shows the placeholder.
- **Pick** always calls `onChange(value, option)`, also when the row already is the value (AddressForm resets on re-pick); then the menu closes unless `closeOnSelect={false}`. Callers whose `onChange` has side effects (immediate save, page reset) ignore a re-pick of the current value themselves.
- **Custom rendering:** `renderOption` replaces the whole row content (no check mark added; the row keeps its classes/ARIA; its name is its text). Without it each selected row ends with a `Check`. `renderValue` replaces only the text inside `span[data-slot="combobox-value"]`, which keeps `title={option.label}`; with no `renderValue` the `ChevronDown` is the first `svg` in the trigger.
- **Search text** is owned by the Combobox: `onSearchChange(term)` on every change and `onSearchChange('')` when it resets; it resets on every close (pick, Esc, outside click, controlled `open` → false).
- **Highlight:** opening with an empty search highlights the first selected row; with no selected row, opening highlights the first enabled row (Task 4 test "opens on the first enabled row when no row is selected"); when the visible rows change while the search is not empty (typing, server results after the debounce) the first enabled row is highlighted and announced (`aria-activedescendant`), so Enter picks it.
- **`filter`** gets `(options, rawQuery)` and its order is rendered as-is (rows sharing a `group` are gathered under it, groups in first-seen order) — in server mode too. Without `filter`: `filterAndRank`, except in server mode, where rows are not filtered again.
- **Create row / Enter-to-create:** shown when the trimmed term is non-empty, no option has `normalizeThai(label) === normalizeThai(term)`, and neither `loading` nor `pending`; `error` does not hide it. `onCreate` / `createLabel` get the raw text (callers trim); default label `สร้าง “{term}”`. Create calls `onCreate` then closes. The create button sits outside cmdk's root.
- **Empty text** shows whenever 0 rows are visible and the list is not loading, in error or pending — also next to the create row.
- **Pending:** one non-option status row (`role="status"`, the string or `กำลังเพิ่ม…`, spinner) between the search box and the listbox; no rows, no create row; the search box stays usable; Esc / outside click / trigger click / Tab do not close the menu while pending.
- **Error:** the `error` string as given (`true` → `โหลดรายการไม่สำเร็จ`); `onRetry` adds `ลองใหม่`; both outside `<Command>`.
- **Clear button:** rendered when `value` is non-empty (also a value no option carries) and not `disabled`; calls `onChange('', null)`, refocuses the trigger, does not open the menu.
- **Footer** renders inside the open content after `<Command>`.
- **Attributes:** `required` → `aria-required="true"` (never blocks submit); `disabled` → native `disabled` on the trigger (a disabled `<fieldset>` disables it too); `className` merged after `formControlClass` (caller wins); `id` on the trigger. The search box is named by cmdk's hidden `<Command label>` and also carries `aria-label={searchLabel}` (an explicit name for tests and tools that read the attribute; the field-scale menu probes find the menu through the trigger's `aria-controls` since Task 1).
- **Keyboard extra:** Tab / Shift+Tab out of the menu closes it without picking and refocuses the trigger.
- **Look** = Task 2's approved visual contract: 44px rows (`min-h-11`), disabled rows `text-muted-foreground` without fading (never cmdk's `opacity-50`), check mark `text-primary!`, `title` on the value span (not the button). Option accessible name = the row's whole text (label + description + disabledReason).

### Test helpers (Task 4)

- `apps/web/src/test/setup.ts`: a global no-op `Element.prototype.scrollIntoView` (only when missing) — compatible with the 14 files that already polyfill or spy on it.
- `apps/web/src/test/combobox.ts`:

```ts
import type { UserEvent } from '@testing-library/user-event';
export async function openCombobox(user: UserEvent, name: string | RegExp): Promise<HTMLElement>; // returns the listbox
export async function pickComboOption(
  user: UserEvent,
  name: string | RegExp,            // the trigger's accessible name (its label)
  option: string | RegExp,          // the option's accessible name
  opts?: { search?: string },       // type this into the search box first
): Promise<void>;                   // resolves after the menu has closed
```

`pickComboOption` waits (`waitFor`, 1 s) for the trigger's `aria-expanded="false"`. With `closeOnSelect={false}` it passes only when the caller closes the menu within that timeout (ContactCombobox: on ensure-role success); otherwise click the row yourself.

## Task order and dependencies

| Task | Spec PR | Depends on | Deliverable |
|---|---|---|---|
| 1 Field-scale routes for Round 2 screens + `baseline-r2` | R2 (§5) | Round 1 merged | routes for every screen Tasks 5–15 touch; address-host routes fixed; `baseline-r2` on main |
| 2 `Combobox` mockup | R2-0 | 1 | canvas artifact with 9 states, owner approval recorded |
| 3 `thai-search` | R2-1 | — | `normalizeThai`, `rankMatch`, `filterAndRank` + tests |
| 4 `Combobox` + test helpers | R2-1 | 2, 3 | `combobox.tsx`, `setup.ts` polyfill, `test/combobox.ts`, tests |
| 5 Address flow characterization | R2-2 | 1 | `AddressForm` flow tests passing against `SearchableSelect` |
| 6 `AddressForm` → `Combobox`, delete `SearchableSelect` | R2-2 | 4, 5 | 9 hosts unchanged; guards/F5/menu-clip/api e2e updated |
| 7 `AccountCombobox` (every `AccountSearchDropdown` user) | R2-3a | 4 + the PEAK-layout work on main | replaces `AccountSearchDropdown` (`<code> - <name>` + headings kept); characterization first |
| 8 GL + AccountRoles pickers | R2-3a | 7 | both on `AccountCombobox` |
| 9 `ContactCombobox` (+3 wrappers) | R2-3b | 4 | thin shell on `Combobox`, external API kept |
| 10 `EmployeeCombobox`, Bookings `CustomerCombobox` | R2-3b | 4 | thin shells; create-customer footer out of `<Command>` |
| 11 Staff fields (9) | R2-4a | 4 | appendix ค R2-4a rows |
| 12 Models (5) + suppliers (2) | R2-4b | 4 | appendix ค R2-4b rows |
| 13 Expense accounts (3) | R2-4c | 7 (so also the PEAK-layout work) | appendix ค R2-4c rows; the pending account-menu probes attached |
| 14 Others (4) | R2-4d | 4 | appendix ค R2-4d rows |
| 15 `TemplatePickerCombobox` overflow | owner 2026-11-16 | 1 | portalled menu inside the viewport; F5 allow-list −1 |

Each task is one PR-sized, independently revertable unit (spec §7: separate branches per PR are fine; this plan's tasks map to them).

## Cross-task notes (read before starting any task)

- **Baseline label is `baseline-r2`** (Task 1): main's UI after Round 1, measured by the Task 1 tools. Every visual task: `npm run local:preview` → `node tools/field-scale/check.mjs --label <task-label>` → `node tools/field-scale/check.mjs --compare baseline-r2 <task-label>`. The Round 1 `baseline` stays on disk for history only.
- **Compare triage rule** — the Round 1 rule applies unchanged (Round 1 plan, cross-task notes: clauses (a) dup/re-key with the same-cell one-to-one identical-detail condition, (b) membership growth, (c) derived bottom; MENU, lost cells, fact drops and nondeterminism are never accepted). Converting a `NativeSelect` / Radix `SelectTrigger` / custom button to `Combobox` **re-kinds** the control (its `memberKey` kind changes), so its still-open findings come back under new keys — that is clause (a), and the report must list each pair.
- **What the compare cannot see:** the menu itself (collector measures closed fields) and search behaviour. Those are proven by vitest (each converted field has at least one strict test: open → pick → assert the state/payload) and by Task 1's per-screen open-menu probes where the task says so.
- **Loose e2e locators** (`select, [role="combobox"]).first()` in admin-settings, expense-workflow, finance, reports-notifications, stock-management, template-editor, trade-in-flow) do not land on any field this plan converts (verified 2026-11-16) — re-check with grep in each task that converts a field on those pages.
- **e2e and audit specs that touch converted fields** are listed in the task that converts them; each must be updated in the same task (web `apps/web/e2e/**`, api `apps/api/e2e/ui-fields/**`). They do not run on Windows — the task updates them by reading the selector code and states they were not executed.
- **cmdk facts** (verified with cmdk 1.1.1 + jsdom 25): item values are trimmed (not lower-cased); an item with value `''` can never be highlighted; with `shouldFilter={false}` `CommandEmpty` shows only when no items are mounted; the cmdk input is itself `role=combobox` named only by `<Command label>`; Enter on any `<button>` inside `<Command>` selects the highlighted row instead of clicking the button — footers, retry and create buttons live outside `<Command>`.
- **Radix facts:** `PopoverTrigger asChild` adds `aria-haspopup="dialog"` (override with `listbox`), `aria-controls`, `data-state`; it opens on Enter/Space but not ArrowDown; default open-focus selects all input text (prevent and set the caret); in Dialog/Sheet/AlertDialog the first Esc closes only the popover.
- **Account codes (spec §9.1, decided 2026-11-16).** The searchable account picker (`AccountSearchDropdown`, after Task 7 `AccountCombobox`) shows `เลขบัญชี - ชื่อ` — exactly `` `${code} - ${accountDisplayName(name)}` ``, the separator the PEAK-layout work ships — under account-group headings on every screen that uses it: other-income items, Override JV, adjustments, petty cash, and the expense / credit-note lines once the PEAK-layout work has moved them onto it. That is `AccountCombobox`'s default `display` (`'code-dash-name'`, Task 7). Question 4 (Task 2) — do the pickers Round 2 converts from `NativeSelect` / Popover (RecurringBillDialog, the `/expenses` type filter, GL, AccountRoles) also show the code that way? — was answered yes on 2026-11-16 ("ทำได้เลย"), so Task 7's default covers them: Tasks 8 and 13 dropped their `display` props (GL `code-full-name`, AccountRoles `name`, the filter's `name`, RecurringBill `code-name`); no caller passes `display` any more.
- **PEAK-layout merge after `baseline-r2`.** If the PEAK-layout work reaches main after Task 1 recorded `baseline-r2`, every route on `/expenses/new` changes under every later compare (`expense-new`, `payroll-new`, `r2-petty-cash-lines`, `r2-credit-note-lines`, `r2-settlement-new`). Then, before the next Round 2 task: rebase `feat/dropdown-search-round2` onto main, run `npm run local:preview`, record `node tools/field-scale/check.mjs --label baseline-r2-peak` (Task 1 Step 11's command with that label; expect `menu probes: <n> pass · 0 fail`, `<n>` = 32 plus 8 if Task 12 is done), and from then on compare against `baseline-r2-peak` wherever a task says `baseline-r2`. Note in the task report which baseline was used.
- **Line numbers** below are from `feat/field-scale-round1` HEAD `69ab47516` (= main after the squash merge), except in files the PEAK-layout work changed (`components/expense-form-v4/ItemLinesSection.tsx`, `ExpenseFormV4.tsx`, `VendorSection.tsx`, their tests, `pages/other-income/components/AccountSearchDropdown.tsx` + test, `utils/accountName.ts`), where Tasks 7, 8 and 13 quote that branch's commit `7b67db27c`. Anchor every edit on an exact unique string; treat lines as a guide.
- **Drafting notes cited in the tasks** (`plan-notes`, `facts-core` / `facts-address` / `facts-accounts` / `facts-comboboxes` / `facts-callsites` §…) are the code-reading notes in `.superpowers/plan-r2/` (gitignored, kept on the planning machine); the steps quote the repo file and line they rely on, so the notes are background only.
- **Owner-visible deviations from the spec** (behaviour or look the owner may notice, decided by following the code) are collected in Appendix A; each task's PR body repeats the rows that belong to it. Appendix B records what each task's code was verified against while the plan was written.

---

### Task 1: Field-scale routes for every Round 2 screen + `baseline-r2`

**Why:** The Round 1 tool measures 28 screens (appendix ก + the AddressForm hosts). Round 2 converts fields on ~30 more screens, and 3 of the 9 `ADDRESS_FORM_HOSTS` never show the address fields at their open step (plan-notes line 14, facts-address §6): `company-entity-edit` opens `EditCompanyDialog`, whose ที่อยู่ is a `<textarea>` (the AddressForm host is `AddCompanyDialog` = route `company-entity-create`); `customer-create-dialog` leaves the address `<details>` closed; `trade-in-quick-buy` stops on step 1 while the address is on step 3. Without routes that leave each converted field on screen, the compare of Tasks 5–15 cannot see them. This task:

1. adds 31 `r2-<screen>` routes (table above), every list they show mocked so two runs — and runs after a preview restart, which re-seeds random ids — measure the same options;
2. fixes `ADDRESS_FORM_HOSTS` (`company-entity-create`, `r2-customer-create-address`, `r2-trade-in-quick-buy-address` replace the three wrong ids — the Round 1 routes themselves are not renamed or changed, so Round 1 reports stay comparable);
3. adds three small tool capabilities the routes need, each unit-tested: `quoteMock` (a POST that only prices a quote — QuickBuyModal step 2 cannot be passed without it), `blockWrites` (an inbox room POSTs `/read` and `/suggest` just by being open — those are aborted and listed instead of writing to the preview), and probes with `menu: 'controls'` (the menu is the element the trigger's `aria-controls` names — works for Radix Popover/Select today and the header's `Combobox` after conversion);
4. adds a menu probe on every Round 2 trigger that is a portalled Radix menu today — GL account, petty-cash account, booking customer, inbox owner, prospect owner, quick-buy model, profile extension; located by role + name (or `#quick-buy-model`) the converting task keeps — moves the two Round 1 account probes to `controls`, and defines in `PENDING_PROBES` the five probes whose trigger is a native `<select>` today (expense filter / line / recurring-bill account, stock-alert model, PO accessory model — the converting Task 12 / 13 attaches them: a probe on a native `<select>` fails "menu not found", and a MENU failure blocks every compare even when it matches the baseline, `lib.mjs compareRuns`);
5. pins (characterization, no code change) that `collect.js` already measures a `button[role=combobox]` as a field of kind `combobox` named by its `<label for>` — the header Combobox's trigger shape — and never records the value it shows (`collect.js:701` FIELD_SELECTOR includes `button[role=combobox]`, `:863` kind `combobox`, `:899-910` name from `labels[0]`; the existing tests cover `aria-label` and `aria-labelledby` only, `collect-fields.test.mjs:138,278`);
6. records `baseline-r2` (main's UI after Round 1, on the new branch before any UI change) and proves it repeatable (`baseline-r2-det`). No re-record procedure is needed (main = current UI; `.superpowers/sdd/baseline-rerecord-report.md` does not apply).

**Files:**
- Modify: `tools/field-scale/routes.mjs` — header comment (:1-9), `mock` (:24), `ACCOUNT_MENU_ITEMS_CARD` / `ACCOUNT_MENU_OVERRIDE_JV` (:197-207), `ADDRESS_FORM_HOSTS` (:209-212, + `QUICK_BUY_MODEL_MENU` before it), `export const ROUTES = [` (:214 → `const R1_ROUTES = [`), the `trade-in-quick-buy` route's open step end (:247-249, + its probe), append the Round 2 block after the closing `];` (:294)
- Modify: `tools/field-scale/lib.mjs` — add `routeRequest` after `cellId` (:77)
- Modify: `tools/field-scale/check.mjs` — header (:4-5, :15), import list (:22-35), `previewContext` (:69), `installNetwork` (:73-97), `runMenuProbe` (:99-112), `measureCell` cell init (:127-130)
- Modify: `tools/field-scale/menu-clip.mjs` — header (:3-7), `readMenuGeometry` head (:11-17)
- Test: `tools/field-scale/check.test.mjs` — imports (:5-21), probe test (:314-328) replaced, 8 tests added
- Test: `tools/typography-audit/collect-fields.test.mjs` — 1 test added after the label test (:275-293)
- No change: `tools/typography-audit/collect.js` (already measures `button[role=combobox]`, pinned by the new test), `tools/field-scale/allow.json`, `tools/field-scale/coa.mjs`.

**Interfaces:**
- Consumes: the preview's `GET /api/admin/preview/info` field `chatWorkRooms.SHOP` (already read by `menu-clip-components.mjs:97`); `window.__collectFields` (collect.js); `evaluateFields` (rules.mjs); every existing export of `routes.mjs` / `lib.mjs` / `menu-clip.mjs`.
- Produces (later tasks may use):
  - `routes.mjs`: `R2_ROUTES` (the 31 routes), `ROUTES = [...R1_ROUTES, ...R2_ROUTES]`, `PENDING_PROBES` (route id → probes a later task attaches), `quoteMock(path, json)` (POST mock, path must end in `/preview`), route field `blockWrites?: true`, probe field `menu?: 'controls'`, `ADDRESS_FORM_HOSTS` (fixed list), ctx field `shopRoomId`.
  - `lib.mjs`: `routeRequest(route, mocks, method, path) → { action: 'mock', mock } | { action: 'block' } | { action: 'pass' }`.
  - `menu-clip.mjs`: `readMenuGeometry(target: string | Element)` (string = search-box aria-label as before; element = trigger whose `aria-controls` names the menu).
  - results.json cells gain `blockedWrites: string[]` (`"POST /staff-chat/rooms/<id>/read"` …).
  - `.tmp/field-scale/baseline-r2/` (results.json, report.md, pr-summary.md, PNGs) and `.tmp/field-scale/baseline-r2-det/` — the baseline every Round 2 task compares against.

**Routes Task 1 defines** (later tasks measure with these ids)

Task 1 defines these 31 `r2-<screen>` routes; Round 1's 28 route ids stay exactly as they are (same order, same steps; only the two account probes change mode, above, and `trade-in-quick-buy` gains the probe `quick-buy-model-menu`). A later task that converts a field on one of these screens measures with these ids. **Locators a later task must keep (or update the route in the same task):**

| Route id | Screen (path) | Converted fields on screen | Task(s) | Locators the route depends on |
|---|---|---|---|---|
| `r2-customer-create-address` | `/customers` → "+ เพิ่มลูกค้าใหม่" → open `<details>` ที่อยู่ + ข้อมูลที่ทำงาน | 3 AddressForms (id-card, current, work) | 5, 6 | dialog name `เพิ่มลูกค้าใหม่`; `summary` texts `ที่อยู่`, `ข้อมูลที่ทำงาน` |
| `r2-trade-in-quick-buy-address` | `/trade-in` → "รับซื้อเครื่อง" → step 1 → 2 → 3 | AddressForm "ที่อยู่ตามบัตร", seller `ContactCombobox`; (model field on step 1) | 6, 9, 12 | `#quick-buy-model:not([disabled])` + click `#quick-buy-model` then `option` `iPhone 15`; `#quick-buy-storage` + option `128GB`; `#quick-buy-imei`, `#quick-buy-serial`; text `ไม่มีรอย`; button `ถัดไป`; text `ที่อยู่ตามบัตร` |
| `r2-supplier-edit` | `/suppliers` (one mocked supplier whose address is the AddressForm JSON) → "แก้ไข …" | SupplierForm in **edit** mode: AddressForm with every picker filled, อำเภอ / ตำบล enabled (`supplier-form` is the create mode) | 6 | button `/^แก้ไข /`; dialog `แก้ไขผู้จัดจำหน่าย` |
| `r2-general-ledger` | `/finance/general-ledger` | GL account picker | 8 | probe `account-menu-gl`: first `#main button[role=combobox]` (the account picker must stay the first `button[role=combobox]` in `#main`; CompanyFilter is a native select) |
| `r2-account-role-dialog` | `/settings/access/account-roles` → "แก้ไข …" (menu closed) | AccountRoles picker | 8 | button `/^แก้ไข /`, the dialog |
| `r2-other-income-adjustment` | `/other-income/new` + received 100 → "เพิ่มผลต่างที่เหลือ …" | AdjustmentTable's `AccountSearchDropdown` | 7 | label `/^จำนวนเงินที่ได้รับจริง/`; button `/^เพิ่มผลต่างที่เหลือ/`; textbox `หมายเหตุผลต่างรายการ 1` |
| `r2-petty-cash-lines` | `/expenses/new` → doc type "เงินสดย่อย" | PettyCash `AccountSearchDropdown`, `VendorCombobox` | 7, 9 | button `/^เงินสดย่อย/`; probe `account-menu-petty-cash`: `dialog` → first combobox `บัญชี` (exact) |
| `r2-expenses-list` | `/expenses` | "ประเภทค่าใช้จ่าย" filter | 13 | pending probe `account-menu-expense-filter`: combobox `ประเภทค่าใช้จ่าย` |
| `r2-credit-note-lines` | `/expenses/new?type=CN` → "ไม่มีเอกสารต้นทาง" | ItemLinesSection "บัญชีค่าใช้จ่าย" (CN copy) | 13 | button `/^ไม่มีเอกสารต้นทาง/` |
| `r2-settlement-new` | `/expenses/new?type=SE` | SettlementLinesSection `VendorCombobox` | 9 | — |
| `r2-asset-new` | `/assets/new` | AssetEntrySection3Vendor `ContactCombobox` | 9 | — |
| `r2-after-sales-walk-in` | `/after-sales/new?imei=356000000000005` (walk-in lookup mocked) | customer `ContactCombobox`, `RepairCenterCombobox` | 9 | — |
| `r2-po-wizard-items` | `/purchase-orders` → "+ ซื้อสินค้า" (draft: mode `po`, step 0, one เคส line; waits for the "draft recovered" toast to leave) | StepSupplier `ContactCombobox`, AccessoryItemRow "สำหรับรุ่น" | 9, 12 | combobox `สำหรับรุ่น` (accessible name kept); pending probe `po-accessory-model-menu`: first combobox `สำหรับรุ่น` |
| `r2-booking-create` | `/bookings` → "สร้างใบจอง" | Bookings `CustomerCombobox` | 10 | probe: `dialog` → combobox `ลูกค้า` (exact) |
| `r2-store-appointments` | `/appointments` | StoreAppointments `CustomerCombobox` | 10 | — |
| `r2-inbox-filter` | `/inbox?zone=shop` → "ตัวกรองแชท" | ChannelFilter "ผู้ดูแล" | 11 | probe: dialog `ตัวกรองแชท` → combobox `ผู้ดูแล` (exact) |
| `r2-inbox-follow-up` | `/inbox/<SHOP room>` → (dossier sheet < 1280) → "ตั้งนัดติดตาม" | ChatFollowUpDialog "ผู้รับผิดชอบงาน" | 11 | button `ตั้งนัดติดตาม`; dialog text `ผู้รับผิดชอบงาน` |
| `r2-inbox-service-request` | same room → "บริการหลังการขาย" → "รับเรื่องหลังการขาย" | ChatServiceRequestDialog "ผู้รับผิดชอบ" (its case picker's `service-intake-options` is mocked empty) | 11 | buttons `บริการหลังการขาย`, `รับเรื่องหลังการขาย`; dialog text `ผู้รับผิดชอบ` |
| `r2-inbox-service-request-edit` | same room → "บริการหลังการขาย" → request card → "แก้ไขการติดตาม" | ChatServiceRequestCard "ผู้รับผิดชอบ" | 11 | button `แก้ไขการติดตาม` |
| `r2-inbox-facebook-comment` | `/inbox?zone=shop` → "คอมเมนต์" → the thread | FacebookCommentPanel "ผู้รับผิดชอบคอมเมนต์" | 11 | text `ผู้รับผิดชอบคอมเมนต์` |
| `r2-todos-list` | `/todos` (BRANCH_MANAGER actor) | TodoFilters "ผู้รับมอบหมาย" | 11 | — |
| `r2-collections-stuck-reassign` | `/collections` → "วิเคราะห์" → tick `CT-PREVIEW-0001` → "มอบหมายใหม่" | StuckContractsSection "เลือกผู้รับผิดชอบใหม่" | 11 | checkbox `เลือก CT-PREVIEW-0001`; button `/^มอบหมายใหม่/` |
| `r2-prospect-filters` | `/customers?view=prospects` (sheet "เปิดตัวกรอง" < 1024) | ProspectFilterBar "ผู้ดูแล" | 11 | button `เปิดตัวกรอง` (< 1024); probe `prospect-owner-menu`: combobox `ผู้ดูแล` (exact) |
| `r2-product-create` | `/products/create` → ยี่ห้อ `Apple` (enables รุ่น) | ProductInfoCard "รุ่น *", BranchSupplierCard "ผู้จัดจำหน่าย" | 12 | label `ยี่ห้อ *` (exact, a native select — not converted) |
| `r2-stock-alert-create` | `/stock/alerts` → "+ จุดสั่งซื้อซ้ำ" → แบรนด์ `Apple` (enables รุ่น) | StockAlertsPage "รุ่น" | 12 | button `+ จุดสั่งซื้อซ้ำ`; `dialog` → label `แบรนด์` (exact, native select); pending probe `stock-alert-model-menu`: `dialog` → combobox `รุ่น` (exact) |
| `r2-trade-in-questions` | `/trade-in` → radio "แบบตรวจสภาพ" (`/trade-ins/sell-config` mocked) | ReferenceQuestionnaire "รุ่นและความจุ" | 12 | radio `แบบตรวจสภาพ`; text `รุ่นและความจุ` |
| `r2-purchase-orders-list` | `/purchase-orders` | POListTab "ผู้จัดจำหน่าย" filter | 12 | — |
| `r2-chat-analytics` | `/chat-analytics` | "พนักงาน" | 14 | — |
| `r2-sales-history` | `/sales` | "พนักงานขาย" | 14 | — |
| `r2-canned-quick-reply` | `/canned-responses` → expand "ทักทาย" → "ตอบเรื่องผ่อนชำระ" | QuickReplyEditor "เมื่อกด:" | 14 | button `ขยาย`; text `ตอบเรื่องผ่อนชำระ`; text `เมื่อกด:` |
| `r2-profile-yeastar` | `/profile` | "Extension Yeastar (โทรศัพท์)" | 14 | probe `profile-extension-menu`: combobox `Extension Yeastar (โทรศัพท์)` (exact) |

Round 1 routes that already show a Round 2 field (no new route needed): `trade-in-quick-buy` (QuickBuyModal model, Task 12 — keeps `#quick-buy-model` + native `disabled`; probe `quick-buy-model-menu` clicks `#quick-buy-model`), `todo-form` (TodoForm, Task 11), `payroll-new` (`EmployeeCombobox` ×2, Task 10), `expense-new` (VendorSection `VendorCombobox` + ItemLinesSection, Tasks 9 / 13; pending probe `account-menu-expense-line`), `recurring-bill-dialog` (`VendorCombobox` `rb-vendor` + expense account, Tasks 9 / 13; pending probe `account-menu-recurring-bill`), `other-income-items` / `other-income-override` (ItemsTable / EditableJournalTable account pickers + CounterpartyPicker, Tasks 7 / 9; the "ใช้แม่แบบ" button, Task 15), `account-role-edit` (opens the AccountRoles menu via `#ar-coa-trigger` — Task 8 keeps that id on the trigger or updates this route), `company-entity-create`, `contract-customer-create`, `contract-customer-edit`, `customer-edit-dialog`, `supplier-form`, `branch-create`, `contact-create` (AddressForm hosts, Task 6).

**Not routed (stated so nobody assumes they are measured):** `RepairCenterCombobox` inside `SendRepairDialog` (`after-sales/RepairActionDialogs.tsx:85`) and `SwitchToRepairDialog` (`after-sales/ExchangeActionDialogs.tsx:476`) — both need an after-sales case detail (`GET /after-sales/:id`, a large shape) in a stage that offers "ส่งซ่อม"; the same component with the same props is measured on `r2-after-sales-walk-in`, and Task 9's unit tests cover the dialogs.

- [ ] **Step 1: Branch from main**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
git status --short            # must not list tracked changes
git switch -c feat/dropdown-search-round2 origin/main
git log --oneline -1          # 6e79e6eb4 รอบ 1 สเกลช่องกรอก: … (#1780), or a later main commit
grep -rln "AccountSearchDropdown" apps/web/src --include=*.tsx
```

Record the grep in the Task 1 report (header: the PEAK-layout dependency). On `6e79e6eb4` it lists `pages/other-income/components/{AccountSearchDropdown,ItemsTable,EditableJournalTable,AdjustmentTable}.tsx`, `pages/other-income/components/__tests__/{AccountSearchDropdown,ItemsTable.fields}.test.tsx` and `components/expense-form-v4/PettyCashLinesSection.tsx`; once the PEAK-layout work is on main it also lists `components/expense-form-v4/ItemLinesSection.tsx` and `components/expense-form-v4/__tests__/ExpenseFormV4.{page,payloads}.test.tsx`. Without `ItemLinesSection.tsx` in the list, Tasks 7, 8 and 13 wait; everything else goes ahead.

(`origin/main` is the Round 1 squash commit; local `main` may be older — `git diff --stat origin/main feat/field-scale-round1` is empty, verified 2026-11-16.)

- [ ] **Step 2: Pin the collector on the Round 2 trigger shape (characterization — passes before any change)**

In `tools/typography-audit/collect-fields.test.mjs`, replace

```js
  assert.equal(byKey(facts, 'input|ที่อยู่|0').label.above, false, 'a wrapping label is not above');
  assert.equal(byKey(facts, 'input|ป้ายซ่อน|0').label, null);
});
```

with

```js
  assert.equal(byKey(facts, 'input|ที่อยู่|0').label.above, false, 'a wrapping label is not above');
  assert.equal(byKey(facts, 'input|ป้ายซ่อน|0').label, null);
});

// Round 2 Combobox trigger (plan header DOM contract): a raw button[role=combobox] named by its <label for>,
// showing the picked value as text. F1 must see it as kind 'combobox' with the label's words as its name.
test('a Combobox trigger is a combobox field named by its <label for>, never by the value it shows', async () => {
  const facts = await collect(`
    <div style="display:grid;grid-template-columns:200px 200px;gap:16px">
      <div><label for="cb" class="lab">ผู้รับผิดชอบ</label><button type="button" role="combobox" id="cb" aria-haspopup="listbox" aria-expanded="false" data-slot="combobox-trigger" class="f" style="display:flex;align-items:center;justify-content:space-between"><span>นายสมชาย ใจดีลับ</span><svg width="16" height="16" aria-hidden="true"></svg></button></div>
      <div><label for="in" class="lab">เบอร์โทร</label><input id="in" class="f" style="height:40px"></div>
    </div>`);
  const trigger = byKey(facts, 'combobox|ผู้รับผิดชอบ|0');
  assert.deepEqual([trigger.kind, trigger.tag], ['combobox', 'button']);
  assert.deepEqual(trigger.label, { fontSize: 14, gap: 12, above: true });
  assert.equal(trigger.h, 44);
  assert.equal(trigger.placeholderInkWidth, null, 'a button has no placeholder attribute');
  assert.ok(!JSON.stringify(facts).includes('สมชาย'), 'the shown value never leaves the page');
  const f1 = evaluateFields(facts, CTX).filter((f) => f.rule === 'F1').map((f) => f.key);
  assert.deepEqual(
    f1.filter((k) => k.startsWith('height@')),
    ['height@combobox|ผู้รับผิดชอบ|0', 'height@input|เบอร์โทร|0'],
    'one F1 row with the input next to it',
  );
  const target = facts.filter((f) => f.type === 'target' && f.role === 'combobox');
  assert.deepEqual(target.map((t) => t.key), ['target-combobox||0'], 'a combobox target is named by aria-label only');
});
```

Run: `node --test tools/typography-audit/collect-fields.test.mjs`
Expected: `ℹ tests 20` · `ℹ pass 20` · `ℹ fail 0` (the new test passes on the unchanged `collect.js` — this is the "check that collect.js measures `button[role=combobox]` for F1" item: it does, so no collector change).

- [ ] **Step 3: Write the failing tool tests**

In `tools/field-scale/check.test.mjs`:

(a) replace the import block

```js
  renderReport,
  screenProblem,
  selectRoutes,
  summarize,
} from './lib.mjs';
import { ACCOUNT_CODE_RE, coaByCodes, coaGrouped, coaList, loadCoa, parseCsvLine } from './coa.mjs';
import { menuClipVerdict } from './menu-clip.mjs';
import { ADDRESS_FORM_HOSTS, COMMON_MOCKS, ROUTES } from './routes.mjs';
```

with

```js
  renderReport,
  routeRequest,
  screenProblem,
  selectRoutes,
  summarize,
} from './lib.mjs';
import { chromium } from '@playwright/test';
import { ACCOUNT_CODE_RE, coaByCodes, coaGrouped, coaList, loadCoa, parseCsvLine } from './coa.mjs';
import { menuClipVerdict, readMenuGeometry } from './menu-clip.mjs';
import { ADDRESS_FORM_HOSTS, COMMON_MOCKS, PENDING_PROBES, R2_ROUTES, ROUTES } from './routes.mjs';
```

(b) replace the whole test (currently :314-328)

```js
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
```

with

```js
test('routes: cover appendix ก, the 9 AddressForm hosts and every menu probe', () => {
  const appendix = new Set(ROUTES.flatMap((r) => r.appendix));
  for (const code of ['S1-01', 'S1-02', 'S1-03', 'S1-04', 'S1-05', 'S1-06', 'S2-01', 'S2-02', 'S2-03', 'S2-04', 'S2-05',
    'S2-07', 'S2-08', 'S3-02', 'S3-03', 'S3-04', 'S3-05', 'S3-07', 'S3-09', 'S3-10', 'S3-12']) {
    assert.ok(appendix.has(code), code);
  }
  const ids = new Set(ROUTES.map((r) => r.id));
  assert.equal(ADDRESS_FORM_HOSTS.length, 9);
  for (const id of ADDRESS_FORM_HOSTS) assert.ok(ids.has(id), id);
  const probes = ROUTES.flatMap((r) => (r.probes ?? []).map((p) => [r.id, p.id, p.widths, p.menu ?? 'search-label']));
  assert.deepEqual(probes, [
    ['other-income-items', 'account-menu-items-card', [1440], 'controls'],
    ['other-income-override', 'account-menu-override-jv', [1440], 'controls'],
    ['trade-in-quick-buy', 'quick-buy-model-menu', [1440, 390], 'controls'],
    ['r2-general-ledger', 'account-menu-gl', [1440, 390], 'controls'],
    ['r2-petty-cash-lines', 'account-menu-petty-cash', [1440, 390], 'controls'],
    ['r2-booking-create', 'booking-customer-menu', [1440, 390], 'controls'],
    ['r2-inbox-filter', 'inbox-owner-menu', [1440, 390], 'controls'],
    ['r2-prospect-filters', 'prospect-owner-menu', [1440, 390], 'controls'],
    ['r2-profile-yeastar', 'profile-extension-menu', [1440, 390], 'controls'],
  ]);
});

// A probe on a native <select> fails today (no aria-controls) and a MENU failure blocks every compare — so it waits
// in PENDING_PROBES until the task that converts the field attaches it to the route and deletes the entry.
test('routes: pending probes name an existing route and are not attached yet', () => {
  const byId = new Map(ROUTES.map((r) => [r.id, r]));
  const attached = new Set(ROUTES.flatMap((r) => (r.probes ?? []).map((p) => p.id)));
  const pending = Object.entries(PENDING_PROBES).flatMap(([id, probes]) => probes.map((p) => [id, p.id, p.widths, p.menu]));
  assert.deepEqual(pending, [
    ['r2-expenses-list', 'account-menu-expense-filter', [1440], 'controls'],
    ['expense-new', 'account-menu-expense-line', [1440], 'controls'],
    ['recurring-bill-dialog', 'account-menu-recurring-bill', [1440], 'controls'],
    ['r2-stock-alert-create', 'stock-alert-model-menu', [1440, 390], 'controls'],
    ['r2-po-wizard-items', 'po-accessory-model-menu', [1440, 390], 'controls'],
  ]);
  for (const [id, probeId] of pending) {
    assert.ok(byId.has(id), id);
    assert.ok(!attached.has(probeId), `${probeId} is attached — delete it from PENDING_PROBES`);
  }
});

// Round 1 reports stay comparable: every Round 1 id is still there, in the same order, before the r2- routes.
const ROUND1_IDS = [
  'dunning-rule-dialog', 'sms-template-form', 'other-income-items', 'other-income-override', 'company-entity-edit',
  'company-entity-create', 'audit-logs', 'finance-knowledge-form', 'repossessions', 'stock-transfers-outgoing',
  'stock-transfers-incoming', 'stock-transfers-history', 'expense-new', 'payroll-new', 'recurring-bill-dialog',
  'trade-in-quick-buy', 'interest-config-form', 'branch-create', 'todo-form', 'purchase-order-wizard',
  'account-role-edit', 'customer-create-dialog', 'customer-edit-dialog', 'contract-customer-create',
  'contract-customer-edit', 'supplier-form', 'pos-sale-form', 'contact-create',
];

test('routes: Round 1 ids unchanged; Round 2 routes are r2-<screen>', () => {
  assert.deepEqual(ROUTES.slice(0, ROUND1_IDS.length).map((r) => r.id), ROUND1_IDS);
  assert.deepEqual(ROUTES.slice(ROUND1_IDS.length), R2_ROUTES);
  for (const r of R2_ROUTES) {
    assert.match(r.id, /^r2-[a-z0-9-]+$/, r.id);
    assert.ok(r.appendix.length > 0 && r.appendix.every((a) => /^R2-(2|3a|3b|4a|4b|4c|4d) /.test(a)), r.id);
  }
});

test('routes: the AddressForm hosts are the routes that leave the address fields on screen', () => {
  assert.deepEqual(ADDRESS_FORM_HOSTS, [
    'company-entity-create', 'r2-customer-create-address', 'contract-customer-create', 'contract-customer-edit',
    'customer-edit-dialog', 'supplier-form', 'r2-trade-in-quick-buy-address', 'branch-create', 'contact-create',
  ]);
  for (const notAHost of ['company-entity-edit', 'customer-create-dialog', 'trade-in-quick-buy']) {
    assert.ok(!ADDRESS_FORM_HOSTS.includes(notAHost), `${notAHost} leaves the address off screen`);
  }
});

// Every screen Round 2 Tasks 5–15 convert (plan header table; appendix ค; facts-comboboxes consumers).
const R2_SCREENS = {
  'R2-2 AddressForm': ['r2-customer-create-address', 'r2-trade-in-quick-buy-address', 'r2-supplier-edit'],
  'R2-3a GL': ['r2-general-ledger'],
  'R2-3a AccountRoles': ['r2-account-role-dialog'],
  'R2-3a AdjustmentTable': ['r2-other-income-adjustment'],
  'R2-3a PettyCash': ['r2-petty-cash-lines'],
  'R2-4c ExpensesPage': ['r2-expenses-list'],
  'R2-4c ItemLinesSection': ['r2-credit-note-lines'],
  'R2-3b VendorCombobox': ['r2-petty-cash-lines', 'r2-settlement-new'],
  'R2-3b ContactCombobox': ['r2-trade-in-quick-buy-address', 'r2-asset-new', 'r2-after-sales-walk-in', 'r2-po-wizard-items'],
  'R2-3b CustomerCombobox': ['r2-booking-create', 'r2-store-appointments'],
  'R2-4a ChannelFilter': ['r2-inbox-filter'],
  'R2-4a ChatFollowUpDialog': ['r2-inbox-follow-up'],
  'R2-4a ChatServiceRequestDialog': ['r2-inbox-service-request'],
  'R2-4a ChatServiceRequestCard': ['r2-inbox-service-request-edit'],
  'R2-4a FacebookCommentPanel': ['r2-inbox-facebook-comment'],
  'R2-4a TodoFilters': ['r2-todos-list'],
  'R2-4a StuckContractsSection': ['r2-collections-stuck-reassign'],
  'R2-4a ProspectFilterBar': ['r2-prospect-filters'],
  'R2-4b ProductInfoCard': ['r2-product-create'],
  'R2-4b BranchSupplierCard': ['r2-product-create'],
  'R2-4b StockAlertsPage': ['r2-stock-alert-create'],
  'R2-4b AccessoryItemRow': ['r2-po-wizard-items'],
  'R2-4b ReferenceQuestionnaire': ['r2-trade-in-questions'],
  'R2-4b POListTab': ['r2-purchase-orders-list'],
  'R2-4d ChatAnalyticsPage': ['r2-chat-analytics'],
  'R2-4d SalesHistoryPage': ['r2-sales-history'],
  'R2-4d QuickReplyEditor': ['r2-canned-quick-reply'],
  'R2-4d UserProfilePage': ['r2-profile-yeastar'],
};

test('routes: one Round 2 route per converted screen, tagged with it', () => {
  const byId = new Map(R2_ROUTES.map((r) => [r.id, r]));
  for (const [tag, ids] of Object.entries(R2_SCREENS)) {
    for (const id of ids) assert.ok(byId.get(id)?.appendix.includes(tag), `${tag} → ${id}`);
  }
  const tagged = new Set(Object.values(R2_SCREENS).flat());
  assert.deepEqual(R2_ROUTES.map((r) => r.id).filter((id) => !tagged.has(id)), [], 'no untagged r2 route');
});

test('routes: a mock answers GET, or POST only for a /preview quote; only inbox-room routes block writes', async () => {
  for (const r of ROUTES) {
    for (const m of [...COMMON_MOCKS, ...r.mocks]) {
      assert.ok(m.method === undefined || (m.method === 'POST' && /\\\/preview\$$/.test(m.path.source)),
        `${r.id}: ${m.method} ${m.path}`);
    }
    assert.ok(r.blockWrites === undefined || r.blockWrites === true, r.id);
  }
  assert.deepEqual(ROUTES.filter((r) => r.blockWrites).map((r) => r.id),
    ['r2-inbox-follow-up', 'r2-inbox-service-request', 'r2-inbox-service-request-edit']);
  const room = ROUTES.find((r) => r.id === 'r2-inbox-follow-up');
  assert.equal(await room.path({ shopRoomId: null }), null, 'no synthetic room → cell skipped');
  assert.equal(await room.path({ shopRoomId: 'room-1' }), '/inbox/room-1?zone=shop');
});

test('routeRequest: mocks by method + path, blocks writes only on blockWrites routes, else passes', () => {
  const get = { path: /^\/a$/, json: () => 'get' };
  const quote = { path: /^\/a\/preview$/, json: () => 'quote', method: 'POST' };
  const mocks = [get, quote];
  assert.deepEqual(routeRequest({}, mocks, 'GET', '/a'), { action: 'mock', mock: get });
  assert.deepEqual(routeRequest({}, mocks, 'POST', '/a/preview'), { action: 'mock', mock: quote });
  assert.deepEqual(routeRequest({}, mocks, 'POST', '/a'), { action: 'pass' }, 'a GET mock never answers a POST');
  assert.deepEqual(routeRequest({}, mocks, 'GET', '/a/preview'), { action: 'pass' }, 'a POST mock never answers a GET');
  assert.deepEqual(routeRequest({ blockWrites: true }, mocks, 'POST', '/rooms/1/read'), { action: 'block' });
  assert.deepEqual(routeRequest({ blockWrites: true }, mocks, 'PATCH', '/x'), { action: 'block' });
  assert.deepEqual(routeRequest({ blockWrites: true }, mocks, 'GET', '/x'), { action: 'pass' });
  assert.deepEqual(routeRequest({ blockWrites: true }, mocks, 'POST', '/a/preview'), { action: 'mock', mock: quote });
});

test('routes: Round 2 mocks — fixed staff/ids (preview ids change per start), room-bound service request', async () => {
  const byId = new Map(R2_ROUTES.map((r) => [r.id, r]));
  const find = (id, path) => byId.get(id).mocks.find((m) => m.path.test(path));
  const ctx = { shopRoomId: 'room-1' };
  const list = await find('r2-inbox-service-request-edit', '/staff-chat/rooms/room-1/service-requests').json(null, ctx);
  assert.equal(list.total, 1);
  assert.equal(list.data[0].roomId, 'room-1');
  assert.equal(list.data[0].todo.status, 'TODO', 'an active request shows "แก้ไขการติดตาม"');
  const detail = await find('r2-inbox-service-request-edit', `/staff-chat/service-requests/${list.data[0].id}`).json(null, ctx);
  assert.deepEqual(detail, list.data[0]);
  const staff = await find('r2-inbox-follow-up', '/staff-chat/rooms/room-1/eligible-staff').json();
  assert.ok(staff.length >= 2 && staff.every((s) => s.id.startsWith('preview-staff-') && s.detail));
  const options = await find('r2-chat-analytics', '/chat-analytics/v2/filter-options').json();
  assert.ok(options.staff.every((s) => s.id.startsWith('preview-staff-')));
  const quote = byId.get('r2-trade-in-quick-buy-address').mocks.find((m) => m.method === 'POST');
  const q = await quote.json();
  assert.ok(q.available && q.previewToken && q.grade && Number(q.cashPrice) > 0, 'priceReady (QuickBuyModal.tsx:274-280)');
  const walkIn = await find('r2-after-sales-walk-in', '/after-sales/lookup').json();
  assert.equal(walkIn.found, false, 'walk-in → the customer picker is shown');
  assert.ok(walkIn.outcomes.some((o) => o.outcome === 'REPAIR' && o.enabled && o.implemented), 'REPAIR → the repair centre picker');
  const summary = await find('r2-booking-create', '/bookings/summary').json();
  assert.ok(summary.total > 0, 'not the first-use empty state, so the header button "สร้างใบจอง" is shown');
  const suppliers = await find('r2-supplier-edit', '/suppliers').json();
  assert.equal(suppliers.data.length, 1);
  const address = JSON.parse(suppliers.data[0].address);
  assert.ok(address.province && address.district && address.subdistrict && address.postalCode,
    'deserializeAddress (AddressForm.tsx:67-88) fills every picker, so อำเภอ / ตำบล are enabled');
});

// readMenuGeometry runs in a real page (Playwright serialises it), so it is checked in Chromium.
test('readMenuGeometry: a trigger finds its menu through aria-controls; the search-label path is unchanged', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    await page.setContent(`<!doctype html><body style="margin:0">
      <button id="t" aria-controls="m">open</button>
      <button id="t2" aria-controls="missing">open</button>
      <button id="t3">no menu</button>
      <div style="position:fixed;left:250px;top:40px"><div id="m" style="width:200px;height:120px">
        <input aria-label="ค้นหารหัส หรือ ชื่อบัญชี"></div></div>
      <div style="position:relative;overflow:hidden;width:100px;height:50px">
        <div style="position:absolute;top:10px;left:10px;width:300px;height:80px"><input aria-label="clipped"></div></div>
    </body>`);
    const fromTrigger = await page.locator('#t').evaluate(readMenuGeometry);
    assert.equal(fromTrigger.found, true);
    assert.equal(fromTrigger.position, 'fixed');
    assert.deepEqual(fromTrigger.menu, { top: 40, left: 250, bottom: 160, right: 450 });
    assert.match(menuClipVerdict(fromTrigger).reasons[0], /ล้นจอ 400×300/, 'runs past the right edge');
    assert.deepEqual(await page.locator('#t2').evaluate(readMenuGeometry), { found: false });
    assert.deepEqual(await page.locator('#t3').evaluate(readMenuGeometry), { found: false });
    const fromLabel = await page.evaluate(readMenuGeometry, 'ค้นหารหัส หรือ ชื่อบัญชี');
    assert.deepEqual(fromLabel.menu, fromTrigger.menu, 'same panel either way');
    const clipped = await page.evaluate(readMenuGeometry, 'clipped');
    assert.equal(clipped.position, 'absolute');
    assert.match(menuClipVerdict(clipped).reasons.join(' '), /ถูกตัดโดย <div/);
  } finally {
    await browser.close();
  }
});
```

Run: `node --test tools/field-scale/check.test.mjs`
Expected: the file fails to load — `SyntaxError: The requested module './routes.mjs' does not provide an export named 'R2_ROUTES'` (Node may name `routeRequest` from `./lib.mjs` first) · `ℹ pass 0` · `ℹ fail 1`.

- [ ] **Step 4: `routeRequest` in `lib.mjs`**

In `tools/field-scale/lib.mjs`, replace

```js
export const cellId = (c) => `${c.route}|${c.width}|${c.theme}`;
```

with

```js
export const cellId = (c) => `${c.route}|${c.width}|${c.theme}`;

// How a route's network rule answers one /api request (path WITHOUT /api or /api/admin): the first mock
// whose method (default GET) and path match → 'mock'; else a non-GET on a blockWrites route → 'block'
// (aborted, listed in the cell as blockedWrites); else 'pass' to the preview.
export function routeRequest(route, mocks, method, path) {
  const mock = mocks.find((m) => (m.method ?? 'GET') === method && m.path.test(path));
  if (mock) return { action: 'mock', mock };
  if (route.blockWrites && method !== 'GET') return { action: 'block' };
  return { action: 'pass' };
}
```

- [ ] **Step 5: `readMenuGeometry` takes a trigger too (`menu-clip.mjs`)**

Replace

```js
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
```

with

```js
// readMenuGeometry runs INSIDE the page (Playwright serialises its source — no imports, no outer
// variables). Its argument says where the open menu is: a string = the aria-label of the menu's search
// box (the Round 1 account menu: the visible box with that name); an element = the trigger
// (Locator.evaluate passes it), whose aria-controls names the menu — Radix Popover / Select triggers and
// the Round 2 Combobox always carry it. It walks up from there to the menu panel (first absolutely/fixed
// positioned ancestor — the old absolute dropdown, or Radix's fixed popper wrapper), then lists every
// overflow-clipping ancestor at or above the panel's containing block. menuClipVerdict is the pure
// decision (both tested in check.test.mjs).

export const MENU_TOLERANCE_PX = 1;

export function readMenuGeometry(target) {
  let start = null;
  if (typeof target === 'string') {
    const inputs = Array.from(document.querySelectorAll('input')).filter(
      (el) => el.getAttribute('aria-label') === target && el.checkVisibility(),
    );
    const input = inputs[inputs.length - 1];
    if (!input) return { found: false };
    start = input.parentElement;
  } else {
    const id = target && typeof target.getAttribute === 'function' ? target.getAttribute('aria-controls') : null;
    const menu = id ? document.getElementById(id) : null;
    if (!menu || !menu.checkVisibility()) return { found: false };
    start = menu;
  }
  let panel = start;
```

(The rest of the function — the `while (panel …)` walk and the clipper list — is unchanged.)

- [ ] **Step 6: `check.mjs` — room id in ctx, network rule, controls probes, `blockedWrites`**

Six edits in `tools/field-scale/check.mjs`.

(a) header — replace

```js
// this checkout's local preview, at each width × theme. On the other-income screens it also opens the
// account menu and records whether it is clipped (S2-01 / S2-02 → rule MENU, P1).
```

with

```js
// this checkout's local preview, at each width × theme. On the screens with probes it also opens a menu
// and records whether it is clipped (the account menu S2-01 / S2-02, Round 2's GL / booking / inbox
// menus → rule MENU, P1).
```

and replace

```js
// restarts it. Read-only: mocks answer GETs; open steps never save.
```

with

```js
// restarts it. Read-only: mocks answer GETs (and quote-only POSTs); open steps never save; a route with
// blockWrites aborts every other non-GET request (results.json lists them per cell as blockedWrites).
```

(b) import — replace

```js
  renderReport,
  screenProblem,
  selectRoutes,
  summarize,
} from './lib.mjs';
```

with

```js
  renderReport,
  routeRequest,
  screenProblem,
  selectRoutes,
  summarize,
} from './lib.mjs';
```

(c) `previewContext` — replace

```js
    contractPath: info?.documentUrl ? new URL(info.documentUrl).pathname : null,
  };
}
```

with

```js
    contractPath: info?.documentUrl ? new URL(info.documentUrl).pathname : null,
    // the synthetic SHOP chat room (same one menu-clip-components.mjs opens) — the Round 2 inbox routes
    shopRoomId: info?.chatWorkRooms?.SHOP ?? null,
  };
}
```

(d) `installNetwork` — replace

```js
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
```

with

```js
  const mocks = [...COMMON_MOCKS, ...route.mocks];
  const mocked = new Set();
  const blocked = new Set();
  const errors = new Map();
  await page.routeWebSocket('**/socket.io/**', (socket) => socket.close());
  await page.route((url) => url.pathname.startsWith('/api/'), async (r) => {
    const request = r.request();
    const url = new URL(request.url());
    const path = apiPathOf(url);
    const decision = routeRequest(route, mocks, request.method(), path);
    if (decision.action === 'mock') {
      mocked.add(path);
      return r.fulfill({ json: await decision.mock.json(url, ctx) });
    }
    if (decision.action === 'block') {
      blocked.add(`${request.method()} ${path}`);
      return r.abort();
    }
    return r.fallback();
  });
```

and replace

```js
  return () => {
    cell.mocked = [...mocked].sort();
    cell.apiErrors = [...errors.values()];
  };
```

with

```js
  return () => {
    cell.mocked = [...mocked].sort();
    cell.blockedWrites = [...blocked].sort();
    cell.apiErrors = [...errors.values()];
  };
```

(e) `runMenuProbe` — replace

```js
    const trigger = probe.trigger(page);
    await trigger.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await trigger.click();
    await page.waitForTimeout(300);
    const geometry = await page.evaluate(readMenuGeometry, MENU_SEARCH_LABEL);
```

with

```js
    const trigger = probe.trigger(page);
    await trigger.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    // Held before the click: a modal Radix menu (Select) hides everything else from the accessibility
    // tree once open, so a role-based locator no longer finds its own trigger.
    const handle = await trigger.elementHandle();
    await trigger.click();
    await page.waitForTimeout(300);
    const geometry =
      probe.menu === 'controls'
        ? await handle.evaluate(readMenuGeometry)
        : await page.evaluate(readMenuGeometry, MENU_SEARCH_LABEL);
```

(The element handle is needed: on the preview the `inbox-owner-menu` probe timed out on `locator.evaluate` after the click — the open Radix Select set `aria-hidden` on the dialog behind it, so `getByRole('combobox', { name: 'ผู้ดูแล' })` no longer matched.)

(f) `measureCell` — replace

```js
    factCount: 0, screenshot: null, mocked: [], apiErrors: [], findings: [], probes: [],
```

with

```js
    factCount: 0, screenshot: null, mocked: [], blockedWrites: [], apiErrors: [], findings: [], probes: [],
```

- [ ] **Step 7: `routes.mjs` — fix the address hosts, add the Round 2 routes**

Six edits in `tools/field-scale/routes.mjs`.

(a) header — replace

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
```

with

```js
// Field-scale check — what to measure (spec §5 "หน้าที่วัด"): every screen in appendix ก plus the 9 forms
// that embed AddressForm (spec §4.3), as { id, path, appendix, open?, mocks, probes?, blockWrites? }; Round 2
// adds R2_ROUTES (ids r2-<screen>) for every screen the Round 2 plan converts.
//   path      string, or (ctx) => string | null (null = the preview has no sample record → cell "skipped")
//   open      clicks that open the dialog / tab / mode to measure — never save, never pick a value that saves
//   mocks     GET endpoints the local preview answers 501/404 for, or answers from data that varies between
//             preview starts: { path: /^\/api-path$/, json(url, ctx), method? }. path is matched against the
//             request pathname WITHOUT /api or /api/admin; route mocks after COMMON_MOCKS, first match wins.
//             GET only — except quoteMock(): a POST that prices a quote and stores nothing (path ends in /preview).
//   blockWrites  true = every other non-GET /api request the page makes is aborted and listed in the cell
//             (screens that write just by being open — an inbox room marks itself read and asks for suggestions)
//   probes    menu clipping check (rule MENU): { id, widths, trigger(page) → Locator, menu? }. menu 'controls' =
//             the menu is the element the trigger's aria-controls names (Radix Popover / Select, the Round 2
//             Combobox); default = the Round 1 account menu, found by its search box MENU_SEARCH_LABEL.
// COMMON_MOCKS apply to every route. ctx = { origin, me (GET /auth/me), customerId, contractPath, shopRoomId }.
```

(b) replace

```js
export const mock = (path, json) => ({ path, json: typeof json === 'function' ? json : () => json });
```

with

```js
export const mock = (path, json) => ({ path, json: typeof json === 'function' ? json : () => json });
// A POST that only prices a quote: the one non-GET a mock may answer (check.test.mjs pins the /preview path).
export const quoteMock = (path, json) => ({ ...mock(path, json), method: 'POST' });
```

(c) replace

```js
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
```

with

```js
// menu 'controls' (Round 2 Task 1): the menu is found through the trigger's aria-controls, not the search box's
// aria-label, so R2-3a's AccountCombobox may name its search box through cmdk's <Command label> instead.
const ACCOUNT_MENU_ITEMS_CARD = {
  id: 'account-menu-items-card',
  widths: [1440],
  menu: 'controls',
  // item #1 defaults to 42-1102 — the trigger shows its name (role-agnostic: R1-2 may add role=combobox)
  trigger: (page) => page.locator('button', { hasText: 'ดอกเบี้ยเงินฝาก' }).first(),
};
const ACCOUNT_MENU_OVERRIDE_JV = {
  id: 'account-menu-override-jv',
  widths: [1440],
  menu: 'controls',
  trigger: (page) => journalTable(page).locator('tbody tr').first().locator('td').first().locator('button').first(),
};
```

(d) add the quick-buy model probe and fix the hosts — replace

```js
export const ADDRESS_FORM_HOSTS = [
  'company-entity-edit', 'customer-create-dialog', 'contract-customer-create', 'contract-customer-edit',
  'customer-edit-dialog', 'supplier-form', 'trade-in-quick-buy', 'branch-create', 'contact-create',
];

export const ROUTES = [
```

with

```js
// Round 2 (Task 1): a portalled Radix Select inside QuickBuyModal (a Radix Dialog); R2-4b keeps id="quick-buy-model"
// (the route's open step waits for it)
const QUICK_BUY_MODEL_MENU = {
  id: 'quick-buy-model-menu', widths: [1440, 390], menu: 'controls',
  trigger: (page) => page.locator('#quick-buy-model'),
};

// The route of each of the 9 AddressForm hosts (spec §4.3) whose open step leaves the address fields on screen.
// Not 'company-entity-edit' (EditCompanyDialog's ที่อยู่ is a textarea — AddCompanyDialog is the host), not
// 'customer-create-dialog' (the address <details> stays closed) and not 'trade-in-quick-buy' (step 1 — the
// address is on step 3): the r2- routes below open those.
export const ADDRESS_FORM_HOSTS = [
  'company-entity-create', 'r2-customer-create-address', 'contract-customer-create', 'contract-customer-edit',
  'customer-edit-dialog', 'supplier-form', 'r2-trade-in-quick-buy-address', 'branch-create', 'contact-create',
];

const R1_ROUTES = [
```

(e) append the Round 2 block — replace the end of the file

```js
  { id: 'contact-create', path: '/contacts', appendix: ['S3-12'], mocks: [],
    open: async (page) => {
      await page.getByRole('button', { name: 'เพิ่มผู้ติดต่อ' }).click();
      await page.getByRole('menuitem', { name: 'เพิ่มลูกค้า' }).click();
    } },
];
```

with

```js
  { id: 'contact-create', path: '/contacts', appendix: ['S3-12'], mocks: [],
    open: async (page) => {
      await page.getByRole('button', { name: 'เพิ่มผู้ติดต่อ' }).click();
      await page.getByRole('menuitem', { name: 'เพิ่มลูกค้า' }).click();
    } },
];

// ---- Round 2 (plan 2026-11-16, spec §7 R2-2 … R2-4d + owner 2026-11-16) --------------------------------------
// One route per screen Tasks 5–15 convert, opened until the converted field is on screen. Every list a picker
// shows comes from a mock below (or the CPA chart in COMMON_MOCKS), so two runs measure the same options.

const PREVIEW_STAFF = [
  { id: 'preview-staff-1', name: 'พนักงานตัวอย่าง หนึ่ง', role: 'SALES', branch: 'สาขาตัวอย่าง (คลังหลัก)' },
  { id: 'preview-staff-2', name: 'พนักงานตัวอย่างที่มีชื่อยาวมากเป็นพิเศษ สอง', role: 'BRANCH_MANAGER', branch: 'สาขาตัวอย่าง 2' },
];
const roomStaff = PREVIEW_STAFF.map((s) => ({
  id: s.id, name: s.name, nickname: null, role: s.role, detail: [s.branch, s.role, s.id.slice(-6)].join(' · '),
}));

const serviceRequest = (ctx) => ({
  id: 'preview-service-request-1', roomId: ctx.shopRoomId, symptom: 'จอกระพริบหลังใช้งานสองสัปดาห์', revision: 1,
  status: 'OPEN',
  todo: {
    id: 'preview-service-todo-1', status: 'TODO', assigneeId: PREVIEW_STAFF[0].id,
    assignee: { name: PREVIEW_STAFF[0].name }, dueDate: '2026-12-01T03:00:00.000Z',
  },
  sourceMessages: [], currentCustomerId: null, canOpenCase: false, canLinkCase: false, linkedCase: null,
});

const FB_THREAD_ID = 'preview-fb-thread-1';
const FB_RECORD = { authorName: 'ลูกค้า Facebook ตัวอย่าง', text: 'รุ่นนี้ผ่อนได้ไหมครับ', deletedAt: null };
const FB_THREAD = {
  id: FB_THREAD_ID, revision: 1, status: 'OPEN', rootDeleted: false, needsReconciliation: false, assigneeId: null,
  customerId: null, roomId: null, permalink: 'https://www.facebook.com/preview/posts/1',
  capabilities: { publicReply: true, privateReply: false, reason: null },
  records: [{ id: 'preview-fb-record-1', commentId: 'preview-comment-1', parentCommentId: null, ...FB_RECORD }],
  replies: [], recordsTotal: 1, repliesTotal: 0, unresolvedReply: null,
};

const BUYBACK_QUESTIONS = {
  bonusPct: '0',
  questions: [{
    id: 'preview-question-1', key: 'screen', title: 'สภาพหน้าจอ', helpText: null, selectType: 'SINGLE',
    choices: [{ id: 'preview-choice-1', label: 'ไม่มีรอย', deductType: 'PERCENT', deductValue: '0', isNoneChoice: true }],
  }],
};
const BUYBACK_QUOTE = {
  available: true, previewToken: 'preview-token', grade: 'A', model: 'iPhone 15', storage: '128GB', price: '14500',
  maxPrice: '14500', cashPrice: '14500', exchangePrice: '15000', bonusPct: '0',
};
// The questionnaire tab's reference catalog: 3 model/storage pairs, one profile.
const BUYBACK_REFERENCE = {
  questions: [],
  reference: {
    source: 'https://www.applehouseth.com/', capturedAt: '2026-11-01T00:00:00.000Z',
    assignments: [
      { model: 'iPhone 15', storage: '128GB', profileId: 'preview-profile-1' },
      { model: 'iPhone 15', storage: '256GB', profileId: 'preview-profile-1' },
      { model: 'iPhone 15 Pro Max', storage: '1TB', profileId: 'preview-profile-1' },
    ],
    profiles: { 'preview-profile-1': { questions: [], eligibilityText: 'เครื่องเปิดติด ไม่ติดล็อก iCloud' } },
  },
};

const CANNED_TEMPLATES = [
  { id: 'preview-canned-1', shortcut: '/ผ่อน', title: 'ตอบเรื่องผ่อนชำระ', content: 'ผ่อนได้สูงสุด 12 งวดค่ะ', category: 'ทักทาย',
    sortOrder: 0, isActive: true, createdAt: '2026-11-01T00:00:00.000Z' },
  { id: 'preview-canned-2', shortcut: '/โปร', title: 'โปรโมชันเดือนนี้', content: 'โปรประจำเดือน', category: 'ทักทาย',
    sortOrder: 1, isActive: true, createdAt: '2026-11-01T00:00:00.000Z' },
];
const QUICK_REPLIES = [
  { id: 'preview-quick-reply-1', cannedResponseId: 'preview-canned-1', label: 'ดูโปรผ่อน', type: 'POSTBACK',
    payload: 'TEMPLATE:preview-canned-2', url: null, message: null, sortOrder: 0, createdAt: '2026-11-01T00:00:00.000Z' },
];

// A purchase-wizard draft (useCreatePoWizard.ts:17) on step 0 with one case line: StepSupplier's supplier picker and
// AccessoryItemRow's "สำหรับรุ่น" (เคส) are both on screen. Local storage only — nothing is submitted.
async function openPurchaseItems(page) {
  await page.evaluate((supplierId) => {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
    localStorage.setItem('bestchoice-po-draft', JSON.stringify({
      step: 0,
      mode: 'po',
      form: {
        supplierId, orderDate: today, expectedDate: '', notes: '', discount: '', discountAfterVat: '',
        paymentStatus: 'UNPAID', paymentMethod: '', paidAmount: '', paymentNotes: '',
      },
      items: [{
        brand: '', category: 'ACCESSORY', model: '', color: '', storage: '', quantity: '1', unitPrice: '120',
        accessoryType: 'เคส', accessoryBrand: '',
      }],
      savedAt: new Date().toISOString(),
    }));
  }, PO_SUPPLIER.id);
  await clickButton('+ ซื้อสินค้า')(page);
  await page.getByRole('combobox', { name: 'สำหรับรุ่น' }).first().waitFor();
  // the "draft recovered" toast (5 s) can sit over the row at 390
  await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 10000 });
}

const pickRadixOption = async (page, id, option) => {
  await page.locator(`#${id}`).click();
  await page.getByRole('option', { name: option, exact: true }).click();
};

// QuickBuyModal step 1 → 2 → 3 (AddressForm "ที่อยู่ตามบัตร" + the seller picker). Every value is wizard state; the
// one POST is the price quote (quoteMock) — nothing is bought (step 4 "ยืนยัน" is never reached).
async function openQuickBuyAddress(page) {
  await clickButton('รับซื้อเครื่อง')(page);
  await page.locator('#quick-buy-model:not([disabled])').waitFor();
  await pickRadixOption(page, 'quick-buy-model', 'iPhone 15');
  await pickRadixOption(page, 'quick-buy-storage', '128GB');
  await page.locator('#quick-buy-imei').fill('356000000000005');
  await page.locator('#quick-buy-serial').fill('PREVIEWSERIAL01');
  await clickButton('ถัดไป')(page);
  await page.getByText('ไม่มีรอย', { exact: true }).click();
  await page.locator('button:not([disabled])', { hasText: 'ถัดไป' }).waitFor();
  await clickButton('ถัดไป')(page);
  await page.getByText('ที่อยู่ตามบัตร', { exact: true }).waitFor();
}

// The inbox room's customer panel is a column at ≥1280 and a sheet below (UnifiedInboxPage/index.tsx:518-519).
async function openRoomDossier(page) {
  if (page.viewportSize().width >= 1280) return;
  await page.getByRole('button', { name: /^(เปิด)?ข้อมูลลูกค้า$/ }).first().click();
  await page.getByRole('dialog').first().waitFor();
}

const R2 = {
  roomStaff: mock(/^\/staff-chat\/rooms\/[^/]+\/eligible-staff$/, roomStaff),
  onlineStaff: mock(/^\/staff-chat\/staff\/online$/, PREVIEW_STAFF.map((s) => ({
    id: s.id, name: s.name, email: `${s.id}@preview.invalid`, activeCount: 0,
  }))),
  users: mock(/^\/users$/, {
    data: PREVIEW_STAFF.map((s) => ({ id: s.id, name: s.name, role: s.role, isActive: true })),
    total: PREVIEW_STAFF.length, page: 1, limit: 50,
  }),
  serviceRequests: [
    mock(/^\/staff-chat\/rooms\/[^/]+\/service-requests$/, (url, ctx) => ({ data: [serviceRequest(ctx)], total: 1 })),
    mock(/^\/staff-chat\/service-requests\/preview-service-request-1$/, (url, ctx) => serviceRequest(ctx)),
    // the dialog's customer/case picker (ChatServiceRequestDialog.tsx:46-52) — empty, the same on every start
    mock(/^\/staff-chat\/rooms\/[^/]+\/service-intake-options$/, { data: [], total: 0 }),
  ],
  // one supplier whose address is the AddressForm JSON, so the edit dialog opens with every picker filled
  // (create mode leaves อำเภอ / ตำบล disabled)
  supplierEdit: mock(/^\/suppliers$/, {
    data: [{
      id: 'preview-supplier-edit-1', type: 'JURISTIC', name: 'ผู้จัดจำหน่ายตัวอย่าง', titleName: null,
      contactName: 'ผู้ติดต่อตัวอย่าง', contactPhone: '020000001', contactPosition: null, nickname: null,
      branchCode: '00000', phone: '020000000', phoneSecondary: null, lineId: null,
      address: JSON.stringify({
        houseNo: '12', moo: '', village: '', soi: '', road: 'ราชดำเนินใน', province: 'กรุงเทพมหานคร',
        district: 'เขตพระนคร', subdistrict: 'แขวงพระบรมมหาราชวัง', postalCode: '10200',
      }),
      taxId: '0105500000000', hasVat: true, paymentMethods: [], notes: null, isActive: true,
      createdAt: '2026-11-01T00:00:00.000Z', _count: { products: 0, purchaseOrders: 0 },
    }],
    total: 1, page: 1, totalPages: 1,
  }),
  sellConfig: mock(/^\/trade-ins\/sell-config$/, { exchangeBonusPct: 10 }),
  facebookComments: [
    mock(/^\/staff-chat\/facebook-comments$/, {
      data: [{ id: FB_THREAD_ID, rootDeleted: false, records: [FB_RECORD] }], total: 1,
    }),
    mock(/^\/staff-chat\/work-targets\/FACEBOOK_COMMENT\/preview-fb-thread-1$/, {
      targetType: 'FACEBOOK_COMMENT', targetId: FB_THREAD_ID, roomId: null, title: 'คอมเมนต์ใต้โพสต์ Facebook',
    }),
    mock(/^\/staff-chat\/facebook-comments\/preview-fb-thread-1$/, FB_THREAD),
    mock(/^\/staff-chat\/facebook-comments\/preview-fb-thread-1\/eligible-staff$/,
      PREVIEW_STAFF.map(({ id, name, role }) => ({ id, name, role }))),
  ],
  expensesList: [
    mock(/^\/expense-documents$/, { data: [], total: 0, page: 1, limit: 20 }),
    mock(/^\/expense-documents\/summary$/, {
      totalCount: 0, byStatus: {}, accrualUnpaidCount: 0, accrualUnpaidTotal: '0.00',
    }),
    mock(/^\/expenses\/periods\/reopened$/, []),
  ],
  // the "วิเคราะห์" tab (CollectionsPage/tabs/AnalyticsTab.tsx) and every card on it — empty except the one
  // stuck contract the reassign dialog needs
  collections: [
    mock(/^\/overdue\/analytics$/, {
      range: '30d', weeklyCollectionRate: [], promiseKeptTrend: [], dunningActionVolume: [], letterDispatchByType: [],
      mdmLockVolume: [],
    }),
    mock(/^\/overdue\/analytics\/(aging|leaderboard|recovery)$/, []),
    // WorkloadGrid on the same tab reads the whole queue (the default tab reads it too, before the switch)
    mock(/^\/overdue\/queue$/, { data: [], total: 0, page: 1, limit: 500, truncated: false }),
    mock(/^\/overdue\/analytics\/stuck$/, [{
      contractId: 'preview-stuck-1', contractNumber: 'CT-PREVIEW-0001', customerName: 'ลูกค้าตัวอย่าง',
      customerPhone: null, branchName: 'สาขาตัวอย่าง (คลังหลัก)', assignedToId: null, assignedToName: null,
      daysIdle: 21, outstanding: 4500,
    }]),
    mock(/^\/reporting\/compliance\/dunning-frequency$/, { threshold: 5, rows: [] }),
    mock(/^\/reporting\/compliance\/legal-pipeline$/, { windows: [], rows: [] }),
    mock(/^\/reporting\/compliance\/audit-summary$/, (url) => ({
      period: url.searchParams.get('period') === 'month' ? 'month' : 'week', since: '2026-11-09T00:00:00.000Z',
      actionsByUser: [], actionsByType: [], anomalyCount: 0,
    })),
    mock(/^\/reporting\/compliance\/voice-memo-retention$/, {
      hotDays: 30, deleteDays: 365, eligibleForGlacier: { count: 0, sample: [] }, eligibleForDelete: { count: 0, sample: [] },
    }),
  ],
  stockAlerts: [
    mock(/^\/reorder-points\/low-stock$/, { totalLowStock: 0, items: [] }),
    mock(/^\/reorder-points$/, []),
    mock(/^\/reorder-points\/alerts$/, { data: [], total: 0 }),
  ],
  purchaseOrdersSummary: mock(/^\/purchase-orders\/summary$/, {}),
  quickBuy: [
    mock(/^\/trade-ins\/quick-buy\/questions$/, BUYBACK_QUESTIONS),
    quoteMock(/^\/trade-ins\/quick-buy\/preview$/, BUYBACK_QUOTE),
    mock(/^\/trade-ins\/check-imei\/\d+$/, { result: 'ok', occurrences: [] }),
  ],
  buybackReference: mock(/^\/trade-ins\/buyback-questions$/, BUYBACK_REFERENCE),
  canned: [
    mock(/^\/staff-chat\/canned-responses$/, CANNED_TEMPLATES),
    mock(/^\/staff-chat\/canned-responses\/preview-canned-1\/quick-replies$/, QUICK_REPLIES),
    mock(/^\/staff-chat\/canned-responses\/[^/]+\/bubbles$/, []),
  ],
  // the staff option label ends with the id's last 6 characters (ChatAnalyticsPage.tsx:280-283) — preview ids change
  // on every preview start, so the list is fixed here
  chatAnalyticsOptions: mock(/^\/chat-analytics\/v2\/filter-options$/, {
    branches: [{ id: 'preview-branch-1', name: 'สาขาตัวอย่าง (คลังหลัก)' }, { id: 'preview-branch-2', name: 'สาขาตัวอย่าง 2' }],
    staff: PREVIEW_STAFF.map(({ id, name }) => ({ id, name })),
  }),
  salespersons: mock(/^\/sales\/salespersons$/, PREVIEW_STAFF.map(({ id, name }) => ({ id, name }))),
  yeastar: mock(/^\/yeastar\/extensions$/, [
    { number: '101', name: 'หน้าร้าน สาขาตัวอย่าง', status: 'Registered' },
    { number: '102', name: 'ฝ่ายการเงิน', status: 'Unavailable' },
  ]),
  assetCode: mock(/^\/assets\/generate-code$/, { assetCode: 'AST-PREVIEW-0001' }),
  afterSalesWalkIn: mock(/^\/after-sales\/lookup$/, {
    found: false, source: 'WALK_IN', lineLinked: false, product: null, customer: null, contract: null, sale: null,
    warranty: {
      status: 'WALK_IN', daysRemainingIn7Day: 0, purchasedAt: null, shopWarrantyEndDate: null,
      manufacturerWarrantyEndDate: null, checkedAt: '2026-11-16T00:00:00.000Z',
    },
    purchasePhotos: null, openCase: null,
    outcomes: [{ outcome: 'REPAIR', enabled: true, implemented: true, payerDefault: 'CUSTOMER' }],
  }),
  // total 1 keeps the page off its first-use empty state, so the header's "สร้างใบจอง" is the way in
  bookings: [
    mock(/^\/bookings\/summary$/, {
      total: 1, open: 0, pendingDeposit: 0, paid: 0, paidDepositHeld: '0.00', expiringWithin3Days: 0,
      closed: { converted: 1, canceled: 0, expired: 0, total: 1 }, forfeitedThisMonth: '0.00',
    }),
    mock(/^\/bookings$/, { data: [], total: 0, page: 1, limit: 20 }),
  ],
};

// Menu probes (rule MENU) on triggers that are portalled Radix menus today and stay one after their task
// (located by role + accessible name the converting task keeps; the menu is found through aria-controls).
const ACCOUNT_MENU_GL = {
  id: 'account-menu-gl', widths: [1440, 390], menu: 'controls',
  trigger: (page) => page.locator('#main button[role=combobox]').first(),
};
const ACCOUNT_MENU_PETTY_CASH = {
  id: 'account-menu-petty-cash', widths: [1440, 390], menu: 'controls',
  trigger: (page) => page.getByRole('dialog').getByRole('combobox', { name: 'บัญชี', exact: true }).first(),
};
const BOOKING_CUSTOMER_MENU = {
  id: 'booking-customer-menu', widths: [1440, 390], menu: 'controls',
  trigger: (page) => page.getByRole('dialog').getByRole('combobox', { name: 'ลูกค้า', exact: true }),
};
const INBOX_OWNER_MENU = {
  id: 'inbox-owner-menu', widths: [1440, 390], menu: 'controls',
  trigger: (page) => page.getByRole('dialog', { name: 'ตัวกรองแชท' }).getByRole('combobox', { name: 'ผู้ดูแล', exact: true }),
};
// 130 px trigger, 256 px list (Task 11); below 1024 the filters are a sheet (the route's open step opens it)
const PROSPECT_OWNER_MENU = {
  id: 'prospect-owner-menu', widths: [1440, 390], menu: 'controls',
  trigger: (page) => page.getByRole('combobox', { name: 'ผู้ดูแล', exact: true }),
};
const PROFILE_EXTENSION_MENU = {
  id: 'profile-extension-menu', widths: [1440, 390], menu: 'controls',
  trigger: (page) => page.getByRole('combobox', { name: 'Extension Yeastar (โทรศัพท์)', exact: true }),
};

// Probes on fields that are native <select>s today: a native select has no aria-controls, so on baseline-r2 the
// probe would fail ("menu not found") and a MENU failure blocks every compare. The task that converts the field
// attaches the probe to its route (`probes: [X]`) and deletes the entry here — the probe then PASSes.
export const PENDING_PROBES = {
  'r2-expenses-list': [{ // Task 13
    id: 'account-menu-expense-filter', widths: [1440], menu: 'controls',
    trigger: (page) => page.getByRole('combobox', { name: 'ประเภทค่าใช้จ่าย' }),
  }],
  'expense-new': [{ // Task 13
    id: 'account-menu-expense-line', widths: [1440], menu: 'controls',
    trigger: (page) => page.getByRole('combobox', { name: 'บัญชีค่าใช้จ่าย' }).first(),
  }],
  'recurring-bill-dialog': [{ // Task 13
    id: 'account-menu-recurring-bill', widths: [1440], menu: 'controls',
    trigger: (page) => page.getByRole('dialog').getByRole('combobox', { name: 'บัญชีค่าใช้จ่าย' }),
  }],
  'r2-stock-alert-create': [{ // Task 12 (menu inside a Radix Dialog)
    id: 'stock-alert-model-menu', widths: [1440, 390], menu: 'controls',
    trigger: (page) => page.getByRole('dialog').getByRole('combobox', { name: 'รุ่น', exact: true }),
  }],
  'r2-po-wizard-items': [{ // Task 12 (overflow-x-auto table; vaul Drawer below 1024)
    id: 'po-accessory-model-menu', widths: [1440, 390], menu: 'controls',
    trigger: (page) => page.getByRole('combobox', { name: 'สำหรับรุ่น' }).first(),
  }],
};

const room = (ctx) => (ctx.shopRoomId ? `/inbox/${ctx.shopRoomId}?zone=shop` : null);

export const R2_ROUTES = [
  // R2-2 AddressForm hosts the Round 1 routes left closed
  { id: 'r2-customer-create-address', path: '/customers', appendix: ['R2-2 AddressForm'], mocks: [],
    open: async (page) => {
      await page.getByRole('button', { name: /^\+ เพิ่ม(ลูกค้า|ผู้สนใจ)ใหม่$/ }).first().click();
      const dialog = page.getByRole('dialog', { name: 'เพิ่มลูกค้าใหม่' });
      await dialog.locator('summary').filter({ hasText: 'ที่อยู่' }).first().click();
      await dialog.locator('summary').filter({ hasText: 'ข้อมูลที่ทำงาน' }).first().click();
    } },
  { id: 'r2-trade-in-quick-buy-address', path: '/trade-in', appendix: ['R2-2 AddressForm', 'R2-3b ContactCombobox'],
    mocks: [M.buybackCatalog, ...R2.quickBuy], open: openQuickBuyAddress },
  // SupplierForm in edit mode (supplier-form is the create mode: อำเภอ / ตำบล disabled until a province is picked)
  { id: 'r2-supplier-edit', path: '/suppliers', appendix: ['R2-2 AddressForm'], mocks: [R2.supplierEdit],
    open: async (page) => {
      await page.getByRole('button', { name: /^แก้ไข / }).first().click();
      await page.getByRole('dialog', { name: 'แก้ไขผู้จัดจำหน่าย' }).waitFor();
    } },
  // R2-3a account pickers the Round 1 routes do not show
  { id: 'r2-general-ledger', path: '/finance/general-ledger', appendix: ['R2-3a GL'], mocks: [],
    probes: [ACCOUNT_MENU_GL] },
  { id: 'r2-account-role-dialog', path: '/settings/access/account-roles', appendix: ['R2-3a AccountRoles'],
    mocks: [M.roleMap], open: async (page) => {
      await page.getByRole('button', { name: /^แก้ไข / }).first().click();
      await page.getByRole('dialog').waitFor();
    } },
  // AdjustmentTable shows once the amount received differs from the lines (OtherIncomeEntryPage.tsx:1015);
  // its "เพิ่มผลต่างที่เหลือ …" button adds one adjustment row (with its account picker). Form state only.
  { id: 'r2-other-income-adjustment', path: '/other-income/new', appendix: ['R2-3a AdjustmentTable'],
    mocks: M.otherIncome, open: async (page) => {
      await page.getByLabel(/^จำนวนเงินที่ได้รับจริง/).fill('100');
      await page.getByRole('button', { name: /^เพิ่มผลต่างที่เหลือ/ }).click();
      await page.getByRole('textbox', { name: 'หมายเหตุผลต่างรายการ 1' }).waitFor();
    } },
  { id: 'r2-petty-cash-lines', path: '/expenses/new', appendix: ['R2-3a PettyCash', 'R2-3b VendorCombobox'],
    mocks: M.expense, open: async (page) => {
      await page.getByRole('button', { name: /^เงินสดย่อย/ }).click();
    }, probes: [ACCOUNT_MENU_PETTY_CASH] },
  // R2-4c expense account fields (+ the credit-note copy of ItemLinesSection)
  { id: 'r2-expenses-list', path: '/expenses', appendix: ['R2-4c ExpensesPage'], mocks: R2.expensesList },
  { id: 'r2-credit-note-lines', path: '/expenses/new?type=CN', appendix: ['R2-4c ItemLinesSection'], mocks: M.expense,
    open: async (page) => {
      await page.getByRole('button', { name: /^ไม่มีเอกสารต้นทาง/ }).click();
    } },
  // R2-3b ContactCombobox / EmployeeCombobox / CustomerCombobox hosts the Round 1 routes do not show
  // SettlementLinesSection lists the branch's open ACCRUAL bills (GET /expense-documents) — none here
  { id: 'r2-settlement-new', path: '/expenses/new?type=SE', appendix: ['R2-3b VendorCombobox'],
    mocks: [...M.expense, R2.expensesList[0]] },
  { id: 'r2-asset-new', path: '/assets/new', appendix: ['R2-3b ContactCombobox'], mocks: [R2.assetCode] },
  { id: 'r2-after-sales-walk-in', path: '/after-sales/new?imei=356000000000005', appendix: ['R2-3b ContactCombobox'],
    mocks: [R2.afterSalesWalkIn] },
  { id: 'r2-po-wizard-items', path: '/purchase-orders', appendix: ['R2-3b ContactCombobox', 'R2-4b AccessoryItemRow'],
    mocks: [M.purchaseOrders, M.poSuppliers, R2.purchaseOrdersSummary], open: openPurchaseItems },
  { id: 'r2-booking-create', path: '/bookings', appendix: ['R2-3b CustomerCombobox'], mocks: R2.bookings,
    open: clickButton('สร้างใบจอง'), probes: [BOOKING_CUSTOMER_MENU] },
  { id: 'r2-store-appointments', path: '/appointments', appendix: ['R2-3b CustomerCombobox'], mocks: [] },
  // R2-4a staff fields
  { id: 'r2-inbox-filter', path: '/inbox?zone=shop', appendix: ['R2-4a ChannelFilter'], mocks: [R2.onlineStaff],
    open: clickButton('ตัวกรองแชท'), probes: [INBOX_OWNER_MENU] },
  { id: 'r2-inbox-follow-up', path: room, appendix: ['R2-4a ChatFollowUpDialog'], mocks: [R2.roomStaff],
    blockWrites: true, open: async (page) => {
      await openRoomDossier(page);
      await clickButton('ตั้งนัดติดตาม')(page);
      await page.getByRole('dialog').getByText('ผู้รับผิดชอบงาน').waitFor();
    } },
  { id: 'r2-inbox-service-request', path: room, appendix: ['R2-4a ChatServiceRequestDialog'],
    mocks: [R2.roomStaff, ...R2.serviceRequests], blockWrites: true, open: async (page) => {
      await openRoomDossier(page);
      await clickButton('บริการหลังการขาย')(page);
      await clickButton('รับเรื่องหลังการขาย')(page);
      await page.getByRole('dialog').getByText('ผู้รับผิดชอบ').waitFor();
    } },
  { id: 'r2-inbox-service-request-edit', path: room, appendix: ['R2-4a ChatServiceRequestCard'],
    mocks: [R2.roomStaff, ...R2.serviceRequests], blockWrites: true, open: async (page) => {
      await openRoomDossier(page);
      await clickButton('บริการหลังการขาย')(page);
      await page.getByRole('button', { name: /จอกระพริบหลังใช้งานสองสัปดาห์/ }).click();
      await clickButton('แก้ไขการติดตาม')(page);
    } },
  { id: 'r2-inbox-facebook-comment', path: '/inbox?zone=shop', appendix: ['R2-4a FacebookCommentPanel'],
    mocks: R2.facebookComments, open: async (page) => {
      await clickButton('คอมเมนต์')(page);
      await page.getByRole('button', { name: /ลูกค้า Facebook ตัวอย่าง/ }).click();
      await page.getByText('ผู้รับผิดชอบคอมเมนต์', { exact: true }).waitFor();
    } },
  // TodoFilters is on the page; todo-form (above) covers TodoForm in its dialog
  { id: 'r2-todos-list', path: '/todos', appendix: ['R2-4a TodoFilters'], mocks: [M.branchManagerActor] },
  { id: 'r2-collections-stuck-reassign', path: '/collections', appendix: ['R2-4a StuckContractsSection'],
    mocks: [...R2.collections, R2.users], open: async (page) => {
      await page.getByRole('button', { name: /^วิเคราะห์/ }).click();
      await page.getByRole('checkbox', { name: 'เลือก CT-PREVIEW-0001' }).click();
      await page.getByRole('button', { name: /^มอบหมายใหม่/ }).click();
      await page.getByRole('dialog').waitFor();
    } },
  // ProspectFilterBar is a sheet below 1024 (ResponsiveFilterPanel)
  { id: 'r2-prospect-filters', path: '/customers?view=prospects', appendix: ['R2-4a ProspectFilterBar'],
    mocks: [R2.users], open: async (page) => {
      if (page.viewportSize().width < 1024) await page.getByRole('button', { name: 'เปิดตัวกรอง' }).click();
    }, probes: [PROSPECT_OWNER_MENU] },
  // R2-4b models + suppliers (QuickBuyModal's model field: trade-in-quick-buy above)
  // ยี่ห้อ Apple enables รุ่น (local form state only)
  { id: 'r2-product-create', path: '/products/create', appendix: ['R2-4b ProductInfoCard', 'R2-4b BranchSupplierCard'],
    mocks: [M.poSuppliers, M.branches], open: async (page) => {
      await page.getByLabel('ยี่ห้อ *', { exact: true }).selectOption('Apple');
    } },
  { id: 'r2-stock-alert-create', path: '/stock/alerts', appendix: ['R2-4b StockAlertsPage'],
    mocks: [...R2.stockAlerts, M.branches], open: async (page) => {
      await clickButton('+ จุดสั่งซื้อซ้ำ')(page);
      await page.getByRole('dialog').getByLabel('แบรนด์', { exact: true }).selectOption('Apple');
    } },
  { id: 'r2-trade-in-questions', path: '/trade-in', appendix: ['R2-4b ReferenceQuestionnaire'],
    mocks: [R2.buybackReference, R2.sellConfig], open: async (page) => {
      await page.getByRole('radio', { name: 'แบบตรวจสภาพ', exact: true }).click();
      await page.getByText('รุ่นและความจุ', { exact: true }).waitFor();
    } },
  { id: 'r2-purchase-orders-list', path: '/purchase-orders', appendix: ['R2-4b POListTab'],
    mocks: [M.purchaseOrders, M.poSuppliers, R2.purchaseOrdersSummary] },
  // R2-4d others
  { id: 'r2-chat-analytics', path: '/chat-analytics', appendix: ['R2-4d ChatAnalyticsPage'], mocks: [R2.chatAnalyticsOptions] },
  { id: 'r2-sales-history', path: '/sales', appendix: ['R2-4d SalesHistoryPage'], mocks: [R2.salespersons] },
  { id: 'r2-canned-quick-reply', path: '/canned-responses', appendix: ['R2-4d QuickReplyEditor'], mocks: R2.canned,
    open: async (page) => {
      await page.getByRole('button', { name: 'ขยาย', exact: true }).first().click();
      await page.getByText('ตอบเรื่องผ่อนชำระ', { exact: true }).click();
      await page.getByText('เมื่อกด:', { exact: true }).waitFor();
    } },
  { id: 'r2-profile-yeastar', path: '/profile', appendix: ['R2-4d UserProfilePage'], mocks: [R2.yeastar],
    probes: [PROFILE_EXTENSION_MENU] },
];

export const ROUTES = [...R1_ROUTES, ...R2_ROUTES];
```

Notes on the steps (all local state, nothing saved): the QuickBuy route fills an IMEI/serial and answers one inspection question in wizard state and prices via the mocked quote; it never reaches step 4. The PO wizard route writes the wizard's own localStorage draft (as Round 1's `openPurchasePayment` does). The adjustment route types a received amount and adds a row in form state. `r2-other-income-adjustment` deliberately uses "เพิ่มผลต่างที่เหลือ …" — the first "เพิ่มบัญชี" button on the page belongs to the items card, not the AdjustmentTable.

(f) give Round 1's `trade-in-quick-buy` the model-menu probe (its open step is unchanged) — replace

```js
      await clickButton('รับซื้อเครื่อง')(page);
      await page.locator('#quick-buy-model:not([disabled])').waitFor();
    } },
```

with

```js
      await clickButton('รับซื้อเครื่อง')(page);
      await page.locator('#quick-buy-model:not([disabled])').waitFor();
    }, probes: [QUICK_BUY_MODEL_MENU] },
```

- [ ] **Step 8: Run the tool tests (green)**

```bash
node --test tools/field-scale/check.test.mjs
node --test $(ls tools/typography-audit/*.test.mjs) tools/field-scale/check.test.mjs
```

Expected: first command `ℹ tests 32` · `ℹ pass 32` · `ℹ fail 0` (24 existing — one of them, the probe test, rewritten — + 8 new). Second command: every test passes (Round 1's typography suite + the new collector test + the 32).

- [ ] **Step 9: Smoke the Round 2 routes on the preview**

```bash
npm run local:preview
node tools/field-scale/check.mjs --label r2-smoke --routes r2-customer-create-address,r2-trade-in-quick-buy-address,r2-supplier-edit,r2-general-ledger,r2-account-role-dialog,r2-other-income-adjustment,r2-petty-cash-lines,r2-expenses-list,r2-credit-note-lines,r2-settlement-new,r2-asset-new,r2-after-sales-walk-in,r2-po-wizard-items,r2-booking-create,r2-store-appointments,r2-inbox-filter,r2-inbox-follow-up,r2-inbox-service-request,r2-inbox-service-request-edit,r2-inbox-facebook-comment,r2-todos-list,r2-collections-stuck-reassign,r2-prospect-filters,r2-product-create,r2-stock-alert-create,r2-trade-in-questions,r2-purchase-orders-list,r2-chat-analytics,r2-sales-history,r2-canned-quick-reply,r2-profile-yeastar,other-income-items,other-income-override,trade-in-quick-buy --widths 1440,390 --themes light
```

Expected: every line `rendered` (68 cells), e.g. `r2-trade-in-quick-buy-address 1440 light: rendered · facts 32 · findings 2`, `r2-inbox-filter 1440 light: rendered · facts 5 · findings 0 · inbox-owner-menu PASS`, then `menu probes: 16 pass · 0 fail` (account items-card, override-jv at 1440; quick-buy model, gl, petty-cash, booking, inbox-owner, prospect-owner, profile-extension at 1440 and 390) and `cells not fully measured: 0`. In `.tmp/field-scale/r2-smoke/results.json` the three `r2-inbox-follow-up` / `-service-request` / `-service-request-edit` cells list `blockedWrites` like `POST /staff-chat/rooms/<room>/read` and `POST /staff-chat/rooms/<room>/suggest`; no other cell has `blockedWrites`. Open each `r2-*-1440-light.png` and check the converted field is on screen (table "Routes Task 1 defines" above). Any `open-failed` / `error`: read the PNG, fix the locator or add the missing mock in `routes.mjs` (the route header says how), rerun Step 8 and this step.

- [ ] **Step 10: Commit the tool change**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
git add tools/field-scale/routes.mjs tools/field-scale/lib.mjs tools/field-scale/check.mjs tools/field-scale/menu-clip.mjs tools/field-scale/check.test.mjs tools/typography-audit/collect-fields.test.mjs
git commit -F - <<'EOF'
test(field-scale): routes for every Round 2 screen + controls menu probes

- routes.mjs: 31 r2-<screen> routes (AddressForm hosts with the address on screen, GL, AccountRoles,
  AdjustmentTable, petty cash, credit note, /expenses filter, the ContactCombobox / Customer hosts and the
  20 appendix ค call-site screens), every picker list mocked; ADDRESS_FORM_HOSTS now names routes that show
  the address (company-entity-create, r2-customer-create-address, r2-trade-in-quick-buy-address).
  Round 1 route ids and steps unchanged.
- quoteMock (a POST that only prices a quote — QuickBuyModal step 2), blockWrites (inbox rooms POST
  read/suggest just by being open — aborted and listed as blockedWrites), ctx.shopRoomId.
- probes with menu 'controls' (menu = the trigger's aria-controls) on every trigger that is a portalled
  Radix menu today: GL / petty-cash account, booking customer, inbox / prospect owner, quick-buy model,
  profile extension; the two Round 1 account probes move to it too. PENDING_PROBES holds the five probes
  on native selects (Tasks 12 / 13 attach them when they convert the field).
- lib.mjs routeRequest + tests; readMenuGeometry(element) + a Chromium test; collector pinned on the
  Round 2 Combobox trigger shape (button[role=combobox] named by <label for>).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: one commit, 6 files changed. `git status --short` shows nothing under `tools/`.

- [ ] **Step 11: Record `baseline-r2` (main's UI, no UI change on this branch yet)**

`npm run local:preview` first (the commit changed `tools/`, so the preview is stale; it restarts it). Then (≈ 20 minutes: 59 routes × 3 widths × 2 themes = 354 cells; Round 1's 168 cells took ≈ 9 minutes):

```bash
npm run local:preview
mkdir -p .tmp/field-scale && node tools/field-scale/check.mjs --label baseline-r2 2>&1 | tee .tmp/field-scale/baseline-r2.log
echo "exit=${PIPESTATUS[0]}"
```

Expected: 354 progress lines, then

```
open findings: <N> (P1 0 · P2 <N> · P3 0) · allowed 0
menu probes: 32 pass · 0 fail
cells not fully measured: 0 · API errors without a mock: <y>
wrote D:\BESTCHOICE APP\BESTCHOICE\.tmp\field-scale\baseline-r2\results.json and report.md
exit=0
```

- `menu probes: 32 pass` = account items-card 2 + override-jv 2 (1440 × light/dark) + quick-buy-model 4 + account-menu-gl 4 + account-menu-petty-cash 4 + booking 4 + inbox-owner 4 + prospect-owner 4 + profile-extension 4 (1440 and 390 × light/dark). **MENU is 0 now** (Round 1 fixed S2-01/S2-02). `PENDING_PROBES` do not run.
- P1 must be 0. For orientation: the 28 Round 1 routes had 336 open P2 at the last Round 1 run (`.tmp/field-scale/final-polish`, revision `6e07daa73`); the 31 Round 2 routes had 157 findings at 1440/1024/390 light on the preview (2026-11-16 draft run) — dark adds about as many again. The exact `<N>` is whatever this run records; it is the baseline.
- "API ที่ตอบ error (ยังไม่มี mock)" may list the 5 Round 1 endpoints of the last Round 1 run (`/customers/<id>/blacklist`, `/expense-documents/payroll/meta`, `/line-oa/link-invite`, `/purchase-orders/summary` on `purchase-order-wizard`, `/receipts/contract/<id>` — ids change per preview start) and, on `r2-collections-stuck-reassign` only, `GET /overdue/kpi/my-today 501`, `GET /overdue/kpi 501`, `GET /filter-presets 501` (the collections page's default tab, left before the measurement). None blocks a screen.
- If a cell is not `rendered`, treat it as in Step 9 (fix, commit `fix(tools): field-scale <route> locator`, rerun from `npm run local:preview`).

- [ ] **Step 12: Prove it repeatable (`baseline-r2-det`)**

Same preview, no source edits in between:

```bash
node tools/field-scale/check.mjs --label baseline-r2-det 2>&1 | tee .tmp/field-scale/baseline-r2-det.log
node tools/field-scale/check.mjs --compare baseline-r2 baseline-r2-det | tee .tmp/field-scale/cmp-baseline-r2-baseline-r2-det.txt
echo "exit=${PIPESTATUS[0]}"
```

Expected compare output (exit 0):

```
Compared 354 cells (route × width × theme) of "baseline-r2" → "baseline-r2-det"
New findings: 0 (blocking P1/P2: 0)
Fixed: 0
MENU failures (account-menu probes — never accepted from the baseline): 0
PASS: no new P1/P2 findings, no MENU failures, no cell lost or emptied
exit=0
```

(The wording "account-menu probes" is `lib.mjs`'s fixed text; it now covers all nine probes.) Any other line is nondeterminism in a route: mock the data the screen reads or wait for the stable state in the open step, commit, and rerun Steps 11–12 from `npm run local:preview`. Also run `git status --short` — nothing under `.tmp/` (gitignored).

- [ ] **Step 13: `pr-summary.md` (gitignored; for the Round 2 PR description)**

Write `.tmp/field-scale/baseline-r2/pr-summary.md` with exactly these parts (copy the tables from `.tmp/field-scale/baseline-r2/report.md`):

```markdown
## Baseline รอบ 2 บน main (UI ยังไม่เปลี่ยน)

- <the 4 header bullets of baseline-r2/report.md: เวลา · source revision · ความกว้าง/ธีม/หน้า/cell · ข้อพบที่ยังเปิด>
- หมายเหตุ: วัดบน branch `feat/dropdown-search-round2` ก่อนแก้ UI ใดๆ — apps/ + packages/ = `6e79e6eb4` (main หลัง Round 1) · tools/ = commit ของ Task 1 · baseline รอบ 1 (`.tmp/field-scale/baseline/`) เก็บไว้เป็นประวัติเท่านั้น

### ข้อพบตามกฎ
<table "ข้อพบตามกฎ">

### เมนูถูกตัด (probe)
<table "เมนูบัญชีถูกตัด (S2-01 / S2-02)" — all 32 rows PASS: account-menu-items-card, account-menu-override-jv, quick-buy-model-menu, account-menu-gl, account-menu-petty-cash, booking-customer-menu, inbox-owner-menu, prospect-owner-menu, profile-extension-menu>

### รายหน้า
<table "รายหน้า" — 59 routes, cell 6 / วัดได้ 6 each>

- cell ที่วัดไม่ครบ: <count, 0 expected> · API ที่ตอบ error: <count and the endpoints>
- ทำซ้ำได้: `--compare baseline-r2 baseline-r2-det` → 354 cell · New 0 · Fixed 0 · MENU 0 · PASS (exit 0)
- รันบน Windows: `node --test $(ls tools/typography-audit/*.test.mjs) tools/field-scale/check.test.mjs` (ผ่านทั้งหมด), `npm run local:preview`, `node tools/field-scale/check.mjs --label baseline-r2` และ `--label baseline-r2-det`; `npm run local:check` ไม่รองรับ Windows — ต้องรันบน Linux/CI
```

Every later Round 2 task proves "ไม่เพิ่มจาก baseline" with `npm run local:preview` → `node tools/field-scale/check.mjs --label <task-label> [--routes …]` → `node tools/field-scale/check.mjs --compare baseline-r2 <task-label>` (exit 0, or the exact clause (a) re-key pairs its task lists).

---

### Task 2: `Combobox` mockup on the owner's canvas (R2-0) — approval gate for Task 4

**Why:** Spec §7 row R2-0 asks for a mockup on the canvas the owner already reviewed ("มาตรฐานช่องกรอก ก่อน/หลัง", https://claude.ai/artifact/P9HZMn9fL6V17TdWyG5QDn) showing ปิด / เปิด / ค้นหา / ไม่พบ / กำลังโหลด / ผิดพลาด / ตัวเลือกปิด / ในหน้าต่าง / 390, and the owner signs it off before any `Combobox` code (header table: Task 4 depends on 2). Spec §9 adds two checks this mockup must answer: the combobox replaces the phone's own picker in 23 fields (so the 390 screen is designed here — list focused, no keyboard), and the read-only value next to it must stay readable in dark mode (contrast numbers on the board). No app code changes in this task.

What was found while drafting (facts the boards rely on):
- The canvas is editable: `Artifact read` on 2026-11-16 reported it as the person's own canvas, version `1794652679-c752`, 4 boards (`Main`, `Expense`, `OtherIncome`, `AuditFilter`, lowest edge y = 1500), `notes: {}`. **Decision: add a new section to this canvas** (5 boards + 1 title note under the existing rows). A separate canvas is only the fallback for Step 1's "cannot edit" case.
- Colours are the admin-shell tokens (`apps/web/src/styles/admin-colors.css:6-41` light, `:81-119` dark — these override `index.css` under `body:has(.app-shell)`), converted to hex. The boards carry them as two CSS blocks, `.t-light` and `.t-dark`, so a dark board is the light markup with one class swapped.
- cmdk's `CommandItem` default `data-[disabled=true]:opacity-50` (`apps/web/src/components/ui/command.tsx:93`) makes a disabled row's label 3.19:1 and its reason 2.10:1 in light mode (4.38 / 2.98 dark) — below 4.5:1. The mockup draws disabled rows in `text-muted-foreground` without fading (5.74 / 7.33). Task 4 must follow (Produces table).
- Read-only value (spec §9): text 14.51:1 light / 12.08:1 dark, border vs box 3.03 / 3.12 — passes. Its fill is only 1.04:1 (light) / 1.30:1 (dark) away from an editable field; it is told apart by right-aligned numbers and no caret, which the board states.

**Files:**
- Artifact (not in the repo) https://claude.ai/artifact/P9HZMn9fL6V17TdWyG5QDn:
  - Modify `project/canvas.json` (add 5 `boards` entries, 5 `order` names, `notes.r2combobox`; every existing key unchanged)
  - Create `project/ComboboxLight.dc.html` (1200×2080 — states 1–8, light)
  - Create `project/ComboboxDark.dc.html` (1200×2080 — generated from the light board)
  - Create `project/ComboboxMobileLight.dc.html` (390×844 — the 390 state, light)
  - Create `project/ComboboxMobileDark.dc.html` (390×844 — generated)
  - Create `project/ComboboxChecks.dc.html` (1540×1180 — phone behaviour notes, contrast table, read-only row in both themes)
  - Existing `project/Main.dc.html`, `Expense.dc.html`, `OtherIncome.dc.html`, `AuditFilter.dc.html`: not touched
- Scratch (OS temp, never committed): `<SCRATCH>/r2-tools/make-dark.mjs`, `<SCRATCH>/r2-tools/contrast.mjs` (`<SCRATCH>` = the scratchpad directory your session prompt names)
- Repo: Modify the Round 2 plan file (the file that contains this task): append a `## Progress notes` entry (Step 10)
- Test files: none (no app code). No `vitest` / `check-types` / `eslint` / field-scale run in this task — nothing under `apps/` changes.

**Interfaces:**
- Consumes:
  - Header Thai copy (Global Constraints): `เลือก…`, `พิมพ์เพื่อค้นหา…`, `ไม่พบรายการ`, `กำลังโหลด…`, `โหลดรายการไม่สำเร็จ`, `ลองใหม่` (the `…` is U+2026)
  - Round 1 look: `formControlClass` (`apps/web/src/components/ui/form-styles.ts:5-8` — 44px, `rounded-lg` 8px, `border-input`, `bg-background`, 14px ≥1024 / 16px below), `formLabelClass` (`:13` — 14px `font-medium` `mb-3`)
  - Real data for the samples: provinces in `.sort()` order (`apps/web/src/data/thai-address-data.ts`, as `AddressForm.tsx:133` lists them), FINANCE accounts 42-1102…42-1108 / 53-1301 (`apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv`, names through `accountDisplayName`), the real blocked reason `ยังไม่รองรับ — รอ payroll module` (`apps/web/src/pages/other-income/components/ItemsTable.tsx:111`), real labels (`TodoForm.tsx` "เพิ่มงานใหม่" / "ชื่องาน *" / "ผู้รับมอบหมาย", `ItemsTable` "บัญชีรายได้", `AddressForm` "จังหวัด *" / "อำเภอ/เขต *" / "ตำบล/แขวง *", `BranchSupplierCard` "ผู้จัดจำหน่าย", Bookings "ลูกค้า"). Staff names are made up.
- Produces:
  1. The approved mockup: link + version recorded in the plan's `## Progress notes` (Step 10). **Task 4 must not start until that entry says `Decision: approved`** (or `approved with changes` and the changes are applied).
  2. The visual contract Task 4 implements (what each drawn element is in code). If the owner changes something in Step 9, update the matching row here in the same commit as the progress note:

| Drawn on the boards | `Combobox` (Task 4) |
|---|---|
| Trigger, all states | raw `button[type=button][role=combobox]`, `cn(formControlClass, 'flex items-center justify-between gap-2 text-left', className)` — 44px from the global CSS, 8px corners, `border-input`, `bg-background` |
| Value text | `<span data-slot="combobox-value" className="min-w-0 truncate" title={label}>` — the `title` sits on the span, not the button (state 1, third field) |
| Placeholder `เลือก…` | `<span className="min-w-0 truncate text-muted-foreground">` |
| Arrow | lucide `ChevronDown` `size-4 shrink-0 text-muted-foreground`, `aria-hidden` |
| Disabled trigger | nothing extra — `formControlClass` already has `disabled:opacity-60 disabled:cursor-not-allowed` |
| Keyboard focus ring | nothing extra — the admin shell's global 2px `ring` outline, offset 3px |
| Menu box | `PopoverContent` + `w-(--radix-popover-trigger-width) min-w-64 p-0` (keeps its default `rounded-md border-border bg-popover shadow-md`, `sideOffset` 4) |
| Search row | `CommandInput` unchanged (search icon, `h-11 text-sm`, `border-b`) |
| List | `CommandList` + `overscroll-contain` (keeps `max-h-[300px] p-1`) |
| Row | `CommandItem` + `min-h-11 py-2 leading-snug` — 44px rows, the same height as Radix `SelectItem` (`select.tsx:164`) |
| Highlighted row | `CommandItem` default `data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground` |
| Mark on the current value | lucide `Check` `ml-auto size-4 text-primary!` (the `!` beats `CommandItem`'s `[&_svg]:text-muted-foreground`) |
| Second line (`description`, `disabledReason`) | `<span className="text-xs text-muted-foreground">` under the label inside `flex min-w-0 flex-col` |
| Disabled option | `data-[disabled=true]:opacity-100 data-[disabled=true]:text-muted-foreground data-[disabled=true]:cursor-not-allowed` — never the default `opacity-50` |
| Group heading | `CommandGroup` heading default (`text-xs font-semibold text-muted-foreground`) |
| `ไม่พบรายการ` | `CommandEmpty` default (`py-8 text-center text-sm text-muted-foreground`) |
| `กำลังโหลด…` | centred `text-sm text-muted-foreground` row with lucide `Loader2` `size-4 animate-spin` |
| `โหลดรายการไม่สำเร็จ` + `ลองใหม่` | centred `text-sm text-destructive` with lucide `AlertCircle` `size-4`; `Button variant="outline" size="md"` with lucide `RotateCw`, rendered outside `<Command>` (header cmdk facts) |
| Account rows (states 1 and 7) | the label itself is `เลขบัญชี - ชื่อ` (owner 2026-11-16, spec §9.1 — `AccountCombobox`'s default `display`, Task 7) under the CoA group heading — plain row text, no extra span |

---

- [ ] **Step 1: Read the canvas and set the working folder**

Call the Artifact tool:

```json
{ "action": "read", "url": "https://claude.ai/artifact/P9HZMn9fL6V17TdWyG5QDn", "path": "project/canvas.json" }
```

Expected: the result says the person owns / can write this artifact, and saves `project/canvas.json` under a folder like `<SCRATCH>\artifact-files\b3513470-f72b-4848-b84c-99d50a2d8df1`. Call that folder `ROOT` (it holds `project/`). Then:

```bash
sha256sum "<ROOT>/project/canvas.json"
```

- Hash `8647c7289075e2386aa14964b30234acc2a3c65d46fbdeae698bf0f6754121a1` = the canvas is exactly as read while drafting (4 boards, no notes) → Step 6 overwrites it with the full file given there.
- Any other hash = someone edited the canvas since → Step 6 merges by hand.
- If the read says the person cannot edit it: create a new Design canvas titled `Combobox — mockup รอบ 2` (Artifact publish with `type_url` = `https://claude.ai/artifact/QKN21svewxgyPb6SYRqWnd` — the Design type this canvas was made from — and that `title`, nothing else), use its `url` instead in Steps 7–10, put all 5 boards in it with the Step 6 positions minus 1900 on `y`, and in Step 8 also give the owner the old canvas link. Write which canvas was used in the progress note.

- [ ] **Step 2: Write `<ROOT>/project/ComboboxLight.dc.html`**

States 1–8 at desktop width, light. Exact file:

```html
<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<title>Combobox — จอใหญ่ (สว่าง)</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700&amp;display=swap" rel="stylesheet">
<style>
body{margin:0}
.t-light{--page:#f7f7f7;--card:#ffffff;--fg:#212121;--muted-fg:#666666;--border:#dbdbdb;--input:#8c8c8c;--field:#f7f7f7;--pop:#ffffff;--pop-fg:#212121;--accent:#e8e8e8;--accent-fg:#212121;--primary:#0a714e;--primary-fg:#ffffff;--destructive:#b81919;--scrim:#777777;--shadow:0 4px 6px -1px rgba(0,0,0,.08),0 2px 4px -2px rgba(0,0,0,.06)}
.t-dark{--page:#171717;--card:#212121;--fg:#f0f0f0;--muted-fg:#b8b8b8;--border:#474747;--input:#787878;--field:#171717;--pop:#292929;--pop-fg:#f0f0f0;--accent:#3b3b3b;--accent-fg:#f5f5f5;--primary:#3fd9a6;--primary-fg:#0d211a;--destructive:#f77e7e;--scrim:#999999;--shadow:0 4px 6px -1px rgba(0,0,0,.4),0 2px 4px -2px rgba(0,0,0,.3)}
.board{box-sizing:border-box;width:1200px;height:2080px;padding:40px 48px;background:var(--page);color:var(--fg);font-family:'Noto Sans Thai',sans-serif;display:flex;flex-direction:column;gap:28px}
.card{box-sizing:border-box;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:12px;min-width:0}
.chip{align-self:flex-start;display:inline-flex;align-items:center;height:26px;padding:0 10px;border-radius:999px;background:var(--accent);color:var(--fg);font:600 13px/1 'Noto Sans Thai',sans-serif}
.desc{margin:0;font:400 13px/1.6 'Noto Sans Thai',sans-serif;color:var(--muted-fg)}
.lbl{display:block;margin:0 0 12px;font:500 14px/1.375 'Noto Sans Thai',sans-serif;color:var(--fg)}
.hint{margin:6px 0 0;font:400 13px/1.5 'Noto Sans Thai',sans-serif;color:var(--muted-fg)}
.trg{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;height:44px;padding:0 12px;border:1px solid var(--input);border-radius:8px;background:var(--field);box-shadow:0 1px 2px rgba(0,0,0,.05);font:400 14px/1.5 'Noto Sans Thai',sans-serif;color:var(--fg);text-align:left;cursor:pointer}
.trg:disabled{opacity:.6;cursor:not-allowed}
.trg.focus{outline:2px solid var(--primary);outline-offset:3px}
.val{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.ph{min-width:0;color:var(--muted-fg)}
.ico{flex:none;width:16px;height:16px;color:var(--muted-fg)}
.grp{padding:6px 8px 4px;font:600 12px/1.5 'Noto Sans Thai',sans-serif;color:var(--muted-fg)}
.pop{box-sizing:border-box;margin-top:4px;width:100%;min-width:256px;border:1px solid var(--border);border-radius:6px;background:var(--pop);color:var(--pop-fg);box-shadow:var(--shadow);overflow:hidden}
.srch{display:flex;align-items:center;gap:8px;height:44px;padding:0 12px;border-bottom:1px solid var(--border)}
.srch input{flex:1;min-width:0;height:42px;border:0;padding:0;outline:0;background:transparent;font:400 14px/1.5 'Noto Sans Thai',sans-serif;color:var(--pop-fg)}
.srch input::placeholder{color:var(--muted-fg)}
.caret{flex:none;width:1.5px;height:20px;background:var(--pop-fg);margin-right:-8px}
.typed{flex:none;font:400 14px/1.5 'Noto Sans Thai',sans-serif;color:var(--pop-fg);margin-right:-8px}
.list{box-sizing:border-box;height:300px;padding:4px;overflow:hidden;position:relative}
.list.auto{height:auto}
.scroll{position:absolute;right:2px;width:4px;border-radius:2px;background:var(--border)}
.opt{box-sizing:border-box;display:flex;align-items:center;gap:8px;min-height:44px;padding:8px;border-radius:6px;font:400 14px/1.375 'Noto Sans Thai',sans-serif;color:var(--pop-fg)}
.opt.hl{background:var(--accent);color:var(--accent-fg)}
.opt.off{color:var(--muted-fg);cursor:not-allowed}
.main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.name{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.sub{font-size:12px;line-height:1.5;color:var(--muted-fg);white-space:normal}
.chk{flex:none;width:16px;height:16px;color:var(--primary)}
.msg{display:flex;flex-direction:column;align-items:center;gap:12px;padding:28px 12px;font:400 14px/1.5 'Noto Sans Thai',sans-serif;color:var(--muted-fg);text-align:center}
.msg-row{display:flex;align-items:center;gap:8px}
.err{color:var(--destructive)}
.btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;padding:0 12px;border-radius:6px;font:500 13px/1 'Noto Sans Thai',sans-serif;cursor:pointer}
.btn-o{border:1px solid var(--input);background:var(--field);color:var(--fg)}
.btn-p{border:1px solid var(--primary);background:var(--primary);color:var(--primary-fg)}
.fld{box-sizing:border-box;width:100%;height:44px;padding:0 12px;border:1px solid var(--input);border-radius:8px;background:var(--field);box-shadow:0 1px 2px rgba(0,0,0,.05);font:400 14px/1.5 'Noto Sans Thai',sans-serif;color:var(--fg)}
.keys{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:10px;font:400 14px/1.5 'Noto Sans Thai',sans-serif;color:var(--fg)}
.kbd{display:inline-block;min-width:28px;padding:1px 6px;margin-right:6px;border:1px solid var(--input);border-radius:4px;background:var(--field);font:500 12px/1.5 ui-monospace,Consolas,monospace;text-align:center;color:var(--fg)}
</style>
</helmet>
<div class="board t-light">
  <div style="display: flex; flex-direction: column; gap: 6px">
    <h1 style="margin: 0; font-size: 26px; font-weight: 700; line-height: 1.35">Combobox — dropdown ค้นหาได้ (จอใหญ่ · สว่าง)</h1>
    <p style="margin: 0; font-size: 15px; line-height: 1.6; color: var(--muted-fg)">ใช้กับรายการยาว 23 ช่องในภาคผนวก ค + ที่อยู่ + ผังบัญชี + ช่องค้นหาเดิม 6 ตัว · ความสูง มุม ขอบ และป้ายชื่อเหมือนช่องกรอกรอบ 1 · แถวในรายการสูง 44px เท่ากับ dropdown เดิมของระบบ</p>
  </div>

  <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; align-items: start">

    <div class="card">
      <span class="chip">1 · ปิด</span>
      <p class="desc">ปุ่มหน้าตาเดียวกับช่องกรอก (สูง 44px มุม 8px ขอบเทาเข้ม) · ลูกศรขวาแบบ dropdown เดิม · ค่ายาวตัดท้ายด้วย … และเห็นเต็มเมื่อชี้</p>
      <div style="display: flex; flex-direction: column; gap: 16px">
        <div><label class="lbl" for="c1a">ผู้รับมอบหมาย</label><button class="trg" id="c1a" type="button" role="combobox" aria-expanded="false"><span class="ph">เลือก…</span><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button></div>
        <div><label class="lbl" for="c1b">ผู้รับผิดชอบ</label><button class="trg focus" id="c1b" type="button" role="combobox" aria-expanded="false"><span class="val">ปิยะพร วงศ์ใหญ่</span><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button><p class="hint">กรอบสีเขียวเมื่อกด Tab มาถึงช่อง</p></div>
        <div><label class="lbl" for="c1c">บัญชีรายได้</label><button class="trg" id="c1c" type="button" role="combobox" aria-expanded="false" ><span class="val" title="42-1108 - รายได้อื่น-ภาษีซื้อของสินค้าที่ขายผ่อน">42-1108 - รายได้อื่น-ภาษีซื้อของสินค้าที่ขายผ่อน</span><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button></div>
        <div><label class="lbl" for="c1d">รุ่น</label><button class="trg" id="c1d" type="button" role="combobox" aria-expanded="false" disabled><span class="ph">เลือก…</span><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button><p class="hint">เลือกยี่ห้อก่อน (ช่องปิดอยู่)</p></div>
      </div>
    </div>

    <div class="card">
      <span class="chip">2 · เปิด</span>
      <p class="desc">คลิก/แตะ หรือกด ↓ Enter Space · กล่องรายการกว้างเท่าช่อง (อย่างน้อย 256px) · เลื่อนไปที่ค่าที่เลือกอยู่และไฮไลต์ไว้ · ช่องค้นหาพร้อมพิมพ์</p>
      <div>
        <label class="lbl" for="c2">จังหวัด *</label><button class="trg" id="c2" type="button" role="combobox" aria-expanded="true"><span class="val">ชลบุรี</span><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button>
        <div class="pop">
          <div class="srch"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg><span class="caret" aria-hidden="true"></span><input type="text" aria-label="ค้นหา" placeholder="พิมพ์เพื่อค้นหา…"></div>
          <div class="list">
            <div style="margin-top: -20px">
              <div class="opt"><span class="main"><span class="name">กาญจนบุรี</span></span></div>
              <div class="opt"><span class="main"><span class="name">กาฬสินธุ์</span></span></div>
              <div class="opt"><span class="main"><span class="name">กำแพงเพชร</span></span></div>
              <div class="opt"><span class="main"><span class="name">ขอนแก่น</span></span></div>
              <div class="opt"><span class="main"><span class="name">จันทบุรี</span></span></div>
              <div class="opt"><span class="main"><span class="name">ฉะเชิงเทรา</span></span></div>
              <div class="opt hl"><span class="main"><span class="name">ชลบุรี</span></span><svg class="chk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg></div>
            </div>
            <span class="scroll" style="top: 30px; height: 70px"></span>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <span class="chip">3 · ค้นหา (ภาษาไทย)</span>
      <p class="desc">พิมพ์ ช → ขึ้นต้นด้วย ช ก่อน → ขึ้นต้นหลังสระนำ (เชียง…) → มี ช กลางคำ · ผลแรกไฮไลต์ให้ กด Enter เลือกได้ทันที · พิมพ์ นํ้า เเ หรือเลขไทยก็เจอ</p>
      <div>
        <label class="lbl" for="c3">จังหวัด *</label><button class="trg" id="c3" type="button" role="combobox" aria-expanded="true"><span class="ph">เลือก…</span><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button>
        <div class="pop">
          <div class="srch"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg><span class="typed">ช</span><span class="caret" aria-hidden="true"></span><input type="text" aria-label="ค้นหา" value=""></div>
          <div class="list">
            <div class="opt hl"><span class="main"><span class="name">ชลบุรี</span></span></div>
            <div class="opt"><span class="main"><span class="name">ชัยนาท</span></span></div>
            <div class="opt"><span class="main"><span class="name">ชัยภูมิ</span></span></div>
            <div class="opt"><span class="main"><span class="name">ชุมพร</span></span></div>
            <div class="opt"><span class="main"><span class="name">เชียงราย</span></span></div>
            <div class="opt"><span class="main"><span class="name">เชียงใหม่</span></span></div>
            <div class="opt"><span class="main"><span class="name">กำแพงเพชร</span></span></div>
            <span class="scroll" style="top: 6px; height: 128px"></span>
          </div>
        </div>
        <p class="hint">ทั้งหมด 14 รายการ: ขึ้นต้นด้วย ช 4 · เชียงราย เชียงใหม่ 2 · มี ช กลางคำ 8 (กำแพงเพชร ฉะเชิงเทรา นครราชสีมา …)</p>
      </div>
    </div>

    <div class="card">
      <span class="chip">4 · ไม่พบ</span>
      <p class="desc">ไม่มีรายการตรงคำค้น — ขึ้น "ไม่พบรายการ" · แก้คำค้น หรือกด Esc ปิดโดยไม่เปลี่ยนค่า</p>
      <div>
        <label class="lbl" for="c4">จังหวัด *</label><button class="trg" id="c4" type="button" role="combobox" aria-expanded="true"><span class="ph">เลือก…</span><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button>
        <div class="pop">
          <div class="srch"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg><span class="typed">ชลบุลี</span><span class="caret" aria-hidden="true"></span><input type="text" aria-label="ค้นหา" value=""></div>
          <div class="list auto"><div class="msg">ไม่พบรายการ</div></div>
        </div>
      </div>
    </div>

    <div class="card">
      <span class="chip">5 · กำลังโหลด</span>
      <p class="desc">รายการจากเซิร์ฟเวอร์ยังไม่มา — ขึ้น "กำลังโหลด…" ในกล่อง · พิมพ์ค้นหาต่อได้</p>
      <div>
        <label class="lbl" for="c5">ผู้จัดจำหน่าย</label><button class="trg" id="c5" type="button" role="combobox" aria-expanded="true"><span class="ph">เลือก…</span><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button>
        <div class="pop">
          <div class="srch"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg><span class="caret" aria-hidden="true"></span><input type="text" aria-label="ค้นหา" placeholder="พิมพ์เพื่อค้นหา…"></div>
          <div class="list auto"><div class="msg"><span class="msg-row"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>กำลังโหลด…</span></div></div>
        </div>
      </div>
    </div>

    <div class="card">
      <span class="chip">6 · ผิดพลาด (ลองใหม่)</span>
      <p class="desc">โหลดไม่สำเร็จ — ข้อความสีแดง + ปุ่ม "ลองใหม่" (ปุ่มอยู่นอกส่วนรายการ จึงกด Enter ที่ปุ่มได้)</p>
      <div>
        <label class="lbl" for="c6">ลูกค้า</label><button class="trg" id="c6" type="button" role="combobox" aria-expanded="true"><span class="ph">เลือก…</span><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button>
        <div class="pop">
          <div class="srch"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg><span class="typed">สมช</span><span class="caret" aria-hidden="true"></span><input type="text" aria-label="ค้นหา" value=""></div>
          <div class="list auto"><div class="msg"><span class="msg-row err"><svg class="ico" style="color: var(--destructive)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" x2="12" y1="8" y2="12"></line><line x1="12" x2="12.01" y1="16" y2="16"></line></svg>โหลดรายการไม่สำเร็จ</span><button class="btn btn-o" type="button"><svg class="ico" style="color: var(--fg)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>ลองใหม่</button></div></div>
        </div>
      </div>
    </div>

    <div class="card">
      <span class="chip">7 · ตัวเลือกที่เลือกไม่ได้</span>
      <p class="desc">เหตุผลเป็นข้อความบรรทัดที่สองในแถว (ไม่ใช่ tooltip) · สีรองแต่ไม่จาง อ่านออก · ลูกศรขึ้นลงข้ามแถวนี้ · ตัวเลือกบัญชีแบบค้นหาแสดง "เลขบัญชี - ชื่อ" ใต้หัวข้อกลุ่มบัญชี (ตัดสินแล้ว 16 พ.ย.)</p>
      <div>
        <label class="lbl" for="c7">บัญชีรายได้</label><button class="trg" id="c7" type="button" role="combobox" aria-expanded="true"><span class="val">42-1102 - ดอกเบี้ยเงินฝาก</span><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button>
        <div class="pop">
          <div class="srch"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg><span class="caret" aria-hidden="true"></span><input type="text" aria-label="ค้นหา" placeholder="ค้นหารหัส หรือ ชื่อบัญชี"></div>
          <div class="list">
            <div class="grp">รายได้อื่น</div>
            <div class="opt hl"><span class="main"><span class="name">42-1102 - ดอกเบี้ยเงินฝาก</span></span><svg class="chk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg></div>
            <div class="opt"><span class="main"><span class="name">42-1103 - ค่าปรับชำระล่าช้า</span></span></div>
            <div class="opt off" aria-disabled="true"><span class="main"><span class="name">42-1104 - รายได้จากการหักค่าจ้าง</span><span class="sub">ยังไม่รองรับ — รอ payroll module</span></span></div>
            <div class="opt"><span class="main"><span class="name">42-1105 - กำไรจากการจำหน่ายสินทรัพย์</span></span></div>
            <div class="opt"><span class="main"><span class="name">42-1106 - หนี้สูญได้รับคืน</span></span></div>
            <div class="opt"><span class="main"><span class="name">42-1107 - ส่วนลดรับ</span></span></div>
            <span class="scroll" style="top: 6px; height: 200px"></span>
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="grid-column: span 2">
      <span class="chip">8 · ในหน้าต่าง (Dialog)</span>
      <p class="desc">รายการลอยเหนือหน้าต่าง ไม่ถูกขอบหน้าต่างตัด · เลื่อนรายการด้วยล้อเมาส์/นิ้วได้แม้หน้าต่างล็อกการเลื่อน · Esc ครั้งแรกปิดเฉพาะรายการ ครั้งที่สองปิดหน้าต่าง</p>
      <div style="display: grid; grid-template-columns: 460px minmax(0, 1fr); gap: 24px; align-items: start">
        <div style="position: relative; height: 640px; border-radius: 8px; background: var(--scrim); overflow: hidden">
          <div style="position: absolute; left: 10px; top: 24px; width: 440px; box-sizing: border-box; padding: 24px; border: 1px solid var(--border); border-radius: 8px; background: var(--page); color: var(--fg); box-shadow: var(--shadow)">
            <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px">
              <h2 style="margin: 0; font-size: 18px; font-weight: 600; line-height: 1.375">เพิ่มงานใหม่</h2>
              <button type="button" aria-label="ปิด" style="width: 44px; height: 44px; margin: -12px -12px 0 0; border: 0; border-radius: 6px; background: transparent; color: var(--muted-fg); display: flex; align-items: center; justify-content: center; cursor: pointer"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button>
            </div>
            <div style="display: flex; flex-direction: column; gap: 16px">
              <div><label class="lbl" for="c8a">ชื่องาน *</label><input class="fld" id="c8a" type="text" value="โทรติดตามลูกค้าค้างงวดที่ 3"></div>
              <div>
                <label class="lbl" for="c8b">ผู้รับมอบหมาย</label><button class="trg" id="c8b" type="button" role="combobox" aria-expanded="true"><span class="val">ชนิดา บุญมา</span><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button>
                <div style="position: relative; height: 0">
                  <div class="pop" style="position: absolute; left: 0; right: 0; top: 0; z-index: 2">
                    <div class="srch"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg><span class="caret" aria-hidden="true"></span><input type="text" aria-label="ค้นหา" placeholder="พิมพ์เพื่อค้นหา…"></div>
                    <div class="list">
                      <div class="opt"><span class="main"><span class="name">กมลชนก ศรีสุข</span></span></div>
                      <div class="opt hl"><span class="main"><span class="name">ชนิดา บุญมา</span></span><svg class="chk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg></div>
                      <div class="opt"><span class="main"><span class="name">ณัฐพล แก้วกาญจนา</span></span></div>
                      <div class="opt"><span class="main"><span class="name">ธนากร ใจดี</span></span></div>
                      <div class="opt"><span class="main"><span class="name">ปิยะพร วงศ์ใหญ่</span></span></div>
                      <div class="opt"><span class="main"><span class="name">พงศกร สมบูรณ์</span></span></div>
                      <div class="opt"><span class="main"><span class="name">วรรณิภา ทองดี</span></span></div>
                      <span class="scroll" style="top: 6px; height: 150px"></span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 10px; padding-top: 20px">
              <button class="btn btn-o" type="button">ยกเลิก</button>
              <button class="btn btn-p" type="button">บันทึก</button>
            </div>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 14px">
          <span style="font: 600 15px/1.5 'Noto Sans Thai', sans-serif">แป้นพิมพ์</span>
          <ul class="keys">
            <li><span class="kbd">↓</span><span class="kbd">Enter</span><span class="kbd">Space</span>บนช่อง = เปิดรายการ</li>
            <li><span class="kbd">ก</span>พิมพ์ตัวอักษรบนช่อง = เปิดและเริ่มค้นหาด้วยตัวนั้นทันที</li>
            <li><span class="kbd">↑</span><span class="kbd">↓</span>เลื่อนไฮไลต์ (ข้ามตัวที่เลือกไม่ได้)</li>
            <li><span class="kbd">Enter</span>เลือกตัวที่ไฮไลต์แล้วปิด</li>
            <li><span class="kbd">Esc</span>ปิดเฉพาะรายการ ค่าเดิมไม่เปลี่ยน</li>
          </ul>
          <p class="desc">โปรแกรมอ่านหน้าจออ่านชื่อช่องจากป้ายชื่อเสมอ (เช่น "ผู้รับมอบหมาย") ไม่เปลี่ยนตามค่าที่เลือก</p>
        </div>
      </div>
    </div>

  </div>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":1200,"height":2080}}'>
class Component extends DCLogic {
  renderVals() {
    return {};
  }
}
</script>
</body>
</html>
```

Content per state (what the owner sees):

| # | Field (label) | Shown | Menu content, top to bottom |
|---|---|---|---|
| 1 ปิด | `ผู้รับมอบหมาย` · `ผู้รับผิดชอบ` · `บัญชีรายได้` · `รุ่น` | `เลือก…` · `ปิยะพร วงศ์ใหญ่` with the Tab focus ring · `42-1108 - รายได้อื่น-ภาษีซื้อของสินค้าที่ขายผ่อน` cut with … · disabled `เลือก…` + hint `เลือกยี่ห้อก่อน (ช่องปิดอยู่)` | closed |
| 2 เปิด | `จังหวัด *` | `ชลบุรี` | search empty (placeholder, caret) · list scrolled so the current value is the last full row: (cut) กาญจนบุรี, กาฬสินธุ์, กำแพงเพชร, ขอนแก่น, จันทบุรี, ฉะเชิงเทรา, **ชลบุรี ✓ highlighted** |
| 3 ค้นหา | `จังหวัด *` | `เลือก…` | search `ช` · **ชลบุรี (highlighted)**, ชัยนาท, ชัยภูมิ, ชุมพร, เชียงราย, เชียงใหม่, กำแพงเพชร (scrolls on) — exactly Task 3's `filterAndRank(provinces, 'ช')` order; hint `ทั้งหมด 14 รายการ …` |
| 4 ไม่พบ | `จังหวัด *` | `เลือก…` | search `ชลบุลี` · `ไม่พบรายการ` |
| 5 กำลังโหลด | `ผู้จัดจำหน่าย` | `เลือก…` | search empty · spinner + `กำลังโหลด…` |
| 6 ผิดพลาด | `ลูกค้า` | `เลือก…` | search `สมช` · alert icon + `โหลดรายการไม่สำเร็จ` (red) · button `ลองใหม่` |
| 7 ตัวเลือกปิด | `บัญชีรายได้` | `42-1102 - ดอกเบี้ยเงินฝาก` | search placeholder `ค้นหารหัส หรือ ชื่อบัญชี` · group heading `รายได้อื่น` · **42-1102 - ดอกเบี้ยเงินฝาก ✓ highlighted**, 42-1103 - ค่าปรับชำระล่าช้า, 42-1104 - รายได้จากการหักค่าจ้าง (disabled, second line `ยังไม่รองรับ — รอ payroll module`), 42-1105 - กำไรจากการจำหน่ายสินทรัพย์, 42-1106 - หนี้สูญได้รับคืน, 42-1107 - ส่วนลดรับ |
| 8 ในหน้าต่าง | dialog `เพิ่มงานใหม่`: `ชื่องาน *` = `โทรติดตามลูกค้าค้างงวดที่ 3`, `ผู้รับมอบหมาย` | `ชนิดา บุญมา` | menu runs past the dialog's bottom edge over the dimmed page: กมลชนก ศรีสุข, **ชนิดา บุญมา ✓ highlighted**, ณัฐพล แก้วกาญจนา, ธนากร ใจดี, ปิยะพร วงศ์ใหญ่, พงศกร สมบูรณ์, วรรณิภา ทองดี; next to it the keyboard legend (↓ Enter Space / type a letter / ↑↓ skip disabled / Enter / Esc) |

The dimmed page behind the dialog is `bg-foreground/60` as the real `DialogOverlay` draws it (`dialog.tsx:45`): dark grey in light mode, light grey in dark mode.

- [ ] **Step 3: Write `<ROOT>/project/ComboboxMobileLight.dc.html`**

The 390 state, light: page `เพิ่มลูกค้าใหม่`, card `ที่อยู่ตามบัตรประชาชน`, `บ้านเลขที่` = `99/12`, `จังหวัด *` = `เชียงใหม่` open. The **list has focus** (no caret in the search box, no keyboard on screen, the `ยกเลิก` / `บันทึกลูกค้า` bar still visible), scrolled so the current value is the last full row: (cut) อุดรธานี, อุตรดิตถ์, อุทัยธานี, อุบลราชธานี, อ่างทอง, เชียงราย, **เชียงใหม่ ✓ highlighted**. Under the menu: `อำเภอ/เขต *` = `อำเภอเมืองเชียงใหม่`, `ตำบล/แขวง *` = `ตำบลศรีภูมิ`, read-only `รหัสไปรษณีย์` = `50200`. Field and search text 16px (the global rule below 1024px), rows 14px. Exact file:

```html
<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<title>Combobox — มือถือ 390 (สว่าง)</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700&amp;display=swap" rel="stylesheet">
<style>
body{margin:0}
.t-light{--page:#f7f7f7;--card:#ffffff;--fg:#212121;--muted-fg:#666666;--border:#dbdbdb;--input:#8c8c8c;--field:#f7f7f7;--pop:#ffffff;--pop-fg:#212121;--accent:#e8e8e8;--accent-fg:#212121;--primary:#0a714e;--primary-fg:#ffffff;--ro:#f3f3f3;--shadow:0 4px 6px -1px rgba(0,0,0,.08),0 2px 4px -2px rgba(0,0,0,.06)}
.t-dark{--page:#171717;--card:#212121;--fg:#f0f0f0;--muted-fg:#b8b8b8;--border:#474747;--input:#787878;--field:#171717;--pop:#292929;--pop-fg:#f0f0f0;--accent:#3b3b3b;--accent-fg:#f5f5f5;--primary:#3fd9a6;--primary-fg:#0d211a;--ro:#2d2d2d;--shadow:0 4px 6px -1px rgba(0,0,0,.4),0 2px 4px -2px rgba(0,0,0,.3)}
.phone{box-sizing:border-box;position:relative;width:390px;height:844px;overflow:hidden;background:var(--page);color:var(--fg);font-family:'Noto Sans Thai',sans-serif}
.bar{box-sizing:border-box;display:flex;align-items:center;gap:4px;height:56px;padding:0 6px;background:var(--card);border-bottom:1px solid var(--border)}
.iconbtn{width:44px;height:44px;border:0;border-radius:6px;background:transparent;color:var(--fg);display:flex;align-items:center;justify-content:center;cursor:pointer}
.ico{flex:none;width:16px;height:16px;color:var(--muted-fg)}
.card{box-sizing:border-box;margin:16px;padding:16px;background:var(--card);border:1px solid var(--border);border-radius:12px;display:flex;flex-direction:column;gap:16px}
.lbl{display:block;margin:0 0 12px;font:500 14px/1.375 'Noto Sans Thai',sans-serif;color:var(--fg)}
.fld{box-sizing:border-box;width:100%;height:44px;padding:0 12px;border:1px solid var(--input);border-radius:8px;background:var(--field);box-shadow:0 1px 2px rgba(0,0,0,.05);font:400 16px/1.5 'Noto Sans Thai',sans-serif;color:var(--fg)}
.ro{box-sizing:border-box;display:flex;align-items:center;width:100%;height:44px;padding:0 12px;border:1px solid var(--input);border-radius:8px;background:var(--ro);font:400 16px/1.5 'Noto Sans Thai',sans-serif;color:var(--fg);font-variant-numeric:tabular-nums}
.trg{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;height:44px;padding:0 12px;border:1px solid var(--input);border-radius:8px;background:var(--field);box-shadow:0 1px 2px rgba(0,0,0,.05);font:400 16px/1.5 'Noto Sans Thai',sans-serif;color:var(--fg);text-align:left;cursor:pointer}
.val{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.pop{box-sizing:border-box;position:absolute;left:0;right:0;top:48px;z-index:2;border:1px solid var(--border);border-radius:6px;background:var(--pop);color:var(--pop-fg);box-shadow:var(--shadow);overflow:hidden}
.srch{display:flex;align-items:center;gap:8px;height:44px;padding:0 12px;border-bottom:1px solid var(--border)}
.srch input{flex:1;min-width:0;height:42px;border:0;padding:0;outline:0;background:transparent;font:400 16px/1.5 'Noto Sans Thai',sans-serif;color:var(--pop-fg)}
.srch input::placeholder{color:var(--muted-fg)}
.list{box-sizing:border-box;height:300px;padding:4px;overflow:hidden;position:relative}
.scroll{position:absolute;right:2px;width:4px;border-radius:2px;background:var(--border)}
.opt{box-sizing:border-box;display:flex;align-items:center;gap:8px;min-height:44px;padding:8px;border-radius:6px;font:400 14px/1.375 'Noto Sans Thai',sans-serif;color:var(--pop-fg)}
.opt.hl{background:var(--accent);color:var(--accent-fg)}
.chk{flex:none;width:16px;height:16px;margin-left:auto;color:var(--primary)}
.foot{box-sizing:border-box;position:absolute;left:0;right:0;bottom:0;display:flex;gap:12px;padding:12px 16px;background:var(--card);border-top:1px solid var(--border)}
.btn{box-sizing:border-box;flex:1;height:44px;border-radius:6px;font:500 16px/1 'Noto Sans Thai',sans-serif;cursor:pointer}
.btn-o{border:1px solid var(--input);background:var(--field);color:var(--fg)}
.btn-p{border:1px solid var(--primary);background:var(--primary);color:var(--primary-fg)}
</style>
</helmet>
<div class="phone t-light">
  <div class="bar">
    <button class="iconbtn" type="button" aria-label="เมนู"><svg style="width: 20px; height: 20px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16"></path><path d="M4 12h16"></path><path d="M4 18h16"></path></svg></button>
    <span style="font-size: 18px; font-weight: 600; line-height: 1.375">เพิ่มลูกค้าใหม่</span>
  </div>
  <div class="card">
    <span style="font-size: 16px; font-weight: 600; line-height: 1.5">ที่อยู่ตามบัตรประชาชน</span>
    <div><label class="lbl" for="m1">บ้านเลขที่</label><input class="fld" id="m1" type="text" value="99/12"></div>
    <div style="position: relative">
      <label class="lbl" for="m2">จังหวัด *</label><button class="trg" id="m2" type="button" role="combobox" aria-expanded="true"><span class="val">เชียงใหม่</span><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button>
      <div class="pop" style="top: 83px">
        <div class="srch"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg><input type="text" aria-label="ค้นหา" placeholder="พิมพ์เพื่อค้นหา…"></div>
        <div class="list">
          <div style="margin-top: -20px">
            <div class="opt">อุดรธานี</div>
            <div class="opt">อุตรดิตถ์</div>
            <div class="opt">อุทัยธานี</div>
            <div class="opt">อุบลราชธานี</div>
            <div class="opt">อ่างทอง</div>
            <div class="opt">เชียงราย</div>
            <div class="opt hl">เชียงใหม่<svg class="chk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg></div>
          </div>
          <span class="scroll" style="top: 220px; height: 30px"></span>
        </div>
      </div>
    </div>
    <div><label class="lbl" for="m3">อำเภอ/เขต *</label><button class="trg" id="m3" type="button" role="combobox" aria-expanded="false"><span class="val">อำเภอเมืองเชียงใหม่</span><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button></div>
    <div><label class="lbl" for="m4">ตำบล/แขวง *</label><button class="trg" id="m4" type="button" role="combobox" aria-expanded="false"><span class="val">ตำบลศรีภูมิ</span><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button></div>
    <div><label class="lbl" for="m5">รหัสไปรษณีย์</label><output class="ro" id="m5">50200</output></div>
  </div>
  <div class="foot">
    <button class="btn btn-o" type="button">ยกเลิก</button>
    <button class="btn btn-p" type="button">บันทึกลูกค้า</button>
  </div>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":390,"height":844}}'>
class Component extends DCLogic {
  renderVals() {
    return {};
  }
}
</script>
</body>
</html>
```

- [ ] **Step 4: Write `<ROOT>/project/ComboboxChecks.dc.html`**

Phone behaviour in words, the contrast table (numbers from Step 9's script; light and dark), and the read-only row (spec §9) in both themes: `ราคา/หน่วย` 12,500.00 · `บัญชีค่าใช้จ่าย` = `53-1301 - ค่าน้ำ` · read-only `ก่อนภาษี` 12,500.00. Exact file:

```html
<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<title>Combobox — มือถือและความต่างสี</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700&amp;display=swap" rel="stylesheet">
<style>
body{margin:0}
.t-light{--page:#f7f7f7;--card:#ffffff;--fg:#212121;--muted-fg:#666666;--border:#dbdbdb;--input:#8c8c8c;--field:#f7f7f7;--primary:#0a714e;--destructive:#b81919;--ro:#f3f3f3}
.t-dark{--page:#171717;--card:#212121;--fg:#f0f0f0;--muted-fg:#b8b8b8;--border:#474747;--input:#787878;--field:#171717;--primary:#3fd9a6;--destructive:#f77e7e;--ro:#2d2d2d}
.board{box-sizing:border-box;width:1540px;height:1180px;padding:40px 48px;background:var(--page);color:var(--fg);font-family:'Noto Sans Thai',sans-serif;display:flex;flex-direction:column;gap:28px}
.card{box-sizing:border-box;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px 24px;display:flex;flex-direction:column;gap:14px;min-width:0}
.h2{margin:0;font:600 17px/1.5 'Noto Sans Thai',sans-serif;color:var(--fg)}
.desc{margin:0;font:400 13px/1.6 'Noto Sans Thai',sans-serif;color:var(--muted-fg)}
.bul{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:10px;font:400 14px/1.6 'Noto Sans Thai',sans-serif;color:var(--fg)}
table{width:100%;border-collapse:collapse;font:400 13px/1.5 'Noto Sans Thai',sans-serif;color:var(--fg)}
th{text-align:left;font-weight:600;color:var(--muted-fg);padding:6px 8px;border-bottom:1px solid var(--border)}
td{padding:5px 8px;border-bottom:1px solid var(--border);vertical-align:top}
td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.res{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.res svg{width:14px;height:14px;flex:none}
.ok svg{color:var(--primary)}
.bad{color:var(--destructive);font-weight:600}
.info{color:var(--muted-fg)}
.lbl{display:block;margin:0 0 12px;font:500 14px/1.375 'Noto Sans Thai',sans-serif;color:var(--fg)}
.fld{box-sizing:border-box;width:100%;height:44px;padding:0 12px;border:1px solid var(--input);border-radius:8px;background:var(--field);box-shadow:0 1px 2px rgba(0,0,0,.05);font:400 14px/1.5 'Noto Sans Thai',sans-serif;color:var(--fg);text-align:right;font-variant-numeric:tabular-nums}
.ro{box-sizing:border-box;display:flex;align-items:center;justify-content:flex-end;width:100%;height:44px;padding:0 12px;border:1px solid var(--input);border-radius:8px;background:var(--ro);font:500 14px/1.5 'Noto Sans Thai',sans-serif;color:var(--fg);font-variant-numeric:tabular-nums}
.trg{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;height:44px;padding:0 12px;border:1px solid var(--input);border-radius:8px;background:var(--field);box-shadow:0 1px 2px rgba(0,0,0,.05);font:400 14px/1.5 'Noto Sans Thai',sans-serif;color:var(--fg);text-align:left;cursor:pointer}
.val{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.ico{flex:none;width:16px;height:16px;color:var(--muted-fg)}
</style>
</helmet>
<div class="board t-light">
  <div style="display: flex; flex-direction: column; gap: 6px">
    <h1 style="margin: 0; font-size: 26px; font-weight: 700; line-height: 1.35">Combobox — บนมือถือ และตรวจความต่างสี</h1>
    <p style="margin: 0; font-size: 15px; line-height: 1.6; color: var(--muted-fg)">ตัวเลขวัดจากสีจริงของหน้าจอหลังบ้าน (สว่างและมืด) · ตัวอักษรต้องได้อย่างน้อย 4.5:1 · เส้นขอบและไอคอนอย่างน้อย 3:1 (มาตรฐาน WCAG 2.1 AA) · ช่องที่ปิดอยู่ไม่อยู่ในเกณฑ์</p>
  </div>

  <div style="display: grid; grid-template-columns: 440px minmax(0, 1fr); gap: 24px; align-items: start">
    <div class="card">
      <span class="h2">บนมือถือ (จอ 390px — ภาพซ้ายมือ)</span>
      <ul class="bul">
        <li>แตะช่อง → รายการเปิดกว้างเท่าช่อง เลื่อนไปที่ค่าที่เลือกอยู่ (เชียงใหม่) และไฮไลต์ไว้</li>
        <li>คีย์บอร์ดยังไม่เด้ง เพราะโฟกัสอยู่ที่รายการ ไม่ใช่ช่องค้นหา — แตะช่องค้นหาเมื่ออยากพิมพ์</li>
        <li>แตะชื่อ = เลือกแล้วปิดทันที · แตะนอกกล่อง = ปิด ค่าเดิมไม่เปลี่ยน</li>
        <li>แถวสูง 44px ทุกแถว นิ้วแตะได้ไม่พลาด</li>
        <li>ตัวอักษรในช่องและช่องค้นหา 16px (iPhone ไม่ซูมหน้าจอ) · ในรายการ 14px</li>
        <li>ปุ่มบันทึกด้านล่างยังมองเห็น เพราะไม่มีคีย์บอร์ดบัง</li>
      </ul>
    </div>

    <div class="card">
      <span class="h2">ความต่างสี</span>
      <table>
        <thead>
          <tr><th>จุดที่ตรวจ</th><th style="text-align: right">เกณฑ์</th><th style="text-align: right">สว่าง</th><th style="text-align: right">มืด</th><th>ผล</th></tr>
        </thead>
        <tbody>
          <tr><td>ค่าที่เลือกในช่อง</td><td class="n">4.5</td><td class="n">15.03</td><td class="n">15.73</td><td><span class="res ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>ผ่าน</span></td></tr>
          <tr><td>ข้อความ "เลือก…" ในช่อง</td><td class="n">4.5</td><td class="n">5.36</td><td class="n">9.04</td><td><span class="res ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>ผ่าน</span></td></tr>
          <tr><td>เส้นขอบช่อง (เทียบพื้นการ์ด)</td><td class="n">3</td><td class="n">3.36</td><td class="n">3.65</td><td><span class="res ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>ผ่าน</span></td></tr>
          <tr><td>ลูกศรในช่อง</td><td class="n">3</td><td class="n">5.36</td><td class="n">9.04</td><td><span class="res ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>ผ่าน</span></td></tr>
          <tr><td>ตัวเลือกในรายการ</td><td class="n">4.5</td><td class="n">16.10</td><td class="n">12.77</td><td><span class="res ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>ผ่าน</span></td></tr>
          <tr><td>แถวที่ไฮไลต์</td><td class="n">4.5</td><td class="n">13.14</td><td class="n">10.27</td><td><span class="res ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>ผ่าน</span></td></tr>
          <tr><td>ข้อความรอง · หัวกลุ่ม · "ไม่พบรายการ" · "กำลังโหลด…" · ข้อความในช่องค้นหา</td><td class="n">4.5</td><td class="n">5.74</td><td class="n">7.33</td><td><span class="res ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>ผ่าน</span></td></tr>
          <tr><td>ข้อความรองในแถวที่ไฮไลต์</td><td class="n">4.5</td><td class="n">4.69</td><td class="n">5.65</td><td><span class="res ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>ผ่าน</span></td></tr>
          <tr><td>เครื่องหมายถูกหน้าค่าที่เลือก</td><td class="n">3</td><td class="n">6.03</td><td class="n">8.10</td><td><span class="res ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>ผ่าน</span></td></tr>
          <tr><td>"โหลดรายการไม่สำเร็จ" (สีแดง)</td><td class="n">4.5</td><td class="n">6.58</td><td class="n">5.71</td><td><span class="res ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>ผ่าน</span></td></tr>
          <tr><td>ตัวเลือกที่เลือกไม่ได้ — แบบในภาพ (สีรอง ไม่จาง)</td><td class="n">4.5</td><td class="n">5.74</td><td class="n">7.33</td><td><span class="res ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>ผ่าน</span></td></tr>
          <tr><td>ตัวเลือกที่เลือกไม่ได้ — แบบตั้งต้นของชุดเครื่องมือ (จาง 50%) ชื่อ / เหตุผล</td><td class="n">4.5</td><td class="n">3.19 / 2.10</td><td class="n">4.38 / 2.98</td><td><span class="res bad"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>ไม่ผ่าน — ไม่ใช้</span></td></tr>
          <tr><td>ค่าอ่านอย่างเดียว — ตัวอักษร</td><td class="n">4.5</td><td class="n">14.51</td><td class="n">12.08</td><td><span class="res ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>ผ่าน</span></td></tr>
          <tr><td>ค่าอ่านอย่างเดียว — เส้นขอบเทียบพื้นกล่อง</td><td class="n">3</td><td class="n">3.03</td><td class="n">3.12</td><td><span class="res ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>ผ่าน</span></td></tr>
          <tr><td>กรอบโฟกัส (กด Tab)</td><td class="n">3</td><td class="n">6.03</td><td class="n">8.96</td><td><span class="res ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>ผ่าน</span></td></tr>
          <tr><td>พื้นแถวที่ไฮไลต์ เทียบพื้นรายการ</td><td class="n">—</td><td class="n">1.23</td><td class="n">1.30</td><td><span class="res info">ข้อมูล — เท่ากับ dropdown เดิม</span></td></tr>
          <tr><td>พื้นค่าอ่านอย่างเดียว เทียบพื้นช่องพิมพ์</td><td class="n">—</td><td class="n">1.04</td><td class="n">1.30</td><td><span class="res info">ข้อมูล — แยกด้วยตัวเลขชิดขวา</span></td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="card">
    <span class="h2">ค่าอ่านอย่างเดียว ข้าง Combobox (สเปคข้อ 9 — ตรวจในจอมืด)</span>
    <p class="desc">แถวเดียวกันในการ์ดรายการ: ช่องพิมพ์ · Combobox · กล่องอ่านอย่างเดียว — สูง ขอบ และมุมเท่ากัน · กล่องอ่านอย่างเดียวพื้นเข้มขึ้นเล็กน้อย ตัวเลขชิดขวา ไม่มีเคอร์เซอร์</p>
    <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px">
      <div class="t-light" style="padding: 20px; border: 1px solid var(--border); border-radius: 12px; background: var(--card); color: var(--fg)">
        <div style="margin-bottom: 14px; font: 600 13px/1.5 'Noto Sans Thai', sans-serif; color: var(--muted-fg)">สว่าง</div>
        <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px">
          <div><label class="lbl" for="k1">ราคา/หน่วย</label><input class="fld" id="k1" type="text" value="12,500.00"></div>
          <div><label class="lbl" for="k2">บัญชีค่าใช้จ่าย</label><button class="trg" id="k2" type="button" role="combobox" aria-expanded="false"><span class="val">53-1301 - ค่าน้ำ</span><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button></div>
          <div><label class="lbl" for="k3">ก่อนภาษี</label><output class="ro" id="k3">12,500.00</output></div>
        </div>
      </div>
      <div class="t-dark" style="padding: 20px; border: 1px solid var(--border); border-radius: 12px; background: var(--card); color: var(--fg)">
        <div style="margin-bottom: 14px; font: 600 13px/1.5 'Noto Sans Thai', sans-serif; color: var(--muted-fg)">มืด</div>
        <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px">
          <div><label class="lbl" for="k4">ราคา/หน่วย</label><input class="fld" id="k4" type="text" value="12,500.00"></div>
          <div><label class="lbl" for="k5">บัญชีค่าใช้จ่าย</label><button class="trg" id="k5" type="button" role="combobox" aria-expanded="false"><span class="val">53-1301 - ค่าน้ำ</span><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button></div>
          <div><label class="lbl" for="k6">ก่อนภาษี</label><output class="ro" id="k6">12,500.00</output></div>
        </div>
      </div>
    </div>
  </div>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":1540,"height":1180}}'>
class Component extends DCLogic {
  renderVals() {
    return {};
  }
}
</script>
</body>
</html>
```

- [ ] **Step 5: Generate the two dark boards**

Save this as `<SCRATCH>/r2-tools/make-dark.mjs` (outside `ROOT`, so it is never published):

```js
// Writes the two dark boards from their light twins. Every colour lives in the
// .t-light / .t-dark blocks both files already carry, so the dark board is the
// light markup with the theme class and the theme word swapped.
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
if (!root) throw new Error('usage: node make-dark.mjs <root that holds project/>');

const jobs = [
  {
    from: 'ComboboxLight.dc.html',
    to: 'ComboboxDark.dc.html',
    swaps: [
      ['<title>Combobox — จอใหญ่ (สว่าง)</title>', '<title>Combobox — จอใหญ่ (มืด)</title>'],
      ['<div class="board t-light">', '<div class="board t-dark">'],
      ['(จอใหญ่ · สว่าง)</h1>', '(จอใหญ่ · มืด)</h1>'],
    ],
  },
  {
    from: 'ComboboxMobileLight.dc.html',
    to: 'ComboboxMobileDark.dc.html',
    swaps: [
      ['<title>Combobox — มือถือ 390 (สว่าง)</title>', '<title>Combobox — มือถือ 390 (มืด)</title>'],
      ['<div class="phone t-light">', '<div class="phone t-dark">'],
    ],
  },
];

for (const job of jobs) {
  let text = fs.readFileSync(path.join(root, 'project', job.from), 'utf8');
  for (const [from, to] of job.swaps) {
    const count = text.split(from).length - 1;
    if (count !== 1) throw new Error(`${job.from}: expected exactly one "${from}", found ${count}`);
    text = text.replace(from, to);
  }
  fs.writeFileSync(path.join(root, 'project', job.to), text);
  console.log(`wrote project/${job.to}`);
}
```

Run:

```bash
node "<SCRATCH>/r2-tools/make-dark.mjs" "<ROOT>"
```

Expected output exactly:

```text
wrote project/ComboboxDark.dc.html
wrote project/ComboboxMobileDark.dc.html
```

An `expected exactly one …` error means a light board differs from Steps 2–3 — recopy it.

- [ ] **Step 6: Write `<ROOT>/project/canvas.json`**

If Step 1's hash matched, overwrite it with exactly:

```json
{
  "v": 3,
  "createdOnFiles": { "v": 1, "at": "2026-11-14T10:40:00Z" },
  "title": "มาตรฐานช่องกรอก ก่อน/หลัง",
  "launch": { "view": "canvas" },
  "pages": [],
  "boards": {
    "Main.dc.html": { "x": 0, "y": 0, "w": 1200, "h": 760, "title": "มาตรฐานช่อง + ป้ายชื่อ 2 แบบ" },
    "Expense.dc.html": { "x": 1280, "y": 0, "w": 1200, "h": 760, "title": "บันทึกรายจ่าย — แถวรายการ" },
    "OtherIncome.dc.html": { "x": 0, "y": 880, "w": 1200, "h": 620, "title": "รายได้อื่น — แถวรายการ" },
    "AuditFilter.dc.html": { "x": 1280, "y": 880, "w": 1200, "h": 620, "title": "ประวัติการใช้งาน — แถบกรอง" },
    "ComboboxLight.dc.html": { "x": 0, "y": 1900, "w": 1200, "h": 2080, "title": "Combobox — จอใหญ่ (สว่าง)" },
    "ComboboxDark.dc.html": { "x": 1280, "y": 1900, "w": 1200, "h": 2080, "title": "Combobox — จอใหญ่ (มืด)" },
    "ComboboxMobileLight.dc.html": { "x": 0, "y": 4100, "w": 390, "h": 844, "title": "Combobox — มือถือ 390 (สว่าง)" },
    "ComboboxMobileDark.dc.html": { "x": 470, "y": 4100, "w": 390, "h": 844, "title": "Combobox — มือถือ 390 (มืด)" },
    "ComboboxChecks.dc.html": { "x": 940, "y": 4100, "w": 1540, "h": 1180, "title": "Combobox — มือถือและความต่างสี" }
  },
  "order": [
    "Main.dc.html",
    "Expense.dc.html",
    "OtherIncome.dc.html",
    "AuditFilter.dc.html",
    "ComboboxLight.dc.html",
    "ComboboxDark.dc.html",
    "ComboboxMobileLight.dc.html",
    "ComboboxMobileDark.dc.html",
    "ComboboxChecks.dc.html"
  ],
  "notes": {
    "r2combobox": { "x": 0, "y": 1660, "text": "Combobox — dropdown ค้นหาได้ (รอบ 2 · R2-0)", "kind": "title1", "maxW": 2480 }
  },
  "designSystems": []
}
```

New section layout: title note at y 1660 (≥ 223px above its row, 160px below the existing rows that end at y 1500), row 1 at y 1900 (light and dark desktop boards side by side like the existing pairs), row 2 at y 4100 = 1900 + 2080 + 120 (two phones 80px apart, then the checks board ending at x 2480 like row 1).

If the hash did not match: keep the file you read and change only these keys — add the five `ComboboxLight` / `ComboboxDark` / `ComboboxMobileLight` / `ComboboxMobileDark` / `ComboboxChecks` entries to `boards` (values as above; if the owner's own boards now sit lower than y 1500, add the same offset to every new `y` and to the note's `y`), append the five names to the end of `order`, add `notes.r2combobox` (keep any other notes).

- [ ] **Step 7: Publish — one Artifact call**

```json
{
  "action": "publish",
  "url": "https://claude.ai/artifact/P9HZMn9fL6V17TdWyG5QDn",
  "root": "<ROOT>",
  "file_path": "<ROOT>/project/canvas.json",
  "files": {
    "project/ComboboxLight.dc.html": "project/ComboboxLight.dc.html",
    "project/ComboboxDark.dc.html": "project/ComboboxDark.dc.html",
    "project/ComboboxMobileLight.dc.html": "project/ComboboxMobileLight.dc.html",
    "project/ComboboxMobileDark.dc.html": "project/ComboboxMobileDark.dc.html",
    "project/ComboboxChecks.dc.html": "project/ComboboxChecks.dc.html"
  },
  "label": "R2-0 Combobox mockup"
}
```

No `icon` (the canvas keeps its own). Expected: success with a new version id — note it for Step 10. If the publish is refused because someone saved the canvas meanwhile: read `project/canvas.json` again, redo Step 6's merge on what comes back, publish again; after a third refusal stop and tell the owner. Do not render, screenshot or re-read the published boards to check them (the canvas type's rule) — the owner's review in Step 8 is the check; the files were rendered while the plan was written (Appendix B).

- [ ] **Step 8: Ask the owner to approve**

Send the owner exactly this (fill in nothing — it has no blanks):

> กระดาน mockup ช่อง dropdown ค้นหาได้ (Combobox) อยู่บน canvas เดิม "มาตรฐานช่องกรอก ก่อน/หลัง" แล้วครับ — ใต้หัวข้อ "Combobox — dropdown ค้นหาได้ (รอบ 2 · R2-0)": https://claude.ai/artifact/P9HZMn9fL6V17TdWyG5QDn
> มี 8 สถานะบนจอใหญ่ (สว่าง และ มืด) · มือถือ 390 (สว่าง และ มืด) · ตารางตรวจความต่างสี + ค่าอ่านอย่างเดียวข้าง Combobox
> ขอให้ช่วยเคาะ 5 ข้อ:
> 1. แถวในรายการสูง 44px ทุกแถว เท่ากับ dropdown เดิมของระบบ — ใช้ได้ไหม
> 2. ตัวเลือกที่เลือกไม่ได้ (ภาพที่ 7) แสดงเหตุผลเป็นบรรทัดที่สอง สีรองแต่ไม่จาง — แบบจางของชุดเครื่องมืออ่านไม่ผ่านเกณฑ์ความต่างสี — ใช้ได้ไหม
> 3. มือถือ: แตะแล้วรายการเปิดโดยยังไม่เด้งคีย์บอร์ด ต้องแตะช่องค้นหาก่อนถึงจะพิมพ์ — ใช้ได้ไหม
> 4. ตัวเลือกบัญชีแบบค้นหาแสดง "เลขบัญชี - ชื่อ" + หัวข้อกลุ่มตามที่ตัดสินแล้ว (16 พ.ย.) — ช่องบัญชีที่รอบนี้แปลงจาก dropdown ธรรมดา (บิลประจำ, ตัวกรองประเภทค่าใช้จ่าย, บัญชีแยกประเภท, บทบาทบัญชี) ให้แสดงเลขบัญชีแบบเดียวกันไหม หรือคงแบบเดิมของแต่ละหน้า
> 5. แถวที่ไฮไลต์เป็นสีเทาอ่อน เท่ากับ dropdown เดิม — คงไว้ไหม
> ถ้าใช้ได้ทั้งหมดตอบ "อนุมัติ" ได้เลย หรือบอกข้อที่อยากเปลี่ยน — ยังไม่เริ่มเขียนโค้ด Combobox จนกว่าจะได้คำตอบครับ

Wait for the reply. Do not start Task 4.

- [ ] **Step 9: Apply requested changes (only if the owner asked for any)**

- Edit only the light boards (`ComboboxLight`, `ComboboxMobileLight`) and/or `ComboboxChecks` in `ROOT`, rerun Step 5, publish again with only the changed files (`files` lists them; `file_path` = one of them; no `canvas.json` unless a board's size changed — then also update its `h`, the row-2 `y` and `$preview`). Then send the owner the link again with one line per change, and wait.
- If a colour changes, recompute the table with this script (tokens = HSL triples from `admin-colors.css`), save it as `<SCRATCH>/r2-tools/contrast.mjs`, run `node "<SCRATCH>/r2-tools/contrast.mjs"`, and copy the new numbers into `ComboboxChecks.dc.html`:

```js
function hsl2rgb(h,s,l){s/=100;l/=100;const k=n=>(n+h/30)%12;const a=s*Math.min(l,1-l);const f=n=>l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1)));return [f(0),f(8),f(4)].map(x=>Math.round(x*255));}
const hex=c=>'#'+c.map(x=>x.toString(16).padStart(2,'0')).join('');
const lum=c=>{const [r,g,b]=c.map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});return 0.2126*r+0.7152*g+0.0722*b;};
const cr=(a,b)=>{const la=lum(a),lb=lum(b);return (Math.max(la,lb)+0.05)/(Math.min(la,lb)+0.05);};
const mix=(fg,bg,alpha)=>fg.map((v,i)=>Math.round(v*alpha+bg[i]*(1-alpha)));
const T={
 light:{background:[0,0,97],foreground:[0,0,13],card:[0,0,100],popover:[0,0,100],popoverFg:[0,0,13],muted:[0,0,94],mutedFg:[0,0,40],accent:[0,0,91],accentFg:[0,0,13],destructive:[0,76,41],primary:[160,84,24],border:[0,0,86],input:[0,0,55],ring:[160,84,24]},
 dark:{background:[0,0,9],foreground:[0,0,94],card:[0,0,13],popover:[0,0,16],popoverFg:[0,0,94],muted:[0,0,19],mutedFg:[0,0,72],accent:[0,0,23],accentFg:[0,0,96],destructive:[0,88,73],primary:[160,67,55],border:[0,0,28],input:[0,0,47],ring:[160,67,55]},
};
for (const [name,t] of Object.entries(T)){
  const c=Object.fromEntries(Object.entries(t).map(([k,v])=>[k,hsl2rgb(...v)]));
  const ro=mix(c.muted,c.card,0.8);
  const roPage=mix(c.muted,c.background,0.8);
  console.log('==',name, Object.entries(c).map(([k,v])=>k+'='+hex(v)).join(' '), 'readonly(card)='+hex(ro), 'readonly(page)='+hex(roPage));
  const rows=[
   ['value text: foreground on background (trigger)', c.foreground,c.background,4.5],
   ['placeholder: muted-fg on background', c.mutedFg,c.background,4.5],
   ['trigger border: input vs card', c.input,c.card,3],
   ['trigger border: input vs background', c.input,c.background,3],
   ['chevron: muted-fg on background', c.mutedFg,c.background,3],
   ['option text: popover-fg on popover', c.popoverFg,c.popover,4.5],
   ['highlighted row text: accent-fg on accent', c.accentFg,c.accent,4.5],
   ['highlight bg vs popover bg', c.accent,c.popover,null],
   ['search placeholder / heading / description / empty / loading: muted-fg on popover', c.mutedFg,c.popover,4.5],
   ['description on highlighted row: muted-fg on accent', c.mutedFg,c.accent,4.5],
   ['disabled label with cmdk opacity-50', mix(c.popoverFg,c.popover,0.5),c.popover,4.5],
   ['disabledReason with opacity-50', mix(c.mutedFg,c.popover,0.5),c.popover,4.5],
   ['proposed disabled label+reason: muted-fg on popover', c.mutedFg,c.popover,4.5],
   ['error text: destructive on popover', c.destructive,c.popover,4.5],
   ['check icon: primary on popover', c.primary,c.popover,3],
   ['check icon: primary on accent (highlighted)', c.primary,c.accent,3],
   ['read-only value: foreground on readonly (in card)', c.foreground,ro,4.5],
   ['read-only value: foreground on readonly (on page)', c.foreground,roPage,4.5],
   ['read-only bg vs editable bg (background) in card', ro,c.background,null],
   ['read-only border: input vs readonly bg', c.input,ro,3],
   ['focus ring: ring on card', c.ring,c.card,3],
   ['popover border: border vs popover', c.border,c.popover,null],
   ['popover vs card behind it', c.popover,c.card,null],
  ];
  for (const [label,a,b,min] of rows){const r=cr(a,b);console.log((r.toFixed(2)+':1').padStart(8),min?(r>=min?'PASS':'FAIL')+' ≥'+min:'info   ',' ',label,' ',hex(a),'on',hex(b));}
}
```

Expected output with today's tokens (the numbers already on the board), first column of each line after the `== light` / `== dark` header line: light `15.03 5.36 3.36 3.14 5.36 16.10 13.14 1.23 5.74 4.69 3.19 2.10 5.74 6.58 6.03 4.92 14.51 14.26 1.04 3.03 6.03 1.38 1.00`, dark `15.73 9.04 3.65 4.06 9.04 12.77 10.27 1.30 7.33 5.65 4.38 2.98 7.33 5.71 8.10 6.23 12.08 12.42 1.30 3.12 8.96 1.57 1.11`.
- Update the matching row of this task's Produces table in the plan when a change alters what Task 4 builds (e.g. question 1 → the Row line). Question 4 changes no row here: it decides the `display` props of Tasks 8 and 13 (header "Account codes").

- [ ] **Step 10: Record the decision in the plan's progress notes**

Find the plan file:

```bash
PLAN=$(grep -l '^# Round 2 — Searchable Dropdowns' docs/superpowers/plans/*.md); echo "$PLAN"
```

Expected: exactly one path (the plan whose title is ``# Round 2 — Searchable Dropdowns (`Combobox`) Implementation Plan``). If the file has no `## Progress notes` heading, append one at the end; then append this entry (replace each `<…>` with the real value from this run):

```markdown
### Task 2 — Combobox mockup (R2-0)
- Date: <YYYY-MM-DD> · Canvas: https://claude.ai/artifact/P9HZMn9fL6V17TdWyG5QDn (<the canvas used, if Step 1 fell back>) · Version: <version id from the last Step 7/9 publish>
- Boards added: ComboboxLight, ComboboxDark, ComboboxMobileLight, ComboboxMobileDark, ComboboxChecks + title note "Combobox — dropdown ค้นหาได้ (รอบ 2 · R2-0)"
- Owner reply (verbatim): "<reply>"
- Decision: <approved | approved with changes | not approved>
- Answers: 1 row height <44px kept | changed to …> · 2 disabled rows <as drawn | …> · 3 phone list focus <as drawn | …> · 4 converted account fields <code - name like the searchable picker | keep each screen's display> · 5 highlight <kept | …>
- Changes made after the first publish: <none | one line each>
- Task 4 visual contract (Task 2 Produces table): <unchanged | rows changed: …>
```

- [ ] **Step 11: Commit the progress note**

```bash
git add "$PLAN"
git commit -F - <<'EOF'
docs(plan): record owner decision on the Combobox mockup (R2-0)

Mockup boards (8 desktop states light/dark, 390 phone light/dark,
contrast + read-only check) were added to the owner's canvas
"มาตรฐานช่องกรอก ก่อน/หลัง". The owner's answer, the published
version and any change to the visual contract Task 4 builds are
recorded under Progress notes. Task 4 starts only after approval.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: one commit that changes only the plan file. Do not push.

---

### Task 3: `thai-search` — Thai normaliser and ranked filter (R2-1, spec §6.2)

**Why:** Every `Combobox` filters through one Thai-aware matcher (spec §6.2; header contract). Nothing reusable exists (facts-core §7): `packages/shared/src/accessory-compatibility.ts:7-8` normalises with **NFKC** and has no fold, and NFKC splits sara am (U+0E33) into nikhahit + sara aa — so do not import or copy it. This task adds the pure module and its tests; nothing imports it until Task 4 (default `filter` of `Combobox`), so no screen changes.

**Files:**
- Create: `apps/web/src/lib/thai-search.ts`
- Create (test): `apps/web/src/lib/thai-search.test.ts`
- No other file changes. (`apps/web/src/lib/` exists; no `thai-search` / `normalizeThai` / `rankMatch` name exists anywhere in `apps/web/src` — facts-core §9.)

**Interfaces:**
- Consumes: nothing beyond the language — `String.prototype.normalize`, Unicode property escapes (`/[\s\p{P}\p{S}]+/u`, fine for `apps/web/tsconfig.json` target ES2020).
- Produces (the header contract, unchanged):
  - `normalizeThai(s: string): string` — NFC → remove U+200B–U+200D and U+FEFF → nikhahit + optional tone + sara aa → tone + sara am (both typing orders of น้ำ) → `เเ` → `แ` → lower-case → trim → Thai digits ๐–๙ → 0–9. It does **not** collapse inner spaces and does **not** apply NFKC (`①` stays `①`).
  - `type MatchRank = 1 | 2 | 3 | 4`; `interface Searchable { label: string; keywords?: readonly string[] }`
  - `rankMatch(item, query)` — both sides normalised; 1 label starts with the query · 2 label starts with it after one leading vowel `[เแโใไ]`, or any word of the label starts with it (also after one leading vowel); words split on runs of whitespace, punctuation and symbols (`[\s\p{P}\p{S}]+`, so `52-1104 ส่วนลด` has the words `52`, `1104`, `ส่วนลด`) · 3 label contains it · 4 any keyword contains it (which includes "starts with") · otherwise `null`. The best rank wins: a label match is never demoted to 4 by a keyword. A query that normalises to `''` (empty, spaces, zero-width only) → 1.
  - `filterAndRank(items, query)` — drops `null`, sorts by rank, keeps input order within a rank (explicit index tie-break), returns a **new** array of the **same** item objects (labels untouched — normalisation is for comparing only), never mutates `items`; a blank query returns every item in input order.
  - `ComboOption<M>` (Task 4) satisfies `Searchable` as-is (`label: string`, `keywords?: string[]`), so `filterAndRank(options, term)` is the `Combobox` default filter with no adapter.
- **Decision for Task 6 — address names keep their prefixes (`เขตพระนคร`, `อำเภอเมืองบุรีรัมย์`, `แขวง…`, `ตำบล…`; provinces have none):**
  - Rank 2's word split does **not** handle them: `เขตพระนคร` has no separator, so `พระนคร` is only a rank-3 "contains" match (test `rank 2 does not split the prefix off`).
  - Prefix-stripped **keywords do not help either** (this replaces the plan-notes idea "add prefix-stripped keywords"): a keyword hit is rank 4, below the label's own rank 3, so `{ label: 'เขตพระนคร', keywords: ['พระนคร'] }` still ranks 3 (test `a prefix-stripped keyword cannot lift it`).
  - On the real data this matters: over every province's district list (77 lists) and every district's subdistrict list (928 lists), typing the first 2–3 letters of a name puts a mid-word match above the names that start with them in 364 of 16,652 cases (2.2%) — e.g. Bangkok `สา` lists `เขตคลองสาน`, `เขตคลองสามวา` before `เขตสาทร`, Buriram `เมือง` lists `อำเภอคูเมือง` before `อำเภอเมืองบุรีรัมย์`.
  - **So callers rank on the bare name and keep the full name as a keyword, through `Combobox`'s `filter` prop** (contract unchanged). Task 6 passes this on the district and subdistrict `Combobox` (provinces keep the default filter) — its module-private `filterAddressOptions` in `AddressForm.tsx` is this composition (sketch below; Task 6 Step 2 has the exact code); option `value`/`label` stay the full names, so values sent to the API do not change:

```ts
import { filterAndRank } from '@/lib/thai-search';
import type { ComboOption } from '@/components/ui/combobox';

const ADDRESS_PREFIX = /^(?:เขต|อำเภอ|แขวง|ตำบล)/;

/** Rank address names on the name after เขต/อำเภอ/แขวง/ตำบล; typing the prefix still finds every row. */
function filterAddressOptions(options: ComboOption[], query: string): ComboOption[] {
  return filterAndRank(
    options.map((option) => ({
      option,
      label: option.label.replace(ADDRESS_PREFIX, ''),
      keywords: [option.label],
    })),
    query,
  ).map((entry) => entry.option);
}
// <Combobox … filter={filterAddressOptions} />
```

  - With it: 0 of the 16,652 cases mis-ordered and 0 lost; `สา` → `เขตสาทร`, `เขตสายไหม`, `เขตคลองสาน`, `เขตคลองสามวา`; `เขต` → every Bangkok district in list order; `อำเภอเมือง` → only the `อำเภอเมือง…` names (tests in the last `describe`). Not handled (same as `SearchableSelect` today): abbreviations `อ.` / `ต.`.

---

- [ ] **Step 1: Write the failing test file**

Create `apps/web/src/lib/thai-search.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import { filterAndRank, normalizeThai, rankMatch, type Searchable } from './thai-search';

// Code points spelled out where an editor could silently re-compose them.
const NAM = '\u0E19\u0E49\u0E33'; // น้ำ = NO NU + MAI THO + SARA AM
const NAM_NIKHAHIT_FIRST = '\u0E19\u0E4D\u0E49\u0E32'; // spec "น ํ ้ า": what a Thai keyboard gives for น้ำ
const NAM_TONE_FIRST = '\u0E19\u0E49\u0E4D\u0E32'; // the other typing order: น + ้ + ํ + า
const DOUBLE_SARA_E = '\u0E40\u0E40'; // เ + เ typed instead of แ
const ZWSP = '\u200B';
const BOM = '\uFEFF';

// The 77 provinces exactly as AddressForm lists them: the unique province names of
// data/thai-address-data.ts sorted with the default .sort() (AddressForm.tsx:133).
// prettier-ignore
const PROVINCES = [
  'กระบี่', 'กรุงเทพมหานคร', 'กาญจนบุรี', 'กาฬสินธุ์', 'กำแพงเพชร', 'ขอนแก่น', 'จันทบุรี',
  'ฉะเชิงเทรา', 'ชลบุรี', 'ชัยนาท', 'ชัยภูมิ', 'ชุมพร', 'ตรัง', 'ตราด', 'ตาก', 'นครนายก',
  'นครปฐม', 'นครพนม', 'นครราชสีมา', 'นครศรีธรรมราช', 'นครสวรรค์', 'นนทบุรี', 'นราธิวาส',
  'น่าน', 'บึงกาฬ', 'บุรีรัมย์', 'ปทุมธานี', 'ประจวบคีรีขันธ์', 'ปราจีนบุรี', 'ปัตตานี',
  'พระนครศรีอยุธยา', 'พะเยา', 'พังงา', 'พัทลุง', 'พิจิตร', 'พิษณุโลก', 'ภูเก็ต', 'มหาสารคาม',
  'มุกดาหาร', 'ยะลา', 'ยโสธร', 'ระนอง', 'ระยอง', 'ราชบุรี', 'ร้อยเอ็ด', 'ลพบุรี', 'ลำปาง',
  'ลำพูน', 'ศรีสะเกษ', 'สกลนคร', 'สงขลา', 'สตูล', 'สมุทรปราการ', 'สมุทรสงคราม', 'สมุทรสาคร',
  'สระบุรี', 'สระแก้ว', 'สิงห์บุรี', 'สุพรรณบุรี', 'สุราษฎร์ธานี', 'สุรินทร์', 'สุโขทัย',
  'หนองคาย', 'หนองบัวลำภู', 'อำนาจเจริญ', 'อุดรธานี', 'อุตรดิตถ์', 'อุทัยธานี', 'อุบลราชธานี',
  'อ่างทอง', 'เชียงราย', 'เชียงใหม่', 'เพชรบุรี', 'เพชรบูรณ์', 'เลย', 'แพร่', 'แม่ฮ่องสอน',
];

// Real FINANCE expense accounts (finance-coa.csv), passed the way the account pickers pass them:
// label = account name, the code only as a keyword.
const EXPENSE_ACCOUNTS = [
  { label: 'ค่าคอมฯ พนักงาน', keywords: ['52-1101'] },
  { label: 'ค่าส่งเสริมการขาย', keywords: ['52-1102'] },
  { label: 'ค่าบริการส่ง SMS', keywords: ['52-1103'] },
  { label: 'ส่วนลดไม่จ่ายเศษสตางค์', keywords: ['52-1104'] },
  { label: 'เงินเดือน ค่าจ้าง', keywords: ['53-1101'] },
  { label: 'ค่าน้ำ', keywords: ['53-1301'] },
  { label: 'ค่าไฟฟ้า', keywords: ['53-1302'] },
];

const asItems = (labels: readonly string[]) => labels.map((label) => ({ label }));
const labelsOf = (items: readonly Searchable[]) => items.map((item) => item.label);

describe('normalizeThai', () => {
  it('folds nikhahit + sara aa into sara am in both typing orders', () => {
    expect(normalizeThai(NAM_NIKHAHIT_FIRST)).toBe(NAM);
    expect(normalizeThai(NAM_TONE_FIRST)).toBe(NAM);
    expect(normalizeThai('\u0E01\u0E4D\u0E32')).toBe('\u0E01\u0E33'); // ก + ํ + า → กำ (no tone)
    expect(normalizeThai(NAM)).toBe(NAM);
  });

  it('uses NFC as the spec says: composes, keeps sara am, leaves compatibility characters', () => {
    expect(normalizeThai('\u0E33')).toBe('\u0E33');
    expect(normalizeThai('e\u0301')).toBe('\u00E9');
    expect(normalizeThai('\u2460')).toBe('\u2460'); // ① — NFKC would turn it into "1"
  });

  it('removes the zero-width characters U+200B–U+200D and U+FEFF', () => {
    expect(normalizeThai(`ชล${ZWSP}บุ\u200Cรี\u200D${BOM}`)).toBe('ชลบุรี');
  });

  it('turns a doubled sara e into sara ae', () => {
    expect(normalizeThai(`${DOUBLE_SARA_E}พร่`)).toBe('แพร่');
  });

  it('lower-cases and trims', () => {
    expect(normalizeThai('  iPhone 15 PRO  ')).toBe('iphone 15 pro');
  });

  it('maps Thai digits ๐–๙ to 0–9', () => {
    expect(normalizeThai('๐๑๒๓๔๕๖๗๘๙')).toBe('0123456789');
    expect(normalizeThai('ซอย ๑๒/๓')).toBe('ซอย 12/3');
  });
});

describe('rankMatch', () => {
  it.each([
    ['label starts with the query', { label: 'ชลบุรี' }, 'ชล', 1],
    ['label starts with it after one leading vowel', { label: 'เชียงใหม่' }, 'ชี', 2],
    ['a later word starts with it', { label: 'สมชาย ใจดี' }, 'ใจ', 2],
    ['a later word starts with it after a leading vowel', { label: 'สมชาย ใจดี' }, 'จดี', 2],
    ['words split on punctuation', { label: '52-1104 ส่วนลด' }, '1104', 2],
    ['label contains it mid-word', { label: 'ฉะเชิงเทรา' }, 'ชิง', 3],
    [
      'a keyword starts with it',
      { label: 'ส่วนลดไม่จ่ายเศษสตางค์', keywords: ['52-1104'] },
      '52-11',
      4,
    ],
    [
      'a keyword contains it',
      { label: 'ส่วนลดไม่จ่ายเศษสตางค์', keywords: ['52-1104'] },
      '1104',
      4,
    ],
    ['no match', { label: 'ชลบุรี', keywords: ['20000'] }, 'ระยอง', null],
  ] as const)('%s', (_case, item, query, expected) => {
    expect(rankMatch(item, query)).toBe(expected);
  });

  it('the label rank wins over a keyword match', () => {
    expect(rankMatch({ label: 'ค่าน้ำ', keywords: ['ค่าสาธารณูปโภค'] }, 'ค่า')).toBe(1);
  });

  it('normalizes the label and the query the same way', () => {
    expect(rankMatch({ label: `ค่า${NAM}` }, `ค่า${NAM_NIKHAHIT_FIRST}`)).toBe(1);
    expect(rankMatch({ label: `ค่า${NAM_TONE_FIRST}` }, `ค่า${NAM}`)).toBe(1);
    expect(rankMatch({ label: 'แพร่' }, `${DOUBLE_SARA_E}พ`)).toBe(1);
    expect(rankMatch({ label: `${DOUBLE_SARA_E}ม่ฮ่องสอน` }, 'แม่')).toBe(1);
    expect(rankMatch({ label: 'ซอย ๑๒' }, '12')).toBe(2);
    expect(rankMatch({ label: `ชล${ZWSP}บุรี` }, 'ชลบุ')).toBe(1);
    expect(rankMatch({ label: 'iPhone 15 Pro' }, 'IPHONE 15')).toBe(1);
  });

  it('an empty query (after normalizing) matches everything at rank 1', () => {
    expect(rankMatch({ label: 'ชลบุรี' }, '')).toBe(1);
    expect(rankMatch({ label: 'ชลบุรี' }, '   ')).toBe(1);
    expect(rankMatch({ label: 'ชลบุรี' }, ZWSP)).toBe(1);
  });
});

describe('filterAndRank', () => {
  it('spec §6.2: ช → ชลบุรี ชัยนาท ชัยภูมิ ชุมพร, then เชียง…, then ช mid-word', () => {
    const result = labelsOf(filterAndRank(asItems(PROVINCES), 'ช'));
    expect(result).toEqual([
      // rank 1 — starts with ช, in the list's own order
      'ชลบุรี',
      'ชัยนาท',
      'ชัยภูมิ',
      'ชุมพร',
      // rank 2 — starts with ช after the leading vowel เ
      'เชียงราย',
      'เชียงใหม่',
      // rank 3 — ช in the middle of the name
      'กำแพงเพชร',
      'ฉะเชิงเทรา',
      'นครราชสีมา',
      'นครศรีธรรมราช',
      'ราชบุรี',
      'อุบลราชธานี',
      'เพชรบุรี',
      'เพชรบูรณ์',
    ]);
    expect(result.indexOf('ชุมพร')).toBeLessThan(result.indexOf('เชียงใหม่'));
    expect(result.indexOf('เชียงใหม่')).toBeLessThan(result.indexOf('ฉะเชิงเทรา'));
  });

  it('the province list in this test is in the order AddressForm uses', () => {
    expect(PROVINCES).toHaveLength(77);
    expect([...PROVINCES].sort()).toEqual(PROVINCES);
  });

  it('finds น้ำ when it is typed as น ํ ้ า or น ้ ํ า', () => {
    expect(labelsOf(filterAndRank(EXPENSE_ACCOUNTS, NAM_NIKHAHIT_FIRST))).toEqual(['ค่าน้ำ']);
    expect(labelsOf(filterAndRank(EXPENSE_ACCOUNTS, NAM_TONE_FIRST))).toEqual(['ค่าน้ำ']);
  });

  it('finds account codes through keywords (52-11 → the four 52-11xx accounts, in list order)', () => {
    expect(labelsOf(filterAndRank(EXPENSE_ACCOUNTS, '52-11'))).toEqual([
      'ค่าคอมฯ พนักงาน',
      'ค่าส่งเสริมการขาย',
      'ค่าบริการส่ง SMS',
      'ส่วนลดไม่จ่ายเศษสตางค์',
    ]);
    expect(labelsOf(filterAndRank(EXPENSE_ACCOUNTS, '53-13'))).toEqual(['ค่าน้ำ', 'ค่าไฟฟ้า']);
  });

  it('ranks label prefixes before word prefixes', () => {
    expect(labelsOf(filterAndRank(EXPENSE_ACCOUNTS, 'ค่า'))).toEqual([
      'ค่าคอมฯ พนักงาน',
      'ค่าส่งเสริมการขาย',
      'ค่าบริการส่ง SMS',
      'ค่าน้ำ',
      'ค่าไฟฟ้า',
      'เงินเดือน ค่าจ้าง', // rank 2: the word ค่าจ้าง
    ]);
    expect(labelsOf(filterAndRank(EXPENSE_ACCOUNTS, 'sms'))).toEqual(['ค่าบริการส่ง SMS']);
  });

  it('matches Thai digits against Arabic digits both ways', () => {
    const items = asItems(['ซอย 12', 'ซอย ๑๓', 'หมู่ 1']);
    expect(labelsOf(filterAndRank(items, '๑๒'))).toEqual(['ซอย 12']);
    expect(labelsOf(filterAndRank(items, '13'))).toEqual(['ซอย ๑๓']);
  });

  it('ignores zero-width characters and returns the original item unchanged', () => {
    const items = asItems([`ชล${ZWSP}บุรี`, 'ระยอง']);
    const result = filterAndRank(items, `ชลบุ${BOM}`);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(items[0]);
    expect(result[0].label).toBe(`ชล${ZWSP}บุรี`);
  });

  it('matches a doubled sara e (เเ) as แ in the label and in the query', () => {
    const items = asItems(['แพร่', `${DOUBLE_SARA_E}ม่ฮ่องสอน`, 'พะเยา']);
    expect(labelsOf(filterAndRank(items, DOUBLE_SARA_E))).toEqual([
      'แพร่',
      `${DOUBLE_SARA_E}ม่ฮ่องสอน`,
    ]);
    expect(labelsOf(filterAndRank(items, 'แม่'))).toEqual([`${DOUBLE_SARA_E}ม่ฮ่องสอน`]);
  });

  it('keeps the original order within a rank (not alphabetical)', () => {
    expect(labelsOf(filterAndRank(asItems(['ชุมพร', 'ชัยนาท', 'ชลบุรี']), 'ช'))).toEqual([
      'ชุมพร',
      'ชัยนาท',
      'ชลบุรี',
    ]);
    const twins = [
      { label: 'สมชาย ใจดี', id: 'u-1' },
      { label: 'สมชาย ใจดี', id: 'u-2' },
    ];
    expect(filterAndRank(twins, 'สม').map((item) => item.id)).toEqual(['u-1', 'u-2']);
  });

  it('an empty or blank query returns every item in the original order, as a new array', () => {
    const items = asItems(PROVINCES);
    for (const query of ['', '   ', ZWSP]) {
      const result = filterAndRank(items, query);
      expect(result).toEqual(items);
      expect(result).not.toBe(items);
    }
  });

  it('returns [] when nothing matches and never mutates the input', () => {
    const items = asItems(PROVINCES);
    const before = [...items];
    expect(filterAndRank(items, 'ลอนดอน')).toEqual([]);
    filterAndRank(items, 'ช');
    expect(items).toEqual(before);
  });
});

// Address names keep their prefixes (เขตพระนคร, อำเภอเมืองบุรีรัมย์, แขวง…, ตำบล… —
// data/thai-address-data.ts). These tests pin how the ranking treats them; Task 6 relies on it.
describe('address names with เขต/อำเภอ/แขวง/ตำบล prefixes', () => {
  const BANGKOK = ['เขตคลองสาน', 'เขตคลองสามวา', 'เขตพระนคร', 'เขตสาทร', 'เขตสายไหม'];
  const ADDRESS_PREFIX = /^(?:เขต|อำเภอ|แขวง|ตำบล)/;
  // The composition Task 6 passes as the Combobox `filter`: rank on the bare name and keep
  // the full name as a keyword, so typing the prefix still finds every row.
  const byBareName = (names: readonly string[], query: string) =>
    filterAndRank(
      names.map((name) => ({ name, label: name.replace(ADDRESS_PREFIX, ''), keywords: [name] })),
      query,
    ).map((entry) => entry.name);

  it('rank 2 does not split the prefix off — the name is only a rank-3 contains match', () => {
    expect(rankMatch({ label: 'เขตพระนคร' }, 'พระนคร')).toBe(3);
    expect(rankMatch({ label: 'อำเภอเมืองบุรีรัมย์' }, 'เมือง')).toBe(3);
  });

  it('a prefix-stripped keyword cannot lift it: keywords rank 4, below the label', () => {
    expect(rankMatch({ label: 'เขตพระนคร', keywords: ['พระนคร'] }, 'พระนคร')).toBe(3);
  });

  it('raw labels let mid-word matches come first', () => {
    expect(labelsOf(filterAndRank(asItems(BANGKOK), 'สา'))).toEqual([
      'เขตคลองสาน',
      'เขตคลองสามวา',
      'เขตสาทร',
      'เขตสายไหม',
    ]);
  });

  it('ranking on the bare name puts names that start with the query first', () => {
    expect(byBareName(BANGKOK, 'สา')).toEqual([
      'เขตสาทร',
      'เขตสายไหม',
      'เขตคลองสาน',
      'เขตคลองสามวา',
    ]);
    expect(byBareName(BANGKOK, 'พระนคร')).toEqual(['เขตพระนคร']);
    expect(byBareName(['อำเภอคูเมือง', 'อำเภอเมืองบุรีรัมย์'], 'เมือง')).toEqual([
      'อำเภอเมืองบุรีรัมย์',
      'อำเภอคูเมือง',
    ]);
  });

  it('typing the prefix itself still finds every row, in list order', () => {
    expect(byBareName(BANGKOK, 'เขต')).toEqual(BANGKOK);
    expect(byBareName(['อำเภอคูเมือง', 'อำเภอเมืองบุรีรัมย์'], 'อำเภอเมือง')).toEqual([
      'อำเภอเมืองบุรีรัมย์',
    ]);
  });
});
```

The file spells tricky code points as backslash-u escapes (`'\u0E19\u0E4D\u0E49\u0E32'` …) on purpose: an editor or an agent's file tool may silently re-compose literal ones. Some agent file tools decode backslash-u escapes while writing — check right after saving:

```bash
grep -o 'u[0-9A-F]\{4\}' apps/web/src/lib/thai-search.test.ts | wc -l
```

Expected: `28`. A smaller number means escapes were turned into characters — rewrite those lines so the file holds the escapes (e.g. write the file with `node` from a script, or with an editor that does not decode them).

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd apps/web && npx vitest run src/lib/thai-search.test.ts
```

Expected: `Error: Failed to resolve import "./thai-search" from "src/lib/thai-search.test.ts". Does the file exist?` and `Test Files  1 failed (1)`, `Tests  no tests`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/thai-search.ts` with exactly:

```ts
/**
 * Thai-aware search for pick lists (spec §6.2).
 *
 * normalizeThai folds the spellings a Thai keyboard produces for the same text,
 * rankMatch scores one item against a query, filterAndRank keeps the matches in
 * rank order. Pure functions — no React, no DOM.
 *
 * Do not swap in a shared helper that uses NFKC: NFKC splits sara am (U+0E33)
 * back into nikhahit + sara aa, the opposite of the fold below.
 */

// U+200B ZERO WIDTH SPACE, U+200C ZWNJ, U+200D ZWJ, U+FEFF ZERO WIDTH NO-BREAK SPACE (BOM).
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;
// NIKHAHIT U+0E4D + optional tone mark U+0E48–U+0E4B + SARA AA U+0E32 → tone + SARA AM U+0E33.
// Both typing orders of น้ำ ("น ํ ้ า" and "น ้ ํ า") end up as U+0E19 U+0E49 U+0E33.
const NIKHAHIT_AA = /\u0E4D([\u0E48-\u0E4B]?)\u0E32/g;
// Two SARA E (U+0E40 U+0E40) typed for one SARA AE (U+0E41).
const DOUBLE_SARA_E = /\u0E40\u0E40/g;
// Thai digits ๐–๙ (U+0E50–U+0E59).
const THAI_DIGIT = /[\u0E50-\u0E59]/g;
// Leading vowels เ แ โ ใ ไ (U+0E40–U+0E44): written before the consonant they follow in speech.
const LEADING_VOWEL = /^[\u0E40-\u0E44]/;
// Word separators for rank 2: whitespace, punctuation, symbols ("52-1104 ส่วนลด", "สาขา (ลาดพร้าว)").
const WORD_SEPARATOR = /[\s\p{P}\p{S}]+/u;

export function normalizeThai(s: string): string {
  return s
    .normalize('NFC')
    .replace(ZERO_WIDTH, '')
    .replace(NIKHAHIT_AA, '$1\u0E33')
    .replace(DOUBLE_SARA_E, '\u0E41')
    .toLowerCase()
    .trim()
    .replace(THAI_DIGIT, (digit) => String(digit.charCodeAt(0) - 0x0e50));
}

/** 1 = label starts with the query · 2 = after one leading vowel, or a word starts with it · 3 = label contains it · 4 = a keyword contains it. */
export type MatchRank = 1 | 2 | 3 | 4;

export interface Searchable {
  label: string;
  keywords?: readonly string[];
}

function startsAfterLeadingVowel(text: string, query: string): boolean {
  return LEADING_VOWEL.test(text) && text.startsWith(query, 1);
}

/** `query` must already be normalized and non-empty. */
function rankNormalized(item: Searchable, query: string): MatchRank | null {
  const label = normalizeThai(item.label);
  if (label.startsWith(query)) return 1;
  if (startsAfterLeadingVowel(label, query)) return 2;
  const words = label.split(WORD_SEPARATOR);
  if (words.some((word) => word.startsWith(query) || startsAfterLeadingVowel(word, query))) {
    return 2;
  }
  if (label.includes(query)) return 3;
  if (item.keywords?.some((keyword) => normalizeThai(keyword).includes(query))) return 4;
  return null;
}

/** Best rank of `item` for `query`, or `null` when it does not match. An empty query matches everything at rank 1. */
export function rankMatch(item: Searchable, query: string): MatchRank | null {
  const q = normalizeThai(query);
  return q ? rankNormalized(item, q) : 1;
}

/** Items that match `query`, best rank first; items of the same rank keep their original order. */
export function filterAndRank<T extends Searchable>(items: readonly T[], query: string): T[] {
  const q = normalizeThai(query);
  if (!q) return [...items];
  const matches: { item: T; rank: MatchRank; index: number }[] = [];
  items.forEach((item, index) => {
    const rank = rankNormalized(item, q);
    if (rank !== null) matches.push({ item, rank, index });
  });
  matches.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return matches.map((match) => match.item);
}
```

Check the escapes survived:

```bash
grep -o 'u[0-9A-F]\{4\}' apps/web/src/lib/thai-search.ts | wc -l
```

Expected: `15` (ESLint's `no-irregular-whitespace` also fails in Step 5 if U+200B / U+FEFF were written as characters).

- [ ] **Step 4: Run the test and confirm it passes**

```bash
cd apps/web && npx vitest run src/lib/thai-search.test.ts
```

Expected: `Test Files  1 passed (1)` and `Tests  34 passed (34)`.

- [ ] **Step 5: Type check, lint, format**

```bash
bash tools/check-types.sh web
cd apps/web && npx eslint src/lib/thai-search.ts src/lib/thai-search.test.ts && cd ../..
npx prettier --check apps/web/src/lib/thai-search.ts apps/web/src/lib/thai-search.test.ts
```

Expected: 0 type errors; ESLint prints nothing (0 errors, 0 warnings — no `no-restricted-syntax`, no `no-irregular-whitespace`); Prettier `All matched files use Prettier code style!` (the province list keeps its compact lines through its `// prettier-ignore`).

- [ ] **Step 6: Source-scan guards still pass with the new files**

```bash
cd apps/web && npx vitest run src/components/ui/field-guards.inventory.test.ts src/components/ui/native-select.inventory.test.ts
```

Expected: both files pass. The scan reads every non-test source under `apps/web/src`; `thai-search.ts` has no `-[--…]` utility, no `bg-input`, no JSX (F5 scans `.tsx` only) and no `<select>`.

- [ ] **Step 7: Field-scale — not applicable**

No route renders this module (nothing imports it until Task 4), so `tools/field-scale/check.mjs` would measure the same pages as `baseline-r2`; skip it in this task and say so in the PR body. Task 4 runs it.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/thai-search.ts apps/web/src/lib/thai-search.test.ts
git commit -F - <<'EOF'
feat(web): Thai-aware search for Combobox (R2-1 thai-search)

normalizeThai folds what Thai keyboards type for the same text: NFC,
zero-width characters, nikhahit + tone + sara aa into sara am (both
typing orders), a doubled sara e into sara ae, case, outer spaces and
Thai digits. rankMatch scores label prefix (1), prefix after a leading
vowel or a word prefix (2), contains (3) and keyword hits (4);
filterAndRank keeps the matches best-first and stable.

Tests pin the spec 6.2 order on the 77 provinces (ช: ชลบุรี ชัยนาท
ชัยภูมิ ชุมพร, then เชียงราย เชียงใหม่, then mid-word), น้ำ typed
decomposed, account codes via keywords, Thai digits, zero-width
characters, เเ, stable order, the empty query, and how address names
with เขต/อำเภอ/แขวง/ตำบล prefixes rank (Task 6 ranks on the bare name).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: one commit with the two new files. Do not push.

---

### Task 4: `Combobox` + test helpers (R2-1, spec §6.1–§6.3)

**Why:** Every Round 2 conversion (Tasks 6–14) needs one searchable select with the field skin of Round 1. Spec §6.1–§6.3 fixes its behaviour and API; the header's shared contract fixes the names. This task builds it once on top of the existing shadcn pieces — `ui/command.tsx` (cmdk 1.1.1) inside a portalled `ui/popover.tsx` `PopoverContent` (Radix 1.1.15), the same portalled pattern as the Round 1 `AccountSearchDropdown.tsx:142-263` — and wires `thai-search` (Task 3) as the default ranking. It also adds what every later test needs: a global `scrollIntoView` no-op in `src/test/setup.ts` (cmdk throws `TypeError: e.scrollIntoView is not a function` in jsdom; 14 files polyfill it locally today) and `pickComboOption` / `openCombobox` in `src/test/combobox.ts`.
cmdk / Radix facts the code works around (facts-core §0, all probed): cmdk trims item values and can never highlight `value=""` → rows use the internal key `opt:${index}`; with `shouldFilter={false}` `CommandEmpty` shows only when no row is mounted → loading/error/pending hide it; Enter on any `<button>` inside cmdk's root picks the highlighted row → the retry, create and footer buttons sit outside `<Command>`; Radix `PopoverTrigger asChild` sets `aria-haspopup="dialog"` and does not open on ArrowDown → the trigger sets `aria-haspopup="listbox"` and handles ArrowDown; Radix selects the whole search text on open → `onOpenAutoFocus` places the caret at the end; a modal Dialog's scroll lock swallows wheel/touchmove from the portalled menu → `stopPropagation` on the content (`WizardStackedOverlay.tsx:44-45`).
No call site changes here, so no field-scale compare (Step 11 explains). The menu's look follows the Task 2 mockup (Step 10).

**Files:**
- Create: `apps/web/src/components/ui/combobox.tsx`
- Create: `apps/web/src/components/ui/combobox.test.tsx`
- Create: `apps/web/src/test/combobox.ts` (test helper — under `src/test/`, so vitest does not collect it and the F5 / field guards skip it; `tsc` still checks it, `tsconfig.json` `include: ["src"]`)
- Modify: `apps/web/src/test/setup.ts` — append after the last line (L44, the closing `}` of the `matchMedia` stub). The file has CRLF line endings; keep them.
- Modify: `DESIGN.md` — add a `Combobox` bullet to "Field primitives" after the `NativeSelect` bullet (L238), before `### 5.5 Dialogs & Sheets` (L240). CRLF file.
- No change (verified): `apps/web/src/components/ui/command.tsx`, `popover.tsx`, `form-styles.ts`, `button.tsx`, `labeled-field.tsx`, `form.tsx`; `apps/web/src/components/ui/dialog.tsx:73-80` (its Esc guard is for `[data-inline-combobox]` = `NameAutocomplete`; a portalled Combobox closes first through Radix layering — test "inside overlays"); `apps/web/src/styles/admin-typography.css` (already sizes `button[role=combobox]` 44px / 14px ≥1024 / 16px below, L49-57, L212-218); `apps/web/src/components/ui/field-guards.inventory.test.ts` (F5 does not flag `combobox.tsx` — Step 8; no allow-list entry); `apps/web/src/components/ui/native-select.inventory.test.ts` (no `<select>` is rendered); `tools/typography-audit/collect.js:858-863` (the field collector already maps `button[role=combobox]` to kind `combobox`).
- Test files: `apps/web/src/components/ui/combobox.test.tsx` (new, 67 tests); regression set in Step 9.

**Interfaces:**
- Consumes:
  - `filterAndRank`, `normalizeThai` from `@/lib/thai-search` (Task 3 — imported, not reimplemented). Relied on: `filterAndRank` returns **the same item objects** (no copies) in rank order, stable within a rank; an empty/blank query returns every item in input order; `normalizeThai` trims and lower-cases (used for the exact-label check of `onCreate`).
  - `Command`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem` from `./command`; `useCommandState` from `cmdk` (state `{ value, selectedItemId }`).
  - `Popover`, `PopoverTrigger`, `PopoverContent` from `./popover` (content is portalled; its `data-slot` is overridable because props spread last, `popover.tsx:23-31`).
  - `Button` from `./button` (`variant="outline" size="md"` for `ลองใหม่`, Task 2); `formControlClass` from `./form-styles`; `cn` from `@/lib/utils`; `AlertCircle`, `Check`, `ChevronDown`, `Loader2`, `Plus`, `RotateCw`, `X` from `lucide-react` (all exported by the installed lucide-react 1.14.0).
- Produces (the header's shared contract — `ComboboxProps` incl. `aria-invalid`, `aria-required`, `closeOnSelect` — and every line of its Behaviour list):
  - `Combobox`, `type ComboboxProps`, `type ComboOption` from `apps/web/src/components/ui/combobox.tsx`.
  - DOM (classes = the Task 2 visual contract): wrapper `span[data-slot="combobox"]` (`relative block w-full min-w-0 max-w-full` + `wrapperClassName`) → trigger `button[type=button][role=combobox][data-slot="combobox-trigger"][aria-haspopup="listbox"][aria-expanded]` (+ Radix `aria-controls` = menu id, `data-state`), class `cn(formControlClass, 'flex items-center justify-between gap-2 text-left', className)`, holding the value `span[data-slot="combobox-value"]` (`min-w-0 truncate`, `text-muted-foreground` for the placeholder, `title` = label, `mr-8` while the clear button shows) and the arrow `ChevronDown` (`size-4 shrink-0 text-muted-foreground`, `aria-hidden`, inside the button so it fades with `disabled:opacity-60`) → optional clear button (`absolute right-9 top-1/2 size-7`). Menu `[data-slot="combobox-content"]` (portalled `PopoverContent`, keeps its `rounded-md border bg-popover shadow-md`, + `w-(--radix-popover-trigger-width) min-w-64 p-0` and the layout classes `flex max-h-(--radix-popover-content-available-height) flex-col overflow-hidden`) holds cmdk's root: `CommandInput` unchanged (named `searchLabel`, also `aria-label={searchLabel}`), `[role=status][data-slot="combobox-status"]` (between the search box and the listbox) while loading/pending (centred `text-sm text-muted-foreground` + `Loader2 size-4 animate-spin`), `CommandList` + `overscroll-contain` (`[role=listbox]` named `listLabel`) of `CommandItem` rows + `min-h-11 py-2 leading-snug` and the disabled classes above (`aria-selected` = highlighted, `aria-disabled`; second line `text-xs text-muted-foreground` inside `flex min-w-0 flex-1 flex-col`; `Check` `ml-auto size-4 text-primary!` only on rows whose value equals `value`, and none when `renderOption` is given); then, outside cmdk's root, `[role=alert][data-slot="combobox-error"]` (centred `text-sm text-destructive` + `AlertCircle size-4`, `Button variant="outline" size="md"` with `RotateCw` + `ลองใหม่`), `button[data-slot="combobox-create"]`, `[data-slot="combobox-footer"]`.
  - Thai defaults exactly: `เลือก…`, `พิมพ์เพื่อค้นหา…`, search name `ค้นหา`, list name `ตัวเลือก`, `ไม่พบรายการ`, `กำลังโหลด…`, `โหลดรายการไม่สำเร็จ` + `ลองใหม่`, `กำลังเพิ่ม…`, `ล้างค่า`, create `สร้าง “{term}”`.
  - `openCombobox(user, name): Promise<HTMLElement>` and `pickComboOption(user, name, option, opts?)` from `apps/web/src/test/combobox.ts` (header signatures). `openCombobox` finds the trigger by role + name, clicks it if closed, waits for the element its `aria-controls` names (it must be `[data-slot="combobox-content"]`, else it throws "… is not a Combobox") and returns the listbox inside it. `pickComboOption` then clears and types `opts.search` into that menu's search box (`{` / `[` typed literally), clicks `findByRole('option', { name: option })` inside the menu, and waits (`waitFor`, 1 s) until the trigger's `aria-expanded` is `"false"` — a disabled row or a `pending` menu makes it throw `… is still open after clicking …` instead of passing silently. With `closeOnSelect={false}` it passes only when the caller closes the menu within `waitFor`'s timeout (ContactCombobox: on ensure-role success).
  - `src/test/setup.ts`: `Element.prototype.scrollIntoView` = writable, configurable no-op, installed only when missing.

- [ ] **Step 1: Check the prerequisites**

```bash
git branch --show-current
grep -n "export function \(normalizeThai\|filterAndRank\)" apps/web/src/lib/thai-search.ts
ls apps/web/src/components/ui/combobox.tsx apps/web/src/test/combobox.ts 2>&1 | grep -c "No such file"
```

Expected: the branch is `feat/dropdown-search-round2` (header); both thai-search exports are printed (Task 3 is committed); `2` (neither new file exists yet). Also confirm the Task 2 mockup approval is recorded (the header says Task 4 depends on Task 2); Step 10 compares against it.

- [ ] **Step 2: Write the test helper**

Create `apps/web/src/test/combobox.ts` with exactly:

```ts
import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/** user-event reads `{…}` and `[…]` as key descriptors; double them to type them literally. */
const literal = (text: string) => text.replace(/[{[]/g, '$&$&');

async function openMenu(user: UserEvent, name: string | RegExp) {
  const trigger = await screen.findByRole('combobox', { name });
  if (trigger.getAttribute('aria-expanded') !== 'true') await user.click(trigger);
  // The trigger's aria-controls (set by Radix) is the id of the portalled menu,
  // [data-slot="combobox-content"].
  const content = await waitFor(() => {
    const id = trigger.getAttribute('aria-controls');
    const el = id ? document.getElementById(id) : null;
    if (!el) throw new Error(`Combobox "${String(name)}" did not open (disabled?)`);
    if (!el.matches('[data-slot="combobox-content"]')) {
      throw new Error(
        `"${String(name)}" is not a Combobox (no [data-slot="combobox-content"] menu)`,
      );
    }
    return el;
  });
  return { trigger, content, listbox: within(content).getByRole('listbox') };
}

/** Opens the `Combobox` whose trigger is named `name` (its label) and returns its listbox. */
export async function openCombobox(user: UserEvent, name: string | RegExp): Promise<HTMLElement> {
  return (await openMenu(user, name)).listbox;
}

/**
 * Opens the `Combobox` named `name`, optionally types `opts.search` into its search box, clicks
 * the row whose accessible name is `option`, and resolves once the menu has closed — so a pick
 * that cannot happen (a disabled row, a `pending` menu) fails the test instead of passing silently.
 */
export async function pickComboOption(
  user: UserEvent,
  name: string | RegExp,
  option: string | RegExp,
  opts: { search?: string } = {},
): Promise<void> {
  const { trigger, content } = await openMenu(user, name);
  if (opts.search !== undefined) {
    // The search box is the only role=combobox inside the menu (cmdk's input).
    const search = within(content).getByRole('combobox');
    await user.clear(search);
    if (opts.search) await user.type(search, literal(opts.search));
  }
  await user.click(await within(content).findByRole('option', { name: option }));
  await waitFor(() => {
    if (trigger.getAttribute('aria-expanded') === 'true') {
      throw new Error(
        `Combobox "${String(name)}" is still open after clicking "${String(option)}"`,
      );
    }
  });
}
```

- [ ] **Step 3: Write the failing component test**

Create `apps/web/src/components/ui/combobox.test.tsx` with exactly:

```tsx
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openCombobox, pickComboOption } from '@/test/combobox';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from './alert-dialog';
import { Combobox, type ComboboxProps, type ComboOption } from './combobox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from './form';
import { LabeledField } from './labeled-field';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './sheet';

const BRANCHES: ComboOption[] = [
  { value: 'b1', label: 'ลาดพร้าว' },
  { value: 'b2', label: 'บางนา' },
  { value: 'b3', label: 'รังสิต', disabled: true, disabledReason: 'ปิดชั่วคราว' },
  { value: 'b4', label: 'ชลบุรี' },
];

const PROVINCES: ComboOption[] = [
  'เชียงใหม่',
  'กรุงเทพมหานคร',
  'ชลบุรี',
  'ฉะเชิงเทรา',
  'ชัยนาท',
  'ชุมพร',
  'ชัยภูมิ',
  'ลำปาง',
].map((label, i) => ({ value: `p${i}`, label }));

type HarnessProps = Partial<Omit<ComboboxProps, 'value' | 'onChange'>> & {
  initialValue?: string | null;
  onPick?: (value: string, option: ComboOption | null) => void;
  label?: string;
};

/** Labelled, controlled Combobox inside an overflow-hidden box (the clipping parent of S2-01). */
function Harness({
  initialValue = null,
  onPick,
  label = 'สาขา',
  id = 'branch',
  options = BRANCHES,
  ...rest
}: HarnessProps) {
  const [value, setValue] = useState<string | null>(initialValue);
  return (
    <div data-testid="clip" className="overflow-hidden">
      <label htmlFor={id}>{label}</label>
      <Combobox
        {...rest}
        id={id}
        options={options}
        value={value}
        onChange={(next, option) => {
          setValue(next);
          onPick?.(next, option);
        }}
      />
    </div>
  );
}

const trigger = (name: string | RegExp = 'สาขา') => screen.getByRole('combobox', { name });
const searchBox = () => screen.getByRole('combobox', { name: 'ค้นหา' });
const optionNames = () => screen.queryAllByRole('option').map((o) => o.textContent);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Combobox — DOM contract', () => {
  it('trigger: raw button[type=button][role=combobox], aria-haspopup=listbox, named by its label only', () => {
    render(<Harness />);
    const t = trigger();
    expect(t.tagName).toBe('BUTTON');
    expect(t).toHaveAttribute('type', 'button');
    expect(t).toHaveAttribute('data-slot', 'combobox-trigger');
    expect(t).toHaveAttribute('aria-haspopup', 'listbox');
    expect(t).toHaveAttribute('aria-expanded', 'false');
    expect(t).not.toHaveAttribute('aria-label');
    expect(t).toHaveTextContent('เลือก…');
    // formControlClass skin: 8px corner, border-input, bg-background, 44px, full width.
    expect(t).toHaveClass(
      'rounded-lg',
      'border',
      'border-input',
      'bg-background',
      'h-11',
      'w-full',
    );
    expect(t).toHaveClass('flex', 'items-center', 'justify-between', 'text-left');
    // Arrow inside the button (Task 2 mockup): decorative, fades with the button when disabled.
    const arrow = t.querySelector('svg');
    expect(arrow).toHaveAttribute('aria-hidden', 'true');
    expect(arrow).toHaveClass('size-4', 'shrink-0', 'text-muted-foreground');
    expect(t.querySelector('[data-slot="combobox-value"]')).toHaveClass(
      'min-w-0',
      'truncate',
      'text-muted-foreground',
    );
    expect(t.closest('[data-slot="combobox"]')).toHaveClass(
      'relative',
      'block',
      'w-full',
      'min-w-0',
    );
  });

  it('opens a portalled menu with a named search box and a named listbox (Thai defaults)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());

    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    const content = document.querySelector<HTMLElement>('[data-slot="combobox-content"]');
    expect(content).not.toBeNull();
    expect(screen.getByTestId('clip')).not.toContainElement(content);
    expect(content).toHaveClass('w-(--radix-popover-trigger-width)', 'min-w-64', 'p-0');
    expect(trigger()).toHaveAttribute('aria-controls', content!.id);

    expect(searchBox()).toHaveAttribute('placeholder', 'พิมพ์เพื่อค้นหา…');
    expect(searchBox()).toHaveAttribute('aria-label', 'ค้นหา'); // tools select it by attribute
    const listbox = within(content!).getByRole('listbox', { name: 'ตัวเลือก' });
    expect(listbox).toHaveClass('overscroll-contain');
    expect(within(listbox).getAllByRole('option')).toHaveLength(4);
    expect(within(listbox).getAllByRole('option')[0]).toHaveClass('leading-snug', 'min-h-11');
  });

  it('keeps the accessible name = label after picking; the value is the button text', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);

    await pickComboOption(user, 'สาขา', 'บางนา');

    expect(onPick).toHaveBeenCalledWith('b2', BRANCHES[1]);
    const t = screen.getByRole('combobox', { name: 'สาขา' });
    expect(t).toHaveTextContent('บางนา');
    expect(t.querySelector('[data-slot="combobox-value"]')).toHaveAttribute('title', 'บางนา');
    expect(t).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(t).toHaveFocus());
  });

  it('merges className after formControlClass (caller wins) and wrapperClassName on the wrapper', () => {
    render(<Harness className="w-40 border-destructive" wrapperClassName="max-w-xs" />);
    expect(trigger()).toHaveClass('w-40', 'border-destructive', 'h-11', 'rounded-lg');
    expect(trigger()).not.toHaveClass('w-full');
    expect(trigger()).not.toHaveClass('border-input');
    expect(trigger().closest('[data-slot="combobox"]')).toHaveClass('max-w-xs');
  });

  it('uses the caller copy for placeholder, search, list and empty text', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        placeholder="เลือกสาขา"
        searchPlaceholder="ชื่อสาขา"
        searchLabel="ค้นหาสาขา"
        listLabel="รายการสาขา"
        emptyText="ไม่พบสาขา"
      />,
    );
    expect(trigger()).toHaveTextContent('เลือกสาขา');
    await user.click(trigger());
    const search = screen.getByRole('combobox', { name: 'ค้นหาสาขา' });
    expect(search).toHaveAttribute('placeholder', 'ชื่อสาขา');
    expect(screen.getByRole('listbox', { name: 'รายการสาขา' })).toBeInTheDocument();
    await user.type(search, 'ไม่มีสาขานี้');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('ไม่พบสาขา')).toBeInTheDocument();
  });

  it('renders the default empty text ไม่พบรายการ', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());
    await user.type(searchBox(), 'zzz');
    expect(screen.getByText('ไม่พบรายการ')).toBeInTheDocument();
  });
});

describe('Combobox — keyboard', () => {
  it.each([['{ArrowDown}'], ['{Enter}'], [' ']])(
    '%s on the trigger opens the menu',
    async (key) => {
      const user = userEvent.setup();
      render(<Harness />);
      trigger().focus();
      await user.keyboard(key);
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      expect(trigger()).toHaveAttribute('aria-expanded', 'true');
      expect(searchBox()).toHaveFocus();
    },
  );

  it("navigates to and picks an option whose value is '' in the first row", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const options: ComboOption[] = [{ value: '', label: 'ทุกสาขา' }, ...BRANCHES];
    render(<Harness options={options} initialValue="b1" onPick={onPick} />);
    trigger().focus();
    await user.keyboard('{ArrowDown}');

    const rows = screen.getAllByRole('option');
    expect(rows[1]).toHaveAttribute('aria-selected', 'true'); // current value b1
    await user.keyboard('{ArrowUp}');
    expect(rows[0]).toHaveAttribute('aria-selected', 'true');
    expect(searchBox()).toHaveAttribute('aria-activedescendant', rows[0].id);
    await user.keyboard('{ArrowDown}{ArrowUp}{Enter}');

    expect(onPick).toHaveBeenCalledWith('', options[0]);
    expect(trigger()).toHaveTextContent('ทุกสาขา');
    expect(screen.queryByRole('listbox')).toBeNull();
    await waitFor(() => expect(trigger()).toHaveFocus());

    // Reopen: the '' row is the current value and is highlighted.
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('picking the already-selected row calls onChange again (AddressForm resets depend on it)', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness initialValue="b2" onPick={onPick} />);
    await pickComboOption(user, 'สาขา', 'บางนา');
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('b2', BRANCHES[1]);
    trigger().focus();
    await user.keyboard('{ArrowDown}{Enter}'); // opens on the current row, Enter re-picks it
    expect(onPick).toHaveBeenCalledTimes(2);
    expect(onPick).toHaveBeenLastCalledWith('b2', BRANCHES[1]);
  });

  it('ArrowDown skips a disabled row', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness initialValue="b2" onPick={onPick} />);
    trigger().focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}'); // b2 → (b3 disabled) → b4
    expect(onPick).toHaveBeenCalledWith('b4', BRANCHES[3]);
  });

  it('a printable key on the trigger opens and seeds the search with the caret at the end', async () => {
    const user = userEvent.setup();
    render(<Harness label="จังหวัด" id="province" options={PROVINCES} />);
    trigger('จังหวัด').focus();

    await user.keyboard('ชล');

    const search = searchBox() as HTMLInputElement;
    expect(search).toHaveFocus();
    // Radix would have selected the seeded "ช", and "ล" would have replaced it.
    expect(search).toHaveValue('ชล');
    expect(search.selectionStart).toBe(2);
    expect(search.selectionEnd).toBe(2);
    expect(optionNames()).toEqual(['ชลบุรี']);
    expect(screen.getByRole('option', { name: 'ชลบุรี' })).toHaveAttribute('aria-selected', 'true');
  });

  it('does not open for an IME composition key or a shortcut', () => {
    render(<Harness />);
    const t = trigger();
    fireEvent.keyDown(t, { key: 'ก', isComposing: true });
    fireEvent.keyDown(t, { key: 'ก', keyCode: 229 });
    fireEvent.keyDown(t, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(t, { key: 'Shift' });
    expect(t).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Escape closes the menu and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it.each([['{Tab}'], ['{Shift>}{Tab}{/Shift}']])(
    '%s in the search box closes without picking and keeps focus on the trigger',
    async (keys) => {
      const user = userEvent.setup();
      const onPick = vi.fn();
      render(<Harness initialValue="b2" onPick={onPick} />);
      await user.click(trigger());
      expect(searchBox()).toHaveFocus();
      await user.keyboard(keys);
      expect(screen.queryByRole('listbox')).toBeNull();
      expect(onPick).not.toHaveBeenCalled();
      expect(trigger()).toHaveTextContent('บางนา');
      await waitFor(() => expect(trigger()).toHaveFocus());
    },
  );

  it('does not open when disabled (native disabled attribute)', async () => {
    const user = userEvent.setup();
    render(<Harness disabled />);
    expect(trigger()).toHaveAttribute('disabled');
    await user.click(trigger());
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('is disabled by a disabled <fieldset> around it', async () => {
    const user = userEvent.setup();
    render(
      <fieldset disabled>
        <Harness />
      </fieldset>,
    );
    expect(trigger()).toBeDisabled();
    await user.click(trigger());
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('Combobox — open state', () => {
  it('highlights and scrolls to the selected row on open and announces it', async () => {
    const user = userEvent.setup();
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(<Harness initialValue="b4" />);
    await user.click(trigger());

    const current = screen.getByRole('option', { name: 'ชลบุรี' });
    expect(current).toHaveAttribute('aria-selected', 'true');
    expect(scroll.mock.contexts).toContain(current);
    expect(searchBox()).toHaveAttribute('aria-activedescendant', current.id);
    expect(current.querySelector('svg.lucide-check')).toHaveClass('text-primary!');
    // Only selected rows carry a check mark.
    expect(screen.getByRole('option', { name: 'ลาดพร้าว' }).querySelector('svg')).toBeNull();
  });

  it('opens on the first enabled row when no row is selected', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    // รังสิต (disabled) first, then ลาดพร้าว, บางนา, ชลบุรี — value '' matches no row
    const options = [BRANCHES[2], BRANCHES[0], BRANCHES[1], BRANCHES[3]];
    render(<Harness options={options} initialValue="" onPick={onPick} />);
    trigger().focus();
    await user.keyboard('{ArrowDown}');

    const rows = screen.getAllByRole('option');
    expect(rows[0]).toHaveAttribute('aria-disabled', 'true');
    expect(rows[0]).toHaveAttribute('aria-selected', 'false');
    expect(rows[1]).toHaveTextContent('ลาดพร้าว');
    expect(rows[1]).toHaveAttribute('aria-selected', 'true');
    expect(searchBox()).toHaveAttribute('aria-activedescendant', rows[1].id);
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith('b1', BRANCHES[0]);
  });

  it('marks every row whose value equals value (plain equality)', async () => {
    const user = userEvent.setup();
    const options: ComboOption[] = [
      { value: 'สมชาย', label: 'สมชาย', description: 'ลูกค้า' },
      { value: 'สมชาย', label: 'สมชาย', description: 'ผู้จัดจำหน่าย' },
      { value: 'สมหญิง', label: 'สมหญิง' },
    ];
    render(<Harness label="ผู้ติดต่อ" id="contact" options={options} initialValue="สมชาย" />);
    await user.click(trigger('ผู้ติดต่อ'));
    const marks = screen.getAllByRole('option').map((r) => !!r.querySelector('svg.lucide-check'));
    expect(marks).toEqual([true, true, false]);
  });

  it('typing highlights the first result', async () => {
    const user = userEvent.setup();
    render(<Harness initialValue="b1" />);
    await user.click(trigger());
    await user.type(searchBox(), 'บาง');
    const first = screen.getAllByRole('option')[0];
    expect(first).toHaveTextContent('บางนา');
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(searchBox()).toHaveAttribute('aria-activedescendant', first.id);
  });

  it('clears the search when the menu closes', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());
    await user.type(searchBox(), 'บาง');
    await user.keyboard('{Escape}');
    await user.click(trigger());
    expect(searchBox()).toHaveValue('');
    expect(screen.getAllByRole('option')).toHaveLength(4);
  });

  it('follows a controlled open / onOpenChange', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Combobox
        aria-label="สาขา"
        value={null}
        onChange={vi.fn()}
        options={BRANCHES}
        open={false}
        onOpenChange={onOpenChange}
      />,
    );
    await user.click(trigger());
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('listbox')).toBeNull();
    rerender(
      <Combobox
        aria-label="สาขา"
        value={null}
        onChange={vi.fn()}
        options={BRANCHES}
        open
        onOpenChange={onOpenChange}
      />,
    );
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('a controlled open going to false resets the search and reports onSearchChange("")', async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    const props = {
      'aria-label': 'สาขา',
      value: null,
      onChange: vi.fn(),
      options: BRANCHES,
      onSearchChange,
    };
    const { rerender } = render(<Combobox {...props} open />);
    await user.type(searchBox(), 'บาง');
    expect(onSearchChange).toHaveBeenLastCalledWith('บาง');
    rerender(<Combobox {...props} open={false} />);
    expect(onSearchChange).toHaveBeenLastCalledWith('');
    rerender(<Combobox {...props} open />);
    expect(searchBox()).toHaveValue('');
  });

  it('mounted open (controlled) highlights the current value', () => {
    render(<Combobox aria-label="สาขา" value="b2" onChange={vi.fn()} options={BRANCHES} open />);
    expect(screen.getByRole('option', { name: 'บางนา' })).toHaveAttribute('aria-selected', 'true');
  });

  it('focuses the list instead of the search box on a coarse pointer; arrows and Enter still pick', async () => {
    const user = userEvent.setup();
    const real = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      ...real(query),
      matches: query === '(pointer: coarse)',
    })) as typeof window.matchMedia;
    try {
      const onPick = vi.fn();
      render(<Harness onPick={onPick} />);
      await user.click(trigger());
      expect(screen.getByRole('listbox')).toHaveFocus();
      expect(searchBox()).not.toHaveFocus();
      await user.keyboard('{ArrowDown}{Enter}');
      expect(onPick).toHaveBeenCalledWith('b2', BRANCHES[1]);
    } finally {
      window.matchMedia = real;
    }
  });
});

describe('Combobox — search', () => {
  it('ranks with thai-search by default: prefix, then after a leading vowel, then mid-word', async () => {
    const user = userEvent.setup();
    render(<Harness label="จังหวัด" id="province" options={PROVINCES} />);
    await user.click(trigger('จังหวัด'));
    await user.type(searchBox(), 'ช');
    expect(optionNames()).toEqual([
      'ชลบุรี',
      'ชัยนาท',
      'ชุมพร',
      'ชัยภูมิ',
      'เชียงใหม่',
      'ฉะเชิงเทรา',
    ]);
  });

  it('matches keywords (account codes) and the ำ spelled as ํ + า', async () => {
    const user = userEvent.setup();
    const accounts: ComboOption[] = [
      { value: '52-1101', label: 'ค่าน้ำมันรถ', keywords: ['52-1101'] },
      { value: '52-1102', label: 'ค่าทางด่วน', keywords: ['52-1102'] },
      { value: '53-1301', label: 'ค่าเช่าสำนักงาน', keywords: ['53-1301'] },
    ];
    render(<Harness label="บัญชี" id="account" options={accounts} />);
    await user.click(trigger('บัญชี'));
    await user.type(searchBox(), '52-11');
    expect(optionNames()).toEqual(['ค่าน้ำมันรถ', 'ค่าทางด่วน']);
    await user.clear(searchBox());
    await user.type(searchBox(), 'นํ้า');
    expect(optionNames()).toEqual(['ค่าน้ำมันรถ']);
  });

  it('uses a caller filter with the raw query and keeps its order as-is; the first row is highlighted', async () => {
    const user = userEvent.setup();
    // e.g. AddressForm ranks districts on the name without the เขต/อำเภอ prefix.
    const filter = vi.fn((options: ComboOption[], query: string) =>
      options.filter((o) => o.value !== 'b3' && query.trim() !== '').reverse(),
    );
    render(<Harness filter={filter} />);
    await user.click(trigger());
    await user.type(searchBox(), 'x ');
    expect(filter).toHaveBeenLastCalledWith(BRANCHES, 'x ');
    expect(optionNames()).toEqual(['ชลบุรี', 'บางนา', 'ลาดพร้าว']);
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('lists rows under group headings in first-seen order', async () => {
    const user = userEvent.setup();
    const options: ComboOption[] = [
      { value: 'a', label: 'สวัสดีค่ะ', group: 'ทักทาย' },
      { value: 'b', label: 'ขอบคุณค่ะ', group: 'ปิดการขาย' },
      { value: 'c', label: 'สวัสดีครับ', group: 'ทักทาย' },
    ];
    render(<Harness label="ข้อความ" id="reply" options={options} />);
    await user.click(trigger('ข้อความ'));
    const groups = screen.getAllByRole('group');
    expect(groups).toHaveLength(2);
    expect(
      within(groups[0])
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['สวัสดีค่ะ', 'สวัสดีครับ']);
    expect(screen.getByText('ทักทาย')).toBeInTheDocument();
    expect(screen.getByText('ปิดการขาย')).toBeInTheDocument();
  });

  it('searchable={false}: no search box, the list takes focus, arrows and Enter pick', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness searchable={false} onPick={onPick} />);
    await user.click(trigger());
    expect(screen.queryByRole('combobox', { name: 'ค้นหา' })).toBeNull();
    expect(screen.getByRole('listbox')).toHaveFocus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onPick).toHaveBeenCalledWith('b2', BRANCHES[1]);
  });
});

describe('Combobox — server mode', () => {
  const PEOPLE: ComboOption[] = [
    { value: 'c1', label: 'สมชาย ใจดี', description: '081-111-1111' },
    { value: 'c2', label: 'สมหญิง รักดี', description: '089-222-2222' },
  ];

  function ServerHarness({
    onSearch,
    onRetry,
    loading = false,
    error = false,
    results = PEOPLE,
  }: {
    onSearch: (term: string) => void;
    onRetry?: () => void;
    loading?: boolean;
    error?: boolean | string;
    results?: ComboOption[];
  }) {
    const [value, setValue] = useState<string | null>(null);
    return (
      <>
        <label htmlFor="customer">ลูกค้า</label>
        <Combobox
          id="customer"
          value={value}
          onChange={setValue}
          options={results}
          searchable={false}
          onSearchChange={onSearch}
          loading={loading}
          error={error}
          onRetry={onRetry}
        />
      </>
    );
  }

  it('reports every search change, keeps the server rows unfiltered and resets the term on close', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(<ServerHarness onSearch={onSearch} />);
    await user.click(trigger('ลูกค้า'));
    // searchable={false} is overridden: server mode always shows the search box.
    await user.type(searchBox(), '0811');
    expect(onSearch.mock.calls.map(([t]) => t)).toEqual(['0', '08', '081', '0811']);
    // The server matched by phone — the labels do not contain the term, rows are not filtered.
    expect(optionNames()).toEqual(['สมชาย ใจดี081-111-1111', 'สมหญิง รักดี089-222-2222']);
    await user.keyboard('{Escape}');
    expect(onSearch).toHaveBeenLastCalledWith('');
  });

  it('new server rows under a search highlight the first enabled row, so Enter picks it', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    function Live({ results }: { results: ComboOption[] }) {
      return (
        <Combobox
          aria-label="ลูกค้า"
          value={null}
          onChange={onPick}
          options={results}
          onSearchChange={vi.fn()}
        />
      );
    }
    const first: ComboOption[] = [...PEOPLE, { value: 'c3', label: 'สมใจ ใจงาม' }];
    const { rerender } = render(<Live results={first} />);
    await user.click(trigger('ลูกค้า'));
    await user.type(searchBox(), 'สม');
    await user.keyboard('{ArrowDown}{ArrowDown}'); // the user moved to the 3rd row
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true');

    const fresh: ComboOption[] = [
      { value: 'c9', label: 'สมปอง ปิดบัญชี', disabled: true, disabledReason: 'ปิดบัญชีแล้ว' },
      { value: 'c7', label: 'สมศรี มีสุข' },
      { value: 'c8', label: 'สมพร ดีใจ' },
    ];
    rerender(<Live results={fresh} />); // debounced results arrive, same search text
    const rows = screen.getAllByRole('option');
    expect(rows[1]).toHaveAttribute('aria-selected', 'true'); // first enabled row
    expect(searchBox()).toHaveAttribute('aria-activedescendant', rows[1].id);
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith('c7', fresh[1]);
  });

  it('applies a caller filter as given also in server mode', async () => {
    const user = userEvent.setup();
    const filter = vi.fn((options: ComboOption[]) => options.slice(1));
    render(
      <Combobox
        aria-label="ลูกค้า"
        value={null}
        onChange={vi.fn()}
        options={PEOPLE}
        onSearchChange={vi.fn()}
        filter={filter}
      />,
    );
    await user.click(trigger('ลูกค้า'));
    await user.type(searchBox(), 'x');
    expect(filter).toHaveBeenLastCalledWith(PEOPLE, 'x');
    expect(optionNames()).toEqual(['สมหญิง รักดี089-222-2222']);
  });

  it('shows กำลังโหลด… while loading, not the empty text', async () => {
    const user = userEvent.setup();
    render(<ServerHarness onSearch={vi.fn()} loading results={[]} />);
    await user.click(trigger('ลูกค้า'));
    expect(screen.getByRole('status')).toHaveTextContent('กำลังโหลด…');
    expect(screen.getByRole('status').querySelector('svg')).toHaveClass('animate-spin');
    expect(screen.queryByText('ไม่พบรายการ')).toBeNull();
  });

  it('shows โหลดรายการไม่สำเร็จ + ลองใหม่; the retry button works by click and by Enter', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ServerHarness onSearch={vi.fn()} error results={[]} onRetry={onRetry} />);
    await user.click(trigger('ลูกค้า'));
    expect(screen.getByRole('alert')).toHaveTextContent('โหลดรายการไม่สำเร็จ');
    expect(screen.queryByText('ไม่พบรายการ')).toBeNull();
    const retry = screen.getByRole('button', { name: 'ลองใหม่' });
    await user.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    // Outside <Command>: cmdk does not turn Enter into a row pick.
    retry.focus();
    await user.keyboard('{Enter}');
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('shows a caller error string', async () => {
    const user = userEvent.setup();
    render(<ServerHarness onSearch={vi.fn()} error="โหลดลูกค้าไม่สำเร็จ" results={[]} />);
    await user.click(trigger('ลูกค้า'));
    expect(screen.getByRole('alert')).toHaveTextContent('โหลดลูกค้าไม่สำเร็จ');
    expect(screen.queryByRole('button', { name: 'ลองใหม่' })).toBeNull();
  });
});

describe('Combobox — clearable', () => {
  it('a separate clear button calls onChange("", null) and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness initialValue="b1" clearable onPick={onPick} />);
    expect(trigger().querySelector('[data-slot="combobox-value"]')).toHaveClass('mr-8');
    const clear = screen.getByRole('button', { name: 'ล้างค่า' });
    expect(trigger()).not.toContainElement(clear);

    await user.click(clear);

    expect(onPick).toHaveBeenCalledWith('', null);
    expect(trigger()).toHaveTextContent('เลือก…');
    expect(screen.queryByRole('button', { name: 'ล้างค่า' })).toBeNull();
    expect(trigger()).toHaveFocus();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('has no clear button without a value or when disabled; takes a custom name', () => {
    const { rerender } = render(<Harness clearable />);
    expect(screen.queryByRole('button', { name: 'ล้างค่า' })).toBeNull();
    rerender(<Harness clearable initialValue="b1" disabled key="d" />);
    expect(screen.queryByRole('button', { name: 'ล้างค่า' })).toBeNull();
    rerender(<Harness clearable initialValue="b1" clearLabel="ล้างสาขา" key="c" />);
    expect(screen.getByRole('button', { name: 'ล้างสาขา' })).toBeInTheDocument();
    // Any non-empty value, also one no option carries.
    rerender(<Harness clearable initialValue="zz" key="z" />);
    expect(screen.getByRole('button', { name: 'ล้างค่า' })).toBeInTheDocument();
  });
});

describe('Combobox — pending', () => {
  it('keeps the menu open with one pending row until the caller finishes', async () => {
    const user = userEvent.setup();
    const work = deferred();
    function PendingHarness() {
      const [value, setValue] = useState<string | null>(null);
      const [pending, setPending] = useState(false);
      return (
        <>
          <label htmlFor="assignee">ผู้รับงาน</label>
          <Combobox
            id="assignee"
            value={value}
            options={BRANCHES}
            pending={pending}
            onChange={(next) => {
              setPending(true); // same event as the pick → the menu never flickers closed
              void work.promise.then(() => {
                setValue(next);
                setPending(false);
              });
            }}
          />
        </>
      );
    }
    render(<PendingHarness />);
    await user.click(trigger('ผู้รับงาน'));
    await user.click(screen.getByRole('option', { name: 'บางนา' }));

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('กำลังเพิ่ม…');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.queryByText('ไม่พบรายการ')).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.type(searchBox(), 'บ'); // the search box stays usable
    expect(searchBox()).toHaveValue('บ');
    expect(screen.queryAllByRole('option')).toHaveLength(0);

    await act(async () => {
      work.resolve();
      await work.promise;
    });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger('ผู้รับงาน')).toHaveTextContent('บางนา');
  });

  it('a controlled caller keeps it open after a failure; a string replaces the text', async () => {
    const user = userEvent.setup();
    const work = deferred();
    function FailingHarness() {
      const [open, setOpen] = useState(false);
      const [pending, setPending] = useState(false);
      return (
        <Combobox
          aria-label="ผู้ติดต่อ"
          value={null}
          options={BRANCHES}
          open={open}
          onOpenChange={setOpen}
          pending={pending && 'กำลังบันทึก…'}
          onChange={() => {
            setPending(true);
            void work.promise.then(() => {
              setPending(false);
              setOpen(true); // failed: stay open so the user can pick again
            });
          }}
        />
      );
    }
    render(<FailingHarness />);
    await user.click(trigger('ผู้ติดต่อ'));
    await user.click(screen.getByRole('option', { name: 'ลาดพร้าว' }));
    expect(screen.getByRole('status')).toHaveTextContent('กำลังบันทึก…');

    await act(async () => {
      work.resolve();
      await work.promise;
    });

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(4);
  });
});

describe('Combobox — closeOnSelect', () => {
  it('false: a pick only calls onChange; the menu closes when the caller sets open=false', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const props = {
      'aria-label': 'ผู้ติดต่อ',
      value: null,
      onChange,
      options: BRANCHES,
      closeOnSelect: false,
      onOpenChange: vi.fn(),
    };
    const { rerender } = render(<Combobox {...props} open />);
    await user.click(screen.getByRole('option', { name: 'บางนา' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('b2', BRANCHES[1]);
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(trigger('ผู้ติดต่อ')).toHaveAttribute('aria-expanded', 'true');
    rerender(<Combobox {...props} open={false} />);
    expect(trigger('ผู้ติดต่อ')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('false (uncontrolled): stays open after a pick; Esc still closes', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness closeOnSelect={false} onPick={onPick} />);
    await user.click(trigger());
    await user.click(screen.getByRole('option', { name: 'บางนา' }));
    expect(onPick).toHaveBeenCalledWith('b2', BRANCHES[1]);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('Combobox — create', () => {
  it('createOnEnter: Enter with no exact label match calls onCreate(term) and closes', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onPick = vi.fn();
    render(<Harness onCreate={onCreate} createOnEnter onPick={onPick} />);
    await user.click(trigger());
    await user.type(searchBox(), ' บาง ');
    // "บาง" matches บางนา, but no label equals it → Enter creates instead of picking the first row.
    expect(screen.getByRole('button', { name: 'สร้าง “บาง”' })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onCreate).toHaveBeenCalledWith(' บาง '); // raw text — callers trim
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows the empty text together with the create row; an error does not hide the create row', async () => {
    const user = userEvent.setup();
    render(<Harness onCreate={vi.fn()} error="โหลดสาขาไม่สำเร็จ" />);
    await user.click(trigger());
    await user.type(searchBox(), 'สาขาใหม่');
    expect(screen.getByRole('button', { name: 'สร้าง “สาขาใหม่”' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('โหลดสาขาไม่สำเร็จ');
  });

  it('shows ไม่พบรายการ next to the create row when nothing matches', async () => {
    const user = userEvent.setup();
    render(<Harness onCreate={vi.fn()} />);
    await user.click(trigger());
    await user.type(searchBox(), 'สาขาใหม่');
    expect(screen.getByText('ไม่พบรายการ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'สร้าง “สาขาใหม่”' })).toBeInTheDocument();
  });

  it('createOnEnter: an exact label match is picked, not created', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onPick = vi.fn();
    render(<Harness onCreate={onCreate} createOnEnter onPick={onPick} />);
    await user.click(trigger());
    await user.type(searchBox(), 'บางนา');
    expect(screen.queryByRole('button', { name: /สร้าง/ })).toBeNull();
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith('b2', BRANCHES[1]);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('without createOnEnter Enter picks the row; the create button (custom label) calls onCreate', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onPick = vi.fn();
    render(
      <Harness
        onCreate={onCreate}
        createLabel={(t) => `+ เพิ่มสาขา "${t.trim()}"`}
        onPick={onPick}
      />,
    );
    await user.click(trigger());
    await user.type(searchBox(), 'บาง');
    await user.click(screen.getByRole('button', { name: '+ เพิ่มสาขา "บาง"' }));
    expect(onCreate).toHaveBeenCalledWith('บาง');

    await user.click(trigger());
    await user.type(searchBox(), 'บาง');
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith('b2', BRANCHES[1]);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});

describe('Combobox — footer', () => {
  it('renders outside <Command>: Tab reaches it and Enter clicks it without picking a row', async () => {
    const user = userEvent.setup();
    const onFooter = vi.fn();
    const onPick = vi.fn();
    render(
      <Harness
        onPick={onPick}
        footer={
          <button type="button" onClick={onFooter}>
            สร้างลูกค้าใหม่
          </button>
        }
      />,
    );
    await user.click(trigger());
    const footerButton = screen.getByRole('button', { name: 'สร้างลูกค้าใหม่' });
    expect(footerButton.closest('[cmdk-root]')).toBeNull();
    expect(footerButton.closest('[data-slot="combobox-footer"]')).not.toBeNull();

    await user.keyboard('{Tab}');
    expect(footerButton).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onFooter).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();

    // Tab past the last stop closes the menu.
    await user.keyboard('{Tab}');
    expect(screen.queryByRole('listbox')).toBeNull();
    await waitFor(() => expect(trigger()).toHaveFocus());
  });
});

describe('Combobox — disabled options', () => {
  it('shows disabledReason as text and cannot be picked by click', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    await user.click(trigger());
    const row = screen.getByRole('option', { name: /^รังสิต/ });
    expect(row).toHaveAttribute('aria-disabled', 'true');
    // Not faded (Task 2: opacity-50 fails contrast) — secondary text colour instead.
    expect(row).toHaveClass(
      'data-[disabled=true]:opacity-100',
      'data-[disabled=true]:text-muted-foreground',
    );
    expect(row).not.toHaveClass('data-[disabled=true]:opacity-50');
    expect(within(row).getByText('ปิดชั่วคราว')).toBeVisible();
    await user.click(row);
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('pickComboOption fails instead of passing silently on a disabled row', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await expect(pickComboOption(user, 'สาขา', /^รังสิต/)).rejects.toThrow(/still open/);
  });
});

describe('Combobox — selectedOption', () => {
  it('shows the current value that is not in options, but never as a row', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(
      <Harness
        label="ผู้รับผิดชอบ"
        id="owner"
        initialValue="u-old"
        selectedOption={{ value: 'u-old', label: 'สมศักดิ์ (ลาออกแล้ว)' }}
        onPick={onPick}
      />,
    );
    expect(trigger('ผู้รับผิดชอบ')).toHaveTextContent('สมศักดิ์ (ลาออกแล้ว)');
    await user.click(trigger('ผู้รับผิดชอบ'));
    expect(screen.getAllByRole('option')).toHaveLength(4);
    expect(screen.queryByRole('option', { name: /สมศักดิ์/ })).toBeNull();
    await user.click(screen.getByRole('option', { name: 'บางนา' }));
    expect(onPick).toHaveBeenCalledWith('b2', BRANCHES[1]);
  });

  it('is ignored when the value is in options', () => {
    render(<Harness initialValue="b1" selectedOption={{ value: 'zz', label: 'อื่น ๆ' }} />);
    expect(trigger()).toHaveTextContent('ลาดพร้าว');
  });

  it('is ignored when its value differs from value — the trigger shows the placeholder', () => {
    render(<Harness initialValue="u-1" selectedOption={{ value: 'u-2', label: 'สมศักดิ์' }} />);
    expect(trigger()).toHaveTextContent('เลือก…');
  });

  it('shows the placeholder when the value matches no option and there is no selectedOption', () => {
    render(<Harness initialValue="zz" placeholder="-- เลือกจังหวัด --" />);
    expect(trigger()).toHaveTextContent('-- เลือกจังหวัด --');
    expect(trigger().querySelector('[data-slot="combobox-value"]')).toHaveClass(
      'text-muted-foreground',
    );
  });
});

describe('Combobox — render props', () => {
  it('renderValue / renderOption replace the trigger and row content', async () => {
    const user = userEvent.setup();
    const options: ComboOption<{ code: string }>[] = [
      { value: 'a', label: 'เงินสด', meta: { code: '11-1101' } },
      { value: 'b', label: 'ธนาคาร', meta: { code: '11-1201' } },
    ];
    render(
      <Combobox<{ code: string }>
        aria-label="บัญชีรับเงิน"
        value="a"
        onChange={vi.fn()}
        options={options}
        renderValue={(o) => `${o.meta?.code} ${o.label}`}
        renderOption={(o, { selected }) => `${o.meta?.code} ${o.label}${selected ? ' ✓' : ''}`}
      />,
    );
    expect(trigger('บัญชีรับเงิน')).toHaveTextContent('11-1101 เงินสด');
    const valueText = trigger('บัญชีรับเงิน').querySelector('[data-slot="combobox-value"]');
    expect(valueText).toHaveAttribute('title', 'เงินสด');
    await user.click(trigger('บัญชีรับเงิน'));
    expect(optionNames()).toEqual(['11-1101 เงินสด ✓', '11-1201 ธนาคาร']);
    // renderOption owns the whole row: the Combobox adds no check mark.
    for (const row of screen.getAllByRole('option')) expect(row.querySelector('svg')).toBeNull();
  });
});

describe('Combobox — inside overlays', () => {
  type Wrap = (
    open: boolean,
    onOpenChange: (open: boolean) => void,
    children: React.ReactNode,
  ) => React.ReactNode;
  it.each<[string, Wrap]>([
    [
      'Dialog',
      (open, onOpenChange, children) => (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogTitle>หัวข้อหน้าต่าง</DialogTitle>
            <DialogDescription>รายละเอียด</DialogDescription>
            {children}
          </DialogContent>
        </Dialog>
      ),
    ],
    [
      'Sheet',
      (open, onOpenChange, children) => (
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent>
            <SheetTitle>หัวข้อหน้าต่าง</SheetTitle>
            <SheetDescription>รายละเอียด</SheetDescription>
            {children}
          </SheetContent>
        </Sheet>
      ),
    ],
    [
      'AlertDialog',
      (open, onOpenChange, children) => (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
          <AlertDialogContent>
            <AlertDialogTitle>หัวข้อหน้าต่าง</AlertDialogTitle>
            <AlertDialogDescription>รายละเอียด</AlertDialogDescription>
            {children}
          </AlertDialogContent>
        </AlertDialog>
      ),
    ],
  ])(
    '%s: picks inside it; the first Esc closes only the menu, the second the overlay',
    async (_name, wrap) => {
      const user = userEvent.setup();
      function Overlay() {
        const [open, setOpen] = useState(true);
        const [value, setValue] = useState<string | null>(null);
        return wrap(
          open,
          setOpen,
          <Combobox aria-label="สาขา" value={value} onChange={setValue} options={BRANCHES} />,
        );
      }
      render(<Overlay />);

      await user.click(trigger());
      await user.click(screen.getByRole('option', { name: 'ชลบุรี' }));
      expect(trigger()).toHaveTextContent('ชลบุรี');
      expect(screen.getByText('หัวข้อหน้าต่าง')).toBeInTheDocument();

      await user.click(trigger());
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('listbox')).toBeNull();
      expect(screen.getByText('หัวข้อหน้าต่าง')).toBeInTheDocument();
      await waitFor(() => expect(trigger()).toHaveFocus());

      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByText('หัวข้อหน้าต่าง')).toBeNull());
    },
  );

  it('in a modal Dialog, wheel and touchmove on the list never reach the document scroll lock', async () => {
    const user = userEvent.setup();
    const onDocumentScroll = vi.fn();
    document.addEventListener('wheel', onDocumentScroll);
    document.addEventListener('touchmove', onDocumentScroll);
    try {
      render(
        <Dialog open>
          <DialogContent>
            <DialogTitle>หัวข้อหน้าต่าง</DialogTitle>
            <DialogDescription>รายละเอียด</DialogDescription>
            <Combobox aria-label="จังหวัด" value={null} onChange={vi.fn()} options={PROVINCES} />
          </DialogContent>
        </Dialog>,
      );
      await user.click(trigger('จังหวัด'));
      const listbox = screen.getByRole('listbox');
      // true = nobody called preventDefault, so the browser scrolls the list.
      expect(fireEvent.wheel(listbox, { deltaY: 120 })).toBe(true);
      expect(fireEvent.touchMove(listbox)).toBe(true);
      expect(onDocumentScroll).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('wheel', onDocumentScroll);
      document.removeEventListener('touchmove', onDocumentScroll);
    }
  });
});

describe('Combobox — form wiring', () => {
  it('works under shadcn FormControl: label, id, aria-invalid, aria-describedby, ref, onBlur', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    function RhfForm() {
      const form = useForm<{ branchId: string }>({ defaultValues: { branchId: '' } });
      return (
        <Form {...form}>
          <form aria-label="รับเครื่อง" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="branchId"
              rules={{ required: 'กรุณาเลือกสาขา' }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>สาขา</FormLabel>
                  <FormControl>
                    <Combobox
                      value={field.value}
                      onChange={(v) => field.onChange(v)}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      options={BRANCHES}
                    />
                  </FormControl>
                  <FormDescription>สาขาที่รับเครื่อง</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <p data-testid="touched">{String(form.formState.touchedFields.branchId ?? false)}</p>
            <button type="submit">บันทึก</button>
          </form>
        </Form>
      );
    }
    render(<RhfForm />);
    const t = trigger();
    expect(t.id).toMatch(/-control$/);
    expect(t).toHaveAttribute('data-slot', 'combobox-trigger'); // not FormControl's "form-control"
    expect(t).toHaveAttribute('aria-invalid', 'false');
    expect(t).toHaveAccessibleDescription('สาขาที่รับเครื่อง');

    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(await screen.findByText('กรุณาเลือกสาขา')).toBeInTheDocument();
    expect(t).toHaveAttribute('aria-invalid', 'true');
    expect(t).toHaveAccessibleDescription('สาขาที่รับเครื่อง กรุณาเลือกสาขา');
    expect(t).toHaveFocus(); // RHF focused the field through the forwarded ref
    expect(onSubmit).not.toHaveBeenCalled();

    await pickComboOption(user, 'สาขา', 'บางนา');
    expect(t).toHaveAttribute('aria-invalid', 'false');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toEqual({ branchId: 'b2' });
    expect(screen.getByTestId('touched')).toHaveTextContent('true');
  });

  it('takes aria-required / aria-invalid / aria-describedby from LabeledField; required never blocks', async () => {
    render(
      <LabeledField label="สาขา" htmlFor="branch" required error="กรุณาเลือกสาขา">
        <Combobox id="branch" value={null} onChange={vi.fn()} options={BRANCHES} />
      </LabeledField>,
    );
    const t = trigger();
    expect(t).toHaveAttribute('aria-required', 'true');
    expect(t).toHaveAttribute('aria-invalid', 'true');
    expect(t).toHaveAccessibleDescription('กรุณาเลือกสาขา');
  });

  it('required / invalid props set aria-required / aria-invalid', () => {
    render(
      <Combobox
        aria-label="สาขา"
        required
        invalid
        value={null}
        onChange={vi.fn()}
        options={BRANCHES}
      />,
    );
    expect(trigger()).toHaveAttribute('aria-required', 'true');
    expect(trigger()).toHaveAttribute('aria-invalid', 'true');
  });

  it('aria-labelledby names the trigger', () => {
    render(
      <>
        <span id="lbl">สาขาที่ขาย</span>
        <Combobox aria-labelledby="lbl" value={null} onChange={vi.fn()} options={BRANCHES} />
      </>,
    );
    expect(screen.getByRole('combobox', { name: 'สาขาที่ขาย' })).toBeInTheDocument();
  });
});

describe('test helpers (src/test/combobox.ts)', () => {
  it('openCombobox returns the listbox; pickComboOption searches, picks and waits for the close', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness label="จังหวัด" id="province" options={PROVINCES} onPick={onPick} />);
    const listbox = await openCombobox(user, 'จังหวัด');
    expect(listbox).toHaveAttribute('role', 'listbox');
    expect(within(listbox).getAllByRole('option')).toHaveLength(8);
    await user.keyboard('{Escape}');

    await pickComboOption(user, 'จังหวัด', 'ชัยภูมิ', { search: 'ชัย' });
    expect(onPick).toHaveBeenCalledWith('p6', PROVINCES[6]);
    expect(trigger('จังหวัด')).toHaveAttribute('aria-expanded', 'false');
  });
});
```

The test file does not polyfill `scrollIntoView` itself — it relies on the global no-op from Step 5 (the open-state test spies on `Element.prototype.scrollIntoView`, which exists only after Step 5).

- [ ] **Step 4: Run it and watch it fail**

```bash
npm run test --workspace=apps/web -- src/components/ui/combobox.test.tsx
```

Expected: FAIL — `Error: Failed to resolve import "./combobox" from "src/components/ui/combobox.test.tsx". Does the file exist?` and `Test Files  1 failed (1)`.

- [ ] **Step 5: Add the global `scrollIntoView` no-op to `src/test/setup.ts`**

Edit `apps/web/src/test/setup.ts` — old string (end of file, L42-44):

```ts
    dispatchEvent: () => true,
  });
}
```

new string:

```ts
    dispatchEvent: () => true,
  });
}

// jsdom has no Element.scrollIntoView. cmdk (Combobox, CommandPalette, the cmdk pickers) calls it
// on the highlighted row when a list opens and on every keyboard move, and throws without it.
// A writable, configurable no-op on Element.prototype: test files that install their own on
// HTMLElement.prototype (no-ops or vi.fn() spies) shadow it, and their restore (defineProperty
// back / Reflect.deleteProperty) falls back to this one.
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: function scrollIntoView() {},
  });
}
```

Compatible with every file that installs its own (facts-core §1.8, re-checked in Step 9): `HTMLElement.prototype.scrollIntoView ??= …` sees the inherited no-op and skips; unconditional assignments to `Element.prototype` (`BookingFilterBar.test.tsx:10-13`) overwrite it (writable); `vi.fn()` spies assigned to `HTMLElement.prototype` (`CategoryPage.test.tsx:51-52`, `settings-hash-loading.test.tsx:35-36`) shadow it, so their "was called" assertions still see the spy; `Object.defineProperty(HTMLElement.prototype, …)` + restore via `Reflect.deleteProperty` (`TradeInFlow.test.tsx:63-75`, `command-palette-search.test.tsx:15-22`, `CustomerTagDialog.test.tsx:10-21`) falls back to this one. Each test file gets a fresh environment and re-runs `setup.ts`.

- [ ] **Step 6: Write the component**

Create `apps/web/src/components/ui/combobox.tsx` with exactly:

```tsx
import * as React from 'react';
import { useCommandState } from 'cmdk';
import { AlertCircle, Check, ChevronDown, Loader2, Plus, RotateCw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { filterAndRank, normalizeThai } from '@/lib/thai-search';
import { Button } from './button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './command';
import { formControlClass } from './form-styles';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

type ComboOption<M = unknown> = {
  /** '' is allowed — cmdk only ever sees the internal key `opt:${index}`. */
  value: string;
  label: string;
  /** Extra search terms (codes, phone numbers, nicknames) — rank 4 in thai-search. */
  keywords?: string[];
  /** Second line of the row. */
  description?: string;
  /** Rows with the same group are listed under one heading, groups in first-seen order. */
  group?: string;
  disabled?: boolean;
  /** Shown as text under a disabled row (the keyboard never lands on it, so not a tooltip). */
  disabledReason?: string;
  meta?: M;
};

interface ComboboxProps<M = unknown> {
  value: string | null;
  /** `option` is null only when the clear button was used (`value` is then ''). */
  onChange: (value: string, option: ComboOption<M> | null) => void;
  options: ComboOption<M>[];
  /**
   * Display only (never a row): shown in the trigger when no option has `value` and
   * `selectedOption.value === value` (e.g. a former assignee, a contact name from another page).
   */
  selectedOption?: ComboOption<M> | null;
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Accessible name of the search box (cmdk `<Command label>`). */
  searchLabel?: string;
  /** Accessible name of the listbox. */
  listLabel?: string;
  emptyText?: string;
  /**
   * Gets (options, raw query); its order is rendered as-is — also in server mode. Default:
   * `filterAndRank`, except in server mode, where the rows are not filtered again.
   */
  filter?: (options: ComboOption<M>[], query: string) => ComboOption<M>[];
  /** Server mode: the caller owns useDebounce/useQuery and passes the results as `options`. */
  onSearchChange?: (term: string) => void;
  loading?: boolean;
  error?: boolean | string;
  onRetry?: () => void;
  /** Gets the raw search text (callers trim). */
  onCreate?: (term: string) => void;
  createLabel?: (term: string) => string;
  /** Enter in the search box with no option whose label equals the term calls `onCreate`. */
  createOnEnter?: boolean;
  /** Rendered below the list, outside `<Command>` (cmdk turns Enter on a button inside it into a row pick). */
  footer?: React.ReactNode;
  clearable?: boolean;
  clearLabel?: string;
  /** Truthy: the menu stays open, the rows give way to one status row, nothing can be picked. */
  pending?: boolean | string;
  /**
   * Default true. False: a pick only calls `onChange`; the menu stays open until the caller sets
   * `open` to false, or the user presses Esc / clicks outside (ContactCombobox: close on success).
   */
  closeOnSelect?: boolean;
  /** Replaces the whole row content (no check mark is added); `selected` = `option.value === value`. */
  renderOption?: (option: ComboOption<M>, state: { selected: boolean }) => React.ReactNode;
  /** Replaces the value text inside the trigger (its `title` stays `option.label`). */
  renderValue?: (option: ComboOption<M>) => React.ReactNode;
  id?: string;
  /** aria-required only — never blocks a submit. */
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  /** From shadcn `FormControl` / `LabeledField`; `invalid` wins when true. */
  'aria-invalid'?: React.AriaAttributes['aria-invalid'];
  /** From `LabeledField`; `required` wins when true. */
  'aria-required'?: React.AriaAttributes['aria-required'];
  onBlur?: React.FocusEventHandler<HTMLButtonElement>;
  /** Trigger. */
  className?: string;
  wrapperClassName?: string;
  contentClassName?: string;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const DEFAULT_TEXT = {
  placeholder: 'เลือก…',
  searchPlaceholder: 'พิมพ์เพื่อค้นหา…',
  searchLabel: 'ค้นหา',
  listLabel: 'ตัวเลือก',
  empty: 'ไม่พบรายการ',
  loading: 'กำลังโหลด…',
  error: 'โหลดรายการไม่สำเร็จ',
  retry: 'ลองใหม่',
  pending: 'กำลังเพิ่ม…',
  clear: 'ล้างค่า',
  create: (term: string) => `สร้าง “${term}”`,
} as const;

/**
 * Rows (Task 2 mockup): 44px like `ui/select.tsx` items (touch target at 390). Disabled rows are
 * drawn in the secondary text colour without fading — cmdk's default `opacity-50` leaves the
 * label at 3.19:1 and the reason at 2.10:1 (light), below 4.5:1.
 */
const ROW_CLASS =
  'min-h-11 py-2 leading-snug data-[disabled=true]:cursor-not-allowed data-[disabled=true]:text-muted-foreground data-[disabled=true]:opacity-100';

const TABBABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]';

const optionKey = (index: number) => `opt:${index}`;

function isCoarsePointer(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

/** A printable key typed on the closed trigger: opens the menu and becomes the first search letter. */
function isTypeaheadKey(e: React.KeyboardEvent): boolean {
  return (
    e.key.length === 1 &&
    e.key !== ' ' &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !e.nativeEvent.isComposing &&
    e.keyCode !== 229
  );
}

/**
 * cmdk updates `aria-activedescendant` only on its own highlight moves, so a highlight set through
 * the `value` prop (the current value on open, the first row when server results arrive) is not
 * announced. Mirror the highlighted row onto the search box and the list; when cmdk moves the
 * highlight itself, its attribute and ours name the same row.
 */
function ActiveDescendantSync({
  inputRef,
  listRef,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  listRef: React.RefObject<HTMLDivElement | null>;
}) {
  const value = useCommandState((state) => state.value);
  const cmdkActiveId = useCommandState((state) => state.selectedItemId);
  React.useLayoutEffect(() => {
    // Runs after the rows' own layout effects wrote data-value, before cmdk re-renders them selected.
    const rows = listRef.current?.querySelectorAll<HTMLElement>('[cmdk-item]') ?? [];
    const active = value ? Array.from(rows).find((row) => row.dataset.value === value) : undefined;
    for (const el of [inputRef.current, listRef.current]) {
      if (!el) continue;
      if (active) el.setAttribute('aria-activedescendant', active.id);
      else el.removeAttribute('aria-activedescendant');
    }
  }, [value, cmdkActiveId, inputRef, listRef]);
  return null;
}

/**
 * Searchable single-select (spec 2026-11-14 §6.1–§6.3). A raw `<button role="combobox">` with the
 * shared field skin (`formControlClass`, 44px via admin-typography.css) opens a portalled
 * `PopoverContent` holding a cmdk search box and listbox. Rows are ranked by `thai-search`;
 * cmdk's own filter is off and it only ever sees the keys `opt:${index}`.
 *
 * Accessible name = the caller's label (`<label htmlFor={id}>`, `aria-labelledby` or
 * `aria-label`); the component never names itself, so `getByRole('combobox', { name })`
 * keeps working after a value is picked. `id`, `ref`, `onBlur`, `aria-describedby`,
 * `aria-invalid` and `aria-required` reach the trigger, so it works under shadcn `FormControl`
 * and `LabeledField`.
 *
 * Keyboard: ArrowDown / Enter / Space open; a printable key opens and seeds the search; the
 * search box gets focus with the caret at the end (the list on a coarse pointer); Esc closes
 * only the menu (Radix layering inside Dialog / Sheet / AlertDialog); Tab past either end of
 * the menu closes it and returns focus to the trigger. Wheel/touchmove stop at the menu so it
 * scrolls inside a modal Dialog (same escape as WizardStackedOverlay).
 */
function Combobox<M = unknown>({
  value,
  onChange,
  options,
  selectedOption,
  placeholder = DEFAULT_TEXT.placeholder,
  searchable = true,
  searchPlaceholder = DEFAULT_TEXT.searchPlaceholder,
  searchLabel = DEFAULT_TEXT.searchLabel,
  listLabel = DEFAULT_TEXT.listLabel,
  emptyText = DEFAULT_TEXT.empty,
  filter,
  onSearchChange,
  loading = false,
  error = false,
  onRetry,
  onCreate,
  createLabel,
  createOnEnter = false,
  footer,
  clearable = false,
  clearLabel = DEFAULT_TEXT.clear,
  pending = false,
  closeOnSelect = true,
  renderOption,
  renderValue,
  id,
  required = false,
  disabled = false,
  invalid = false,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
  'aria-invalid': ariaInvalid,
  'aria-required': ariaRequired,
  onBlur,
  className,
  wrapperClassName,
  contentClassName,
  align = 'start',
  side = 'bottom',
  open: openProp,
  onOpenChange,
  ref,
}: ComboboxProps<M> & { ref?: React.Ref<HTMLButtonElement> }): React.ReactElement {
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const sentTermRef = React.useRef('');
  const [openState, setOpenState] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const isPending = Boolean(pending);
  const open = !disabled && ((openProp ?? openState) || isPending);
  const showSearch = searchable || Boolean(onSearchChange);

  const isSelected = (o: ComboOption<M>) => value !== null && o.value === value;
  const inOptions = options.find(isSelected);
  // Trigger: the first option with `value`, else `selectedOption` when it carries `value`.
  const current =
    inOptions ?? (value !== null && selectedOption?.value === value ? selectedOption : null);
  const keys = React.useMemo(
    () => new Map(options.map((o, i) => [o, optionKey(i)] as const)),
    [options],
  );
  const keyOf = (o: ComboOption<M>) =>
    keys.get(o) ?? optionKey(options.findIndex((x) => x.value === o.value && x.label === o.label));
  const currentKey = inOptions ? keyOf(inOptions) : '';
  // The cmdk highlight (a row key). Controlled so the current value is highlighted on open.
  const [highlight, setHighlight] = React.useState(() => (open ? currentKey : ''));

  const term = search.trim();
  // Server mode: the caller's rows are already the search result (matched on fields the labels
  // may not show), so they are not filtered again unless the caller passes `filter`.
  const visible = filter
    ? filter(options, search)
    : onSearchChange
      ? options
      : filterAndRank(options, search);
  const sections = new Map<string, ComboOption<M>[]>();
  for (const o of visible) {
    const rows = sections.get(o.group ?? '');
    if (rows) rows.push(o);
    else sections.set(o.group ?? '', [o]);
  }
  const rows = [...sections.values()].flat(); // DOM order
  const firstEnabled = rows.find((o) => !o.disabled);
  const hasExactMatch =
    term !== '' && options.some((o) => normalizeThai(o.label) === normalizeThai(term));
  const canCreate = Boolean(onCreate) && term !== '' && !hasExactMatch && !loading && !isPending;
  const showClear = clearable && !disabled && value !== null && value !== '';
  const status = isPending
    ? typeof pending === 'string'
      ? pending
      : DEFAULT_TEXT.pending
    : loading
      ? DEFAULT_TEXT.loading
      : null;

  // Reset per open: highlight the current value (or let cmdk pick the first match of a seeded
  // search); clear the search on close.
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setHighlight(term ? '' : currentKey);
    } else {
      setSearch('');
      setHighlight('');
    }
  }

  // While searching, a new set of rows (typing, or server results arriving after the debounce)
  // highlights the first enabled row, so Enter picks it.
  const rowsSignature = rows
    .map((o) => `${keyOf(o)}\u0000${o.value}\u0000${o.label}`)
    .join('\u0001');
  const [seenRows, setSeenRows] = React.useState(rowsSignature);
  if (rowsSignature !== seenRows) {
    setSeenRows(rowsSignature);
    if (open && term) setHighlight(firstEnabled ? keyOf(firstEnabled) : '');
  }

  // Server mode: the caller's query follows the search box, so tell it the search was cleared.
  React.useEffect(() => {
    if (!open && sentTermRef.current !== '') {
      sentTermRef.current = '';
      onSearchChange?.('');
    }
  }, [open, onSearchChange]);

  const setTriggerRef = React.useCallback(
    (node: HTMLButtonElement | null) => {
      triggerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const setOpen = (next: boolean) => {
    if (next && disabled) return;
    if (!next && isPending) return;
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };

  const changeSearch = (next: string) => {
    setSearch(next);
    sentTermRef.current = next;
    onSearchChange?.(next);
  };

  const pick = (option: ComboOption<M>) => {
    if (option.disabled) return;
    onChange(option.value, option); // also when it is already the value (callers reset on re-pick)
    if (closeOnSelect) setOpen(false);
  };

  const create = () => {
    if (!onCreate) return;
    onCreate(search);
    setOpen(false);
  };

  const clear = () => {
    onChange('', null);
    triggerRef.current?.focus();
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (open || disabled) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
    } else if (isTypeaheadKey(e)) {
      e.preventDefault();
      if (showSearch) changeSearch(e.key);
      setOpen(true);
    }
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && createOnEnter && canCreate) {
      // preventDefault also stops cmdk's root handler from picking the highlighted row.
      e.preventDefault();
      create();
    }
  };

  const onContentKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey || isPending) return;
    const tabbables = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(TABBABLE)).filter(
      (el) => el.tabIndex >= 0,
    );
    const edge = e.shiftKey ? tabbables[0] : tabbables[tabbables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (active && tabbables.includes(active) && active !== edge) return;
    // Past the last (or before the first) stop: close without picking, focus back on the trigger.
    e.preventDefault();
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onOpenAutoFocus = (e: Event) => {
    // Radix would select the whole search text, so the next typed letter replaced a seeded one.
    e.preventDefault();
    const input = inputRef.current;
    if (input && !isCoarsePointer()) {
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    } else {
      // Touch: no on-screen keyboard until the user taps the search box; arrows/Enter still work.
      listRef.current?.focus();
    }
  };

  // A modal Dialog's scroll lock preventDefault()s wheel/touchmove that bubble out of its content;
  // the portalled menu is outside it, so stop them here.
  const stopScrollLock = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <span
      data-slot="combobox"
      className={cn('relative block w-full min-w-0 max-w-full', wrapperClassName)}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild disabled={disabled}>
          <button
            ref={setTriggerRef}
            id={id}
            type="button"
            role="combobox"
            data-slot="combobox-trigger"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledby}
            aria-describedby={ariaDescribedby}
            aria-invalid={invalid ? true : ariaInvalid}
            aria-required={required ? true : ariaRequired}
            disabled={disabled}
            onKeyDown={onTriggerKeyDown}
            onBlur={onBlur}
            className={cn(
              formControlClass,
              'flex items-center justify-between gap-2 text-left',
              className,
            )}
          >
            {/* title on the text, not the button: on the button it would become the accessible
                description and the value would be read twice. mr-8 = room for the clear button. */}
            <span
              data-slot="combobox-value"
              title={current?.label}
              className={cn(
                'min-w-0 truncate',
                !current && 'text-muted-foreground',
                showClear && 'mr-8',
              )}
            >
              {current ? (renderValue ? renderValue(current) : current.label) : placeholder}
            </span>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        {showClear && (
          <button
            type="button"
            aria-label={clearLabel}
            onClick={clear}
            className="absolute right-9 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/30"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        )}
        <PopoverContent
          data-slot="combobox-content"
          align={align}
          side={side}
          className={cn(
            'flex max-h-(--radix-popover-content-available-height) w-(--radix-popover-trigger-width) min-w-64 flex-col overflow-hidden p-0',
            contentClassName,
          )}
          onOpenAutoFocus={onOpenAutoFocus}
          onKeyDown={onContentKeyDown}
          onWheel={stopScrollLock}
          onTouchMove={stopScrollLock}
        >
          <Command
            label={searchLabel}
            shouldFilter={false}
            vimBindings={false}
            value={highlight}
            onValueChange={setHighlight}
            className="min-h-0"
          >
            {showSearch && (
              <CommandInput
                ref={inputRef}
                // cmdk names the box through aria-labelledby (its hidden label = searchLabel); the
                // same text as an attribute keeps `input[aria-label=…]` selectors working
                // (tools/field-scale/menu-clip.mjs readMenuGeometry).
                aria-label={searchLabel}
                placeholder={searchPlaceholder}
                value={search}
                onValueChange={changeSearch}
                onKeyDown={onSearchKeyDown}
              />
            )}
            {status && (
              <div
                role="status"
                data-slot="combobox-status"
                className="flex items-center justify-center gap-2 px-3 py-6 text-sm leading-snug text-muted-foreground"
              >
                <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin" />
                {status}
              </div>
            )}
            <CommandList ref={listRef} label={listLabel} className="overscroll-contain">
              {!isPending &&
                [...sections].map(([group, groupRows]) => (
                  <CommandGroup key={`group:${group}`} heading={group || undefined}>
                    {groupRows.map((option) => {
                      const key = keyOf(option);
                      const selected = isSelected(option);
                      return (
                        <CommandItem
                          key={key}
                          value={key}
                          disabled={option.disabled}
                          onSelect={() => pick(option)}
                          className={ROW_CLASS}
                        >
                          {renderOption ? (
                            renderOption(option, { selected })
                          ) : (
                            <>
                              <span className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate">{option.label}</span>
                                {option.description && (
                                  <span className="text-xs text-muted-foreground">
                                    {option.description}
                                  </span>
                                )}
                                {option.disabled && option.disabledReason && (
                                  <span className="text-xs text-muted-foreground">
                                    {option.disabledReason}
                                  </span>
                                )}
                              </span>
                              {selected && (
                                // `!`: CommandItem's `[&_svg]:text-muted-foreground` (.x svg)
                                // outranks .text-primary
                                <Check
                                  aria-hidden="true"
                                  className="ml-auto size-4 text-primary!"
                                />
                              )}
                            </>
                          )}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ))}
              {!loading && !error && !isPending && <CommandEmpty>{emptyText}</CommandEmpty>}
            </CommandList>
            <ActiveDescendantSync inputRef={inputRef} listRef={listRef} />
          </Command>
          {error && !isPending && (
            <div
              role="alert"
              data-slot="combobox-error"
              className="flex flex-col items-center gap-3 px-3 py-4 text-center text-sm leading-snug text-destructive"
            >
              <span className="flex items-center gap-2">
                <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
                {typeof error === 'string' ? error : DEFAULT_TEXT.error}
              </span>
              {onRetry && (
                <Button type="button" variant="outline" size="md" onClick={onRetry}>
                  <RotateCw aria-hidden="true" />
                  {DEFAULT_TEXT.retry}
                </Button>
              )}
            </div>
          )}
          {canCreate && (
            <div className="border-t border-border p-1">
              <button
                type="button"
                data-slot="combobox-create"
                onClick={create}
                className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm leading-snug hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-hidden"
              >
                <Plus aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">
                  {createLabel ? createLabel(search) : DEFAULT_TEXT.create(term)}
                </span>
              </button>
            </div>
          )}
          {footer && (
            <div data-slot="combobox-footer" className="border-t border-border p-1">
              {footer}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </span>
  );
}

export { Combobox, type ComboboxProps, type ComboOption };
```

Notes for the implementer (they hold for the code above — do not "fix" them):
- The trigger is a raw `<button>` (spec §6.1: `<Button>` has hover/open colours the fields next to it do not). Radix `Slot` merges props with the child winning, so `aria-haspopup="listbox"` beats Radix's `dialog`; `aria-controls` / `data-state` come from Radix. The component never sets its own accessible name.
- The arrow is inside the button: with `px-3` it lands where `NativeSelect`'s absolute arrow sits (12px + 1px border from the right edge) and fades with the button's `disabled:opacity-60` (Task 2: "Disabled trigger — nothing extra").
- Unknown props are not spread on purpose: shadcn `FormControl` also injects `data-slot="form-control"`, which would replace `combobox-trigger` (facts-core §1.10).
- `open = !disabled && ((open prop ?? internal) || pending)`; `setOpen(false)` is ignored while `pending` (Esc, outside click, trigger click, Tab). A pick calls `setOpen(false)` only when `closeOnSelect` is true.
- Rows are keyed `opt:${index in options}`, so a new server result set can reuse the keys of the old one; `rowsSignature` (key + value + label of the rendered rows, in DOM order) is what tells "the rows changed" and moves the highlight to the first enabled row while a search is typed.
- The per-open reset is "derived state during render" (`wasOpen`), so the first render of an opened menu already carries the highlight → cmdk scrolls that row into view on mount (`v(6, ne)`, facts-core §2.3).
- `ActiveDescendantSync` sits after `CommandList` inside cmdk's root so its layout effect runs after the rows wrote `data-value` (cmdk `ve`). It always mirrors the highlighted row (found by `data-value`): cmdk's own `selectedItemId` goes stale when the highlight is moved through the `value` prop (on open, on new server rows), and when cmdk moves the highlight itself both name the same row.
- `vimBindings={false}`: Ctrl+N/J/P/K stay with the browser (Ctrl+P = print) instead of moving the highlight.
- `text-primary!` on the `Check` and the disabled-row classes are the header's Behaviour "Look" line (compiled with tailwindcss 4.3, `CommandItem`'s `[&_svg]:text-muted-foreground` becomes `.x svg`, specificity 0,1,1, which outranks a plain `.text-primary` 0,1,0 — the `!` wins; cmdk's `opacity-50` on disabled rows fails contrast, 3.19:1 / 2.10:1); `cn()` inside `CommandItem` drops its `data-[disabled=true]:opacity-50` in favour of `opacity-100`.

- [ ] **Step 7: Run the test and watch it pass**

```bash
npm run test --workspace=apps/web -- src/components/ui/combobox.test.tsx
```

Expected: PASS — `Test Files  1 passed (1)` and `Tests  67 passed (67)`, no `stderr` output (no act/Radix warnings).
If Step 5 was skipped the same run fails with `TypeError: e.scrollIntoView is not a function` (`Tests  17 failed | 50 passed (67)` when the plan was verified) — that is the cmdk mount-time scroll the polyfill exists for.

- [ ] **Step 8: Guards — F5 and the field scans must not flag the new files**

```bash
npm run test --workspace=apps/web -- src/components/ui/field-guards.inventory.test.ts src/components/ui/native-select.inventory.test.ts
```

Expected: both files pass with **no edit** to either. Why no allow-list entry is needed (F5 rules, `field-guards.inventory.test.ts:672-684`): the menu is inside `PopoverContent` (rule d — portalled), and the only `absolute` element in `combobox.tsx` is the clear button (`right-9 top-1/2` — not a placement token, rule a; the arrow is in the button's flex flow), so `findInlineMenuPanels(combobox.tsx)` = `[]` and the exact-count scan result is unchanged. `src/test/combobox.ts` and `combobox.test.tsx` are skipped by the scan (`test` dir / test-file regex). The file uses `w-(--…)` / `max-h-(--…)` (never `w-[--…]`, guard L48), no `bg-input` (L52), no JSX `<select>` (native-select inventory). If the F5 scan reports `apps/web/src/components/ui/combobox.tsx`, the clear button got a placement token (`top-full`, `mt-*`…) — revert it rather than adding an allow-list entry.

- [ ] **Step 9: Regression — cmdk users and every file that polyfills `scrollIntoView`**

```bash
npm run test --workspace=apps/web -- src/components/CommandPalette.test.tsx src/components/__tests__/command-palette-search.test.tsx src/components/contacts/ContactCombobox.test.tsx src/components/employees/__tests__/EmployeeCombobox.test.tsx src/components/expense-form-v4/VendorCombobox.test.tsx src/components/expense-form-v4/__tests__/PayrollLinesSection.test.tsx src/components/trade-in/TradeInFlow.test.tsx src/pages/BookingsPage/__tests__/BookingDetailSheet.test.tsx src/pages/BookingsPage/__tests__/BookingFilterBar.test.tsx src/pages/BookingsPage/__tests__/BookingsPage.test.tsx src/pages/BookingsPage/__tests__/CreateBookingDialog.test.tsx src/pages/CollectionsPage/components/CustomerTagDialog.test.tsx src/pages/GeneralLedgerPage.test.tsx src/pages/PurchaseOrdersPage/components/wizard/StepItems.test.tsx src/pages/other-income/components/__tests__/AccountSearchDropdown.test.tsx src/pages/settings/__tests__/CategoryPage.test.tsx src/pages/settings/__tests__/settings-hash-loading.test.tsx src/components/ui/form.test.tsx src/components/ui/labeled-field.test.tsx
```

Expected: `Test Files  19 passed (19)` and `Tests  187 passed (187)` — the same as before Step 5. `TradeInFlow.test.tsx` is a known Windows timeout under load (header); if only its tests time out, rerun it alone: `npm run test --workspace=apps/web -- src/components/trade-in/TradeInFlow.test.tsx` → `21 passed`.

- [ ] **Step 10: Check the code against the approved mockup (Task 2)**

Open the Round 2 plan's `## Progress notes` entry from Task 2 Step 10.

Expected: it says `Decision: approved` (or `approved with changes`, and Task 2 updated its "Produces" table in the same commit). The code above implements Task 2's "Produces" table row by row; if the owner changed a row, change only the matching spot and its pinning assertion, then rerun Step 7:

| Task 2 row | Spot in `combobox.tsx` | Assertion in `combobox.test.tsx` |
|---|---|---|
| Trigger / Value text / Placeholder / Arrow | trigger `className`, `data-slot="combobox-value"` span, in-button `ChevronDown` | "trigger: raw button …" (skin, arrow, value classes) |
| Menu box / Search row / List | `PopoverContent` `className`, `CommandInput`, `CommandList className="overscroll-contain"` | "opens a portalled menu …" |
| Row / Disabled option | `ROW_CLASS` | "opens a portalled menu …" (`min-h-11`, `leading-snug`), "shows disabledReason as text …" (`opacity-100`, not `opacity-50`) |
| Mark on the current value | `<Check … 'ml-auto size-4 text-primary!'>` | "highlights and scrolls …" |
| `กำลังโหลด…` | `data-slot="combobox-status"` + `Loader2` | "shows กำลังโหลด… while loading …" (`animate-spin`) |
| `โหลดรายการไม่สำเร็จ` + `ลองใหม่` | `data-slot="combobox-error"` + `AlertCircle`, `Button size="md"` + `RotateCw` | "shows โหลดรายการไม่สำเร็จ + ลองใหม่ …" |

Not in the Task 2 table (this task's choice): the clear button (`X` in a `size-7` button inside the field, left of the arrow) and the create button row (`Plus` + text, `min-h-11`). Do not change: `formControlClass`, the 44px height, the portal, the Thai default copy (header Global Constraints).

- [ ] **Step 11: Field-scale — not applicable to this task (prove it)**

```bash
grep -rln "components/ui/combobox'" apps/web/src --include=*.ts --include=*.tsx | grep -v "\.test\.tsx$"
```

Expected: no output — no production file imports `Combobox`, so the built bundle and every measured screen are unchanged and `node tools/field-scale/check.mjs --compare baseline-r2 …` would compare identical UI. The first field-scale compare of a `Combobox` is Task 6 (AddressForm hosts), where the re-keyed controls (kind `select-trigger`/`select` → `combobox`, clause (a)) are listed.

- [ ] **Step 12: Document the primitive in `DESIGN.md`**

Edit `DESIGN.md` — old string:

```md
### 5.5 Dialogs & Sheets
```

new string (one bullet, then a blank line, then the unchanged heading — the bullet directly follows the `NativeSelect` bullet at L238; keep the file's CRLF line endings):

```md
- **`Combobox`** — searchable single-select for long lists only (short lists stay `NativeSelect`; spec §6). A raw `<button type="button" role="combobox" data-slot="combobox-trigger">` with `formControlClass` (never `<Button>`) and the `NativeSelect` chevron opens a portalled `PopoverContent` (`data-slot="combobox-content"`, trigger width, `min-w-64`) with a cmdk search box and listbox. Rows are ranked by `thai-search` (`filterAndRank`); cmdk only sees `opt:${index}` keys, so `value: ''` and duplicate labels work. Name = the caller's label (`<label htmlFor={id}>`, `LabeledField`, `FormLabel`, or `aria-labelledby`); the component never names itself. Works under `FormControl` (`id`, `ref`, `onBlur`, `aria-invalid`, `aria-describedby`) and `LabeledField` (`aria-required`). `required` = `aria-required` only — validate before submit. Server search: `onSearchChange` + `loading` / `error` / `onRetry` (the caller owns `useDebounce` + `useQuery`; rows are not filtered again). Buttons inside the menu (`footer`, create, retry) sit outside cmdk's root because cmdk turns Enter on them into a row pick. Default copy: `เลือก…`, `พิมพ์เพื่อค้นหา…`, `ไม่พบรายการ`, `กำลังโหลด…`, `โหลดรายการไม่สำเร็จ` + `ลองใหม่`. Tests pick with `pickComboOption` / `openCombobox` from `src/test/combobox.ts`. `filter` (if given) applies in server mode too · `pending` keeps the menu open · `closeOnSelect={false}` leaves closing to the caller.

### 5.5 Dialogs & Sheets
```

- [ ] **Step 13: Type check + lint + build**

```bash
bash tools/check-types.sh web
cd apps/web && npx eslint src/components/ui/combobox.tsx src/components/ui/combobox.test.tsx src/test/combobox.ts src/test/setup.ts && cd ../..
npm run build --workspace=apps/web
```

Expected: `Web: OK` (0 errors); ESLint prints nothing (0 errors, 0 warnings — semantic tokens only, no `any`); the build succeeds (the component is not imported by the app yet, so the bundle does not change).

- [ ] **Step 14: Commit**

```bash
git add apps/web/src/components/ui/combobox.tsx apps/web/src/components/ui/combobox.test.tsx apps/web/src/test/combobox.ts apps/web/src/test/setup.ts DESIGN.md
git commit -F - <<'EOF'
feat(web): Combobox primitive + pickComboOption test helpers (R2-1)

One searchable single-select for the Round 2 conversions (spec §6.1-6.3):
a raw button[role=combobox] with the shared field skin opens a portalled
cmdk list ranked by thai-search. Keys opt:${index} so value '' and
duplicate labels work; ArrowDown/Enter/Space/typed letter open, caret at
the end, Esc closes only the menu inside Dialog/Sheet/AlertDialog,
wheel/touch stop at the menu, server mode with loading/error/retry,
clearable, pending, closeOnSelect, create, footer outside cmdk's root, disabled rows
with a visible reason, FormControl/LabeledField wiring. The name always
comes from the caller's label.

setup.ts gets a global scrollIntoView no-op (cmdk throws without it);
src/test/combobox.ts adds openCombobox/pickComboOption.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: one commit on `feat/dropdown-search-round2`. Do not push.

---

### Task 5: Address flow characterization (R2-2 part 1, spec §6.4 row ที่อยู่)

**Why:** Spec §6.4 row ที่อยู่ and §7 R2-2 require the address flow tests **first**, passing against today's `SearchableSelect`, then the switch to `Combobox` (Task 6) with the same tests still passing. No test renders `AddressForm` today (facts-address §1d) — the only widget tests are `SearchableSelect.test.tsx`, which Task 6 deletes. This task adds `AddressForm.test.tsx` and changes no production code.

The tests must run unchanged on both widgets, so they use only what both expose: the pickers as `combobox` named by their label (`จังหวัด *`, `อำเภอ/เขต *`, `ตำบล/แขวง *` — the `<label htmlFor>` text, asterisk included, which `fields.audit-spec.ts:167-169` also relies on), `option` rows by name, `listbox`, `aria-expanded`, `disabled`, and the read-only postal field by its label. Two neutral helpers cover the one real difference — where the value shows and where typing goes:
- `shown(el)` = the `<input>`'s value today, the trigger button's text after Task 6; the three `-- เลือก… --` placeholder strings count as empty.
- `pick(user, field, option, search?)` = click the field, type into whatever now has focus (today the field itself; after Task 6 the list's search box, which gets focus on open — header DOM contract), click the option.

Data: the real lazy chunk `@/data/thai-address-data` (7,452 rows, 77 provinces). `AddressForm` keeps it in a module-level cache (`AddressForm.tsx:6-21`), so `beforeAll` opens the province list once and waits for all 77 options — after that every test in the file renders with the lists already loaded (deterministic; no mock).

Behaviour pinned (source → test):
- Cascade and resets (`AddressForm.tsx:157-175`): province → district (reset) → subdistrict (reset) → postal code; a new province clears district/subdistrict/postal and keeps the other fields; a new district clears subdistrict/postal.
- **Re-picking the same province or district still resets what is below** (current behaviour — every `handle…Change` call resets).
- Lists (`:132-151`): 77 provinces, กรุงเทพมหานคร 50 districts, เขตพระนคร 12 subdistricts, and their order (code-unit `.sort()` for provinces/districts, `localeCompare` for subdistricts) — first three names each.
- Edit mode: mounted with stored values (`CustomerEditModal` renders the form after its GET `:120-122,276`; `SupplierForm` via `SuppliersPage` `openEdit` index.tsx:194) — names shown, dependent lists filled, nothing saved; values that arrive **after** mount (`EditCustomerDialog` effect `:68-95`) — lists follow the new province; a stored triple without postal code gets it on load exactly once (effect `:120-130`).
- Values not in the lists keep showing: `QuickBuyModal` card reader strips `ตำบล/อำเภอ` (`QuickBuyModal.tsx:432-435`) → shown, no postal auto-fill, district list = the real province's districts; an unknown province text shows and its district list is empty; a `BranchesPage` location is a composed string (`BranchesPage.tsx:60`) so `deserializeAddress` returns `emptyAddress` and edit never pre-fills (`:93-98`).
- Keyboard / Escape / pointer behaviour of today's `SearchableSelect` that `Combobox` keeps (facts-address §7), written so both pass: ArrowDown on the focused field leaves the list open, typing filters, ArrowDown + Enter on a single match picks it and closes; Escape closes and keeps the saved value (typed text never saved); a click outside does the same; inside a Radix `Dialog` the first Escape closes only the list and the second closes the dialog; after a pointer pick a click reopens the list.
- **Not pinned** — differs by design (spec §6.1): focus alone opening the list, where focus goes on Tab, "nothing highlighted until ArrowDown", upward opening (`openDirection="up"`), the empty-list text (`ไม่พบผลลัพธ์` → `ไม่พบรายการ`). The ArrowDown + Enter test therefore uses a search with exactly one match, where both widgets highlight the same row.

**Files:**
- Create: `apps/web/src/components/ui/AddressForm.test.tsx`
- No production change. (Read-only sources: `apps/web/src/components/ui/AddressForm.tsx`, `apps/web/src/components/ui/SearchableSelect.tsx`, `apps/web/src/components/ui/dialog.tsx:73-80`, `apps/web/src/data/thai-address-data.ts`.)

**Interfaces:**
- Consumes: default export `AddressForm({ value, onChange, label })` and `composeAddress`, `deserializeAddress`, `emptyAddress`, type `AddressData` from `./AddressForm`; `Dialog`, `DialogContent`, `DialogTitle` from `./dialog`; the real module `@/data/thai-address-data`.
- Produces (Task 6 appends to this file and reuses them): constants `PROVINCE`, `DISTRICT`, `SUBDISTRICT`, `POSTAL`, `PLACEHOLDERS`, `BANGKOK`, `CHIANG_MAI`; helpers `field(name)`, `shown(el)`, `pick(user, name, option, search?)`, `optionNames()`; component `Host({ initial, onChange })`.

---

- [ ] **Step 1: Write the characterization test file**

Create `apps/web/src/components/ui/AddressForm.test.tsx` with exactly:

```tsx
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { Dialog, DialogContent, DialogTitle } from './dialog';
import AddressForm, {
  composeAddress,
  deserializeAddress,
  emptyAddress,
  type AddressData,
} from './AddressForm';

// Characterization of the address flow (spec 2026-11-14 §6.4 row ที่อยู่, R2-2).
// Written against the SearchableSelect version and kept unchanged when AddressForm moves to
// Combobox: every query goes through roles and the labels' names, never widget internals.
// Data = the real lazy-loaded chunk (@/data/thai-address-data); beforeAll fills AddressForm's
// module cache so every test starts with the full lists and no async gap.

const PROVINCE = 'จังหวัด *';
const DISTRICT = 'อำเภอ/เขต *';
const SUBDISTRICT = 'ตำบล/แขวง *';
const POSTAL = 'รหัสไปรษณีย์';
const PLACEHOLDERS = ['-- เลือกจังหวัด --', '-- เลือกอำเภอ/เขต --', '-- เลือกตำบล/แขวง --'];

const BANGKOK: AddressData = {
  ...emptyAddress,
  houseNo: '12',
  road: 'ราชดำเนินใน',
  province: 'กรุงเทพมหานคร',
  district: 'เขตพระนคร',
  subdistrict: 'แขวงพระบรมมหาราชวัง',
  postalCode: '10200',
};
const CHIANG_MAI: AddressData = {
  ...emptyAddress,
  houseNo: '99/1',
  moo: '3',
  village: 'หมู่บ้านทดสอบ',
  province: 'เชียงใหม่',
  district: 'อำเภอเมืองเชียงใหม่',
  subdistrict: 'ตำบลศรีภูมิ',
  postalCode: '50200',
};

const field = (name: string) => screen.getByRole('combobox', { name });

/** The value a picker shows: the text field's value today, the trigger's text after R2-2.
 *  A placeholder counts as "shows nothing". */
function shown(el: HTMLElement): string {
  const text = el instanceof HTMLInputElement ? el.value : (el.textContent ?? '').trim();
  return PLACEHOLDERS.includes(text) ? '' : text;
}

/** Open a picker with the pointer, optionally type a search, click an option by its name. */
async function pick(user: UserEvent, name: string, option: string, search?: string) {
  await user.click(field(name));
  if (search) await user.keyboard(search);
  await user.click(await screen.findByRole('option', { name: option }));
}

const optionNames = () => screen.getAllByRole('option').map((o) => (o.textContent ?? '').trim());

/** A host like the 9 real ones: a useState object passed straight back into AddressForm. */
function Host({ initial, onChange }: { initial: AddressData; onChange: (a: AddressData) => void }) {
  const [address, setAddress] = useState(initial);
  return (
    <>
      <AddressForm
        value={address}
        onChange={(next) => {
          onChange(next);
          setAddress(next);
        }}
      />
      <button type="button">ถัดไป</button>
    </>
  );
}

beforeAll(async () => {
  await import('@/data/thai-address-data');
  const user = userEvent.setup();
  const { unmount } = render(<AddressForm value={emptyAddress} onChange={() => {}} />);
  await user.click(field(PROVINCE));
  // the province list fills once AddressForm's own import() has put the data in its cache
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(77), { timeout: 20_000 });
  unmount();
}, 30_000);

describe('AddressForm — cascade จังหวัด → อำเภอ → ตำบล → รหัสไปรษณีย์', () => {
  it('starts with only the province open; each pick enables the next and the subdistrict fills the postal code', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial={emptyAddress} onChange={onChange} />);

    expect(field(PROVINCE)).toBeEnabled();
    expect(field(DISTRICT)).toBeDisabled();
    expect(field(SUBDISTRICT)).toBeDisabled();
    expect(screen.getByLabelText(POSTAL)).toHaveAttribute('readonly');
    expect(screen.getByLabelText(POSTAL)).toHaveValue('');

    await pick(user, PROVINCE, 'กรุงเทพมหานคร', 'กรุงเทพ');
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyAddress, province: 'กรุงเทพมหานคร' });
    expect(shown(field(PROVINCE))).toBe('กรุงเทพมหานคร');
    expect(field(DISTRICT)).toBeEnabled();
    expect(field(SUBDISTRICT)).toBeDisabled();

    await pick(user, DISTRICT, 'เขตพระนคร', 'พระนคร');
    expect(onChange).toHaveBeenLastCalledWith({
      ...emptyAddress,
      province: 'กรุงเทพมหานคร',
      district: 'เขตพระนคร',
    });
    expect(shown(field(DISTRICT))).toBe('เขตพระนคร');
    expect(field(SUBDISTRICT)).toBeEnabled();

    await pick(user, SUBDISTRICT, 'แขวงพระบรมมหาราชวัง');
    expect(onChange).toHaveBeenLastCalledWith({
      ...emptyAddress,
      province: 'กรุงเทพมหานคร',
      district: 'เขตพระนคร',
      subdistrict: 'แขวงพระบรมมหาราชวัง',
      postalCode: '10200',
    });
    expect(shown(field(SUBDISTRICT))).toBe('แขวงพระบรมมหาราชวัง');
    expect(screen.getByLabelText(POSTAL)).toHaveValue('10200');
  });

  it('a new province clears district, subdistrict and postal code; the other fields stay', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial={BANGKOK} onChange={onChange} />);

    await pick(user, PROVINCE, 'เชียงใหม่', 'เชียงใ');

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({
      ...BANGKOK,
      province: 'เชียงใหม่',
      district: '',
      subdistrict: '',
      postalCode: '',
    });
    expect(shown(field(DISTRICT))).toBe('');
    expect(field(SUBDISTRICT)).toBeDisabled();
    expect(screen.getByLabelText(POSTAL)).toHaveValue('');
  });

  it('a new district clears subdistrict and postal code', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial={BANGKOK} onChange={onChange} />);

    await pick(user, DISTRICT, 'เขตดุสิต', 'ดุสิต');

    expect(onChange).toHaveBeenLastCalledWith({
      ...BANGKOK,
      district: 'เขตดุสิต',
      subdistrict: '',
      postalCode: '',
    });
    expect(shown(field(SUBDISTRICT))).toBe('');
    await pick(user, SUBDISTRICT, 'แขวงดุสิต');
    expect(onChange).toHaveBeenLastCalledWith({
      ...BANGKOK,
      district: 'เขตดุสิต',
      subdistrict: 'แขวงดุสิต',
      postalCode: '10300',
    });
  });

  it('re-picking the same province or district still clears what is below it (current behaviour)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial={BANGKOK} onChange={onChange} />);

    await pick(user, DISTRICT, 'เขตพระนคร', 'พระนคร');
    expect(onChange).toHaveBeenLastCalledWith({ ...BANGKOK, subdistrict: '', postalCode: '' });

    await pick(user, SUBDISTRICT, 'แขวงพระบรมมหาราชวัง');
    expect(onChange).toHaveBeenLastCalledWith(BANGKOK);

    await pick(user, PROVINCE, 'กรุงเทพมหานคร', 'กรุงเทพ');
    expect(onChange).toHaveBeenLastCalledWith({
      ...BANGKOK,
      district: '',
      subdistrict: '',
      postalCode: '',
    });
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('lists every province, only the chosen province’s districts and the chosen district’s subdistricts, in the same order', async () => {
    const user = userEvent.setup();
    render(<Host initial={BANGKOK} onChange={vi.fn()} />);

    await user.click(field(PROVINCE));
    expect(optionNames()).toHaveLength(77);
    expect(optionNames().slice(0, 3)).toEqual(['กระบี่', 'กรุงเทพมหานคร', 'กาญจนบุรี']);
    await user.keyboard('{Escape}');

    await user.click(field(DISTRICT));
    expect(optionNames()).toHaveLength(50);
    expect(optionNames().slice(0, 3)).toEqual(['เขตคลองสาน', 'เขตคลองสามวา', 'เขตคลองเตย']);
    expect(optionNames()).not.toContain('อำเภอเมืองเชียงใหม่');
    await user.keyboard('{Escape}');

    await user.click(field(SUBDISTRICT));
    expect(optionNames()).toHaveLength(12);
    expect(optionNames().slice(0, 3)).toEqual(['แขวงชนะสงคราม', 'แขวงตลาดยอด', 'แขวงบวรนิเวศ']);
  });
});

describe('AddressForm — edit mode with stored values', () => {
  it('mounted with stored values (CustomerEditModal / SupplierForm): shows them, fills the lists, saves nothing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial={CHIANG_MAI} onChange={onChange} />);

    expect(shown(field(PROVINCE))).toBe('เชียงใหม่');
    expect(shown(field(DISTRICT))).toBe('อำเภอเมืองเชียงใหม่');
    expect(shown(field(SUBDISTRICT))).toBe('ตำบลศรีภูมิ');
    expect(screen.getByLabelText(POSTAL)).toHaveValue('50200');
    expect(field(DISTRICT)).toBeEnabled();
    expect(field(SUBDISTRICT)).toBeEnabled();

    await user.click(field(SUBDISTRICT));
    expect(optionNames()).toHaveLength(16);
    await user.click(screen.getByRole('option', { name: 'ตำบลหายยา' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({
      ...CHIANG_MAI,
      subdistrict: 'ตำบลหายยา',
      postalCode: '50100',
    });
  });

  it('values that arrive after mount (EditCustomerDialog effect) fill the lists too', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<AddressForm value={emptyAddress} onChange={onChange} />);
    expect(field(DISTRICT)).toBeDisabled();

    rerender(<AddressForm value={CHIANG_MAI} onChange={onChange} />);

    expect(shown(field(PROVINCE))).toBe('เชียงใหม่');
    expect(field(DISTRICT)).toBeEnabled();
    await user.click(field(DISTRICT));
    expect(optionNames()).toHaveLength(25);
    expect(optionNames()).toContain('อำเภอเมืองเชียงใหม่');
    expect(optionNames()).not.toContain('เขตพระนคร');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a stored address without a postal code gets it on load, once', async () => {
    const onChange = vi.fn();
    render(<Host initial={{ ...CHIANG_MAI, postalCode: '' }} onChange={onChange} />);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(CHIANG_MAI));
    expect(screen.getByLabelText(POSTAL)).toHaveValue('50200');
    await act(async () => {});
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('AddressForm — values that are not in the lists', () => {
  it('names without the ตำบล/อำเภอ prefix (QuickBuyModal card reader) keep showing and get no postal code', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const stripped = {
      ...emptyAddress,
      houseNo: '5',
      province: 'เชียงใหม่',
      district: 'เมืองเชียงใหม่',
      subdistrict: 'ศรีภูมิ',
    };
    render(<Host initial={stripped} onChange={onChange} />);

    expect(shown(field(PROVINCE))).toBe('เชียงใหม่');
    expect(shown(field(DISTRICT))).toBe('เมืองเชียงใหม่');
    expect(shown(field(SUBDISTRICT))).toBe('ศรีภูมิ');
    expect(field(SUBDISTRICT)).toBeEnabled();
    await act(async () => {});
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText(POSTAL)).toHaveValue('');

    // the province is real, so its districts are listed; picking one replaces the stripped name
    await pick(user, DISTRICT, 'อำเภอเมืองเชียงใหม่', 'เมืองเชียงใหม่');
    expect(onChange).toHaveBeenLastCalledWith({
      ...stripped,
      district: 'อำเภอเมืองเชียงใหม่',
      subdistrict: '',
      postalCode: '',
    });
  });

  it('a province that is not in the data keeps showing; its district list is empty', async () => {
    const user = userEvent.setup();
    render(<Host initial={{ ...emptyAddress, province: 'กรุงเทพฯ' }} onChange={vi.fn()} />);

    expect(shown(field(PROVINCE))).toBe('กรุงเทพฯ');
    expect(field(DISTRICT)).toBeEnabled();
    await user.click(field(DISTRICT));
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('a branch location saved as composed text never pre-fills the form (BranchesPage edit)', () => {
    const location = composeAddress(BANGKOK);
    expect(location).toBe('12 ถ.ราชดำเนินใน แขวงพระบรมมหาราชวัง เขตพระนคร กรุงเทพมหานคร 10200');
    const loaded = deserializeAddress(location);
    expect(loaded).toEqual(emptyAddress);

    render(<Host initial={loaded} onChange={vi.fn()} />);
    expect(shown(field(PROVINCE))).toBe('');
    expect(field(DISTRICT)).toBeDisabled();
    expect(screen.getByLabelText(POSTAL)).toHaveValue('');
  });
});

describe('AddressForm — keyboard, Escape and pointer (SearchableSelect behaviour kept by Combobox)', () => {
  it('keyboard only: ArrowDown opens, typing filters, ArrowDown + Enter picks the only match and closes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial={emptyAddress} onChange={onChange} />);

    act(() => field(PROVINCE).focus());
    await user.keyboard('{ArrowDown}');
    expect(field(PROVINCE)).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('เชียงใ');
    expect(optionNames()).toEqual(['เชียงใหม่']);
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onChange).toHaveBeenLastCalledWith({ ...emptyAddress, province: 'เชียงใหม่' });
    expect(field(PROVINCE)).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(shown(field(PROVINCE))).toBe('เชียงใหม่');
  });

  it('Escape closes the list and keeps the saved value — typed text is never saved', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial={BANGKOK} onChange={onChange} />);

    await user.click(field(PROVINCE));
    await user.keyboard('ขอน');
    expect(optionNames()).toEqual(['ขอนแก่น']);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(field(PROVINCE)).toHaveAttribute('aria-expanded', 'false');
    expect(shown(field(PROVINCE))).toBe('กรุงเทพมหานคร');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a click outside closes the list without saving the typed text', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial={BANGKOK} onChange={onChange} />);

    await user.click(field(PROVINCE));
    await user.keyboard('ขอน');
    await user.click(screen.getByLabelText('บ้านเลขที่'));

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(shown(field(PROVINCE))).toBe('กรุงเทพมหานคร');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('inside a dialog the first Escape closes only the list, the second closes the dialog', async () => {
    const user = userEvent.setup();
    function InDialog() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>ที่อยู่ลูกค้า</DialogTitle>
            <Host initial={BANGKOK} onChange={vi.fn()} />
          </DialogContent>
        </Dialog>
      );
    }
    render(<InDialog />);

    await user.click(field(PROVINCE));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(field(PROVINCE)).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('dialog', { name: 'ที่อยู่ลูกค้า' })).toBeVisible();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'ที่อยู่ลูกค้า' })).toBeNull());
  });

  it('after a pointer pick, clicking the field again reopens the list', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial={emptyAddress} onChange={onChange} />);

    await pick(user, PROVINCE, 'ขอนแก่น');
    expect(shown(field(PROVINCE))).toBe('ขอนแก่น');
    expect(screen.queryByRole('listbox')).toBeNull();

    await user.click(field(PROVINCE));
    const listbox = screen.getByRole('listbox');
    await user.click(within(listbox).getByRole('option', { name: 'เชียงใหม่' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyAddress, province: 'เชียงใหม่' });
    expect(shown(field(PROVINCE))).toBe('เชียงใหม่');
  });
});
```

- [ ] **Step 2: Run it against today's `SearchableSelect` and confirm it passes**

```bash
npm run test --workspace=apps/web -- src/components/ui/AddressForm.test.tsx
```

Expected: `Test Files  1 passed (1)` and `Tests  16 passed (16)`. (Characterization: these pass on the current code by design. If one fails, the test is wrong about today's behaviour — fix the test, never `AddressForm.tsx`.)

- [ ] **Step 3: Prove the tests bite (temporary mutation, then restore)**

Break two pinned behaviours — the same-value reset and the postal-code auto-fill — run, then restore the file:

```bash
node -e "
const fs = require('fs');
const f = 'apps/web/src/components/ui/AddressForm.tsx';
let s = fs.readFileSync(f, 'utf8');
s = s.replace('const handleDistrictChange = (district: string) => {', 'const handleDistrictChange = (district: string) => {\n    if (district === value.district) return;');
s = s.replace('if (value.province && value.district && value.subdistrict && !value.postalCode && addressData.length > 0) {', 'if (false) {');
fs.writeFileSync(f, s);
"
npm run test --workspace=apps/web -- src/components/ui/AddressForm.test.tsx
git checkout -- apps/web/src/components/ui/AddressForm.tsx
git diff --exit-code apps/web/src/components/ui/AddressForm.tsx && echo restored
```

Expected: the run reports `Tests  2 failed | 14 passed (16)` — exactly "re-picking the same province or district still clears what is below it (current behaviour)" and "a stored address without a postal code gets it on load, once" — then `restored`.

- [ ] **Step 4: Type check + lint**

```bash
bash tools/check-types.sh web
cd apps/web && npx eslint src/components/ui/AddressForm.test.tsx; cd ../..
```

Expected: `Web: OK` (0 type errors) and no ESLint output for the file.

- [ ] **Step 5: No field-scale run**

This task changes no UI (one new test file), so `tools/field-scale/check.mjs` is not run; Task 6 measures the switch against `baseline-r2`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ui/AddressForm.test.tsx
git commit -F - <<'EOF'
test(web): characterize the AddressForm flow before the Combobox switch (R2-2)

Province → district → subdistrict → postal code with the resets (also on a
same-value re-pick), the lists and their order from the real address data,
edit mode (stored values on mount, values after mount, postal auto-fill
once), names outside the lists (card reader without prefixes, unknown
province, branch location that never pre-fills) and the keyboard / Escape /
pointer behaviour SearchableSelect has today. Queries go through roles and
label names only, so the same file must pass after AddressForm moves to
Combobox.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: one commit on `feat/dropdown-search-round2`. Do not push.

---

### Task 6: `AddressForm` → `Combobox`, delete `SearchableSelect` (R2-2 part 2, spec §6.4 row ที่อยู่, appendix ก S1-06)

**Why:** `AddressForm` is the only user of `SearchableSelect` (`AddressForm.tsx:4,240-274`). Its menu is an inline `absolute` panel opened upward (`openDirection="up"`), which the scrolling branch modal cuts (S1-06, `BranchesPage.tsx:333`) and which is why `SearchableSelect` sits in the F5 allow-list "until R2-2". This task moves the three pickers to the shared `Combobox` (portalled `PopoverContent`, auto-flip — closes S1-06), deletes `SearchableSelect.tsx` + its test, and updates every guard, tool and audit keyed to it. Task 5's 16 tests must pass unchanged.

What stays byte-for-byte (spec §6.4 + plan-notes):
- `AddressData` in/out and every `onChange` payload: always a whole object built from `value`; province pick → `district/subdistrict/postalCode = ''`; district pick → `subdistrict/postalCode = ''`; **also on a same-value re-pick** (header Behaviour "Pick": a pick always calls `onChange`); subdistrict pick → postal code from the data, else the old one; the postal-code auto-fill effect; the `selectedProvince/selectedDistrict` sync effect; `disabled` rules (district needs a province, subdistrict a district); the lazy data loader and its cache; all exported helpers.
- Labels stay style A (`formLabelClass`, `<label htmlFor>`), text unchanged (`จังหวัด *` …) — the label is the trigger's only name (a `<button>` is labelable). The asterisk stays plain label text and **no `required` is passed**: no host validates the three pickers one by one (facts §2c) and `CreateContactModal` labels the whole address "ไม่บังคับ", so adding `aria-required` would be new behaviour.
- Placeholders keep today's text (`-- เลือกจังหวัด --`, `-- เลือกอำเภอ/เขต --`, `-- เลือกตำบล/แขวง --`) — no copy change in this task. Search box / list get per-field names: `ค้นหาจังหวัด` / `รายชื่อจังหวัด`, `ค้นหาอำเภอ/เขต` / `รายชื่ออำเภอ/เขต`, `ค้นหาตำบล/แขวง` / `รายชื่อตำบล/แขวง` (`searchLabel` / `listLabel`); search placeholder and empty text are the `Combobox` defaults (`พิมพ์เพื่อค้นหา…`, `ไม่พบรายการ`).
- Postal code: the read-only `Input` is unchanged (the spec says nothing else).
- A stored name that is not in the list (card reader without prefixes `QuickBuyModal.tsx:432-435`, OCR `ต.`/`อ.` `ocr-address.ts`, old free text, or any stored name while the data chunk is still loading) keeps showing through `selectedOption` (spec §6.3).

Thai search with the `เขต/อำเภอ/แขวง/ตำบล` prefixes: every district and subdistrict name in the data starts with one (facts §2a). Under the header's `rankMatch`, a name typed without its prefix is a "contains" match (rank 3), and a prefix-stripped `keywords` entry would be rank 4 — it can never move a row, so keywords alone change nothing. `AddressForm` therefore passes the contract's `filter` prop: `filterAddressOptions` runs `filterAndRank` with the name **without** its prefix as the label and the full name as a keyword. Measured on the data (scratch script, 2026-11-16): it changes the first hit for 56 district queries and 349 subdistrict queries, e.g. กรุงเทพมหานคร "วัฒนา" → `เขตวัฒนา` before `เขตทวีวัฒนา`; เขตพระนคร "วัง" → `แขวงวังบูรพาภิรมย์` before `แขวงพระบรมมหาราชวัง`; typing "เขตวัฒ" still finds `เขตวัฒนา` (keyword). Provinces carry no prefix → the default filter.

Things keyed to `SearchableSelect` that change here:
- F5 allow-list entry (`field-guards.inventory.test.ts:611-615`, exact match both ways → must go in this commit) and its comment; the positive detector fixture label `(SearchableSelect)` (`:841`) is renamed (the fixture source is inline — only the label names the deleted file).
- `native-select.inventory.test.ts:50` comment.
- `tools/field-scale/menu-clip-components.mjs:110-125`: its case found the list by `SearchableSelect`'s placeholder-named listbox (`-- เลือกจังหวัด --`). It becomes a `Combobox` case on the **S1-06 screen** (branch modal, province scrolled to the top of the scrolling form — the worst case for the old upward list), the browser proof that S1-06 is closed.
- `apps/api/e2e/ui-fields/fields.audit-spec.ts:156,171-186`: `.fill()`/`.press()` on the trigger and `toHaveValue` (a `<button>` has neither), and `dialog.getByRole('option')` (the list is portalled to `<body>`, outside the dialog). `dialogs.audit-spec.ts` needs no change (Step 10 says why).
- `dialog.tsx:73-80` keeps its `[data-inline-combobox="true"][aria-expanded="true"]` Escape special case — `NameAutocomplete.tsx:51` still sets that attribute; the `Combobox` gets its Escape layering from Radix.

`SearchableSelect.test.tsx` (5 tests) → where each case lives now:

| old test | now |
|---|---|
| "opens the menu downward by default" | dropped — position is Radix's (portal + auto-flip); proven in the browser by the `Combobox` case of `menu-clip-components.mjs` |
| "opens the menu upward when openDirection="up"…" | dropped — `openDirection` no longer exists; S1-06 browser case replaces it |
| "selects by keyboard and restores the saved value on Escape or blur" | `AddressForm.test.tsx` (Task 5): "keyboard only: ArrowDown opens…", "Escape closes the list and keeps the saved value…", "a click outside closes the list without saving the typed text". The Tab part is not ported: where Tab moves focus is `Combobox` behaviour (Task 4), not address behaviour |
| "reopens after selecting with a pointer while focus remains in the field" | `AddressForm.test.tsx` (Task 5): "after a pointer pick, clicking the field again reopens the list" |
| "closes only the options on first Escape inside a dialog…" | `AddressForm.test.tsx` (Task 5): "inside a dialog the first Escape closes only the list, the second closes the dialog" |

**Files:**
- Modify: `apps/web/src/components/ui/AddressForm.tsx` — imports `:1-4`; new helpers before `interface Props` `:103`; option memos after the `subdistricts` memo `:145-151`; the three pickers `:240-248`, `:252-261`, `:265-274`
- Modify (test): `apps/web/src/components/ui/AddressForm.test.tsx` — one import line + one appended `describe` (Task 5's 16 tests untouched)
- Delete: `apps/web/src/components/ui/SearchableSelect.tsx`, `apps/web/src/components/ui/SearchableSelect.test.tsx`
- Modify (test): `apps/web/src/components/ui/field-guards.inventory.test.ts` — `:611-615` (allow-list), `:841` (fixture label)
- Modify (test): `apps/web/src/components/ui/native-select.inventory.test.ts` — `:50` comment
- Modify (tool): `tools/field-scale/menu-clip-components.mjs` — header `:1-3`, before `const CASES = [` `:92`, case `:110-125`
- Modify (api audit): `apps/api/e2e/ui-fields/fields.audit-spec.ts` — `:156`, `:171-186`
- Read, no change: `apps/api/e2e/ui-fields/dialogs.audit-spec.ts`, `apps/web/src/components/ui/dialog.tsx:73-80`
- Host tests that must pass **unchanged** (Step 8): `apps/web/src/pages/CompanySettingsPage.vat-row.test.tsx` (host 1); `apps/web/src/components/customer/CustomerCreateDialog.test.tsx`, `apps/web/src/components/customer/CustomerCreateDialog.financeLine.test.tsx` (host 2); `apps/web/src/pages/ContractCreatePage/components/CustomerCreateModal.financeLine.test.tsx`, `apps/web/src/pages/ContractCreatePage/hooks/useContractCreateData.financeLine.test.tsx`, `apps/web/src/pages/ContractCreatePage/hooks/useOcrFlow.test.ts` (host 3); `apps/web/src/components/contract/CustomerEditModal.fallback.test.tsx` (host 4); `apps/web/src/pages/CustomerDetailPage/__tests__/EditCustomerDialog.test.tsx`, `apps/web/src/pages/CustomerDetailPage/__tests__/EditCustomerDialog.financeLine.test.tsx` (host 5); `apps/web/src/components/trade-in/TradeInFlow.test.tsx` (host 7 — types into the `123/45` house-number field of step 3); `apps/web/src/components/contacts/CreateContactModal.test.tsx` (host 9 — types into `123/45`), plus the parents that render or mock a host: `apps/web/src/components/contacts/ContactCombobox.test.tsx`, `apps/web/src/pages/__tests__/ContactsPage.test.tsx`, `apps/web/src/pages/BookingsPage/__tests__/CreateBookingDialog.test.tsx`, `apps/web/src/pages/UnifiedInboxPage/components/gfin/GfinTab.test.tsx`. Hosts 6 (`SupplierForm`) and 8 (`BranchesPage`) have no unit test — `AddressForm.test.tsx`, the field-scale routes and `dialogs.audit-spec.ts` (`supplier-create`/`supplier-edit`) cover them.

**Interfaces:**
- Consumes: `Combobox`, type `ComboOption` from `@/components/ui/combobox` (Task 4 header contract — Behaviour "Pick" and "Selected / trigger": a re-pick calls `onChange`, an empty value shows the placeholder) — props used: `id`, `value`, `onChange`, `options`, `selectedOption`, `filter`, `placeholder`, `searchLabel`, `listLabel`, `disabled`; `filterAndRank` from `@/lib/thai-search` (Task 3); `openCombobox`, `pickComboOption` from `@/test/combobox` and the global `scrollIntoView` polyfill in `src/test/setup.ts` (Task 4); Task 5's helpers in `AddressForm.test.tsx`.
- Produces:
  - Unchanged public API of `@/components/ui/AddressForm`: default `AddressForm(props: { value: AddressData; onChange: (addr: AddressData) => void; label?: string })`, `AddressData`, `emptyAddress`, `composeAddress`, `serializeAddress`, `deserializeAddress`, `displayAddress`. The 18 call sites in 9 hosts are not edited.
  - DOM contract per picker: trigger `button[type=button][role=combobox]` with id `${useId()}-province|district|subdistrict`, named by its label (`จังหวัด *`, `อำเภอ/เขต *`, `ตำบล/แขวง *`); open list `[role=listbox]` named `รายชื่อจังหวัด` / `รายชื่ออำเภอ/เขต` / `รายชื่อตำบล/แขวง` in a portal under `<body>`; search box (cmdk input, role `combobox`) named `ค้นหาจังหวัด` / `ค้นหาอำเภอ/เขต` / `ค้นหาตำบล/แขวง`. No `data-inline-combobox`, no `data-slot="searchable-select-input"`.
  - Module-private `filterAddressOptions(options: ComboOption[], query: string): ComboOption[]` (returns elements of `options`, same objects).

---

- [ ] **Step 1: Add the failing `Combobox` tests to `AddressForm.test.tsx`**

Edit `apps/web/src/components/ui/AddressForm.test.tsx`. Old:

```tsx
import { Dialog, DialogContent, DialogTitle } from './dialog';
import AddressForm, {
```

New:

```tsx
import { Dialog, DialogContent, DialogTitle } from './dialog';
import { openCombobox, pickComboOption } from '@/test/combobox';
import AddressForm, {
```

Then append at the end of the file (after its last line `});`), with one blank line before it:

```tsx
describe('AddressForm on Combobox (R2-2)', () => {
  it('strict: pickComboOption through province → district → subdistrict saves the whole address', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial={{ ...emptyAddress, houseNo: '7' }} onChange={onChange} />);

    await pickComboOption(user, PROVINCE, 'เชียงใหม่', { search: 'เชียงใ' });
    await pickComboOption(user, DISTRICT, 'อำเภอเมืองเชียงใหม่', { search: 'เมือง' });
    await pickComboOption(user, SUBDISTRICT, 'ตำบลหายยา', { search: 'หาย' });

    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenLastCalledWith({
      ...emptyAddress,
      houseNo: '7',
      province: 'เชียงใหม่',
      district: 'อำเภอเมืองเชียงใหม่',
      subdistrict: 'ตำบลหายยา',
      postalCode: '50100',
    });
    expect(field(SUBDISTRICT)).toHaveTextContent('ตำบลหายยา');
  });

  it('search ranks districts and subdistricts by the name after the เขต/แขวง prefix; the full name still finds them', async () => {
    const user = userEvent.setup();
    render(<Host initial={BANGKOK} onChange={vi.fn()} />);

    await openCombobox(user, DISTRICT);
    const districtSearch = screen.getByRole('combobox', { name: 'ค้นหาอำเภอ/เขต' });
    await user.type(districtSearch, 'วัฒนา');
    expect(optionNames()).toEqual(['เขตวัฒนา', 'เขตทวีวัฒนา']);
    await user.clear(districtSearch);
    await user.type(districtSearch, 'เขตวัฒ');
    expect(optionNames()).toEqual(['เขตวัฒนา']);
    await user.keyboard('{Escape}');

    await openCombobox(user, SUBDISTRICT);
    await user.keyboard('วัง');
    expect(optionNames()).toEqual(['แขวงวังบูรพาภิรมย์', 'แขวงพระบรมมหาราชวัง']);
  });

  it('opens a portalled list named per field, focuses its search box, and the trigger is a 44px form-control button', async () => {
    const user = userEvent.setup();
    const { container } = render(<Host initial={emptyAddress} onChange={vi.fn()} />);
    const trigger = field(PROVINCE);

    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('type', 'button');
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger).toHaveClass('h-11', 'rounded-lg', 'border-input', 'bg-background');
    expect(trigger).toHaveTextContent('-- เลือกจังหวัด --');
    expect(container.querySelector('[data-inline-combobox]')).toBeNull();

    const listbox = await openCombobox(user, PROVINCE);
    expect(listbox).toHaveAccessibleName('รายชื่อจังหวัด');
    expect(container).not.toContainElement(listbox);
    expect(document.body).toContainElement(listbox);
    expect(screen.getByRole('combobox', { name: 'ค้นหาจังหวัด' })).toHaveFocus();
  });
});
```

Run:

```bash
npm run test --workspace=apps/web -- src/components/ui/AddressForm.test.tsx
```

Expected: `Tests  3 failed | 16 passed (19)` — Task 5's 16 still pass; the 3 new ones fail because the fields are still `<input>` elements: the strict test at its first `pickComboOption` with `"จังหวัด *" is not a Combobox (no [data-slot="combobox-content"] menu)`, the search test at `openCombobox` with `"อำเภอ/เขต *" is not a Combobox (no [data-slot="combobox-content"] menu)` (both helpers follow the trigger's `aria-controls`, which on `SearchableSelect` names its inline listbox), and the portal test with `expected 'INPUT' to be 'BUTTON'`.

- [ ] **Step 2: Move the three pickers to `Combobox`**

Edit `apps/web/src/components/ui/AddressForm.tsx` (six exact replacements).

A — imports. Old:

```tsx
import { useState, useEffect, useMemo, useId } from 'react';
import { Input } from '@/components/ui/input';
import { formControlClass, formLabelClass } from './form-styles';
import SearchableSelect from '@/components/ui/SearchableSelect';
```

New:

```tsx
import { useState, useEffect, useMemo, useId } from 'react';
import { Input } from '@/components/ui/input';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { filterAndRank } from '@/lib/thai-search';
import { formControlClass, formLabelClass } from './form-styles';
```

B — helpers. Old:

```tsx
interface Props {
  value: AddressData;
  onChange: (addr: AddressData) => void;
  label?: string;
}
```

New:

```tsx
// District and subdistrict names keep their prefix in the data ("เขตพระนคร", "ตำบลศรีภูมิ").
const ADDRESS_PREFIX = /^(อำเภอ|เขต|ตำบล|แขวง)/;

/** Rank on the name without its prefix (typing "วัฒนา" lists "เขตวัฒนา" before "เขตทวีวัฒนา");
 *  the full name stays a keyword, so "เขตวัฒ" still finds it. */
function filterAddressOptions(options: ComboOption[], query: string): ComboOption[] {
  const ranked = filterAndRank(
    options.map((option, index) => ({
      index,
      label: option.label.replace(ADDRESS_PREFIX, ''),
      keywords: [option.label],
    })),
    query,
  );
  return ranked.map((r) => options[r.index]);
}

const toOptions = (names: readonly string[]): ComboOption[] =>
  names.map((name) => ({ value: name, label: name }));

/** A stored name that is not in the list (card reader without prefix, OCR, old free text) still shows. */
const outsideList = (names: readonly string[], current: string): ComboOption | null =>
  current && !names.includes(current) ? { value: current, label: current } : null;

interface Props {
  value: AddressData;
  onChange: (addr: AddressData) => void;
  label?: string;
}
```

C — option lists. Old:

```tsx
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [addressData, selectedProvince, selectedDistrict]);
```

New:

```tsx
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [addressData, selectedProvince, selectedDistrict]);

  const subdistrictNames = useMemo(() => subdistricts.map((s) => s.name), [subdistricts]);
  const provinceOptions = useMemo(() => toOptions(provinces), [provinces]);
  const districtOptions = useMemo(() => toOptions(districts), [districts]);
  const subdistrictOptions = useMemo(() => toOptions(subdistrictNames), [subdistrictNames]);
```

D — province. Old:

```tsx
          <SearchableSelect
            inputClassName={formControlClass}
            id={`${id}-province`}
            value={value.province}
            onChange={handleProvinceChange}
            options={provinces}
            placeholder="-- เลือกจังหวัด --"
            openDirection="up"
          />
```

New:

```tsx
          <Combobox
            id={`${id}-province`}
            value={value.province}
            onChange={handleProvinceChange}
            options={provinceOptions}
            selectedOption={outsideList(provinces, value.province)}
            placeholder="-- เลือกจังหวัด --"
            searchLabel="ค้นหาจังหวัด"
            listLabel="รายชื่อจังหวัด"
          />
```

E — district. Old:

```tsx
          <SearchableSelect
            inputClassName={formControlClass}
            id={`${id}-district`}
            value={value.district}
            onChange={handleDistrictChange}
            options={districts}
            placeholder="-- เลือกอำเภอ/เขต --"
            disabled={!selectedProvince}
            openDirection="up"
          />
```

New:

```tsx
          <Combobox
            id={`${id}-district`}
            value={value.district}
            onChange={handleDistrictChange}
            options={districtOptions}
            selectedOption={outsideList(districts, value.district)}
            filter={filterAddressOptions}
            placeholder="-- เลือกอำเภอ/เขต --"
            searchLabel="ค้นหาอำเภอ/เขต"
            listLabel="รายชื่ออำเภอ/เขต"
            disabled={!selectedProvince}
          />
```

F — subdistrict. Old:

```tsx
          <SearchableSelect
            inputClassName={formControlClass}
            id={`${id}-subdistrict`}
            value={value.subdistrict}
            onChange={handleSubdistrictChange}
            options={subdistricts.map((s) => s.name)}
            placeholder="-- เลือกตำบล/แขวง --"
            disabled={!selectedDistrict}
            openDirection="up"
          />
```

New:

```tsx
          <Combobox
            id={`${id}-subdistrict`}
            value={value.subdistrict}
            onChange={handleSubdistrictChange}
            options={subdistrictOptions}
            selectedOption={outsideList(subdistrictNames, value.subdistrict)}
            filter={filterAddressOptions}
            placeholder="-- เลือกตำบล/แขวง --"
            searchLabel="ค้นหาตำบล/แขวง"
            listLabel="รายชื่อตำบล/แขวง"
            disabled={!selectedDistrict}
          />
```

Notes for the implementer (they hold for the code above — do not "fix" them):
- `handleProvinceChange(province: string)` etc. are passed to `onChange: (value, option) => void` unchanged — a one-parameter function is assignable, and the handlers stay the single place that builds the payload and the resets.
- `formControlClass` is still imported: the six text `Input`s use it. The trigger gets the same class from `Combobox` itself (header contract), so `AddressForm` passes no `className`.
- No `side`/`align`: the list flips by itself (that is the S1-06 fix). No `required` (see Why). No `clearable` (picking a new province is how a value changes today; there was no clear).
- `filterAddressOptions` is module-private (no new export from a component file).

- [ ] **Step 3: Run the address tests — all 19 pass**

```bash
npm run test --workspace=apps/web -- src/components/ui/AddressForm.test.tsx
```

Expected: `Test Files  1 passed (1)` and `Tests  19 passed (19)` — Task 5's 16 unchanged plus the 3 from Step 1.

- [ ] **Step 4: Delete `SearchableSelect` and its test**

```bash
git rm apps/web/src/components/ui/SearchableSelect.tsx apps/web/src/components/ui/SearchableSelect.test.tsx
```

Expected: `rm 'apps/web/src/components/ui/SearchableSelect.test.tsx'` and `rm 'apps/web/src/components/ui/SearchableSelect.tsx'`. Its five tests are covered or dropped as listed in the table in **Why**.

- [ ] **Step 5: F5 allow-list — see the exact-match guard fail, then remove the entry**

```bash
npm run test --workspace=apps/web -- src/components/ui/field-guards.inventory.test.ts
```

Expected: `Tests  1 failed | 37 passed (38)` — "only allow-listed files render an absolute menu outside a portal" fails on `expect(found).toEqual(allowed)` with the diff line `-   "apps/web/src/components/ui/SearchableSelect.tsx": 2,` (the entry is still allowed but the file is gone; `AddressForm.tsx` has no inline menu — `PopoverContent` matches `F5_PORTAL_TAG`).

Edit `apps/web/src/components/ui/field-guards.inventory.test.ts`. Old:

```ts
  // spec §5 F5 allow-list + SearchableSelect (until R2-2) — each has a case in menu-clip-components.mjs
  'apps/web/src/components/ui/SearchableSelect.tsx': {
    panels: 2,
    reason: 'R2-2 replaces it — AddressForm ย้ายไป Combobox แล้วลบไฟล์นี้ (listbox + กล่อง "ไม่พบผลลัพธ์")',
  },
  'apps/web/src/components/ui/NameAutocomplete.tsx': {
```

New:

```ts
  // spec §5 F5 allow-list — each has a case in menu-clip-components.mjs
  'apps/web/src/components/ui/NameAutocomplete.tsx': {
```

And (detector fixture label only — the sample source is inline). Old:

```ts
    'listbox via cn() + same-file const (SearchableSelect)',
```

New:

```ts
    'listbox via cn() + same-file const (inline input + listbox)',
```

Run again:

```bash
npm run test --workspace=apps/web -- src/components/ui/field-guards.inventory.test.ts
```

Expected: `Test Files  1 passed (1)`, 0 failed (38 tests at `69ab47516`; the count only changes if another task edits this file).

- [ ] **Step 6: `native-select.inventory.test.ts` comment**

Edit `apps/web/src/components/ui/native-select.inventory.test.ts`. Old:

```ts
// Custom Radix/SearchableSelect widgets keep their own accessible implementation.
```

New:

```ts
// Custom Radix/Combobox widgets keep their own accessible implementation.
```

```bash
npm run test --workspace=apps/web -- src/components/ui/native-select.inventory.test.ts src/components/ui/native-select.test.tsx
```

Expected: both files pass (spec §8: they must keep passing). The `Combobox` renders no `<select>`/`<datalist>`, so the inventory body is unaffected.

- [ ] **Step 7: Leftover check**

```bash
grep -rn "SearchableSelect\|searchable-select" apps/web/src apps/api/e2e
grep -rn "data-inline-combobox" apps/web/src
```

Expected — first command: only the two historical lines in `apps/web/src/components/ui/AddressForm.test.tsx` (the header comment "Written against the SearchableSelect version…" and the `describe` title "…(SearchableSelect behaviour kept by Combobox)"). Second command: exactly `apps/web/src/components/ui/AddressForm.test.tsx:463` (Step 1's `container.querySelector('[data-inline-combobox]')` assertion), `apps/web/src/components/ui/dialog.tsx:77` and `apps/web/src/components/ui/NameAutocomplete.tsx:51` — the dialog's Escape special case stays for `NameAutocomplete`.

- [ ] **Step 8: The 9 hosts' tests pass unchanged**

```bash
npm run test --workspace=apps/web -- src/components/ui/AddressForm.test.tsx src/pages/CompanySettingsPage.vat-row.test.tsx src/components/customer/CustomerCreateDialog.test.tsx src/components/customer/CustomerCreateDialog.financeLine.test.tsx src/pages/ContractCreatePage/components/CustomerCreateModal.financeLine.test.tsx src/pages/ContractCreatePage/hooks/useContractCreateData.financeLine.test.tsx src/pages/ContractCreatePage/hooks/useOcrFlow.test.ts src/components/contract/CustomerEditModal.fallback.test.tsx src/pages/CustomerDetailPage/__tests__/EditCustomerDialog.test.tsx src/pages/CustomerDetailPage/__tests__/EditCustomerDialog.financeLine.test.tsx src/components/trade-in/TradeInFlow.test.tsx src/components/contacts/CreateContactModal.test.tsx src/components/contacts/ContactCombobox.test.tsx src/pages/__tests__/ContactsPage.test.tsx src/pages/BookingsPage/__tests__/CreateBookingDialog.test.tsx src/pages/UnifiedInboxPage/components/gfin/GfinTab.test.tsx
```

Expected: `Test Files  16 passed (16)`, 0 failed — with no edit to any of these files (172 tests at `69ab47516` + Tasks 4–6; Tasks 9–10 may change the `ContactCombobox` / `CreateBookingDialog` counts). If `TradeInFlow.test.tsx` times out only inside a larger run on Windows (known, header Global Constraints), re-run it alone.

- [ ] **Step 9: `menu-clip-components.mjs` — replace the `SearchableSelect` case with the S1-06 `Combobox` case**

Edit `tools/field-scale/menu-clip-components.mjs` (three replacements).

Header. Old:

```js
// non-portalled menu. Opens each menu on the local preview and checks the list box is
// inside the viewport and inside every ancestor that clips overflow. Saves nothing: every
```

New:

```js
// non-portalled menu, plus one portalled Combobox case (the AddressForm province list in the
// branch modal — browser proof that appendix ก S1-06 is closed since R2-2 deleted
// SearchableSelect). Opens each menu on the local preview and checks the list box is
// inside the viewport and inside every ancestor that clips overflow. Saves nothing: every
```

Branch-list mock (the preview's `GET /branches` has no `_count` and `BranchesPage.tsx:158` crashes — same reason as `routes.mjs` `M.branches`). Old:

```js
const CASES = [
  {
    name: 'NoteMentionInput',
```

New:

```js
// The preview's GET /branches is a bare findMany without `_count`, which BranchesPage reads
// (same reason and shape as tools/field-scale/routes.mjs M.branches).
const BRANCHES = [
  {
    id: 'f5-branch-1', name: 'สาขาตัวอย่าง (คลังหลัก)', location: 'กรุงเทพมหานคร', phone: '020000000',
    isActive: true, isMainWarehouse: true, shopCashAccountCode: 'S11-1101', shopCashFloat: '2000',
    _count: { users: 5, products: 120, contracts: 30 },
  },
];

const CASES = [
  {
    name: 'NoteMentionInput',
```

The case. Old:

```js
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
```

New:

```js
  {
    name: 'Combobox',
    where: '/branches → "+ เพิ่มสาขา" → ที่ตั้ง → จังหวัด, ช่องเลื่อนไปบนสุดของฟอร์ม (S1-06)',
    async open(page, origin) {
      await mockGet(page, /\/branches(?:\?|$)/, () => BRANCHES);
      await page.goto(`${origin}/branches`);
      await page.getByRole('button', { name: '+ เพิ่มสาขา', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'เพิ่มสาขาใหม่' });
      const province = dialog.getByRole('combobox', { name: 'จังหวัด *', exact: true });
      // S1-06: the old SearchableSelect list opened upward inside the modal's scrolling form, so
      // with the field at the top of the form it ran above the form's edge. The Combobox list is
      // portalled to <body> and flips by itself.
      await province.evaluate((e) => e.scrollIntoView({ block: 'start' }));
      await province.click();
      const list = page.getByRole('listbox', { name: 'รายชื่อจังหวัด', exact: true });
      await expect(list.getByRole('option').first()).toBeVisible();
      return list;
    },
  },
```

Notes: `mockGet` (already in the file) answers GETs whose URL matches and lets the page document itself through (`resourceType() === 'document'`), so `/branches` the page still loads; the script already switches the preview actor to OWNER, whose `+ เพิ่มสาขา` button `BranchesPage.tsx:193-199` shows. The modal is `role="dialog"` `aria-label="เพิ่มสาขาใหม่"` (`:217`). `clipIssues` then checks the listbox against the viewport and every overflow ancestor (for a portalled list: the cmdk wrapper and the Radix popper wrapper only).

```bash
node --check tools/field-scale/menu-clip-components.mjs && echo syntax-ok
```

Expected: `syntax-ok`. (The browser run is Step 12.)

- [ ] **Step 10: API ui-fields audits — `fields.audit-spec.ts` updated, `dialogs.audit-spec.ts` checked (not executed on Windows; verified by reading)**

Both run only in the Linux docs-integration harness (`docs/guides/form-field-qa.md:17-24`).

Edit `apps/api/e2e/ui-fields/fields.audit-spec.ts`. First (`:156`) — name the dialog, because an open `Combobox` list is a second portalled layer on the page (Radix `PopoverContent`). Old:

```ts
    const dialog=p.getByRole('dialog');
    await dialog.getByRole('button',{name:'บันทึก',exact:true}).click();
```

New:

```ts
    // Named: an open Combobox list is a second, portalled layer on the page.
    const dialog=p.getByRole('dialog',{name:'เพิ่มลูกค้าใหม่'});
    await dialog.getByRole('button',{name:'บันทึก',exact:true}).click();
```

Then the address block (`:171-186`). Old:

```ts
    await browserExpect(district).toBeDisabled();
    await province.click(); await province.fill('กรุงเทพ');
    await province.press('ArrowDown'); await province.press('Enter');
    await browserExpect(province).toHaveValue('กรุงเทพมหานคร');
    await district.click(); await district.fill('พระนคร');
    await district.press('ArrowDown'); await district.press('Enter');
    await subdistrict.click(); await subdistrict.press('ArrowDown'); await subdistrict.press('Enter');
    await browserExpect(postal).not.toHaveValue('');
    // Pointer selection must reopen on the same focused input; changing province resets dependents.
    await province.click(); await province.fill('เชียงใหม่');
    await dialog.getByRole('option',{name:'เชียงใหม่',exact:true}).click();
    await browserExpect(district).toHaveValue('');
    await browserExpect(subdistrict).toBeDisabled();
    await browserExpect(postal).toHaveValue('');
    await province.click(); await browserExpect(province).toHaveAttribute('aria-expanded','true');
    await province.press('Escape'); await browserExpect(dialog).toBeVisible();
```

New:

```ts
    await browserExpect(district).toBeDisabled();
    // Combobox (R2-2): the trigger is a button; a click opens the list and focuses its search box,
    // typing filters and highlights the first match, Enter picks it. The shown value is the text.
    await province.click(); await browserExpect(p.getByRole('combobox',{name:'ค้นหาจังหวัด'})).toBeFocused();
    await p.keyboard.type('กรุงเทพ'); await p.keyboard.press('Enter');
    await browserExpect(province).toHaveText('กรุงเทพมหานคร');
    await district.click(); await browserExpect(p.getByRole('combobox',{name:'ค้นหาอำเภอ/เขต'})).toBeFocused();
    await p.keyboard.type('พระนคร'); await p.keyboard.press('Enter');
    await browserExpect(district).toHaveText('เขตพระนคร');
    await subdistrict.click(); await browserExpect(p.getByRole('combobox',{name:'ค้นหาตำบล/แขวง'})).toBeFocused();
    await p.keyboard.type('พระบรม'); await p.keyboard.press('Enter');
    await browserExpect(subdistrict).toHaveText('แขวงพระบรมมหาราชวัง');
    await browserExpect(postal).toHaveValue('10200');
    // A click reopens the list after a pick; changing province resets dependents. The list is
    // portalled to <body>, so its options are found on the page, not inside the dialog.
    await province.click(); await browserExpect(p.getByRole('combobox',{name:'ค้นหาจังหวัด'})).toBeFocused();
    await p.keyboard.type('เชียงใหม่');
    await p.getByRole('option',{name:'เชียงใหม่',exact:true}).click();
    await browserExpect(province).toHaveText('เชียงใหม่');
    await browserExpect(district).toHaveText('-- เลือกอำเภอ/เขต --');
    await browserExpect(subdistrict).toBeDisabled();
    await browserExpect(postal).toHaveValue('');
    // First Escape closes only the list. Focus is in the list's search box, so press on the page.
    await province.click(); await browserExpect(province).toHaveAttribute('aria-expanded','true');
    await p.keyboard.press('Escape');
    await browserExpect(province).toHaveAttribute('aria-expanded','false');
    await browserExpect(dialog).toBeVisible();
```

Why each change (selector by selector, facts §4c): `.fill()` on a `<button>` throws and `toHaveValue` reads `input.value` → type into the focused search box (`p.keyboard`) after waiting for it to have focus, and read the trigger with `toHaveText`; `ArrowDown` before `Enter` is gone — the `Combobox` highlights the first result after typing (spec §6.1, header Behaviour "Highlight"), and every search here has one match (`กรุงเทพ`, `พระนคร`, `พระบรม` — the old run picked the first subdistrict alphabetically without typing, which made the postal assertion weaker; it is now exact `10200`); `dialog.getByRole('option')` → `p.getByRole('option')` because the list is portalled outside the dialog; the reset check reads the placeholder text (header Behaviour "Selected / trigger"); `province.press('Escape')` → `p.keyboard.press('Escape')` because focus is in the list's search box, plus an explicit `aria-expanded="false"` check. The names `จังหวัด *` / `อำเภอ/เขต *` / `ตำบล/แขวง *` (`:167-169`), `toBeDisabled()` (`:171`, `:183`) and the postal field (`:170`) work unchanged on a labelled `<button>`.

The observation loop above it needs no change: `button[role=combobox]` is already in its control selector (`:91`), the label comes from `e.labels` (a `<button>` is labelable), and `fullSizeForms` (`customers-create`, `customers-create-expanded`, `branches-create`) get 44 px from `admin-typography.css:49` (`button[role='combobox']` sized with inputs, ≥ 140 px wide at 390 — single column).

`apps/api/e2e/ui-fields/dialogs.audit-spec.ts` — **no change.** It opens 6 address hosts (`supplier-create`, `supplier-edit`, `contact-create`, `contact-supplier`, `contract-customer-create`, `company-create`) and asserts per dialog: every field has a name (`:72` — the trigger's name is its `<label htmlFor>`), no duplicate ids in the dialog (`:75-76` — trigger ids are `useId`-based and unique; the closed list is not mounted, so its ids do not exist), Tab after opening stays inside the dialog (`:111-112` — the trigger is a focusable `<button>` inside the dialog; focus no longer opens a list), and one Escape closes the dialog (`:113-115` — before, a Tab that landed on an address `<input>` opened its list and the first Escape went to it; a `Combobox` trigger does not open on focus, so the first Escape reaches the dialog); with `FORM_AXE=1`, axe `button-name` / `aria-input-field-name` are satisfied by the label.

```bash
node -e "const ts=require('typescript');const src=require('fs').readFileSync('apps/api/e2e/ui-fields/fields.audit-spec.ts','utf8');const r=ts.transpileModule(src,{reportDiagnostics:true,compilerOptions:{module:1,target:7}});console.log('syntax diagnostics:',r.diagnostics.length)"
```

Expected: `syntax diagnostics: 0`.

- [ ] **Step 11: Type check, lint, full web suite, build**

```bash
bash tools/check-types.sh web
cd apps/web && npx eslint src/components/ui/AddressForm.tsx src/components/ui/AddressForm.test.tsx src/components/ui/field-guards.inventory.test.ts src/components/ui/native-select.inventory.test.ts; cd ../..
npm run lint --workspace=apps/web
npm run test --workspace=apps/web
npm run build --workspace=apps/web
```

Expected:
- `Web: OK` (0 type errors — no file imports `SearchableSelect` any more).
- The four-file ESLint run prints nothing; the workspace lint has no errors (pre-existing warnings elsewhere allowed) and no new `no-restricted-syntax` warning (semantic tokens only — `AddressForm.tsx` adds no classes).
- Full suite: 0 failed, except the known Windows-only failures named in the header's Global Constraints (`headerNowrap`, `tabsButtonRowsNowrap`, `RecordPaymentWizard.preview-params`; `TradeInFlow` / `ProductsPage` timeouts under load — re-run those two files alone and they pass).
- Build succeeds; the address data is still its own chunk (the dynamic `import('@/data/thai-address-data')` is unchanged) — `ls apps/web/dist/assets | grep -i thai-address` lists one `thai-address-data-*.js` (as on main).

- [ ] **Step 12: Browser — S1-06 closed (menu-clip) on a fresh preview**

```bash
npm run local:preview
node tools/field-scale/menu-clip-components.mjs
echo "exit=$?"
```

Expected: `PASS Combobox 1440px`, `PASS Combobox 1024px`, `PASS Combobox 390px`; the other cases print what they printed before this task (`NoteMentionInput`, `NameAutocomplete`, `CatalogPicker` PASS; `TemplatePickerCombobox` `KNOWN` at 1024/390 unless Task 15 already landed, then PASS); last line `PASS menu clip: … passed · … known → …`; `exit=0`. Open `.tmp/field-scale/menu-clip-components/Combobox-390.png` and `Combobox-1440.png`: the province list is drawn over the branch modal, fully on screen, not cut at the form's top edge.

**How S1-06 is verified (all three must hold):** (1) vitest "opens a portalled list named per field…" — the listbox is in `document.body`, not inside the form's container (the old list was a child of the field inside `BranchesPage.tsx:227`'s scrolling `<form>`); (2) the F5 scan (Step 5) — no inline `absolute` menu is left in the address form's tree and `SearchableSelect` is off the allow-list; (3) this browser case on the S1-06 screen at 1440/1024/390 with the province scrolled to the top of the scrolling form — the position where the old upward list ran past the form's edge. Leave the verified preview running (AGENTS.md).

- [ ] **Step 13: Field-scale on the address hosts vs `baseline-r2`**

On the preview from Step 12 (no source edit since; if `check.mjs` exits 2, run `npm run local:preview` again):

```bash
node tools/field-scale/check.mjs --label t6-address --routes company-entity-create,r2-customer-create-address,contract-customer-create,contract-customer-edit,customer-edit-dialog,supplier-form,r2-supplier-edit,r2-trade-in-quick-buy-address,branch-create,contact-create
node tools/field-scale/check.mjs --compare baseline-r2 t6-address
echo "exit=$?"
```

Expected:
- Every listed cell renders (`ok`) at 1440/1024/390 × light/dark — no "Cells rendered … but not in …", no "fact count fell" section (a lost or emptied cell is never accepted); cells of other routes are only "Not run … (subset run — not blocking)"; `MENU failures …: 0`.
- `exit=0`: the three triggers have the same height (44 px, `admin-typography.css:49`), corner (8 px), font, border (`border-input`), background (`bg-background`), disabled opacity and label (`formLabelClass`) as the `<input>`s they replace, so the address rows จังหวัด↔อำเภอ/เขต and ตำบล/แขวง↔รหัสไปรษณีย์ gain no F1 key ("F1 ใน 9 ฟอร์ม", spec §7 R2-2).
- Or `exit=1` where **every** new line is a clause-(a) re-key (the collector kind changes `input` → `combobox`, `collect.js:863`): new `<route>|<w>|<theme>|F1|<property>@combobox|<label>|<k>` paired in the same cell with a **Fixed** `<route>|<w>|<theme>|F1|<property>@input|<label>|<k>`, same `<property>`, where `<label>` ∈ {`จังหวัด *`, `อำเภอ/เขต *`, `ตำบล/แขวง *`} and `<k>` = 0…n−1 in DOM order (n = address forms visible on that route: 3 on `r2-customer-create-address` and `contract-customer-create`, up to 3 on the two customer edit routes (2 when the stored ตามบัตร = ปัจจุบัน), 1 elsewhere). The partner `รหัสไปรษณีย์` keeps its key (`input|รหัสไปรษณีย์|k`). Accept each pair under the compare triage rule (header cross-task notes) with the baseline-r2 report line and the same-row screenshot as evidence, and list every pair in the task report. Anything else (a new property on an address row, any F2/F3/F4, any MENU/P1) is a regression of this task — fix it.
- An F2 `placeholder@input|<label>|k` under **Fixed** with no partner is expected and not blocking (the trigger has no `placeholder` attribute).

- [ ] **Step 14: Screenshots for the PR (spec §8)**

From the run above, attach before/after pairs at 1440 and 390, light and dark: `.tmp/field-scale/baseline-r2/<route>-<width>-<theme>.png` vs `.tmp/field-scale/t6-address/<route>-<width>-<theme>.png` for `branch-create`, `r2-customer-create-address`, `r2-supplier-edit` (filled triggers) and `r2-trade-in-quick-buy-address`, plus `.tmp/field-scale/menu-clip-components/Combobox-{1440,390}.png` (open list, S1-06). Paste the compare summary and the menu-clip result. The PR body states what ran on Windows (Steps 1–13; Step 10 only by reading), that `fields.audit-spec.ts` / `dialogs.audit-spec.ts` were not executed (Linux harness), and that `npm run local:check` must run on Linux/CI. Do not commit anything from `.tmp/`.

- [ ] **Step 15: Review**

Stage with the `git add` line of Step 16, then run the `code-reviewer` agent on `git diff --staged` (spec §8). Fix every Critical finding (re-run Steps 3, 5, 8 and 11 for any code change) before committing.

- [ ] **Step 16: Commit**

```bash
git add apps/web/src/components/ui/AddressForm.tsx apps/web/src/components/ui/AddressForm.test.tsx apps/web/src/components/ui/field-guards.inventory.test.ts apps/web/src/components/ui/native-select.inventory.test.ts tools/field-scale/menu-clip-components.mjs apps/api/e2e/ui-fields/fields.audit-spec.ts
git status --short
git commit -F - <<'EOF'
feat(web): AddressForm pickers on Combobox, delete SearchableSelect (R2-2)

จังหวัด / อำเภอ/เขต / ตำบล/แขวง now use the shared Combobox: a portalled,
auto-flipping list (closes S1-06, the province list cut by the branch
modal's scrolling form) with Thai search that ranks district and
subdistrict names after their เขต/อำเภอ/แขวง/ตำบล prefix. AddressData in
and out, the resets (also on a same-value re-pick), the postal-code
auto-fill, labels and placeholders are unchanged; stored names that are not
in the lists still show. The Task 5 flow tests pass unchanged.

SearchableSelect and its test are deleted (keyboard/Escape/pointer cases
live in AddressForm.test.tsx); the F5 allow-list entry goes with it, the
menu-clip browser case now opens the province Combobox on the S1-06 screen,
and the ui-fields address audit types into the portalled search box.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: `git status --short` before the commit shows `M` for the six files and `D` for `apps/web/src/components/ui/SearchableSelect.tsx` and `apps/web/src/components/ui/SearchableSelect.test.tsx` (staged by `git rm` in Step 4); one commit on `feat/dropdown-search-round2`. Do not push.

---

### Task 7: `AccountCombobox` — one chart-of-accounts picker on `Combobox` (R2-3a, spec §6.4 row ผังบัญชี, §9 จอเงิน)

**Why:** `AccountSearchDropdown` (`pages/other-income/components/AccountSearchDropdown.tsx`) is a hand-rolled Popover +
listbox: substring search with no Thai normalisation and no ranking, no error state, and its own keyboard code. Spec §6.4
replaces it (and the GL / AccountRoles pickers, Task 8) with **one** `AccountCombobox` built on the shared `Combobox`
(Task 4), keeping `filter`, `blockedCodes`, `blockedReason`.

**Runs only after the expense-create PEAK-layout work is on main** (header). That work changed `AccountSearchDropdown`
to show `<code> - <name>` under CoA group headings (owner 2026-11-16, spec §9.1) and moved `ItemLinesSection`'s account
field (expense and credit-note lines) onto it. Step 0 checks this; Steps 1–2 characterize the component that is actually
on main then, and Step 5f switches every importer the Step 0 grep lists.

Decisions (follow the code where the spec is silent):
- **Location:** `apps/web/src/components/accounting/AccountCombobox.tsx` — the existing accounting-UI folder, same
  domain-folder pattern as `components/contacts/ContactCombobox.tsx` and `components/employees/EmployeeCombobox.tsx`.
  Imported by path, not through `components/accounting/index.ts` (that barrel is the InternalControlActionBar public
  API). The old file is **deleted** and every importer switches (no alias left behind): the 4 Round 1 callers
  (ItemsTable, EditableJournalTable, AdjustmentTable, PettyCashLinesSection), `ItemLinesSection`, and the test mocks
  that name the module path (`ItemsTable.fields.test.tsx`, `ExpenseFormV4.payloads.test.tsx`, `ExpenseFormV4.page.test.tsx`).
- **API:** the existing props unchanged (`value`, `onChange(code)`, `filter`, `placeholder` default `— เลือกบัญชี —`,
  `disabled`, `blockedCodes`, `blockedReason` default `บัญชีนี้ยังไม่รองรับในระบบ`, `aria-label`, `aria-labelledby`) plus
  what Tasks 8/13 need: `id`, `aria-describedby`, `invalid` / `aria-invalid`, `className`, `wrapperClassName`,
  `coaFilter` (the `useCoaGroups` filter, default `{}` = every active account — what `AccountSearchDropdown` loaded),
  `display` (`code-dash-name` default · `name` · `code-name` · `code-full-name`), `valueDisplay` (`label` default ·
  `code`), `emptyOption` (a first row with value `''`), `limit`.
- **Name:** the shared `Combobox` never sets its own `aria-label` (Global Constraints). `AccountCombobox` keeps the
  default name `บัญชี` **only** when the caller gives neither `id` (a `<label htmlFor>`) nor `aria-labelledby` — the
  three table consumers (Override JV, ผลต่าง, เงินสดย่อย) have no label, so their name stays `บัญชี`; `ItemLinesSection`
  passes `aria-label="บัญชีค่าใช้จ่าย"`. `ItemsTable` has a visible label `บัญชีรายได้` with no `htmlFor`
  (`ItemsTable.tsx:99`); this task links it (`id` + `htmlFor`), so that picker's name becomes `บัญชีรายได้`.
- **Rows (owner 2026-11-16, spec §9.1):** `<code> - <name>` — exactly `` `${code} - ${accountDisplayName(name)}` ``, the
  text the PEAK-layout `AccountSearchDropdown` shows — under CoA group headings; this is the default
  `display="code-dash-name"`. `keywords = [code, full CoA name]` so a word that only the full name has (`สำนักงาน` in
  `ค่าเช่า (สำนักงาน)`) still finds the row — the old component searched the raw name too.
- **Owner question 4 (header "Account codes"):** still open for the pickers Tasks 8 and 13 convert. They pass an explicit
  `display` until the owner answers; the default lives here (`display = 'code-dash-name'` in Step 4), so a "yes" only
  deletes their `display` props.
- **Value outside the list:** a value outside `filter` keeps showing its label (the old component looked it up in the
  whole chart); a code not in the chart at all — or not loaded yet — shows the code (the old component showed the
  placeholder) — values are never changed.
- **Unchanged:** the value written to the form, re-picking the current row calls `onChange` again, blocked rows listed
  with their reason as text and skipped by the keyboard, Escape/Tab close without picking, portal + wheel stop.
- **Test hooks kept:** search box name and placeholder `ค้นหารหัส หรือ ชื่อบัญชี`, listbox name `รายการบัญชี`, empty
  text `ไม่พบบัญชี`. The field-scale menu probes find the menu through the trigger's `aria-controls` (Task 1), so no tool
  changes. **Changed:** trigger `data-slot` `select-trigger` → `combobox-trigger` (Task 4 contract) — the field-scale
  collector's kind for these triggers changes from `select-trigger` to `combobox` (`collect.js:862-863`), so open F1
  findings re-key under compare clause (a). Audit selectors still match (`button[role="combobox"]`:
  `fields.audit-spec.ts:91`, `uxui-pages.browser.docs-spec.ts:252`, `collect.js:23,701`).
- **Characterization first (spec §9 จอเงิน):** the `AccountSearchDropdown` cases (portal, wheel, Tab, arrows, Escape,
  names, skin, blocked rows, disabled, search, `<code> - <name>`, group headings) are restated with roles/names/outcomes
  only (no `data-slot`, no `aria-activedescendant`, no result order — R2 ranks results) and must pass on the component on
  main before the switch; a consumers test pins the value each of the 4 other-income / petty-cash callers writes, and the
  PEAK-layout `ItemLinesSection.layout.test.tsx` pins the expense-line picker (it passes before and after).

**Files:**
- Create: `apps/web/src/components/accounting/AccountCombobox.tsx`
- Create (test): `apps/web/src/components/accounting/__tests__/AccountCombobox.test.tsx`
- Create (test): `apps/web/src/components/accounting/__tests__/AccountCombobox.consumers.test.tsx`
- Modify: `apps/web/src/pages/other-income/components/ItemsTable.tsx:14` (import), `:99-102` (label + `id`)
- Modify: `apps/web/src/pages/other-income/components/EditableJournalTable.tsx:8` (import), `:119` (tag)
- Modify: `apps/web/src/pages/other-income/components/AdjustmentTable.tsx:10` (import), `:60` (tag)
- Modify: `apps/web/src/components/expense-form-v4/PettyCashLinesSection.tsx:11` (import), `:106` (tag)
- Modify (test): `apps/web/src/pages/other-income/components/__tests__/ItemsTable.fields.test.tsx:6`
- Modify (Step 5f, files the PEAK-layout work added — lines at its commit `7b67db27c`):
  `apps/web/src/components/expense-form-v4/ItemLinesSection.tsx:15` (import), `:38` (comment), `:41` (tag);
  `apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.payloads.test.tsx:60-62` and
  `ExpenseFormV4.page.test.tsx:59-61` (`vi.mock` path + key); `apps/web/src/components/expense-form-v4/__tests__/expense-form-driver.ts:14`
  (comment); `apps/web/src/utils/accountName.ts:11-14` (comment)
- Delete: `apps/web/src/pages/other-income/components/AccountSearchDropdown.tsx`,
  `apps/web/src/pages/other-income/components/__tests__/AccountSearchDropdown.test.tsx` (their cases move to the
  characterization block)
- No change (verified): `components/ui/field-guards.inventory.test.ts:856-866, 932-941` (F5 scanner samples are inline
  strings named after the old component — no import, no path); `tools/field-scale/*` (the account probes use
  `menu: 'controls'` since Task 1); `apps/web/e2e/other-income-override-jv.spec.ts` (uses `table input[data-numeric-input]`
  / `page.locator('table')` — no account picker); no web e2e or api audit spec drives the account picker (facts-accounts §1.5)

**Interfaces:**
- Consumes: `Combobox`, `type ComboOption` from `@/components/ui/combobox` (Task 4, header contract);
  `filterAndRank` from `@/lib/thai-search` (Task 3); `useCoaGroups`, `type CoaGroupedFilter` from `@/hooks/useCoa`;
  `accountDisplayName` from `@/utils/accountName`; test helpers `openCombobox` / `pickComboOption` from
  `@/test/combobox` and the global `scrollIntoView` polyfill in `src/test/setup.ts` (Task 4).
- Produces (Tasks 8 and 13 use these exact names):
  ```ts
  export interface AccountItem { code: string; name: string }
  export type AccountDisplay = 'code-dash-name' | 'name' | 'code-name' | 'code-full-name';
  export interface AccountComboboxProps {
    value: string; onChange: (code: string) => void; filter?: (a: AccountItem) => boolean;
    placeholder?: string; disabled?: boolean; blockedCodes?: string[]; blockedReason?: string;
    coaFilter?: CoaGroupedFilter; display?: AccountDisplay; valueDisplay?: 'label' | 'code';
    emptyOption?: string; limit?: number; id?: string; invalid?: boolean;
    'aria-invalid'?: boolean | 'true' | 'false'; 'aria-label'?: string; 'aria-labelledby'?: string;
    'aria-describedby'?: string; className?: string; wrapperClassName?: string;
  }
  export function AccountCombobox(props: AccountComboboxProps): JSX.Element;
  ```
  DOM: the shared `Combobox` trigger (`data-slot="combobox-trigger"`); open menu search box named
  `ค้นหารหัส หรือ ชื่อบัญชี` (placeholder the same), `[role=listbox]` named `รายการบัญชี` holding one `[role=group]` per
  CoA category (named by its heading), empty `ไม่พบบัญชี`.

---

- [ ] **Step 0: Confirm the PEAK-layout work is on main and list the importers**

```bash
git fetch origin && git log --oneline -1 origin/main
git merge-base --is-ancestor origin/main HEAD && echo "branch contains main"
grep -rln "AccountSearchDropdown" apps/web/src --include=*.ts --include=*.tsx
grep -n "labelOf = \|role=\"group\"" apps/web/src/pages/other-income/components/AccountSearchDropdown.tsx
```

Expected: `branch contains main` (else rebase `feat/dropdown-search-round2` onto `origin/main` first — header). The
first grep lists (at the PEAK-layout commit `7b67db27c`) `components/expense-form-v4/{ItemLinesSection,PettyCashLinesSection}.tsx`,
`components/expense-form-v4/__tests__/{ExpenseFormV4.page.test.tsx,ExpenseFormV4.payloads.test.tsx,expense-form-driver.ts}`,
`components/ui/field-guards.inventory.test.ts`, `pages/other-income/components/{AccountSearchDropdown,AdjustmentTable,EditableJournalTable,ItemsTable}.tsx`,
`pages/other-income/components/__tests__/{AccountSearchDropdown,ItemsTable.fields}.test.tsx` and `utils/accountName.ts`.
The second grep prints `const labelOf = (a: CoaItem) => \`${a.code} - ${accountDisplayName(a.name)}\`;` and the
`role="group"` line — the component shows `<code> - <name>` under group headings. **Stop** if `ItemLinesSection.tsx`
is missing from the first list or `labelOf` is not printed: the PEAK-layout work is not on this branch yet (header).
A file in the first list that Step 5 does not name gets the same treatment as its neighbours in Step 5f (import path
and name, opening tag, `vi.mock` path and key, comments) — list it in the task report.

- [ ] **Step 1: Characterization test — the `AccountSearchDropdown` on main (`<code> - <name>`, group headings)**

Create `apps/web/src/components/accounting/__tests__/AccountCombobox.test.tsx` with exactly:

```tsx
import { useState, type ComponentProps } from 'react';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// One chart for every case; `coa.state` lets the Round 2 cases switch to loading / error.
const coa = vi.hoisted(() => ({
  state: { isLoading: false, isError: false },
  filters: [] as unknown[],
  refetch: vi.fn(),
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
}));
vi.mock('@/hooks/useCoa', () => ({
  useCoaGroups: (filter: unknown) => {
    coa.filters.push(filter);
    return {
      isLoading: coa.state.isLoading,
      isError: coa.state.isError,
      refetch: coa.refetch,
      data: coa.state.isLoading || coa.state.isError ? undefined : { groups: coa.groups },
    };
  },
}));

// Characterization step: the account picker on main (the PEAK-layout version — `<code> - <name>`
// under CoA group headings, owner 2026-11-16). Step 3 changes only this import.
import { AccountSearchDropdown as AccountCombobox } from '@/pages/other-income/components/AccountSearchDropdown';

type HarnessProps = Omit<ComponentProps<typeof AccountCombobox>, 'value' | 'onChange'> & {
  initialValue?: string;
  onPick?: (code: string) => void;
};

/** Controlled wrapper inside an overflow-hidden box — the clipping parent of S2-01. */
function Harness({ initialValue = '', onPick, ...rest }: HarnessProps) {
  const [value, setValue] = useState(initialValue);
  return (
    <div data-testid="clip" className="overflow-hidden">
      <AccountCombobox
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
const LIST = 'รายการบัญชี';
const trigger = () => screen.getByRole('combobox', { name: 'บัญชี' });

beforeEach(() => {
  coa.state = { isLoading: false, isError: false };
  coa.filters.length = 0;
  coa.refetch.mockReset();
});

// Behaviour the AccountSearchDropdown test pinned, restated with roles/names only so the
// same cases pass on AccountSearchDropdown and on AccountCombobox (no data-slot, no
// aria-activedescendant, no search-result order — R2 ranks results; see the R2 block below).
describe('AccountCombobox — AccountSearchDropdown behaviour kept (characterization)', () => {
  it('renders the list in document.body, not inside the overflow-hidden parent', async () => {
    const user = userEvent.setup();
    render(<Harness filter={only42} />);
    expect(trigger()).toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger());

    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    const listbox = screen.getByRole('listbox', { name: LIST });
    expect(screen.getByTestId('clip')).not.toContainElement(listbox);
    expect(document.body).toContainElement(listbox);
    expect(listbox).toHaveClass('overscroll-contain');
    expect(within(listbox).getAllByRole('option')).toHaveLength(4);
    expect(within(listbox).queryByRole('option', { name: '53-1301 - ค่าเช่า' })).toBeNull(); // filtered out
  });

  it('stops wheel/touchmove inside the menu from reaching ancestors (modal scroll-lock escape)', async () => {
    const user = userEvent.setup();
    const parentScroll = vi.fn();
    render(
      <div onWheel={parentScroll} onTouchMove={parentScroll}>
        <Harness filter={only42} />
      </div>,
    );
    await user.click(trigger());
    const listbox = screen.getByRole('listbox', { name: LIST });
    fireEvent.wheel(listbox);
    fireEvent.touchMove(listbox);
    expect(parentScroll).not.toHaveBeenCalled();
  });

  it.each([['{Tab}'], ['{Shift>}{Tab}{/Shift}']])(
    'Tab (%s) in the search box closes the menu without picking and keeps focus on the trigger',
    async (keys) => {
      const user = userEvent.setup();
      const onPick = vi.fn();
      render(<Harness filter={only42} initialValue="42-1105" onPick={onPick} />);
      await user.click(trigger());
      expect(screen.getByLabelText(SEARCH)).toHaveFocus();

      await user.keyboard(keys);

      expect(screen.queryByRole('listbox')).toBeNull();
      expect(onPick).not.toHaveBeenCalled();
      expect(trigger()).toHaveTextContent('42-1105 - รายได้ดอกเบี้ยธนาคาร');
      await waitFor(() => expect(document.activeElement).toBe(trigger()));
    },
  );

  it('ArrowDown skips a blocked row, Enter picks the highlighted row, focus returns to the trigger', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness filter={only42} blockedCodes={['42-1104']} onPick={onPick} />);
    await user.click(trigger());
    expect(screen.getByLabelText(SEARCH)).toHaveFocus();

    // 42-1101 (first) → 42-1102 → 42-1104 is blocked → 42-1105
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(onPick).toHaveBeenCalledWith('42-1105');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger()).toHaveTextContent('42-1105 - รายได้ดอกเบี้ยธนาคาร');
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it('ArrowUp moves the highlight back up', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness filter={only42} blockedCodes={['42-1104']} onPick={onPick} />);
    await user.click(trigger());
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}{Enter}');
    expect(onPick).toHaveBeenCalledWith('42-1102');
    expect(trigger()).toHaveTextContent('42-1102 - รายได้ค่าเช่า');
  });

  it('opens on ArrowDown from the trigger and highlights the current value', async () => {
    const user = userEvent.setup();
    render(<Harness filter={only42} initialValue="42-1105" />);
    expect(trigger()).toHaveTextContent('42-1105 - รายได้ดอกเบี้ยธนาคาร');
    trigger().focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox', { name: LIST })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '42-1105 - รายได้ดอกเบี้ยธนาคาร' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('Escape closes the menu and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Harness filter={only42} />);
    await user.click(trigger());
    expect(screen.getByRole('listbox', { name: LIST })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it("trigger name defaults to 'บัญชี'", () => {
    render(<Harness filter={only42} />);
    expect(screen.getByRole('combobox', { name: 'บัญชี' })).toBeInTheDocument();
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
    const named = screen.getByRole('combobox', { name: 'บัญชีที่ใช้' });
    expect(named).not.toHaveAttribute('aria-label');
  });

  it('looks like the fields next to it: 8px corner, border-input, bg-background, 44px, full width', () => {
    render(<Harness filter={only42} />);
    expect(trigger()).toHaveClass('rounded-lg', 'border', 'border-input', 'bg-background', 'h-11', 'w-full');
    expect(trigger()).not.toHaveClass('rounded-md');
    expect(trigger()).toHaveClass('flex', 'items-center', 'justify-between', 'text-left');
  });

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
    await user.click(trigger());
    const blocked = screen.getByRole('option', { name: /รายได้หักเงินเดือน/ });
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    expect(within(blocked).getByText('ยังไม่รองรับ — รอ payroll module')).toBeVisible();

    await user.click(blocked);
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox', { name: LIST })).toBeInTheDocument();
  });

  it('a mouse click on a blocked row does not call onChange and keeps the menu open', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness filter={only42} blockedCodes={['42-1104']} onPick={onPick} />);
    await user.click(trigger());
    fireEvent.mouseDown(screen.getByRole('option', { name: /รายได้หักเงินเดือน/ }));
    fireEvent.click(screen.getByRole('option', { name: /รายได้หักเงินเดือน/ }));
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox', { name: LIST })).toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
  });

  it('does not open when disabled', async () => {
    const user = userEvent.setup();
    render(<Harness disabled />);
    expect(trigger()).toBeDisabled();
    await user.click(trigger());
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('a value outside `filter` still shows its code and name on the trigger', () => {
    render(<Harness filter={only42} initialValue="53-1301" />);
    expect(trigger()).toHaveTextContent('53-1301 - ค่าเช่า');
  });

  it('search matches the code and the full CoA name, shows ไม่พบบัญชี, Enter picks the first listed row', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());
    const search = screen.getByLabelText(SEARCH);

    await user.type(search, '42-1105');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['42-1105 - รายได้ดอกเบี้ยธนาคาร']);

    await user.clear(search);
    await user.type(search, 'สำนักงาน'); // only in the raw name "ค่าเช่า (สำนักงาน)"
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['53-1301 - ค่าเช่า']);

    await user.clear(search);
    await user.type(search, 'ไม่มีบัญชีนี้');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('ไม่พบบัญชี')).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'ค่าเช่า');
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent).sort()).toEqual(['53-1301 - ค่าเช่า', '42-1102 - รายได้ค่าเช่า'].sort());
    const first = options[0].textContent ?? '';
    await user.keyboard('{Enter}');
    expect(trigger()).toHaveTextContent(first);
  });

  it('shows the code before the name on the trigger and in the rows; the name drops "(...)"', async () => {
    const user = userEvent.setup();
    render(<Harness initialValue="42-1105" />);
    expect(trigger()).toHaveTextContent('42-1105 - รายได้ดอกเบี้ยธนาคาร');
    await user.click(trigger());
    expect(screen.getByRole('option', { name: '42-1101 - รายได้ค่าบริการ' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '53-1301 - ค่าเช่า' })).toBeInTheDocument();
  });

  it('lists rows under their CoA group heading; a group with no row left is not shown', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());
    expect(within(screen.getByRole('group', { name: 'รายได้อื่น' })).getAllByRole('option')).toHaveLength(4);
    expect(within(screen.getByRole('group', { name: 'ค่าใช้จ่าย' })).getAllByRole('option')).toHaveLength(1);
    await user.type(screen.getByLabelText(SEARCH), '53-13');
    expect(screen.queryByRole('group', { name: 'รายได้อื่น' })).toBeNull();
    expect(screen.getByRole('option', { name: '53-1301 - ค่าเช่า' })).toBeInTheDocument();
  });

  it('a group the caller filter empties is not shown', async () => {
    const user = userEvent.setup();
    render(<Harness filter={only42} />);
    await user.click(trigger());
    expect(screen.queryByRole('group', { name: 'ค่าใช้จ่าย' })).toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(4);
  });
});
```

Run:

```bash
cd apps/web && npx vitest run src/components/accounting/__tests__/AccountCombobox.test.tsx
```

Expected: PASS on the component on main — `Tests  20 passed (20)`: the Round 1 cases (the arrow case is split in two
because its `aria-activedescendant` checks became picks, plus the "value outside `filter`" case) and the three
PEAK-layout cases (code before the name, group headings, a group the filter empties).

- [ ] **Step 2: Characterization test — what the 4 callers write**

Create `apps/web/src/components/accounting/__tests__/AccountCombobox.consumers.test.tsx` with exactly:

```tsx
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import type { OtherIncomeFormValues } from '@/lib/otherIncome.schema';

vi.mock('@/hooks/useCoa', () => ({
  useCoaGroups: () => ({
    isLoading: false,
    isError: false,
    data: {
      groups: [
        {
          category: 'รายได้อื่น',
          accounts: [
            { code: '42-1101', name: 'รายได้ค่าบริการ' },
            { code: '42-1102', name: 'ดอกเบี้ยเงินฝาก' },
            { code: '42-1104', name: 'รายได้หักเงินเดือน' },
          ],
        },
        { category: 'ค่าใช้จ่ายขาย', accounts: [{ code: '52-1104', name: 'ส่วนลดเศษสตางค์' }] },
        {
          category: 'OpEx-สถานที่',
          accounts: [
            { code: '53-1301', name: 'ค่าเช่า (สำนักงาน)' },
            { code: '53-1302', name: 'ค่าโทรศัพท์และอินเทอร์เน็ต' },
          ],
        },
        { category: 'สินทรัพย์หมุนเวียน', accounts: [{ code: '11-4101', name: 'ภาษีซื้อ' }] },
      ],
    },
  }),
}));
// PettyCashLinesSection neighbours that would call the API.
vi.mock('@/components/expense-form-v4/VendorCombobox', () => ({ VendorCombobox: () => null }));
vi.mock('@/hooks/useUserNames', () => ({ useUserNames: () => [] }));

import { ItemsTable } from '@/pages/other-income/components/ItemsTable';
import { AdjustmentTable } from '@/pages/other-income/components/AdjustmentTable';
import {
  EditableJournalTable,
  type EditableJournalLine,
} from '@/pages/other-income/components/EditableJournalTable';
import { PettyCashLinesSection } from '@/components/expense-form-v4/PettyCashLinesSection';
import { newPettyCashLine, type PettyCashFormFields } from '@/components/expense-form-v4/types';

function ItemsHarness() {
  const { control, register, watch, setValue } = useForm<OtherIncomeFormValues>({
    defaultValues: {
      priceType: 'EXCLUSIVE',
      items: [{ accountCode: '42-1102', quantity: 1, unitAmount: 100, discountAmount: 0, vatPct: 0, whtPct: 0, description: '' }],
    } as unknown as OtherIncomeFormValues,
  });
  return (
    <>
      <ItemsTable control={control} register={register} watch={watch} setValue={setValue} />
      <output data-testid="code">{watch('items.0.accountCode')}</output>
    </>
  );
}

function AdjustmentHarness() {
  const { control, register, watch, setValue } = useForm<OtherIncomeFormValues>({
    defaultValues: { adjustments: [{ amount: 50, accountCode: '', note: '' }] } as unknown as OtherIncomeFormValues,
  });
  const adjustments = watch('adjustments') ?? [];
  return (
    <>
      <AdjustmentTable
        control={control}
        register={register}
        setValue={setValue}
        totalDiff={50}
        diffSign="over"
        watchedAdjustments={adjustments}
      />
      <output data-testid="code">{adjustments[0]?.accountCode}</output>
    </>
  );
}

function PettyCashHarness({ onLines }: { onLines: (v: PettyCashFormFields) => void }) {
  const [value, setValue] = useState<PettyCashFormFields>({
    custodianName: '',
    lines: [newPettyCashLine({ uid: 'line-1' })],
  });
  return (
    <PettyCashLinesSection
      value={value}
      onChange={(v) => {
        setValue(v);
        onLines(v);
      }}
    />
  );
}

// The four other-income / petty-cash callers keep their filters, blocked code and the value they
// write (R2-3a characterization — passes on AccountSearchDropdown and on AccountCombobox).
// The expense lines (ItemLinesSection) are pinned by ItemLinesSection.layout.test.tsx.
describe('account picker callers — value written on pick', () => {
  it('รายได้อื่น › ItemsTable: 42- accounts only, 42-1104 blocked, pick writes items.N.accountCode', async () => {
    const user = userEvent.setup();
    render(<ItemsHarness />);
    const picker = screen.getByRole('combobox', { name: /^บัญชี/ });
    expect(picker).toHaveTextContent('42-1102 - ดอกเบี้ยเงินฝาก');
    await user.click(picker);
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(3);
    expect(within(list).getByRole('option', { name: /รายได้หักเงินเดือน/ })).toHaveAttribute('aria-disabled', 'true');
    await user.click(within(list).getByRole('option', { name: '42-1101 - รายได้ค่าบริการ' }));
    expect(screen.getByTestId('code')).toHaveTextContent('42-1101');
  });

  it('รายได้อื่น › AdjustmentTable: 52-/53-/11-41 accounts, pick writes adjustments.N.accountCode', async () => {
    const user = userEvent.setup();
    render(<AdjustmentHarness />);
    await user.click(screen.getByRole('combobox', { name: 'บัญชี' }));
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(4);
    expect(within(list).queryByRole('option', { name: '42-1102 - ดอกเบี้ยเงินฝาก' })).toBeNull();
    await user.click(within(list).getByRole('option', { name: '52-1104 - ส่วนลดเศษสตางค์' }));
    expect(screen.getByTestId('code')).toHaveTextContent('52-1104');
  });

  it('Override JV › EditableJournalTable: 41/42/51/52/53 accounts, pick sends the line with the new code', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const lines: EditableJournalLine[] = [{ accountCode: '', debit: 100, credit: 0, description: 'x' }];
    render(<EditableJournalTable lines={lines} onChange={onChange} />);
    await user.click(screen.getByRole('combobox', { name: 'บัญชี' }));
    const list = screen.getByRole('listbox');
    expect(within(list).queryByRole('option', { name: '11-4101 - ภาษีซื้อ' })).toBeNull();
    await user.click(within(list).getByRole('option', { name: '53-1302 - ค่าโทรศัพท์และอินเทอร์เน็ต' }));
    expect(onChange).toHaveBeenCalledWith([{ accountCode: '53-1302', debit: 100, credit: 0, description: 'x' }]);
  });

  it('เงินสดย่อย › PettyCashLinesSection: 53- accounts only, pick writes the line category', async () => {
    const user = userEvent.setup();
    const onLines = vi.fn();
    render(<PettyCashHarness onLines={onLines} />);
    await user.click(screen.getByRole('combobox', { name: 'บัญชี' }));
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(2);
    await user.click(within(list).getByRole('option', { name: '53-1301 - ค่าเช่า' }));
    expect(onLines).toHaveBeenLastCalledWith({
      custodianName: '',
      lines: [expect.objectContaining({ uid: 'line-1', category: '53-1301' })],
    });
  });
});
```

Run:

```bash
cd apps/web && npx vitest run src/components/accounting/__tests__/AccountCombobox.consumers.test.tsx
```

Expected: PASS on the current callers (still `AccountSearchDropdown`) — `Tests  4 passed (4)`.

- [ ] **Step 3: Write the failing Round 2 tests**

3a. In `apps/web/src/components/accounting/__tests__/AccountCombobox.test.tsx` replace

```tsx
// Characterization step: the account picker on main (the PEAK-layout version — `<code> - <name>`
// under CoA group headings, owner 2026-11-16). Step 3 changes only this import.
import { AccountSearchDropdown as AccountCombobox } from '@/pages/other-income/components/AccountSearchDropdown';
```

with

```tsx
import { AccountCombobox } from '../AccountCombobox';
```

and append at the end of the file:

```tsx

describe('AccountCombobox — Round 2 (shared Combobox)', () => {
  it('is the shared Combobox; the search box keeps its name and placeholder', async () => {
    const user = userEvent.setup();
    render(<Harness filter={only42} />);
    expect(trigger()).toHaveAttribute('data-slot', 'combobox-trigger');
    await user.click(trigger());
    expect(screen.getByRole('combobox', { name: SEARCH })).toHaveFocus();
    expect(screen.getByRole('combobox', { name: SEARCH })).toHaveAttribute('placeholder', SEARCH);
  });

  it('ranks Thai matches: a name that starts with the query comes before one that only contains it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());
    await user.type(screen.getByLabelText(SEARCH), 'ค่าเช่า');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      '53-1301 - ค่าเช่า',
      '42-1102 - รายได้ค่าเช่า',
    ]);
  });

  it('finds an account by part of its code', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());
    await user.type(screen.getByLabelText(SEARCH), '53-13');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['53-1301 - ค่าเช่า']);
  });

  it('with an id, a <label htmlFor> names the trigger and no default aria-label is set', () => {
    render(
      <>
        <label htmlFor="acc">บัญชีรายได้</label>
        <Harness id="acc" filter={only42} />
      </>,
    );
    const named = screen.getByRole('combobox', { name: 'บัญชีรายได้' });
    expect(named).toHaveAttribute('id', 'acc');
    expect(named).not.toHaveAttribute('aria-label');
  });

  it('passes aria-describedby and aria-invalid to the trigger', () => {
    render(
      <>
        <p id="acc-hint">ไปอยู่ในบรรทัดของร่าง</p>
        <Harness filter={only42} aria-describedby="acc-hint" aria-invalid />
      </>,
    );
    expect(trigger()).toHaveAccessibleDescription('ไปอยู่ในบรรทัดของร่าง');
    expect(trigger()).toHaveAttribute('aria-invalid', 'true');
  });

  it("display='name' shows the display name only, in rows and on the trigger", async () => {
    const user = userEvent.setup();
    render(<Harness filter={only42} display="name" />);
    await user.click(trigger());
    await user.click(screen.getByRole('option', { name: 'รายได้ดอกเบี้ยธนาคาร' }));
    expect(trigger()).toHaveTextContent(/^รายได้ดอกเบี้ยธนาคาร$/);
  });

  it("display='code-name' shows code + display name in rows and on the trigger", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness filter={only42} display="code-name" onPick={onPick} />);
    await user.click(trigger());
    await user.click(screen.getByRole('option', { name: '42-1105 รายได้ดอกเบี้ยธนาคาร' }));
    expect(onPick).toHaveBeenCalledWith('42-1105');
    expect(trigger()).toHaveTextContent('42-1105 รายได้ดอกเบี้ยธนาคาร');
  });

  it("display='code-full-name' keeps the full chart name", async () => {
    const user = userEvent.setup();
    render(<Harness display="code-full-name" />);
    await user.click(trigger());
    expect(screen.getByRole('option', { name: '53-1301 ค่าเช่า (สำนักงาน)' })).toBeInTheDocument();
  });

  it("valueDisplay='code' shows only the code on the trigger", () => {
    render(<Harness filter={only42} valueDisplay="code" initialValue="42-1105" />);
    expect(trigger()).toHaveTextContent(/^42-1105$/);
  });

  it('a code that is not in the chart shows the code instead of the placeholder', () => {
    render(<Harness filter={only42} initialValue="99-9999" />);
    expect(trigger()).toHaveTextContent('99-9999');
  });

  it("emptyOption lists a '' row first, shows it for '' and picks ''", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness filter={only42} emptyOption="ทุกประเภท" initialValue="42-1101" onPick={onPick} />);
    await user.click(trigger());
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('ทุกประเภท');
    await user.click(screen.getByRole('option', { name: 'ทุกประเภท' }));
    expect(onPick).toHaveBeenCalledWith('');
    expect(trigger()).toHaveTextContent('ทุกประเภท');
  });

  it('limit caps the rows shown', async () => {
    const user = userEvent.setup();
    render(<Harness limit={2} />);
    await user.click(trigger());
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('loads the chart named by coaFilter (default: every active account)', () => {
    render(
      <>
        <Harness />
        <Harness coaFilter={{ type: 'ค่าใช้จ่าย' }} />
      </>,
    );
    expect(coa.filters).toContainEqual({});
    expect(coa.filters).toContainEqual({ type: 'ค่าใช้จ่าย' });
  });

  it('while the chart loads a saved code shows the code, then its label', () => {
    coa.state = { isLoading: true, isError: false };
    const { rerender } = render(<Harness initialValue="42-1105" />);
    expect(trigger()).toHaveTextContent(/^42-1105$/);
    coa.state = { isLoading: false, isError: false };
    rerender(<Harness initialValue="42-1105" />);
    expect(trigger()).toHaveTextContent('42-1105 - รายได้ดอกเบี้ยธนาคาร');
  });

  it('shows the shared loading text while the chart loads', async () => {
    coa.state = { isLoading: true, isError: false };
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());
    expect(screen.getByText('กำลังโหลด…')).toBeInTheDocument();
  });

  it('shows the shared error and retries the chart query', async () => {
    coa.state = { isLoading: false, isError: true };
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());
    expect(screen.getByText('โหลดรายการไม่สำเร็จ')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    expect(coa.refetch).toHaveBeenCalled();
  });
});
```

3b. Append at the end of `apps/web/src/components/accounting/__tests__/AccountCombobox.consumers.test.tsx`:

```tsx

describe('account picker callers — labels (R2-3a)', () => {
  it('รายได้อื่น › ItemsTable: the visible label "บัญชีรายได้" names the picker', () => {
    render(<ItemsHarness />);
    expect(screen.getByRole('combobox', { name: 'บัญชีรายได้' })).toHaveTextContent('42-1102 - ดอกเบี้ยเงินฝาก');
  });
});
```

Run:

```bash
cd apps/web && npx vitest run src/components/accounting/__tests__
```

Expected: FAIL.
- `AccountCombobox.test.tsx` fails to load: `Failed to resolve import "../AccountCombobox" from "src/components/accounting/__tests__/AccountCombobox.test.tsx". Does the file exist?`
- `AccountCombobox.consumers.test.tsx`: `Tests  1 failed | 4 passed (5)` — `Unable to find an accessible element with the role "combobox" and name "บัญชีรายได้"` (the label has no `htmlFor` yet).

- [ ] **Step 4: Create `AccountCombobox`**

Create `apps/web/src/components/accounting/AccountCombobox.tsx` with exactly:

```tsx
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { useCoaGroups, type CoaGroupedFilter } from '@/hooks/useCoa';
import { filterAndRank } from '@/lib/thai-search';
import { accountDisplayName } from '@/utils/accountName';

export interface AccountItem {
  code: string;
  name: string;
}

/**
 * What a row shows (and the trigger, unless `valueDisplay="code"`):
 * - `code-dash-name` (default) — `<code> - <display name>` under the CoA group headings: the
 *   searchable account picker the owner chose on 2026-11-16 (spec §9.1, `utils/accountName.ts`)
 * - `name` — the display name only (entry-form `NativeSelect` pickers before Round 2)
 * - `code-name` — code + display name (the recurring-bill account select)
 * - `code-full-name` — code + the full chart name, "(...)" kept (reports: general ledger)
 */
export type AccountDisplay = 'code-dash-name' | 'name' | 'code-name' | 'code-full-name';

export interface AccountComboboxProps {
  value: string;
  onChange: (code: string) => void;
  /** Client-side filter on the loaded chart (e.g. `a.code.startsWith('42-')`). */
  filter?: (a: AccountItem) => boolean;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Codes listed but not selectable (server validation still rejects them) — shown with
   * `blockedReason` as visible text and skipped by the keyboard.
   */
  blockedCodes?: string[];
  blockedReason?: string;
  /** Which chart `GET /chart-of-accounts/grouped` loads. Default `{}` = every active account. */
  coaFilter?: CoaGroupedFilter;
  display?: AccountDisplay;
  /** `code` = the trigger shows the code only (mono), rows keep `display`. */
  valueDisplay?: 'label' | 'code';
  /** Adds a first row with value `''` and this label (a filter's "all", or "none" in a form). */
  emptyOption?: string;
  /** Show at most this many rows after searching (the general ledger caps at 200). */
  limit?: number;
  id?: string;
  invalid?: boolean;
  'aria-invalid'?: boolean | 'true' | 'false';
  /** Default `'บัญชี'` when neither `id` (a `<label htmlFor>`) nor `aria-labelledby` names it. */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  className?: string;
  wrapperClassName?: string;
}

const DEFAULT_BLOCKED_REASON = 'บัญชีนี้ยังไม่รองรับในระบบ';
const DEFAULT_TRIGGER_LABEL = 'บัญชี';
const SEARCH_LABEL = 'ค้นหารหัส หรือ ชื่อบัญชี';
const ALL_ACCOUNTS: CoaGroupedFilter = {};

function accountLabel(a: AccountItem, display: AccountDisplay): string {
  if (display === 'code-full-name') return `${a.code} ${a.name}`;
  const name = accountDisplayName(a.name);
  if (display === 'code-dash-name') return `${a.code} - ${name}`;
  return display === 'code-name' ? `${a.code} ${name}` : name;
}

const codeOnly = (option: ComboOption<AccountItem>) => (
  <span className="font-mono">{option.value}</span>
);

/**
 * The one chart-of-accounts picker (spec 2026-11-14 §6.4 "ผังบัญชี", R2-3a): the shared
 * `Combobox` fed by `useCoaGroups`. Rows show `<code> - <name>` (default `display`) grouped by CoA
 * category; search is Thai-aware (`filterAndRank`) over the row text, the code and the full CoA
 * name. Keeps the `AccountSearchDropdown` API (value/onChange(code)/filter/blockedCodes/
 * blockedReason) and its test hooks: search box named `ค้นหารหัส หรือ ชื่อบัญชี`, list named
 * `รายการบัญชี`.
 */
export function AccountCombobox({
  value,
  onChange,
  filter,
  placeholder = '— เลือกบัญชี —',
  disabled,
  blockedCodes,
  blockedReason,
  coaFilter = ALL_ACCOUNTS,
  display = 'code-dash-name',
  valueDisplay = 'label',
  emptyOption,
  limit,
  id,
  invalid,
  'aria-invalid': ariaInvalid,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
  className,
  wrapperClassName,
}: AccountComboboxProps) {
  const coa = useCoaGroups(coaFilter);
  const groups = coa.data?.groups;

  const toOption = (a: AccountItem, category: string): ComboOption<AccountItem> => {
    const blocked = blockedCodes?.includes(a.code) ?? false;
    return {
      value: a.code,
      label: accountLabel(a, display),
      keywords: [a.code, a.name],
      group: category,
      disabled: blocked || undefined,
      disabledReason: blocked ? (blockedReason ?? DEFAULT_BLOCKED_REASON) : undefined,
      meta: { code: a.code, name: a.name },
    };
  };
  const chart = (groups ?? []).flatMap((g) =>
    g.accounts.map((a) => ({ account: { code: a.code, name: a.name }, category: g.category })),
  );
  const listed = chart
    .filter(({ account }) => !filter || filter(account))
    .map(({ account, category }) => toOption(account, category));
  const options: ComboOption<AccountItem>[] =
    emptyOption === undefined ? listed : [{ value: '', label: emptyOption }, ...listed];

  // A value outside `filter` keeps its label (R1 looked it up in the whole chart); a code not in
  // the chart (inactive, typed in a URL) — or not loaded yet — shows the code itself.
  const inChart = chart.find(({ account }) => account.code === value);
  const selectedOption =
    value && !listed.some((o) => o.value === value)
      ? inChart
        ? toOption(inChart.account, inChart.category)
        : { value, label: value }
      : null;

  return (
    <Combobox
      value={value === '' && emptyOption === undefined ? null : value}
      onChange={(code) => onChange(code)}
      options={options}
      selectedOption={selectedOption}
      placeholder={placeholder}
      searchLabel={SEARCH_LABEL}
      searchPlaceholder={SEARCH_LABEL}
      listLabel="รายการบัญชี"
      emptyText="ไม่พบบัญชี"
      filter={limit ? (opts, query) => filterAndRank(opts, query).slice(0, limit) : undefined}
      loading={coa.isLoading}
      error={coa.isError}
      onRetry={coa.isError ? () => void coa.refetch() : undefined}
      renderValue={valueDisplay === 'code' ? codeOnly : undefined}
      id={id}
      disabled={disabled}
      invalid={invalid ?? (ariaInvalid === true || ariaInvalid === 'true')}
      aria-label={ariaLabelledby ? undefined : (ariaLabel ?? (id ? undefined : DEFAULT_TRIGGER_LABEL))}
      aria-labelledby={ariaLabelledby}
      aria-describedby={ariaDescribedby}
      className={className}
      wrapperClassName={wrapperClassName}
    />
  );
}
```

Notes (hold for the code above — do not "fix"):
- The options are rebuilt every render (a chart of ~170 rows, several pickers per screen) — the `Combobox` keys rows by
  index (`opt:${index}`), so object identity does not matter; no `useMemo` needed.
- `onRetry` is passed only while `isError`: several existing tests mock `useCoaGroups` as `{ data }` only (no
  `refetch`), e.g. `ItemLinesSection.readonly.test.tsx:4`, `ExpensesPage.ux.test.tsx:24`.
- `invalid` is `false` (not `undefined`) when neither prop is set — the `Combobox` sets `aria-invalid` only when true.
- `selectedOption` does not wait for the chart: while `/chart-of-accounts/grouped` loads, a saved code shows as the code
  (AccountRoles showed its code at once before Task 8), then its label once the chart arrives.

Run:

```bash
cd apps/web && npx vitest run src/components/accounting/__tests__/AccountCombobox.test.tsx
```

Expected: PASS — `Tests  36 passed (36)` (20 characterization + 16 Round 2).

- [ ] **Step 5: Switch every importer, link the ItemsTable label, delete the old component**

5a. `apps/web/src/pages/other-income/components/ItemsTable.tsx` — replace

```tsx
import { AccountSearchDropdown } from './AccountSearchDropdown';
```

with

```tsx
import { AccountCombobox } from '@/components/accounting/AccountCombobox';
```

and replace

```tsx
                <label className={formLabelClass}>บัญชีรายได้</label>
                <div>
                  <AccountSearchDropdown
                    value={items[idx]?.accountCode ?? ''}
```

with

```tsx
                <label htmlFor={`${uiExtraFieldId}-0-${idx}`} className={formLabelClass}>บัญชีรายได้</label>
                <div>
                  <AccountCombobox
                    id={`${uiExtraFieldId}-0-${idx}`}
                    value={items[idx]?.accountCode ?? ''}
```

(`uiExtraFieldId` is `useExtraFieldId()` at `ItemsTable.tsx:41`; suffixes `-1`…`-4` are taken, `-0` is free.)

5b. `apps/web/src/pages/other-income/components/EditableJournalTable.tsx` and
`apps/web/src/pages/other-income/components/AdjustmentTable.tsx` — in each file replace

```tsx
import { AccountSearchDropdown } from './AccountSearchDropdown';
```

with

```tsx
import { AccountCombobox } from '@/components/accounting/AccountCombobox';
```

and the opening tag `<AccountSearchDropdown` (one occurrence per file: `EditableJournalTable.tsx:119`,
`AdjustmentTable.tsx:60`) with `<AccountCombobox`. Props stay as they are.

5c. `apps/web/src/components/expense-form-v4/PettyCashLinesSection.tsx` — replace

```tsx
import { AccountSearchDropdown } from '@/pages/other-income/components/AccountSearchDropdown';
```

with

```tsx
import { AccountCombobox } from '@/components/accounting/AccountCombobox';
```

and the opening tag `<AccountSearchDropdown` (`:106`) with `<AccountCombobox`.

5d. `apps/web/src/pages/other-income/components/__tests__/ItemsTable.fields.test.tsx` — replace

```tsx
vi.mock('../AccountSearchDropdown', () => ({ AccountSearchDropdown: () => <div data-testid="account-dropdown" /> }));
```

with

```tsx
vi.mock('@/components/accounting/AccountCombobox', () => ({ AccountCombobox: () => <div data-testid="account-dropdown" /> }));
```

5e. Delete the old component and its test (their cases live on in Step 1's characterization block):

```bash
git rm apps/web/src/pages/other-income/components/AccountSearchDropdown.tsx \
  apps/web/src/pages/other-income/components/__tests__/AccountSearchDropdown.test.tsx
```

5f. Switch every other importer Step 0 listed — the ones the PEAK-layout work added.

`apps/web/src/components/expense-form-v4/ItemLinesSection.tsx` — replace

```tsx
import { AccountSearchDropdown } from '@/pages/other-income/components/AccountSearchDropdown';
```

with

```tsx
import { AccountCombobox } from '@/components/accounting/AccountCombobox';
```

replace

```tsx
  // ชุดบัญชีเดิมของ dropdown นี้ — AccountSearchDropdown โหลดผังทั้งหมด จึงกรองด้วยรหัสชุดนี้
```

with

```tsx
  // ชุดบัญชีเดิมของ dropdown นี้ — AccountCombobox โหลดผังทั้งหมด จึงกรองด้วยรหัสชุดนี้
```

and replace

```tsx
    <AccountSearchDropdown
      aria-label="บัญชีค่าใช้จ่าย"
```

with

```tsx
    <AccountCombobox
      aria-label="บัญชีค่าใช้จ่าย"
```

(the props stay as they are — `value`, `onChange`, `filter`, `placeholder="— เลือก —"`; rows show `<code> - <name>`, the
default `display`.)

In `apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.payloads.test.tsx` and
`apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.page.test.tsx` replace

```tsx
vi.mock('@/pages/other-income/components/AccountSearchDropdown', () => ({
```

with

```tsx
vi.mock('@/components/accounting/AccountCombobox', () => ({
```

and

```tsx
  AccountSearchDropdown: (props: { value: string; onChange: (code: string) => void; 'aria-label'?: string }) => (
```

with

```tsx
  AccountCombobox: (props: { value: string; onChange: (code: string) => void; 'aria-label'?: string }) => (
```

In `apps/web/src/components/expense-form-v4/__tests__/expense-form-driver.ts` replace

```ts
  // เทสต์ที่ใช้ driver นี้แทน AccountSearchDropdown ด้วยปุ่มที่เลือก 53-1101 เสมอ
```

with

```ts
  // เทสต์ที่ใช้ driver นี้แทน AccountCombobox ด้วยปุ่มที่เลือก 53-1101 เสมอ
```

In `apps/web/src/utils/accountName.ts` replace

```ts
 * 2026-11-16 (owner): the SEARCHABLE account picker (`AccountSearchDropdown`) shows
 * `code - name` plus chart group headings, like PEAK. It still runs the name through
 * this function (parentheticals stay dropped). Plain `NativeSelect` account pickers
 * keep name-only until the shared `AccountCombobox` (dropdown spec 2026-11-14 §9.1).
```

with

```ts
 * 2026-11-16 (owner): the SEARCHABLE account picker (`AccountCombobox`, its default `display`)
 * shows `code - name` plus chart group headings, like PEAK. It still runs the name through
 * this function (parentheticals stay dropped). Plain `NativeSelect` account pickers keep
 * name-only (dropdown spec 2026-11-14 §9.1).
```

Then check that nothing else names the old component:

```bash
grep -rn "AccountSearchDropdown" apps/web/src --include=*.ts --include=*.tsx | grep -v "src/components/accounting/"
```

Expected grep output: only the two F5 sample descriptions in `components/ui/field-guards.inventory.test.ts`
(`'AccountSearchDropdown panel as of HEAD 2026-11-14 …'`, `'AccountSearchDropdown after Task 6 (PopoverContent portal)'`)
— inline scanner samples, left as they are. (`components/accounting/` mentions the old name only in comments and the
characterization `describe` title.)

Run:

```bash
cd apps/web && npx vitest run src/components/accounting src/pages/other-income src/components/expense-form-v4 src/components/ui/field-guards.inventory.test.ts
```

Expected: every file passes, 0 failed (`AccountCombobox.test.tsx` 36, `AccountCombobox.consumers.test.tsx` 5; the
PEAK-layout `ItemLinesSection.layout.test.tsx` — options `53-1101 - ค่าไฟฟ้า`, expense accounts only, search — and
`ExpenseFormV4.page.test.tsx` / `ExpenseFormV4.payloads.test.tsx` pass unchanged apart from the mock path).

- [ ] **Step 6: no tool change**

Task 4's search box carries `aria-label` and Task 1's account probes find the menu through the trigger's
`aria-controls`; nothing in `tools/field-scale` changes here. (Optional check: `grep -n "menu: 'controls'"
tools/field-scale/routes.mjs` prints the `menu: 'controls'` line of every probe.)

- [ ] **Step 7: Type check + lint**

```bash
bash tools/check-types.sh web
cd apps/web && npx eslint src/components/accounting/AccountCombobox.tsx src/components/accounting/__tests__/AccountCombobox.test.tsx src/components/accounting/__tests__/AccountCombobox.consumers.test.tsx src/pages/other-income/components/ItemsTable.tsx src/pages/other-income/components/EditableJournalTable.tsx src/pages/other-income/components/AdjustmentTable.tsx src/components/expense-form-v4/PettyCashLinesSection.tsx src/pages/other-income/components/__tests__/ItemsTable.fields.test.tsx src/components/expense-form-v4/ItemLinesSection.tsx src/components/expense-form-v4/__tests__/ExpenseFormV4.payloads.test.tsx src/components/expense-form-v4/__tests__/ExpenseFormV4.page.test.tsx src/components/expense-form-v4/__tests__/expense-form-driver.ts src/utils/accountName.ts
```

Expected: 0 type errors for web; ESLint prints nothing (no errors, no warnings in these files).

- [ ] **Step 8: Money screens on the preview — field-scale, menu probes, before/after screenshots**

```bash
npm run local:preview
node tools/field-scale/check.mjs --label t7-account-combobox --routes other-income-items,other-income-override,r2-other-income-adjustment,r2-petty-cash-lines,expense-new,r2-credit-note-lines
node tools/field-scale/check.mjs --compare baseline-r2 t7-account-combobox
echo "exit=$?"
```

(Wait for `Started http://localhost:5195/inbox` before the second line. Compare against `baseline-r2-peak` instead if the
header's PEAK-layout rule made you record it.)

Expected:
- The run prints `menu probes: 8 pass · 0 fail` — `account-menu-items-card` and `account-menu-override-jv` (1440) and
  `account-menu-petty-cash` (1440, 390), light and dark — and `report.md` section "เมนูบัญชีถูกตัด (S2-01 / S2-02)" lists
  them `PASS`. They were PASS on `baseline-r2` too (`menu: 'controls'`), so the compare lists no **Fixed** line for them.
  (`account-menu-expense-line` on `expense-new` is still in `PENDING_PROBES` — Task 13 attaches it.) A probe `FAIL` means
  the trigger lost `aria-controls` (Combobox contract) — fix `AccountCombobox`, not the tool.
- Compare: `MENU failures …: 0`, no "Cells rendered … but not in …" / "fact count fell", and `exit=0` — or `exit=1`
  where every new P2 line is a clause (a) re-key pair (the trigger changed kind `select-trigger` → `combobox`, and the
  item-card picker's name `บัญชี` → `บัญชีรายได้`), same cell, same detail:
  `<prop>@select-trigger|บัญชี|<n>` on `other-income-items` → `<prop>@combobox|บัญชีรายได้|0`;
  on `other-income-override`, `r2-other-income-adjustment` and `r2-petty-cash-lines` → `<prop>@combobox|บัญชี|<n>`;
  `<prop>@select-trigger|บัญชีค่าใช้จ่าย|<n>` on `expense-new` and `r2-credit-note-lines` → `<prop>@combobox|บัญชีค่าใช้จ่าย|<n>`.
  List each pair in the task report. Anything else (F2/F3/F4, MENU, a changed detail) must be fixed.
- Screenshots (before = `.tmp/field-scale/baseline-r2/`, after = `.tmp/field-scale/t7-account-combobox/`): compare
  `other-income-items-{1440,390}-{light,dark}.png`, `other-income-override-…png` and `expense-new-…png` — the account
  triggers are the same height and corner as the fields next to them, the item card shows `42-1102 - ดอกเบี้ยเงินฝาก`;
  open `other-income-items-1440-light-account-menu-items-card.png`, `other-income-override-1440-light-account-menu-override-jv.png`
  and `r2-petty-cash-lines-390-light-account-menu-petty-cash.png` — the menu has the search box `ค้นหารหัส หรือ ชื่อบัญชี`,
  rows `<code> - <name>` under a category heading, and is drawn over the card/table edge.

Leave the verified preview running (AGENTS.md).

- [ ] **Step 9: Real-save check on the preview (spec §9 จอเงิน, as far as the preview API goes)**

In a browser on the running preview (no login — fixed OWNER actor), with DevTools → Network open:
1. Open `http://localhost:5195/other-income/new`. If `GET …/chart-of-accounts/grouped` answers 200, open `บัญชีรายได้`,
   type `42-11`, pick a row, then click `บันทึกร่าง`; in the `POST …/other-income` request body check
   `items[0].accountCode` equals the picked code.
2. If `/chart-of-accounts/grouped` or `POST …/other-income` is not served by the synthetic preview API (404/500), record
   "not verifiable on the preview — value written proven by `AccountCombobox.consumers.test.tsx`" in the task report.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/components/accounting/AccountCombobox.tsx \
  apps/web/src/components/accounting/__tests__/AccountCombobox.test.tsx \
  apps/web/src/components/accounting/__tests__/AccountCombobox.consumers.test.tsx \
  apps/web/src/pages/other-income/components/ItemsTable.tsx \
  apps/web/src/pages/other-income/components/EditableJournalTable.tsx \
  apps/web/src/pages/other-income/components/AdjustmentTable.tsx \
  apps/web/src/components/expense-form-v4/PettyCashLinesSection.tsx \
  apps/web/src/pages/other-income/components/__tests__/ItemsTable.fields.test.tsx \
  apps/web/src/components/expense-form-v4/ItemLinesSection.tsx \
  apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.payloads.test.tsx \
  apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.page.test.tsx \
  apps/web/src/components/expense-form-v4/__tests__/expense-form-driver.ts \
  apps/web/src/utils/accountName.ts
git commit -F - <<'EOF'
feat(web): AccountCombobox replaces AccountSearchDropdown (R2-3a)

One chart-of-accounts picker on the shared Combobox: rows "<code> - <name>"
under CoA group headings (owner 2026-11-16), Thai-aware search over the
row, the code and the full CoA name, shared loading/error/retry, blocked
codes listed with their reason. Same props and the same value written by
every caller (other-income items, Override JV, adjustments, petty cash,
expense / credit-note lines) — pinned by characterization tests that passed
on AccountSearchDropdown first. The item-card label now names its picker;
a saved code shows while the chart loads.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

(The `git rm` in Step 5e already staged the two deletions.) Expected: one commit. Do not push.

---

### Task 8: General ledger + account-role pickers on `AccountCombobox` (R2-3a)

**Why:** Two more chart pickers each carry their own Popover + cmdk (spec §6.4 names them:
`GeneralLedgerPage.tsx:230-289`, `AccountRolesPage.tsx:275-317`).
- **General ledger** (`/finance/general-ledger`): `useCoaGroups({})`, own substring search, `Command shouldFilter={false}`,
  first **200** rows, rows and trigger show **code + full (raw) name**, trigger is a shadcn `<Button variant="outline"
  aria-label="เลือกบัญชี">` while the visible label `รหัสบัญชี` has no `htmlFor`, menu `w-[380px]`. →
  `AccountCombobox display="code-full-name" limit={200}` — same data, same rows, same cap. The label gets `htmlFor` +
  `id` (Global Constraints: the trigger's name is its label), so the name becomes `รหัสบัญชี`; the label keeps its
  current class (`text-2xs … uppercase`) because the date fields beside it use the same one. `GeneralLedgerPage.test.tsx:231-232`
  is first rewritten to pick by role (passes on both), then a strict test uses the new name. The menu becomes as wide
  as the trigger (spec §6.1) instead of 380px. The GL query (`/expenses/ledger/general-ledger?accountCode=…`) is
  unchanged.
- **Account roles** (`/settings/access/account-roles`, edit dialog): its own query `GET /chart-of-accounts?status=ใช้งาน`
  (`findAll`: `deletedAt: null` + `status` + `orderBy code`) returns the same accounts as `/chart-of-accounts/grouped`
  (`findGrouped`: `deletedAt: null, status: 'ใช้งาน'`, `orderBy code`) — so it moves onto `AccountCombobox` (no separate
  `Combobox` needed); the query stays lazy because `DialogContent` mounts only while the dialog is open. Rows keep the
  display name (`display="name"` — explicit, because `AccountCombobox`'s default is `<code> - <name>`), the trigger keeps
  **the code only** (`valueDisplay="code"`), `id="ar-coa-trigger"` stays (field-scale
  `account-role-edit` opens the menu with it, `routes.mjs:260`), so does the label `htmlFor`. cmdk's fuzzy filter is
  replaced by the Thai ranking (the code still finds the row — keyword). A mapped code that is not in the chart (the
  table shows "ไม่พบในผังบัญชี") still shows its code — and a saved code shows at once while the chart loads, as the
  old `{accountCode || 'เลือกบัญชี...'}` trigger did. `PUT /settings/role-map/:id` sends `accountCode` only when it
  changed — unchanged.
- **Owner question 4 (header "Account codes"):** if the owner wants codes on the converted pickers, GL keeps
  `display="code-full-name"` (a report — it already shows the code) or drops it for the default, and AccountRoles drops
  `display="name"` (Step 5); nothing else changes.

**Files:**
- Modify: `apps/web/src/pages/GeneralLedgerPage.tsx:2` (react import), `:11-24` (popover/command/lucide imports), `:29`
  (`useCoaGroups` import), `:97-125` (picker state), `:227-289` (label + picker)
- Modify (test): `apps/web/src/pages/GeneralLedgerPage.test.tsx:2`, `:5`, `:230-232`; append one `describe`
- Modify: `apps/web/src/pages/AccountRolesPage.tsx:6`, `:22-32`, `:45-51`, `:221-228`, `:275-317`
- Create (test): `apps/web/src/pages/__tests__/AccountRolesPage.test.tsx`
- Modify (e2e, not executed on Windows): `apps/web/e2e/account-roles-admin.spec.ts:90`
- No change (verified by reading): `apps/web/e2e/sp2-accounting-reports.spec.ts:28` (`getByText(/เลือกบัญชี/).first()`
  still matches the trigger placeholder `เลือกบัญชี…` or the empty state :333);
  `pages/settings/__tests__/company-access-system-migration.test.tsx:11` (mocks the default export — kept);
  `pages/__tests__/headerNowrap.test.ts:14` (scans the table, not the dialog)

**Interfaces:**
- Consumes: `AccountCombobox` (Task 7) with `id`, `display` (`code-full-name`, `name`), `limit`, `valueDisplay`, `placeholder`;
  `openCombobox` / `pickComboOption` (Task 4).
- Produces: GL trigger = `button[role=combobox]#${uiFieldId}-0` named `รหัสบัญชี`; AccountRoles trigger =
  `button[role=combobox]#ar-coa-trigger` named `รหัสบัญชี`.

---

- [ ] **Step 1: Characterization — GL test picks by role (passes on the current picker)**

In `apps/web/src/pages/GeneralLedgerPage.test.tsx` replace

```tsx
    // Select an account — the GL query is gated on accountCode.
    await userEvent.click(screen.getByRole('combobox', { name: 'เลือกบัญชี' }));
    await userEvent.click(await screen.findByText('ลูกหนี้ผ่อนชำระ'));
```

with

```tsx
    // Select an account — the GL query is gated on accountCode. (R2-3a characterization:
    // the page's only combobox, picked by role so it passes before and after AccountCombobox.)
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: /ลูกหนี้ผ่อนชำระ/ }));
```

Run:

```bash
cd apps/web && npx vitest run src/pages/GeneralLedgerPage.test.tsx
```

Expected: PASS — `Tests  3 passed (3)`.

- [ ] **Step 2: Characterization — AccountRoles edit dialog (passes on the current picker)**

Create `apps/web/src/pages/__tests__/AccountRolesPage.test.tsx` with exactly:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiGet = vi.fn();
const apiPut = vi.fn();
vi.mock('@/lib/api', () => ({
  default: {
    get: (...a: unknown[]) => apiGet(...a),
    put: (...a: unknown[]) => apiPut(...a),
  },
  getErrorMessage: () => 'บันทึกไม่สำเร็จ',
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AccountRolesPage from '../AccountRolesPage';

const ROWS = [
  { id: 'rm-1', role: 'payroll_expense', accountCode: '53-1101', accountName: 'เงินเดือน', priority: 1, isActive: true, note: null, required: false },
  { id: 'rm-2', role: 'legacy_role', accountCode: '99-0000', accountName: null, priority: 1, isActive: true, note: null, required: false },
];
const ACCOUNTS = [
  { code: '53-1101', name: 'เงินเดือน' },
  { code: '53-1102', name: 'ประกันสังคม (นายจ้าง)' },
];

beforeEach(() => {
  apiGet.mockReset();
  apiPut.mockReset();
  apiGet.mockImplementation(async (url: string) => {
    if (url === '/settings/role-map') return { data: ROWS };
    // R1 picker: its own flat query · AccountCombobox: the grouped chart (same active accounts)
    if (url === '/chart-of-accounts')
      return { data: ACCOUNTS.map((a, i) => ({ id: `coa-${i}`, status: 'ใช้งาน', ...a })) };
    if (url === '/chart-of-accounts/grouped')
      return {
        data: {
          groups: [
            {
              category: 'OpEx-บุคลากร',
              accounts: ACCOUNTS.map((a) => ({ ...a, normalBalance: 'Dr', vatApplicable: false, notes: null })),
            },
          ],
        },
      };
    throw new Error(`unexpected url ${url}`);
  });
  apiPut.mockResolvedValue({ data: {} });
});

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AccountRolesPage />
    </QueryClientProvider>,
  );
}

// R2-3a characterization — passes on the R1 cmdk picker and on AccountCombobox.
describe('AccountRolesPage — edit dialog account picker', () => {
  it('shows the mapped code, picks another account and PUTs only accountCode', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'แก้ไข payroll_expense' }));
    const picker = await screen.findByRole('combobox', { name: 'รหัสบัญชี' });
    expect(picker).toHaveTextContent('53-1101');
    await user.click(picker);
    await user.click(await screen.findByRole('option', { name: /^ประกันสังคม/ }));
    expect(picker).toHaveTextContent('53-1102');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() =>
      expect(apiPut).toHaveBeenCalledWith('/settings/role-map/rm-1', { accountCode: '53-1102' }),
    );
  });

  it('a mapped code that is not in the chart still shows its code', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'แก้ไข legacy_role' }));
    expect(await screen.findByRole('combobox', { name: 'รหัสบัญชี' })).toHaveTextContent('99-0000');
  });

  it('the first Escape closes only the account menu, the second closes the dialog', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'แก้ไข payroll_expense' }));
    await user.click(await screen.findByRole('combobox', { name: 'รหัสบัญชี' }));
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(apiPut).not.toHaveBeenCalled();
  });
});
```

Run:

```bash
cd apps/web && npx vitest run src/pages/__tests__/AccountRolesPage.test.tsx
```

Expected: PASS — `Tests  3 passed (3)`.

- [ ] **Step 3: Write the failing strict tests**

3a. `apps/web/src/pages/GeneralLedgerPage.test.tsx` — replace

```tsx
import { render, screen, waitFor } from '@testing-library/react';
```

with

```tsx
import { render, screen, waitFor, within } from '@testing-library/react';
```

replace

```tsx
import { MemoryRouter } from 'react-router';
```

with

```tsx
import { MemoryRouter } from 'react-router';
import { openCombobox, pickComboOption } from '@/test/combobox';
```

and append at the end of the file:

```tsx

describe('GeneralLedgerPage — account picker (R2-3a)', () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it('the visible label "รหัสบัญชี" names the picker; picking loads that account', async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/chart-of-accounts/grouped')) {
        return {
          data: {
            groups: [
              {
                category: 'สินทรัพย์หมุนเวียน',
                accounts: [
                  { code: '11-2101', name: 'ลูกหนี้ผ่อนชำระ (HP)', normalBalance: 'Dr', vatApplicable: false, notes: null },
                ],
              },
            ],
          },
        };
      }
      if (url.startsWith('/expenses/ledger/general-ledger')) return { data: null };
      throw new Error(`unexpected url ${url}`);
    });
    renderPage();
    await pickComboOption(userEvent.setup(), 'รหัสบัญชี', '11-2101 ลูกหนี้ผ่อนชำระ (HP)');
    expect(screen.getByRole('combobox', { name: 'รหัสบัญชี' })).toHaveTextContent(
      '11-2101 ลูกหนี้ผ่อนชำระ (HP)',
    );
    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith(
        expect.stringMatching(/^\/expenses\/ledger\/general-ledger\?accountCode=11-2101&/),
      ),
    );
  });

  it('lists code + full chart name and shows at most 200 accounts (as before)', async () => {
    const accounts = Array.from({ length: 205 }, (_, i) => ({
      code: `53-${1000 + i}`,
      name: `ค่าใช้จ่ายทดสอบ ${i} (หมายเหตุ)`,
      normalBalance: 'Dr',
      vatApplicable: false,
      notes: null,
    }));
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/chart-of-accounts/grouped')) {
        return { data: { groups: [{ category: 'ค่าใช้จ่าย', accounts }] } };
      }
      throw new Error(`unexpected url ${url}`);
    });
    renderPage();
    const listbox = await openCombobox(userEvent.setup(), 'รหัสบัญชี');
    const options = await within(listbox).findAllByRole('option');
    expect(options).toHaveLength(200);
    expect(options[0]).toHaveTextContent('53-1000 ค่าใช้จ่ายทดสอบ 0 (หมายเหตุ)');
  });
});
```

3b. `apps/web/src/pages/__tests__/AccountRolesPage.test.tsx` — replace

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
```

with

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pickComboOption } from '@/test/combobox';
```

and append at the end of the file:

```tsx

describe('AccountRolesPage — AccountCombobox (R2-3a)', () => {
  it('finds an account by code, saves it, and no longer runs its own /chart-of-accounts query', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'แก้ไข payroll_expense' }));
    await screen.findByRole('combobox', { name: 'รหัสบัญชี' });
    await pickComboOption(user, 'รหัสบัญชี', 'ประกันสังคม', { search: '53-1102' });
    expect(screen.getByRole('combobox', { name: 'รหัสบัญชี' })).toHaveTextContent(/^53-1102$/);
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() =>
      expect(apiPut).toHaveBeenCalledWith('/settings/role-map/rm-1', { accountCode: '53-1102' }),
    );
    expect(apiGet).not.toHaveBeenCalledWith('/chart-of-accounts', expect.anything());
  });
});
```

Run:

```bash
cd apps/web && npx vitest run src/pages/GeneralLedgerPage.test.tsx src/pages/__tests__/AccountRolesPage.test.tsx
```

Expected: FAIL — `Tests  3 failed | 6 passed (9)`: both new GL tests with
`Unable to find an accessible element with the role "combobox" and name "รหัสบัญชี"`; the new AccountRoles test inside
`pickComboOption` (the menu is not the shared Combobox) or at its last line (`/chart-of-accounts` was called). The 6
characterization tests pass.

- [ ] **Step 4: GeneralLedgerPage → `AccountCombobox`**

In `apps/web/src/pages/GeneralLedgerPage.tsx`:

Replace `import { useId as useUiFieldId, useMemo, useState } from 'react';` with
`import { useId as useUiFieldId, useState } from 'react';`.

Replace

```tsx
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { BookOpen, ChevronsUpDown, Check, Download, FileSpreadsheet } from 'lucide-react';
```

with

```tsx
import { BookOpen, Download, FileSpreadsheet } from 'lucide-react';
```

Replace `import { useCoaGroups } from '@/hooks/useCoa';` with
`import { AccountCombobox } from '@/components/accounting/AccountCombobox';`.

Replace

```tsx
  const [accountCode, setAccountCode] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const { cacheTtlReports } = useUiFlags();
  const reportsStaleTime = cacheTtlReports * 1000;

  // Load CoA groups for the picker
  const coaQ = useCoaGroups({});
  const allAccounts = useMemo(() => {
    const flat: { code: string; name: string; category: string }[] = [];
    for (const g of coaQ.data?.groups ?? []) {
      for (const a of g.accounts) {
        flat.push({ code: a.code, name: a.name, category: g.category });
      }
    }
    return flat;
  }, [coaQ.data]);

  const filteredAccounts = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return allAccounts;
    return allAccounts.filter(
      (a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q),
    );
  }, [pickerSearch, allAccounts]);

  const selectedAccount = useMemo(
    () => allAccounts.find((a) => a.code === accountCode),
    [allAccounts, accountCode],
  );

  const {
```

with

```tsx
  const [accountCode, setAccountCode] = useState('');
  const { cacheTtlReports } = useUiFlags();
  const reportsStaleTime = cacheTtlReports * 1000;

  const {
```

Replace

```tsx
          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            รหัสบัญชี
          </label>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-label="เลือกบัญชี"
                aria-expanded={pickerOpen}
                className="w-full justify-between font-normal"
              >
                {selectedAccount ? (
                  <span className="truncate leading-snug">
                    <span className="font-mono text-xs text-muted-foreground mr-2">
                      {selectedAccount.code}
                    </span>
                    {selectedAccount.name}
                  </span>
                ) : (
                  <span className="text-muted-foreground leading-snug">
                    เลือกบัญชี…
                  </span>
                )}
                <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[380px] p-0" align="start">
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder="ค้นหารหัสหรือชื่อบัญชี…"
                  value={pickerSearch}
                  onValueChange={setPickerSearch}
                />
                <CommandList>
                  <CommandEmpty>ไม่พบบัญชี</CommandEmpty>
                  <CommandGroup>
                    {filteredAccounts.slice(0, 200).map((a) => (
                      <CommandItem
                        key={a.code}
                        value={a.code}
                        onSelect={() => {
                          setAccountCode(a.code);
                          setPickerOpen(false);
                          setPickerSearch('');
                        }}
                      >
                        <Check
                          className={`mr-2 size-4 ${
                            accountCode === a.code ? 'opacity-100' : 'opacity-0'
                          }`}
                        />
                        <span className="font-mono text-xs text-muted-foreground mr-2">
                          {a.code}
                        </span>
                        <span className="leading-snug">{a.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
```

with

```tsx
          <label htmlFor={`${uiFieldId}-0`} className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            รหัสบัญชี
          </label>
          {/* R2-3a — report picker: code + full chart name, first 200 matches (as before) */}
          <AccountCombobox
            id={`${uiFieldId}-0`}
            value={accountCode}
            onChange={setAccountCode}
            display="code-full-name"
            limit={200}
            placeholder="เลือกบัญชี…"
          />
```

(`Button` stays imported — the Excel button uses it; ids `-1`/`-2` are the date fields.)

- [ ] **Step 5: AccountRolesPage → `AccountCombobox`**

In `apps/web/src/pages/AccountRolesPage.tsx`:

Replace `import { Lock, Check, ChevronsUpDown } from 'lucide-react';` with `import { Lock } from 'lucide-react';`.

Replace

```tsx
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { accountDisplayName } from '@/utils/accountName';
```

with

```tsx
import { AccountCombobox } from '@/components/accounting/AccountCombobox';
```

Delete (the blank line after it too)

```tsx
interface ChartOfAccount {
  id: string;
  code: string;
  name: string;
  status: string;
}

```

Replace

```tsx
  const [note, setNote] = useState(row.note ?? '');
  const [coaOpen, setCoaOpen] = useState(false);

  const coaQuery = useQuery<ChartOfAccount[]>({
    queryKey: ['chart-of-accounts', 'active'],
    queryFn: async () =>
      (await api.get<ChartOfAccount[]>('/chart-of-accounts', { params: { status: 'ใช้งาน' } })).data,
    enabled: open,
  });

  const updateMutation
```

with

```tsx
  const [note, setNote] = useState(row.note ?? '');

  const updateMutation
```

Replace

```tsx
            <Popover open={coaOpen} onOpenChange={setCoaOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="ar-coa-trigger"
                  variant="outline"
                  role="combobox"
                  aria-expanded={coaOpen}
                  className="w-full justify-between font-mono"
                >
                  {accountCode || 'เลือกบัญชี...'}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0">
                <Command>
                  <CommandInput placeholder="ค้นหารหัส/ชื่อบัญชี..." />
                  <CommandList>
                    <CommandEmpty>ไม่พบบัญชี</CommandEmpty>
                    <CommandGroup>
                      {(coaQuery.data ?? []).map((acc) => (
                        <CommandItem
                          key={acc.id}
                          value={`${acc.code} ${acc.name}`}
                          onSelect={() => {
                            setAccountCode(acc.code);
                            setCoaOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              'mr-2 h-4 w-4',
                              accountCode === acc.code ? 'opacity-100' : 'opacity-0',
                            )}
                            aria-hidden
                          />
                          <span className="leading-snug">{accountDisplayName(acc.name)}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
```

with

```tsx
            {/* R2-3a — same active accounts as the old /chart-of-accounts?status=ใช้งาน query;
                rows show the name, the trigger the code (as before) */}
            <AccountCombobox
              id="ar-coa-trigger"
              value={accountCode}
              onChange={setAccountCode}
              display="name"
              valueDisplay="code"
              placeholder="เลือกบัญชี..."
            />
```

(`useQuery`, `api`, `Button`, `useState` stay — the page query, the footer buttons and the other fields use them.)

- [ ] **Step 6: Run the tests**

```bash
cd apps/web && npx vitest run src/pages/GeneralLedgerPage.test.tsx src/pages/__tests__/AccountRolesPage.test.tsx src/pages/settings/__tests__/company-access-system-migration.test.tsx src/components/accounting
```

Expected: every file passes — GL `5 passed`, AccountRoles `4 passed`, 0 failed.
(`src/pages/__tests__/headerNowrap.test.ts` still fails on Windows exactly as on `main` — CRLF, Global Constraints — with
no `AccountRolesPage.tsx` case among the failures.)

- [ ] **Step 7: e2e — name the account-role combobox (not executed on Windows; verified by reading)**

In `apps/web/e2e/account-roles-admin.spec.ts` replace

```ts
    const combobox = dialog.getByRole('combobox').first();
```

with

```ts
    const combobox = dialog.getByRole('combobox', { name: 'รหัสบัญชี' });
```

The trigger is not portalled (only its menu is), so it is inside `[role="dialog"]`; the label `htmlFor="ar-coa-trigger"`
names it. The test still only asserts visibility and presses Escape (closes the dialog — the menu is not open). Not
executed on Windows; verified by reading the selector code.

- [ ] **Step 8: Type check + lint**

```bash
bash tools/check-types.sh web
cd apps/web && npx eslint src/pages/GeneralLedgerPage.tsx src/pages/GeneralLedgerPage.test.tsx src/pages/AccountRolesPage.tsx src/pages/__tests__/AccountRolesPage.test.tsx
```

Expected: 0 type errors; ESLint prints nothing.

- [ ] **Step 9: field-scale + GL menu probe + screenshots**

```bash
npm run local:preview
node tools/field-scale/check.mjs --label t8-gl-account-roles --routes account-role-edit,r2-account-role-dialog,r2-general-ledger
node tools/field-scale/check.mjs --compare baseline-r2 t8-gl-account-roles
echo "exit=$?"
```

(Compare against `baseline-r2-peak` instead if the header's PEAK-layout rule made you record it.)

Expected:
- `menu probes: 4 pass · 0 fail` (`account-menu-gl` at 1440 and 390, light/dark) — PASS on `baseline-r2` too (its
  probe is `menu: 'controls'` and the old picker was a portalled Popover), so the compare shows no MENU line and no
  **Fixed** line for it. The probe clicks the first `#main button[role=combobox]`; the `AccountCombobox` trigger is that
  button (`CompanyFilter` is a native `<select>`). If anything placed before it in `#main` becomes a
  `button[role=combobox]`, update `ACCOUNT_MENU_GL.trigger` in `tools/field-scale/routes.mjs` in this task.
- Compare `exit=0`, or `exit=1` where every new P2 line is a clause (a) re-key: on `r2-general-ledger`
  `<prop>@combobox|เลือกบัญชี|0` → `<prop>@combobox|รหัสบัญชี|0` (the label now names the trigger); on `account-role-edit`
  (the menu is open while measuring) the search input `input|ค้นหารหัส/ชื่อบัญชี...|0` →
  `input|ค้นหารหัส หรือ ชื่อบัญชี|0`. The account-role trigger keeps its key `combobox|รหัสบัญชี|0` on `account-role-edit`
  and `r2-account-role-dialog` (menu closed). Findings caused by the old `<Button>` skin (6px corner, hover fill) on the GL
  row and in the account-role dialog should appear under **Fixed**. Anything else must be fixed.
- Screenshots: `r2-general-ledger-{1440,390}-{light,dark}.png` — the account trigger is 44px with the 8px corner like
  the date fields; `r2-general-ledger-1440-light-account-menu-gl.png` — rows `11-xxxx <full name>` under category
  headings, menu as wide as the trigger; `account-role-edit-1440-{light,dark}.png` and
  `r2-account-role-dialog-1440-{light,dark}.png` — the dialog's trigger shows the code, the open menu lists names under
  category headings.

Real-save check (spec §9): on the preview open `/settings/access/account-roles`, `แก้ไข` a non-required row, pick another
account, `บันทึก`; in DevTools Network the `PUT …/settings/role-map/<id>` body is `{ "accountCode": "<picked code>" }`.
If the synthetic preview API does not serve `/settings/role-map` (404), record "not verifiable on the preview — PUT body
proven by `AccountRolesPage.test.tsx`". On `/finance/general-ledger` pick an account and check the
`GET …/expenses/ledger/general-ledger?accountCode=<code>&periodStart=…&periodEnd=…` request (the response may 404 on the
preview — the request URL is what this checks).

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/GeneralLedgerPage.tsx apps/web/src/pages/GeneralLedgerPage.test.tsx \
  apps/web/src/pages/AccountRolesPage.tsx apps/web/src/pages/__tests__/AccountRolesPage.test.tsx \
  apps/web/e2e/account-roles-admin.spec.ts
git commit -F - <<'EOF'
feat(web): general ledger and account-role pickers use AccountCombobox (R2-3a)

The general-ledger picker keeps code + full chart name and its 200-row cap;
its visible label "รหัสบัญชี" now names it. The account-role dialog drops its
own /chart-of-accounts?status=ใช้งาน query (same active accounts as the
grouped chart), keeps the code on the trigger and the PUT unchanged. Both
search Thai-aware and by code. Characterization tests passed on the old
pickers first; the e2e dialog locator now names the combobox.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: one commit. Do not push.

---

### Task 9: `ContactCombobox` → thin shell on `Combobox` (Vendor / RepairCenter / Counterparty wrappers unchanged)

**Why:** Spec §6.4 row "combobox เดิม" and §7 R2-3b. `ContactCombobox` is a bespoke cmdk + Popover picker (`components/contacts/ContactCombobox.tsx`, 226 lines). It is rendered directly by 4 screens (`QuickBuyModal`, `AfterSalesNewPage`, `AssetEntrySection3Vendor`, `StepSupplier`), and through 3 wrappers: `VendorCombobox` (4 call sites), `RepairCenterCombobox` (3) and `CounterpartyPicker` (1). `PurchaseModal` imports only its `ContactPickResult` type.

The task rebuilds it on the shared `Combobox` (Task 4) and keeps its external API, so the wrappers and every caller compile and behave as before. Spec §6.4 says to write characterization tests before the switch. The ones in this task pin every behaviour in facts-comboboxes §3 and spec §6.4:

| Behaviour pinned (old code) | Where in the old code |
|---|---|
| `value` is the display name, and the tick compares names (`value === c.name`, case-sensitive) | `:170` |
| The contacts query has no `enabled`, so the first page loads on mount, not on open | `:70-74` |
| While `ensureRole` runs, the whole list is replaced by `กำลังเพิ่ม...` | `:149-150` |
| The menu closes only on success; on error there is a toast and the menu, search text and rows stay | `:82-92` |
| Enter with no exact (case-insensitive) name match opens create-contact with the typed name | `:140-146` |
| That Enter judges "exact match" against the results of the previous debounced term (300 ms) | — |
| The create row stays visible when the list failed to load | — |
| The TRADE_IN_SELLER create path, and the role-labelled `aria-label` used when there is no `id` | — |

The stale-results Enter behaviour is pinned as it is today. Fixing it would change when Enter decides, and the spec says to keep behaviour.

Four quirks, decided here (owner-safe):

1. **`RepairCenterCombobox` ignores its `value` (a supplier id) — kept.**
   - The list rows are contacts keyed by contact id, so a supplier id cannot match any row without a new API field.
   - All 3 callers pass `displayName` next to `value`, and that is what the trigger and the tick use. Changing this would change nothing that is visible.
   - The new `RepairCenterCombobox.test.tsx` pins it. `RepairCenterCombobox.tsx` is not edited.
2. **`AssetEntrySection3Vendor`'s `<Label htmlFor="vendor-combobox">` points at nothing — fixed** by passing `id="vendor-combobox"`.
   - The accessible name changes from the role fallback `ผู้จัดจำหน่าย` to the visible label `ชื่อผู้ขาย / บริษัท *`. Spec §6.1 says the name is the label.
   - Nothing depends on the old name:
     - `dialogs.audit-spec.ts` `asset-create` only counts unlabelled fields.
     - No web e2e or `fields.audit-spec` case reads that field.
     - `shared-controls.audit-spec.ts:117` on `/assets/new` uses only the custodian field.
     - The unit test's mock is updated in this task.
   - The field, its value and the save path do not change. Screen readers now read the label the user sees. Field-scale re-keys that one control (see Step 12).
3. **`StepSupplier` passes `'กำลังโหลด...'` as the *value* while `suppliers-for-po` loads — fixed, but not through Combobox `loading`.**
   - Combobox `loading` is about the option list. Those options are contacts: their own query, loaded on mount.
   - `suppliersLoading` is the page's supplier list, used to find the chosen supplier's name. Mapping it to `loading` would replace contacts that are already loaded with a loading row, and block picking during an unrelated request.
   - So `StepSupplier` passes `value={selectedSupplier?.name ?? ''}` and `placeholder={suppliersLoading ? 'กำลังโหลด…' : 'เลือก/ค้นหาผู้จัดจำหน่าย'}`. The user sees the same words, now in muted placeholder style, with no `title`. A contact literally named `กำลังโหลด...` can no longer be ticked by accident.
   - `ContactCombobox`'s API is unchanged.
4. **The "ไม่พบผู้ติดต่อที่ตรงกับ "…"" message could never be reached — fixed.**
   - cmdk shows `CommandEmpty` only when no item is mounted, and the create row is an item, so the old message never appeared.
   - The shell passes it as `emptyText`, so it shows above the create row (header Behaviour "Empty text"). It is an information line only; the create row and Enter-to-create do not change.

Conscious copy and behaviour changes:
- **Copy from the Combobox defaults:** the pending text is `กำลังเพิ่ม…` (was `กำลังเพิ่ม...`) and the loading text is `กำลังโหลด…` (was `กำลังโหลด...`).
- **Copy kept:** the error text is still `โหลดข้อมูลไม่สำเร็จ`, and it now has a `ลองใหม่` retry.
- **Search text:** it now resets when the menu closes. Before, Esc kept it, so the menu reopened already filtered.
- **Trigger look:** the trigger is the 44px `formControlClass` button (8px corners, `border-input`) instead of an outline `<Button>` (6px). This is visible at call sites that did not already pass `formControlClass`.
- **`aria-invalid`:** a valid trigger no longer carries `aria-invalid="false"`.

**Files:**
- Modify (full rewrite, current lines 1-226): `apps/web/src/components/contacts/ContactCombobox.tsx`
- Modify (full rewrite, then one edit, current lines 1-134): `apps/web/src/components/contacts/ContactCombobox.test.tsx`
- Create (test): `apps/web/src/pages/after-sales/RepairCenterCombobox.test.tsx`
- Create (test): `apps/web/src/pages/other-income/components/CounterpartyPicker.test.tsx`
- Create (test): `apps/web/src/components/expense-form-v4/VendorCombobox.contact.test.tsx`
- Modify: `apps/web/src/pages/assets/components/AssetEntrySection3Vendor.tsx:87-89` (add `id`)
- Modify: `apps/web/src/pages/assets/__tests__/AssetEntrySection3Vendor.test.tsx:18-42` (the mock honours `id`) and add 1 test before `:84`
- Modify: `apps/web/src/pages/PurchaseOrdersPage/components/wizard/StepSupplier.tsx:121,124`
- Modify: `apps/web/src/pages/PurchaseOrdersPage/components/wizard/StepSupplier.test.tsx:5-7` (the mock exposes props) and append 1 `describe`
- No change (the wrappers keep wrapping `ContactCombobox`, and their props are unchanged):
  - `apps/web/src/components/expense-form-v4/VendorCombobox.tsx`
  - `apps/web/src/pages/after-sales/RepairCenterCombobox.tsx`
  - `apps/web/src/pages/other-income/components/CounterpartyPicker.tsx`
  - the direct callers `components/trade-in/QuickBuyModal.tsx:786`, `pages/AfterSalesNewPage.tsx:465`, `pages/PurchaseOrdersPage/components/PurchaseModal.tsx:7` (type import)
  - every wrapper caller (facts-comboboxes §4)
- Test files run unchanged (they mock or embed these components):
  - `components/expense-form-v4/VendorCombobox.test.tsx`
  - `components/expense-templates/RecurringBillDialog.test.tsx`
  - `components/trade-in/TradeInFlow.test.tsx`
  - `pages/AfterSalesNewPage.test.tsx`
  - `pages/AfterSalesCasePage.test.tsx`
  - `pages/PurchaseOrdersPage/components/PurchaseModal.test.tsx`
  - plus the guard scans `components/ui/field-guards.inventory.test.ts`, `components/ui/native-select.inventory.test.ts` and `pages/__tests__/touchTargets.test.ts` (its anchor `ล้างชื่อผู้ขาย` is still the nearest `<button` in `AssetEntrySection3Vendor.tsx`).

**Interfaces:**
- Consumes:
  - `Combobox`, `type ComboOption` from `@/components/ui/combobox` (Task 4; header contract incl. `closeOnSelect` and the Behaviour list).
  - `pickComboOption` from `@/test/combobox` (Task 4).
  - The global `scrollIntoView` no-op in `apps/web/src/test/setup.ts` (Task 4).
  - `contactsApi.list` / `ensureRole`, `contactKeys.list`, and the types `Contact`, `ContactRole` from `@/lib/api/contacts`.
  - `useDebounce` (300 ms) from `@/hooks/useDebounce`.
- Produces (unchanged):

  ```ts
  export interface ContactPickResult { contactId: string; childId: string; name: string; taxId: string }
  export function ContactCombobox(props: {
    id?: string; className?: string;
    roleNeeded: 'SUPPLIER' | 'CUSTOMER' | 'TRADE_IN_SELLER';
    value: string;                       // display name
    onSelect: (result: ContactPickResult) => void;
    invalid?: boolean; placeholder?: string; // default 'เลือก/ค้นหาผู้ติดต่อ'
  }): JSX.Element;
  ```

  - DOM:
    - Trigger: the Combobox trigger. With `id` it is named by the caller's `<label htmlFor>`; without `id` its name is `ผู้จัดจำหน่าย` / `ลูกค้า` / `คนขายมือสอง`.
    - Search box: placeholder `ค้นหาผู้ติดต่อ / เลขภาษี...`, accessible name `ค้นหาผู้ติดต่อ`.
    - Listbox: `รายชื่อผู้ติดต่อ`.
    - Rows: a lucide `Check` (`opacity-100` when ticked, else `opacity-0`), the name, role badges, and `ข้อมูลไม่ครบ` when the contact has no phone.

---

- [ ] **Step 1: Write the characterization tests (they must pass on today's code)**

Replace the whole of `apps/web/src/components/contacts/ContactCombobox.test.tsx` with the content below. Compared with today's file:
- The 2 existing tests are kept with the same assertions. Only `renderCombo` changed: it now returns `{ onSelect, qc }`.
- The CreateContactModal mock now also exposes `role` and `initialName` through `data-*` attributes.
- `sonner` is mocked.

```tsx
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContactCombobox } from './ContactCombobox';

// jsdom does not implement scrollIntoView; cmdk calls it on CommandItem mount.
// Polyfill here (test-only) so the component can render without throwing.
beforeAll(() => {
  if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => {};
  }
});

const listMock = vi.fn();
const ensureRoleMock = vi.fn();
vi.mock('@/lib/api/contacts', () => ({
  contactsApi: {
    list: (...a: unknown[]) => listMock(...a),
    ensureRole: (...a: unknown[]) => ensureRoleMock(...a),
  },
  contactKeys: {
    all: ['contacts'],
    list: (p: unknown) => ['contacts', 'list', p],
    detail: (id: string) => ['contacts', 'detail', id],
  },
}));

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

// Mock CreateContactModal: when open=true it renders one button that fires onCreated
// with a stub result (simulates a user filling and submitting the form). The data-*
// attributes expose what ContactCombobox passed in.
vi.mock('./CreateContactModal', () => ({
  default: ({
    open,
    role,
    initialName,
    onCreated,
  }: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    role: string;
    initialName?: string;
    onCreated: (r: { contactId: string; childId: string; name: string; taxId: string }) => void;
  }) => {
    if (!open) return null;
    return (
      <button
        data-testid="mock-create-modal-submit"
        data-role={role}
        data-initial-name={initialName}
        onClick={() => onCreated({ contactId: 'ct9', childId: 'sup9', name: 'New Co', taxId: '' })}
      >
        mock-submit
      </button>
    );
  },
}));

type Props = React.ComponentProps<typeof ContactCombobox>;

function renderCombo(props: Partial<Props> = {}, before?: ReactNode) {
  const onSelect = vi.fn();
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      {before}
      <ContactCombobox roleNeeded="SUPPLIER" value="" onSelect={onSelect} {...props} />
    </QueryClientProvider>,
  );
  return { onSelect, qc };
}

const ABC = {
  id: 'c1',
  name: 'ABC Co',
  taxId: '0105500000001',
  phone: '021111111',
  roles: ['CUSTOMER'],
};
const ABC_TWIN = { id: 'c2', name: 'ABC Co', taxId: null, phone: '022222222', roles: ['SUPPLIER'] };
const XYZ = {
  id: 'c3',
  name: 'XYZ Ltd',
  taxId: null,
  phone: null,
  roles: ['SUPPLIER', 'CUSTOMER'],
};
const page = (data: unknown[]) => ({ data, total: data.length, page: 1, limit: 20 });
const MOUNT_KEY = ['contacts', 'list', { search: undefined, isActive: true, limit: 20 }];
const SEARCH_PLACEHOLDER = 'ค้นหาผู้ติดต่อ / เลขภาษี...';

/** The mount-time (empty search) query has landed. */
async function settled(qc: QueryClient) {
  await waitFor(() => expect(qc.getQueryState(MOUNT_KEY)?.status).not.toBe('pending'));
}
const searchBox = () => screen.getByPlaceholderText(SEARCH_PLACEHOLDER);
const checkOf = (row: HTMLElement) => row.querySelector('svg.lucide-check');
const rowsNamed = (name: string) =>
  screen.getAllByRole('option').filter((r) => r.textContent?.startsWith(name));

beforeEach(() => {
  listMock.mockReset();
  ensureRoleMock.mockReset();
  toastMock.error.mockReset();
});

describe('ContactCombobox', () => {
  it('searches all contacts (no role filter) and provisions the role on pick', async () => {
    listMock.mockResolvedValue({
      data: [{ id: 'c1', name: 'ABC Co', taxId: '0105500000001', roles: ['CUSTOMER'] }],
      total: 1,
      page: 1,
      limit: 20,
    });
    ensureRoleMock.mockResolvedValue({
      contactId: 'c1',
      role: 'SUPPLIER',
      supplierId: 'sup1',
      provisioned: true,
    });
    const { onSelect } = renderCombo();

    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.type(screen.getByPlaceholderText(/ค้นหา/), 'ABC');

    const item = await screen.findByText('ABC Co');
    await userEvent.click(item);

    // list was called WITHOUT a role filter
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    expect(listMock.mock.calls.some(([arg]) => (arg as { role?: string }).role === undefined)).toBe(
      true,
    );
    await waitFor(() => expect(ensureRoleMock).toHaveBeenCalledWith('c1', 'SUPPLIER'));
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith({
        contactId: 'c1',
        childId: 'sup1',
        name: 'ABC Co',
        taxId: '0105500000001',
      }),
    );
  });

  it('shows สร้างผู้ติดต่อใหม่ action when search has no matching contacts; clicking it opens modal and onSelect receives created result', async () => {
    // No contacts match the search term
    listMock.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
    const { onSelect } = renderCombo();

    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.type(screen.getByPlaceholderText(/ค้นหา/), 'New Co');

    // The create action item should appear
    const createItem = await screen.findByText(/สร้างผู้ติดต่อใหม่/);
    expect(createItem).toBeDefined();

    // Click the create action — opens the (mocked) modal
    await userEvent.click(createItem);

    // The mock modal renders a submit button; click it to fire onCreated
    const submitBtn = await screen.findByTestId('mock-create-modal-submit');
    await userEvent.click(submitBtn);

    // onSelect should have been called with the shape returned by CreateContactModal
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith({
        contactId: 'ct9',
        childId: 'sup9',
        name: 'New Co',
        taxId: '',
      }),
    );
  });
});

// R2-3b characterization — pinned on the cmdk version BEFORE the Combobox switch (spec §6.4).
// Every test here must pass unchanged on both the old and the new implementation.
describe('ContactCombobox — characterization (R2-3b)', () => {
  it('loads the first 20 active contacts on mount, before the menu is ever opened', async () => {
    listMock.mockResolvedValue(page([ABC]));
    renderCombo();
    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith({ search: undefined, isActive: true, limit: 20 }),
    );
    expect(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('opens straight onto the preloaded rows — no loading state', async () => {
    listMock.mockResolvedValue(page([ABC, XYZ]));
    const user = userEvent.setup();
    const { qc } = renderCombo();
    await settled(qc);

    await user.click(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' }));

    expect(screen.getByRole('option', { name: /^ABC Co/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /^XYZ Ltd/ })).toBeInTheDocument();
    expect(screen.queryByText(/กำลังโหลด/)).toBeNull();
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it('the trigger shows the value text (a display name) with a title, or the placeholder', async () => {
    listMock.mockResolvedValue(page([]));
    renderCombo({ value: 'ABC Co' });
    const trigger = screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' });
    expect(trigger).toHaveTextContent('ABC Co');
    expect(trigger).toContainElement(screen.getByTitle('ABC Co'));
  });

  it('empty value shows the default placeholder "เลือก/ค้นหาผู้ติดต่อ" (or the caller one)', () => {
    listMock.mockResolvedValue(page([]));
    renderCombo();
    expect(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' })).toHaveTextContent(
      'เลือก/ค้นหาผู้ติดต่อ',
    );
  });

  it.each([
    ['SUPPLIER', 'ผู้จัดจำหน่าย'],
    ['CUSTOMER', 'ลูกค้า'],
    ['TRADE_IN_SELLER', 'คนขายมือสอง'],
  ] as const)('without an id the trigger is named by role: %s → %s', (roleNeeded, name) => {
    listMock.mockResolvedValue(page([]));
    renderCombo({ roleNeeded });
    expect(screen.getByRole('combobox', { name })).toHaveAttribute('aria-label', name);
  });

  it('with an id the trigger takes its name from the caller label and sets no aria-label', () => {
    listMock.mockResolvedValue(page([]));
    renderCombo({ id: 'vendor-x' }, <label htmlFor="vendor-x">ผู้ขาย *</label>);
    const trigger = screen.getByRole('combobox', { name: 'ผู้ขาย *' });
    expect(trigger).toHaveAttribute('id', 'vendor-x');
    expect(trigger).not.toHaveAttribute('aria-label');
  });

  it('ticks every row whose NAME equals the value (ids are never compared)', async () => {
    listMock.mockResolvedValue(page([ABC, ABC_TWIN, XYZ]));
    const user = userEvent.setup();
    const { qc } = renderCombo({ value: 'ABC Co' });
    await settled(qc);
    await user.click(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' }));

    const abcRows = rowsNamed('ABC Co');
    expect(abcRows).toHaveLength(2);
    for (const r of abcRows) expect(checkOf(r)).toHaveClass('opacity-100');
    expect(checkOf(rowsNamed('XYZ Ltd')[0])).toHaveClass('opacity-0');
  });

  it('a value that is no contact name (legacy snapshot) shows in the trigger and ticks nothing', async () => {
    listMock.mockResolvedValue(page([ABC, XYZ]));
    const user = userEvent.setup();
    const { qc } = renderCombo({ value: 'ผู้ขายเก่า (ไม่อยู่ในสมุด)' });
    await settled(qc);
    const trigger = screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' });
    expect(trigger).toHaveTextContent('ผู้ขายเก่า (ไม่อยู่ในสมุด)');
    await user.click(trigger);

    const rows = screen.getAllByRole('option');
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(checkOf(r)).toHaveClass('opacity-0');
  });

  it('a row shows one badge per role and "ข้อมูลไม่ครบ" when the contact has no phone', async () => {
    listMock.mockResolvedValue(page([XYZ, ABC]));
    const user = userEvent.setup();
    const { qc } = renderCombo();
    await settled(qc);
    await user.click(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' }));

    const xyz = screen.getByRole('option', { name: /^XYZ Ltd/ });
    expect(within(xyz).getByText('ผู้จัดจำหน่าย')).toBeInTheDocument();
    expect(within(xyz).getByText('ลูกค้า')).toBeInTheDocument();
    expect(within(xyz).getByText('ข้อมูลไม่ครบ')).toBeInTheDocument();
    const abc = screen.getByRole('option', { name: /^ABC Co/ });
    expect(within(abc).queryByText('ข้อมูลไม่ครบ')).toBeNull();
  });

  it('while ensure-role runs the list shows only "กำลังเพิ่ม…" and stays open; it closes and reports on success', async () => {
    listMock.mockResolvedValue(page([ABC, XYZ]));
    let resolveRole!: (v: unknown) => void;
    ensureRoleMock.mockReturnValue(
      new Promise((r) => {
        resolveRole = r;
      }),
    );
    const user = userEvent.setup();
    const { onSelect, qc } = renderCombo();
    await settled(qc);
    const trigger = screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' });
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: /^ABC Co/ }));

    expect(await screen.findByText(/กำลังเพิ่ม/)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^XYZ Ltd/ })).toBeNull();
    expect(searchBox()).toBeInTheDocument(); // menu still open
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(ensureRoleMock).toHaveBeenCalledWith('c1', 'SUPPLIER');
    expect(onSelect).not.toHaveBeenCalled();

    resolveRole({ contactId: 'c1', role: 'SUPPLIER', supplierId: 'sup1', provisioned: true });
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith({
        contactId: 'c1',
        childId: 'sup1',
        name: 'ABC Co',
        taxId: '0105500000001',
      }),
    );
    await waitFor(() => expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).toBeNull());
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it.each([
    ['CUSTOMER', 'ลูกค้า', { customerId: 'cus1' }, 'cus1'],
    ['TRADE_IN_SELLER', 'คนขายมือสอง', {}, 'c1'],
  ] as const)(
    '%s: childId = supplierId ?? customerId ?? contact id',
    async (roleNeeded, name, extra, childId) => {
      listMock.mockResolvedValue(page([ABC]));
      ensureRoleMock.mockResolvedValue({
        contactId: 'c1',
        role: roleNeeded,
        provisioned: true,
        ...extra,
      });
      const user = userEvent.setup();
      const { onSelect, qc } = renderCombo({ roleNeeded });
      await settled(qc);
      await user.click(screen.getByRole('combobox', { name }));
      await user.click(screen.getByRole('option', { name: /^ABC Co/ }));
      await waitFor(() => expect(ensureRoleMock).toHaveBeenCalledWith('c1', roleNeeded));
      await waitFor(() =>
        expect(onSelect).toHaveBeenCalledWith({
          contactId: 'c1',
          childId,
          name: 'ABC Co',
          taxId: '0105500000001',
        }),
      );
    },
  );

  it('when ensure-role fails: toast, the menu stays open with its rows and search text, no pick', async () => {
    listMock.mockImplementation(async ({ search }: { search?: string }) =>
      page(search ? [ABC] : [ABC, XYZ]),
    );
    ensureRoleMock.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    const { onSelect, qc } = renderCombo();
    await settled(qc);
    await user.click(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' }));
    await user.type(searchBox(), 'ABC');
    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ search: 'ABC' })),
    );
    await user.click(await screen.findByRole('option', { name: /^ABC Co/ }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'ไม่สามารถเพิ่มบทบาทให้ผู้ติดต่อได้ กรุณาลองใหม่อีกครั้ง',
      ),
    );
    expect(await screen.findByRole('option', { name: /^ABC Co/ })).toBeInTheDocument();
    expect(searchBox()).toHaveValue('ABC');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each([
    ['SUPPLIER', 'ผู้จัดจำหน่าย', 'SUPPLIER'],
    ['CUSTOMER', 'ลูกค้า', 'CUSTOMER'],
    ['TRADE_IN_SELLER', 'คนขายมือสอง', 'CUSTOMER'],
  ] as const)(
    'Enter with no exact name match opens create-contact (%s → modal role %s) with the typed name',
    async (roleNeeded, name, modalRole) => {
      listMock.mockImplementation(async ({ search }: { search?: string }) =>
        page(search ? [ABC] : []),
      );
      const user = userEvent.setup();
      const { qc } = renderCombo({ roleNeeded });
      await settled(qc);
      await user.click(screen.getByRole('combobox', { name }));
      await user.type(searchBox(), 'AB');
      await screen.findByRole('option', { name: /^ABC Co/ }); // results for "AB" are in
      await user.keyboard('{Enter}');

      const modal = await screen.findByTestId('mock-create-modal-submit');
      expect(modal).toHaveAttribute('data-role', modalRole);
      expect(modal).toHaveAttribute('data-initial-name', 'AB');
      expect(ensureRoleMock).not.toHaveBeenCalled();
    },
  );

  it('Enter when a loaded contact matches the typed name exactly (any case) picks the highlighted row instead', async () => {
    listMock.mockImplementation(async ({ search }: { search?: string }) =>
      page(search ? [ABC, XYZ] : []),
    );
    ensureRoleMock.mockResolvedValue({
      contactId: 'c1',
      role: 'SUPPLIER',
      supplierId: 'sup1',
      provisioned: true,
    });
    const user = userEvent.setup();
    const { onSelect, qc } = renderCombo();
    await settled(qc);
    await user.click(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' }));
    await user.type(searchBox(), 'abc co');
    await screen.findByRole('option', { name: /^ABC Co/ });
    await user.keyboard('{Enter}');

    await waitFor(() => expect(ensureRoleMock).toHaveBeenCalledWith('c1', 'SUPPLIER'));
    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(screen.queryByTestId('mock-create-modal-submit')).toBeNull();
  });

  it('Enter inside the 300 ms debounce judges "exact match" on the previous results — opens create even though the server has that name (pinned, current behaviour)', async () => {
    listMock.mockImplementation(async ({ search }: { search?: string }) =>
      page(search ? [ABC] : [XYZ]),
    );
    const user = userEvent.setup();
    const { qc } = renderCombo();
    await settled(qc);
    await user.click(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' }));
    await user.type(searchBox(), 'ABC Co{Enter}');

    const modal = await screen.findByTestId('mock-create-modal-submit');
    expect(modal).toHaveAttribute('data-initial-name', 'ABC Co');
    expect(ensureRoleMock).not.toHaveBeenCalled();
  });

  it('TRADE_IN_SELLER create: adds the role to the new person, reports childId = contactId', async () => {
    listMock.mockResolvedValue(page([]));
    ensureRoleMock.mockResolvedValue({
      contactId: 'ct9',
      role: 'TRADE_IN_SELLER',
      provisioned: true,
    });
    const user = userEvent.setup();
    const { onSelect, qc } = renderCombo({ roleNeeded: 'TRADE_IN_SELLER' });
    await settled(qc);
    await user.click(screen.getByRole('combobox', { name: 'คนขายมือสอง' }));
    await user.type(searchBox(), 'New Co');
    await user.click(await screen.findByText(/สร้างผู้ติดต่อใหม่/));
    await user.click(await screen.findByTestId('mock-create-modal-submit'));

    await waitFor(() => expect(ensureRoleMock).toHaveBeenCalledWith('ct9', 'TRADE_IN_SELLER'));
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith({
        contactId: 'ct9',
        childId: 'ct9',
        name: 'New Co',
        taxId: '',
      }),
    );
  });

  it('TRADE_IN_SELLER create: when adding the role fails → toast, no pick', async () => {
    listMock.mockResolvedValue(page([]));
    ensureRoleMock.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    const { onSelect, qc } = renderCombo({ roleNeeded: 'TRADE_IN_SELLER' });
    await settled(qc);
    await user.click(screen.getByRole('combobox', { name: 'คนขายมือสอง' }));
    await user.type(searchBox(), 'New Co');
    await user.click(await screen.findByText(/สร้างผู้ติดต่อใหม่/));
    await user.click(await screen.findByTestId('mock-create-modal-submit'));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'ไม่สามารถเพิ่มบทบาทผู้ขายมือสองได้ กรุณาลองใหม่อีกครั้ง',
      ),
    );
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('no contacts and an empty search: the list says "พิมพ์เพื่อค้นหาผู้ติดต่อ"', async () => {
    listMock.mockResolvedValue(page([]));
    const user = userEvent.setup();
    const { qc } = renderCombo();
    await settled(qc);
    await user.click(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' }));
    expect(screen.getByText('พิมพ์เพื่อค้นหาผู้ติดต่อ')).toBeInTheDocument();
  });

  it('a failed load says "โหลดข้อมูลไม่สำเร็จ"', async () => {
    listMock.mockRejectedValue(new Error('down'));
    const user = userEvent.setup();
    const { qc } = renderCombo();
    await settled(qc);
    await user.click(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' }));
    expect(await screen.findByText('โหลดข้อมูลไม่สำเร็จ')).toBeInTheDocument();
  });

  it('even when the search fails, a typed name can still be created (create action stays)', async () => {
    listMock.mockRejectedValue(new Error('down'));
    const user = userEvent.setup();
    const { qc } = renderCombo();
    await settled(qc);
    await user.click(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' }));
    await user.type(searchBox(), 'New Co');
    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ search: 'New Co' })),
    );
    await user.click(await screen.findByText(/สร้างผู้ติดต่อใหม่ "New Co"/));
    expect(await screen.findByTestId('mock-create-modal-submit')).toHaveAttribute(
      'data-initial-name',
      'New Co',
    );
  });
});
```

Create `apps/web/src/pages/after-sales/RepairCenterCombobox.test.tsx`. It renders the real ContactCombobox underneath and mocks only the HTTP edges, so it is also the strict test for the repair-center field:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RepairCenterCombobox } from './RepairCenterCombobox';

// Real ContactCombobox underneath — only the HTTP edges are mocked.
const contacts = vi.hoisted(() => ({ list: vi.fn(), ensureRole: vi.fn() }));
vi.mock('@/lib/api/contacts', () => ({
  contactsApi: contacts,
  contactKeys: {
    all: ['contacts'],
    list: (p: unknown) => ['contacts', 'list', p],
    detail: (id: string) => ['contacts', 'detail', id],
  },
}));
const patch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ default: { patch } }));
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/components/contacts/CreateContactModal', () => ({ default: () => null }));

const ICARE = {
  id: 'ct1',
  name: 'iCare',
  taxId: '0105500000009',
  phone: '020000000',
  roles: ['SUPPLIER'],
};

function renderPicker(props: Partial<React.ComponentProps<typeof RepairCenterCombobox>> = {}) {
  const onSelect = vi.fn();
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <RepairCenterCombobox value="" onSelect={onSelect} {...props} />
    </QueryClientProvider>,
  );
  return { onSelect };
}
const trigger = () => screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' });

beforeEach(() => {
  vi.clearAllMocks();
  contacts.list.mockResolvedValue({ data: [ICARE], total: 1, page: 1, limit: 20 });
  contacts.ensureRole.mockResolvedValue({
    contactId: 'ct1',
    role: 'SUPPLIER',
    supplierId: 'sup-1',
    provisioned: true,
  });
  patch.mockResolvedValue({ data: {} });
});

// R2-3b characterization (wrapper unchanged by the task — pins its external API).
describe('RepairCenterCombobox (R2-3b)', () => {
  it('the trigger shows displayName; the supplier id in `value` is ignored (quirk kept)', () => {
    renderPicker({ value: 'sup-1' });
    expect(trigger()).toHaveTextContent('เลือก/ค้นหาศูนย์ซ่อม');
  });

  it('shows the display name of the current repair center', () => {
    renderPicker({ value: 'sup-1', displayName: 'iCare' });
    expect(trigger()).toHaveTextContent('iCare');
  });

  it('pick → ensure-role SUPPLIER → PATCH repair-center → onSelect({ id: supplierId, name })', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPicker();
    await user.click(trigger());
    await user.click(await screen.findByRole('option', { name: /^iCare/ }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ id: 'sup-1', name: 'iCare' }));
    expect(contacts.ensureRole).toHaveBeenCalledWith('ct1', 'SUPPLIER');
    expect(patch).toHaveBeenCalledWith('/suppliers/sup-1/repair-center');
  });

  it('a failed PATCH still selects, with a toast', async () => {
    patch.mockRejectedValue(new Error('down'));
    const user = userEvent.setup();
    const { onSelect } = renderPicker();
    await user.click(trigger());
    await user.click(await screen.findByRole('option', { name: /^iCare/ }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ id: 'sup-1', name: 'iCare' }));
    expect(toastMock.error).toHaveBeenCalledWith(
      'บันทึกเป็นศูนย์ซ่อมไม่สำเร็จ แต่เลือกผู้จัดจำหน่ายแล้ว',
    );
  });
});
```

Create `apps/web/src/pages/other-income/components/CounterpartyPicker.test.tsx` (real ContactCombobox underneath):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CounterpartyPicker } from './CounterpartyPicker';

// Real ContactCombobox underneath — only the HTTP edges are mocked.
const contacts = vi.hoisted(() => ({ list: vi.fn(), ensureRole: vi.fn(), detail: vi.fn() }));
vi.mock('@/lib/api/contacts', () => ({
  contactsApi: contacts,
  contactKeys: {
    all: ['contacts'],
    list: (p: unknown) => ['contacts', 'list', p],
    detail: (id: string) => ['contacts', 'detail', id],
  },
}));
vi.mock('@/components/contacts/CreateContactModal', () => ({ default: () => null }));

const ABC = {
  id: 'ct1',
  name: 'ABC Co',
  taxId: '0105500000001',
  phone: '021111111',
  roles: ['CUSTOMER'],
};
const EMPTY = { customerId: null, name: '' };

function renderPicker(value: React.ComponentProps<typeof CounterpartyPicker>['value'] = EMPTY) {
  const onChange = vi.fn();
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <CounterpartyPicker value={value} onChange={onChange} />
    </QueryClientProvider>,
  );
  return { onChange };
}
const trigger = () => screen.getByRole('combobox', { name: 'ลูกค้า' });

beforeEach(() => {
  vi.clearAllMocks();
  contacts.list.mockResolvedValue({ data: [ABC], total: 1, page: 1, limit: 20 });
  contacts.ensureRole.mockResolvedValue({
    contactId: 'ct1',
    role: 'CUSTOMER',
    customerId: 'cus-1',
    provisioned: true,
  });
  contacts.detail.mockResolvedValue({ ...ABC, address: '1 ถนนทดสอบ', phone: '021111111' });
});

// R2-3b characterization (wrapper unchanged by the task — pins its external API).
describe('CounterpartyPicker (R2-3b)', () => {
  it('shows value.name, or its placeholder', () => {
    renderPicker();
    expect(trigger()).toHaveTextContent('ค้นหา/สร้างลูกค้า-คู่ค้า');
  });

  it('pick → ensure-role CUSTOMER → detail → onChange with customerId = child id', async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker();
    await user.click(trigger());
    await user.click(await screen.findByRole('option', { name: /^ABC Co/ }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        customerId: 'cus-1',
        name: 'ABC Co',
        taxId: '0105500000001',
        address: '1 ถนนทดสอบ',
        phone: '021111111',
      }),
    );
    expect(contacts.ensureRole).toHaveBeenCalledWith('ct1', 'CUSTOMER');
    expect(contacts.detail).toHaveBeenCalledWith('ct1');
  });

  it('a failed detail lookup still reports the pick (no address/phone)', async () => {
    contacts.detail.mockRejectedValue(new Error('down'));
    const user = userEvent.setup();
    const { onChange } = renderPicker({ customerId: null, name: 'เดิม' });
    expect(trigger()).toHaveTextContent('เดิม');
    await user.click(trigger());
    await user.click(await screen.findByRole('option', { name: /^ABC Co/ }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        customerId: 'cus-1',
        name: 'ABC Co',
        taxId: '0105500000001',
        address: null,
        phone: null,
      }),
    );
  });
});
```

Create `apps/web/src/components/expense-form-v4/VendorCombobox.contact.test.tsx`. This is a separate file because `VendorCombobox.test.tsx` mocks ContactCombobox at file level:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VendorCombobox } from './VendorCombobox';

// VendorCombobox.test.tsx mocks ContactCombobox; this file runs the real one underneath
// (only the HTTP edges are mocked) so the vendor field is covered end to end.
const contacts = vi.hoisted(() => ({ list: vi.fn(), ensureRole: vi.fn(), detail: vi.fn() }));
vi.mock('@/lib/api/contacts', () => ({
  contactsApi: contacts,
  contactKeys: {
    all: ['contacts'],
    list: (p: unknown) => ['contacts', 'list', p],
    detail: (id: string) => ['contacts', 'detail', id],
  },
}));
vi.mock('@/components/contacts/CreateContactModal', () => ({ default: () => null }));

const ABC = { id: 'ct1', name: 'ABC Co', taxId: '0105', phone: '021111111', roles: ['CUSTOMER'] };

beforeEach(() => {
  vi.clearAllMocks();
  contacts.list.mockResolvedValue({ data: [ABC], total: 1, page: 1, limit: 20 });
  contacts.ensureRole.mockResolvedValue({
    contactId: 'ct1',
    role: 'SUPPLIER',
    supplierId: 'sup-1',
    provisioned: true,
  });
  contacts.detail.mockResolvedValue({ ...ABC, suppliers: [{ type: 'JURISTIC', taxId: '9999' }] });
});

describe('VendorCombobox over the real ContactCombobox (R2-3b)', () => {
  it('labelled by its id; pick → ensure-role SUPPLIER → detail → onSelectSupplier', async () => {
    const onSelectSupplier = vi.fn();
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={qc}>
        <label htmlFor="exp-vendor">ผู้ขาย *</label>
        <VendorCombobox id="exp-vendor" value="" onSelectSupplier={onSelectSupplier} />
      </QueryClientProvider>,
    );
    const trigger = screen.getByRole('combobox', { name: 'ผู้ขาย *' });
    expect(trigger).toHaveTextContent('เลือก/ค้นหาผู้ขาย');
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: /^ABC Co/ }));
    await waitFor(() =>
      expect(onSelectSupplier).toHaveBeenCalledWith({
        name: 'ABC Co',
        taxId: '9999',
        supplierId: 'sup-1',
        whtFormType: 'PND53',
      }),
    );
    expect(contacts.ensureRole).toHaveBeenCalledWith('ct1', 'SUPPLIER');
  });
});
```

- [ ] **Step 2: Run the characterization tests on today's code — they must pass**

```bash
cd apps/web && npx vitest run src/components/contacts/ContactCombobox.test.tsx src/pages/after-sales/RepairCenterCombobox.test.tsx src/pages/other-income/components/CounterpartyPicker.test.tsx src/components/expense-form-v4/VendorCombobox.contact.test.tsx
```

Expected: `Test Files  4 passed (4)` and `Tests  35 passed (35)`. That is 27 + 4 + 3 + 1. The ContactCombobox file takes about 8 s, because several tests wait for the real 300 ms debounce. If any test fails, the test is wrong about today's behaviour: fix the test, not the component, before going on.

- [ ] **Step 3: Write the failing tests for the switch and the two consumer fixes**

(a) In `apps/web/src/components/contacts/ContactCombobox.test.tsx` add the helper import.

Old:
```tsx
import { ContactCombobox } from './ContactCombobox';

// jsdom does not implement scrollIntoView; cmdk calls it on CommandItem mount.
```
New:
```tsx
import { ContactCombobox } from './ContactCombobox';
import { pickComboOption } from '@/test/combobox';

// jsdom does not implement scrollIntoView; cmdk calls it on CommandItem mount.
```

Then append a `describe` after the last test of the file.

Old (end of file):
```tsx
    expect(await screen.findByTestId('mock-create-modal-submit')).toHaveAttribute(
      'data-initial-name',
      'New Co',
    );
  });
});
```
New:
```tsx
    expect(await screen.findByTestId('mock-create-modal-submit')).toHaveAttribute(
      'data-initial-name',
      'New Co',
    );
  });
});

// After the switch (R2-3b): the shared Combobox contract and the strict pick path.
describe('ContactCombobox — on the shared Combobox (R2-3b)', () => {
  it('the trigger is the shared Combobox trigger (44px form-control skin, listbox popup)', () => {
    listMock.mockResolvedValue(page([]));
    renderCombo();
    const trigger = screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' });
    expect(trigger).toHaveAttribute('data-slot', 'combobox-trigger');
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger).toHaveClass('rounded-lg', 'border-input', 'bg-background', 'h-11');
  });

  it('pickComboOption: search → pick → ensure-role → onSelect (strict)', async () => {
    listMock.mockImplementation(async ({ search }: { search?: string }) =>
      page(search ? [ABC] : [XYZ]),
    );
    ensureRoleMock.mockResolvedValue({
      contactId: 'c1',
      role: 'SUPPLIER',
      supplierId: 'sup1',
      provisioned: true,
    });
    const user = userEvent.setup();
    const { onSelect, qc } = renderCombo();
    await settled(qc);
    await pickComboOption(user, 'ผู้จัดจำหน่าย', /^ABC Co/, { search: 'ABC' });
    expect(ensureRoleMock).toHaveBeenCalledWith('c1', 'SUPPLIER');
    expect(onSelect).toHaveBeenCalledWith({
      contactId: 'c1',
      childId: 'sup1',
      name: 'ABC Co',
      taxId: '0105500000001',
    });
  });

  it('no match: the "ไม่พบผู้ติดต่อ…" line now shows above the create action (was hidden by cmdk)', async () => {
    listMock.mockResolvedValue(page([]));
    const user = userEvent.setup();
    const { qc } = renderCombo();
    await settled(qc);
    await user.click(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' }));
    await user.type(searchBox(), 'New Co');
    expect(await screen.findByText('ไม่พบผู้ติดต่อที่ตรงกับ "New Co"')).toBeInTheDocument();
    expect(screen.getByText('+ สร้างผู้ติดต่อใหม่ "New Co"')).toBeInTheDocument();
  });
});
```

(b) `apps/web/src/pages/assets/__tests__/AssetEntrySection3Vendor.test.tsx`: make the mock behave like the real component about `id`.

Old:
```tsx
// Mock the shared ContactCombobox so the section can be rendered in JSDOM
// without Radix portal issues. The mock renders a plain combobox button that
// exposes the same role/aria-label as the real component.
vi.mock('@/components/contacts/ContactCombobox', () => ({
  ContactCombobox: ({
    value,
    placeholder,
    invalid,
  }: {
    value: string;
    placeholder?: string;
    invalid?: boolean;
    onSelect: (r: unknown) => void;
    roleNeeded: string;
  }) => (
    <button
      type="button"
      role="combobox"
      aria-label="ผู้ขาย"
      aria-invalid={invalid}
      aria-expanded={false}
    >
```
New:
```tsx
// Mock the shared ContactCombobox so the section can be rendered in JSDOM
// without Radix portal issues. The mock renders a plain combobox button and, like
// the real component, puts `id` on the trigger and drops its fallback aria-label
// when an id is given (the caller's <label htmlFor> names it then).
vi.mock('@/components/contacts/ContactCombobox', () => ({
  ContactCombobox: ({
    id,
    value,
    placeholder,
    invalid,
  }: {
    id?: string;
    value: string;
    placeholder?: string;
    invalid?: boolean;
    onSelect: (r: unknown) => void;
    roleNeeded: string;
  }) => (
    <button
      type="button"
      role="combobox"
      id={id}
      aria-label={id ? undefined : 'ผู้ขาย'}
      aria-invalid={invalid}
      aria-expanded={false}
    >
```

Add one test.

Old:
```tsx
  it('renders the "จำนวนเงินที่จ่าย" partial-payment input', async () => {
```
New:
```tsx
  it('the vendor combobox is named by its visible label "ชื่อผู้ขาย / บริษัท *" (R2-3b: id linked)', async () => {
    renderSection();
    const combobox = await screen.findByRole('combobox', { name: 'ชื่อผู้ขาย / บริษัท *' });
    expect(combobox).toHaveAttribute('id', 'vendor-combobox');
    expect(combobox).not.toHaveAttribute('aria-label');
  });

  it('renders the "จำนวนเงินที่จ่าย" partial-payment input', async () => {
```

(c) `apps/web/src/pages/PurchaseOrdersPage/components/wizard/StepSupplier.test.tsx`: expose the props the step passes.

Old:
```tsx
vi.mock('@/components/contacts/ContactCombobox', () => ({
  ContactCombobox: () => <div data-testid="contact-combobox" />,
}));
```
New:
```tsx
vi.mock('@/components/contacts/ContactCombobox', () => ({
  ContactCombobox: ({ value, placeholder }: { value: string; placeholder?: string }) => (
    <div data-testid="contact-combobox" data-value={value} data-placeholder={placeholder} />
  ),
}));
```

Append a `describe`.

Old (end of file):
```tsx
    fireEvent.click(receive);
    expect(onModeChange).toHaveBeenCalledWith('receive');
  });
});
```
New:
```tsx
    fireEvent.click(receive);
    expect(onModeChange).toHaveBeenCalledWith('receive');
  });
});

describe('StepSupplier — supplier field while the supplier list loads (R2-3b)', () => {
  it('loading shows "กำลังโหลด…" as the placeholder, never as a value', () => {
    renderStep({ suppliersLoading: true });
    const combo = screen.getByTestId('contact-combobox');
    expect(combo).toHaveAttribute('data-value', '');
    expect(combo).toHaveAttribute('data-placeholder', 'กำลังโหลด…');
  });

  it('loaded: the picker placeholder, and the chosen supplier name as the value', () => {
    const { unmount } = renderStep();
    expect(screen.getByTestId('contact-combobox')).toHaveAttribute(
      'data-placeholder',
      'เลือก/ค้นหาผู้จัดจำหน่าย',
    );
    unmount();
    renderStep({
      selectedSupplier: {
        id: 's1',
        name: 'ซัพพลายเออร์ หนึ่ง',
        contactName: null,
        hasVat: false,
        paymentMethods: [],
      },
    });
    expect(screen.getByTestId('contact-combobox')).toHaveAttribute(
      'data-value',
      'ซัพพลายเออร์ หนึ่ง',
    );
  });
});
```

- [ ] **Step 4: Run the new tests and confirm they fail for the right reasons**

```bash
cd apps/web && npx vitest run src/components/contacts/ContactCombobox.test.tsx src/pages/assets/__tests__/AssetEntrySection3Vendor.test.tsx src/pages/PurchaseOrdersPage/components/wizard/StepSupplier.test.tsx
```

Expected: `Tests  5 failed | 38 passed (43)`. The failing tests:
- `the trigger is the shared Combobox trigger …` — `expect(element).toHaveAttribute("data-slot", "combobox-trigger")`. The old trigger is a shadcn `<Button>`.
- `pickComboOption: search → pick → ensure-role → onSelect (strict)` — the helper never finds the shared Combobox menu, because the old menu is a bare `PopoverContent`.
- `no match: the "ไม่พบผู้ติดต่อ…" line …` — `Unable to find an element with the text: ไม่พบผู้ติดต่อที่ตรงกับ "New Co"`.
- `the vendor combobox is named by its visible label …` — `Unable to find role="combobox" and name "ชื่อผู้ขาย / บริษัท *"`.
- `loading shows "กำลังโหลด…" as the placeholder …` — `data-value` is `กำลังโหลด...`, not `''`.

All 27 characterization tests still pass.

- [ ] **Step 5: Rewrite `ContactCombobox` as a shell on `Combobox`**

Replace the whole of `apps/web/src/components/contacts/ContactCombobox.tsx` with:

```tsx
// Reusable PEAK-style contact picker. Searches the party master (สมุดผู้ติดต่อ)
// across ALL roles (server-side, debounced). On pick it calls ensure-role so the
// chosen contact is provisioned into the field's role (e.g. a customer-only
// contact becomes a Supplier) and returns the child id to the parent.
//
// v2 change: free-text one-off path removed. Typed searches with no exact match
// show an inline "+ สร้างผู้ติดต่อใหม่" action that opens CreateContactModal.
// The created contact flows out through the same onSelect callback as a picked one.
//
// R2-3b: a thin shell on the shared <Combobox>. Kept on purpose (pinned by
// ContactCombobox.test.tsx): `value` is the display NAME and a row is ticked when
// its name equals it · the list loads on mount, not on open · a pick keeps the menu
// open with "กำลังเพิ่ม…" until ensure-role succeeds (error = toast, menu stays) ·
// Enter with no exact name match opens create-contact.
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';
import { contactsApi, contactKeys, type Contact, type ContactRole } from '@/lib/api/contacts';
import CreateContactModal from './CreateContactModal';

const ROLE_LABELS: Record<ContactRole, string> = {
  CUSTOMER: 'ลูกค้า',
  SUPPLIER: 'ผู้จัดจำหน่าย',
  TRADE_IN_SELLER: 'คนขายมือสอง',
  FINANCE_COMPANY: 'ไฟแนนซ์',
};

export interface ContactPickResult {
  contactId: string;
  childId: string;
  name: string;
  taxId: string;
}

interface Props {
  id?: string;
  className?: string;
  // TRADE_IN_SELLER: backend adds the role directly to the Contact (no child entity created).
  // For create, ContactCombobox opens CreateContactModal in CUSTOMER mode (creates a person),
  // then calls ensureRole(contactId, 'TRADE_IN_SELLER') afterwards to add the role.
  roleNeeded: 'SUPPLIER' | 'CUSTOMER' | 'TRADE_IN_SELLER';
  value: string;
  onSelect: (result: ContactPickResult) => void;
  invalid?: boolean;
  placeholder?: string;
}

/** The server already matched name / phone / tax id / contact code — keep its rows and order. */
const keepServerRows = (options: ComboOption<Contact>[]) => options;

function ContactRow({ contact, selected }: { contact: Contact; selected: boolean }) {
  return (
    <>
      <Check
        aria-hidden="true"
        className={cn('mr-2 size-4 shrink-0 text-primary!', selected ? 'opacity-100' : 'opacity-0')}
      />
      <span className="flex-1 truncate leading-snug">{contact.name}</span>
      <span className="ml-2 flex shrink-0 gap-1">
        {contact.roles.map((r) => (
          <Badge key={r} variant="secondary" className="text-2xs">
            {ROLE_LABELS[r]}
          </Badge>
        ))}
        {!contact.phone && (
          <Badge variant="outline" className="text-2xs text-muted-foreground">
            ข้อมูลไม่ครบ
          </Badge>
        )}
      </span>
    </>
  );
}

export function ContactCombobox({
  id,
  className,
  roleNeeded,
  value,
  onSelect,
  invalid,
  placeholder = 'เลือก/ค้นหาผู้ติดต่อ',
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const debounced = useDebounce(search);

  // No `enabled`: the first page loads on mount so the menu opens onto rows.
  const query = useQuery({
    queryKey: contactKeys.list({ search: debounced || undefined, isActive: true, limit: 20 }),
    queryFn: () => contactsApi.list({ search: debounced || undefined, isActive: true, limit: 20 }),
    staleTime: 60 * 1000,
  });
  const contacts = query.data?.data ?? [];

  const ensureRoleMutation = useMutation({
    mutationFn: (c: Contact) => contactsApi.ensureRole(c.id, roleNeeded),
    onSuccess: (res, c) => {
      // TRADE_IN_SELLER has no child entity (no supplierId/customerId) — fall back to contactId
      const childId = res.supplierId ?? res.customerId ?? c.id;
      onSelect({ contactId: c.id, childId, name: c.name, taxId: c.taxId ?? '' });
      setOpen(false);
    },
    onError: () => toast.error('ไม่สามารถเพิ่มบทบาทให้ผู้ติดต่อได้ กรุณาลองใหม่อีกครั้ง'),
  });

  const handleCreated = async (r: {
    contactId: string;
    childId: string;
    name: string;
    taxId: string;
  }) => {
    // For TRADE_IN_SELLER, CreateContactModal creates a Customer (a person). We then
    // need to add the TRADE_IN_SELLER role via ensureRole so the trade-in record can
    // reference this contact. childId falls back to contactId (no child entity for this role).
    if (roleNeeded === 'TRADE_IN_SELLER') {
      try {
        await contactsApi.ensureRole(r.contactId, 'TRADE_IN_SELLER');
      } catch {
        toast.error('ไม่สามารถเพิ่มบทบาทผู้ขายมือสองได้ กรุณาลองใหม่อีกครั้ง');
        return;
      }
      onSelect({ contactId: r.contactId, childId: r.contactId, name: r.name, taxId: r.taxId });
    } else {
      onSelect({ contactId: r.contactId, childId: r.childId, name: r.name, taxId: r.taxId });
    }
    setCreateOpen(false);
    setOpen(false);
  };

  // value = display name: the option value is the contact name, so the tick compares names.
  const options: ComboOption<Contact>[] = contacts.map((c) => ({
    value: c.name,
    label: c.name,
    group: 'รายชื่อผู้ติดต่อ',
    meta: c,
  }));
  const term = search.trim();

  return (
    <>
      <Combobox<Contact>
        id={id}
        aria-label={id ? undefined : ROLE_LABELS[roleNeeded]}
        className={className}
        value={value || null}
        selectedOption={value ? { value, label: value } : null}
        options={options}
        filter={keepServerRows}
        onSearchChange={setSearch}
        placeholder={placeholder}
        searchPlaceholder="ค้นหาผู้ติดต่อ / เลขภาษี..."
        searchLabel="ค้นหาผู้ติดต่อ"
        listLabel="รายชื่อผู้ติดต่อ"
        emptyText={term ? `ไม่พบผู้ติดต่อที่ตรงกับ "${term}"` : 'พิมพ์เพื่อค้นหาผู้ติดต่อ'}
        loading={query.isLoading}
        error={query.isError ? 'โหลดข้อมูลไม่สำเร็จ' : false}
        onRetry={() => void query.refetch()}
        onCreate={(t) => {
          setCreateName(t.trim());
          setCreateOpen(true);
        }}
        createLabel={(t) => `+ สร้างผู้ติดต่อใหม่ "${t.trim()}"`}
        createOnEnter
        pending={ensureRoleMutation.isPending}
        closeOnSelect={false}
        invalid={invalid}
        open={open}
        onOpenChange={setOpen}
        onChange={(_name, option) => {
          if (option?.meta) ensureRoleMutation.mutate(option.meta);
        }}
        renderOption={(option, { selected }) =>
          option.meta ? <ContactRow contact={option.meta} selected={selected} /> : option.label
        }
      />

      {/* TRADE_IN_SELLER creates via CUSTOMER modal (an individual person);
          ensureRole adds the TRADE_IN_SELLER role afterwards in handleCreated. */}
      <CreateContactModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        role={roleNeeded === 'SUPPLIER' ? 'SUPPLIER' : 'CUSTOMER'}
        initialName={createName}
        onCreated={handleCreated}
      />
    </>
  );
}
```

Notes for the implementer (they hold for the code above, so do not "fix" them):
- **The old `setSearch('')` calls are gone on purpose.** The Combobox clears its search box when the menu closes and reports `''` through `onSearchChange` (header Behaviour "Search text"). So `search` follows the box, the query falls back to the shared empty-search key, and the next open shows the first page again. `initialName` comes from `createName`, which is captured when create is triggered, so a close that resets the search cannot blank the modal's prefill.
- **The modal's `role` mapping is unchanged:** `SUPPLIER` → `SUPPLIER`; `CUSTOMER` / `TRADE_IN_SELLER` → `CUSTOMER`. The TRADE_IN_SELLER `ensureRole` after create still has no pending UI.
- **`selectedOption` is display-only (header Behaviour "Selected / trigger").** A legacy name, or a caller value such as QuickBuy's free-typed `sellerName`, shows in the trigger and ticks nothing, as before.
- **The trigger skin comes from the Combobox (`formControlClass`).** `className` is still forwarded. `VendorCombobox` passes `formControlClass` again, and that merges as a no-op.

- [ ] **Step 6: The two consumer fixes**

`apps/web/src/pages/assets/components/AssetEntrySection3Vendor.tsx` — link the orphaned label.

Old:
```tsx
          <ContactCombobox
            roleNeeded="SUPPLIER"
            value={supplierName}
```
New:
```tsx
          <ContactCombobox
            id="vendor-combobox"
            roleNeeded="SUPPLIER"
            value={supplierName}
```

`apps/web/src/pages/PurchaseOrdersPage/components/wizard/StepSupplier.tsx` — the loading hint becomes the placeholder.

Old:
```tsx
            value={selectedSupplier?.name ?? (suppliersLoading ? 'กำลังโหลด...' : '')}
            onSelect={onSupplierSelect}
            invalid={!form.supplierId && suppliersError}
            placeholder="เลือก/ค้นหาผู้จัดจำหน่าย"
```
New:
```tsx
            value={selectedSupplier?.name ?? ''}
            onSelect={onSupplierSelect}
            invalid={!form.supplierId && suppliersError}
            placeholder={suppliersLoading ? 'กำลังโหลด…' : 'เลือก/ค้นหาผู้จัดจำหน่าย'}
```

- [ ] **Step 7: Run the task's tests — everything passes**

```bash
cd apps/web && npx vitest run src/components/contacts/ContactCombobox.test.tsx src/pages/after-sales/RepairCenterCombobox.test.tsx src/pages/other-income/components/CounterpartyPicker.test.tsx src/components/expense-form-v4/VendorCombobox.contact.test.tsx src/pages/assets/__tests__/AssetEntrySection3Vendor.test.tsx src/pages/PurchaseOrdersPage/components/wizard/StepSupplier.test.tsx
```

Expected: `Test Files  6 passed (6)` and `Tests  51 passed (51)`, made up of:
- ContactCombobox 30
- RepairCenter 4
- Counterparty 3
- Vendor-contact 1
- AssetEntry 6
- StepSupplier 7

The 27 characterization tests must pass without any edit. If one fails, the shell or Task 4's Combobox differs from the header contract (`closeOnSelect`, Behaviour list). Fix the shell, or raise it with the controller; never edit the characterization test.

- [ ] **Step 8: Run every consumer test file — no regressions**

```bash
cd apps/web && npx vitest run src/components/contacts src/components/expense-form-v4 src/components/expense-templates/RecurringBillDialog.test.tsx src/pages/AfterSalesNewPage.test.tsx src/pages/AfterSalesCasePage.test.tsx src/pages/after-sales src/pages/assets src/pages/other-income src/pages/PurchaseOrdersPage src/pages/ExpenseDocumentNewPage.test.tsx src/pages/ExpensesPage.ux.test.tsx src/pages/ExpenseFavoritesPage.test.tsx src/pages/RecurringBillsPage src/components/ui/field-guards.inventory.test.ts src/components/ui/native-select.inventory.test.ts src/pages/__tests__/touchTargets.test.ts
cd apps/web && npx vitest run src/components/trade-in/TradeInFlow.test.tsx
```

Expected: 0 failed in both runs. `TradeInFlow.test.tsx` runs alone because of the known Windows timeouts under load (header). It mocks `ContactCombobox`, so this change cannot affect it.

What these pin:
- `AfterSalesNewPage.test.tsx:364` finds the default placeholder `เลือก/ค้นหาผู้ติดต่อ` on the real trigger. Its `api.get` mock throws for `/contacts`, so the mount query errors silently, as before.
- The guard scans pass: the shell has no `absolute` menu, no `w-[--x]` and no native `<select>`.

- [ ] **Step 9: e2e and ui-fields audit specs — verified by reading, no edits (not executed on Windows)**

| Spec | Why it still holds |
|---|---|
| `apps/api/e2e/ui-fields/fields.audit-spec.ts:68` | `expenses-create` → `getByRole('combobox',{name:/ผู้ขาย/}).first()`. VendorSection still passes `id={`${fieldId}-1`}`, so the name is still the label `ผู้ขาย *`. The search box (name `ค้นหาผู้ติดต่อ`) exists only while the menu is open, and its name does not contain `ผู้ขาย`. |
| `fields.audit-spec.ts:137-144` | `expenses-create` checks 44px and a label. The new trigger is `button[role=combobox]`, sized 44px by `admin-typography.css`, and labelled as before. |
| `apps/api/e2e/ui-fields/dialogs.audit-spec.ts` | `purchase-wizard`, `expense-settlement`, `expense-accrual`, `asset-create`, `other-income-create` and `other-income-edit` scan `button[role=combobox]` for a name (aria-label, aria-labelledby or labels): every trigger keeps one. `asset-create` now uses its label `ชื่อผู้ขาย / บริษัท *` instead of `aria-label`. The new `id="vendor-combobox"` is unique on `/assets/new`, so `duplicateIds` stays empty. |
| `apps/api/e2e/ui-fields/po-filters.audit-spec.ts:55` | Exact `ผู้จัดจำหน่าย` is the PO-list `FilterSelect` (`POListTab.tsx:498`), not this field. |
| `apps/web/e2e/other-income-override-jv.spec.ts:141-142` | Comment only — the document is created through the API. |
| Loose locators `select, [role="combobox"]).first()` | They are on list pages (`/expenses`, finance, `/trade-in`) where no ContactCombobox renders (facts-comboboxes §2.7). Re-checked with `grep -rn 'role="combobox"' apps/web/e2e`: no loose locator on `/expenses/new`, `/assets/new`, `/after-sales/new` or `/purchase-orders`. |

- [ ] **Step 10: Type check, lint, build**

```bash
bash tools/check-types.sh web
cd apps/web && npx eslint src/components/contacts/ContactCombobox.tsx src/components/contacts/ContactCombobox.test.tsx src/pages/after-sales/RepairCenterCombobox.test.tsx src/pages/other-income/components/CounterpartyPicker.test.tsx src/components/expense-form-v4/VendorCombobox.contact.test.tsx src/pages/assets/components/AssetEntrySection3Vendor.tsx src/pages/assets/__tests__/AssetEntrySection3Vendor.test.tsx src/pages/PurchaseOrdersPage/components/wizard/StepSupplier.tsx src/pages/PurchaseOrdersPage/components/wizard/StepSupplier.test.tsx
npm run build --workspace=apps/web
```

Expected: `Web: OK` · ESLint prints nothing (0 problems) · the build succeeds.

- [ ] **Step 11: Field-scale — run and compare**

1. `npm run local:preview` and wait for `Started http://localhost:5195/inbox`.
2. Run the check:
   ```bash
   node tools/field-scale/check.mjs --label r2-t9-contact --routes expense-new,recurring-bill-dialog,other-income-items,other-income-override,r2-petty-cash-lines,r2-po-wizard-items,r2-asset-new,r2-after-sales-walk-in,r2-settlement-new,r2-trade-in-quick-buy-address
   node tools/field-scale/check.mjs --compare baseline-r2 r2-t9-contact
   echo "exit=$?"
   ```
3. Expected: `exit=0`, `MENU failures (…): 0`, no "Cells rendered … but not in …" and no "fact count fell" section.
   - **Menu probes:** `… pass · 0 fail` — every probe attached to these routes PASSes: `account-menu-items-card`,
     `account-menu-override-jv`, `account-menu-petty-cash`, plus `account-menu-expense-line` / `account-menu-recurring-bill`
     (Task 13) and `po-accessory-model-menu` (Task 12) if those tasks have attached them. This task does not touch those
     triggers. (Compare against `baseline-r2-peak` if the header's PEAK-layout rule made you record it.)
   - **Not re-kinded.** Every converted trigger was already `button[role=combobox]`, so its `kind` stays `combobox`. Its name stays the same (caller label or `aria-label`), so none of the reused Round 1 routes gets re-keyed.
   - **`r2-po-wizard-items` and `r2-asset-new`.** The old outline-`<Button>` trigger (6px corners) sat in a row with 8px fields. Expect `radius@combobox|…` keys under **Fixed** for both routes at 1440 and 1024, together with the matching keys of the row partners. A new F1 key there means the row is still inconsistent: fix it.
   - **Clause (a) re-key, only on `r2-asset-new`.** The vendor control is renamed from `combobox|ผู้จัดจำหน่าย|0` to `combobox|ชื่อผู้ขาย / บริษัท *|0`, because the label is now linked. The expected outcome is that its baseline keys are **Fixed** and no new key appears.

     A new key for `combobox|ชื่อผู้ขาย / บริษัท *|0` is accepted only in two cases. Record the evidence in the task report either way.
     - **Clause (a) pair.** It pairs with a Fixed baseline key `…|F1|<property>@combobox|ผู้จัดจำหน่าย|0` in the same cell (route, width, theme), with identical detail.
     - **Clause (b) membership growth.** A `labelFontSize@` / `labelGap@` key: the label is newly associated, so the control now joins the label checks. Accept this only if the baseline screenshot shows the same label mismatch.
   - **Any other new finding blocks.**
4. Leave the verified preview running (AGENTS.md).

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/components/contacts/ContactCombobox.tsx apps/web/src/components/contacts/ContactCombobox.test.tsx apps/web/src/pages/after-sales/RepairCenterCombobox.test.tsx apps/web/src/pages/other-income/components/CounterpartyPicker.test.tsx apps/web/src/components/expense-form-v4/VendorCombobox.contact.test.tsx apps/web/src/pages/assets/components/AssetEntrySection3Vendor.tsx apps/web/src/pages/assets/__tests__/AssetEntrySection3Vendor.test.tsx apps/web/src/pages/PurchaseOrdersPage/components/wizard/StepSupplier.tsx apps/web/src/pages/PurchaseOrdersPage/components/wizard/StepSupplier.test.tsx
git commit -F - <<'EOF'
refactor(web): ContactCombobox on the shared Combobox (R2-3b)

ContactCombobox (and through it VendorCombobox, RepairCenterCombobox and
CounterpartyPicker) is now a thin shell on <Combobox> with the same props.
Characterization tests written first pin what callers rely on: value is
the display name and the tick compares names, the first page loads on
mount, a pick keeps the menu open with the pending row until ensure-role
succeeds (toast and stay open on error), Enter with no exact name match
opens create-contact (judged on the last debounced results, as before).

Also: the asset vendor label is linked to its field (name = visible
label), StepSupplier shows its loading hint as a placeholder instead of
a fake value, and the "no contact matches" line is now visible above the
create action.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: one commit on `feat/dropdown-search-round2`. Do not push.

---

### Task 10: `EmployeeCombobox` + Bookings `CustomerCombobox` → thin shells; create-customer footer out of `<Command>`

**Why:** This is the second half of spec R2-3b. Both pickers are bespoke cmdk + Popover components.

`EmployeeCombobox` (`components/employees/EmployeeCombobox.tsx`, 128 lines) behaviour to pin:
- `value` is the display name, also for a legacy snapshot.
- The tick compares names (`:105`).
- It fetches only while open (`enabled: open`, `:47`).
- The payroll `period` is in the query key `['employees','pickable', search, period]` (`:45`, `lib/api/employees.ts:75`) and in `GET /employees/pickable` params `{search?, period?}` (`employees.ts:91-96`). Only `PayrollLinesSection.tsx:543-548` passes `period`, so that the people who resigned in that period can still be picked.
- There is no create action; the empty text points to the registry.

Bookings `CustomerCombobox` (`pages/BookingsPage/components/CustomerCombobox.tsx`, 176 lines) behaviour to pin:
- It holds a `CustomerOption` object.
- The trigger is named `ลูกค้า` and shows `name · phone` (or `จากแชท · ยังไม่มีเบอร์`).
- It searches `GET /customers?limit=20&search=<trimmed debounced term>` only while open.
- The clear `X` is a separate button named `ล้างลูกค้า`, rendered only with a value and not when disabled.
- With `canCreate` it has a create button.
- The chosen customer stays when the next search fails.

**Latent bug.** Today the create button sits inside `CommandList`, inside cmdk's `<Command>` (`:133-149`). cmdk's root Enter handler calls `preventDefault()` and selects the highlighted row (facts-core headline 7). So a keyboard user who tabs to `สร้างลูกค้าใหม่` and presses Enter picks the first customer instead. The fix is the Combobox `footer` prop, which renders outside `<Command>`, plus a test that Enter on the footer opens create-customer.

What tests and e2e rely on, all kept unchanged:
- **CreateBookingDialog.test** (8 `combobox` queries, `:196-:296`):
  - trigger named exactly `ลูกค้า`;
  - search placeholder `พิมพ์ชื่อหรือเบอร์โทร`;
  - a `button` named `ล้างลูกค้า`;
  - a create entry with role `button` matching `/สร้างลูกค้าใหม่/`;
  - placeholder text `ค้นหาชื่อหรือเบอร์โทรลูกค้า`;
  - the error text `/โหลดลูกค้าไม่สำเร็จ/`.
- **PayrollLinesSection.test** uses the real EmployeeCombobox through `getAllByRole('combobox').find(el => el.tagName === 'BUTTON')` and the placeholder `/ค้นหาพนักงาน/`.
- **e2e** `bookings.spec.ts:55` and `booking-deposit-convert.spec.ts:47` use `getByRole('combobox', { name: 'ลูกค้า' })`.
- **`fields.audit-spec.ts:137-144`** (`bookings-create`): 44px and a label.

Conscious changes (owner-safe):
- **Copy from the Combobox defaults:** loading is `กำลังโหลด…` (was `กำลังโหลด...` / `กำลังค้นหาลูกค้า...`). The customer error is now the text `โหลดลูกค้าไม่สำเร็จ` plus a `ลองใหม่` button (was one button `โหลดลูกค้าไม่สำเร็จ ลองอีกครั้ง`).
- **Employee error:** keeps `โหลดข้อมูลไม่สำเร็จ` and gains `ลองใหม่`.
- **Search text resets on close:** the customer search used to survive close and reopen, and the employee search survived Esc. The create-customer prefill is captured when the footer is pressed, so it is unaffected.
- **Create footer:** it no longer scrolls with the rows. It stays pinned under the list.
- **Background refetch:** a background refetch of the same customer search keeps showing the rows it already has, without a loading line.
- **Trigger look:** the employee trigger takes the `formControlClass` look (8px corners). The payroll table row is not an F1 row, so no field-scale change is expected there. The booking and appointment triggers already pass a form-control class.

**Files:**
- Modify (full rewrite, current lines 1-128): `apps/web/src/components/employees/EmployeeCombobox.tsx`
- Modify (full rewrite, then one edit, current lines 1-55): `apps/web/src/components/employees/__tests__/EmployeeCombobox.test.tsx`
- Create (test): `apps/web/src/components/employees/__tests__/EmployeeCombobox.request.test.tsx`
- Modify (full rewrite, current lines 1-176): `apps/web/src/pages/BookingsPage/components/CustomerCombobox.tsx`
- Create (test): `apps/web/src/pages/BookingsPage/__tests__/CustomerCombobox.test.tsx`
- No change (props unchanged):
  - callers `components/expense-form-v4/PayrollLinesSection.tsx:543-548`, `pages/BookingsPage/components/CreateBookingDialog.tsx:271-277`, `pages/StoreAppointmentsPage/index.tsx:342-350`
  - tests run unchanged: `components/expense-form-v4/__tests__/PayrollLinesSection.test.tsx` (real EmployeeCombobox), `components/expense-form-v4/__tests__/ExpenseFormV4.payroll.test.tsx` (mocks the default export), `pages/BookingsPage/__tests__/CreateBookingDialog.test.tsx` (real CustomerCombobox), `pages/BookingsPage/__tests__/BookingsPage.test.tsx`, `pages/StoreAppointmentsPage/index.test.tsx` (mocks the default export)

**Interfaces:**
- Consumes:
  - `Combobox`, `type ComboOption` from `@/components/ui/combobox` (Task 4; header Behaviour list — Task 10 does not use `closeOnSelect`).
  - `pickComboOption` from `@/test/combobox`.
  - `employeeKeys.pickable(search, period = '')` and `employeesApi.pickable(search?, period?)`, plus `type PickableEmployee`, from `@/lib/api/employees`.
  - `api` from `@/lib/api`.
  - `CustomerCreateDialog`, `splitDisplayName`, `type CreatedCustomer` from `@/components/customer/CustomerCreateDialog`.
  - `type CustomerOption` from `../types`.
- Produces (unchanged default exports):
  ```ts
  export default function EmployeeCombobox(props: {
    value: string; onSelect: (employee: PickableEmployee) => void;
    invalid?: boolean; placeholder?: string; /* default 'เลือกพนักงาน' */ period?: string;
  }): JSX.Element;
  export default function CustomerCombobox(props: {
    value: CustomerOption | null; onChange: (customer: CustomerOption | null) => void;
    disabled?: boolean; canCreate: boolean; className?: string;
  }): JSX.Element;
  ```
  - EmployeeCombobox DOM: trigger name `พนักงาน`, search placeholder `ค้นหาพนักงาน (ชื่อ / ชื่อเล่น / รหัส)` (name `ค้นหาพนักงาน`), listbox `รายชื่อพนักงาน`.
  - CustomerCombobox DOM:
    - trigger name `ลูกค้า`, placeholder text `ค้นหาชื่อหรือเบอร์โทรลูกค้า…`;
    - search placeholder `พิมพ์ชื่อหรือเบอร์โทร` (name `ค้นหาชื่อหรือเบอร์โทร`, which deliberately does not contain `ลูกค้า`, so Playwright's substring `name: 'ลูกค้า'` can never hit it);
    - clear button `ล้างลูกค้า`;
    - footer button `สร้างลูกค้าใหม่[ “term”]`.

---

- [ ] **Step 1: Write the characterization tests (they must pass on today's code)**

Replace the whole of `apps/web/src/components/employees/__tests__/EmployeeCombobox.test.tsx` with the content below. Compared with today's file:
- The 3 existing tests keep their assertions.
- The module mock now keeps the real `employeeKeys`, whose key carries `period` (the old mock dropped it).
- `pickable` is reached through `vi.mocked`.

```tsx
import type { ReactElement } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EmployeeCombobox from '../EmployeeCombobox';
import { employeesApi, type PickableEmployee } from '@/lib/api/employees';

// Real employeeKeys (the cache key carries the payroll period); only the request is mocked.
vi.mock('@/lib/api/employees', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/employees')>()),
  employeesApi: { pickable: vi.fn() },
}));
const pickable = vi.mocked(employeesApi.pickable);

const wrap = (ui: ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  return {
    qc,
    rerender: (next: ReactElement) =>
      view.rerender(<QueryClientProvider client={qc}>{next}</QueryClientProvider>),
  };
};

const EMP: PickableEmployee = {
  userId: 'u1',
  employeeId: 'EMP-001',
  name: 'สมชาย ใจดี',
  nickname: 'ชาย',
  baseSalary: '15000',
  ssoEligible: true,
};
const EMP2: PickableEmployee = {
  userId: 'u2',
  employeeId: null,
  name: 'สมหญิง ดีใจ',
  nickname: null,
  baseSalary: null,
  ssoEligible: false,
};
const trigger = () => screen.getByRole('combobox', { name: 'พนักงาน' });
const searchBox = () => screen.getByPlaceholderText('ค้นหาพนักงาน (ชื่อ / ชื่อเล่น / รหัส)');
const checkOf = (row: HTMLElement) => row.querySelector('svg.lucide-check');

beforeEach(() => {
  pickable.mockReset();
});

describe('EmployeeCombobox', () => {
  it('searches and selects an employee (returns the full pickable record)', async () => {
    pickable.mockResolvedValue([EMP]);
    const onSelect = vi.fn();
    const user = userEvent.setup();
    wrap(<EmployeeCombobox value="" onSelect={onSelect} />);

    await user.click(screen.getByRole('combobox'));
    await user.type(screen.getByPlaceholderText(/ค้นหาพนักงาน/), 'สมชาย');
    await waitFor(() => expect(screen.getByText('สมชาย ใจดี')).toBeInTheDocument());
    await user.click(screen.getByText('สมชาย ใจดี'));
    expect(onSelect).toHaveBeenCalledWith(EMP);
  });

  it('shows a registry hint when no employee matches — and NO create action', async () => {
    pickable.mockResolvedValue([]);
    const user = userEvent.setup();
    wrap(<EmployeeCombobox value="" onSelect={vi.fn()} />);

    await user.click(screen.getByRole('combobox'));
    await user.type(screen.getByPlaceholderText(/ค้นหาพนักงาน/), 'ไม่มีคนนี้');
    await waitFor(() => expect(screen.getByText(/เพิ่มที่หน้าทะเบียนพนักงาน/)).toBeInTheDocument());
    expect(screen.queryByText(/สร้างใหม่/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\+ สร้าง/)).not.toBeInTheDocument();
  });

  it('shows the current value as the trigger label (legacy snapshot display)', () => {
    wrap(<EmployeeCombobox value="พนักงานเก่า" onSelect={vi.fn()} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('พนักงานเก่า');
  });
});

// R2-3b characterization — pinned on the cmdk version BEFORE the Combobox switch (spec §6.4).
describe('EmployeeCombobox — characterization (R2-3b)', () => {
  it('fetches only while open; the payroll period is in the request and in the cache key', async () => {
    pickable.mockResolvedValue([EMP]);
    const user = userEvent.setup();
    const { qc } = wrap(<EmployeeCombobox value="" onSelect={vi.fn()} period="2026-10" />);
    expect(pickable).not.toHaveBeenCalled();

    await user.click(trigger());
    await waitFor(() => expect(pickable).toHaveBeenCalledWith(undefined, '2026-10'));
    expect(
      qc.getQueryCache().find({ queryKey: ['employees', 'pickable', '', '2026-10'], exact: true }),
    ).toBeDefined();

    await user.type(searchBox(), 'สมชาย');
    await waitFor(() => expect(pickable).toHaveBeenCalledWith('สมชาย', '2026-10'));
    expect(
      qc
        .getQueryCache()
        .find({ queryKey: ['employees', 'pickable', 'สมชาย', '2026-10'], exact: true }),
    ).toBeDefined();
  });

  it('a different period is a different query (people who resigned during that period)', async () => {
    pickable.mockResolvedValue([EMP]);
    const user = userEvent.setup();
    const { rerender } = wrap(<EmployeeCombobox value="" onSelect={vi.fn()} period="2026-10" />);
    await user.click(trigger());
    await waitFor(() => expect(pickable).toHaveBeenCalledWith(undefined, '2026-10'));

    rerender(<EmployeeCombobox value="" onSelect={vi.fn()} period="2026-11" />);
    await waitFor(() => expect(pickable).toHaveBeenCalledWith(undefined, '2026-11'));
  });

  it('without a period the request carries none', async () => {
    pickable.mockResolvedValue([EMP]);
    const user = userEvent.setup();
    wrap(<EmployeeCombobox value="" onSelect={vi.fn()} />);
    await user.click(trigger());
    await waitFor(() => expect(pickable).toHaveBeenCalledWith(undefined, undefined));
  });

  it('ticks the row whose NAME equals the value; a legacy snapshot name ticks none', async () => {
    pickable.mockResolvedValue([EMP, EMP2]);
    const user = userEvent.setup();
    wrap(<EmployeeCombobox value="สมชาย ใจดี" onSelect={vi.fn()} />);
    await user.click(trigger());
    const somchai = await screen.findByRole('option', { name: /^สมชาย ใจดี/ });
    expect(checkOf(somchai)).toHaveClass('opacity-100');
    expect(checkOf(screen.getByRole('option', { name: /^สมหญิง ดีใจ/ }))).toHaveClass('opacity-0');
  });

  it('a legacy snapshot value ticks nothing', async () => {
    pickable.mockResolvedValue([EMP, EMP2]);
    const user = userEvent.setup();
    wrap(<EmployeeCombobox value="พนักงานเก่า" onSelect={vi.fn()} />);
    await user.click(trigger());
    await screen.findByRole('option', { name: /^สมชาย ใจดี/ });
    for (const r of screen.getAllByRole('option')) expect(checkOf(r)).toHaveClass('opacity-0');
  });

  it('a row shows the nickname and the employee code', async () => {
    pickable.mockResolvedValue([EMP]);
    const user = userEvent.setup();
    wrap(<EmployeeCombobox value="" onSelect={vi.fn()} />);
    await user.click(trigger());
    const row = await screen.findByRole('option', { name: /^สมชาย ใจดี/ });
    expect(within(row).getByText('ชาย')).toBeInTheDocument();
    expect(within(row).getByText('EMP-001')).toBeInTheDocument();
  });

  it('empty search with no employees says "พิมพ์เพื่อค้นหาพนักงาน"', async () => {
    pickable.mockResolvedValue([]);
    const user = userEvent.setup();
    wrap(<EmployeeCombobox value="" onSelect={vi.fn()} />);
    await user.click(trigger());
    expect(await screen.findByText('พิมพ์เพื่อค้นหาพนักงาน')).toBeInTheDocument();
  });

  it('a failed load says "โหลดข้อมูลไม่สำเร็จ"', async () => {
    pickable.mockRejectedValue(new Error('down'));
    const user = userEvent.setup();
    wrap(<EmployeeCombobox value="" onSelect={vi.fn()} />);
    await user.click(trigger());
    expect(await screen.findByText('โหลดข้อมูลไม่สำเร็จ')).toBeInTheDocument();
  });

  it('a pick closes the menu at once (no async step) and the next open starts with an empty search', async () => {
    pickable.mockResolvedValue([EMP]);
    const onSelect = vi.fn();
    const user = userEvent.setup();
    wrap(<EmployeeCombobox value="" onSelect={onSelect} />);
    await user.click(trigger());
    await user.type(searchBox(), 'สมชาย');
    await user.click(await screen.findByRole('option', { name: /^สมชาย ใจดี/ }));
    expect(onSelect).toHaveBeenCalledWith(EMP);
    await waitFor(() => expect(screen.queryByRole('option')).toBeNull());
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger());
    expect(searchBox()).toHaveValue('');
  });

  it('empty value shows the placeholder "เลือกพนักงาน" (or the caller one)', () => {
    wrap(<EmployeeCombobox value="" onSelect={vi.fn()} />);
    expect(trigger()).toHaveTextContent('เลือกพนักงาน');
  });
});
```

Create `apps/web/src/components/employees/__tests__/EmployeeCombobox.request.test.tsx`. It uses the real `employeesApi` and mocks only the HTTP client, so it pins the `/employees/pickable` params:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EmployeeCombobox from '../EmployeeCombobox';

// Real employeesApi + employeeKeys; only the HTTP client is mocked → pins GET /employees/pickable params.
const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ default: { get } }));

const EMP = {
  userId: 'u1',
  employeeId: 'EMP-001',
  name: 'สมชาย ใจดี',
  nickname: 'ชาย',
  baseSalary: '15000',
  ssoEligible: true,
};

function renderCombo(period?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <EmployeeCombobox value="" onSelect={vi.fn()} period={period} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ data: [EMP] });
});

describe('EmployeeCombobox — GET /employees/pickable (R2-3b characterization)', () => {
  it('sends { period } on open and { search, period } after typing', async () => {
    const user = userEvent.setup();
    renderCombo('2026-10');
    expect(get).not.toHaveBeenCalled();
    await user.click(screen.getByRole('combobox', { name: 'พนักงาน' }));
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith('/employees/pickable', { params: { period: '2026-10' } }),
    );
    await user.type(screen.getByPlaceholderText(/ค้นหาพนักงาน/), 'สม');
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith('/employees/pickable', {
        params: { search: 'สม', period: '2026-10' },
      }),
    );
  });

  it('sends no period param when the payroll period is not given', async () => {
    const user = userEvent.setup();
    renderCombo();
    await user.click(screen.getByRole('combobox', { name: 'พนักงาน' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/employees/pickable', { params: {} }));
  });
});
```

Create `apps/web/src/pages/BookingsPage/__tests__/CustomerCombobox.test.tsx`:

```tsx
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CustomerCombobox from '../components/CustomerCombobox';
import type { CustomerOption } from '../types';

const mocks = vi.hoisted(() => ({ get: vi.fn(), rows: [] as unknown[], fail: false }));
vi.mock('@/lib/api', () => ({ default: { get: mocks.get } }));
vi.mock('@/components/customer/CustomerCreateDialog', () => ({
  default: ({
    open,
    initialValues,
    onCreated,
  }: {
    open: boolean;
    initialValues?: { firstName?: string; lastName?: string };
    onCreated: (c: { id: string; name: string; phone?: string | null }) => void;
  }) =>
    open ? (
      <div data-testid="create-customer-dialog">
        <output data-testid="create-initial">{JSON.stringify(initialValues ?? null)}</output>
        <button
          type="button"
          onClick={() =>
            onCreated({ id: 'c-new', name: 'ลูกค้าใหม่', phone: '0899999999', extra: 1 } as never)
          }
        >
          บันทึกลูกค้าใหม่ (จำลอง)
        </button>
      </div>
    ) : null,
  splitDisplayName: (s: string) => {
    const [firstName = '', ...rest] = s.trim().split(/\s+/);
    return { firstName, lastName: rest.join(' ') };
  },
}));

const SOMCHAI: CustomerOption = { id: 'c1', name: 'สมชาย ใจดี', phone: '0812345678' };
const LEAD: CustomerOption = {
  id: 'c2',
  name: 'ผู้สนใจจากแชท',
  phone: null,
  chatPlaceholder: true,
};
const url = (search: string) => `/customers?${new URLSearchParams({ limit: '20', search })}`;

function Harness(props: {
  initial?: CustomerOption | null;
  canCreate?: boolean;
  disabled?: boolean;
  onChange: (c: CustomerOption | null) => void;
}) {
  const [value, setValue] = useState<CustomerOption | null>(props.initial ?? null);
  return (
    <CustomerCombobox
      value={value}
      onChange={(c) => {
        setValue(c);
        props.onChange(c);
      }}
      canCreate={props.canCreate ?? true}
      disabled={props.disabled}
    />
  );
}

function renderCombo(props: Partial<Omit<Parameters<typeof Harness>[0], 'onChange'>> = {}) {
  const onChange = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Harness {...props} onChange={onChange} />
    </QueryClientProvider>,
  );
  return { onChange };
}

const trigger = () => screen.getByRole('combobox', { name: 'ลูกค้า' });
const searchBox = () => screen.getByPlaceholderText('พิมพ์ชื่อหรือเบอร์โทร');

beforeEach(() => {
  mocks.rows = [SOMCHAI, LEAD];
  mocks.fail = false;
  mocks.get.mockReset();
  mocks.get.mockImplementation(async () => {
    if (mocks.fail) throw new Error('ค้นหาล้ม');
    return { data: { data: mocks.rows } };
  });
});

// R2-3b characterization — pinned on the cmdk version BEFORE the Combobox switch (spec §6.4).
describe('Bookings CustomerCombobox — characterization (R2-3b)', () => {
  it('the trigger is named "ลูกค้า" and shows the placeholder when empty', () => {
    renderCombo();
    expect(trigger()).toHaveTextContent('ค้นหาชื่อหรือเบอร์โทรลูกค้า…');
  });

  it('a value shows its name and " · phone" (a chat lead: "จากแชท · ยังไม่มีเบอร์")', () => {
    renderCombo({ initial: SOMCHAI });
    expect(trigger()).toHaveTextContent('สมชาย ใจดี · 0812345678');
  });

  it('a chat lead value says it has no phone yet', () => {
    renderCombo({ initial: LEAD });
    expect(trigger()).toHaveTextContent('ผู้สนใจจากแชท · จากแชท · ยังไม่มีเบอร์');
  });

  it('searches only while open: GET /customers?limit=20&search= then the debounced, trimmed term', async () => {
    const user = userEvent.setup();
    renderCombo();
    expect(mocks.get).not.toHaveBeenCalled();
    await user.click(trigger());
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith(url('')));
    await user.type(searchBox(), '  สม ');
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith(url('สม')));
  });

  it('rows show the name and a second line (phone, or the chat-lead note)', async () => {
    const user = userEvent.setup();
    renderCombo();
    await user.click(trigger());
    const somchai = await screen.findByRole('option', { name: /^สมชาย ใจดี/ });
    expect(within(somchai).getByText('0812345678')).toBeInTheDocument();
    const lead = screen.getByRole('option', { name: /^ผู้สนใจจากแชท/ });
    expect(within(lead).getByText('จากแชท · ยังไม่มีเบอร์')).toBeInTheDocument();
  });

  it('a pick hands the whole option up (chatPlaceholder kept) and closes the menu', async () => {
    const user = userEvent.setup();
    const { onChange } = renderCombo();
    await user.click(trigger());
    await user.click(await screen.findByRole('option', { name: /^ผู้สนใจจากแชท/ }));
    expect(onChange).toHaveBeenCalledWith(LEAD);
    await waitFor(() => expect(screen.queryByPlaceholderText('พิมพ์ชื่อหรือเบอร์โทร')).toBeNull());
    expect(trigger()).toHaveTextContent('ผู้สนใจจากแชท · จากแชท · ยังไม่มีเบอร์');
  });

  it('no result says "ไม่พบลูกค้า — พิมพ์ชื่อหรือเบอร์ให้ครบขึ้น"', async () => {
    mocks.rows = [];
    const user = userEvent.setup();
    renderCombo();
    await user.click(trigger());
    expect(
      await screen.findByText('ไม่พบลูกค้า — พิมพ์ชื่อหรือเบอร์ให้ครบขึ้น'),
    ).toBeInTheDocument();
  });

  it('shows a loading message while the search runs', async () => {
    let release!: () => void;
    mocks.get.mockImplementation(
      () =>
        new Promise((r) => {
          release = () => r({ data: { data: [SOMCHAI] } });
        }),
    );
    const user = userEvent.setup();
    renderCombo();
    await user.click(trigger());
    expect(await screen.findByText(/กำลังค้นหาลูกค้า|กำลังโหลด/)).toBeInTheDocument();
    release();
    expect(await screen.findByRole('option', { name: /^สมชาย ใจดี/ })).toBeInTheDocument();
  });

  it('a failed search says "โหลดลูกค้าไม่สำเร็จ" and offers a retry that asks again', async () => {
    mocks.fail = true;
    const user = userEvent.setup();
    renderCombo();
    await user.click(trigger());
    expect(await screen.findByText(/โหลดลูกค้าไม่สำเร็จ/)).toBeInTheDocument();
    const calls = mocks.get.mock.calls.length;
    await user.click(screen.getByRole('button', { name: /ลองอีกครั้ง|ลองใหม่/ }));
    await waitFor(() => expect(mocks.get.mock.calls.length).toBeGreaterThan(calls));
  });

  it('the chosen customer stays in the trigger when the next search fails', async () => {
    mocks.fail = true;
    const user = userEvent.setup();
    renderCombo({ initial: SOMCHAI });
    await user.click(trigger());
    await user.type(searchBox(), 'x');
    expect(await screen.findByText(/โหลดลูกค้าไม่สำเร็จ/)).toBeInTheDocument();
    expect(trigger()).toHaveTextContent('สมชาย ใจดี');
  });

  it('clear is a separate "ล้างลูกค้า" button: onChange(null), the menu stays closed', async () => {
    const user = userEvent.setup();
    const { onChange } = renderCombo({ initial: SOMCHAI });
    await user.click(screen.getByRole('button', { name: 'ล้างลูกค้า' }));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).toHaveTextContent('ค้นหาชื่อหรือเบอร์โทรลูกค้า…');
    expect(screen.queryByRole('button', { name: 'ล้างลูกค้า' })).toBeNull();
  });

  it('disabled: the trigger is disabled and there is no clear button', () => {
    renderCombo({ initial: SOMCHAI, disabled: true });
    expect(trigger()).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'ล้างลูกค้า' })).toBeNull();
  });

  it('canCreate: a create BUTTON (not an option) carries the typed name and opens create-customer with it', async () => {
    const user = userEvent.setup();
    const { onChange } = renderCombo();
    await user.click(trigger());
    expect(screen.getByRole('button', { name: 'สร้างลูกค้าใหม่' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /สร้างลูกค้าใหม่/ })).toBeNull();
    await user.type(searchBox(), 'สมศรี มีสุข');
    await user.click(screen.getByRole('button', { name: 'สร้างลูกค้าใหม่ “สมศรี มีสุข”' }));

    await waitFor(() => expect(screen.queryByPlaceholderText('พิมพ์ชื่อหรือเบอร์โทร')).toBeNull());
    expect(screen.getByTestId('create-initial')).toHaveTextContent(
      JSON.stringify({ firstName: 'สมศรี', lastName: 'มีสุข' }),
    );
    await user.click(screen.getByRole('button', { name: 'บันทึกลูกค้าใหม่ (จำลอง)' }));
    expect(onChange).toHaveBeenCalledWith({ id: 'c-new', name: 'ลูกค้าใหม่', phone: '0899999999' });
    expect(screen.queryByTestId('create-customer-dialog')).toBeNull();
    expect(trigger()).toHaveTextContent('ลูกค้าใหม่ · 0899999999');
  });

  it('create with an empty search opens create-customer with no initial values', async () => {
    const user = userEvent.setup();
    renderCombo();
    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'สร้างลูกค้าใหม่' }));
    expect(await screen.findByTestId('create-initial')).toHaveTextContent('null');
  });

  it('canCreate=false: no create button', async () => {
    const user = userEvent.setup();
    renderCombo({ canCreate: false });
    await user.click(trigger());
    await screen.findByRole('option', { name: /^สมชาย ใจดี/ });
    expect(screen.queryByRole('button', { name: /สร้างลูกค้าใหม่/ })).toBeNull();
  });
});
```

- [ ] **Step 2: Run them on today's code — they must pass**

```bash
cd apps/web && npx vitest run src/components/employees/__tests__/EmployeeCombobox.test.tsx src/components/employees/__tests__/EmployeeCombobox.request.test.tsx src/pages/BookingsPage/__tests__/CustomerCombobox.test.tsx
```

Expected: `Test Files  3 passed (3)` and `Tests  30 passed (30)`, i.e. 13 + 2 + 15. A failure means the test is wrong about today's behaviour: fix the test, not the component.

- [ ] **Step 3: Write the failing tests — the footer bug and the strict pick tests**

(a) `apps/web/src/components/employees/__tests__/EmployeeCombobox.test.tsx` — add the helper import.

Old:
```tsx
import { employeesApi, type PickableEmployee } from '@/lib/api/employees';
```
New:
```tsx
import { employeesApi, type PickableEmployee } from '@/lib/api/employees';
import { pickComboOption } from '@/test/combobox';
```

Append a `describe`.

Old (end of file):
```tsx
  it('empty value shows the placeholder "เลือกพนักงาน" (or the caller one)', () => {
    wrap(<EmployeeCombobox value="" onSelect={vi.fn()} />);
    expect(trigger()).toHaveTextContent('เลือกพนักงาน');
  });
});
```
New:
```tsx
  it('empty value shows the placeholder "เลือกพนักงาน" (or the caller one)', () => {
    wrap(<EmployeeCombobox value="" onSelect={vi.fn()} />);
    expect(trigger()).toHaveTextContent('เลือกพนักงาน');
  });
});

describe('EmployeeCombobox — on the shared Combobox (R2-3b)', () => {
  it('pickComboOption: search → pick → onSelect(full record) (strict)', async () => {
    pickable.mockImplementation(async (search?: string) => (search ? [EMP] : [EMP2]));
    const onSelect = vi.fn();
    const user = userEvent.setup();
    wrap(<EmployeeCombobox value="" onSelect={onSelect} period="2026-10" />);
    await pickComboOption(user, 'พนักงาน', /^สมชาย ใจดี/, { search: 'สมชาย' });
    expect(onSelect).toHaveBeenCalledWith(EMP);
    expect(pickable).toHaveBeenCalledWith('สมชาย', '2026-10');
    expect(trigger()).toHaveAttribute('data-slot', 'combobox-trigger');
  });
});
```

(b) `apps/web/src/pages/BookingsPage/__tests__/CustomerCombobox.test.tsx` — add the helper import.

Old:
```tsx
import type { CustomerOption } from '../types';
```
New:
```tsx
import type { CustomerOption } from '../types';
import { pickComboOption } from '@/test/combobox';
```

Append the bug test and the strict pick test.

Old (end of file):
```tsx
    expect(screen.queryByRole('button', { name: /สร้างลูกค้าใหม่/ })).toBeNull();
  });
});
```
New:
```tsx
    expect(screen.queryByRole('button', { name: /สร้างลูกค้าใหม่/ })).toBeNull();
  });
});

// R2-3b latent bug: the create button sat inside cmdk's <Command>, whose Enter handler picks
// the highlighted row instead of pressing the focused button. Fails before the switch.
describe('Bookings CustomerCombobox — create footer (R2-3b fix)', () => {
  it('Enter on the focused "สร้างลูกค้าใหม่" button opens create-customer and picks no row', async () => {
    const user = userEvent.setup();
    const { onChange } = renderCombo();
    await user.click(trigger());
    await screen.findByRole('option', { name: /^สมชาย ใจดี/ });
    const create = screen.getByRole('button', { name: 'สร้างลูกค้าใหม่' });
    // the Combobox footer box draws the top border and padding — no second box inside it
    expect(create.parentElement).toHaveAttribute('data-slot', 'combobox-footer');
    create.focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByTestId('create-customer-dialog')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Bookings CustomerCombobox — on the shared Combobox (R2-3b)', () => {
  it('pickComboOption: search → pick → onChange(option) (strict)', async () => {
    mocks.get.mockImplementation(async (path: string) => ({
      data: { data: path === url('สม') ? [SOMCHAI] : [LEAD] },
    }));
    const user = userEvent.setup();
    const { onChange } = renderCombo();
    await pickComboOption(user, 'ลูกค้า', /^สมชาย ใจดี/, { search: 'สม' });
    expect(onChange).toHaveBeenCalledWith(SOMCHAI);
    expect(mocks.get).toHaveBeenCalledWith(url('สม'));
    expect(trigger()).toHaveAttribute('data-slot', 'combobox-trigger');
  });
});
```

The strict tests make the server's answer depend on the search term. The row to pick only appears after the debounced request, so `pickComboOption` cannot click a row from the unfiltered first page.

- [ ] **Step 4: Run them and confirm the failures**

```bash
cd apps/web && npx vitest run src/components/employees/__tests__/EmployeeCombobox.test.tsx src/components/employees/__tests__/EmployeeCombobox.request.test.tsx src/pages/BookingsPage/__tests__/CustomerCombobox.test.tsx
```

Expected: `Tests  3 failed | 30 passed (33)`. The failing tests:
- `Enter on the focused "สร้างลูกค้าใหม่" button …` — `expect(element).toHaveAttribute("data-slot", "combobox-footer")`: today the button's box is a plain `div` inside `CommandList`, so this structural check fails first. Without that line the test fails at `Unable to find an element by: [data-testid="create-customer-dialog"]`. This is the bug: cmdk picked `สมชาย ใจดี` instead.
- Both `pickComboOption … (strict)` tests — the helper never finds the shared Combobox menu.

- [ ] **Step 5: Rewrite `EmployeeCombobox` as a shell**

Replace the whole of `apps/web/src/components/employees/EmployeeCombobox.tsx` with:

```tsx
// Payroll employee picker. Searches the payroll registry (active employees only,
// server-side, debounced) via GET /employees/pickable. NO inline-create —
// employees are Users provisioned at /employees first (spec §3.2). On pick it
// hands the full PickableEmployee to the parent, which sets userId + pre-fills
// base salary / SSO. `value` is the display name (shows legacy snapshot too).
//
// R2-3b: a thin shell on the shared <Combobox>. Kept on purpose (pinned by
// __tests__/EmployeeCombobox*.test.tsx): fetches only while open · the payroll
// `period` is part of the cache key and the request · a row is ticked when its
// name equals `value`.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';
import { employeeKeys, employeesApi, type PickableEmployee } from '@/lib/api/employees';

interface Props {
  value: string; // current display name (picked or legacy snapshot)
  onSelect: (employee: PickableEmployee) => void;
  invalid?: boolean;
  placeholder?: string;
  /** งวดใบเงินเดือน (YYYY-MM) — ให้เลือกคนที่ลาออกระหว่างงวดนั้นได้ */
  period?: string;
}

/** The server already matched name / nickname / employee code — keep its rows and order. */
const keepServerRows = (options: ComboOption<PickableEmployee>[]) => options;

function EmployeeRow({ employee, selected }: { employee: PickableEmployee; selected: boolean }) {
  return (
    <>
      <Check
        aria-hidden="true"
        className={cn('mr-2 size-4 shrink-0 text-primary!', selected ? 'opacity-100' : 'opacity-0')}
      />
      <span className="flex-1 truncate leading-snug">{employee.name}</span>
      {employee.nickname && (
        <span className="ml-2 shrink-0 text-xs text-muted-foreground">{employee.nickname}</span>
      )}
      {employee.employeeId && (
        <Badge variant="secondary" className="ml-2 text-2xs">
          {employee.employeeId}
        </Badge>
      )}
    </>
  );
}

export default function EmployeeCombobox({
  value,
  onSelect,
  invalid,
  placeholder = 'เลือกพนักงาน',
  period,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search);

  const query = useQuery({
    queryKey: employeeKeys.pickable(debounced || '', period),
    queryFn: () => employeesApi.pickable(debounced || undefined, period),
    enabled: open,
    staleTime: 60 * 1000,
  });
  const employees = query.data ?? [];

  // value = display name: the option value is the employee name, so the tick compares names.
  const options: ComboOption<PickableEmployee>[] = employees.map((e) => ({
    value: e.name,
    label: e.name,
    group: 'พนักงาน',
    meta: e,
  }));
  const term = search.trim();

  return (
    <Combobox<PickableEmployee>
      aria-label="พนักงาน"
      value={value || null}
      selectedOption={value ? { value, label: value } : null}
      options={options}
      filter={keepServerRows}
      onSearchChange={setSearch}
      placeholder={placeholder}
      searchPlaceholder="ค้นหาพนักงาน (ชื่อ / ชื่อเล่น / รหัส)"
      searchLabel="ค้นหาพนักงาน"
      listLabel="รายชื่อพนักงาน"
      emptyText={
        term ? `ไม่พบพนักงาน "${term}" — เพิ่มที่หน้าทะเบียนพนักงาน` : 'พิมพ์เพื่อค้นหาพนักงาน'
      }
      loading={query.isLoading}
      error={query.isError ? 'โหลดข้อมูลไม่สำเร็จ' : false}
      onRetry={() => void query.refetch()}
      invalid={invalid}
      open={open}
      onOpenChange={setOpen}
      onChange={(_name, option) => {
        if (option?.meta) onSelect(option.meta);
      }}
      renderOption={(option, { selected }) =>
        option.meta ? <EmployeeRow employee={option.meta} selected={selected} /> : option.label
      }
    />
  );
}
```

- [ ] **Step 6: Rewrite the Bookings `CustomerCombobox` as a shell, with the create button as `footer`**

Replace the whole of `apps/web/src/pages/BookingsPage/components/CustomerCombobox.tsx` with:

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import CustomerCreateDialog, {
  splitDisplayName,
  type CreatedCustomer,
} from '@/components/customer/CustomerCreateDialog';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { useDebounce } from '@/hooks/useDebounce';
import api from '@/lib/api';
import type { CustomerOption } from '../types';

/**
 * ค้นหา + เลือกลูกค้าในช่องเดียว (เดิมเป็น Input ค้นหา + Select แยกกัน) · ไม่ส่ง `view` ให้ /customers
 * เพราะใบจองต้องเลือกได้ทั้งลูกค้าและผู้สนใจ (ด่านเบอร์อยู่ฝั่ง API) · ลูกค้าที่เลือกไว้คงอยู่แม้การค้นหาครั้งถัดไปล้ม
 *
 * R2-3b: เปลือกบางบน <Combobox> — ปุ่ม "สร้างลูกค้าใหม่" เป็น `footer` นอก <Command> (เดิมอยู่ใน
 * CommandList ⇒ กด Enter บนปุ่มแล้วไปเลือกแถวที่ไฮไลต์แทน) · ปุ่มล้าง "ล้างลูกค้า" แยกจากช่อง
 */
const describeCustomer = (c: CustomerOption) =>
  c.chatPlaceholder ? 'จากแชท · ยังไม่มีเบอร์' : c.phone ? c.phone : '';

const toOption = (c: CustomerOption): ComboOption<CustomerOption> => ({
  value: c.id,
  label: c.name,
  meta: c,
});

/** The server already matched name / phone — keep its rows and order. */
const keepServerRows = (options: ComboOption<CustomerOption>[]) => options;

function CustomerText({ customer, row }: { customer: CustomerOption; row?: boolean }) {
  const note = describeCustomer(customer);
  if (row) {
    return (
      <span className="flex min-w-0 flex-col leading-snug">
        <span className="truncate font-medium">{customer.name}</span>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </span>
    );
  }
  return (
    <span className="truncate">
      <span className="font-medium">{customer.name}</span>
      {note && <span className="text-muted-foreground"> · {note}</span>}
    </span>
  );
}

export default function CustomerCombobox({
  value,
  onChange,
  disabled,
  canCreate,
  className,
}: {
  value: CustomerOption | null;
  onChange: (customer: CustomerOption | null) => void;
  disabled?: boolean;
  canCreate: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createSeed, setCreateSeed] = useState('');
  const term = useDebounce(search.trim());
  const {
    data: options = [],
    isFetching,
    isError,
    refetch,
  } = useQuery<CustomerOption[]>({
    queryKey: ['booking-customer-search', term],
    enabled: open,
    queryFn: async () => {
      const { data } = await api.get(
        `/customers?${new URLSearchParams({ limit: '20', search: term })}`,
      );
      return (data.data ?? data ?? []) as CustomerOption[];
    },
  });

  const typed = search.trim();
  const footer = canCreate ? (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="w-full justify-start"
      onClick={() => {
        setCreateSeed(typed);
        setOpen(false);
        setCreateOpen(true);
      }}
    >
      <Plus aria-hidden="true" className="size-3.5" /> สร้างลูกค้าใหม่
      {typed ? ` “${typed}”` : ''}
    </Button>
  ) : undefined;

  return (
    <>
      <Combobox<CustomerOption>
        aria-label="ลูกค้า"
        className={className}
        wrapperClassName="min-w-0"
        value={value?.id ?? null}
        selectedOption={value ? toOption(value) : null}
        options={options.map(toOption)}
        filter={keepServerRows}
        onSearchChange={setSearch}
        placeholder="ค้นหาชื่อหรือเบอร์โทรลูกค้า…"
        searchPlaceholder="พิมพ์ชื่อหรือเบอร์โทร"
        searchLabel="ค้นหาชื่อหรือเบอร์โทร"
        listLabel="รายชื่อลูกค้า"
        emptyText="ไม่พบลูกค้า — พิมพ์ชื่อหรือเบอร์ให้ครบขึ้น"
        // background refetch keeps showing the rows it already has
        loading={isFetching && options.length === 0}
        error={isError ? 'โหลดลูกค้าไม่สำเร็จ' : false}
        onRetry={() => void refetch()}
        clearable={!disabled}
        clearLabel="ล้างลูกค้า"
        disabled={disabled}
        footer={footer}
        open={open}
        onOpenChange={setOpen}
        onChange={(_id, option) => onChange(option?.meta ?? null)}
        renderValue={(option) =>
          option.meta ? <CustomerText customer={option.meta} /> : option.label
        }
        renderOption={(option) =>
          option.meta ? <CustomerText customer={option.meta} row /> : option.label
        }
      />
      <CustomerCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialValues={createSeed ? splitDisplayName(createSeed) : undefined}
        onCreated={(created: CreatedCustomer) => {
          onChange({ id: created.id, name: created.name, phone: created.phone ?? null });
          setCreateOpen(false);
        }}
      />
    </>
  );
}
```

Notes for the implementer (they hold for the code above, so do not "fix" them):
- **Combobox keys.** `value` is the customer id, which is unique. The selected `CustomerOption` travels as `selectedOption.meta`, so the trigger keeps the chosen customer when the next search fails. This is what the old component's comment promised.
- **The footer is a real `<Button>` passed through `footer`.** The Combobox renders it outside `<Command>`, so Enter and Space press the button. The test name `/สร้างลูกค้าใหม่/` keeps role `button`.
- **`createSeed` is captured at click time.** Closing the menu resets the search through `onSearchChange('')`, so the dialog could not read `search` afterwards.
- **Clear button.** `clearable={!disabled}` mirrors the old `value && !disabled`; the Combobox also hides the clear button while `value` is empty (header Behaviour "Clear button"). `onChange('', null)` → `onChange(null)`.
- **No tick by design.** `renderOption` has no tick, as before. A selected row that appears in the results is only highlighted when the menu opens.
- **`wrapperClassName="min-w-0"`** keeps the old wrapper's shrink inside the dialog grid.

- [ ] **Step 7: Run the task's tests — everything passes**

```bash
cd apps/web && npx vitest run src/components/employees/__tests__/EmployeeCombobox.test.tsx src/components/employees/__tests__/EmployeeCombobox.request.test.tsx src/pages/BookingsPage/__tests__/CustomerCombobox.test.tsx
```

Expected: `Test Files  3 passed (3)` and `Tests  33 passed (33)`, i.e. 14 + 2 + 17. The 25 characterization tests must pass without edits.

- [ ] **Step 8: Run every consumer test file — no regressions**

```bash
cd apps/web && npx vitest run src/pages/BookingsPage src/pages/StoreAppointmentsPage src/components/expense-form-v4 src/pages/ExpenseDocumentNewPage.test.tsx src/pages/ExpensesPage.ux.test.tsx src/components/ui/field-guards.inventory.test.ts src/components/ui/native-select.inventory.test.ts
```

Expected: 0 failed.
- **`CreateBookingDialog.test.tsx` passes unchanged**, with all 8 `combobox` queries:
  - `:196-204` pick, clear, then create through the footer button `/สร้างลูกค้าใหม่/` and the mocked dialog;
  - `:207-214` the trigger keeps `สมชาย ใจดี` when the search fails (`/โหลดลูกค้าไม่สำเร็จ/`);
  - `:286-300` after close and reopen the trigger shows `ค้นหาชื่อหรือเบอร์โทรลูกค้า…`, which contains the asserted `ค้นหาชื่อหรือเบอร์โทรลูกค้า`;
  - `:154` the POST body still has `customerId: 'c1'`.
- **`PayrollLinesSection.test.tsx` passes with the real EmployeeCombobox.** The trigger is still the only `<button role=combobox>` in the section. After it opens, the search input is also `role=combobox`, but its tag is `INPUT`, so the test's lookup ignores it. The row text `สมชาย ใจดี` is a single element. The base-salary and SSO prefill flows through `onSelect(PickableEmployee)` exactly as before.

- [ ] **Step 9: e2e and ui-fields audit specs — verified by reading, no edits (not executed on Windows)**

| Spec | Why it still holds |
|---|---|
| `apps/web/e2e/bookings.spec.ts:55` | `getByRole('combobox', { name: 'ลูกค้า' })` (substring, case-insensitive) matches the trigger's `aria-label="ลูกค้า"`. The other comboboxes in the create dialog are `สาขา` and, only while the menu is open, the search box `ค้นหาชื่อหรือเบอร์โทร` — no `ลูกค้า` substring, so strict mode keeps one match. |
| `apps/web/e2e/flows/booking-deposit-convert.spec.ts:47` | Same locator and reasoning (OWNER). |
| `apps/api/e2e/ui-fields/fields.audit-spec.ts:24,137-144` | `bookings-create` is a `fullSizeForms` case. The trigger is `button[role=combobox]`: 44px through `admin-typography.css`, label `ลูกค้า` from `aria-label`, width ≥ 140 at ≤ 390 (`w-full`, with no clear button when empty). |
| `apps/api/e2e/ui-fields/dialogs.audit-spec.ts:34` | `expense-payroll` keeps the label `aria-label="พนักงาน"` on the payroll trigger. |
| Loose `select, [role="combobox"]).first()` locators | They are on `/expenses` (list), finance, reports, stock, template-editor, trade-in and admin-settings. None of them renders EmployeeCombobox or the booking CustomerCombobox (grep `apps/web/e2e` for `/bookings`, `/appointments`, `type=PR`: only the two locators above). |

- [ ] **Step 10: Type check, lint, full unit suite, build**

```bash
bash tools/check-types.sh web
cd apps/web && npx eslint src/components/employees/EmployeeCombobox.tsx src/components/employees/__tests__/EmployeeCombobox.test.tsx src/components/employees/__tests__/EmployeeCombobox.request.test.tsx src/pages/BookingsPage/components/CustomerCombobox.tsx src/pages/BookingsPage/__tests__/CustomerCombobox.test.tsx
npm run test --workspace=apps/web
npm run build --workspace=apps/web
```

Expected:
- `Web: OK`, and ESLint prints nothing.
- The full suite has 0 failures, except the Windows-only ones listed in the header: `headerNowrap`, `tabsButtonRowsNowrap` and `RecordPaymentWizard.preview-params` (CRLF regexes), and `TradeInFlow` / `ProductsPage` timeouts under load. Re-run those alone to confirm they pass.
- The build succeeds.
- The PR body (R2-3b = Tasks 9 + 10) states what ran on Windows, and that `local:check` must run on Linux/CI.

- [ ] **Step 11: Field-scale — run and compare**

1. `npm run local:preview` and wait for `Started http://localhost:5195/inbox`.
2. Run the check:
   ```bash
   node tools/field-scale/check.mjs --label r2-t10-employee-customer --routes payroll-new,r2-booking-create,r2-store-appointments
   node tools/field-scale/check.mjs --compare baseline-r2 r2-t10-employee-customer
   echo "exit=$?"
   ```
3. Expected: `exit=0` with 0 new and, normally, 0 fixed.
   - **Menu probe:** `menu probes: 4 pass · 0 fail` — `booking-customer-menu` on `r2-booking-create` at 1440 and 390,
     light/dark (PASS on `baseline-r2` too; the trigger keeps the name `ลูกค้า` and Radix's `aria-controls`).
   - **No re-keys.** Every trigger keeps `kind` `combobox` and its name (`พนักงาน`, `ลูกค้า`).
   - **`payroll-new`.** The EmployeeCombobox sits in a table cell, so its row is not an F1 row (the common ancestor is a table row, layout `other`).
   - **Booking and appointment triggers.** They keep the class their callers pass (`formControlClass` / `appointmentControlClass`).
   - **New finding.** Any new finding, a lost cell or a fact drop blocks. Fix the shell or Task 4's wrapper; never the baseline.
4. Leave the verified preview running.

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/components/employees/EmployeeCombobox.tsx apps/web/src/components/employees/__tests__/EmployeeCombobox.test.tsx apps/web/src/components/employees/__tests__/EmployeeCombobox.request.test.tsx apps/web/src/pages/BookingsPage/components/CustomerCombobox.tsx apps/web/src/pages/BookingsPage/__tests__/CustomerCombobox.test.tsx
git commit -F - <<'EOF'
refactor(web): EmployeeCombobox + booking CustomerCombobox on Combobox (R2-3b)

Both pickers are now thin shells on <Combobox> with the same props.
Characterization tests written first pin: employee value is the display
name (tick by name), fetch only while open, the payroll period in the
cache key and in GET /employees/pickable; booking customer trigger named
"ลูกค้า" with name · phone, GET /customers?limit=20&search=<term> only
while open, the separate "ล้างลูกค้า" clear button, the chosen customer
kept when the next search fails.

Fix: the "สร้างลูกค้าใหม่" button moves out of cmdk's <Command> into the
Combobox footer — Enter on it used to pick the highlighted customer
instead of opening create-customer.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: one commit. Do not push.

---

### Task 11: Staff fields (9) — appendix ค R2-4a

**Why:** Appendix ค rows R2-4a list 9 staff pickers in chat, todos, collections and the prospect list. Each holds up to ~40 people, so each one becomes the searchable `Combobox` (spec §6.4, §6.5, §7 R2-4a). Every field gets a strict test (open → pick → assert the request or state). Values sent to the API and every `onChange` effect stay the same.

In seven places the spec text and the code disagree. Each time we **follow the code**:

- **ChannelFilter (spec: "sentinel ALL/FREE → `''` ภายใน แต่แปลงกลับ")**: `'__all__'` / `'__free__'` were only Radix item values. They existed because a Radix item cannot hold `''`. The values that go upward are already the `WhoFilter` strings `'all'` / `'free'` (ChannelFilter.tsx:30, :246-251), and `room-query.ts` maps them to request params. `Combobox` accepts any string, so the options use `'all'` / `'free'` / staff ids directly. Nothing is converted back, and `FREE` is deleted. `ALL` stays because the channel radios use it.
  - An owner that is not in the list: the old code added an extra list row `ผู้ดูแลที่เลือก`. That becomes `selectedOption`.
  - The trigger text stays `ownerLabel(...)` (the signed-in user shows as "คุณ"), through `renderValue`.
  - The field stays disabled in the "ของฉัน" tab.
- **ChatFollowUpDialog / ChatServiceRequestDialog (spec §6.5: "native required only → add `if (!value) setError…` + invalid + message")**: both submit buttons are already disabled while `!assignee` (ChatFollowUpDialog.tsx:274-282, ChatServiceRequestDialog.tsx:289-292). The form therefore never submits without an assignee, and the native `required` popup never fired. In ChatServiceRequestDialog the retry path also sits inside a disabled `<fieldset>`, which takes it out of validation.
  - A new guard and error line would never run, so we add neither. The disabled-button gate stays, and `required` now only sets `aria-required` (spec §6.3).
  - The existing load-error alerts ("โหลดผู้รับงานไม่ได้" + "ลองใหม่") stay where they are.
- **ChatServiceRequestCard (spec: "ผู้รับเดิมอาจไม่อยู่ในรายการ → selectedOption")**: the current assignee is not a fallback row. It is **always** the first row (ChatServiceRequestCard.tsx:220-222), and the staff list filters it out.
  - Picking it again means "keep": the PATCH sends `assigneeId` only when it differs (:74-76).
  - `selectedOption` only shows a value that is *not* in the list. After the user picks someone else, they could no longer pick the old assignee back.
  - So the row stays as `options[0]`, exactly as in the old list, and `selectedOption` is not used here.
- **FacebookCommentPanel**: the former-assignee row (`ผู้รับเดิม · ต้องตรวจสิทธิ์`, only when the id is not in the list) becomes `selectedOption`, as the spec says.
  - The field still saves on pick (spec §6.5). It never saves on open or search: `onChange` only fires on pick.
  - Re-picking the row that is already selected is a no-op, because the native select fired no change event for it.
- **TodoFilters**: `Combobox` has no `leadingIcon`. The user icon moves inside the trigger through `renderValue`: `px-3` + 16 px icon + `gap-3` puts the text at 40 px, the same as `NativeSelect`'s `pl-10`. No hand-placed icon goes back outside the trigger, which is what Round 1 Task 5 removed.
  - A `<button>` is as wide as its current text, while the native select was as wide as its longest option. So the wrapper gets a fixed `sm:w-56` (224 px). Below `sm` it stays `w-full`.
  - An `?assigneeId` outside the list: the native select showed its first row "ผู้รับมอบหมายทั้งหมด". `placeholder` keeps that text, without the icon. Picking "ผู้รับมอบหมายทั้งหมด" now really clears the filter (the native select fired no change for a row that already looked selected).
- **TodoForm**: editing a todo whose assignee is not in the list is the normal case for every non-OWNER role, because `GET /users` is OWNER-only. The native select showed "ไม่ระบุ" while still sending the id. The trigger now shows the saved `editing.assignee` name through `selectedOption`, and the id is still sent unchanged. With no saved name, `placeholder="ไม่ระบุ"` keeps today's text.
- **ProspectFilterBar**: `FilterSelect` is shared by the four sibling prospect filters, `CustomerFilterBar` and `BookingFilterBar`, which are all short lists. Only the owner call site converts.
  - `FilterSelect`'s `ALL` sentinel maps to `''`, which is the `owner` URL value for "ทุกคน", so the `Combobox` uses `''` directly.
  - The group "พนักงาน" becomes `group: 'พนักงาน'` on the staff options.
  - A re-pick of the current owner is ignored at the call site: `setFilters` → `write()` always drops `page` (and the
    legacy keys, `useCustomersQuery.ts:184-190, 211-219`), and the Radix `FilterSelect` fired no `onValueChange` for a
    re-pick, so re-picking must not jump back to page 1 (header Behaviour "Pick").
  - The inline `maxWidth: 130px` becomes `max-w-[130px]` on the trigger. The list keeps `min-w-64` (256 px): portalled and collision-aware, it stays inside the 390 px sheet (trigger at x≈24, list ends at ≈280).

Staff lists from `GET /users` stay OWNER-only (TodosPage, ProspectFilterBar, StuckContracts), unchanged. Lists that are empty while they load (ChatFollowUpDialog, ChatServiceRequestDialog, StuckContractsSection) pass `loading`, so an opened menu says `กำลังโหลด…` instead of `ไม่พบรายการ`.

**Labels (style A, spec §4.3 ค + §9):** spec §4.3 (ค) counts every form whose field round 2 converts as a style A form, and §9 forbids mixing label styles inside one form. So:

- **The three inbox `<form>`s** (ChatFollowUpDialog, ChatServiceRequestDialog, the ChatServiceRequestCard edit form): every wrapping `<label>` becomes `<div><label htmlFor className={formLabelClass}>…</label><control id …/></div>`. Their fields move from the local `field` string (6 px corners, `mt-1`) to `formControlClass` / `formTextareaClass` / bare `NativeSelect`, so the converted `Combobox` (8 px, `formControlClass`) matches its neighbours. In ChatServiceRequestDialog the assignee and the due date share a grid row at ≥640, and they keep one corner and one label gap (no new F1).
- **FacebookCommentPanel** is not one form: only the assignee row is relabelled. The reply/reconcile mini-forms are untouched.
- **ChannelFilter and StuckContractsSection** already have one `<label htmlFor>`; its class becomes `formLabelClass`.
- **TodoForm** is already style A (Round 1 Task 11).
- **TodoFilters and ProspectFilterBar** are filter bars with no visible label. They keep `aria-label` (§4.3: filter bars unchanged).

Every trigger is named only by its label. The component sets no `aria-label` of its own.

**Files:**
- Modify `apps/web/src/pages/UnifiedInboxPage/components/ChannelFilter.tsx`: import :13, `FREE` :37, after `unknownOwner` :165-166, label + `<Select>` :238-274
- Modify `apps/web/src/pages/UnifiedInboxPage/components/ChatFollowUpDialog.tsx`: imports :2, :7; hook after :48; `field` :131-132; form fields :151-187 and :188-204, :213-228
- Modify `apps/web/src/pages/UnifiedInboxPage/components/ChatServiceRequestCard.tsx`: imports :2, :6; hook after :26; after `active` :111; edit-form fields :213-282 (`field` :14-15 stays for the "ค้นหาเคสเดิม" input :302-315)
- Modify `apps/web/src/pages/UnifiedInboxPage/components/ChatServiceRequestDialog.tsx`: imports :2, :6; delete `field` :11-12; hook after :24; options before `return (` :86; fields :99-139 and :157-185
- Modify `apps/web/src/pages/UnifiedInboxPage/components/FacebookCommentPanel.tsx`: imports :1, :3, :6; hook after :26; options after `echoIds` :86-88; assignee row :107-132
- Modify `apps/web/src/pages/TodosPage/components/TodoFilters.tsx`: import :1; options after :34; assignee block :79-96
- Modify `apps/web/src/pages/TodosPage/components/TodoForm.tsx`: import :1; options after `removeChecklist` :317-318; assignee control :456-466
- Modify `apps/web/src/pages/CollectionsPage/components/StuckContractsSection.tsx`: import :2; query :42; dialog field :212-227
- Modify `apps/web/src/pages/CustomersPage/components/ProspectFilterBar.tsx`: import :3; owner filter :130-142
- Test (modify): `apps/web/src/pages/UnifiedInboxPage/components/ChannelFilter.test.tsx`, `apps/web/src/pages/UnifiedInboxPage/components/ChatFollowUpDialog.test.tsx` (:62, :103-104, :149-150), `apps/web/src/pages/UnifiedInboxPage/components/ChatServiceRequestCard.test.tsx`, `apps/web/src/pages/UnifiedInboxPage/components/FacebookCommentPanel.test.tsx`, `apps/web/src/pages/TodosPage/components/TodoFilters.test.tsx` (rewritten — the old test pinned `NativeSelect` internals :30-41), `apps/web/src/pages/CustomersPage/__tests__/CustomersPage.test.tsx` (append)
- Test (create): `apps/web/src/pages/UnifiedInboxPage/components/ChatServiceRequestDialog.test.tsx`, `apps/web/src/pages/TodosPage/components/TodoForm.assignee.test.tsx`, `apps/web/src/pages/CollectionsPage/components/StuckContractsSection.test.tsx`
- No change (checked):
  - `ChannelFilter.test.tsx:45` (`getByRole('combobox', { name: 'ผู้ดูแล' })` + `toHaveTextContent('ผู้ดูแลคนอื่น')`) and `:53` (`toBeDisabled()`) stay valid as written: the trigger is the only closed `combobox` named by the label, `renderValue` shows the same `ownerLabel` text, and `disabled={mineTab}` disables the button.
  - `CustomersPage.test.tsx:296-298` stays valid (the trigger keeps `aria-label="ผู้ดูแล"`).
  - `CustomerTagDialog.test.tsx:113-130` drives the sibling `แท็ก` FilterSelect only.
  - `TodoForm.tags-frame.test.tsx`, `TodosPage/home-link.test.tsx`, `RoomDossier.test.tsx` (mocks TodoForm), `ConversationList.test.tsx`, `room-query.test.ts`: unchanged.
- e2e / audit (not executed on Windows; verified by reading):
  - `apps/web/e2e/chat-inbox.spec.ts:22-29, :32-41` opens the filter dialog and checks the `ช่องทาง` group and 390 px overflow. It never touches the owner control, and the trigger is `w-full min-w-0` inside the dialog, so it needs no change.
  - `grep -rn "ผู้รับมอบหมาย\|ผู้ดูแล\|ผู้รับผิดชอบ\|เลือกผู้รับผิดชอบใหม่\|มอบหมายใหม่" apps/web/e2e apps/api/e2e/ui-fields` finds only `shared-controls.audit-spec.ts:118` (`ผู้รับผิดชอบ (Custodian) *` on the asset form, not one of these fields).
  - The loose locators of header cross-task notes are not on `/inbox`, `/todos`, `/collections` or the prospects view. `customers.spec.ts:103` / `crud-flows.spec.ts:84` select `นาย` in the create-customer modal, and `crud-flows.spec.ts:33` only clicks the `ผู้สนใจ` view button.

**Interfaces:**
- Consumes:
  - `Combobox`, `type ComboOption` from `@/components/ui/combobox` (Task 4). Props used: `value`, `onChange(value)`, `options`, `selectedOption`, `placeholder`, `renderValue`, `loading`, `required`, `disabled`, `id`, `aria-label`, `aria-labelledby`, `className`. Trigger `data-slot="combobox-trigger"`.
  - `formControlClass`, `formLabelClass`, `formTextareaClass` from `@/components/ui/form-styles` (form-styles.ts:5-13).
  - `pickComboOption(user, name, option, { search? })` from `@/test/combobox` (Task 4).
- Produces: nothing exported. The internal `FREE` constant of ChannelFilter is deleted (it was not exported).

---

#### Group A — inbox fields (ChannelFilter, ChatFollowUpDialog, ChatServiceRequestCard, ChatServiceRequestDialog, FacebookCommentPanel)

- [ ] **Step 1: Write the failing inbox tests**

1a. `apps/web/src/pages/UnifiedInboxPage/components/ChannelFilter.test.tsx`: add the helper import after the component import.

Replace:
```tsx
import ChannelFilter, { ActiveInboxFilters, InboxTabs } from './ChannelFilter';
```
with:
```tsx
import ChannelFilter, { ActiveInboxFilters, InboxTabs } from './ChannelFilter';
import { pickComboOption } from '@/test/combobox';
```
Then append at the end of the file, after the last `});`:
```tsx

describe('Inbox filter — owner combobox (R2-4a)', () => {
  it('searches and picks an owner; Apply sends the staff id, never a sentinel', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<ChannelFilter {...base} onApply={onApply} />);
    await user.click(screen.getByRole('button', { name: 'ตัวกรองแชท' }));
    const owner = screen.getByRole('combobox', { name: 'ผู้ดูแล' });
    expect(owner).toHaveAttribute('data-slot', 'combobox-trigger');
    expect(owner).toHaveTextContent('ทุกคน');

    await pickComboOption(user, 'ผู้ดูแล', 'ผู้ดูแลคนอื่น', { search: 'คนอื่น' });

    expect(owner).toHaveTextContent('ผู้ดูแลคนอื่น');
    expect(screen.getByRole('dialog', { name: 'ตัวกรองแชท' })).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'แสดงแชท' }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith({ channel: null, who: 'other' });
  });

  it('shows the signed-in owner as "คุณ" and applies "ยังไม่มีผู้ดูแล" as who=free', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<ChannelFilter {...base} onApply={onApply} />);
    await user.click(screen.getByRole('button', { name: 'ตัวกรองแชท' }));
    const owner = screen.getByRole('combobox', { name: 'ผู้ดูแล' });

    await pickComboOption(user, 'ผู้ดูแล', 'พนักงานทดสอบ (คุณ)');
    expect(owner).toHaveTextContent(/^คุณ$/);

    await pickComboOption(user, 'ผู้ดูแล', 'ยังไม่มีผู้ดูแล');
    expect(owner).toHaveTextContent('ยังไม่มีผู้ดูแล');
    await user.click(screen.getByRole('button', { name: 'แสดงแชท' }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith({ channel: null, who: 'free' });
  });

  it('keeps an applied owner who is not in the staff list', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<ChannelFilter {...base} who="left-company" onApply={onApply} />);
    await user.click(screen.getByRole('button', { name: 'ตัวกรองแชท' }));
    expect(screen.getByRole('combobox', { name: 'ผู้ดูแล' })).toHaveTextContent('ผู้ดูแลที่เลือก');
    await user.click(screen.getByRole('button', { name: 'แสดงแชท' }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith({ channel: null, who: 'left-company' });
  });
});
```
The third test is characterization: it pins today's unknown-owner behaviour and already passes before the switch.

1b. `apps/web/src/pages/UnifiedInboxPage/components/ChatFollowUpDialog.test.tsx`: make these replacements.

Replace:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
```
with:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
```
Replace:
```tsx
import ChatFollowUpDialog from './ChatFollowUpDialog';
```
with:
```tsx
import ChatFollowUpDialog from './ChatFollowUpDialog';
import { pickComboOption } from '@/test/combobox';
```
Line 62, edit path: the options are no longer in the DOM until the menu opens, so wait for the trigger to show the loaded assignee instead. Replace:
```tsx
    await screen.findByRole('option', { name: 'เมย์' });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกนัด' }));
    await screen.findByText(/มีคนแก้ไขนัดนี้แล้ว/);
```
with:
```tsx
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'ผู้รับผิดชอบงาน' })).toHaveTextContent('เมย์'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกนัด' }));
    await screen.findByText(/มีคนแก้ไขนัดนี้แล้ว/);
```
Replace:
```tsx
    async (handoff) => {
      const titleLabel
```
with:
```tsx
    async (handoff) => {
      const user = userEvent.setup();
      const titleLabel
```
Lines 103-104. Replace:
```tsx
      await screen.findByRole('option', { name: 'เมย์' });
      fireEvent.change(screen.getByLabelText('ผู้รับผิดชอบงาน'), { target: { value: 'staff' } });
      fireEvent.click(screen.getByRole('button', { name: saveLabel }));
```
with:
```tsx
      await pickComboOption(user, 'ผู้รับผิดชอบงาน', 'เมย์');
      fireEvent.click(screen.getByRole('button', { name: saveLabel }));
```
Replace:
```tsx
    api.post.mockRejectedValueOnce(new Error()).mockResolvedValue({ data: {} });
    view();
```
with:
```tsx
    const user = userEvent.setup();
    api.post.mockRejectedValueOnce(new Error()).mockResolvedValue({ data: {} });
    view();
```
Lines 149-150. Replace:
```tsx
    await screen.findByRole('option', { name: 'เมย์' });
    fireEvent.change(screen.getByLabelText('ผู้รับผิดชอบงาน'), { target: { value: 'staff' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกนัด' }));
```
with:
```tsx
    await pickComboOption(user, 'ผู้รับผิดชอบงาน', 'เมย์');
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกนัด' }));
```
Finally add the strict create test before the closing `});` of `describe('Chat follow-up form'`. Replace the end of the file:
```tsx
    expect(api.post.mock.calls[0][1].clientRequestId).toBe(
      api.post.mock.calls[1][1].clientRequestId,
    );
  });
});
```
with:
```tsx
    expect(api.post.mock.calls[0][1].clientRequestId).toBe(
      api.post.mock.calls[1][1].clientRequestId,
    );
  });
  it('create: save waits for a picked assignee and the body carries the picked id (R2-4a)', async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({
      data: [
        { id: 'staff', name: 'เมย์' },
        {
          id: 'staff-2',
          name: 'สมชาย ใจดี',
          nickname: 'ชาย',
          detail: 'สาขาลาดพร้าว · SALES · 0000s2',
        },
      ],
    });
    api.post.mockResolvedValue({ data: {} });
    view();
    fireEvent.change(screen.getByLabelText('เรื่องที่ติดตาม'), { target: { value: 'โทรติดตาม' } });
    fireEvent.change(screen.getByLabelText('วันเวลานัด (เวลาไทย)'), {
      target: { value: '2026-10-06T10:30' },
    });
    const save = screen.getByRole('button', { name: 'บันทึกนัด' });
    const assignee = screen.getByRole('combobox', { name: 'ผู้รับผิดชอบงาน' });
    expect(assignee).toHaveAttribute('aria-required', 'true');
    expect(assignee).toHaveTextContent('เลือกผู้รับผิดชอบ');
    expect(save).toBeDisabled();

    // the label shows the nickname; the full name is a search keyword
    await pickComboOption(user, 'ผู้รับผิดชอบงาน', 'ชาย · สาขาลาดพร้าว · SALES · 0000s2', {
      search: 'สมชาย',
    });

    expect(assignee).toHaveTextContent('ชาย · สาขาลาดพร้าว · SALES · 0000s2');
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/staff-chat/rooms/room/follow-ups',
        expect.objectContaining({
          title: 'โทรติดตาม',
          dueAt: '2026-10-06T03:30:00.000Z',
          assigneeId: 'staff-2',
        }),
        { params: { company: 'SHOP' } },
      ),
    );
  });
});
```

1c. `apps/web/src/pages/UnifiedInboxPage/components/ChatServiceRequestCard.test.tsx`: make these replacements.

Replace:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
```
with:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
```
Replace:
```tsx
import ChatServiceRequestCard from './ChatServiceRequestCard';
```
with:
```tsx
import ChatServiceRequestCard from './ChatServiceRequestCard';
import { pickComboOption } from '@/test/combobox';
```
Replace the end of the file:
```tsx
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'บันทึกการติดตาม' })).toBeEnabled(),
    );
  });
});
```
with:
```tsx
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'บันทึกการติดตาม' })).toBeEnabled(),
    );
  });
  it('picks a new assignee from the eligible staff and PATCHes it (R2-4a)', async () => {
    const user = userEvent.setup();
    mocks.api.get.mockImplementation((url: string) =>
      Promise.resolve({
        data: url.endsWith('eligible-staff')
          ? [
              { id: 'u', name: 'เมย์' },
              { id: 'v', name: 'ต้น', detail: 'สาขาลาดพร้าว · SALES · 00000v' },
            ]
          : row,
      }),
    );
    mocks.api.patch.mockResolvedValue({ data: {} });
    view();
    await user.click(await screen.findByRole('button', { name: 'แก้ไขการติดตาม' }));
    const assignee = screen.getByRole('combobox', { name: 'ผู้รับผิดชอบ' });
    expect(assignee).toHaveTextContent('เมย์');
    await waitFor(() =>
      expect(mocks.api.get).toHaveBeenCalledWith(
        '/staff-chat/rooms/room/eligible-staff',
        expect.anything(),
      ),
    );

    await pickComboOption(user, 'ผู้รับผิดชอบ', 'ต้น สาขาลาดพร้าว · SALES · 00000v', {
      search: 'ต้น',
    });

    expect(assignee).toHaveTextContent('ต้น สาขาลาดพร้าว · SALES · 00000v');
    await user.click(screen.getByRole('button', { name: 'บันทึกการติดตาม' }));
    await waitFor(() =>
      expect(mocks.api.patch).toHaveBeenCalledWith(
        '/staff-chat/service-requests/intake',
        expect.objectContaining({ expectedRevision: 0, status: 'OPEN', assigneeId: 'v' }),
        { params: { company: 'SHOP' } },
      ),
    );
  });
  it('keeps an assignee who left the eligible list as the first row; picking it back sends no assigneeId', async () => {
    const user = userEvent.setup();
    const formerRow = {
      ...row,
      todo: { ...row.todo, assigneeId: 'gone', assignee: { name: 'คนเดิม' } },
    };
    mocks.api.get.mockImplementation((url: string) =>
      Promise.resolve({
        data: url.endsWith('eligible-staff') ? [{ id: 'v', name: 'ต้น' }] : formerRow,
      }),
    );
    mocks.api.patch.mockResolvedValue({ data: {} });
    view();
    await user.click(await screen.findByRole('button', { name: 'แก้ไขการติดตาม' }));
    const assignee = screen.getByRole('combobox', { name: 'ผู้รับผิดชอบ' });
    expect(assignee).toHaveTextContent('คนเดิม');
    await waitFor(() =>
      expect(mocks.api.get).toHaveBeenCalledWith(
        '/staff-chat/rooms/room/eligible-staff',
        expect.anything(),
      ),
    );
    await pickComboOption(user, 'ผู้รับผิดชอบ', 'ต้น');
    await pickComboOption(user, 'ผู้รับผิดชอบ', 'คนเดิม');
    expect(assignee).toHaveTextContent('คนเดิม');
    await user.click(screen.getByRole('button', { name: 'บันทึกการติดตาม' }));
    await waitFor(() => expect(mocks.api.patch).toHaveBeenCalledTimes(1));
    expect(mocks.api.patch.mock.calls[0][1]).not.toHaveProperty('assigneeId');
  });
});
```
The existing `:84` / `:85` / `:88` `getByLabelText('สถานะรับเรื่อง' | 'เหตุผล')` lines stay. Those fields keep their labels through `htmlFor`/`id` (Step 5).

1d. Create `apps/web/src/pages/UnifiedInboxPage/components/ChatServiceRequestDialog.test.tsx` with exactly:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatServiceRequestDialog from './ChatServiceRequestDialog';
import { pickComboOption } from '@/test/combobox';

const mocks = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/lib/api', () => ({ default: mocks.api, getErrorMessage: () => 'บันทึกไม่ได้' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../hooks/useChatWork', () => ({
  useChatWorkSettings: () => ({
    company: 'SHOP',
    scope: { company: 'SHOP' },
    key: ['chat-work', 'u', 'SHOP'],
  }),
}));

function view() {
  const onCreated = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <ChatServiceRequestDialog roomId="room" onClose={vi.fn()} onCreated={onCreated} />
    </QueryClientProvider>,
  );
  return onCreated;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.get.mockImplementation((url: string) =>
    Promise.resolve({
      data: url.endsWith('eligible-staff')
        ? [
            { id: 'u1', name: 'เมย์', detail: 'สาขาลาดพร้าว · SALES · 0000u1' },
            { id: 'u2', name: 'ต้น' },
          ]
        : { data: [], total: 0 },
    }),
  );
});

describe('ChatServiceRequestDialog — assignee combobox (R2-4a)', () => {
  it('keeps save disabled until an assignee is picked, then posts the picked id', async () => {
    const user = userEvent.setup();
    mocks.api.post.mockResolvedValue({ data: { id: 'sr-1' } });
    const onCreated = view();
    fireEvent.change(screen.getByLabelText('อาการที่ลูกค้าแจ้ง'), {
      target: { value: 'จอเป็นเส้นแนวตั้ง' },
    });
    fireEvent.change(screen.getByLabelText('นัดติดตาม (เวลาไทย)'), {
      target: { value: '2026-10-06T10:30' },
    });
    const save = screen.getByRole('button', { name: 'บันทึกรับเรื่อง' });
    const assignee = screen.getByRole('combobox', { name: 'ผู้รับผิดชอบ' });
    expect(assignee).toHaveAttribute('aria-required', 'true');
    expect(assignee).toHaveTextContent('เลือกผู้ติดตาม');
    expect(save).toBeDisabled();
    await waitFor(() =>
      expect(mocks.api.get).toHaveBeenCalledWith(
        '/staff-chat/rooms/room/eligible-staff',
        expect.anything(),
      ),
    );

    await pickComboOption(user, 'ผู้รับผิดชอบ', 'เมย์ สาขาลาดพร้าว · SALES · 0000u1', {
      search: 'เมย์',
    });

    expect(assignee).toHaveTextContent('เมย์ สาขาลาดพร้าว · SALES · 0000u1');
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() =>
      expect(mocks.api.post).toHaveBeenCalledWith(
        '/staff-chat/rooms/room/service-requests',
        expect.objectContaining({
          symptom: 'จอเป็นเส้นแนวตั้ง',
          assigneeId: 'u1',
          dueAt: '2026-10-06T03:30:00.000Z',
          sourceMessageIds: [],
        }),
        { params: { company: 'SHOP' } },
      ),
    );
    expect(onCreated).toHaveBeenCalledWith('sr-1');
  });
});
```

1e. `apps/web/src/pages/UnifiedInboxPage/components/FacebookCommentPanel.test.tsx`: make these replacements.

Replace:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
```
with:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
```
Replace:
```tsx
import FacebookCommentPanel, { canReplyPublic } from './FacebookCommentPanel';
```
with:
```tsx
import FacebookCommentPanel, { canReplyPublic } from './FacebookCommentPanel';
import { pickComboOption } from '@/test/combobox';
```
Then append at the end of the file, after the last test (`await screen.findByText('ยังตรวจยืนยันคอมเมนต์ต้นทางไม่ได้ กรุณาลองอีกครั้ง');\n});`):
```tsx

it('saves the assignee only when a different person is picked — never on open, search or re-pick (R2-4a)', async () => {
  const user = userEvent.setup();
  mocks.api.get.mockImplementation((url: string) =>
    Promise.resolve({
      data: url.endsWith('eligible-staff')
        ? [{ id: 'staff-000001', name: 'เมย์', role: 'SALES' }]
        : fixture,
    }),
  );
  mocks.api.patch.mockResolvedValue({ data: {} });
  view();
  await screen.findByText('ราคาเท่าไร');
  const assignee = screen.getByRole('combobox', { name: 'ผู้รับผิดชอบคอมเมนต์' });
  expect(assignee).toHaveTextContent('ยังไม่มีผู้รับผิดชอบ');
  await waitFor(() =>
    expect(mocks.api.get).toHaveBeenCalledWith(
      '/staff-chat/facebook-comments/thread/eligible-staff',
      expect.anything(),
    ),
  );

  await user.click(assignee);
  await user.keyboard('เมย์');
  await user.keyboard('{Escape}');
  expect(mocks.api.patch).not.toHaveBeenCalled();

  await pickComboOption(user, 'ผู้รับผิดชอบคอมเมนต์', 'ยังไม่มีผู้รับผิดชอบ');
  expect(mocks.api.patch).not.toHaveBeenCalled();

  await pickComboOption(user, 'ผู้รับผิดชอบคอมเมนต์', 'เมย์ · SALES · 000001', { search: 'เมย์' });
  await waitFor(() =>
    expect(mocks.api.patch).toHaveBeenCalledExactlyOnceWith(
      '/staff-chat/facebook-comments/thread/assign',
      { expectedRevision: 1, assigneeId: 'staff-000001' },
      { params: { company: 'SHOP' } },
    ),
  );
});

it('shows a former assignee outside the eligible list and clears to null (R2-4a)', async () => {
  const user = userEvent.setup();
  mocks.api.get.mockImplementation((url: string) =>
    Promise.resolve({
      data: url.endsWith('eligible-staff') ? [] : { ...fixture, assigneeId: 'gone-123456' },
    }),
  );
  mocks.api.patch.mockResolvedValue({ data: {} });
  view();
  await screen.findByText('ราคาเท่าไร');
  const assignee = screen.getByRole('combobox', { name: 'ผู้รับผิดชอบคอมเมนต์' });
  await waitFor(() => expect(assignee).toHaveTextContent('ผู้รับเดิม · ต้องตรวจสิทธิ์'));

  await pickComboOption(user, 'ผู้รับผิดชอบคอมเมนต์', 'ยังไม่มีผู้รับผิดชอบ');

  await waitFor(() =>
    expect(mocks.api.patch).toHaveBeenCalledExactlyOnceWith(
      '/staff-chat/facebook-comments/thread/assign',
      { expectedRevision: 1, assigneeId: null },
      { params: { company: 'SHOP' } },
    ),
  );
});
```

- [ ] **Step 2: Run the inbox tests and watch the new ones fail**

```bash
cd apps/web && npx vitest run src/pages/UnifiedInboxPage/components/ChannelFilter.test.tsx src/pages/UnifiedInboxPage/components/ChatFollowUpDialog.test.tsx src/pages/UnifiedInboxPage/components/ChatServiceRequestCard.test.tsx src/pages/UnifiedInboxPage/components/ChatServiceRequestDialog.test.tsx src/pages/UnifiedInboxPage/components/FacebookCommentPanel.test.tsx
```
Expected: `Tests  11 failed | 19 passed (30)`. The failures, file by file:

| File | Failed | Why |
|---|---|---|
| ChannelFilter | 2 of 9 | `toHaveAttribute("data-slot", "combobox-trigger")` receives `select-trigger`, or `pickComboOption` cannot open a combobox menu. The unknown-owner characterization test passes. |
| ChatFollowUpDialog | 4 of 5 | Three tests now pick through `pickComboOption` and the field is still a native `<select>`, so no `[data-slot="combobox-content"]` opens. The new test fails at `aria-required`. The edit test that only reads the trigger text passes. |
| ChatServiceRequestCard | 2 of 5 | Both new tests: the field is still a `<select>`. |
| ChatServiceRequestDialog | 1 of 1 | `aria-required` is missing. |
| FacebookCommentPanel | 2 of 10 | No combobox menu opens. |

Every pre-existing test passes.

- [ ] **Step 3: ChannelFilter → `Combobox`**

Edit `apps/web/src/pages/UnifiedInboxPage/components/ChannelFilter.tsx`.

Replace:
```tsx
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
```
with:
```tsx
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { formLabelClass } from '@/components/ui/form-styles';
```
Replace:
```tsx
const ALL = '__all__';
const FREE = '__free__';
```
with:
```tsx
const ALL = '__all__';
```
Replace:
```tsx
  const unknownOwner =
    draftWho !== 'all' && draftWho !== 'free' && !staff.some((person) => person.id === draftWho);
```
with:
```tsx
  const unknownOwner =
    draftWho !== 'all' && draftWho !== 'free' && !staff.some((person) => person.id === draftWho);
  // The owner values are the WhoFilter strings themselves ('all' / 'free' / a staff id) —
  // the old '__all__' / '__free__' existed only because a Radix Select item cannot hold ''.
  const ownerOptions: ComboOption[] = [
    { value: 'all', label: mineTab ? 'คุณ · มุมมองของฉัน' : 'ทุกคน' },
    { value: 'free', label: 'ยังไม่มีผู้ดูแล' },
    ...staff.map((person) => ({
      value: person.id,
      label: `${person.name}${person.id === currentUserId ? ' (คุณ)' : ''}`,
    })),
  ];
```
Replace:
```tsx
            <label
              id={`${id}-owner-label`}
              htmlFor={`${id}-owner`}
              className="mb-3 block text-sm font-medium"
            >
              ผู้ดูแล
            </label>
            <Select
              value={
                mineTab ? ALL : draftWho === 'all' ? ALL : draftWho === 'free' ? FREE : draftWho
              }
              onValueChange={(value) =>
                setDraftWho(value === ALL ? 'all' : value === FREE ? 'free' : value)
              }
              disabled={mineTab}
            >
              <SelectTrigger
                id={`${id}-owner`}
                aria-labelledby={`${id}-owner-label`}
                className="w-full min-w-0"
              >
                <span className="truncate">
                  {mineTab ? 'คุณ · มุมมองของฉัน' : ownerLabel(draftWho, staff, currentUserId)}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{mineTab ? 'คุณ · มุมมองของฉัน' : 'ทุกคน'}</SelectItem>
                <SelectItem value={FREE}>ยังไม่มีผู้ดูแล</SelectItem>
                {unknownOwner && <SelectItem value={draftWho}>ผู้ดูแลที่เลือก</SelectItem>}
                {staff.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.name}
                    {person.id === currentUserId ? ' (คุณ)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
```
with:
```tsx
            <label id={`${id}-owner-label`} htmlFor={`${id}-owner`} className={formLabelClass}>
              ผู้ดูแล
            </label>
            <Combobox
              id={`${id}-owner`}
              aria-labelledby={`${id}-owner-label`}
              value={mineTab ? 'all' : draftWho}
              onChange={(value) => setDraftWho(value)}
              options={ownerOptions}
              selectedOption={unknownOwner ? { value: draftWho, label: 'ผู้ดูแลที่เลือก' } : null}
              renderValue={() =>
                mineTab ? 'คุณ · มุมมองของฉัน' : ownerLabel(draftWho, staff, currentUserId)
              }
              disabled={mineTab}
            />
```
The form's `onSubmit` (`onApply({ channel: draftChannel, who: mineTab ? 'all' : draftWho })`), the "ล้างตัวกรอง" reset (`setDraftWho('all')`) and the dialog-open draft reset do not change.

- [ ] **Step 4: ChatFollowUpDialog → `Combobox` + style A form**

Edit `apps/web/src/pages/UnifiedInboxPage/components/ChatFollowUpDialog.tsx`.

Replace:
```tsx
import { useEffect, useRef, useState } from 'react';
```
with:
```tsx
import { useEffect, useId, useRef, useState } from 'react';
```
Replace:
```tsx
import { Button } from '@/components/ui/button';
```
with:
```tsx
import { Button } from '@/components/ui/button';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { formControlClass, formLabelClass, formTextareaClass } from '@/components/ui/form-styles';
```
Replace:
```tsx
  const client = useQueryClient();
  const [title, setTitle] = useState('');
```
with:
```tsx
  const client = useQueryClient();
  const uid = useId();
  const [title, setTitle] = useState('');
```
Replace (the `field` string has no user left after this step):
```tsx
  const field =
    'mt-1 min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm';
```
with:
```tsx
  const staffOptions: ComboOption[] = (staff.data ?? []).map((person) => ({
    value: person.id,
    label: `${person.nickname || person.name}${'detail' in person ? ` · ${String(person.detail)}` : ''}`,
    keywords: person.nickname ? [person.name] : undefined,
  }));
```
Replace:
```tsx
          <label className="block text-sm font-medium">
            {handoff ? 'เรื่องที่ฝาก' : 'เรื่องที่ติดตาม'}
            <input
              className={field}
              required
              maxLength={255}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          {handoff && (
            <label className="block text-sm font-medium">
              รายละเอียดงาน
              <textarea
                className={field}
                rows={3}
                maxLength={5000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          )}
          <label className="block text-sm font-medium">
            วันเวลานัด (เวลาไทย)
            <input
              className={field}
              required
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
```
with:
```tsx
          <div>
            <label htmlFor={`${uid}-title`} className={formLabelClass}>
              {handoff ? 'เรื่องที่ฝาก' : 'เรื่องที่ติดตาม'}
            </label>
            <input
              id={`${uid}-title`}
              className={formControlClass}
              required
              maxLength={255}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          {handoff && (
            <div>
              <label htmlFor={`${uid}-note`} className={formLabelClass}>
                รายละเอียดงาน
              </label>
              <textarea
                id={`${uid}-note`}
                className={formTextareaClass}
                rows={3}
                maxLength={5000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          )}
          <div>
            <label htmlFor={`${uid}-due`} className={formLabelClass}>
              วันเวลานัด (เวลาไทย)
            </label>
            <input
              id={`${uid}-due`}
              className={formControlClass}
              required
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </div>
```
Replace:
```tsx
          <label className="block text-sm font-medium">
            ผู้รับผิดชอบงาน
            <NativeSelect wrapperClassName="max-w-full mt-1 w-full min-w-0"
              className={`${field} mt-0`}
              required
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="">เลือกผู้รับผิดชอบ</option>
              {staff.data?.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.nickname || person.name}
                  {'detail' in person ? ` · ${String(person.detail)}` : ''}
                </option>
              ))}
            </NativeSelect>
          </label>
```
with:
```tsx
          <div>
            <label htmlFor={`${uid}-assignee`} className={formLabelClass}>
              ผู้รับผิดชอบงาน
            </label>
            <Combobox
              id={`${uid}-assignee`}
              required
              value={assignee}
              onChange={(value) => setAssignee(value)}
              options={staffOptions}
              placeholder="เลือกผู้รับผิดชอบ"
              loading={staff.isLoading}
            />
          </div>
```
Replace:
```tsx
          {editing && (
            <label className="block text-sm font-medium">
              สถานะนัด
              <NativeSelect wrapperClassName="max-w-full mt-1 w-full min-w-0"
                className={`${field} mt-0`}
                value={status}
                onChange={(e) => setStatus(e.target.value as TodoStatus)}
              >
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </label>
          )}
```
with:
```tsx
          {editing && (
            <div>
              <label htmlFor={`${uid}-status`} className={formLabelClass}>
                สถานะนัด
              </label>
              <NativeSelect
                id={`${uid}-status`}
                wrapperClassName="max-w-full w-full min-w-0"
                value={status}
                onChange={(e) => setStatus(e.target.value as TodoStatus)}
              >
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
```
These parts are unchanged:
- The `staff.isError` alert ("โหลดผู้รับงานไม่ได้" + "ลองใหม่").
- The past-time warning.
- The submit button's `disabled` list (it already contains `!assignee`, which is the required gate).
- The body `{ title, dueAt, assigneeId: assignee }`.

When editing, an `assigneeId` outside `eligible-staff` shows the placeholder `เลือกผู้รับผิดชอบ`. That is the same text the native select showed, and the id is still sent.

- [ ] **Step 5: ChatServiceRequestCard → `Combobox` + style A edit form**

Edit `apps/web/src/pages/UnifiedInboxPage/components/ChatServiceRequestCard.tsx`.

Replace:
```tsx
import { useState } from 'react';
```
with:
```tsx
import { useId, useState } from 'react';
```
Replace:
```tsx
import { Button } from '@/components/ui/button';
```
with:
```tsx
import { Button } from '@/components/ui/button';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { formControlClass, formLabelClass, formTextareaClass } from '@/components/ui/form-styles';
```
Replace (the hook goes before the early returns at :100-110):
```tsx
    request = useChatServiceRequest(requestId);
```
with:
```tsx
    request = useChatServiceRequest(requestId);
  const uid = useId();
```
Replace:
```tsx
  const active = ['TODO', 'DOING', 'REVIEW'].includes(row.todo.status);
```
with:
```tsx
  const active = ['TODO', 'DOING', 'REVIEW'].includes(row.todo.status);
  // The current assignee stays the first row, as in the native list: picking it again means
  // "keep" — the PATCH sends assigneeId only when it differs from row.todo.assigneeId.
  const assigneeOptions: ComboOption[] = [
    { value: row.todo.assigneeId || '', label: row.todo.assignee?.name || 'ไม่ระบุ' },
    ...(staff.isError
      ? []
      : (staff.data ?? [])
          .filter((s) => s.id !== row.todo.assigneeId)
          .map((s) => ({ value: s.id, label: s.detail ? `${s.name} ${s.detail}` : s.name }))),
  ];
```
(`s.detail ? … : s.name` keeps the old option text. JSX `{s.name} {s.detail}` printed nothing for a missing detail, but a plain template string would print "undefined".)

Replace:
```tsx
          <label className="block">
            ผู้รับผิดชอบ
            <NativeSelect wrapperClassName="max-w-full mt-1 w-full min-w-0"
              className={`${field} mt-0`}
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value={row.todo.assigneeId || ''}>
                {row.todo.assignee?.name || 'ไม่ระบุ'}
              </option>
              {!staff.isError &&
                staff.data
                  ?.filter((s) => s.id !== row.todo.assigneeId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.detail}
                    </option>
                  ))}
            </NativeSelect>
          </label>
```
with:
```tsx
          <div>
            <label htmlFor={`${uid}-assignee`} className={formLabelClass}>
              ผู้รับผิดชอบ
            </label>
            <Combobox
              id={`${uid}-assignee`}
              value={assignee}
              onChange={(value) => setAssignee(value)}
              options={assigneeOptions}
            />
          </div>
```
Replace:
```tsx
          <label className="block">
            นัดติดตาม (เวลาไทย)
            <input
              type="datetime-local"
              className={field}
              value={due}
              required
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
          {row.status !== 'LINKED' && (
            <>
              <label className="block">
                สถานะรับเรื่อง
                <NativeSelect wrapperClassName="max-w-full mt-1 w-full min-w-0"
                  className={`${field} mt-0`}
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {Object.entries(labels)
                    .filter(([k]) => k !== 'LINKED')
                    .map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                </NativeSelect>
              </label>
              {['RESOLVED', 'CANCELLED'].includes(status) && (
                <label className="block">
                  เหตุผล
                  <textarea
                    required
                    className={field}
                    value={reason}
                    maxLength={1000}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
              )}
            </>
          )}
```
with:
```tsx
          <div>
            <label htmlFor={`${uid}-due`} className={formLabelClass}>
              นัดติดตาม (เวลาไทย)
            </label>
            <input
              id={`${uid}-due`}
              type="datetime-local"
              className={formControlClass}
              value={due}
              required
              onChange={(e) => setDue(e.target.value)}
            />
          </div>
          {row.status !== 'LINKED' && (
            <>
              <div>
                <label htmlFor={`${uid}-status`} className={formLabelClass}>
                  สถานะรับเรื่อง
                </label>
                <NativeSelect
                  id={`${uid}-status`}
                  wrapperClassName="max-w-full w-full min-w-0"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {Object.entries(labels)
                    .filter(([k]) => k !== 'LINKED')
                    .map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                </NativeSelect>
              </div>
              {['RESOLVED', 'CANCELLED'].includes(status) && (
                <div>
                  <label htmlFor={`${uid}-reason`} className={formLabelClass}>
                    เหตุผล
                  </label>
                  <textarea
                    id={`${uid}-reason`}
                    required
                    className={formTextareaClass}
                    value={reason}
                    maxLength={1000}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>
              )}
            </>
          )}
```
These parts are unchanged:
- The `field` const (:14-15) and the "ค้นหาเคสเดิม" panel (:300-372), a separate form.
- The PATCH body (:69-82).
- The "แก้ไขการติดตาม" seeding (`setAssignee(row.todo.assigneeId || '')`).

- [ ] **Step 6: ChatServiceRequestDialog → `Combobox` + style A form**

Edit `apps/web/src/pages/UnifiedInboxPage/components/ChatServiceRequestDialog.tsx`.

Replace:
```tsx
import { useRef, useState } from 'react';
```
with:
```tsx
import { useId, useRef, useState } from 'react';
```
Replace:
```tsx
import { Button } from '@/components/ui/button';
```
with:
```tsx
import { Button } from '@/components/ui/button';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { formControlClass, formLabelClass, formTextareaClass } from '@/components/ui/form-styles';
```
Delete (every user is converted below):
```tsx
const field =
  'mt-1 min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm';
```
Replace:
```tsx
  const work = useChatWorkSettings(),
    client = useQueryClient();
```
with:
```tsx
  const work = useChatWorkSettings(),
    client = useQueryClient();
  const uid = useId();
```
Replace:
```tsx
  return (
    <Dialog open onOpenChange={(o) => !o && !create.isPending && onClose()}>
```
with:
```tsx
  const staffOptions: ComboOption[] = staff.isError
    ? []
    : (staff.data ?? []).map((s) => ({
        value: s.id,
        label: s.detail ? `${s.name} ${s.detail}` : s.name,
      }));
  return (
    <Dialog open onOpenChange={(o) => !o && !create.isPending && onClose()}>
```
Replace:
```tsx
            <label className="block">
              อาการที่ลูกค้าแจ้ง
              <textarea
                className={field}
                value={symptom}
                required
                minLength={5}
                maxLength={5000}
                rows={3}
                onChange={(e) => setSymptom(e.target.value)}
              />
            </label>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <label className="block min-w-0">
                ผู้รับผิดชอบ
                <NativeSelect wrapperClassName="max-w-full mt-1 w-full min-w-0"
                  className={`${field} mt-0`}
                  required
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                >
                  <option value="">เลือกผู้ติดตาม</option>
                  {!staff.isError &&
                    staff.data?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.detail}
                      </option>
                    ))}
                </NativeSelect>
              </label>
              <label className="block min-w-0">
                นัดติดตาม (เวลาไทย)
                <input
                  type="datetime-local"
                  className={field}
                  value={due}
                  required
                  onChange={(e) => setDue(e.target.value)}
                />
              </label>
            </div>
```
with:
```tsx
            <div>
              <label htmlFor={`${uid}-symptom`} className={formLabelClass}>
                อาการที่ลูกค้าแจ้ง
              </label>
              <textarea
                id={`${uid}-symptom`}
                className={formTextareaClass}
                value={symptom}
                required
                minLength={5}
                maxLength={5000}
                rows={3}
                onChange={(e) => setSymptom(e.target.value)}
              />
            </div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <label htmlFor={`${uid}-assignee`} className={formLabelClass}>
                  ผู้รับผิดชอบ
                </label>
                <Combobox
                  id={`${uid}-assignee`}
                  required
                  value={assignee}
                  onChange={(value) => setAssignee(value)}
                  options={staffOptions}
                  placeholder="เลือกผู้ติดตาม"
                  loading={staff.isLoading}
                />
              </div>
              <div className="min-w-0">
                <label htmlFor={`${uid}-due`} className={formLabelClass}>
                  นัดติดตาม (เวลาไทย)
                </label>
                <input
                  id={`${uid}-due`}
                  type="datetime-local"
                  className={formControlClass}
                  value={due}
                  required
                  onChange={(e) => setDue(e.target.value)}
                />
              </div>
            </div>
```
Replace:
```tsx
                <label className="block">
                  ประเภทข้อมูล
                  <NativeSelect wrapperClassName="max-w-full mt-1 w-full min-w-0"
                    className={`${field} mt-0`}
                    value={kind}
                    onChange={(e) => {
                      setKind(e.target.value as Choice['kind']);
                      setPage(1);
                      setSearch('');
                    }}
                  >
                    <option value="SALE">ใบขาย / เครื่อง</option>
                    <option value="CONTRACT">สัญญา / เครื่อง</option>
                    <option value="MESSAGE">ข้อความในแชท</option>
                  </NativeSelect>
                </label>
                <label className="block">
                  ค้นหาข้อมูลอ้างอิง
                  <input
                    className={field}
                    value={search}
                    maxLength={100}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    placeholder={kind === 'MESSAGE' ? 'คำในข้อความ' : 'รุ่น, IMEI หรือเลขเอกสาร'}
                  />
                </label>
```
with:
```tsx
                <div>
                  <label htmlFor={`${uid}-kind`} className={formLabelClass}>
                    ประเภทข้อมูล
                  </label>
                  <NativeSelect
                    id={`${uid}-kind`}
                    wrapperClassName="max-w-full w-full min-w-0"
                    value={kind}
                    onChange={(e) => {
                      setKind(e.target.value as Choice['kind']);
                      setPage(1);
                      setSearch('');
                    }}
                  >
                    <option value="SALE">ใบขาย / เครื่อง</option>
                    <option value="CONTRACT">สัญญา / เครื่อง</option>
                    <option value="MESSAGE">ข้อความในแชท</option>
                  </NativeSelect>
                </div>
                <div>
                  <label htmlFor={`${uid}-search`} className={formLabelClass}>
                    ค้นหาข้อมูลอ้างอิง
                  </label>
                  <input
                    id={`${uid}-search`}
                    className={formControlClass}
                    value={search}
                    maxLength={100}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    placeholder={kind === 'MESSAGE' ? 'คำในข้อความ' : 'รุ่น, IMEI หรือเลขเอกสาร'}
                  />
                </div>
```
These parts are unchanged:
- `<fieldset disabled={!!submitted || create.isPending}>`: it also disables the trigger `<button>`.
- The frozen-body retry and the submit `disabled` list (`!assignee` is the required gate).
- The radio/checkbox reference rows. Their `<label>`s wrap a radio or checkbox; they are not field labels.

- [ ] **Step 7: FacebookCommentPanel → `Combobox` (saves on pick only)**

Edit `apps/web/src/pages/UnifiedInboxPage/components/FacebookCommentPanel.tsx`.

Delete (its only use is replaced below):
```tsx
import { NativeSelect } from '@/components/ui/native-select';
```
Replace:
```tsx
import { useRef, useState } from 'react';
```
with:
```tsx
import { useId, useRef, useState } from 'react';
```
Replace:
```tsx
import { Button } from '@/components/ui/button';
```
with:
```tsx
import { Button } from '@/components/ui/button';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { formLabelClass } from '@/components/ui/form-styles';
```
Replace (the hook goes before the early returns at :76-85):
```tsx
  const [page, setPage] = useState(1);
  const { query, staff, scope, refresh } = useFacebookComments(threadId, page);
```
with:
```tsx
  const [page, setPage] = useState(1);
  const uid = useId();
  const { query, staff, scope, refresh } = useFacebookComments(threadId, page);
```
Replace:
```tsx
  const echoIds = new Set(
    row.replies.filter((r) => r.status === 'CONFIRMED').map((r) => r.externalId),
  );
```
with:
```tsx
  const echoIds = new Set(
    row.replies.filter((r) => r.status === 'CONFIRMED').map((r) => r.externalId),
  );
  const assigneeOptions: ComboOption[] = [
    { value: '', label: 'ยังไม่มีผู้รับผิดชอบ' },
    ...(staff.data ?? []).map((s) => ({
      value: s.id,
      label: `${s.name} · ${s.role} · ${s.id.slice(-6)}`,
    })),
  ];
  const formerAssignee: ComboOption | null =
    row.assigneeId && !staff.data?.some((s) => s.id === row.assigneeId)
      ? { value: row.assigneeId, label: 'ผู้รับเดิม · ต้องตรวจสิทธิ์' }
      : null;
```
Replace:
```tsx
        <label className="min-w-0 flex-1 space-y-1">
          <span>ผู้รับผิดชอบคอมเมนต์</span>
          <NativeSelect wrapperClassName="max-w-full w-full"
            value={row.assigneeId ?? ''}
            disabled={busy || staff.isError}
            onChange={(e) =>
              void act(() =>
                api.patch(
                  `/staff-chat/facebook-comments/${threadId}/assign`,
                  { expectedRevision: row.revision, assigneeId: e.target.value || null },
                  { params: scope },
                ),
              )
            }
          >
            <option value="">ยังไม่มีผู้รับผิดชอบ</option>
            {row.assigneeId && !staff.data?.some((s) => s.id === row.assigneeId) && (
              <option value={row.assigneeId}>ผู้รับเดิม · ต้องตรวจสิทธิ์</option>
            )}
            {staff.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.role} · {s.id.slice(-6)}
              </option>
            ))}
          </NativeSelect>
        </label>
```
with:
```tsx
        <div className="min-w-0 flex-1">
          <label htmlFor={`${uid}-assignee`} className={formLabelClass}>
            ผู้รับผิดชอบคอมเมนต์
          </label>
          <Combobox
            id={`${uid}-assignee`}
            value={row.assigneeId ?? ''}
            disabled={busy || staff.isError}
            onChange={(value) => {
              // Saves on pick only: the native select fired no change for the row already
              // selected, so re-picking it must not PATCH either.
              if (value === (row.assigneeId ?? '')) return;
              void act(() =>
                api.patch(
                  `/staff-chat/facebook-comments/${threadId}/assign`,
                  { expectedRevision: row.revision, assigneeId: value || null },
                  { params: scope },
                ),
              );
            }}
            options={assigneeOptions}
            selectedOption={formerAssignee}
          />
        </div>
```
The `flex flex-wrap items-end gap-2` row and its "ปิดงาน / เปิดงานอีกครั้ง" button stay. `items-end` still lines the button up with the field's bottom edge. `act` (busy → PATCH → refresh, error alert) does not change.

- [ ] **Step 8: Run the inbox tests and see them pass**

```bash
cd apps/web && npx vitest run src/pages/UnifiedInboxPage/components/ChannelFilter.test.tsx src/pages/UnifiedInboxPage/components/ChatFollowUpDialog.test.tsx src/pages/UnifiedInboxPage/components/ChatServiceRequestCard.test.tsx src/pages/UnifiedInboxPage/components/ChatServiceRequestDialog.test.tsx src/pages/UnifiedInboxPage/components/FacebookCommentPanel.test.tsx
```
Expected: `Test Files  5 passed (5)`, `Tests  30 passed (30)` (9 + 5 + 5 + 1 + 10).

- [ ] **Step 9: Run the rest of the inbox page tests**

```bash
cd apps/web && npx vitest run src/pages/UnifiedInboxPage
```
Expected: every file passes, with 0 failed. `RoomDossier.test.tsx` mocks `TodoForm`. `ConversationList.test.tsx` and `room-query.test.ts` only pass the filter values through, and those are unchanged.

- [ ] **Step 10: Type check + lint the inbox files**

```bash
bash tools/check-types.sh web
cd apps/web && npx eslint src/pages/UnifiedInboxPage/components/ChannelFilter.tsx src/pages/UnifiedInboxPage/components/ChannelFilter.test.tsx src/pages/UnifiedInboxPage/components/ChatFollowUpDialog.tsx src/pages/UnifiedInboxPage/components/ChatFollowUpDialog.test.tsx src/pages/UnifiedInboxPage/components/ChatServiceRequestCard.tsx src/pages/UnifiedInboxPage/components/ChatServiceRequestCard.test.tsx src/pages/UnifiedInboxPage/components/ChatServiceRequestDialog.tsx src/pages/UnifiedInboxPage/components/ChatServiceRequestDialog.test.tsx src/pages/UnifiedInboxPage/components/FacebookCommentPanel.tsx src/pages/UnifiedInboxPage/components/FacebookCommentPanel.test.tsx
```
Expected: `Web: OK` (0 type errors) and ESLint `0 errors` (no new warnings; semantic tokens only).

- [ ] **Step 11: e2e check by reading (not executed on Windows; verified by reading)**

Open `apps/web/e2e/chat-inbox.spec.ts:22-41`. It clicks `ตัวกรองแชท`, expects the dialog and the `ช่องทาง` group, and checks `scrollWidth <= innerWidth + 1` at 390. It never touches the owner field, and the new trigger is `w-full min-w-0` inside the dialog, so the spec needs no change. No other web e2e or `apps/api/e2e/ui-fields` spec touches these five fields: the grep listed under **Files** finds only the Custodian field on the asset form.

- [ ] **Step 12: Commit group A**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/ChannelFilter.tsx apps/web/src/pages/UnifiedInboxPage/components/ChannelFilter.test.tsx apps/web/src/pages/UnifiedInboxPage/components/ChatFollowUpDialog.tsx apps/web/src/pages/UnifiedInboxPage/components/ChatFollowUpDialog.test.tsx apps/web/src/pages/UnifiedInboxPage/components/ChatServiceRequestCard.tsx apps/web/src/pages/UnifiedInboxPage/components/ChatServiceRequestCard.test.tsx apps/web/src/pages/UnifiedInboxPage/components/ChatServiceRequestDialog.tsx apps/web/src/pages/UnifiedInboxPage/components/ChatServiceRequestDialog.test.tsx apps/web/src/pages/UnifiedInboxPage/components/FacebookCommentPanel.tsx apps/web/src/pages/UnifiedInboxPage/components/FacebookCommentPanel.test.tsx
git commit -F - <<'EOF'
feat(web): searchable staff pickers in the inbox (R2-4a part 1)

The inbox owner filter, the follow-up / handoff assignee, the service
request assignee (create and edit) and the Facebook comment assignee
become Combobox. Values sent to the API do not change: the owner filter
still passes 'all' / 'free' / a staff id upward (the '__all__' /
'__free__' Radix sentinels are gone), the service-request card keeps the
current assignee as its first row (picking it again still means "keep"),
and the Facebook assignee still saves on pick only - not on open, search
or re-picking the current row. Required assignees keep their disabled
submit button as the gate and now set aria-required. The three inbox
forms move to style A labels with formControlClass fields.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
Expected: one commit. Do not push.

---

#### Group B — todos (TodoFilters, TodoForm)

- [ ] **Step 13: Write the failing todo tests**

13a. Replace the whole of `apps/web/src/pages/TodosPage/components/TodoFilters.test.tsx` with the content below. The old single test pinned `NativeSelect` internals (`pl-10`, `[data-slot="native-select-wrapper"]`, `[data-slot="native-select-leading-icon"]`, `fireEvent.change`, :30-41). The new one pins the same promise: one user icon, owned by the field, with no hand-positioned icon outside it.
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TodoFilters } from './TodoFilters';
import type { TodoView } from '../types';
import { pickComboOption } from '@/test/combobox';

const counts: Record<TodoView, number> = {
  all: 0,
  today: 0,
  upcoming: 0,
  priority: 0,
  cancelled: 0,
  completed: 0,
};

function renderFilters(assigneeFilter: string, onAssignee = vi.fn()) {
  const view = render(
    <TodoFilters
      view="all"
      onViewChange={vi.fn()}
      search=""
      onSearchChange={vi.fn()}
      tabCounts={counts}
      staffUsers={[{ id: 'u1', name: 'สมชาย ใจดี', nickname: 'ชาย' }]}
      assigneeFilter={assigneeFilter}
      onAssigneeFilterChange={onAssignee}
    />,
  );
  return { ...view, onAssignee };
}

describe('TodoFilters assignee filter', () => {
  it('keeps the user icon inside the trigger and filters by the picked assignee (R2-4a)', async () => {
    const user = userEvent.setup();
    const { container, onAssignee } = renderFilters('');
    const trigger = screen.getByRole('combobox', { name: 'ผู้รับมอบหมาย' });
    expect(trigger).toHaveAttribute('data-slot', 'combobox-trigger');
    expect(trigger).toHaveTextContent('ผู้รับมอบหมายทั้งหมด');
    // One user icon, drawn by renderValue inside the trigger — none hand-positioned outside it.
    const icons = container.querySelectorAll('svg.lucide-user');
    expect(icons).toHaveLength(1);
    expect(trigger).toContainElement(icons[0] as HTMLElement);

    await pickComboOption(user, 'ผู้รับมอบหมาย', 'งานของฉัน');
    expect(onAssignee).toHaveBeenLastCalledWith('me');

    // the nickname is the label; the full name is a search keyword
    await pickComboOption(user, 'ผู้รับมอบหมาย', 'ชาย', { search: 'สมชาย' });
    expect(onAssignee).toHaveBeenLastCalledWith('u1');
  });

  it('shows "งานของฉัน" for ?assigneeId=me and clears to "" from "ผู้รับมอบหมายทั้งหมด"', async () => {
    const user = userEvent.setup();
    const { onAssignee } = renderFilters('me');
    expect(screen.getByRole('combobox', { name: 'ผู้รับมอบหมาย' })).toHaveTextContent('งานของฉัน');
    await pickComboOption(user, 'ผู้รับมอบหมาย', 'ผู้รับมอบหมายทั้งหมด');
    expect(onAssignee).toHaveBeenCalledExactlyOnceWith('');
  });

  it('an ?assigneeId outside the list keeps the old text and can be cleared', async () => {
    const user = userEvent.setup();
    const { onAssignee } = renderFilters('someone-else');
    expect(screen.getByRole('combobox', { name: 'ผู้รับมอบหมาย' })).toHaveTextContent(
      'ผู้รับมอบหมายทั้งหมด',
    );
    await pickComboOption(user, 'ผู้รับมอบหมาย', 'ผู้รับมอบหมายทั้งหมด');
    expect(onAssignee).toHaveBeenCalledExactlyOnceWith('');
  });
});
```

13b. Create `apps/web/src/pages/TodosPage/components/TodoForm.assignee.test.tsx` with exactly:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pickComboOption } from '@/test/combobox';
import type { Todo } from '../types';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/api', () => ({
  default: api,
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TodoForm } from './TodoForm';

const staff = [
  { id: 'u1', name: 'สมชาย ใจดี', nickname: 'ชาย' },
  { id: 'u2', name: 'สมหญิง รักงาน' },
];

const assignedElsewhere: Todo = {
  id: 't1',
  title: 'งานเดิม',
  status: 'TODO',
  priority: 'MEDIUM',
  revision: 3,
  assigneeId: 'u9',
  assignee: { id: 'u9', name: 'พนักงานสาขาอื่น' },
  createdById: 'u1',
  tags: [],
  createdAt: '2026-11-01T00:00:00.000Z',
};

function view(editing: Todo | null = null) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <MemoryRouter>
        <TodoForm open onOpenChange={() => {}} editing={editing} staffUsers={staff} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ data: [] });
  api.post.mockResolvedValue({ data: {} });
  api.patch.mockResolvedValue({ data: {} });
});

describe('TodoForm — assignee combobox (R2-4a)', () => {
  it('sends the picked assignee id when creating a todo', async () => {
    const user = userEvent.setup();
    view();
    fireEvent.change(screen.getByLabelText(/ชื่องาน/), { target: { value: 'โทรหาลูกค้า' } });
    const assignee = screen.getByRole('combobox', { name: 'ผู้รับมอบหมาย' });
    expect(assignee).toHaveTextContent('ไม่ระบุ');

    await pickComboOption(user, 'ผู้รับมอบหมาย', 'ชาย', { search: 'สมชาย' });

    expect(assignee).toHaveTextContent('ชาย');
    await user.click(screen.getByRole('button', { name: 'สร้างงาน' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/todos',
        expect.objectContaining({ title: 'โทรหาลูกค้า', assigneeId: 'u1' }),
      ),
    );
  });

  it('"ไม่ระบุ" sends no assigneeId', async () => {
    const user = userEvent.setup();
    view();
    fireEvent.change(screen.getByLabelText(/ชื่องาน/), { target: { value: 'งานไม่มีคนรับ' } });
    await pickComboOption(user, 'ผู้รับมอบหมาย', 'สมหญิง รักงาน');
    await pickComboOption(user, 'ผู้รับมอบหมาย', 'ไม่ระบุ');
    await user.click(screen.getByRole('button', { name: 'สร้างงาน' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post.mock.calls[0][1].assigneeId).toBeUndefined();
  });

  it('editing a todo assigned outside the list shows the saved name and keeps the id', async () => {
    const user = userEvent.setup();
    view(assignedElsewhere);
    const assignee = screen.getByRole('combobox', { name: 'ผู้รับมอบหมาย' });
    await waitFor(() => expect(assignee).toHaveTextContent('พนักงานสาขาอื่น'));
    await user.click(screen.getByRole('button', { name: 'บันทึกการแก้ไข' }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        '/todos/t1',
        expect.objectContaining({ assigneeId: 'u9', expectedRevision: 3 }),
      ),
    );
  });
});
```

- [ ] **Step 14: Run the todo tests and watch them fail**

```bash
cd apps/web && npx vitest run src/pages/TodosPage/components/TodoFilters.test.tsx src/pages/TodosPage/components/TodoForm.assignee.test.tsx
```
Expected: `Tests  6 failed (6)`. In TodoFilters the trigger is still a native `<select>` (`data-slot="native-select"`), so `toHaveAttribute("data-slot", "combobox-trigger")` fails and `pickComboOption` cannot open a combobox menu. In TodoForm no combobox menu opens, and the edit test's trigger does not contain `พนักงานสาขาอื่น` (the native select shows "ไม่ระบุ").

- [ ] **Step 15: TodoFilters → `Combobox` with the icon inside the trigger**

Edit `apps/web/src/pages/TodosPage/components/TodoFilters.tsx`.

Replace:
```tsx
import { NativeSelect } from '@/components/ui/native-select';
```
with:
```tsx
import { Combobox, type ComboOption } from '@/components/ui/combobox';
```
Replace:
```tsx
}: TodoFiltersProps) {
  return (
```
with:
```tsx
}: TodoFiltersProps) {
  const assigneeOptions: ComboOption[] = [
    { value: '', label: 'ผู้รับมอบหมายทั้งหมด' },
    { value: 'me', label: 'งานของฉัน' },
    ...staffUsers.map((u) => ({
      value: u.id,
      label: u.nickname || u.name,
      keywords: u.nickname ? [u.name] : undefined,
    })),
  ];
  return (
```
Replace:
```tsx
          <div className="min-w-0 w-full sm:w-auto">
            <NativeSelect wrapperClassName="max-w-full w-auto"
              aria-label="ผู้รับมอบหมาย"
              leadingIcon={<UserIcon />}
              value={assigneeFilter}
              onChange={(e) => onAssigneeFilterChange(e.target.value)}
            >
              <option value="">ผู้รับมอบหมายทั้งหมด</option>
              <option value="me">งานของฉัน</option>
              {staffUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nickname || u.name}
                </option>
              ))}
            </NativeSelect>
          </div>
```
with:
```tsx
          <div className="min-w-0 w-full sm:w-56">
            <Combobox
              aria-label="ผู้รับมอบหมาย"
              value={assigneeFilter}
              onChange={(value) => onAssigneeFilterChange(value)}
              options={assigneeOptions}
              // An ?assigneeId outside the list: the native select showed its first option.
              placeholder="ผู้รับมอบหมายทั้งหมด"
              renderValue={(option) => (
                <span className="flex min-w-0 items-center gap-3">
                  <UserIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{option.label}</span>
                </span>
              )}
            />
          </div>
```
`UserIcon` is already imported (`User as UserIcon`, line 2). The icon sits at `px-3`; with the 16 px icon and `gap-3` the text starts at 40 px, the same as the old `pl-10`. `sm:w-56` (224 px) fixes the width that the native select took from its longest option. Below `sm` the field stays `w-full`. `TodosPage/index.tsx:36-42` (URL `?assigneeId`, `replace: true`) does not change.

- [ ] **Step 16: TodoForm → `Combobox`**

Edit `apps/web/src/pages/TodosPage/components/TodoForm.tsx`.

Replace (line 1; NativeSelect has no other use in this file):
```tsx
import { NativeSelect } from '@/components/ui/native-select';
```
with:
```tsx
import { Combobox, type ComboOption } from '@/components/ui/combobox';
```
Replace:
```tsx
  const removeChecklist = (id: string) =>
    setForm({ ...form, checklist: (form.checklist || []).filter((c) => c.id !== id) });
```
with:
```tsx
  const removeChecklist = (id: string) =>
    setForm({ ...form, checklist: (form.checklist || []).filter((c) => c.id !== id) });

  const assigneeList = roomId ? (eligible.data ?? []) : staffUsers;
  const assigneeOptions: ComboOption[] = [
    { value: '', label: 'ไม่ระบุ' },
    ...assigneeList.map((u) => ({
      value: u.id,
      label: u.nickname || u.name,
      keywords: u.nickname ? [u.name] : undefined,
    })),
  ];
  // Editing a todo whose assignee is not in this list (e.g. GET /users is OWNER-only): show the
  // saved assignee's name instead of the native select's first row. The id is sent unchanged.
  const assigneeFallback: ComboOption | null =
    form.assigneeId &&
    editing?.assigneeId === form.assigneeId &&
    editing.assignee &&
    !assigneeList.some((u) => u.id === form.assigneeId)
      ? { value: form.assigneeId, label: editing.assignee.nickname || editing.assignee.name }
      : null;
```
Replace:
```tsx
                <NativeSelect wrapperClassName="max-w-full w-full" id={`${uiFieldId}-4`}
                  value={form.assigneeId || ''}
                  onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}
                >
                  <option value="">ไม่ระบุ</option>
                  {(roomId ? eligible.data ?? [] : staffUsers).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nickname || u.name}
                    </option>
                  ))}
                </NativeSelect>
```
with:
```tsx
                <Combobox
                  id={`${uiFieldId}-4`}
                  value={form.assigneeId || ''}
                  onChange={(value) => setForm({ ...form, assigneeId: value })}
                  options={assigneeOptions}
                  selectedOption={assigneeFallback}
                  // an id outside the list with no saved name: the native select showed "ไม่ระบุ"
                  placeholder="ไม่ระบุ"
                />
```
The label above it stays: `<label htmlFor={`${uiFieldId}-4`} className={cn(formLabelClass, 'flex items-center gap-1.5')}>` with `UserIcon` + "ผู้รับมอบหมาย". It is already style A and still names the trigger. The payload `assigneeId: form.assigneeId || undefined` and the save button's `disabled` do not change.

- [ ] **Step 17: Run the todo tests and see them pass**

```bash
cd apps/web && npx vitest run src/pages/TodosPage
```
Expected: `Test Files  4 passed (4)` and `Tests  10 passed (10)`:
- `TodoFilters.test.tsx`: 3
- `TodoForm.assignee.test.tsx`: 3
- `TodoForm.tags-frame.test.tsx`: 1 (unchanged)
- `home-link.test.tsx`: 3 (unchanged; its assertion `assigneeId=me` is kept on view switch)

- [ ] **Step 18: Type check + lint the todo files**

```bash
bash tools/check-types.sh web
cd apps/web && npx eslint src/pages/TodosPage/components/TodoFilters.tsx src/pages/TodosPage/components/TodoFilters.test.tsx src/pages/TodosPage/components/TodoForm.tsx src/pages/TodosPage/components/TodoForm.assignee.test.tsx
```
Expected: `Web: OK` and ESLint `0 errors`. One pre-existing warning is allowed: `TodoForm.tsx:130:5 Unused eslint-disable directive` is present at HEAD `69ab47516`, and this task does not touch that line. No other warning.

- [ ] **Step 19: Commit group B**

```bash
git add apps/web/src/pages/TodosPage/components/TodoFilters.tsx apps/web/src/pages/TodosPage/components/TodoFilters.test.tsx apps/web/src/pages/TodosPage/components/TodoForm.tsx apps/web/src/pages/TodosPage/components/TodoForm.assignee.test.tsx
git commit -F - <<'EOF'
feat(web): searchable assignee in todos filter and form (R2-4a part 2)

TodoFilters' assignee filter and TodoForm's assignee become Combobox.
The filter keeps its user icon, now drawn inside the trigger (text still
starts at 40px), keeps the "งานของฉัน" ('me') option and writes the same
?assigneeId values; it gets a fixed sm:w-56 because a button sizes to
its text. Editing a todo whose assignee is outside the list (every
non-OWNER role) now shows the saved name instead of "ไม่ระบุ"; the id
sent is unchanged and "ไม่ระบุ" still sends none.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
Expected: one commit. Do not push.

---

#### Group C — collections + prospects (StuckContractsSection, ProspectFilterBar)

- [ ] **Step 20: Write the failing tests**

20a. Create `apps/web/src/pages/CollectionsPage/components/StuckContractsSection.test.tsx` with exactly:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pickComboOption } from '@/test/combobox';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: api }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import StuckContractsSection from './StuckContractsSection';

const rows = [
  {
    contractId: 'c1',
    contractNumber: 'CT-0001',
    customerName: 'สมชาย ผ่อนดี',
    customerPhone: null,
    branchName: 'สาขาลาดพร้าว',
    assignedToId: null,
    assignedToName: null,
    daysIdle: 21,
    outstanding: 4500,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation((url: string) =>
    Promise.resolve({
      data:
        url === '/users'
          ? {
              data: [
                { id: 'u1', name: 'เมย์', role: 'SALES' },
                { id: 'u2', name: 'สมหญิง รักงาน', role: 'BRANCH_MANAGER' },
              ],
            }
          : rows,
    }),
  );
  api.post.mockResolvedValue({ data: {} });
});

describe('StuckContractsSection — reassign combobox (R2-4a)', () => {
  it('posts the picked staff id for the checked contracts', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <StuckContractsSection />
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole('checkbox', { name: 'เลือก CT-0001' }));
    await user.click(screen.getByRole('button', { name: 'มอบหมายใหม่ (1)' }));
    const confirm = screen.getByRole('button', { name: 'ยืนยัน' });
    const picker = screen.getByRole('combobox', { name: 'เลือกผู้รับผิดชอบใหม่' });
    expect(picker).toHaveTextContent('— เลือก —');
    expect(confirm).toBeDisabled();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/users'));

    await pickComboOption(user, 'เลือกผู้รับผิดชอบใหม่', 'สมหญิง รักงาน (BRANCH_MANAGER)', {
      search: 'สมหญิง',
    });

    expect(picker).toHaveTextContent('สมหญิง รักงาน (BRANCH_MANAGER)');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/overdue/bulk/assign', {
        contractIds: ['c1'],
        assignedToId: 'u2',
      }),
    );
  });
});
```

20b. `apps/web/src/pages/CustomersPage/__tests__/CustomersPage.test.tsx` gets a page-level strict test: pick → URL `owner` → API `assignedToId`. Make these replacements.

Replace:
```tsx
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
```
with:
```tsx
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
```
Replace:
```tsx
import type { CustomerRow, ProspectRow } from '../types';
```
with:
```tsx
import type { CustomerRow, ProspectRow } from '../types';
import { pickComboOption } from '@/test/combobox';
```
Then append at the end of the file, after the last `});`:
```tsx

describe('ตัวกรองผู้ดูแล — Combobox (R2-4a)', () => {
  it('ค้นหาแล้วเลือกได้ เขียน URL owner และส่ง assignedToId — "ทุกคน" ล้างค่า', async () => {
    const user = userEvent.setup();
    show('/customers?zone=shop&view=prospects');
    await screen.findByText('ผู้สนใจ หนึ่ง');
    const owner = screen.getByRole('combobox', { name: 'ผู้ดูแล' });
    expect(owner).toHaveAttribute('data-slot', 'combobox-trigger');
    expect(owner).toHaveClass('max-w-[130px]');
    expect(owner).toHaveTextContent('ทุกคน');
    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith('/users', { params: { limit: 200 } }),
    );

    await pickComboOption(user, 'ผู้ดูแล', 'ยังไม่มีผู้ดูแล');
    await waitFor(() => expect(lastListParams().assignedToId).toBe('unassigned'));
    expect(locationText()).toContain('owner=unassigned');

    await pickComboOption(user, 'ผู้ดูแล', 'พนักงาน ขายเก่ง', { search: 'ขายเก่ง' });
    await waitFor(() => expect(lastListParams().assignedToId).toBe('u9'));
    expect(locationText()).toContain('owner=u9');
    expect(owner).toHaveTextContent('พนักงาน ขายเก่ง');

    await pickComboOption(user, 'ผู้ดูแล', 'ทุกคน');
    await waitFor(() => expect(lastListParams().assignedToId).toBeUndefined());
    expect(locationText()).not.toContain('owner=');
  });

  it('เลือกผู้ดูแลคนเดิมซ้ำไม่รีเซ็ตหน้า', async () => {
    const user = userEvent.setup();
    show('/customers?zone=shop&view=prospects&owner=u9&page=3');
    await screen.findByText('ผู้สนใจ หนึ่ง');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'ผู้ดูแล' })).toHaveTextContent('พนักงาน ขายเก่ง'),
    );
    await pickComboOption(user, 'ผู้ดูแล', 'พนักงาน ขายเก่ง');
    expect(locationText()).toContain('page=3');
  });
});
```
(`show`, `lastListParams`, `locationText` and `mocks` already exist in this file, at lines 175-238. `mocks.role` is `'OWNER'` by default, and `/users` answers `[{ id: 'u9', name: 'พนักงาน ขายเก่ง' }]` (:221). The existing `:296-298` loop keeps passing unchanged, because the trigger keeps `aria-label="ผู้ดูแล"`.)

- [ ] **Step 21: Run them and watch them fail**

```bash
cd apps/web && npx vitest run src/pages/CollectionsPage/components/StuckContractsSection.test.tsx src/pages/CustomersPage/__tests__/CustomersPage.test.tsx
```
Expected: `Tests  3 failed | 56 passed (59)`.
- StuckContracts: no combobox menu opens, because the field is a `<select>`.
- CustomersPage (2): `toHaveAttribute("data-slot", "combobox-trigger")` receives `select-trigger`; the re-pick test fails
  inside `pickComboOption` (the owner filter is still a Radix `Select`, not a Combobox).

- [ ] **Step 22: StuckContractsSection → `Combobox`**

Edit `apps/web/src/pages/CollectionsPage/components/StuckContractsSection.tsx`.

Replace:
```tsx
import { NativeSelect } from '@/components/ui/native-select';
```
with:
```tsx
import { Combobox } from '@/components/ui/combobox';
import { formLabelClass } from '@/components/ui/form-styles';
```
Replace:
```tsx
  const { data: staff = [] } = useQuery<StaffUser[]>({
```
with:
```tsx
  const { data: staff = [], isLoading: staffLoading } = useQuery<StaffUser[]>({
```
Replace:
```tsx
          <div className="space-y-2">
            <label htmlFor={`${uiFieldId}-1`} className="text-xs text-muted-foreground leading-snug">
              เลือกผู้รับผิดชอบใหม่
            </label>
            <NativeSelect wrapperClassName="max-w-full w-full" id={`${uiFieldId}-1`}
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
            >
              <option value="">— เลือก —</option>
              {staff.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role})
                </option>
              ))}
            </NativeSelect>
          </div>
```
with:
```tsx
          <div>
            <label htmlFor={`${uiFieldId}-1`} className={formLabelClass}>
              เลือกผู้รับผิดชอบใหม่
            </label>
            <Combobox
              id={`${uiFieldId}-1`}
              value={targetUserId}
              onChange={(value) => setTargetUserId(value)}
              options={staff.map((u) => ({ value: u.id, label: `${u.name} (${u.role})` }))}
              placeholder="— เลือก —"
              loading={staffLoading}
            />
          </div>
```
"— เลือก —" was an empty first option that only kept "ยืนยัน" disabled. It is now the placeholder. "ยืนยัน" still disables on `!targetUserId`, the POST `{ contractIds, assignedToId }` does not change, and success still resets `targetUserId` to `''`.

- [ ] **Step 23: ProspectFilterBar owner filter → `Combobox`**

Edit `apps/web/src/pages/CustomersPage/components/ProspectFilterBar.tsx`.

Replace:
```tsx
import ResponsiveFilterPanel from '@/components/ui/ResponsiveFilterPanel';
```
with:
```tsx
import ResponsiveFilterPanel from '@/components/ui/ResponsiveFilterPanel';
import { Combobox } from '@/components/ui/combobox';
```
Replace:
```tsx
        <FilterSelect
          ariaLabel="ผู้ดูแล"
          placeholder="ทุกคน"
          width={130}
          value={owner}
          onChange={(value) => setFilters({ owner: value })}
          groups={[
            { options: [{ value: UNASSIGNED, label: 'ยังไม่มีผู้ดูแล' }] },
            ...(staff.length > 0
              ? [{ label: 'พนักงาน', options: staff.map((s) => ({ value: s.id, label: s.name })) }]
              : []),
          ]}
        />
```
with:
```tsx
        {/* The only searchable filter here (staff list up to 200) — the siblings stay FilterSelect.
            '' = ทุกคน, so FilterSelect's ALL sentinel is not needed. */}
        <Combobox
          aria-label="ผู้ดูแล"
          value={owner}
          // A re-pick of the current owner keeps the page (FilterSelect fired no change).
          onChange={(value) => {
            if (value !== owner) setFilters({ owner: value });
          }}
          options={[
            { value: '', label: 'ทุกคน' },
            { value: UNASSIGNED, label: 'ยังไม่มีผู้ดูแล' },
            ...staff.map((s) => ({ value: s.id, label: s.name, group: 'พนักงาน' })),
          ]}
          placeholder="ทุกคน"
          className="max-w-[130px]"
        />
```
`FilterSelect.tsx` does not change, and the four sibling filters stay `FilterSelect`. `UNASSIGNED` (`'unassigned'`) is still exported. `useCustomersQuery.ts:304` (`owner → params.assignedToId`) does not change.

- [ ] **Step 24: Run them and see them pass, plus the neighbours**

```bash
cd apps/web && npx vitest run src/pages/CollectionsPage src/pages/CustomersPage
```
Expected: every file passes, with 0 failed. That includes:
- `StuckContractsSection.test.tsx` 1
- `CustomersPage.test.tsx` 58
- `CustomerTagDialog.test.tsx` 5 (it renders `ProspectFilterBar` with `staff={[]}` and drives the `แท็ก` FilterSelect only)
- `tabVisibility.test.tsx`

- [ ] **Step 25: Type check + lint group C files**

```bash
bash tools/check-types.sh web
cd apps/web && npx eslint src/pages/CollectionsPage/components/StuckContractsSection.tsx src/pages/CollectionsPage/components/StuckContractsSection.test.tsx src/pages/CustomersPage/components/ProspectFilterBar.tsx src/pages/CustomersPage/__tests__/CustomersPage.test.tsx
```
Expected: `Web: OK` and ESLint `0 errors`, no new warnings.

- [ ] **Step 26: Commit group C**

```bash
git add apps/web/src/pages/CollectionsPage/components/StuckContractsSection.tsx apps/web/src/pages/CollectionsPage/components/StuckContractsSection.test.tsx apps/web/src/pages/CustomersPage/components/ProspectFilterBar.tsx apps/web/src/pages/CustomersPage/__tests__/CustomersPage.test.tsx
git commit -F - <<'EOF'
feat(web): searchable staff in stuck-contract reassign + prospect owner (R2-4a part 3)

The collections "มอบหมายใหม่" picker and the prospects "ผู้ดูแล" filter
become Combobox. The reassign POST body and the prospect ?owner /
assignedToId values do not change ('' = ทุกคน, 'unassigned' =
ยังไม่มีผู้ดูแล, staff under a "พนักงาน" group). The owner trigger keeps
its 130px cap; its list keeps min-w-64 and is portalled, so it opens
wider than the trigger and stays inside the 390px filter sheet. Only the
owner filter converts; the other prospect filters stay FilterSelect.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
Expected: one commit. Do not push.

---

#### Verify the whole task

- [ ] **Step 27: Field-scale against `baseline-r2`**

1. Run `npm run local:preview` (it restarts the preview, which is stale after the source edits) and wait for `Started http://localhost:5195/inbox`.
2. Measure the routes this task touches (`todo-form` is a Round 1 route; the `r2-*` ids are Task 1's):
   ```bash
   node tools/field-scale/check.mjs --label t11-staff --routes todo-form,r2-todos-list,r2-inbox-filter,r2-inbox-follow-up,r2-inbox-service-request,r2-inbox-service-request-edit,r2-inbox-facebook-comment,r2-collections-stuck-reassign,r2-prospect-filters
   node tools/field-scale/check.mjs --compare baseline-r2 t11-staff
   echo "exit=$?"
   ```
3. Expected:
   - `menu probes: 8 pass · 0 fail` — `inbox-owner-menu` (r2-inbox-filter) and `prospect-owner-menu` (r2-prospect-filters)
     at 1440 and 390, light/dark; PASS on `baseline-r2` too (both triggers keep their names and Radix's `aria-controls`).
   - `New findings: 0`, no "Cells rendered … but not in …", no "fact count fell" (each converted control is still one control fact and one target fact: native `<select>` / Radix trigger → `button[role=combobox]`), no MENU line, and `exit=0`.
   - `todo-form` had 0 findings in all 6 cells in the Round 1 final run (`.tmp/field-scale/final-polish/results.json`), and its factCount at 1440 light was 22. It must stay 22.
4. If `baseline-r2` holds an open finding on a converted control, it comes back re-keyed under clause (a) because the control is re-kinded. Only these pairs may be accepted, and the task report lists each one with its baseline evidence (same property, same cell, same detail):

   | route | baseline-r2 key → t11-staff key |
   |---|---|
   | `todo-form` | `…@native-select\|ผู้รับมอบหมาย\|0` → `…@combobox\|ผู้รับมอบหมาย\|0` (TodoFilters, page behind the dialog) |
   | `todo-form` | `…@native-select\|ผู้รับมอบหมาย\|1` → `…@combobox\|ผู้รับมอบหมาย\|1` (TodoForm, in the dialog — dup counts the whole page in DOM order) |
   | `todo-form` | F3 target keys `target-field\|ผู้รับมอบหมาย\|0` → `target-combobox\|ผู้รับมอบหมาย\|0`, and TodoForm's unnamed `target-field\|\|n` → `target-combobox\|\|0`, with the later `target-field\|\|n` of that dialog shifting down by one |
   | `r2-todos-list` | `…@native-select\|ผู้รับมอบหมาย\|0` → `…@combobox\|ผู้รับมอบหมาย\|0` (TodoFilters on the page, no dialog) |
   | `r2-inbox-filter` | `…@select-trigger\|ผู้ดูแล\|0` → `…@combobox\|ผู้ดูแล\|0` |
   | `r2-inbox-follow-up` | `…@native-select\|ผู้รับผิดชอบงาน\|0` → `…@combobox\|ผู้รับผิดชอบงาน\|0` |
   | `r2-inbox-service-request` and `r2-inbox-service-request-edit` | `…@native-select\|ผู้รับผิดชอบ\|0` → `…@combobox\|ผู้รับผิดชอบ\|0` |
   | `r2-inbox-facebook-comment` | `…@native-select\|ผู้รับผิดชอบคอมเมนต์\|0` → `…@combobox\|ผู้รับผิดชอบคอมเมนต์\|0` |
   | `r2-collections-stuck-reassign` | `…@native-select\|เลือกผู้รับผิดชอบใหม่\|0` → `…@combobox\|เลือกผู้รับผิดชอบใหม่\|0` |
   | `r2-prospect-filters` | `…@select-trigger\|ผู้ดูแล\|0` → `…@combobox\|ผู้ดูแล\|0` |

   Field names do not change for the relabelled neighbours (wrapping label → `htmlFor` label), so their keys stay the same.
5. Any other new finding is created by this task and must be fixed, for example an F1 label/corner mismatch in the ChatServiceRequestDialog grid row (assignee + due at ≥640). Both sides of that row are `formControlClass` with `formLabelClass` labels, so none is expected.
6. A baseline F2 `valueOverflowX@select-trigger|ผู้ดูแล|0` on `r2-prospect-filters` (Radix value text wider than 130 px) shows up as **Fixed** only because the collector reads `[data-slot=select-value]`, which `Combobox` does not have. The trigger text is truncated with a `title`. Report it that way, not as a fix.
7. Open the 390-light and 1440-dark screenshots of `todo-form` and `r2-prospect-filters`. Check:
   - The user icon sits inside the TodoFilters field, with the text after it.
   - The owner trigger is ≤130 px with "ทุกคน" readable.
   - In both themes the fields look like their neighbours: 44 px, 8 px corners, `border-input`.
8. Leave the verified preview running (AGENTS.md). `npm run local:stop` stops it at the end of the day.

- [ ] **Step 28: Full web suite and build before the PR**

```bash
npm run test --workspace=apps/web
npm run build --workspace=apps/web
npm run lint --workspace=apps/web
```
Expected: the build and lint succeed (0 lint errors). Tests: 0 failed, apart from the Windows-only failures named in the header's Global Constraints (`headerNowrap`, `tabsButtonRowsNowrap`, `RecordPaymentWizard.preview-params` CRLF regexes; `TradeInFlow` / `ProductsPage` timeouts under full-suite load, which pass when run alone). The PR body states what ran on Windows, that `local:check` must run on Linux/CI, and that the e2e specs were checked by reading only.

---

### Task 12: Models (5) + suppliers (2) → `Combobox` (R2-4b)

**Why:** Appendix ค row group R2-4b: five model fields (~40–150 options) and two supplier fields (~50–200) become searchable `Combobox`es. Behaviour stays byte-for-byte: the same values reach state and the API, and every side effect of `onChange` is kept (model resets colour/storage, StockAlerts copies the catalog category, QuickBuy clears storage/colour/inspection, ReferenceQuestionnaire keeps the `model|storage` value). A re-pick of the current option does nothing, as with the native/Radix selects today (call-site guard — header Behaviour "Pick"). Where the spec and the code differ, this task follows the code (plan-notes / facts-callsites §0):
- **ProductInfoCard รุ่น** — spec §6.5 says the field relies on the browser `required` popup only. It does not: `ProductCreatePage/index.tsx:306-309` already guards with `toast.error('กรุณาเลือกรุ่น')`, but the native `required` fired first and hid it. After the switch the Combobox's `required` is `aria-required` only, so that existing toast becomes the guard. No second inline error is added. (If สาขา or ราคาทุน is also empty, the browser's `required` popup on those native fields still comes first, because they now come first in the form's validation order.)
- **StockAlertsPage รุ่น** — the only field in this group guarded by the browser popup alone. It gets an explicit check (spec §6.5): `if (!form.model) { setModelError('กรุณาเลือกรุ่น'); return; }` before `createMutation.mutate`, plus `invalid` on the Combobox and the message under it (`role="alert"`, linked by `aria-describedby`). The error clears on pick and on `resetForm`. Pre-existing and kept: the pick copies the catalog entry's category, and `getModels(brand, 'PHONE_USED')` lists the catalog's `PHONE_NEW` entries, so picking a model under "มือถือมือสอง" flips the category to "มือถือใหม่". The test pins this; it is not changed here.
- **BranchSupplierCard** — the first option's text doubled as the loading/error message (`กำลังโหลด...` / `โหลดข้อมูลไม่ได้`). These become the Combobox `loading` / `error` props, plus `onRetry` → the query's `refetch` (new prop `onRetrySuppliers`). The `''` option stays as `ไม่ระบุ`, so the user can clear the supplier again. The fetch is unchanged: `GET /suppliers?isActive=true` with **no limit**, so the API returns the first **50** active suppliers (`suppliers.service.ts:25`), not "~100" as the spec says. That is a data limit outside this task. Follow-up, not done here: pass `limit: 200` like `usePurchaseOrdersData.ts:96`.
- **POListTab** — the Radix sentinel `__all__` disappears: the Combobox takes `''` directly (`ทุกผู้จัดจำหน่าย`), and the page state is `''` exactly as before. Its `renderOption` (long names wrap) replaces the whole row, so it draws the check mark on the current value itself (`text-primary!`, as the Combobox's own) — the Radix `SelectItem` showed one. สถานะ and ช่วงเวลา (≤ 8 options) stay on the local Radix `FilterSelect`.
- **QuickBuyModal** — `id="quick-buy-model"` and the native `disabled` attribute are kept: `tools/field-scale/routes.mjs` waits for `#quick-buy-model:not([disabled])` (a test pins it). The trigger copies PurchaseSelect's skin (`bg-card border-border px-4 shadow-sm` + open ring), because the ความจุ PurchaseSelect stands next to it in the same row and F1 compares background and border colour.
- **AccessoryItemRow** — the visible label is the row's shared 72px `LabeledControl` `<span>` (also used by หัวชาร์จ, ฟิล์ม and รหัสสินค้า), so the trigger keeps its `aria-label="สำหรับรุ่น"`. `className={selectCls}` keeps the compact row skin, exactly as `NativeSelect` merged it. The model is optional (`po-catalog.util.ts allItemsComplete`), so `— เลือกรุ่น —` stays as a `''` option that clears it.
- **ReferenceQuestionnaire** — the wrapping `<label>` becomes `<label htmlFor>` + sibling trigger. A label wrapping a `role=combobox` button would put the selected value into the trigger's accessible name (spec §6.1).
- Labels: every converted field that had a real `<label htmlFor>` keeps it unchanged (same classes as its siblings — switching one label to `formLabelClass` would make its row's labels differ). QuickBuyModal's label is already `formLabelClass` (a STYLE_A host). Pre-existing, noted and fixed here because this task edits the same block: `apps/api/e2e/ui-fields/shared-controls.audit-spec.ts:87` clicked a button `+ Reorder Point` that no longer exists (it reads `+ จุดสั่งซื้อซ้ำ`, `StockAlertsPage.tsx:411`), so the stock-alert part of that audit could not reach the field. It is a one-word fix.

**Files:**
- Modify: `apps/web/src/pages/ProductCreatePage/components/ProductInfoCard.tsx` (imports :2-3; รุ่น block :233-247)
- Modify: `apps/web/src/pages/ProductCreatePage/components/BranchSupplierCard.tsx` (imports :2-3; props :14-15; destructure :25-27; ผู้จัดจำหน่าย :55-68)
- Modify: `apps/web/src/pages/ProductCreatePage/index.tsx` (supplier query :69; `<BranchSupplierCard>` props :380-381)
- Modify: `apps/web/src/pages/StockAlertsPage.tsx` (imports :2-3; state :100; `resetForm` :213-215; submit :576-578; รุ่น :613-627)
- Modify: `apps/web/src/pages/PurchaseOrdersPage/components/wizard/items/AccessoryItemRow.tsx` (imports :1-2; helper before :79; เคส :114-121)
- Modify: `apps/web/src/pages/TradeInPage/components/ReferenceQuestionnaire.tsx` (imports :1-2; :19; :37-52)
- Modify: `apps/web/src/components/trade-in/QuickBuyModal.tsx` (import :53; รุ่น iPhone :893-911)
- Modify: `apps/web/src/pages/PurchaseOrdersPage/components/POListTab.tsx` (import :29; ผู้จัดจำหน่าย :498-502)
- Create (tests): `apps/web/src/pages/ProductCreatePage/__tests__/ProductCreatePage.combobox.test.tsx`, `apps/web/src/pages/ProductCreatePage/__tests__/BranchSupplierCard.test.tsx`, `apps/web/src/pages/__tests__/StockAlertsPage.model.test.tsx`, `apps/web/src/pages/TradeInPage/components/ReferenceQuestionnaire.test.tsx`
- Modify (tests): `apps/web/src/pages/PurchaseOrdersPage/components/wizard/StepItems.test.tsx` (:1-3, :241-247), `apps/web/src/components/trade-in/TradeInFlow.test.tsx` (:10, :89-91, :187, :231), `apps/web/src/pages/PurchaseOrdersPage/components/POListTab.test.tsx` (:1-3, :27, :42, end)
- Modify (api ui-fields audits, not run on Windows): `apps/api/e2e/ui-fields/shared-controls.audit-spec.ts` (:74-78, :86-91), `apps/api/e2e/ui-fields/fields.audit-spec.ts` (:192-196), `apps/api/e2e/ui-fields/po-filters.audit-spec.ts` (:67, :108-115)
- No change, verified: `apps/web/src/components/trade-in/PurchaseSelect.tsx` (still used for สาขา / ความจุ / สีเครื่อง); `apps/web/src/components/ui/field-guards.inventory.test.ts` (QuickBuyModal/PurchaseSelect guards and the STYLE_A label guard still hold — no label is touched); `tools/field-scale/routes.mjs` (Task 1 owns it; `#quick-buy-model` is kept); web e2e — none drives these fields (Step 1).

**Interfaces:**
- Consumes (Task 4): `Combobox`, `type ComboOption` from `@/components/ui/combobox` — props used: `value`, `onChange`, `options`, `id`, `aria-label`, `placeholder`, `required`, `disabled`, `invalid`, `aria-describedby`, `loading`, `error`, `onRetry`, `renderOption`, `className`, `wrapperClassName`; `pickComboOption`, `openCombobox` from `@/test/combobox`; the global `scrollIntoView` no-op in `src/test/setup.ts`. DOM contract: `[data-slot=combobox-content]`, default `searchLabel` `'ค้นหา'`, `id` and native `disabled` on the trigger, `loading` / `error` shown whatever `options` holds, `renderOption` replacing the row content only, one `span[data-slot="combobox-value"]` followed by the chevron (the trigger's first `svg`) — all header Behaviour lines.
- Produces:
  - `BranchSupplierCardProps.onRetrySuppliers: () => void` (new, required; the only caller is `ProductCreatePage/index.tsx`).
  - Triggers named by their labels: `รุ่น *` (product), `รุ่น` (reorder point dialog), `สำหรับรุ่น` (PO เคส row, `aria-label`), `รุ่นและความจุ`, `รุ่น iPhone *` (`#quick-buy-model`, native `disabled` while the catalog loads), `ผู้จัดจำหน่าย` (product form, `<label htmlFor>`; PO list filter, `aria-label`).
  - StockAlertsPage: `p#<uiFieldId>-3-error[role=alert]` with `กรุณาเลือกรุ่น` while the check fails.

---

- [ ] **Step 1: Re-check the loose e2e locators (cross-task note)**

```bash
grep -rn 'select, \[role="combobox"\]\|locator(.select.)' apps/web/e2e
```

Expected: 13 lines, all on screens this task does not convert — `admin-settings.spec.ts:367` (`/audit-logs`), `crud-flows.spec.ts:84,594,659` (customers / contract create / `/stock`), `expense-workflow.spec.ts:124` and `finance.spec.ts:294` (`/expenses`), `installment-calculation.spec.ts:236` (`/contracts/create`), `payments.spec.ts:95` (`/payments`), `reports-notifications.spec.ts:159` (`/notifications`), `stock-management.spec.ts:57,68` (`/stock`, not `/stock/alerts`), `template-editor.spec.ts:128` (`/settings/pricing-templates`), `trade-in-flow.spec.ts:36` (`/trade-in` list tab — QuickBuyModal is not opened, ReferenceQuestionnaire is on the `questions` tab). Nothing to change. A line on `/products/create`, `/stock/alerts`, `/purchase-orders` or the trade-in questions tab would have to be updated in this task.

- [ ] **Step 2: Write the failing tests for ProductInfoCard รุ่น and BranchSupplierCard ผู้จัดจำหน่าย**

Create `apps/web/src/pages/ProductCreatePage/__tests__/ProductCreatePage.combobox.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import api from '@/lib/api';
import { pickComboOption } from '@/test/combobox';
import ProductCreatePage from '../index';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  getErrorMessage: () => 'บันทึกไม่สำเร็จ',
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ProductCreatePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === '/branches') return { data: [{ id: 'branch-1', name: 'สาขาหลัก' }] };
    if (url === '/suppliers') {
      return { data: { data: [{ id: 'sup-1', name: 'บริษัท มือถือดี จำกัด' }, { id: 'sup-2', name: 'ห้างหุ้นส่วน ไอโฟนไทย' }] } };
    }
    if (url.startsWith('/pricing-templates/lookup?')) {
      return { data: { cashPrice: '30000', installmentBestchoicePrice: '35000', installmentFinancePrice: '36000' } };
    }
    throw new Error(`unexpected GET ${url}`);
  });
  vi.mocked(api.post).mockResolvedValue({ data: { id: 'product-1' } });
});

describe('ProductCreatePage — รุ่น (Combobox)', () => {
  it('is disabled until a brand is chosen; the picked model and supplier go into POST /products', async () => {
    const user = userEvent.setup();
    renderPage();
    const model = await screen.findByRole('combobox', { name: 'รุ่น *' });
    expect(model).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('ยี่ห้อ *'), 'Apple');
    expect(model).toBeEnabled();

    await pickComboOption(user, 'รุ่น *', 'iPhone 16 Pro', { search: '16 pro' });
    expect(model).toHaveTextContent('iPhone 16 Pro');
    await pickComboOption(user, 'ผู้จัดจำหน่าย', 'ห้างหุ้นส่วน ไอโฟนไทย');
    await user.selectOptions(screen.getByLabelText('สาขา *'), 'branch-1');
    await user.type(screen.getByLabelText('ราคาทุน (บาท) *'), '25000');
    await screen.findByDisplayValue('30,000'); // price template filled from brand + model
    await user.click(screen.getByRole('button', { name: 'บันทึกสินค้า' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith(
      '/products',
      expect.objectContaining({
        brand: 'Apple',
        model: 'iPhone 16 Pro',
        name: 'Apple iPhone 16 Pro',
        category: 'PHONE_NEW',
        supplierId: 'sup-2',
        branchId: 'branch-1',
        costPrice: 25000,
      }),
    );
  });

  it('required: with a brand but no model, saving shows กรุณาเลือกรุ่น and posts nothing', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(await screen.findByLabelText('ยี่ห้อ *'), 'Apple');
    await user.selectOptions(screen.getByLabelText('สาขา *'), 'branch-1');
    await user.type(screen.getByLabelText('ราคาทุน (บาท) *'), '25000');
    await user.type(screen.getByLabelText('จำนวนเงินราคา 1'), '30000');
    await user.click(screen.getByRole('button', { name: 'บันทึกสินค้า' }));

    expect(toast.error).toHaveBeenCalledWith('กรุณาเลือกรุ่น');
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: 'รุ่น *' })).toHaveAttribute('aria-required', 'true');
  });

  it('re-picking the current model keeps the chosen storage (a native select fired no change)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(await screen.findByLabelText('ยี่ห้อ *'), 'Apple');
    await pickComboOption(user, 'รุ่น *', 'iPhone 16 Pro', { search: '16 pro' });
    await user.click(screen.getByRole('button', { name: '256GB' }));
    expect(screen.getByRole('button', { name: '256GB' })).toHaveAttribute('aria-pressed', 'true');

    await pickComboOption(user, 'รุ่น *', 'iPhone 16 Pro', { search: '16 pro' });
    expect(screen.getByRole('button', { name: '256GB' })).toHaveAttribute('aria-pressed', 'true');

    await pickComboOption(user, 'รุ่น *', 'iPhone 15');
    expect(screen.getByRole('combobox', { name: 'รุ่น *' })).toHaveTextContent('iPhone 15');
    expect(screen.getByRole('button', { name: '256GB' })).toHaveAttribute('aria-pressed', 'false');
  });
});
```

Create `apps/web/src/pages/ProductCreatePage/__tests__/BranchSupplierCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { openCombobox, pickComboOption } from '@/test/combobox';
import BranchSupplierCard from '../components/BranchSupplierCard';

const suppliers = [
  { id: 'sup-1', name: 'บริษัท มือถือดี จำกัด' },
  { id: 'sup-2', name: 'ห้างหุ้นส่วน ไอโฟนไทย' },
];

function renderCard(over: Partial<React.ComponentProps<typeof BranchSupplierCard>> = {}) {
  const props: React.ComponentProps<typeof BranchSupplierCard> = {
    branchId: '',
    supplierId: '',
    costPrice: '',
    branchList: [{ id: 'branch-1', name: 'สาขาหลัก' }],
    suppliers,
    suppliersLoading: false,
    suppliersError: false,
    onRetrySuppliers: vi.fn(),
    inputCls: '',
    onChange: vi.fn(),
    ...over,
  };
  render(<BranchSupplierCard {...props} />);
  return props;
}

describe('BranchSupplierCard — ผู้จัดจำหน่าย (Combobox)', () => {
  it('shows ไม่ระบุ when none is chosen and sends the picked supplier id', async () => {
    const user = userEvent.setup();
    const p = renderCard();
    expect(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' })).toHaveTextContent(/^ไม่ระบุ$/);
    await pickComboOption(user, 'ผู้จัดจำหน่าย', 'ห้างหุ้นส่วน ไอโฟนไทย', { search: 'ไอโฟน' });
    expect(p.onChange).toHaveBeenCalledWith('supplierId', 'sup-2');
  });

  it('ไม่ระบุ clears a chosen supplier', async () => {
    const user = userEvent.setup();
    const p = renderCard({ supplierId: 'sup-1' });
    expect(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' })).toHaveTextContent('บริษัท มือถือดี จำกัด');
    await pickComboOption(user, 'ผู้จัดจำหน่าย', 'ไม่ระบุ');
    expect(p.onChange).toHaveBeenCalledWith('supplierId', '');
  });

  it('while suppliers load the list says กำลังโหลด…', async () => {
    const user = userEvent.setup();
    renderCard({ suppliers: [], suppliersLoading: true });
    await openCombobox(user, 'ผู้จัดจำหน่าย');
    expect(screen.getByText('กำลังโหลด…')).toBeInTheDocument();
  });

  it('when suppliers fail the list says โหลดรายการไม่สำเร็จ and ลองใหม่ refetches', async () => {
    const user = userEvent.setup();
    const p = renderCard({ suppliers: [], suppliersError: true });
    await openCombobox(user, 'ผู้จัดจำหน่าย');
    expect(screen.getByText('โหลดรายการไม่สำเร็จ')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    expect(p.onRetrySuppliers).toHaveBeenCalledTimes(1);
    expect(p.onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run them and confirm they fail**

```bash
npm run test --workspace=apps/web -- src/pages/ProductCreatePage/__tests__
```

Expected: FAIL. `Test Files  2 failed (2)` and `Tests  7 failed (7)`:
- every test that opens รุ่น or ผู้จัดจำหน่าย fails in `pickComboOption` / `openCombobox`, because both fields are still native `<select>` elements and no Combobox menu (listbox) opens;
- the `required` test fails on `expect(toast.error).toHaveBeenCalledWith('กรุณาเลือกรุ่น')`, because the native `required` on รุ่น blocks the submit before `handleSubmit` runs.

- [ ] **Step 4: Switch ProductInfoCard รุ่น to `Combobox`**

In `apps/web/src/pages/ProductCreatePage/components/ProductInfoCard.tsx` replace

```tsx
import { NativeSelect } from '@/components/ui/native-select';
import { useId as useFieldId } from 'react';
```

with

```tsx
import { NativeSelect } from '@/components/ui/native-select';
import { Combobox } from '@/components/ui/combobox';
import { useId as useFieldId } from 'react';
```

and replace

```tsx
                <label htmlFor={`${fieldId}-7`} className="block text-sm font-medium text-foreground mb-3">รุ่น *</label>
                <NativeSelect id={`${fieldId}-7`}
                  value={form.model}
                  onChange={(e) => onModelChange(e.target.value)}
                  className={inputCls}
                  required
                  disabled={!form.brand}
                >
                  <option value="">เลือกรุ่น</option>
                  {availableModels.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </NativeSelect>
```

with

```tsx
                <label htmlFor={`${fieldId}-7`} className="block text-sm font-medium text-foreground mb-3">รุ่น *</label>
                <Combobox
                  id={`${fieldId}-7`}
                  value={form.model}
                  onChange={(model) => {
                    // A native select fired no change for the same option — keep colour/storage.
                    if (model !== form.model) onModelChange(model);
                  }}
                  options={availableModels.map((m) => ({ value: m.name, label: m.name }))}
                  placeholder="เลือกรุ่น"
                  required
                  disabled={!form.brand}
                />
```

(The helper `ไม่พบรุ่นสำหรับประเภทนี้` below it, `handleModelChange` and the existing `toast.error('กรุณาเลือกรุ่น')` guard in `index.tsx` are unchanged.)

- [ ] **Step 5: Switch BranchSupplierCard ผู้จัดจำหน่าย to `Combobox` and wire the retry**

In `apps/web/src/pages/ProductCreatePage/components/BranchSupplierCard.tsx` replace

```tsx
import { NativeSelect } from '@/components/ui/native-select';
import { useId as useFieldId } from 'react';
```

with

```tsx
import { NativeSelect } from '@/components/ui/native-select';
import { Combobox } from '@/components/ui/combobox';
import { useId as useFieldId } from 'react';
```

replace

```tsx
  suppliersError: boolean;
  inputCls: string;
```

with

```tsx
  suppliersError: boolean;
  /** Refetch the supplier list (the field's "ลองใหม่" button). */
  onRetrySuppliers: () => void;
  inputCls: string;
```

replace

```tsx
  suppliersError,
  inputCls,
  onChange,
}: BranchSupplierCardProps) {
```

with

```tsx
  suppliersError,
  onRetrySuppliers,
  inputCls,
  onChange,
}: BranchSupplierCardProps) {
```

and replace

```tsx
            <NativeSelect id={`${fieldId}-2`}
              value={supplierId}
              onChange={(e) => onChange('supplierId', e.target.value)}
              className={inputCls}
            >
              <option value="">
                {suppliersLoading ? 'กำลังโหลด...' : suppliersError ? 'โหลดข้อมูลไม่ได้' : 'ไม่ระบุ'}
              </option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
```

with

```tsx
            <Combobox
              id={`${fieldId}-2`}
              value={supplierId}
              onChange={(value) => onChange('supplierId', value)}
              options={[
                { value: '', label: 'ไม่ระบุ' },
                ...suppliers.map((s) => ({ value: s.id, label: s.name })),
              ]}
              loading={suppliersLoading}
              error={suppliersError}
              onRetry={onRetrySuppliers}
            />
```

In `apps/web/src/pages/ProductCreatePage/index.tsx` replace

```tsx
  const { data: supplierResult, isLoading: suppliersLoading, isError: suppliersError } = useQuery<{
```

with

```tsx
  const {
    data: supplierResult,
    isLoading: suppliersLoading,
    isError: suppliersError,
    refetch: refetchSuppliers,
  } = useQuery<{
```

and replace

```tsx
            suppliersError={suppliersError}
            inputCls={inputCls}
```

with

```tsx
            suppliersError={suppliersError}
            onRetrySuppliers={() => void refetchSuppliers()}
            inputCls={inputCls}
```

(The query itself — `['suppliers-active']`, `GET /suppliers` with `{ isActive: 'true' }`, `retry: 2` — is unchanged; see Why for the 50-row limit.)

- [ ] **Step 6: Run them and confirm they pass**

```bash
npm run test --workspace=apps/web -- src/pages/ProductCreatePage/__tests__
```

Expected: `Test Files  2 passed (2)`, `Tests  7 passed (7)`.

- [ ] **Step 7: Write the failing test for StockAlertsPage รุ่น**

Create `apps/web/src/pages/__tests__/StockAlertsPage.model.test.tsx`:

```tsx
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import { pickComboOption } from '@/test/combobox';
import StockAlertsPage from '../StockAlertsPage';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorMessage: () => 'บันทึกไม่สำเร็จ',
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'owner-1', role: 'OWNER', branchId: null } }),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <StockAlertsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function openCreate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: '+ จุดสั่งซื้อซ้ำ' }));
  return screen.getByRole('dialog', { name: 'สร้าง จุดสั่งซื้อซ้ำ ใหม่' });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === '/branches') return { data: [{ id: 'branch-1', name: 'สาขาหลัก' }] };
    if (url === '/reorder-points/low-stock') return { data: { totalLowStock: 0, data: [] } };
    if (url === '/reorder-points') return { data: [] };
    if (url === '/reorder-points/alerts') return { data: { data: [], total: 0 } };
    throw new Error(`unexpected GET ${url}`);
  });
  vi.mocked(api.post).mockResolvedValue({ data: { id: 'rp-1' } });
});

describe('StockAlertsPage — รุ่น (Combobox) in the create dialog', () => {
  it('is disabled until a brand is chosen; the picked model goes into POST /reorder-points', async () => {
    const user = userEvent.setup();
    renderPage();
    const dialog = await openCreate(user);
    const model = within(dialog).getByRole('combobox', { name: 'รุ่น' });
    expect(model).toBeDisabled();
    await user.selectOptions(within(dialog).getByLabelText('แบรนด์'), 'Apple');
    expect(model).toBeEnabled();

    await pickComboOption(user, 'รุ่น', 'iPhone 16 Pro', { search: '16 pro' });
    expect(model).toHaveTextContent('iPhone 16 Pro');
    await user.selectOptions(within(dialog).getByLabelText('สาขา'), 'branch-1');
    await user.click(within(dialog).getByRole('button', { name: 'บันทึก' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/reorder-points', {
        brand: 'Apple',
        model: 'iPhone 16 Pro',
        storage: undefined,
        category: 'PHONE_NEW',
        branchId: 'branch-1',
        minQuantity: 1,
        reorderQuantity: 5,
      }),
    );
  });

  it('picking a model sets the category from the catalog entry and clears the storage', async () => {
    const user = userEvent.setup();
    renderPage();
    const dialog = await openCreate(user);
    // Pre-existing: getModels(brand, 'PHONE_USED') lists the catalog's PHONE_NEW entries, and the
    // pick copies the entry's category — so the category flips to มือถือใหม่ (kept as is).
    await user.selectOptions(within(dialog).getByLabelText('ประเภท'), 'PHONE_USED');
    await user.selectOptions(within(dialog).getByLabelText('แบรนด์'), 'Apple');
    await pickComboOption(user, 'รุ่น', 'iPhone 16 Pro', { search: '16 pro' });
    await user.selectOptions(within(dialog).getByLabelText('ความจุ (ไม่บังคับ)'), '256GB');
    expect(within(dialog).getByLabelText('ประเภท')).toHaveValue('PHONE_NEW');

    await pickComboOption(user, 'รุ่น', 'iPhone 15');
    expect(within(dialog).getByLabelText('ความจุ (ไม่บังคับ)')).toHaveValue('');
  });

  it('required: saving with no model shows กรุณาเลือกรุ่น under the field and posts nothing; picking clears it', async () => {
    const user = userEvent.setup();
    renderPage();
    const dialog = await openCreate(user);
    await user.selectOptions(within(dialog).getByLabelText('แบรนด์'), 'Apple');
    await user.selectOptions(within(dialog).getByLabelText('สาขา'), 'branch-1');
    await user.click(within(dialog).getByRole('button', { name: 'บันทึก' }));

    const model = within(dialog).getByRole('combobox', { name: 'รุ่น' });
    expect(await within(dialog).findByText('กรุณาเลือกรุ่น')).toBeInTheDocument();
    expect(model).toHaveAttribute('aria-invalid', 'true');
    expect(model).toHaveAccessibleDescription('กรุณาเลือกรุ่น');
    expect(api.post).not.toHaveBeenCalled();

    await pickComboOption(user, 'รุ่น', 'iPhone 15');
    expect(within(dialog).queryByText('กรุณาเลือกรุ่น')).toBeNull();
    expect(model).not.toHaveAttribute('aria-invalid', 'true');
  });
});
```

(The dialog is looked up by its title so that, while the รุ่น menu — also `role=dialog` — is open, the locator is still unique.)

- [ ] **Step 8: Run it and confirm it fails**

```bash
npm run test --workspace=apps/web -- src/pages/__tests__/StockAlertsPage.model.test.tsx
```

Expected: FAIL, `Tests  3 failed (3)`. The first two fail in `pickComboOption`, because รุ่น is a native `<select>` and no Combobox menu opens. The third fails with `Unable to find an element with the text: กรุณาเลือกรุ่น`: jsdom's `requestSubmit` runs the native `required` check, the empty รุ่น `<select>` blocks the submit, and the page has no message of its own.

- [ ] **Step 9: Switch StockAlertsPage รุ่น to `Combobox` with an explicit required check**

In `apps/web/src/pages/StockAlertsPage.tsx` replace

```tsx
import { NativeSelect } from '@/components/ui/native-select';
import { useId as useUiFieldId, useState } from 'react';
```

with

```tsx
import { NativeSelect } from '@/components/ui/native-select';
import { Combobox } from '@/components/ui/combobox';
import { useId as useUiFieldId, useState } from 'react';
```

replace

```tsx
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string; action: () => void }>({ open: false, message: '', action: () => {} });
```

with

```tsx
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string; action: () => void }>({ open: false, message: '', action: () => {} });
  // รุ่น was guarded by the browser's `required` popup only; the Combobox needs an explicit check.
  const [modelError, setModelError] = useState('');
```

replace

```tsx
  const resetForm = () => {
    setForm({ brand: '', model: '', storage: '', category: 'PHONE_NEW', branchId: '', minQuantity: '1', reorderQuantity: '5' });
  };
```

with

```tsx
  const resetForm = () => {
    setForm({ brand: '', model: '', storage: '', category: 'PHONE_NEW', branchId: '', minQuantity: '1', reorderQuantity: '5' });
    setModelError('');
  };
```

replace

```tsx
            } else {
              createMutation.mutate(form);
            }
```

with

```tsx
            } else {
              if (!form.model) {
                setModelError('กรุณาเลือกรุ่น');
                return;
              }
              createMutation.mutate(form);
            }
```

and replace

```tsx
                  <NativeSelect id={`${uiFieldId}-3`}
                    value={form.model}
                    onChange={(e) => {
                      const modelName = e.target.value;
                      const info = form.brand ? getModelInfo(form.brand, modelName) : undefined;
                      setForm({ ...form, model: modelName, storage: '', category: info?.category || form.category });
                    }}
                    required
                    disabled={!form.brand}
                  >
                    <option value="">-- เลือกรุ่น --</option>
                    {form.brand && getModels(form.brand, form.category).map((m) => (
                      <option key={m.name} value={m.name}>{m.name}</option>
                    ))}
                  </NativeSelect>
```

with

```tsx
                  <Combobox
                    id={`${uiFieldId}-3`}
                    value={form.model}
                    onChange={(modelName) => {
                      setModelError('');
                      // A native select fired no change for the same option — keep the storage.
                      if (modelName === form.model) return;
                      const info = form.brand ? getModelInfo(form.brand, modelName) : undefined;
                      setForm({ ...form, model: modelName, storage: '', category: info?.category || form.category });
                    }}
                    options={form.brand ? getModels(form.brand, form.category).map((m) => ({ value: m.name, label: m.name })) : []}
                    placeholder="-- เลือกรุ่น --"
                    required
                    invalid={!!modelError}
                    aria-describedby={modelError ? `${uiFieldId}-3-error` : undefined}
                    disabled={!form.brand}
                  />
                  {modelError && (
                    <p id={`${uiFieldId}-3-error`} role="alert" className="mt-1 text-xs leading-snug text-destructive">
                      {modelError}
                    </p>
                  )}
```

(The modal's cancel/close paths already call `resetForm()`, which now also clears the message. The edit-mode branch never renders this field — it is inside `!editingPoint`.)

- [ ] **Step 10: Run it and confirm it passes**

```bash
npm run test --workspace=apps/web -- src/pages/__tests__/StockAlertsPage.model.test.tsx
```

Expected: `Tests  3 passed (3)`.

- [ ] **Step 11: Update StepItems.test for the เคส "สำหรับรุ่น" field (failing)**

In `apps/web/src/pages/PurchaseOrdersPage/components/wizard/StepItems.test.tsx` replace

```tsx
import { render, screen, fireEvent, within } from '@testing-library/react';
import { StepItems } from './StepItems';
```

with

```tsx
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { pickComboOption } from '@/test/combobox';
import { StepItems } from './StepItems';
```

and replace (old :241-247)

```tsx
  it('เคส: one compatible model from a select', () => {
    const p = renderStep([caseItem]);
    const sel = row(1).getByRole('combobox', { name: 'สำหรับรุ่น' });
    expect(within(sel).getByRole('option', { name: 'iPhone 16 Pro' })).toBeInTheDocument();
    fireEvent.change(sel, { target: { value: 'iPhone 16 Pro' } });
    expect(p.updateItem).toHaveBeenCalledWith(0, 'model', 'iPhone 16 Pro');
  });
```

with

```tsx
  it('เคส: one compatible model from a searchable list', async () => {
    const user = userEvent.setup();
    const p = renderStep([caseItem]);
    expect(row(1).getByRole('combobox', { name: 'สำหรับรุ่น' })).toHaveTextContent('— เลือกรุ่น —');
    await pickComboOption(user, 'สำหรับรุ่น', 'iPhone 16 Pro', { search: '16 pro' });
    expect(p.updateItem).toHaveBeenCalledWith(0, 'model', 'iPhone 16 Pro');
    expect(p.updateItem).toHaveBeenCalledTimes(1);
  });

  it('เคส: "— เลือกรุ่น —" clears the model (it is optional); re-picking the current model changes nothing', async () => {
    const user = userEvent.setup();
    const p = renderStep([{ ...caseItem, model: 'iPhone 16 Pro' }]);
    expect(row(1).getByRole('combobox', { name: 'สำหรับรุ่น' })).toHaveTextContent('iPhone 16 Pro');
    await pickComboOption(user, 'สำหรับรุ่น', 'iPhone 16 Pro', { search: '16 pro' });
    expect(p.updateItem).not.toHaveBeenCalled();
    await pickComboOption(user, 'สำหรับรุ่น', '— เลือกรุ่น —');
    expect(p.updateItem).toHaveBeenCalledWith(0, 'model', '');
  });
```

(The ฟิล์ม picker test — `getByRole('button', { name: 'สำหรับรุ่น' })` — and the หัวชาร์จ `fireEvent.change` test stay as they are: those controls are not converted. The file's own `scrollIntoView` polyfill at :6-9 is compatible with the global one.)

Run:

```bash
npm run test --workspace=apps/web -- src/pages/PurchaseOrdersPage/components/wizard/StepItems.test.tsx
```

Expected: FAIL, `Tests  2 failed | 25 passed (27)` — both เคส tests fail in `pickComboOption`, because the field is still a native `<select>`.

- [ ] **Step 12: Switch AccessoryItemRow เคส "สำหรับรุ่น" to `Combobox`**

In `apps/web/src/pages/PurchaseOrdersPage/components/wizard/items/AccessoryItemRow.tsx` replace

```tsx
import { NativeSelect } from '@/components/ui/native-select';
import { useState } from 'react';
```

with

```tsx
import { NativeSelect } from '@/components/ui/native-select';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { useState } from 'react';
```

replace

```tsx
/** The one control each accessory kind needs, in a fixed label track so all rows line up. */
```

with

```tsx
/** เคส "สำหรับรุ่น": the whole catalog; '' first because the model is optional (po-catalog.util allItemsComplete). */
let caseModelOptions: ComboOption[] | null = null;
function getCaseModelOptions(): ComboOption[] {
  caseModelOptions ??= [
    { value: '', label: '— เลือกรุ่น —' },
    ...catalogEntries().map((e) => ({ value: e.name, label: e.name })),
  ];
  return caseModelOptions;
}

/** The one control each accessory kind needs, in a fixed label track so all rows line up. */
```

and replace

```tsx
          <NativeSelect wrapperClassName="max-w-full w-full" aria-label="สำหรับรุ่น" value={item.model} onChange={(e) => onChange('model', e.target.value)} className={selectCls}>
            <option value="">— เลือกรุ่น —</option>
            {catalogEntries().map((e) => (
              <option key={e.name} value={e.name}>
                {e.name}
              </option>
            ))}
          </NativeSelect>
```

with

```tsx
          <Combobox
            aria-label="สำหรับรุ่น"
            value={item.model}
            onChange={(model) => {
              // A native select fired no change for the same option — keep colour/storage.
              if (model !== item.model) onChange('model', model);
            }}
            options={getCaseModelOptions()}
            wrapperClassName="max-w-full w-full"
            className={selectCls}
          />
```

(`catalogEntries()` is static and cached, so the option list is built once and shared by every เคส row. `NativeSelect` is still imported for หัวชาร์จ.)

Run:

```bash
npm run test --workspace=apps/web -- src/pages/PurchaseOrdersPage/components/wizard/StepItems.test.tsx
```

Expected: `Tests  27 passed (27)`.

- [ ] **Step 13: Write the failing test for ReferenceQuestionnaire รุ่นและความจุ**

Create `apps/web/src/pages/TradeInPage/components/ReferenceQuestionnaire.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { BuybackQuestion } from '@installment/shared';
import { openCombobox, pickComboOption } from '@/test/combobox';
import ReferenceQuestionnaire, { type ReferenceQuestionnaireCatalog } from './ReferenceQuestionnaire';

const question = (key: string, title: string, label: string): BuybackQuestion => ({
  id: key,
  key,
  title,
  helpText: null,
  selectType: 'SINGLE',
  choices: [{ id: `${key}-ok`, label, deductType: 'PERCENT', deductValue: '0' }],
});

const catalog: ReferenceQuestionnaireCatalog = {
  source: 'https://www.yellobe.com/buy',
  capturedAt: '2026-09-08T00:00:00Z',
  assignments: [
    { model: 'iPhone 15', storage: '128GB', profileId: 'basic' },
    { model: 'iPhone 15', storage: '256GB', profileId: 'basic' },
    { model: 'iPhone 16 Pro', storage: '256GB', profileId: 'pro' },
  ],
  profiles: {
    basic: { eligibilityText: 'เงื่อนไขชุดพื้นฐาน', questions: [question('screen', 'หน้าจอ', 'จอปกติ')] },
    pro: { eligibilityText: 'เงื่อนไขชุดรุ่นโปร', questions: [question('camera', 'กล้อง', 'กล้องปกติ')] },
  },
};

describe('ReferenceQuestionnaire — รุ่นและความจุ (Combobox)', () => {
  it('starts on the first model · storage; picking another shows that profile', async () => {
    const user = userEvent.setup();
    render(<ReferenceQuestionnaire catalog={catalog} />);
    const trigger = screen.getByRole('combobox', { name: 'รุ่นและความจุ' });
    expect(trigger).toHaveTextContent('iPhone 15 · 128GB');
    expect(screen.getByText('เงื่อนไขชุดพื้นฐาน')).toBeInTheDocument();

    await pickComboOption(user, 'รุ่นและความจุ', 'iPhone 16 Pro · 256GB', { search: '16' });

    expect(trigger).toHaveTextContent('iPhone 16 Pro · 256GB');
    expect(screen.getByText('เงื่อนไขชุดรุ่นโปร')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'กล้อง' })).toBeInTheDocument();
    expect(screen.queryByText('เงื่อนไขชุดพื้นฐาน')).toBeNull();
  });

  it('search narrows the list by storage too (one row per model|storage pair)', async () => {
    const user = userEvent.setup();
    render(<ReferenceQuestionnaire catalog={catalog} />);
    const listbox = await openCombobox(user, 'รุ่นและความจุ');
    expect(within(listbox).getAllByRole('option')).toHaveLength(3);
    await user.type(screen.getByRole('combobox', { name: 'ค้นหา' }), '256');
    expect(within(listbox).getAllByRole('option')).toHaveLength(2);
    expect(within(listbox).getByRole('option', { name: 'iPhone 15 · 256GB' })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: 'iPhone 16 Pro · 256GB' })).toBeInTheDocument();
    expect(within(listbox).queryByRole('option', { name: 'iPhone 15 · 128GB' })).toBeNull();
  });
});
```

Run:

```bash
npm run test --workspace=apps/web -- src/pages/TradeInPage/components/ReferenceQuestionnaire.test.tsx
```

Expected: FAIL, `Tests  2 failed (2)`. The trigger lookup by name works on today's native select (its wrapping label names it), but `pickComboOption` / `openCombobox` never get a Combobox menu.

- [ ] **Step 14: Switch ReferenceQuestionnaire to `Combobox` (value stays `model|storage`)**

In `apps/web/src/pages/TradeInPage/components/ReferenceQuestionnaire.tsx` replace

```tsx
import { NativeSelect } from '@/components/ui/native-select';
import { useState } from 'react';
```

with

```tsx
import { useId, useState } from 'react';
import { Combobox } from '@/components/ui/combobox';
```

replace

```tsx
  const [selection, setSelection] = useState('');
```

with

```tsx
  const fieldId = useId();
  const [selection, setSelection] = useState('');
```

and replace

```tsx
        <label className="space-y-1 text-sm">
          <span className="block font-medium">รุ่นและความจุ</span>
          <NativeSelect wrapperClassName="w-auto max-w-full"
            value={active ? `${active.model}|${active.storage}` : ''}
            onChange={(event) => setSelection(event.target.value)}
          >
            {assignments.map((entry) => (
              <option
                key={`${entry.model}|${entry.storage}`}
                value={`${entry.model}|${entry.storage}`}
              >
                {entry.model} · {entry.storage}
              </option>
            ))}
          </NativeSelect>
        </label>
```

with

```tsx
        <div className="w-full min-w-0 space-y-1 text-sm sm:w-auto">
          <label htmlFor={fieldId} className="block font-medium">รุ่นและความจุ</label>
          <Combobox
            id={fieldId}
            value={active ? `${active.model}|${active.storage}` : ''}
            onChange={(value) => setSelection(value)}
            options={assignments.map((entry) => ({
              value: `${entry.model}|${entry.storage}`,
              label: `${entry.model} · ${entry.storage}`,
            }))}
            wrapperClassName="w-full sm:w-72"
          />
        </div>
```

(The `w-auto` native select sized itself to its longest option. A button trigger sizes to the *selected* label, so it gets a fixed width instead: 288px from `sm`, full width below — ≈ 324px at 390, where the old field was ≈ 220–324px.)

Run:

```bash
npm run test --workspace=apps/web -- src/pages/TradeInPage/components/ReferenceQuestionnaire.test.tsx
```

Expected: `Tests  2 passed (2)`.

- [ ] **Step 15: Update TradeInFlow.test for รุ่น iPhone (characterization + failing)**

In `apps/web/src/components/trade-in/TradeInFlow.test.tsx` replace

```tsx
import TradeInProductHandoff from './TradeInProductHandoff';
import api from '@/lib/api';
```

with

```tsx
import TradeInProductHandoff from './TradeInProductHandoff';
import api from '@/lib/api';
import { pickComboOption } from '@/test/combobox';
```

replace

```tsx
async function selectDevice(user: ReturnType<typeof userEvent.setup>) {
  await selectPurchaseOption(user, 'รุ่น iPhone *', 'iPhone 15');
```

with

```tsx
/** รุ่น iPhone is a Combobox (R2-4b); ความจุ / สีเครื่อง / สาขา stay PurchaseSelect. */
async function selectModel(user: ReturnType<typeof userEvent.setup>, model = 'iPhone 15') {
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'รุ่น iPhone *' })).toBeEnabled());
  await pickComboOption(user, 'รุ่น iPhone *', model);
}
async function selectDevice(user: ReturnType<typeof userEvent.setup>) {
  await selectModel(user);
```

replace (old :231-232)

```tsx
    await selectPurchaseOption(user, 'รุ่น iPhone *', 'iPhone 15');
    await selectPurchaseOption(user, 'ความจุ *', '128GB');
    await user.click(nextButton());
    expect(screen.getByText('ขั้นที่ 1 / 4')).toBeVisible();
```

with

```tsx
    await selectModel(user);
    await selectPurchaseOption(user, 'ความจุ *', '128GB');
    await user.click(nextButton());
    expect(screen.getByText('ขั้นที่ 1 / 4')).toBeVisible();
```

and insert two tests before `  it('selects Thai/imported origin only in inspection and includes it in the price assessment', async () => {` — i.e. replace that line with:

```tsx
  it('รุ่น iPhone keeps id quick-buy-model and a native disabled attribute until the catalog loads', async () => {
    const gate = deferred<{ data: typeof catalog }>();
    const get = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation((url, options) =>
      String(url).endsWith('/catalog') ? gate.promise : get(url, options));
    render(<QuickBuyModal open onClose={vi.fn()} onSuccess={vi.fn()} onIncomplete={vi.fn()} />, { wrapper });
    const model = screen.getByRole('combobox', { name: 'รุ่น iPhone *' });
    expect(model).toHaveAttribute('id', 'quick-buy-model');
    expect(model).toHaveAttribute('disabled');
    await act(async () => gate.resolve({ data: catalog }));
    // tools/field-scale/routes.mjs (trade-in-quick-buy) waits for exactly this selector
    await waitFor(() => expect(document.querySelector('#quick-buy-model:not([disabled])')).toBe(model));
  });

  it('a new รุ่น iPhone clears storage and the inspection; re-picking the current model keeps both', async () => {
    render(<QuickBuyModal open onClose={vi.fn()} onSuccess={vi.fn()} onIncomplete={vi.fn()} />, { wrapper });
    const user = userEvent.setup();
    await preparePrice(user);
    await user.click(backButton());
    await selectModel(user, 'iPhone 15');
    expect(screen.getByRole('combobox', { name: 'ความจุ *' })).toHaveTextContent('128GB');
    await user.click(nextButton());
    expect(await screen.findByRole('radio', { name: 'หน้าจอสมบูรณ์' })).toBeChecked();

    await user.click(backButton());
    await pickComboOption(user, 'รุ่น iPhone *', 'iPhone 17', { search: '17' });
    expect(screen.getByRole('combobox', { name: 'ความจุ *' })).toHaveTextContent('เลือกความจุ');
    await selectPurchaseOption(user, 'ความจุ *', '256GB');
    await user.click(nextButton());
    expect(await screen.findByRole('radio', { name: 'หน้าจอสมบูรณ์' })).not.toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'หน้าจอสมบูรณ์' }));
    await user.click(screen.getByRole('checkbox', { name: 'ตรวจแล้ว ไม่พบปัญหา' }));
    await user.click(screen.getByRole('checkbox', { name: 'ยืนยันเครื่องผ่านเงื่อนไขรับซื้อ' }));
    await waitFor(() =>
      expect(previewCalls().at(-1)?.[1]).toMatchObject({ deviceModel: 'iPhone 17', deviceStorage: '256GB' }));
  });

  it('selects Thai/imported origin only in inspection and includes it in the price assessment', async () => {
```

(`selectPurchaseOption` and the Radix `hasPointerCapture`/`scrollIntoView` polyfill at :62-75 stay — ความจุ is still a PurchaseSelect.)

Run:

```bash
npm run test --workspace=apps/web -- src/components/trade-in/TradeInFlow.test.tsx
```

Expected: FAIL, `Tests  19 failed | 4 passed (23)`. Every test that goes through `selectModel` fails in `pickComboOption`, because รุ่น iPhone is still a Radix `SelectTrigger` (`data-slot=select-trigger`) and opens no Combobox menu. The new `#quick-buy-model` characterization test **passes** (the Radix trigger already has that id and a native `disabled` — it pins the field-scale contract across the switch), and so do the three tests that never pick a model. If the passing tests time out on Windows (known: the original file times out at the 5 s default on a loaded Windows machine), re-run with `-- --testTimeout=40000` to separate timing from logic, and record it.

- [ ] **Step 16: Switch QuickBuyModal รุ่น iPhone to `Combobox` (keep `#quick-buy-model` + native `disabled`)**

In `apps/web/src/components/trade-in/QuickBuyModal.tsx` replace

```tsx
import PurchaseSelect from './PurchaseSelect';
```

with

```tsx
import PurchaseSelect from './PurchaseSelect';
import { Combobox } from '@/components/ui/combobox';

/** รุ่น iPhone sits beside PurchaseSelect (ความจุ) — same fill, border, padding and open ring. */
const MODEL_TRIGGER_SKIN =
  'cursor-pointer gap-3 border-border bg-card px-4 shadow-sm transition-colors hover:border-primary/50 data-[state=open]:border-primary data-[state=open]:ring-2 data-[state=open]:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted/40';
```

and replace

```tsx
                  <PurchaseSelect
                    id="quick-buy-model"
                    value={form.deviceModel}
                    disabled={catalog.isPending || catalog.isError}
                    placeholder="เลือกรุ่น iPhone"
                    options={modelOptions.map((entry) => ({
                      value: entry.model,
                      label: entry.model,
                    }))}
                    onValueChange={(value) => {
                      clearInspection();
                      setForm((f) => ({
                        ...f,
                        deviceModel: value,
                        deviceStorage: '',
                        deviceColor: '',
                      }));
                    }}
                  />
```

with

```tsx
                  <Combobox
                    id="quick-buy-model"
                    value={form.deviceModel}
                    disabled={catalog.isPending || catalog.isError}
                    placeholder="เลือกรุ่น iPhone"
                    options={modelOptions.map((entry) => ({
                      value: entry.model,
                      label: entry.model,
                    }))}
                    onChange={(value) => {
                      // Radix Select ignored a re-pick of the current model — keep storage, colour and answers.
                      if (value === form.deviceModel) return;
                      clearInspection();
                      setForm((f) => ({
                        ...f,
                        deviceModel: value,
                        deviceStorage: '',
                        deviceColor: '',
                      }));
                    }}
                    className={MODEL_TRIGGER_SKIN}
                  />
```

(The loading / error / empty blocks above the grid (:874-889), the `<Label htmlFor="quick-buy-model" className={formLabelClass}>` and `next()`'s toast guard are unchanged. The DialogContent's `[&_[role=combobox]]:min-h-11 [&_[role=combobox]]:rounded-lg` applies to the new trigger exactly as it did to the Radix one. The portalled search box is outside DialogContent, so it does not apply there.)

Run:

```bash
npm run test --workspace=apps/web -- src/components/trade-in/TradeInFlow.test.tsx
```

Expected: `Tests  23 passed (23)` (on a loaded Windows machine add `-- --testTimeout=40000` if the 5 s default times out; the plan's Global Constraints list `TradeInFlow` timeouts as a known Windows-only failure).

- [ ] **Step 17: Write the failing test for the POListTab ผู้จัดจำหน่าย filter**

In `apps/web/src/pages/PurchaseOrdersPage/components/POListTab.test.tsx` replace

```tsx
import { render, screen, within, fireEvent } from '@testing-library/react';
import { POListTab } from './POListTab';
```

with

```tsx
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { openCombobox, pickComboOption } from '@/test/combobox';
import { POListTab } from './POListTab';
```

replace

```tsx
function renderTab(pos: PurchaseOrder[], readOnly = false) {
```

with

```tsx
function renderTab(pos: PurchaseOrder[], readOnly = false, suppliers = [{ id: 's1', name: 'QA' }]) {
```

replace

```tsx
      suppliers={[{ id: 's1', name: 'QA' }]}
```

with

```tsx
      suppliers={suppliers}
```

and append at the end of the file:

```tsx

describe('POListTab — ผู้จัดจำหน่าย filter (Combobox, client-side)', () => {
  it('picks a supplier from the searchable list, filters the rows and clears back to ทุกผู้จัดจำหน่าย', async () => {
    const user = userEvent.setup();
    const idea = { id: 's2', name: 'บริษัท ไอเดียโมบาย จำกัด', contactName: null, phone: '', hasVat: false };
    renderTab(
      [po({}), po({ id: 'po-2', poNumber: 'PO-2026-09-009', supplier: idea })],
      false,
      [{ id: 's1', name: 'QA' }, { id: 's2', name: idea.name }],
    );
    const trigger = screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' });
    expect(trigger).toHaveTextContent('ทุกผู้จัดจำหน่าย');

    await pickComboOption(user, 'ผู้จัดจำหน่าย', idea.name, { search: 'ไอเดีย' });
    expect(trigger).toHaveTextContent(idea.name);
    expect(screen.queryByRole('button', { name: 'PO-2026-09-010' })).toBeNull();
    expect(screen.getByRole('button', { name: 'PO-2026-09-009' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `ลบ ผู้จัดจำหน่าย: ${idea.name}` })).toBeInTheDocument();
    // renderOption keeps the mark on the current value
    const list = await openCombobox(user, 'ผู้จัดจำหน่าย');
    expect(within(list).getByRole('option', { name: idea.name }).querySelector('svg.lucide-check')).not.toBeNull();
    expect(within(list).getByRole('option', { name: 'ทุกผู้จัดจำหน่าย' }).querySelector('svg.lucide-check')).toBeNull();
    await user.keyboard('{Escape}');

    await pickComboOption(user, 'ผู้จัดจำหน่าย', 'ทุกผู้จัดจำหน่าย');
    expect(trigger).toHaveTextContent('ทุกผู้จัดจำหน่าย');
    expect(screen.getByRole('button', { name: 'PO-2026-09-010' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^ลบ ผู้จัดจำหน่าย:/ })).toBeNull();
  });
});
```

Run:

```bash
npm run test --workspace=apps/web -- src/pages/PurchaseOrdersPage/components/POListTab.test.tsx
```

Expected: FAIL, `Tests  1 failed | 6 passed (7)` — the new test fails in `pickComboOption` (the filter is still a Radix `SelectTrigger`).

- [ ] **Step 18: Switch the POListTab supplier filter to `Combobox` (no `__all__` sentinel)**

In `apps/web/src/pages/PurchaseOrdersPage/components/POListTab.tsx` replace

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
```

with

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Combobox } from '@/components/ui/combobox';
```

and replace

```tsx
        <FilterSelect label="ผู้จัดจำหน่าย"
          value={supplierFilter}
          onChange={setSupplierFilter}
          options={[{ value: '', label: 'ทุกผู้จัดจำหน่าย' }, ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))]}
        />
```

with

```tsx
        <Combobox
          aria-label="ผู้จัดจำหน่าย"
          value={supplierFilter}
          onChange={(value) => setSupplierFilter(value)}
          options={[{ value: '', label: 'ทุกผู้จัดจำหน่าย' }, ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))]}
          className="shadow-none"
          // A long unbroken supplier name wraps inside the menu (po-filters.audit-spec.ts); renderOption
          // replaces the whole row, so it draws the mark on the current value itself.
          renderOption={(option, { selected }) => (
            <>
              <span className="min-w-0 flex-1 whitespace-normal break-words leading-snug">{option.label}</span>
              {selected && <Check aria-hidden="true" className="ml-auto size-4 shrink-0 text-primary!" />}
            </>
          )}
        />
```

(`Check` is already imported from `lucide-react` at `POListTab.tsx:17` — no import change. `shadow-none` matches its three siblings, which use `filterControlClass = cn(formControlClass, 'shadow-none')`. The local `FilterSelect`, `filterControlClass` and `allFilterValue` stay for สถานะ and ช่วงเวลา. The chip, `selectedSupplierName` and `clearAll` are unchanged.)

Run:

```bash
npm run test --workspace=apps/web -- src/pages/PurchaseOrdersPage/components/POListTab.test.tsx
```

Expected: `Tests  7 passed (7)`.

- [ ] **Step 19: Update the api ui-fields audits for รุ่น (not executed on Windows; verified by reading)**

`apps/api/e2e/ui-fields/shared-controls.audit-spec.ts` — replace (old :74-78)

```ts
          const model = page.getByLabel('รุ่น *', { exact: true });
          await browserExpect(model).toBeEnabled();
          const option = await model.locator('option').nth(1).getAttribute('value');
          await model.selectOption(option!);
          await browserExpect(model).toHaveValue(option!);
```

with

```ts
          // รุ่น is a Combobox (R2-4b): pick the first catalog model from its portalled menu.
          const model = page.getByRole('combobox', { name: 'รุ่น *', exact: true });
          await browserExpect(model).toBeEnabled();
          await model.click();
          const firstModel = page.locator('[data-slot=combobox-content]').getByRole('option').first();
          const modelName = (await firstModel.innerText()).trim();
          await firstModel.click();
          await browserExpect(page.locator('[data-slot=combobox-content]')).toHaveCount(0);
          await browserExpect(model).toContainText(modelName);
```

and replace (old :86-91)

```ts
          await web.navigate(page, '/stock/alerts');
          await page.getByRole('button', { name: '+ Reorder Point', exact: true }).click();
          const dialog = page.getByRole('dialog');
          await dialog.getByLabel('แบรนด์', { exact: true }).selectOption('Apple');
          const stockModel = dialog.getByLabel('รุ่น', { exact: true });
          await stockModel.selectOption(await stockModel.locator('option').nth(1).getAttribute('value') as string);
```

with

```ts
          await web.navigate(page, '/stock/alerts');
          // pre-existing: the button reads "+ จุดสั่งซื้อซ้ำ" (StockAlertsPage.tsx:411), not "+ Reorder Point"
          await page.getByRole('button', { name: '+ จุดสั่งซื้อซ้ำ', exact: true }).click();
          // named: the open รุ่น menu is also role=dialog
          const dialog = page.getByRole('dialog', { name: 'สร้าง จุดสั่งซื้อซ้ำ ใหม่', exact: true });
          await dialog.getByLabel('แบรนด์', { exact: true }).selectOption('Apple');
          await dialog.getByRole('combobox', { name: 'รุ่น', exact: true }).click();
          await page.locator('[data-slot=combobox-content]').getByRole('option').first().click();
          await browserExpect(page.locator('[data-slot=combobox-content]')).toHaveCount(0);
```

(`capture()` measures `[data-slot=native-select]` in `dialogs.at(-1)`; waiting for the menu to be gone keeps that the modal. The converted fields — product รุ่น and ผู้จัดจำหน่าย, reorder-point รุ่น — are no longer native selects, so this audit's native-arrow checks simply no longer include them. The fields audit below still measures their height and label.)

`apps/api/e2e/ui-fields/fields.audit-spec.ts` — replace (old :192-196)

```ts
    await browserExpect(p.getByLabel('รุ่น *',{exact:true})).toBeEnabled();
    const model=p.getByLabel('รุ่น *',{exact:true});
    const modelValue=await model.locator('option').nth(1).getAttribute('value');
    expect(modelValue).toBeTruthy(); await model.selectOption(modelValue!);
```

with

```ts
    const model=p.getByRole('combobox',{name:'รุ่น *',exact:true});
    await browserExpect(model).toBeEnabled();
    await model.click();
    const firstModel=p.locator('[data-slot=combobox-content]').getByRole('option').first();
    const modelName=(await firstModel.innerText()).trim();
    expect(modelName).toBeTruthy(); await firstModel.click();
    await browserExpect(model).toContainText(modelName);
```

(The page cases `products-create` / `products-used` / `products-accessory` need no change: the collector already includes `button[role=combobox]` (:91) and names it through `e.labels` — a `<button>` is labelable — so `unlabelled` stays 0, and both converted triggers are 44px.)

- [ ] **Step 20: Update the po-filters audit for the supplier Combobox (not executed on Windows; verified by reading)**

`apps/api/e2e/ui-fields/po-filters.audit-spec.ts` — replace (:67)

```ts
              const text = element.querySelector('[data-slot=select-value]')?.getBoundingClientRect();
```

with

```ts
              const text = element.querySelector('[data-slot=select-value],[data-slot=combobox-value]')?.getBoundingClientRect();
```

and replace (old :111-115)

```ts
          const popup = await longOption.evaluate(element => {
            const label = element.lastElementChild as HTMLElement;
            const box = element.closest('[role=listbox]')!.getBoundingClientRect();
            return { x: box.x, right: box.right, width: box.width, labelWidth: label.clientWidth, labelScroll: label.scrollWidth, labelHeight: label.clientHeight };
          });
```

with

```ts
          const popup = await longOption.evaluate((element, name) => {
            // Combobox row: the label is the leaf element holding the whole name (renderOption in POListTab)
            const label = ([...element.querySelectorAll<HTMLElement>('*')].find(node => node.childElementCount === 0 && node.textContent === name) ?? element) as HTMLElement;
            // the portalled menu, border included, is as wide as the trigger (w-(--radix-popover-trigger-width))
            const box = element.closest('[data-slot=combobox-content]')!.getBoundingClientRect();
            return { x: box.x, right: box.right, width: box.width, labelWidth: label.clientWidth, labelScroll: label.scrollWidth, labelHeight: label.clientHeight };
          }, unbrokenName);
```

and replace (old :118)

```ts
          expect(popup.width).toBeCloseTo(selects[1].width, 0);
```

with

```ts
          // the Combobox menu is never narrower than min-w-64 (16rem); on the xl row (1440/1280, sidebar expanded)
          // the supplier column is narrower (~217/185px), so there the menu is 16rem wide
          expect(popup.width).toBeCloseTo(Math.max(selects[1].width, 16 * config.root), 0);
```

(The Radix `FilterSelect` menu was `min-w-0`; the Combobox menu is `w-(--radix-popover-trigger-width) min-w-64`. At 1024 and below the column is ≥ 288px at 16px root and 350px > 320px at 20px root, so the menu equals the trigger; at 1440/1280 the 256px menu still ends inside the viewport — :116-117.)

The rest holds as written (checked by reading):
- :55 `getByRole('combobox', { name: 'ผู้จัดจำหน่าย', exact: true })` — the `aria-label`. The open menu's search box is named `ค้นหา`, so there is no clash.
- :62-77 four fields `input,button[role=combobox]`. Same height/font/padding; the arrow is the trigger's first `svg` (`size-4`) at `0.75rem + 1px` inset; text inset `0.75rem + 1px` (formControlClass `px-3` + 1px border) — header Behaviour "Custom rendering" (the chevron is the trigger's first `svg`).
- :119-120 the label does not overflow and wraps to ≥ 2 lines (`whitespace-normal break-words leading-snug`).
- :123 `toContainText(unbrokenName)`.
- :134 / :163 `toHaveText('ทุกผู้จัดจำหน่าย')` — the trigger's text is the `''` option's label only.
- :137 picking `data.supplier.name`.
- :140-169 สถานะ / ช่วงเวลา are still Radix.

- [ ] **Step 21: Guards, neighbours, type check, lint, build**

```bash
npm run test --workspace=apps/web -- src/components/ui/field-guards.inventory.test.ts src/components/ui/native-select.inventory.test.ts src/pages/PurchaseOrdersPage src/pages/TradeInPage src/pages/ProductCreatePage src/pages/__tests__/StockAlertsPage.model.test.tsx src/components/trade-in
bash tools/check-types.sh web
cd apps/web && npx eslint src/pages/ProductCreatePage/components/ProductInfoCard.tsx src/pages/ProductCreatePage/components/BranchSupplierCard.tsx src/pages/ProductCreatePage/index.tsx src/pages/ProductCreatePage/__tests__ src/pages/StockAlertsPage.tsx src/pages/__tests__/StockAlertsPage.model.test.tsx src/pages/PurchaseOrdersPage/components/wizard/items/AccessoryItemRow.tsx src/pages/PurchaseOrdersPage/components/wizard/StepItems.test.tsx src/pages/TradeInPage/components/ReferenceQuestionnaire.tsx src/pages/TradeInPage/components/ReferenceQuestionnaire.test.tsx src/components/trade-in/QuickBuyModal.tsx src/components/trade-in/TradeInFlow.test.tsx src/pages/PurchaseOrdersPage/components/POListTab.tsx src/pages/PurchaseOrdersPage/components/POListTab.test.tsx && cd ../..
npm run build --workspace=apps/web
```

Expected: every test file passes (TradeInFlow: see Step 16 for the Windows timeout note). The guard results:
- `field-guards.inventory.test.ts` — the QuickBuyModal / PurchaseSelect margin guards and the STYLE_A label guard hold, because no label was touched; F5 counts no new absolute menu, because the Combobox menu is in `PopoverContent`.
- `native-select.inventory.test.ts` — no raw `<select>` was added.

Type check: 0 errors. ESLint: 0 errors. Build: succeeds.

- [ ] **Step 22: Attach the two pending model-menu probes (`tools/field-scale`)**

Task 1 parked `stock-alert-model-menu` and `po-accessory-model-menu` in `PENDING_PROBES` because a native `<select>` has no
`aria-controls` (a failing probe blocks every compare). Their triggers are `Combobox` now. The edits do not depend on
whether Task 13 already attached its three.

In `tools/field-scale/routes.mjs` replace

```js
  'r2-stock-alert-create': [{ // Task 12 (menu inside a Radix Dialog)
    id: 'stock-alert-model-menu', widths: [1440, 390], menu: 'controls',
    trigger: (page) => page.getByRole('dialog').getByRole('combobox', { name: 'รุ่น', exact: true }),
  }],
  'r2-po-wizard-items': [{ // Task 12 (overflow-x-auto table; vaul Drawer below 1024)
    id: 'po-accessory-model-menu', widths: [1440, 390], menu: 'controls',
    trigger: (page) => page.getByRole('combobox', { name: 'สำหรับรุ่น' }).first(),
  }],
};
```

with

```js
};
// Round 2 Task 12 attached these two from PENDING_PROBES (the model fields are Combobox now).
const STOCK_ALERT_MODEL_MENU = { // menu inside a Radix Dialog
  id: 'stock-alert-model-menu', widths: [1440, 390], menu: 'controls',
  trigger: (page) => page.getByRole('dialog').getByRole('combobox', { name: 'รุ่น', exact: true }),
};
const PO_ACCESSORY_MODEL_MENU = { // overflow-x-auto table; vaul Drawer below 1024
  id: 'po-accessory-model-menu', widths: [1440, 390], menu: 'controls',
  trigger: (page) => page.getByRole('combobox', { name: 'สำหรับรุ่น' }).first(),
};
```

replace

```js
    mocks: [M.purchaseOrders, M.poSuppliers, R2.purchaseOrdersSummary], open: openPurchaseItems },
```

with

```js
    mocks: [M.purchaseOrders, M.poSuppliers, R2.purchaseOrdersSummary], open: openPurchaseItems,
    probes: [PO_ACCESSORY_MODEL_MENU] },
```

replace

```js
      await page.getByRole('dialog').getByLabel('แบรนด์', { exact: true }).selectOption('Apple');
    } },
```

with

```js
      await page.getByRole('dialog').getByLabel('แบรนด์', { exact: true }).selectOption('Apple');
    }, probes: [STOCK_ALERT_MODEL_MENU] },
```

In `tools/field-scale/check.test.mjs` replace

```js
    ['r2-booking-create', 'booking-customer-menu', [1440, 390], 'controls'],
```

with

```js
    ['r2-po-wizard-items', 'po-accessory-model-menu', [1440, 390], 'controls'],
    ['r2-booking-create', 'booking-customer-menu', [1440, 390], 'controls'],
```

replace

```js
    ['r2-profile-yeastar', 'profile-extension-menu', [1440, 390], 'controls'],
```

with

```js
    ['r2-stock-alert-create', 'stock-alert-model-menu', [1440, 390], 'controls'],
    ['r2-profile-yeastar', 'profile-extension-menu', [1440, 390], 'controls'],
```

replace

```js
    ['r2-stock-alert-create', 'stock-alert-model-menu', [1440, 390], 'controls'],
    ['r2-po-wizard-items', 'po-accessory-model-menu', [1440, 390], 'controls'],
  ]);
```

with

```js
  ]);
```

Run:

```bash
node --test tools/field-scale/check.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Expected: `ℹ tests 32` · `ℹ pass 32` · `ℹ fail 0`.

- [ ] **Step 23: Field-scale check**

1. `npm run local:preview` and wait for `Started http://localhost:5195/inbox`.
2. Run the runner on this task's routes (Task 1 ids; POListTab is measured on `r2-purchase-orders-list` — the wizard route
   `purchase-order-wizard` measures only the wizard dialog):

   ```bash
   node tools/field-scale/check.mjs --label t12-models-suppliers --routes trade-in-quick-buy,r2-purchase-orders-list,r2-product-create,r2-stock-alert-create,r2-po-wizard-items,r2-trade-in-questions
   node tools/field-scale/check.mjs --compare baseline-r2 t12-models-suppliers
   echo "exit=$?"
   ```

   Expected: `menu probes: 12 pass · 0 fail` (`quick-buy-model-menu`, `stock-alert-model-menu`, `po-accessory-model-menu` at 1440 and 390, light/dark — the last two attached in Step 22; a PASSing probe adds no finding), `MENU failures …: 0`, no lost cell, no fact drop, and `exit=0`. The converted controls are re-kinded (labels keep their text, so only the kind changes; `dup` is `0` in every pair — no earlier control on these screens has the same kind and name):

   | route | baseline key → t12 key |
   |---|---|
   | `trade-in-quick-buy` | `select-trigger\|รุ่น iPhone *\|0` → `combobox\|รุ่น iPhone *\|0` |
   | `r2-purchase-orders-list` | `select-trigger\|ผู้จัดจำหน่าย\|0` → `combobox\|ผู้จัดจำหน่าย\|0` |
   | `r2-product-create` | `native-select\|รุ่น *\|0` → `combobox\|รุ่น *\|0`; `native-select\|ผู้จัดจำหน่าย\|0` → `combobox\|ผู้จัดจำหน่าย\|0` |
   | `r2-stock-alert-create` | `native-select\|รุ่น\|0` → `combobox\|รุ่น\|0` |
   | `r2-po-wizard-items` | `native-select\|สำหรับรุ่น\|0` → `combobox\|สำหรับรุ่น\|0` |
   | `r2-trade-in-questions` | `native-select\|รุ่นและความจุ\|0` → `combobox\|รุ่นและความจุ\|0` |

   If the compare exits 1, the only acceptable new lines are clause (a) re-keys: in the same cell, a baseline key listed under **Fixed** whose key, after substituting the old memberKey for the new one, equals the new key, with identical detail — one new key per baseline key. List every pair in the task report with both keys and the detail. Anything else must be fixed. In particular:
   - a new F1 `background@combobox|รุ่น iPhone *|0` / `borderColor@…` means `MODEL_TRIGGER_SKIN` no longer matches the ความจุ PurchaseSelect;
   - a new `borderColor` / `background` key on the PO filter row or the product form means a skin class was lost.
3. Look at the screenshots of `r2-po-wizard-items` at 390 and `trade-in-quick-buy` at 390, light and dark: the trigger matches its neighbours.
4. Manual check on the preview, 390px with touch emulation: open the เคส row's "สำหรับรุ่น" menu inside the purchase Drawer and scroll the list. The list scrolls and the Drawer does not drag — the same as the ฟิล์ม picker in the same row, which already uses a Popover + Command. Record the result. If the Drawer drags, report it before committing: it is a Combobox (Task 4) issue, not a call-site one.
5. Leave the verified preview running (AGENTS.md).

- [ ] **Step 24: Commit (two commits)**

```bash
git add apps/web/src/pages/ProductCreatePage/components/ProductInfoCard.tsx \
  apps/web/src/pages/StockAlertsPage.tsx \
  apps/web/src/pages/__tests__/StockAlertsPage.model.test.tsx \
  apps/web/src/pages/PurchaseOrdersPage/components/wizard/items/AccessoryItemRow.tsx \
  apps/web/src/pages/PurchaseOrdersPage/components/wizard/StepItems.test.tsx \
  apps/web/src/pages/TradeInPage/components/ReferenceQuestionnaire.tsx \
  apps/web/src/pages/TradeInPage/components/ReferenceQuestionnaire.test.tsx \
  apps/web/src/components/trade-in/QuickBuyModal.tsx \
  apps/web/src/components/trade-in/TradeInFlow.test.tsx \
  apps/api/e2e/ui-fields/shared-controls.audit-spec.ts \
  apps/api/e2e/ui-fields/fields.audit-spec.ts \
  tools/field-scale/routes.mjs tools/field-scale/check.test.mjs
git commit -F - <<'EOF'
feat(web): searchable รุ่น fields on product, reorder point, PO case row and trade-in (R2-4b)

ProductInfoCard, StockAlertsPage, AccessoryItemRow (เคส), ReferenceQuestionnaire
and QuickBuyModal pick the model from a Combobox instead of a native or Radix
select. Values and side effects are unchanged: a model change still resets
colour/storage (and the QuickBuy inspection), StockAlerts still copies the
catalog category, ReferenceQuestionnaire keeps its model|storage value, and a
re-pick of the current model does nothing, as before.

StockAlertsPage now checks รุ่น itself (กรุณาเลือกรุ่น under the field), since a
Combobox has no browser `required` popup; on ProductCreatePage the existing
toast guard takes over. #quick-buy-model keeps its id and native disabled
attribute for tools/field-scale. ui-fields audits follow the new controls
(and the stock-alert audit's stale "+ Reorder Point" button name). The
stock-alert and PO case-row model menus get their field-scale probes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git add apps/web/src/pages/ProductCreatePage/components/BranchSupplierCard.tsx \
  apps/web/src/pages/ProductCreatePage/index.tsx \
  apps/web/src/pages/ProductCreatePage/__tests__/BranchSupplierCard.test.tsx \
  apps/web/src/pages/ProductCreatePage/__tests__/ProductCreatePage.combobox.test.tsx \
  apps/web/src/pages/PurchaseOrdersPage/components/POListTab.tsx \
  apps/web/src/pages/PurchaseOrdersPage/components/POListTab.test.tsx \
  apps/api/e2e/ui-fields/po-filters.audit-spec.ts
git commit -F - <<'EOF'
feat(web): searchable ผู้จัดจำหน่าย on the product form and PO list filter (R2-4b)

BranchSupplierCard's supplier field becomes a Combobox. Its first option no
longer doubles as the loading/error text: the menu shows กำลังโหลด… or
โหลดรายการไม่สำเร็จ with ลองใหม่ (refetch), and ไม่ระบุ still clears it. The fetch
is unchanged (GET /suppliers?isActive=true, API default 50 rows).

The PO list supplier filter drops the Radix __all__ sentinel: '' is
ทุกผู้จัดจำหน่าย and the client-side filter, chip and clear-all are unchanged.
Long unbroken supplier names still wrap in the menu (po-filters audit) and
the current supplier keeps its check mark.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: two commits on the current branch. Do not push.

---

### Task 13: Expense accounts — 3 fields on `AccountCombobox` (R2-4c, appendix ค)

**Why:** Appendix ค R2-4c converts the three ~50-row expense-account `NativeSelect`s (`useCoaGroups({ type: 'ค่าใช้จ่าย' })`)
to the searchable `AccountCombobox` (Task 7). Runs after Task 7, so after the expense-create PEAK-layout work is on main
(header). Where the spec differs from the code, the code wins (plan-notes):
- `ExpensesPage.tsx:646` — list filter "ประเภทค่าใช้จ่าย" (`aria-label`, no visible label), `<optgroup>` per CoA category
  → the `AccountCombobox` groups by the same category (spec §6.5 "optgroup → group"); `ทุกประเภท` (value `''`) stays as
  the first row (`emptyOption`). The value is still the URL param `category` → `GET /expense-documents?…&category=<code>`.
  A native select fired no change when the same option was picked again; the combobox calls `onChange` on every pick, so
  the call site ignores a re-pick of the current type (otherwise `setFilter` would jump back to page 1). The native select
  sized itself to its longest option (≈ 285px at 14px for the synthetic chart); a button sizes to its text, so the wrapper
  gets a fixed `sm:w-72` (288px) to keep the toolbar from jumping with the picked name (names truncate with a `title`).
  Rows keep today's display — the name only — through an explicit `display="name"` (header "Account codes": owner
  question 4 is still open for the converted pickers).
- `ItemLinesSection.tsx` — repeated per line (expense and credit-note lines); rows and trigger show `<code> - <name>`
  under CoA headings (spec §9.1 / appendix ค "แสดงรหัส + ชื่อ"). The PEAK-layout work moved this field from `NativeSelect`
  onto `AccountSearchDropdown`, and Task 7 Step 5f switched it to `AccountCombobox` with the same props (`aria-label`,
  the expense-code `filter`, placeholder `— เลือก —`), so this task only pins it (Step 2b) and skips Step 4. That work
  dropped the old `— เลือก —` row: a line's account can no longer be set back to empty (it never could be saved empty —
  kept as that work shipped it). `buildExpenseLinePayload` sends `category` unchanged.
- `RecurringBillDialog.tsx` — appendix ค cites `:307` with "สาขาไม่รู้จัก → selectedOption", but `:306-310` is the **branch**
  select (its unknown-branch fallback option is `:309`) — branch selects are not converted (spec §6.4). The account select
  is `:314-318`: options `{code} {display name}` → `display="code-name"` (today's display, kept while owner question 4 is
  open); no fallback option exists today — the
  `AccountCombobox` shows a saved code that left the chart as the code (and saving keeps it, as before). `''` stays
  (`— เลือก —`) so an edit can remove the category. `{...a11y('category', true)}` keeps
  `aria-describedby="rb-category-hint"` (Round 1 S3-09 — test `:223`) and the `rb-category` id (focus-first-error,
  `FIELD_IDS`).
- `RecurringBillDialog.test.tsx` has **11** `selectOptions` (spec says 9); only `:124` targets the account. Its
  `useCoaGroups` mock uses `{ name }` instead of the API's `{ category }` (harmless before — the select flattened groups);
  it becomes `category`.
- e2e `expense-workflow.spec.ts:123-126` (`locator('select, [role="combobox"]').first()` on `/expenses`): `MainLayout` and
  the page header render no select/combobox, so before and after this task it lands on the category filter (a `<select>`
  before, the combobox trigger after) and only asserts visibility — no change needed, verified by reading.
- The three probes Task 1 parked in `PENDING_PROBES` (`account-menu-expense-filter`, `account-menu-expense-line`,
  `account-menu-recurring-bill`) are attached here (Step 9) now that their triggers carry `aria-controls`.
- **Owner question 4 (header "Account codes"):** if the owner wants codes on the converted pickers, Step 5 drops the
  filter's `display="name"` and Step 3 drops RecurringBill's `display="code-name"` (both then use the default).

**Files:**
- Modify: `apps/web/src/components/expense-templates/RecurringBillDialog.tsx:16-17` (imports), `:204-206` (query), `:315-318`
- Modify (test): `apps/web/src/components/expense-templates/RecurringBillDialog.test.tsx:4` (import), `:21` (mock), `:124`,
  new cases before `:226`
- Modify only if Step 4 applies (`ItemLinesSection` still renders the account `NativeSelect`): `apps/web/src/components/expense-form-v4/ItemLinesSection.tsx`
- Create (test): `apps/web/src/components/expense-form-v4/__tests__/ItemLinesSection.account.test.tsx`
- Modify: `apps/web/src/pages/ExpensesPage.tsx:26` (import), `:646-662`
- Modify (test): `apps/web/src/pages/ExpensesPage.ux.test.tsx:2`, `:5`, `:24`, `:31`, `:42`, `:47`; append one `describe`
- Modify (tools): `tools/field-scale/routes.mjs` (two probe constants before `QUICK_BUY_MODEL_MENU`, the `expense-new` /
  `recurring-bill-dialog` / `r2-expenses-list` routes, `PENDING_PROBES`), `tools/field-scale/check.test.mjs` (the pinned
  probe lists)
- No change (verified by reading): `apps/web/e2e/expense-workflow.spec.ts:123-126` (above);
  `apps/api/e2e/ui-fields/fields.audit-spec.ts` routes `expenses-list` / `expenses-create` (generic
  `button[role=combobox]` measure; the triggers keep a name — `aria-label` / `<label htmlFor>` — and 44px; the
  `/expenses/new` interaction :207-225 uses other labels); `dialogs.audit-spec.ts` (ids stay unique);
  `ItemLinesSection.readonly.test.tsx:4` (its `{ data: { groups: [] } }` mock still works); `ExpenseFavoritesPage.test.tsx:14-15`,
  `RecurringBillsPage.test.tsx:18-19` (mock the dialog)

**Interfaces:**
- Consumes: `AccountCombobox` (Task 7) with `coaFilter`, `display`, `emptyOption`, `id`, `aria-label`,
  `aria-describedby`, `aria-invalid`, `wrapperClassName`; `openCombobox` / `pickComboOption` (Task 4).
- Produces: triggers named `ประเภทค่าใช้จ่าย` (`/expenses`), `บัญชีค่าใช้จ่าย` (expense lines — `aria-label`; recurring
  bill, `#rb-category`); probes `account-menu-expense-filter` / `-expense-line` / `-recurring-bill` attached in
  `routes.mjs` (`PENDING_PROBES` keeps only Task 12's, if any).

---

- [ ] **Step 1: Characterization — a recurring bill keeps its saved account (passes on the native select)**

In `apps/web/src/components/expense-templates/RecurringBillDialog.test.tsx` insert before
`  it('ผู้จัดการสาขาสร้างใหม่: สาขาถูกล็อกเป็นสาขาตนเอง', async () => {`:

```tsx
  it('โหมดแก้ไข: บัญชีค่าใช้จ่ายเดิมส่งกลับใน prefilledData ตามเดิม (R2-4c)', async () => {
    const u = userEvent.setup();
    mount({ template });
    await screen.findByRole('dialog');
    await u.clear(field('เตือนล่วงหน้า (วัน)'));
    await u.type(field('เตือนล่วงหน้า (วัน)'), '5');
    await u.click(submit());
    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    expect(apiPatch.mock.calls[0][1]).toMatchObject({ prefilledData: { category: '53-1301' } });
  });

  it('โหมดแก้ไข: รหัสบัญชีที่ไม่อยู่ในผังแล้วไม่ถูกล้างตอนบันทึก (R2-4c)', async () => {
    const u = userEvent.setup();
    mount({ template: { ...template, prefilledData: { ...template.prefilledData, category: '53-9999' } } });
    await screen.findByRole('dialog');
    await u.click(submit());
    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    expect(apiPatch.mock.calls[0][1]).toMatchObject({ prefilledData: { category: '53-9999' } });
  });

```

Run:

```bash
cd apps/web && npx vitest run src/components/expense-templates/RecurringBillDialog.test.tsx
```

Expected: PASS — `Tests  13 passed (13)`.

- [ ] **Step 2: Write the failing strict tests (one or more per field)**

2a. `RecurringBillDialog.test.tsx` — replace

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
```

with

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { openCombobox, pickComboOption } from '@/test/combobox';
```

replace (`:21`)

```tsx
  useCoaGroups: () => ({ data: { groups: [{ name: 'ค่าใช้จ่ายดำเนินงาน', accounts: [{ code: '53-1302', name: 'ค่าโทรศัพท์และอินเทอร์เน็ต' }, { code: '53-1301', name: 'ค่าเช่า' }] }] } }),
```

with

```tsx
  useCoaGroups: () => ({ data: { groups: [{ category: 'ค่าใช้จ่ายดำเนินงาน', accounts: [{ code: '53-1302', name: 'ค่าโทรศัพท์และอินเทอร์เน็ต' }, { code: '53-1301', name: 'ค่าเช่า' }] }] } }),
```

replace (`:124`)

```tsx
    await u.selectOptions(field('บัญชีค่าใช้จ่าย'), '53-1302');
```

with

```tsx
    await pickComboOption(u, 'บัญชีค่าใช้จ่าย', '53-1302 ค่าโทรศัพท์และอินเทอร์เน็ต');
```

and insert before `  it('ผู้จัดการสาขาสร้างใหม่: สาขาถูกล็อกเป็นสาขาตนเอง', async () => {`:

```tsx
  it('บัญชีค่าใช้จ่ายเป็นช่องค้นหา: แถวแสดงรหัส + ชื่อ ค้นด้วยรหัสได้ (R2-4c)', async () => {
    const u = userEvent.setup();
    mount();
    await screen.findByRole('dialog');
    const list = await openCombobox(u, 'บัญชีค่าใช้จ่าย');
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual([
      '— เลือก —',
      '53-1302 ค่าโทรศัพท์และอินเทอร์เน็ต',
      '53-1301 ค่าเช่า',
    ]);
    await u.keyboard('{Escape}');
    await pickComboOption(u, 'บัญชีค่าใช้จ่าย', '53-1301 ค่าเช่า', { search: '1301' });
    expect(field('บัญชีค่าใช้จ่าย')).toHaveTextContent('53-1301 ค่าเช่า');
    expect(screen.getByRole('dialog')).toBeInTheDocument(); // picking does not close the dialog
  });

  it('โหมดแก้ไข: ช่องแสดงบัญชีเดิม · เลือก "— เลือก —" แล้ว PATCH ไม่มี category (R2-4c)', async () => {
    const u = userEvent.setup();
    mount({ template });
    await screen.findByRole('dialog');
    expect(field('บัญชีค่าใช้จ่าย')).toHaveTextContent('53-1301 ค่าเช่า');
    await pickComboOption(u, 'บัญชีค่าใช้จ่าย', '— เลือก —');
    await u.click(submit());
    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    expect((apiPatch.mock.calls[0][1] as { prefilledData: Record<string, unknown> }).prefilledData).not.toHaveProperty('category');
  });

  it('โหมดแก้ไข: รหัสที่ไม่อยู่ในผังแสดงเป็นรหัส ไม่ใช่ "— เลือก —" (R2-4c)', async () => {
    mount({ template: { ...template, prefilledData: { ...template.prefilledData, category: '53-9999' } } });
    await screen.findByRole('dialog');
    expect(field('บัญชีค่าใช้จ่าย')).toHaveTextContent('53-9999');
  });

```

(`:223` `expect(field('บัญชีค่าใช้จ่าย')).toHaveAccessibleDescription('ไปอยู่ในบรรทัดของร่างใบรายจ่าย — แก้ในร่างได้');` stays
as it is — after Step 3 `field()` returns the trigger, which keeps `aria-describedby="rb-category-hint"`.)

2b. Create `apps/web/src/components/expense-form-v4/__tests__/ItemLinesSection.account.test.tsx` with exactly:

```tsx
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { openCombobox, pickComboOption } from '@/test/combobox';

const coa = vi.hoisted(() => ({ filters: [] as unknown[] }));
vi.mock('@/hooks/useCoa', () => ({
  useCoaGroups: (filter: unknown) => {
    coa.filters.push(filter);
    return {
      data: {
        groups: [
          { category: 'OpEx-สถานที่', accounts: [{ code: '53-1301', name: 'ค่าเช่า (สำนักงาน)' }, { code: '53-1302', name: 'ค่าโทรศัพท์และอินเทอร์เน็ต' }] },
          { category: 'OpEx-วิชาชีพ', accounts: [{ code: '53-1501', name: 'ค่าทำบัญชี' }] },
        ],
      },
    };
  },
}));
vi.mock('@/hooks/useUiFlags', () => ({ useUiFlags: () => ({ whtRates: [] }) }));

import { ItemLinesSection } from '../ItemLinesSection';
import { newLine, type ExpenseLineForm } from '../types';
import { buildExpenseLinePayload } from '../expense-line-payload';

function Harness({ onLines, category = '' }: { onLines: (l: ExpenseLineForm[]) => void; category?: string }) {
  const [lines, setLines] = useState([newLine({ uid: 'l1', category, quantity: '1', unitPrice: '100' })]);
  return (
    <ItemLinesSection
      lines={lines}
      onChange={(next) => {
        setLines(next);
        onLines(next);
      }}
      priceTypeLabel="ไม่รวม VAT"
    />
  );
}

// R2-4c — the expense-line account is the searchable AccountCombobox: "<code> - <name>" under the CoA
// category (owner 2026-11-16, spec §9.1); the value written to the line is still the code.
describe('ItemLinesSection — บัญชีค่าใช้จ่าย (R2-4c)', () => {
  it('lists expense accounts as "<code> - <name>" under their category and writes the code into the line', async () => {
    const user = userEvent.setup();
    const onLines = vi.fn();
    render(<Harness onLines={onLines} />);
    expect(coa.filters).toContainEqual({ type: 'ค่าใช้จ่าย' });
    expect(screen.getByRole('combobox', { name: 'บัญชีค่าใช้จ่าย' })).toHaveTextContent('— เลือก —');

    const list = await openCombobox(user, 'บัญชีค่าใช้จ่าย');
    expect(within(list).getAllByRole('option', { name: /^53-/ }).map((o) => o.textContent)).toEqual([
      '53-1301 - ค่าเช่า',
      '53-1302 - ค่าโทรศัพท์และอินเทอร์เน็ต',
      '53-1501 - ค่าทำบัญชี',
    ]);
    expect(within(list).getByText('OpEx-วิชาชีพ')).toBeInTheDocument();
    await user.click(within(list).getByRole('option', { name: '53-1302 - ค่าโทรศัพท์และอินเทอร์เน็ต' }));

    const [line] = onLines.mock.lastCall![0] as ExpenseLineForm[];
    expect(line.category).toBe('53-1302');
    expect(buildExpenseLinePayload(line).category).toBe('53-1302');
    expect(screen.getByRole('combobox', { name: 'บัญชีค่าใช้จ่าย' })).toHaveTextContent(
      '53-1302 - ค่าโทรศัพท์และอินเทอร์เน็ต',
    );
  });

  it('finds an account by its code', async () => {
    const user = userEvent.setup();
    const onLines = vi.fn();
    render(<Harness onLines={onLines} />);
    await pickComboOption(user, 'บัญชีค่าใช้จ่าย', '53-1501 - ค่าทำบัญชี', { search: '53-15' });
    expect((onLines.mock.lastCall![0] as ExpenseLineForm[])[0].category).toBe('53-1501');
  });

  it('a saved account shows "<code> - <name>" on the trigger', () => {
    render(<Harness onLines={vi.fn()} category="53-1301" />);
    expect(screen.getByRole('combobox', { name: 'บัญชีค่าใช้จ่าย' })).toHaveTextContent('53-1301 - ค่าเช่า');
  });
});
```

(`getAllByRole('option', { name: /^53-/ })` reads the account rows only, so the test holds whether or not a `— เลือก —` row
exists — Step 4's fallback keeps one.)

2c. `apps/web/src/pages/ExpensesPage.ux.test.tsx` — replace

```tsx
import { render, screen, waitFor } from '@testing-library/react';
```

with

```tsx
import { render, screen, waitFor, within } from '@testing-library/react';
```

replace

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
```

with

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { openCombobox, pickComboOption } from '@/test/combobox';
```

replace

```tsx
vi.mock('@/hooks/useCoa', () => ({ useCoaGroups: () => ({ data: { groups: [] } }) }));
```

with

```tsx
const coaGroups = vi.hoisted(() => ({ current: [] as { category: string; accounts: { code: string; name: string }[] }[] }));
vi.mock('@/hooks/useCoa', () => ({ useCoaGroups: () => ({ data: { groups: coaGroups.current } }) }));
```

replace `function mount(status = 'DRAFT', documentType = 'EXPENSE') {` with
`function mount(status = 'DRAFT', documentType = 'EXPENSE', path = '/expenses') {`,
replace `<MemoryRouter initialEntries={['/expenses']}>` with `<MemoryRouter initialEntries={[path]}>`,
replace `  apiGet.mockReset(); apiPost.mockReset(); approvalEnabled = false; allowed = true;` with
`  apiGet.mockReset(); apiPost.mockReset(); approvalEnabled = false; allowed = true; coaGroups.current = [];`,
and append at the end of the file:

```tsx

// R2-4c — ตัวกรอง "ประเภทค่าใช้จ่าย" เป็นช่องค้นหา (กลุ่มตามหมวดบัญชีแทน optgroup) · ส่งรหัสบัญชีใน ?category= เหมือนเดิม
describe('expense category filter', () => {
  beforeEach(() => {
    coaGroups.current = [
      { category: 'OpEx-สถานที่', accounts: [{ code: '53-1301', name: 'ค่าเช่า (สำนักงาน)' }, { code: '53-1302', name: 'ค่าโทรศัพท์และอินเทอร์เน็ต' }] },
      { category: 'OpEx-วิชาชีพ', accounts: [{ code: '53-1501', name: 'ค่าทำบัญชี' }] },
    ];
  });

  it('lists ทุกประเภท and the accounts under their category; picking one filters the list by its code', async () => {
    const user = userEvent.setup(); mount();
    expect(screen.getByRole('combobox', { name: 'ประเภทค่าใช้จ่าย' })).toHaveTextContent('ทุกประเภท');
    const list = await openCombobox(user, 'ประเภทค่าใช้จ่าย');
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['ทุกประเภท', 'ค่าเช่า', 'ค่าโทรศัพท์และอินเทอร์เน็ต', 'ค่าทำบัญชี']);
    expect(within(list).getByText('OpEx-วิชาชีพ')).toBeInTheDocument();
    await user.click(within(list).getByRole('option', { name: 'ค่าโทรศัพท์และอินเทอร์เน็ต' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/expenses?category=53-1302&page=1');
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringMatching(/^\/expense-documents\?.*category=53-1302/)));
  });

  it('ทุกประเภท removes the category from the URL', async () => {
    const user = userEvent.setup(); mount('DRAFT', 'EXPENSE', '/expenses?category=53-1302');
    expect(screen.getByRole('combobox', { name: 'ประเภทค่าใช้จ่าย' })).toHaveTextContent('ค่าโทรศัพท์และอินเทอร์เน็ต');
    await pickComboOption(user, 'ประเภทค่าใช้จ่าย', 'ทุกประเภท');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/expenses\?page=1$/);
  });

  it('picking the current type again keeps the page (a native select fired no change)', async () => {
    const user = userEvent.setup(); mount('DRAFT', 'EXPENSE', '/expenses?category=53-1302&page=3');
    await pickComboOption(user, 'ประเภทค่าใช้จ่าย', 'ค่าโทรศัพท์และอินเทอร์เน็ต');
    expect(screen.getByTestId('location')).toHaveTextContent('/expenses?category=53-1302&page=3');
  });
});
```

Run:

```bash
cd apps/web && npx vitest run src/components/expense-templates/RecurringBillDialog.test.tsx src/components/expense-form-v4/__tests__/ItemLinesSection.account.test.tsx src/pages/ExpensesPage.ux.test.tsx
```

Expected: FAIL — RecurringBillDialog `4 failed | 12 passed (16)` (the POST case at `:124` and the 3 new cases);
ExpensesPage.ux `3 failed`, the rest passing (`3 failed | 18 passed (21)` on the PEAK-layout commit `7b67db27c`; its later commits add tests to this file). ItemLinesSection.account already passes, `3 passed (3)`: Task 7 Step 5f moved
the expense lines onto `AccountCombobox` (if `ItemLinesSection` still renders the `NativeSelect`, its 3 tests fail inside
`openCombobox` / `pickComboOption` — then Step 4 applies). The pick-based cases fail inside
`openCombobox` / `pickComboOption` (the native `<select>` — also `role=combobox` with the same name — opens no menu);
`รหัสที่ไม่อยู่ในผัง…` fails at `toHaveTextContent('53-9999')` (a native select's text is its option list).

- [ ] **Step 3: RecurringBillDialog → `AccountCombobox`**

In `apps/web/src/components/expense-templates/RecurringBillDialog.tsx` replace

```tsx
import { useCoaGroups } from '@/hooks/useCoa';
import { accountDisplayName } from '@/utils/accountName';
```

with

```tsx
import { AccountCombobox } from '@/components/accounting/AccountCombobox';
```

delete (with the blank line after it)

```tsx
  const { data: coa } = useCoaGroups({ type: 'ค่าใช้จ่าย' });
  const groups = coa?.groups ?? [];

```

and replace

```tsx
              <NativeSelect id="rb-category" value={form.category} onChange={(e) => set('category', e.target.value)} {...a11y('category', true)}>
                <option value="">— เลือก —</option>
                {groups.flatMap((g) => g.accounts.map((a) => <option key={a.code} value={a.code}>{a.code} {accountDisplayName(a.name)}</option>))}
              </NativeSelect>
```

with

```tsx
              <AccountCombobox id="rb-category" value={form.category} onChange={(code) => set('category', code)} coaFilter={{ type: 'ค่าใช้จ่าย' }} display="code-name" emptyOption="— เลือก —" {...a11y('category', true)} />
```

(`NativeSelect` stays imported — branch, payment, frequency and month still use it; the branch select `:306-310` and its
`:309` fallback option are not touched.)

- [ ] **Step 4: ItemLinesSection → `AccountCombobox` (only if it still renders the account `NativeSelect`)**

```bash
grep -n "AccountCombobox\|NativeSelect" apps/web/src/components/expense-form-v4/ItemLinesSection.tsx
```

If `ItemLinesSection.tsx` already renders `AccountCombobox` (Task 7 Step 5f — the normal case after the PEAK-layout
merge), skip this step; Step 2b's test still applies. Otherwise (the field is still the `NativeSelect` of `6e79e6eb4`; the
old strings below are from that commit) in `apps/web/src/components/expense-form-v4/ItemLinesSection.tsx` replace

```tsx
import { useCoaGroups } from '@/hooks/useCoa';
import { Plus, Trash2 } from 'lucide-react';
import { ExpenseLineForm, newLine } from './types';
import { formatNumberDecimal } from '@/utils/formatters';
import { accountDisplayName } from '@/utils/accountName';
```

with

```tsx
import { AccountCombobox } from '@/components/accounting/AccountCombobox';
import { Plus, Trash2 } from 'lucide-react';
import { ExpenseLineForm, newLine } from './types';
import { formatNumberDecimal } from '@/utils/formatters';
```

replace

```tsx
  const fieldId = useFieldId();
  const { data: coaData } = useCoaGroups({ type: 'ค่าใช้จ่าย' });
  const groups = coaData?.groups ?? [];
```

with

```tsx
  const fieldId = useFieldId();
```

and replace

```tsx
              <NativeSelect wrapperClassName="max-w-full w-full min-w-0" id={`${fieldId}-${line.uid}-1`}
                value={line.category}
                onChange={(e) => updateLine(line.uid, { category: e.target.value })}
                className={formControlClass}
              >
                <option value="">— เลือก —</option>
                {groups.flatMap((g) =>
                  g.accounts.map((a) => (
                    <option key={a.code} value={a.code}>
                      {accountDisplayName(a.name)}
                    </option>
                  )),
                )}
              </NativeSelect>
```

with

```tsx
              {/* R2-4c — rows `<code> - <name>` (default display, spec §9.1); `— เลือก —` still clears the line */}
              <AccountCombobox
                id={`${fieldId}-${line.uid}-1`}
                value={line.category}
                onChange={(code) => updateLine(line.uid, { category: code })}
                coaFilter={{ type: 'ค่าใช้จ่าย' }}
                emptyOption="— เลือก —"
              />
```

(`NativeSelect` and `formControlClass` stay imported — the VAT/WHT selects and number fields use them.)

- [ ] **Step 5: ExpensesPage filter → `AccountCombobox`**

In `apps/web/src/pages/ExpensesPage.tsx` replace `import { accountDisplayName } from '@/utils/accountName';` with
`import { AccountCombobox } from '@/components/accounting/AccountCombobox';` and replace

```tsx
        <NativeSelect wrapperClassName="max-w-full w-full min-w-0 sm:w-auto sm:min-w-[150px]"
          aria-label="ประเภทค่าใช้จ่าย"
          value={categoryFilter}
          onChange={(e) => setFilter('category', e.target.value)}
          className={cn(formControlClass, "")}
        >
          <option value="">ทุกประเภท</option>
          {coaGroups.map((g) => (
            <optgroup key={g.category} label={g.category}>
              {g.accounts.map((a) => (
                <option key={a.code} value={a.code}>
                  {accountDisplayName(a.name)}
                </option>
              ))}
            </optgroup>
          ))}
        </NativeSelect>
```

with

```tsx
        {/* R2-4c — searchable; CoA category = the old optgroup. sm:w-72 ≈ the native select's
            width (its longest option) so the toolbar does not jump with the picked name. */}
        <AccountCombobox
          wrapperClassName="max-w-full w-full min-w-0 sm:w-72"
          aria-label="ประเภทค่าใช้จ่าย"
          value={categoryFilter}
          onChange={(code) => {
            // A native select fired no change when the same type was picked again — keep the page.
            if (code !== categoryFilter) setFilter('category', code);
          }}
          coaFilter={{ type: 'ค่าใช้จ่าย' }}
          display="name"
          emptyOption="ทุกประเภท"
        />
```

(`useCoaGroups` / `coaGroups` / `codeToName` stay — the "บัญชี" column uses them; same query key as the picker, one
request. `NativeSelect`, `cn`, `formControlClass` stay — the advanced filters and the search field use them.)

- [ ] **Step 6: Run the tests**

```bash
cd apps/web && npx vitest run src/components/expense-templates src/components/expense-form-v4 src/pages/ExpensesPage.ux.test.tsx src/pages/ExpenseFavoritesPage.test.tsx src/pages/RecurringBillsPage src/components/accounting src/components/ui/field-guards.inventory.test.ts src/components/ui/native-select.inventory.test.ts
```

Expected: every file passes, 0 failed — RecurringBillDialog `16 passed`, ItemLinesSection.account `3 passed`,
ExpensesPage.ux all passing (21 on `7b67db27c`, 22 with the PEAK-layout commits up to `5e44c303f`).

- [ ] **Step 7: e2e / audit specs (not executed on Windows; verified by reading)**

No file changes (see **Why** and **Files → No change**): `apps/web/e2e/expense-workflow.spec.ts:123-126` still hits the
category filter (first `select, [role="combobox"]` on `/expenses`, now the combobox trigger) and asserts visibility only;
no web e2e selects an expense account (`grep -rn "บัญชีค่าใช้จ่าย\|rb-category\|ประเภทค่าใช้จ่าย" apps/web/e2e` → comments in
`approval-workflow.spec.ts:92,101` only); `apps/api/e2e/ui-fields/fields.audit-spec.ts` measures
`button[role=combobox]` generically — the converted triggers keep a name and 44px. Not executed on Windows.

- [ ] **Step 8: Type check + lint**

```bash
bash tools/check-types.sh web
cd apps/web && npx eslint src/components/expense-templates/RecurringBillDialog.tsx src/components/expense-templates/RecurringBillDialog.test.tsx src/components/expense-form-v4/ItemLinesSection.tsx src/components/expense-form-v4/__tests__/ItemLinesSection.account.test.tsx src/pages/ExpensesPage.tsx src/pages/ExpensesPage.ux.test.tsx
```

Expected: 0 type errors; ESLint prints nothing.

- [ ] **Step 9: Attach the three pending account-menu probes (`tools/field-scale`)**

Task 1 parked them in `PENDING_PROBES` because a native `<select>` has no `aria-controls` (a failing probe blocks every
compare). Their triggers are `AccountCombobox` now. The edits do not depend on whether Task 12 already attached its two.

In `tools/field-scale/routes.mjs` replace

```js
// Round 2 (Task 1): a portalled Radix Select inside QuickBuyModal (a Radix Dialog); R2-4b keeps id="quick-buy-model"
```

with

```js
// Round 2 Task 13 attached these two from PENDING_PROBES (the expense-account fields are AccountCombobox now).
// Defined before R1_ROUTES: the two Round 1 routes below use them.
const ACCOUNT_MENU_EXPENSE_LINE = {
  id: 'account-menu-expense-line', widths: [1440], menu: 'controls',
  trigger: (page) => page.getByRole('combobox', { name: 'บัญชีค่าใช้จ่าย' }).first(),
};
const ACCOUNT_MENU_RECURRING_BILL = {
  id: 'account-menu-recurring-bill', widths: [1440], menu: 'controls',
  trigger: (page) => page.getByRole('dialog').getByRole('combobox', { name: 'บัญชีค่าใช้จ่าย' }),
};

// Round 2 (Task 1): a portalled Radix Select inside QuickBuyModal (a Radix Dialog); R2-4b keeps id="quick-buy-model"
```

replace

```js
  { id: 'expense-new', path: '/expenses/new', appendix: ['S3-02', 'S3-04', 'S3-05'], mocks: M.expense },
```

with

```js
  { id: 'expense-new', path: '/expenses/new', appendix: ['S3-02', 'S3-04', 'S3-05'], mocks: M.expense,
    probes: [ACCOUNT_MENU_EXPENSE_LINE] },
```

replace

```js
  { id: 'recurring-bill-dialog', path: '/expenses/favorites', appendix: ['S3-09'], open: clickButton('+ บิลประจำ'),
    mocks: M.expense },
```

with

```js
  { id: 'recurring-bill-dialog', path: '/expenses/favorites', appendix: ['S3-09'], open: clickButton('+ บิลประจำ'),
    mocks: M.expense, probes: [ACCOUNT_MENU_RECURRING_BILL] },
```

replace

```js
export const PENDING_PROBES = {
  'r2-expenses-list': [{ // Task 13
    id: 'account-menu-expense-filter', widths: [1440], menu: 'controls',
    trigger: (page) => page.getByRole('combobox', { name: 'ประเภทค่าใช้จ่าย' }),
  }],
  'expense-new': [{ // Task 13
    id: 'account-menu-expense-line', widths: [1440], menu: 'controls',
    trigger: (page) => page.getByRole('combobox', { name: 'บัญชีค่าใช้จ่าย' }).first(),
  }],
  'recurring-bill-dialog': [{ // Task 13
    id: 'account-menu-recurring-bill', widths: [1440], menu: 'controls',
    trigger: (page) => page.getByRole('dialog').getByRole('combobox', { name: 'บัญชีค่าใช้จ่าย' }),
  }],
```

with

```js
// Round 2 Task 13 attached it (the /expenses type filter is AccountCombobox now).
const ACCOUNT_MENU_EXPENSE_FILTER = {
  id: 'account-menu-expense-filter', widths: [1440], menu: 'controls',
  trigger: (page) => page.getByRole('combobox', { name: 'ประเภทค่าใช้จ่าย' }),
};

export const PENDING_PROBES = {
```

replace

```js
  { id: 'r2-expenses-list', path: '/expenses', appendix: ['R2-4c ExpensesPage'], mocks: R2.expensesList },
```

with

```js
  { id: 'r2-expenses-list', path: '/expenses', appendix: ['R2-4c ExpensesPage'], mocks: R2.expensesList,
    probes: [ACCOUNT_MENU_EXPENSE_FILTER] },
```

In `tools/field-scale/check.test.mjs` replace

```js
    ['other-income-override', 'account-menu-override-jv', [1440], 'controls'],
```

with

```js
    ['other-income-override', 'account-menu-override-jv', [1440], 'controls'],
    ['expense-new', 'account-menu-expense-line', [1440], 'controls'],
    ['recurring-bill-dialog', 'account-menu-recurring-bill', [1440], 'controls'],
```

replace

```js
    ['r2-petty-cash-lines', 'account-menu-petty-cash', [1440, 390], 'controls'],
```

with

```js
    ['r2-petty-cash-lines', 'account-menu-petty-cash', [1440, 390], 'controls'],
    ['r2-expenses-list', 'account-menu-expense-filter', [1440], 'controls'],
```

replace

```js
    ['r2-expenses-list', 'account-menu-expense-filter', [1440], 'controls'],
    ['expense-new', 'account-menu-expense-line', [1440], 'controls'],
    ['recurring-bill-dialog', 'account-menu-recurring-bill', [1440], 'controls'],
```

with nothing (delete those lines)

Run:

```bash
node --test tools/field-scale/check.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Expected: `ℹ tests 32` · `ℹ pass 32` · `ℹ fail 0`.

- [ ] **Step 10: field-scale + menu probes + screenshots**

```bash
npm run local:preview
node tools/field-scale/check.mjs --label t13-expense-accounts --routes expense-new,recurring-bill-dialog,r2-expenses-list,r2-credit-note-lines
node tools/field-scale/check.mjs --compare baseline-r2 t13-expense-accounts
echo "exit=$?"
```

(Compare against `baseline-r2-peak` instead if the header's PEAK-layout rule made you record it.)

Expected:
- `menu probes: 6 pass · 0 fail` (`account-menu-expense-line`, `account-menu-recurring-bill`, `account-menu-expense-filter`,
  light/dark at 1440 — attached in Step 9). They did not run on the baseline (pending), and a PASSing probe yields no
  finding, so the compare is unaffected by them; a failing one is a MENU failure and blocks.
- Compare `exit=0`, or `exit=1` where every new P2 line is a clause (a) re-key, same cell, same detail:
  `<prop>@native-select|บัญชีค่าใช้จ่าย|<n>` → `<prop>@combobox|บัญชีค่าใช้จ่าย|<n>` on `recurring-bill-dialog` (it shares a row with
  the สาขา select); `<prop>@native-select|ประเภทค่าใช้จ่าย|0` → `<prop>@combobox|ประเภทค่าใช้จ่าย|0` on `r2-expenses-list`;
  on `expense-new` and `r2-credit-note-lines` the pairs Task 7 Step 8 already listed (`select-trigger|บัญชีค่าใช้จ่าย` →
  `combobox|บัญชีค่าใช้จ่าย` — the compare is cumulative against the baseline), unless Step 4 ran (then
  `native-select|บัญชีค่าใช้จ่าย` → `combobox|บัญชีค่าใช้จ่าย`). F2 "longest option wider than the field" findings of the
  converted native selects (if any in the baseline) go under **Fixed**. Anything else (F2/F3/F4, MENU, changed detail)
  must be fixed.
- Screenshots (baseline vs `t13-expense-accounts/`): `r2-expenses-list-{1440,390}-{light,dark}.png` — the filter
  shows `ทุกประเภท`, is 288px wide from `sm` up and full width at 390, the toolbar row keeps its wrap;
  `recurring-bill-dialog-…png` — สาขา and บัญชีค่าใช้จ่าย side by side, same height, the hint text still under the account;
  the three `…-1440-light-account-menu-*.png` — search box, category headings, `<code> - <name>` rows on the expense line,
  `<code> <name>` on the recurring bill, names on the filter; the recurring-bill menu above the dialog.

Real-save check (spec §9, as far as the preview API goes): on `/expenses/favorites` → `+ บิลประจำ`, fill ชื่อบิล, สาขา,
วันครบกำหนด, pick an account, `บันทึกบิลประจำ`; in DevTools Network the `POST …/expense-templates` body has
`prefilledData.category` = the picked code. On `/expenses` pick a type and check the `GET …/expense-documents?…&category=<code>`
request. Where the synthetic preview API answers 404, record "not verifiable on the preview — payload proven by
`RecurringBillDialog.test.tsx` / `ExpensesPage.ux.test.tsx`".

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/components/expense-templates/RecurringBillDialog.tsx \
  apps/web/src/components/expense-templates/RecurringBillDialog.test.tsx \
  apps/web/src/components/expense-form-v4/__tests__/ItemLinesSection.account.test.tsx \
  apps/web/src/pages/ExpensesPage.tsx apps/web/src/pages/ExpensesPage.ux.test.tsx \
  tools/field-scale/routes.mjs tools/field-scale/check.test.mjs
# only if Step 4 changed it:
# git add apps/web/src/components/expense-form-v4/ItemLinesSection.tsx
git commit -F - <<'EOF'
feat(web): expense-account fields use AccountCombobox (R2-4c)

The /expenses type filter (CoA categories replace the optgroups), the
expense-line account and the recurring-bill account are searchable by
name or code. Values sent are unchanged: ?category=<code>, line.category,
prefilledData.category; "ทุกประเภท" / "— เลือก —" stay as the empty
choice, re-picking the current type keeps the page, a recurring bill
whose account left the chart shows and keeps its code. The expense-line
picker (AccountCombobox since R2-3a) gets its test; the three pending
field-scale account-menu probes are attached.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: one commit. Do not push.

---

### Task 14: Others (4) → `Combobox` (R2-4d)

**Why:** Appendix ค rows R2-4d: four long dropdowns become searchable `Combobox`es. In every case the value and the save path stay the same:
- **ChatAnalyticsPage พนักงาน** — the label stays `ชื่อ · ท้าย id 6 ตัว`; the draft `staffId` is applied to the URL only on `แสดงรายงาน`. `loading` is shown while `/chat-analytics/v2/filter-options` loads. That query's error already shows in the page's QueryBoundary, so the field does not repeat it.
- **SalesHistoryPage พนักงานขาย** — `'' = ทุกพนักงาน`. The filter still goes to `GET /sales?…salespersonId=` and to the Excel export through `buildParams`. The list (`GET /sales/salespersons`) is still fetched for OWNER/BRANCH_MANAGER only, and only they see the row.
- **QuickReplyEditor เมื่อกด** — `<optgroup label="ส่ง แม่แบบตอบกลับ">` becomes `group` (spec §6.5). The field still **saves immediately on pick** (`PATCH /staff-chat/canned-responses/quick-replies/:id` with `{ payload: 'TEMPLATE:<id>' | '' }`) and never on open or search. There is still no error toast (none existed — kept). A re-pick of the current choice saves nothing, because a native `<select>` fired no `change` for it. Pre-existing, not touched: at 390 the editor pane is ≈ 0px wide (`CannedResponseAdminPage.tsx:288-289`, the 384px tree pane does not shrink).
- **UserProfilePage Extension Yeastar** — label `เบอร์ — ชื่อ`; the pick changes the draft only; `บันทึก` still PATCHes `/users/me/extension`. One display difference, on purpose: when the saved extension is no longer in the PBX list, Radix showed an empty trigger and the Combobox shows the number (`selectedOption`, spec §6.3) — the value and the save are unchanged.

Labels: ChatAnalytics' wrapping `<label>` becomes `<label htmlFor>` + sibling trigger. A label wrapping a `role=combobox` button would put the value into its accessible name (spec §6.1). It keeps the same plain classes as its four sibling labels in the row. SalesHistory keeps its `aria-label`, like every other field in that filter bar, which has no visible labels. QuickReplyEditor and UserProfile already have `<label htmlFor>`. Widths: a button trigger sizes to the *selected* label, while a `w-auto` native select sized to its longest option. So SalesHistory gets `w-full sm:w-56`, and the others keep their flex/full widths.

**Files:**
- Modify: `apps/web/src/pages/ChatAnalyticsPage.tsx` (imports :1-2; `AnalyticsDashboard` :84; พนักงาน :272-286)
- Modify: `apps/web/src/pages/SalesHistoryPage.tsx` (import :1; พนักงานขาย :741-750)
- Modify: `apps/web/src/pages/canned-response-admin/QuickReplyEditor.tsx` (import :1; :47; เมื่อกด :81-99)
- Modify: `apps/web/src/pages/UserProfilePage.tsx` (imports :10-17; :44; Extension :135-146)
- Modify (test): `apps/web/src/pages/chat-analytics/ChatAnalyticsPage.test.tsx` (imports :1-5; new test before :61)
- Create (tests): `apps/web/src/pages/__tests__/SalesHistoryPage.salesperson.test.tsx`, `apps/web/src/pages/canned-response-admin/QuickReplyEditor.test.tsx`, `apps/web/src/pages/__tests__/UserProfilePage.extension.test.tsx`
- Modify (web e2e, not run on Windows): `apps/web/e2e/sales-menu-regression.spec.ts` (:365), `apps/web/e2e/profile-preferences.spec.ts` (:55-56)
- No change, verified by running: `apps/web/src/pages/__tests__/SalesHistoryPage.void.test.tsx`, `SalesHistoryPage.receipt.test.tsx`, `apps/web/src/pages/CannedResponseAdminPage.test.tsx` (they render these pages and do not touch the fields). No api ui-fields audit drives these four fields; `dialogs.audit-spec.ts` `canned-create` opens the create dialog, not the quick-reply editor.

**Interfaces:**
- Consumes (Task 4): `Combobox` (`id`, `aria-label`, `value`, `onChange`, `options` incl. `group`, `selectedOption`, `placeholder`, `loading`, `className`, `wrapperClassName`), `pickComboOption` / `openCombobox`, DOM contract `[data-slot=combobox-content]`, default `searchLabel` `'ค้นหา'`, `id` and native `disabled` on the trigger (header).
- Produces: triggers named `พนักงาน` (ChatAnalytics, `<label htmlFor>`), `พนักงานขาย` (`aria-label`), `เมื่อกด:` (`<label htmlFor>`, one per POSTBACK quick reply), `Extension Yeastar (โทรศัพท์)` (`<label htmlFor>`). No props or exports change.

---

- [ ] **Step 1: Re-check the loose e2e locators**

Same grep as Task 12 Step 1. Expected: no line lands on `/chat-analytics`, `/sales`, `/canned-responses` or `/profile`. The only e2e lines that drive these fields are the direct ones in Steps 10–11.

- [ ] **Step 2: Write the failing tests**

In `apps/web/src/pages/chat-analytics/ChatAnalyticsPage.test.tsx` replace

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
```

with

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
```

replace

```tsx
import ChatAnalyticsPage from '../ChatAnalyticsPage';
```

with

```tsx
import { pickComboOption } from '@/test/combobox';
import ChatAnalyticsPage from '../ChatAnalyticsPage';
```

and replace

```tsx
  it('does not call metrics while the feature flag is off', async () => {
```

with

```tsx
  it('พนักงาน: picks a staff member from the searchable list and sends staffId only on แสดงรายงาน', async () => {
    const user = userEvent.setup();
    mocks.get.mockImplementation((url: string) =>
      url === '/chat-analytics/v2/filter-options'
        ? Promise.resolve({
            data: {
              branches: [],
              staff: [
                { id: 'staff-0000-aaaa01', name: 'สมชาย ตอบไว' },
                { id: 'staff-0000-bbbb02', name: 'สมหญิง ปิดการขาย' },
              ],
            },
          })
        : Promise.reject(new Error('ไม่มีสิทธิ์แล้ว')),
    );
    view();
    await screen.findByRole('alert'); // every query settled — the staff list has loaded
    const staff = screen.getByRole('combobox', { name: 'พนักงาน' });
    expect(staff).toHaveTextContent('ทุกคน');

    await pickComboOption(user, 'พนักงาน', 'สมหญิง ปิดการขาย · bbbb02', { search: 'หญิง' });
    expect(staff).toHaveTextContent('สมหญิง ปิดการขาย · bbbb02');
    const withStaff = expect.objectContaining({
      params: expect.objectContaining({ staffId: 'staff-0000-bbbb02' }),
    });
    expect(mocks.get).not.toHaveBeenCalledWith('/chat-analytics/v2/overview', withStaff);

    await user.click(screen.getByRole('button', { name: 'แสดงรายงาน' }));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/chat-analytics/v2/overview', withStaff));
  });
  it('does not call metrics while the feature flag is off', async () => {
```

Create `apps/web/src/pages/__tests__/SalesHistoryPage.salesperson.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openCombobox, pickComboOption } from '@/test/combobox';
import SalesHistoryPage from '../SalesHistoryPage';

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => apiGet(...args), post: vi.fn() },
  getErrorMessage: () => 'เกิดข้อผิดพลาด',
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn() } }));
let mockRole = 'OWNER';
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me', role: mockRole, branchId: 'b1' }, isLoading: false, isAuthenticated: true }),
}));

const salespersons = [
  { id: 'sp-1', name: 'สมชาย ขายดี' },
  { id: 'sp-2', name: 'สมหญิง ขายเก่ง' },
];

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const listUrls = () =>
  apiGet.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith('/sales?'));

beforeEach(() => {
  apiGet.mockReset();
  mockRole = 'OWNER';
  apiGet.mockImplementation(async (url: string) => {
    if (url === '/sales/salespersons') return { data: salespersons };
    if (url.startsWith('/sales?')) {
      return {
        data: {
          data: [], total: 0, page: 1, limit: 20, totalPages: 1,
          summary: {
            totalAmount: 0, totalDiscount: 0, totalProfit: 0, cashCount: 0, cashAmount: 0,
            installmentCount: 0, installmentAmount: 0, financeCount: 0, financeAmount: 0,
          },
        },
      };
    }
    return { data: [] };
  });
});

describe('SalesHistoryPage — พนักงานขาย (Combobox)', () => {
  it('OWNER picks a salesperson → the list request carries salespersonId; ทุกพนักงาน drops it', async () => {
    const user = userEvent.setup();
    render(<SalesHistoryPage />, { wrapper });
    const trigger = await screen.findByRole('combobox', { name: 'พนักงานขาย' });
    expect(trigger).toHaveTextContent('ทุกพนักงาน');

    await openCombobox(user, 'พนักงานขาย');
    await user.click(await screen.findByRole('option', { name: 'สมหญิง ขายเก่ง' }));
    await waitFor(() => expect(listUrls().at(-1)).toMatch(/[?&]salespersonId=sp-2(&|$)/));
    expect(trigger).toHaveTextContent('สมหญิง ขายเก่ง');

    await pickComboOption(user, 'พนักงานขาย', 'ทุกพนักงาน');
    await waitFor(() => expect(listUrls().at(-1)).not.toMatch(/salespersonId=/));
  });

  it('SALES does not see the field and never asks for /sales/salespersons', async () => {
    mockRole = 'SALES';
    render(<SalesHistoryPage />, { wrapper });
    await waitFor(() => expect(listUrls().length).toBeGreaterThan(0));
    expect(screen.queryByRole('combobox', { name: 'พนักงานขาย' })).toBeNull();
    expect(apiGet).not.toHaveBeenCalledWith('/sales/salespersons');
  });
});
```

Create `apps/web/src/pages/canned-response-admin/QuickReplyEditor.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import { openCombobox, pickComboOption } from '@/test/combobox';
import QuickReplyEditor from './QuickReplyEditor';
import type { CannedResponse, CannedResponseQuickReply } from './types';

vi.mock('@/lib/api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const template = (id: string, title: string, category: string | null, isActive = true): CannedResponse => ({
  id, shortcut: `/${id}`, title, content: '', category, sortOrder: 0, isActive, createdAt: '2026-11-01T00:00:00Z',
});
const allTemplates = [
  template('self', 'ข้อความนี้เอง', null),
  template('tpl-greet', 'ทักทาย', 'ทั่วไป'),
  template('tpl-loan', 'สนใจผ่อน', 'การเงิน'),
  template('tpl-off', 'แม่แบบที่ปิดแล้ว', null, false),
];
const postback: CannedResponseQuickReply = {
  id: 'qr-1', cannedResponseId: 'self', label: 'สนใจ', type: 'POSTBACK', payload: 'TEMPLATE:tpl-greet',
  url: null, message: null, sortOrder: 0, createdAt: '2026-11-01T00:00:00Z',
};

function renderEditor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <QuickReplyEditor cannedResponseId="self" allTemplates={allTemplates} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue({ data: [postback] });
  vi.mocked(api.patch).mockResolvedValue({ data: {} });
});

describe('QuickReplyEditor — เมื่อกด (Combobox, saves on pick)', () => {
  it('lists active templates except itself under ส่ง แม่แบบตอบกลับ; open + search save nothing; a pick PATCHes TEMPLATE:<id>', async () => {
    const user = userEvent.setup();
    renderEditor();
    const trigger = await screen.findByRole('combobox', { name: 'เมื่อกด:' });
    expect(trigger).toHaveTextContent('ทักทาย · ทั่วไป');

    const listbox = await openCombobox(user, 'เมื่อกด:');
    expect(screen.getByText('ส่ง แม่แบบตอบกลับ')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '— ตั้งเอง (custom payload) —' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /ข้อความนี้เอง/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /แม่แบบที่ปิดแล้ว/ })).toBeNull();
    expect(listbox).toBeInTheDocument();
    await user.type(screen.getByRole('combobox', { name: 'ค้นหา' }), 'ผ่อน');
    expect(api.patch).not.toHaveBeenCalled();

    await user.click(screen.getByRole('option', { name: 'สนใจผ่อน · การเงิน' }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/staff-chat/canned-responses/quick-replies/qr-1', {
        payload: 'TEMPLATE:tpl-loan',
      }),
    );
    expect(api.patch).toHaveBeenCalledTimes(1);
  });

  it('re-picking the current template saves nothing; ตั้งเอง clears the payload', async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByRole('combobox', { name: 'เมื่อกด:' });
    await pickComboOption(user, 'เมื่อกด:', 'ทักทาย · ทั่วไป');
    expect(api.patch).not.toHaveBeenCalled();

    await pickComboOption(user, 'เมื่อกด:', '— ตั้งเอง (custom payload) —');
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/staff-chat/canned-responses/quick-replies/qr-1', { payload: '' }),
    );
    expect(api.patch).toHaveBeenCalledTimes(1);
  });
});
```

Create `apps/web/src/pages/__tests__/UserProfilePage.extension.test.tsx`:

```tsx
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import { pickComboOption } from '@/test/combobox';
import UserProfilePage from '../UserProfilePage';

vi.mock('@/lib/api', () => ({ default: { get: vi.fn(), patch: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/CashAccountSelect', () => ({ CashAccountSelect: () => null }));
const auth = vi.hoisted(() => ({
  user: {
    id: 'user-1', name: 'พนักงานทดสอบ', email: 'staff@example.test', role: 'SALES',
    yeastarExtension: '101', defaultCashAccountCode: '11-1101',
  } as Record<string, unknown>,
  refresh: vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));

const extensions = [
  { number: '101', name: 'หมายเลขเดิม', status: 'ONLINE' },
  { number: '102', name: 'หมายเลขใหม่ที่มีชื่อยาว', status: 'ONLINE' },
  { number: '205', name: 'หน้าร้าน', status: 'OFFLINE' },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <UserProfilePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
const yeastarCard = () =>
  screen.getByText('ระบบโทรศัพท์ Yeastar PBX').closest('[data-slot="card"]') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  auth.user.yeastarExtension = '101';
  vi.mocked(api.get).mockResolvedValue({ data: extensions });
  vi.mocked(api.patch).mockResolvedValue({ data: {} });
});

describe('UserProfilePage — Extension Yeastar (Combobox)', () => {
  it('shows the saved extension as "เบอร์ — ชื่อ"; a pick + บันทึก PATCHes the number', async () => {
    const user = userEvent.setup();
    renderPage();
    const trigger = await screen.findByRole('combobox', { name: 'Extension Yeastar (โทรศัพท์)' });
    expect(trigger).toHaveTextContent('101 — หมายเลขเดิม');

    await pickComboOption(user, 'Extension Yeastar (โทรศัพท์)', '102 — หมายเลขใหม่ที่มีชื่อยาว', { search: '102' });
    expect(trigger).toHaveTextContent('102 — หมายเลขใหม่ที่มีชื่อยาว');
    expect(api.patch).not.toHaveBeenCalled(); // draft only until บันทึก

    await user.click(within(yeastarCard()).getByRole('button', { name: 'บันทึก' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/users/me/extension', { extension: '102' }));
    await waitFor(() => expect(auth.refresh).toHaveBeenCalled());
  });

  it('a saved extension the PBX no longer lists still shows its number', async () => {
    auth.user.yeastarExtension = '109';
    renderPage();
    const trigger = await screen.findByRole('combobox', { name: 'Extension Yeastar (โทรศัพท์)' });
    expect(trigger).toHaveTextContent('109');
  });
});
```

- [ ] **Step 3: Run them and confirm they fail**

```bash
npm run test --workspace=apps/web -- src/pages/chat-analytics/ChatAnalyticsPage.test.tsx src/pages/__tests__/SalesHistoryPage.salesperson.test.tsx src/pages/canned-response-admin/QuickReplyEditor.test.tsx src/pages/__tests__/UserProfilePage.extension.test.tsx
```

Expected: FAIL, `Test Files  4 failed (4)`, `Tests  6 failed | 3 passed (9)`:
- ChatAnalytics `พนักงาน`, SalesHistory (OWNER), both QuickReplyEditor tests and the UserProfile pick test fail in `openCombobox` / `pickComboOption`: the fields are still native `<select>`s (Yeastar: a Radix `Select` — jsdom may also log `target.hasPointerCapture is not a function` when the Radix trigger is clicked);
- the UserProfile `109` test fails on `toHaveTextContent('109')`, because the Radix trigger shows nothing for an unlisted value;
- the two pre-existing ChatAnalytics tests and the SalesHistory `SALES` test (a characterization of the role gate) pass.

- [ ] **Step 4: Switch ChatAnalyticsPage พนักงาน to `Combobox`**

In `apps/web/src/pages/ChatAnalyticsPage.tsx` replace

```tsx
import { NativeSelect } from '@/components/ui/native-select';
import { useState } from 'react';
```

with

```tsx
import { NativeSelect } from '@/components/ui/native-select';
import { Combobox } from '@/components/ui/combobox';
import { useId, useState } from 'react';
```

replace

```tsx
function AnalyticsDashboard() {
  const work = useChatWorkSettings(),
    [search, setSearch] = useSearchParams();
```

with

```tsx
function AnalyticsDashboard() {
  const staffFieldId = useId();
  const work = useChatWorkSettings(),
    [search, setSearch] = useSearchParams();
```

and replace

```tsx
        <label className="min-w-0 text-sm">
          พนักงาน
          <NativeSelect wrapperClassName="max-w-full mt-1 w-full min-w-0"
            className={`${field} mt-0`}
            value={draft.staffId}
            onChange={(e) => setDraft({ ...draft, staffId: e.target.value })}
          >
            <option value="">ทุกคน</option>
            {options.data?.staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.id.slice(-6)}
              </option>
            ))}
          </NativeSelect>
        </label>
```

with

```tsx
        <div className="min-w-0 text-sm">
          <label htmlFor={staffFieldId}>พนักงาน</label>
          <Combobox
            id={staffFieldId}
            value={draft.staffId}
            onChange={(staffId) => setDraft({ ...draft, staffId })}
            options={[
              { value: '', label: 'ทุกคน' },
              ...(options.data?.staff ?? []).map((s) => ({
                value: s.id,
                label: `${s.name} · ${s.id.slice(-6)}`,
              })),
            ]}
            loading={options.isLoading}
            wrapperClassName="max-w-full mt-1 w-full min-w-0"
            className={`${field} mt-0`}
          />
        </div>
```

(The label text sits on its own line above the `mt-1` field, as the wrapping label did, so the row's bottoms stay aligned. The skin (`field mt-0` over `formControlClass`) is the one `NativeSelect` produced. The branch select's reset of `staffId` and the submit handler are unchanged.)

- [ ] **Step 5: Switch SalesHistoryPage พนักงานขาย to `Combobox`**

In `apps/web/src/pages/SalesHistoryPage.tsx` replace

```tsx
import { NativeSelect } from '@/components/ui/native-select';
import { saleMargin } from '@/lib/sale-margin';
```

with

```tsx
import { NativeSelect } from '@/components/ui/native-select';
import { Combobox } from '@/components/ui/combobox';
import { saleMargin } from '@/lib/sale-margin';
```

and replace

```tsx
            <NativeSelect wrapperClassName="w-auto min-w-0 max-w-full"
              aria-label="พนักงานขาย" value={salespersonFilter}
              onChange={(e) => setSalespersonFilter(e.target.value)}
              className={inputClass}
            >
              <option value="">ทุกพนักงาน</option>
              {salespersons.map((sp) => (
                <option key={sp.id} value={sp.id}>{sp.name}</option>
              ))}
            </NativeSelect>
```

with

```tsx
            <Combobox
              aria-label="พนักงานขาย"
              value={salespersonFilter}
              onChange={(value) => setSalespersonFilter(value)}
              options={[
                { value: '', label: 'ทุกพนักงาน' },
                ...salespersons.map((sp) => ({ value: sp.id, label: sp.name })),
              ]}
              wrapperClassName="w-full min-w-0 max-w-full sm:w-56"
              className={inputClass}
            />
```

- [ ] **Step 6: Switch QuickReplyEditor เมื่อกด to `Combobox` (optgroup → `group`, save on pick only)**

In `apps/web/src/pages/canned-response-admin/QuickReplyEditor.tsx` replace

```tsx
import { NativeSelect } from '@/components/ui/native-select';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
```

with

```tsx
import { NativeSelect } from '@/components/ui/native-select';
import { Combobox } from '@/components/ui/combobox';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
```

replace

```tsx
  const uiFieldId = useUiFieldId();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: qr.id });
```

with

```tsx
  const uiFieldId = useUiFieldId();
  const templateId = parseTemplatePostback(qr.payload) ?? '';
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: qr.id });
```

and replace

```tsx
              <NativeSelect wrapperClassName="max-w-full w-auto flex-1" id={`${uiFieldId}-1`}
                value={parseTemplatePostback(qr.payload) ?? ''}
                onChange={(e) => {
                  const tplId = e.target.value;
                  onChange({ payload: tplId ? `${POSTBACK_TEMPLATE_PREFIX}${tplId}` : '' });
                }}
              >
                <option value="">— ตั้งเอง (custom payload) —</option>
                <optgroup label="ส่ง แม่แบบตอบกลับ">
                  {allTemplates
                    .filter((t) => t.id !== selfId && t.isActive !== false)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                        {t.category ? ` · ${t.category}` : ''}
                      </option>
                    ))}
                </optgroup>
              </NativeSelect>
```

with

```tsx
              <Combobox
                id={`${uiFieldId}-1`}
                value={templateId}
                onChange={(tplId) => {
                  // Saves on pick only. A native select fired no change for the same option — no PATCH.
                  if (tplId === templateId) return;
                  onChange({ payload: tplId ? `${POSTBACK_TEMPLATE_PREFIX}${tplId}` : '' });
                }}
                options={[
                  { value: '', label: '— ตั้งเอง (custom payload) —' },
                  ...allTemplates
                    .filter((t) => t.id !== selfId && t.isActive !== false)
                    .map((t) => ({
                      value: t.id,
                      label: `${t.title}${t.category ? ` · ${t.category}` : ''}`,
                      group: 'ส่ง แม่แบบตอบกลับ',
                    })),
                ]}
                wrapperClassName="min-w-0 flex-1"
              />
```

(The row's `onChange` → `updateMut.mutate` → PATCH path, the payload `<Input>` below it and the type select (`NativeSelect`, 3 options) are unchanged. A payload pointing at the template itself, an inactive template or an unknown id has no matching option — as before. The trigger then shows the placeholder (the native select showed an empty field).)

- [ ] **Step 7: Switch UserProfilePage Extension Yeastar to `Combobox`**

In `apps/web/src/pages/UserProfilePage.tsx` replace

```tsx
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CashAccountSelect } from '@/components/CashAccountSelect';
```

with

```tsx
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { CashAccountSelect } from '@/components/CashAccountSelect';
```

replace

```tsx
  const pbxExtensions = pbxQuery.data ?? [];
```

with

```tsx
  const pbxExtensions = pbxQuery.data ?? [];
  const extensionOptions = pbxExtensions.map((e) => ({ value: e.number, label: `${e.number} — ${e.name}` }));
  // A saved extension the PBX no longer lists still shows its number (Radix showed an empty field).
  const unlistedExtension =
    yeastarExtension && !pbxExtensions.some((e) => e.number === yeastarExtension)
      ? { value: yeastarExtension, label: yeastarExtension }
      : null;
```

and replace

```tsx
                  <Select value={yeastarExtension} onValueChange={setYeastarExtension}>
                    <SelectTrigger id={`${uiFieldId}-1`} className="w-full min-w-0 sm:flex-1">
                      <SelectValue placeholder="เลือก extension" />
                    </SelectTrigger>
                    <SelectContent>
                      {pbxExtensions.map((e) => (
                        <SelectItem key={e.number} value={e.number}>
                          {e.number} — {e.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
```

with

```tsx
                  <Combobox
                    id={`${uiFieldId}-1`}
                    value={yeastarExtension}
                    onChange={(value) => setYeastarExtension(value)}
                    options={extensionOptions}
                    selectedOption={unlistedExtension}
                    placeholder="เลือก extension"
                    wrapperClassName="w-full min-w-0 sm:flex-1"
                  />
```

(The loading / error + `ลองใหม่` / empty blocks around the field (:108-128), the `บันทึก` button and its mutation are unchanged. The block still renders only when `pbxExtensions.length > 0`.)

- [ ] **Step 8: Run the tests and confirm they pass**

```bash
npm run test --workspace=apps/web -- src/pages/chat-analytics/ChatAnalyticsPage.test.tsx src/pages/__tests__/SalesHistoryPage.salesperson.test.tsx src/pages/__tests__/SalesHistoryPage.void.test.tsx src/pages/__tests__/SalesHistoryPage.receipt.test.tsx src/pages/canned-response-admin src/pages/CannedResponseAdminPage.test.tsx src/pages/__tests__/UserProfilePage.extension.test.tsx
```

Expected: every file passes — the 9 tests of Step 3 plus the existing void/receipt, canned-response-admin and CannedResponseAdminPage tests, 0 failed.

- [ ] **Step 9: Type check, lint, guards, build**

```bash
bash tools/check-types.sh web
cd apps/web && npx eslint src/pages/ChatAnalyticsPage.tsx src/pages/chat-analytics/ChatAnalyticsPage.test.tsx src/pages/SalesHistoryPage.tsx src/pages/__tests__/SalesHistoryPage.salesperson.test.tsx src/pages/canned-response-admin/QuickReplyEditor.tsx src/pages/canned-response-admin/QuickReplyEditor.test.tsx src/pages/UserProfilePage.tsx src/pages/__tests__/UserProfilePage.extension.test.tsx && cd ../..
npm run test --workspace=apps/web -- src/components/ui/field-guards.inventory.test.ts src/components/ui/native-select.inventory.test.ts
npm run build --workspace=apps/web
```

Expected:
- Type check: 0 errors.
- ESLint: 0 errors. The four pre-existing warnings in `QuickReplyEditor.tsx` stay (`text-amber-700` at the URL hint, three `any`); no new warning.
- Both guard files pass.
- The build succeeds.

- [ ] **Step 10: Update `sales-menu-regression.spec.ts` (not executed on Windows; verified by reading)**

`apps/web/e2e/sales-menu-regression.spec.ts` — replace (:365)

```ts
      await page.getByRole('combobox', { name: 'พนักงานขาย', exact: true }).selectOption('ux-actor');
```

with

```ts
      await page.getByRole('combobox', { name: 'พนักงานขาย', exact: true }).click();
      await page.locator('[data-slot=combobox-content]').getByRole('option', { name: 'พนักงานตัวอย่าง UX', exact: true }).click();
```

(`selectOption` works only on a `<select>`. The fixture's `/sales/salespersons` returns `[actor]` (:72) with `name: 'พนักงานตัวอย่าง UX'` (:9). The `/sales/export` expectation `salespersonId: 'ux-actor'` (:385) still holds. The three `selectOption` lines before it (ประเภทการขาย, วิธีชำระ, สาขา) stay native.)

- [ ] **Step 11: Update `profile-preferences.spec.ts` (not executed on Windows; verified by reading)**

`apps/web/e2e/profile-preferences.spec.ts` — replace (:55-56)

```ts
  await extension.click();
  await page.getByRole('option', { name: /^102/ }).click();
```

with

```ts
  await extension.click();
  // the Combobox menu is portalled and searchable (R2-4d)
  const extensionMenu = page.locator('[data-slot=combobox-content]');
  await extensionMenu.getByRole('combobox', { name: 'ค้นหา', exact: true }).fill('ใหม่');
  await extensionMenu.getByRole('option', { name: /^102/ }).click();
  await expect(extensionMenu).toHaveCount(0);
  await expect(extension).toContainText('102');
```

The rest holds as written (checked by reading):
- :50-54 — the trigger is named by its `<label htmlFor>`, and `toContainText('101')` reads `101 — พนักงานทดสอบหมายเลขเดิม`.
- :85 `toContainText('102')` after reload.
- :67-71 — CashAccountSelect is a different control.
- :87-90 no horizontal overflow — the menu is portalled with `position: fixed`, and it is closed by then.

At 320px with a 20px root, `min-w-64` (= 320px) makes the open menu as wide as the viewport; this is visible in the run's screenshot but not asserted.

- [ ] **Step 12: Field-scale check**

1. `npm run local:preview` (restart after the source edits) and wait for `Started http://localhost:5195/inbox`.
2. Run:

   ```bash
   node tools/field-scale/check.mjs --label t14-others --routes r2-chat-analytics,r2-sales-history,r2-canned-quick-reply,r2-profile-yeastar
   node tools/field-scale/check.mjs --compare baseline-r2 t14-others
   echo "exit=$?"
   ```

   Expected: `menu probes: 4 pass · 0 fail` (`profile-extension-menu` on `r2-profile-yeastar` at 1440 and 390, light/dark — PASS on `baseline-r2` too), `MENU failures …: 0`, no lost cell, no fact drop, and `exit=0`. The four converted controls re-kind (labels keep their text; `dup` is `0` in every pair) (`native-select|พนักงาน|0` → `combobox|พนักงาน|0`, `native-select|พนักงานขาย|0` → `combobox|พนักงานขาย|0`, `native-select|เมื่อกด:|0` → `combobox|เมื่อกด:|0`, `select-trigger|Extension Yeastar (โทรศัพท์)|0` → `combobox|Extension Yeastar (โทรศัพท์)|0`). If the compare exits 1, accept only clause (a) re-key pairs with identical detail in the same cell, each listed with both keys; fix anything else. In particular:
   - a new F1 `bottom@…` or `labelGap@…` on the ChatAnalytics filter row would mean the label/field stacking changed;
   - `r2-canned-quick-reply` at 390 measures no เมื่อกด field before or after (pre-existing ≈ 0px editor pane).
3. Screenshots of `r2-sales-history` and `r2-chat-analytics` at 390 and 1440, light and dark: the trigger matches its neighbours, and SalesHistory's field is full width below `sm` and 224px from `sm`.
4. Leave the verified preview running.

- [ ] **Step 13: Commit**

```bash
git add apps/web/src/pages/ChatAnalyticsPage.tsx \
  apps/web/src/pages/chat-analytics/ChatAnalyticsPage.test.tsx \
  apps/web/src/pages/SalesHistoryPage.tsx \
  apps/web/src/pages/__tests__/SalesHistoryPage.salesperson.test.tsx \
  apps/web/src/pages/canned-response-admin/QuickReplyEditor.tsx \
  apps/web/src/pages/canned-response-admin/QuickReplyEditor.test.tsx \
  apps/web/src/pages/UserProfilePage.tsx \
  apps/web/src/pages/__tests__/UserProfilePage.extension.test.tsx \
  apps/web/e2e/sales-menu-regression.spec.ts \
  apps/web/e2e/profile-preferences.spec.ts
git commit -F - <<'EOF'
feat(web): searchable staff, salesperson, quick-reply template and Yeastar extension (R2-4d)

ChatAnalytics พนักงาน (name · last 6 of id), SalesHistory พนักงานขาย,
QuickReplyEditor เมื่อกด (optgroup → group) and the profile Yeastar extension
(เบอร์ — ชื่อ) become Combobox fields. Values and save paths are unchanged:
staffId still applies on แสดงรายงาน, salespersonId still filters the list and
the export, and the quick-reply template still saves at once on pick — never
on open or search, and not on a re-pick of the current template. The profile
field now shows a saved extension the PBX no longer lists, where Radix showed
an empty field. web e2e follow the new controls.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: one commit on the current branch. Do not push.

---

### Task 15: `TemplatePickerCombobox` — portalled menu inside the viewport

**Why:** Owner decision 2026-11-16: fix in Round 2 the known overflow of the "ใช้แม่แบบ" menu on `/other-income/new` — its `absolute w-72` panel (`TemplatePickerCombobox.tsx:48`) is left-aligned to a button at the right edge of the section header, so it runs past the right edge of the screen at 1024 (856→1144) and 390 (258→546) (`tools/field-scale/menu-clip-components.mjs:141-147`, KNOWN). The spec keeps it a **command menu** (each row applies a template; not a value picker — spec §6.4, header "Not converted: … `TemplatePickerCombobox` as a picker (Task 15 only fixes its overflow)"), so it does not become a `Combobox`: the panel becomes a portalled Radix `Popover` (`PopoverContent`, `align="end"`, `collisionPadding={16}`, `max-w-[calc(100vw-2rem)]`), keeping the rows, the lazy list query, the apply mutation and the copy byte-for-byte. Radix adds what the old panel lacked: Esc closes it and focus returns to the button; a click elsewhere closes it (replaces the hand-written `mousedown` listener). Because the panel is portalled, the F5 guard no longer finds an inline panel in the file, so its entry is removed from `F5_NON_PORTAL_MENU_ALLOW` (exact match both ways — Round 1 plan Task 12), and the browser case in `menu-clip-components.mjs` changes from KNOWN to an expected PASS at 1440/1024/390.

There is no existing `TemplatePickerCombobox` unit test. The existing tests that touch it: `field-guards.inventory.test.ts:620-623` (F5 allow-list entry), `pages/__tests__/tabsButtonRowsNowrap.test.ts:71` (the `<button>` before the first occurrence of `ใช้แม่แบบ` in the file must carry `whitespace-nowrap` — so the component's doc comment must not contain that Thai text), and the browser case `menu-clip-components.mjs:139-164`. No web e2e or api audit spec opens this menu (grep `ใช้แม่แบบ|TemplatePicker` over `apps/web/e2e`, `apps/api/e2e`: none; `other-income-*.spec.ts` / `other-income.docs-spec.ts` never click it — verified by reading).

**Files:**
- Modify (full rewrite, 72 lines): `apps/web/src/pages/other-income/components/TemplatePickerCombobox.tsx`
- Create (test): `apps/web/src/pages/other-income/components/__tests__/TemplatePickerCombobox.test.tsx`
- Modify: `apps/web/src/components/ui/field-guards.inventory.test.ts:620-623` (delete the entry)
- Modify: `tools/field-scale/menu-clip-components.mjs:139-164` (the case; the header comment is Task 6's)
- No change: `apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx:852-861` (the `onApply` caller — props unchanged).
- Line endings: in this Windows checkout the two `apps/web` files are CRLF in the working tree (`git ls-files --eol` → `i/lf w/crlf`); the `tools/` files are LF. The old/new strings below are written with `\n` — apply them with the Edit tool (it matches across CRLF) or normalise first; git stores LF either way.

**Interfaces:**
- Consumes: `Popover`, `PopoverTrigger`, `PopoverContent` (`@/components/ui/popover` — portalled, defaults `z-50 w-72 rounded-md border bg-popover p-4`; tailwind-merge turns `p-4` + `p-0` into `p-0`); `otherIncomeApi.templates.list()` / `.use(id)` (`@/lib/otherIncome.ts:150-153`); Task 1's `menu-clip-components.mjs` (unchanged runner) and route ids `other-income-items`, `other-income-override`.
- Produces: unchanged export `TemplatePickerCombobox({ onApply }: { onApply: (resolvedItems: any[], priceType: 'EXCLUSIVE' | 'INCLUSIVE') => void })`. DOM: trigger = the same `<button data-ui-control="button" type="button">ใช้แม่แบบ …</button>` (Radix adds `aria-haspopup="dialog"`, `aria-expanded`, `aria-controls`); open menu = `[data-slot="popover-content"][role="dialog"][aria-label="แม่แบบรายได้"][data-align="end"]` portalled into `document.body`, holding one `<button>` per template.

- [ ] **Step 1: Record the current defect (red, browser)**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
npm run local:preview
MENU_CLIP_STRICT=1 node tools/field-scale/menu-clip-components.mjs; echo "exit $?"
```

Expected: `FAIL menu clip:` listing `TemplatePickerCombobox 1024px (/other-income/new → ส่วน 2 → ปุ่ม "ใช้แม่แบบ"): list box is cut [{"by":"viewport",…"clip":[0,0,1024,900]}]` and the same at 390px (`"clip":[0,0,390,844]`), every other case PASS (`SearchableSelect` before Task 6, `Combobox` after), `exit 1`.

Also record the screen before the change (needed for Step 9):

```bash
node tools/field-scale/check.mjs --label t15-before --routes other-income-items,other-income-override
```

- [ ] **Step 2: Characterization tests (pass on the current inline panel)**

Create `apps/web/src/pages/other-income/components/__tests__/TemplatePickerCombobox.test.tsx` with:

```tsx
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const templatesApi = vi.hoisted(() => ({ list: vi.fn(), use: vi.fn() }));
vi.mock('@/lib/otherIncome', () => ({ otherIncomeApi: { templates: templatesApi } }));

import { TemplatePickerCombobox } from '../TemplatePickerCombobox';

const TEMPLATES = [
  { id: 'tpl-1', name: 'ค่าเช่าพื้นที่รายเดือน', itemsJson: [{}, {}], useCount: 3 },
  { id: 'tpl-2', name: 'ดอกเบี้ยเงินฝาก', itemsJson: [{}], useCount: 0 },
];
const ITEMS = [{ accountCode: '42-1102', description: 'ดอกเบี้ยเงินฝาก', quantity: 1, unitAmount: 100 }];

function renderPicker() {
  const onApply = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(
    // the section header that hosts the button clips nothing today, but an overflow-hidden host
    // proves the menu does not depend on its container
    <div data-testid="host" className="overflow-hidden">
      <TemplatePickerCombobox onApply={onApply} />
      <button type="button">ปุ่มอื่นบนหน้า</button>
    </div>,
    { wrapper },
  );
  return { onApply, trigger: screen.getByRole('button', { name: 'ใช้แม่แบบ' }) };
}

beforeEach(() => {
  templatesApi.list.mockReset().mockResolvedValue(TEMPLATES);
  templatesApi.use.mockReset().mockResolvedValue({ items: ITEMS, priceType: 'INCLUSIVE' });
});

// Characterization — passes on the inline panel before the switch and on the Popover after it.
describe('TemplatePickerCombobox — command behaviour', () => {
  it('loads the templates only when opened, then lists each name with its line and use counts', async () => {
    const user = userEvent.setup();
    const { trigger } = renderPicker();
    expect(templatesApi.list).not.toHaveBeenCalled();

    await user.click(trigger);

    expect(await screen.findByText('ค่าเช่าพื้นที่รายเดือน')).toBeInTheDocument();
    expect(screen.getByText('2 รายการ · ใช้ 3 ครั้ง')).toBeInTheDocument();
    expect(screen.getByText('ดอกเบี้ยเงินฝาก')).toBeInTheDocument();
    expect(screen.getByText('1 รายการ · ใช้ 0 ครั้ง')).toBeInTheDocument();
    expect(templatesApi.list).toHaveBeenCalledTimes(1);
  });

  it('a template applies its resolved lines and price type, then the menu closes', async () => {
    const user = userEvent.setup();
    const { trigger, onApply } = renderPicker();
    await user.click(trigger);

    await user.click(await screen.findByRole('button', { name: /^ดอกเบี้ยเงินฝาก/ }));

    await waitFor(() => expect(onApply).toHaveBeenCalledExactlyOnceWith(ITEMS, 'INCLUSIVE'));
    expect(templatesApi.use).toHaveBeenCalledExactlyOnceWith('tpl-2');
    await waitFor(() => expect(screen.queryByText('ค่าเช่าพื้นที่รายเดือน')).toBeNull());
  });

  it('says "ไม่มี แม่แบบ" when there are none', async () => {
    templatesApi.list.mockResolvedValue([]);
    const user = userEvent.setup();
    const { trigger } = renderPicker();
    await user.click(trigger);
    expect(await screen.findByText('ไม่มี แม่แบบ')).toBeInTheDocument();
  });

  it('says "กำลังโหลด..." while the list loads', async () => {
    templatesApi.list.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    const { trigger } = renderPicker();
    await user.click(trigger);
    expect(await screen.findByText('กำลังโหลด...')).toBeInTheDocument();
  });

  it('a click elsewhere on the page closes the menu without applying anything', async () => {
    const user = userEvent.setup();
    const { trigger, onApply } = renderPicker();
    await user.click(trigger);
    await screen.findByText('ค่าเช่าพื้นที่รายเดือน');

    await user.click(screen.getByRole('button', { name: 'ปุ่มอื่นบนหน้า' }));

    await waitFor(() => expect(screen.queryByText('ค่าเช่าพื้นที่รายเดือน')).toBeNull());
    expect(templatesApi.use).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });
});
```

Run: `cd apps/web && npx vitest run src/pages/other-income/components/__tests__/TemplatePickerCombobox.test.tsx`
Expected: `Tests  5 passed (5)` on the unchanged component.

- [ ] **Step 3: Add the portal tests (red)**

Append to the same file:

```tsx
// Owner 2026-11-16: the panel ran past the right edge at 1024 (856→1144) and 390 (258→546).
describe('TemplatePickerCombobox — portalled menu inside the viewport', () => {
  it('renders the menu in document.body, outside its host, aligned to the button end and no wider than the screen', async () => {
    const user = userEvent.setup();
    const { trigger } = renderPicker();
    await user.click(trigger);

    const menu = await screen.findByRole('dialog', { name: 'แม่แบบรายได้' });
    expect(screen.getByTestId('host')).not.toContainElement(menu);
    expect(document.body).toContainElement(menu);
    expect(menu).toHaveAttribute('data-slot', 'popover-content');
    expect(menu).toHaveAttribute('data-align', 'end');
    expect(menu).toHaveClass('w-72', 'max-w-[calc(100vw-2rem)]', 'max-h-72', 'overflow-y-auto', 'p-0');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('ค่าเช่าพื้นที่รายเดือน')).toBeInTheDocument();
  });

  it('Escape closes the menu without applying and gives focus back to the button', async () => {
    const user = userEvent.setup();
    const { trigger, onApply } = renderPicker();
    await user.click(trigger);
    await screen.findByText('ค่าเช่าพื้นที่รายเดือน');

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByText('ค่าเช่าพื้นที่รายเดือน')).toBeNull());
    expect(onApply).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
```

Run the same command. Expected: `Tests  2 failed | 5 passed (7)` — `renders the menu in document.body …` fails at `findByRole('dialog', { name: 'แม่แบบรายได้' })` (`Unable to find role="dialog"`), `Escape closes the menu …` fails because the template rows are still there after Escape (the inline panel has no Escape handler).

- [ ] **Step 4: Remove the F5 allow-list entry (red)**

In `apps/web/src/components/ui/field-guards.inventory.test.ts`, delete:

```ts
  'apps/web/src/pages/other-income/components/TemplatePickerCombobox.tsx': {
    panels: 1,
    reason: 'allow-list ใน spec §5 F5 — เมนูคำสั่ง ไม่ใช่ตัวเลือก (§6.4) · เลยขอบขวาจอที่ 1024/390 (KNOWN ในสคริปต์)',
  },
```

(i.e. replace that block plus the following `  'apps/web/src/pages/PurchaseOrdersPage` line with just `  'apps/web/src/pages/PurchaseOrdersPage`).

Run: `cd apps/web && npx vitest run src/components/ui/field-guards.inventory.test.ts`
Expected: `Tests  1 failed | 37 passed (38)` — `F5 — inline (non-portalled) menus … > only allow-listed files render an absolute menu outside a portal`, with the diff `+   "apps/web/src/pages/other-income/components/TemplatePickerCombobox.tsx": 1,`.

- [ ] **Step 5: Rewrite the component**

Replace the whole of `apps/web/src/pages/other-income/components/TemplatePickerCombobox.tsx` with:

```tsx
import { useQuery, useMutation } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { otherIncomeApi } from '@/lib/otherIncome';

interface Props {
  onApply: (resolvedItems: any[], priceType: 'EXCLUSIVE' | 'INCLUSIVE') => void;
}

/**
 * The "use a template" button of section 2 — a command menu: each row applies a template, it is not
 * a value picker (spec §6.4). The panel is a portalled Radix Popover aligned to the button's end, so it
 * stays on screen next to the right-hand button at every width (owner 2026-11-16 — the old inline
 * `absolute` panel ran past the right edge at 1024 and 390). Esc, a click elsewhere and focus return
 * come from Radix. (No Thai button text in this comment: tabsButtonRowsNowrap.test.ts finds the
 * button by the first occurrence of its label.)
 */
export function TemplatePickerCombobox({ onApply }: Props) {
  const [open, setOpen] = useState(false);

  const query = useQuery({
    queryKey: ['other-income-templates-picker'],
    queryFn: () => otherIncomeApi.templates.list(),
    enabled: open,
  });
  const applyTemplateMutation = useMutation({
    mutationFn: (id: string) => otherIncomeApi.templates.use(id),
    onSuccess: (data) => {
      onApply(data.items, data.priceType);
      setOpen(false);
    },
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button data-ui-control="button"
          type="button"
          className="inline-flex items-center gap-1 whitespace-nowrap px-3 py-1.5 border rounded-md text-xs hover:bg-accent"
        >
          ใช้แม่แบบ <ChevronDown size={12} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={16}
        aria-label="แม่แบบรายได้"
        className="w-72 max-w-[calc(100vw-2rem)] max-h-72 overflow-y-auto overscroll-contain p-0"
      >
        {(query.data ?? []).map((t: any) => (
          <button
            key={t.id}
            type="button"
            onClick={() => applyTemplateMutation.mutate(t.id)}
            className="w-full text-left px-3 py-2 hover:bg-accent text-xs"
          >
            <div className="font-semibold">{t.name}</div>
            <div className="text-muted-foreground">
              {t.itemsJson?.length ?? 0} รายการ · ใช้ {t.useCount} ครั้ง
            </div>
          </button>
        ))}
        {query.data?.length === 0 && (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">ไม่มี แม่แบบ</div>
        )}
        {query.isLoading && (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">กำลังโหลด...</div>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

What stays byte-for-byte: the props, the query key / `enabled: open`, the mutation and its `onSuccess` (apply, then close), every row's markup and copy (`{n} รายการ · ใช้ {m} ครั้ง`, `ไม่มี แม่แบบ`, `กำลังโหลด...`), the trigger's classes. What goes: the `relative` wrapper `<div>`, the `ref` and the document `mousedown` listener (Radix `DismissableLayer` closes on a press outside).

- [ ] **Step 6: Run the tests (green)**

```bash
cd apps/web
npx vitest run src/pages/other-income/components/__tests__/TemplatePickerCombobox.test.tsx src/components/ui/field-guards.inventory.test.ts
npx vitest run src/pages/__tests__/tabsButtonRowsNowrap.test.ts -t "ใช้แม่แบบ"
```

Expected: first command `Test Files  2 passed (2)` · `Tests  45 passed (45)` (7 + 38). Second: the case `other-income/components/TemplatePickerCombobox.tsx buttons > button "ใช้แม่แบบ" is whitespace-nowrap` passes. (On Windows the full `tabsButtonRowsNowrap.test.ts` file has 6 known failures unrelated to this task — `"คัดลอก\n"`, `OtherIncomeViewPage header action row`, `never wraps`, `lives in the payouts panel header …`, and the two `ring-inset` tab bars; the same 6 fail on unchanged main.)

- [ ] **Step 7: The browser case — KNOWN becomes an expected PASS**

In `tools/field-scale/menu-clip-components.mjs` (the file header stays as it is — Task 6 Step 9 rewrites it, and the case's own comment below records this history) replace

```js
    where: '/other-income/new → ส่วน 2 → ปุ่ม "ใช้แม่แบบ"',
    // Measured 2026-11-14 on the local preview: the w-72 panel is left-aligned to a
    // right-aligned button, so it runs past the right edge of the screen.
    known: {
      1024: { by: 'viewport', note: 'กล่องกว้าง 288px ชิดซ้ายของปุ่มที่อยู่ขวาสุด → เลยขอบขวาจอ (856→1144 บนจอ 1024)' },
      390: { by: 'viewport', note: 'เลยขอบขวาจอ (258→546 บนจอ 390)' },
    },
    async open(page, origin) {
```

with

```js
    where: '/other-income/new → ส่วน 2 → ปุ่ม "ใช้แม่แบบ"',
    // Until Round 2 Task 15 the w-72 panel was left-aligned to the right-hand button and ran past
    // the right edge (856→1144 at 1024, 258→546 at 390). It is now a portalled Popover aligned to
    // the button's end: expected PASS at every width.
    async open(page, origin) {
```

and replace

```js
      const panel = trigger.locator('xpath=following-sibling::div[1]');
```

with

```js
      const panel = page.getByRole('dialog', { name: 'แม่แบบรายได้', exact: true });
```

Run:

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
npm run local:preview
MENU_CLIP_STRICT=1 node tools/field-scale/menu-clip-components.mjs; echo "exit $?"
node tools/field-scale/menu-clip-components.mjs; echo "exit $?"
```

Expected, both runs: `PASS TemplatePickerCombobox 1440px`, `PASS TemplatePickerCombobox 1024px`, `PASS TemplatePickerCombobox 390px`; every other case as before (`NoteMentionInput`, `NameAutocomplete`, `CatalogPicker` PASS; `PASS Combobox <w>px` if Task 6 has landed, else `PASS SearchableSelect <w>px`), then `PASS menu clip: <n> passed · 0 known → …\.tmp\field-scale\menu-clip-components` and `exit 0` (strict and normal print the same — no KNOWN entry is left). Open `.tmp/field-scale/menu-clip-components/TemplatePickerCombobox-390.png`: the panel's right edge lines up with the button's right edge and the whole panel is on screen.

- [ ] **Step 8: Checks**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
bash tools/check-types.sh web
cd apps/web
npx eslint src/pages/other-income/components/TemplatePickerCombobox.tsx src/pages/other-income/components/__tests__/TemplatePickerCombobox.test.tsx src/components/ui/field-guards.inventory.test.ts
npx vitest run src/pages/other-income src/components/ui/field-guards.inventory.test.ts
```

Expected: `Web: OK`; eslint `0 errors` (2 warnings `@typescript-eslint/no-explicit-any` at the `any[]` prop and `(t: any)` — both already in the file before this task); vitest all passing.

- [ ] **Step 9: Field-scale**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
npm run local:preview
node tools/field-scale/check.mjs --label t15 --routes other-income-items,other-income-override
node tools/field-scale/check.mjs --compare t15-before t15; echo "exit $?"
node tools/field-scale/check.mjs --compare baseline-r2 t15; echo "exit $?"
```

Expected:
- `--compare t15-before t15` (this task alone): `Compared 12 cells`, `New findings: 0`, `Fixed: 0`, `MENU failures …: 0`, `PASS …`, `exit 0` — the button and the screen's fields measure the same (verified on the preview with the new component: identical fact counts 66/66/54 and 76/76/64 and identical finding ids at 1440/1024/390). The run's `menu probes` line shows `account-menu-items-card` and `account-menu-override-jv` PASS.
- `--compare baseline-r2 t15`: `Compared 12 cells`, `Not run in "t15" (subset run — not blocking): 336 cells`, `MENU failures …: 0`, `exit 0` with `New findings: 0 · Fixed: 0` when no earlier Round 2 task has changed these two screens. If Tasks 7 / 9 have landed on this branch, the only lines are the clause (a) re-key pairs of the account pickers / CounterpartyPicker that their own PRs list — none from this task.

- [ ] **Step 10: Commit**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
git add apps/web/src/pages/other-income/components/TemplatePickerCombobox.tsx apps/web/src/pages/other-income/components/__tests__/TemplatePickerCombobox.test.tsx apps/web/src/components/ui/field-guards.inventory.test.ts tools/field-scale/menu-clip-components.mjs
git commit -F - <<'EOF'
fix(web): "ใช้แม่แบบ" menu stays on screen — portalled Popover aligned to the button end

TemplatePickerCombobox (other income, section 2) kept its command menu but the inline
absolute w-72 panel ran past the right edge at 1024 (856→1144) and 390 (258→546). It is now
a Radix PopoverContent (portal, align end, collisionPadding 16, max-w 100vw-2rem): same rows,
same lazy query and apply mutation; Esc and a click elsewhere close it, focus returns to the
button (owner 2026-11-16).

- tests: 5 characterization tests (pass before and after) + portal/Escape tests
- F5_NON_PORTAL_MENU_ALLOW: entry removed (exact-match guard)
- menu-clip-components: TemplatePickerCombobox case KNOWN → expected PASS at 1440/1024/390;
  MENU_CLIP_STRICT=1 exits 0

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: one commit, 4 files changed (1 created). PR body: state what ran on Windows (Steps 2–9) and that `npm run local:check` must run on Linux/CI.

---

## Appendix A — Owner-visible deviations from the spec

Behaviour or look the owner may notice that differs from what the spec text says (the plan followed the code, an owner decision, or a contrast rule). Each task's PR body repeats its rows. Values sent to the API do not change in any row.

| # | Task | Screen / field | Spec says | The plan does | Why |
|---|---|---|---|---|---|
| A1 | 7, 8, 13 | Account pickers | §9.1 (decided 2026-11-16; owner question 4 answered yes — "ทำได้เลย") | Every account picker shows `เลขบัญชี - ชื่อ` (`AccountCombobox` default, "(...)" dropped from the name; search still finds the full name). Searchable picker: other-income items, Override JV, adjustments, petty cash, expense / credit-note lines, under CoA group headings. General ledger: rows and trigger `code - name` with "(...)" dropped (the Excel export still uses the full name from the API). RecurringBill: `code - name`. `/expenses` type filter: rows `code - name` under CoA category headings, 288px wide from `sm` up. AccountRoles: grouped `code - name` rows with a code-only trigger. Search results are ranked (best match first) instead of chart order | Owner decision (question 4); no caller passes `display` any more (header "Account codes") |
| A2 | 11 | ChatFollowUpDialog, ChatServiceRequestDialog, ChatServiceRequestCard edit form | §4.3 ค / §9: no mixed label styles; only the assignee field converts | The three inbox forms move wholesale to style A labels (`formLabelClass`) and the standard field classes, not just the assignee field | Converting one field to style A would mix label styles in one form — scope widening |
| A3 | 11, 12 | Required-field errors (§6.5 "native required → setError + invalid + message", 4 spots) | Add an inline error to each | Only StockAlertsPage รุ่น gets the inline `กรุณาเลือกรุ่น`. ChatFollowUpDialog / ChatServiceRequestDialog keep their disabled submit button (they never submit without an assignee). ProductCreatePage keeps its existing toast `กรุณาเลือกรุ่น`, which now fires because the browser popup no longer comes first (if สาขา or ราคาทุน is also empty, their browser popup still comes first) | The code already guards these forms; a second guard would never run |
| A4 | 14 | Profile › Extension Yeastar | — | A saved extension that the PBX no longer lists shows its number in the field (Radix showed an empty field) | `selectedOption` (§6.3); value and save unchanged |
| A5 | 13 | `/expenses` › ประเภทค่าใช้จ่าย filter | — | Fixed width 288px from `sm` up (the native select sized itself to its longest option); picking the current type again keeps the page | A button sizes to its text; a native select fired no change on a re-pick |
| A6 | 13 | RecurringBillDialog | Appendix ค cites `:307` "สาขาไม่รู้จัก → selectedOption" | That line is the branch select, which is not converted; the account field shows a saved code that left the chart as the code | Spec row points at the wrong select |
| A7 | 11 | `/todos` › ผู้รับมอบหมาย filter | — | Fixed width 224px from `sm` up; with an `?assigneeId` outside the list, choosing "ผู้รับมอบหมายทั้งหมด" now really clears the filter (the native select showed that row as if selected and fired nothing) | Button width; re-pick semantics |
| A8 | 11 | TodoForm › ผู้รับมอบหมาย (non-OWNER editing) | — | Shows the saved assignee's name instead of "ไม่ระบุ" | `GET /users` is OWNER-only, so the id is never in the list for other roles |
| A9 | 11 | ChannelFilter › ผู้ดูแล | — | An owner that is not in the staff list shows in the field but is no longer a list row — after picking someone else it cannot be picked back | `selectedOption` is display-only (header contract) |
| A10 | 12 | Product form › ผู้จัดจำหน่าย | "~100 suppliers" | Still the first 50 active suppliers (API default for `GET /suppliers` without `limit`) | Data limit outside this task; follow-up: pass `limit: 200` |
| A11 | 12 | Stock alerts › รุ่น under "มือถือมือสอง" | — | Picking a model still flips the category to "มือถือใหม่" (the catalog lists `PHONE_NEW` entries) | Pre-existing, pinned by a test, not changed here |
| A12 | 9 | Contact pickers | — | The "ไม่พบผู้ติดต่อ…" line now shows above the create row (it was unreachable); the create row reads `+ สร้างผู้ติดต่อใหม่ "…"` next to the Combobox's own plus icon (two plus signs) | Empty text shows whenever no row is visible (header); create text pinned by characterization tests — follow-up: drop the leading `+ ` |
| A13 | 9 | Asset entry › ผู้ขาย | — | The visible label `ชื่อผู้ขาย / บริษัท *` now names the field (it was not linked) | §6.1: the trigger's name is its label |
| A14 | 9 | PO wizard › ผู้จัดจำหน่าย while suppliers load | — | Shows the placeholder instead of the text `กำลังโหลด...` as if it were a value | The value was a fake string |
| A15 | 8 | General ledger › account | — | The menu is as wide as the field (was 380px); the field is named by its label `รหัสบัญชี` (was `เลือกบัญชี`) | §6.1 |
| A16 | 7 | Other-income item card › บัญชีรายได้ | — | The label now names the picker; a code that is not in the chart shows the code (was the placeholder); a saved code shows while the chart loads | §6.1; values never hidden |
| A17 | 6 | Address › อำเภอ/เขต, ตำบล/แขวง search | §6.2 ranking | Ranks on the name without the เขต/อำเภอ/แขวง/ตำบล prefix (typing the prefix still finds every row); abbreviations `อ.` / `ต.` are not understood (same as before) | Without it, 364 of 16,652 short queries put a mid-word match first |
| A18 | 4 | Every Combobox | — | Disabled rows are not faded (secondary text colour instead of cmdk's 50% opacity); the check mark is the primary colour; the create row's default text is `สร้าง “{term}”` (no spec text) | Contrast (3.19:1 faded vs 5.74:1); owner questions 1–2 and 5 in Task 2 |
| A19 | 10 | Bookings › ลูกค้า create button | — | Enter on the focused "สร้างลูกค้าใหม่" button opens the create dialog (it used to pick the highlighted customer) | Bug fix: the button moved out of cmdk's list |
| A20 | 12 | QuickBuy › รุ่น iPhone | Combobox look = `formControlClass` | The trigger copies the neighbouring PurchaseSelect skin (`bg-card`, shadow, open ring) | Same row as the ความจุ PurchaseSelect; F1 compares background/border |
| A21 | 15 | Other income › ใช้แม่แบบ menu | — | Opens aligned to the button's right edge, inside the screen at 1024/390; Esc closes it and returns focus to the button | The overflow fix (owner 2026-11-16) |
| A22 | 8 | General ledger › account | — | The account menu is as wide as the field (at least 256px; the field is `min-w-[260px]`) instead of a fixed 380px, so long names are cut off in the rows | Width rule: the menu follows the field |

Context, not a Round 2 change: the expense-create PEAK-layout work moved the expense-line account field onto the searchable picker and dropped its `— เลือก —` row (a line's account can no longer be set back to empty); Round 2 keeps that as shipped (Task 13).

## Appendix B — Draft verification notes

What each task's code and tests were run against while the plan was written (2026-11-16). All runs used throwaway copies in the OS temp directory with junctions to the repo's `node_modules` (vitest 4.1.5, jsdom 25.0.1, cmdk 1.1.1, Radix 1.1.15, React 19.2.6, user-event 14.6.1) and the repo's `vitest.config.ts`, `tsconfig.json`, `eslint.config.mjs`; nothing in the repo was modified. "Stand-in" = a `combobox.tsx` / `thai-search.ts` / `test/combobox.ts` written by that task's drafter from the header contract, before Tasks 3/4 existed. Nothing below was run on Linux/CI, and no web e2e / api `ui-fields` audit was executed (read only).

**Final pass (plan fixer).** A copy of `apps/web` at the PEAK-layout commit `7b67db27c` (= main `6e79e6eb4` + the expense-create PEAK-layout work) with the **real** Task 3 and Task 4 files extracted from this plan's code blocks:
- Task 3 + Task 4: `thai-search.test.ts` 34/34 and `combobox.test.tsx` 67/67 (the new "opens on the first enabled row when no row is selected" case included; it fails when the open highlight is moved to the first row even if disabled). Without the `setup.ts` polyfill: `17 failed | 50 passed (67)`.
- Task 7: characterization 20/20 and consumers 4/4 **on the PEAK-layout `AccountSearchDropdown`** (`<code> - <name>`, group headings); red step exactly as written (`Failed to resolve import "../AccountCombobox"`; consumers `1 failed | 4 passed (5)`); after Step 4 36/36; after Step 5 (incl. 5f: `ItemLinesSection`, the two `ExpenseFormV4` test mocks, comments) `src/components/accounting`, `src/pages/other-income`, `src/components/expense-form-v4`, `field-guards.inventory.test.ts`: 30 files / 285 tests pass, including the PEAK-layout `ItemLinesSection.layout.test.tsx`, `ExpenseFormV4.page.test.tsx`, `ExpenseFormV4.payloads.test.tsx`.
- Task 8: characterization 6/6 on the current pages; strict tests `3 failed | 6 passed (9)` before, all pass after (GL 5, AccountRoles 4, with `display="name"`); 11 files / 127 tests incl. `src/components/accounting`.
- Task 13: RecurringBill characterization 13/13 on the native select; red `RecurringBill 4 failed | 12 passed`, `ExpensesPage.ux 3 failed | 18 passed`, `ItemLinesSection.account 3 passed` (already `AccountCombobox` after Task 7); after Steps 3 and 5 (`display="name"` on the filter): 29 files / 309 tests incl. `native-select.inventory.test.ts` and `field-guards.inventory.test.ts`.
- Task 13 / Task 12 probe edits: applied to a copy of Task 1's final `tools/` in both orders (12 then 13, 13 then 12): `node --test tools/field-scale/check.test.mjs` 32/32 after each; 14 probes attached, `PENDING_PROBES` empty at the end.
- Task 11 (owner filter only): the re-pick test fails on the draft call site (`page=3` dropped) and passes with the guard; `src/pages/CollectionsPage` + `src/pages/CustomersPage` 24 files / 169 tests; on the unconverted `ProspectFilterBar` the CustomersPage file gives `2 failed | 56 passed (58)`.
- Task 10 (Bookings `CustomerCombobox` only): the footer test (now also asserting the button sits directly in `[data-slot="combobox-footer"]`) fails with the doubled wrapper and passes without it; `src/pages/BookingsPage` + `src/pages/StoreAppointmentsPage` 14 files / 159 tests.
- Task 12 (POListTab only): the check-mark assertion fails with the draft `renderOption` and passes with the fix; `src/pages/PurchaseOrdersPage` 35 files / 277 tests.
- Re-run on the next PEAK-layout commits (up to `5e44c303f`: `ItemLinesSection`, `ExpenseFormV4`, `ExpensesPage` and their tests changed): Task 7 Step 5f and Task 13 Steps 2c/5 re-applied from the plan text; `src/components/accounting`, `src/pages/other-income`, `src/components/expense-form-v4`, `src/components/expense-templates`, `ExpensesPage.ux` (22), `ExpenseDocumentNewPage`, `ExpenseFavoritesPage`, `RecurringBillsPage`, `src/components/layout` and both guard files: 46 files / 426 tests pass; `tsc --noEmit` 0 errors.
- `tsc --noEmit` over the whole copy after all of the above: 0 errors. ESLint on every touched file: 0 problems.
- Every code block changed in this pass was extracted back from the plan text and compared with the file that was run: identical (apart from CRLF).

**Per task (drafters).**
- **Task 1** — the tool edits applied to a copy of `tools/`: `check.test.mjs` 32/32 (red step: `does not provide an export named 'R2_ROUTES'`); the collector test passes on the unmodified `collect.js`. Every `r2-*` route measured on a running local preview with a harness reproducing `check.mjs measureCell` (1440/1024/390, light twice + dark): all cells rendered, identical fact counts and finding ids between the two light runs; every attached probe PASS (16 light + 16 dark); the five pending probes resolve and click and report "menu not found" on native selects. Not run: `check.mjs` itself, `baseline-r2`, `baseline-r2-det` (they need the commit and a fresh preview).
- **Task 2** — the five boards rendered as plain HTML in Playwright Chromium at their frame sizes, light and dark; `make-dark.mjs` output identical to the rendered dark boards; contrast numbers from `contrast.mjs`. Not published; the owner's answer is Step 8. (The account rows were redrawn as `เลขบัญชี - ชื่อ` under a group heading in the final pass — not re-rendered.)
- **Task 3** — 34/34; fail-first without `thai-search.ts`; `tsc`, ESLint, Prettier clean; 15 mutations each caught; real address data: 7,452 rows, 77 provinces, the prefix study (364 of 16,652 queries mis-ordered with raw labels, 0 with `filterAddressOptions`).
- **Task 4** — 66/66 in its own scratch (67/67 in the final pass), red phases as stated, mutation checks, `tsc`/ESLint/Prettier clean, a Vite lib build of `combobox.tsx`, the F5 detector finds no inline panel; the 19 regression files of Step 9 pass with the polyfill (`TradeInFlow` times out under load with or without it, passes alone).
- **Tasks 5–6** — Task 5's 16 tests pass on the real `SearchableSelect` + real data; Task 6 against stand-ins: 19/19, guard files 38/38 + inventory, 16 host files / 172 tests unchanged, full web suite in the copy (8 unrelated failures: the known Windows-only ones and timeouts). Not run with the real Task 4 `Combobox`.
- **Tasks 7, 8, 13** — the drafter ran them against stand-ins; superseded by the final pass above (real Task 3/4, PEAK-layout base).
- **Tasks 9–10** — characterization on today's code (Contact 27/27, Employee 13/13, Customer 15/15, wrappers 8/8) and the expected red tests; after the switch against stand-ins: all task tests pass, 96 consumer files / 843 tests unchanged, guard scans pass, `tsc` 0. Only the Bookings footer was re-run with the real Task 4 (final pass).
- **Task 11** — red phase `19 failed | 75 passed (94)` on the original components; green against stand-ins (all nine fields' files, 117 neighbour files / 777 tests); `tsc` 0, ESLint 0 errors (1 pre-existing warning in `TodoForm.tsx`). Only the ProspectFilterBar part was re-run with the real Task 4 (final pass).
- **Tasks 12, 14** — red phases as stated; green against stand-ins (Task 12: 42 files / 325 tests, `TradeInFlow` 23/23 with `--testTimeout=40000`; Task 14: 9 files / 40 tests); guard files pass; `tsc` 0; ESLint 0 errors (4 pre-existing warnings in `QuickReplyEditor.tsx`). Only POListTab was re-run with the real Task 4 (final pass).
- **Task 15** — in a full copy of `apps/web`: 5 characterization tests on the old component, the 2 portal tests red, the F5 entry removal red, then 7 + 38 green; `tsc` 0; the browser case on a Vite server of the copy: `15 passed · 0 known`, TemplatePickerCombobox PASS at 1440/1024/390; the two other-income field-scale routes unchanged.

**Re-verification against the real Task 4 (2026-11-16, `.superpowers/plan-r2/verify-real-combobox.md`).**
- Base: a copy of main `6e79e6eb4` (not the PEAK-layout branch) with Task 3 (34/34) and Task 4 (67/67) extracted from this plan.
- Tasks 5, 6, 9, 10, 11, 12, 14 and 15 were each applied step by step in their own copy, with characterization tests on the pre-switch code. Every red and green count matched its "Expected:".
- Every web, api `ui-fields`, e2e and `tools/` anchor matched, except where it needs Task 1.
- Seven text fixes were applied: Task 6 Step 1 and Step 7 Expected, Task 10 Step 4 Expected and the Step 9 line reference, the Task 12 Step 20 po-filters menu width (`min-w-64` floor at 1440/1280), and the Task 12 Step 24 commit split. No task code or test changed.
- All six results were applied in plan order to one copy:
  - `tsc --noEmit` 0 errors;
  - ESLint 0 errors on the 61 touched files (7 warnings, all present at base);
  - the touched test files + Task 3/4 tests + both guard files: 35 files / 423 tests pass.
- Not run: field-scale, menu probes, e2e / `ui-fields` audits, build.

**Known gaps for the implementer:** Tasks 6, 9, 10, 11, 12 and 14 now pass against the real Task 4 (above), but only on a main-based copy. Tasks 7, 8 and 13 were checked on the PEAK-layout base (final pass). No `field-scale` compare of any converted screen has been run; the expected re-key pairs are derived from `collect.js` (`kindOf`, naming), not measured.

## Progress notes

### Task 2 — Combobox mockup (R2-0)
- Date: 2026-11-16 · Canvas: https://claude.ai/artifact/P9HZMn9fL6V17TdWyG5QDn (the owner's canvas; Step 1 hash matched `8647c728…`, so `canvas.json` was overwritten with the Step 6 file) · Version: 1794791511-5f10
- Boards added: ComboboxLight, ComboboxDark, ComboboxMobileLight, ComboboxMobileDark, ComboboxChecks + title note "Combobox — dropdown ค้นหาได้ (รอบ 2 · R2-0)"
- Owner reply (verbatim): "อมุมัติ"
- Decision: approved
- Answers: 1 row height 44px kept · 2 disabled rows as drawn · 3 phone list focus as drawn · 4 converted account fields — one "อนุมัติ" for all five; read as yes, code - name like the searchable picker; asked to confirm that reading, the owner replied "ทำได้เลย" (2026-11-16) — so Task 8 and Task 13 drop their explicit display props (header "Account codes"); both still wait for the PEAK-layout merge · 5 highlight kept
- Changes made after the first publish: none
- Task 4 visual contract (Task 2 Produces table): unchanged

### Round 2 part 1 — executed (2026-11-16)
- Done and reviewed (task review each, then one whole-branch review): Tasks 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 14, 15. Not done: Tasks 7, 8, 13 — they wait for the expense-create PEAK-layout work (PR #1781) to reach main; they ship as a separate PR.
- Extra commits beyond the task list: 783e42507 (the menu's search box opts out of the admin focus outline, which the menu's overflow clipped — the R2-0 mockup shows a caret only); cef848a07 (whole-branch review batch: the width rule — width/height go on `wrapperClassName` because `admin-typography.css` sets unlayered `max-width:100%`/`height` on `button[role=combobox]` — written into `combobox.tsx` JSDoc and DESIGN.md and enforced by a new `field-guards` scan; the menu is named `aria-label={listLabel}`); 0ac403717 and e8f6f59d5 (owner decisions below).
- Owner decisions after the whole-branch review (AskUserQuestion, 2026-11-16):
  - Open the PR for this part now; Tasks 7/8/13 follow in their own PR.
  - AddressForm: picking the current province or district again no longer resets what is below it (it did before Round 2 and in Task 6, which kept that behaviour) — commit 0ac403717; a different province/district still resets.
  - The ฟิล์ม "สำหรับรุ่น" multi-pick in the PO accessory row (not converted) did not scroll inside the PO Drawer on touch/wheel; fixed the same way as `Combobox` (stop wheel/touchmove at the content) — commit e8f6f59d5.
  - SalesHistory › พนักงานขาย filter at 224px (`sm:w-56`, was ~303px with the native select sizing to its longest name): accepted as is.
- Before Tasks 7/8/13 start (from the whole-branch review): fix T4-m1 in code if `CustomerSearchCombobox` keeps `className` + `clearable`; T4-m6 if `AccountCombobox` uses `description`; check T4-m2 (`onBlur` fires when the menu opens) against any react-hook-form host; fix T1-m2 (mock dates) before the next compare; record `baseline-r2-peak` after rebasing on the PEAK merge.

### Round 2 part 2 — executed (2026-11-16)
- Branch `feat/dropdown-search-round2-accounts` from main 809471ba0. Tasks 7, 8 and 13 (the account pickers on `AccountCombobox`) after the PEAK-layout merge. Commits: 002987f0d and 9efc9f540 (field-scale tooling, then the `baseline-r2-peak` baseline); cd8d4c409 + 284ecb3ff (Task 7); fdb8ef7b4 + 7e5be4c1f (Task 8); 64ea150d3 (Task 13); c4f212720 (owner decision: the mobile account labels are linked with `<label htmlFor>`); plus the final-review fix commit (this section, Appendix A row A1 / A22, the `AccountCombobox` docblock and `id` / `className` JSDoc, the width guard now also scans `AccountCombobox`, `ContactCombobox` and `CustomerCombobox`).
- Owner decisions (2026-11-16): question 4 yes — the converted account pickers show `เลขบัญชี - ชื่อ` like the searchable picker, so Tasks 8 and 13 dropped their `display` props; Task 13: the mobile account labels are linked to their pickers with `<label htmlFor>`.
- Verification: every compare against `baseline-r2-peak` PASS (Task 7: the adjustment-row re-key was accepted — the baseline had sampled the old trigger in its hover state). The full web suite fails only the known Windows set.
- Not verified: a real save on the preview (the grouped CoA endpoint returns 501 there), the e2e / audit specs (not run on Windows), `local:check` (Linux / CI).
