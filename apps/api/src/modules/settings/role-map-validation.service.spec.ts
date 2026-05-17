import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { RoleMapValidationService } from './role-map-validation.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * D1.1.1.5 — Validation rules.
 *   1. Required-role lock — REQUIRED_ROLES cannot be deactivated.
 *   2. CoA presence + normalBalance side match.
 *   3. Priority uniqueness within a role.
 */
describe('RoleMapValidationService', () => {
  let service: RoleMapValidationService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      accountRoleMap: { findFirst: jest.fn() },
      chartOfAccount: { findFirst: jest.fn() },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        RoleMapValidationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = mod.get(RoleMapValidationService);
  });

  const baseRow = {
    id: 'r1',
    role: 'custom_role',
    accountCode: '11-4101',
    priority: 1,
    isActive: true,
  };

  it('rule 1 — rejects deactivating a REQUIRED_ROLES row', async () => {
    await expect(
      service.validateUpdate({
        id: 'r1',
        currentRow: { ...baseRow, role: 'vat_input' },
        update: { isActive: false },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rule 1 — allows deactivating a non-required role', async () => {
    await expect(
      service.validateUpdate({
        id: 'r1',
        currentRow: { ...baseRow, role: 'custom_role' },
        update: { isActive: false },
      }),
    ).resolves.toBeUndefined();
  });

  it('rule 2a — rejects accountCode missing from chart_of_accounts', async () => {
    prisma.chartOfAccount.findFirst.mockResolvedValue(null);
    await expect(
      service.validateUpdate({
        id: 'r1',
        currentRow: baseRow,
        update: { accountCode: '99-9999' },
      }),
    ).rejects.toThrow('99-9999 ไม่พบในผังบัญชี');
  });

  it('rule 2b — rejects wrong normalBalance side (vat_input must be Dr)', async () => {
    prisma.chartOfAccount.findFirst.mockResolvedValue({
      code: '21-2101',
      normalBalance: 'Cr',
    });
    await expect(
      service.validateUpdate({
        id: 'r1',
        currentRow: { ...baseRow, role: 'vat_input' },
        update: { accountCode: '21-2101' },
      }),
    ).rejects.toThrow(/ฝั่ง Dr.*ฝั่ง Cr/);
  });

  it('rule 2b — accepts matching normalBalance (vat_output must be Cr)', async () => {
    prisma.chartOfAccount.findFirst.mockResolvedValue({
      code: '21-2101',
      normalBalance: 'Cr',
    });
    await expect(
      service.validateUpdate({
        id: 'r1',
        currentRow: { ...baseRow, role: 'vat_output' },
        update: { accountCode: '21-2101' },
      }),
    ).resolves.toBeUndefined();
  });

  it('rule 3 — rejects priority that conflicts with another row of the same role', async () => {
    prisma.accountRoleMap.findFirst.mockResolvedValue({ id: 'r2' });
    await expect(
      service.validateUpdate({
        id: 'r1',
        currentRow: baseRow,
        update: { priority: 5 },
      }),
    ).rejects.toThrow(/Priority 5 ถูกใช้แล้ว/);
  });

  it('rule 3 — passes when priority is unique within the role', async () => {
    prisma.accountRoleMap.findFirst.mockResolvedValue(null);
    await expect(
      service.validateUpdate({
        id: 'r1',
        currentRow: baseRow,
        update: { priority: 5 },
      }),
    ).resolves.toBeUndefined();
  });
});
