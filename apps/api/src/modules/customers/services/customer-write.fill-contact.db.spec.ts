import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CustomerWriteService } from './customer-write.service';
import { hashPII } from '../../../utils/pii.util';

/**
 * พิสูจน์กับ Postgres จริง: เติมเบอร์ให้ placeholder เขียน phone + phoneHash (dedup ทำงานจริง) ·
 * เบอร์ซ้ำ → 409 พร้อม existingCustomer · คนที่มีเบอร์แล้ว → 409 · audit ถูกเรียก ·
 * Fix round 1 (Ruling R34) — เลขบัตร normalize ก่อนเก็บ + dedup ผ่าน nationalIdHash เหมือน create()
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest <ไฟล์นี้> --runInBand
 */
describe('CustomerWriteService.fillPlaceholderContact (real DB)', () => {
  const SALT = 'fill-contact-spec-salt-0123456789abcdef';
  const prisma = new PrismaClient();
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  // contactResolver / query ไม่ถูกใช้ในเมธอดนี้ (อ่านผ่าน prisma ตรง) · ไม่ส่ง piiService = fallback inline (ไม่มี key → เก็บ plaintext, มี salt → hash จริง)
  const service = new CustomerWriteService(prisma as any, {} as any, {} as any, undefined, audit as any);
  const stamp = String(Date.now()).slice(-8);
  const ids: string[] = [];
  let prevSalt: string | undefined;
  let prevKey: string | undefined;

  beforeAll(() => {
    prevSalt = process.env.PII_HASH_SALT;
    prevKey = process.env.PII_ENCRYPTION_KEY;
    process.env.PII_HASH_SALT = SALT;
    delete process.env.PII_ENCRYPTION_KEY;
  });
  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
    if (prevSalt === undefined) delete process.env.PII_HASH_SALT; else process.env.PII_HASH_SALT = prevSalt;
    if (prevKey !== undefined) process.env.PII_ENCRYPTION_KEY = prevKey;
  });
  beforeEach(() => audit.log.mockClear());

  async function placeholder(label: string) {
    const row = await prisma.customer.create({
      data: { name: `fill spec ${label}`, phone: null, nationalId: null, acquisitionSource: 'CHAT_FACEBOOK', creditCheckStatus: 'PRE_CHECK_PASSED' },
    });
    ids.push(row.id);
    return row;
  }

  it('placeholder + เบอร์ใหม่ → เขียน phone/phoneHash/ชื่อ · ไม่ใช่ placeholder อีก · audit CUSTOMER_PLACEHOLDER_CONTACT_FILLED', async () => {
    const p = await placeholder('ok');
    const phone = `08${stamp}`;
    const result = await service.fillPlaceholderContact(p.id, { phone, name: 'สมชาย ใจดี', nickname: 'ชาย' }, { id: 'staff-1', role: 'SALES' });
    expect(result).toEqual({ id: p.id, name: 'สมชาย ใจดี', phone });
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.phone).toBe(phone);
    expect(row.phoneHash).toBe(hashPII(phone, SALT));
    expect(row.nickname).toBe('ชาย');
    expect(row.acquisitionSource).toBe('CHAT_FACEBOOK'); // ที่มาไม่ถูกทับ
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'staff-1', action: 'CUSTOMER_PLACEHOLDER_CONTACT_FILLED', entity: 'customer', entityId: p.id,
      newValue: expect.objectContaining({ phone, name: 'สมชาย ใจดี' }),
    }));
  });

  it('เบอร์ซ้ำกับลูกค้าเดิม → 409 พร้อม existingCustomer {id, name} และไม่แตะแถว', async () => {
    const phone = `09${stamp}`;
    const existing = await prisma.customer.create({ data: { name: 'fill spec existing', phone, phoneHash: hashPII(phone, SALT) } });
    ids.push(existing.id);
    const p = await placeholder('dup');
    let error: unknown;
    try { await service.fillPlaceholderContact(p.id, { phone }, { id: 'staff-1', role: 'OWNER' }); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(ConflictException);
    // R44: `field` บอกช่องที่ชนจริง — เว็บใช้แยกข้อความ/ปุ่มแก้ไข ไม่เดาว่าเป็นเบอร์เสมอ
    expect((error as ConflictException).getResponse()).toEqual({ message: 'ลูกค้าที่มีเบอร์โทรนี้มีอยู่แล้ว', existingCustomer: { id: existing.id, name: 'fill spec existing' }, field: 'phone' });
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.phone).toBeNull();
    expect(audit.log).not.toHaveBeenCalled();
  });

  // Fix round 1 (Ruling R34, Finding 1a) — เลขบัตรที่มีขีด/เว้นวรรคต้องถูก normalize ก่อนเก็บ
  // เหมือน create() (normalizeNationalId) ไม่ใช่แค่ trim — ไม่งั้นค่าที่เก็บแบบไม่ normalize จะ
  // มองไม่เห็นจาก nationalIdHash lookup ของจุดอื่นในระบบ (dedup ถัดไปจะไม่เจอมันเลย)
  it('เลขบัตรมีขีด/เว้นวรรค → normalize เก็บเป็นเลข 13 หลักล้วน + nationalIdHash ตรงกับเลขที่ normalize แล้ว', async () => {
    const p = await placeholder('nid-normalize');
    const digits = `1${stamp}0000`; // 13 หลักล้วน ไม่ซ้ำข้าม test run (derive จาก stamp)
    const raw = `${digits.slice(0, 1)}-${digits.slice(1, 5)}-${digits.slice(5, 10)}-${digits.slice(10, 12)}-${digits.slice(12, 13)}`;
    const phone = `04${stamp}`;
    const result = await service.fillPlaceholderContact(p.id, { phone, nationalId: raw }, { id: 'staff-1', role: 'SALES' });
    expect(result).toEqual({ id: p.id, name: `fill spec nid-normalize`, phone });
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.nationalId).toBe(digits);
    expect(row.nationalIdHash).toBe(hashPII(digits, SALT));
  });

  // Fix round 1 (Ruling R34, Finding 1b) — เลขบัตรซ้ำต้องได้ 409 ไทยแบบเดียวกับ create() ไม่ใช่
  // P2002 ดิบ (Customer.nationalId + nationalIdHash เป็น @unique ทั้งคู่)
  it('เลขบัตรซ้ำกับลูกค้าเดิม → 409 พร้อม existingCustomer {id, name} และไม่แตะแถว ไม่มี audit', async () => {
    const digits = `2${stamp}0000`; // prefix ต่างจากเทสก่อนหน้า กันชนกันเอง
    const existing = await prisma.customer.create({
      data: { name: 'fill spec nid existing', nationalId: digits, nationalIdHash: hashPII(digits, SALT) },
    });
    ids.push(existing.id);
    const p = await placeholder('nid-dup');
    let error: unknown;
    try {
      await service.fillPlaceholderContact(p.id, { phone: `03${stamp}`, nationalId: digits }, { id: 'staff-1', role: 'OWNER' });
    } catch (e) { error = e; }
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      message: 'ลูกค้าที่มีเลขบัตรประชาชนนี้มีอยู่แล้ว',
      existingCustomer: { id: existing.id, name: 'fill spec nid existing' },
      field: 'nationalId', // R44 — เว็บต้องแยกได้ว่านี่คือการชนเลขบัตร ไม่ใช่เบอร์
    });
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.phone).toBeNull();
    expect(row.nationalId).toBeNull();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('แถวที่มีเบอร์แล้ว (ไม่ใช่ placeholder) → 409 ข้อความชี้ทางไปหน้ารายละเอียด · แถวที่ถูกลบ → 404', async () => {
    const real = await prisma.customer.create({ data: { name: 'fill spec real', phone: `07${stamp}`, acquisitionSource: 'CHAT_LINE_SHOP' } });
    ids.push(real.id);
    await expect(service.fillPlaceholderContact(real.id, { phone: `06${stamp}` }, { id: 'staff-1', role: 'OWNER' }))
      .rejects.toThrow('เติมเบอร์ได้เฉพาะผู้สนใจอัตโนมัติจากแชทที่ยังไม่มีเบอร์และเลขบัตร');
    const gone = await placeholder('gone');
    await prisma.customer.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
    await expect(service.fillPlaceholderContact(gone.id, { phone: `05${stamp}` }, { id: 'staff-1', role: 'OWNER' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
