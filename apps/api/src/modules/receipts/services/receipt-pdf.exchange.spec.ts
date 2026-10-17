import { Decimal } from '@prisma/client/runtime/library';
import { ReceiptPdfService } from './receipt-pdf.service';
import { ReceiptQueryService } from './receipt-query.service';

let capturedHtml = '';
jest.mock('puppeteer', () => ({
  launch: jest.fn().mockResolvedValue({
    newPage: jest.fn().mockResolvedValue({
      setContent: jest.fn(async (html: string) => { capturedHtml = html; }),
      evaluate: jest.fn().mockResolvedValue(undefined),
      pdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
    }),
    close: jest.fn().mockResolvedValue(undefined),
  }),
}));

const company = { nameTh: 'บริษัท เบสท์ช้อยส์โฟน จำกัด', nameEn: null, taxId: '0165568000050', address: '-', phone: null, logoUrl: null, bankName: null, bankAccountName: null, bankAccountNumber: null };
const contract = {
  contractNumber: 'CT-2569-0418', productDisclosure: null, totalMonths: 12, financedAmount: new Decimal('10000'),
  storeCommission: new Decimal('1000'), interestTotal: new Decimal('6000'), vatAmount: new Decimal('1190'),
  customer: { name: 'ลูกค้าทดสอบ', phone: null, email: null, nationalId: null, addressIdCard: null, addressCurrent: null },
  branch: { id: 'b', name: 'ลาดพร้าว', location: null, phone: null }, product: { id: 'p', name: 'iPhone 14', imeiSerial: '1', serialNumber: null },
  parentContractId: 'ct-old', parentContract: { contractNumber: 'CT-2569-0412' },
};
const base = (overrides: Record<string, unknown>) => ({
  id: 'r', receiptNumber: 'RT-202610-00044', receiptType: 'CREDIT_NOTE', payerName: 'ลูกค้าทดสอบ', receiverName: 'FINANCE',
  payerAddress: null, payerTaxId: null, amount: new Decimal('1515.83'), amountBeforeVat: new Decimal('1416.66'), vatAmount: new Decimal('99.17'),
  roundingAmount: new Decimal(0), lateFeeAmount: new Decimal(0), lateFeeWaivedAmount: new Decimal(0), advanceAmount: new Decimal(0), advanceVatAmount: new Decimal(0),
  installmentNo: 1, paymentId: 'pay-1', voidedReceiptId: 'rc-31', paidDate: new Date('2026-10-15T00:00:00.000Z'), isVoided: false,
  paymentMethod: 'BANK_TRANSFER', transactionRef: null, remainingBalance: null, remainingMonths: null, paymentStatus: 'PENDING', priorReceiptCount: 0,
  voidedRef: { receiptNumber: 'RT-202610-00031', paidDate: new Date('2026-10-10T00:00:00.000Z') }, cnSource: 'DEFECT_EXCHANGE',
  installmentAllocations: [], advanceTargetInstallmentNo: null, payment: null, issuer: { name: 'ผจก.', role: 'BRANCH_MANAGER' },
  company, contract: { ...contract, contractNumber: 'CT-2569-0412' }, exchangeTarget: { contractNumber: 'CT-2569-0418' }, exchangeCreditSource: null,
  ...overrides,
});

describe('ReceiptPdfService — เอกสารเปลี่ยนเครื่องตำหนิ (mockup 7dMBBNTYVZLGDvgG1pk2Yo)', () => {
  let service: ReceiptPdfService;
  const query = { getReceipt: jest.fn() };
  beforeEach(() => { capturedHtml = ''; service = new ReceiptPdfService(query as unknown as ReceiptQueryService); });

  it('ใบลดหนี้ cnSource DEFECT_EXCHANGE: ข้อความกล่องเหลือง · รายการ · ผลของการลดหนี้ 3 บรรทัด · ม.86/10', async () => {
    query.getReceipt.mockResolvedValue(base({}));
    await service.generatePDF('r');
    expect(capturedHtml).toContain('ใบลดหนี้');
    expect(capturedHtml).toContain('เนื่องจากเปลี่ยนเครื่องตำหนิภายใน 7 วัน');
    expect(capturedHtml).toContain('โอนเป็นเครดิตของสัญญาใหม่ <strong>CT-2569-0418</strong>');
    expect(capturedHtml).toContain('ลดหนี้ — เปลี่ยนเครื่องตำหนิภายใน 7 วัน');
    expect(capturedHtml).toContain('ตามใบเสร็จ RT-202610-00031 · เหตุผล: เปลี่ยนเครื่องตำหนิภายใน 7 วัน (ม.82/10 (3))');
    expect(capturedHtml).toContain('<div class="heading">ผลของการลดหนี้</div>');
    expect(capturedHtml).toContain('<span class="k">เงินของลูกค้า</span><span class="v">1,515.83 บาท — ไม่คืนเงินสด</span>');
    expect(capturedHtml).toContain('<span class="k">โอนเป็นเครดิต</span><span class="v">สัญญาใหม่ CT-2569-0418</span>');
    expect(capturedHtml).toContain('<span class="k">ใช้เครดิต</span><span class="v">ชำระค่างวดของสัญญาใหม่ (ใบกำกับภาษีใหม่)</span>');
    expect(capturedHtml).toContain('ใบลดหนี้ตามมาตรา 86/10');
    expect(capturedHtml).not.toContain('งวดนี้กลับเป็นยอดค้างชำระ');
  });

  it('ใบลดหนี้ void ปกติ (cnSource null) ไม่เปลี่ยน', async () => {
    query.getReceipt.mockResolvedValue(base({ cnSource: null, exchangeTarget: null }));
    await service.generatePDF('r');
    expect(capturedHtml).toContain('ยอดตามใบเสร็จเดิมถูกกลับรายการทั้งจำนวน');
    expect(capturedHtml).toContain('กลับรายการ — งวดนี้กลับเป็นยอดค้างชำระ');
    expect(capturedHtml).not.toContain('เปลี่ยนเครื่องตำหนิ');
  });

  it('ใบใช้เครดิตของสัญญาใหม่: บรรทัดรอง · ที่มาของเครดิต · กล่องเหลือง · แถวในรายละเอียดสัญญา', async () => {
    query.getReceipt.mockResolvedValue(base({
      receiptNumber: 'RT-202610-00045', receiptType: 'INSTALLMENT', voidedReceiptId: null, voidedRef: null, cnSource: null,
      paymentMethod: 'CREDIT_BALANCE', paymentStatus: 'PAID', remainingBalance: new Decimal('16674.17'), remainingMonths: 11,
      contract, exchangeTarget: null,
      exchangeCreditSource: { parentContractNumber: 'CT-2569-0412', transferred: new Decimal('1515.83'), creditNotes: [{ number: 'RT-202610-00044', originalNumber: 'RT-202610-00031' }] },
    }));
    await service.generatePDF('r');
    expect(capturedHtml).toContain('ใบเสร็จรับเงิน / ใบกำกับภาษี');
    expect(capturedHtml).toContain('<div class="item-meta">เครดิตจากการเปลี่ยนเครื่องตำหนิ</div>');
    expect(capturedHtml).toContain('<span class="k">ที่มาของเครดิต</span><span class="v">สัญญาเดิม CT-2569-0412</span>');
    expect(capturedHtml).toContain('ชำระด้วยเครดิต 1,515.83 บาท ที่โอนมาจากสัญญาเดิม <strong>CT-2569-0412</strong>');
    expect(capturedHtml).toContain('(ใบลดหนี้ RT-202610-00044) — ไม่มีเงินสดรับเพิ่ม');
    expect(capturedHtml).toContain('<strong>เปลี่ยนเครื่องจากสัญญา</strong> CT-2569-0412</div>');
    // กล่องเหลืองอยู่ในคอลัมน์ซ้ายของยอดรวม (ข้าง "จำนวนเงินตัวอักษร") ตาม mockup กระดาน 2 — ไม่ใช่เหนือตารางรายการ
    expect(capturedHtml.indexOf('ชำระด้วยเครดิต 1,515.83 บาท')).toBeGreaterThan(capturedHtml.indexOf('จำนวนเงินตัวอักษร'));
    expect(capturedHtml).toContain('ใช้ยอดเครดิตในสัญญา');
  });

  it('ใบใช้เครดิตที่ไม่ได้มาจากการเปลี่ยนเครื่อง (exchangeCreditSource null) ไม่มีบรรทัดรอง', async () => {
    query.getReceipt.mockResolvedValue(base({ receiptType: 'INSTALLMENT', voidedReceiptId: null, voidedRef: null, cnSource: null, paymentMethod: 'CREDIT_BALANCE', contract, exchangeTarget: null, exchangeCreditSource: null }));
    await service.generatePDF('r');
    expect(capturedHtml).not.toContain('ที่มาของเครดิต');
    expect(capturedHtml).not.toContain('เครดิตจากการเปลี่ยนเครื่อง');
  });
});
