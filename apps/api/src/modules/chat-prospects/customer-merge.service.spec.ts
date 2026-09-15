import { ConflictException, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { CustomerMergeService } from './customer-merge.service';
import { ChatProspectsModule } from './chat-prospects.module';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CustomerJourneyModule } from '../customer-journey/customer-journey.module';
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { JourneyStateService } from '../customer-journey/journey-state.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

// เงียบ log "[merge] placeholder …" ให้ผลเทสสะอาด
beforeAll(() => jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined));
afterAll(() => jest.restoreAllMocks());

// แชททักมาก่อน (1 ก.ย.) แล้วพนักงานเพิ่งสร้างลูกค้าจากกล่องข้อความ (10 ก.ย.) — เคสหลักของ Ruling R24
const PLACEHOLDER = {
  id: 'p1', deletedAt: null, acquisitionSource: 'CHAT_FACEBOOK', phone: null, nationalId: null,
  creditCheckStatus: 'PRE_CHECK_PASSED', createdAt: new Date('2026-09-01T03:00:00Z'),
  facebookUserId: 'psid-1234567890', facebookName: 'สมชาย เฟซ',
};
const TARGET = {
  id: 't1', deletedAt: null, acquisitionSource: null, phone: '0812345678', nationalId: null,
  creditCheckStatus: 'NONE', createdAt: new Date('2026-09-10T03:00:00Z'),
  facebookUserId: null, facebookName: null,
};
const ZERO_COUNTS = {
  contracts: 0, sales: 0, bookings: 0, reservations: 0, tradeIns: 0, onlineOrders: 0, savingPlans: 0, onlineApplications: 0,
  loyaltyPoints: 0, loyaltyRedemptions: 0, promotionUsages: 0, repairTickets: 0, otherIncomes: 0, partialPaymentLinks: 0,
  kycVerifications: 0, pdpaConsents: 0, dsarRequests: 0, lineLinks: 0, referrals: 0, reviews: 0, creditApprovals: 0,
  websiteVisits: 0, websiteSessions: 0,
};

function makeTx(overrides: { placeholder?: any; target?: any; counts?: Partial<typeof ZERO_COUNTS>; states?: Record<string, any> } = {}) {
  const placeholder = { ...PLACEHOLDER, _count: { ...ZERO_COUNTS, ...(overrides.counts ?? {}) }, ...(overrides.placeholder ?? {}) };
  const target = { ...TARGET, ...(overrides.target ?? {}) };
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    customer: {
      findUnique: jest.fn(({ where }: any) => Promise.resolve(where.id === 'p1' ? placeholder : where.id === 't1' ? target : null)),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
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
    customerJourneyEntry: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    customerJourneyState: {
      findUnique: jest.fn(({ where }: any) => Promise.resolve(overrides.states?.[where.customerId] ?? null)),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

/** JourneyEntryWriter / JourneyStateService ปลอม — unit spec ตรวจแค่ว่าเรียกอะไร ด้วยค่าอะไร (ของจริงอยู่ใน db spec) */
function makeJourney() {
  return {
    entries: { recordInTx: jest.fn().mockResolvedValue(undefined), recordAfterCommit: jest.fn().mockResolvedValue(undefined) },
    state: { recompute: jest.fn().mockResolvedValue(undefined) },
  };
}

function newService(prisma: any, audit: any): CustomerMergeService {
  const journey = makeJourney();
  return new CustomerMergeService(prisma, audit, journey.entries as any, journey.state as any);
}

describe('CustomerMergeService.absorbPlaceholder', () => {
  const actor = { id: 'staff-1', role: 'SALES' };
  let audit: any;
  const build = (tx: any) => {
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    const prisma: any = { $transaction: jest.fn((fn: any) => fn(tx)) };
    return newService(prisma, audit);
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
    // สถานะเครดิต: ปลายทาง NONE, placeholder ผ่าน pre-check → คัดลอก · ที่มา CHAT_* ยกไปด้วย (R24) ในใบเดียว
    expect(tx.customer.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: {
        creditCheckStatus: 'PRE_CHECK_PASSED', acquisitionSource: 'CHAT_FACEBOOK',
        facebookUserId: 'psid-1234567890', facebookName: 'สมชาย เฟซ',
      },
    });
    expect(tx.customer.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { deletedAt: expect.any(Date), mergedIntoId: 't1' } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'staff-1', action: 'CUSTOMER_PLACEHOLDER_MERGED', entity: 'customer', entityId: 't1',
      oldValue: { placeholderId: 'p1' },
      newValue: { roomIds: ['r1', 'r2'], movedCreditChecks: 1, sourceCopied: true },
    }));
  });

  it('ปลายทางมีสถานะเครดิตและที่มาอยู่แล้ว → ไม่แตะปลายทางเลย', async () => {
    const tx = makeTx({ target: { creditCheckStatus: 'FULL_CHECK_PASSED', acquisitionSource: 'WALK_IN' } });
    await build(tx).absorbPlaceholder('p1', 't1', actor);
    expect(tx.customer.update).not.toHaveBeenCalledWith({ where: { id: 't1' }, data: expect.anything() });
  });

  // Ruling R24 (แก้สเปค §3.3) — KPI "มาจากแชท" ต้องนับคนที่ทักมาก่อนแล้วค่อยซื้อ
  it('ปลายทางมีที่มาอยู่แล้ว → ไม่ทับที่มา (sourceCopied: false)', async () => {
    const tx = makeTx({ target: { acquisitionSource: 'WALK_IN' } });
    await build(tx).absorbPlaceholder('p1', 't1', actor);
    expect(tx.customer.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { creditCheckStatus: 'PRE_CHECK_PASSED' } });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ newValue: expect.objectContaining({ sourceCopied: false }) }),
    );
  });

  it('ปลายทางเกิดก่อนผู้สนใจ (ซื้อก่อน ผูกห้องทีหลัง) → ไม่ยกที่มา', async () => {
    const tx = makeTx({ target: { createdAt: new Date('2026-08-20T03:00:00Z') } });
    await build(tx).absorbPlaceholder('p1', 't1', actor);
    expect(tx.customer.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { creditCheckStatus: 'PRE_CHECK_PASSED' } });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ newValue: expect.objectContaining({ sourceCopied: false }) }),
    );
  });

  it('ปลายทางมีช่อง facebook อยู่แล้ว → ยกเฉพาะที่มา ไม่ทับ PSID/ชื่อเดิม', async () => {
    const tx = makeTx({ target: { facebookUserId: 'psid-ของปลายทาง', facebookName: 'ชื่อเดิม' } });
    await build(tx).absorbPlaceholder('p1', 't1', actor);
    expect(tx.customer.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { creditCheckStatus: 'PRE_CHECK_PASSED', acquisitionSource: 'CHAT_FACEBOOK' },
    });
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

  // Ruling R22 — ปุ่ม "รวมเข้าลูกค้าเดิม" ส่งธงนี้เสมอ ต้องไม่เปิดทางให้รวมกลับทิศ
  it('allowPlaceholderTarget ไม่ผ่อนปรนต้นทาง — ต้นทางมีเบอร์แล้วยัง 409 (รวมทางเดียวเหมือนเดิม)', async () => {
    const tx = makeTx({
      placeholder: { phone: '0899999999' },
      target: { acquisitionSource: 'CHAT_LINE_SHOP', phone: null },
    });
    await expect(
      build(tx).absorbPlaceholder('p1', 't1', actor, { allowPlaceholderTarget: true }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.chatRoom.updateMany).not.toHaveBeenCalled();
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
    const service = newService(prisma, audit);
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
    return { service: newService(prisma, audit), audit, prisma };
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

// Ruling R26 (I6) — ปุ่มรวมของ SALES ต้องแน่นเท่าทางผูกห้อง (การรวมย้ายห้องทุกห้องของผู้สนใจคนนั้น)
describe('CustomerMergeService.assertActorMayAbsorb', () => {
  const build = (rows: any) => {
    const prisma: any = { chatRoom: { findFirst: jest.fn().mockResolvedValue(rows) } };
    return { service: newService(prisma, { log: jest.fn() }), prisma };
  };

  it('SALES + มีห้องที่คนอื่นดูแลอยู่ → 403 ข้อความเดียวกับ linkCustomer', async () => {
    const { service, prisma } = build({ id: 'room-other' });
    await expect(service.assertActorMayAbsorb('p1', { id: 'sales-1', role: 'SALES' })).rejects.toThrow(
      new ForbiddenException('ไม่มีสิทธิ์เข้าถึงห้องแชทนี้'),
    );
    expect(prisma.chatRoom.findFirst).toHaveBeenCalledWith({
      where: {
        customerId: 'p1',
        deletedAt: null,
        AND: [{ assignedToId: { not: null } }, { assignedToId: { not: 'sales-1' } }],
      },
      select: { id: true },
    });
  });

  it('SALES + ห้องยังไม่มีคนดูแล หรือเป็นห้องของตัวเอง → ผ่าน', async () => {
    const { service } = build(null);
    await expect(service.assertActorMayAbsorb('p1', { id: 'sales-1', role: 'SALES' })).resolves.toBeUndefined();
  });

  it('role อื่น (OWNER/BM/FM/SYSTEM) → ไม่ตรวจขอบเขตห้องเลย', async () => {
    const { service, prisma } = build({ id: 'room-other' });
    await expect(service.assertActorMayAbsorb('p1', { id: 'owner-1', role: 'OWNER' })).resolves.toBeUndefined();
    expect(prisma.chatRoom.findFirst).not.toHaveBeenCalled();
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
    const service = newService(prisma, { log: jest.fn() });
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

// การเดินทางของลูกค้า (Plan 2 Task 4) — ทุกทางรวมผ่าน absorbPlaceholder จึงตรวจที่เดียว
describe('CustomerMergeService.absorbPlaceholder — การเดินทางของลูกค้า', () => {
  const actor = { id: 'staff-1', role: 'SALES' };
  const PH_STATE = {
    customerId: 'p1', stage: 'INTERESTED', stageEnteredAt: new Date('2026-08-02T03:00:00Z'), path: 'UNKNOWN',
    contactedAt: new Date('2026-08-01T03:00:00Z'), firstChannel: 'CHAT_FACEBOOK', firstSource: 'CHAT_FACEBOOK',
    firstAdCampaignId: null, firstStaffReplyAt: new Date('2026-08-01T04:00:00Z'), computedAt: new Date('2026-08-03T03:00:00Z'),
  };
  const TG_STATE = {
    customerId: 't1', stage: 'PURCHASED', stageEnteredAt: new Date('2026-09-10T03:00:00Z'), path: 'CASH',
    contactedAt: new Date('2026-09-10T03:00:00Z'), firstChannel: 'WALK_IN', firstSource: 'WALK_IN',
    firstAdCampaignId: null, firstStaffReplyAt: null, computedAt: new Date('2026-09-10T03:05:00Z'),
  };

  const setup = (tx: any, opts: { commitFails?: boolean; systemUser?: { id: string } | null } = {}) => {
    const journey = makeJourney();
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const commitSeenByRecompute: boolean[] = [];
    let committed = false;
    const prisma: any = {
      $transaction: jest.fn(async (fn: any) => {
        const out = await fn(tx);
        if (opts.commitFails) throw new Error('commit failed');
        committed = true;
        return out;
      }),
      user: { findFirst: jest.fn().mockResolvedValue(opts.systemUser === undefined ? { id: 'sys-user-real-id' } : opts.systemUser) },
    };
    journey.state.recompute.mockImplementation(async () => {
      commitSeenByRecompute.push(committed);
    });
    const service = new CustomerMergeService(prisma, audit as any, journey.entries as any, journey.state as any);
    return { service, journey, audit, commitSeenByRecompute };
  };

  it('ใน tx: ย้าย entries · ยุบ chain · soft-delete คู่ mergedIntoId · PLACEHOLDER_MERGED ผ่าน recordInTx (occurredAt = เวลาลบ · data มีแค่จำนวนห้อง)', async () => {
    const tx = makeTx();
    const { service, journey } = setup(tx);
    await service.absorbPlaceholder('p1', 't1', actor);

    expect(tx.customerJourneyEntry.updateMany).toHaveBeenCalledWith({ where: { customerId: 'p1' }, data: { customerId: 't1' } });
    expect(tx.customer.updateMany).toHaveBeenCalledWith({ where: { mergedIntoId: 'p1' }, data: { mergedIntoId: 't1' } });
    const softDelete = tx.customer.update.mock.calls.map(([arg]: any[]) => arg).find((arg: any) => arg.where.id === 'p1');
    expect(softDelete).toEqual({ where: { id: 'p1' }, data: { deletedAt: expect.any(Date), mergedIntoId: 't1' } });
    expect(journey.entries.recordInTx).toHaveBeenCalledTimes(1);
    expect(journey.entries.recordInTx).toHaveBeenCalledWith(tx, {
      customerId: 't1',
      kind: 'PLACEHOLDER_MERGED',
      occurredAt: softDelete.data.deletedAt,
      actorType: 'STAFF',
      actorUserId: 'staff-1',
      data: { roomCount: 2 },
      dedupeKey: 'PLACEHOLDER_MERGED:p1',
    });
    expect(journey.entries.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('actor SYSTEM ที่หา system user ไม่เจอ → audit ถูกข้าม แต่ PLACEHOLDER_MERGED ยังเขียน (actorType SYSTEM · actorUserId null ไม่ติด FK)', async () => {
    const tx = makeTx();
    const { service, journey, audit } = setup(tx, { systemUser: null });
    await service.absorbPlaceholder('p1', 't1', { id: 'system', role: 'SYSTEM' });
    expect(audit.log).not.toHaveBeenCalled();
    expect(journey.entries.recordInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ kind: 'PLACEHOLDER_MERGED', actorType: 'SYSTEM', actorUserId: null, dedupeKey: 'PLACEHOLDER_MERGED:p1' }),
    );
  });

  it('recompute([ปลายทาง, placeholder]) หลัง commit เท่านั้น · commit ล้ม → ไม่ recompute', async () => {
    const ok = setup(makeTx());
    await ok.service.absorbPlaceholder('p1', 't1', actor);
    expect(ok.journey.state.recompute).toHaveBeenCalledWith(['t1', 'p1']);
    expect(ok.commitSeenByRecompute).toEqual([true]);

    const failed = setup(makeTx(), { commitFails: true });
    await expect(failed.service.absorbPlaceholder('p1', 't1', actor)).rejects.toThrow('commit failed');
    expect(failed.journey.state.recompute).not.toHaveBeenCalled();
  });

  it('recompute ล้ม → การรวมยังสำเร็จ + Sentry (summary endpoint และ cron ซ่อมแคชเอง)', async () => {
    (Sentry.captureException as jest.Mock).mockClear();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, journey } = setup(makeTx());
    journey.state.recompute.mockRejectedValueOnce(new Error('recompute down'));
    await expect(service.absorbPlaceholder('p1', 't1', actor)).resolves.toEqual({
      placeholderId: 'p1', targetId: 't1', movedRooms: 2, movedCreditChecks: 1,
    });
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'recompute down' }),
      { tags: { kind: 'customer-journey' } },
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('journey recompute failed'));
  });

  it('แช่แข็ง: placeholder ทักก่อน + ปลายทางมีแคช → update เฉพาะช่องจุดเริ่มต้น แล้วลบแคช placeholder', async () => {
    const tx = makeTx({ states: { p1: PH_STATE, t1: TG_STATE } });
    await setup(tx).service.absorbPlaceholder('p1', 't1', actor);
    expect(tx.customerJourneyState.upsert).toHaveBeenCalledWith({
      where: { customerId: 't1' },
      update: {
        contactedAt: PH_STATE.contactedAt,
        firstChannel: 'CHAT_FACEBOOK',
        firstSource: 'CHAT_FACEBOOK',
        firstAdCampaignId: null,
        firstStaffReplyAt: PH_STATE.firstStaffReplyAt,
      },
      create: expect.objectContaining({ customerId: 't1', contactedAt: PH_STATE.contactedAt }),
    });
    expect(tx.customerJourneyState.deleteMany).toHaveBeenCalledWith({ where: { customerId: 'p1' } });
  });

  it('แช่แข็ง: ปลายทางยังไม่มีแคช → create จากแคช placeholder (ขั้น/path ให้ recompute แก้หลัง commit)', async () => {
    const tx = makeTx({ states: { p1: PH_STATE } });
    await setup(tx).service.absorbPlaceholder('p1', 't1', actor);
    expect(tx.customerJourneyState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: {
        customerId: 't1',
        stage: 'INTERESTED',
        stageEnteredAt: PH_STATE.stageEnteredAt,
        path: 'UNKNOWN',
        computedAt: PH_STATE.computedAt,
        contactedAt: PH_STATE.contactedAt,
        firstChannel: 'CHAT_FACEBOOK',
        firstSource: 'CHAT_FACEBOOK',
        firstAdCampaignId: null,
        firstStaffReplyAt: PH_STATE.firstStaffReplyAt,
      },
    }));
  });

  it('แช่แข็ง: ปลายทางทักก่อน หรือ placeholder ไม่มีแคช → ไม่ upsert แต่ยังลบแคช placeholder', async () => {
    const olderTarget = makeTx({ states: { p1: PH_STATE, t1: { ...TG_STATE, contactedAt: new Date('2026-07-01T03:00:00Z') } } });
    await setup(olderTarget).service.absorbPlaceholder('p1', 't1', actor);
    expect(olderTarget.customerJourneyState.upsert).not.toHaveBeenCalled();
    expect(olderTarget.customerJourneyState.deleteMany).toHaveBeenCalledWith({ where: { customerId: 'p1' } });

    const noCache = makeTx({ states: { t1: TG_STATE } });
    await setup(noCache).service.absorbPlaceholder('p1', 't1', actor);
    expect(noCache.customerJourneyState.upsert).not.toHaveBeenCalled();
    expect(noCache.customerJourneyState.deleteMany).toHaveBeenCalledWith({ where: { customerId: 'p1' } });
  });

  it('แช่แข็ง: placeholder ยังไม่เคยมีร้านตอบ → firstStaffReplyAt ใช้ของปลายทาง (ค่าเก่าสุดที่ไม่ว่าง)', async () => {
    const tx = makeTx({
      states: {
        p1: { ...PH_STATE, firstStaffReplyAt: null },
        t1: { ...TG_STATE, firstStaffReplyAt: new Date('2026-09-10T03:30:00Z') },
      },
    });
    await setup(tx).service.absorbPlaceholder('p1', 't1', actor);
    expect(tx.customerJourneyState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ firstStaffReplyAt: new Date('2026-09-10T03:30:00Z') }),
    }));
  });

  it('409 เอกสารพ่วง → ไม่แตะ entries / chain / แคช / recordInTx / recompute', async () => {
    const tx = makeTx({ counts: { bookings: 1 } });
    const { service, journey } = setup(tx);
    await expect(service.absorbPlaceholder('p1', 't1', actor)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.customerJourneyEntry.updateMany).not.toHaveBeenCalled();
    expect(tx.customer.updateMany).not.toHaveBeenCalled();
    expect(tx.customerJourneyState.deleteMany).not.toHaveBeenCalled();
    expect(journey.entries.recordInTx).not.toHaveBeenCalled();
    expect(journey.state.recompute).not.toHaveBeenCalled();
  });

  it('DI: CustomerMergeService ขอ JourneyEntryWriter + JourneyStateService ตามชนิด · ChatProspectsModule import CustomerJourneyModule ที่ export ทั้งสอง', () => {
    expect(Reflect.getMetadata('design:paramtypes', CustomerMergeService)).toEqual([
      PrismaService, AuditService, JourneyEntryWriter, JourneyStateService,
    ]);
    expect(Reflect.getMetadata('imports', ChatProspectsModule)).toContain(CustomerJourneyModule);
    expect(Reflect.getMetadata('exports', CustomerJourneyModule)).toEqual(
      expect.arrayContaining([JourneyEntryWriter, JourneyStateService]),
    );
  });
});
