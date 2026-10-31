import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../app.setup';
import { LiffTokenGuard } from '../line-oa/guards/liff-token.guard';
import { ChatbotFinanceLiffController } from './chatbot-finance-liff.controller';
import { FeedbackService } from './services/feedback.service';
import { VerificationService } from './services/verification.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

/**
 * Task 33 (mockup C1–C3 "ยินยอมตอนผูก") — `POST chatbot/finance/liff/verify-otp` ต้องได้ `consent: true` จากหน้า LIFF
 * (ห้ามเชื่อ client: ตรวจที่ DTO ฝั่ง server) · ไม่มี/false/ค่าอื่นที่ไม่ใช่ boolean `true` = 400 ภาษาไทยที่บอกให้เปิดหน้าใหม่แล้วติ๊กยินยอม
 * (หน้า LIFF รุ่นเก่าที่ค้างในเครื่องลูกค้าไม่ส่งช่องนี้) และ**ไม่แตะ service เลย** (ไม่กิน attempt ของ OTP) ·
 * ยิงผ่าน HTTP จริงด้วย `configureApp` (ValidationPipe ตัวเดียวกับ prod — `enableImplicitConversion` ต้องไม่แปลง `"true"` เป็น true)
 */
const LINE = 'U-consent-line';

describe('POST /api/chatbot/finance/liff/verify-otp — consent (HTTP)', () => {
  let app: INestApplication;
  const verifyOtp = jest.fn();

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [ChatbotFinanceLiffController],
      providers: [
        { provide: VerificationService, useValue: { verifyOtp } },
        { provide: FeedbackService, useValue: {} },
      ],
    })
      .overrideGuard(LiffTokenGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest().liffUserId = LINE;
          return true;
        },
      })
      .compile();
    app = mod.createNestApplication();
    configureApp(app, { swagger: false });
    await app.init();
  });
  afterAll(async () => app?.close());

  beforeEach(() => {
    verifyOtp.mockReset().mockResolvedValue({
      customerId: 'c-1',
      customerName: 'ทดสอบ',
      consentRecordedAt: '2026-10-31T03:00:00.000Z',
    });
  });

  const post = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/chatbot/finance/liff/verify-otp')
      .set('User-Agent', 'jest-agent')
      .send(body);

  const expectConsentRejected = (res: request.Response) => {
    expect(res.status).toBe(400);
    const message = ([] as string[]).concat(res.body.message).join(' ');
    // ชี้ทางของลูกค้าเอง: ปิดหน้านี้ → ทักแชท LINE น้องเบส → การ์ด "เริ่มยืนยันตัวตน" → ติ๊กยินยอม
    expect(message).toContain('ติ๊กยินยอม');
    expect(message).toContain('เริ่มยืนยันตัวตน');
    expect(verifyOtp).not.toHaveBeenCalled();
  };

  it('ไม่มีช่อง consent (หน้า LIFF รุ่นเก่า) → 400 ไทย ไม่เรียก service', async () => {
    expectConsentRejected(await post({ otp: '123456' }));
  });

  it('consent: false → 400', async () => {
    expectConsentRejected(await post({ otp: '123456', consent: false }));
  });

  it('consent ที่ไม่ใช่ boolean true ("true" · 1 · "yes") → 400 — ValidationPipe ไม่แปลงชนิดให้', async () => {
    expectConsentRejected(await post({ otp: '123456', consent: 'true' }));
    expectConsentRejected(await post({ otp: '123456', consent: 1 }));
    expectConsentRejected(await post({ otp: '123456', consent: 'yes' }));
  });

  it('consent: true → ส่งต่อให้ service พร้อมหลักฐาน (IP · user agent) และ LINE จาก token เท่านั้น', async () => {
    const res = await post({ otp: '123456', consent: true, lineUserId: 'U-spoofed' });
    expect(res.status).toBe(200);
    // configureApp ห่อคำตอบเป็น { success, data, timestamp } — liffApi ของเว็บแกะ data ให้
    expect(res.body.data).toEqual({
      customerId: 'c-1',
      customerName: 'ทดสอบ',
      consentRecordedAt: '2026-10-31T03:00:00.000Z',
    });
    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(verifyOtp).toHaveBeenCalledWith({
      lineUserId: LINE,
      otp: '123456',
      consent: { granted: true, ipAddress: expect.any(String), userAgent: 'jest-agent' },
    });
  });
});
