import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import ContractInputVatCard from '../ContractInputVatCard';
import type { ContractInputVat } from '@/lib/input-vat';

/** ก้อน 5 — การ์ดภาษีซื้อของเครื่อง 3 สถานะ (mockup กระดาน Contract) · เห็นเฉพาะ OWNER/FM/ACCOUNTANT (Q5) */
const base: ContractInputVat = {
  status: 'CLAIMED', amount: '686.00', journalEntryNo: 'JE-202610-00009',
  taxInvoice: { number: 'IV-9', date: '2026-10-01', ageMonths: 0 },
  grNumber: 'GR-20261005-001', receivingId: 'gr-1', poId: 'po-1', poNumber: 'PO-20261001-0001', reason: null,
};
const renderCard = (inputVat: ContractInputVat | null | undefined, role = 'OWNER') =>
  render(<MemoryRouter><ContractInputVatCard inputVat={inputVat} role={role} /></MemoryRouter>);

describe('ContractInputVatCard', () => {
  it('CLAIMED → ยอด 686.00 ฿ · เลข JE · ใบกำกับ+วันที่ · ใบรับของ · ไม่มีป้ายอายุเมื่อ 0 เดือน', () => {
    renderCard(base);
    expect(screen.getByRole('region', { name: 'ภาษีซื้อของเครื่อง' })).toBeInTheDocument();
    expect(screen.getByText('เคลมแล้ว')).toBeInTheDocument();
    expect(screen.getByText('686.00 ฿')).toBeInTheDocument();
    expect(screen.getByText('JE-202610-00009')).toBeInTheDocument();
    expect(screen.getByText(/IV-9/)).toBeInTheDocument();
    expect(screen.getByText(/GR-20261005-001/)).toBeInTheDocument();
    expect(screen.queryByText(/เกิน 6 เดือน/)).toBeNull();
  });

  it('อายุใบกำกับ ≥ 6 เดือน → ป้ายเตือน (ไม่บล็อก)', () => {
    renderCard({ ...base, taxInvoice: { number: 'IV-9', date: '2026-03-31', ageMonths: 6 } });
    expect(screen.getByText('ใบกำกับอายุ 6 เดือน — เกิน 6 เดือน ตรวจกับฝ่ายบัญชี')).toBeInTheDocument();
  });

  it('PENDING_INVOICE → "รอใบกำกับภาษี" + ยอดที่จะเคลม + ลิงก์ดูใบรับของ', () => {
    renderCard({ ...base, status: 'PENDING_INVOICE', journalEntryNo: null, taxInvoice: null });
    expect(screen.getByText('รอใบกำกับภาษี')).toBeInTheDocument();
    expect(screen.getByText('686.00 ฿')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'ดูใบรับของ GR-20261005-001' });
    expect(link).toHaveAttribute('href', '/purchase-orders/po-1/goods-receivings/gr-1/print');
    expect(screen.getByText(/บันทึกใบกำกับภาษีได้ที่หน้าใบสั่งซื้อ PO-20261001-0001/)).toBeInTheDocument();
  });

  it('NOT_ELIGIBLE → "ไม่มีภาษีซื้อ" + เหตุผล · ไม่มียอด', () => {
    renderCard({ ...base, status: 'NOT_ELIGIBLE', amount: null, journalEntryNo: null, taxInvoice: null, grNumber: null, receivingId: null, poId: null, poNumber: null, reason: 'ผู้จัดจำหน่ายไม่จด VAT / บิลเงินสด — ใบสั่งซื้อไม่มีภาษีซื้อ' });
    expect(screen.getByText('ไม่มีภาษีซื้อ')).toBeInTheDocument();
    expect(screen.getByText('ผู้จัดจำหน่ายไม่จด VAT / บิลเงินสด — ใบสั่งซื้อไม่มีภาษีซื้อ')).toBeInTheDocument();
    expect(screen.queryByText(/฿/)).toBeNull();
  });

  it('REVERSED → "กลับรายการแล้ว (ยกเลิกสัญญา)" + JE เดิม', () => {
    renderCard({ ...base, status: 'REVERSED' });
    expect(screen.getByText('กลับรายการแล้ว (ยกเลิกสัญญา)')).toBeInTheDocument();
    expect(screen.getByText('JE-202610-00009')).toBeInTheDocument();
  });

  it('BRANCH_MANAGER / SALES ไม่เห็นการ์ด · NONE / ไม่มีข้อมูล ไม่เห็นการ์ด', () => {
    const { container: c1 } = renderCard(base, 'BRANCH_MANAGER');
    expect(c1.querySelector('section')).toBeNull();
    const { container: c2 } = renderCard(base, 'SALES');
    expect(c2.querySelector('section')).toBeNull();
    const { container: c3 } = renderCard({ ...base, status: 'NONE' });
    expect(c3.querySelector('section')).toBeNull();
    const { container: c4 } = renderCard(undefined);
    expect(c4.querySelector('section')).toBeNull();
  });
});
