import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BookingTimeline, { describeEvent, eventActorLabel } from '../components/BookingTimeline';

describe('describeEvent — ล็อกเครื่อง (PR 2)', () => {
  const base = { id: 'e1', at: '2026-10-05T03:00:00.000Z', actor: { id: 'u1', name: 'สมชาย' } };
  it('รับมัดจำที่ล็อกเครื่อง → บอกว่าล็อกแล้ว', () => {
    expect(
      describeEvent({
        ...base,
        kind: 'BOOKING_DEPOSIT_PAID',
        data: { depositMethod: 'CASH', lockedProductId: 'prod-1' },
      }).title,
    ).toBe('รับมัดจำ · เงินสด · ล็อกเครื่องให้ลูกค้าแล้ว');
  });
  it('รับมัดจำใบยุคก่อน (ไม่ล็อก) → ข้อความเดิม', () => {
    expect(
      describeEvent({
        ...base,
        kind: 'BOOKING_DEPOSIT_PAID',
        data: { depositMethod: 'CASH', lockedProductId: null },
      }).title,
    ).toBe('รับมัดจำ · เงินสด');
  });
  it('BOOKING_UNLOCK_SKIPPED → เตือนว่าปลดล็อกไม่สำเร็จ', () => {
    const r = describeEvent({
      ...base,
      kind: 'BOOKING_UNLOCK_SKIPPED',
      data: { reason: 'PRODUCT_NOT_RESERVED' },
    });
    expect(r.title).toBe('ปลดล็อกเครื่องไม่ได้ — สถานะเครื่องถูกเปลี่ยนไปแล้ว ตรวจสต็อก');
    expect(r.tone).toBe('destructive');
  });
  it('BOOKING_UNLOCK_SKIPPED จาก cron หมดอายุ → ผู้กระทำเป็น "ระบบ" · จากการยกเลิกโดยคน → ชื่อผู้ใช้', () => {
    const cron = {
      ...base,
      actor: { id: 'sys', name: 'System' },
      kind: 'BOOKING_UNLOCK_SKIPPED',
      data: { reason: 'PRODUCT_NOT_RESERVED', flow: 'auto-expire' },
    };
    const manual = {
      ...base,
      kind: 'BOOKING_UNLOCK_SKIPPED',
      data: { reason: 'PRODUCT_NOT_RESERVED', flow: 'cancel' },
    };
    expect(eventActorLabel(cron)).toBe('ระบบ');
    expect(eventActorLabel(manual)).toBe('สมชาย');
    render(<BookingTimeline events={[cron]} />);
    expect(screen.getByText(/· ระบบ$/)).toBeInTheDocument();
    expect(screen.queryByText(/System/)).not.toBeInTheDocument();
  });
});
