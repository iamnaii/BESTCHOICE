import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DocConfigService } from '../doc-config.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AuditService } from '../../../audit/audit.service';
import {
  formatDocNumber,
  getPeriodBounds,
  buildStartsWithPrefix,
  parseSequence,
} from '../../../../utils/doc-number-format.util';

/**
 * SP4 — DocConfigService unit tests.
 *
 * Covers list / fetch / update + audit log + preview, plus token substitution
 * edge cases (digitCount=10, mixed tokens) and period-bound calculation per
 * resetCadence (DAILY / MONTHLY / YEARLY / NEVER).
 */
describe('DocConfigService', () => {
  let service: DocConfigService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let audit: any;

  const baseRow = {
    id: 'cfg-EX',
    docType: 'EX',
    description: 'ใบสำคัญจ่าย',
    prefix: 'EX',
    format: '{prefix}-{YYYYMMDD}-{NNNN}',
    resetCadence: 'DAILY',
    digitCount: 4,
    active: true,
    notes: null,
    createdAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-01T00:00:00Z'),
    deletedAt: null,
    updatedById: null,
  };

  beforeEach(async () => {
    prisma = {
      documentNumberConfig: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      expenseDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      otherIncome: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        DocConfigService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = mod.get(DocConfigService);
  });

  describe('findAll', () => {
    it('returns all non-deleted configs sorted by docType', async () => {
      prisma.documentNumberConfig.findMany.mockResolvedValue([baseRow]);
      const result = await service.findAll();
      expect(result).toEqual([baseRow]);
      expect(prisma.documentNumberConfig.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null },
          orderBy: { docType: 'asc' },
        }),
      );
    });
  });

  describe('findByType', () => {
    it('returns the config for a known docType', async () => {
      prisma.documentNumberConfig.findUnique.mockResolvedValue(baseRow);
      const result = await service.findByType('EX');
      expect(result.docType).toBe('EX');
    });

    it('throws NotFoundException for unknown docType', async () => {
      prisma.documentNumberConfig.findUnique.mockResolvedValue(null);
      await expect(service.findByType('ZZ')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException for soft-deleted docType', async () => {
      prisma.documentNumberConfig.findUnique.mockResolvedValue({
        ...baseRow,
        deletedAt: new Date(),
      });
      await expect(service.findByType('EX')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('persists update and writes an audit log entry', async () => {
      prisma.documentNumberConfig.findUnique.mockResolvedValue(baseRow);
      const updatedRow = { ...baseRow, prefix: 'EX2', digitCount: 5 };
      prisma.documentNumberConfig.update.mockResolvedValue(updatedRow);

      const result = await service.update(
        'EX',
        { prefix: 'EX2', digitCount: 5 },
        'user-1',
      );

      expect(result.prefix).toBe('EX2');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DOC_NUMBER_CONFIG_UPDATED',
          entity: 'document_number_config',
          entityId: 'EX',
          userId: 'user-1',
        }),
      );
      // old vs new captured for diff
      expect(audit.log.mock.calls[0][0].oldValue).toMatchObject({
        prefix: 'EX',
        digitCount: 4,
      });
      expect(audit.log.mock.calls[0][0].newValue).toMatchObject({
        prefix: 'EX2',
        digitCount: 5,
      });
    });

    it('passes only provided fields to update (no undefined leakage)', async () => {
      prisma.documentNumberConfig.findUnique.mockResolvedValue(baseRow);
      prisma.documentNumberConfig.update.mockResolvedValue(baseRow);
      await service.update('EX', { active: false }, 'user-1');
      const callArg = prisma.documentNumberConfig.update.mock.calls[0][0];
      expect(callArg.data.active).toBe(false);
      expect(callArg.data.prefix).toBeUndefined();
      expect(callArg.data.format).toBeUndefined();
      expect(callArg.data.updatedById).toBe('user-1');
    });
  });

  describe('preview', () => {
    it('generates EX-YYYYMMDD-0001 with default config + no existing docs', async () => {
      prisma.documentNumberConfig.findUnique.mockResolvedValue(baseRow);
      const result = await service.preview('EX', {
        sampleDate: '2026-05-17T12:00:00Z',
      });
      expect(result.sample).toBe('EX-20260517-0001');
      expect(result.nextSeq).toBe(1);
    });

    it('uses override fields when provided (prefix/format/digitCount)', async () => {
      prisma.documentNumberConfig.findUnique.mockResolvedValue(baseRow);
      const result = await service.preview('EX', {
        sampleDate: '2026-05-17T12:00:00Z',
        prefix: 'EXP',
        format: '{prefix}/{YYYY}/{NN}',
        digitCount: 2,
      });
      expect(result.sample).toBe('EXP/2026/01');
    });

    it('handles malformed sampleDate gracefully (falls back to now)', async () => {
      prisma.documentNumberConfig.findUnique.mockResolvedValue(baseRow);
      const result = await service.preview('EX', { sampleDate: 'not-a-date' });
      // The sample is generated with today's BKK date — only assert prefix + suffix shape.
      expect(result.sample).toMatch(/^EX-\d{8}-0001$/);
    });
  });
});

/**
 * SP4 — token substitution + period-bound helpers (pure functions).
 *
 * Verified directly because they're the contract every DocNumberService
 * implementation must agree on.
 */
describe('doc-number-format util', () => {
  describe('formatDocNumber', () => {
    it('substitutes prefix + YYYYMMDD + NNNN', () => {
      const out = formatDocNumber(
        '{prefix}-{YYYYMMDD}-{NNNN}',
        'EX',
        42,
        new Date('2026-05-17T12:00:00Z'),
        4,
      );
      expect(out).toBe('EX-20260517-0042');
    });

    it('supports YYYY / MM / DD individually', () => {
      const out = formatDocNumber(
        '{prefix}/{YYYY}/{MM}/{DD}-{NNN}',
        'X',
        7,
        new Date('2026-05-17T12:00:00Z'),
        3,
      );
      expect(out).toBe('X/2026/05/17-007');
    });

    it('supports YYYYMM token', () => {
      const out = formatDocNumber(
        '{prefix}-{YYYYMM}-{NNNNN}',
        'RT',
        1,
        new Date('2026-05-17T12:00:00Z'),
        5,
      );
      expect(out).toBe('RT-202605-00001');
    });

    it('supports digitCount up to 10', () => {
      const out = formatDocNumber(
        '{prefix}-{SEQ}',
        'X',
        42,
        new Date('2026-05-17T12:00:00Z'),
        10,
      );
      expect(out).toBe('X-0000000042');
    });

    it('treats unknown tokens as literal text', () => {
      const out = formatDocNumber(
        '{prefix}-{UNKNOWN}-{NNNN}',
        'EX',
        1,
        new Date('2026-05-17T12:00:00Z'),
        4,
      );
      expect(out).toBe('EX-{UNKNOWN}-0001');
    });
  });

  describe('getPeriodBounds', () => {
    const date = new Date('2026-05-17T12:00:00Z'); // BKK 2026-05-17 19:00

    it('DAILY → single-day window keyed YYYYMMDD', () => {
      const b = getPeriodBounds(date, 'DAILY');
      expect(b.periodKey).toBe('20260517');
      expect(b.end.getTime() - b.start.getTime()).toBe(24 * 60 * 60 * 1000);
    });

    it('MONTHLY → first-of-month → first-of-next-month, keyed YYYYMM', () => {
      const b = getPeriodBounds(date, 'MONTHLY');
      expect(b.periodKey).toBe('202605');
      // 31 days in May
      expect(b.end.getTime() - b.start.getTime()).toBe(31 * 24 * 60 * 60 * 1000);
    });

    it('YEARLY → Jan 1 → Jan 1 next year, keyed YYYY', () => {
      const b = getPeriodBounds(date, 'YEARLY');
      expect(b.periodKey).toBe('2026');
    });

    it('NEVER → single sentinel bucket', () => {
      const b = getPeriodBounds(date, 'NEVER');
      expect(b.periodKey).toBe('all');
    });

    it('unknown cadence falls back to DAILY', () => {
      const b = getPeriodBounds(date, 'WEEKLY-UNSUPPORTED');
      expect(b.periodKey).toBe('20260517');
    });
  });

  describe('buildStartsWithPrefix + parseSequence', () => {
    it('strips off the sequence token so LIKE queries match all numbers in period', () => {
      const sw = buildStartsWithPrefix(
        '{prefix}-{YYYYMMDD}-{NNNN}',
        'EX',
        new Date('2026-05-17T12:00:00Z'),
      );
      expect(sw).toBe('EX-20260517-');
    });

    it('parseSequence reads trailing digits even when -R suffix is present', () => {
      expect(parseSequence('OI-20260517-0042', 'OI-20260517-')).toBe(42);
      expect(parseSequence('OI-20260517-0042-R', 'OI-20260517-')).toBe(42);
      expect(parseSequence('OI-20260518-0001', 'OI-20260517-')).toBe(0);
    });
  });
});
