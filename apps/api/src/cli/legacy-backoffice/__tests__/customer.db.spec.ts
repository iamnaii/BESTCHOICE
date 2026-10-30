import { Prisma, PrismaClient } from '@prisma/client';
import { CustomerPiiService } from '../../../modules/customers/customer-pii.service';
import { customerPhoneLockKey } from '../../../modules/customers/customer-phone-lock';
import type { PrismaService } from '../../../prisma/prisma.service';
import { decryptPII } from '../../../utils/crypto.util';
import { hashPII } from '../../../utils/pii.util';
import { TEST_NAME_PREFIX } from '../../../utils/test-data-markers';
import {
  linkOrCreateLegacyCustomer,
  lockLegacyCustomerPhones,
  resolveLegacyCustomerOrigin,
  type CustomerLinkResult,
  type LegacyCustomerInput,
  type LinkLegacyCustomerOptions,
} from '../customer';

/**
 * ผูกหรือสร้างลูกค้าจากระบบเก่าบน Postgres จริง (Task 8) — ข้อมูลสังเคราะห์ทั้งหมด (ชื่อขึ้นต้น "ทดสอบระบบ",
 * เลขบัตรขึ้นต้น 09 ที่คำนวณหลักตรวจเอง, เบอร์ 0977…, รหัสสมาชิก TEST-T8-…) · ลบเฉพาะแถวที่สเปคนี้สร้าง
 *
 * กุญแจ/salt ของ PII ตั้งในสเปคเอง (ค่าทิ้ง) แล้วคืนค่าเดิมตอนจบ — CI ไม่มีสองตัวนี้ใน env
 * รัน: DATABASE_URL=<ฐานทดสอบ test_db หรือ *_test> npx jest <ไฟล์นี้> --runInBand · ไม่มี DATABASE_URL = ข้าม
 */
const KEY = 'a7'.repeat(32);
const SALT = 'legacy-t8-customer-db-spec-salt-0001';
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('linkOrCreateLegacyCustomer (real DB)', () => {
  let prisma: PrismaClient;
  /** client ที่จด SQL ทุกคำสั่ง — ใช้พิสูจน์ลำดับล็อก */
  let logged: PrismaClient<Prisma.PrismaClientOptions, 'query'>;
  let pii: CustomerPiiService;
  let capture = false;
  const statements: string[] = [];
  const customerIds = new Set<string>();
  const contactIds = new Set<string>();
  const saved = { key: process.env.PII_ENCRYPTION_KEY, salt: process.env.PII_HASH_SALT };
  const stamp = Date.now().toString(36).toUpperCase();
  let seq = 0;
  /** สาขาของต้นทางสิทธิ์ (`--branch-id`, Task 15): ผูกบริษัท SHOP · ไม่ผูกบริษัท (`company_id` ว่าง) */
  let shopBranchId = '';
  let bareBranchId = '';
  let createdShopId: string | null = null;

  beforeAll(async () => {
    const dbName = new URL(process.env.DATABASE_URL as string).pathname.slice(1);
    if (!/^test_db$|_test$/.test(dbName)) {
      throw new Error(
        `สเปคนี้เขียนแถวจริง — ต้องรันกับฐานทดสอบ (test_db หรือ *_test) แต่ได้ "${dbName}"`,
      );
    }
    process.env.PII_ENCRYPTION_KEY = KEY;
    process.env.PII_HASH_SALT = SALT;
    prisma = new PrismaClient();
    logged = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
    logged.$on('query', (e) => {
      if (capture && !/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(e.query.trim())) {
        statements.push(`${e.query} -- ${e.params}`);
      }
    });
    await Promise.all([prisma.$connect(), logged.$connect()]);
    pii = new CustomerPiiService(prisma as unknown as PrismaService);

    let shop = await prisma.companyInfo.findFirst({
      where: { companyCode: 'SHOP' },
      select: { id: true },
    });
    if (!shop) {
      shop = await prisma.companyInfo.create({
        data: {
          nameTh: `${TEST_NAME_PREFIX} SHOP T15`,
          taxId: '0000000000000',
          companyCode: 'SHOP',
          address: '1 Test Rd.',
          directorName: `${TEST_NAME_PREFIX} กรรมการ`,
        },
        select: { id: true },
      });
      createdShopId = shop.id;
    }
    shopBranchId = (
      await prisma.branch.create({
        data: { name: `${TEST_NAME_PREFIX} T15 SHOP ${stamp}`, companyId: shop.id },
        select: { id: true },
      })
    ).id;
    bareBranchId = (
      await prisma.branch.create({
        data: { name: `${TEST_NAME_PREFIX} T15 ไม่ผูกบริษัท ${stamp}` },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    const mine = {
      OR: [
        { id: { in: [...customerIds] } },
        { legacyMemberCode: { startsWith: `TEST-T8-${stamp}` } },
      ],
    };
    const leftovers = await prisma.customer.findMany({ where: mine, select: { contactId: true } });
    for (const c of leftovers) if (c.contactId) contactIds.add(c.contactId);
    await prisma.customer.deleteMany({ where: mine });
    await prisma.contact.deleteMany({
      where: {
        OR: [{ id: { in: [...contactIds] } }, { contactCode: { startsWith: `T8C-${stamp}` } }],
      },
    });
    await prisma.branch.deleteMany({
      where: { id: { in: [shopBranchId, bareBranchId].filter(Boolean) } },
    });
    if (createdShopId) await prisma.companyInfo.deleteMany({ where: { id: createdShopId } });
    await Promise.all([prisma.$disconnect(), logged.$disconnect()]);
    if (saved.key === undefined) delete process.env.PII_ENCRYPTION_KEY;
    else process.env.PII_ENCRYPTION_KEY = saved.key;
    if (saved.salt === undefined) delete process.env.PII_HASH_SALT;
    else process.env.PII_HASH_SALT = saved.salt;
  });

  const hash = (v: string) => hashPII(v, SALT);

  function thaiId(first12: string): string {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (13 - i);
    return `${first12}${(11 - (sum % 11)) % 10}`;
  }

  async function freshNationalId(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const id = thaiId(`09${String(Math.floor(Math.random() * 1e10)).padStart(10, '0')}`);
      const taken =
        (await prisma.customer.count({
          where: { OR: [{ nationalId: id }, { nationalIdHash: hash(id) }] },
        })) + (await prisma.contact.count({ where: { nationalIdHash: hash(id) } }));
      if (taken === 0) return id;
    }
    throw new Error('หาเลขบัตรทดสอบที่ว่างไม่ได้');
  }

  async function freshPhone(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const phone = `0977${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
      const taken = await prisma.customer.count({
        where: { OR: [{ phone }, { phoneHash: hash(phone) }] },
      });
      if (taken === 0) return phone;
    }
    throw new Error('หาเบอร์ทดสอบที่ว่างไม่ได้');
  }

  const memberCode = () => `TEST-T8-${stamp}-${++seq}`;
  const peakCode = () => `T8${stamp.slice(-8)}${++seq}`;

  async function legacyInput(
    over: Partial<LegacyCustomerInput> = {},
  ): Promise<LegacyCustomerInput> {
    const n = ++seq;
    return {
      legacyMemberCode: memberCode(),
      peakContactCode: null,
      overrideCustomerId: null,
      name: `${TEST_NAME_PREFIX} legacy-t8 ระบบเก่า ${n}`,
      nickname: 'ทด',
      nationalId: await freshNationalId(),
      phone: await freshPhone(),
      phoneInvalid: false,
      phoneSecondary: null,
      birthDate: new Date(Date.UTC(1990, 4, 17)),
      addressIdCard: `${n}/1 หมู่ 1 ต.ทดสอบ อ.ทดสอบ จ.ทดสอบ 15000`,
      addressCurrent: null,
      addressWork: null,
      lineId: `line-t8-${n}`,
      facebookLink: `https://facebook.com/t8.${n}`,
      occupation: 'พนักงาน',
      occupationDetail: null,
      workplace: 'บริษัททดสอบ',
      salary: new Prisma.Decimal('15000'),
      ...over,
    };
  }

  async function contact(
    label: string,
    data: { nationalId?: string; peakContactCode?: string | null },
  ) {
    const row = await prisma.contact.create({
      data: {
        contactCode: `T8C-${stamp}-${++seq}`,
        name: `${TEST_NAME_PREFIX} legacy-t8 contact ${label}`,
        nationalIdHash: data.nationalId ? hash(data.nationalId) : null,
        peakContactCode: data.peakContactCode ?? null,
        roles: ['CUSTOMER'],
      },
    });
    contactIds.add(row.id);
    return row;
  }

  /** ลูกค้าที่มีอยู่แล้วใน BESTCHOICE — เลือกได้ว่าเก็บเลขบัตรแบบ plaintext / hash / ทั้งคู่ */
  async function existing(
    label: string,
    data: {
      nationalId?: string;
      store?: 'both' | 'plaintext' | 'hash';
      phone?: string | null;
      legacyMemberCode?: string | null;
      contactId?: string | null;
      deletedAt?: Date | null;
      accessCompanyCode?: 'SHOP' | 'FINANCE' | null;
    },
  ) {
    const store = data.store ?? 'both';
    const row = await prisma.customer.create({
      data: {
        name: `${TEST_NAME_PREFIX} legacy-t8 เดิม ${label}`,
        nationalId: data.nationalId && store !== 'hash' ? data.nationalId : null,
        nationalIdHash: data.nationalId && store !== 'plaintext' ? hash(data.nationalId) : null,
        phone: data.phone ?? null,
        phoneHash: data.phone ? hash(data.phone) : null,
        addressIdCard: `ที่อยู่เดิม ${label}`,
        legacyMemberCode: data.legacyMemberCode ?? null,
        contactId: data.contactId ?? null,
        deletedAt: data.deletedAt ?? null,
        accessCompanyCode: data.accessCompanyCode ?? null,
      },
    });
    customerIds.add(row.id);
    return row;
  }

  async function track(result: CustomerLinkResult) {
    if (!result.customerId) return;
    customerIds.add(result.customerId);
    const row = await prisma.customer.findUnique({
      where: { id: result.customerId },
      select: { contactId: true },
    });
    if (row?.contactId) contactIds.add(row.contactId);
  }

  async function run(input: LegacyCustomerInput, options: LinkLegacyCustomerOptions = {}) {
    const result = await prisma.$transaction((tx) =>
      linkOrCreateLegacyCustomer(tx, pii, input, options),
    );
    await track(result);
    return result;
  }

  /** รันผ่าน client ที่จด SQL — คืนผลพร้อมคำสั่งทุกคำสั่งในทรานแซกชัน (ไม่นับ BEGIN/COMMIT) */
  async function runLogged(input: LegacyCustomerInput, options: LinkLegacyCustomerOptions = {}) {
    statements.length = 0;
    capture = true;
    try {
      const result = await logged.$transaction((tx) =>
        linkOrCreateLegacyCustomer(tx, pii, input, options),
      );
      await track(result);
      return { result, sql: [...statements] };
    } finally {
      capture = false;
    }
  }

  const phoneLocks = (sql: string[]) =>
    sql.filter((q) => /pg_advisory_xact_lock\(hashtext/.test(q));
  const contactCodeLockAt = (sql: string[]) =>
    sql.findIndex((q) => /pg_advisory_xact_lock\(-?\d+\)/.test(q));

  /** ล็อกเบอร์ของ input เป็นคำสั่งแรก ครั้งเดียว และ `contact:code` (ถ้ามี) มาทีหลัง */
  function expectPhoneLockFirst(sql: string[], phone: string | null, contactCreated: boolean) {
    expect(sql[0]).toMatch(/pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
    expect(sql[0]).toContain(customerPhoneLockKey(pii, phone) as string);
    expect(phoneLocks(sql)).toHaveLength(1);
    if (contactCreated) expect(contactCodeLockAt(sql)).toBeGreaterThan(0);
  }

  async function customerWithContact(id: string) {
    return prisma.customer.findUniqueOrThrow({ where: { id }, include: { contact: true } });
  }

  /** ผลที่บล็อกต้องไม่ทิ้งแถวไว้เลย — ไม่มีลูกค้าที่ถือรหัสสมาชิก และไม่มี contact ที่ถือเลขบัตรของ input */
  async function expectNoWrites(input: LegacyCustomerInput) {
    expect(
      await prisma.customer.count({ where: { legacyMemberCode: input.legacyMemberCode } }),
    ).toBe(0);
    if (input.nationalId) {
      expect(
        await prisma.contact.count({ where: { nationalIdHash: hash(input.nationalId) } }),
      ).toBe(0);
    }
  }

  describe('CREATED', () => {
    it('encrypts PII, stamps legacyMemberCode, links a new Contact with the PEAK code; locks phone first', async () => {
      const input = await legacyInput({ peakContactCode: peakCode() });
      const { result, sql } = await runLogged(input);
      expect(result).toEqual({
        outcome: 'CREATED',
        customerId: expect.any(String),
        writes: ['customerCreated', 'contactCreated', 'peakContactCode', 'contactLineId'],
      });
      expectPhoneLockFirst(sql, input.phone, true);

      const row = await customerWithContact(result.customerId as string);
      expect(row.legacyMemberCode).toBe(input.legacyMemberCode);
      expect(row.name).toBe(input.name);
      expect(row.nationalIdHash).toBe(hash(input.nationalId as string));
      expect(decryptPII(row.nationalIdEncrypted as string, KEY)).toBe(input.nationalId);
      expect(row.phone).toBe(input.phone);
      expect(row.phoneHash).toBe(hash(input.phone as string));
      expect(decryptPII(row.phoneEncrypted as string, KEY)).toBe(input.phone);
      expect(decryptPII(row.addressIdCardEncrypted as string, KEY)).toBe(input.addressIdCard);
      expect(row.birthDate).toEqual(input.birthDate);
      expect(row.facebookLink).toBe(input.facebookLink);
      expect(row.salary).toEqual(input.salary);
      // LINE ของระบบเก่าไม่ใช่ LINE userId ของ OA ระบบนี้ — ห้ามลงช่องที่ระบบใช้ส่งข้อความ
      expect(row.lineIdFinance).toBeNull();
      expect(row.contact).toMatchObject({
        peakContactCode: input.peakContactCode,
        nationalIdHash: hash(input.nationalId as string),
        lineId: input.lineId,
        deletedAt: null,
      });
      expect(row.contact?.roles).toContain('CUSTOMER');
    });

    it("no phone (invalid in the legacy row) → phone '', no hash, no phone lock; result flags phoneInvalid", async () => {
      const input = await legacyInput({ phone: null, phoneInvalid: true });
      const { result, sql } = await runLogged(input);
      expect(result).toMatchObject({ outcome: 'CREATED', phoneInvalid: true });
      expect(phoneLocks(sql)).toEqual([]);
      expect(contactCodeLockAt(sql)).toBeGreaterThanOrEqual(0);
      const row = await customerWithContact(result.customerId as string);
      expect(row.phone).toBe('');
      expect(row.phoneHash).toBeNull();
      expect(row.phoneEncrypted).toBeNull();
    });

    it('reuses a keyed Contact that has no customer yet and sets the PEAK code', async () => {
      const nationalId = await freshNationalId();
      const keyed = await contact('no-customer', { nationalId });
      const input = await legacyInput({ nationalId, peakContactCode: peakCode() });
      const result = await run(input);
      expect(result).toMatchObject({
        outcome: 'CREATED',
        writes: ['customerCreated', 'peakContactCode', 'contactLineId'],
      });
      const row = await customerWithContact(result.customerId as string);
      expect(row.contactId).toBe(keyed.id);
      expect(row.contact?.peakContactCode).toBe(input.peakContactCode);
    });
  });

  describe('LINKED', () => {
    it('runs again with the same input (second contract) → LINKED with empty writes, no second row', async () => {
      const input = await legacyInput({ peakContactCode: peakCode() });
      const first = await run(input);
      expect(await run(input)).toEqual({
        outcome: 'LINKED',
        customerId: first.customerId,
        writes: [],
      });
      expect(
        await prisma.customer.count({
          where: { nationalIdHash: hash(input.nationalId as string) },
        }),
      ).toBe(1);
    });

    it('by national id: never overwrites name/phone/address; fills legacyMemberCode and the PEAK code', async () => {
      const nationalId = await freshNationalId();
      const oldPhone = await freshPhone();
      const linkedContact = await contact('linked', { nationalId });
      const before = await existing('linked', {
        nationalId,
        phone: oldPhone,
        contactId: linkedContact.id,
      });
      const input = await legacyInput({ nationalId, peakContactCode: peakCode() });

      expect(await run(input)).toEqual({
        outcome: 'LINKED',
        customerId: before.id,
        writes: ['legacyMemberCode', 'peakContactCode'],
      });
      const after = await customerWithContact(before.id);
      expect(after.name).toBe(before.name);
      expect(after.phone).toBe(oldPhone);
      expect(after.phoneHash).toBe(hash(oldPhone));
      expect(after.addressIdCard).toBe(before.addressIdCard);
      expect(after.addressIdCardEncrypted).toBeNull();
      expect(after.birthDate).toBeNull();
      expect(after.legacyMemberCode).toBe(input.legacyMemberCode);
      expect(after.contactId).toBe(linkedContact.id);
      expect(after.contact?.peakContactCode).toBe(input.peakContactCode);
    });

    it('plaintext-only row with another legacy code and no Contact: keeps the code, creates + links a Contact; phone locked first', async () => {
      const nationalId = await freshNationalId();
      const otherCode = memberCode();
      const before = await existing('plaintext', {
        nationalId,
        store: 'plaintext',
        legacyMemberCode: otherCode,
      });
      const input = await legacyInput({ nationalId, peakContactCode: peakCode() });

      const { result, sql } = await runLogged(input);
      expect(result).toEqual({
        outcome: 'LINKED',
        customerId: before.id,
        writes: ['contactCreated', 'contactId', 'peakContactCode'],
      });
      expectPhoneLockFirst(sql, input.phone, true);
      const after = await customerWithContact(before.id);
      expect(after.legacyMemberCode).toBe(otherCode);
      expect(after.name).toBe(before.name);
      expect(after.nationalIdHash).toBeNull();
      expect(after.contact).toMatchObject({
        name: before.name,
        nationalIdHash: hash(nationalId),
        peakContactCode: input.peakContactCode,
      });
    });

    it('by legacyMemberCode only (the legacy national id changed): links without touching the stored id', async () => {
      const storedId = await freshNationalId();
      const code = memberCode();
      const holderCode = peakCode();
      const keyed = await contact('by-code', { nationalId: storedId, peakContactCode: holderCode });
      const before = await existing('by-code', {
        nationalId: storedId,
        legacyMemberCode: code,
        contactId: keyed.id,
      });
      const input = await legacyInput({ legacyMemberCode: code, peakContactCode: holderCode });

      expect(await run(input)).toEqual({ outcome: 'LINKED', customerId: before.id, writes: [] });
      const after = await prisma.customer.findUniqueOrThrow({ where: { id: before.id } });
      expect(after.nationalId).toBe(storedId);
      expect(after.nationalIdHash).toBe(hash(storedId));
    });

    it('to the id-less stub on the Contact holding this national id: fills the id, not PHONE_TAKEN', async () => {
      const nationalId = await freshNationalId();
      const phone = await freshPhone();
      const keyed = await contact('stub', { nationalId });
      const stub = await existing('stub', { phone, contactId: keyed.id });
      const input = await legacyInput({ nationalId, phone, peakContactCode: peakCode() });

      expect(await run(input)).toEqual({
        outcome: 'LINKED',
        customerId: stub.id,
        writes: ['legacyMemberCode', 'nationalId', 'peakContactCode'],
      });
      const after = await customerWithContact(stub.id);
      expect(after.name).toBe(stub.name);
      expect(after.phone).toBe(phone);
      expect(after.legacyMemberCode).toBe(input.legacyMemberCode);
      expect(after.nationalId).toBe(nationalId);
      expect(after.nationalIdHash).toBe(hash(nationalId));
      expect(decryptPII(after.nationalIdEncrypted as string, KEY)).toBe(nationalId);
      expect(after.contact?.peakContactCode).toBe(input.peakContactCode);
    });
  });

  describe('access origin of --branch-id (Task 15) — CREATED only, LINKED never overwrites', () => {
    it('resolveLegacyCustomerOrigin on real rows: branch company code · no company → SHOP fallback · unknown branch → throws', async () => {
      expect(await resolveLegacyCustomerOrigin(prisma, shopBranchId)).toEqual({
        accessCompanyCode: 'SHOP',
        accessBranchId: shopBranchId,
        companyFallback: false,
      });
      expect(await resolveLegacyCustomerOrigin(prisma, bareBranchId)).toEqual({
        accessCompanyCode: 'SHOP',
        accessBranchId: bareBranchId,
        companyFallback: true,
      });
      await expect(
        resolveLegacyCustomerOrigin(prisma, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toThrow(/ไม่พบสาขา/);
    });

    it.each([
      ['a branch with a SHOP company', () => shopBranchId],
      ['a branch without a company (SHOP fallback)', () => bareBranchId],
    ])(
      'CREATED via %s: the new customer and its new Contact carry SHOP + the branch',
      async (_label, branch) => {
        const origin = await resolveLegacyCustomerOrigin(prisma, branch());
        const input = await legacyInput({ peakContactCode: peakCode() });
        const result = await run(input, { origin });
        expect(result).toMatchObject({
          outcome: 'CREATED',
          writes: expect.arrayContaining(['customerCreated', 'contactCreated']),
        });
        const row = await customerWithContact(result.customerId as string);
        expect(row).toMatchObject({ accessCompanyCode: 'SHOP', accessBranchId: branch() });
        expect(row.contact).toMatchObject({ accessCompanyCode: 'SHOP', accessBranchId: branch() });
      },
    );

    it('CREATED on a reused keyed Contact: the customer gets the origin, the existing Contact is left as is', async () => {
      const nationalId = await freshNationalId();
      const keyed = await contact('origin-keyed', { nationalId });
      const origin = await resolveLegacyCustomerOrigin(prisma, shopBranchId);
      const result = await run(await legacyInput({ nationalId }), { origin });
      expect(result.outcome).toBe('CREATED');
      const row = await customerWithContact(result.customerId as string);
      expect(row.contactId).toBe(keyed.id);
      expect(row).toMatchObject({ accessCompanyCode: 'SHOP', accessBranchId: shopBranchId });
      expect(row.contact).toMatchObject({ accessCompanyCode: null, accessBranchId: null });
    });

    it('LINKED keeps the existing origin: by national id (own origin), plaintext-only (new Contact), override', async () => {
      const origin = await resolveLegacyCustomerOrigin(prisma, shopBranchId);

      const nationalId = await freshNationalId();
      const own = await existing('origin-own', { nationalId, accessCompanyCode: 'FINANCE' });
      expect((await run(await legacyInput({ nationalId }), { origin })).outcome).toBe('LINKED');
      expect(await prisma.customer.findUniqueOrThrow({ where: { id: own.id } })).toMatchObject({
        accessCompanyCode: 'FINANCE',
        accessBranchId: null,
      });

      const plainId = await freshNationalId();
      const plain = await existing('origin-plain', { nationalId: plainId, store: 'plaintext' });
      expect(await run(await legacyInput({ nationalId: plainId }), { origin })).toMatchObject({
        outcome: 'LINKED',
        writes: expect.arrayContaining(['contactCreated', 'contactId']),
      });
      const after = await customerWithContact(plain.id);
      expect(after).toMatchObject({ accessCompanyCode: null, accessBranchId: null });
      expect(after.contact).toMatchObject({ accessCompanyCode: null, accessBranchId: null });

      const target = await existing('origin-override', {});
      expect(
        (await run(await legacyInput({ overrideCustomerId: target.id }), { origin })).outcome,
      ).toBe('LINKED');
      expect(await prisma.customer.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({
        accessCompanyCode: null,
        accessBranchId: null,
      });
    });
  });

  describe('blocked — nothing written', () => {
    it('PHONE_TAKEN: the phone belongs to another live customer', async () => {
      const phone = await freshPhone();
      const owner = await existing('phone-owner', { nationalId: await freshNationalId(), phone });
      const input = await legacyInput({ phone, peakContactCode: peakCode() });

      expect(await run(input)).toEqual<CustomerLinkResult>({
        outcome: 'PHONE_TAKEN',
        customerId: null,
        relatedCustomerId: owner.id,
      });
      await expectNoWrites(input);
    });

    it('INVALID_NATIONAL_ID: bad checksum or no id → blocked before any statement', async () => {
      const good = await freshNationalId();
      const badChecksum = `${good.slice(0, 12)}${(Number(good[12]) + 1) % 10}`;
      for (const nationalId of [badChecksum, null, '12345']) {
        const input = await legacyInput({ nationalId });
        const { result, sql } = await runLogged(input);
        expect(result).toEqual({ outcome: 'INVALID_NATIONAL_ID', customerId: null });
        expect(sql).toEqual([]);
        await expectNoWrites(input);
      }
    });

    it('PEAK_CODE_CONFLICT: the Contact holds another code (both codes reported); the same code → LINKED', async () => {
      const nationalId = await freshNationalId();
      const holderCode = peakCode();
      const linkedContact = await contact('peak', { nationalId, peakContactCode: holderCode });
      const before = await existing('peak', {
        nationalId,
        store: 'hash',
        contactId: linkedContact.id,
      });

      const conflicting = await legacyInput({ nationalId, peakContactCode: peakCode() });
      expect(await run(conflicting)).toEqual({
        outcome: 'PEAK_CODE_CONFLICT',
        customerId: null,
        relatedCustomerId: before.id,
        existingPeakContactCode: holderCode,
        requestedPeakContactCode: conflicting.peakContactCode,
      });
      const untouched = await customerWithContact(before.id);
      expect(untouched.legacyMemberCode).toBeNull();
      expect(untouched.contact?.peakContactCode).toBe(holderCode);

      const same = await legacyInput({ nationalId, peakContactCode: holderCode });
      expect(await run(same)).toEqual({
        outcome: 'LINKED',
        customerId: before.id,
        writes: ['legacyMemberCode'],
      });
    });

    it('PEAK_CODE_CONFLICT on a keyed Contact without a customer → no customer is created', async () => {
      const nationalId = await freshNationalId();
      const holderCode = peakCode();
      const keyed = await contact('peak-no-customer', { nationalId, peakContactCode: holderCode });
      const input = await legacyInput({ nationalId, peakContactCode: peakCode() });
      expect(await run(input)).toEqual({
        outcome: 'PEAK_CODE_CONFLICT',
        customerId: null,
        existingPeakContactCode: holderCode,
        requestedPeakContactCode: input.peakContactCode,
      });
      expect(
        await prisma.customer.count({ where: { legacyMemberCode: input.legacyMemberCode } }),
      ).toBe(0);
      expect(await prisma.customer.count({ where: { contactId: keyed.id } })).toBe(0);
    });

    it('NATIONAL_ID_CONFLICT: a soft-deleted holder, a plaintext/hash split, or a code held by someone else', async () => {
      const deletedId = await freshNationalId();
      const ghost = await existing('ghost', { nationalId: deletedId, deletedAt: new Date() });
      const ghostInput = await legacyInput({ nationalId: deletedId });
      expect(await run(ghostInput)).toEqual({
        outcome: 'NATIONAL_ID_CONFLICT',
        customerId: null,
        relatedCustomerId: ghost.id,
      });
      await expectNoWrites({ ...ghostInput, nationalId: null });

      const splitId = await freshNationalId();
      await existing('split-plain', { nationalId: splitId, store: 'plaintext' });
      await existing('split-hash', { nationalId: splitId, store: 'hash' });
      const splitInput = await legacyInput({ nationalId: splitId });
      expect((await run(splitInput)).outcome).toBe('NATIONAL_ID_CONFLICT');
      expect(
        await prisma.customer.count({ where: { legacyMemberCode: splitInput.legacyMemberCode } }),
      ).toBe(0);

      const code = memberCode();
      await existing('code-holder', {
        nationalId: await freshNationalId(),
        legacyMemberCode: code,
      });
      const heldId = await freshNationalId();
      const idHolder = await existing('id-holder', { nationalId: heldId });
      const crossed = await legacyInput({ legacyMemberCode: code, nationalId: heldId });
      expect((await run(crossed)).outcome).toBe('NATIONAL_ID_CONFLICT');
      expect(
        (await prisma.customer.findUniqueOrThrow({ where: { id: idHolder.id } })).legacyMemberCode,
      ).toBeNull();
    });

    it('NATIONAL_ID_CONFLICT: the customer on the keyed Contact has a (different) id, or there are two stubs', async () => {
      const nationalId = await freshNationalId();
      const keyed = await contact('keyed-other-id', { nationalId });
      const other = await existing('keyed-other-id', {
        nationalId: await freshNationalId(),
        contactId: keyed.id,
      });
      const input = await legacyInput({ nationalId });
      expect(await run(input)).toEqual({
        outcome: 'NATIONAL_ID_CONFLICT',
        customerId: null,
        relatedCustomerId: other.id,
      });
      expect(
        (await prisma.customer.findUniqueOrThrow({ where: { id: other.id } })).legacyMemberCode,
      ).toBeNull();

      const twoStubsId = await freshNationalId();
      const shared = await contact('two-stubs', { nationalId: twoStubsId });
      await existing('stub-1', { contactId: shared.id });
      const second = await existing('stub-2', { contactId: shared.id });
      const twoStubs = await legacyInput({ nationalId: twoStubsId });
      expect(await run(twoStubs)).toEqual({
        outcome: 'NATIONAL_ID_CONFLICT',
        customerId: null,
        relatedCustomerId: second.id,
      });
      expect(
        await prisma.customer.count({ where: { legacyMemberCode: twoStubs.legacyMemberCode } }),
      ).toBe(0);
    });

    it('NATIONAL_ID_CONFLICT: the existing customer points at a soft-deleted Contact (contactId is not re-pointed)', async () => {
      const nationalId = await freshNationalId();
      const deleted = await contact('deleted', {});
      await prisma.contact.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
      const before = await existing('deleted-contact', { nationalId, contactId: deleted.id });
      const input = await legacyInput({ nationalId, peakContactCode: peakCode() });

      expect(await run(input)).toEqual({
        outcome: 'NATIONAL_ID_CONFLICT',
        customerId: null,
        relatedCustomerId: before.id,
      });
      const after = await prisma.customer.findUniqueOrThrow({ where: { id: before.id } });
      expect(after.contactId).toBe(deleted.id);
      expect(after.legacyMemberCode).toBeNull();
      expect(await prisma.contact.count({ where: { nationalIdHash: hash(nationalId) } })).toBe(0);
    });
  });

  describe('override (--customer-overrides)', () => {
    it('links to the chosen customer, skipping phone/id checks, still applying the PEAK rule; phone locked first', async () => {
      const phone = await freshPhone();
      await existing('override-phone-owner', { nationalId: await freshNationalId(), phone });
      const target = await existing('override-target', { phone: await freshPhone() });
      const input = await legacyInput({
        nationalId: '1234567890123',
        phone,
        peakContactCode: peakCode(),
        overrideCustomerId: target.id,
      });

      const { result, sql } = await runLogged(input);
      expect(result).toEqual({
        outcome: 'LINKED',
        customerId: target.id,
        writes: ['contactCreated', 'contactId', 'legacyMemberCode', 'peakContactCode'],
      });
      expectPhoneLockFirst(sql, input.phone, true);
      const after = await customerWithContact(target.id);
      expect(after.name).toBe(target.name);
      expect(after.phone).toBe(target.phone);
      // เลขบัตรของ input ผิด checksum — ไม่เติม
      expect(after.nationalIdHash).toBeNull();
      expect(after.legacyMemberCode).toBe(input.legacyMemberCode);
      expect(after.contact?.peakContactCode).toBe(input.peakContactCode);

      const other = await legacyInput({
        peakContactCode: peakCode(),
        overrideCustomerId: target.id,
      });
      expect(await run(other)).toEqual({
        outcome: 'PEAK_CODE_CONFLICT',
        customerId: null,
        relatedCustomerId: target.id,
        existingPeakContactCode: input.peakContactCode,
        requestedPeakContactCode: other.peakContactCode,
      });
    });

    it('fills a valid national id on an id-less target only when no row (even soft-deleted) holds it', async () => {
      const target = await existing('override-fill', { phone: await freshPhone() });
      const nationalId = await freshNationalId();
      expect(
        await run(await legacyInput({ nationalId, overrideCustomerId: target.id })),
      ).toMatchObject({ outcome: 'LINKED', writes: expect.arrayContaining(['nationalId']) });
      const filled = await prisma.customer.findUniqueOrThrow({ where: { id: target.id } });
      expect(filled.nationalId).toBe(nationalId);
      expect(filled.nationalIdHash).toBe(hash(nationalId));
      expect(decryptPII(filled.nationalIdEncrypted as string, KEY)).toBe(nationalId);

      const heldId = await freshNationalId();
      await existing('override-fill-ghost', { nationalId: heldId, deletedAt: new Date() });
      const second = await existing('override-no-fill', {});
      expect(
        await run(await legacyInput({ nationalId: heldId, overrideCustomerId: second.id })),
      ).toEqual({
        outcome: 'LINKED',
        customerId: second.id,
        writes: ['contactCreated', 'contactId', 'legacyMemberCode'],
      });
      expect(
        (await prisma.customer.findUniqueOrThrow({ where: { id: second.id } })).nationalIdHash,
      ).toBeNull();
    });

    it('to a missing / deleted customer, or a code already held elsewhere → throws', async () => {
      const gone = await existing('override-gone', { deletedAt: new Date() });
      await expect(run(await legacyInput({ overrideCustomerId: gone.id }))).rejects.toThrow(
        /customer-overrides/,
      );
      const code = memberCode();
      await existing('override-code-holder', { legacyMemberCode: code });
      const target = await existing('override-other-target', {});
      await expect(
        run(await legacyInput({ legacyMemberCode: code, overrideCustomerId: target.id })),
      ).rejects.toThrow(/customer-overrides/);
    });
  });

  describe('single main transaction (lockLegacyCustomerPhones + phoneLocked)', () => {
    it('locks each distinct phone once, in sorted key order, as the first statements; phoneLocked calls add no lock', async () => {
      const a = await legacyInput({ peakContactCode: peakCode() });
      const b = await legacyInput({ peakContactCode: peakCode() });
      const noPhone = await legacyInput({ phone: null });
      statements.length = 0;
      capture = true;
      let results: CustomerLinkResult[] = [];
      try {
        results = await logged.$transaction(async (tx) => {
          // ส่งเบอร์ที่คีย์มากกว่าก่อน — ผลต้องออกมาเรียงคีย์ ไม่ใช่ตามลำดับที่ส่ง
          const [high, low] =
            (customerPhoneLockKey(pii, a.phone) as string) >
            (customerPhoneLockKey(pii, b.phone) as string)
              ? [a, b]
              : [b, a];
          await lockLegacyCustomerPhones(tx, pii, [high, low, high, noPhone]);
          const out: CustomerLinkResult[] = [];
          for (const input of [a, b, noPhone]) {
            out.push(await linkOrCreateLegacyCustomer(tx, pii, input, { phoneLocked: true }));
          }
          return out;
        });
      } finally {
        capture = false;
      }
      for (const r of results) await track(r);
      expect(results.map((r) => r.outcome)).toEqual(['CREATED', 'CREATED', 'CREATED']);

      const sql = [...statements];
      const keys = [a.phone, b.phone].map((p) => customerPhoneLockKey(pii, p) as string).sort();
      expect(phoneLocks(sql)).toHaveLength(2);
      expect(sql[0]).toContain(keys[0]);
      expect(sql[1]).toContain(keys[1]);
      expect(contactCodeLockAt(sql)).toBeGreaterThan(1);
    });

    it('phoneLocked: true issues no phone lock (normal and override paths)', async () => {
      const normal = await runLogged(await legacyInput(), { phoneLocked: true });
      expect(normal.result.outcome).toBe('CREATED');
      expect(phoneLocks(normal.sql)).toEqual([]);

      const target = await existing('locked-override', {});
      const override = await runLogged(await legacyInput({ overrideCustomerId: target.id }), {
        phoneLocked: true,
      });
      expect(override.result.outcome).toBe('LINKED');
      expect(phoneLocks(override.sql)).toEqual([]);
    });
  });
});
