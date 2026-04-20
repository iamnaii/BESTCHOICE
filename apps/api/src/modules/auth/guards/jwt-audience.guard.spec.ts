import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAudienceGuard } from './jwt-audience.guard';

/** Build a mock execution context for a given path, aud claim, and optional @RequireAudience value. */
function makeContext(opts: {
  path: string;
  aud?: string;
  decoratorAud?: string;
}) {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(opts.decoratorAud as any);

  const guard = new JwtAudienceGuard(reflector);

  const mockRequest = {
    path: opts.path,
    user: opts.aud !== undefined ? { aud: opts.aud } : undefined,
  };

  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(mockRequest),
    }),
  } as any;

  return { guard, context };
}

describe('JwtAudienceGuard — decorator mode', () => {
  it('passes when @RequireAudience aud matches JWT aud', () => {
    const { guard, context } = makeContext({ path: '/api/customers', aud: 'admin', decoratorAud: 'admin' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws ForbiddenException when JWT has no aud claim but decorator requires one', () => {
    const { guard, context } = makeContext({ path: '/api/customers', aud: undefined, decoratorAud: 'admin' });
    // req.user is undefined → guard defers to JwtAuthGuard → returns true
    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws ForbiddenException when aud claim does not match @RequireAudience', () => {
    const { guard, context } = makeContext({ path: '/api/customers', aud: 'shop', decoratorAud: 'admin' });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});

describe('JwtAudienceGuard — path-based mode (no decorator)', () => {
  // /api/shop/* → require aud='shop'
  it('allows /api/shop/* with aud=shop', () => {
    const { guard, context } = makeContext({ path: '/api/shop/products', aud: 'shop' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('blocks /api/shop/* with aud=admin', () => {
    const { guard, context } = makeContext({ path: '/api/shop/products', aud: 'admin' });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('blocks /api/shop/* with no aud', () => {
    const { guard, context } = makeContext({ path: '/api/shop/products', aud: '' });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  // /api/* standard admin endpoints → require aud='admin'
  it('allows /api/customers with aud=admin', () => {
    const { guard, context } = makeContext({ path: '/api/customers', aud: 'admin' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('blocks /api/customers with aud=shop', () => {
    const { guard, context } = makeContext({ path: '/api/customers', aud: 'shop' });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  // Public paths → always pass
  it('allows /api/auth/login (public — no JWT required)', () => {
    const { guard, context } = makeContext({ path: '/api/auth/login', aud: undefined });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows /api/health (public)', () => {
    const { guard, context } = makeContext({ path: '/api/health', aud: undefined });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows /api/address/provinces (public static data)', () => {
    const { guard, context } = makeContext({ path: '/api/address/provinces', aud: undefined });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows /api/sms-webhook (public webhook)', () => {
    const { guard, context } = makeContext({ path: '/api/sms-webhook', aud: undefined });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows /api/paysolutions (public payment webhook)', () => {
    const { guard, context } = makeContext({ path: '/api/paysolutions', aud: undefined });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows /api/chatbot-finance-liff/payment (LIFF public)', () => {
    const { guard, context } = makeContext({ path: '/api/chatbot-finance-liff/payment', aud: undefined });
    expect(guard.canActivate(context)).toBe(true);
  });

  // /api/2fa/* → accept admin OR temp 2FA tokens
  it('allows /api/2fa/confirm with aud=2fa_setup', () => {
    const { guard, context } = makeContext({ path: '/api/2fa/confirm', aud: '2fa_setup' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows /api/2fa/verify with aud=2fa_login', () => {
    const { guard, context } = makeContext({ path: '/api/2fa/verify', aud: '2fa_login' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows /api/2fa/setup with aud=admin', () => {
    const { guard, context } = makeContext({ path: '/api/2fa/setup', aud: 'admin' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('blocks /api/2fa/confirm with aud=shop', () => {
    const { guard, context } = makeContext({ path: '/api/2fa/confirm', aud: 'shop' });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  // No JWT user on protected path → defer to JwtAuthGuard
  it('passes through when req.user is undefined on admin path (let JwtAuthGuard handle)', () => {
    const { guard, context } = makeContext({ path: '/api/customers', aud: undefined });
    expect(guard.canActivate(context)).toBe(true);
  });
});
