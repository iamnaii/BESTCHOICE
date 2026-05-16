import { Test } from '@nestjs/testing';
import { AccountRoleService } from './account-role.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * D1.1.6.1 — boot-guard unit tests for AccountRoleService.
 *
 * These tests mock PrismaService and call `onModuleInit` directly so we can
 * assert that the REQUIRED_ROLES set (now including `adj_underpay`) is
 * enforced at boot. No real DB needed.
 */
describe('AccountRoleService — boot guard (D1.1.6.1)', () => {
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
    { role: 'adj_underpay', accountCode: '52-1104' },
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

  it('boots successfully when adj_underpay is present in account_role_map', async () => {
    const service = await makeService(buildPrismaMock(requiredRows));
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(service.code('adj_underpay')).toBe('52-1104');
  });

  it('throws at boot if adj_underpay is missing from account_role_map', async () => {
    const rows = requiredRows.filter((r) => r.role !== 'adj_underpay');
    const service = await makeService(buildPrismaMock(rows));
    await expect(service.onModuleInit()).rejects.toThrow(
      /required role\(s\) missing.*adj_underpay/,
    );
  });

  it('tryCode("adj_underpay") returns the seeded code without throwing on unknown roles', async () => {
    const service = await makeService(buildPrismaMock(requiredRows));
    await service.onModuleInit();
    expect(service.tryCode('adj_underpay')).toBe('52-1104');
    expect(service.tryCode('does_not_exist')).toBeNull();
  });
});
