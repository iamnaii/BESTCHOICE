import { MaintenanceModeMiddleware } from './maintenance-mode.middleware';

describe('MaintenanceModeMiddleware', () => {
  let middleware: MaintenanceModeMiddleware;
  const originalEnv = process.env.MAINTENANCE_MODE;

  beforeEach(() => {
    middleware = new MaintenanceModeMiddleware();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.MAINTENANCE_MODE;
    else process.env.MAINTENANCE_MODE = originalEnv;
  });

  const mkRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

  describe('MAINTENANCE_MODE not enabled', () => {
    it('passes through POST when MAINTENANCE_MODE is not set', () => {
      delete process.env.MAINTENANCE_MODE;
      const req: any = { method: 'POST', path: '/api/payments' };
      const next = jest.fn();
      middleware.use(req, mkRes() as any, next);
      expect(next).toHaveBeenCalled();
    });

    it('passes through POST when MAINTENANCE_MODE=false', () => {
      process.env.MAINTENANCE_MODE = 'false';
      const req: any = { method: 'POST', path: '/api/payments' };
      const next = jest.fn();
      middleware.use(req, mkRes() as any, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('MAINTENANCE_MODE=true — write methods blocked', () => {
    beforeEach(() => {
      process.env.MAINTENANCE_MODE = 'true';
    });

    it('blocks POST to /api/payments with 503', () => {
      const req: any = { method: 'POST', path: '/api/payments' };
      const res = mkRes();
      const next = jest.fn();
      middleware.use(req, res as any, next);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ maintenance: true }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('blocks PUT', () => {
      const req: any = { method: 'PUT', path: '/api/contracts/123' };
      const res = mkRes();
      const next = jest.fn();
      middleware.use(req, res as any, next);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(next).not.toHaveBeenCalled();
    });

    it('blocks PATCH', () => {
      const req: any = { method: 'PATCH', path: '/api/customers/456' };
      const res = mkRes();
      const next = jest.fn();
      middleware.use(req, res as any, next);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(next).not.toHaveBeenCalled();
    });

    it('blocks DELETE', () => {
      const req: any = { method: 'DELETE', path: '/api/payments/789' };
      const res = mkRes();
      const next = jest.fn();
      middleware.use(req, res as any, next);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('MAINTENANCE_MODE=true — reads allowed', () => {
    beforeEach(() => {
      process.env.MAINTENANCE_MODE = 'true';
    });

    it('allows GET requests through', () => {
      const req: any = { method: 'GET', path: '/api/payments' };
      const next = jest.fn();
      middleware.use(req, mkRes() as any, next);
      expect(next).toHaveBeenCalled();
    });

    it('allows HEAD requests through', () => {
      const req: any = { method: 'HEAD', path: '/api/contracts' };
      const next = jest.fn();
      middleware.use(req, mkRes() as any, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('MAINTENANCE_MODE=true — whitelist', () => {
    beforeEach(() => {
      process.env.MAINTENANCE_MODE = 'true';
    });

    it('whitelists POST /api/health (liveness probe)', () => {
      const req: any = { method: 'POST', path: '/api/health' };
      const next = jest.fn();
      middleware.use(req, mkRes() as any, next);
      expect(next).toHaveBeenCalled();
    });

    it('whitelists POST /api/version', () => {
      const req: any = { method: 'POST', path: '/api/version' };
      const next = jest.fn();
      middleware.use(req, mkRes() as any, next);
      expect(next).toHaveBeenCalled();
    });

    it('whitelists sub-paths under /api/health/', () => {
      const req: any = { method: 'POST', path: '/api/health/db' };
      const next = jest.fn();
      middleware.use(req, mkRes() as any, next);
      expect(next).toHaveBeenCalled();
    });

    it('does NOT whitelist /api/payments/health (not a health prefix)', () => {
      const req: any = { method: 'POST', path: '/api/payments/health' };
      const res = mkRes();
      const next = jest.fn();
      middleware.use(req, res as any, next);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('503 response body', () => {
    it('includes Thai maintenance message and retryAfter', () => {
      process.env.MAINTENANCE_MODE = 'true';
      const req: any = { method: 'POST', path: '/api/payments' };
      const res = mkRes();
      middleware.use(req, res as any, jest.fn());
      expect(res.json).toHaveBeenCalledWith({
        message: expect.stringContaining('บำรุงรักษา'),
        maintenance: true,
        retryAfter: '04:00 BKK',
      });
    });
  });
});
