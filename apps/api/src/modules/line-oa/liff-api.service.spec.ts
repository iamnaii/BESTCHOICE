import { Test, TestingModule } from '@nestjs/testing';
import { LiffApiService } from './liff-api.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

describe('LiffApiService', () => {
  let service: LiffApiService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // tx ของ unlinkLineAccount — แยกจาก prisma เพื่อพิสูจน์ว่าเขียนในธุรกรรมเดียวกัน
  let tx: {
    $queryRaw: jest.Mock;
    customer: { findMany: jest.Mock; updateMany: jest.Mock };
    customerLineLink: { updateMany: jest.Mock; findMany: jest.Mock };
    chatRoom: { updateMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      customer: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      loyaltyPoint: {
        aggregate: jest.fn(),
      },
      paymentLink: {
        count: jest.fn(),
      },
      contract: {
        findFirst: jest.fn(),
      },
      receipt: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      // Task 22 I-1 (ก) — ตัวตนของทุกหน้า LIFF การเงิน = แถว OTP ช่อง FINANCE ที่ยังผูก (ค่าเริ่ม: LINE นี้ผูกกับ cust1)
      customerLineLink: {
        findFirst: jest.fn().mockResolvedValue({ customerId: 'cust1' }),
      },
      $transaction: jest.fn(),
    };
    tx = {
      // Task 29 — unlinkFinanceLine ล็อกแถวลูกค้า (ผู้ถือแถว link + ผู้ถือคอลัมน์) ก่อนแถว link/ห้อง
      $queryRaw: jest.fn().mockResolvedValue([]),
      customer: {
        findMany: jest.fn().mockResolvedValue([{ id: 'cust1' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      customerLineLink: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ customerId: 'cust1' }]),
      },
      chatRoom: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (cb: (client: typeof tx) => unknown) => cb(tx));

    const module: TestingModule = await Test.createTestingModule({
      providers: [LiffApiService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<LiffApiService>(LiffApiService);
  });

  // ─── findCustomerContractsFull ───────────────────────

  describe('findCustomerContractsFull', () => {
    it('returns null when customer not found', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      const result = await service.findCustomerContractsFull('U_nonexistent');
      expect(result).toBeNull();
    });

    it('returns formatted contracts with payment summaries', async () => {
      prisma.customer.findFirst.mockResolvedValue({
        id: 'cust1',
        name: 'สมชาย',
        contracts: [
          {
            id: 'con1',
            contractNumber: 'BC-2026-0001',
            status: 'ACTIVE',
            sellingPrice: new Prisma.Decimal('15000.00'),
            downPayment: new Prisma.Decimal('3000.00'),
            monthlyPayment: new Prisma.Decimal('2000.00'),
            totalMonths: 6,
            createdAt: new Date('2026-01-15'),
            product: { name: 'iPhone 15', brand: 'Apple', model: 'iPhone 15' },
            payments: [
              {
                id: 'p1',
                installmentNo: 1,
                dueDate: new Date('2026-02-15'),
                amountDue: new Prisma.Decimal('2000'),
                amountPaid: new Prisma.Decimal('2000'),
                lateFee: new Prisma.Decimal('0'),
                status: 'PAID',
                paidDate: new Date('2026-02-14'),
                paymentMethod: 'BANK_TRANSFER',
              },
              {
                id: 'p2',
                installmentNo: 2,
                dueDate: new Date('2026-03-15'),
                amountDue: new Prisma.Decimal('2000'),
                amountPaid: new Prisma.Decimal('0'),
                lateFee: new Prisma.Decimal('100'),
                status: 'OVERDUE',
                paidDate: null,
                paymentMethod: null,
              },
            ],
          },
        ],
      });

      const result = await service.findCustomerContractsFull('U_line123');
      expect(result).not.toBeNull();
      expect(result!.customer.name).toBe('สมชาย');
      expect(result!.contracts).toHaveLength(1);

      const c = result!.contracts[0];
      expect(c.contractNumber).toBe('BC-2026-0001');
      expect(c.product).toBe('Apple iPhone 15');
      expect(c.sellingPrice).toBe(15000);
      expect(c.paidInstallments).toBe(1);
      // Outstanding: 2000 + 100 - 0 = 2100
      expect(c.totalOutstanding).toBe(2100);
      expect(c.payments).toHaveLength(2);
      expect(c.payments[0].status).toBe('PAID');
      expect(c.payments[1].lateFee).toBe(100);
    });

    it('handles product with no brand (falls back to name)', async () => {
      prisma.customer.findFirst.mockResolvedValue({
        id: 'cust1',
        name: 'ทดสอบ',
        contracts: [
          {
            id: 'con1',
            contractNumber: 'BC-0001',
            status: 'ACTIVE',
            sellingPrice: new Prisma.Decimal('5000'),
            downPayment: new Prisma.Decimal('1000'),
            monthlyPayment: new Prisma.Decimal('500'),
            totalMonths: 8,
            createdAt: new Date(),
            product: { name: 'มือถือมือสอง', brand: null, model: null },
            payments: [],
          },
        ],
      });

      const result = await service.findCustomerContractsFull('U_line');
      expect(result!.contracts[0].product).toBe('มือถือมือสอง');
    });

    it('handles null product gracefully', async () => {
      prisma.customer.findFirst.mockResolvedValue({
        id: 'cust1',
        name: 'ทดสอบ',
        contracts: [
          {
            id: 'con1',
            contractNumber: 'BC-0001',
            status: 'ACTIVE',
            sellingPrice: new Prisma.Decimal('5000'),
            downPayment: new Prisma.Decimal('1000'),
            monthlyPayment: new Prisma.Decimal('500'),
            totalMonths: 8,
            createdAt: new Date(),
            product: null,
            payments: [],
          },
        ],
      });

      const result = await service.findCustomerContractsFull('U_line');
      expect(result!.contracts[0].product).toBe('-');
    });
  });

  // การผูก LINE (lookupCustomerByPhone / confirmLinkLine / isLineIdLinked) ถูกถอดออกจาก service นี้
  // (Task 19 — ผูกได้โดยไม่มี OTP) · ทางผูกเดียวคือ VerificationService (verification.service.spec.ts)

  // ─── findCustomerPaymentHistory ─────────────────────

  describe('findCustomerPaymentHistory', () => {
    it('returns null when customer not found', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      expect(await service.findCustomerPaymentHistory('U_line')).toBeNull();
    });

    it('returns sorted payment history across contracts', async () => {
      prisma.customer.findFirst.mockResolvedValue({
        name: 'สมชาย',
        contracts: [
          {
            contractNumber: 'BC-001',
            payments: [
              {
                id: 'pay-1',
                installmentNo: 1,
                amountPaid: new Prisma.Decimal('2000'),
                paidDate: new Date('2026-02-01'),
                paymentMethod: 'CASH',
                lateFee: new Prisma.Decimal('0'),
              },
              {
                id: 'pay-2',
                installmentNo: 2,
                amountPaid: new Prisma.Decimal('2000'),
                paidDate: new Date('2026-03-01'),
                paymentMethod: 'BANK_TRANSFER',
                lateFee: new Prisma.Decimal('50'),
              },
            ],
          },
          {
            contractNumber: 'BC-002',
            payments: [
              {
                id: 'pay-3',
                installmentNo: 1,
                amountPaid: new Prisma.Decimal('1500'),
                paidDate: new Date('2026-02-15'),
                paymentMethod: 'PROMPTPAY',
                lateFee: new Prisma.Decimal('0'),
              },
            ],
          },
        ],
      });
      // Receipts issued for pay-1 and pay-3 only
      prisma.receipt.findMany.mockResolvedValue([
        { id: 'rc-a', paymentId: 'pay-1' },
        { id: 'rc-c', paymentId: 'pay-3' },
      ]);

      const result = await service.findCustomerPaymentHistory('U_line');
      expect(result).not.toBeNull();
      expect(result!.payments).toHaveLength(3);
      // Sorted descending by paidDate
      expect(result!.payments[0].contractNumber).toBe('BC-001'); // Mar 1
      expect(result!.payments[0].installmentNo).toBe(2);
      expect(result!.payments[1].contractNumber).toBe('BC-002'); // Feb 15
      expect(result!.payments[2].contractNumber).toBe('BC-001'); // Feb 1
      // Decimal → number conversion
      expect(result!.payments[2].amountPaid).toBe(2000);
      expect(result!.payments[0].lateFee).toBe(50);
      // Receipt IDs joined: pay-1 → rc-a, pay-3 → rc-c, pay-2 → null (no receipt)
      expect(result!.payments[0].receiptId).toBeNull(); // pay-2 (Mar 1)
      expect(result!.payments[1].receiptId).toBe('rc-c'); // pay-3 (Feb 15)
      expect(result!.payments[2].receiptId).toBe('rc-a'); // pay-1 (Feb 1)
    });
  });

  // ─── findCustomerProfile ────────────────────────────

  describe('findCustomerProfile', () => {
    it('returns null when customer not found', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      expect(await service.findCustomerProfile('U_line')).toBeNull();
    });

    it('returns profile with contract count and loyalty points', async () => {
      prisma.customer.findFirst.mockResolvedValue({
        id: 'cust1',
        name: 'สมชาย',
        phone: '0812345678',
        _count: { contracts: 3 },
      });
      prisma.loyaltyPoint.aggregate.mockResolvedValue({
        _sum: { points: 150 },
      });

      const result = await service.findCustomerProfile('U_line');
      expect(result).toEqual({
        name: 'สมชาย',
        phone: '0812345678',
        lineDisplayName: '-',
        contractCount: 3,
        totalPoints: 150,
      });
    });

    it('handles null phone and zero points', async () => {
      prisma.customer.findFirst.mockResolvedValue({
        id: 'cust1',
        name: 'ทดสอบ',
        phone: null,
        _count: { contracts: 0 },
      });
      prisma.loyaltyPoint.aggregate.mockResolvedValue({ _sum: { points: null } });

      const result = await service.findCustomerProfile('U_line');
      expect(result!.phone).toBe('-');
      expect(result!.totalPoints).toBe(0);
    });
  });

  // ─── unlinkLineAccount ──────────────────────────────

  describe('unlinkLineAccount', () => {
    it('returns error if no customer linked', async () => {
      prisma.customerLineLink.findFirst.mockResolvedValue(null);
      prisma.customer.findFirst.mockResolvedValue(null);
      const result = await service.unlinkLineAccount('U_line');
      expect(result.success).toBe(false);
      expect(result.error).toContain('ไม่พบบัญชี');
    });

    it('unlinks: ล้าง lineIdFinance บนทุกลูกค้าที่ถือ LINE นี้ (ค่าซ้ำบนคนที่สองต้องไม่ค้าง — Task 19 review M1)', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust1', name: 'สมชาย' });

      const result = await service.unlinkLineAccount('U_line');
      expect(result.success).toBe(true);
      expect(tx.customer.updateMany).toHaveBeenCalledWith({
        where: { lineIdFinance: 'U_line' },
        data: { lineIdFinance: null },
      });
    });

    it('ปิดแถว customer_line_links (FINANCE) ของ LINE นี้ในธุรกรรมเดียวกัน — ผูกกลับด้วย OTP ได้ (ไม่ค้าง "ยืนยันแล้ว")', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust1', name: 'สมชาย' });

      await service.unlinkLineAccount('U_line');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.customerLineLink.updateMany).toHaveBeenCalledWith({
        where: { lineUserId: 'U_line', channel: 'FINANCE', unlinkedAt: null },
        data: { unlinkedAt: expect.any(Date) },
      });
      // เขียนผ่าน tx เท่านั้น ไม่ใช่ client หลัก
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });

    it('Task 24 M-8: ล้าง verified_at ของห้อง LINE การเงิน (ของ LINE นี้ + ของลูกค้าที่ถือแถว) ในธุรกรรมเดียวกัน — แม่แบบ verifiedOnly หยุดส่ง', async () => {
      await service.unlinkLineAccount('U_line');
      expect(tx.chatRoom.updateMany).toHaveBeenCalledWith({
        where: {
          channel: 'LINE_FINANCE',
          verifiedAt: { not: null },
          OR: [{ lineUserId: { in: ['U_line'] } }, { customerId: { in: ['cust1'] } }],
        },
        data: { verifiedAt: null, financeLineUnlinkedAt: expect.any(Date) },
      });
    });

    it('ไม่พบลูกค้าที่ผูก LINE นี้ → ไม่เปิดธุรกรรม ไม่ปิดแถวใด', async () => {
      prisma.customerLineLink.findFirst.mockResolvedValue(null);
      prisma.customer.findFirst.mockResolvedValue(null);
      await service.unlinkLineAccount('U_line');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('Task 22 I-1: ไม่มีแถว OTP แต่คอลัมน์ค้างค่า LINE นี้ → ยังล้างได้ (เจ้าของ LINE ล้างค่าค้างของตัวเอง)', async () => {
      prisma.customerLineLink.findFirst.mockResolvedValue(null);
      prisma.customer.findFirst.mockResolvedValue({ id: 'stale-1' });
      await expect(service.unlinkLineAccount('U_line')).resolves.toEqual({ success: true });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Task 22 I-1 (ก): ตัวตน = แถว OTP ไม่ใช่คอลัมน์ ──────

  describe('Task 22 I-1 (ก) — LIFF การเงินหาลูกค้าจากแถว OTP ที่ยังผูกเท่านั้น', () => {
    const noLink = () => prisma.customerLineLink.findFirst.mockResolvedValue(null);
    const byColumn = () =>
      prisma.customer.findFirst.mock.calls.filter(
        (c: [{ where?: Record<string, unknown> }]) => c[0]?.where && 'lineIdFinance' in c[0].where,
      );

    it('ค้นแถว OTP ช่อง FINANCE ที่ยังผูก ของลูกค้าที่ยังไม่ถูกลบ ด้วย LINE จาก LiffTokenGuard', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust1', name: 'สมชาย' });
      await service.findCustomerByLineId('U_line');
      expect(prisma.customerLineLink.findFirst.mock.calls[0][0].where).toEqual({
        lineUserId: 'U_line',
        channel: 'FINANCE',
        unlinkedAt: null,
        deletedAt: null,
        customer: { deletedAt: null },
      });
      expect(prisma.customer.findFirst.mock.calls[0][0].where).toEqual({
        id: 'cust1',
        deletedAt: null,
      });
      expect(byColumn()).toHaveLength(0);
    });

    it.each([
      ['findCustomerContractsFull', (s: LiffApiService) => s.findCustomerContractsFull('U_line')],
      ['findCustomerPaymentHistory', (s: LiffApiService) => s.findCustomerPaymentHistory('U_line')],
      ['findCustomerProfile', (s: LiffApiService) => s.findCustomerProfile('U_line')],
      ['findCustomerByLineId', (s: LiffApiService) => s.findCustomerByLineId('U_line')],
      ['getConsentStatus', (s: LiffApiService) => s.getConsentStatus('U_line')],
      ['getNotificationPreferences', (s: LiffApiService) => s.getNotificationPreferences('U_line')],
    ])(
      '%s: ไม่มีแถว OTP (คอลัมน์ค้าง/พนักงานพิมพ์) → null ไม่อ่านลูกค้าตามคอลัมน์',
      async (_name, call) => {
        noLink();
        // ถ้ายังค้นด้วยคอลัมน์ จะได้ลูกค้าคนนี้กลับมา
        prisma.customer.findFirst.mockResolvedValue({
          id: 'victim',
          name: 'เหยื่อ',
          contracts: [],
        });
        await expect(call(service)).resolves.toBeNull();
        expect(byColumn()).toHaveLength(0);
      },
    );

    it.each([
      ['updateConsent', (s: LiffApiService) => s.updateConsent('U_line', true)],
      [
        'updateNotificationPreferences',
        (s: LiffApiService) =>
          s.updateNotificationPreferences('U_line', {
            paymentReminder: true,
            overdueNotice: true,
            receiptNotification: true,
          }),
      ],
    ])('%s: ไม่มีแถว OTP → ไม่แก้ลูกค้าคนใด', async (_name, call) => {
      noLink();
      prisma.customer.findFirst.mockResolvedValue({ id: 'victim' });
      await expect(call(service)).resolves.toMatchObject({ success: false });
      expect(prisma.customer.update).not.toHaveBeenCalled();
      expect(byColumn()).toHaveLength(0);
    });

    it('resolveDownloadDocumentId (ตั๋ว PDF): ไม่มีแถว OTP → 404 แม้คอลัมน์ของลูกค้าอื่นถือ LINE นี้', async () => {
      noLink();
      prisma.customer.findFirst.mockResolvedValue({ id: 'victim', name: 'เหยื่อ' });
      await expect(
        service.resolveDownloadDocumentId('U_line', 'contract-document', 'k1'),
      ).rejects.toThrow('ไม่พบข้อมูลลูกค้า');
    });
  });

  // ─── resolveDownloadDocumentId (Task 22 M-3) ─────────

  describe('resolveDownloadDocumentId', () => {
    beforeEach(() => {
      prisma.receipt.findFirst = jest.fn();
      prisma.eDocument = { findFirst: jest.fn() };
    });

    it('LINE ไม่ผูกลูกค้า → 404 ไม่พบข้อมูลลูกค้า', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      await expect(service.resolveDownloadDocumentId('U_line', 'receipt', 'r1')).rejects.toThrow(
        'ไม่พบข้อมูลลูกค้า',
      );
    });

    it('ใบเสร็จ: ค้นเฉพาะใบที่ยังไม่ยกเลิกของสัญญาของลูกค้าคนนี้ → id ของ eDocument ตามไฟล์', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust1', name: 'x' });
      prisma.receipt.findFirst.mockResolvedValue({ id: 'r1', fileUrl: 'receipts/r1.pdf' });
      prisma.eDocument.findFirst.mockResolvedValue({ id: 'edoc-r1' });
      await expect(service.resolveDownloadDocumentId('U_line', 'receipt', 'r1')).resolves.toBe(
        'edoc-r1',
      );
      expect(prisma.receipt.findFirst.mock.calls[0][0].where).toEqual({
        id: 'r1',
        contract: { customerId: 'cust1', deletedAt: null },
        isVoided: false,
      });
      expect(prisma.eDocument.findFirst.mock.calls[0][0].where).toEqual({
        fileUrl: 'receipts/r1.pdf',
      });
    });

    it('ใบเสร็จของคนอื่น → 404 ไม่พบใบเสร็จ · ไม่มีไฟล์ → 404 ให้ติดต่อพนักงาน', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust1', name: 'x' });
      prisma.receipt.findFirst.mockResolvedValueOnce(null);
      await expect(service.resolveDownloadDocumentId('U_line', 'receipt', 'r9')).rejects.toThrow(
        'ไม่พบใบเสร็จ',
      );
      prisma.receipt.findFirst.mockResolvedValueOnce({ id: 'r1', fileUrl: null });
      await expect(service.resolveDownloadDocumentId('U_line', 'receipt', 'r1')).rejects.toThrow(
        'ใบเสร็จนี้ยังไม่มีไฟล์ PDF',
      );
    });

    it('สัญญา: ต้องเป็นสัญญาของลูกค้าคนนี้ → เอกสาร CONTRACT ล่าสุด', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust1', name: 'x' });
      prisma.contract.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.resolveDownloadDocumentId('U_line', 'contract-document', 'k9'),
      ).rejects.toThrow('ไม่พบสัญญา');
      prisma.contract.findFirst.mockResolvedValueOnce({ id: 'k1' });
      prisma.eDocument.findFirst.mockResolvedValue({ id: 'edoc-k1' });
      await expect(
        service.resolveDownloadDocumentId('U_line', 'contract-document', 'k1'),
      ).resolves.toBe('edoc-k1');
      expect(prisma.contract.findFirst.mock.calls[1][0].where).toEqual({
        id: 'k1',
        customerId: 'cust1',
        deletedAt: null,
      });
      expect(prisma.eDocument.findFirst.mock.calls[0][0]).toMatchObject({
        where: { contractId: 'k1', documentType: 'CONTRACT' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  // ─── getConsentStatus ────────────────────────────────

  describe('getConsentStatus', () => {
    it('returns null when customer not found', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      expect(await service.getConsentStatus('U_line')).toBeNull();
    });

    it('returns consent status', async () => {
      prisma.customer.findFirst.mockResolvedValue({
        chatConsent: true,
        chatConsentAt: new Date('2026-04-10'),
      });
      const result = await service.getConsentStatus('U_line');
      expect(result!.consent).toBe(true);
      expect(result!.consentAt).toBeTruthy();
    });

    // Task 33 fix round 1 (คำตัดสินเจ้าของข้อ 30) — ลูกค้าที่ยินยอมตอนผูก LINE (แถว GRANTED ของวัตถุประสงค์นี้) ไม่ต้องเห็นโมดัล chat_consent ซ้ำ
    it('ยินยอมตอนผูก LINE แล้ว (แถว pdpa_consents ของวัตถุประสงค์นี้) → consent = true แม้ chat_consent ยังเป็น false', async () => {
      prisma.customer.findFirst.mockResolvedValue({
        chatConsent: false,
        chatConsentAt: null,
        pdpaConsents: [{ grantedAt: new Date('2026-10-31T03:00:00.000Z'), createdAt: new Date() }],
      });
      const result = await service.getConsentStatus('U_line');
      expect(result).toEqual({ consent: true, consentAt: '2026-10-31T03:00:00.000Z' });
      expect(prisma.customer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            pdpaConsents: expect.objectContaining({
              where: {
                status: 'GRANTED',
                deletedAt: null,
                purposes: { has: 'แจ้งเตือนค่างวด ใบเสร็จ และข้อมูลสัญญาทาง LINE' },
              },
            }),
          }),
        }),
      );
    });

    it('ไม่มีทั้ง chat_consent และความยินยอมตอนผูก → consent = false (โมดัลยังขึ้น)', async () => {
      prisma.customer.findFirst.mockResolvedValue({
        chatConsent: false,
        chatConsentAt: null,
        pdpaConsents: [],
      });
      expect(await service.getConsentStatus('U_line')).toEqual({ consent: false, consentAt: null });
    });
  });

  // ─── updateConsent ──────────────────────────────────

  describe('updateConsent', () => {
    it('returns error if customer not found', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      const result = await service.updateConsent('U_line', true);
      expect(result.success).toBe(false);
    });

    it('grants consent with timestamp', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust1' });
      prisma.customer.update.mockResolvedValue({});

      const result = await service.updateConsent('U_line', true);
      expect(result.success).toBe(true);
      const updateArg = prisma.customer.update.mock.calls[0][0];
      expect(updateArg.data.chatConsent).toBe(true);
      expect(updateArg.data.chatConsentAt).toBeInstanceOf(Date);
    });

    it('revokes consent but preserves timestamp (PDPA audit trail)', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust1' });
      prisma.customer.update.mockResolvedValue({});

      const result = await service.updateConsent('U_line', false);
      expect(result.success).toBe(true);
      const updateArg = prisma.customer.update.mock.calls[0][0];
      expect(updateArg.data.chatConsent).toBe(false);
      // chatConsentAt should be a Date, NOT null — preserves audit trail
      expect(updateArg.data.chatConsentAt).toBeInstanceOf(Date);
    });
  });

  // ─── Payment helpers ────────────────────────────────

  describe('findCustomerByLineId', () => {
    it('returns customer id and name', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust1', name: 'สมชาย' });
      const result = await service.findCustomerByLineId('U_line');
      expect(result).toEqual({ id: 'cust1', name: 'สมชาย' });
    });
  });

  describe('findContractForCustomer', () => {
    it('finds contract owned by customer', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'con1', contractNumber: 'BC-001' });
      const result = await service.findContractForCustomer('con1', 'cust1');
      expect(result).toBeTruthy();
      expect(prisma.contract.findFirst).toHaveBeenCalledWith({
        where: { id: 'con1', customerId: 'cust1', deletedAt: null },
      });
    });
  });

  describe('countRecentPaymentLinks', () => {
    it('counts links created in last 24 hours', async () => {
      prisma.paymentLink.count.mockResolvedValue(3);
      const result = await service.countRecentPaymentLinks('con1');
      expect(result).toBe(3);
    });
  });
});
