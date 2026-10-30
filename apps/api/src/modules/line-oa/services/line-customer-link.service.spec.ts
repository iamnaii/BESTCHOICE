import { LineCustomerLinkService } from './line-customer-link.service';
import { LineOaService } from '../line-oa.service';

/**
 * Task 20 C1 — ตัวตนลูกค้าของ OA ร้านมาจากแถว customer_line_links ช่อง FINANCE ที่ยังผูก (ยืนยัน OTP แล้ว)
 * ไม่ใช่ customers.line_id_shop และไม่มีทางผูกด้วยเบอร์อย่างเดียวอีก (selfLinkByPhone ถูกถอด)
 */
function makePrisma(link: { customerId: string } | null) {
  return {
    customerLineLink: { findFirst: jest.fn().mockResolvedValue(link) },
    customer: {
      findFirst: jest.fn().mockResolvedValue({ id: 'cust-real', name: 'สมชาย', contracts: [] }),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    branch: { findFirst: jest.fn().mockResolvedValue({ name: 'สำนักงานใหญ่' }) },
  };
}

describe('LineCustomerLinkService — OTP-verified identity only (Task 20 C1)', () => {
  it('findVerifiedCustomerByLineId reads the active FINANCE link row, then the customer by id', async () => {
    const prisma = makePrisma({ customerId: 'cust-real' });
    const service = new LineCustomerLinkService(prisma as never, {} as never);

    await expect(service.findVerifiedCustomerByLineId('Uabc')).resolves.toMatchObject({
      id: 'cust-real',
    });
    expect(prisma.customerLineLink.findFirst).toHaveBeenCalledWith({
      where: {
        lineUserId: 'Uabc',
        channel: 'FINANCE',
        unlinkedAt: null,
        deletedAt: null,
        customer: { deletedAt: null },
      },
      select: { customerId: true },
    });
    const where = prisma.customer.findFirst.mock.calls[0][0].where;
    expect(where).toEqual({ id: 'cust-real', deletedAt: null });
    expect(where).not.toHaveProperty('lineIdShop');
  });

  it('no active FINANCE link → null without ever reading line_id_shop', async () => {
    const prisma = makePrisma(null);
    const service = new LineCustomerLinkService(prisma as never, {} as never);

    await expect(service.findVerifiedCustomerByLineId('Uabc')).resolves.toBeNull();
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
  });

  it('branch contact of an unverified LINE falls back to the main branch (no contract branch leak)', async () => {
    const prisma = makePrisma(null);
    const service = new LineCustomerLinkService(prisma as never, {} as never);

    await expect(service.findBranchForCustomer('Uabc')).resolves.toEqual({ name: 'สำนักงานใหญ่' });
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
  });

  it('there is no phone-only linking path any more (service + facade)', () => {
    const service = new LineCustomerLinkService(makePrisma(null) as never, {} as never);
    const facade = new LineOaService(
      { get: jest.fn() } as never,
      makePrisma(null) as never,
      {} as never,
      {} as never,
    );
    expect((service as unknown as Record<string, unknown>).selfLinkByPhone).toBeUndefined();
    expect((facade as unknown as Record<string, unknown>).selfLinkByPhone).toBeUndefined();
    expect((facade as unknown as Record<string, unknown>).findCustomerByLineId).toBeUndefined();
  });
});
