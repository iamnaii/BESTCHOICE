import { Decimal } from '@prisma/client/runtime/library';
import { ReceiptPdfService } from './receipt-pdf.service';
import { ReceiptQueryService } from './receipt-query.service';

// The renderer is one large Puppeteer call — `page.setContent(html)` then
// `page.pdf()`. Rather than refactor the production template into a
// standalone "build HTML" function (out of scope for this task), we mock
// puppeteer.launch()/newPage() so the REAL generatePDF() runs end-to-end and
// capture the HTML string that would have been rendered. This exercises the
// actual reference-box + VAT-split logic without needing a real browser.
let capturedHtml = '';
jest.mock('puppeteer', () => ({
  launch: jest.fn().mockResolvedValue({
    newPage: jest.fn().mockResolvedValue({
      setContent: jest.fn(async (html: string) => {
        capturedHtml = html;
      }),
      evaluate: jest.fn().mockResolvedValue(undefined),
      pdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
    }),
    close: jest.fn().mockResolvedValue(undefined),
  }),
}));

/**
 * Phase 3 Task 4 — standalone Credit Note (CreditNoteDocumentService,
 * paymentId=null, voidedReceiptId=null) must render correctly:
 *   1. Reference box shows "อ้างอิง: เลิกสัญญา ... — ใบลดหนี้ตามมาตรา 82/5"
 *      instead of the void-CN "ยกเลิกใบเสร็จรับเงินเลขที่ ..." notice.
 *   2. amountBeforeVat/vatAmount rows render the EXACT stamped values, not a
 *      pro-rata 100/107 recompute (which drifts by ±0.01 vs the ledger).
 * The legacy void-CN path (voidedRef present) must stay byte-identical.
 */
describe('ReceiptPdfService — Credit Note rendering (Phase 3 Task 4)', () => {
  let service: ReceiptPdfService;
  let query: { getReceipt: jest.Mock };

  const baseReceipt = (overrides: Record<string, unknown> = {}) => ({
    id: 'rcpt-cn-1',
    receiptNumber: 'RT-202607-00099',
    receiptType: 'CREDIT_NOTE',
    payerName: 'ลูกค้าทดสอบ',
    receiverName: 'BESTCHOICE FINANCE',
    payerAddress: null,
    payerTaxId: null,
    amount: new Decimal('4547.49'),
    amountBeforeVat: new Decimal('4249.98'),
    vatAmount: new Decimal('297.51'),
    installmentNo: null,
    paymentId: null,
    voidedReceiptId: null,
    paidDate: new Date('2026-07-24T00:00:00.000Z'),
    isVoided: false,
    paymentMethod: null,
    transactionRef: null,
    remainingBalance: null,
    remainingMonths: null,
    paymentStatus: 'PAID',
    priorReceiptCount: 0,
    voidedRef: null,
    payment: null,
    issuer: { name: 'ระบบอัตโนมัติ', role: 'OWNER' },
    company: {
      nameTh: 'บริษัท เบสท์ช้อยส์โฟน จำกัด',
      taxId: '0000000000000',
      address: null,
      phone: null,
      bankName: null,
      bankAccountName: null,
      bankAccountNumber: null,
    },
    contract: {
      contractNumber: 'CT-2607-0001',
      totalMonths: 12,
      financedAmount: new Decimal('10000.00'),
      storeCommission: new Decimal('1000.00'),
      interestTotal: new Decimal('6000.00'),
      vatAmount: new Decimal('1190.00'),
      customer: {
        name: 'ลูกค้าทดสอบ',
        phone: null,
        email: null,
        nationalId: null,
        addressIdCard: null,
        addressCurrent: null,
      },
      branch: null,
      product: null,
    },
    ...overrides,
  });

  beforeEach(() => {
    capturedHtml = '';
    query = { getReceipt: jest.fn() };
    service = new ReceiptPdfService(query as unknown as ReceiptQueryService);
  });

  it('standalone CN (voidedRef null): shows the ม.82/5 contract-termination reference, not the void-receipt notice', async () => {
    query.getReceipt.mockResolvedValue(baseReceipt());

    await service.generatePDF('rcpt-cn-1');

    expect(capturedHtml).toContain('อ้างอิง: เลิกสัญญา');
    expect(capturedHtml).toContain('CT-2607-0001');
    expect(capturedHtml).toContain('มาตรา 82/5');
    expect(capturedHtml).not.toContain('เอกสารนี้ออกเพื่อยกเลิกใบเสร็จรับเงินเลขที่');
  });

  it('standalone CN: renders the exact stamped amountBeforeVat/vatAmount, not a pro-rata recompute', async () => {
    query.getReceipt.mockResolvedValue(baseReceipt());

    await service.generatePDF('rcpt-cn-1');

    // Golden fixture (credit-note-document.service.spec.ts / bad-debt-writeoff
    // template): 3 accrued-unpaid installments → amountBeforeVat=4,249.98 /
    // vat=297.51. A 100/107 pro-rata split of the 4,547.49 total would instead
    // produce 4,249.99 / 297.50 — off by 0.01 baht vs the JE the CN mirrors.
    expect(capturedHtml).toContain('4,249.98');
    expect(capturedHtml).toContain('297.51');
    expect(capturedHtml).not.toContain('4,249.99');
    expect(capturedHtml).not.toContain('297.50');
  });

  it('void-CN (voidedRef present): keeps the legacy "ยกเลิกใบเสร็จ" notice — byte-identical behavior', async () => {
    query.getReceipt.mockResolvedValue(
      baseReceipt({
        amountBeforeVat: null,
        vatAmount: null,
        installmentNo: 2,
        paymentId: 'pay-1',
        voidedReceiptId: 'rcpt-orig-1',
        voidedRef: {
          receiptNumber: 'RT-202607-00050',
          paidDate: new Date('2026-07-20T00:00:00.000Z'),
        },
        payment: {
          amountDue: new Decimal('1515.83'),
          lateFee: new Decimal('0'),
          amountPaid: new Decimal('1515.83'),
          status: 'PAID',
          lateFeeWaived: false,
          waivedAmount: null,
          waivedReason: null,
        },
      }),
    );

    await service.generatePDF('rcpt-cn-1');

    expect(capturedHtml).toContain('เอกสารนี้ออกเพื่อยกเลิกใบเสร็จรับเงินเลขที่');
    expect(capturedHtml).toContain('RT-202607-00050');
    expect(capturedHtml).not.toContain('อ้างอิง: เลิกสัญญา');
  });
  it('uses the receipt fee for a later manual charge instead of the cumulative installment fee', async () => {
    query.getReceipt.mockResolvedValue(baseReceipt({
      receiptType: 'INSTALLMENT', amount: new Decimal('3050'), amountBeforeVat: null,
      vatAmount: null, installmentNo: 2, paymentId: 'p1', priorReceiptCount: 1,
      lateFeeCollected: '50.00', lateFeeWaivedThisReceipt: '0.00', hasReceiptFeeHistory: true,
      payment: { amountDue: new Decimal('6079'), lateFee: new Decimal('150'),
        amountPaid: new Decimal('6229'), status: 'PAID', lateFeeWaived: false,
        waivedAmount: null, waivedReason: null },
    }));
    await service.generatePDF('r2');
    expect(capturedHtml).toContain('ค่าปรับชำระล่าช้า');
    expect(capturedHtml).toContain('<strong>50.00</strong>');
    expect(capturedHtml).not.toContain('<strong>150.00</strong>');
    expect(capturedHtml).toContain('<strong>3,000.00</strong>');
  });

  it('does not print guessed VAT when an unknown legacy receipt has linked fee history', async () => {
    query.getReceipt.mockResolvedValue(baseReceipt({
      receiptType: 'INSTALLMENT', installmentNo: 2, paymentId: 'p1',
      lateFeeCollected: null, lateFeeWaivedThisReceipt: null, hasReceiptFeeHistory: true,
    }));
    await expect(service.generatePDF('ambiguous')).rejects.toThrow(
      'ไม่สามารถระบุค่าปรับของใบเสร็จนี้จากรายการบัญชีได้',
    );
    expect(capturedHtml).toBe('');
  });

  const installmentDocument = (overrides: Record<string, unknown> = {}) => baseReceipt({
    receiptType: 'INSTALLMENT', amount: new Decimal('5516'), amountBeforeVat: null,
    vatAmount: null, installmentNo: 4, paymentId: 'p4',
    remainingBalance: new Decimal('4112'), remainingMonths: 6,
    documentRemainingBalance: '25788.00', documentRemainingMonths: 6,
    documentInstallmentAmountDue: '4472.00', documentInstallmentAmountPaid: '4472.00',
    paymentCase: 'RESCHEDULE', lateFeeCollected: '0.00', lateFeeWaivedThisReceipt: '0.00',
    hasReceiptFeeHistory: true,
    installmentAllocations: [
      { installmentNo: 4, amount: '4472.00', kind: 'INSTALLMENT' },
      { installmentNo: 10, amount: '1044.00', kind: 'RESCHEDULE_ADVANCE' },
    ],
    contract: { ...baseReceipt().contract, totalMonths: 10, financedAmount: new Decimal('22000'),
      storeCommission: new Decimal('2200'), interestTotal: new Decimal('17594.40'), vatAmount: new Decimal('2925.61') },
    ...overrides,
  });

  it('bundled 5516 splits both rows while preserving the original document VAT totals', async () => {
    query.getReceipt.mockResolvedValue(installmentDocument());
    await service.generatePDF('bundle');
    expect(capturedHtml).toContain('ค่างวดเช่าซื้อ งวดที่ 4/10');
    expect(capturedHtml).toContain('เงินรับล่วงหน้างวดที่ 10/10 — ปรับดิว');
    expect(capturedHtml).toContain('<strong>4,472.00</strong>');
    expect(capturedHtml).toContain('<strong>1,044.00</strong>');
    expect(capturedHtml).toContain('4,179.44');
    expect(capturedHtml).toContain('292.56');
    expect(capturedHtml).toContain('5,516.00');
    expect(capturedHtml).toContain('25,788.00 บาท');
    expect(capturedHtml).toContain('975.70');
    expect(capturedHtml).toContain('68.30');
    expect(capturedHtml).toContain('5,155.14');
    expect(capturedHtml).toContain('360.86');
    expect(capturedHtml).not.toContain('4,112.00 บาท');
  });

  it('separate reschedule 1144 prints last advance 1044 and collected fee 100 without current installment VAT', async () => {
    query.getReceipt.mockResolvedValue(installmentDocument({
      receiptType: 'RESCHEDULE_FEE', amount: new Decimal('1144'),
      lateFeeCollected: '100.00', lateFeeWaivedThisReceipt: '0.00',
      installmentAllocations: [{ installmentNo: 10, amount: '1044.00', kind: 'RESCHEDULE_ADVANCE' }],
      documentRemainingBalance: '30260.00', documentRemainingMonths: 7,
    }));
    await service.generatePDF('separate');
    expect(capturedHtml).toContain('งวดที่รับล่วงหน้า</strong> 10 จาก 10 งวด');
    expect(capturedHtml).toContain('เงินรับล่วงหน้างวดที่ 10/10 — ปรับดิว');
    expect(capturedHtml).toContain('<strong>1,044.00</strong>');
    expect(capturedHtml).toContain('<strong>100.00</strong>');
    expect(capturedHtml).toContain('30,260.00 บาท');
    expect(capturedHtml).not.toContain('ค่างวดเช่าซื้อ งวดที่ 4/10');
    expect(capturedHtml).not.toContain('ใบเสร็จรับเงิน / ใบกำกับภาษี');
  });

  it('historic partial cumulative remains 2900 despite later payment or manual fees', async () => {
    query.getReceipt.mockResolvedValue(installmentDocument({
      amount: new Decimal('3000'), lateFeeCollected: '100.00', paymentStatus: 'PARTIAL',
      installmentAllocations: [{ installmentNo: 4, amount: '2900.00', kind: 'INSTALLMENT' }],
      documentInstallmentAmountPaid: '2900.00', documentRemainingBalance: '28404.00',
      documentRemainingMonths: 7,
      payment: { amountDue: new Decimal('4472'), amountPaid: new Decimal('4522'),
        lateFee: new Decimal('150'), status: 'PAID', lateFeeWaived: false },
    }));
    await service.generatePDF('partial');
    expect(capturedHtml).toContain('ชำระบางส่วน — สะสมงวดนี้ 2,900.00 จากยอดงวด 4,472.00 บาท');
    expect(capturedHtml).not.toContain('4,622.00');
    expect(capturedHtml).not.toContain('4,522.00');
  });

  it('prints a clear unavailable balance when historical evidence is incomplete', async () => {
    query.getReceipt.mockResolvedValue(installmentDocument({
      documentRemainingBalance: null, documentRemainingMonths: null,
    }));
    await service.generatePDF('unknown-balance');
    expect(capturedHtml).toContain('ไม่สามารถยืนยันยอด ณ วันออกใบเสร็จจากประวัติได้');
    expect(capturedHtml).not.toContain('4,112.00 บาท');
    expect(capturedHtml).not.toContain('ชำระครบตามเอกสารนี้');
  });

  it.each([null, [{ installmentNo: 4, amount: '5516.01', kind: 'INSTALLMENT' }]])(
    'refuses missing or inconsistent allocation instead of inventing its VAT base', async (installmentAllocations) => {
      query.getReceipt.mockResolvedValue(installmentDocument({ installmentAllocations }));
      await expect(service.generatePDF('unknown-allocation')).rejects.toThrow('กรุณาตรวจสอบก่อนพิมพ์');
      expect(capturedHtml).toBe('');
    },
  );

  it('ordinary overpay advance has a printable source-based split without inventing a target installment', async () => {
    query.getReceipt.mockResolvedValue(installmentDocument({
      paymentCase: 'OVERPAY_ADVANCE', installmentAllocations: null, receiptAdvanceAmount: '1044.00',
    }));
    await service.generatePDF('generic-advance');
    expect(capturedHtml).toContain('เงินรับล่วงหน้าในสัญญา');
    expect(capturedHtml).toContain('<strong>4,472.00</strong>');
    expect(capturedHtml).toContain('<strong>1,044.00</strong>');
    expect(capturedHtml).toContain('292.56');
    expect(capturedHtml).toContain('360.86');
    expect(capturedHtml).not.toContain('เงินรับล่วงหน้างวดที่ 10/10');
    expect(capturedHtml).not.toContain('เงินรับล่วงหน้างวดสุดท้าย');
  });

  it('prints a verified zero balance even when unapplied funds cover future installments', async () => {
    query.getReceipt.mockResolvedValue(installmentDocument({ documentRemainingBalance: '0.00', documentRemainingMonths: 6 }));
    await service.generatePDF('covered');
    expect(capturedHtml).toContain('ค่างวดคงเหลือ</span><span class="v">0.00 บาท');
    expect(capturedHtml).toContain('6 งวด');
    expect(capturedHtml).not.toContain('ชำระครบตามเอกสารนี้');
  });

  it('keeps the final cash receipt tax unchanged after an earlier advance receipt', async () => {
    query.getReceipt.mockResolvedValue(installmentDocument({
      amount: new Decimal('3428'), installmentNo: 10,
      installmentAllocations: [{ installmentNo: 10, amount: '3428.00', kind: 'INSTALLMENT' }],
      documentRemainingBalance: '0.00', documentRemainingMonths: 0,
    }));
    await service.generatePDF('final-cash');
    expect(capturedHtml).toContain('3,203.74');
    expect(capturedHtml).toContain('224.26');
    expect(capturedHtml).toContain('<strong>3,428.00</strong>');
    expect(capturedHtml).not.toContain('เงินรับล่วงหน้างวดที่');
  });

  // ── ใบกำกับภาษีตามบัญชี (PR3 — D3–D5 · Q4–Q5): ใบที่เก็บค่า ณ ตอนออกใบ พิมพ์ค่าที่เก็บ ─────────────
  const stored = (overrides: Record<string, unknown> = {}) => baseReceipt({
    receiptType: 'INSTALLMENT', installmentNo: 3, paymentId: 'p3', paymentStatus: 'PAID',
    amount: new Decimal('6079'), amountBeforeVat: new Decimal('5681.00'), vatAmount: new Decimal('397.67'),
    roundingAmount: new Decimal('0.33'), lateFeeAmount: new Decimal('0'), lateFeeWaivedAmount: new Decimal('0'),
    advanceAmount: new Decimal('0'), advanceVatAmount: new Decimal('0'),
    lateFeeCollected: '0.00', lateFeeWaivedThisReceipt: '0.00', hasReceiptFeeHistory: true,
    installmentAllocations: [{ installmentNo: 3, amount: '6079.00', kind: 'INSTALLMENT' }],
    documentRemainingBalance: '54708.03', documentRemainingMonths: 9,
    ...overrides,
  });

  it('PR3: ใบ 6,079 ที่เก็บค่าแล้ว → มูลค่า 5,681.00 · VAT 397.67 · แถวและบรรทัดสรุป "ปัดเศษ (ไม่อยู่ในฐานภาษี)" 0.33 (ไม่คิด ×100/107 = 5,681.31 / 397.69)', async () => {
    query.getReceipt.mockResolvedValue(stored());
    await service.generatePDF('stored-6079');
    expect(capturedHtml).toContain('ใบเสร็จรับเงิน / ใบกำกับภาษี');
    expect(capturedHtml).toContain('<strong>6,078.67</strong>');
    expect(capturedHtml).toContain('5,681.00');
    expect(capturedHtml).toContain('397.67');
    expect(capturedHtml).toContain('<div class="item-name">ปัดเศษ (ไม่อยู่ในฐานภาษี)</div>');
    expect(capturedHtml).toContain('รับเกินค่างวดไม่ถึง 1 บาท');
    expect(capturedHtml).toContain('<span class="k">ปัดเศษ (ไม่อยู่ในฐานภาษี)</span><span class="v">0.33</span>');
    expect(capturedHtml).toContain('6,079.00');
    expect(capturedHtml).not.toContain('5,681.31');
    expect(capturedHtml).not.toContain('397.69');
  });

  it('PR3 (Q4): จ่ายขาด 0.67 → VAT เต็ม 397.67 + ปัดเศษ −0.67', async () => {
    query.getReceipt.mockResolvedValue(stored({ amount: new Decimal('6078'), roundingAmount: new Decimal('-0.67') }));
    await service.generatePDF('stored-underpay');
    expect(capturedHtml).toContain('397.67');
    expect(capturedHtml).toContain('ส่วนลดเศษสตางค์ของค่างวด (ไม่เกิน 1 บาท)');
    expect(capturedHtml).toContain('<span class="k">ปัดเศษ (ไม่อยู่ในฐานภาษี)</span><span class="v">−0.67</span>');
    expect(capturedHtml).toContain('6,078.00');
  });

  it('PR3: หักเงินรับล่วงหน้า 500 → แถวค่างวด 1,515.83 (VAT 99.17) + แถว "หักเงินรับล่วงหน้า" −500.00 (VAT −32.71) · สรุป 949.37 / 66.46', async () => {
    query.getReceipt.mockResolvedValue(stored({
      amount: new Decimal('1015.83'), amountBeforeVat: new Decimal('949.37'), vatAmount: new Decimal('66.46'),
      roundingAmount: new Decimal('0'), advanceAmount: new Decimal('-500'), advanceVatAmount: new Decimal('-32.71'),
      installmentAllocations: [{ installmentNo: 3, amount: '1015.83', kind: 'INSTALLMENT' }],
    }));
    await service.generatePDF('stored-deduction');
    expect(capturedHtml).toContain('<strong>1,515.83</strong>');
    expect(capturedHtml).toContain('99.17');
    expect(capturedHtml).toContain('<div class="item-name">หักเงินรับล่วงหน้า</div>');
    // บรรทัดรองเป็นกลาง — ไม่อ้างว่าเคยออกเอกสารภาษี (เงินบางแหล่งไม่เคยมีใบกำกับภาษี — ถ3)
    expect(capturedHtml).toContain('<div class="item-meta">เงินที่ชำระไว้ก่อนแล้ว</div>');
    expect(capturedHtml).not.toContain('ออกเอกสารพร้อมภาษี');
    expect(capturedHtml).toContain('<strong>−500.00</strong>');
    expect(capturedHtml).toContain('−32.71');
    expect(capturedHtml).toContain('949.37');
    expect(capturedHtml).toContain('66.46');
    expect(capturedHtml).not.toContain('ปัดเศษ (ไม่อยู่ในฐานภาษี)');
  });

  it('PR3 (Q5): ใบลดหนี้ที่คัดลอกค่าของใบ 3,050 → แถวค่างวด 3,000 (VAT 196.26) + แถวค่าปรับ 50 เหมือนใบเดิม (เดิมพิมพ์ 199.53)', async () => {
    query.getReceipt.mockResolvedValue(baseReceipt({
      receiptType: 'CREDIT_NOTE', installmentNo: 2, paymentId: 'p2', voidedReceiptId: 'r-3050',
      voidedRef: { receiptNumber: 'RT-202610-00001', paidDate: new Date('2026-10-01T00:00:00.000Z') },
      amount: new Decimal('3050'), amountBeforeVat: new Decimal('2803.74'), vatAmount: new Decimal('196.26'),
      roundingAmount: new Decimal('0'), lateFeeAmount: new Decimal('50'), lateFeeWaivedAmount: new Decimal('0'),
      advanceAmount: new Decimal('0'), advanceVatAmount: new Decimal('0'),
    }));
    await service.generatePDF('cn-3050');
    expect(capturedHtml).toContain('ใบลดหนี้');
    expect(capturedHtml).toContain('ลดหนี้ — ยกเลิกใบเสร็จ');
    expect(capturedHtml).toContain('<strong>3,000.00</strong>');
    expect(capturedHtml).toContain('196.26');
    expect(capturedHtml).toContain('ค่าปรับชำระล่าช้า');
    expect(capturedHtml).toContain('<strong>50.00</strong>');
    expect(capturedHtml).not.toContain('199.53');
  });

  it('PR3: ใบเสร็จปิดยอดก่อนกำหนด (ไม่เก็บค่า — ย้ายไป PR5) → พิมพ์แบบเดิม 16,205.57 / 1,134.39 · ไม่มีแถวปัดเศษ', async () => {
    query.getReceipt.mockResolvedValue(baseReceipt({
      receiptType: 'EARLY_PAYOFF', installmentNo: null, paymentId: null,
      amount: new Decimal('17339.96'), amountBeforeVat: null, vatAmount: null,
    }));
    await service.generatePDF('payoff-unchanged');
    expect(capturedHtml).toContain('ใบเสร็จรับเงิน / ใบกำกับภาษี');
    expect(capturedHtml).toContain('ปิดยอดสัญญาก่อนกำหนด');
    expect(capturedHtml).toContain('16,205.57');
    expect(capturedHtml).toContain('1,134.39');
    expect(capturedHtml).not.toContain('ปัดเศษ (ไม่อยู่ในฐานภาษี)');
  });

  it('PR3: ใบที่รับเฉพาะเศษ 0.17 (ไม่ได้ล้างลูกหนี้ของงวด) → ไม่มีแถวค่างวด 0.00 · มีแต่แถวปัดเศษ · ไม่ใช่ใบกำกับภาษี', async () => {
    query.getReceipt.mockResolvedValue(stored({
      amount: new Decimal('0.17'), amountBeforeVat: new Decimal('0'), vatAmount: new Decimal('0'),
      roundingAmount: new Decimal('0.17'),
      installmentAllocations: [{ installmentNo: 3, amount: '0.17', kind: 'INSTALLMENT' }],
    }));
    await service.generatePDF('stored-residue');
    expect(capturedHtml).not.toContain('ใบเสร็จรับเงิน / ใบกำกับภาษี');
    expect(capturedHtml).not.toContain('ค่างวดเช่าซื้อ งวดที่ 3/12');
    expect(capturedHtml).toContain('<div class="item-name">ปัดเศษ (ไม่อยู่ในฐานภาษี)</div>');
  });



  // ── PR4ข (ฝ่ายบัญชี 16/10/2569 ข้อ 14 / 23.1 / 23.2 · mockup FWZ6vrgaixKmP1buUdrUry กระดาน 2–3) ──
  // ใบปิดยอดก่อนกำหนดเป็นใบกำกับภาษีตามบัญชี (ฝ่ายบัญชี 16/10/2569 ข้อ 16.1/16.2 · mockup เจ้าของเคาะ 18/10/2569
  // `7WWhgoL9ovNxPHji7m6tGf` กระดาน 1–3): ค่าที่เก็บ + บริบทจาก metadata ของ JP4 (payoffContext)
  describe('ใบปิดยอดก่อนกำหนดที่เก็บค่า (16.1/16.2 + บรรทัดอธิบาย 18.1)', () => {
    const payoffContext = (o: Record<string, unknown> = {}) => ({
      unpaidInstallments: 12,
      firstNo: 1,
      lastNo: 12,
      receivableCleared: '18190.00',
      dueMonths: 0,
      notDueMonths: 12,
      discountPct: 50,
      parkRelief: null,
      advanceRelief: null,
      creditRelief: null,
      advanceVatReversal: null,
      parkReceiptNumber: null,
      ...o,
    });
    const payoffStored = (overrides: Record<string, unknown> = {}) => baseReceipt({
      id: 'rcpt-ep', receiptNumber: 'RT-202610-00044', receiptType: 'EARLY_PAYOFF', installmentNo: null, paymentId: null,
      amount: new Decimal('15189.98'), amountBeforeVat: new Decimal('17000.00'), vatAmount: new Decimal('1190.00'),
      roundingAmount: new Decimal('0'), lateFeeAmount: new Decimal('0'), lateFeeWaivedAmount: new Decimal('0'),
      advanceAmount: new Decimal('0'), advanceVatAmount: new Decimal('0'), discountAmount: new Decimal('3000.02'),
      paymentMethod: 'BANK_TRANSFER', lateFeeCollected: null, lateFeeWaivedThisReceipt: null, hasReceiptFeeHistory: false,
      installmentAllocations: null, sourceJournalEntryId: 'je-jp4', payoffContext: payoffContext(),
      ...overrides,
    });

    it('16.1 ยังไม่จ่ายเลย: แถวค่างวดคงเหลือ 12 งวด 17,000/1,190 ตามบัญชี · แถวส่วนลดดอกเบี้ยปิดยอด −3,000.02 ไม่ลดฐานภาษี · รวม 15,189.98 · ยกเลิกไม่ได้', async () => {
      query.getReceipt.mockResolvedValue(payoffStored());
      await service.generatePDF('rcpt-ep');
      expect(capturedHtml).toContain('ใบเสร็จรับเงิน / ใบกำกับภาษี');
      expect(capturedHtml).toContain('ค่างวดคงเหลือ 12 งวด (งวดที่ 1–12) — ปิดยอดสัญญา');
      expect(capturedHtml).toContain('<strong>18,190.00</strong>'); // ยอดแถว = ลูกหนี้ตามบัญชี (ไม่มีบรรทัดรองเมื่อไม่มีงวดถึงกำหนด)
      expect(capturedHtml).not.toContain('ลูกหนี้คงเหลือ');
      expect(capturedHtml).toContain('ชำระครบตามเอกสารนี้ — สัญญาเช่าซื้อสิ้นสุด');
      expect(capturedHtml).toContain('ส่วนลดดอกเบี้ยปิดยอด (ไม่ลดฐานภาษี)');
      expect(capturedHtml).toContain('ส่วนลด 50% ของดอกเบี้ยงวดที่ยังไม่ถึงกำหนด · ฐานภาษีคงเดิม');
      expect(capturedHtml).toContain('<strong>−3,000.02</strong>');
      expect(capturedHtml).toContain('<span class="k">ส่วนลดดอกเบี้ยปิดยอด</span><span class="v">−3,000.02</span>');
      expect(capturedHtml).toContain('17,000.00');
      expect(capturedHtml).toContain('1,190.00');
      expect(capturedHtml).toContain('15,189.98');
      expect(capturedHtml).toContain('กรรมสิทธิ์เครื่องโอนให้ลูกค้า');
      expect(capturedHtml).toContain('ยกเลิกใบนี้ไม่ได้');
      expect(capturedHtml).not.toContain('เฉพาะงวดที่ยังไม่ถึงกำหนด');
      expect(capturedHtml).not.toContain('หักเงินรับล่วงหน้า');
      // ไม่ถอด 7/107 จากเงินที่รับแบบใบเดิม (15,189.98 → 14,196.24 / 993.74)
      expect(capturedHtml).not.toContain('993.74');
    });

    it('16.2 มีเงินพักค่าปรับดิว: แถวหัก −1,044.00 / −68.30 อ้างใบ 6a · ภาษีใบ 1,121.70 · ฐาน 16,024.30 · รวม 14,318.16', async () => {
      query.getReceipt.mockResolvedValue(payoffStored({
        amount: new Decimal('14318.16'), amountBeforeVat: new Decimal('16024.30'), vatAmount: new Decimal('1121.70'),
        advanceAmount: new Decimal('-1044.00'), advanceVatAmount: new Decimal('-68.30'), discountAmount: new Decimal('2827.84'),
        payoffContext: payoffContext({ parkRelief: '1044.00', advanceVatReversal: '68.30', parkReceiptNumber: 'RC-20260915-0012' }),
      }));
      await service.generatePDF('rcpt-ep-park');
      expect(capturedHtml).toContain('หักเงินพักค่าปรับดิวที่จ่ายไว้ล่วงหน้า');
      expect(capturedHtml).toContain('RC-20260915-0012');
      expect(capturedHtml).toContain('ภาษี 68.30 หักออกจากใบนี้');
      expect(capturedHtml).toContain('<strong>−1,044.00</strong>');
      expect(capturedHtml).toContain('−68.30');
      expect(capturedHtml).toContain('16,024.30');
      expect(capturedHtml).toContain('1,121.70');
      expect(capturedHtml).toContain('<strong>−2,827.84</strong>');
      expect(capturedHtml).toContain('14,318.16');
    });

    it('18.1 ค้าง 4 จาก 8 งวด: ป้ายงวดที่ถึงกำหนดแล้ว/ยังไม่ถึง · บรรทัดอธิบายส่วนลดเฉพาะงวด 9–12 · รวม 11,126.65', async () => {
      query.getReceipt.mockResolvedValue(payoffStored({
        amount: new Decimal('11126.65'), amountBeforeVat: new Decimal('11333.36'), vatAmount: new Decimal('793.32'),
        discountAmount: new Decimal('1000.03'),
        payoffContext: payoffContext({ unpaidInstallments: 8, firstNo: 5, lastNo: 12, receivableCleared: '12126.68', dueMonths: 4, notDueMonths: 4 }),
      }));
      await service.generatePDF('rcpt-ep-due');
      expect(capturedHtml).toContain('ค่างวดคงเหลือ 8 งวด (งวดที่ 5–12) — ปิดยอดสัญญา');
      expect(capturedHtml).toContain('ตามรายการบัญชี · งวดที่ถึงกำหนดแล้ว 5–8 · ยังไม่ถึงกำหนด 9–12');
      expect(capturedHtml).toContain('ส่วนลด 50% ของดอกเบี้ยเฉพาะงวดที่ยังไม่ถึงกำหนด 4 งวด (งวด 9–12) · งวดที่ถึงกำหนดแล้ว 4 งวดชำระเต็มจำนวน');
      expect(capturedHtml).toContain('<strong>−1,000.03</strong>');
      expect(capturedHtml).toContain('11,126.65');
    });

    it('งวดค้างไม่ต่อเนื่อง (ยกเลิกใบงวด 2 แล้วปิดยอด: ค้าง 2, 7–12 = 7 งวด) → พิมพ์จำนวนงวดอย่างเดียว ไม่พิมพ์ช่วง/การแบ่งงวด (ผู้ตรวจอิสระ I2)', async () => {
      query.getReceipt.mockResolvedValue(payoffStored({
        amount: new Decimal('9000.00'), amountBeforeVat: new Decimal('9916.73'), vatAmount: new Decimal('694.19'),
        discountAmount: new Decimal('1610.92'),
        payoffContext: payoffContext({ unpaidInstallments: 7, firstNo: 2, lastNo: 12, receivableCleared: '10610.92', dueMonths: 2, notDueMonths: 5 }),
      }));
      await service.generatePDF('rcpt-ep-gap');
      expect(capturedHtml).toContain('ค่างวดคงเหลือ 7 งวด — ปิดยอดสัญญา');
      expect(capturedHtml).not.toContain('(งวดที่ 2–12)');
      expect(capturedHtml).not.toContain('ถึงกำหนดแล้ว 2–3');
      expect(capturedHtml).toContain('ส่วนลด 50% ของดอกเบี้ยเฉพาะงวดที่ยังไม่ถึงกำหนด 5 งวด · งวดที่ถึงกำหนดแล้ว 2 งวดชำระเต็มจำนวน');
      expect(capturedHtml).not.toContain('(งวด 8–12)');
    });

    it('ใบปิดยอดเก่า (ไม่เก็บค่า · ไม่มี payoffContext) → พิมพ์แบบเดิม ไม่มีแถวส่วนลด', async () => {
      query.getReceipt.mockResolvedValue(payoffStored({
        amount: new Decimal('17339.96'), amountBeforeVat: null, vatAmount: null, roundingAmount: null, lateFeeAmount: null,
        lateFeeWaivedAmount: null, advanceAmount: null, advanceVatAmount: null, discountAmount: null,
        sourceJournalEntryId: null, payoffContext: null,
      }));
      await service.generatePDF('rcpt-ep-legacy');
      expect(capturedHtml).toContain('16,205.57');
      expect(capturedHtml).toContain('1,134.39');
      expect(capturedHtml).not.toContain('ส่วนลดดอกเบี้ยปิดยอด');
      expect(capturedHtml).not.toContain('— ปิดยอดสัญญา');
      expect(capturedHtml).not.toContain('ยกเลิกใบนี้ไม่ได้');
    });
  });

  describe('PR4ข — ใบปรับดิว 6a เป็นใบกำกับภาษี · ใบรับเงินส่วนเกินลิงก์ชำระ', () => {
    const stored6a = (overrides: Record<string, unknown> = {}) =>
      baseReceipt({
        receiptType: 'RESCHEDULE_FEE',
        amount: new Decimal('1566'),
        amountBeforeVat: new Decimal('1416.82'),
        vatAmount: new Decimal('99.18'),
        roundingAmount: new Decimal('0'),
        lateFeeAmount: new Decimal('50'),
        lateFeeWaivedAmount: new Decimal('0'),
        advanceAmount: new Decimal('1516'),
        advanceVatAmount: new Decimal('99.18'),
        installmentNo: 4,
        paymentId: 'p4',
        paymentMethod: 'BANK_TRANSFER',
        transactionRef: 'SLIP-1',
        paidDate: new Date('2026-10-12T17:00:00.000Z'),
        lateFeeCollected: '50.00',
        lateFeeWaivedThisReceipt: '0.00',
        hasReceiptFeeHistory: true,
        paymentCase: 'RESCHEDULE',
        installmentAllocations: [{ installmentNo: 12, amount: '1516.00', kind: 'RESCHEDULE_ADVANCE' }],
        documentRemainingBalance: '12126.47',
        documentRemainingMonths: 9,
        documentInstallmentAmountDue: '1515.83',
        documentInstallmentAmountPaid: '0.00',
        documentUnappliedFunds: '1516.00',
        rescheduleContext: { installmentNo: 4, daysToShift: 30, newDueDate: '2026-11-11T17:00:00.000Z' },
        surplusContext: null,
        ...overrides,
      });

    it('ใบ 6a ที่เก็บค่า → ใบกำกับภาษี: แถวเงินพักงวด 12/12 1,416.82 / 99.18 / 1,516.00 · ค่าปรับ 50 ยกเว้น · กล่องเตือน · สรุป · บรรทัดเลื่อนนัด · เงินรับล่วงหน้าค้าง', async () => {
      query.getReceipt.mockResolvedValue(stored6a());
      await service.generatePDF('r-6a');

      expect(capturedHtml).toContain('ใบเสร็จรับเงิน / ใบกำกับภาษี');
      expect(capturedHtml).toContain('งวดที่รับล่วงหน้า</strong> 12 จาก 12 งวด');
      expect(capturedHtml).toContain('เงินรับล่วงหน้างวดที่ 12/12 — ปรับดิว');
      expect(capturedHtml).toContain('ค่าธรรมเนียมเลื่อนนัดชำระ · พักไว้หักค่างวดสุดท้าย');
      expect(capturedHtml).toContain('<td class="right">1,416.82</td>');
      expect(capturedHtml).toContain('<td class="right">99.18</td>');
      expect(capturedHtml).toContain('<strong>1,516.00</strong>');
      expect(capturedHtml).toContain('ค่าปรับชำระล่าช้า');
      expect(capturedHtml).toContain('<strong>50.00</strong>');
      expect(capturedHtml).toContain('มูลค่าสินค้า/บริการก่อนภาษี');
      expect(capturedHtml).toContain('ค่าปรับ (ยกเว้นภาษี)');
      expect(capturedHtml).toContain('1,566.00');
      expect(capturedHtml).toMatch(/เลื่อนนัดชำระ<\/strong> งวดที่ 4 เลื่อน 30 วัน เป็น 12\/11\/(2569|2026)</);
      expect(capturedHtml).toContain('เงินรับล่วงหน้า 1,516.00 บาท');
      expect(capturedHtml).toContain('พักไว้หักค่างวดสุดท้าย (งวดที่ 12)');
      expect(capturedHtml).toContain('ใบงวดสุดท้ายไม่คิดภาษีซ้ำ');
      expect(capturedHtml).toContain('12,126.47 บาท');
      expect(capturedHtml).toContain('เงินรับล่วงหน้าค้าง');
      expect(capturedHtml).toContain('1,516.00 บาท (พักหักงวดที่ 12)');
      expect(capturedHtml).not.toContain('ค่างวดเช่าซื้อ งวดที่');
    });

    it('ใบ 6a รายการเก่าที่ไม่มีวันครบกำหนดใหม่ → บรรทัดเลื่อนนัดไม่พิมพ์วันที่ (ไม่เดา)', async () => {
      query.getReceipt.mockResolvedValue(
        stored6a({ rescheduleContext: { installmentNo: 4, daysToShift: 30, newDueDate: null } }),
      );
      await service.generatePDF('r-6a-old-je');

      expect(capturedHtml).toContain('เลื่อนนัดชำระ</strong> งวดที่ 4 เลื่อน 30 วัน<');
      expect(capturedHtml).not.toContain('เลื่อน 30 วัน เป็น');
    });

    it('ใบ 6a เก่าที่ไม่มีค่าที่เก็บ (forward-only) → ไม่มีคำว่าใบกำกับภาษี · ไม่มีกล่องเตือน · ไม่มีแถวเงินรับล่วงหน้าค้าง', async () => {
      query.getReceipt.mockResolvedValue(
        installmentDocument({
          receiptType: 'RESCHEDULE_FEE',
          amount: new Decimal('1144'),
          lateFeeCollected: '100.00',
          lateFeeWaivedThisReceipt: '0.00',
          installmentAllocations: [{ installmentNo: 10, amount: '1044.00', kind: 'RESCHEDULE_ADVANCE' }],
          documentRemainingBalance: '30260.00',
          documentRemainingMonths: 7,
          documentUnappliedFunds: null,
          // ใบ 6a เก่าก็ผูกรายการมาตั้งแต่ base ⇒ query คืน context ได้ (daysToShift มี · newDueDate ไม่มี) —
          // ใบเก่าต้องพิมพ์เหมือนเดิมทุกตัวอักษร จึงห้ามพิมพ์บรรทัด "เลื่อนนัดชำระ" (final review I1)
          rescheduleContext: { installmentNo: 4, daysToShift: 30, newDueDate: null },
          surplusContext: null,
        }),
      );
      await service.generatePDF('legacy-6a');

      expect(capturedHtml).not.toContain('ใบเสร็จรับเงิน / ใบกำกับภาษี');
      expect(capturedHtml).not.toContain('ภาษีมูลค่าเพิ่มรับรู้ ณ วันรับเงินนี้แล้ว');
      expect(capturedHtml).not.toContain('เงินรับล่วงหน้าค้าง');
      expect(capturedHtml).not.toContain('เลื่อนนัดชำระ');
      expect(capturedHtml).toContain('เงินรับล่วงหน้างวดที่ 10/10 — ปรับดิว');
    });

    it('ใบส่วนเกินลิงก์ชำระ (ADVANCE_SURPLUS) → ใบกำกับภาษี: แถวเงินรับล่วงหน้าในสัญญา 467.29 / 32.71 / 500 · บรรทัดชำระผ่านลิงก์ · กล่องเตือน (งวดที่ 6) · ผู้ออก ระบบ (ลิงก์ชำระ) · เงินรับล่วงหน้าค้าง', async () => {
      query.getReceipt.mockResolvedValue(
        baseReceipt({
          receiptType: 'ADVANCE_SURPLUS',
          amount: new Decimal('500'),
          amountBeforeVat: new Decimal('467.29'),
          vatAmount: new Decimal('32.71'),
          roundingAmount: new Decimal('0'),
          lateFeeAmount: new Decimal('0'),
          lateFeeWaivedAmount: new Decimal('0'),
          advanceAmount: new Decimal('500'),
          advanceVatAmount: new Decimal('32.71'),
          installmentNo: null,
          paymentId: null,
          paymentMethod: 'ONLINE_GATEWAY',
          transactionRef: 'REF-9',
          paidDate: new Date('2026-10-12T17:00:00.000Z'),
          issuer: { name: 'Admin Owner', role: 'OWNER' },
          installmentAllocations: null,
          documentRemainingBalance: '10610.81',
          documentRemainingMonths: 7,
          documentInstallmentAmountDue: null,
          documentInstallmentAmountPaid: null,
          documentUnappliedFunds: '500.00',
          rescheduleContext: null,
          surplusContext: {
            refno: 'REF-9',
            paidAmount: '2015.83',
            appliedAmount: '1515.83',
            installmentNos: [5],
            nextInstallmentNo: 6,
            siblingReceipts: [{ receiptNumber: 'RT-202610-00033', installmentNo: 5 }],
          },
        }),
      );
      await service.generatePDF('r-surplus');

      expect(capturedHtml).toContain('ใบเสร็จรับเงิน / ใบกำกับภาษี');
      expect(capturedHtml).toContain('เงินรับล่วงหน้าในสัญญา');
      expect(capturedHtml).toContain('ชำระเกินผ่านลิงก์ชำระ (Pay Solutions) · หักเข้างวดถัดไปอัตโนมัติ');
      expect(capturedHtml).toContain('<td class="right">467.29</td>');
      expect(capturedHtml).toContain('<td class="right">32.71</td>');
      expect(capturedHtml).toContain('<strong>500.00</strong>');
      expect(capturedHtml).toContain(
        'ชำระผ่านลิงก์</strong> งวดที่ 5 (ใบ RT-202610-00033) · ยอดโอน 2,015.83 · เข้างวด 1,515.83 · ส่วนเกิน 500.00',
      );
      expect(capturedHtml).toContain('เงินส่วนเกิน 500.00 บาท');
      expect(capturedHtml).toContain('(งวดที่ 6)');
      expect(capturedHtml).toContain('ไม่ต้องติดต่อร้านเพื่อขอคืน');
      expect(capturedHtml).toContain('ระบบ (ลิงก์ชำระ)');
      expect(capturedHtml).toContain('10,610.81 บาท');
      expect(capturedHtml).toContain('เงินรับล่วงหน้าค้าง');
      expect(capturedHtml).toContain('500.00 บาท (หักงวดถัดไป)');
      expect(capturedHtml).not.toContain('งวดที่ชำระ');
      expect(capturedHtml).not.toContain('ค่างวดเช่าซื้อ');
      expect(capturedHtml).not.toContain('ค่าปรับชำระล่าช้า');
    });

    it('ใบส่วนเกินลิงก์ชำระที่ลิงก์ครอบหลายงวด (ใบรับชำระ 12 ใบ) → บรรทัดชำระผ่านลิงก์พิมพ์เป็นช่วง "งวดที่ 1 ถึง 12 (12 งวด)" ไม่ไล่เลขใบ (กันใบล้นเป็น 2 หน้า)', async () => {
      const siblingReceipts = Array.from({ length: 12 }, (_, i) => ({
        receiptNumber: `RT-202610-${String(100 + i)}`,
        installmentNo: i + 1,
      }));
      query.getReceipt.mockResolvedValue(
        baseReceipt({
          receiptType: 'ADVANCE_SURPLUS',
          amount: new Decimal('500'),
          amountBeforeVat: new Decimal('467.29'),
          vatAmount: new Decimal('32.71'),
          roundingAmount: new Decimal('0'),
          lateFeeAmount: new Decimal('0'),
          lateFeeWaivedAmount: new Decimal('0'),
          advanceAmount: new Decimal('500'),
          advanceVatAmount: new Decimal('32.71'),
          installmentNo: null,
          paymentId: null,
          paymentMethod: 'ONLINE_GATEWAY',
          transactionRef: 'REF-12',
          paidDate: new Date('2026-10-12T17:00:00.000Z'),
          issuer: { name: 'Admin Owner', role: 'OWNER' },
          installmentAllocations: null,
          documentRemainingBalance: '0.00',
          documentRemainingMonths: 0,
          documentInstallmentAmountDue: null,
          documentInstallmentAmountPaid: null,
          documentUnappliedFunds: '500.00',
          rescheduleContext: null,
          surplusContext: {
            refno: 'REF-12',
            paidAmount: '18690.00',
            appliedAmount: '18190.00',
            installmentNos: siblingReceipts.map((r) => r.installmentNo),
            nextInstallmentNo: null,
            siblingReceipts,
          },
        }),
      );
      await service.generatePDF('r-surplus-12');

      expect(capturedHtml).toContain(
        'ชำระผ่านลิงก์</strong> งวดที่ 1 ถึง 12 (12 งวด) · ยอดโอน 18,690.00 · เข้างวด 18,190.00 · ส่วนเกิน 500.00',
      );
      expect(capturedHtml).not.toContain('RT-202610-100');
      expect(capturedHtml).not.toContain('RT-202610-111');
    });

    it('ใบส่วนเกินลิงก์ชำระ เมื่อไม่มีงวดถัดไป (เงินครอบทุกงวดแล้ว — กรณีจริงของส่วนเกิน): ไม่อ้างว่าจะหักเข้างวดถัดไป · ยังบอกว่าเก็บเป็นเงินรับล่วงหน้า + ไม่ต้องขอคืน', async () => {
      query.getReceipt.mockResolvedValue(
        baseReceipt({
          receiptType: 'ADVANCE_SURPLUS',
          amount: new Decimal('500'),
          amountBeforeVat: new Decimal('467.29'),
          vatAmount: new Decimal('32.71'),
          roundingAmount: new Decimal('0'),
          lateFeeAmount: new Decimal('0'),
          lateFeeWaivedAmount: new Decimal('0'),
          advanceAmount: new Decimal('500'),
          advanceVatAmount: new Decimal('32.71'),
          installmentNo: null,
          paymentId: null,
          paymentMethod: 'ONLINE_GATEWAY',
          transactionRef: 'REF-10',
          paidDate: new Date('2026-10-12T17:00:00.000Z'),
          issuer: { name: 'Admin Owner', role: 'OWNER' },
          installmentAllocations: null,
          documentRemainingBalance: '0.00',
          documentRemainingMonths: 0,
          documentInstallmentAmountDue: null,
          documentInstallmentAmountPaid: null,
          documentUnappliedFunds: '500.00',
          rescheduleContext: null,
          surplusContext: {
            refno: 'REF-10',
            paidAmount: '2015.83',
            appliedAmount: '1515.83',
            installmentNos: [12],
            nextInstallmentNo: null,
            siblingReceipts: [{ receiptNumber: 'RT-202610-00040', installmentNo: 12 }],
          },
        }),
      );
      await service.generatePDF('r-surplus-last');

      expect(capturedHtml).toContain('ใบเสร็จรับเงิน / ใบกำกับภาษี');
      expect(capturedHtml).toContain('ชำระเกินผ่านลิงก์ชำระ (Pay Solutions)</div>');
      expect(capturedHtml).toContain('เงินส่วนเกิน 500.00 บาท จากการชำระผ่านลิงก์ เก็บไว้เป็นเงินรับล่วงหน้าของสัญญา');
      expect(capturedHtml).toContain('ภาษีมูลค่าเพิ่มรับรู้แล้ว');
      expect(capturedHtml).toContain('ไม่ต้องติดต่อร้านเพื่อขอคืน');
      expect(capturedHtml).toContain('500.00 บาท</span>');
      expect(capturedHtml).not.toContain('หักเข้างวดถัดไป');
      expect(capturedHtml).not.toContain('หักงวดถัดไป');
      expect(capturedHtml).not.toContain('(งวดที่ ');
    });
  });
});

