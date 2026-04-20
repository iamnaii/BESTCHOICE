import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAudienceGuard, REQUIRED_AUDIENCE_KEY } from './jwt-audience.guard';

function makeContext(aud: string | undefined, decoratorValue?: string) {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(decoratorValue as any);

  const guard = new JwtAudienceGuard(reflector);

  const mockRequest = { user: aud !== undefined ? { aud } : {} };
  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(mockRequest),
    }),
  } as any;

  return { guard, context, reflector };
}

describe('JwtAudienceGuard', () => {
  it('returns true when no @RequireAudience decorator is present', () => {
    const { guard, context } = makeContext(undefined, undefined);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('returns true when audience matches the required value', () => {
    const { guard, context } = makeContext('admin', 'admin');
    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws ForbiddenException when JWT has no aud claim', () => {
    const { guard, context } = makeContext(undefined, 'admin');
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when aud claim does not match required', () => {
    // shop customer JWT trying to hit an admin-only endpoint
    const { guard, context } = makeContext('shop', 'admin');
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
