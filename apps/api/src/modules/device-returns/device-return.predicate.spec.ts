import { noOpenDeviceReturnWhere, OPEN_DEVICE_RETURN_STATUSES } from './device-return.predicate';

/**
 * spec 2026-09-20 §5.7 — "ใบเปิดอยู่" = เครื่องอยู่ที่สาขาแล้ว (รอยืนยัน หรือยืนยันแล้ว)
 * ใช้ร่วมกันโดย queue.service.ts (แท็บนัดชำระ) + promise-resolution.cron.ts (ข้าม autoLock)
 * ห้ามมีสำเนาเงื่อนไขนี้ที่อื่น.
 */
describe('device-return.predicate', () => {
  it('OPEN_DEVICE_RETURN_STATUSES = PENDING_CONFIRM + CONFIRMED (ตาม spec §5.7 — ไม่ใช่ PENDING อย่างเดียว)', () => {
    expect(OPEN_DEVICE_RETURN_STATUSES).toEqual(['PENDING_CONFIRM', 'CONFIRMED']);
  });

  it('noOpenDeviceReturnWhere() = deviceReturns.none ของสถานะเปิด + deletedAt null', () => {
    expect(noOpenDeviceReturnWhere()).toEqual({
      deviceReturns: {
        none: { status: { in: ['PENDING_CONFIRM', 'CONFIRMED'] }, deletedAt: null },
      },
    });
  });
});
