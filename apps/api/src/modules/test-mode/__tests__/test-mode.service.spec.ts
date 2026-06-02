import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { TestModeService } from '../test-mode.service';

describe('TestModeService', () => {
  let svc: TestModeService;
  let prisma: any;

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
});
