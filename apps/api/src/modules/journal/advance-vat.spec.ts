import { Decimal } from '@prisma/client/runtime/library';
import {
  ADVANCE_VAT_META,
  ADVANCE_VAT_PARK_DESCRIPTION,
  ADVANCE_VAT_CONSUME_DESCRIPTION,
  advanceVatOf,
  advanceVatOutstanding,
  buildAdvanceVatConsumeLines,
  buildAdvanceVatParkLines,
  consumeVatFor,
  resolveConsumeVat,
} from './advance-vat';
import { advanceVatOf as reExported } from './receipt-tax-breakdown';

/**
 * PR4 — ภาษีขายของเงินรับล่วงหน้า ณ วันรับเงิน (คำตอบฝ่ายบัญชี เล่ม 1 ข้อ 1–3, 29/09/2569 · แผน
 * docs/superpowers/plans/2026-10-11-acct-review-pr4-advance-vat.md ต2–ต5). ตัวช่วยตัวเดียวที่ทุกจุดพัก/หักใช้ —
 * ห้ามมีสูตร 7/107 ที่สอง.
 */
const D = (v: string | number) => new Decimal(v);
const money = (d: Decimal) => d.toFixed(2);

type JeRow = { metadata: Record<string, unknown> | null };
function clientWith(rows: JeRow[]) {
  const findMany = jest.fn(async () => rows);
  return { client: { journalEntry: { findMany } } as never, findMany };
}

describe('advanceVatOf — สูตรเดียว HALF_UP(|ยอด| × 7/107)', () => {
  it('G1: ค่าปรับดิว 1,419.00 → 92.83 · G3: จ่ายเกิน 500.00 → 32.71', () => {
    expect(money(advanceVatOf(D('1419')))).toBe('92.83');
    expect(money(advanceVatOf(D('500')))).toBe('32.71');
  });

  it('receipt-tax-breakdown re-exports the same function (no second formula)', () => {
    expect(reExported).toBe(advanceVatOf);
  });
});

describe('buildAdvanceVatParkLines / buildAdvanceVatConsumeLines', () => {
  it('park = Dr 21-2102 / Cr 21-2101 ด้วยคำอธิบาย "รับรู้ ณ วันรับ"', () => {
    const lines = buildAdvanceVatParkLines(D('92.83'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ accountCode: '21-2102', description: ADVANCE_VAT_PARK_DESCRIPTION });
    expect(money(lines[0].dr)).toBe('92.83');
    expect(money(lines[0].cr)).toBe('0.00');
    expect(lines[1]).toMatchObject({ accountCode: '21-2101', description: ADVANCE_VAT_PARK_DESCRIPTION });
    expect(money(lines[1].dr)).toBe('0.00');
    expect(money(lines[1].cr)).toBe('92.83');
    expect(ADVANCE_VAT_PARK_DESCRIPTION).toBe('ภาษีขายของเงินรับล่วงหน้า (รับรู้ ณ วันรับ)');
  });

  it('consume = Dr 21-2101 / Cr 21-2102 ด้วยคำอธิบาย "หักเข้างวด (รับรู้แล้วตอนรับ)"', () => {
    const lines = buildAdvanceVatConsumeLines(D('92.83'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ accountCode: '21-2101', description: ADVANCE_VAT_CONSUME_DESCRIPTION });
    expect(money(lines[0].dr)).toBe('92.83');
    expect(lines[1]).toMatchObject({ accountCode: '21-2102', description: ADVANCE_VAT_CONSUME_DESCRIPTION });
    expect(money(lines[1].cr)).toBe('92.83');
    expect(ADVANCE_VAT_CONSUME_DESCRIPTION).toBe(
      'ภาษีขายของเงินรับล่วงหน้าที่หักเข้างวด (รับรู้แล้วตอนรับ)',
    );
  });

  it('ยอด 0 หรือติดลบ = ไม่มีบรรทัด (ไม่ลงบรรทัดศูนย์บาท)', () => {
    expect(buildAdvanceVatParkLines(D(0))).toEqual([]);
    expect(buildAdvanceVatConsumeLines(D(0))).toEqual([]);
    expect(buildAdvanceVatParkLines(D('-1'))).toEqual([]);
    expect(buildAdvanceVatConsumeLines(D('-1'))).toEqual([]);
  });

  it('metadata stamp keys are fixed strings read by ภ.พ.30 + outstanding', () => {
    expect(ADVANCE_VAT_META).toEqual({ park: 'advanceVatPark', consume: 'advanceVatConsume' });
  });
});

describe('advanceVatOutstanding — อ่านจากสมุดบัญชี (stamp บน metadata)', () => {
  it('Σ park − Σ consume ของรายการ POSTED ของสัญญา · ข้ามแถว reversed · กระจกไม่มี stamp ไม่ถูกนับ', async () => {
    const { client, findMany } = clientWith([
      { metadata: { contractId: 'c1', advanceVatPark: '92.83' } },
      { metadata: { contractId: 'c1', advanceVatConsume: '32.71' } },
      { metadata: { contractId: 'c1', advanceVatPark: '50.00', reversed: true } },
      { metadata: { contractId: 'c1', tag: 'REVERSAL', reversesEntryId: 'x' } },
      { metadata: null },
    ]);
    const out = await advanceVatOutstanding(client, 'c1');
    expect(money(out)).toBe('60.12');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'POSTED',
          deletedAt: null,
          metadata: { path: ['contractId'], equals: 'c1' },
        }),
      }),
    );
  });

  it('clamp ≥ 0 เมื่อ Σ consume > Σ park (ผลตรวจ I6 — void ทำให้ติดลบไม่ได้)', async () => {
    const { client } = clientWith([
      { metadata: { advanceVatPark: '10.00' } },
      { metadata: { advanceVatConsume: '16.36' } },
    ]);
    expect(money(await advanceVatOutstanding(client, 'c1'))).toBe('0.00');
  });

  it('ไม่มี stamp เลย (เครดิตจากเปลี่ยนเครื่องเสีย · เงินพักก่อน deploy) = 0', async () => {
    const { client } = clientWith([{ metadata: { contractId: 'c1', flow: 'defect-exchange' } }]);
    expect(money(await advanceVatOutstanding(client, 'c1'))).toBe('0.00');
  });
});

describe('consumeVatFor / resolveConsumeVat — ขากลับ (ต4)', () => {
  it('หักบางส่วน: min(HALF_UP(ยอดที่ออก × 7/107), ยังค้าง) — 250 จาก 500 → 16.36', () => {
    expect(money(consumeVatFor(D('32.71'), D('250'), false))).toBe('16.36');
  });

  it('ใบสุดท้ายรับเศษ: รายการที่ทำให้ถังเป็น 0 ใช้ภาษีที่ยังค้างทั้งก้อน — 250 ที่สอง → 16.35 ไม่ใช่ 16.36', () => {
    expect(money(consumeVatFor(D('16.35'), D('250'), true))).toBe('16.35');
  });

  it('เพดาน "ยังค้าง": หักมากกว่าที่เคยรับรู้ → ได้แค่ที่ค้าง · ไม่มีค้างเลย (G7 เครดิตไม่มี stamp) → 0 แม้ถังหมด', () => {
    expect(money(consumeVatFor(D('32.71'), D('10000'), false))).toBe('32.71');
    expect(money(consumeVatFor(D(0), D('2000'), false))).toBe('0.00');
    expect(money(consumeVatFor(D(0), D('2000'), true))).toBe('0.00');
  });

  it('ยอดที่ออก 0 → 0 แม้ยังค้าง (ไม่ใช่รายการที่หัก)', () => {
    expect(money(consumeVatFor(D('32.71'), D(0), false))).toBe('0.00');
  });

  it('resolveConsumeVat อ่าน outstanding จากสมุดแล้วใช้กติกาเดียวกัน', async () => {
    const { client } = clientWith([
      { metadata: { advanceVatPark: '32.71' } },
      { metadata: { advanceVatConsume: '16.36' } },
    ]);
    expect(money(await resolveConsumeVat(client, 'c1', D('250'), false))).toBe('16.35');
    expect(money(await resolveConsumeVat(client, 'c1', D('250'), true))).toBe('16.35');
    expect(money(await resolveConsumeVat(client, 'c1', D('100'), false))).toBe('6.54');
  });
});
