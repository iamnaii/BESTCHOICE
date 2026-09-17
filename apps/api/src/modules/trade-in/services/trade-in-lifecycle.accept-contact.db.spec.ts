import { TRADE_IN_DECLARATION_VERSION } from '@installment/shared';
import { Prisma, PrismaClient } from '@prisma/client';
import { TradeInLifecycleService } from './trade-in-lifecycle.service';
import { ContactResolverService } from '../../contacts/contact-resolver.service';
import { CustomerPiiService } from '../../customers/customer-pii.service';
import { CustomerWriteService } from '../../customers/services/customer-write.service';
import { hashPII } from '../../../utils/pii.util';

const PII_KEY = 'c'.repeat(64);
const PII_SALT = 'trade-in-accept-contact-spec-salt-0123';

/**
 * รับเครื่องเทิร์น (EXCHANGE) ที่ contact ผู้ขายไม่มีเลขบัตร (keyless) — Part E (2026-09-17)
 * accept ตรวจบัตรแล้วต้องผูก contact ด้วยเลขบัตรนั้นก่อนสร้าง stub ลูกค้า:
 *  (ก) ไม่มี contact อื่นถือเลขบัตร → เติม hash ให้ contact เดิม → พนักงานสร้างลูกค้าคนเดียวกัน
 *      (เลขบัตร + เบอร์เดิม) = upgrade stub ไม่ใช่ 409
 *  (ข) มี contact อื่นถือเลขบัตรอยู่แล้ว → ย้ายรายการไปผูก contact นั้น ใช้ลูกค้าของเขา ไม่สร้าง stub ใหม่
 *  (ค) contact มีเลขบัตรอยู่แล้ว → พฤติกรรมเดิม
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest <ไฟล์นี้> --runInBand
 */
describe('TradeInLifecycleService.accept — ผูกผู้ขายไม่มีเลขบัตรด้วยเลขบัตรที่ตรวจแล้ว (real DB)', () => {
  const prisma = new PrismaClient();
  const saved = { key: process.env.PII_ENCRYPTION_KEY, salt: process.env.PII_HASH_SALT };
  const stamp = String(Date.now()).slice(-8);
  const tradeInIds: string[] = [];
  const productIds = new Set<string>();
  const customerIds = new Set<string>();
  const contactIds = new Set<string>();
  let branchId = '';
  let userId = '';
  let pii: CustomerPiiService;
  let resolver: ContactResolverService;
  let service: TradeInLifecycleService;
  let staff: CustomerWriteService;
  const credits = { issue: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    process.env.PII_ENCRYPTION_KEY = PII_KEY;
    process.env.PII_HASH_SALT = PII_SALT;
    pii = new CustomerPiiService(prisma as never);
    resolver = new ContactResolverService(prisma as never, pii);
    service = new TradeInLifecycleService(
      prisma as never,
      {} as never,
      {} as never,
      resolver,
      pii,
      {} as never,
      {} as never,
      { execute: jest.fn() } as never,
      { resolveOutflowCashAccount: jest.fn() } as never,
      credits as never,
    );
    staff = new CustomerWriteService(prisma as never, resolver, {} as never, pii);
    const branch = await prisma.branch.create({ data: { name: `accept-contact spec ${stamp}` } });
    branchId = branch.id;
    const user = await prisma.user.create({
      data: {
        email: `accept-contact-spec-${stamp}@test.local`,
        name: 'accept-contact spec',
        role: 'SALES',
        password: '__NO_LOGIN__',
        accessibleCompanies: ['SHOP'],
        primaryCompany: 'SHOP',
        isActive: false,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.tradeIn.deleteMany({ where: { id: { in: tradeInIds } } });
    await prisma.product.deleteMany({ where: { id: { in: [...productIds] } } });
    const linked = await prisma.customer.findMany({
      where: { contactId: { in: [...contactIds] } },
      select: { id: true },
    });
    linked.forEach((c) => customerIds.add(c.id));
    await prisma.customer.deleteMany({ where: { id: { in: [...customerIds] } } });
    await prisma.contact.deleteMany({ where: { id: { in: [...contactIds] } } });
    if (branchId) await prisma.branch.deleteMany({ where: { id: branchId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    if (saved.key === undefined) delete process.env.PII_ENCRYPTION_KEY;
    else process.env.PII_ENCRYPTION_KEY = saved.key;
    if (saved.salt === undefined) delete process.env.PII_HASH_SALT;
    else process.env.PII_HASH_SALT = saved.salt;
  });

  beforeEach(() => credits.issue.mockClear());

  /** เลขบัตรประชาชนไทยสุ่มที่ checksum ถูก (ฐานเทสใช้ร่วมกัน — สุ่มกันชน) */
  function randomThaiId(): string {
    const d = [1, ...Array.from({ length: 11 }, () => Math.floor(Math.random() * 10))];
    const sum = d.reduce((acc, n, i) => acc + n * (13 - i), 0);
    return d.join('') + String((11 - (sum % 11)) % 10);
  }

  async function freshPhone(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const phone = `0967${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
      const taken = await prisma.customer.count({
        where: { OR: [{ phone }, { phoneHash: hashPII(phone, PII_SALT) }, { phoneSecondary: phone }] },
      });
      if (taken === 0) return phone;
    }
    throw new Error('หาเบอร์ทดสอบที่ว่างไม่ได้');
  }

  async function keylessContact(label: string, phone: string) {
    const c = await resolver.findOrCreateByNaturalKey(prisma as never, {
      name: `accept-contact ${label} ${stamp}`,
      taxId: null,
      nationalIdHash: null,
      phone,
      role: 'TRADE_IN_SELLER',
    });
    contactIds.add(c.id);
    return c;
  }

  async function appraisedExchange(sellerContactId: string) {
    const row = await prisma.tradeIn.create({
      data: {
        flow: 'EXCHANGE',
        status: 'APPRAISED',
        branchId,
        deviceBrand: 'Apple',
        deviceModel: `accept-contact ${stamp}`,
        offeredPrice: new Prisma.Decimal(5000),
        sellerContactId,
      },
    });
    tradeInIds.push(row.id);
    return row;
  }

  async function accept(tradeInId: string, nid: string, phone: string) {
    const result = await service.accept(
      tradeInId,
      {
        sellerName: `accept-contact seller ${stamp}`,
        sellerPhone: phone,
        sellerAddress: 'TEST ADDRESS',
        sellerIdCardNumber: nid,
        serialNumber: `TEST-SN-${stamp}-${Math.floor(Math.random() * 1e6)}`,
        imeiMissingReason: 'TEST: no cellular radio',
        idCardVerified: true,
        sellerConsentSigned: true,
        declarationVersion: TRADE_IN_DECLARATION_VERSION,
        sellerSignatureBase64: 'data:image/png;base64,dGVzdA==',
        paymentMethod: 'CASH',
      } as never,
      userId,
    );
    if (result.productId) productIds.add(result.productId);
    if (result.customerId) customerIds.add(result.customerId);
    return result;
  }

  it('(ก) contact ไม่มีเลขบัตร ไม่มีใครถือเลขนี้ → เติม hash ให้ contact · stub ถือเบอร์ · พนักงานสร้างลูกค้า = upgrade stub ไม่ใช่ 409', async () => {
    const phone = await freshPhone();
    const nid = randomThaiId();
    const contact = await keylessContact('A', phone);
    const ti = await appraisedExchange(contact.id);

    const accepted = await accept(ti.id, nid, phone);

    expect(accepted.sellerContactId).toBe(contact.id);
    const keyed = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(keyed.nationalIdHash).toBe(hashPII(nid, PII_SALT));
    const stub = await prisma.customer.findUniqueOrThrow({ where: { id: accepted.customerId! } });
    expect(stub.contactId).toBe(contact.id);
    expect(stub.phoneHash).toBe(hashPII(phone, PII_SALT));
    expect(stub.nationalIdHash).toBeNull();
    expect(credits.issue).toHaveBeenCalledTimes(1);

    const created = await staff.create({ name: `accept-contact staff ${stamp}`, nationalId: nid, phone } as never);
    customerIds.add(created.id);
    expect(created.id).toBe(stub.id);
    const upgraded = await prisma.customer.findUniqueOrThrow({ where: { id: stub.id } });
    expect(upgraded.nationalIdHash).toBe(hashPII(nid, PII_SALT));
    expect(upgraded.contactId).toBe(contact.id);
    expect(
      await prisma.customer.count({ where: { deletedAt: null, phoneHash: hashPII(phone, PII_SALT) } }),
    ).toBe(1);
  });

  it('(ข) มี contact อื่นถือเลขบัตรนี้แล้ว → ย้ายรายการไป contact นั้น · เครดิตเข้าลูกค้าเดิม · ไม่สร้าง stub ใหม่', async () => {
    const nid = randomThaiId();
    const existingPhone = await freshPhone();
    const existingCustomer = await staff.create({
      name: `accept-contact existing ${stamp}`,
      nationalId: nid,
      phone: existingPhone,
    } as never);
    customerIds.add(existingCustomer.id);
    const existingContactId = existingCustomer.contactId!;
    contactIds.add(existingContactId);

    const sellerPhone = await freshPhone();
    const keyless = await keylessContact('B', sellerPhone);
    const ti = await appraisedExchange(keyless.id);

    const accepted = await accept(ti.id, nid, sellerPhone);

    expect(accepted.sellerContactId).toBe(existingContactId);
    expect(accepted.customerId).toBe(existingCustomer.id);
    const row = await prisma.tradeIn.findUniqueOrThrow({ where: { id: ti.id } });
    expect(row.sellerContactId).toBe(existingContactId);
    expect(row.customerId).toBe(existingCustomer.id);
    // contact เดิมไม่ถูกแตะ ไม่มี stub
    const untouched = await prisma.contact.findUniqueOrThrow({ where: { id: keyless.id } });
    expect(untouched.nationalIdHash).toBeNull();
    expect(untouched.deletedAt).toBeNull();
    expect(await prisma.customer.count({ where: { contactId: keyless.id } })).toBe(0);
    expect(await prisma.customer.count({ where: { phoneHash: hashPII(sellerPhone, PII_SALT) } })).toBe(0);
    const existingContact = await prisma.contact.findUniqueOrThrow({ where: { id: existingContactId } });
    expect(existingContact.roles).toEqual(expect.arrayContaining(['CUSTOMER', 'TRADE_IN_SELLER']));
    expect(await prisma.customer.count({ where: { contactId: existingContactId, deletedAt: null } })).toBe(1);
  });

  it('(ค) contact มีเลขบัตรอยู่แล้ว → ใช้ contact เดิม สร้าง stub บน contact นั้นเหมือนเดิม', async () => {
    const phone = await freshPhone();
    const nid = randomThaiId();
    const keyed = await resolver.findOrCreateByNaturalKey(prisma as never, {
      name: `accept-contact C ${stamp}`,
      taxId: null,
      nationalIdHash: hashPII(nid, PII_SALT),
      phone,
      role: 'TRADE_IN_SELLER',
    });
    contactIds.add(keyed.id);
    const ti = await appraisedExchange(keyed.id);

    const accepted = await accept(ti.id, nid, phone);

    expect(accepted.sellerContactId).toBe(keyed.id);
    const stub = await prisma.customer.findUniqueOrThrow({ where: { id: accepted.customerId! } });
    expect(stub.contactId).toBe(keyed.id);
    const after = await prisma.contact.findUniqueOrThrow({ where: { id: keyed.id } });
    expect(after.nationalIdHash).toBe(hashPII(nid, PII_SALT));
    expect(await prisma.customer.count({ where: { contactId: keyed.id, deletedAt: null } })).toBe(1);
  });
});
