import { computeOutcomes } from '../utils/after-sales-outcomes.util';

const base = {
  source: 'INSTALLMENT_CONTRACT' as const,
  warrantyStatus: 'IN_7DAY_DEFECT' as const,
  daysRemainingIn7Day: 2,
  contractStatus: 'ACTIVE',
  defectEligible: true,
  defectReasons: [] as string[],
  viewerRole: 'SALES',
};
const pick = (opts: ReturnType<typeof computeOutcomes>, o: string) =>
  opts.find((x) => x.outcome === o)!;

describe('computeOutcomes — ตารางทางออก (spec 4.3)', () => {
  it('ผ่อน ≤7 วัน: เปิดทั้ง 3 ทาง · ซ่อมร้านจ่าย', () => {
    const o = computeOutcomes(base);
    expect(o.map((x) => [x.outcome, x.enabled])).toEqual([
      ['REPAIR', true],
      ['SAME_MODEL_EXCHANGE', true],
      ['PRICED_EXCHANGE', true],
    ]);
    expect(pick(o, 'REPAIR').payerDefault).toBe('SHOP');
  });

  it('ผ่อน ในประกันร้าน: SALES เปลี่ยนรุ่นเดิม/มีราคาไม่ได้ พร้อมเหตุผล · BM ได้แต่ต้องยืนยัน', () => {
    const sales = computeOutcomes({
      ...base,
      warrantyStatus: 'IN_SHOP_WARRANTY',
      daysRemainingIn7Day: 0,
      defectEligible: false,
      defectReasons: ['เกินกรอบ 7 วัน'],
    });
    expect(pick(sales, 'SAME_MODEL_EXCHANGE')).toMatchObject({
      enabled: false,
      reason: 'เกินกรอบ 7 วัน',
    });
    expect(pick(sales, 'PRICED_EXCHANGE')).toMatchObject({
      enabled: false,
      reason: 'เกินกรอบ 7 วัน — ผจก.สาขาหรือเจ้าของยื่นได้',
    });
    const bm = computeOutcomes({
      ...base,
      warrantyStatus: 'IN_SHOP_WARRANTY',
      daysRemainingIn7Day: 0,
      defectEligible: false,
      defectReasons: ['เกินกรอบ 7 วัน'],
      viewerRole: 'BRANCH_MANAGER',
    });
    expect(pick(bm, 'SAME_MODEL_EXCHANGE')).toMatchObject({
      enabled: true,
      note: 'ข้ามกรอบ 7 วัน — ผจก. ต้องยืนยัน',
    });
    expect(pick(bm, 'PRICED_EXCHANGE').enabled).toBe(true);
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
      reason: 'อยู่ในประกันศูนย์ — ส่งเคลมก่อน',
    });
  });

  it('ผ่อน หมดประกัน: ซ่อมลูกค้าจ่าย · มีราคาได้ (BM)', () => {
    const o = computeOutcomes({
      ...base,
      warrantyStatus: 'OUT_OF_WARRANTY',
      daysRemainingIn7Day: 0,
      defectEligible: false,
      defectReasons: ['เกินกรอบ 7 วัน'],
      viewerRole: 'BRANCH_MANAGER',
    });
    expect(pick(o, 'REPAIR').payerDefault).toBe('CUSTOMER');
    expect(pick(o, 'PRICED_EXCHANGE').enabled).toBe(true);
  });

  it('ขายสด ≤7 วัน: ซ่อม + เปลี่ยนรุ่นเดิม(ขายสด) แต่ปิดรอกติกาบัญชี · ไม่มีเปลี่ยนแบบมีราคา', () => {
    const o = computeOutcomes({ ...base, source: 'CASH_SALE', contractStatus: undefined });
    expect(o.map((x) => x.outcome)).toEqual(['REPAIR', 'CASH_SAME_MODEL_EXCHANGE']);
    expect(pick(o, 'CASH_SAME_MODEL_EXCHANGE')).toMatchObject({
      enabled: false,
      reason: 'รอกติกาบัญชี (สเปกข้อ 10)',
    });
  });

  it('ขายสด เกิน 7 วัน: ซ่อมอย่างเดียว เหตุผลบอกวัน', () => {
    const o = computeOutcomes({
      ...base,
      source: 'CASH_SALE',
      contractStatus: undefined,
      warrantyStatus: 'IN_SHOP_WARRANTY',
      daysRemainingIn7Day: 0,
    });
    expect(pick(o, 'CASH_SAME_MODEL_EXCHANGE')).toMatchObject({
      enabled: false,
      reason: 'เกินกรอบ 7 วันแล้ว',
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

  it('ทุกทางออกที่ไม่ใช่ REPAIR ยัง implemented=false ใน PR 1', () => {
    expect(computeOutcomes(base).map((x) => x.implemented)).toEqual([true, false, false]);
  });
});
