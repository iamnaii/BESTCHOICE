import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import LineChatPanel from './LineChatPanel';

vi.mock('../hooks/useLineChatPanel', () => ({
  useLineChatPanel: () => ({
    data: { pages: [{ roomId: 'room-1', messages: [] }] },
    isLoading: false,
    isError: false,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  }),
  useSendLineChatMessage: () => ({ mutate: vi.fn(), isPending: false }),
}));

/**
 * Task 27 (คำสั่งผู้คุมงาน — รีวิว Task 24): ช่องพิมพ์ของแท็บ "แชท LINE" ส่งข้อความจริง (`POST /staff-chat/customer/:id/messages`)
 * ⇒ เปิดตามเกณฑ์เดียวกับปุ่ม "ส่ง LINE" (แถว OTP ที่ยังผูก — hasVerifiedLine) · ยังไม่ยืนยัน = ข้อความวิธีผูกเอง (อ่านอย่างเดียว) ไม่มีช่องพิมพ์
 */
describe('LineChatPanel — ช่องพิมพ์ตามสถานะยืนยัน OTP', () => {
  it('ยืนยันแล้ว → มีช่องพิมพ์ + ปุ่มส่ง', () => {
    render(<LineChatPanel customerId="c1" canSend />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('ยังไม่ยืนยัน → ไม่มีช่องพิมพ์/ปุ่มส่ง · ข้อความวิธีผูกเองแบบเดียวกับฟอร์มลูกค้า', () => {
    render(<LineChatPanel customerId="c1" canSend={false} />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(
      'ลูกค้าต้องผูกเอง: ส่งข้อความใดก็ได้ในแชท LINE น้องเบส แล้วกดปุ่ม “เริ่มยืนยันตัวตน” กรอกเบอร์และรหัส OTP ทาง SMS ผูกเสร็จแล้วสถานะที่นี่จะเปลี่ยนเอง',
    );
  });
});
