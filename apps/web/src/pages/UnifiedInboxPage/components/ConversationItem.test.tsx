import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import ConversationItem from './ConversationItem';

/** ป้ายในแถวไม่เกิน 2 ใบ ลำดับล็อก: หน้าต่าง → ด่วน → ค้างชำระ → บอท (สเปก §7 แก้ไข 2026-09-05) */
const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const H = 60 * 60 * 1000;

function room(over: Record<string, unknown> = {}) {
  return {
    id: 'r-1',
    channel: 'FACEBOOK',
    priority: 'NORMAL',
    lastMessageAt: ago(5 * 60_000),
    totalMessages: 3,
    displayName: 'ลูกค้า ทดสอบ',
    messages: [{ text: 'สวัสดีค่ะ', role: 'CUSTOMER', createdAt: ago(5 * 60_000) }],
    ...over,
  };
}

function renderRow(session: ReturnType<typeof room>) {
  return render(
    <MemoryRouter>
      <ConversationItem session={session} isActive={false} onSelect={vi.fn()} />
    </MemoryRouter>,
  );
}

describe('ConversationItem — ป้ายในแถว', () => {
  it('ห้อง FB ที่รอและเหลือไม่เกิน 3 ชม. → ป้าย "เหลือ N" มาก่อน และคงเห็นแม้มีป้ายอื่นอีก 3 ใบ', () => {
    renderRow(room({
      priority: 'HIGH',
      tags: [{ tag: 'overdue' }],
      aiPaused: true,
      waitingSince: ago(5 * H),
      lastCustomerAt: ago(22 * H),
    }));
    expect(screen.getByText(/^เหลือ 2 ชม\.$/)).toBeInTheDocument();
    // ใบที่สอง = ด่วน · ค้างชำระกับบอทยุบเป็น +2
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.queryByText('ค้างชำระ')).toBeNull();
  });

  it('ห้อง FB ที่รอและพ้น 24 ชม. → "หมดเวลาตอบ" ไม่ใช่ "รอ N"', () => {
    renderRow(room({ waitingSince: ago(3 * 24 * H), lastCustomerAt: ago(3 * 24 * H) }));
    expect(screen.getByText('หมดเวลาตอบ')).toBeInTheDocument();
    expect(screen.queryByText(/^รอ /)).toBeNull();
  });

  it('ห้อง LINE ไม่มีหน้าต่าง → "รอ N" ตามปกติแม้ผ่านมาหลายวัน', () => {
    renderRow(room({ channel: 'LINE_FINANCE', waitingSince: ago(3 * 24 * H), lastCustomerAt: ago(3 * 24 * H) }));
    expect(screen.getByText(/^รอ /)).toBeInTheDocument();
    expect(screen.queryByText('หมดเวลาตอบ')).toBeNull();
  });

  it('ห้อง FB ที่รอแต่ยังไม่มี lastCustomerAt (ก่อน CLI เติม) → "ไม่ทราบเวลา" ไม่ใช่ "รอ N"', () => {
    renderRow(room({ waitingSince: ago(3 * 24 * H), lastCustomerAt: null }));
    expect(screen.getByText('ไม่ทราบเวลา')).toBeInTheDocument();
    expect(screen.queryByText(/^รอ /)).toBeNull();
  });

  it('ไม่รอ ไม่ด่วน ไม่ค้าง ไม่มีบอท → ไม่มีป้ายและไม่มี +N', () => {
    renderRow(room());
    expect(screen.queryByText(/\+\d/)).toBeNull();
    expect(screen.queryByText(/^รอ /)).toBeNull();
  });
});

/**
 * Task 33 (mockup A2) — ห้อง LINE การเงินที่ LINE ในห้องไม่ใช่ LINE ที่ลูกค้ายืนยัน OTP อยู่ตอนนี้ (`financeLineStatus` จาก server — ไม่มี U-id):
 * ป้าย "ยกเลิกผูกแล้ว" (ไอคอน + คำ ไม่ตัดบรรทัด) เป็น**ป้ายแรก**ของแถว · ห้องที่ยืนยันแล้ว/ไม่เคยผูก/ช่องอื่น ไม่มีป้ายนี้
 */
describe('ConversationItem — ป้าย "ยกเลิกผูกแล้ว" (Task 33 A2)', () => {
  const unlinked = { verified: false, unlinkedAt: '2026-10-30T05:00:00.000Z' };

  it('ยกเลิกผูกแล้ว → ป้ายแรกของแถว (ก่อน "รอ N") · ไม่ตัดบรรทัด · มีไอคอน', () => {
    renderRow(
      room({
        channel: 'LINE_FINANCE',
        financeLineStatus: unlinked,
        waitingSince: ago(12 * 60_000),
        priority: 'HIGH',
      }),
    );
    const badge = screen.getByText('ยกเลิกผูกแล้ว');
    expect(badge.className).toMatch(/whitespace-nowrap/);
    expect(badge.querySelector('svg')).not.toBeNull();
    const pills = badge.parentElement!.children;
    expect(pills[0]).toBe(badge);
    // เพดานป้ายสองใบเดิม: ป้ายนี้ + "รอ N" · ที่เหลือยุบเป็น +N
    expect(screen.getByText(/^รอ /)).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('ยกเลิกผูกแล้วโดยไม่มีป้ายอื่น → แถวป้ายยังขึ้น', () => {
    renderRow(room({ channel: 'LINE_FINANCE', financeLineStatus: unlinked }));
    expect(screen.getByText('ยกเลิกผูกแล้ว')).toBeInTheDocument();
  });

  it.each([
    ['ยืนยัน OTP แล้ว', { verified: true, unlinkedAt: null }],
    ['ไม่เคยผูก LINE นี้ (ไม่อยู่ใน mockup — คงหน้าตาเดิม)', { verified: false, unlinkedAt: null }],
    ['ช่องอื่น', null],
  ])('%s → ไม่มีป้าย "ยกเลิกผูกแล้ว"', (_label, financeLineStatus) => {
    renderRow(room({ channel: 'LINE_FINANCE', financeLineStatus }));
    expect(screen.queryByText('ยกเลิกผูกแล้ว')).toBeNull();
  });
});
