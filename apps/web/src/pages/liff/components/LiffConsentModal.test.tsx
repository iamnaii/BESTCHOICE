import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import LiffConsentModal from './LiffConsentModal';

/**
 * Task 33 fix round 1 (คำตัดสินเจ้าของข้อ 30) — โมดัล "ข้อตกลงการใช้งาน" ของ `/liff/contract` เคยเขียนว่า "ถอนความยินยอมได้ตลอดเวลาผ่านหน้าโปรไฟล์"
 * ซึ่งหน้าโปรไฟล์ไม่มีทางนั้น ⇒ บอกทางที่มีจริง ชุดเดียวกับหน้า "ผูก LINE เรียบร้อย" (C3): ติดต่อเจ้าหน้าที่ทางแชท หรือโทรหาสาขา
 */
describe('LiffConsentModal', () => {
  it('บอกทางถอนความยินยอมที่มีจริง (ชุดเดียวกับ C3) · ไม่อ้างหน้าโปรไฟล์', () => {
    render(<LiffConsentModal pending={false} onAccept={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'ข้อตกลงการใช้งาน' });
    expect(dialog).toHaveTextContent(
      'ต้องการยกเลิกความยินยอม: ติดต่อเจ้าหน้าที่ทางแชทนี้ หรือโทรหาสาขา 063-134-6356',
    );
    expect(dialog).not.toHaveTextContent('หน้าโปรไฟล์');
  });

  it('กด "ยินยอม" → onAccept · ระหว่างบันทึกปุ่มกดไม่ได้', () => {
    const onAccept = vi.fn();
    const { rerender } = render(<LiffConsentModal pending={false} onAccept={onAccept} />);
    fireEvent.click(screen.getByRole('button', { name: 'ยินยอม' }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    rerender(<LiffConsentModal pending onAccept={onAccept} />);
    expect(screen.getByRole('button', { name: 'กำลังบันทึก...' })).toBeDisabled();
  });
});
