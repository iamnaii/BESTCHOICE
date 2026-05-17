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

/**
 * D1.1.6.2 — boot-guard unit tests for AccountRoleService.
 *
 * Mocks PrismaService and calls `onModuleInit` directly so we can assert that
 * the REQUIRED_ROLES set (now including `adj_overpay`) is enforced at boot.
 * No real DB needed.
 */
describe('AccountRoleService — boot guard (D1.1.6.2)', () => {
  // Snapshot of the rows the seed migration installs for every role currently
  // required by AccountRoleService.REQUIRED_ROLES. Tests reuse this list and
  // selectively drop rows to verify the missing-role branch.
  const requiredRows = [
    { role: 'vat_input', accountCode: '11-4101' },
    { role: 'vat_output', accountCode: '21-2101' },
    { role: 'payable_default', accountCode: '21-1104' },
    { role: 'wht_individual', accountCode: '21-3102' },
    { role: 'wht_juristic', accountCode: '21-3103' },
    { role: 'wht_payroll', accountCode: '21-3101' },
    { role: 'sso_employee', accountCode: '21-3105' },
    { role: 'sso_employer', accountCode: '21-3106' },
    { role: 'payroll_expense', accountCode: '53-1101' },
    { role: 'payroll_sso_expense', accountCode: '53-1102' },
    { role: 'adj_overpay', accountCode: '53-1503' },
  ];

  function buildPrismaMock(rows: { role: string; accountCode: string }[]) {
    return {
      accountRoleMap: {
        findMany: jest.fn().mockResolvedValue(rows),
      },
      chartOfAccount: {
        findMany: jest
          .fn()
          // Every code referenced by the map is present in CoA (good case).
          .mockImplementation(({ where }: any) =>
            Promise.resolve(
              (where.code.in as string[]).map((code: string) => ({ code })),
            ),
          ),
      },
    };
  }

  async function makeService(prismaMock: any): Promise<AccountRoleService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AccountRoleService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    return moduleRef.get(AccountRoleService);
  }

  it('boots successfully when adj_overpay is present in account_role_map', async () => {
    const service = await makeService(buildPrismaMock(requiredRows));
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(service.code('adj_overpay')).toBe('53-1503');
  });

  it('throws at boot if adj_overpay is missing from account_role_map', async () => {
    const rows = requiredRows.filter((r) => r.role !== 'adj_overpay');
    const service = await makeService(buildPrismaMock(rows));
    await expect(service.onModuleInit()).rejects.toThrow(
      /required role\(s\) missing.*adj_overpay/,
    );
  });

  it('tryCode("adj_overpay") returns the seeded code without throwing on unknown roles', async () => {
    const service = await makeService(buildPrismaMock(requiredRows));
    await service.onModuleInit();
    expect(service.tryCode('adj_overpay')).toBe('53-1503');
    expect(service.tryCode('does_not_exist')).toBeNull();
  });
});
