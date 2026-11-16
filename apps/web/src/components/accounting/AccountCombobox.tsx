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

const codeOnly = (option: ComboOption<AccountItem>) =>
  option.value ? <span className="font-mono">{option.value}</span> : option.label;

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
