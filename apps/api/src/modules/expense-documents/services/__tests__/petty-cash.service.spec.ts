import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PettyCashService } from '../petty-cash.service';
import { PrismaService } from '../../../../prisma/prisma.service';

const Dec = (n: string | number) => new Prisma.Decimal(n);

describe('PettyCashService', () => {
  let service: PettyCashService;
  let prisma: { systemConfig: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { systemConfig: { findMany: jest.fn().mockResolvedValue([]) } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PettyCashService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(PettyCashService);
  });

  describe('getConfig', () => {
    it('defaults to 11-1201 / 5000 when no SystemConfig rows exist', async () => {
      const cfg = await service.getConfig();
      expect(cfg.account).toBe('11-1201');
      expect(cfg.limit.toString()).toBe('5000');
      expect(cfg.replenishThreshold).toBeNull();
    });

    it('reads overrides from SystemConfig when present', async () => {
      prisma.systemConfig.findMany.mockResolvedValue([
        { key: 'petty_cash_account', value: '11-1103' },
        { key: 'petty_cash_limit', value: '10000' },
        { key: 'petty_cash_replenish_threshold', value: '2000' },
      ]);
      const cfg = await service.getConfig();
      expect(cfg.account).toBe('11-1103');
      expect(cfg.limit.toString()).toBe('10000');
      expect(cfg.replenishThreshold?.toString()).toBe('2000');
    });
  });

  describe('validate', () => {
    const defaultCfg = {
      account: '11-1201',
      limit: Dec('5000'),
      replenishThreshold: null,
    };

    it('accepts total ≤ limit + all rows have supplier + correct account', () => {
      expect(() =>
        service.validate(
          {
            total: Dec('4999'),
            depositAccountCode: '11-1201',
            lines: [{ supplierName: 'A' }, { supplierName: 'B' }],
          },
          defaultCfg,
        ),
      ).not.toThrow();
    });

    it('V20.1: rejects when total > limit', () => {
      expect(() =>
        service.validate(
          {
            total: Dec('5001'),
            depositAccountCode: '11-1201',
            lines: [{ supplierName: 'A' }],
          },
          defaultCfg,
        ),
      ).toThrow(/V20.*เกินวงเงิน/);
    });

    it('V20.1 boundary: total === limit passes (≤ not <)', () => {
      expect(() =>
        service.validate(
          {
            total: Dec('5000.00'),
            depositAccountCode: '11-1201',
            lines: [{ supplierName: 'A' }],
          },
          defaultCfg,
        ),
      ).not.toThrow();
    });

    it('V20.2: rejects when any line has empty supplierName', () => {
      expect(() =>
        service.validate(
          {
            total: Dec('1000'),
            depositAccountCode: '11-1201',
            lines: [{ supplierName: 'A' }, { supplierName: '   ' }],
          },
          defaultCfg,
        ),
      ).toThrow(/V20.*ระบุชื่อผู้ขาย/);
    });

    it('V20.3: rejects depositAccountCode that doesn\'t match config.account', () => {
      expect(() =>
        service.validate(
          {
            total: Dec('1000'),
            depositAccountCode: '11-1101', // doesn't match 11-1201
            lines: [{ supplierName: 'A' }],
          },
          defaultCfg,
        ),
      ).toThrow(/V20.*Petty Cash ต้องใช้บัญชี 11-1201/);
    });

    it('V20.3 with override: accepts depositAccountCode that matches config override', () => {
      const overrideCfg = { ...defaultCfg, account: '11-1103' };
      expect(() =>
        service.validate(
          {
            total: Dec('1000'),
            depositAccountCode: '11-1103',
            lines: [{ supplierName: 'A' }],
          },
          overrideCfg,
        ),
      ).not.toThrow();
    });

    it('throws BadRequestException (not generic Error) for HTTP 400 mapping', () => {
      expect(() =>
        service.validate(
          {
            total: Dec('99999'),
            depositAccountCode: '11-1201',
            lines: [{ supplierName: 'A' }],
          },
          defaultCfg,
        ),
      ).toThrow(BadRequestException);
    });
  });
});
