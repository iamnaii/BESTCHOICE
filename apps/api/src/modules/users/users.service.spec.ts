import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('UsersService.update — T7-C7 deactivation revokes refresh tokens', () => {
  let service: UsersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      refreshToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(UsersService);
  });

  it('revokes all refresh tokens when the user transitions from active → inactive', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true });
    prisma.user.update.mockResolvedValue({ id: 'u1', isActive: false });

    await service.update('u1', { isActive: false });

    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('does NOT touch refresh tokens on unrelated update (e.g. name change)', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true });
    prisma.user.update.mockResolvedValue({ id: 'u1', isActive: true });

    await service.update('u1', { name: 'renamed' });

    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('does NOT revoke again if the user was already inactive', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: false });
    prisma.user.update.mockResolvedValue({ id: 'u1', isActive: false });

    await service.update('u1', { isActive: false });

    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('does NOT revoke on reactivation (false → true)', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: false });
    prisma.user.update.mockResolvedValue({ id: 'u1', isActive: true });

    await service.update('u1', { isActive: true });

    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });
});
