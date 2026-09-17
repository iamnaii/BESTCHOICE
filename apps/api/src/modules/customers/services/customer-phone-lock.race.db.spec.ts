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
 * → ปล่อยผู้เขียนออกวิ่งทีละราย รอจนรายนั้นเข้าคิวใน pg_locks ก่อนเริ่มรายถัดไป (ยืนยันว่าล็อกทำงานจริง
 * และกำหนดลำดับได้ — Postgres ให้ล็อกตามลำดับคิว) → ค่อยปล่อย holder · ด่านนัดพบก่อน INSERT (ด้านล่าง)
 * ทำให้โค้ดที่ไม่ล็อกแดงทุกครั้ง (ถ้าโค้ดไม่ล็อก ผู้เขียนไม่เข้าคิวเลย มาถึงด่านแทน → เริ่มรายถัดไปทันที)
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
   * ถือล็อกเบอร์ไว้ → เริ่มผู้เขียนทีละราย ตามลำดับใน `writers` (รอให้รายก่อนหน้าเข้าคิวล็อกก่อนเริ่มรายถัดไป)
   * → ปล่อย · Postgres ให้ล็อก exclusive ตามลำดับคิว ⇒ ผู้เข้าคิวก่อนได้ล็อกก่อนเสมอ (ลำดับผลแพ้ชนะกำหนดได้)
   * ถ้าโค้ดไม่ล็อก ผู้เขียนจะไม่เข้าคิวเลย — รอถึง deadline หรือจนงานจบ แล้ว `bothWaited = false`
   * คืนผล allSettled ของผู้เขียน (ลำดับเดียวกับ `writers`)
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
    const runs: Array<Promise<PromiseSettledResult<unknown>>> = [];
    let bothWaited = true;
    for (const [i, writer] of writers.entries()) {
      const run = Promise.allSettled([writer()]).then(([r]) => r);
      let settled = false;
      void run.then(() => (settled = true));
      runs.push(run);
      const deadline = Date.now() + 10_000;
      let queued = false;
      // arrivals > 0 = รายนี้มาถึงด่านก่อน INSERT โดยไม่เข้าคิวล็อก (โค้ดไม่ล็อก) → เริ่มรายถัดไปทันที
      // ให้ทั้งสองเจอกันที่ด่าน (แดงแน่นอน) แทนการรอจนรายแรก commit
      while (!settled && arrivals.length === 0 && Date.now() < deadline) {
        if ((await waitersFor(key)) >= i + 1) {
          queued = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 25));
      }
      if (!queued) bothWaited = false;
    }
    release();
    await holder;
    return { results: await Promise.all(runs), bothWaited };
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

  /** ห้องแชท FACEBOOK ของสเปคนี้ (มีรหัสผู้ใช้ ⇒ บอทที่แพ้เบอร์ตั้งที่มาเป็น CHAT_FACEBOOK) */
  async function newRoom(tag: string) {
    const room = await holderDb.chatRoom.create({
      data: { channel: ChatChannel.FACEBOOK, externalUserId: `phone-lock-race-${tag}-${stamp}` },
    });
    roomIds.push(room.id);
    return room;
  }

  // ลำดับผลแพ้ชนะกำหนดได้: raceUnderHeldLock ปล่อยผู้เขียนเข้าคิวล็อกทีละราย และ Postgres ให้ล็อก exclusive
  // ตามลำดับคิว ⇒ รายแรกในคิวได้ล็อกก่อน commit ก่อนเสมอ ⇒ ตรวจทางแพ้ของแต่ละฝั่งได้ตรงตัว (A1-3)
  it('(ข-1) บอทเข้าคิวก่อน → บอทได้เบอร์หลัก · พนักงานได้ 409 field phone ชี้แถวของบอท', async () => {
    const phone = await freshPhone();
    const room = await newRoom('bot-first');
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
    expect(botResult.status).toBe('fulfilled');
    const botId = (botResult as PromiseFulfilledResult<{ customerId: string }>).value.customerId;
    expect(staffResult.status).toBe('rejected');
    const err = (staffResult as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      message: 'ลูกค้าที่มีเบอร์โทรนี้มีอยู่แล้ว',
      field: 'phone',
      existingCustomer: expect.objectContaining({ id: botId }),
    });
    expect(await primaryOwners(phone)).toEqual([botId]);
    const botRow = await holderDb.customer.findUniqueOrThrow({ where: { id: botId } });
    expect(botRow.acquisitionSource).toBe('AI_CHAT');
  });

  it('(ข-2) พนักงานเข้าคิวก่อน → พนักงานได้เบอร์หลัก · บอทเห็นแถวนั้นใต้ล็อก เก็บเบอร์เป็นเบอร์สำรอง', async () => {
    const phone = await freshPhone();
    const room = await newRoom('staff-first');
    const bot = botTool(dbA);
    const staff = staffService(dbB);

    const { results, bothWaited } = await raceUnderHeldLock(phone, [
      () => staff.create({ name: `race staff ${stamp}`, phone } as never),
      () =>
        bot.run({ roomId: room.id, customerName: `race bot ${stamp}`, phone, downAmount: 1000 }),
    ]);
    await track(phone);

    expect(bothWaited).toBe(true);
    const [staffResult, botResult] = results;
    expect(staffResult.status).toBe('fulfilled');
    expect(botResult.status).toBe('fulfilled');
    const staffId = (staffResult as PromiseFulfilledResult<{ id: string }>).value.id;
    const botId = (botResult as PromiseFulfilledResult<{ customerId: string }>).value.customerId;
    expect(botId).not.toBe(staffId);
    expect(await primaryOwners(phone)).toEqual([staffId]);
    // ทาง OWNER_APPEARED ของ createLead: เบอร์ไปช่องสำรอง + ที่มา CHAT_* ของห้อง (เป็นผู้สนใจที่รวมเข้าเจ้าของเบอร์ได้)
    const botRow = await holderDb.customer.findUniqueOrThrow({ where: { id: botId } });
    expect(botRow.phone).toBeNull();
    expect(botRow.phoneHash).toBeNull();
    expect(botRow.phoneSecondary).toBe(phone);
    expect(botRow.acquisitionSource).toBe('CHAT_FACEBOOK');
  });
  /** เลขบัตรประชาชนไทยสุ่มที่ checksum ถูก (ฐานเทสใช้ร่วมกัน — สุ่มกันชน) */
  function randomThaiId(): string {
    const d = [1, ...Array.from({ length: 11 }, () => Math.floor(Math.random() * 10))];
    const sum = d.reduce((acc, n, i) => acc + n * (13 - i), 0);
    return d.join('') + String((11 - (sum % 11)) % 10);
  }

  // A2-1: stub ของ contact เดียวกันที่ถือ phoneHash เดียวกัน (ensureRole เขียน hash ให้ stub ตั้งแต่ Part C) ต้องถูก upgrade
  // ไม่ใช่ 409 เบอร์ซ้ำ — ไม่งั้นลงทะเบียนคนนี้ด้วยเลขบัตรไม่ได้อีกเลย
  it('(ค) stub ของ contact เดียวกันถือเบอร์เดียวกัน → create ด้วยเลขบัตร upgrade stub ไม่ใช่ 409', async () => {
    const phone = await freshPhone();
    const nid = randomThaiId();
    const contact = await holderDb.contact.create({
      data: {
        contactCode: `RACE-${stamp}-${Math.floor(Math.random() * 1e6)}`,
        name: `race stub ${stamp}`,
        nationalIdHash: hashPII(nid, PII_SALT),
        phone,
        roles: ['CUSTOMER'],
      },
    });
    // stub จริงจาก ensureRole (Part C เขียน phoneHash/phoneEncrypted ให้ stub แล้ว)
    const { customerId: stubId } = await new ContactResolverService(holderDb as never).ensureRole(
      holderDb as never,
      contact.id,
      'CUSTOMER',
    );
    const stub = await holderDb.customer.findUniqueOrThrow({ where: { id: stubId! } });
    createdCustomerIds.add(stub.id);
    expect(stub.phone).toBe(phone);
    expect(stub.phoneHash).toBe(hashPII(phone, PII_SALT));
    expect(stub.phoneEncrypted).toBeTruthy();

    const result = await staffService(rawB).create({
      name: `race stub upgraded ${stamp}`,
      nationalId: nid,
      phone,
    } as never);
    await track(phone);

    expect(result.id).toBe(stub.id);
    expect(await primaryOwners(phone)).toEqual([stub.id]);
    const row = await holderDb.customer.findUniqueOrThrow({ where: { id: stub.id } });
    expect(row.nationalIdHash).toBe(hashPII(nid, PII_SALT));
    expect(row.contactId).toBe(contact.id);
  });
});
