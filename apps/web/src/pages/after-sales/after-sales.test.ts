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
  EXCHANGE_KIND_LABEL,
  APPROVER_LABEL,
  TIER_LABEL,
  STEP_TITLES_BY_OUTCOME,
  stageIndex,
  afterSalesKeys,
  type AfterSalesOutcome,
} from './after-sales';

const ALL_OUTCOMES: AfterSalesOutcome[] = [
  'REPAIR',
  'SAME_MODEL_EXCHANGE',
  'PRICED_EXCHANGE',
  'CASH_SAME_MODEL_EXCHANGE',
];
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
  it('staleLabel บอกจำนวนวันตาม stage (R25 e — เลิกคำว่า "เกิน" ที่ขอบ)', () => {
    expect(staleLabel('IN_REPAIR', 14)).toBe('ส่งศูนย์ 14 วัน (เกณฑ์ 14 วัน)');
    expect(staleLabel('IN_REPAIR', 16)).toBe('ส่งศูนย์ 16 วัน (เกณฑ์ 14 วัน)');
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
    expect(staleLabel('IN_REPAIR', daysInStageFromApi)).toBe('ส่งศูนย์ 14 วัน (เกณฑ์ 14 วัน)');
  });
  it('ทุก WarrantyStatus มีป้าย+โทเคนสี (WARRANTY_LABEL/WARRANTY_TILE ใช้ร่วมกันทั้ง IntakeBox และ AfterSalesNewPage)', () => {
    for (const status of WARRANTY_STATUSES) {
      expect(WARRANTY_LABEL[status]).toBeTruthy();
      expect(WARRANTY_TILE[status]).toMatch(/border-|bg-/);
    }
  });

  it('Task 9: EXCHANGE_KIND_LABEL / APPROVER_LABEL / TIER_LABEL ตรงคำเป๊ะ', () => {
    expect(EXCHANGE_KIND_LABEL).toEqual({ SAME_MODEL: 'รุ่นเดิม · 7 วัน', PRICED: 'มีราคา' });
    expect(APPROVER_LABEL).toEqual({ BRANCH_MANAGER: 'ผจก.สาขา', OWNER: 'เจ้าของเท่านั้น' });
    expect(TIER_LABEL).toEqual({ AUTO: 'อัตโนมัติ', REVIEW: 'REVIEW', ESCALATE: 'ESCALATE' });
  });

  it('Task 9: STEP_TITLES_BY_OUTCOME ครบทุก outcome — 4 ขั้นเป๊ะ ไม่มีเลขนำหน้า และไม่มีคำว่า "รับเครื่อง"', () => {
    for (const outcome of ALL_OUTCOMES) {
      const titles = STEP_TITLES_BY_OUTCOME[outcome];
      expect(titles).toHaveLength(4);
      for (const title of titles) {
        expect(title).not.toMatch(/\d/);
        expect(title).not.toContain('รับเครื่อง');
      }
    }
    expect(STEP_TITLES_BY_OUTCOME.REPAIR).toEqual([
      'รับเรื่องแล้ว',
      'กำลังซ่อม',
      'รอลูกค้ารับ',
      'ปิดเคส',
    ]);
    expect(STEP_TITLES_BY_OUTCOME.SAME_MODEL_EXCHANGE).toEqual([
      'รับเรื่องแล้ว',
      'รอ ผจก. ยืนยัน',
      'ส่งมอบเครื่องใหม่',
      'ปิดเคส',
    ]);
    expect(STEP_TITLES_BY_OUTCOME.CASH_SAME_MODEL_EXCHANGE).toEqual(
      STEP_TITLES_BY_OUTCOME.SAME_MODEL_EXCHANGE,
    );
    expect(STEP_TITLES_BY_OUTCOME.PRICED_EXCHANGE).toEqual([
      'รับเรื่องแล้ว',
      'รออนุมัติ',
      'สัญญาใหม่',
      'ปิดเคส',
    ]);
  });

  it('Task 9: stageIndex map ตำแหน่งขั้น 0..3 · CANCELLED = idle ทั้งหมด (-1)', () => {
    expect(stageIndex('RECEIVED')).toBe(0);
    expect(stageIndex('IN_REPAIR')).toBe(1);
    expect(stageIndex('AWAITING_APPROVAL')).toBe(1);
    expect(stageIndex('READY_FOR_PICKUP')).toBe(2);
    expect(stageIndex('CLOSED')).toBe(3);
    expect(stageIndex('CANCELLED')).toBe(-1);
  });

  it('Task 9: afterSalesKeys.preview/replacementProducts เป็นคีย์แยกจาก list/case', () => {
    expect(afterSalesKeys.preview({ contractId: 'c1' })).toEqual([
      'after-sales',
      'preview',
      { contractId: 'c1' },
    ]);
    expect(afterSalesKeys.replacementProducts({ contractId: 'c1' })).toEqual([
      'after-sales',
      'replacement-products',
      { contractId: 'c1' },
    ]);
  });
});
