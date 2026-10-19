import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MovementDialog } from '../components/MovementDialog';
import type { PettyCashSummary } from '../types';

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

const summary: PettyCashSummary = {
  accountCode: 'S11-1106',
  balance: '6514.00',
  limit: { value: '20000.00', source: 'SET', updatedAt: '2026-10-10T07:00:00.000Z' },
  headroom: '13486.00',
  overLimit: '0.00',
  month: { key: '2026-10', label: 'ตุลาคม 2569', opening: '0.00', closing: '6514.00', topUps: { amount: '10000.00', count: 1 }, returns: { amount: '0.00', count: 0 }, supplierPayments: { amount: '3486.00', count: 2 }, other: { amount: '0.00', count: 0 }, net: '6514.00' },
  banks: [
    { code: 'S11-1202', label: 'ธนาคารหน้าร้าน (จ่ายออก)' },
    { code: 'S11-1201', label: 'ธนาคารหน้าร้าน (รับเข้า)' },
  ],
  defaultBank: { TOP_UP: 'S11-1202', RETURN: 'S11-1201' },
  asOf: '2026-10-18T07:02:00.000Z',
};

type Props = Parameters<typeof MovementDialog>[0];
function renderDialog(over: Partial<Props> = {}) {
  const props: Props = { kind: 'TOP_UP', open: true, summary, pending: false, onClose: vi.fn(), onSubmit: vi.fn(), ...over };
  render(<MovementDialog {...props} />);
  return props;
}

describe('MovementDialog — เติม/คืนเงินสดย่อย (mockup กระดาน 2–3)', () => {
  it('เติม: ธนาคารเริ่มต้น S11-1202 · ยอดเกิน "เติมได้อีก" → ข้อความแดง + ปุ่มปิด · ปุ่มลัดเติมให้เต็มวงเงิน · ส่ง payload ครบ', () => {
    const p = renderDialog();
    expect(screen.getByRole('heading', { name: 'เติมเงินสดย่อย' })).toBeInTheDocument();
    const bank = screen.getByRole('combobox', { name: 'ถอน/โอนจากบัญชี' }) as HTMLSelectElement;
    expect(bank.value).toBe('S11-1202');
    expect(screen.getByText(/เติมได้อีกไม่เกิน 13,486\.00 บาท/)).toBeInTheDocument();

    const amount = screen.getByRole('spinbutton', { name: 'จำนวนเงินที่เติม (บาท)' });
    const submit = screen.getByRole('button', { name: /บันทึกการเติม/ });
    expect(submit).toBeDisabled(); // ยังไม่กรอก
    fireEvent.change(amount, { target: { value: '14000' } });
    expect(screen.getByText('เกินยอดที่เติมได้ (13,486.00 บาท) — ลดยอดหรือตั้งวงเงินใหม่ก่อน')).toBeInTheDocument();
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'เติมให้เต็มวงเงิน 13,486.00' }));
    expect((amount as HTMLInputElement).value).toBe('13,486.00');
    expect(submit).toBeEnabled();
    // แสดงรายการบัญชีที่จะลง
    expect(screen.getByText(/Dr S11-1106/)).toBeInTheDocument();
    expect(screen.getByText(/Cr S11-1202/)).toBeInTheDocument();
    expect(screen.getByText(/คงเหลือหลังเติม 20,000\.00 บาท/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/หมายเหตุ/), { target: { value: 'ถอน ATM' } });
    fireEvent.click(submit);
    expect(p.onSubmit).toHaveBeenCalledTimes(1);
    const payload = (p.onSubmit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).toMatchObject({ amount: 13486, bankAccountCode: 'S11-1202', note: 'ถอน ATM', evidence: null });
    expect(payload.movedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(payload.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('เติมเมื่อถึงวงเงินแล้ว (เติมได้อีก 0) → บอกให้ตั้งวงเงิน/คืนก่อน ปุ่มปิดเสมอ', () => {
    renderDialog({ summary: { ...summary, balance: '20000.00', headroom: '0.00' } });
    expect(screen.getByText(/ยอดถึงวงเงินแล้ว/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'จำนวนเงินที่เติม (บาท)' }), { target: { value: '1' } });
    expect(screen.getByRole('button', { name: /บันทึกการเติม/ })).toBeDisabled();
  });

  it('คืน: ธนาคารเริ่มต้น S11-1201 · ยอดเกินคงเหลือ → ปิด · ปุ่มลัดคืนทั้งหมด · เลือกธนาคารอื่นได้', () => {
    const p = renderDialog({ kind: 'RETURN' });
    expect(screen.getByRole('heading', { name: 'คืนเงินสดย่อยเข้าธนาคาร' })).toBeInTheDocument();
    const bank = screen.getByRole('combobox', { name: 'ฝากเข้าบัญชี' }) as HTMLSelectElement;
    expect(bank.value).toBe('S11-1201');
    const amount = screen.getByRole('spinbutton', { name: 'จำนวนเงินที่คืน (บาท)' });
    const submit = screen.getByRole('button', { name: /บันทึกการคืน/ });
    fireEvent.change(amount, { target: { value: '7000' } });
    expect(screen.getByText('คืนได้ไม่เกินยอดคงเหลือ 6,514.00 บาท — เงินสดย่อยติดลบไม่ได้')).toBeInTheDocument();
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'คืนทั้งหมด 6,514.00' }));
    expect((amount as HTMLInputElement).value).toBe('6,514.00');
    fireEvent.change(bank, { target: { value: 'S11-1202' } });
    expect(screen.getByText(/Dr S11-1202/)).toBeInTheDocument();
    expect(screen.getByText(/Cr S11-1106/)).toBeInTheDocument();
    fireEvent.click(submit);
    expect(p.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ amount: 6514, bankAccountCode: 'S11-1202' }));
  });

  it('รูปหลักฐานไม่บังคับ: ไฟล์ที่ไม่ใช่รูป → ข้อความเตือน ไม่แนบ · รูปถูกชนิดแนบได้', () => {
    renderDialog();
    const input = screen.getByLabelText('แนบรูปหลักฐาน') as HTMLInputElement;
    const pdf = new File(['x'], 'slip.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [pdf] } });
    expect(screen.getByText('รองรับเฉพาะรูป JPEG, PNG หรือ WEBP')).toBeInTheDocument();
    const png = new File(['x'], 'slip.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [png] } });
    expect(screen.getByText('slip.png')).toBeInTheDocument();
  });
});
