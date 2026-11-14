# Searchable/combobox audit — apps/web (read-only; no files changed, nothing run)

## 0. Corrections to the "established facts" (check these first)

1. **Control heights are already normalised to 44px inside the back office by global CSS.** `apps/web/src/styles/admin-typography.css:49-57` (imported unlayered from `apps/web/src/main.tsx:20`, so it beats Tailwind's layered utilities) applies `height: 2.75rem; min-height: 2.75rem; font-size: .875rem` to every `input`, `select`, `[data-slot='select-trigger']`, `button[role='combobox']`, `[data-slot='input-wrapper']`, `[data-slot='input-addon']` under `body:has(.app-shell)`. Lines 212-218 raise the font to 16px below 1024px.
   - `.app-shell` is set only in `components/layout/MainLayout.tsx:167` and `pages/ContractVerifyPage.tsx:39`. Portalled dialogs and popovers are still under `body`, so they are covered.
   - So the 34px-vs-44px mismatch between `<Input>`, `<SelectTrigger>`, cmdk trigger buttons and `NativeSelect` should only be visible **outside** `.app-shell` (LIFF, `/pay`, kiosk, login, public pages), inside the excluded document containers (`.tiptap`, `.document-sheet`, …), or on controls carrying `text-lg` or larger.
   - What stays inconsistent inside the shell is **radius** (`rounded-md` vs `rounded-lg`), horizontal padding, chevron icon and size, and any trigger that is neither `button[role=combobox]` nor `data-slot="select-trigger"`.
   - I read the CSS only; this needs a browser check. `styles/admin-typography.test.ts` exists and I did not read it.
2. **`SearchableSelect` has one production consumer:** `components/ui/AddressForm.tsx:240,252,264` (province, district, subdistrict). The "~3 usages" are three instances in one file.
3. **Likely real width bug:** `w-[--radix-popover-trigger-width]` in `components/contacts/ContactCombobox.tsx:134`, `components/employees/EmployeeCombobox.tsx:70` and `pages/AccountRolesPage.tsx:288`.
   - Installed Tailwind is 4.3.0, where a bare `[--var]` is no longer wrapped in `var()`. The declaration becomes `width: --radix-…`, which is invalid.
   - `tailwind-merge` has already removed the default `w-72` from `PopoverContent`, so the menu becomes content-width instead of trigger-width.
   - `pages/BookingsPage/components/CustomerCombobox.tsx:89` uses the correct `w-[var(--radix-popover-trigger-width)]`. `ui/select.tsx:122,136` uses the v4 form `w-(--…)`.
   - This affects VendorCombobox, RepairCenterCombobox and CounterpartyPicker too, since they wrap ContactCombobox. Verify in a browser.
4. Installed versions (`apps/web/package.json`): `cmdk ^1.1.1` (1.1.1 in node_modules), `@radix-ui/react-popover ^1.1.15`, `@radix-ui/react-select ^2.2.6`, `@radix-ui/react-dialog ^1.1.15`, `vaul ^1.1.2`, `react ^19.2.6`, `react-hook-form ^7.75.0`, `tailwind-merge ^3.6.0`, `tailwindcss ^4.2.2` (4.3.0 installed).

## 1. Inventory — what exists

There are three families plus two non-searchable Radix wrappers.

| Family | Implementations |
|---|---|
| **A. cmdk `Command` + Radix `Popover`** (portalled) | `ContactCombobox` and its three thin wrappers (`VendorCombobox`, `RepairCenterCombobox`, `CounterpartyPicker`); `EmployeeCombobox`; `BookingsPage/…/CustomerCombobox`; inline in `GeneralLedgerPage.tsx:230-289`; inline in `AccountRolesPage.tsx:275-317` |
| **A, not in the task list** | `PurchaseOrdersPage/…/items/AccessoryItemRow.tsx:167-205` (`CompatibleModelsPicker`, multi-select); `ui/data-grid-column-filter.tsx` (multi-select facet filter); `components/CommandPalette.tsx` |
| **B. cmdk inline, no popover** | `PurchaseOrdersPage/…/items/CatalogPicker.tsx` |
| **C. Hand-rolled `<input role="combobox">` + absolute menu** | `ui/SearchableSelect.tsx`; `ui/NameAutocomplete.tsx`; `UnifiedInboxPage/components/NoteMentionInput.tsx:203-270` (multi-select chips) |
| **C′. Hand-rolled button + absolute panel** | `other-income/components/AccountSearchDropdown.tsx` (searchable; used by ItemsTable, AdjustmentTable, PettyCashLinesSection); `other-income/components/TemplatePickerCombobox.tsx` (a menu button, not searchable despite the name) |
| **D. Radix Select wrappers, no search** | `components/CashAccountSelect.tsx`; `CustomersPage/components/FilterSelect.tsx` |

`NameAutocomplete` consumers: `TemplateEditorPane.tsx:137`, `TransferAssetDialog.tsx:72`, `AssetEntrySection1Info.tsx:121`, `PettyCashLinesSection.tsx:62`, `SellerPaymentFields.tsx:41`.

## 2. Per-implementation findings

Heights below are the component's own classes. Inside `.app-shell` they all resolve to 44px per §0.1.

### 2.1 `ui/SearchableSelect.tsx` (home-made)
- **API:** `value: string`, `onChange(string)`, `options: string[]`, `placeholder`, `disabled`, `className` (wrapper), `inputClassName`, `id`, `aria-label`, `openDirection: 'down'|'up'`.
  - No value/label split, grouping, async, create-new, `name`, `required`, `aria-invalid`, `aria-describedby`, or ref.
  - **Not clearable:** an emptied field restores the saved value on blur (lines 84-89), so a chosen value cannot be removed.
  - `key={opt}` (line 165) collides on duplicate strings.
- **Positioning:** `absolute z-50 w-full` inside the `relative` wrapper (line 155), not portalled. It is clipped by any `overflow` ancestor. `openDirection="up"` is the manual workaround; AddressForm hard-codes `"up"` on all three fields. There is no collision detection or flip.
- **Keyboard:**
  - ArrowUp/Down wrap around and call `scrollIntoView?.`.
  - Enter picks only when an item is active (line 134). Typing then Enter does nothing; the test at `SearchableSelect.test.tsx:62` has to press `{ArrowDown}{Enter}`.
  - Enter while closed is not prevented, so it submits the surrounding form.
  - Escape closes and restores the value, with `stopPropagation`.
  - No Home/End/PageUp/PageDown, no Tab-to-select, no `isComposing` guard.
- **ARIA:** mostly correct: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-autocomplete="list"`, `aria-activedescendant`, `role="listbox"` with `role="option"` and `aria-selected`.
  - The empty state renders a `listbox` with no options and no live region (lines 180-192).
  - There is no chevron, so it looks like a plain text input.
- **Trigger:** `h-[34px] rounded-md px-3 text-sm leading-snug` (line 144). AddressForm overrides it with `inputClassName={formControlClass}` (44px, `rounded-lg`, 16px / 14px at lg).
- **Mobile:** focusing always opens the soft keyboard, even for a short list. Options are `min-h-11`. Outside `.app-shell` the default is 34px/14px, which triggers iOS zoom.
- **Matching:** `toLowerCase()`, prefix matches first then substring (lines 63-70). It is the only implementation with prefix-then-substring ordering.
  - No `trim()`, no Unicode normalisation, no Thai handling (`ํา` vs `ำ`, `เเ` vs `แ`, zero-width characters, tone-mark order).
  - Thai leading vowels mean typing the consonant `ช` lands `เชียงใหม่` in the "contains" group.
- **Inside a Radix Dialog:** works without a portal (focus trap and scroll lock are not an issue).
  - Escape relies on a contract with `ui/dialog.tsx:73-80`: `data-inline-combobox="true"` plus `aria-expanded="true"` makes the dialog ignore the first Escape.
  - That hook exists only in `dialog.tsx`. It is not in `sheet.tsx`, `alert-dialog` or `drawer.tsx`, so there the first Escape closes the whole overlay.
- **Tests:** `SearchableSelect.test.tsx` has 5 tests: open direction (asserting the classes `.max-h-60`, `mt-1`, `bottom-full`), keyboard/Escape/blur restore, pointer reselect, and Escape inside a Dialog. Good coverage, but coupled to class names.

### 2.2 `ui/NameAutocomplete.tsx` (free-text plus suggestions)
- **API:** `value`, `onChange`, `options: string[]`, `placeholder`, `id`, `className`, `disabled`. Free text is allowed by design, so it is not a select.
- **Positioning and behaviour:** same absolute, non-portalled menu, always downward (line 89, `rounded-lg shadow-xl`). The keyboard, blur and Escape code is near line-for-line the same as SearchableSelect. It uses `<Input>` and has a chevron.
- **Matching:** substring only, `slice(0, 50)`, no prefix ordering.
- **ARIA:** fine.
- **Tests:** `NameAutocomplete.test.tsx`, 4 tests including the Dialog Escape contract.
- **Recommendation:** keep it as the separate free-text primitive; do not fold it into the select.

### 2.3 `components/contacts/ContactCombobox.tsx` (cmdk + Popover; the richest)
- **API:** `id`, `className` (trigger), `roleNeeded`, `value: string`, `onSelect(ContactPickResult {contactId, childId, name, taxId})`, `invalid`, `placeholder`.
  - **`value` is the display name, not an id.** The check mark compares `value === c.name` (line 170).
  - Not clearable.
- **Search:** server-side via `useQuery` and `useDebounce`, `limit: 20`, `shouldFilter={false}`. The query is not gated on `open`, so it fires on mount.
- **Create-new:** yes. A "+ สร้างผู้ติดต่อใหม่" item, or Enter when there is no exact match, opens `CreateContactModal`.
- **Async on select:** `ensureRole` mutation, with a pending state shown inside the list.
- **Grouping:** `CommandGroup` headings; role badges per row.
- **Positioning:** Radix Popover portal, `align="start"`, collision-aware. Width bug per §0.3.
- **Keyboard:** from cmdk (arrows, Home/End, Enter); Escape from Radix.
- **ARIA:** the trigger `Button role="combobox"` has `aria-expanded` and `aria-invalid`.
  - Without an `id` it gets an `aria-label` equal to the role label (line 122), which hides the selected value from the accessible name.
  - Radix adds `aria-haspopup="dialog"`; the listbox lives on the inner cmdk input. This is the usual shadcn pattern.
- **Trigger:** `Button variant="outline"`, size md (`h-8.5` 34px, `rounded-md`, 13px, `max-lg:min-h-11`). VendorCombobox passes `formControlClass` (44px, `rounded-lg`); the other wrappers do not, so radius differs between wrappers.
- **Tests:** `ContactCombobox.test.tsx`, 2 tests (search and pick, create flow). It polyfills `scrollIntoView` locally.

### 2.4 `components/employees/EmployeeCombobox.tsx`
- Same skeleton as 2.3. `value` is a display name, shown as a legacy snapshot.
- `onSelect(PickableEmployee)`, `period`, `invalid`. Server search gated on `open`. No create, no clear.
- Rows show nickname and an employee-id badge. Fixed `aria-label="พนักงาน"`, no `id` prop.
- **Tests:** 3.

### 2.5 `pages/BookingsPage/components/CustomerCombobox.tsx`
- `value: CustomerOption | null`, `onChange(option|null)`, `disabled`, `canCreate`, `className`.
- **Clearable** through a separate ghost X button beside the trigger (lines 154-164).
- Create-new is a footer button inside the list that opens `CustomerCreateDialog`.
- Server search gated on `open`, with an error state and retry button.
- Two-line items (name, phone). Trigger `h-10`. Correct popover width class.
- **Tests:** indirect, via `CreateBookingDialog.test.tsx` (8 combobox queries) and e2e `bookings.spec.ts:55`, `flows/booking-deposit-convert.spec.ts:47`.

### 2.6 Inline CoA pickers
- **`GeneralLedgerPage.tsx:230-289`:** client filter over code and name (`includes`), `shouldFilter={false}`, `slice(0, 200)`, popover `w-[380px]`. The label at line 227 has no `htmlFor`; the trigger uses `aria-label="เลือกบัญชี"`. Test: `GeneralLedgerPage.test.tsx:231`.
- **`AccountRolesPage.tsx:275-317`:** inside a Radix `Dialog`. It uses **cmdk's default fuzzy filter** with `value={`${code} ${name}`}`. Trigger is `font-mono`, labelled via `htmlFor="ar-coa-trigger"`. E2E: `account-roles-admin.spec.ts:91`.
- **`other-income/components/AccountSearchDropdown.tsx`:** a third CoA picker, hand-rolled.
  - Trigger is a plain button with `data-slot="select-trigger"` to pick up the global 44px rule. It has no `role`, `aria-expanded` or `aria-haspopup`.
  - Panel is `absolute z-30` (clippable). Search input uses `autoFocus`.
  - **No keyboard navigation at all**, and options have no `role="option"`.
  - Unique features: a `filter` predicate, and `blockedCodes` with `blockedReason` (disabled rows with a tooltip).

### 2.7 `PurchaseOrdersPage/…/items/CatalogPicker.tsx` (cmdk inline)
- A "search and add a row" box, not a value select.
- Uses `CommandPrimitive.Input` directly, with the list `absolute top-full z-20` and not portalled. The doc comment at lines 51-53 says this avoids clipping by the modal's scroll container; an absolute child of an overflow container can still be clipped, so that claim needs a browser check.
- `shouldFilter={false}`, `loop`. Opens only on an explicit gesture. Static catalogue search plus a debounced async SKU search with a request-sequence guard. Grouped, with a footer keyboard hint.
- Input is `h-11 rounded-lg`.
- **Tests:** `StepItems.test.tsx` (14 combobox queries), `PurchaseModal.test.tsx`.
- **Recommendation:** leave it alone; it is a different interaction.

### 2.8 `TemplatePickerCombobox.tsx`
- A menu button ("ใช้แม่แบบ"), not searchable. Hand-rolled `absolute z-10 w-72` panel with a `mousedown` outside-click listener.
- No ARIA and no keyboard support. `text-xs`, `px-3 py-1.5`; the trigger is not normalised by the global rule.
- It belongs with `DropdownMenu`, not the combobox.

### 2.9 `CashAccountSelect.tsx` and `FilterSelect.tsx` (Radix Select)
- **CashAccountSelect:** at most 6 codes; names from `GET /chart-of-accounts/by-codes`; disabled while loading. `aria-label={placeholder}` overrides any external `<label htmlFor>`. E2E `profile-preferences.spec.ts:67` depends on the name `เลือกบัญชีรับเงิน`. No search needed; keep as is.
- **FilterSelect:** `groups: {label?, options: {value, label, indent?}}[]`, an `ALL` sentinel because Radix Select forbids `value=""` (lines 11-15), `h-10`, `maxWidth` in px. Tests: `CustomersPage.test.tsx` (8); e2e `sales-menu-regression.spec.ts:200,257`.
- **`ui/select.tsx` generally:** portalled popper, real typeahead, items `min-h-11`, trigger sizes 28/34/40. No search.

### 2.10 `ui/native-select.tsx`
- A real `<select>`: `name`, `required`, `ref`, `onChange(e)`, native validation, the OS picker on mobile (the best mobile behaviour of everything here), and first-letter typeahead.
- No search, no rich options.
- Forced `h-11` / `text-base lg:text-sm` / `rounded-lg`, as the brief states.
- `<NativeSelect` appears 250 times in 144 non-ui files.

## 3. Answers

### (a) How much duplicated logic
- **Popover → Button[role=combobox] → Command → Input/List/Empty/Group/Item with a check mark:** written about six times (ContactCombobox, EmployeeCombobox, CustomerCombobox, GL inline, AccountRoles inline, CompatibleModelsPicker), roughly 40-60 lines each. Each differs slightly in trigger height, popover width, filter and `aria-label`.
- **Hand-rolled combobox state machine** (open, activeIndex, blur containment, ArrowUp/Down wrap, Enter, Escape with `stopPropagation`, `onMouseDown preventDefault`): SearchableSelect and NameAutocomplete are near-identical for about 60 lines. NoteMentionInput is a third variant with different clamping and an `isComposing` guard.
- **`document.addEventListener('mousedown')` outside-click:** SearchableSelect, AccountSearchDropdown, TemplatePickerCombobox, plus two unrelated files.
- **Chart-of-accounts picker:** implemented three times (GL, AccountRoles, AccountSearchDropdown) with three different matchers and three different looks.
- **Client filter** `x.toLowerCase().includes(q)`: five copies. Only SearchableSelect does prefix ordering. AccountRoles, CompatibleModelsPicker and data-grid-column-filter use cmdk's fuzzy scorer.
- **Async search** (`useDebounce` + `useQuery` + loading/error/empty rendering): three copies with three different empty and error presentations.

### (b) Recommended base: cmdk `Command` + Radix `Popover`, as a new generic component
Build it as a new file (suggested `ui/combobox.tsx`). Do not extend the home-made `SearchableSelect`.

**Why cmdk + Popover fits this codebase**
- **It is already the majority pattern.** Six-plus usages, the `ui/command.tsx` and `ui/popover.tsx` wrappers, and existing tests all use it. Unit tests and e2e already query `getByRole('combobox', { name })` on a button trigger.
- **Portal and collision handling solve the clipping problem** that forces `openDirection="up"` today. That matters for the many NativeSelects inside dialogs, sheets and `overflow-x-auto` tables.
- **The trigger gets the 44px scale for free.** A `button[role='combobox']` is already matched by `admin-typography.css:49`. Adding `formControlClass` gives `rounded-lg` and 16px / 14px to match NativeSelect outside the shell too.
- **A button trigger is labelable.** `<label htmlFor>` and `FormControl` (Slot) work, and `aria-invalid` and `aria-describedby` can be forwarded.
- **Escape layering is handled by Radix.** The popover closes first and the dialog stays open, with no need for the `data-inline-combobox` hook, so it also works in Sheet and AlertDialog.
- **The guard test is unaffected.** `native-select.inventory.test.ts:35-45,72-73` only flags JSX `<select>` and `<datalist>` tags.
- **Grouping, custom rows, footers and loading states are composition**, already proven in ContactCombobox.

**Costs and how to handle them**
- **Never use cmdk's default filter.** Its scorer is a fuzzy subsequence match, which gives surprising Thai results. Always use `shouldFilter={false}` with one shared matcher, e.g. `lib/thai-search.ts`:
  - NFC normalise, strip zero-width characters, fold `ํา`→`ำ` and `เเ`→`แ`, lowercase, trim, optionally map Thai digits.
  - Order by label prefix, then word prefix, then substring, also matching `keywords` (code, phone, nickname).
  - Four of the six existing usages already pass `shouldFilter={false}`.
- **Tests need a global `scrollIntoView` no-op.** jsdom lacks it and cmdk calls it. Today 11 test files polyfill it locally (ContactCombobox.test, GeneralLedgerPage.test:154-156, the BookingsPage tests, StepItems.test, CommandPalette.test, …) and `src/test/setup.ts` does not. `ResizeObserver` is already polyfilled at `setup.ts:16-22`.
- **Interaction is click-then-type rather than type-in-place.** For keyboard-heavy data entry, open on ArrowDown, Enter, Space or a printable key on the trigger and forward that first character into the search box.
- **Short lists should not show a search box.** Use `searchable="auto"` (hide the input below about 8 options) so a 3-option dropdown behaves like a select and does not open the phone keyboard. Do not auto-focus the search input on touch devices.
- **Wheel and touch scrolling of a portalled popover inside a modal Dialog must be verified** in a real browser. This has been a known problem with react-remove-scroll in the past, and no caller currently passes `modal` to `Popover`. Expose `modal` and `container` props in case.
- **No virtualisation.** That is fine for provinces (77), CoA (about 170) and branches; cap anything larger, as GL does with `slice(0, 200)`.
- **React Hook Form:** a button is not a form field, so `register()` cannot be spread on it. See (d).

**Why not extend the home-made SearchableSelect**
- It would need value/label, groups, async, create, clear, disabled options, `aria-invalid`, `name` and collision or portal positioning all re-implemented. That is most of what cmdk and Radix Popper already provide.
- Portalling it brings back the focus-trap and scroll-lock problems that being inline avoids today.
- An `<input>` whose text is the value cannot cleanly show a label different from the value, or a rich selected display (code plus name, name plus phone).
- It opens the soft keyboard on every tap on mobile.
- Its current tests pin class names and `openDirection`, so changing it in place breaks them anyway.

**Migration**
- Migrate `AddressForm` (the only consumer) to the new component, then delete `SearchableSelect.tsx` and its test. Port the keyboard, Escape and blur-restore test cases.
- Keep `NameAutocomplete` (free text), `CatalogPicker` (row adder), `NoteMentionInput` (mentions) and `CommandPalette` as they are.
- Do **not** bulk-replace NativeSelect. Target fields with long or dynamic lists (branch, staff, supplier, product model, CoA, bank, province). Leave lists of about 7 or fewer on NativeSelect: native validation, `register()` and the mobile OS picker are better there.

### (c) API the generic component must support
This is what covers the existing bespoke comboboxes as thin wrappers rather than rewrites.

```ts
type ComboOption<M = unknown> = {
  value: string;            // '' must be allowed (NativeSelect "ทั้งหมด"/"-- เลือก --"; Radix Select forbids it → FilterSelect ALL sentinel)
  label: string;
  keywords?: string[];      // code / phone / nickname / taxId
  description?: string;     // second line (CustomerCombobox phone)
  group?: string;           // or groups: {label?, options}[]  (FilterSelect, <optgroup>)
  disabled?: boolean; disabledReason?: string;   // AccountSearchDropdown blockedCodes/blockedReason
  meta?: M;                 // full record returned on select (PickableEmployee, Contact)
};
```

Props:
- **Value:** `value: string | null`, `onChange(value, option)`.
  - Also `selectedOption` or `displayValue` for async cases where the selected row is not in the loaded page. ContactCombobox and EmployeeCombobox show a name snapshot and compare by name; CustomerCombobox holds the object.
- **Data:** `options` or `groups`; `renderOption(option, {selected, active})`; `renderValue(option)` (GL shows a mono code plus name); `maxVisible`.
- **Search:**
  - `searchable: boolean | 'auto'`, `searchPlaceholder`.
  - `filter?: (option, query) => rank | null`, defaulting to the shared Thai-aware matcher.
  - Async mode: `onSearchChange(term)` with `loading`, `error`, `onRetry`, the caller owning `useQuery` and `useDebounce`, and client filtering off.
  - `emptyText` and `idleText` ("พิมพ์เพื่อค้นหา…").
- **Create-new:** `onCreate?(term)`, `createLabel?(term)`, and whether Enter triggers it when there is no exact match (ContactCombobox). Alternatively a `footer` slot (CustomerCombobox's button).
- **Clear:** `clearable`, either an inline X or selecting the `''` option; `onChange(null)`.
- **Form and a11y:**
  - `id`, `name` (rendering `<input type="hidden">`; a hidden `<select>` would trip the guard test), `required`, `disabled`.
  - `aria-label`, `aria-labelledby`, `aria-describedby`, `aria-invalid` / `invalid`.
  - `ref` forwarded to the trigger (RHF `setFocus`, `FormControl` Slot); `onBlur` (RHF touched).
- **Layout:**
  - `size: 'form' (44px, rounded-lg, default) | 'compact'`.
  - `className` for the trigger, `wrapperClassName` for width, margin, flex and grid (mirroring NativeSelect's contract).
  - `contentClassName`, `contentWidth: 'trigger' | number` using valid v4 syntax, `align`, `side`.
  - `modal`, `container`.
- **Behaviour:** `open` / `onOpenChange`, `closeOnSelect`, and a `pending` state shown in the list (ContactCombobox's `ensureRole`).
- **Out of scope for v1:** multi-select (CompatibleModelsPicker, data-grid-column-filter, NoteMentionInput) and free text (NameAutocomplete).

### (d) Pitfalls
1. **Unit tests that only work on a native `<select>`:**
   - `selectOptions(`: 20 calls in 9 files: RecurringBillDialog.test (9), BookingDetailSheet.test (2), CreateContactModal.test (2), PayrollLinesSection.test (2), and one each in AfterSalesCasePage.test, PricedExchangeFields.test, ContractQuoteFlow.test, ShopDailyCashPage.test, TradeInCreditPicker.test.
   - `fireEvent.change(<combobox/select>, { target: { value } })`: about 36 matches in 16 files (approximate regex; a few may be inputs). The largest are ProductsPage.test (10) and CustomerCreateDialog.test (7).
   - `getByRole('combobox', …)`: 140 calls in 39 test files. These already cover native selects, Radix triggers and cmdk triggers, so the role query survives but `toHaveValue`, `HTMLSelectElement` casts and option queries do not. About 33 matches in 21 files touch `toHaveDisplayValue`, `HTMLSelectElement`, `querySelector('…select')` or `getByRole('option')`.
   - `native-select.test.tsx` pins label, native validation, `FormData`, `form.reset()`, ref identity, disabled-fieldset and `register()` behaviour. It stays valid as long as NativeSelect remains.
2. **Playwright:**
   - `selectOption(`: 15 calls in 7 specs. Examples: `sales-menu-regression.spec.ts:206,345,362-365` (`getByRole('combobox', {name}).selectOption(...)`), `other-income-override-jv.spec.ts:54` (`select[name="items.0.whtPct"]`), `customers.spec.ts:103`, `crud-flows.spec.ts:84,596,665`, `installment-calculation.spec.ts:236-250`, `payments.spec.ts:104`, `after-sales-hub.spec.ts:100`.
   - Loose `locator('select, [role="combobox"]').first()` in admin-settings, expense-workflow, finance, reports-notifications, stock-management, template-editor and trade-in-flow. Converting one field can silently change which element `.first()` hits.
3. **React Hook Form `register()` spread on NativeSelect** (uncontrolled, ref-based), 5 sites: `other-income/OtherIncomeEntryPage.tsx:806-807`, `other-income/components/ItemsTable.tsx:136-137,157-158`, `interco/CreateBatchDialog.tsx:222-224,236-238`.
   - A button combobox needs `Controller` / `useController` or `setValue`.
   - Six more files use `required`, `name` or `{...field}` on NativeSelect and rely on native validation or `FormData` (CustomerCreateDialog ×2, StoreAppointmentsPage/Schedule, ChatFollowUpDialog, ChatServiceRequestDialog, POSPage/SaleDetailsForm). A custom combobox gives no browser "please select" bubble.
4. **`onChange` signature:** NativeSelect callers use `e => set(e.target.value)`; the combobox passes the value directly. Coercions such as `Number(e.target.value)` must be carried over at each call site. Use `<optgroup>` (2 files: `canned-response-admin/QuickReplyEditor.tsx`, `ExpensesPage.tsx`) as the grouping test case.
5. **`form.test.tsx`** only renders a raw `<input>`, so it will not break. It does define the contract, though: label click focuses the control, and `FormControl` injects `id`, `aria-describedby` and `aria-invalid` via Slot. The combobox trigger must accept and forward those and a ref. Its role is `combobox`, not `textbox`.
6. **Guard test:** do not render a hidden native `<select>` in the new component; use `<input type="hidden">`. The comment at `native-select.inventory.test.ts:48` names SearchableSelect; update it when the file is deleted.
7. **Tailwind v4 variable syntax:** use `w-(--radix-popover-trigger-width)` or `w-[var(--…)]`, and fix the three existing bad usages from §0.3 in the same pass.
8. **Global CSS coupling:** the trigger must stay a `button[role='combobox']` (or carry `data-slot="select-trigger"`) to inherit the 44px/16px rules. Do not put `text-lg` or larger on it, which opts out. Hand-set `h-8`, `h-9` or `h-10` on triggers is dead inside the shell (CustomerCombobox `h-10`, FilterSelect `h-10`), so there is no need to "fix" those to `h-11`.
9. **`aria-label` hiding the value:** the ContactCombobox, EmployeeCombobox and CashAccountSelect pattern makes the selected value absent from the accessible name, and CashAccountSelect's label overrides the caller's `<label>`. In the generic component prefer `aria-labelledby` (label id plus value span id). Tests and e2e that match `name: 'เลือกบัญชีรับเงิน'`, `'พนักงาน'` or `'ลูกค้า'` will need updating if naming changes.
10. **Dialog Escape contract:** `data-inline-combobox` in `dialog.tsx:77` must stay while NameAutocomplete exists. The portalled combobox must not set that attribute.
11. **Thai typography:** `CommandItem` (`ui/command.tsx:93`) and `CommandInput` have no explicit `leading-snug`. Inside the shell the global rule gives `text-sm` a 1.5 line height; outside it (LIFF) add `leading-snug` to items and the trigger. Truncated triggers need `title`, as ContactCombobox does at line 128.
12. **Mobile and LIFF** (mobile-first, outside `.app-shell`): the generic default must be 44px/16px on its own (`formControlClass`), not reliant on admin-typography. Consider a `vaul` Drawer presentation at 430px and below (`ui/drawer.tsx` and `useIsMobile` exist), or keep NativeSelect on LIFF pages.

## 4. Files read
All under `apps/web/`:
- `package.json`
- `src/main.tsx` (import line), `src/index.css` (imports and layers)
- `src/styles/admin-typography.css`
- `src/test/setup.ts`
- `src/components/ui/`: `SearchableSelect.tsx` and test, `command.tsx`, `popover.tsx`, `select.tsx`, `native-select.tsx` and test, `native-select.inventory.test.ts`, `NameAutocomplete.tsx` and test, `AddressForm.tsx`, `form-styles.ts`, `input.tsx`, `button.tsx` (lines 1-120), `dialog.tsx`, `form.test.tsx`, `data-grid-column-filter.tsx`
- `src/components/contacts/ContactCombobox.tsx` and test
- `src/components/employees/EmployeeCombobox.tsx` and test
- `src/components/expense-form-v4/VendorCombobox.tsx`
- `src/components/CashAccountSelect.tsx`
- `src/pages/BookingsPage/components/CustomerCombobox.tsx`
- `src/pages/after-sales/RepairCenterCombobox.tsx`
- `src/pages/other-income/components/`: `TemplatePickerCombobox.tsx`, `CounterpartyPicker.tsx`, `AccountSearchDropdown.tsx`
- `src/pages/PurchaseOrdersPage/components/wizard/items/`: `CatalogPicker.tsx`, `AccessoryItemRow.tsx` (lines 140-206)
- `src/pages/GeneralLedgerPage.tsx` (lines 60-299), `src/pages/AccountRolesPage.tsx` (lines 180-339)
- `src/pages/UnifiedInboxPage/components/NoteMentionInput.tsx` (lines 60-269)
- `src/pages/CustomersPage/components/FilterSelect.tsx`

Usage counts come from ripgrep over `apps/web/src` and `apps/web/e2e`. `sheet.tsx`, `drawer.tsx` and `alert-dialog` were checked by grep only, not read.