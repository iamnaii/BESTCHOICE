import { Decimal } from '@prisma/client/runtime/library';
import {
  EarlyPayoffJe,
  EarlyPayoffLedger,
  buildEarlyPayoffJE,
  buildEarlyPayoffJournal,
  readEarlyPayoffLedger,
} from './compute-early-payoff-je';
import { ledgerLines } from './__tests__/ledger-lines-mock';

/**
 * PR5 — ปิดยอดก่อนกำหนดล้างตามยอดในบัญชี (คำตอบฝ่ายบัญชี เล่ม 1 ข้อ 5.1–5.4 · 29/09/2569).
 * สัญญาตัวอย่างของฝ่ายบัญชี: 17,000/12 งวด งวดละ 1,515.83 (ขายสด 12,000 ดาวน์ 2,000 ค่าคอม 1,000 ดอกเบี้ย 6,000
 * VAT 1,190) — รายการเปิดสัญญา (1A) ตั้ง 11-2101 17,000.00 · 11-2105 1,190.00 · 11-2106 6,000.00 · 21-2102 1,190.00
 */
describe('buildEarlyPayoffJE — รายการปิดยอดก่อนกำหนดตามยอดในบัญชี (PR5)', () => {
  const d = (v: string) => new Decimal(v);
  const ledger = (v: {
    gross: string;
    accrued?: string;
    vatReceivable: string;
    deferredInterest: string;
    deferredVat: string;
  }): EarlyPayoffLedger => ({
    gross: d(v.gross),
    accrued: d(v.accrued ?? '0'),
    vatReceivable: d(v.vatReceivable),
    deferredInterest: d(v.deferredInterest),
    deferredVat: d(v.deferredVat),
  });
  /** ยังไม่จ่ายเลย — ยอดหลังรายการเปิดสัญญา */
  const opened = ledger({
    gross: '17000.00',
    vatReceivable: '1190.00',
    deferredInterest: '6000.00',
    deferredVat: '1190.00',
  });
  const linesOf = (je: EarlyPayoffJe) =>
    je.lines.map((l) => `${l.accountCode}:${l.dr.toFixed(2)}:${l.cr.toFixed(2)}`);
  const totals = (je: EarlyPayoffJe) => ({
    dr: je.lines.reduce((s, l) => s.plus(l.dr), new Decimal(0)).toFixed(2),
    cr: je.lines.reduce((s, l) => s.plus(l.cr), new Decimal(0)).toFixed(2),
  });

  it('ตัวอย่างฝ่ายบัญชี: ยังไม่จ่ายเลย ส่วนลด 50% ลูกค้าจ่าย 15,189.98 → เงินสด 15,189.98 · 52-1106 3,000.02 · ล้างลูกหนี้ 17,000.00 / ภาษี 1,190.00 ตามบัญชี', () => {
    const je = buildEarlyPayoffJE({
      depositAccountCode: '11-1201',
      cashReceived: '15189.98',
      ledger: opened,
      discountPercent: '50',
    });
    expect(linesOf(je)).toEqual([
      '11-1201:15189.98:0.00',
      '11-2106:6000.00:0.00',
      '21-2102:1190.00:0.00',
      '52-1106:3000.02:0.00',
      '11-2101:0.00:17000.00',
      '11-2105:0.00:1190.00',
      '41-1101:0.00:6000.00',
      '21-2101:0.00:1190.00',
    ]);
    expect(totals(je)).toEqual({ dr: '25380.00', cr: '25380.00' });
    expect(je.receivableCleared.toFixed(2)).toBe('18190.00');
    expect(je.discount.toFixed(2)).toBe('3000.02');
    // ฐานข้อ 5.2 = 50% × 6,000.00 · ส่วนที่เกิน = เศษงวดสุดท้าย 0.02 (ผู้เรียกไม่บันทึก — ไม่เกิน 1.00)
    expect(je.deferredInterestDiscountBase.toFixed(2)).toBe('3000.00');
    expect(je.discountBeyondDeferredBase.toFixed(2)).toBe('0.02');
    expect(je.roundingGain.toFixed(2)).toBe('0.00');
    expect(je.excessReceived.toFixed(2)).toBe('0.00');
  });

  it('มีเงินพักค่าปรับดิว 1,044.00 ลูกค้าจ่าย 14,318.16 → Dr 21-1103 1,044.00 แทนเงินสด · 52-1106 2,827.84', () => {
    const je = buildEarlyPayoffJE({
      depositAccountCode: '11-1201',
      cashReceived: '14318.16',
      ledger: opened,
      parkRelief: '1044.00',
      discountPercent: '50',
    });
    expect(linesOf(je)).toEqual([
      '11-1201:14318.16:0.00',
      '11-2106:6000.00:0.00',
      '21-2102:1190.00:0.00',
      '52-1106:2827.84:0.00',
      '21-1103:1044.00:0.00',
      '11-2101:0.00:17000.00',
      '11-2105:0.00:1190.00',
      '41-1101:0.00:6000.00',
      '21-2101:0.00:1190.00',
    ]);
    expect(totals(je)).toEqual({ dr: '25380.00', cr: '25380.00' });
  });

  it('6 งวดค้าง งวดแรกรับบางส่วน 1,000 ก่อนครบกำหนด (2A เท่ายอดที่รับ) ลูกค้าจ่าย 7,062.28 → เงินสด = เงินที่รับ · ล้างส่วนที่ยังไม่ตั้งตามบัญชี · 52-1106 1,032.74', () => {
    const je = buildEarlyPayoffJE({
      depositAccountCode: '11-1201',
      cashReceived: '7062.28',
      // 6 งวดแรกตั้งและรับครบ · งวด 7 ตั้งเท่ายอดที่รับ 1,000 (ex-VAT 934.58 · VAT 65.42 · ดอกเบี้ย 329.85)
      ledger: ledger({
        gross: '7565.46',
        vatReceivable: '529.56',
        deferredInterest: '2670.15',
        deferredVat: '529.56',
      }),
      discountPercent: '50',
    });
    expect(linesOf(je)).toEqual([
      '11-1201:7062.28:0.00',
      '11-2106:2670.15:0.00',
      '21-2102:529.56:0.00',
      '52-1106:1032.74:0.00',
      '11-2101:0.00:7565.46',
      '11-2105:0.00:529.56',
      '41-1101:0.00:2670.15',
      '21-2101:0.00:529.56',
    ]);
    expect(totals(je)).toEqual({ dr: '11294.73', cr: '11294.73' });
  });

  it('ข้อ 5.1: งวด 1–4 ตั้งลูกหนี้แล้วค้าง (งวด 1 รับบางส่วน 500) → Cr 11-2103 ตามยอดค้างจริง 5,563.32 · ดอกเบี้ย/ภาษีรับรู้เฉพาะ 8 งวดที่ยังไม่ถึงกำหนด · 52-1106 เกินฐานข้อ 5.2 (50% × 4,000.00) อยู่ 766.37', () => {
    const je = buildEarlyPayoffJE({
      depositAccountCode: '11-1201',
      cashReceived: '14923.63',
      ledger: ledger({
        gross: '11333.36',
        accrued: '5563.32',
        vatReceivable: '793.32',
        deferredInterest: '4000.00',
        deferredVat: '793.32',
      }),
      discountPercent: '50',
    });
    expect(linesOf(je)).toEqual([
      '11-1201:14923.63:0.00',
      '11-2106:4000.00:0.00',
      '21-2102:793.32:0.00',
      '52-1106:2766.37:0.00',
      '11-2103:0.00:5563.32',
      '11-2101:0.00:11333.36',
      '11-2105:0.00:793.32',
      '41-1101:0.00:4000.00',
      '21-2101:0.00:793.32',
    ]);
    expect(totals(je)).toEqual({ dr: '22483.32', cr: '22483.32' });
    // ส่วนลดบนจอคิดจากทุกงวดค้าง (รวม 4 งวดที่ตั้งลูกหนี้แล้ว) ⇒ 2,766.37 − ฐานข้อ 5.2 2,000.00 = 766.37 (ถ1)
    expect(je.deferredInterestDiscountBase.toFixed(2)).toBe('2000.00');
    expect(je.discountBeyondDeferredBase.toFixed(2)).toBe('766.37');
  });

  it('ข้อ 5.2 เทียบ 5.3: 4 งวดตั้งลูกหนี้แล้วค้าง + 4 งวดยังไม่ถึงกำหนด ลูกค้าจ่าย 10,126.65 → 52-1106 2,000.03 · ฐานข้อ 5.2 1,000.00 (50% × ดอกเบี้ย 4 งวด 2,000.00) · เกิน 1,000.03', () => {
    const je = buildEarlyPayoffJE({
      depositAccountCode: '11-1201',
      cashReceived: '10126.65',
      // 4 งวดแรกตั้งและรับครบ · งวด 5–8 ตั้งลูกหนี้แล้วค้าง (4 × 1,515.83) · งวด 9–12 ยังไม่ถึงกำหนด (งวด 12 ถือเศษ)
      ledger: ledger({
        gross: '5666.72',
        accrued: '6063.32',
        vatReceivable: '396.64',
        deferredInterest: '2000.00',
        deferredVat: '396.64',
      }),
      discountPercent: '50',
    });
    expect(je.receivableCleared.toFixed(2)).toBe('12126.68');
    expect(je.discount.toFixed(2)).toBe('2000.03');
    expect(je.deferredInterestDiscountBase.toFixed(2)).toBe('1000.00');
    expect(je.discountBeyondDeferredBase.toFixed(2)).toBe('1000.03');
    expect(totals(je)).toEqual({ dr: '14523.32', cr: '14523.32' });
  });

  it('ข้อ 5.2: งวดที่ตั้งแล้วค้าง 9 งวด เหลือยังไม่ถึงกำหนด 3 งวด → 52-1106 3,000.02 มากกว่าดอกเบี้ยที่ยังไม่รับรู้ทั้งก้อน (1,500.00) · เกินฐานข้อ 5.2 (750.00) อยู่ 2,250.02 (ลงทั้งก้อนตามข้อ 5.3 · บอกยอดที่เกินไว้)', () => {
    const je = buildEarlyPayoffJE({
      depositAccountCode: '11-1201',
      cashReceived: '15189.98',
      ledger: ledger({
        gross: '4250.06',
        accrued: '13642.47',
        vatReceivable: '297.47',
        deferredInterest: '1500.00',
        deferredVat: '297.47',
      }),
      discountPercent: '50',
    });
    expect(je.discount.toFixed(2)).toBe('3000.02');
    expect(je.deferredInterestDiscountBase.toFixed(2)).toBe('750.00');
    expect(je.discountBeyondDeferredBase.toFixed(2)).toBe('2250.02');
    expect(totals(je)).toEqual({ dr: '19987.47', cr: '19987.47' });
  });

  it('ข้อ 5.1: งวดที่เหลือตั้งลูกหนี้ครบทุกงวดแล้ว (11-2103 18,190.00 · ไม่มีส่วนที่ยังไม่ถึงกำหนด) → ไม่มีบรรทัด 11-2106 / 21-2102 / 41-1101 / 21-2101 · ไม่รับรู้ดอกเบี้ยหรือภาษีขายซ้ำ', () => {
    const je = buildEarlyPayoffJE({
      depositAccountCode: '11-1201',
      cashReceived: '15189.98',
      ledger: ledger({
        gross: '0.00',
        accrued: '18190.00',
        vatReceivable: '0.00',
        deferredInterest: '0.00',
        deferredVat: '0.00',
      }),
      discountPercent: '50',
    });
    expect(linesOf(je)).toEqual([
      '11-1201:15189.98:0.00',
      '52-1106:3000.02:0.00',
      '11-2103:0.00:18190.00',
    ]);
    expect(je.deferredInterest.toFixed(2)).toBe('0.00');
    expect(je.deferredInterestDiscountBase.toFixed(2)).toBe('0.00');
    expect(je.discountBeyondDeferredBase.toFixed(2)).toBe('3000.02');
    expect(je.ledger.accrued.toFixed(2)).toBe('18190.00');
  });

  it('จ่ายงวด 1 ในวันครบกำหนดก่อนรอบกลางคืนตั้งลูกหนี้งวด (11-2103 ติดลบ 1,515.83) → Dr 11-2103 1,515.83 · ล้าง 11-2101 ทั้งก้อน · รับรู้ดอกเบี้ย 6,000.00 ครบ', () => {
    const je = buildEarlyPayoffJE({
      depositAccountCode: '11-1201',
      cashReceived: '13924.15',
      ledger: ledger({
        gross: '17000.00',
        accrued: '-1515.83',
        vatReceivable: '1190.00',
        deferredInterest: '6000.00',
        deferredVat: '1190.00',
      }),
      discountPercent: '50',
    });
    expect(linesOf(je)).toEqual([
      '11-1201:13924.15:0.00',
      '11-2106:6000.00:0.00',
      '21-2102:1190.00:0.00',
      '52-1106:2750.02:0.00',
      '11-2103:1515.83:0.00',
      '11-2101:0.00:17000.00',
      '11-2105:0.00:1190.00',
      '41-1101:0.00:6000.00',
      '21-2101:0.00:1190.00',
    ]);
    expect(totals(je)).toEqual({ dr: '25380.00', cr: '25380.00' });
  });

  it('ค่าปรับ 100 + เงินเกินของลูกค้า 300 → Cr 42-1103 100.00 (เงินสดรวมค่าปรับ) · Dr 21-5101 300.00 แทนเงินสด', () => {
    const je = buildEarlyPayoffJE({
      depositAccountCode: '11-1201',
      cashReceived: '15130.17',
      ledger: opened,
      unpaidLateFees: '100.00',
      creditRelief: '300.00',
      discountPercent: '50',
    });
    expect(linesOf(je)).toEqual([
      '11-1201:15130.17:0.00',
      '11-2106:6000.00:0.00',
      '21-2102:1190.00:0.00',
      '52-1106:2859.83:0.00',
      '21-5101:300.00:0.00',
      '11-2101:0.00:17000.00',
      '11-2105:0.00:1190.00',
      '41-1101:0.00:6000.00',
      '21-2101:0.00:1190.00',
      '42-1103:0.00:100.00',
    ]);
    expect(totals(je)).toEqual({ dr: '25480.00', cr: '25480.00' });
  });

  it('ส่วนลด 0% ลูกค้าจ่ายมากกว่าลูกหนี้ตามบัญชี 0.08 (ค่างวดปัดขึ้น) → ไม่มี 52-1106 · Cr 53-1503 0.08', () => {
    const je = buildEarlyPayoffJE({
      depositAccountCode: '11-1201',
      cashReceived: '18190.08',
      ledger: opened,
      discountPercent: '0',
    });
    expect(linesOf(je)).toEqual([
      '11-1201:18190.08:0.00',
      '11-2106:6000.00:0.00',
      '21-2102:1190.00:0.00',
      '11-2101:0.00:17000.00',
      '11-2105:0.00:1190.00',
      '41-1101:0.00:6000.00',
      '21-2101:0.00:1190.00',
      '53-1503:0.00:0.08',
    ]);
    expect(je.roundingGain.toFixed(2)).toBe('0.08');
    expect(je.discount.toFixed(2)).toBe('0.00');
    expect(totals(je)).toEqual({ dr: '25380.08', cr: '25380.08' });
  });

  it('เงินที่รับ + เงินของลูกค้าเกินลูกหนี้ตามบัญชี: พอดี 1.00 → Cr 53-1503 1.00 · เกิน 1.01 → excessReceived 1.01 ไม่มีบรรทัดรับ (ผู้เรียกปฏิเสธ)', () => {
    const atLimit = buildEarlyPayoffJE({
      depositAccountCode: '11-1201',
      cashReceived: '18191.00',
      ledger: opened,
      discountPercent: '0',
    });
    expect(atLimit.roundingGain.toFixed(2)).toBe('1.00');
    expect(atLimit.excessReceived.toFixed(2)).toBe('0.00');
    expect(totals(atLimit)).toEqual({ dr: '25381.00', cr: '25381.00' });

    const over = buildEarlyPayoffJE({
      depositAccountCode: '11-1201',
      cashReceived: '17891.01',
      ledger: opened,
      creditRelief: '300.00',
      discountPercent: '0',
    });
    expect(over.excessReceived.toFixed(2)).toBe('1.01');
    expect(over.roundingGain.toFixed(2)).toBe('0.00');
    expect(over.discount.toFixed(2)).toBe('0.00');
    expect(over.lines.map((l) => l.accountCode)).not.toContain('53-1503');
    expect(over.lines.map((l) => l.accountCode)).not.toContain('52-1106');
    expect(totals(over)).toEqual({ dr: '25381.01', cr: '25380.00' });
  });

  it('ยอดเงินที่ส่งเข้าติดลบหรือเกิน 2 ตำแหน่ง → throw (ห้ามลงยอดที่ฐานข้อมูลจะปัดเพี้ยน)', () => {
    expect(() =>
      buildEarlyPayoffJE({
        depositAccountCode: '11-1201',
        cashReceived: '-1',
        ledger: opened,
        discountPercent: '50',
      }),
    ).toThrow('cashReceived must be a non-negative amount with at most 2 decimals');
    expect(() =>
      buildEarlyPayoffJE({
        depositAccountCode: '11-1201',
        cashReceived: '15189.98',
        ledger: opened,
        parkRelief: '354.005',
        discountPercent: '50',
      }),
    ).toThrow('parkRelief must be a non-negative amount with at most 2 decimals');
  });

  // PR5ข — เจ้าของเคาะ 01/10/2569: ปิดยอดหักเงินรับล่วงหน้าถังรวมแบบเดียวกับเงินพักค่าปรับดิว
  it('PR5ข ตัวอย่างที่เจ้าของเคาะ: เครดิต 300 + ถังรวม 500 ลูกค้าจ่าย 14,612.63 → Dr 21-1103 500.00 (บรรทัดถังรวม) · Dr 21-5101 300.00 · 52-1106 2,777.37', () => {
    const je = buildEarlyPayoffJE({
      depositAccountCode: '11-1201',
      cashReceived: '14612.63',
      ledger: opened,
      advanceRelief: '500.00',
      creditRelief: '300.00',
      discountPercent: '50',
    });
    expect(linesOf(je)).toEqual([
      '11-1201:14612.63:0.00',
      '11-2106:6000.00:0.00',
      '21-2102:1190.00:0.00',
      '52-1106:2777.37:0.00',
      '21-1103:500.00:0.00',
      '21-5101:300.00:0.00',
      '11-2101:0.00:17000.00',
      '11-2105:0.00:1190.00',
      '41-1101:0.00:6000.00',
      '21-2101:0.00:1190.00',
    ]);
    expect(totals(je)).toEqual({ dr: '25380.00', cr: '25380.00' });
    expect(je.advanceRelief.toFixed(2)).toBe('500.00');
    expect(je.parkRelief.toFixed(2)).toBe('0.00');
    // บรรทัดถังรวมมีเครื่องหมาย ให้ผู้เรียกไม่ใส่คำอธิบายของเงินพักค่าปรับดิว
    expect(je.lines.find((l) => l.accountCode === '21-1103')!.generalAdvance).toBe(true);
    // ส่วนลดบนจอ 2,777.33 + เศษงวดสุดท้าย 0.04 (ก่อน PR5ข: ลูกค้าจ่าย 15,030.17 · 52-1106 2,859.83 · 500 ค้างใน 21-1103)
    expect(je.discount.toFixed(2)).toBe('2777.37');
  });

  it('PR5ข เงินพัก 354 + ถังรวม 500 → Dr 21-1103 สองบรรทัด เงินพักก่อน (ไม่มีเครื่องหมาย) แล้วถังรวม · 52-1106 2,859.17 · ยอดถังรวมติดลบ → throw', () => {
    const je = buildEarlyPayoffJE({
      depositAccountCode: '11-1201',
      // computePayoffQuote (ถังพัก 354 · ถังรวม 500 · ส่วนลด 50%): ยอดปิด 14,476.83 · ส่วนลด 2,859.13
      cashReceived: '14476.83',
      ledger: opened,
      parkRelief: '354.00',
      advanceRelief: '500.00',
      discountPercent: '50',
    });
    expect(
      je.lines.map((l) => `${l.accountCode}:${l.dr.toFixed(2)}:${l.generalAdvance ?? false}`),
    ).toEqual([
      '11-1201:14476.83:false',
      '11-2106:6000.00:false',
      '21-2102:1190.00:false',
      '52-1106:2859.17:false',
      '21-1103:354.00:false',
      '21-1103:500.00:true',
      '11-2101:0.00:false',
      '11-2105:0.00:false',
      '41-1101:0.00:false',
      '21-2101:0.00:false',
    ]);
    expect(totals(je)).toEqual({ dr: '25380.00', cr: '25380.00' });
    expect(() =>
      buildEarlyPayoffJE({
        depositAccountCode: '11-1201',
        cashReceived: '14476.83',
        ledger: opened,
        advanceRelief: '-500',
        discountPercent: '50',
      }),
    ).toThrow('advanceRelief must be a non-negative amount with at most 2 decimals');
  });
});

describe('readEarlyPayoffLedger / buildEarlyPayoffJournal — อ่านยอดในบัญชีของสัญญา (PR5)', () => {
  const contract = (cols: {
    advanceBalance?: string;
    rescheduleAdvanceBalance?: string;
    creditBalance?: string;
  }) => ({
    id: 'contract-jp4-ledger',
    contractNumber: 'CT-JP4-LEDGER',
    advanceBalance: new Decimal(cols.advanceBalance ?? '0'),
    rescheduleAdvanceBalance: new Decimal(cols.rescheduleAdvanceBalance ?? '0'),
    creditBalance: new Decimal(cols.creditBalance ?? '0'),
  });

  it('อ่าน 11-2101 / 11-2103 / 11-2105 ด้าน Dr และ 11-2106 / 21-2102 ด้าน Cr ของสัญญาด้วย client ที่ส่งมา', async () => {
    const findMany = jest.fn(
      ledgerLines({
        '11-2101': '11333.36',
        '11-2103': '5563.32',
        '11-2105': '793.32',
        '11-2106': '4000.00',
        '21-2102': '793.32',
      }),
    );
    const l = await readEarlyPayoffLedger({ journalLine: { findMany } } as never, 'contract-x');
    expect(
      [l.gross, l.accrued, l.vatReceivable, l.deferredInterest, l.deferredVat].map((v) =>
        v.toFixed(2),
      ),
    ).toEqual(['11333.36', '5563.32', '793.32', '4000.00', '793.32']);
    expect(findMany.mock.calls.map((c) => c[0].where.accountCode)).toEqual([
      '11-2101',
      '11-2103',
      '11-2105',
      '11-2106',
      '21-2102',
    ]);
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { journalEntry: { metadata: { path: ['contractId'], equals: 'contract-x' } } },
    });
  });

  it('PR5ข: เงินพัก 1,044 + ถังรวม 500 + เครดิต 300 ที่ยอดปิดหักให้ทั้งหมด → Dr 21-1103 สองบรรทัด (เงินพัก 1,044.00 · ถังรวม 500.00) · Dr 21-5101 300.00 · คอลัมน์ตรงบัญชีและ 52-1106 ต่างจากส่วนลดบนจอ 0.04 → ไม่มีสัญญาณ', async () => {
    const findMany = jest.fn(
      ledgerLines({
        '11-2101': '17000.00',
        '11-2105': '1190.00',
        '11-2106': '6000.00',
        '21-2102': '1190.00',
        '21-1103': '1544.00',
        '21-5101': '300.00',
      }),
    );
    const je = await buildEarlyPayoffJournal({ journalLine: { findMany } } as never, {
      contract: contract({
        advanceBalance: '500',
        rescheduleAdvanceBalance: '1044',
        creditBalance: '300',
      }),
      depositAccountCode: '11-1201',
      // computePayoffQuote (เครดิต 300 · ถังพัก 1,044 · ถังรวม 500 · ส่วนลด 50%): ยอดปิด 13,740.81 · ส่วนลด 2,605.15
      // (ก่อน PR5ข ถังรวมไม่ถูกหัก: ยอดปิด 14,158.35 · ส่วนลด 2,687.61 · 500 ค้างใน 21-1103)
      cashReceived: '13740.81',
      unpaidLateFees: '0',
      parkReliefApplied: '1044.00',
      advanceReliefApplied: '500.00',
      quoteDiscountAmount: '2605.15',
      discountPercent: '50',
    });
    expect(je.parkRelief.toFixed(2)).toBe('1044.00');
    expect(je.advanceRelief.toFixed(2)).toBe('500.00');
    expect(je.creditRelief.toFixed(2)).toBe('300.00');
    expect(
      je.lines
        .filter((l) => l.accountCode === '21-1103')
        .map((l) => [l.dr.toFixed(2), l.generalAdvance ?? false]),
    ).toEqual([
      ['1044.00', false],
      ['500.00', true],
    ]);
    // 18,190.00 − 13,740.81 − 1,044.00 − 500.00 − 300.00 (ส่วนลดบนจอ 2,605.15 + เศษงวดสุดท้าย 0.04)
    expect(je.discount.toFixed(2)).toBe('2605.19');
    expect(je.warnings).toEqual([]);
  });

  it('เงินเกินของลูกค้าที่หัก = min(คอลัมน์ที่ยอดปิดหักให้, ยอด 21-5101 ในบัญชี): บัญชี 2,000 คอลัมน์ 0 → ไม่หัก (2,000 ยังเป็นเงินของลูกค้า) + สัญญาณเตือน · คอลัมน์ 300 → หัก 300', async () => {
    const ledger = {
      '11-2101': '17000.00',
      '11-2105': '1190.00',
      '11-2106': '6000.00',
      '21-2102': '1190.00',
      '21-5101': '2000.00',
    };
    const notDeducted = await buildEarlyPayoffJournal(
      { journalLine: { findMany: jest.fn(ledgerLines(ledger)) } } as never,
      {
        contract: contract({}),
        depositAccountCode: '11-1201',
        cashReceived: '15189.98',
        unpaidLateFees: '0',
        parkReliefApplied: '0',
        advanceReliefApplied: '0',
        quoteDiscountAmount: '2999.98',
        discountPercent: '50',
      },
    );
    expect(notDeducted.creditRelief.toFixed(2)).toBe('0.00');
    expect(notDeducted.lines.map((l) => l.accountCode)).not.toContain('21-5101');
    expect(notDeducted.discount.toFixed(2)).toBe('3000.02');
    expect(notDeducted.excessReceived.toFixed(2)).toBe('0.00');
    expect(notDeducted.warnings.map((w) => w.tags.action)).toEqual([
      'close-advance-ledger-mismatch',
    ]);
    expect(notDeducted.warnings[0].extra).toMatchObject({
      ledger21_5101: '2000.00',
      creditBalance: '0.00',
    });

    // computePayoffQuote (เครดิต 300): ยอดปิด 15,030.17 · ส่วนลด 2,859.79
    const partly = await buildEarlyPayoffJournal(
      { journalLine: { findMany: jest.fn(ledgerLines(ledger)) } } as never,
      {
        contract: contract({ creditBalance: '300' }),
        depositAccountCode: '11-1201',
        cashReceived: '15030.17',
        unpaidLateFees: '0',
        parkReliefApplied: '0',
        advanceReliefApplied: '0',
        quoteDiscountAmount: '2859.79',
        discountPercent: '50',
      },
    );
    expect(partly.creditRelief.toFixed(2)).toBe('300.00');
    expect(partly.discount.toFixed(2)).toBe('2859.83');
    expect(partly.warnings.map((w) => w.tags.action)).toEqual(['close-advance-ledger-mismatch']);
  });

  it('52-1106 ต่างจากส่วนลดบนหน้าจอเกิน 1.00 (ยอดในบัญชีมากกว่ายอดค้างตามงวด) → สัญญาณเตือน early-payoff-discount-vs-quote · ต่างไม่เกิน 1.00 → ไม่มี', async () => {
    const opened = {
      '11-2101': '17000.00',
      '11-2105': '1190.00',
      '11-2106': '6000.00',
      '21-2102': '1190.00',
    };
    const input = {
      contract: contract({}),
      depositAccountCode: '11-1201',
      cashReceived: '15189.98',
      unpaidLateFees: '0',
      parkReliefApplied: '0',
      advanceReliefApplied: '0',
      quoteDiscountAmount: '2999.98',
      discountPercent: '50',
    };
    // ปกติ: 3,000.02 เทียบจอ 2,999.98 (เศษงวดสุดท้าย 0.04)
    const normal = await buildEarlyPayoffJournal(
      { journalLine: { findMany: jest.fn(ledgerLines(opened)) } } as never,
      input,
    );
    expect(normal.warnings).toEqual([]);

    // ลูกหนี้ในบัญชีเกินยอดค้างตามงวด 1,515.83 (เช่นแถวงวดถูกตั้ง PAID โดยไม่มีรายการรับชำระ)
    const anomaly = await buildEarlyPayoffJournal(
      {
        journalLine: {
          findMany: jest.fn(
            ledgerLines({
              ...opened,
              '11-2101': '18416.66',
              '11-2105': '1289.17',
              '11-2106': '6500.00',
              '21-2102': '1289.17',
            }),
          ),
        },
      } as never,
      input,
    );
    expect(anomaly.discount.toFixed(2)).toBe('4515.85');
    expect(anomaly.warnings).toHaveLength(1);
    expect(anomaly.warnings[0]).toMatchObject({
      message: '[early-payoff] 52-1106 differs from the payoff-screen discount by more than 1.00',
      tags: { module: 'journal', action: 'early-payoff-discount-vs-quote', flow: 'early-payoff' },
      extra: {
        contractId: 'contract-jp4-ledger',
        discount: '4515.85',
        quoteDiscountAmount: '2999.98',
        difference: '1515.87',
      },
    });
  });

  it('ยอด 21-1103 ในบัญชีน้อยกว่าคอลัมน์ถังพัก → หักเงินพักเท่ายอดในบัญชี 200 · ส่วนที่ขาด 154 ไหลเข้า 52-1106 → สัญญาณเตือนสองตัว flow early-payoff (ผู้เรียกส่งหลัง commit)', async () => {
    const findMany = jest.fn(
      ledgerLines({
        '11-2101': '17000.00',
        '11-2105': '1190.00',
        '11-2106': '6000.00',
        '21-2102': '1190.00',
        '21-1103': '200.00',
      }),
    );
    const je = await buildEarlyPayoffJournal({ journalLine: { findMany } } as never, {
      contract: contract({ rescheduleAdvanceBalance: '354' }),
      depositAccountCode: '11-1201',
      // computePayoffQuote (ถังพัก 354 · ส่วนลด 50%): ยอดปิด 14,894.37 · ส่วนลด 2,941.59
      cashReceived: '14894.37',
      unpaidLateFees: '0',
      parkReliefApplied: '354.00',
      advanceReliefApplied: '0',
      quoteDiscountAmount: '2941.59',
      discountPercent: '50',
    });
    expect(je.parkRelief.toFixed(2)).toBe('200.00');
    // 18,190.00 − 14,894.37 − 200.00 = 3,095.63 (ส่วนลดบนจอ 2,941.59 + เงินพักที่ไม่มีในบัญชี 154.00 + เศษ 0.04)
    expect(je.discount.toFixed(2)).toBe('3095.63');
    expect(je.warnings).toHaveLength(2);
    expect(je.warnings[1].tags.action).toBe('early-payoff-discount-vs-quote');
    expect(je.warnings[1].extra).toMatchObject({ difference: '154.04' });
    expect(je.warnings[0].tags).toEqual({
      module: 'journal',
      action: 'close-advance-ledger-mismatch',
      flow: 'early-payoff',
    });
    expect(je.warnings[0].extra).toMatchObject({
      contractId: 'contract-jp4-ledger',
      ledger21_1103: '200.00',
      rescheduleAdvanceBalance: '354.00',
    });
  });

  // PR5ข — ถังรวมที่หัก = min(ยอดที่ยอดปิดหักให้, คอลัมน์ advanceBalance, ยอด 21-1103 ในบัญชี − เงินพักที่หัก)
  it('PR5ข ถังรวมที่หัก = min(ยอดที่ยอดปิดหักให้, คอลัมน์, ยอด 21-1103 ในบัญชีที่เหลือหลังเงินพัก): บัญชีครบ 854 → 354 + 500 · บัญชีมี 600 → เงินพัก 354 + ถังรวม 246 · ส่วนที่ขาด 254 ไหลเข้า 52-1106 → สัญญาณเตือนสองตัว', async () => {
    const opened = {
      '11-2101': '17000.00',
      '11-2105': '1190.00',
      '11-2106': '6000.00',
      '21-2102': '1190.00',
    };
    const input = {
      contract: contract({ rescheduleAdvanceBalance: '354', advanceBalance: '500' }),
      depositAccountCode: '11-1201',
      // computePayoffQuote (ถังพัก 354 · ถังรวม 500 · ส่วนลด 50%): ยอดปิด 14,476.83 · ส่วนลด 2,859.13
      cashReceived: '14476.83',
      unpaidLateFees: '0',
      parkReliefApplied: '354.00',
      advanceReliefApplied: '500.00',
      quoteDiscountAmount: '2859.13',
      discountPercent: '50',
    };
    const full = await buildEarlyPayoffJournal(
      {
        journalLine: { findMany: jest.fn(ledgerLines({ ...opened, '21-1103': '854.00' })) },
      } as never,
      input,
    );
    expect([full.parkRelief.toFixed(2), full.advanceRelief.toFixed(2)]).toEqual([
      '354.00',
      '500.00',
    ]);
    expect(full.discount.toFixed(2)).toBe('2859.17');
    expect(full.warnings).toEqual([]);

    const short = await buildEarlyPayoffJournal(
      {
        journalLine: { findMany: jest.fn(ledgerLines({ ...opened, '21-1103': '600.00' })) },
      } as never,
      input,
    );
    expect([short.parkRelief.toFixed(2), short.advanceRelief.toFixed(2)]).toEqual([
      '354.00',
      '246.00',
    ]);
    // 18,190.00 − 14,476.83 − 354.00 − 246.00 = 3,113.17 (ส่วนลดบนจอ 2,859.13 + ถังรวมที่ไม่มีในบัญชี 254.00 + เศษ 0.04)
    expect(short.discount.toFixed(2)).toBe('3113.17');
    expect(short.warnings.map((w) => w.tags.action)).toEqual([
      'close-advance-ledger-mismatch',
      'early-payoff-discount-vs-quote',
    ]);
    expect(short.warnings[0].extra).toMatchObject({
      ledger21_1103: '600.00',
      advanceBalance: '500.00',
      rescheduleAdvanceBalance: '354.00',
    });
    expect(short.warnings[1].extra).toMatchObject({
      difference: '254.04',
      parkRelief: '354.00',
      advanceRelief: '246.00',
    });
  });

  it('PR5ข ถังรวม 50,000 ใหญ่กว่ายอดค้าง 18,189.96 → ยอดปิด 0.00 · หักเท่าที่ยอดปิดหักให้ 18,189.96 · 31,810.04 ค้างใน 21-1103 (เงินของลูกค้า) · 52-1106 0.04 (เศษงวดสุดท้าย) · ไม่มีสัญญาณ', async () => {
    const je = await buildEarlyPayoffJournal(
      {
        journalLine: {
          findMany: jest.fn(
            ledgerLines({
              '11-2101': '17000.00',
              '11-2105': '1190.00',
              '11-2106': '6000.00',
              '21-2102': '1190.00',
              '21-1103': '50000.00',
            }),
          ),
        },
      } as never,
      {
        contract: contract({ advanceBalance: '50000' }),
        depositAccountCode: '11-1201',
        // computePayoffQuote (ถังรวม 50,000 · ส่วนลด 50%): ยอดค้างหมดด้วยถังรวม → ยอดปิด 0.00 · ส่วนลด 0.00
        cashReceived: '0',
        unpaidLateFees: '0',
        parkReliefApplied: '0',
        advanceReliefApplied: '18189.96',
        quoteDiscountAmount: '0',
        discountPercent: '50',
      },
    );
    expect(je.advanceRelief.toFixed(2)).toBe('18189.96');
    expect(je.discount.toFixed(2)).toBe('0.04');
    expect(je.excessReceived.toFixed(2)).toBe('0.00');
    expect(je.warnings).toEqual([]);
  });
});
