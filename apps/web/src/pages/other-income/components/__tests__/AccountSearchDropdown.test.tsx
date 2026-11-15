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
