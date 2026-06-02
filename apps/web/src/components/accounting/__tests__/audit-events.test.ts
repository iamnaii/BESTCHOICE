import { describe, it, expect } from 'vitest';
import { mapAuditEvents, type RawAuditEntry } from '../audit-events';

const row = (over: Partial<RawAuditEntry>): RawAuditEntry => ({
  id: 'a1',
  action: 'CREATED',
  createdAt: '2026-05-12T07:25:10.000Z',
  user: { id: 'u1', name: 'เอกนรินทร์ คงเดช' },
  ...over,
});

describe('mapAuditEvents — shared across the 3 accounting modules', () => {
  it('preserves the action verbatim as event + maps user/timestamp', () => {
    const [e] = mapAuditEvents([row({ action: 'POSTED' })]);
    expect(e.event).toBe('POSTED');
    expect(e.userId).toBe('u1');
    expect(e.userName).toBe('เอกนรินทร์ คงเดช');
    expect(e.timestamp).toBe('2026-05-12T07:25:10.000Z');
  });

  it('falls back to ระบบ / unknown when user is null', () => {
    const [e] = mapAuditEvents([row({ user: null })]);
    expect(e.userName).toBe('ระบบ');
    expect(e.userId).toBe('unknown');
  });

  it('combines reverseReasonLabel + reverseNote into "label — note"', () => {
    const [e] = mapAuditEvents([
      row({ action: 'REVERSED', newValue: { reverseReasonLabel: 'บันทึกผิดบัญชี', reverseNote: 'ควรเป็น 42-1105' } }),
    ]);
    expect(e.reason).toBe('บันทึกผิดบัญชี — ควรเป็น 42-1105');
  });

  it('uses the label alone when note is absent', () => {
    const [e] = mapAuditEvents([row({ newValue: { reverseReasonLabel: 'ผู้ขายผิด' } })]);
    expect(e.reason).toBe('ผู้ขายผิด');
  });

  it('honours the asset-style reversalReason key as enum fallback', () => {
    const [e] = mapAuditEvents([row({ newValue: { reversalReason: 'DISPOSAL_ERROR' } })]);
    expect(e.reason).toBe('DISPOSAL_ERROR');
  });

  it('leaves reason undefined when newValue carries nothing useful', () => {
    const [e] = mapAuditEvents([row({ newValue: { somethingElse: 1 } })]);
    expect(e.reason).toBeUndefined();
  });
});
