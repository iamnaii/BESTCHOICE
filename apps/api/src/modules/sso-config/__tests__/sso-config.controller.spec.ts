import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SsoConfigController } from '../sso-config.controller';

describe('SsoConfigController', () => {
  it('GET /sso-config/effective returns ceiling + cap + rate for the given date', async () => {
    const svc = {
      getEffectiveConfig: jest.fn().mockResolvedValue({
        id: 'cfg-1',
        salaryCeiling: new Prisma.Decimal('17500'),
        maxContribution: new Prisma.Decimal('875'),
        effectiveFrom: new Date('2026-01-01'),
        effectiveTo: null,
      }),
    };
    const controller = new SsoConfigController(svc as never);
    const res = await controller.effective('2026-06-01');
    expect(svc.getEffectiveConfig).toHaveBeenCalledWith(new Date('2026-06-01'));
    expect(res.maxContribution.toString()).toBe('875');
    expect(res.salaryCeiling.toString()).toBe('17500');
    expect(res.rate).toBe(0.05);
  });

  it('defaults to "now" when no date is provided', async () => {
    const svc = {
      getEffectiveConfig: jest.fn().mockResolvedValue({
        id: 'cfg-1',
        salaryCeiling: new Prisma.Decimal('17500'),
        maxContribution: new Prisma.Decimal('875'),
        effectiveFrom: new Date('2026-01-01'),
        effectiveTo: null,
      }),
    };
    const controller = new SsoConfigController(svc as never);
    await controller.effective(undefined);
    expect(svc.getEffectiveConfig).toHaveBeenCalledTimes(1);
    const arg = svc.getEffectiveConfig.mock.calls[0][0];
    expect(arg).toBeInstanceOf(Date);
    expect(Date.now() - arg.getTime()).toBeLessThan(5000);
  });

  it('rejects an invalid date string with BadRequestException (no DB call)', async () => {
    const svc = { getEffectiveConfig: jest.fn() };
    const controller = new SsoConfigController(svc as never);
    await expect(controller.effective('garbage')).rejects.toThrow(BadRequestException);
    expect(svc.getEffectiveConfig).not.toHaveBeenCalled();
  });
});
