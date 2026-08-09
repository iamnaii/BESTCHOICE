import { Test } from '@nestjs/testing';
import { ShopPublicConfigService } from './shop-public-config.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';

describe('ShopPublicConfigService', () => {
  let service: ShopPublicConfigService;
  const envBackup: Record<string, string | undefined> = {};
  const ENV_KEYS = ['LINE_LOGIN_CHANNEL_ID', 'LINE_LOGIN_CHANNEL_SECRET', 'SHOP_BASE_URL'];

  beforeEach(async () => {
    for (const k of ENV_KEYS) {
      envBackup[k] = process.env[k];
      delete process.env[k];
    }
    const module = await Test.createTestingModule({
      providers: [
        ShopPublicConfigService,
        { provide: IntegrationConfigService, useValue: { getValue: jest.fn() } },
      ],
    }).compile();
    service = module.get(ShopPublicConfigService);
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (envBackup[k] === undefined) delete process.env[k];
      else process.env[k] = envBackup[k];
    }
  });

  describe('getAuthConfig', () => {
    it('reports LINE login disabled when channel env vars are missing', () => {
      expect(service.getAuthConfig()).toEqual({
        lineLoginEnabled: false,
        lineLoginChannelId: null,
        lineLoginRedirectUri: null,
      });
    });

    it('is disabled when the secret is missing even if the id is set', () => {
      process.env.LINE_LOGIN_CHANNEL_ID = '1234567890';
      process.env.SHOP_BASE_URL = 'https://shop.example.com';
      expect(service.getAuthConfig().lineLoginEnabled).toBe(false);
    });

    it('returns channel id + redirect uri when fully configured', () => {
      process.env.LINE_LOGIN_CHANNEL_ID = '1234567890';
      process.env.LINE_LOGIN_CHANNEL_SECRET = 'secret';
      process.env.SHOP_BASE_URL = 'https://shop.example.com/';
      expect(service.getAuthConfig()).toEqual({
        lineLoginEnabled: true,
        lineLoginChannelId: '1234567890',
        // trailing slash on SHOP_BASE_URL must not double up
        lineLoginRedirectUri: 'https://shop.example.com/auth/line-callback',
      });
    });
  });

  describe('getShopConfig', () => {
    const getValue = () =>
      (service as unknown as { integrations: { getValue: jest.Mock } }).integrations.getValue;

    it('ใช้ pageUsername เมื่อเจ้าของกรอกไว้', async () => {
      getValue().mockImplementation((_k: string, f: string) =>
        Promise.resolve(f === 'pageUsername' ? ' bestchoicephone ' : '123456'),
      );
      expect(await service.getShopConfig()).toEqual({ facebookPageHandle: 'bestchoicephone' });
    });

    it('ถอยไปใช้ pageId เมื่อยังไม่ได้กรอก username (m.me รับ id ได้)', async () => {
      getValue().mockImplementation((_k: string, f: string) =>
        Promise.resolve(f === 'pageUsername' ? '' : '123456'),
      );
      expect(await service.getShopConfig()).toEqual({ facebookPageHandle: '123456' });
    });

    it('คืน null เมื่อยังไม่ได้ตั้งค่า Facebook เลย (ปุ่มจะถูกซ่อน)', async () => {
      getValue().mockResolvedValue(undefined);
      expect(await service.getShopConfig()).toEqual({ facebookPageHandle: null });
    });
  });
});
