import { AdminPrefixMiddleware } from './admin-prefix.middleware';

function makeReq(url: string) {
  return { url } as any;
}

const noopRes = {} as any;
const noopNext = jest.fn();

describe('AdminPrefixMiddleware', () => {
  let middleware: AdminPrefixMiddleware;

  beforeEach(() => {
    middleware = new AdminPrefixMiddleware();
    jest.clearAllMocks();
  });

  it('rewrites /api/admin/X to /api/X', () => {
    const req = makeReq('/api/admin/customers?page=1');
    middleware.use(req, noopRes, noopNext);
    expect(req.url).toBe('/api/customers?page=1');
    expect(noopNext).toHaveBeenCalled();
  });

  it('leaves /api/X paths unchanged', () => {
    const req = makeReq('/api/customers');
    middleware.use(req, noopRes, noopNext);
    expect(req.url).toBe('/api/customers');
    expect(noopNext).toHaveBeenCalled();
  });

  it('leaves /api/shop/X paths unchanged', () => {
    const req = makeReq('/api/shop/profile');
    middleware.use(req, noopRes, noopNext);
    expect(req.url).toBe('/api/shop/profile');
    expect(noopNext).toHaveBeenCalled();
  });

  it('handles /api/admin (no trailing slash)', () => {
    const req = makeReq('/api/admin');
    middleware.use(req, noopRes, noopNext);
    expect(req.url).toBe('/api');
    expect(noopNext).toHaveBeenCalled();
  });
});
