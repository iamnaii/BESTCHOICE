import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ScreenTable from '../ScreenTable';

describe('ScreenTable preserves editing and row actions', () => {
  it('keeps the edited input and table ref when optional columns change', () => {
    const ref = createRef<HTMLTableElement>();
    const example = (showNote: boolean) => (
      <ScreenTable ref={ref}>
        <thead>
          <tr>
            <th>ยอดเงิน</th>
            {showNote && <th>หมายเหตุ</th>}
            <th>จัดการ</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <input aria-label="ยอดเงิน" defaultValue="1000" />
            </td>
            {showNote && <td>ตรวจยอด</td>}
            <td>
              <button type="button">ดูรายการ</button>
            </td>
          </tr>
        </tbody>
      </ScreenTable>
    );
    const { rerender } = render(example(true));
    const table = screen.getByRole('table');
    const input = screen.getByRole('textbox', { name: 'ยอดเงิน' });
    input.focus();
    fireEvent.change(input, { target: { value: '2500' } });
    rerender(example(false));
    expect(ref.current).toBe(table);
    expect(screen.getByRole('textbox', { name: 'ยอดเงิน' })).toBe(input);
    expect(input).toHaveValue('2500');
    expect(input).toHaveFocus();
    expect(screen.getByRole('button', { name: 'ดูรายการ' }).closest('td')).toHaveAttribute(
      'data-table-label',
      'จัดการ',
    );
  });

  it('retains the receiving row keyboard action and its authored role', () => {
    const edit = vi.fn();
    render(
      <ScreenTable>
        <thead>
          <tr>
            <th>รุ่น</th>
          </tr>
        </thead>
        <tbody>
          <tr
            role="button"
            tabIndex={0}
            aria-label="แก้ไขเครื่อง"
            onClick={edit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') edit();
            }}
          >
            <td>เครื่องตัวอย่าง</td>
          </tr>
        </tbody>
      </ScreenTable>,
    );
    const row = screen.getByRole('button', { name: 'แก้ไขเครื่อง' });
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.click(row);
    expect(edit).toHaveBeenCalledTimes(2);
  });
});
