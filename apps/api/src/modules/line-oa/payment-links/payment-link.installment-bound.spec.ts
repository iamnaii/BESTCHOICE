import { Prisma } from '@prisma/client';
import { PaymentLinkService } from './payment-link.service';

/**
 * Task 39 — ลิงก์ชำระรู้ตัวว่า "ผูกงวด" หรือไม่ (`PaymentLink.installmentBound`) ให้หน้า `/pay/:token` ตัดสินจากข้อมูลแทนการเดาจากยอด:
 * ผูกงวด = ยอดของลิงก์คือยอดคงค้างของงวดที่ผูก — ไม่ได้ส่งยอดมา (ยอด = ยอดคงค้างของงวดนั้น) หรือผู้เรียกระบุงวดเอง ·
 * ไม่ผูก = ผู้เรียกส่งยอดมาโดยไม่ระบุงวด (ปิดยอด · ยอดค้างรวมแจ้งล็อก · ยอดนัด)
 */
describe('PaymentLinkService — ธงผูกงวดของลิงก์', () => {
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
    ['ระบุงวด ไม่ส่งยอด (ไลน์บอท · ขั้นทวงตามวัน · การ์ดลิงก์อัตโนมัติ) → ผูกงวด', 1, undefined, true],
    ['ไม่ระบุงวด ไม่ส่งยอด (งวดค้างแรก ยอด = ยอดคงค้างของงวดนั้น — การ์ดลิงก์ของพนักงาน / ลูกค้าขอลิงก์) → ผูกงวด', undefined, undefined, true],
    ['ระบุงวด + ยอดคงค้างของงวด (กฎทวงตามเหตุการณ์ที่ข้อความระบุงวด) → ผูกงวด', 1, 1615.83, true],
    ['ไม่ระบุงวด + ส่งยอด (ปิดยอด · ยอดค้างรวมแจ้งล็อก · ยอดนัด) → ไม่ผูกงวด', undefined, 1000, false],
  ] as const)('%s', async (_label, installmentNo, amount, bound) => {
    const { prisma, service } = build();

    await service.createPaymentLink('ct-1', installmentNo, amount);

    expect(prisma.paymentLink.create.mock.calls[0][0].data).toMatchObject({
      contractId: 'ct-1',
      paymentId: 'pay-1',
      installmentBound: bound,
    });
  });

  it.each([true, false])('GET /line-oa/pay/:token ส่งธงของลิงก์ (installmentBound = %s) ให้หน้าเว็บ', async (bound) => {
    const { service } = build({
      id: 'link-1',
      status: 'ACTIVE',
      amount: new Prisma.Decimal('1000.00'),
      installmentBound: bound,
      expiresAt: new Date(Date.now() + 60_000),
      contract: { id: 'ct-1', contractNumber: 'BC-001', customer: { name: 'สมชาย ใจดี' } },
      payment: unpaid,
    });

    const view = await service.resolvePaymentLink('tok');

    expect(view).toMatchObject({ valid: true, amount: 1000, installmentBound: bound });
  });
});
