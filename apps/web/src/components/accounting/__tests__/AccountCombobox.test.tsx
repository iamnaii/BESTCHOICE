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

import { AccountCombobox } from '../AccountCombobox';

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

  it('re-picking the row that is already selected calls onChange again', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness filter={only42} initialValue="42-1105" onPick={onPick} />);
    await user.click(trigger());
    await user.click(screen.getByRole('option', { name: '42-1105 - รายได้ดอกเบี้ยธนาคาร' }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('42-1105');
  });
});

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

  it("valueDisplay='code' with emptyOption shows the empty row's label for ''", () => {
    render(<Harness filter={only42} valueDisplay="code" emptyOption="— ทั้งหมด —" initialValue="" />);
    expect(trigger()).toHaveTextContent('— ทั้งหมด —');
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
