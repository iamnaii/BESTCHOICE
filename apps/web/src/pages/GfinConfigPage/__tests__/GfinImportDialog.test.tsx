import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GfinImportDialog } from '../import/GfinImportDialog';
import { buildImportTermsReview, findMissingPrices } from '../import/gfinImportTerms';
import { buildGfinImportReview, type ExistingMaxPrice } from '../gfinPriceListImport';

const ex = (id: string, series: string, storage: string, price: number): ExistingMaxPrice => ({
  id, gfinSeries: series, gfinVariant: null, storage, condition: 'HAND_2', maxPrice: String(price), modelMatchPattern: series, isActive: true,
});
const existing = [ex('p1', 'iPhone 14 Pro', '128GB', 20000), ex('p2', 'iPhone 14 Pro', '1TB', 28000), ex('o1', 'iPhone 12', '64GB', 9000)];
const rows = [
  { 'รุ่น': 'iPhone 14 Pro', 'ความจุ': '128GB', 'มือ 1/มือ 2': 'มือ 2', 'ราคา': 20000 },
  { 'รุ่น': 'iPhone 18 Pro', 'ความจุ': '256GB', 'มือ 1/มือ 2': 'มือ 2', 'ราคา': 45000 },
];
const rules = [{ id: 'r', label: 'x', seriesPattern: 'iPhone 14 Pro', condition: 'HAND_2' as const, allowance: '2000', maxMonths: 15, minDownPct: null, isActive: true }];

function setup(onConfirm = vi.fn()) {
  render(
    <GfinImportDialog
      fileName="ใบราคา.xlsx"
      prices={buildGfinImportReview(rows, existing)}
      missing={findMissingPrices(rows, existing)}
      terms={buildImportTermsReview(rows, existing, rules)}
      pending={false}
      progress={null}
      onCancel={vi.fn()}
      onConfirm={onConfirm}
    />,
  );
  return onConfirm;
}

describe('GfinImportDialog', () => {
  it('ค่าตั้งต้น: ปิดราคาที่ขาดของรุ่นในไฟล์ · เปิดรุ่นที่ไม่มีในไฟล์ไว้', () => {
    setup();
    expect(screen.getByRole('radio', { name: /ปิดราคาพวกนี้ \(รุ่นที่มีในไฟล์/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /เปิดไว้เหมือนเดิม \(รุ่นที่ไม่มีในไฟล์/ })).toBeChecked();
    expect(screen.getByText('iPhone 12 · มือ 2 · 64GB 9,000')).toBeInTheDocument();
  });

  it('รุ่นใหม่ที่ไม่มี OVER/ผ่อนสูงสุด ต้องกรอกก่อน ยืนยันจึงกดได้', async () => {
    const onConfirm = setup();
    const confirm = screen.getByRole('button', { name: 'ยืนยันนำเข้า' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('OVER ของ iPhone 18 Pro มือ 2 (บาท)'), '2000');
    await userEvent.click(screen.getByRole('radio', { name: 'iPhone 18 Pro มือ 2 ผ่อนสูงสุด 15 งวด' }));
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith({
      closeIds: ['p2'],
      changes: [{ series: 'iPhone 18 Pro', condition: 'HAND_2', allowance: 2000, maxMonths: 15 }],
    });
  });
});
