import { Prisma, PrismaClient } from '@prisma/client';
import { CustomerPiiService } from '../../../modules/customers/customer-pii.service';
import { customerPhoneLockKey } from '../../../modules/customers/customer-phone-lock';
import type { PrismaService } from '../../../prisma/prisma.service';
import { decryptPII } from '../../../utils/crypto.util';
import { hashPII } from '../../../utils/pii.util';
import { TEST_NAME_PREFIX } from '../../../utils/test-data-markers';
import {
  linkOrCreateLegacyCustomer,
  type CustomerLinkResult,
  type LegacyCustomerInput,
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
      },
    });
    customerIds.add(row.id);
    return row;
  }

  async function run(
    input: LegacyCustomerInput,
    client: Pick<PrismaClient, '$transaction'> = prisma,
  ) {
    const result = await client.$transaction((tx) => linkOrCreateLegacyCustomer(tx, pii, input));
    if (result.customerId) {
      customerIds.add(result.customerId);
      const row = await prisma.customer.findUnique({
        where: { id: result.customerId },
        select: { contactId: true },
      });
      if (row?.contactId) contactIds.add(row.contactId);
    }
    return result;
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

  it('CREATED: encrypts PII, stamps legacyMemberCode, links a new Contact with the PEAK code', async () => {
    const input = await legacyInput({ peakContactCode: peakCode() });
    const result = await run(input);
    expect(result.outcome).toBe('CREATED');

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

  it('runs again with the same input → LINKED to the same customer, no second row', async () => {
    const input = await legacyInput({ peakContactCode: peakCode() });
    const first = await run(input);
    const second = await run(input);
    expect(second).toEqual({ outcome: 'LINKED', customerId: first.customerId });
    expect(
      await prisma.customer.count({ where: { nationalIdHash: hash(input.nationalId as string) } }),
    ).toBe(1);
  });

  it('LINKED by national id: never overwrites name/phone/address; fills legacyMemberCode and the PEAK code', async () => {
    const nationalId = await freshNationalId();
    const oldPhone = await freshPhone();
    const linkedContact = await contact('linked', { nationalId });
    const before = await existing('linked', {
      nationalId,
      phone: oldPhone,
      contactId: linkedContact.id,
    });
    const input = await legacyInput({ nationalId, peakContactCode: peakCode() });

    const result = await run(input);
    expect(result).toEqual({ outcome: 'LINKED', customerId: before.id });

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

  it('LINKED (plaintext-only row with another legacy code, no Contact): keeps the code, creates + links a Contact', async () => {
    const nationalId = await freshNationalId();
    const otherCode = memberCode();
    const before = await existing('plaintext', {
      nationalId,
      store: 'plaintext',
      legacyMemberCode: otherCode,
    });
    const input = await legacyInput({ nationalId, peakContactCode: peakCode() });

    const result = await run(input);
    expect(result).toEqual({ outcome: 'LINKED', customerId: before.id });

    const after = await customerWithContact(before.id);
    expect(after.legacyMemberCode).toBe(otherCode);
    expect(after.name).toBe(before.name);
    expect(after.contact).toMatchObject({
      name: before.name,
      nationalIdHash: hash(nationalId),
      peakContactCode: input.peakContactCode,
    });
  });

  it('LINKED to the stub on the Contact that already holds this national id (not PHONE_TAKEN)', async () => {
    const nationalId = await freshNationalId();
    const phone = await freshPhone();
    const keyed = await contact('stub', { nationalId });
    const stub = await existing('stub', { phone, contactId: keyed.id });
    const input = await legacyInput({ nationalId, phone, peakContactCode: peakCode() });

    const result = await run(input);
    expect(result).toEqual({ outcome: 'LINKED', customerId: stub.id });
    const after = await customerWithContact(stub.id);
    expect(after.name).toBe(stub.name);
    expect(after.legacyMemberCode).toBe(input.legacyMemberCode);
    expect(after.contact?.peakContactCode).toBe(input.peakContactCode);
  });

  it('CREATED on a keyed Contact that has no customer yet: reuses it and sets the PEAK code', async () => {
    const nationalId = await freshNationalId();
    const keyed = await contact('no-customer', { nationalId });
    const input = await legacyInput({ nationalId, peakContactCode: peakCode() });

    const result = await run(input);
    expect(result.outcome).toBe('CREATED');
    const row = await customerWithContact(result.customerId as string);
    expect(row.contactId).toBe(keyed.id);
    expect(row.contact?.peakContactCode).toBe(input.peakContactCode);
  });

  it('PHONE_TAKEN: the phone belongs to another live customer → blocked, nothing written', async () => {
    const phone = await freshPhone();
    const owner = await existing('phone-owner', { nationalId: await freshNationalId(), phone });
    const input = await legacyInput({ phone, peakContactCode: peakCode() });

    const result = await run(input);
    expect(result).toEqual<CustomerLinkResult>({
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
      statements.length = 0;
      capture = true;
      const result = await run(input, logged);
      capture = false;
      expect(result).toEqual({ outcome: 'INVALID_NATIONAL_ID', customerId: null });
      expect(statements).toEqual([]);
      await expectNoWrites(input);
    }
  });

  it('PEAK_CODE_CONFLICT: existing Contact holds a different code → blocked, nothing written; same code → LINKED', async () => {
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
    });
    const untouched = await customerWithContact(before.id);
    expect(untouched.legacyMemberCode).toBeNull();
    expect(untouched.contact?.peakContactCode).toBe(holderCode);

    const same = await legacyInput({ nationalId, peakContactCode: holderCode });
    expect(await run(same)).toEqual({ outcome: 'LINKED', customerId: before.id });
  });

  it('PEAK_CODE_CONFLICT on a keyed Contact without a customer → no customer is created', async () => {
    const nationalId = await freshNationalId();
    const keyed = await contact('peak-no-customer', { nationalId, peakContactCode: peakCode() });
    const input = await legacyInput({ nationalId, peakContactCode: peakCode() });
    expect(await run(input)).toEqual({ outcome: 'PEAK_CODE_CONFLICT', customerId: null });
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
    await existing('code-holder', { nationalId: await freshNationalId(), legacyMemberCode: code });
    const heldId = await freshNationalId();
    const idHolder = await existing('id-holder', { nationalId: heldId });
    const crossed = await legacyInput({ legacyMemberCode: code, nationalId: heldId });
    expect((await run(crossed)).outcome).toBe('NATIONAL_ID_CONFLICT');
    expect(
      (await prisma.customer.findUniqueOrThrow({ where: { id: idHolder.id } })).legacyMemberCode,
    ).toBeNull();
  });

  it('override: links to the chosen customer, skipping phone/id checks, still applying the PEAK rule', async () => {
    const phone = await freshPhone();
    await existing('override-phone-owner', { nationalId: await freshNationalId(), phone });
    const target = await existing('override-target', { phone: await freshPhone() });
    const input = await legacyInput({
      nationalId: '1234567890123',
      phone,
      peakContactCode: peakCode(),
      overrideCustomerId: target.id,
    });

    expect(await run(input)).toEqual({ outcome: 'LINKED', customerId: target.id });
    const after = await customerWithContact(target.id);
    expect(after.name).toBe(target.name);
    expect(after.phone).toBe(target.phone);
    expect(after.legacyMemberCode).toBe(input.legacyMemberCode);
    expect(after.contact?.peakContactCode).toBe(input.peakContactCode);

    const other = await legacyInput({ peakContactCode: peakCode(), overrideCustomerId: target.id });
    expect(await run(other)).toEqual({
      outcome: 'PEAK_CODE_CONFLICT',
      customerId: null,
      relatedCustomerId: target.id,
    });
  });

  it('override to a missing / deleted customer, or a code already held elsewhere → throws', async () => {
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

  it('locks the phone as the first statement of the transaction, before the contact:code lock', async () => {
    const input = await legacyInput({ peakContactCode: peakCode() });
    statements.length = 0;
    capture = true;
    const result = await run(input, logged);
    capture = false;
    expect(result.outcome).toBe('CREATED');

    expect(statements[0]).toMatch(/pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
    expect(statements[0]).toContain(customerPhoneLockKey(pii, input.phone) as string);
    const contactCodeLock = statements.findIndex((s) => /pg_advisory_xact_lock\(-?\d+\)/.test(s));
    expect(contactCodeLock).toBeGreaterThan(0);
    expect(statements.filter((s) => /pg_advisory_xact_lock\(hashtext/.test(s))).toHaveLength(1);
  });
});
