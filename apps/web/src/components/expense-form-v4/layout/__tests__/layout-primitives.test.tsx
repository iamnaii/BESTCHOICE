import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DocCard } from '../DocCard';
import { FormRow } from '../FormRow';
import { SummaryBox } from '../SummaryBox';
import { StickyActionBar } from '../StickyActionBar';

describe('โครงหน้าเอกสาร', () => {
  it('FormRow แสดงหัวข้อ เนื้อหา และปุ่มท้ายหัวข้อ', () => {
    render(<FormRow title="ข้อมูลผู้ขาย" action={<button type="button">ย่อ/ขยาย</button>}><p>เนื้อหา</p></FormRow>);
    const row = screen.getByRole('region', { name: 'ข้อมูลผู้ขาย' });
    expect(within(row).getByText('เนื้อหา')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'ย่อ/ขยาย' })).toBeInTheDocument();
  });

  it('SummaryBox แสดงตัวเลขตามที่ได้รับ ไม่คำนวณเอง', () => {
    render(<SummaryBox rows={[{ label: 'มูลค่าก่อนภาษี', value: '850.00' }, { label: 'ภาษีมูลค่าเพิ่ม', value: '—' }]} total={{ label: 'จำนวนเงินทั้งสิ้น', value: '909.50' }} />);
    expect(screen.getByText('มูลค่าก่อนภาษี').nextElementSibling).toHaveTextContent('850.00');
    expect(screen.getByText('ภาษีมูลค่าเพิ่ม').nextElementSibling).toHaveTextContent('—');
    expect(screen.getByText('จำนวนเงินทั้งสิ้น').parentElement).toHaveTextContent('909.50');
  });

  it('StickyActionBar วางข้อความแจ้งเตือนไว้ก่อนแถวปุ่ม', () => {
    render(<StickyActionBar summary={<span>1 รายการ</span>} notices={<p role="alert">ผิดพลาด</p>}><button type="button">บันทึกร่าง</button></StickyActionBar>);
    const alert = screen.getByRole('alert');
    const button = screen.getByRole('button', { name: 'บันทึกร่าง' });
    expect(alert.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('DocCard วางแบนเนอร์ไว้บนสุด', () => {
    render(<DocCard banner={<p>แบนเนอร์</p>}><p>เนื้อหา</p></DocCard>);
    expect(screen.getByText('แบนเนอร์').compareDocumentPosition(screen.getByText('เนื้อหา')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
