import { Test, TestingModule } from '@nestjs/testing';
import { AccountRoleService } from './account-role.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * D1.1.1.2 — `listWithCoa()` joins account_role_map with chart_of_accounts
 * for the admin UI. These tests exercise the join logic + the required-role
 * flag without touching the boot-time invariants (those are integration-
 * tested in account-role boot specs).
 */
describe('AccountRoleService.listWithCoa', () => {
  let service: AccountRoleService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      accountRoleMap: { findMany: jest.fn() },
      chartOfAccount: { findMany: jest.fn() },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        AccountRoleService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = mod.get(AccountRoleService);
  });

  it('returns rows joined with ChartOfAccount.name + required flag', async () => {
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
        isActive: true,
        note: 'optional',
      },
    ]);
    prisma.chartOfAccount.findMany.mockResolvedValue([
      { code: '11-4101', name: 'ภาษีซื้อ' },
      { code: '53-1503', name: 'กำไร/ขาดทุนจากการปัดเศษ' },
    ]);

    const rows = await service.listWithCoa();

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: 'r1',
      role: 'vat_input',
      accountCode: '11-4101',
      accountName: 'ภาษีซื้อ',
      required: true,
    });
    expect(rows[1]).toMatchObject({
      id: 'r2',
      role: 'custom_role',
      accountCode: '53-1503',
      accountName: 'กำไร/ขาดทุนจากการปัดเศษ',
      required: false,
    });
    // Must NOT filter by isActive — the admin UI needs to see inactive rows
    // so an OWNER can reactivate them.
    expect(prisma.accountRoleMap.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ role: 'asc' }, { priority: 'asc' }],
      }),
    );
    expect(prisma.accountRoleMap.findMany.mock.calls[0][0]).not.toHaveProperty('where');
  });

  it('returns accountName=null when CoA row is missing (drift detection)', async () => {
    prisma.accountRoleMap.findMany.mockResolvedValue([
      {
        id: 'r1',
        role: 'vat_input',
        accountCode: '99-9999',
        priority: 1,
        isActive: true,
        note: null,
      },
    ]);
    prisma.chartOfAccount.findMany.mockResolvedValue([]); // no match
    const rows = await service.listWithCoa();
    expect(rows[0].accountName).toBeNull();
    expect(rows[0].required).toBe(true); // vat_input is in REQUIRED_ROLES
  });

  it('returns empty array + skips CoA query when no role rows exist', async () => {
    prisma.accountRoleMap.findMany.mockResolvedValue([]);
    const rows = await service.listWithCoa();
    expect(rows).toEqual([]);
    expect(prisma.chartOfAccount.findMany).not.toHaveBeenCalled();
  });
});
