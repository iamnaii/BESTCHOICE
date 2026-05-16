import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AccountRoleService } from '../journal/account-role.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * D1.1.1.4 — admin UI smoke tests for `listWithCoa()` + `update()`.
 * Tests live under `apps/api/src/modules/settings/` because the
 * `journal/__tests__` path is excluded from the jest run.
 */
describe('AccountRoleService (admin endpoints)', () => {
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

  it('listWithCoa: joins role-map with chart_of_accounts + sets required flag', async () => {
    prisma.accountRoleMap.findMany.mockResolvedValue([
      {
        id: 'r1',
        role: 'vat_input',
        accountCode: '11-4101',
        priority: 1,
        isActive: true,
        note: null,
      },
      {
        id: 'r2',
        role: 'custom_role',
        accountCode: '53-1503',
        priority: 1,
        isActive: false,
        note: 'inactive',
      },
    ]);
    prisma.chartOfAccount.findMany.mockResolvedValue([
      { code: '11-4101', name: 'ภาษีซื้อ' },
      { code: '53-1503', name: 'กำไร/ขาดทุนจากการปัดเศษ' },
    ]);

    const rows = await service.listWithCoa();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      role: 'vat_input',
      accountName: 'ภาษีซื้อ',
      required: true,
    });
    expect(rows[1]).toMatchObject({
      role: 'custom_role',
      accountName: 'กำไร/ขาดทุนจากการปัดเศษ',
      required: false,
      isActive: false,
    });
  });

  it('update: writes audit + invalidates cache on accountCode change', async () => {
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
      }),
    );
    expect(prisma.accountRoleMap.findMany).toHaveBeenCalled(); // invalidate()
  });

  it('update: rejects unknown accountCode', async () => {
    prisma.accountRoleMap.findUnique.mockResolvedValue({
      id: 'r1',
      role: 'custom_role',
      accountCode: '11-4101',
      priority: 1,
      isActive: true,
      note: null,
    });
    prisma.chartOfAccount.findFirst.mockResolvedValue(null);

    await expect(
      service.update('r1', { accountCode: '99-9999' }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update: blocks deactivating REQUIRED_ROLES', async () => {
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
  });

  it('update: throws NotFoundException for unknown id', async () => {
    prisma.accountRoleMap.findUnique.mockResolvedValue(null);
    await expect(
      service.update('nope', { priority: 2 }, 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
