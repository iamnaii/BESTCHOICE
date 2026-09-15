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

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    getConfig = jest.fn().mockResolvedValue({ pageAccessToken: 'page-token', pageId: 'PAGE1' });
    service = new FacebookAppReviewService({ getConfig } as unknown as IntegrationConfigService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function sentFields(): string {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return (JSON.parse(String(init.body)) as { subscribed_fields: string }).subscribed_fields;
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

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v25.0/PAGE1/subscribed_apps');
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

  it('ยังไม่ตั้งค่าเพจ → BadRequest และไม่ยิง Graph API', async () => {
    getConfig.mockResolvedValue({});

    await expect(service.subscribePageWebhooks({})).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
