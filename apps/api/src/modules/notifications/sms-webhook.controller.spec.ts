import { Test, TestingModule } from '@nestjs/testing';
import { SmsWebhookController } from './sms-webhook.controller';
import { NotificationsService } from './notifications.service';
import { WebhookAnomalyService } from '../webhook-security/webhook-anomaly.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

describe('SmsWebhookController — IP allow-list (T6-C10)', () => {
  let controller: SmsWebhookController;
  let notifications: { handleSmsDeliveryReport: jest.Mock };
  let anomaly: { record: jest.Mock };
  const originalEnv = process.env.SMS_WEBHOOK_ALLOWED_IPS;

  const buildRes = () => {
    const res: Record<string, jest.Mock> = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res as unknown as import('express').Response & { status: jest.Mock; json: jest.Mock };
  };

  beforeEach(async () => {
    notifications = { handleSmsDeliveryReport: jest.fn().mockResolvedValue({ ok: true }) };
    anomaly = { record: jest.fn().mockResolvedValue(undefined) };
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [SmsWebhookController],
      providers: [
        { provide: NotificationsService, useValue: notifications },
        { provide: WebhookAnomalyService, useValue: anomaly },
      ],
    }).compile();
    controller = mod.get(SmsWebhookController);
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.SMS_WEBHOOK_ALLOWED_IPS;
    else process.env.SMS_WEBHOOK_ALLOWED_IPS = originalEnv;
  });

  it('allows request when IP is in SMS_WEBHOOK_ALLOWED_IPS', async () => {
    process.env.SMS_WEBHOOK_ALLOWED_IPS = '203.0.113.10,203.0.113.11';
    const req = { ip: '203.0.113.10', headers: { 'user-agent': 'thaibulksms/1.0' } } as unknown as import('express').Request;
    const res = buildRes();

    await controller.handleDeliveryReportPost({ refno: 'abc', status: 'DELIVERED' }, req, res);

    expect(notifications.handleSmsDeliveryReport).toHaveBeenCalledWith({ refno: 'abc', status: 'DELIVERED' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(anomaly.record).not.toHaveBeenCalled();
  });

  it('rejects with 403 + writes WebhookAnomaly when IP is not allow-listed', async () => {
    process.env.SMS_WEBHOOK_ALLOWED_IPS = '203.0.113.10';
    const req = { ip: '198.51.100.99', headers: { 'user-agent': 'curl/7.0' } } as unknown as import('express').Request;
    const res = buildRes();

    await controller.handleDeliveryReportPost({ refno: 'abc' }, req, res);

    expect(notifications.handleSmsDeliveryReport).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(anomaly.record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'sms',
        reason: 'other',
        ipAddress: '198.51.100.99',
        meta: expect.objectContaining({ note: 'ip_not_allowed', method: 'POST' }),
      }),
    );
  });
});
