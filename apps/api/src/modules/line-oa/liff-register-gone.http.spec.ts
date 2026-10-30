import { Test } from '@nestjs/testing';
import { ExecutionContext, INestApplication } from '@nestjs/common';
import request from 'supertest';
import { configureApp } from '../../app.setup';
import { LiffApiController } from './liff-api.controller';
import { LiffApiService } from './liff-api.service';
import { PaymentLinkService } from './payment-links/payment-link.service';
import { ContractPaymentService } from '../contracts/contract-payment.service';
import { DocumentsService } from '../contracts/documents.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RichMenuService } from './rich-menu/rich-menu.service';
import { LiffTokenGuard } from './guards/liff-token.guard';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

/**
 * Task 19 — ปิดทางผูก LINE การเงินด้วยเบอร์อย่างเดียว (ไม่มี OTP).
 *
 * `POST liff/register/lookup` เคยคืน `customerId` ของเจ้าของเบอร์ให้ใครก็ได้ที่มี LIFF token
 * และ `POST liff/register/confirm` รับ `customerId` อะไรก็ได้ แล้วเขียน `customers.line_id_finance`
 * ทันที ⇒ ใครรู้เบอร์ (หรือ UUID) ของลูกค้า ผูก LINE ตัวเองแล้วอ่านสัญญา/ยอด/ใบเสร็จของคนอื่นได้.
 * ทางผูกที่ถูกคือ `/liff/finance-verify` (เบอร์ + OTP SMS) — สองเส้นนี้ต้องตอบ 410 โดยไม่แตะข้อมูล.
 *
 * ยิงผ่าน HTTP จริง (global pipe + filter ของ configureApp) เพื่อพิสูจน์ status 410 ที่ client เห็น
 * และให้ LiffApiService ตัวจริงรันบน Prisma mock — ถ้ามีเส้นไหนยังผูกได้ จะเห็นการเขียน customer.
 */
const ATTACKER_LINE = 'U_attacker_line_user';
const VICTIM = {
  id: '6f0f3c3e-1d5a-4a8e-9f61-0c3c5b8d2a11',
  name: 'สมชาย ใจดี',
  phone: '0812345678',
  deletedAt: null,
  lineIdFinance: null,
};
const OTHER_CUSTOMER_ID = '0b7c2c2e-8d1f-4f0e-a2a4-5b1f6f7d9c22';

describe('LIFF register endpoints are gone (HTTP 410, no linking without OTP)', () => {
  let app: INestApplication;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeAll(async () => {
    prisma = {
      customer: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      customerLineLink: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      chatbotOtpRequest: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    const mod = await Test.createTestingModule({
      controllers: [LiffApiController],
      providers: [
        LiffApiService,
        { provide: PrismaService, useValue: prisma },
        { provide: PaymentLinkService, useValue: {} },
        { provide: ContractPaymentService, useValue: {} },
        { provide: DocumentsService, useValue: {} },
        { provide: RichMenuService, useValue: { switchRichMenu: jest.fn() } },
      ],
    })
      .overrideGuard(LiffTokenGuard)
      .useValue({
        // LIFF token ถูกต้อง (LINE รับรอง) แต่ยังไม่เคยยืนยัน OTP — คือผู้โจมตีในเคสนี้
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest().liffUserId = ATTACKER_LINE;
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
    jest.clearAllMocks();
    // สภาพที่ผู้โจมตีต้องการ: LINE นี้ยังไม่ผูกใคร · เบอร์/UUID ของเหยื่อมีอยู่จริง
    prisma.customer.findFirst.mockImplementation(
      async (args: { where?: { lineIdFinance?: string; phone?: unknown } }) =>
        args?.where?.lineIdFinance ? null : VICTIM,
    );
    prisma.customer.findUnique.mockImplementation(async (args: { where: { id: string } }) =>
      args.where.id === VICTIM.id ? VICTIM : { ...VICTIM, id: args.where.id },
    );
    prisma.customer.update.mockResolvedValue({});
    prisma.customerLineLink.findUnique.mockResolvedValue(null);
    prisma.chatbotOtpRequest.findUnique.mockResolvedValue(null);
  });

  const noLinkWritten = () => {
    expect(prisma.customer.update).not.toHaveBeenCalled();
    expect(prisma.customer.updateMany).not.toHaveBeenCalled();
    expect(prisma.customerLineLink.upsert).not.toHaveBeenCalled();
    expect(prisma.customerLineLink.update).not.toHaveBeenCalled();
    expect(prisma.customerLineLink.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  };

  it('(a) confirm without any OTP → 410 with a Thai message and nothing is linked', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/line-oa/liff/register/confirm')
      .send({ customerId: VICTIM.id })
      .expect(410);

    expect(res.body.statusCode).toBe(410);
    expect(String(res.body.message)).toMatch(/OTP/);
    noLinkWritten();
  });

  it('(b) a pending OTP for customer A does not let confirm link customer B (nor A) → 410, nothing linked', async () => {
    // ผู้โจมตีขอ OTP ไปที่เบอร์ของลูกค้า A (ยังไม่ได้กรอกรหัส) แล้วยิง confirm ด้วย UUID ของลูกค้า B
    prisma.chatbotOtpRequest.findUnique.mockResolvedValue({
      id: 'otp-1',
      lineUserId: ATTACKER_LINE,
      customerId: VICTIM.id,
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
    });

    await request(app.getHttpServer())
      .post('/api/line-oa/liff/register/confirm')
      .send({ customerId: OTHER_CUSTOMER_ID })
      .expect(410);
    await request(app.getHttpServer())
      .post('/api/line-oa/liff/register/confirm')
      .send({ customerId: VICTIM.id })
      .expect(410);

    noLinkWritten();
  });

  it('(c) lookup no longer leaks customerId (or the masked name) for a known phone → 410', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/line-oa/liff/register/lookup')
      .send({ phone: VICTIM.phone })
      .expect(410);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain(VICTIM.id);
    expect(body).not.toContain('customerId');
    expect(body).not.toContain('สม***');
    // ไม่ค้นลูกค้าด้วยเบอร์เลย — ไม่มีทางเป็น oracle เบอร์ → ลูกค้า
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
    noLinkWritten();
  });

  it('410 does not depend on the body shape (no validation 400 leaks which fields are expected)', async () => {
    await request(app.getHttpServer())
      .post('/api/line-oa/liff/register/lookup')
      .send({})
      .expect(410);
    await request(app.getHttpServer())
      .post('/api/line-oa/liff/register/confirm')
      .send({})
      .expect(410);
    noLinkWritten();
  });
});
