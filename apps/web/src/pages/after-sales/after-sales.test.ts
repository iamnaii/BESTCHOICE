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
  it('ทุก WarrantyStatus มีป้าย+โทเคนสี (WARRANTY_LABEL/WARRANTY_TILE ใช้ร่วมกันทั้ง IntakeBox และ AfterSalesNewPage)', () => {
    for (const status of WARRANTY_STATUSES) {
      expect(WARRANTY_LABEL[status]).toBeTruthy();
      expect(WARRANTY_TILE[status]).toMatch(/border-|bg-/);
    }
  });
});
