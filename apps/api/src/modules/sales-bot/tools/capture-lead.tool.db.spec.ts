import { Logger } from '@nestjs/common';
import { ChatChannel, PrismaClient } from '@prisma/client';
import { CaptureLeadTool } from './capture-lead.tool';
import { CustomerPiiService } from '../../customers/customer-pii.service';
import { CustomerMergeService } from '../../chat-prospects/customer-merge.service';
import { ChatProspectService } from '../../chat-prospects/chat-prospect.service';
import { JourneyEntryWriter } from '../../customer-journey/journey-entry-writer.service';
import { decryptPII } from '../../../utils/crypto.util';
import { hashPII } from '../../../utils/pii.util';

const PII_KEY = 'a'.repeat(64);
const PII_SALT = 'capture-lead-db-spec-salt-0123456789';
const CENTRAL_BRANCH_KEY = 'shop_bot_central_branch_id';

/**
 * R25 บน Postgres จริง — capture_lead ห้ามเขียนเบอร์หลักที่ลูกค้าคนอื่นถืออยู่ (ทั้งแถว plaintext และแถว hash-only)
 * บริการจริงทั้งหมด ยกเว้น AuditService / JourneyStateService (mock แบบ customer-merge.service.db.spec.ts)
 * รัน: DATABASE_URL=<ฐานทดสอบที่ apply migration แล้ว> npx jest <ไฟล์นี้> --runInBand
 */
describe('CaptureLeadTool (real DB) — เบอร์ซ้ำ', () => {
  const prisma = new PrismaClient();
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const journeyState = { recompute: jest.fn().mockResolvedValue(undefined) };
  const writer = new JourneyEntryWriter(prisma as never);
  const pii = new CustomerPiiService(prisma as never);
  const merge = new CustomerMergeService(prisma as never, audit as never, writer, journeyState as never);
  const prospects = new ChatProspectService(prisma as never);
  const tool = new CaptureLeadTool(prisma as never, pii, merge, prospects, writer);

  const stamp = Date.now();
  const customerIds: string[] = [];
  const roomIds: string[] = [];
  let phoneSeq = 0;
  const savedEnv = { key: process.env.PII_ENCRYPTION_KEY, salt: process.env.PII_HASH_SALT };
  let configCreated = false;
  let configRevived = false;

  const nextPhone = () => `09${String(stamp).slice(-6)}${String(++phoneSeq).padStart(2, '0')}`;

  beforeAll(async () => {
    process.env.PII_ENCRYPTION_KEY = PII_KEY;
    process.env.PII_HASH_SALT = PII_SALT;
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    // ฐานเทสใหม่ไม่มีแถว isSystemUser — seed แบบ customer-merge.service.db.spec.ts (ไม่ลบทิ้ง: audit_logs อ้าง FK)
    const sys = await prisma.user.findFirst({ where: { isSystemUser: true }, select: { id: true } });
    if (!sys) {
      await prisma.user.upsert({
        where: { email: 'system@bestchoice.internal' },
        update: { isSystemUser: true, isActive: false },
        create: {
          email: 'system@bestchoice.internal',
          name: 'SYSTEM',
          role: 'OWNER',
          password: '__NO_LOGIN__',
          accessibleCompanies: ['SHOP', 'FINANCE'],
          primaryCompany: 'SHOP',
          isActive: false,
          isSystemUser: true,
        },
      });
    }

    const config = await prisma.systemConfig.findUnique({ where: { key: CENTRAL_BRANCH_KEY } });
    if (!config) {
      await prisma.systemConfig.create({ data: { key: CENTRAL_BRANCH_KEY, value: 'capture-lead-db-spec-branch' } });
      configCreated = true;
    } else if (config.deletedAt) {
      await prisma.systemConfig.update({ where: { key: CENTRAL_BRANCH_KEY }, data: { deletedAt: null } });
      configRevived = true;
    }
  });

  afterAll(async () => {
    const merged = await prisma.customer.findMany({ where: { mergedIntoId: { in: customerIds } }, select: { id: true } });
    const all = [...new Set([...customerIds, ...merged.map((c) => c.id)])];
    // ลูกค้าที่ ensureForRoom/บอทสร้าง ตามห้องของสเปคนี้
    const roomCustomers = await prisma.chatRoom.findMany({ where: { id: { in: roomIds } }, select: { customerId: true } });
    for (const r of roomCustomers) if (r.customerId && !all.includes(r.customerId)) all.push(r.customerId);
    await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: all } } });
    await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: all } } });
    await prisma.customer.updateMany({ where: { id: { in: all } }, data: { mergedIntoId: null } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: all } } });
    if (configCreated) await prisma.systemConfig.delete({ where: { key: CENTRAL_BRANCH_KEY } });
    if (configRevived) {
      await prisma.systemConfig.update({ where: { key: CENTRAL_BRANCH_KEY }, data: { deletedAt: new Date() } });
    }
    await prisma.$disconnect();
    jest.restoreAllMocks();
    if (savedEnv.key === undefined) delete process.env.PII_ENCRYPTION_KEY;
    else process.env.PII_ENCRYPTION_KEY = savedEnv.key;
    if (savedEnv.salt === undefined) delete process.env.PII_HASH_SALT;
    else process.env.PII_HASH_SALT = savedEnv.salt;
  });

  async function fbRoom(label: string, customerId: string | null) {
    const room = await prisma.chatRoom.create({
      data: { channel: ChatChannel.FACEBOOK, externalUserId: `capture-lead-db-${label}-${stamp}`, customerId },
    });
    roomIds.push(room.id);
    return room;
  }

  async function placeholder(label: string) {
    const p = await prisma.customer.create({
      data: { name: `capture db placeholder ${label}`, phone: null, acquisitionSource: 'CHAT_FACEBOOK' },
    });
    customerIds.push(p.id);
    return p;
  }

  async function hashOnlyOwner(name: string, phone: string) {
    const o = await prisma.customer.create({
      data: { name, phone: null, phoneHash: hashPII(phone, PII_SALT), phoneEncrypted: pii.encryptCustomerFields({ phone }).phoneEncrypted },
    });
    customerIds.push(o.id);
    return o;
  }

  async function plaintextOwner(name: string, phone: string) {
    const o = await prisma.customer.create({ data: { name, phone, acquisitionSource: 'AI_CHAT' } });
    customerIds.push(o.id);
    return o;
  }

  it('placeholder + เจ้าของเบอร์แบบ hash-only → absorb: ย้ายห้อง, placeholder ถูกลบ+ชี้ mergedIntoId, ชื่อ/เบอร์ของเจ้าของไม่เปลี่ยน', async () => {
    const phone = nextPhone();
    const p = await placeholder('absorb');
    const room = await fbRoom('absorb', p.id);
    const o = await hashOnlyOwner('capture db เจ้าของเดิม', phone);

    const result = await tool.run({ roomId: room.id, customerName: 'ชื่อที่พิมพ์ในแชท', phone, downAmount: 1000 });

    expect(result.customerId).toBe(o.id);
    expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: room.id } })).customerId).toBe(o.id);
    const deadP = await prisma.customer.findUniqueOrThrow({ where: { id: p.id } });
    expect(deadP.deletedAt).not.toBeNull();
    expect(deadP.mergedIntoId).toBe(o.id);
    const after = await prisma.customer.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.name).toBe('capture db เจ้าของเดิม');
    expect(after.phone).toBeNull();
    expect(after.phoneHash).toBe(o.phoneHash);
    expect(after.phoneSecondary).toBeNull();
    // Ruling R24 ยกที่มา CHAT_* มาให้ (ผู้สนใจเกิดก่อน) — บอทไม่ทับด้วย AI_CHAT_RETURN
    expect(after.acquisitionSource).toBe('CHAT_FACEBOOK');
    // มีลูกค้าที่ยังมีชีวิตถือเบอร์นี้คนเดียว
    expect(await prisma.customer.count({
      where: { deletedAt: null, OR: [{ phone }, { phoneHash: hashPII(phone, PII_SALT) }] },
    })).toBe(1);
  });

  it('placeholder + ไม่มีเจ้าของเบอร์ → เขียน phone + phoneHash + phoneEncrypted และบันทึก CONTACT_ADDED', async () => {
    const phone = nextPhone();
    const p = await placeholder('fill');
    const room = await fbRoom('fill', p.id);

    const result = await tool.run({ roomId: room.id, customerName: 'สมหญิง', phone: `${phone.slice(0, 3)}-${phone.slice(3)}`, downAmount: 1000 });

    expect(result.customerId).toBe(p.id);
    const after = await prisma.customer.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.name).toBe('สมหญิง');
    expect(after.phone).toBe(phone);
    expect(after.phoneHash).toBe(hashPII(phone, PII_SALT));
    expect(after.phoneEncrypted).not.toBeNull();
    expect(decryptPII(after.phoneEncrypted as string, PII_KEY)).toBe(phone);
    expect(after.acquisitionSource).toBe('CHAT_FACEBOOK');
    const entries = await prisma.customerJourneyEntry.findMany({ where: { customerId: p.id, kind: 'CONTACT_ADDED' } });
    expect(entries).toHaveLength(1);
    expect(entries[0].data).toEqual({ fields: ['phone'], via: 'CAPTURE_LEAD' });
  });

  it('placeholder + เจ้าของเบอร์ 2 คน → ไม่ absorb · เบอร์ไปช่องสำรอง · เบอร์หลักยังว่าง', async () => {
    const phone = nextPhone();
    const p = await placeholder('ambiguous');
    const room = await fbRoom('ambiguous', p.id);
    await plaintextOwner('capture db owner A', phone);
    await hashOnlyOwner('capture db owner B', phone);

    const result = await tool.run({ roomId: room.id, customerName: 'ใครสักคน', phone, downAmount: 1000 });

    expect(result.customerId).toBe(p.id);
    const after = await prisma.customer.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.deletedAt).toBeNull();
    expect(after.phone).toBeNull();
    expect(after.phoneHash).toBeNull();
    expect(after.phoneSecondary).toBe(phone);
    expect(decryptPII(after.phoneSecondaryEncrypted as string, PII_KEY)).toBe(phone);
    expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: room.id } })).customerId).toBe(p.id);
    expect(audit.log).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'CUSTOMER_PLACEHOLDER_MERGED', entityId: p.id }));
  });

  it('ห้อง FB ยังไม่มีเจ้าของ + เจ้าของเบอร์ 1 คน (แถวบอทยุคเก่า plaintext) → ผูกห้องเข้าคนนั้น ไม่สร้างลูกค้าใหม่', async () => {
    const phone = nextPhone();
    const room = await fbRoom('link', null);
    const o = await plaintextOwner('capture db legacy bot lead', phone);
    const typedName = `ลูกค้าใหม่-${stamp}`;

    const result = await tool.run({ roomId: room.id, customerName: typedName, phone, downAmount: 1000 });

    expect(result.customerId).toBe(o.id);
    const r = await prisma.chatRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(r.customerId).toBe(o.id);
    expect(r.handoffMode).toBe(true);
    expect(await prisma.customer.count({ where: { name: typedName } })).toBe(0);
    const after = await prisma.customer.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.name).toBe('capture db legacy bot lead');
    expect(after.acquisitionSource).toBe('AI_CHAT_RETURN');
    const auditRow = await prisma.auditLog.findFirst({
      where: { action: 'AI_LEAD_CAPTURED', entityId: o.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditRow?.newValue).toEqual(expect.objectContaining({ phoneOutcome: 'LINKED_BY_PHONE', phoneConflict: null }));
  });
});
