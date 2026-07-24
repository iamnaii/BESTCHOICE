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
});
