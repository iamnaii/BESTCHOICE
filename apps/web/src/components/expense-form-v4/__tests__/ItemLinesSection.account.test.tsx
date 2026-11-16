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
