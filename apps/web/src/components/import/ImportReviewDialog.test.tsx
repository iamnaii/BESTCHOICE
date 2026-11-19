import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportReviewDialog, type ImportReviewRow } from './ImportReviewDialog';

const rows: ImportReviewRow[] = [
  { rowNumber: 2, label: 'Apple iPhone 15 128GB มือ 1', action: 'ADD' },
  { rowNumber: 3, label: 'Apple iPhone 13 128GB มือ 2 มีประกัน', action: 'UPDATE', detail: 'เงินสด 12,000 → 12,500' },
  { rowNumber: 4, label: 'Apple iPhone 12', action: 'SKIP', detail: 'ประเภทต้องเป็น มือ 1 หรือ มือ 2' },
];

const base = { title: 'ตรวจไฟล์ราคากลางก่อนนำเข้า', pending: false, onCancel: vi.fn(), onConfirm: vi.fn() };

describe('ImportReviewDialog', () => {
  it('สรุปจำนวน เพิ่ม / แก้ / ข้าม และบอกเหตุผลของแถวที่ข้าม', () => {
    render(<ImportReviewDialog {...base} rows={rows} />);
    expect(screen.getByText('ตรวจรายการก่อนยืนยัน — เพิ่ม 1 · แก้ 1 · ข้าม 1 แถว')).toBeInTheDocument();
    expect(screen.getByText('เงินสด 12,000 → 12,500')).toBeInTheDocument();
    expect(screen.getByText('ประเภทต้องเป็น มือ 1 หรือ มือ 2')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('ติ๊ก "ปิดแถวที่เปิดใช้อยู่แต่ไม่อยู่ในไฟล์" แล้วยืนยัน → ส่ง deactivateMissing', async () => {
    const onConfirm = vi.fn();
    render(<ImportReviewDialog {...base} rows={rows} deactivateCount={3} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'ปิดแถวที่เปิดใช้อยู่แต่ไม่อยู่ในไฟล์ (3 แถว)' }));
    await userEvent.click(screen.getByRole('button', { name: 'ยืนยันนำเข้า' }));
    expect(onConfirm).toHaveBeenCalledWith({ deactivateMissing: true });
  });

  it('ไม่ติ๊ก → deactivateMissing = false', async () => {
    const onConfirm = vi.fn();
    render(<ImportReviewDialog {...base} rows={rows} deactivateCount={3} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: 'ยืนยันนำเข้า' }));
    expect(onConfirm).toHaveBeenCalledWith({ deactivateMissing: false });
  });

  it('มีแต่แถวข้าม → ปุ่มยืนยันกดไม่ได้ · แสดงคำเตือนเมื่อส่งมา', () => {
    render(<ImportReviewDialog {...base} rows={[rows[2]]} warning="มีแถวเดิมรูปแบบเก่า 3 แถว" />);
    expect(screen.getByRole('button', { name: 'ยืนยันนำเข้า' })).toBeDisabled();
    expect(screen.getByText('มีแถวเดิมรูปแบบเก่า 3 แถว')).toBeInTheDocument();
  });

  it('กำลังนำเข้า → ปุ่มปิดใช้ และแสดงความคืบหน้า', () => {
    render(<ImportReviewDialog {...base} rows={rows} pending progress="กำลังนำเข้า ชุด 1/2" />);
    expect(screen.getByRole('button', { name: 'กำลังนำเข้า...' })).toBeDisabled();
    expect(screen.getByText('กำลังนำเข้า ชุด 1/2')).toBeInTheDocument();
  });

  it('แสดงรายชื่อแถวที่จะถูกปิดใต้ตัวเลือก พร้อมคำว่า ปิด', () => {
    render(
      <ImportReviewDialog
        {...base}
        rows={rows}
        deactivateCount={2}
        deactivateRows={[{ label: 'Apple iPhone 11 64GB มือ 1' }, { label: 'Apple iPhone XR มือ 2 มีประกัน' }]}
      />,
    );
    const list = screen.getByRole('list', { name: 'แถวที่จะถูกปิด' });
    expect(list).toHaveAttribute('tabindex', '0');
    expect(within(list).getByText('Apple iPhone 11 64GB มือ 1')).toBeInTheDocument();
    expect(within(list).getByText('Apple iPhone XR มือ 2 มีประกัน')).toBeInTheDocument();
    expect(within(list).getAllByText('ปิด')).toHaveLength(2);
  });
});
