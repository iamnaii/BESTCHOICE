/**
 * SP5 Phase 2 — Repair ticket SystemConfig defaults.
 *
 * Verifies that:
 * 1. The production seed file contains REPAIR_EXPENSE_ACCOUNT_CODE + REPAIR_INCOME_ACCOUNT_CODE
 *    with the correct SHOP CoA codes (S51-1105 / S42-1101).
 * 2. SettingsService.getKey returns the seeded value when the DB row exists.
 *
 * No `bootstrapDefaults()` method exists in SettingsService — defaults are applied
 * via prisma/seed.ts + prisma/seed-production.ts. These tests validate both the
 * seed payload and the runtime read path.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { SettingsService } from '../settings.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

const SEED_PROD_PATH = path.resolve(
  __dirname,
  '../../../../prisma/seed-production.ts',
);

describe('Repair ticket SystemConfig defaults', () => {
  describe('seed-production.ts contains the repair keys', () => {
    let seedSrc: string;

    beforeAll(() => {
      seedSrc = fs.readFileSync(SEED_PROD_PATH, 'utf-8');
    });

    it('contains REPAIR_EXPENSE_ACCOUNT_CODE with value S51-1105', () => {
      expect(seedSrc).toContain("key: 'REPAIR_EXPENSE_ACCOUNT_CODE'");
      expect(seedSrc).toContain("value: 'S51-1105'");
    });

    it('contains REPAIR_INCOME_ACCOUNT_CODE with value S42-1101', () => {
      expect(seedSrc).toContain("key: 'REPAIR_INCOME_ACCOUNT_CODE'");
      expect(seedSrc).toContain("value: 'S42-1101'");
    });
  });

  describe('SettingsService.getKey reads repair config from DB', () => {
    let service: SettingsService;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let prisma: any;

    beforeEach(async () => {
      prisma = {
        systemConfig: {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn(),
          findFirst: jest.fn(),
          upsert: jest.fn(),
        },
        $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
      };
      const audit = { log: jest.fn().mockResolvedValue(undefined) };

      const mod: TestingModule = await Test.createTestingModule({
        providers: [
          SettingsService,
          { provide: PrismaService, useValue: prisma },
          { provide: AuditService, useValue: audit },
        ],
      }).compile();
      service = mod.get(SettingsService);
    });

    it('seeds REPAIR_EXPENSE_ACCOUNT_CODE + REPAIR_INCOME_ACCOUNT_CODE on bootstrap', async () => {
      // Simulate the seeded rows being present in the DB.
      prisma.systemConfig.findFirst.mockImplementation(
        (args: { where: { key: string } }) => {
          const map: Record<string, string> = {
            REPAIR_EXPENSE_ACCOUNT_CODE: 'S51-1105',
            REPAIR_INCOME_ACCOUNT_CODE: 'S42-1101',
          };
          const val = map[args.where.key];
          return Promise.resolve(val ? { value: val } : null);
        },
      );

      const expense = await service.getKey('REPAIR_EXPENSE_ACCOUNT_CODE');
      const income = await service.getKey('REPAIR_INCOME_ACCOUNT_CODE');

      expect(expense).toBe('S51-1105');
      expect(income).toBe('S42-1101');
    });
  });
});
