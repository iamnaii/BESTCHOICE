import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MessageBubble from '../MessageBubble';

/**
 * สถานะ "ยังไม่ถึงลูกค้า" ต้องอยู่ข้ามการรีเฟรช
 *
 * ก่อนหน้านี้ฟองแดงเป็นแค่ state ชั่วคราวในหน้าจอของคนที่กดส่ง หายทันทีที่รีเฟรช
 * เพื่อนร่วมทีมที่เปิดห้องเดียวกันจึงเห็นบับเบิลปกติ แล้วข้ามเคสนั้นไปเพราะคิดว่า
 * "ตอบแล้ว" ทั้งที่ลูกค้าไม่ได้รับอะไรเลย — อ่านจาก `outboundSentAt` ที่มากับ API แทน
 *
 * กับดักที่ต้องไม่พลาด: ข้อความที่พนักงานตอบจากแอป Facebook (echo) เป็น role STAFF
 * เหมือนกัน ไม่มี `outboundSentAt` เหมือนกัน แต่ **เราไม่ได้เป็นคนส่ง** จึงไม่ใช่ความ
 * ล้มเหลว — prod มี echo แบบนี้ 72,900+ ใบ ถ้าตีเป็นล้มเหลวจะแดงทั้งกล่อง
 */
const base = {
  id: 'm1',
  role: 'STAFF',
  text: 'สวัสดีครับ สนใจรุ่นไหนอยู่ครับ',
  createdAt: '2026-09-13T03:00:00.000Z',
};

const FAILED = 'ยังไม่ถึงลูกค้า';

describe('MessageBubble — สถานะการส่งของข้อความพนักงาน', () => {
  it('ส่งจากอินบ็อกซ์แล้วไม่ถึงลูกค้า → ขึ้นว่ายังไม่ถึงลูกค้า', () => {
    render(
      <MessageBubble
        message={{ ...base, outboundSentAt: null, staff: { id: 'u1', name: 'แอดมินเอ' } }}
      />,
    );
    expect(screen.getByText(FAILED)).toBeInTheDocument();
  });

  it('ส่งจากอินบ็อกซ์แล้วถึงลูกค้า → ไม่ขึ้นคำเตือน', () => {
    render(
      <MessageBubble
        message={{
          ...base,
          outboundSentAt: '2026-09-13T03:00:01.000Z',
          staff: { id: 'u1', name: 'แอดมินเอ' },
        }}
      />,
    );
    expect(screen.queryByText(FAILED)).not.toBeInTheDocument();
  });

  it('echo จากแอป Facebook (ไม่มี staff) → ต้องไม่ถูกตีเป็นส่งไม่สำเร็จ', () => {
    render(<MessageBubble message={{ ...base, outboundSentAt: null, staff: null }} />);
    expect(screen.queryByText(FAILED)).not.toBeInTheDocument();
  });

  it('ข้อความลูกค้าไม่มีสถานะการส่ง', () => {
    render(
      <MessageBubble message={{ ...base, role: 'CUSTOMER', outboundSentAt: null, staff: null }} />,
    );
    expect(screen.queryByText(FAILED)).not.toBeInTheDocument();
  });
});
