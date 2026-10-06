import { BadRequestException } from '@nestjs/common';
import { FACEBOOK_PAGE_SUBSCRIBED_FIELDS } from '@installment/shared';
import { DEFAULT_SUBSCRIBED_FIELDS, FacebookAppReviewService } from './facebook-app-review.service';
import type { IntegrationConfigService } from '../integrations/integration-config.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

/**
 * subscribed_apps ของ Meta เขียนทับทั้งชุด ⇒ ทุกเส้นทางที่ยิง endpoint นี้ต้องมี
 * `message_echoes` (ข้อความที่พนักงานตอบจากกล่องข้อความของเพจ — ร่องรอยทางเดียวของการตอบ
 * นอกระบบ) และ `messaging_referrals` (ที่มาโฆษณาของลูกค้าเก่า) เสมอ
 */
describe('FacebookAppReviewService.subscribePageWebhooks — subscribed fields', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  let getConfig: jest.Mock;
  let service: FacebookAppReviewService;
  let subscribedFields: string[];

  beforeEach(() => {
    subscribedFields = [];
    fetchMock = jest.fn().mockImplementation(async (input: string, init: RequestInit) => {
      const url = new URL(input);
      if (init.method === 'POST') return Response.json({ success: true });
      if (url.pathname.endsWith('/debug_token'))
        return Response.json({
          data: {
            is_valid: true,
            app_id: '456',
            profile_id: '123',
            type: 'PAGE',
            expires_at: 0,
            data_access_expires_at: 0,
            scopes: ['pages_manage_metadata'],
          },
        });
      if (url.pathname.endsWith('/me')) return Response.json({ id: '123' });
      return Response.json({ data: [{ id: '456', subscribed_fields: subscribedFields }] });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    getConfig = jest
      .fn()
      .mockResolvedValue({
        pageAccessToken: 'page-token',
        pageId: '123',
        appId: '456',
        appSecret: 'test-secret',
        verifyToken: 'test-verify',
      });
    service = new FacebookAppReviewService({ getConfig } as unknown as IntegrationConfigService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function sentFields(): string {
    const posts = fetchMock.mock.calls.filter(([, init]) => init.method === 'POST');
    expect(posts).toHaveLength(1);
    return new URLSearchParams(String(posts[0][1].body)).get('subscribed_fields')!;
  }

  it('ค่า default มี message_echoes + messaging_referrals และไม่มี feed', () => {
    const fields = DEFAULT_SUBSCRIBED_FIELDS.split(',');
    expect(fields).toEqual(expect.arrayContaining(['message_echoes', 'messaging_referrals']));
    expect(fields).not.toContain('feed');
    // API กับช่องกรอกของหน้าเว็บต้องมาจากแหล่งเดียวกัน
    expect(DEFAULT_SUBSCRIBED_FIELDS).toBe(FACEBOOK_PAGE_SUBSCRIBED_FIELDS.join(','));
  });

  it('ไม่ส่ง fields (smoke script ส่ง {}) → ยิงชุด default ที่มี message_echoes', async () => {
    await service.subscribePageWebhooks({});

    const [url, init] = fetchMock.mock.calls.find(([, options]) => options.method === 'POST') as [
      string,
      RequestInit,
    ];
    expect(new URL(url).pathname).toBe('/v25.0/123/subscribed_apps');
    expect(init.method).toBe('POST');
    expect(sentFields()).toBe(DEFAULT_SUBSCRIBED_FIELDS);
    expect(sentFields().split(',')).toContain('message_echoes');
  });

  it('รายการเก่าที่ขาด message_echoes (ค่าตั้งต้นของหน้าเว็บก่อนแก้) → เติมกลับให้ ไม่ถอดออกจากเพจ', async () => {
    await service.subscribePageWebhooks({
      fields: 'messages,messaging_postbacks,messaging_referrals,message_deliveries,message_reads',
    });

    expect(sentFields()).toBe(DEFAULT_SUBSCRIBED_FIELDS);
  });

  it('รายการสั้นมาก/ว่าง → ชุดบังคับครบเสมอ', async () => {
    await service.subscribePageWebhooks({ fields: '' });
    expect(sentFields()).toBe(DEFAULT_SUBSCRIBED_FIELDS);
  });

  it('ฟิลด์เพิ่มเติมต่อท้ายชุดบังคับ ตัดช่องว่างและตัวซ้ำ', async () => {
    await service.subscribePageWebhooks({ fields: ' messages , feed,messages,,message_echoes ' });

    expect(sentFields()).toBe(`${DEFAULT_SUBSCRIBED_FIELDS},feed`);
  });

  it('preserves feed and custom subscriptions even when the old form submits defaults', async () => {
    subscribedFields = ['feed', 'leadgen'];
    await service.subscribePageWebhooks({});
    expect(sentFields().split(',')).toEqual(
      expect.arrayContaining(['feed', 'leadgen', ...FACEBOOK_PAGE_SUBSCRIBED_FIELDS]),
    );
  });
  it('refuses a write when current subscriptions cannot be read', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { code: 190 } }, { status: 400 }));
    await expect(service.subscribePageWebhooks({})).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(0);
  });
  it('ยังไม่ตั้งค่าเพจ → BadRequest และไม่ยิง Graph API', async () => {
    getConfig.mockResolvedValue({});

    await expect(service.subscribePageWebhooks({})).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
