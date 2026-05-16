import * as fs from 'fs';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SsoConfigService, SSO_RATE } from '../sso-config.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('SsoConfigService', () => {
  let service: SsoConfigService;
  let prisma: { ssoConfig: { findFirst: jest.Mock } };

  const row2569 = {
    id: 'a',
    salaryCeiling: new Prisma.Decimal('17500'),
    maxContribution: new Prisma.Decimal('875'),
    effectiveFrom: new Date('2026-01-01'),
    effectiveTo: new Date('2028-12-31'),
  };
  const row2572 = {
    id: 'b',
    salaryCeiling: new Prisma.Decimal('20000'),
    maxContribution: new Prisma.Decimal('1000'),
    effectiveFrom: new Date('2029-01-01'),
    effectiveTo: new Date('2031-12-31'),
  };

  beforeEach(async () => {
    prisma = { ssoConfig: { findFirst: jest.fn() } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SsoConfigService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(SsoConfigService);
  });

  describe('getEffectiveConfig', () => {
    it('returns the row whose period covers the date', async () => {
      prisma.ssoConfig.findFirst.mockResolvedValue(row2569);
      const cfg = await service.getEffectiveConfig(new Date('2026-05-11'));
      expect(cfg).toBe(row2569);
      expect(prisma.ssoConfig.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          isActive: true,
          effectiveFrom: { lte: new Date('2026-05-11') },
        }),
        orderBy: { effectiveFrom: 'desc' },
      }));
    });

    it('throws NotFoundException with helpful Thai message when no row matches', async () => {
      prisma.ssoConfig.findFirst.mockResolvedValue(null);
      await expect(service.getEffectiveConfig(new Date('1999-01-01'))).rejects.toThrow(NotFoundException);
      await expect(service.getEffectiveConfig(new Date('1999-01-01'))).rejects.toThrow(/SSO config/);
    });
  });

  describe('validateContribution', () => {
    it('passes silently when ssoEmployee is null/undefined/0', async () => {
      await expect(service.validateContribution(new Date('2026-05-11'), null)).resolves.toBeUndefined();
      await expect(service.validateContribution(new Date('2026-05-11'), undefined)).resolves.toBeUndefined();
      await expect(service.validateContribution(new Date('2026-05-11'), 0)).resolves.toBeUndefined();
      expect(prisma.ssoConfig.findFirst).not.toHaveBeenCalled();
    });

    it('accepts ssoEmployee at exact cap (875 in 2569 period)', async () => {
      prisma.ssoConfig.findFirst.mockResolvedValue(row2569);
      await expect(service.validateContribution(new Date('2026-05-11'), 875)).resolves.toBeUndefined();
    });

    it('accepts ssoEmployee below cap', async () => {
      prisma.ssoConfig.findFirst.mockResolvedValue(row2569);
      await expect(service.validateContribution(new Date('2026-05-11'), 500)).resolves.toBeUndefined();
    });

    it('rejects ssoEmployee above cap with Thai message including period info', async () => {
      prisma.ssoConfig.findFirst.mockResolvedValue(row2569);
      await expect(service.validateContribution(new Date('2026-05-11'), 876))
        .rejects.toThrow(BadRequestException);
      await expect(service.validateContribution(new Date('2026-05-11'), 876))
        .rejects.toThrow(/875\.00.*17500.*2026-01-01/);
    });

    it('uses the 2572 cap for dates in that period (1000)', async () => {
      prisma.ssoConfig.findFirst.mockResolvedValue(row2572);
      await expect(service.validateContribution(new Date('2029-06-15'), 1000)).resolves.toBeUndefined();
      await expect(service.validateContribution(new Date('2029-06-15'), 1001))
        .rejects.toThrow(/1000\.00.*20000/);
    });

    it('rejects when the period has no config (e.g. pre-2569)', async () => {
      prisma.ssoConfig.findFirst.mockResolvedValue(null);
      await expect(service.validateContribution(new Date('2025-01-01'), 500))
        .rejects.toThrow(NotFoundException);
    });
  });

  // D1.1.3.3 — SSO rate is locked at 5% by Thai SSO Act §47.
  describe('SSO_RATE constant (D1.1.3.3 — locked by law)', () => {
    it('exports SSO_RATE as exactly 0.05', () => {
      expect(SSO_RATE).toBe(0.05);
    });

    it('module documents the law citation in a JSDoc comment block', () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, '..', 'sso-config.service.ts'),
        'utf-8',
      );
      // Must reference the law (§47 / Social Security Act / พ.ร.บ.ประกันสังคม)
      // AND must clearly say "DO NOT make this configurable".
      expect(src).toMatch(/§\s*47|มาตรา\s*47|พ\.ร\.บ\.ประกันสังคม|Social Security Act/);
      expect(src).toMatch(/DO NOT make this configurable|locked|fixed at 5/i);
    });

    it('exception message uses SSO_RATE-derived rate string (not a stale literal)', async () => {
      prisma.ssoConfig.findFirst.mockResolvedValue(row2569);
      try {
        await service.validateContribution(new Date('2026-05-11'), 9999);
        throw new Error('should have thrown');
      } catch (e) {
        const msg = (e as Error).message;
        const expectedPct = `${(SSO_RATE * 100).toFixed(0)}%`;
        expect(msg).toContain(expectedPct);
      }
    });
  });
});
