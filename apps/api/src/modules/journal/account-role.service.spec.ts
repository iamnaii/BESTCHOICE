import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AccountRoleService } from './account-role.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * D1.1.1.3 — `update()` validates input, rejects required-role
 * deactivation, validates accountCode against chart_of_accounts, writes
 * an audit log entry, then invalidates the in-memory cache.
 */
describe('AccountRoleService.update', () => {
  let service: AccountRoleService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let audit: any;

  beforeEach(async () => {
    prisma = {
      accountRoleMap: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      chartOfAccount: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        AccountRoleService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = mod.get(AccountRoleService);
  });

  it('updates accountCode + writes ROLE_MAP_UPDATED audit + refreshes cache', async () => {
    prisma.accountRoleMap.findUnique.mockResolvedValue({
      id: 'r1',
      role: 'custom_role',
      accountCode: '11-4101',
      priority: 1,
      isActive: true,
      note: null,
    });
    prisma.chartOfAccount.findFirst.mockResolvedValue({ code: '53-1503' });
    prisma.accountRoleMap.update.mockResolvedValue({
      id: 'r1',
      role: 'custom_role',
      accountCode: '53-1503',
      priority: 1,
      isActive: true,
      note: null,
    });

    const updated = await service.update('r1', { accountCode: '53-1503' }, 'user-1');

    expect(updated.accountCode).toBe('53-1503');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ROLE_MAP_UPDATED',
        entity: 'account_role_map',
        entityId: 'r1',
        userId: 'user-1',
      }),
    );
    expect(audit.log.mock.calls[0][0].newValue.diffSummary).toContain(
      '11-4101 → 53-1503',
    );
    // Cache refresh via invalidate() calls findMany on the active rows
    expect(prisma.accountRoleMap.findMany).toHaveBeenCalled();
  });

  it('rejects unknown accountCode with Thai message', async () => {
    prisma.accountRoleMap.findUnique.mockResolvedValue({
      id: 'r1',
      role: 'custom_role',
      accountCode: '11-4101',
      priority: 1,
      isActive: true,
      note: null,
    });
    prisma.chartOfAccount.findFirst.mockResolvedValue(null); // not in CoA

    await expect(
      service.update('r1', { accountCode: '99-9999' }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update('r1', { accountCode: '99-9999' }, 'user-1'),
    ).rejects.toThrow('บัญชี 99-9999 ไม่พบในผังบัญชี');
    expect(prisma.accountRoleMap.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rejects isActive=false on a REQUIRED_ROLES row (e.g. vat_input)', async () => {
    prisma.accountRoleMap.findUnique.mockResolvedValue({
      id: 'r1',
      role: 'vat_input',
      accountCode: '11-4101',
      priority: 1,
      isActive: true,
      note: null,
    });

    await expect(
      service.update('r1', { isActive: false }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update('r1', { isActive: false }, 'user-1'),
    ).rejects.toThrow(/ห้ามปิดใช้งาน/);
    expect(prisma.accountRoleMap.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when row id is missing', async () => {
    prisma.accountRoleMap.findUnique.mockResolvedValue(null);
    await expect(
      service.update('does-not-exist', { priority: 5 }, 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows partial updates (e.g. priority only) without touching accountCode', async () => {
    prisma.accountRoleMap.findUnique.mockResolvedValue({
      id: 'r1',
      role: 'custom_role',
      accountCode: '11-4101',
      priority: 1,
      isActive: true,
      note: null,
    });
    prisma.accountRoleMap.update.mockResolvedValue({
      id: 'r1',
      role: 'custom_role',
      accountCode: '11-4101',
      priority: 5,
      isActive: true,
      note: null,
    });

    const updated = await service.update('r1', { priority: 5 }, 'user-1');

    // CoA check must NOT happen when accountCode is unchanged
    expect(prisma.chartOfAccount.findFirst).not.toHaveBeenCalled();
    expect(updated.priority).toBe(5);
    expect(audit.log.mock.calls[0][0].newValue.diffSummary).toContain(
      'priority: 1 → 5',
    );
  });
});
