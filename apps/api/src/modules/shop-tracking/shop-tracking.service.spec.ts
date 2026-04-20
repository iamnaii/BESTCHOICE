import { Test } from '@nestjs/testing';
import { ShopTrackingService } from './shop-tracking.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ShopTrackingService', () => {
  let service: ShopTrackingService;
  let prisma: { websiteVisit: { create: jest.Mock }; websiteSession: { upsert: jest.Mock } };

  beforeEach(async () => {
    process.env.PII_HASH_SALT = 'test-salt-32-chars-minimum-needed-here';
    prisma = {
      websiteVisit: { create: jest.fn().mockResolvedValue({}) },
      websiteSession: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const module = await Test.createTestingModule({
      providers: [ShopTrackingService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ShopTrackingService);
  });

  afterEach(() => { delete process.env.PII_HASH_SALT; });

  it('hashes IP and records visit', async () => {
    await service.recordVisit({
      sessionId: 'sess-1',
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
      pagePath: '/products',
      referrer: 'https://google.com',
    });
    const call = prisma.websiteVisit.create.mock.calls[0][0];
    expect(call.data.sessionId).toBe('sess-1');
    expect(call.data.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(call.data.ipHash).not.toBe('127.0.0.1');
    expect(call.data.pagePath).toBe('/products');
    expect(call.data.referrer).toBe('https://google.com');
  });

  it('upserts session on visit', async () => {
    await service.recordVisit({
      sessionId: 'sess-1',
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
      pagePath: '/',
    });
    expect(prisma.websiteSession.upsert).toHaveBeenCalled();
    const call = prisma.websiteSession.upsert.mock.calls[0][0];
    expect(call.where.sessionId).toBe('sess-1');
  });

  it('detects mobile device from user agent', async () => {
    await service.recordVisit({
      sessionId: 'sess-1',
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0)',
      pagePath: '/',
    });
    const call = prisma.websiteVisit.create.mock.calls[0][0];
    expect(call.data.device).toBe('mobile');
  });

  it('marks reachedCart when path is /cart', async () => {
    await service.recordVisit({
      sessionId: 'sess-1',
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
      pagePath: '/cart',
    });
    const call = prisma.websiteSession.upsert.mock.calls[0][0];
    expect(call.update.reachedCart).toBe(true);
  });
});
