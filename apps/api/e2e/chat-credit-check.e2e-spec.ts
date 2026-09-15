import {
  Controller,
  Get,
  Param,
  Patch,
  Body,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Readable } from 'stream';
import { randomUUID } from 'crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/modules/storage/storage.service';
import { OcrService } from '../src/modules/ocr/ocr.service';
import { OcrController } from '../src/modules/ocr/ocr.controller';
import { RoomCreditService } from '../src/modules/credit-check/services/room-credit.service';
import { RoomCreditController } from '../src/modules/staff-chat/room-credit.controller';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { RoomManagerService } from '../src/modules/chat-engine/services/room-manager.service';
import { CreditCheckCrudService } from '../src/modules/credit-check/services/credit-check-crud.service';
import { CreditCheckRiskService } from '../src/modules/credit-check/services/credit-check-risk.service';
import { visibleContractCredit } from '../src/modules/credit-check/services/room-credit-access';
import { CustomerCreditCheckController } from '../src/modules/credit-check/credit-check.controller';
import { CreditCheckService } from '../src/modules/credit-check/credit-check.service';
import { JourneyEntryWriter } from '../src/modules/customer-journey/journey-entry-writer.service';
import { IntegrationConfigService } from '../src/modules/integrations/integration-config.service';
import { AiUsageService } from '../src/modules/ai-usage/ai-usage.service';
import { AiProviderService } from '../src/modules/ai-usage/ai-provider.service';
import { ConfigService } from '@nestjs/config';
import { linkRoomCreditHistory } from '../src/modules/credit-check/services/room-credit-history';

// This suite only accepts the disposable database created by tools/test-chat-credit.sh.
if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) {
  throw new Error(
    'Run tools/test-chat-credit.sh: this suite refuses any shared or production database',
  );
}

const db = new PrismaService();
const roomManager = Object.assign(Object.create(RoomManagerService.prototype), {
  prisma: db,
}) as RoomManagerService;
const linkRoom = (roomId: string, customerId: string) =>
  roomManager.linkCustomer(roomId, customerId, { id: 'test-owner', role: 'OWNER' });
const list = new CreditCheckCrudService(db, new CreditCheckRiskService(db));
const stored = new Map<string, Buffer>();
const storage = {
  configured: true,
  upload: jest.fn(async (key: string, bytes: Buffer) => {
    stored.set(key, bytes);
    return key;
  }),
  getStream: jest.fn(async (key: string) => {
    const bytes = stored.get(key);
    if (!bytes) throw new Error('Missing test file');
    return Readable.from([bytes]);
  }),
  delete: jest.fn(async (key: string) => {
    stored.delete(key);
  }),
};
const ocr = { analyzeBankStatement: jest.fn() };
const result = {
  accountName: 'TEST ACCOUNT',
  bankName: 'TEST BANK',
  monthlyIncome: 10000,
  monthlyExpense: 5000,
  affordablePayment: 3000,
  totalIncome: 10000,
  totalExpense: 5000,
  balance: 1000,
  dateRange: 'มกราคม 2569',
  confidence: 0.9,
};

@Controller()
class CreditTestIntegrationController {
  @Patch('staff-chat/rooms/:id/customer')
  link(@Param('id') id: string, @Body('customerId') customerId: string) {
    return linkRoom(id, customerId);
  }
  @Get('credit-checks')
  list() {
    return list.findAll({ status: 'MANUAL_REVIEW' });
  }
}

describe('chat credit with real PostgreSQL, HTTP and synthetic storage/OCR', () => {
  let app: INestApplication;
  let creditService: CreditCheckService;
  let roomId: string;
  let customerId: string;
  let userId: string;
  let ownerId: string;
  let httpRole = 'SALES';
  let pdf: Buffer;
  beforeAll(async () => {
    await db.$connect();
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    doc.addPage().drawText('SYNTHETIC STATEMENT - Income 10000, Expense 5000 - January 2026');
    pdf = Buffer.from(await doc.save());
    userId = (
      await db.user.create({
        data: {
          email: `${randomUUID()}@test.invalid`,
          password: 'unused',
          name: 'TEST STAFF',
          role: 'SALES',
        },
      })
    ).id;
    customerId = (
      await db.customer.create({ data: { name: 'TEST CUSTOMER', phone: '0000000000' } })
    ).id;
    ownerId = (
      await db.user.create({
        data: {
          email: `${randomUUID()}@test.invalid`,
          password: 'unused',
          name: 'TEST OWNER',
          role: 'OWNER',
        },
      })
    ).id;
    const config = new ConfigService({});
    creditService = new CreditCheckService(
      db,
      new IntegrationConfigService(db, config),
      new AiProviderService(new AiUsageService(db, config)),
    );
    const module = await Test.createTestingModule({
      controllers: [
        RoomCreditController,
        OcrController,
        CreditTestIntegrationController,
        CustomerCreditCheckController,
      ],
      providers: [
        RoomCreditService,
        { provide: PrismaService, useValue: db },
        { provide: StorageService, useValue: storage },
        { provide: OcrService, useValue: ocr },
        { provide: CreditCheckService, useValue: creditService },
        { provide: JourneyEntryWriter, useValue: { recordAfterCommit: async () => undefined, recordInTx: async () => undefined } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: { switchToHttp(): { getRequest(): { user: unknown } } }) => {
          context.switchToHttp().getRequest().user = {
            id: httpRole === 'OWNER' ? ownerId : userId,
            role: httpRole,
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    if (app) await app.close();
    await db.$disconnect();
  });
  beforeEach(async () => {
    httpRole = 'SALES';
    roomId = (
      await db.chatRoom.create({
        data: { channel: 'FACEBOOK', displayName: 'TEST CHAT', assignedToId: userId },
      })
    ).id;
    ocr.analyzeBankStatement.mockReset().mockResolvedValue(result);
  });
  const upload = (room: string) =>
    request(app.getHttpServer())
      .post(`/api/staff-chat/rooms/${room}/credit-check/files`)
      .attach('file', pdf, { filename: 'สเตทเม้น.pdf', contentType: 'application/pdf' });

  it('links two rooms to the same customer concurrently without upgrading conflicting FK locks', async () => {
    const customer = await db.customer.create({ data: { name: 'TEST CONCURRENT LINKS', phone: '0000000000' } });
    const rooms = await Promise.all([1, 2].map(async n => {
      const room = await db.chatRoom.create({ data: { channel: 'FACEBOOK', displayName: `TEST LINK ${n}` } });
      await db.roomCreditAnalysis.create({ data: { roomId: room.id, status: 'COMPLETED', fileIds: [], result } });
      return room;
    }));
    let entered = 0;
    let release!: () => void;
    const bothForeignKeys = new Promise<void>(done => { release = done; });
    const outcomes = await Promise.allSettled(rooms.map(room => db.$transaction(async tx => {
      await tx.chatRoom.update({ where: { id: room.id }, data: { customerId: customer.id } });
      await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customer.id} FOR KEY SHARE`;
      if (++entered === 2) release();
      await bothForeignKeys;
      await linkRoomCreditHistory(tx, room.id, customer.id);
    }, { timeout: 10000 })));
    expect(outcomes.map(outcome => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await db.creditCheck.count({ where: { customerId: customer.id } })).toBe(2);
  });

  it('rejects approving an older result while the newest FULL awaits review', async () => {
    const customer = await db.customer.create({ data: { name: 'TEST LATEST DECISION', phone: '0000000000' } });
    for (const day of [1, 2]) {
      const room = await db.chatRoom.create({ data: { channel: 'FACEBOOK', displayName: `TEST HISTORY ${day}` } });
      await db.roomCreditAnalysis.create({ data: { roomId: room.id, status: 'COMPLETED', fileIds: [], result, createdAt: new Date(`2026-01-0${day}`) } });
      await linkRoom(room.id, customer.id);
    }
    const [latest, older] = await list.findByCustomer(customer.id);
    httpRole = 'OWNER';
    await request(app.getHttpServer()).post(`/api/customers/${customer.id}/credit-check/${older.id}/override`).send({ status: 'APPROVED', overrideReason: 'พิจารณาประวัติใบเก่า โดยใบล่าสุดยังรอผู้จัดการตรวจ', attachmentIds: [], affordability: { verifiedMonthlyIncome: 10000, livingExpenses: 5000, externalMonthlyDebt: 0, salaryPayDay: 25, evidenceNotes: 'ตรวจสอบรายได้ รายจ่าย หนี้ และวันรับเงินจากหลักฐานครบ', approvedMonthlyPayment: 2000, confirmed: true, contextToken: '0'.repeat(64) } }).expect(409);
    expect((await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).creditCheckStatus).toBe('UNDER_REVIEW');
    expect((await list.findLatestByCustomer(customer.id))?.id).toBe(latest.id);
  });

  it('stores two files without a customer; analyzes once and enters the existing queue on linking exactly once', async () => {
    const first = await upload(roomId).expect(201);
    const second = await upload(roomId).expect(201);
    expect(ocr.analyzeBankStatement).not.toHaveBeenCalled();
    const analysis = await request(app.getHttpServer())
      .post('/api/ocr/bank-statement')
      .send({ roomId, fileIds: [first.body.id, second.body.id] })
      .expect(201);
    expect(analysis.body.analysis.result).toMatchObject({ affordablePayment: 3000 });
    expect(analysis.body.analysis.result.confidence).toBeUndefined();
    expect(ocr.analyzeBankStatement).toHaveBeenCalledTimes(1);
    expect(ocr.analyzeBankStatement.mock.calls[0][0]).toHaveLength(2);
    expect(await db.creditCheck.count({ where: { customerId } })).toBe(0);
    await Promise.all([linkRoom(roomId, customerId), linkRoom(roomId, customerId)]);
    const history = await list.findByCustomer(customerId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: 'MANUAL_REVIEW', aiScore: null });
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: customerId } })).creditCheckStatus,
    ).toBe('UNDER_REVIEW');
    const queue = await list.findAll({ status: 'MANUAL_REVIEW' });
    expect(queue.data.some((check) => check.id === history[0].id)).toBe(true);
    const download = await request(app.getHttpServer())
      .get(first.body.url.startsWith('/api') ? first.body.url : `/api${first.body.url}`)
      .expect(200);
    expect(download.headers['content-type']).toContain('application/pdf');
    expect(download.body).toEqual(pdf);
  });

  it('approves an imported result through the real controller, keeps its snapshot, and preserves the decision on relinking or older imports', async () => {
    const customer = await db.customer.create({
      data: { name: 'TEST APPROVAL', phone: '0000000000' },
    });
    const file = await upload(roomId).expect(201);
    await request(app.getHttpServer())
      .post('/api/ocr/bank-statement')
      .send({ roomId, fileIds: [file.body.id] })
      .expect(201);
    await linkRoom(roomId, customer.id);
    const original = (await list.findByCustomer(customer.id))[0];
    const endpoint = `/api/customers/${customer.id}/credit-check/${original.id}/override`;
    const basis = { verifiedMonthlyIncome: 10000, livingExpenses: 5000, externalMonthlyDebt: 0, salaryPayDay: 25, evidenceNotes: 'ตรวจสอบรายได้ รายจ่าย หนี้ และวันรับเงินจากหลักฐานครบ' };
    const preview = await creditService.override_.approval.preview(original.id, basis, { id: ownerId, role: 'OWNER' });
    const decision = {
      affordability: { ...basis, approvedMonthlyPayment: 2000, confirmed: true, contextToken: preview.contextToken },
      status: 'APPROVED',
      overrideReason: 'ตรวจสอบตัวเลขและเอกสารตัวอย่างครบถ้วนแล้ว',
      attachmentIds: [],
    };
    await request(app.getHttpServer()).post(endpoint).send(decision).expect(403);
    httpRole = 'OWNER';
    await request(app.getHttpServer()).post(endpoint).send(decision).expect(201);
    const approved = (
      await request(app.getHttpServer())
        .get(`/api/customers/${customer.id}/credit-check`)
        .expect(200)
    ).body[0];
    expect(approved).toMatchObject({
      status: 'APPROVED',
      aiScore: null,
      aiAnalysis: original.aiAnalysis,
      statementFiles: original.statementFiles,
    });
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).creditCheckStatus,
    ).toBe('FULL_CHECK_PASSED');
    expect(
      await db.auditLog.count({
        where: { entityId: original.id, action: 'CREDIT_CHECK_OVERRIDE' },
      }),
    ).toBe(1);
    await linkRoom(roomId, customer.id);
    const oldRoom = await db.chatRoom.create({
      data: { channel: 'FACEBOOK', displayName: 'TEST OLD HISTORY', assignedToId: userId },
    });
    await db.roomCreditAnalysis.create({
      data: {
        roomId: oldRoom.id,
        status: 'COMPLETED',
        fileIds: [],
        result,
        createdAt: new Date('2025-01-01'),
      },
    });
    await linkRoom(oldRoom.id, customer.id);
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).creditCheckStatus,
    ).toBe('FULL_CHECK_PASSED');
    expect((await list.findLatestByCustomer(customer.id))?.id).toBe(original.id);
    expect(await db.creditCheck.count({ where: { customerId: customer.id } })).toBe(2);
  });

  it('links while OCR is running and preserves exactly one completed result', async () => {
    const file = await upload(roomId).expect(201);
    let release!: (value: typeof result) => void;
    let entered!: () => void;
    const started = new Promise<void>((done) => {
      entered = done;
    });
    ocr.analyzeBankStatement.mockImplementation(() => {
      entered();
      return new Promise((done) => {
        release = done;
      });
    });
    const pending = request(app.getHttpServer())
      .post('/api/ocr/bank-statement')
      .send({ roomId, fileIds: [file.body.id] })
      .then((response) => response);
    await started;
    await linkRoom(roomId, customerId);
    await request(app.getHttpServer())
      .post('/api/ocr/bank-statement')
      .send({ roomId, fileIds: [file.body.id] })
      .expect(409);
    release(result);
    expect((await pending).status).toBe(201);
    expect(
      await db.roomCreditAnalysis.count({ where: { roomId, creditCheckId: { not: null } } }),
    ).toBe(1);
  });

  it('rejects cross-room access and encrypted PDF at the actual HTTP boundary', async () => {
    const other = await db.user.create({
      data: { email: `${randomUUID()}@test.invalid`, password: 'unused', name: 'OTHER STAFF' },
    });
    await db.chatRoom.update({ where: { id: roomId }, data: { assignedToId: other.id } });
    await upload(roomId).expect(403);
    await request(app.getHttpServer())
      .get(`/api/staff-chat/rooms/${roomId}/credit-check`)
      .expect(403);
    await db.chatRoom.update({ where: { id: roomId }, data: { assignedToId: userId } });
    const response = await request(app.getHttpServer())
      .post(`/api/staff-chat/rooms/${roomId}/credit-check/files`)
      .attach('file', Buffer.from('%PDF-1.7\ntrailer << /Encrypt 1 0 R >>'), {
        filename: 'locked.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);
    expect(response.body.message).toContain('ไฟล์นี้ล็อกรหัส');
    expect(await db.roomCreditFile.count({ where: { roomId } })).toBe(0);
  });

  it('keeps chat result history within the existing room access rules after linking', async () => {
    const file = await upload(roomId).expect(201);
    await request(app.getHttpServer())
      .post('/api/ocr/bank-statement')
      .send({ roomId, fileIds: [file.body.id] })
      .expect(201);
    const customer = await db.customer.create({
      data: { name: 'TEST PRIVATE HISTORY', phone: '0000000000' },
    });
    await linkRoom(roomId, customer.id);
    const outsider = { id: randomUUID(), role: 'SALES' };
    const rows = await list.findByCustomer(customer.id, outsider);
    expect(rows).toEqual([]);
    const latest = await list.findLatestByCustomer(customer.id, outsider);
    expect(latest).toBeNull();
    const queue = await list.findAll({}, outsider);
    expect(queue.data.some((row) => row.customerId === customer.id)).toBe(false);
    const ownActor = { id: userId, role: 'SALES' };
    const ownRows = await list.findByCustomer(customer.id, ownActor);
    expect(ownRows).toHaveLength(1);
    expect(await list.findByCustomer(customer.id, { id: userId, role: 'ACCOUNTANT' })).toEqual([]);
    expect(
      (await visibleContractCredit(db, { creditCheck: ownRows[0] }, outsider)).creditCheck,
    ).toBeNull();
    expect(
      (await visibleContractCredit(db, { creditCheck: ownRows[0] }, ownActor)).creditCheck,
    ).toEqual(ownRows[0]);
    await db.chatRoom.update({ where: { id: roomId }, data: { assignedToId: null } });
    expect(await list.findByCustomer(customer.id, outsider)).toHaveLength(1);
  });

  it('renders the actual inbox in Chromium, uploads, analyzes, and shows the linked result in /credit-checks', async () => {
    if (!process.env.CREDIT_WEB_URL)
      throw new Error('CREDIT_WEB_URL is required for browser verification');
    const { chromium, expect: browserExpect } = await import('@playwright/test');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1500, height: 1000 },
      hasTouch: true,
    });
    const page = await context.newPage();
    const otherRoom = await db.chatRoom.create({
      data: { channel: 'FACEBOOK', displayName: 'TEST SECOND ROOM', assignedToId: userId },
    });
    const sourceKey = `staff-chat/test-${randomUUID()}.pdf`;
    stored.set(sourceKey, pdf);
    const sourceMessage = await db.chatMessage.create({
      data: {
        roomId,
        role: 'CUSTOMER',
        type: 'FILE',
        text: 'statement-from-chat.pdf',
        mediaUrl: sourceKey,
        mediaType: 'application/pdf',
      },
    });
    let outboundSends = 0;
    let holdAttachment: Promise<void> | null = null;
    let attachmentEntered: (() => void) | null = null;
    const pageErrors: string[] = [];
    const browserConsole: string[] = [];
    page.on('console', (entry) => {
      if (entry.type() === 'error') browserConsole.push(entry.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const apiOrigin = await app.getUrl();
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/api/')) {
        const path = url.pathname.replace(/^\/api(?:\/admin)?/, '');
        if (
          /^\/staff-chat\/rooms\/[^/]+\/credit-check/.test(path) ||
          path === '/ocr/bank-statement' ||
          path === '/credit-checks'
        ) {
          const delayedAttachment = path.endsWith('/credit-check/messages')
            && route.request().method() === 'POST' ? holdAttachment : null;
          const response = await route.fetch({ url: `${apiOrigin}/api${path}${url.search}` });
          if (delayedAttachment) {
            expect(response.ok()).toBe(true);
            attachmentEntered?.();
            // Delay delivery to the client after real HTTP completes. This tests
            // late success after navigation without deferring context cookie lookup.
            await delayedAttachment;
          }
          return route.fulfill({ response });
        }
        if (path === '/auth/me')
          return route.fulfill({
            json: {
              id: userId,
              role: 'OWNER',
              name: 'TEST STAFF',
              accessibleCompanies: ['SHOP', 'FINANCE'],
            },
          });
        if (
          path === `/staff-chat/rooms/${roomId}` ||
          path === `/staff-chat/rooms/${otherRoom.id}`
        ) {
          const room = await db.chatRoom.findUnique({
            where: { id: path.split('/').pop() },
            include: { customer: true },
          });
          return route.fulfill({ json: { ...room, tags: [], notes: [] } });
        }
        if (/^\/staff-chat\/rooms\/[^/]+\/messages$/.test(path)) {
          if (route.request().method() === 'POST') outboundSends++;
          return route.fulfill({
            json: await db.chatMessage.findMany({
              where: { roomId: path.split('/')[3] },
              orderBy: { createdAt: 'asc' },
            }),
          });
        }
        if (path === '/staff-chat/rooms')
          return route.fulfill({
            json: {
              data: await db.chatRoom.findMany({ where: { id: { in: [roomId, otherRoom.id] } } }),
              total: 2,
              page: 1,
              totalPages: 1,
            },
          });
        if (path === '/staff-chat/rooms/counts') return route.fulfill({ json: {} });
        if (path === '/staff-chat/ai/settings') return route.fulfill({ json: {} });
        if (path.endsWith('/suggest'))
          return route.fulfill({
            json: { suggestions: [], detectedProducts: [], processingTimeMs: 0 },
          });
        if (path === '/todos') return route.fulfill({ json: { data: [] } });
        return route.fulfill({ json: [] });
      }
      if (url.origin === process.env.CREDIT_WEB_URL) return route.continue();
      return route.abort();
    });
    try {
      await page.goto(`${process.env.CREDIT_WEB_URL}/inbox/${roomId}`);
      await browserExpect(
        page.getByRole('heading', { name: 'ตรวจเครดิต', exact: true }),
      ).toBeVisible({ timeout: 30000 });
      const dossier = page.getByRole('complementary', { name: 'ข้อมูลลูกค้า' });
      const externalFile = await page.evaluateHandle(() => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(['test'], 'test.pdf', { type: 'application/pdf' }));
        return transfer;
      });
      const chat = page.getByRole('log', { name: 'ประวัติข้อความ' }).locator('..');
      await chat.dispatchEvent('dragenter', { dataTransfer: externalFile });
      await browserExpect(
        page.getByText('วางที่นี่ = ส่งให้ลูกค้า', { exact: true }),
      ).toBeVisible();
      await browserExpect(page.getByText('ลูกค้าเห็นทันที', { exact: true })).toBeVisible();
      await chat.dispatchEvent('dragleave', { dataTransfer: externalFile });
      await dossier.dispatchEvent('dragenter', { dataTransfer: externalFile });
      await browserExpect(
        page.getByText('วางที่นี่ = ให้ AI ตรวจเครดิต', { exact: true }),
      ).toBeVisible();
      await browserExpect(page.getByText('ลูกค้าไม่เห็น', { exact: true })).toBeVisible();
      await dossier.dispatchEvent('dragleave', { dataTransfer: externalFile });
      await page
        .locator('[draggable="true"]')
        .filter({ hasText: 'statement-from-chat.pdf' })
        .dragTo(dossier);
      await browserExpect(
        page.getByRole('button', { name: 'เอาออกจากการตรวจเครดิต', exact: true }),
      ).toBeEnabled();
      expect(
        await db.roomCreditFile.count({
          where: { roomId, sourceMessageId: sourceMessage.id, deletedAt: null },
        }),
      ).toBe(1);
      await page
        .getByLabel('เลือกสเตทเม้นเพื่อตรวจเครดิต')
        .setInputFiles(
          { name: 'statement.pdf', mimeType: 'application/pdf', buffer: pdf },
          { timeout: 5000 },
        );
      await browserExpect(page.getByRole('button', { name: 'AI วิเคราะห์ (2 ไฟล์)' })).toBeEnabled({
        timeout: 10000,
      });
      expect(ocr.analyzeBankStatement).not.toHaveBeenCalled();
      await page.getByRole('button', { name: 'AI วิเคราะห์ (2 ไฟล์)' }).click();
      await browserExpect(page.getByText('ผ่อนไหวเดือนละ', { exact: true })).toBeVisible();
      await browserExpect(page.getByText('3,000 บาท', { exact: true })).toBeVisible();
      await page.screenshot({
        path: '../../docs/review/2026-09-07-chat-credit-desktop.png',
        fullPage: true,
      });
      // Touch button stays usable; an attachment finishing after navigation opens its source room.
      await page.setViewportSize({ width: 390, height: 844 });
      const removeBubble = page.getByRole('button', {
        name: 'เอาออกจากการตรวจเครดิต',
        exact: true,
      });
      await browserExpect(removeBubble).toHaveCSS('opacity', '1');
      await removeBubble.click();
      const attachBubble = page.getByRole('button', { name: 'แนบเพื่อตรวจเครดิต', exact: true });
      await browserExpect(attachBubble).toBeEnabled();
      let releaseAttachment!: () => void;
      holdAttachment = new Promise<void>((done) => {
        releaseAttachment = done;
      });
      const attachmentStarted = new Promise<void>((done) => {
        attachmentEntered = done;
      });
      await attachBubble.click();
      await attachmentStarted;
      await page.getByRole('button', { name: 'กลับ', exact: true }).click();
      await page.getByText('TEST SECOND ROOM', { exact: true }).click();
      await browserExpect.poll(() => new URL(page.url()).pathname).toBe(`/inbox/${otherRoom.id}`);
      const deliveredAttachment = page.waitForResponse((response) =>
        response.request().method() === 'POST' && response.url().includes('/credit-check/messages'));
      releaseAttachment();
      expect((await deliveredAttachment).ok()).toBe(true);
      await page.getByRole('button', { name: 'เปิดแผง', exact: true }).last().click();
      await browserExpect.poll(() => new URL(page.url()).pathname).toBe(`/inbox/${roomId}`);
      const sheet = page.getByRole('dialog');
      await browserExpect(
        sheet.getByRole('button', { name: 'AI วิเคราะห์ (2 ไฟล์)' }),
      ).toBeEnabled();
      let releaseOcr!: (value: typeof result) => void;
      const ocrStarted = new Promise<void>((entered) => {
        ocr.analyzeBankStatement.mockImplementationOnce(() => {
          entered();
          return new Promise((done) => {
            releaseOcr = done;
          });
        });
      });
      await sheet.getByRole('button', { name: 'AI วิเคราะห์ (2 ไฟล์)' }).click();
      await ocrStarted;
      await browserExpect(
        sheet.getByRole('status').filter({ hasText: 'AI กำลังอ่านสเตทเม้น…' }),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await browserExpect(sheet).not.toBeVisible();
      releaseOcr(result);
      await browserExpect(page.getByText('อ่านสเตทเม้นแล้ว', { exact: true }).last()).toBeVisible();
      await page.getByRole('button', { name: 'ข้อมูลลูกค้า', exact: true }).click();
      await browserExpect(sheet.getByText('3,000 บาท', { exact: true })).toBeVisible();
      await page.screenshot({
        path: '../../docs/review/2026-09-07-chat-credit-mobile.png',
        fullPage: true,
      });
      expect(outboundSends).toBe(0);
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 1500, height: 1000 });
      await linkRoom(roomId, customerId);
      await page.goto(`${process.env.CREDIT_WEB_URL}/credit-checks`);
      await browserExpect(page.getByRole('link', { name: 'เปิดแชทต้นทาง' }).first()).toBeVisible();
      await page.screenshot({
        path: '../../docs/review/2026-09-07-credit-checks-queue.png',
        fullPage: true,
      });
      expect(pageErrors).toEqual([]);
    } catch (error) {
      await page.screenshot({
        path: '../../docs/review/2026-09-07-chat-credit-browser-failure.png',
        fullPage: true,
      });
      console.error(
        'Browser errors:',
        pageErrors,
        browserConsole,
        'URL:',
        page.url(),
        'Page:',
        (await page.locator('body').innerText()).slice(0, 3000),
      );
      throw error;
    } finally {
      await browser.close();
    }
  }, 60000);
});
