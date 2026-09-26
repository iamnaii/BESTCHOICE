/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/chatbot-finance/services/line-group-membership.db.spec.ts --runInBand
 * ไม่ต้องตั้ง PII env (ตารางนี้ไม่มีคอลัมน์เข้ารหัส) · สร้างบริษัทไฟแนนซ์ทดสอบ + ผู้ใช้ OWNER/FINANCE_MANAGER ของตัวเองแล้วลบทิ้ง
 *
 * Fix round 1: เดิม assert ยอด Todo/notify ด้วย `prisma.user.count({role in [OWNER,FINANCE_MANAGER]})` ที่อ่านจาก DB —
 * ใน CI (migrate แล้วแต่ไม่ seed) ตัวนับนี้เป็น 0 ได้ ⇒ assertion ผ่านลอย ๆ โดยไม่ทดสอบอะไรเลย. ตอนนี้สร้าง fixture
 * ผู้ใช้เองสองคน (OWNER + FINANCE_MANAGER) แล้ว assert ต่อ user id ตรง ๆ แทนยอดรวมที่ผันแปรตามข้อมูลในฐาน.
 */
import { PrismaClient } from '@prisma/client';
import { LineGroupMembershipService } from './line-group-membership.service';

const prisma = new PrismaClient();
const tag = `gfin-group-db-${Date.now()}`;
const groupId = `C${tag}`;
const lineClient = { getGroupSummary: jest.fn(), getGroupMemberCount: jest.fn().mockResolvedValue(3) };
const notifications = { send: jest.fn().mockResolvedValue({ id: 'n', status: 'SENT' }) };
let companyId = '';
let ownerId = '';
let fmId = '';
let service: LineGroupMembershipService;

beforeAll(async () => {
  const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://unset/unset').pathname.slice(1);
  if (!/^test_db$|_test$/.test(dbName)) throw new Error(`สเปคนี้ลบแถวจริง — ต้องรันกับฐานทดสอบ แต่ได้ "${dbName}"`);
  const company = await prisma.externalFinanceCompany.create({ data: { name: `TEST-${tag}`, isActive: true } });
  companyId = company.id;
  const owner = await prisma.user.create({
    data: { email: `owner-${tag}@gfin-group-db.test`, name: `owner ${tag}`, password: '__NO_LOGIN__', role: 'OWNER', isActive: true },
  });
  ownerId = owner.id;
  const fm = await prisma.user.create({
    data: { email: `fm-${tag}@gfin-group-db.test`, name: `fm ${tag}`, password: '__NO_LOGIN__', role: 'FINANCE_MANAGER', isActive: true },
  });
  fmId = fm.id;
  service = new LineGroupMembershipService(prisma as never, lineClient as never, notifications as never);
});
afterAll(async () => {
  await prisma.todo.deleteMany({ where: { title: { contains: tag } } });
  await prisma.lineGroupMembership.deleteMany({ where: { groupId } });
  await prisma.externalFinanceCompany.delete({ where: { id: companyId } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, fmId] } } });
  await prisma.$disconnect();
});

describe('LineGroupMembership บน DB จริง', () => {
  it('join → one row; join again with a new name → same row, name updated; leave → leftAt; rejoin → leftAt cleared', async () => {
    lineClient.getGroupSummary.mockResolvedValue({ groupId, groupName: `${tag} v1` });
    await service.onJoin('FINANCE', groupId);
    lineClient.getGroupSummary.mockResolvedValue({ groupId, groupName: `${tag} v2` });
    await service.onJoin('FINANCE', groupId);
    const rows = await prisma.lineGroupMembership.findMany({ where: { groupId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({ channel: 'FINANCE', groupName: `${tag} v2`, memberCount: 3, leftAt: null }));

    await prisma.externalFinanceCompany.update({ where: { id: companyId }, data: { lineGroupId: groupId } });
    await service.onLeave('FINANCE', groupId);
    expect((await service.find('FINANCE', groupId))?.leftAt).toBeInstanceOf(Date);

    // แต่ละ fixture user (OWNER, FINANCE_MANAGER) ต้องได้ todo เดียว + notify เดียว —
    // เทียบต่อ user id ตรง ๆ แทนยอดรวมที่ผันแปรตามจำนวน OWNER/FM จริงในฐาน (ดูหมายเหตุบนสุดของไฟล์)
    for (const userId of [ownerId, fmId]) {
      const todoCount = await prisma.todo.count({
        where: { assigneeId: userId, tags: { has: 'gfin' }, priority: 'HIGH', title: { contains: `${tag} v2` } },
      });
      expect(todoCount).toBe(1);
      expect(notifications.send).toHaveBeenCalledWith(expect.objectContaining({ channel: 'IN_APP', recipient: userId }));
    }

    await service.onJoin('FINANCE', groupId);
    expect((await service.find('FINANCE', groupId))?.leftAt).toBeNull();
    expect((await service.list('FINANCE')).some((r) => r.groupId === groupId)).toBe(true);
  });
});
