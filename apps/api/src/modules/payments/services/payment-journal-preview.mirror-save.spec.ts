import { BadRequestException } from '@nestjs/common';
import { bangkokStartOfDay } from '../../../utils/date.util';
import { formatDateShort } from '../../../utils/thai-date.util';
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
  type Line = { accountCode: string; debit: string; credit: string; block: string; posted: boolean };
  const triples = (lines: Line[]) => lines.map((l) => [l.accountCode, l.debit, l.credit]);

  function buildService(
    accrualJournalEntryId: string | null,
    dueDate: Date = new Date('2026-06-08'), // past due → BACKFILL classification
    status: string = 'ACTIVE',
    advanceBalance: string = '0', // เครดิตคงเหลือของลูกค้า (เงินรับล่วงหน้า)
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
          contract,
        }),
      },
      payment: { findFirst: jest.fn().mockResolvedValue({ amountDue: '1515.83', amountPaid: '0' }) },
      journalEntry: { findMany: jest.fn().mockResolvedValue([]) },
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

  it('จ่ายบางส่วนของงวดที่ยังไม่ถึงกำหนด: ยังถูกปฏิเสธ — ข้อความบอกให้รับเต็มงวดหรือรอถึงวันครบกำหนด', async () => {
    const futureDue = new Date(Date.now() + 30 * 86_400_000);
    const svc = buildService(null, futureDue);

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
      `งวดนี้ยังไม่ถึงวันครบกำหนด (${formatDateShort(futureDue)}) ระบบจึงยังไม่ได้ตั้งลูกหนี้งวด — ` +
        'หน้านี้จึงยังบันทึกรับชำระบางส่วนไม่ได้ กรุณารับชำระเต็มงวด หรือรอให้ถึงวันครบกำหนดแล้วจึงรับชำระบางส่วน',
    );
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

  it('เลือกชำระผ่าน QR แล้วกรอกยอดบางส่วนของงวดที่ยังไม่ถึงวันครบกำหนด: ข้อความของโหมด QR — ไม่บอกว่ารับบางส่วนไม่ได้', async () => {
    const futureDue = new Date(Date.now() + 30 * 86_400_000);
    const svc = buildService(null, futureDue);

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
      `งวดนี้ยังไม่ถึงวันครบกำหนด (${formatDateShort(futureDue)}) ระบบจึงยังไม่ได้ตั้งลูกหนี้งวด — ` +
        'แผงนี้จึงยังแสดงรายการบัญชีของยอดบางส่วนไม่ได้ การส่ง QR ยอดนี้ยังทำได้ตามเดิม',
    );
    expect((err as Error).message).not.toContain('บันทึกรับชำระบางส่วนไม่ได้');
    expect((err as Error).message).not.toContain('กรุณารับชำระเต็มงวด');
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
        'เมื่อเงินเข้า ระบบจะบันทึกเป็นการรับชำระบางส่วน และยังไม่ตั้งลูกหนี้งวด (2A) ' +
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
});
