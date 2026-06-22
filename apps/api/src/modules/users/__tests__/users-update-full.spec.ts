import { Test } from '@nestjs/testing';
import { UsersService } from '../users.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { EmployeesService } from '../../employees/employees.service';

describe('UsersService.updateFull', () => {
  let svc: UsersService;
  const userUpdate = jest.fn().mockResolvedValue({ id: 'u1', isActive: false });
  const userFindUnique = jest.fn();
  const refreshUpdateMany = jest.fn().mockResolvedValue({ count: 2 });
  const upsertProfileTx = jest.fn().mockResolvedValue({ id: 'p1' });

  const prisma = {
    user: { findUnique: userFindUnique },
    $transaction: jest.fn(async (cb: any) =>
      cb({
        user: { update: userUpdate },
        refreshToken: { updateMany: refreshUpdateMany },
      }),
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: EmployeesService, useValue: { upsertProfileTx } },
      ],
    }).compile();
    svc = mod.get(UsersService);
    // findOneFull is called at the end of updateFull — stub it so the test focuses on tx behaviour
    jest.spyOn(svc, 'findOneFull').mockResolvedValue({ id: 'u1' } as any);
  });

  it('updates user + upserts employee in one transaction', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1', isActive: true });
    await svc.updateFull('u1', { name: 'A', employee: { position: 'sales' } }, { userId: 'owner' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(upsertProfileTx).toHaveBeenCalledWith(
      expect.anything(), 'u1', { position: 'sales' }, expect.objectContaining({ userId: 'owner' }),
    );
  });

  it('revokes refresh tokens on deactivate (true→false)', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1', isActive: true });
    await svc.updateFull('u1', { isActive: false }, { userId: 'owner' });
    expect(refreshUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }),
    );
  });

  it('does NOT touch employee profile when employee is null', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1', isActive: true });
    await svc.updateFull('u1', { name: 'A', employee: null }, { userId: 'owner' });
    expect(upsertProfileTx).not.toHaveBeenCalled();
  });
});
