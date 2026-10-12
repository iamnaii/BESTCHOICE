import {
  CASH_DAY7_REASON,
  CASH_EXCHANGE_NOTE,
  CASH_NOT_USED_REASON,
  CASH_OUT_OF_WINDOW_REASON,
  computeOutcomes,
  dropOffOutcome,
  SWITCHED_TO_REPAIR_NOTE,
  type OutcomeInput,
} from '../utils/after-sales-outcomes.util';
import { DEVICE_SWAP_CLOSED_REASON } from '../../contract-exchange/device-swap-closed.policy';

const base = {
  source: 'INSTALLMENT_CONTRACT' as const,
  warrantyStatus: 'IN_7DAY_DEFECT' as const,
  daysRemainingIn7Day: 2,
  contractStatus: 'ACTIVE',
  defectEligible: true,
  defectReasons: [] as string[],
  viewerRole: 'SALES',
};
// ข้อความจริงของ DefectExchangeService.checkEligibility (กรอบ 7 วัน)
const WINDOW = 'พ้นกำหนด 7 วันแล้ว (รับเครื่องเมื่อ 2026-09-01)';
const pick = (opts: ReturnType<typeof computeOutcomes>, o: string) =>
  opts.find((x) => x.outcome === o)!;

describe('computeOutcomes — ตารางทางออก (spec 4.3)', () => {
  it('ผ่อน ≤7 วัน: ซ่อม + เปลี่ยนรุ่นเดิมเปิด · เปลี่ยนแบบมีราคาปิดตามนโยบาย (2026-10-06) · ซ่อมร้านจ่าย', () => {
    const o = computeOutcomes(base);
    expect(o.map((x) => [x.outcome, x.enabled])).toEqual([
      ['REPAIR', true],
      ['SAME_MODEL_EXCHANGE', true],
      ['PRICED_EXCHANGE', false],
    ]);
    expect(pick(o, 'REPAIR').payerDefault).toBe('SHOP');
  });

  it('ผ่อน ในประกันร้าน: SALES เปลี่ยนรุ่นเดิม/มีราคาไม่ได้ พร้อมเหตุผล · BM ได้แต่ต้องยืนยัน', () => {
    const sales = computeOutcomes({
      ...base,
      warrantyStatus: 'IN_SHOP_WARRANTY',
      daysRemainingIn7Day: 0,
      defectEligible: false,
      defectReasons: [WINDOW],
    });
    expect(pick(sales, 'SAME_MODEL_EXCHANGE')).toMatchObject({
      enabled: false,
      // M15 — ข้อความ engine "(รับเครื่องเมื่อ …)" ห้ามขึ้นจอ → แปลงเป็นข้อความ UI
      reason: 'พ้นกรอบ 7 วัน — ผจก. ยืนยันได้',
    });
    expect(pick(sales, 'PRICED_EXCHANGE')).toMatchObject({
      enabled: false,
      reason: DEVICE_SWAP_CLOSED_REASON,
    });
    const bm = computeOutcomes({
      ...base,
      warrantyStatus: 'IN_SHOP_WARRANTY',
      daysRemainingIn7Day: 0,
      defectEligible: false,
      defectReasons: [WINDOW],
      viewerRole: 'BRANCH_MANAGER',
    });
    expect(pick(bm, 'SAME_MODEL_EXCHANGE')).toMatchObject({
      enabled: true,
      note: 'ข้ามกรอบ 7 วัน — ผจก. ต้องยืนยัน',
    });
    // 2026-10-06 — ผจก. ก็ยื่นเปลี่ยนแบบมีราคาไม่ได้แล้ว (ปิดทั้งเมนู)
    expect(pick(bm, 'PRICED_EXCHANGE')).toMatchObject({ enabled: false, reason: DEVICE_SWAP_CLOSED_REASON });
  });

  it('ผ่อน ในประกันศูนย์: ซ่อมเคลมศูนย์เท่านั้น', () => {
    const o = computeOutcomes({
      ...base,
      warrantyStatus: 'IN_MANUFACTURER',
      daysRemainingIn7Day: 0,
      defectEligible: false,
      defectReasons: ['เกินกรอบ 7 วัน'],
      viewerRole: 'OWNER',
    });
    expect(pick(o, 'REPAIR').payerDefault).toBe('SUPPLIER_CLAIM');
    expect(pick(o, 'PRICED_EXCHANGE')).toMatchObject({
      enabled: false,
      reason: DEVICE_SWAP_CLOSED_REASON,
    });
    // R9: SAME_MODEL_EXCHANGE must be gated the same way — even OWNER cannot
    // enable it on a manufacturer-warranty device.
    expect(pick(o, 'SAME_MODEL_EXCHANGE')).toMatchObject({
      enabled: false,
      reason: 'อยู่ในประกันศูนย์ — ส่งเคลมก่อน',
    });
  });

  it('R9: สัญญาไม่ได้อยู่ในสถานะเปิดใช้ → เปลี่ยนรุ่นเดิมปิดแม้ viewer เป็น OWNER', () => {
    const o = computeOutcomes({
      ...base,
      contractStatus: 'CLOSED',
      defectEligible: false,
      defectReasons: [],
      viewerRole: 'OWNER',
    });
    expect(pick(o, 'SAME_MODEL_EXCHANGE')).toMatchObject({
      enabled: false,
      reason: 'สัญญาไม่ได้อยู่ในสถานะเปิดใช้',
    });
  });

  it('ผ่อน หมดประกัน: ซ่อมลูกค้าจ่าย · เปลี่ยนแบบมีราคาปิดแม้เป็น BM (นโยบาย 2026-10-06)', () => {
    const o = computeOutcomes({
      ...base,
      warrantyStatus: 'OUT_OF_WARRANTY',
      daysRemainingIn7Day: 0,
      defectEligible: false,
      defectReasons: ['เกินกรอบ 7 วัน'],
      viewerRole: 'BRANCH_MANAGER',
    });
    expect(pick(o, 'REPAIR').payerDefault).toBe('CUSTOMER');
    expect(pick(o, 'PRICED_EXCHANGE')).toMatchObject({ enabled: false, reason: DEVICE_SWAP_CLOSED_REASON });
  });

  it('R11 (ปรับ 2026-10-06): ผ่อน หมดประกัน (SALES) → เปลี่ยนแบบมีราคาปิดด้วยเหตุผลนโยบาย ไม่ใช่ข้อความ 7 วัน/หมดประกัน', () => {
    const o = computeOutcomes({
      ...base,
      warrantyStatus: 'OUT_OF_WARRANTY',
      daysRemainingIn7Day: 0,
      defectEligible: false,
      defectReasons: ['เกินกรอบ 7 วัน'],
    });
    expect(pick(o, 'PRICED_EXCHANGE')).toMatchObject({
      enabled: false,
      reason: DEVICE_SWAP_CLOSED_REASON,
    });
    expect(pick(o, 'PRICED_EXCHANGE').reason).not.toMatch(/7 วัน|หมดประกัน/);
  });

  describe('CASH_SALE (PR 5) — เปลี่ยนรุ่นเดิมขายสด', () => {
    const cash = {
      ...base,
      source: 'CASH_SALE' as const,
      contractStatus: undefined,
      productCategory: 'PHONE_USED' as const,
    };
    it('มือสอง ใน 7 วัน (เหลือ 2 วัน) → เปิด + implemented · note ผจก. · ไม่มีเปลี่ยนแบบมีราคา', () => {
      const o = computeOutcomes(cash);
      expect(o.map((x) => x.outcome)).toEqual(['REPAIR', 'CASH_SAME_MODEL_EXCHANGE']);
      expect(pick(o, 'CASH_SAME_MODEL_EXCHANGE')).toEqual({
        outcome: 'CASH_SAME_MODEL_EXCHANGE',
        enabled: true,
        implemented: true,
        note: CASH_EXCHANGE_NOTE,
      });
    });
    it('วันที่ 7 (status ยัง IN_7DAY_DEFECT แต่ daysRemaining 0) → ปิด "ครบกำหนด 7 วันแล้ว — ซ่อมเท่านั้น" แม้เป็น OWNER', () => {
      const o = computeOutcomes({ ...cash, daysRemainingIn7Day: 0, viewerRole: 'OWNER' });
      expect(pick(o, 'CASH_SAME_MODEL_EXCHANGE')).toMatchObject({
        enabled: false,
        reason: CASH_DAY7_REASON,
      });
    });
    it('เกิน 7 วัน (IN_SHOP_WARRANTY) → ปิด "เกินกรอบ 7 วันแล้ว — ซ่อมเท่านั้น" ไม่มี override ของ BM', () => {
      const o = computeOutcomes({
        ...cash,
        warrantyStatus: 'IN_SHOP_WARRANTY',
        daysRemainingIn7Day: 0,
        viewerRole: 'BRANCH_MANAGER',
      });
      expect(pick(o, 'CASH_SAME_MODEL_EXCHANGE')).toMatchObject({
        enabled: false,
        reason: CASH_OUT_OF_WINDOW_REASON,
      });
    });
    it('เครื่องใหม่ขายสด ใน 7 วัน → ปิด "เปลี่ยนรุ่นเดิมเฉพาะมือสอง"', () => {
      const o = computeOutcomes({ ...cash, productCategory: 'PHONE_NEW' });
      expect(pick(o, 'CASH_SAME_MODEL_EXCHANGE')).toMatchObject({
        enabled: false,
        reason: CASH_NOT_USED_REASON,
      });
    });
    it('ไม่รู้หมวด (productCategory ว่าง) → ปิดแบบเดียวกับเครื่องใหม่ (fail-closed)', () => {
      const o = computeOutcomes({ ...cash, productCategory: null });
      expect(pick(o, 'CASH_SAME_MODEL_EXCHANGE')).toMatchObject({
        enabled: false,
        reason: CASH_NOT_USED_REASON,
      });
    });
  });

  it('walk-in (ไม่พบ IMEI หรือพบแต่ไม่มีใบขาย/สัญญา): ซ่อมลูกค้าจ่ายเท่านั้น', () => {
    const o = computeOutcomes({
      ...base,
      source: 'WALK_IN',
      warrantyStatus: 'WALK_IN',
      daysRemainingIn7Day: 0,
      contractStatus: undefined,
    });
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ outcome: 'REPAIR', enabled: true, payerDefault: 'CUSTOMER' });
  });

  it('SAME_MODEL_EXCHANGE implemented=true · PRICED_EXCHANGE implemented=false ตั้งแต่ปิดเมนู 2026-10-06 · CASH_SAME_MODEL_EXCHANGE ไม่รู้หมวดเครื่อง = false (fail-closed — PR 5 เปิดเมื่อ PHONE_USED)', () => {
    // ผ่อน ≤7 วัน: ซ่อม + เปลี่ยนรุ่นเดิมเปิด · เปลี่ยนแบบมีราคาปิดทั้งเมนู (คำตัดสินเจ้าของ)
    expect(computeOutcomes(base).map((x) => x.implemented)).toEqual([true, true, false]);
    // ขายสด — ไม่ส่ง productCategory ⇒ ปิดแบบเดียวกับเครื่องใหม่ (กติกา PR 5 · เคสมือสองอยู่ใน describe ด้านบน)
    const cash = computeOutcomes({ ...base, source: 'CASH_SALE', contractStatus: undefined });
    expect(pick(cash, 'CASH_SAME_MODEL_EXCHANGE').implemented).toBe(false);
  });

  describe('I1 — ผจก. ข้ามได้เฉพาะกรอบ 7 วัน ไม่ใช่กติกาอื่นของ engine', () => {
    it('PHONE_NEW (เหตุผล PHONE_USED) ในกรอบ → BM/OWNER เปลี่ยนรุ่นเดิมไม่ได้ พร้อมเหตุผลจริง', () => {
      for (const viewerRole of ['BRANCH_MANAGER', 'OWNER']) {
        const o = computeOutcomes({
          ...base,
          defectEligible: false,
          defectReasons: ['เปลี่ยนเครื่องได้เฉพาะมือสอง (PHONE_USED)'],
          viewerRole,
        });
        expect(pick(o, 'SAME_MODEL_EXCHANGE')).toMatchObject({
          enabled: false,
          reason: 'เปลี่ยนเครื่องได้เฉพาะมือสอง (PHONE_USED)',
        });
      }
    });

    it('กรอบ 7 วัน + เหตุผลอื่นพร้อมกัน → BM ปิด ใช้เหตุผลที่ไม่ใช่กรอบ 7 วัน', () => {
      const o = computeOutcomes({
        ...base,
        warrantyStatus: 'IN_SHOP_WARRANTY',
        daysRemainingIn7Day: 0,
        defectEligible: false,
        defectReasons: [WINDOW, 'เปลี่ยนเครื่องได้เฉพาะมือสอง (PHONE_USED)'],
        viewerRole: 'BRANCH_MANAGER',
      });
      expect(pick(o, 'SAME_MODEL_EXCHANGE')).toMatchObject({
        enabled: false,
        reason: 'เปลี่ยนเครื่องได้เฉพาะมือสอง (PHONE_USED)',
      });
    });

    it('เหตุผลเดียว = กรอบ 7 วัน → BM เปิดได้พร้อมหมายเหตุข้ามกรอบ', () => {
      const o = computeOutcomes({
        ...base,
        warrantyStatus: 'IN_SHOP_WARRANTY',
        daysRemainingIn7Day: 0,
        defectEligible: false,
        defectReasons: [WINDOW],
        viewerRole: 'BRANCH_MANAGER',
      });
      expect(pick(o, 'SAME_MODEL_EXCHANGE')).toMatchObject({
        enabled: true,
        note: 'ข้ามกรอบ 7 วัน — ผจก. ต้องยืนยัน',
      });
    });

    it('M15 — ข้อความที่ส่งออกไม่มีคำว่า "รับเครื่อง" เลย', () => {
      const o = computeOutcomes({
        ...base,
        warrantyStatus: 'IN_SHOP_WARRANTY',
        daysRemainingIn7Day: 0,
        defectEligible: false,
        defectReasons: [WINDOW],
      });
      expect(JSON.stringify(o)).not.toContain('รับเครื่อง');
    });
  });
});

describe('คำตัดสินเจ้าของ 2026-10-06 — เปลี่ยนแบบมีราคา (device swap) ปิดทุกกรณี', () => {
  const cases: Array<[string, Partial<OutcomeInput>]> = [
    ['ในกรอบ 7 วัน · SALES', {}],
    ['ในกรอบ 7 วัน · OWNER', { viewerRole: 'OWNER' }],
    ['ประกันร้าน · BM', { warrantyStatus: 'IN_SHOP_WARRANTY', daysRemainingIn7Day: 0, defectEligible: false, defectReasons: [WINDOW], viewerRole: 'BRANCH_MANAGER' }],
    ['หมดประกัน · BM', { warrantyStatus: 'OUT_OF_WARRANTY', daysRemainingIn7Day: 0, defectEligible: false, defectReasons: ['เกินกรอบ 7 วัน'], viewerRole: 'BRANCH_MANAGER' }],
    ['ประกันศูนย์ · OWNER', { warrantyStatus: 'IN_MANUFACTURER', daysRemainingIn7Day: 0, defectEligible: false, defectReasons: [], viewerRole: 'OWNER' }],
    ['สัญญา OVERDUE · OWNER', { contractStatus: 'OVERDUE', viewerRole: 'OWNER' }],
  ];
  it.each(cases)('%s → PRICED_EXCHANGE enabled=false · implemented=false · reason = นโยบาย (ยังอยู่ในรายการให้จอแสดงเหตุผล)', (_label, over) => {
    const o = computeOutcomes({ ...base, ...over });
    expect(pick(o, 'PRICED_EXCHANGE')).toEqual({
      outcome: 'PRICED_EXCHANGE',
      enabled: false,
      implemented: false,
      reason: DEVICE_SWAP_CLOSED_REASON,
    });
  });

  it('เปลี่ยนรุ่นเดิม (เปลี่ยนเครื่องตำหนิ 7 วัน) ไม่ถูกกระทบ — ในกรอบยังเปิด', () => {
    expect(pick(computeOutcomes(base), 'SAME_MODEL_EXCHANGE')).toMatchObject({ enabled: true, implemented: true });
  });

  it('ข้อความนโยบายบอกเหตุ (ปิดยอดสัญญาเดิมก่อน) และไม่มีคำว่า "รับเครื่อง"', () => {
    expect(DEVICE_SWAP_CLOSED_REASON).toMatch(/ปิดยอดสัญญาเดิมก่อน/);
    expect(DEVICE_SWAP_CLOSED_REASON).not.toMatch(/รับเครื่อง/);
  });
});

describe('dropOffOutcome — ทางออกที่ตกลงตอนรับฝาก (ใบรับฝากพิมพ์ซ้ำ)', () => {
  const switched = `${SWITCHED_TO_REPAIR_NOTE} · ผู้จ่าย SHOP`;

  it('ไม่เคยเปลี่ยน → ทางออกปัจจุบัน', () => {
    expect(
      dropOffOutcome({ outcome: 'REPAIR', repairTicketStatus: 'OPEN', outcomeNotes: [] }),
    ).toBe('REPAIR');
    expect(
      dropOffOutcome({ outcome: null, repairTicketStatus: null, outcomeNotes: [] }),
    ).toBeNull();
  });

  it('เปลี่ยนรุ่นเดิม → เปลี่ยนใจเป็นซ่อม → รับฝากเป็นเปลี่ยนรุ่นเดิม', () => {
    expect(
      dropOffOutcome({ outcome: 'REPAIR', repairTicketStatus: 'OPEN', outcomeNotes: [switched] }),
    ).toBe('SAME_MODEL_EXCHANGE');
  });

  it('ซ่อม → ซ่อมไม่ได้ เปลี่ยนรุ่นเดิม (ใบซ่อม REPLACED) → รับฝากเป็นซ่อม', () => {
    expect(
      dropOffOutcome({
        outcome: 'SAME_MODEL_EXCHANGE',
        repairTicketStatus: 'REPLACED',
        outcomeNotes: ['ซ่อม · ผู้จ่าย SHOP · ซ่อมที่ร้าน'],
      }),
    ).toBe('REPAIR');
  });

  it('เปลี่ยนรุ่นเดิม → เป็นซ่อม → ซ่อมไม่ได้ กลับมาเปลี่ยนรุ่นเดิม → รับฝากเป็นเปลี่ยนรุ่นเดิม', () => {
    expect(
      dropOffOutcome({
        outcome: 'SAME_MODEL_EXCHANGE',
        repairTicketStatus: 'REPLACED',
        outcomeNotes: ['เปลี่ยนรุ่นเดิม · รอ ผจก.สาขา ยืนยัน', switched],
      }),
    ).toBe('SAME_MODEL_EXCHANGE');
  });
});
