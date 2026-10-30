import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { TestModeService } from '../test-mode.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

describe('TestModeService', () => {
  let svc: TestModeService;
  let prisma: { systemConfig: { findFirst: jest.Mock; upsert: jest.Mock } };

  beforeEach(async () => {
    prisma = { systemConfig: { findFirst: jest.fn(), upsert: jest.fn() } };
    const mod = await Test.createTestingModule({
      providers: [TestModeService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    svc = mod.get(TestModeService);
  });

  it('isEnabled true only when value "true"', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'true' });
    expect(await svc.isEnabled()).toBe(true);
  });

  it('isEnabled false when missing', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue(null);
    expect(await svc.isEnabled()).toBe(false);
  });

  it('isEnabled false on db error', async () => {
    prisma.systemConfig.findFirst.mockRejectedValue(new Error('x'));
    expect(await svc.isEnabled()).toBe(false);
  });

  it('setEnabled upserts', async () => {
    prisma.systemConfig.upsert.mockResolvedValue({});
    await svc.setEnabled(true);
    expect(prisma.systemConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'TEST_MODE_BYPASS' } }),
    );
  });

  // Task 20 I2 — flag ใน SystemConfig อย่างเดียวไม่พอบน production (OWNER กดเปิดได้ = OTP/เช็คเครดิตหายทั้งระบบ)
  describe('env gate (Task 20 I2)', () => {
    const env = { ...process.env };
    afterEach(() => {
      process.env = { ...env };
      (Sentry.captureMessage as jest.Mock).mockClear();
    });

    it('production + flag ON + no override → OFF, warns via Sentry', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ALLOW_TEST_MODE_BYPASS;
      prisma.systemConfig.findFirst.mockResolvedValue({ value: 'true' });

      expect(await svc.isEnabled()).toBe(false);
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('TEST_MODE_BYPASS'),
        expect.objectContaining({ level: 'warning' }),
      );
    });

    it('production + flag ON + ALLOW_TEST_MODE_BYPASS=YES_I_AM_SURE → ON', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_TEST_MODE_BYPASS = 'YES_I_AM_SURE';
      prisma.systemConfig.findFirst.mockResolvedValue({ value: 'true' });

      expect(await svc.isEnabled()).toBe(true);
    });

    it('production + any other override value → still OFF', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_TEST_MODE_BYPASS = 'true';
      prisma.systemConfig.findFirst.mockResolvedValue({ value: 'true' });

      expect(await svc.isEnabled()).toBe(false);
    });

    it('production + flag OFF → OFF without warning', async () => {
      process.env.NODE_ENV = 'production';
      prisma.systemConfig.findFirst.mockResolvedValue({ value: 'false' });

      expect(await svc.isEnabled()).toBe(false);
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it('non-production + flag ON → ON (UAT/dev unchanged)', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.ALLOW_TEST_MODE_BYPASS;
      prisma.systemConfig.findFirst.mockResolvedValue({ value: 'true' });

      expect(await svc.isEnabled()).toBe(true);
    });

    it('production + no override → turning it ON is refused (Thai 400), turning OFF still works', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ALLOW_TEST_MODE_BYPASS;
      prisma.systemConfig.upsert.mockResolvedValue({});

      await expect(svc.setEnabled(true)).rejects.toThrow(BadRequestException);
      expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
      await expect(svc.setEnabled(false)).resolves.toBe(false);
      expect(prisma.systemConfig.upsert).toHaveBeenCalledTimes(1);
    });
  });
});
