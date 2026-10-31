import { Readable } from 'node:stream';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../app.setup';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentsService } from '../contracts/documents.service';
import { LiffTokenGuard } from './guards/liff-token.guard';
import { LiffApiService } from './liff-api.service';
import {
  LIFF_DOWNLOAD_TICKET_INVALID_MESSAGE,
  LiffDownloadController,
} from './liff-download.controller';
import { LiffDownloadTicketService } from './services/liff-download-ticket.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

/**
 * Task 24 (Task 22 review M-5) — Express ส่ง `HEAD` เข้า handler ของ `@Get` ⇒ ตัว preview/prefetch ของ in-app browser (แอป LINE)
 * ที่ยิง HEAD ก่อนเคยเผาตั๋วครั้งเดียว แล้วแท็บจริงได้ 401. ยิงผ่าน HTTP จริง (Express + configureApp) กับ `LiffDownloadTicketService`
 * ตัวจริงบนที่เก็บในหน่วยความจำ — HEAD ต้องไม่แตะตั๋ว (405 + `Allow: GET`) · GET ยังใช้ได้ครั้งเดียว
 */
const LINE = 'U-line-a';
const RECEIPT = '0b9c1a52-2f0c-4b8e-9d55-6f0a8e1d2c3b';
const CONTRACT = '7d4e2a10-1c3b-4f6a-8e2d-9b0c5a1f3e47';
const PDF = '%PDF-1.4 ทดสอบ';

type Row = { id: string; lineUserId: string; hash: string; expiresAt: Date };

describe('LIFF download GET ?dl= over HTTP (HEAD/prefetch ไม่เผาตั๋ว)', () => {
  let app: INestApplication;
  let tickets: LiffDownloadTicketService;
  const rows = new Map<string, Row>();
  const prisma = {
    chatbotOtpRequest: {
      create: jest.fn(async ({ data }: { data: Omit<Row, 'id'> }) => {
        const row = { ...data, id: `r${rows.size + 1}` };
        rows.set(row.lineUserId, row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: { where: { lineUserId: string } }) => {
        return rows.get(where.lineUserId) ?? null;
      }),
      deleteMany: jest.fn(async ({ where }: { where: { id: string } }) => {
        for (const [key, row] of rows) {
          if (row.id === where.id) {
            rows.delete(key);
            return { count: 1 };
          }
        }
        return { count: 0 };
      }),
    },
  };
  const liff = { resolveDownloadDocumentId: jest.fn().mockResolvedValue('edoc-1') };
  const documents = {
    getDocumentStream: jest.fn(async () => ({
      stream: Readable.from([Buffer.from(PDF)]),
      filename: 'ใบเสร็จ.pdf',
      contentType: 'application/pdf',
    })),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [LiffDownloadController],
      providers: [
        LiffDownloadTicketService,
        { provide: PrismaService, useValue: prisma },
        { provide: LiffApiService, useValue: liff },
        { provide: DocumentsService, useValue: documents },
      ],
    })
      .overrideGuard(LiffTokenGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = mod.createNestApplication();
    configureApp(app, { swagger: false });
    await app.init();
    tickets = mod.get(LiffDownloadTicketService);
  });
  afterAll(async () => app?.close());

  beforeEach(() => {
    rows.clear();
    jest.clearAllMocks();
  });

  const receiptUrl = (dl: string) => `/api/line-oa/liff/receipts/${RECEIPT}/download?dl=${dl}`;
  const contractUrl = (dl: string) => `/api/line-oa/liff/contracts/${CONTRACT}/document?dl=${dl}`;

  it('HEAD ก่อน (prefetch) → 405 Allow: GET ไม่แตะตั๋ว · GET ต่อมายังได้ไฟล์', async () => {
    const ticket = await tickets.issue(LINE, 'receipt', RECEIPT);

    const head = await request(app.getHttpServer()).head(receiptUrl(ticket));
    expect(head.status).toBe(405);
    expect(head.headers.allow).toBe('GET');
    expect(prisma.chatbotOtpRequest.findUnique).not.toHaveBeenCalled();
    expect(prisma.chatbotOtpRequest.deleteMany).not.toHaveBeenCalled();
    expect(documents.getDocumentStream).not.toHaveBeenCalled();
    expect(rows.size).toBe(1);

    const get = await request(app.getHttpServer()).get(receiptUrl(ticket)).buffer(true);
    expect(get.status).toBe(200);
    expect(get.headers['content-type']).toContain('application/pdf');
    expect(Buffer.from(get.body as Buffer).toString()).toBe(PDF);
    expect(liff.resolveDownloadDocumentId).toHaveBeenCalledWith(LINE, 'receipt', RECEIPT);
  });

  it('HEAD หลายครั้งบนเส้นสัญญา PDF ก็ไม่แตะตั๋ว', async () => {
    const ticket = await tickets.issue(LINE, 'contract-document', CONTRACT);
    for (let i = 0; i < 3; i++) {
      expect((await request(app.getHttpServer()).head(contractUrl(ticket))).status).toBe(405);
    }
    const get = await request(app.getHttpServer()).get(contractUrl(ticket)).buffer(true);
    expect(get.status).toBe(200);
  });

  it('GET สองครั้ง → ครั้งที่สอง 401 ข้อความไทย (ตั๋วยังใช้ได้ครั้งเดียว)', async () => {
    const ticket = await tickets.issue(LINE, 'receipt', RECEIPT);
    expect((await request(app.getHttpServer()).get(receiptUrl(ticket))).status).toBe(200);
    const second = await request(app.getHttpServer()).get(receiptUrl(ticket));
    expect(second.status).toBe(401);
    expect(JSON.stringify(second.body)).toContain(LIFF_DOWNLOAD_TICKET_INVALID_MESSAGE);
    expect(documents.getDocumentStream).toHaveBeenCalledTimes(1);
  });

  it('HEAD ด้วยตั๋วปลอม → 405 เหมือนกัน (ไม่บอกว่าตั๋วใช้ได้ไหม)', async () => {
    expect((await request(app.getHttpServer()).head(receiptUrl('nope'))).status).toBe(405);
    expect(prisma.chatbotOtpRequest.findUnique).not.toHaveBeenCalled();
  });
});
