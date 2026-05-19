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
});
