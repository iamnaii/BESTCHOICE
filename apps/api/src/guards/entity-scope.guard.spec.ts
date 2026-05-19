import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { EntityScopeGuard } from './entity-scope.guard';
import { ENTITY_KEY } from '../decorators/entity.decorator';

describe('EntityScopeGuard', () => {
  let guard: EntityScopeGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new EntityScopeGuard(reflector);
  });

  function mkCtx(opts: { required?: string; userCompanies?: string[] }): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { accessibleCompanies: opts.userCompanies ?? ['SHOP', 'FINANCE'] },
        }),
      }),
      getHandler: () => 'handler',
      getClass: () => 'class',
    } as any;
  }

  it('allows when no @Entity decoration', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(mkCtx({ userCompanies: ['SHOP'] }))).toBe(true);
  });

  it('allows @Entity(SHOP) when user has SHOP', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('SHOP');
    expect(guard.canActivate(mkCtx({ userCompanies: ['SHOP'] }))).toBe(true);
  });

  it('rejects @Entity(FINANCE) when user only has SHOP', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('FINANCE');
    expect(() => guard.canActivate(mkCtx({ userCompanies: ['SHOP'] }))).toThrow(ForbiddenException);
  });

  it('rejects when user has empty accessibleCompanies', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('SHOP');
    expect(() => guard.canActivate(mkCtx({ userCompanies: [] }))).toThrow(ForbiddenException);
  });

  it('allows OWNER (both) on FINANCE handler', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('FINANCE');
    expect(guard.canActivate(mkCtx({ userCompanies: ['SHOP', 'FINANCE'] }))).toBe(true);
  });
});
