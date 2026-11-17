import { useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mobile = vi.hoisted(() => ({ value: false }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mobile.value }));
vi.mock('@/hooks/useUserNames', () => ({ useUserNames: () => ['สมชาย ใจดี'] }));
vi.mock('../VendorCombobox', () => ({
  VendorCombobox: ({ value, onSelectSupplier }: { value: string; onSelectSupplier: (s: unknown) => void }) => (
    <button type="button" onClick={() => onSelectSupplier({ name: 'ร้านตัวอย่าง', taxId: '', supplierId: 'sup-1' })}>
      {value || 'เลือกผู้ขาย'}
    </button>
  ),
}));
vi.mock('@/components/accounting/AccountCombobox', () => ({
  AccountCombobox: (props: { value: string; onChange: (code: string) => void; id?: string; 'aria-label'?: string }) => (
    <button type="button" id={props.id} aria-label={props['aria-label'] ?? (props.id ? undefined : 'บัญชี')} onClick={() => props.onChange('53-1101')}>
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
  beforeEach(() => { mobile.value = false; });

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
    expect(screen.getByLabelText('ผู้ดูแลเงินสดย่อย (ไม่บังคับ)')).toBeInTheDocument();
    expect(screen.getByText('ไม่บังคับ')).toBeInTheDocument();
  });

  describe('จอมือถือ (ต่ำกว่า lg)', () => {
    beforeEach(() => { mobile.value = true; });

    it('เป็นการ์ดต่อบรรทัด ไม่มีตาราง และทุกช่องหาเจอจากป้าย', () => {
      render(<Harness />);
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      for (const name of ['จำนวน', 'VAT %', 'เลขใบกำกับฯ', 'รายละเอียด']) {
        expect(screen.getByLabelText(name)).toBeInTheDocument();
      }
      expect(screen.getByRole('button', { name: 'หมวดบัญชี' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'ลบรายการ #1' })).toBeDisabled();
      for (const label of ['ผู้ขาย/ผู้รับเงิน', 'หมวดบัญชี', 'จำนวน', 'VAT %', 'เลขใบกำกับฯ', 'รายละเอียด', 'รวม']) {
        expect(screen.getAllByText(label).length).toBeGreaterThan(0);
      }
    });

    it('เพิ่ม/ลบรายการได้ และสรุปรวมท้ายการ์ดคิดจากยอดที่กรอก', async () => {
      const user = userEvent.setup();
      render(<Harness />);
      await user.type(screen.getByLabelText('จำนวน'), '100');
      await user.selectOptions(screen.getByLabelText('VAT %'), '7');
      const totals = screen.getByTestId('petty-cash-totals');
      expect(totals).toHaveTextContent('100.00');
      expect(totals).toHaveTextContent('7.00');
      expect(totals).toHaveTextContent('107.00');
      await user.click(screen.getByRole('button', { name: 'เพิ่มรายการ' }));
      expect(screen.getAllByLabelText('จำนวน')).toHaveLength(2);
      await user.click(screen.getByRole('button', { name: 'ลบรายการ #2' }));
      expect(screen.getAllByLabelText('จำนวน')).toHaveLength(1);
    });
  });

  it('ปุ่มลบอยู่แถวล่างของบรรทัด — Tab ไล่ VAT % → เลขใบกำกับฯ → รายละเอียด → ลบ', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    // สองบรรทัด — ปุ่มลบของบรรทัดแรกจึงกดได้ (บรรทัดเดียวปุ่มถูกปิด ไม่อยู่ในลำดับ Tab)
    await user.click(screen.getByRole('button', { name: 'เพิ่มรายการ' }));
    const del = screen.getByRole('button', { name: 'ลบรายการ #1' });
    const invoice = screen.getAllByLabelText('เลขใบกำกับฯ')[0];
    expect(del.closest('tr')).toBe(invoice.closest('tr'));
    act(() => screen.getAllByRole('combobox', { name: 'VAT %' })[0].focus());
    await user.tab();
    expect(invoice).toHaveFocus();
    await user.tab();
    expect(screen.getAllByLabelText('รายละเอียด')[0]).toHaveFocus();
    await user.tab();
    expect(del).toHaveFocus();
  });
});
