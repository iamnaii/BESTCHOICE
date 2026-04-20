import { Test } from '@nestjs/testing';
import { ShopAuthSocialService } from './shop-auth-social.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

describe('ShopAuthSocialService', () => {
  let service: ShopAuthSocialService;
  let prisma: any;
  let jwt: any;

  beforeEach(async () => {
    prisma = {
      customer: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
      customerLineLink: { findFirst: jest.fn() },
    };
    jwt = { signAsync: jest.fn().mockResolvedValue('mock-jwt') };
    const module = await Test.createTestingModule({
      providers: [
        ShopAuthSocialService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();
    service = module.get(ShopAuthSocialService);
  });

  describe('handleLineLogin', () => {
    it('finds customer by existing CustomerLineLink', async () => {
      prisma.customerLineLink.findFirst.mockResolvedValue({ customerId: 'c1' });
      prisma.customer.findFirst.mockResolvedValue({ id: 'c1', name: 'Existing' });

      const result = await service.handleLineLogin({
        lineUserId: 'U-line-1',
        displayName: 'Beam',
      });

      expect(result.customer!.id).toBe('c1');
      expect(result.token).toBe('mock-jwt');
    });

    it('returns null customer if no link found (need OTP to bind phone)', async () => {
      prisma.customerLineLink.findFirst.mockResolvedValue(null);

      const result = await service.handleLineLogin({
        lineUserId: 'U-line-new',
        displayName: 'New',
      });

      expect(result.customer).toBeNull();
      expect(result.requiresPhoneBinding).toBe(true);
    });
  });

  describe('handleFacebookLogin', () => {
    it('finds customer by facebookUserId', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'c1', facebookUserId: 'fb-123' });

      const result = await service.handleFacebookLogin({
        facebookUserId: 'fb-123',
        name: 'Pu',
        email: 'pu@example.com',
      });

      expect(result.customer!.id).toBe('c1');
      expect(result.token).toBe('mock-jwt');
    });

    it('returns requiresPhoneBinding when no match', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      const result = await service.handleFacebookLogin({
        facebookUserId: 'fb-new',
        name: 'New',
      });

      expect(result.customer).toBeNull();
      expect(result.requiresPhoneBinding).toBe(true);
    });
  });

  describe('bindPhoneToSocial', () => {
    it('binds Facebook ID to existing customer matched by phone', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'c1', name: 'Beam' });
      prisma.customer.update.mockResolvedValue({ id: 'c1', facebookUserId: 'fb-123' });

      const result = await service.bindPhoneToSocial({
        phone: '0812345678',
        provider: 'FACEBOOK',
        providerUserId: 'fb-123',
      });

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { facebookUserId: 'fb-123' },
      });
      expect(result.customer!.id).toBe('c1');
      expect(result.token).toBe('mock-jwt');
    });
  });
});
