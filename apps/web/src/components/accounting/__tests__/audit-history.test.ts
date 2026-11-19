import { describe, it, expect } from 'vitest';
import { mapAuditEvents, withCreatedEvent, latestEvents, type RawAuditEntry } from '../audit-events';

/** ประวัติการทำงานของเอกสาร (2026-11-19) — "แก้ไขเอกสาร" แสดงช่องที่แก้ · เอกสารเก่าได้ "สร้างเอกสาร" จากผู้สร้าง · แถวในหน้า = 3 รายการล่าสุด */
const row = (over: Partial<RawAuditEntry>): RawAuditEntry => ({
  id: 'a1',
  action: 'UPDATED',
  createdAt: '2026-11-19T02:00:00.000Z',
  user: { id: 'u1', name: 'ผู้จัดการการเงิน' },
  ...over,
});

describe('mapAuditEvents — UPDATED', () => {
  it('สรุปช่องที่แก้เป็นภาษาไทย + ยอดรวมก่อน → หลัง เมื่อยอดเปลี่ยน', () => {
    const [e] = mapAuditEvents([
      row({
        oldValue: { totalAmount: '500' },
        newValue: { changedFields: ['vendorName', 'lines', 'unknownField'], totalAmount: '1070' },
      }),
    ]);
    expect(e.event).toBe('UPDATED');
    expect(e.changes).toBe('แก้: ผู้ขาย · รายการ · unknownField · ยอดรวม 500.00 → 1,070.00');
  });

  it('ยอดไม่เปลี่ยน → ไม่แสดงส่วนยอด', () => {
    const [e] = mapAuditEvents([
      row({ oldValue: { totalAmount: '500' }, newValue: { changedFields: ['note'], totalAmount: '500' } }),
    ]);
    expect(e.changes).toBe('แก้: หมายเหตุ');
  });

  it('เหตุการณ์อื่นไม่มี changes', () => {
    const [e] = mapAuditEvents([row({ action: 'POSTED', newValue: { status: 'POSTED' } })]);
    expect(e.changes).toBeUndefined();
  });
});

describe('withCreatedEvent', () => {
  const creator = { userId: 'c1', userName: 'พนักงานบัญชี', timestamp: '2026-11-18T01:00:00.000Z' };

  it('ไม่มี CREATED → เติมจากผู้สร้างของเอกสาร', () => {
    const out = withCreatedEvent(mapAuditEvents([row({ action: 'APPROVAL_REQUESTED' })]), creator);
    expect(out.map((e) => e.event)).toEqual(['CREATED', 'APPROVAL_REQUESTED']);
    expect(out[0]).toMatchObject({ userName: 'พนักงานบัญชี', timestamp: '2026-11-18T01:00:00.000Z' });
  });

  it('มี CREATED อยู่แล้ว → ไม่เติมซ้ำ', () => {
    const events = mapAuditEvents([row({ action: 'CREATED' })]);
    expect(withCreatedEvent(events, creator)).toHaveLength(1);
  });

  it('ไม่รู้เวลาสร้าง → ไม่เติม', () => {
    expect(withCreatedEvent([], { ...creator, timestamp: undefined })).toEqual([]);
  });
});

describe('latestEvents', () => {
  it('คืน N รายการล่าสุดตามเวลา ไม่ขึ้นกับลำดับที่ API ส่งมา (API ส่งใหม่ → เก่า)', () => {
    const events = mapAuditEvents([
      row({ action: 'POSTED', createdAt: '2026-11-19T05:00:00.000Z' }),
      row({ action: 'APPROVED', createdAt: '2026-11-19T04:00:00.000Z' }),
      row({ action: 'APPROVAL_REQUESTED', createdAt: '2026-11-19T03:00:00.000Z' }),
      row({ action: 'UPDATED', createdAt: '2026-11-19T02:00:00.000Z' }),
    ]);
    expect(latestEvents(events, 3).map((e) => e.event)).toEqual(['APPROVAL_REQUESTED', 'APPROVED', 'POSTED']);
  });
});
