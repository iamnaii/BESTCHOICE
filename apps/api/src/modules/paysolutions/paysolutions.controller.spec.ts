import { Test, TestingModule } from '@nestjs/testing';
import { createHmac } from 'crypto';
import { PaySolutionsController } from './paysolutions.controller';
import { PaySolutionsService } from './paysolutions.service';
import { WebhookAnomalyService } from '../webhook-security/webhook-anomaly.service';
import { LiffTokenGuard } from '../line-oa/guards/liff-token.guard';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

describe('PaySolutionsController.handleWebhook — HMAC (T6-C12)', () => {
  let controller: PaySolutionsController;
  let paySolutions: {
    verifyWebhookMerchant: jest.Mock;
    handlePaymentCallback: jest.Mock;
  };
  let anomaly: { record: jest.Mock };
  const originalSecret = process.env.PAYSOLUTIONS_WEBHOOK_SECRET;

  const buildReq = (rawBody: Buffer | undefined, ip = '203.0.113.5') => {
    return {
      ip,
      rawBody,
      headers: { 'user-agent': 'paysolutions-webhook/1.0' },
    } as unknown as import('express').Request;
  };

  beforeEach(async () => {
    paySolutions = {
      verifyWebhookMerchant: jest.fn().mockResolvedValue(true),
      handlePaymentCallback: jest.fn().mockResolvedValue(undefined),
    };
    anomaly = { record: jest.fn().mockResolvedValue(undefined) };

    const mod: TestingModule = await Test.createTestingModule({
      controllers: [PaySolutionsController],
      providers: [
        { provide: PaySolutionsService, useValue: paySolutions },
        { provide: WebhookAnomalyService, useValue: anomaly },
      ],
    })
      .overrideGuard(LiffTokenGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = mod.get(PaySolutionsController);
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.PAYSOLUTIONS_WEBHOOK_SECRET;
    else process.env.PAYSOLUTIONS_WEBHOOK_SECRET = originalSecret;
  });

  it('allows webhook when PAYSOLUTIONS_WEBHOOK_SECRET is not set (backward compat)', async () => {
    delete process.env.PAYSOLUTIONS_WEBHOOK_SECRET;
    const body = { merchantid: 'M123', refno: 'R1', result_code: '00' };
    const req = buildReq(Buffer.from(JSON.stringify(body)));

    const result = await controller.handleWebhook(body, req, undefined);

    expect(paySolutions.handlePaymentCallback).toHaveBeenCalledWith(body);
    expect(result).toEqual({ received: true, processed: true });
    expect(anomaly.record).not.toHaveBeenCalled();
  });

  it('allows webhook when HMAC signature is correct', async () => {
    process.env.PAYSOLUTIONS_WEBHOOK_SECRET = 's3cret-k3y';
    const body = { merchantid: 'M123', refno: 'R1', result_code: '00' };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = createHmac('sha256', 's3cret-k3y').update(rawBody).digest('hex');
    const req = buildReq(rawBody);

    const result = await controller.handleWebhook(body, req, signature);

    expect(paySolutions.handlePaymentCallback).toHaveBeenCalledWith(body);
    expect(result).toEqual({ received: true, processed: true });
    expect(anomaly.record).not.toHaveBeenCalled();
  });

  it('rejects webhook + writes anomaly when HMAC signature mismatches', async () => {
    process.env.PAYSOLUTIONS_WEBHOOK_SECRET = 's3cret-k3y';
    const body = { merchantid: 'M123', refno: 'R1', result_code: '00' };
    const rawBody = Buffer.from(JSON.stringify(body));
    const badSig = createHmac('sha256', 'wrong-secret').update(rawBody).digest('hex');
    const req = buildReq(rawBody);

    const result = await controller.handleWebhook(body, req, badSig);

    expect(result).toEqual({ received: true, processed: false });
    expect(paySolutions.handlePaymentCallback).not.toHaveBeenCalled();
    expect(anomaly.record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'paysolutions',
        reason: 'invalid_signature',
        ipAddress: '203.0.113.5',
      }),
    );
  });
});
