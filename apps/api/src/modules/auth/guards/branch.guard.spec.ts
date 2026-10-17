import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { BranchGuard } from './branch.guard';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

describe('BranchGuard', () => {
  let guard: BranchGuard;

  beforeEach(() => {
    guard = new BranchGuard(new Reflector());
  });

  const makeCtx = (request: Record<string, unknown>): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => function endpoint() {},
      getClass: () => class Controller {},
    }) as unknown as ExecutionContext;

  describe('unauthenticated requests', () => {
    it('allows only explicitly public endpoints to validate their capability without a user', () => {
      const handler = function publicEndpoint() {};
      Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
      const context = makeCtx({});
      context.getHandler = () => handler;
      expect(guard.canActivate(context)).toBe(true);
    });
    it('throws ForbiddenException when request.user is missing', () => {
      expect(() => guard.canActivate(makeCtx({}))).toThrow(ForbiddenException);
    });
  });

  describe('cross-branch roles (OWNER / FINANCE_MANAGER / ACCOUNTANT)', () => {
    it.each(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'])(
      'allows %s to access any branch',
      (role) => {
        const ctx = makeCtx({
          user: { role, branchId: 'branch-a' },
          query: { branchId: 'branch-b' },
        });
        expect(guard.canActivate(ctx)).toBe(true);
      },
    );

    it('allows OWNER even when no branchId is passed', () => {
      const ctx = makeCtx({
        user: { role: 'OWNER', branchId: null },
      });
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('branch-scoped roles (SALES / BRANCH_MANAGER)', () => {
    it('allows SALES to access their own branch via query', () => {
      const ctx = makeCtx({
        user: { role: 'SALES', branchId: 'branch-a' },
        query: { branchId: 'branch-a' },
      });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('blocks SALES from accessing another branch via query', () => {
      const ctx = makeCtx({
        user: { role: 'SALES', branchId: 'branch-a' },
        query: { branchId: 'branch-b' },
      });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('blocks BRANCH_MANAGER from accessing another branch via body', () => {
      const ctx = makeCtx({
        user: { role: 'BRANCH_MANAGER', branchId: 'branch-a' },
        body: { branchId: 'branch-b' },
      });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('blocks SALES from accessing another branch via path param', () => {
      const ctx = makeCtx({
        user: { role: 'SALES', branchId: 'branch-a' },
        params: { branchId: 'branch-b' },
      });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('allows the request through when no branchId is passed anywhere', () => {
      // Service layer is responsible for scoping in this case.
      const ctx = makeCtx({
        user: { role: 'SALES', branchId: 'branch-a' },
      });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('blocks SALES with no branchId from targeting a specific branch', () => {
      const ctx = makeCtx({
        user: { role: 'SALES', branchId: null },
        query: { branchId: 'branch-a' },
      });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });
  });

  describe('conflicting branchId sources', () => {
    it('rejects a foreign body/query branch even when params name the own branch', () => {
      const ctx = makeCtx({
        user: { role: 'SALES', branchId: 'branch-a' },
        params: { branchId: 'branch-a' },
        query: { branchId: 'branch-b' },
        body: { branchId: 'branch-b' },
      });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });
  });
});
