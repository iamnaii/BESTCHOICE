import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PaymentSection } from './PaymentSection';

describe('PaymentSection — S2-08 ปุ่มเลือกรูป/เพิ่ม สูงเท่าช่องข้าง ๆ (44px)', () => {
  it('ปุ่ม "เลือกรูป" และ "+ เพิ่ม" ใช้ h-11', () => {
    render(
      <PaymentSection
        payment={{ paymentStatus: 'FULLY_PAID', paymentMethod: 'BANK_TRANSFER', paidAmount: '100', paymentNotes: '' }}
        onChange={() => {}}
        netAmount={100}
        attachmentUrl=""
        setAttachmentUrl={() => {}}
        attachments={[]}
        setAttachments={() => {}}
      />,
    );
    expect(screen.getByText('เลือกรูป').closest('label')).toHaveClass('h-11');
    expect(screen.getByRole('button', { name: 'เพิ่ม' })).toHaveClass('h-11');
  });

  it('uses the shared remove glyph and removes only the named attachment', () => {
    const setAttachments = vi.fn();
    render(
      <PaymentSection
        payment={{ paymentStatus: 'FULLY_PAID', paymentMethod: 'BANK_TRANSFER', paidAmount: '100', paymentNotes: '' }}
        onChange={() => {}}
        netAmount={100}
        attachmentUrl=""
        setAttachmentUrl={() => {}}
        attachments={['/receipt-1', '/receipt-2']}
        setAttachments={setAttachments}
      />,
    );
    const remove = screen.getByRole('button', { name: 'เอาไฟล์แนบ 2 ออก' });
    expect(remove.querySelector('svg.app-icon-x')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(remove);
    expect(setAttachments).toHaveBeenCalledWith(['/receipt-1']);
  });
});
