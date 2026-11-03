import { Prisma } from '@prisma/client';
import { PaymentLinkService } from './payment-link.service';

/**
 * Task 39 — ลิงก์ชำระรู้ว่าเงินของมันจ่ายอะไร (`PaymentLink.purpose`) ให้หน้า `/pay/:token` ตัดสินจากข้อมูลแทนการเดาจากยอด ·
 * ผู้เรียกบอกเองเมื่อส่งยอด: `INSTALLMENT` (ยอดคงค้างของงวด — ไม่ส่งยอด หรือส่งยอดของงวดที่ระบุ) · `PAYOFF` (ยอดปิดสัญญา) · `AMOUNT`
 * (ยอดที่ข้อความทวงบอก — ยอดค้างรวมแจ้งล็อก · ยอดนัด)
 */
describe('PaymentLinkService — purpose ของลิงก์', () => {
  const unpaid = {
    id: 'pay-1',
    installmentNo: 1,
    amountDue: new Prisma.Decimal('1515.83'),
    lateFee: new Prisma.Decimal('100.00'),
    amountPaid: new Prisma.Decimal('0'),
    dueDate: new Date('2026-10-01T17:00:00Z'),
  };

  function build(link?: Record<string, unknown>) {
    const prisma = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ct-1',
          contractNumber: 'BC-001',
          payments: [unpaid],
        }),
      },
      paymentLink: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(link ?? null),
      },
    };
    const promptPay = {
      generateQrDataUrl: jest.fn().mockResolvedValue(null),
      getAccountName: jest.fn().mockReturnValue('บริษัท'),
      getMaskedPromptPayId: jest.fn().mockReturnValue('xxx'),
    };
    const service = new PaymentLinkService(
      { get: jest.fn().mockReturnValue(undefined) } as never,
      prisma as never,
      promptPay as never,
      {} as never,
      {} as never,
    );
    return { prisma, service };
  }

  it.each([
    ['ระบุงวด ไม่ส่งยอด (ไลน์บอท · ขั้นทวงตามวัน · การ์ดลิงก์อัตโนมัติ · ลิงก์ของพนักงาน)', 1, undefined, 1615.83, 'INSTALLMENT'],
    ['ไม่ระบุงวด ไม่ส่งยอด (งวดค้างแรก — การ์ดลิงก์ของพนักงาน / ลูกค้าขอลิงก์)', undefined, undefined, 1615.83, 'INSTALLMENT'],
    ['ระบุงวด + ยอดคงค้างของงวด (กฎทวงตามเหตุการณ์ที่ข้อความระบุงวด)', 1, { amount: 1615.83, purpose: 'INSTALLMENT' }, 1615.83, 'INSTALLMENT'],
    ['ยอดค้างรวมแจ้งล็อก / ยอดนัด', undefined, { amount: 1000, purpose: 'AMOUNT' }, 1000, 'AMOUNT'],
    ['ยอดปิดสัญญา (POST liff/early-payoff)', undefined, { amount: 15189.98, purpose: 'PAYOFF' }, 15189.98, 'PAYOFF'],
  ] as const)('%s → %s', async (_label, installmentNo, override, amount, purpose) => {
    const { prisma, service } = build();

    const result = await service.createPaymentLink('ct-1', installmentNo, override);

    expect(result.amount).toBe(amount);
    expect(prisma.paymentLink.create.mock.calls[0][0].data).toMatchObject({
      contractId: 'ct-1',
      paymentId: 'pay-1',
      amount,
      purpose,
    });
  });

  it.each(['INSTALLMENT', 'PAYOFF', 'AMOUNT', null])(
    'GET /line-oa/pay/:token ส่ง purpose ของลิงก์ (%s) ให้หน้าเว็บ',
    async (purpose) => {
      const { service } = build({
        id: 'link-1',
        status: 'ACTIVE',
        amount: new Prisma.Decimal('1000.00'),
        purpose,
        expiresAt: new Date(Date.now() + 60_000),
        contract: { id: 'ct-1', contractNumber: 'BC-001', customer: { name: 'สมชาย ใจดี' } },
        payment: unpaid,
      });

      const view = await service.resolvePaymentLink('tok');

      expect(view).toMatchObject({ valid: true, amount: 1000, purpose });
    },
  );
});
