import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ShopBotDefenseGuard } from './shop-bot-defense.guard';
import { ShopBotDefenseService } from './shop-bot-defense.service';

function ctx(path: string, ua = 'Mozilla/5.0'): ExecutionContext {
  const req = { path, ip: '1.2.3.4', headers: { 'user-agent': ua } };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => function handler() {},
    getClass: () => class Ctl {},
  } as unknown as ExecutionContext;
}

describe('ShopBotDefenseGuard', () => {
  let guard: ShopBotDefenseGuard;
  let service: jest.Mocked<Pick<ShopBotDefenseService,
    'getRequestRate' | 'decideAction' | 'classifyUserAgent' | 'logDetection' | 'recordRateLimit'>>;
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(() => {
    service = {
      getRequestRate: jest.fn().mockResolvedValue(5),
      decideAction: jest.fn().mockReturnValue('LOGGED'),
      classifyUserAgent: jest.fn().mockReturnValue(null),
      logDetection: jest.fn().mockResolvedValue(undefined),
      recordRateLimit: jest.fn().mockResolvedValue(undefined),
    } as any;
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    guard = new ShopBotDefenseGuard(service as unknown as ShopBotDefenseService, reflector as unknown as Reflector);
  });

  it('strips the /api global prefix before classifying the page path', async () => {
    await guard.canActivate(ctx('/api/shop/products'));
    expect(service.decideAction).toHaveBeenCalledWith(
      expect.objectContaining({ pagePath: '/shop/products' }),
    );
  });

  it('throws 429 on RATE_LIMITED by default', async () => {
    service.decideAction.mockReturnValue('RATE_LIMITED');
    await expect(guard.canActivate(ctx('/api/shop/products'))).rejects.toBeInstanceOf(HttpException);
  });

  it('does NOT throw 429 when the route opts out, but still logs', async () => {
    service.decideAction.mockReturnValue('RATE_LIMITED');
    reflector.getAllAndOverride.mockReturnValue(true);
    await expect(guard.canActivate(ctx('/api/shop/share/abc'))).resolves.toBe(true);
    expect(service.logDetection).toHaveBeenCalled();
  });

  it('still throws 403 on BLOCKED even when the route opts out of rate limiting', async () => {
    service.decideAction.mockReturnValue('BLOCKED');
    reflector.getAllAndOverride.mockReturnValue(true);
    await expect(guard.canActivate(ctx('/api/shop/share/abc'))).rejects.toBeInstanceOf(HttpException);
  });
});
