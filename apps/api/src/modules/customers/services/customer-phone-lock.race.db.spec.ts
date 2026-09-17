import { ConflictException, Logger } from '@nestjs/common';
import { ChatChannel, PrismaClient } from '@prisma/client';
import { CustomerWriteService } from './customer-write.service';
import { CustomerPiiService } from '../customer-pii.service';
import { ContactResolverService } from '../../contacts/contact-resolver.service';
import { customerPhoneLockKey, lockCustomerPhone } from '../customer-phone-lock';
import { CaptureLeadTool } from '../../sales-bot/tools/capture-lead.tool';
import { CustomerMergeService } from '../../chat-prospects/customer-merge.service';
import { ChatProspectService } from '../../chat-prospects/chat-prospect.service';
import { JourneyEntryWriter } from '../../customer-journey/journey-entry-writer.service';
import { hashPII } from '../../../utils/pii.util';

const PII_KEY = 'b'.repeat(64);
const PII_SALT = 'phone-lock-race-spec-salt-0123456789';
const CENTRAL_BRANCH_KEY = 'shop_bot_central_branch_id';

/**
 * ล็อกเบอร์หลัก (คำตัดสินเจ้าของ 2026-09-17) บน Postgres จริง — ผู้เขียนสองรายคนละคอนเนกชัน
 * (PrismaClient คนละตัว = pool คนละชุด) เขียนเบอร์เดียวกันพร้อมกัน ต้องได้ลูกค้าที่ยังไม่ถูกลบ
 * ถือเบอร์นั้นเป็นเบอร์หลักแค่คนเดียว
 *
 * ทำให้การแข่งไม่ขึ้นกับจังหวะเวลา: คอนเนกชัน "holder" ถือล็อกเบอร์ไว้ในทรานแซกชันที่เปิดค้าง
 * → ปล่อยผู้เขียนทั้งสองออกวิ่ง → รอจนเห็นทั้งสองรอล็อกนี้อยู่ใน pg_locks (ยืนยันว่าล็อกทำงานจริง)
 * → ค่อยปล่อย holder · ด่านนัดพบก่อน INSERT (ด้านล่าง) ทำให้โค้ดที่ไม่ล็อกแดงทุกครั้ง
 * (ถ้าโค้ดไม่ล็อก ผู้เขียนจะวิ่งจบเองโดยไม่รอ — การรอ pg_locks จึงแข่งกับ "ทั้งสองจบแล้ว")
 *
 * รัน: DATABASE_URL=<ฐานทดสอบที่ apply migration แล้ว> npx jest <ไฟล์นี้> --runInBand
 */
describe('ล็อกเบอร์หลักของลูกค้า — สองคอนเนกชัน (real DB)', () => {
  const holderDb = new PrismaClient();
  const rawA = new PrismaClient();
  const rawB = new PrismaClient();
  const clients = [holderDb, rawA, rawB];

  /**
   * ด่านนัดพบก่อน INSERT ลูกค้า — ผู้เขียนที่มาถึงรอคู่แข่งสูงสุด BARRIER_MS ก่อนเขียน
   * ⇒ ถ้าโค้ดไม่ล็อก ทั้งสองผ่านการตรวจเบอร์ซ้ำแล้วมาเจอกันที่นี่ก่อนมีใคร commit (แดงแน่นอน ไม่ขึ้นกับจังหวะ)
   * ⇒ ถ้าโค้ดล็อก คู่แข่งติดล็อกอยู่ มาไม่ถึง — ผู้มาก่อนรอครบเวลาแล้วเขียนต่อ (ความถูกต้องไม่พึ่งเวลานี้)
   */
  const BARRIER_MS = 750;
  let arrivals: Array<() => void> = [];
  function arriveAtInsert(): Promise<void> {
    return new Promise<void>((resolve) => {
      arrivals.push(resolve);
      if (arrivals.length >= 2) {
        arrivals.forEach((r) => r());
        arrivals = [];
      } else {
        setTimeout(resolve, BARRIER_MS);
      }
    });
  }
  const withBarrier = (db: PrismaClient) =>
    db.$extends({
      query: {
        customer: {
          async create({ args, query }) {
            await arriveAtInsert();
            return query(args);
          },
        },
      },
    }) as unknown as PrismaClient;
  const dbA = withBarrier(rawA);
  const dbB = withBarrier(rawB);

  const savedEnv = { key: process.env.PII_ENCRYPTION_KEY, salt: process.env.PII_HASH_SALT };
  const stamp = Date.now();
  const createdCustomerIds = new Set<string>();
  const roomIds: string[] = [];
  let configCreated = false;
  let configRevived = false;

  function staffService(db: PrismaClient): CustomerWriteService {
    const pii = new CustomerPiiService(db as never);
    return new CustomerWriteService(
      db as never,
      new ContactResolverService(db as never),
      {} as never,
      pii,
    );
  }

  function botTool(db: PrismaClient): CaptureLeadTool {
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const journeyState = { recompute: jest.fn().mockResolvedValue(undefined) };
    const writer = new JourneyEntryWriter(db as never);
    const pii = new CustomerPiiService(db as never);
    const merge = new CustomerMergeService(
      db as never,
      audit as never,
      writer,
      journeyState as never,
    );
    return new CaptureLeadTool(
      db as never,
      pii,
      merge,
      new ChatProspectService(db as never),
      writer,
    );
  }

  /** เบอร์ที่ยังไม่มีใครในฐานเทสถือ (ฐานเทสใช้ร่วมกับสเปคอื่น) */
  async function freshPhone(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const phone = `0966${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
      const taken = await holderDb.customer.count({
        where: {
          OR: [{ phone }, { phoneHash: hashPII(phone, PII_SALT) }, { phoneSecondary: phone }],
        },
      });
      if (taken === 0) return phone;
    }
    throw new Error('หาเบอร์ทดสอบที่ว่างไม่ได้');
  }

  /** ลูกค้าที่ยังไม่ถูกลบซึ่งถือเบอร์นี้เป็นเบอร์หลัก (plaintext หรือ hash) */
  async function primaryOwners(phone: string): Promise<string[]> {
    const rows = await holderDb.customer.findMany({
      where: { deletedAt: null, OR: [{ phone }, { phoneHash: hashPII(phone, PII_SALT) }] },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async function track(phone: string): Promise<void> {
    const rows = await holderDb.customer.findMany({
      where: {
        OR: [{ phone }, { phoneHash: hashPII(phone, PII_SALT) }, { phoneSecondary: phone }],
      },
      select: { id: true },
    });
    rows.forEach((r) => createdCustomerIds.add(r.id));
  }

  /** จำนวนคอนเนกชันที่กำลังรอ advisory lock ของเบอร์นี้ (ยังไม่ได้) */
  async function waitersFor(key: string): Promise<number> {
    const rows = await holderDb.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM pg_locks
      WHERE locktype = 'advisory' AND NOT granted
        AND objsubid = 1
        AND objid = ((hashtext(${key})::bigint) & 4294967295)::oid`;
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * ถือล็อกเบอร์ไว้ → เริ่มผู้เขียน → รอจนทั้งสองรอล็อก (หรือจบไปเองเพราะไม่ล็อก) → ปล่อย
   * คืนผล allSettled ของผู้เขียน
   */
  async function raceUnderHeldLock(
    phone: string,
    writers: Array<() => Promise<unknown>>,
  ): Promise<{ results: PromiseSettledResult<unknown>[]; bothWaited: boolean }> {
    const key = customerPhoneLockKey(new CustomerPiiService(holderDb as never), phone)!;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const lockTaken = new Promise<void>((r) => (locked = r));

    const holder = holderDb.$transaction(
      async (tx) => {
        await lockCustomerPhone(tx, new CustomerPiiService(holderDb as never), phone);
        locked();
        await gate;
      },
      { timeout: 20_000, maxWait: 5_000 },
    );
    await lockTaken;

    arrivals = [];
    const runs = Promise.allSettled(writers.map((w) => w()));
    let settled = false;
    void runs.then(() => (settled = true));
    const deadline = Date.now() + 10_000;
    let bothWaited = false;
    while (!settled && Date.now() < deadline) {
      if ((await waitersFor(key)) >= writers.length) {
        bothWaited = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    release();
    await holder;
    return { results: await runs, bothWaited };
  }

  beforeAll(async () => {
    process.env.PII_ENCRYPTION_KEY = PII_KEY;
    process.env.PII_HASH_SALT = PII_SALT;
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    // แบบเดียวกับ capture-lead.tool.db.spec.ts — ผู้ใช้ระบบทิ้งไว้ (audit_logs เป็น immutable และอ้าง FK)
    const sys = await holderDb.user.findFirst({
      where: { isSystemUser: true },
      select: { id: true },
    });
    if (!sys) {
      const sameEmail = await holderDb.user.findUnique({
        where: { email: 'system@bestchoice.internal' },
        select: { id: true },
      });
      if (sameEmail)
        throw new Error(
          'ฐานเทสมี system@bestchoice.internal ที่ไม่ใช่ผู้ใช้ระบบ — ไม่แก้แถวของคนอื่น',
        );
      await holderDb.user.create({
        data: {
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
    const config = await holderDb.systemConfig.findUnique({ where: { key: CENTRAL_BRANCH_KEY } });
    if (!config) {
      await holderDb.systemConfig.create({
        data: { key: CENTRAL_BRANCH_KEY, value: 'phone-lock-race-spec-branch' },
      });
      configCreated = true;
    } else if (config.deletedAt) {
      await holderDb.systemConfig.update({
        where: { key: CENTRAL_BRANCH_KEY },
        data: { deletedAt: null },
      });
      configRevived = true;
    }
    await Promise.all(clients.map((c) => c.$connect()));
  });

  afterAll(async () => {
    const roomCustomers = await holderDb.chatRoom.findMany({
      where: { id: { in: roomIds } },
      select: { customerId: true },
    });
    roomCustomers.forEach((r) => r.customerId && createdCustomerIds.add(r.customerId));
    const ids = [...createdCustomerIds];
    const contacts = await holderDb.customer.findMany({
      where: { id: { in: ids }, contactId: { not: null } },
      select: { contactId: true },
    });
    await holderDb.customerJourneyEntry.deleteMany({ where: { customerId: { in: ids } } });
    await holderDb.customerJourneyState.deleteMany({ where: { customerId: { in: ids } } });
    await holderDb.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await holderDb.customer.deleteMany({ where: { id: { in: ids } } });
    await holderDb.contact.deleteMany({
      where: { id: { in: contacts.map((c) => c.contactId as string) } },
    });
    if (configCreated) await holderDb.systemConfig.delete({ where: { key: CENTRAL_BRANCH_KEY } });
    if (configRevived) {
      await holderDb.systemConfig.update({
        where: { key: CENTRAL_BRANCH_KEY },
        data: { deletedAt: new Date() },
      });
    }
    await Promise.all(clients.map((c) => c.$disconnect()));
    jest.restoreAllMocks();
    if (savedEnv.key === undefined) delete process.env.PII_ENCRYPTION_KEY;
    else process.env.PII_ENCRYPTION_KEY = savedEnv.key;
    if (savedEnv.salt === undefined) delete process.env.PII_HASH_SALT;
    else process.env.PII_HASH_SALT = savedEnv.salt;
  });

  it('(ก) พนักงานสองคนสร้างลูกค้าเบอร์เดียวกันพร้อมกัน → สำเร็จหนึ่ง อีกคนได้ 409 field phone', async () => {
    const phone = await freshPhone();
    const staffA = staffService(dbA);
    const staffB = staffService(dbB);

    const { results, bothWaited } = await raceUnderHeldLock(phone, [
      () => staffA.create({ name: `race staff A ${stamp}`, phone } as never),
      () => staffB.create({ name: `race staff B ${stamp}`, phone } as never),
    ]);
    await track(phone);

    expect(bothWaited).toBe(true); // ทั้งสองต้องรอล็อกเบอร์เดียวกันจริง
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    const err = failed[0].reason;
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      message: 'ลูกค้าที่มีเบอร์โทรนี้มีอยู่แล้ว',
      field: 'phone',
      existingCustomer: expect.objectContaining({
        id: (ok[0] as PromiseFulfilledResult<{ id: string }>).value.id,
      }),
    });
    expect(await primaryOwners(phone)).toHaveLength(1);
  });

  it('(ข) บอท capture_lead สร้างลูกค้าใหม่แข่งกับพนักงานสร้างลูกค้า เบอร์ใหม่เดียวกัน → เจ้าของเบอร์หลักคนเดียว', async () => {
    const phone = await freshPhone();
    const room = await holderDb.chatRoom.create({
      data: { channel: ChatChannel.FACEBOOK, externalUserId: `phone-lock-race-${stamp}` },
    });
    roomIds.push(room.id);
    const bot = botTool(dbA);
    const staff = staffService(dbB);

    const { results, bothWaited } = await raceUnderHeldLock(phone, [
      () =>
        bot.run({ roomId: room.id, customerName: `race bot ${stamp}`, phone, downAmount: 1000 }),
      () => staff.create({ name: `race staff ${stamp}`, phone } as never),
    ]);
    await track(phone);

    expect(bothWaited).toBe(true);
    const [botResult, staffResult] = results;
    // บอทต้องไม่ล้มเพราะเบอร์ซ้ำ — แพ้ = เก็บเบอร์เป็นช่องสำรอง · พนักงานแพ้ = 409 ภาษาไทย
    expect(botResult.status).toBe('fulfilled');
    if (staffResult.status === 'rejected') {
      expect(staffResult.reason).toBeInstanceOf(ConflictException);
      expect((staffResult.reason as ConflictException).getResponse()).toMatchObject({
        field: 'phone',
      });
    }
    const owners = await primaryOwners(phone);
    expect(owners).toHaveLength(1);
  });
});
