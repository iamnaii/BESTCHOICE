import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayrollCustomService } from '../payroll-custom.service';
import { PrismaService } from '../../../../prisma/prisma.service';

const Dec = (n: string | number) => new Prisma.Decimal(n);

describe('PayrollCustomService — V16/V17/V18 (C2)', () => {
  let service: PayrollCustomService;
  let prisma: { systemConfig: { findUnique: jest.Mock } };

  beforeEach(async () => {
    prisma = { systemConfig: { findUnique: jest.fn().mockResolvedValue(null) } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollCustomService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(PayrollCustomService);
  });

  describe('loadWhitelist', () => {
    it('returns the seeded default when SystemConfig row is absent', async () => {
      const wl = await service.loadWhitelist();
      expect(wl.has('53-1104')).toBe(true);
      expect(wl.has('53-1105')).toBe(true);
      expect(wl.size).toBe(2);
    });

    it('parses JSON array from SystemConfig.value', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue({
        value: '["53-1104","53-1105","53-1199"]',
      });
      const wl = await service.loadWhitelist();
      expect(wl.has('53-1199')).toBe(true);
      expect(wl.size).toBe(3);
    });

    it('falls back to default on malformed JSON (resilience)', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue({ value: 'not-json' });
      const wl = await service.loadWhitelist();
      expect(wl.has('53-1104')).toBe(true);
    });

    it('falls back to default if JSON is not an array', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue({ value: '{"foo":1}' });
      const wl = await service.loadWhitelist();
      expect(wl.has('53-1104')).toBe(true);
    });
  });

  describe('validateLine', () => {
    const wl = new Set(['53-1104', '53-1105']);

    it('V17: rejects custom income with accountCode NOT on whitelist', async () => {
      await expect(
        service.validateLine(
          {
            employeeName: 'A',
            baseSalary: 20000,
            customIncome: [{ accountCode: '41-1101', amount: 1000 }], // revenue — not allowed
          },
          wl,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.validateLine(
          {
            employeeName: 'A',
            baseSalary: 20000,
            customIncome: [{ accountCode: '41-1101', amount: 1000 }],
          },
          wl,
        ),
      ).rejects.toThrow(/V17.*41-1101/);
    });

    it('V17: accepts whitelisted account codes', async () => {
      await expect(
        service.validateLine(
          {
            employeeName: 'A',
            baseSalary: 20000,
            customIncome: [
              { accountCode: '53-1104', amount: 5000 }, // bonus
              { accountCode: '53-1105', amount: 800 },  // OT
            ],
          },
          wl,
        ),
      ).resolves.toEqual({ taxableBase: Dec(25800) });
    });

    it('V16: taxableBase = base + Σ(taxable income only); non-taxable excluded', async () => {
      const { taxableBase } = await service.validateLine(
        {
          employeeName: 'A',
          baseSalary: 20000,
          customIncome: [
            { accountCode: '53-1104', amount: 5000 },                       // taxable (default)
            { accountCode: '53-1105', amount: 3000, isTaxable: false },     // ม.42 exempt
          ],
        },
        wl,
      );
      // 20000 + 5000 (skip the 3000 exempt)
      expect(taxableBase.toString()).toBe('25000');
    });

    it('V18: rejects when Σ(deduction) > base + Σ(income)', async () => {
      await expect(
        service.validateLine(
          {
            employeeName: 'A',
            baseSalary: 10000,
            customIncome: [{ accountCode: '53-1104', amount: 2000 }], // gross = 12000
            customDeduction: [{ accountCode: '11-2199', amount: 12001 }], // > gross
          },
          wl,
        ),
      ).rejects.toThrow(/V18/);
    });

    it('V18 boundary: Σ(deduction) === base + Σ(income) passes (≤ not <)', async () => {
      await expect(
        service.validateLine(
          {
            employeeName: 'A',
            baseSalary: 10000,
            customIncome: [{ accountCode: '53-1104', amount: 2000 }],
            customDeduction: [{ accountCode: '11-2199', amount: 12000 }], // exactly gross
          },
          wl,
        ),
      ).resolves.toEqual({ taxableBase: Dec(12000) });
    });

    it('no custom rows: taxableBase = baseSalary', async () => {
      const { taxableBase } = await service.validateLine(
        { employeeName: 'A', baseSalary: 30000 },
        wl,
      );
      expect(taxableBase.toString()).toBe('30000');
    });

    it('handles isTaxable=undefined as taxable (matches DTO default)', async () => {
      const { taxableBase } = await service.validateLine(
        {
          employeeName: 'A',
          baseSalary: 20000,
          customIncome: [{ accountCode: '53-1104', amount: 5000 }], // isTaxable not set
        },
        wl,
      );
      expect(taxableBase.toString()).toBe('25000');
    });
  });
});
