import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import {
  AccountRoleService,
  ROLE_MAP_READ_ROLES,
  ROLE_MAP_WRITE_ROLES,
} from '../journal/account-role.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * D1.1.1.7 — Permission control (defense in depth).
 *
 * The @Roles decorator on the controller is the primary gate, but the
 * service-level `assertCanRead` / `assertCanWrite` checks survive
 * accidental decorator misconfiguration in future refactors.
 *
 * Required matrix:
 *   GET  — OWNER, FINANCE_MANAGER, ACCOUNTANT allowed; SALES/BRANCH_MANAGER denied
 *   PUT  — OWNER allowed; everyone else denied
 */
describe('AccountRoleService permission guards (D1.1.1.7)', () => {
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

  it('assertCanRead allows OWNER, FINANCE_MANAGER, ACCOUNTANT and denies SALES/BRANCH_MANAGER', () => {
    for (const role of ROLE_MAP_READ_ROLES) {
      expect(() => service.assertCanRead(role)).not.toThrow();
    }
    for (const denied of ['SALES', 'BRANCH_MANAGER', 'GUEST']) {
      expect(() => service.assertCanRead(denied)).toThrow(ForbiddenException);
    }
  });

  it('assertCanWrite allows only OWNER and denies everyone else', () => {
    expect(() => service.assertCanWrite('OWNER')).not.toThrow();
    for (const denied of [
      'FINANCE_MANAGER',
      'ACCOUNTANT',
      'SALES',
      'BRANCH_MANAGER',
      undefined,
    ]) {
      expect(() => service.assertCanWrite(denied)).toThrow(ForbiddenException);
    }
    // Constant alignment: WRITE_ROLES must contain exactly ['OWNER'].
    expect([...ROLE_MAP_WRITE_ROLES]).toEqual(['OWNER']);
  });

  it('update() runs the OWNER write check before any DB lookup', async () => {
    // ACCOUNTANT has read access (visible in admin UI) but trying to PUT
    // should be blocked even before we hit the prisma findUnique call.
    await expect(
      service.update('r1', { priority: 5 }, 'user-1', 'ACCOUNTANT'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.accountRoleMap.findUnique).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('update() proceeds when caller is OWNER (happy path)', async () => {
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

    const updated = await service.update('r1', { priority: 5 }, 'user-1', 'OWNER');
    expect(updated.priority).toBe(5);
    expect(audit.log).toHaveBeenCalled();
  });
});
