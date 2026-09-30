import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { bangkokStartOfDay } from '../../../utils/date.util';
import { formatDateShort } from '../../../utils/thai-date.util';
import { PaymentReceiptTemplate } from '../../journal/cpa-templates/payment-receipt.template';
import { PaymentJournalPreviewService } from './payment-journal-preview.service';

/**
 * Preview ต้องเท่ากับที่ลงจริง.
 *
 * ตั้งแต่ 2026-09-29 (คำตัดสินฝ่ายบัญชี D2): งวดที่ยังไม่มีรายการ 2A ถูกตั้งลูกหนี้งวดในการบันทึก
 * เดียวกับการรับชำระ เมื่อการรับชำระนั้นทำให้งวดชำระครบ — การบันทึกจึงลง **สองรายการ**: 2A แล้ว 2B (ใบรับชำระ
 * ที่เครดิต 11-2103). Preview แสดงสองบล็อกแยกกัน: `accrual2A` (posted:false) กับ `lines` (2B) —
 * ขาของ 2A (11-2101 / 41-1101 / 11-2106 / 21-2102 / 11-2105 / 21-2101) ต้องไม่ปนเข้าไปใน
 * บล็อกใบรับชำระ (QA #1347 follow-up 2026-07-09 ยังเป็นจริง).
 */
describe('PaymentJournalPreviewService — preview mirrors the save (QA #1347 follow-up)', () => {
  const CONSOLIDATED_ONLY_CODES = ['11-2101', '41-1101', '11-2106', '21-2102', '11-2105', '21-2101'];
  /** สัญญา 17,000/12 งวด: 1,416.66 + VAT 99.17 = 1,515.83 · ดอกเบี้ยงวดละ 500.00 */
  const ACCRUAL_2A_LINES = [
    ['11-2103', '1515.83', '0.00'],
    ['21-2102', '99.17', '0.00'],
    ['11-2106', '500.00', '0.00'],
    ['11-2101', '0.00', '1416.66'],
    ['11-2105', '0.00', '99.17'],
    ['41-1101', '0.00', '500.00'],
    ['21-2101', '0.00', '99.17'],
  ];
  /** ก1: 2A เท่ายอดที่รับ 1,000 ของงวด 1,515.83 (VAT 65.42 · มูลค่า 934.58 · ดอกเบี้ย 329.85) */
  const ACCRUAL_2A_PART_1000 = [
    ['11-2103', '1000.00', '0.00'],
    ['21-2102', '65.42', '0.00'],
    ['11-2106', '329.85', '0.00'],
    ['11-2101', '0.00', '934.58'],
    ['11-2105', '0.00', '65.42'],
    ['41-1101', '0.00', '329.85'],
    ['21-2101', '0.00', '65.42'],
  ];
  /** ก1: ส่วนที่เหลือ 515.83 หลังตั้งไปแล้ว 1,000 */
  const ACCRUAL_2A_REST_515 = [
    ['11-2103', '515.83', '0.00'],
    ['21-2102', '33.75', '0.00'],
    ['11-2106', '170.15', '0.00'],
    ['11-2101', '0.00', '482.08'],
    ['11-2105', '0.00', '33.75'],
    ['41-1101', '0.00', '170.15'],
    ['21-2101', '0.00', '33.75'],
  ];
  type Line = { accountCode: string; debit: string; credit: string; block: string; posted: boolean };
  const triples = (lines: Line[]) => lines.map((l) => [l.accountCode, l.debit, l.credit]);

  function buildService(
    accrualJournalEntryId: string | null,
    dueDate: Date = new Date('2026-06-08'), // past due → BACKFILL classification
    status: string = 'ACTIVE',
    advanceBalance: string = '0', // เครดิตคงเหลือของลูกค้า (เงินรับล่วงหน้า)
    extra: {
      /** ยอดที่ตั้งลูกหนี้งวดไปแล้วของงวด (คอลัมน์ accrued*) */
      accrued?: { amount: string; vat: string; interest: string };
      /** ยอดที่ชำระแล้วบนแถวงวด */
      amountPaid?: string;
      /** ยอด Cr 11-2103 ของใบรับชำระก่อนหน้า (reconstructPriorCleared) */
      priorReceipts?: string[];
    } = {},
  ) {
    const contract = {
      id: 'c1',
      status,
      totalMonths: 12,
      financedAmount: '10000',
      storeCommission: '1000',
      interestTotal: '6000',
      monthlyPayment: '1515.83',
      vatAmount: '1190',
      advanceBalance,
    };
    const prisma = {
      installmentSchedule: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'inst-1',
          contractId: 'c1',
          installmentNo: 1,
          accrualJournalEntryId,
          dueDate,
          // คอลัมน์ยอดสะสมมีทุกแถวจริง (ค่าเริ่มต้น 0) — accruedSoFarOf ไม่อ่านช่องที่หายเป็น 0
          accruedAmount: extra.accrued?.amount ?? '0',
          accruedVat: extra.accrued?.vat ?? '0',
          accruedInterest: extra.accrued?.interest ?? '0',
          contract,
        }),
      },
      payment: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ amountDue: '1515.83', amountPaid: extra.amountPaid ?? '0' }),
      },
      journalEntry: {
        findMany: jest.fn().mockResolvedValue(
          (extra.priorReceipts ?? []).map((credit) => ({
            metadata: { tag: 'receipt', installmentScheduleId: 'inst-1' },
            lines: [{ accountCode: '11-2103', debit: '0', credit }],
          })),
        ),
      },
      chartOfAccount: { findMany: jest.fn().mockResolvedValue([]) },
    } as never;
    return new PaymentJournalPreviewService(prisma, undefined);
  }

  it('non-accrued installment: live lines credit 11-2103 (what the save posts), no consolidated legs', async () => {
    const svc = buildService(null);

    const preview = await svc.previewJournal({
      contractId: 'c1',
      installmentNo: 1,
      amountReceived: 1515.83,
      depositAccountCode: '11-1101',
    } as never);

    const codes = preview.lines.map((l: { accountCode: string }) => l.accountCode);
    expect(codes).toContain('11-2103');
    for (const consolidatedCode of CONSOLIDATED_ONLY_CODES) {
      expect(codes).not.toContain(consolidatedCode);
    }
    // ยอด Cr 11-2103 = ค่างวดเต็ม (mirror PaymentReceiptTemplate)
    const line2103 = preview.lines.find((l: { accountCode: string }) => l.accountCode === '11-2103');
    expect(line2103?.credit).toBe('1515.83');
    expect(preview.isBalanced).toBe(true);
    // งวดถึงวันครบกำหนดแล้วแต่ยังไม่ตั้งลูกหนี้ → 2A จะลงวันครบกำหนด
    expect(preview.accrualMode).toBe('CONSOLIDATED_BACKFILL');
    expect(preview.accrualPostedAt).toBe(new Date('2026-06-08').toISOString());
    // บล็อก 2A ที่จะลงพร้อมการรับชำระนี้ — 7 บรรทัดจากตัวสร้างเดียวกับ template
    expect(triples(preview.accrual2A!.lines as Line[])).toEqual(ACCRUAL_2A_LINES);
    expect((preview.accrual2A!.lines as Line[]).every((l) => l.block === '2A' && !l.posted)).toBe(true);
    expect(preview.subtotals['2A']).toEqual({ debit: '2115.00', credit: '2115.00', balanced: true });
  });

  it('รับเงินก่อนครบกำหนด (ส่ง paidDate): 2A ลงวันที่รับเงิน → PAYING_AHEAD + accrualPostedAt = วันรับเงิน', async () => {
    const svc = buildService(null);

    const preview = await svc.previewJournal({
      contractId: 'c1',
      installmentNo: 1,
      amountReceived: 1515.83,
      depositAccountCode: '11-1101',
      paidDate: '2026-06-01', // ก่อนครบกำหนด 8 มิ.ย.
    } as never);

    expect(preview.accrualMode).toBe('CONSOLIDATED_PAYING_AHEAD');
    expect(preview.accrualPostedAt).toBe(new Date('2026-06-01').toISOString());
    expect(triples(preview.accrual2A!.lines as Line[])).toEqual(ACCRUAL_2A_LINES);
  });

  it('จ่ายบางส่วน 1,000 ของงวดที่ยังไม่ถึงกำหนด (ก1): ไม่มีด่านแล้ว — แสดง 2A เท่ายอดที่รับ ลงวันที่รับเงิน', async () => {
    const futureDue = new Date(Date.now() + 30 * 86_400_000);
    const svc = buildService(null, futureDue);
    const paidDate = new Date().toISOString().slice(0, 10);

    const preview = await svc.previewJournal({
      contractId: 'c1',
      installmentNo: 1,
      amountReceived: 1000,
      depositAccountCode: '11-1101',
      case: 'PARTIAL',
      paidDate,
    } as never);

    expect(triples(preview.lines as Line[])).toEqual([
      ['11-1101', '1000.00', '0.00'],
      ['11-2103', '0.00', '1000.00'],
    ]);
    expect(triples(preview.accrual2A!.lines as Line[])).toEqual(ACCRUAL_2A_PART_1000);
    expect((preview.accrual2A!.lines as Line[]).every((l) => l.block === '2A' && !l.posted)).toBe(true);
    expect(preview.subtotals['2A']).toEqual({ debit: '1395.27', credit: '1395.27', balanced: true });
    expect(preview.accrualMode).toBe('CONSOLIDATED_PAYING_AHEAD');
    expect(preview.accrualPostedAt).toBe(new Date(paidDate).toISOString());
    expect(preview.accrualPortion).toBe('PARTIAL');
    expect(preview.accrualAmount).toBe('1000.00');
    expect(preview.accruedBefore).toBe('0.00');
    expect(preview.isBalanced).toBe(true);
  });

  it('ก1: ใบที่ทำให้งวดชำระครบหลังตั้งไปแล้ว 1,000 → แสดง 2A ส่วนที่เหลือ 515.83', async () => {
    const futureDue = new Date(Date.now() + 30 * 86_400_000);
    const svc = buildService(null, futureDue, 'ACTIVE', '0', {
      accrued: { amount: '1000.00', vat: '65.42', interest: '329.85' },
      amountPaid: '1000.00',
      priorReceipts: ['1000.00'],
    });

    const preview = await svc.previewJournal({
      contractId: 'c1',
      installmentNo: 1,
      amountReceived: 515.83,
      depositAccountCode: '11-1101',
    } as never);

    expect(triples(preview.lines as Line[])).toEqual([
      ['11-1101', '515.83', '0.00'],
      ['11-2103', '0.00', '515.83'],
    ]);
    expect(triples(preview.accrual2A!.lines as Line[])).toEqual(ACCRUAL_2A_REST_515);
    expect(preview.accrualPortion).toBe('REMAINDER');
    expect(preview.accrualAmount).toBe('515.83');
    expect(preview.accruedBefore).toBe('1000.00');
  });

  it('ก1: รับบางส่วนครั้งที่สอง (ตั้งไปแล้ว 500) → แสดง 2A เท่ายอดที่รับ 600 ตามยอดสะสม', async () => {
    const futureDue = new Date(Date.now() + 30 * 86_400_000);
    const svc = buildService(null, futureDue, 'ACTIVE', '0', {
      accrued: { amount: '500.00', vat: '32.71', interest: '164.93' },
      amountPaid: '500.00',
      priorReceipts: ['500.00'],
    });

    const preview = await svc.previewJournal({
      contractId: 'c1',
      installmentNo: 1,
      amountReceived: 600,
      depositAccountCode: '11-1101',
      case: 'PARTIAL',
    } as never);

    expect(triples(preview.accrual2A!.lines as Line[])).toEqual([
      ['11-2103', '600.00', '0.00'],
      ['21-2102', '39.25', '0.00'],
      ['11-2106', '197.91', '0.00'],
      ['11-2101', '0.00', '560.75'],
      ['11-2105', '0.00', '39.25'],
      ['41-1101', '0.00', '197.91'],
      ['21-2101', '0.00', '39.25'],
    ]);
    expect(preview.accrualPortion).toBe('PARTIAL');
    expect(preview.accruedBefore).toBe('500.00');
  });

  it('จ่ายบางส่วนย้อนวันที่ (paidDate ก่อนวันครบกำหนด) ขณะวันนี้ถึงวันครบกำหนดแล้ว → ตัดสินตามวันที่รับเงินแบบเดียวกับการบันทึก: ไม่มีด่าน แสดง 2A บางส่วน', async () => {
    const dueToday = bangkokStartOfDay(new Date());
    const svc = buildService(null, dueToday);
    const twoDaysBefore = new Date(dueToday.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);

    const preview = await svc.previewJournal({
      contractId: 'c1',
      installmentNo: 1,
      amountReceived: 1000,
      depositAccountCode: '11-1101',
      case: 'PARTIAL',
      paidDate: twoDaysBefore,
    } as never);

    expect(triples(preview.accrual2A!.lines as Line[])).toEqual(ACCRUAL_2A_PART_1000);
    expect(preview.accrualMode).toBe('CONSOLIDATED_PAYING_AHEAD');
  });

  it('จ่ายบางส่วนของงวดที่ถึงกำหนดแล้วแต่ยังไม่ตั้งลูกหนี้: ยังถูกปฏิเสธ — ข้อความบอกให้รับเต็มงวดหรือติดต่อฝ่ายบัญชี', async () => {
    const svc = buildService(null); // ครบกำหนด 8 มิ.ย. 2569 (ผ่านมาแล้ว)

    const err = await svc
      .previewJournal({
        contractId: 'c1',
        installmentNo: 1,
        amountReceived: 1000,
        depositAccountCode: '11-1101',
        case: 'PARTIAL',
      } as never)
      .catch((e: Error) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toBe(
      'งวดนี้ถึงวันครบกำหนดแล้ว (08/06/2569) แต่ระบบยังไม่ได้ตั้งลูกหนี้งวด — ' +
        'หน้านี้จึงยังบันทึกรับชำระบางส่วนไม่ได้ กรุณารับชำระเต็มงวด หรือติดต่อฝ่ายบัญชีให้ตรวจสอบงวดนี้ก่อนรับชำระบางส่วน',
    );
    expect((err as Error).message).not.toContain('00:01');
  });

  it('ปรับดิวแบบชำระทั้งก้อน (หน้าปรับดิวขอ preview ด้วย case OVERPAY_ADVANCE) ของงวดที่ยังไม่ตั้งลูกหนี้ → ได้บล็อก 2A ที่จะลงตอนยืนยัน', async () => {
    const futureDue = new Date(Date.now() + 30 * 86_400_000);
    const svc = buildService(null, futureDue);
    const before = Date.now();

    // ค่างวด 1,515.83 + ค่าธรรมเนียมปรับดิว 354.00 = 1,869.83 · หน้าปรับดิวไม่ส่งวันที่รับเงิน (= ตอนนี้)
    const preview = await svc.previewJournal({
      contractId: 'c1',
      installmentNo: 1,
      amountReceived: 1869.83,
      depositAccountCode: '11-1101',
      lateFee: 0,
      case: 'OVERPAY_ADVANCE',
    } as never);

    expect(triples(preview.accrual2A!.lines as Line[])).toEqual(ACCRUAL_2A_LINES);
    expect((preview.accrual2A!.lines as Line[]).every((l) => l.block === '2A' && !l.posted)).toBe(true);
    expect(triples(preview.lines as Line[])).toEqual([
      ['11-1101', '1869.83', '0.00'],
      ['11-2103', '0.00', '1515.83'],
      ['21-1103', '0.00', '354.00'],
    ]);
    expect(preview.isBalanced).toBe(true);
    expect(preview.accrualMode).toBe('CONSOLIDATED_PAYING_AHEAD');
    const postedAt = new Date(preview.accrualPostedAt!).getTime();
    expect(postedAt).toBeGreaterThanOrEqual(before);
    expect(postedAt).toBeLessThanOrEqual(Date.now());
  });

  it('สัญญาที่ถูกบอกเลิกแล้ว: ไม่แสดงบล็อก 2A — การรับเงินของสัญญาแบบนี้ไม่ตั้งลูกหนี้งวด', async () => {
    const futureDue = new Date(Date.now() + 30 * 86_400_000);
    const svc = buildService(null, futureDue, 'TERMINATED');

    const preview = await svc.previewJournal({
      contractId: 'c1',
      installmentNo: 1,
      amountReceived: 1515.83,
      depositAccountCode: '11-1101',
    } as never);

    expect(preview.accrual2A).toBeUndefined();
    expect(preview.accrualPostedAt).toBeUndefined();
    expect(triples(preview.lines as Line[])).toEqual([
      ['11-1101', '1515.83', '0.00'],
      ['11-2103', '0.00', '1515.83'],
    ]);
  });

  it('จ่ายบางส่วนของงวดที่ครบกำหนดวันนี้: ถือว่าถึงวันครบกำหนดแล้ว — ข้อความไม่เรียกงวดนี้ว่าเกินกำหนด', async () => {
    const dueToday = bangkokStartOfDay(new Date());
    const svc = buildService(null, dueToday);

    const err = await svc
      .previewJournal({
        contractId: 'c1',
        installmentNo: 1,
        amountReceived: 1000,
        depositAccountCode: '11-1101',
        case: 'PARTIAL',
      } as never)
      .catch((e: Error) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toBe(
      `งวดนี้ถึงวันครบกำหนดแล้ว (${formatDateShort(dueToday)}) แต่ระบบยังไม่ได้ตั้งลูกหนี้งวด — ` +
        'หน้านี้จึงยังบันทึกรับชำระบางส่วนไม่ได้ กรุณารับชำระเต็มงวด หรือติดต่อฝ่ายบัญชีให้ตรวจสอบงวดนี้ก่อนรับชำระบางส่วน',
    );
    expect((err as Error).message).not.toContain('เกินกำหนด');
    expect((err as Error).message).not.toContain('เลยกำหนด');
  });

  it('เลือกชำระผ่าน QR แล้วกรอกยอดบางส่วนของงวดที่ยังไม่ถึงวันครบกำหนด (ก1): แสดง 2A เท่ายอดที่รับ — วันที่ลง = ตอนนี้ (เงินเข้าจริงอย่างเร็ว)', async () => {
    const futureDue = new Date(Date.now() + 30 * 86_400_000);
    const svc = buildService(null, futureDue);
    const before = Date.now();

    const preview = await svc.previewJournal({
      contractId: 'c1',
      installmentNo: 1,
      amountReceived: 1000,
      depositAccountCode: '11-1201',
      case: 'PARTIAL',
      method: 'QR',
      // วันที่บนหน้าจอไม่ใช่วันที่เงินเข้า — ไม่ถูกใช้ในโหมด QR
      paidDate: '2026-01-01',
    } as never);

    expect(triples(preview.accrual2A!.lines as Line[])).toEqual(ACCRUAL_2A_PART_1000);
    expect(preview.accrualPortion).toBe('PARTIAL');
    const postedAt = new Date(preview.accrualPostedAt!).getTime();
    expect(postedAt).toBeGreaterThanOrEqual(before);
    expect(postedAt).toBeLessThanOrEqual(Date.now());
  });

  it('เลือกชำระผ่าน QR แล้วกรอกยอดบางส่วนของงวดที่ถึงวันครบกำหนดแล้วแต่ยังไม่ตั้งลูกหนี้: ข้อความของโหมด QR', async () => {
    const svc = buildService(null); // ครบกำหนด 8 มิ.ย. 2569 (ผ่านมาแล้ว)

    const err = await svc
      .previewJournal({
        contractId: 'c1',
        installmentNo: 1,
        amountReceived: 1000,
        depositAccountCode: '11-1201',
        case: 'PARTIAL',
        method: 'QR',
      } as never)
      .catch((e: Error) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toBe(
      'งวดนี้ถึงวันครบกำหนดแล้ว (08/06/2569) แต่ระบบยังไม่ได้ตั้งลูกหนี้งวด — ' +
        'แผงนี้จึงยังแสดงรายการบัญชีของยอดบางส่วนไม่ได้ การส่ง QR ยอดนี้ยังทำได้ตามเดิม',
    );
  });

  // คำตัดสิน R14 + R17 (2026-09-29): เงินที่เข้าทาง QR ถูกบันทึกแบบ "รับบางส่วน" เสมอ — ไม่หักเครดิตของลูกค้า
  // และทำให้งวดชำระครบเฉพาะเมื่อยอด QR ครบยอดเรียกเก็บ + ค่าปรับสุทธิ − ที่ชำระแล้ว. ยอด QR ที่หน้าจอ
  // หักเครดิตออกให้แล้วจึงได้ประโยคของโหมด QR ทางเดียวกับด่านจ่ายบางส่วน — ไม่มีบรรทัดรายการบัญชี
  it('เลือกชำระผ่าน QR ขณะลูกค้ามีเครดิต และยอด QR ถูกหักเครดิตออกแล้ว: ได้ประโยคของโหมด QR ไม่มีบรรทัดรายการบัญชี — เงินสดยอดเดียวกัน และ QR เต็มยอด ยังได้บล็อก 2A', async () => {
    const futureDue = new Date(Date.now() + 30 * 86_400_000);
    const svc = buildService(null, futureDue, 'ACTIVE', '500');
    // ค่างวด 1,515.83 − เครดิต 500.00 = 1,015.83 คือยอดที่หน้ารับชำระเติมให้ทุกช่องทาง
    const request = {
      contractId: 'c1',
      installmentNo: 1,
      amountReceived: 1015.83,
      depositAccountCode: '11-1201',
      case: 'NORMAL',
      consumeAdvance: true,
    };

    // (1) QR ยอดที่หักเครดิตออกแล้ว → ตอบด้วยประโยค ไม่มีผล preview (ไม่มีบรรทัด ไม่มีบล็อก 2A)
    const viaQr = await svc
      .previewJournal({ ...request, method: 'QR' } as never)
      .catch((e: Error) => e);

    expect(viaQr).toBeInstanceOf(BadRequestException);
    expect((viaQr as Error).message).toBe(
      'การชำระผ่าน QR ไม่หักเครดิตคงเหลือของลูกค้า — ยอด QR 1,015.83 บาท จึงยังไม่ครบยอดที่ต้องชำระของงวดนี้ (1,515.83 บาท) ' +
        'เมื่อเงินเข้า ระบบจะบันทึกเป็นการรับชำระบางส่วน และตั้งลูกหนี้งวด (2A) เท่ายอดที่รับ ' +
        'หากต้องการให้งวดนี้ชำระครบเมื่อเงินเข้า ให้นำเครื่องหมายถูกออกจากกล่อง "มีเครดิตคงเหลือ" เพื่อส่ง QR เต็มยอด',
    );

    // (2) ยอดเดียวกันแบบเงินสด: การบันทึกหักเครดิต 500.00 ในใบเดียวกัน งวดจึงชำระครบ → บรรทัด + บล็อก 2A
    const viaCash = await svc.previewJournal({ ...request, method: 'CASH' } as never);
    expect(triples(viaCash.accrual2A!.lines as Line[])).toEqual(ACCRUAL_2A_LINES);
    expect(triples(viaCash.lines as Line[])).toEqual([
      ['11-1201', '1015.83', '0.00'],
      ['21-1103', '500.00', '0.00'],
      ['11-2103', '0.00', '1515.83'],
    ]);
    expect(viaCash.accrualMode).toBe('CONSOLIDATED_PAYING_AHEAD');

    // (3) QR ที่ยอดครบยอดที่ต้องชำระของงวด (ไม่หักเครดิต): เงินที่เข้าทำให้งวดชำระครบ → บรรทัด + บล็อก 2A
    const fullQr = await svc.previewJournal({
      ...request,
      amountReceived: 1515.83,
      consumeAdvance: false,
      method: 'QR',
    } as never);
    expect(triples(fullQr.accrual2A!.lines as Line[])).toEqual(ACCRUAL_2A_LINES);
    expect(triples(fullQr.lines as Line[])).toEqual([
      ['11-1201', '1515.83', '0.00'],
      ['11-2103', '0.00', '1515.83'],
    ]);
    expect(fullQr.accrualMode).toBe('CONSOLIDATED_PAYING_AHEAD');
  });

  it('R17 เมื่อถึงวันครบกำหนดแล้ว (รอบกลางคืนตกหล่น): ประโยคเดิม "ยังไม่ตั้งลูกหนี้งวด (2A)" — ใบบางส่วนตั้งแต่วันครบกำหนดไม่ลง 2A', async () => {
    const svc = buildService(null, new Date('2026-06-08'), 'ACTIVE', '500');

    const err = await svc
      .previewJournal({
        contractId: 'c1',
        installmentNo: 1,
        amountReceived: 1015.83,
        depositAccountCode: '11-1201',
        case: 'NORMAL',
        consumeAdvance: true,
        method: 'QR',
        lateFee: 0,
      } as never)
      .catch((e: Error) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toContain(
      'เมื่อเงินเข้า ระบบจะบันทึกเป็นการรับชำระบางส่วน และยังไม่ตั้งลูกหนี้งวด (2A) ',
    );
  });

  // R17 ด้านกลับ: ประโยคของโหมด QR ใช้เฉพาะงวดที่ยังไม่ตั้งลูกหนี้งวดของสัญญาที่รอบกลางคืนดูแล —
  // งวดที่ตั้งลูกหนี้งวดแล้ว และสัญญาในสถานะที่ไม่ตั้งลูกหนี้งวด ได้ผล preview เดิม (ไม่มีบล็อก 2A ที่จะลง)
  const R17_SENTENCE = 'การชำระผ่าน QR ไม่หักเครดิตคงเหลือของลูกค้า';
  /** คำขอเดียวกับเทส R17 ข้างบน: เลือก QR · ลูกค้ามีเครดิต 500.00 · ยอด QR ที่หักเครดิตออกแล้ว 1,015.83 */
  const QR_CREDIT_REDUCED_REQUEST = {
    contractId: 'c1',
    installmentNo: 1,
    amountReceived: 1015.83,
    depositAccountCode: '11-1201',
    case: 'NORMAL',
    consumeAdvance: true,
    method: 'QR',
  };

  it('R17 ด้านกลับ — งวดที่ตั้งลูกหนี้งวดแล้ว: QR ยอดที่หักเครดิตออกแล้วได้ preview ปกติ (2B_ONLY) ไม่มีประโยคของ R17', async () => {
    const futureDue = new Date(Date.now() + 30 * 86_400_000);
    const svc = buildService('JE-202606-00001', futureDue, 'ACTIVE', '500');

    const out = await svc.previewJournal(QR_CREDIT_REDUCED_REQUEST as never).catch((e: Error) => e);

    expect(out).not.toBeInstanceOf(BadRequestException);
    expect(out).not.toBeInstanceOf(Error);
    expect(JSON.stringify(out)).not.toContain(R17_SENTENCE);
    const preview = out as Awaited<ReturnType<PaymentJournalPreviewService['previewJournal']>>;
    expect(preview.accrualMode).toBe('2B_ONLY');
    expect(preview.accrualPostedAt).toBeUndefined();
    expect(triples(preview.lines as Line[])).toEqual([
      ['11-1201', '1015.83', '0.00'],
      ['21-1103', '500.00', '0.00'],
      ['11-2103', '0.00', '1515.83'],
    ]);
  });

  it('R17 ด้านกลับ — สัญญาที่ถูกบอกเลิกแล้ว (TERMINATED): QR ยอดที่หักเครดิตออกแล้วไม่ได้ประโยคของ R17', async () => {
    const futureDue = new Date(Date.now() + 30 * 86_400_000);
    const svc = buildService(null, futureDue, 'TERMINATED', '500');

    const out = await svc.previewJournal(QR_CREDIT_REDUCED_REQUEST as never).catch((e: Error) => e);

    expect(out).not.toBeInstanceOf(BadRequestException);
    expect(out).not.toBeInstanceOf(Error);
    expect(JSON.stringify(out)).not.toContain(R17_SENTENCE);
    const preview = out as Awaited<ReturnType<PaymentJournalPreviewService['previewJournal']>>;
    expect(preview.accrualMode).toBe('2B_ONLY');
    expect(preview.accrual2A).toBeUndefined();
    expect(preview.accrualPostedAt).toBeUndefined();
  });

  it('accrued installment: unchanged — live lines credit 11-2103 and accrualMode=2B_ONLY', async () => {
    const svc = buildService('JE-202606-00001');

    const preview = await svc.previewJournal({
      contractId: 'c1',
      installmentNo: 1,
      amountReceived: 1515.83,
      depositAccountCode: '11-1101',
    } as never);

    const codes = preview.lines.map((l: { accountCode: string }) => l.accountCode);
    expect(codes).toContain('11-2103');
    expect(preview.accrualMode).toBe('2B_ONLY');
    expect(preview.isBalanced).toBe(true);
    // ตั้งลูกหนี้ไปแล้ว → ไม่มีวันที่ "จะลง 2A" และไม่มีบล็อก 2A ที่ยังไม่ลง
    expect(preview.accrualPostedAt).toBeUndefined();
    expect(preview.accrual2A).toBeUndefined(); // journalEntry.findMany mock คืน [] = ไม่มีบริบท 2A
  });

  it('งวดที่ถึงวันครบกำหนดแล้วและตั้งไปแล้วบางส่วน (รอบกลางคืนตกหล่น): ด่านรับบางส่วนใช้ถ้อยคำ "ยังตั้งลูกหนี้งวดไม่ครบ" ตรงกับป้ายของแผง', async () => {
    const svc = buildService(null, new Date('2026-06-08'), 'ACTIVE', '0', {
      accrued: { amount: '1000.00', vat: '65.42', interest: '329.85' },
      amountPaid: '1000',
      priorReceipts: ['1000'],
    });

    const err = await svc
      .previewJournal({
        contractId: 'c1',
        installmentNo: 1,
        amountReceived: 300,
        depositAccountCode: '11-1101',
        case: 'PARTIAL',
      } as never)
      .catch((e: Error) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toBe(
      'งวดนี้ถึงวันครบกำหนดแล้ว (08/06/2569) แต่ระบบยังตั้งลูกหนี้งวดไม่ครบ — ' +
        'หน้านี้จึงยังบันทึกรับชำระบางส่วนไม่ได้ กรุณารับชำระเต็มงวด หรือติดต่อฝ่ายบัญชีให้ตรวจสอบงวดนี้ก่อนรับชำระบางส่วน',
    );
  });

  describe("QR ที่ยอดยังไม่ครบยอดที่ต้องชำระ และไม่มีเครดิต — preview === สิ่งที่ recordPayment(…, 'PARTIAL', …) ลง (คำตัดสินผู้คุมงาน 2026-09-30 ข้อ 3)", () => {
    /**
     * ลงใบรับชำระจริง (PaymentReceiptTemplate + InstallmentAccrual2ATemplate ตัวจริง) บน mock ของงวดเดียวกับ
     * buildService — isFinalReceipt: false แบบที่ recordPayment ส่งเมื่อ case 'PARTIAL' (พนักงานรับบางส่วน และ
     * เส้นทางยืนยันของ QR) · `lateFee` = ค่าปรับของงวดที่ recordPayment ส่งให้ template (ไม่ส่ง = ไม่มีค่าปรับ)
     * คืนบรรทัดของรายการ 2A และใบรับชำระตามลำดับที่ลง
     */
    async function postPartialReceipt(amount: string, dueDate: Date, lateFee?: string) {
      const contract = {
        id: 'c1',
        contractNumber: 'CT-0001',
        status: 'ACTIVE',
        totalMonths: 12,
        financedAmount: new Decimal('10000'),
        storeCommission: new Decimal('1000'),
        interestTotal: new Decimal('6000'),
        vatAmount: new Decimal('1190'),
        advanceBalance: new Decimal('0'),
        rescheduleAdvanceBalance: new Decimal('0'),
      };
      const inst = {
        id: 'inst-1',
        contractId: 'c1',
        installmentNo: 1,
        dueDate,
        accrualJournalEntryId: null,
        accruedAmount: new Decimal('0'),
        accruedVat: new Decimal('0'),
        accruedInterest: new Decimal('0'),
        contract,
      };
      const createAndPost = jest
        .fn()
        .mockResolvedValueOnce({ id: 'je-2a', entryNumber: 'JE-202610-00001' })
        .mockResolvedValueOnce({ id: 'je-receipt', entryNumber: 'JE-202610-00002' });
      const tx = {
        installmentSchedule: {
          findUniqueOrThrow: jest.fn().mockResolvedValue(inst),
          update: jest.fn().mockResolvedValue({}),
        },
        contract: { findUniqueOrThrow: jest.fn().mockResolvedValue(contract) },
        journalEntry: {
          findMany: jest.fn().mockResolvedValue([]), // ไม่มีใบรับชำระก่อนหน้า
          findFirst: jest.fn().mockResolvedValue(null), // reference ว่างทุกค่า
        },
        systemConfig: {
          findFirst: jest.fn().mockResolvedValue(null),
          findUnique: jest.fn().mockResolvedValue(null),
        },
        companyInfo: { findFirst: jest.fn().mockResolvedValue({ id: 'finance-co' }) },
        accountingPeriod: { findUnique: jest.fn().mockResolvedValue(null) },
      };
      await new PaymentReceiptTemplate({ createAndPost } as never, {} as never).execute(
        {
          installmentScheduleId: 'inst-1',
          delta: new Decimal(amount),
          ...(lateFee ? { lateFee: new Decimal(lateFee) } : {}),
          debitAccountCode: '11-1201',
          isFinalReceipt: false,
          postedAt: new Date(),
          contractStatusBeforeReceipt: 'ACTIVE',
        },
        tx as never,
      );
      expect(createAndPost).toHaveBeenCalledTimes(2);
      const linesOf = (call: number) =>
        (
          createAndPost.mock.calls[call][0] as {
            lines: { accountCode: string; dr: Decimal; cr: Decimal }[];
          }
        ).lines.map((l) => [l.accountCode, l.dr.toFixed(2), l.cr.toFixed(2)]);
      return { accrual2A: linesOf(0), receipt: linesOf(1) };
    }

    it('QR 1,515.33 (ขาด 0.50 — หน้าจอส่ง case UNDERPAY) ของงวดที่ยังไม่ถึงกำหนด → บล็อก 2A และบล็อกรับชำระตรงกับที่ลงจริงทุกบรรทัด · ไม่มี 52-1104', async () => {
      const futureDue = new Date(Date.now() + 20 * 86_400_000);
      const preview = await buildService(null, futureDue).previewJournal({
        contractId: 'c1',
        installmentNo: 1,
        amountReceived: 1515.33,
        depositAccountCode: '11-1201',
        case: 'UNDERPAY',
        method: 'QR',
      } as never);
      const posted = await postPartialReceipt('1515.33', futureDue);

      expect(posted.receipt).toEqual([
        ['11-1201', '1515.33', '0.00'],
        ['11-2103', '0.00', '1515.33'],
      ]);
      // VAT HALF_UP(1,515.33 × 7 ÷ 107 = 99.1337…) · ดอกเบี้ย HALF_UP(500 × 1,416.20 ÷ 1,416.66 = 499.8376…)
      expect(posted.accrual2A).toEqual([
        ['11-2103', '1515.33', '0.00'],
        ['21-2102', '99.13', '0.00'],
        ['11-2106', '499.84', '0.00'],
        ['11-2101', '0.00', '1416.20'],
        ['11-2105', '0.00', '99.13'],
        ['41-1101', '0.00', '499.84'],
        ['21-2101', '0.00', '99.13'],
      ]);
      expect(triples(preview.lines as Line[])).toEqual(posted.receipt);
      expect(triples(preview.accrual2A!.lines as Line[])).toEqual(posted.accrual2A);
      expect(preview.accrualPortion).toBe('PARTIAL');
      expect(preview.lines.some((l) => l.accountCode === '52-1104')).toBe(false);

      // เท่ากับ preview ของ case 'PARTIAL' ยอดเดียวกันทุกบรรทัด
      const asPartial = await buildService(null, futureDue).previewJournal({
        contractId: 'c1',
        installmentNo: 1,
        amountReceived: 1515.33,
        depositAccountCode: '11-1201',
        case: 'PARTIAL',
        method: 'QR',
      } as never);
      expect(triples(asPartial.lines as Line[])).toEqual(triples(preview.lines as Line[]));
      expect(triples(asPartial.accrual2A!.lines as Line[])).toEqual(
        triples(preview.accrual2A!.lines as Line[]),
      );
    });

    // case 'PARTIAL' ของพนักงานลงผ่าน recordPayment(…, 'PARTIAL', …) ทางเดียวกับที่ postPartialReceipt จำลอง
    it('รับบางส่วน 1,000 พร้อมค่าปรับ 100 ของงวดที่ยังไม่ถึงกำหนด (case PARTIAL) → หักค่าปรับก่อน: Cr 42-1103 100 / Cr 11-2103 900 · 2A เท่ายอดที่ล้างลูกหนี้ 900 — ตรงกับที่ลงจริงทุกบรรทัด', async () => {
      const futureDue = new Date(Date.now() + 20 * 86_400_000);
      const paidDate = new Date().toISOString().slice(0, 10);
      const preview = await buildService(null, futureDue).previewJournal({
        contractId: 'c1',
        installmentNo: 1,
        amountReceived: 1000,
        lateFee: 100,
        depositAccountCode: '11-1201',
        case: 'PARTIAL',
        paidDate,
      } as never);
      const posted = await postPartialReceipt('1000', futureDue, '100');

      expect(triples(preview.lines as Line[])).toEqual([
        ['11-1201', '1000.00', '0.00'],
        ['11-2103', '0.00', '900.00'],
        ['42-1103', '0.00', '100.00'],
      ]);
      // VAT HALF_UP(900 × 7 ÷ 107 = 58.8785…) · มูลค่า 841.12 · ดอกเบี้ย HALF_UP(500 × 841.12 ÷ 1,416.66 = 296.8672…)
      expect(triples(preview.accrual2A!.lines as Line[])).toEqual([
        ['11-2103', '900.00', '0.00'],
        ['21-2102', '58.88', '0.00'],
        ['11-2106', '296.87', '0.00'],
        ['11-2101', '0.00', '841.12'],
        ['11-2105', '0.00', '58.88'],
        ['41-1101', '0.00', '296.87'],
        ['21-2101', '0.00', '58.88'],
      ]);
      expect(preview.accrualPortion).toBe('PARTIAL');
      expect(preview.accrualAmount).toBe('900.00');
      expect(triples(preview.lines as Line[])).toEqual(posted.receipt);
      expect(triples(preview.accrual2A!.lines as Line[])).toEqual(posted.accrual2A);
    });
  });
});
