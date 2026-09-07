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
});
