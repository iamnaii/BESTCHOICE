import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmployeesService } from '../employees/employees.service';

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
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        // UsersService now depends on AuditService for DI — stub it (update()
        // logs deactivation via audit.log).
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: EmployeesService, useValue: { upsertProfileTx: jest.fn() } },
      ],
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

describe('UsersService.findApprovers — lean 4-eyes approver lookup', () => {
  let service: UsersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: EmployeesService, useValue: { upsertProfileTx: jest.fn() } },
      ],
    }).compile();
    service = mod.get(UsersService);
  });

  it('returns only active, non-deleted manager-role users with a PII-free select', async () => {
    await service.findApprovers();

    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    const arg = prisma.user.findMany.mock.calls[0][0];

    // Role scoping: SALES (and VIEWER) must never appear in approver dropdowns.
    expect(arg.where.role.in).toEqual(
      expect.arrayContaining(['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT']),
    );
    expect(arg.where.role.in).not.toContain('SALES');
    expect(arg.where.isActive).toBe(true);
    expect(arg.where.deletedAt).toBeNull();

    // The endpoint is exposed to every role — the select is the PII guard.
    // GET /users stays OWNER-only precisely because findAll returns PII.
    expect(arg.select).toEqual({ id: true, name: true, role: true });
  });

  it('hides system/service accounts from the approver list', async () => {
    await service.findApprovers();

    const arg = prisma.user.findMany.mock.calls[0][0];
    expect(arg.where.email.notIn).toEqual(expect.arrayContaining(['legacy-import@bestchoice.com']));
  });
});
