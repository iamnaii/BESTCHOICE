import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useUserNames', () => ({ useUserNames: () => ['สมชาย ใจดี'] }));
vi.mock('../VendorCombobox', () => ({
  VendorCombobox: ({ value, onSelectSupplier }: { value: string; onSelectSupplier: (s: unknown) => void }) => (
    <button type="button" onClick={() => onSelectSupplier({ name: 'ร้านตัวอย่าง', taxId: '', supplierId: 'sup-1' })}>
      {value || 'เลือกผู้ขาย'}
    </button>
  ),
}));
vi.mock('@/pages/other-income/components/AccountSearchDropdown', () => ({
  AccountSearchDropdown: (props: { value: string; onChange: (code: string) => void; 'aria-label'?: string }) => (
    <button type="button" aria-label={props['aria-label'] ?? 'บัญชี'} onClick={() => props.onChange('53-1101')}>
      {props.value || '—'}
    </button>
  ),
}));

import { PettyCashCustodianField, PettyCashLinesSection } from '../PettyCashLinesSection';
import { newPettyCashLine, type PettyCashFormFields } from '../types';

function Harness() {
  const [value, setValue] = useState<PettyCashFormFields>(() => ({
    custodianName: '', lines: [newPettyCashLine()],
  }));
  return (
    <>
      <PettyCashCustodianField value={value} onChange={setValue} />
      <PettyCashLinesSection value={value} onChange={setValue} />
    </>
  );
}

describe('PettyCashLinesSection', () => {
  it('หัวคอลัมน์ตามสัดส่วนใหม่ และทุกช่องในตารางมีชื่อ', () => {
    render(<Harness />);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent || h.getAttribute('aria-label'))).toEqual([
      '#', 'ผู้ขาย/ผู้รับเงิน / เลขใบกำกับฯ', 'หมวดบัญชี / รายละเอียด', 'จำนวน', 'VAT %', 'รวม', 'ลบ',
    ]);
    expect(screen.getByRole('button', { name: 'หมวดบัญชี' })).toBeInTheDocument();
    for (const name of ['จำนวน', 'VAT %', 'เลขใบกำกับฯ', 'รายละเอียด']) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'ลบรายการ #1' })).toBeDisabled();
  });

  it('กล่องเลื่อนของตารางเป็น relative และในตารางไม่มี sr-only', () => {
    render(<Harness />);
    const table = screen.getByRole('table');
    expect(table.parentElement).toHaveClass('relative', 'overflow-x-auto');
    expect(table.querySelector('.sr-only')).toBeNull();
  });

  it('ไม่มีบรรทัดสรุปที่หัวส่วน · แถวรวมท้ายตารางคิดจากยอดที่กรอก', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByText(/ผู้ขาย · รวม/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('จำนวน'), '120');
    const footer = screen.getByRole('table').querySelector('tfoot')!;
    expect(footer).toHaveTextContent('รวม');
    expect(footer).toHaveTextContent('120.00');
  });

  it('เพิ่มรายการแล้วลบได้ และผู้ดูแลเงินสดย่อยมีป้ายผูกกับช่อง', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'เพิ่มรายการ' }));
    expect(screen.getAllByLabelText('จำนวน')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'ลบรายการ #2' }));
    expect(screen.getAllByLabelText('จำนวน')).toHaveLength(1);
    expect(screen.getByLabelText('ผู้ดูแลเงินสดย่อย')).toBeInTheDocument();
    expect(screen.getByText('ไม่บังคับ')).toBeInTheDocument();
  });
});
