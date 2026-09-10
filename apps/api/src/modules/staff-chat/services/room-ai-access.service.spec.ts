import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RoomAiAccessService, StaffAiActor } from './room-ai-access.service';

describe('RoomAiAccessService company scope', () => {
  const actor: StaffAiActor = { id: 'staff-1', role: 'FINANCE_MANAGER', branchId: null, accessibleCompanies: ['FINANCE'] };
  const findFirst = jest.fn();
  const service = new RoomAiAccessService({ chatRoom: { findFirst } } as unknown as PrismaService);

  beforeEach(() => findFirst.mockReset());

  it('allows a finance identity into a finance room without needing SHOP access', async () => {
    findFirst.mockResolvedValue({ id: 'room-1', channel: 'LINE_FINANCE', assignedToId: null, customerId: null });
    await expect(service.assertAccess('room-1', actor)).resolves.toMatchObject({ id: 'room-1' });
  });

  it.each(['LINE_SHOP', 'FACEBOOK', 'TIKTOK', 'WEB'])('requires SHOP permission for %s even for cross-branch staff', async (channel) => {
    findFirst.mockResolvedValue({ id: 'room-1', channel, assignedToId: null });
    await expect(service.assertAccess('room-1', actor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.assertAccess('room-1', { ...actor, accessibleCompanies: ['SHOP', 'FINANCE'] }))
      .resolves.toMatchObject({ id: 'room-1' });
  });

  it('does not expose an unknown channel or bypass company policy for OWNER', async () => {
    findFirst.mockResolvedValue({ id: 'room-1', channel: 'UNKNOWN', assignedToId: null });
    await expect(service.assertAccess('room-1', { ...actor, role: 'OWNER', accessibleCompanies: ['SHOP', 'FINANCE'] }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  // สิทธิ์บริษัทที่ยังไม่ถูกตั้งค่า (คอลัมน์ default [] ที่ไม่เคยมีใครเขียน) ต้องอ่านเป็น
  // "ยังไม่ตั้งค่า" → ใช้ค่า default ของ role ไม่ใช่ 403 — ส่วนค่าที่ตั้งไว้แล้วยังบังคับเป๊ะ
  // ตามเทสต์ 'requires SHOP permission for %s' ข้างบนที่ต้องเขียวเหมือนเดิม
  it.each([
    ['SALES ที่ยังไม่ตั้งค่า (array ว่าง) เข้าห้องหน้าร้านได้', 'LINE_SHOP', 'SALES', 'branch-1', [] as string[]],
    ['SALES ที่ยังไม่ตั้งค่า (undefined) เข้าห้องหน้าร้านได้', 'LINE_SHOP', 'SALES', 'branch-1', undefined],
    ['FINANCE_MANAGER ที่ยังไม่ตั้งค่า เข้าห้องการเงินได้', 'LINE_FINANCE', 'FINANCE_MANAGER', null, [] as string[]],
  ])('%s', async (_label, channel, role, branchId, accessibleCompanies) => {
    findFirst.mockResolvedValue({ id: 'room-1', channel, assignedToId: null, customerId: null });
    await expect(service.assertAccess('room-1', { ...actor, role, branchId, accessibleCompanies }))
      .resolves.toMatchObject({ id: 'room-1' });
  });

  it('SALES ที่ยังไม่ตั้งค่า ยังเข้าห้องการเงินไม่ได้ (ค่า default ของ role มีแค่ SHOP)', async () => {
    findFirst.mockResolvedValue({ id: 'room-1', channel: 'LINE_FINANCE', assignedToId: null });
    await expect(service.assertAccess('room-1', { ...actor, role: 'SALES', branchId: 'branch-1', accessibleCompanies: [] }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});
