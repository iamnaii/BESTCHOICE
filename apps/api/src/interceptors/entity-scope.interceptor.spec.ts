import { CallHandler, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { of } from 'rxjs';
import { EntityScopeInterceptor } from './entity-scope.interceptor';

/**
 * เคสส่วนใหญ่ในไฟล์นี้ยกมาจาก entity-scope.middleware.spec.ts ที่ถูกลบทิ้ง (ตรรกะย้ายจาก
 * middleware ที่รันก่อน guard — จึงไม่เคยเห็น req.user เลย — มาเป็น interceptor ที่รันหลัง guard)
 * สองเคสเปลี่ยนความหมายโดยตั้งใจ ดูคอมเมนต์กำกับใน it แต่ละตัว
 */
describe('EntityScopeInterceptor', () => {
  let interceptor: EntityScopeInterceptor;

  beforeEach(() => {
    interceptor = new EntityScopeInterceptor();
  });

  const makeCtx = (request: Record<string, unknown>): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  // return type เป็น Record<string, unknown> เพื่อให้อ่าน req.entityScope ที่ interceptor เขียนทีหลังได้
  const mkReq = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    query: {},
    headers: {},
    user: { role: 'OWNER', accessibleCompanies: ['SHOP', 'FINANCE'], primaryCompany: 'SHOP' },
    ...overrides,
  });

  const mkNext = (): CallHandler & { handle: jest.Mock } => ({ handle: jest.fn(() => of(null)) });

  const run = (req: Record<string, unknown>) => {
    const next = mkNext();
    const result = interceptor.intercept(makeCtx(req), next);
    return { next, result };
  };

  describe('เส้นทางที่ต้องปล่อยผ่านโดยไม่ตรวจ', () => {
    it('ไม่มี req.user → ผ่าน (public / @Public / LIFF / webhook)', () => {
      const req = mkReq({ user: undefined, query: { company: 'finance' } });
      const { next } = run(req);
      expect(next.handle).toHaveBeenCalled();
      expect(req.entityScope).toBeUndefined();
    });

    it('token ฝั่งลูกค้า (aud=shop) ขอ ?company=finance → ผ่าน ไม่ throw ไม่เขียน entityScope', () => {
      const req = mkReq({
        user: { aud: 'shop', role: 'CUSTOMER', sub: 'cust-1' },
        query: { company: 'finance' },
      });
      const { next } = run(req);
      expect(next.handle).toHaveBeenCalled();
      expect(req.entityScope).toBeUndefined();
    });

    it('role CUSTOMER (ไม่มี aud) → ผ่าน', () => {
      const req = mkReq({ user: { role: 'CUSTOMER' }, query: { company: 'finance' } });
      const { next } = run(req);
      expect(next.handle).toHaveBeenCalled();
      expect(req.entityScope).toBeUndefined();
    });

    // เคสนี้แทน 'user.primaryCompany when no query/header' ของ middleware เดิม (spec:44-49):
    // จงใจเลิก fallback ไป primaryCompany/SHOP เพื่อไม่ปลุก tax scoping ที่หลับอยู่
    it('ไม่ระบุ company มา → ไม่ตรวจ และไม่เขียน entityScope (คงพฤติกรรม tax เดิม)', () => {
      const req = mkReq({ user: { role: 'SALES', accessibleCompanies: ['SHOP'], primaryCompany: 'SHOP' } });
      const { next } = run(req);
      expect(next.handle).toHaveBeenCalled();
      expect(req.entityScope).toBeUndefined();
    });

    // เดิมชื่อ 'invalid value falls back to primaryCompany' — ตอนนี้ค่าไม่ valid = ถือว่าไม่ได้ระบุ
    it('ค่าที่ไม่ใช่ shop/finance → ถือว่าไม่ได้ระบุ', () => {
      const req = mkReq({ query: { company: 'banana' } });
      const { next } = run(req);
      expect(next.handle).toHaveBeenCalled();
      expect(req.entityScope).toBeUndefined();
    });
  });

  describe('การอ่านค่า company ที่ร้องขอ', () => {
    it('query มาก่อน header', () => {
      const req = mkReq({
        query: { company: 'finance' },
        headers: { 'x-company-scope': 'shop' },
      });
      run(req);
      expect(req.entityScope).toBe('FINANCE');
    });

    it('ใช้ header เมื่อไม่มี query', () => {
      const req = mkReq({ headers: { 'x-company-scope': 'finance' } });
      run(req);
      expect(req.entityScope).toBe('FINANCE');
    });

    it.each(['FINANCE', 'finance', 'Finance'])('case-insensitive: %s', (v) => {
      const req = mkReq({ query: { company: v } });
      run(req);
      expect(req.entityScope).toBe('FINANCE');
    });
  });

  describe('array ว่าง = ยังไม่ backfill → ใช้ค่า default ของ role ห้ามล็อกใครออก', () => {
    it('SALES + [] ขอ ?company=shop → ผ่าน และได้ entityScope SHOP', () => {
      const req = mkReq({
        user: { role: 'SALES', accessibleCompanies: [], primaryCompany: null },
        query: { company: 'shop' },
      });
      const { next } = run(req);
      expect(next.handle).toHaveBeenCalled();
      expect(req.entityScope).toBe('SHOP');
    });

    it('OWNER + [] ขอ ?company=finance → ผ่าน (default ของ OWNER คือทั้งสองบริษัท)', () => {
      const req = mkReq({
        user: { role: 'OWNER', accessibleCompanies: [], primaryCompany: null },
        query: { company: 'finance' },
      });
      run(req);
      expect(req.entityScope).toBe('FINANCE');
    });

    it('SALES + [] ขอ ?company=finance → 403 (fallback ยังบังคับขอบเขตจริง ไม่ใช่เปิดหมด)', () => {
      const req = mkReq({
        user: { role: 'SALES', accessibleCompanies: [], primaryCompany: null },
        query: { company: 'finance' },
      });
      const next = mkNext();
      expect(() => interceptor.intercept(makeCtx(req), next)).toThrow(ForbiddenException);
      expect(next.handle).not.toHaveBeenCalled();
    });
  });

  describe('array ไม่ว่าง = บังคับใช้ตามนั้นเป๊ะ', () => {
    it("user [FINANCE] ขอ ?company=shop → 403 แม้ role default จะมี SHOP", () => {
      const req = mkReq({
        user: { role: 'OWNER', accessibleCompanies: ['FINANCE'], primaryCompany: 'FINANCE' },
        query: { company: 'shop' },
      });
      const next = mkNext();
      expect(() => interceptor.intercept(makeCtx(req), next)).toThrow(ForbiddenException);
      expect(next.handle).not.toHaveBeenCalled();
      expect(req.entityScope).toBeUndefined();
    });

    it("user [SHOP] ขอ ?company=finance → 403", () => {
      const req = mkReq({
        user: { role: 'SALES', accessibleCompanies: ['SHOP'], primaryCompany: 'SHOP' },
        query: { company: 'finance' },
      });
      const next = mkNext();
      expect(() => interceptor.intercept(makeCtx(req), next)).toThrow(ForbiddenException);
      expect(next.handle).not.toHaveBeenCalled();
    });

    it('OWNER ที่มีทั้งสองบริษัท ขอ finance → ผ่าน', () => {
      const req = mkReq({ query: { company: 'finance' } });
      const { next } = run(req);
      expect(next.handle).toHaveBeenCalled();
      expect(req.entityScope).toBe('FINANCE');
    });
  });
});
