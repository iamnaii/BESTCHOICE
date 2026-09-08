import { randomUUID } from 'node:crypto';
import { ContractLifecycleService } from '../../src/modules/contracts/services/contract-lifecycle.service';
import { ContractQueryService } from '../../src/modules/contracts/services/contract-query.service';
import { CreateContractDto } from '../../src/modules/contracts/dto/contract.dto';
import { loadInstallmentConfig } from '../../src/utils/config.util';
/** Isolated manual preview. Never imported by AppModule or deployed with API source. */
import 'reflect-metadata';
import { Body, Controller, Get, Param, Patch, Post, Query, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
import { parse } from 'dotenv';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RoomCreditService } from '../../src/modules/credit-check/services/room-credit.service';
import { RoomCreditController } from '../../src/modules/staff-chat/room-credit.controller';
import { OcrController } from '../../src/modules/ocr/ocr.controller';
import { OcrService } from '../../src/modules/ocr/ocr.service';
import { StorageService } from '../../src/modules/storage/storage.service';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { BranchGuard } from '../../src/modules/auth/guards/branch.guard';
import { RoomManagerService } from '../../src/modules/chat-engine/services/room-manager.service';
import { CreditCheckService } from '../../src/modules/credit-check/credit-check.service';
import {
  CustomerCreditCheckController,
  GlobalCreditCheckController,
} from '../../src/modules/credit-check/credit-check.controller';
import { IntegrationConfigService } from '../../src/modules/integrations/integration-config.service';
import { AiUsageService } from '../../src/modules/ai-usage/ai-usage.service';
import { AiProviderService } from '../../src/modules/ai-usage/ai-provider.service';
import { AiTextService } from '../../src/modules/ai-usage/ai-text.service';
import { RoomAssistanceController } from '../../src/modules/staff-chat/room-assistance.controller';
import { PrepareOfferService } from '../../src/modules/staff-chat/services/prepare-offer.service';
import { RoomAiAccessService } from '../../src/modules/staff-chat/services/room-ai-access.service';
import { SearchProductsTool } from '../../src/modules/sales-bot/tools/search-products.tool';
import { CalculateInstallmentTool } from '../../src/modules/sales-bot/tools/calculate-installment.tool';

const root = process.env.CREDIT_PREVIEW_ROOT!;
if (
  !root?.startsWith('/tmp/bc-chat-credit.') ||
  !process.env.DATABASE_URL?.includes(`/bc_chat_credit_test?host=${root}/socket`)
)
  throw new Error('Isolated preview database required');
const realOcr = process.env.CREDIT_REAL_OCR === '1';
const realStorage = process.env.CREDIT_REAL_STORAGE === '1';
// Load only the requested provider configuration, never an application DATABASE_URL.
if (realOcr || realStorage) {
  const envFile = join(process.env.CREDIT_REPO_ROOT!, 'apps/api/.env');
  const local = existsSync(envFile) ? parse(readFileSync(envFile)) : {};
  for (const key of ['ANTHROPIC_API_KEY', 'GCS_BUCKET', 'GOOGLE_CLOUD_PROJECT']) {
    if (!process.env[key] && local[key]) process.env[key] = local[key];
  }
}
if (realOcr && !process.env.ANTHROPIC_API_KEY)
  throw new Error('ตั้ง ANTHROPIC_API_KEY ใน apps/api/.env ก่อนเปิด CREDIT_REAL_OCR=1');
if (realStorage && !process.env.GCS_BUCKET)
  throw new Error('ตั้ง GCS_BUCKET ก่อนเปิด CREDIT_REAL_STORAGE=1');

const db = new PrismaService();
const config = new ConfigService({});
const integrations = new IntegrationConfigService(db, config);
const usage = new AiUsageService(db, config);
const credits = new CreditCheckService(db, integrations, new AiProviderService(usage));
const contractQuery = new ContractQueryService(db);
const lifecycle = new ContractLifecycleService(db, contractQuery,
  { execute: async () => ({}) } as never, { execute: async () => ({}) } as never,
  { resolveBranchCashAccount: async () => '110101' } as never);
const manager = Object.assign(Object.create(RoomManagerService.prototype), {
  prisma: db,
}) as RoomManagerService;
const sampleResult = {
  accountName: 'บัญชีตัวอย่าง — ผล AI จำลอง',
  bankName: 'ธนาคารตัวอย่าง',
  monthlyIncome: 20000,
  monthlyExpense: 12000,
  affordablePayment: 6000,
  totalIncome: 60000,
  totalExpense: 36000,
  balance: 8000,
  averageBalance: 9500,
  statementMonths: 3,
  dateRange: 'มกราคม–มีนาคม 2569',
  incomeConsistency: 'stable',
  positiveFactors: ['ตัวอย่าง: มีเงินเข้าต่อเนื่อง'],
  riskFactors: ['ข้อมูลจำลองสำหรับตรวจหน้าจอเท่านั้น'],
  confidence: 0.9,
};
const ocr = realOcr
  ? new OcrService(integrations, new AiProviderService(usage))
  : {
      analyzeBankStatement: async () => {
        await new Promise((done) => setTimeout(done, 1800));
        return sampleResult;
      },
    };
function localFile(key: string) {
  const target = resolve(root, 'storage', key);
  if (!target.startsWith(`${resolve(root, 'storage')}/`))
    throw new Error('Invalid local storage key');
  return target;
}
const storage = realStorage
  ? new StorageService(config)
  : {
      configured: true,
      async upload(key: string, bytes: Buffer) {
        const file = localFile(key);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, bytes);
        return key;
      },
      async getStream(key: string) {
        return createReadStream(localFile(key));
      },
      async delete(key: string) {
        await unlink(localFile(key)).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      },
    };
let actor: { id: string; role: string; accessibleCompanies: string[] };
let info: Record<string, unknown>;
let pdf: Buffer;

async function fixture(name: string) {
  const customer = await db.customer.create({
    data: { name: `ลูกค้าทดสอบ ${name}`, phone: '0000000000' },
  });
  const room = await db.chatRoom.create({
    data: { displayName: name, channel: 'FACEBOOK', assignedToId: actor.id },
  });
  await db.chatMessage.create({
    data: {
      roomId: room.id,
      role: 'CUSTOMER',
      type: 'FILE',
      text: 'statement-demo.pdf',
      mediaUrl: 'staff-chat/demo.pdf',
      mediaType: 'application/pdf',
    },
  });
  await db.chatMessage.create({ data: { roomId: room.id, role: 'CUSTOMER', type: 'TEXT', text: 'สนใจ iPhone 15 งบราคาเงินสดไม่เกิน 15000 บาท' } });
  const branch = await db.branch.findFirst({ where: { name: 'LOCAL PREVIEW BRANCH' } }) ||
    await db.branch.create({ data: { name: 'LOCAL PREVIEW BRANCH' } });
  const product = await db.product.create({ data: { name: 'โทรศัพท์ตัวอย่าง Local', brand: 'Apple', model: 'iPhone 15',
    category: 'PHONE_NEW', costPrice: 5000, installmentPrice: 10000, cashPrice: 10000,
    branchId: branch.id, imeiSerial: randomUUID(), status: 'IN_STOCK' } });
  return { roomId: room.id, customerId: customer.id, customerName: customer.name, productId: product.id, branchId: branch.id };
}

@Controller()
class PreviewController {
  @Get('products') async products() {
    const products = await db.product.findMany({ where: { status: 'IN_STOCK', deletedAt: null }, include: { branch: true, prices: true } });
    return { data: products };
  }
  @Get('products/:id') product(@Param('id') id: string) {
    return db.product.findUnique({ where: { id }, include: { branch: true, prices: true } });
  }
  @Get('customers') async customers(@Query('search') search?: string) {
    return { data: await db.customer.findMany({ where: { deletedAt: null, ...(search ? { name: { contains: search } } : {}) } }) };
  }
  @Get('interest-configs/by-category/:category') interest(@Param('category') category: string) {
    return db.interestConfig.findFirst({ where: { productCategories: { has: category as never }, isActive: true } });
  }
  @Get('sales/config') config() { return loadInstallmentConfig(db); }
  @Post('contracts') createContract(@Body() dto: CreateContractDto) { return lifecycle.create(dto, actor.id, actor.role); }
  @Get('contracts/:id') contract(@Param('id') id: string) { return contractQuery.findOne(id); }
  @Get('preview/info') info() {
    return info;
  }
  @Post('preview/fixture') fixture() {
    return fixture(`ทดสอบเบราว์เซอร์ ${Date.now()}`);
  }
  @Get('auth/me') me() {
    return {
      ...actor,
      name: realOcr ? 'LOCAL · AI จริง' : 'LOCAL PREVIEW · AI จำลอง',
      email: 'preview@test.invalid',
      accessibleCompanies: ['SHOP', 'FINANCE'],
      primaryCompany: 'SHOP',
    };
  }
  @Get('staff-chat/rooms') async rooms() {
    const data = await db.chatRoom.findMany({
      where: { deletedAt: null },
      include: { customer: true, assignedTo: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return { data, total: data.length, page: 1, totalPages: 1 };
  }
  @Get('staff-chat/rooms/counts') counts() {
    return {};
  }
  @Get('staff-chat/ai/settings') settings() {
    return {};
  }
  @Get('staff-chat/rooms/:id') async room(@Param('id') id: string) {
    return {
      ...(await db.chatRoom.findUnique({
        where: { id },
        include: { customer: true, assignedTo: { select: { id: true, name: true } } },
      })),
      tags: [],
      notes: [],
    };
  }
  @Get('staff-chat/rooms/:id/messages') messages(@Param('id') roomId: string) {
    return db.chatMessage.findMany({ where: { roomId }, orderBy: { createdAt: 'asc' } });
  }
  @Patch('staff-chat/rooms/:id/customer') link(
    @Param('id') id: string,
    @Body('customerId') customerId: string,
  ) {
    return manager.linkCustomer(id, customerId, actor);
  }
  @Get('customers/search') customers(@Query('q') q = '') {
    return db.customer.findMany({ where: { deletedAt: null, name: { contains: q } } });
  }
  @Get('customers/:id') async customer(@Param('id') id: string) {
    return {
      ...(await db.customer.findUnique({ where: { id } })),
      contracts: [],
      sales: [],
      documents: [],
      references: [],
    };
  }
}

async function main() {
  await db.$connect();
  const user = await db.user.upsert({
    where: { email: 'preview@test.invalid' },
    update: {},
    create: {
      email: 'preview@test.invalid',
      password: 'unused',
      name: 'ผู้ทดสอบ Local',
      role: 'OWNER',
    },
  });
  actor = { id: user.id, role: 'OWNER', accessibleCompanies: ['SHOP', 'FINANCE'] };
  if (!(await db.interestConfig.count({ where: { productCategories: { has: 'PHONE_NEW' }, isActive: true } }))) {
    await db.interestConfig.create({ data: { name: 'LOCAL PREVIEW PLAN', productCategories: ['PHONE_NEW'],
      interestRate: 0.10, minDownPaymentPct: 0.20, storeCommissionPct: 0, vatPct: 0,
      minInstallmentMonths: 6, maxInstallmentMonths: 12, isActive: true } });
  }
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  [
    'SYNTHETIC BANK STATEMENT - LOCAL TEST ONLY',
    'Account: TEST ACCOUNT / Bank: TEST BANK',
    'Period: January 1 - March 31, 2026',
    'January: salary income 20000, expenses 12000',
    'February: salary income 20000, expenses 12000',
    'March: salary income 20000, expenses 12000',
    'Total deposits 60000; total withdrawals 36000',
    'Opening balance 0; closing balance 24000',
  ].forEach((line, index) => page.drawText(line, { x: 35, y: 780 - index * 30, size: 13 }));
  pdf = Buffer.from(await doc.save());
  // Synthetic source message always stays local, including when real storage is selected.
  await mkdir(dirname(localFile('staff-chat/demo.pdf')), { recursive: true });
  await writeFile(localFile('staff-chat/demo.pdf'), pdf);
  const storageForPreview = realStorage
    ? {
        configured: true,
        upload: storage.upload.bind(storage),
        delete: storage.delete.bind(storage),
        getStream: (key: string) =>
          key === 'staff-chat/demo.pdf'
            ? Promise.resolve(createReadStream(localFile(key)))
            : storage.getStream(key),
      }
    : storage;
  let room = await db.chatRoom.findFirst({
    where: { displayName: { startsWith: 'ห้องลองแนบไฟล์' } },
  });
  if (!room) {
    const created = await fixture('ห้องลองแนบไฟล์ · AI จำลอง');
    room = await db.chatRoom.findUniqueOrThrow({ where: { id: created.roomId } });
  }
  let resultRoom = await db.chatRoom.findFirst({
    where: { displayName: { startsWith: 'ห้องตัวอย่างผลวิเคราะห์' } },
  });
  if (!resultRoom) {
    const created = await fixture('ห้องตัวอย่างผลวิเคราะห์ · AI จำลอง');
    resultRoom = await db.chatRoom.update({
      where: { id: created.roomId },
      data: { customerId: created.customerId },
    });
  }
  const module = await Test.createTestingModule({
    controllers: [
      RoomCreditController,
      RoomAssistanceController,
      OcrController,
      CustomerCreditCheckController,
      GlobalCreditCheckController,
      PreviewController,
    ],
    providers: [
      RoomCreditService,
      PrepareOfferService, RoomAiAccessService, SearchProductsTool, CalculateInstallmentTool,
      { provide: AiTextService, useValue: { isAvailable: true, generate: async () => JSON.stringify({
        summary: 'ตัวอย่าง AI จำลอง: สนใจ iPhone 15 งบเงินสด 15,000 บาท', searchQuery: 'iPhone 15', maxPriceThb: 15000,
      }) } },
      { provide: PrismaService, useValue: db },
      { provide: StorageService, useValue: storageForPreview },
      { provide: OcrService, useValue: ocr },
      { provide: CreditCheckService, useValue: credits },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (context: { switchToHttp(): { getRequest(): { user: unknown } } }) => {
        context.switchToHttp().getRequest().user = actor;
        return true;
      },
    })
    .overrideGuard(BranchGuard)
    .useValue({ canActivate: () => true })
    .compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.use((req, res, next) => {
    req.url = req.url.replace(/^\/api\/admin(?=\/|$)/, '/api');
    const path = req.path;
    if (path.endsWith('/suggest'))
      return res.json({ suggestions: [], detectedProducts: [], processingTimeMs: 0 });
    if (path.endsWith('/chat-summary'))
      return res.json({
        activeContracts: [],
        recentPayments: [],
        callLogs: [],
        totalOutstanding: '0',
      });
    if (path.endsWith('/risk-flag')) return res.json({ riskLevel: 'LOW', overdueContracts: [] });
    if (path.endsWith('/tier'))
      return res.json({
        tier: 'NEW',
        reasons: [],
        history: {
          totalContracts: 0,
          closedContracts: 0,
          activeContracts: 0,
          onTimePaymentPct: 0,
          onTimePayments: 0,
          latePayments: 0,
          maxOverdueDays: 0,
          currentOutstanding: 0,
          hasBadDebt: false,
          hasRepossession: false,
        },
      });
    if (path.endsWith('/points'))
      return res.json({ balance: 0, lifetimeEarned: 0, lifetimeRedeemed: 0, referralCount: 0 });
    if (path.startsWith('/api/loyalty/referral-stats/'))
      return res.json({
        totalReferrals: 0,
        referralsWithContract: 0,
        totalPointsFromReferrals: 0,
        referrals: [],
      });
    if (
      path === '/api/todos' ||
      path === '/api/audit/logs' ||
      /^\/api\/loyalty\/[^/]+\/history$/.test(path)
    )
      return res.json({ data: [], total: 0 });
    if (
      /^\/api\/(preview|auth\/me|credit-checks|ocr\/bank-statement|products|contracts|interest-configs|sales\/config)/.test(path) || path === '/api/customers' ||
      /^\/api\/customers\/(search|[^/]+(?:\/credit-check.*)?)$/.test(path) ||
      /^\/api\/staff-chat\/rooms(?:\/(counts|[^/]+(?:\/(messages|customer|prepare-offer|credit-check.*))?))?$/.test(
        path,
      ) ||
      path === '/api/staff-chat/ai/settings'
    )
      return next();
    if (req.method === 'GET') return res.json([]);
    return res.status(400).json({ message: 'โหมด local นี้เปิดให้ทดสอบเฉพาะการตรวจเครดิต' });
  });
  await app.listen(0, '127.0.0.1');
  const credit = app.get(RoomCreditService);
  if (!realOcr && !(await db.roomCreditAnalysis.count({ where: { roomId: resultRoom.id } }))) {
    const file = await credit.upload(
      resultRoom.id,
      { buffer: pdf, mimetype: 'application/pdf' } as Express.Multer.File,
      actor,
    );
    await credit.analyze(resultRoom.id, [file.id], actor);
  }
  const apiOrigin = await app.getUrl();
  const vite = spawn(
    process.execPath,
    [join(process.env.CREDIT_REPO_ROOT!, 'tools/preview-chat-credit-vite.mjs')],
    {
      env: { ...process.env, CREDIT_API_ORIGIN: apiOrigin },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    },
  );
  let stopping = false;
  const stop = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    if (vite.pid && vite.exitCode === null && vite.signalCode === null) {
      const exited = new Promise<void>(resolve => vite.once('exit', () => resolve()));
      vite.kill('SIGTERM');
      await exited;
    }
    await app.close();
    await db.$disconnect();
    await unlink(join(root, 'runtime.json')).catch(() => {});
    process.exit(code);
  };
  process.once('SIGTERM', () => void stop());
  process.once('SIGINT', () => void stop());
  vite.once('error', error => { console.error(error.message); void stop(1); });
  vite.once('exit', () => { if (!stopping) void stop(1); });
  await new Promise<void>(ready => {
    const timeout = setTimeout(() => { console.error('Preview Vite startup timed out'); void stop(1); }, 30000);
    vite.once('message', () => { clearTimeout(timeout); ready(); });
  });
  info = {
    isolated: true,
    repoRoot: process.env.CREDIT_REPO_ROOT,
    runId: process.env.CREDIT_LOCAL_RUN_ID ?? null,
    sourceFingerprint: process.env.CREDIT_SOURCE_FINGERPRINT ?? null,
    sourceRevision: process.env.CREDIT_SOURCE_REVISION ?? null,
    startedAt: new Date().toISOString(),
    ocr: realOcr ? 'real' : 'mock',
    storage: realStorage ? 'gcs' : 'local-files',
    roomUrl: `http://localhost:${process.env.CREDIT_PREVIEW_PORT || 5187}/inbox/${room.id}`,
    resultUrl: `http://localhost:${process.env.CREDIT_PREVIEW_PORT || 5187}/inbox/${resultRoom.id}`,
    queueUrl: `http://localhost:${process.env.CREDIT_PREVIEW_PORT || 5187}/credit-checks`,
    apiOrigin,
    apiPid: process.pid,
    vitePid: vite.pid,
  };
  writeFileSync(join(root, 'runtime.json'), JSON.stringify(info, null, 2));
  console.log(JSON.stringify(info));
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Preview failed');
  process.exit(1);
});
