/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/chatbot-finance/services/line-group-membership.db.spec.ts --runInBand
 * ไม่ต้องตั้ง PII env (ตารางนี้ไม่มีคอลัมน์เข้ารหัส) · สร้างบริษัทไฟแนนซ์ทดสอบของตัวเองแล้วลบทิ้ง
 */
import { PrismaClient } from '@prisma/client';
import { LineGroupMembershipService } from './line-group-membership.service';

const prisma = new PrismaClient();
const tag = `gfin-group-db-${Date.now()}`;
const groupId = `C${tag}`;
const lineClient = { getGroupSummary: jest.fn(), getGroupMemberCount: jest.fn().mockResolvedValue(3) };
const notifications = { send: jest.fn().mockResolvedValue({ id: 'n', status: 'SENT' }) };
let companyId = '';
let service: LineGroupMembershipService;

beforeAll(async () => {
  const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://unset/unset').pathname.slice(1);
  if (!/^test_db$|_test$/.test(dbName)) throw new Error(`สเปคนี้ลบแถวจริง — ต้องรันกับฐานทดสอบ แต่ได้ "${dbName}"`);
  const company = await prisma.externalFinanceCompany.create({ data: { name: `TEST-${tag}`, isActive: true } });
  companyId = company.id;
  service = new LineGroupMembershipService(prisma as never, lineClient as never, notifications as never);
});
afterAll(async () => {
  await prisma.todo.deleteMany({ where: { title: { contains: tag } } });
  await prisma.lineGroupMembership.deleteMany({ where: { groupId } });
  await prisma.externalFinanceCompany.delete({ where: { id: companyId } });
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
    const owners = await prisma.user.count({ where: { role: { in: ['OWNER', 'FINANCE_MANAGER'] }, isActive: true, deletedAt: null } });
    expect(await prisma.todo.count({ where: { title: { contains: `${tag} v2` }, tags: { has: 'gfin' } } })).toBe(owners);
    expect(notifications.send).toHaveBeenCalledTimes(owners);

    await service.onJoin('FINANCE', groupId);
    expect((await service.find('FINANCE', groupId))?.leftAt).toBeNull();
    expect((await service.list('FINANCE')).some((r) => r.groupId === groupId)).toBe(true);
  });
});
