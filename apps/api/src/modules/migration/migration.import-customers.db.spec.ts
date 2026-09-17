import { PrismaClient } from '@prisma/client';
import { IMPORT_PHONE_TAKEN_MSG, MigrationService } from './migration.service';
import { CustomerPiiService } from '../customers/customer-pii.service';
import { hashPII } from '../../utils/pii.util';
import { decryptPII } from '../../utils/crypto.util';

const PII_KEY = 'e'.repeat(64);
const PII_SALT = 'migration-import-db-spec-salt-012345';

/**
 * นำเข้าลูกค้าบน Postgres จริง (คำตัดสินเจ้าของ 2026-09-17):
 * เขียนเบอร์ normalize + hash/เข้ารหัส · นำเข้าคนเดิมซ้ำ (เลขบัตรเดียวกัน) ไม่ชนตัวเอง ·
 * เบอร์ของลูกค้าคนอื่น → แถวนั้นล้ม field phone ไม่มีสองคนถือเบอร์หลักเดียวกัน
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest <ไฟล์นี้> --runInBand
 */
describe('MigrationService.importCustomers (real DB)', () => {
  const prisma = new PrismaClient();
  const pii = new CustomerPiiService(prisma as never);
  const service = new MigrationService(prisma as never, pii);
  const savedEnv = { key: process.env.PII_ENCRYPTION_KEY, salt: process.env.PII_HASH_SALT };
  const nids: string[] = [];
  const ids = new Set<string>();

  beforeAll(async () => {
    process.env.PII_ENCRYPTION_KEY = PII_KEY;
    process.env.PII_HASH_SALT = PII_SALT;
    await prisma.$connect();
  });

  afterAll(async () => {
    const rows = await prisma.customer.findMany({
      where: { nationalId: { in: nids } },
      select: { id: true },
    });
    rows.forEach((r) => ids.add(r.id));
    await prisma.customer.deleteMany({ where: { id: { in: [...ids] } } });
    await prisma.$disconnect();
    if (savedEnv.key === undefined) delete process.env.PII_ENCRYPTION_KEY;
    else process.env.PII_ENCRYPTION_KEY = savedEnv.key;
    if (savedEnv.salt === undefined) delete process.env.PII_HASH_SALT;
    else process.env.PII_HASH_SALT = savedEnv.salt;
  });

  async function freshNid(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const d = [1, ...Array.from({ length: 11 }, () => Math.floor(Math.random() * 10))];
      const sum = d.reduce((acc, n, idx) => acc + n * (13 - idx), 0);
      const nid = d.join('') + String((11 - (sum % 11)) % 10);
      const taken = await prisma.customer.count({
        where: { OR: [{ nationalId: nid }, { nationalIdHash: hashPII(nid, PII_SALT) }] },
      });
      if (taken === 0) {
        nids.push(nid);
        return nid;
      }
    }
    throw new Error('หาเลขบัตรทดสอบที่ว่างไม่ได้');
  }

  async function freshPhone(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const phone = `0988${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
      const taken = await prisma.customer.count({
        where: { OR: [{ phone }, { phoneHash: hashPII(phone, PII_SALT) }] },
      });
      if (taken === 0) return phone;
    }
    throw new Error('หาเบอร์ทดสอบที่ว่างไม่ได้');
  }

  it('เขียนเบอร์ normalize + hash/เข้ารหัส · นำเข้าคนเดิมซ้ำไม่ชนตัวเอง', async () => {
    const nid = await freshNid();
    const phone = await freshPhone();
    const formatted = `${phone.slice(0, 3)}-${phone.slice(3, 6)} ${phone.slice(6)}`;

    const first = await service.importCustomers([
      { name: 'นำเข้า สเปค', nationalId: nid, phone: formatted, phoneSecondary: '' },
    ]);
    expect(first).toEqual({ success: 1, failed: 0, errors: [] });

    const row = await prisma.customer.findUniqueOrThrow({ where: { nationalId: nid } });
    ids.add(row.id);
    expect(row.phone).toBe(phone);
    expect(row.phoneHash).toBe(hashPII(phone, PII_SALT));
    expect(decryptPII(row.phoneEncrypted!, PII_KEY)).toBe(phone);
    expect(row.nationalIdHash).toBe(hashPII(nid, PII_SALT));
    expect(decryptPII(row.nationalIdEncrypted!, PII_KEY)).toBe(nid);

    const again = await service.importCustomers([
      { name: 'นำเข้า สเปค แก้ชื่อ', nationalId: nid, phone },
    ]);
    expect(again).toEqual({ success: 1, failed: 0, errors: [] });
    const updated = await prisma.customer.findUniqueOrThrow({ where: { nationalId: nid } });
    expect(updated.id).toBe(row.id);
    expect(updated.name).toBe('นำเข้า สเปค แก้ชื่อ');
  });

  it('เบอร์เป็นของลูกค้าคนอื่น → แถวนั้นล้ม field phone และไม่มีแถวใหม่', async () => {
    const phone = await freshPhone();
    const owner = await prisma.customer.create({
      data: { name: 'เจ้าของเบอร์ สเปคนำเข้า', phone, phoneHash: hashPII(phone, PII_SALT) },
    });
    ids.add(owner.id);
    const nid = await freshNid();
    const okNid = await freshNid();
    const okPhone = await freshPhone();

    const res = await service.importCustomers([
      { name: 'คนชนเบอร์', nationalId: nid, phone },
      { name: 'คนไม่ชน', nationalId: okNid, phone: okPhone },
    ]);

    expect(res.success).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.errors).toEqual([{ row: 1, field: 'phone', message: IMPORT_PHONE_TAKEN_MSG }]);
    expect(await prisma.customer.count({ where: { nationalId: nid } })).toBe(0);
    const owners = await prisma.customer.findMany({
      where: { deletedAt: null, OR: [{ phone }, { phoneHash: hashPII(phone, PII_SALT) }] },
      select: { id: true },
    });
    expect(owners.map((o) => o.id)).toEqual([owner.id]);
  });
});
