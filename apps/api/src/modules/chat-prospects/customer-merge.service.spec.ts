import { ConflictException, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { CustomerMergeService } from './customer-merge.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

// เงียบ log "[merge] placeholder …" ให้ผลเทสสะอาด
beforeAll(() => jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined));
afterAll(() => jest.restoreAllMocks());

const PLACEHOLDER = { id: 'p1', deletedAt: null, acquisitionSource: 'CHAT_FACEBOOK', phone: null, nationalId: null, creditCheckStatus: 'PRE_CHECK_PASSED' };
const TARGET = { id: 't1', deletedAt: null, acquisitionSource: null, phone: '0812345678', nationalId: null, creditCheckStatus: 'NONE' };
const ZERO_COUNTS = {
  contracts: 0, sales: 0, bookings: 0, reservations: 0, tradeIns: 0, onlineOrders: 0, savingPlans: 0, onlineApplications: 0,
  loyaltyPoints: 0, loyaltyRedemptions: 0, promotionUsages: 0, repairTickets: 0, otherIncomes: 0, partialPaymentLinks: 0,
  kycVerifications: 0, pdpaConsents: 0, dsarRequests: 0, lineLinks: 0, referrals: 0, reviews: 0, creditApprovals: 0,
  websiteVisits: 0, websiteSessions: 0,
};

function makeTx(overrides: { placeholder?: any; target?: any; counts?: Partial<typeof ZERO_COUNTS> } = {}) {
  const placeholder = { ...PLACEHOLDER, _count: { ...ZERO_COUNTS, ...(overrides.counts ?? {}) }, ...(overrides.placeholder ?? {}) };
  const target = { ...TARGET, ...(overrides.target ?? {}) };
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    customer: {
      findUnique: jest.fn(({ where }: any) => Promise.resolve(where.id === 'p1' ? placeholder : where.id === 't1' ? target : null)),
      update: jest.fn().mockResolvedValue({}),
    },
    chatRoom: { findMany: jest.fn().mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]), updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    creditCheck: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    customerTag: {
      findMany: jest.fn(({ where }: any) => Promise.resolve(where.customerId === 'p1' ? [{ id: 'tag-a', tag: 'VIP' }, { id: 'tag-b', tag: 'HOT' }] : [{ tag: 'HOT' }])),
      update: jest.fn().mockResolvedValue({}),
    },
    crmLead: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    adsAttribution: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    chatAutoTrigger: {
      findMany: jest.fn(({ where }: any) => Promise.resolve(where.customerId === 'p1' ? [{ id: 'tr-1', referenceKey: 'k1' }, { id: 'tr-2', referenceKey: 'k2' }] : [{ referenceKey: 'k2' }])),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    customerScore: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
}

describe('CustomerMergeService.absorbPlaceholder', () => {
  const actor = { id: 'staff-1', role: 'SALES' };
  let audit: any;
  const build = (tx: any) => {
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    const prisma: any = { $transaction: jest.fn((fn: any) => fn(tx)) };
    return new CustomerMergeService(prisma, audit);
  };

  it('ย้ายห้อง/ผลเช็คเครดิต/แท็ก/lead/attribution/trigger แล้ว soft-delete placeholder + audit', async () => {
    const tx = makeTx();
    const service = build(tx);
    await expect(service.absorbPlaceholder('p1', 't1', actor)).resolves.toEqual({ placeholderId: 'p1', targetId: 't1', movedRooms: 2, movedCreditChecks: 1 });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2); // ล็อกทั้งสองฝั่ง
    expect(tx.chatRoom.updateMany).toHaveBeenCalledWith({ where: { customerId: 'p1' }, data: { customerId: 't1' } });
    expect(tx.creditCheck.updateMany).toHaveBeenCalledWith({ where: { customerId: 'p1' }, data: { customerId: 't1' } });
    // แท็ก VIP ย้าย · HOT ซ้ำกับปลายทาง → soft-delete
    expect(tx.customerTag.update).toHaveBeenCalledWith({ where: { id: 'tag-a' }, data: { customerId: 't1' } });
    expect(tx.customerTag.update).toHaveBeenCalledWith({ where: { id: 'tag-b' }, data: { deletedAt: expect.any(Date) } });
    // trigger k1 ย้าย · k2 ชน unique (customerId, referenceKey) → ลบของ placeholder
    expect(tx.chatAutoTrigger.update).toHaveBeenCalledWith({ where: { id: 'tr-1' }, data: { customerId: 't1' } });
    expect(tx.chatAutoTrigger.delete).toHaveBeenCalledWith({ where: { id: 'tr-2' } });
    expect(tx.crmLead.updateMany).toHaveBeenCalledWith({ where: { customerId: 'p1' }, data: { customerId: 't1' } });
    expect(tx.adsAttribution.updateMany).toHaveBeenCalledWith({ where: { customerId: 'p1' }, data: { customerId: 't1' } });
    expect(tx.customerScore.deleteMany).toHaveBeenCalledWith({ where: { customerId: 'p1' } });
    // สถานะเครดิต: ปลายทาง NONE, placeholder ผ่าน pre-check → คัดลอก
    expect(tx.customer.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { creditCheckStatus: 'PRE_CHECK_PASSED' } });
    expect(tx.customer.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { deletedAt: expect.any(Date) } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'staff-1', action: 'CUSTOMER_PLACEHOLDER_MERGED', entity: 'customer', entityId: 't1',
      oldValue: { placeholderId: 'p1' }, newValue: { roomIds: ['r1', 'r2'], movedCreditChecks: 1 },
    }));
  });

  it('ปลายทางมีสถานะเครดิตอยู่แล้ว → คงของปลายทาง', async () => {
    const tx = makeTx({ target: { creditCheckStatus: 'FULL_CHECK_PASSED' } });
    await build(tx).absorbPlaceholder('p1', 't1', actor);
    expect(tx.customer.update).not.toHaveBeenCalledWith({ where: { id: 't1' }, data: expect.anything() });
  });

  it('placeholder มีใบจอง → 409 บอกชื่อรายการ ไม่แตะอะไร', async () => {
    const tx = makeTx({ counts: { bookings: 1 } });
    await expect(build(tx).absorbPlaceholder('p1', 't1', actor)).rejects.toThrow(new ConflictException('รวมไม่ได้: ผู้สนใจคนนี้มีใบจอง 1 รายการ — ให้แก้ที่รายการนั้นก่อน'));
    expect(tx.chatRoom.updateMany).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('ต้นทางไม่ใช่ placeholder (มีเบอร์แล้ว) → 409', async () => {
    const tx = makeTx({ placeholder: { phone: '0899999999' } });
    await expect(build(tx).absorbPlaceholder('p1', 't1', actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('ปลายทางเป็น placeholder → 409 เว้นแต่ allowPlaceholderTarget (ใช้ตอนรวมห้อง)', async () => {
    const tx = makeTx({ target: { acquisitionSource: 'CHAT_LINE_SHOP', phone: null } });
    await expect(build(tx).absorbPlaceholder('p1', 't1', actor)).rejects.toBeInstanceOf(ConflictException);
    const tx2 = makeTx({ target: { acquisitionSource: 'CHAT_LINE_SHOP', phone: null } });
    await expect(build(tx2).absorbPlaceholder('p1', 't1', actor, { allowPlaceholderTarget: true })).resolves.toMatchObject({ movedRooms: 2 });
  });

  it('รวมกับตัวเอง → 400 · ไม่พบ/ถูกลบ → 404', async () => {
    const tx = makeTx();
    await expect(build(tx).absorbPlaceholder('p1', 'p1', actor)).rejects.toBeInstanceOf(BadRequestException);
    const gone = makeTx({ target: { deletedAt: new Date() } });
    await expect(build(gone).absorbPlaceholder('p1', 't1', actor)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ทรานแซกชัน commit ไม่ผ่าน → ไม่เขียน audit (audit ลงหลัง commit เท่านั้น)', async () => {
    const tx = makeTx();
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const prisma: any = {
      $transaction: jest.fn(async (fn: any) => {
        await fn(tx);
        throw new Error('commit failed');
      }),
    };
    const service = new CustomerMergeService(prisma, audit as any);
    await expect(service.absorbPlaceholder('p1', 't1', actor)).rejects.toThrow('commit failed');
    expect(audit.log).not.toHaveBeenCalled();
  });
});

describe('CustomerMergeService.absorbPlaceholder — R12 SYSTEM actor audit', () => {
  const buildSystem = (tx: any, userFindFirst?: any) => {
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const prisma: any = {
      $transaction: jest.fn((fn: any) => fn(tx)),
      user: { findFirst: userFindFirst ?? jest.fn().mockResolvedValue({ id: 'sys-user-real-id' }) },
    };
    return { service: new CustomerMergeService(prisma, audit as any), audit, prisma };
  };

  it('actor SYSTEM → resolve isSystemUser:true แล้วเขียน audit ด้วย userId จริง ไม่ใช่ "system"', async () => {
    const { service, audit, prisma } = buildSystem(makeTx());
    await service.absorbPlaceholder('p1', 't1', { id: 'system', role: 'SYSTEM' });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { isSystemUser: true }, select: { id: true } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ userId: 'sys-user-real-id' }));
  });

  it('resolve ไม่เจอ system user → ข้าม audit ทั้งใบ + alarm Sentry แต่ merge ยังสำเร็จ', async () => {
    (Sentry.captureException as jest.Mock).mockClear();
    const { service, audit, prisma } = buildSystem(makeTx(), jest.fn().mockResolvedValue(null));
    await expect(
      service.absorbPlaceholder('p1', 't1', { id: 'system', role: 'SYSTEM' }),
    ).resolves.toMatchObject({ placeholderId: 'p1', targetId: 't1' });
    expect(prisma.user.findFirst).toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it('actor ไม่ใช่ SYSTEM (staff จริง) → ไม่เรียก resolver เลย ใช้ actor.id ตรงๆ เหมือนเดิม', async () => {
    const { service, audit, prisma } = buildSystem(makeTx());
    await service.absorbPlaceholder('p1', 't1', { id: 'staff-1', role: 'SALES' });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ userId: 'staff-1' }));
  });

  it('cache ต่อ process — สอง absorb ติดกันด้วย actor SYSTEM เรียก findFirst แค่ครั้งเดียว', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'sys-user-real-id' });
    const { service, prisma } = buildSystem(makeTx(), findFirst);
    await service.absorbPlaceholder('p1', 't1', { id: 'system', role: 'SYSTEM' });
    await service.absorbPlaceholder('p1', 't1', { id: 'system', role: 'SYSTEM' });
    expect(prisma.user.findFirst).toHaveBeenCalledTimes(1);
  });
});

describe('CustomerMergeService.absorbRoomsOfLineUser', () => {
  it('ห้อง LINE ของ lineUserId: placeholder → absorb · ไม่มีเจ้าของ → ผูกตรง · คนจริงคนเดิม → ข้าม', async () => {
    const prisma: any = {
      chatRoom: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'r-ph', customerId: 'p1', customer: { acquisitionSource: 'CHAT_LINE_SHOP', phone: null, nationalId: null, deletedAt: null } },
          { id: 'r-none', customerId: null, customer: null },
          { id: 'r-same', customerId: 'cust-real', customer: { acquisitionSource: null, phone: '0812345678', nationalId: null, deletedAt: null } },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new CustomerMergeService(prisma, { log: jest.fn() } as any);
    const absorb = jest.spyOn(service, 'absorbPlaceholder').mockResolvedValue({ placeholderId: 'p1', targetId: 'cust-real', movedRooms: 1, movedCreditChecks: 0 });
    await expect(service.absorbRoomsOfLineUser('Uabc', 'LINE_SHOP', 'cust-real', { id: 'system', role: 'SYSTEM' })).resolves.toEqual({ absorbed: 1, linked: 1 });
    expect(prisma.chatRoom.findMany).toHaveBeenCalledWith({
      where: { lineUserId: 'Uabc', channel: 'LINE_SHOP', deletedAt: null },
      select: { id: true, customerId: true, customer: { select: { acquisitionSource: true, phone: true, nationalId: true, deletedAt: true } } },
    });
    expect(absorb).toHaveBeenCalledWith('p1', 'cust-real', { id: 'system', role: 'SYSTEM' });
    expect(prisma.chatRoom.update).toHaveBeenCalledWith({ where: { id: 'r-none' }, data: { customerId: 'cust-real' } });
  });
});
