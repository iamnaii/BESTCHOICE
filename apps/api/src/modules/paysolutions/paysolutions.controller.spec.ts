import { Test, TestingModule } from '@nestjs/testing';
import { createHmac } from 'crypto';
import { PaySolutionsController } from './paysolutions.controller';
import { PaySolutionsService } from './paysolutions.service';
import { WebhookAnomalyService } from '../webhook-security/webhook-anomaly.service';
import { LiffTokenGuard } from '../line-oa/guards/liff-token.guard';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';

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

describe('PaySolutionsController.createPaymentIntent — verified LINE identity', () => {
  let app: INestApplication;
  const createPaymentIntent = jest.fn();
  const body = { contractId: 'synthetic-contract', amount: 1234, lineId: 'contract-owner', installmentNo: 2 };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [PaySolutionsController],
      providers: [
        { provide: PaySolutionsService, useValue: { createPaymentIntent } },
        { provide: WebhookAnomalyService, useValue: { record: jest.fn() } },
      ],
    }).overrideGuard(LiffTokenGuard).useValue({
      // The guard's token exchange is tested separately. This fixture models
      // its verified request identity independently of the untrusted JSON body.
      canActivate: (context) => {
        const req = context.switchToHttp().getRequest();
        req.liffUserId = req.headers['x-test-verified-identity'];
        return true;
      },
    }).compile();
    app = mod.createNestApplication();
    await app.listen(0, '127.0.0.1');
  });
  beforeEach(() => {
    createPaymentIntent.mockReset().mockResolvedValue({ paymentId: 'intent', paymentUrl: 'https://example.invalid/pay', gatewayRef: 'ref' });
  });
  afterAll(async () => { await app?.close(); });

  it('rejects a body LINE ID belonging to someone other than the verified token', async () => {
    await request(app.getHttpServer()).post('/paysolutions/create-intent')
      .set('x-test-verified-identity', 'different-user').send(body).expect(403);
    expect(createPaymentIntent).not.toHaveBeenCalled();
  });

  it('fails closed when no verified LINE identity reaches the controller', async () => {
    await request(app.getHttpServer()).post('/paysolutions/create-intent').send(body).expect(401);
    expect(createPaymentIntent).not.toHaveBeenCalled();
  });

  it('passes the verified customer identity to the existing ownership-checked service', async () => {
    await request(app.getHttpServer()).post('/paysolutions/create-intent')
      .set('x-test-verified-identity', 'contract-owner').send(body).expect(201);
    expect(createPaymentIntent).toHaveBeenCalledWith('synthetic-contract', 1234, undefined, 'contract-owner', 2);
  });
});
