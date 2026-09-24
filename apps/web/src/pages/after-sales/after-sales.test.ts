import { describe, expect, it } from 'vitest';
import {
  STAGE_LABEL,
  STAGE_ICON,
  STAGE_TILE,
  SOURCE_LABEL,
  OUTCOME_LABEL,
  WARRANTY_LABEL,
  WARRANTY_TILE,
  WARRANTY_STATUSES,
  staleLabel,
} from './after-sales';
describe('after-sales maps', () => {
  it('ทุก stage มีป้าย+ไอคอน+สี (สถานะห้ามบอกด้วยสีอย่างเดียว)', () => {
    for (const s of [
      'RECEIVED',
      'IN_REPAIR',
      'AWAITING_APPROVAL',
      'READY_FOR_PICKUP',
      'CLOSED',
      'CANCELLED',
    ] as const) {
      expect(STAGE_LABEL[s]).toBeTruthy();
      expect(STAGE_ICON[s]).toBeTruthy();
      expect(STAGE_TILE[s]).toMatch(/border-|bg-/);
    }
    expect(STAGE_LABEL.RECEIVED).toBe('รับเรื่องแล้ว');
    expect(SOURCE_LABEL.WALK_IN).toBe('ไม่ได้ซื้อจากร้าน');
    expect(OUTCOME_LABEL.REPAIR).toBe('ซ่อม');
  });
  it('staleLabel บอกจำนวนวันตาม stage', () => {
    expect(staleLabel('IN_REPAIR', 16)).toBe('ส่งศูนย์ 16 วัน (เกิน 14)');
    expect(staleLabel('READY_FOR_PICKUP', 3)).toBeNull();
  });

  // C3 (final-fix brief) — API `isStale` เทียบเป็นมิลลิวินาที (`ms > d*86400000`) แต่
  // `daysInStage` ที่ส่งมาคือ `Math.floor(ms/86400000)` — เคส 14.5 วันจริง: floor = 14 แต่
  // API ถือว่า stale แล้ว (14.5*day > 14*day) ก่อนแก้ `days > s[0]` (14 > 14 = false) จะไม่โชว์
  // ข้อความค้างนานทั้งที่ API บอกว่า stale — ต้องให้ boundary ตรงกัน (`days >= s[0]`)
  it('C3: ขอบ 14.5 วันจริง (floor เหลือ 14) ต้องยังโชว์ข้อความค้างนาน ให้ตรง semantics ของ API isStale', () => {
    // จำลอง daysInStage ที่ API จะส่งมาจริงสำหรับเคส IN_REPAIR ที่ผ่านมา 14.5 วัน:
    // ms = 14.5 * 86400000 → isStale (ms > 14*86400000) = true, floor(ms/86400000) = 14
    const daysInStageFromApi = Math.floor((14.5 * 86400000) / 86400000);
    expect(daysInStageFromApi).toBe(14);
    expect(staleLabel('IN_REPAIR', daysInStageFromApi)).toBe('ส่งศูนย์ 14 วัน (เกิน 14)');
  });
  it('ทุก WarrantyStatus มีป้าย+โทเคนสี (WARRANTY_LABEL/WARRANTY_TILE ใช้ร่วมกันทั้ง IntakeBox และ AfterSalesNewPage)', () => {
    for (const status of WARRANTY_STATUSES) {
      expect(WARRANTY_LABEL[status]).toBeTruthy();
      expect(WARRANTY_TILE[status]).toMatch(/border-|bg-/);
    }
  });
});
