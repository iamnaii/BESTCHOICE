import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtStrategy, JwtPayload } from './jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';

describe('JwtStrategy.validate — entity fields (SP7.1)', () => {
  let strategy: JwtStrategy;
  let prismaMock: { user: { findUnique: jest.Mock }; customer: { findFirst: jest.Mock } };

  beforeEach(async () => {
    prismaMock = {
      user: { findUnique: jest.fn() },
      customer: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('test-secret') },
        },
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    strategy = module.get(JwtStrategy);
  });

  it('returns user with accessibleCompanies + primaryCompany from DB', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'owner@test.com',
      name: 'Owner',
      role: 'OWNER',
      branchId: null,
      isActive: true,
      accessibleCompanies: ['SHOP', 'FINANCE'],
      primaryCompany: 'SHOP',
    });

    const payload: JwtPayload = { sub: 'user-1', role: 'OWNER' };
    const user = (await strategy.validate(payload)) as Record<string, unknown>;

    expect(user['accessibleCompanies']).toEqual(['SHOP', 'FINANCE']);
    expect(user['primaryCompany']).toBe('SHOP');
  });

  it('returns SALES user with single-entity access', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-2',
      email: 'sales@test.com',
      name: 'Sales',
      role: 'SALES',
      branchId: 'b1',
      isActive: true,
      accessibleCompanies: ['SHOP'],
      primaryCompany: 'SHOP',
    });

    const payload: JwtPayload = { sub: 'user-2', role: 'SALES' };
    const user = (await strategy.validate(payload)) as Record<string, unknown>;

    expect(user['accessibleCompanies']).toEqual(['SHOP']);
  });

  /**
   * 2026-09-08: คอลัมน์ accessible_companies เป็น String[] @default([]) ที่ไม่เคยมีใครเขียน
   * ⇒ ทุกแถวบน prod เป็น array ว่าง แล้วฝั่งเว็บ/guard ตีความว่า "ไม่มีสิทธิ์บริษัทใดเลย"
   * จนล็อกทุกคนออกจากระบบ กติกาใหม่คือ array ว่าง = "ยังไม่ตั้งค่า" → ใช้ค่า default ของ role
   * และต้องเกิดที่นี่จุดเดียว เพื่อให้ผู้อ่าน req.user ทุกตัวได้ค่าที่ไม่มีวันว่าง
   */
  describe('company access fallback', () => {
    const dbUser = (over: Record<string, unknown>) => ({
      id: 'user-x',
      email: 'x@test.com',
      name: 'X',
      branchId: null,
      isActive: true,
      primaryCompany: null,
      ...over,
    });

    it('เติมค่า default ของ role ให้แถวที่ยังไม่ backfill (SALES + array ว่าง)', async () => {
      prismaMock.user.findUnique.mockResolvedValue(
        dbUser({ role: 'SALES', accessibleCompanies: [] }),
      );

      const user = (await strategy.validate({ sub: 'user-x', role: 'SALES' })) as Record<
        string,
        unknown
      >;

      expect(user['accessibleCompanies']).toEqual(['SHOP']);
      expect(user['primaryCompany']).toBe('SHOP');
    });

    it('FINANCE_MANAGER + array ว่าง ได้ทั้งสองบริษัท และ primary = FINANCE', async () => {
      prismaMock.user.findUnique.mockResolvedValue(
        dbUser({ role: 'FINANCE_MANAGER', accessibleCompanies: [] }),
      );

      const user = (await strategy.validate({ sub: 'user-x', role: 'FINANCE_MANAGER' })) as Record<
        string,
        unknown
      >;

      expect(user['accessibleCompanies']).toEqual(['SHOP', 'FINANCE']);
      expect(user['primaryCompany']).toBe('FINANCE');
    });

    // กัน regress: e2e เชิงลบพึ่งพฤติกรรมนี้ (OWNER ที่ถูกจำกัดเป็น FINANCE ต้องไม่ได้ SHOP คืน)
    it('ไม่ widen ค่าที่ตั้งไว้แล้ว — OWNER ที่มีแค่ FINANCE ยังคงเป็น FINANCE เท่านั้น', async () => {
      prismaMock.user.findUnique.mockResolvedValue(
        dbUser({ role: 'OWNER', accessibleCompanies: ['FINANCE'] }),
      );

      const user = (await strategy.validate({ sub: 'user-x', role: 'OWNER' })) as Record<
        string,
        unknown
      >;

      expect(user['accessibleCompanies']).toEqual(['FINANCE']);
      expect(user['primaryCompany']).toBe('FINANCE');
    });

    // token ฝั่งลูกค้าไม่มีฟิลด์ companies เลย — ถ้าเผลอใส่เข้าไป interceptor/guard
    // จะตีความ customer เป็นพนักงาน
    it('token aud=shop ต้องไม่มี accessibleCompanies ติดออกไปเลย', async () => {
      prismaMock.customer.findFirst.mockResolvedValue({ id: 'cust-1', name: 'ลูกค้า' });

      const result = await strategy.validate({ sub: 'cust-1', role: 'CUSTOMER', aud: 'shop' });

      expect(result).not.toHaveProperty('accessibleCompanies');
      expect(result).not.toHaveProperty('primaryCompany');
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    });
  });
});
