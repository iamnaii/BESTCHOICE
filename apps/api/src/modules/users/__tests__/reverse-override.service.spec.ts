import { NotFoundException } from '@nestjs/common';
import { UsersService } from '../users.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

/**
 * InternalControlActionBar — covers the new per-user override endpoint.
 * Verifies happy-path write + AuditLog row + not-found rejection.
 */
describe('UsersService.setReverseOverride', () => {
  let prisma: {
    user: { findFirst: jest.Mock; update: jest.Mock };
  };
  let audit: { log: jest.Mock };
  let service: UsersService;

  beforeEach(() => {
    prisma = {
      user: { findFirst: jest.fn(), update: jest.fn() },
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new UsersService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  it('flips the flag and writes an audit log row', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1',
      role: 'ACCOUNTANT',
      canReverseOverride: null,
      name: 'Acc One',
    });
    prisma.user.update.mockResolvedValue({ id: 'u1', canReverseOverride: true });

    const result = await service.setReverseOverride('u1', true, 'owner1');

    expect(result).toEqual({ id: 'u1', canReverseOverride: true });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { canReverseOverride: true },
      select: { id: true, canReverseOverride: true },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner1',
        action: 'USER_REVERSE_OVERRIDE_CHANGED',
        entity: 'user',
        entityId: 'u1',
        oldValue: { canReverseOverride: null, targetUserName: 'Acc One' },
        newValue: { canReverseOverride: true, targetUserName: 'Acc One' },
      }),
    );
  });

  it('accepts null to reset back to role-based mode', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1',
      role: 'ACCOUNTANT',
      canReverseOverride: true,
      name: 'Acc One',
    });
    prisma.user.update.mockResolvedValue({ id: 'u1', canReverseOverride: null });

    await service.setReverseOverride('u1', null, 'owner1');

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { canReverseOverride: null } }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        oldValue: expect.objectContaining({ canReverseOverride: true }),
        newValue: expect.objectContaining({ canReverseOverride: null }),
      }),
    );
  });

  it('rejects unknown user id with NotFoundException', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      service.setReverseOverride('ghost', true, 'owner1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rejects soft-deleted users', async () => {
    // findFirst returns null because the `where: { deletedAt: null }` filter
    // excludes them — simulate that.
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      service.setReverseOverride('soft-deleted-id', true, 'owner1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UsersService.listReverseOverrides', () => {
  let prisma: {
    user: { findMany: jest.Mock };
  };
  let service: UsersService;

  beforeEach(() => {
    prisma = { user: { findMany: jest.fn() } };
    service = new UsersService(
      prisma as unknown as PrismaService,
      { log: jest.fn() } as unknown as AuditService,
    );
  });

  it('excludes system users + soft-deleted + inactive', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'a@b.com', name: 'A', role: 'OWNER', canReverseOverride: null },
    ]);
    await service.listReverseOverrides();
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          isActive: true,
          email: { notIn: expect.arrayContaining(['legacy-import@bestchoice.com']) },
        },
        orderBy: [{ role: 'asc' }, { name: 'asc' }],
      }),
    );
  });

  it('selects only the fields the UI needs', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    await service.listReverseOverrides();
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          canReverseOverride: true,
        },
      }),
    );
  });
});

