import { EntityScopeMiddleware } from './entity-scope.middleware';

describe('EntityScopeMiddleware', () => {
  let middleware: EntityScopeMiddleware;

  beforeEach(() => {
    middleware = new EntityScopeMiddleware();
  });

  function mkReq(overrides: Record<string, unknown> = {}): any {
    return {
      query: {},
      headers: {},
      user: { accessibleCompanies: ['SHOP', 'FINANCE'], primaryCompany: 'SHOP' },
      ...overrides,
    };
  }

  const mkRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

  it('no req.user → skip (public endpoint)', () => {
    const req: any = { user: undefined };
    const next = jest.fn();
    middleware.use(req, mkRes() as any, next);
    expect(next).toHaveBeenCalled();
    expect(req.entityScope).toBeUndefined();
  });

  it('URL query takes precedence', () => {
    const req: any = mkReq({ query: { company: 'finance' } });
    const next = jest.fn();
    middleware.use(req, mkRes() as any, next);
    expect(req.entityScope).toBe('FINANCE');
    expect(next).toHaveBeenCalled();
  });

  it('header next when no query', () => {
    const req: any = mkReq({ headers: { 'x-company-scope': 'shop' } });
    const next = jest.fn();
    middleware.use(req, mkRes() as any, next);
    expect(req.entityScope).toBe('SHOP');
  });

  it('user.primaryCompany when no query/header', () => {
    const req: any = mkReq();
    const next = jest.fn();
    middleware.use(req, mkRes() as any, next);
    expect(req.entityScope).toBe('SHOP');
  });

  it('rejects 403 when requested company not in accessibleCompanies', () => {
    const req: any = mkReq({
      query: { company: 'finance' },
      user: { accessibleCompanies: ['SHOP'], primaryCompany: 'SHOP' },
    });
    const res: any = mkRes();
    const next = jest.fn();
    middleware.use(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('SHOP-only user with no query/header resolves to SHOP', () => {
    const req: any = mkReq({
      user: { accessibleCompanies: ['SHOP'], primaryCompany: 'SHOP' },
    });
    const next = jest.fn();
    middleware.use(req, mkRes() as any, next);
    expect(req.entityScope).toBe('SHOP');
  });

  it('case-insensitive query (FINANCE | finance | Finance)', () => {
    for (const v of ['FINANCE', 'finance', 'Finance']) {
      const req: any = mkReq({ query: { company: v } });
      const next = jest.fn();
      middleware.use(req, mkRes() as any, next);
      expect(req.entityScope).toBe('FINANCE');
    }
  });

  it('invalid value falls back to primaryCompany', () => {
    const req: any = mkReq({ query: { company: 'banana' } });
    const next = jest.fn();
    middleware.use(req, mkRes() as any, next);
    expect(req.entityScope).toBe('SHOP'); // primaryCompany fallback
  });
});
