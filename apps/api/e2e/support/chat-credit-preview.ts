import { chromium } from 'playwright';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { DocumentsService } from '../../src/modules/contracts/documents.service';
import { DocumentsController } from '../../src/modules/contracts/documents.controller';
import { ContractDocumentsService } from '../../src/modules/contracts/contract-documents.service';
import { ContractDocumentsController } from '../../src/modules/contracts/contract-documents.controller';
import { ContractFileAccessGuard } from '../../src/modules/contracts/contract-file-access.guard';
import { seedPreviewDocuments } from './preview-documents-fixture';
import { SettingsFlagsService } from '../../src/modules/settings/services/settings-flags.service';
import { previewBookings, seedPreviewExternalFinanceSale, seedPreviewSales } from './preview-sales-fixture';
import { SalesQueryService } from '../../src/modules/sales/services/sales-query.service';
import { SalesListQueryDto } from '../../src/modules/sales/dto/sales-list-query.dto';
import { ContractsListQueryDto } from '../../src/modules/contracts/dto/contracts-list-query.dto';
import { ContractQuoteDto } from '../../src/modules/contracts/dto/contract-quote.dto';
import { ContractQuoteService } from '../../src/modules/contracts/services/contract-quote.service';
import { seedTradeInAppraisal, seedTradeInShop, tradeInProviders } from './trade-in-fixture';
import { TradeInController } from '../../src/modules/trade-in/trade-in.controller';
import { ContactsController } from '../../src/modules/contacts/contacts.controller';
import { ProductPhotosController } from '../../src/modules/quality-control/product-photos.controller';
import { ProductPhotosService } from '../../src/modules/quality-control/product-photos.service';
import { ProductsService } from '../../src/modules/products/products.service';
import { PoQueryService } from '../../src/modules/purchase-orders/services/po-query.service';
import { UpdateProductDto } from '../../src/modules/products/dto/update-product.dto';
import { InterestConfigService } from '../../src/modules/interest-config/interest-config.service';
import { PromotionsService } from '../../src/modules/promotions/promotions.service';
import { GfinConfigService } from '../../src/modules/gfin-config/gfin-config.service';
import { AuditService } from '../../src/modules/audit/audit.service';
import { ShopReservationService } from '../../src/modules/shop-reservation/shop-reservation.service';
import { randomUUID } from 'node:crypto';
import { json } from 'express';
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
import { ReceivablesReportService } from '../../src/modules/reports/services/receivables-report.service';
import { seedPreviewStock } from './preview-stock-fixture';
import { seedPreviewPortfolio } from './preview-portfolio-fixture';
import { CustomerQueryService } from '../../src/modules/customers/services/customer-query.service';
import { CustomerPurchaseSummaryService } from '../../src/modules/customers/services/customer-purchase-summary.service';
import { CustomerChatRoomsService } from '../../src/modules/customers/services/customer-chat-rooms.service';
import { CustomersListQueryDto } from '../../src/modules/customers/dto/customers-list-query.dto';
import { CustomerTierService } from '../../src/modules/customers/customer-tier.service';
import { DashboardOverviewService } from '../../src/modules/dashboard/services/dashboard-overview.service';
import { DashboardCollectionsService } from '../../src/modules/dashboard/services/dashboard-collections.service';
import { DashboardOpsService } from '../../src/modules/dashboard/services/dashboard-ops.service';
import { OverdueQueriesService } from '../../src/modules/overdue/services/overdue-queries.service';
import { PromiseService } from '../../src/modules/overdue/promise.service';
import { CustomerAnalyticsService } from '../../src/modules/customers/services/customer-analytics.service';
import { RevenueReportService } from '../../src/modules/reports/services/revenue-report.service';
import { TransactionalReportService } from '../../src/modules/accounting/transactional-report.service';
import { CompanyResolverService } from '../../src/modules/journal/company-resolver.service';
import { CompanyService } from '../../src/modules/company/company.service';

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
const receivables = new ReceivablesReportService(db);
const salesQuery = new SalesQueryService(db);
const bookingQuery = previewBookings(db);
const customerQuery = new CustomerQueryService(db, new CustomerTierService(db),
  new CustomerPurchaseSummaryService(db), new CustomerChatRoomsService(db));
// Real dashboard reads against the same synthetic database; only the cache facade is omitted.
const dashboardOverview = new DashboardOverviewService(db);
const dashboardCollections = new DashboardCollectionsService(db);
const dashboardOps = new DashboardOpsService(db);
const overdueQuery = new OverdueQueriesService(db, new PromiseService(db));
const customerAnalytics = new CustomerAnalyticsService(db, customerQuery);
const revenueReports = new RevenueReportService(db);
const transactionalReports = new TransactionalReportService(db, new CompanyResolverService(db));
const companies = new CompanyService(db);
const products = new ProductsService(db);
const poQuery = new PoQueryService(db);
const interestConfigs = new InterestConfigService(db);
const promotions = new PromotionsService(db);
const gfin = new GfinConfigService(db, new AuditService(db));
const holds = new ShopReservationService(db, {} as never, new AuditService(db));
const lifecycle = new ContractLifecycleService(db, contractQuery,
  { execute: async () => ({}) } as never, { execute: async () => ({}) } as never,
  { resolveBranchCashAccount: async () => 'S11-1101', resolveInflowCashAccount: async () => 'S11-1101' } as never);
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
  @Get('reports/finance-portfolio') portfolio(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return receivables.getFinancePortfolio(
      status, Math.max(1, parseInt(page || '', 10) || 1),
      Math.max(1, Math.min(parseInt(limit || '', 10) || 50, 100)), startDate, endDate,
    );
  }
  @Get('branches') branches() {
    return db.branch.findMany({ where: { deletedAt: null } });
  }
  // 🔴 ตัวกรอง "ผู้ดูแล" ของหน้า /customers เติมรายชื่อจาก endpoint นี้ — เดิม preview
  // ตอบ 501 ⇒ ตัวเลือกว่างเปล่าและเจ้าของทดสอบตัวกรองนั้นไม่ได้เลย
  @Get('users') users() {
    return db.user.findMany({ select: { id: true, name: true }, take: 200 });
  }
  @Get('companies') companies() { return companies.findAll(); }
  @Get('dashboard/kpis') dashboardKpis() { return dashboardOverview.computeKPIs(); }
  @Get('dashboard/monthly-trend') dashboardTrend() { return dashboardOverview.getMonthlyTrend(); }
  @Get('dashboard/status-distribution') dashboardStatuses() { return dashboardOverview.getStatusDistribution(); }
  @Get('dashboard/branch-comparison') dashboardBranches() { return dashboardOverview.getBranchComparison(); }
  @Get('dashboard/monthly-revenue') dashboardRevenue() { return dashboardOverview.getMonthlyRevenue(); }
  @Get('dashboard/top-overdue') dashboardOverdue() { return dashboardCollections.getTopOverdue(); }
  @Get('dashboard/aging-summary') dashboardAging() { return dashboardCollections.getAgingSummary(); }
  @Get('dashboard/watch-list') dashboardWatchList() { return dashboardCollections.computeWatchList(); }
  @Get('dashboard/alerts') dashboardAlerts() { return dashboardOps.computeAlerts(); }
  @Get('dashboard/staff-performance') dashboardStaff() { return dashboardOps.getStaffPerformance(); }
  @Get('overdue/pipeline') dashboardPipeline() { return overdueQuery.getCollectionPipelineStats('OWNER'); }
  @Get('customers/upsell-candidates') customerUpsell(@Query('limit') limit = '5') {
    return customerAnalytics.getUpsellCandidates(undefined, Math.max(1, Math.min(parseInt(limit, 10) || 5, 50)));
  }
  @Get('reports/entity-profit') entityProfit(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return revenueReports.getEntityProfitReport(startDate, endDate);
  }
  @Get('reports/comparative-pl') comparativePL(@Query('year') year: string, @Query('month') month: string) {
    return transactionalReports.getComparativePL(Number(year), Number(month), undefined, undefined, true);
  }
  @Get('products') products(@Query() query: Record<string, string>) {
    return products.findAll({ ...query, groupAccessories: query.groupAccessories === 'true', page: Number(query.page) || 1, limit: Number(query.limit) || 50 });
  }
  @Get('products/:id') product(@Param('id') id: string) { return products.findOne(id); }
  @Patch('products/:id') updateProduct(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return products.update(id, dto, actor.id);
  }
  @Get('products/:id/readiness') readiness(@Param('id') id: string) { return products.getReadiness(id); }
  @Get('purchase-orders/qc-pending') qcPending(@Query() query: Record<string, string>) {
    return poQuery.getQCPending({ branchId: query.branchId, poId: query.poId,
      page: Number(query.page) || 1, limit: Number(query.limit) || 50 });
  }
  @Get('admin/product-holds') productHolds(@Query('productId') productId: string) {
    return holds.listAdminHolds({ productId, status: 'ACTIVE' });
  }
  @Get('promotions/active') promotions() { return promotions.findActivePromotions(); }
  @Get('interest-configs/resolved') resolvedInterest(@Query('category') category: string) { return interestConfigs.resolveConfig(category); }
  // ProductDetailPage (useGfinTables) reads settings alongside the three tables since 49a40a1a1.
  @Get('gfin-config/settings') gfinSettings() { return gfin.getSettings(); }
  @Get('gfin-config/max-prices') maxPrices() { return gfin.listMaxPrices(); }
  @Get('gfin-config/overprice-rules') overprice() { return gfin.listOverpriceRules(); }
  @Get('gfin-config/rate-factors') rateFactors() { return gfin.listRateFactors(); }
  @Get('settings/ui-flags') uiFlags() { return new SettingsFlagsService(db).getUiFlags(); }
  // 🔴 ส่ง DTO ทั้งก้อนต่อ — เวอร์ชันเดิมแกะพารามิเตอร์รายตัว ตัวกรองใหม่จึงหายเงียบ ๆ
  // และเจ้าของจะทดสอบบน preview แล้วเห็น "พฤติกรรมเดิม" โดยไม่มีอะไรฟ้อง
  @Get('customers/export') customersExport(@Query() query: CustomersListQueryDto) {
    return customerQuery.exportRows(query);
  }
  @Get('sales/export') salesExport(@Query() query: SalesListQueryDto) { return salesQuery.exportRows(query, actor); }
  @Get('sales/salespersons') salespersons() { return salesQuery.getSalespersons(actor); }
  @Get('sales/top-products') topProducts() { return salesQuery.getTopSellingProducts(actor); }
  @Get('sales') sales(@Query() query: SalesListQueryDto) { return salesQuery.findAll(query, actor); }
  @Get('sales/config') config() { return loadInstallmentConfig(db); }
  @Get('sales/:id') sale(@Param('id') id: string) { return salesQuery.findOne(id, actor); }
  @Get('bookings') bookings(@Query() query: Record<string, string>) {
    return bookingQuery.findAll({ ...query, page: Math.max(1, Number(query.page) || 1), limit: Math.min(200, Math.max(1, Number(query.limit) || 50)) }, actor);
  }
  @Get('bookings/:id') booking(@Param('id') id: string) { return bookingQuery.findOne(id, actor); }
  @Get('contracts/export') contractsExport(@Query() query: ContractsListQueryDto) { return contractQuery.exportRows(query, { ...actor, branchId: null }); }
  @Get('contracts') contracts(@Query() query: ContractsListQueryDto) { return contractQuery.findAll(query, { ...actor, branchId: null }); }
  @Get('customers') customers(@Query() query: CustomersListQueryDto) {
    return customerQuery.findAll({
      ...query,
      page: Math.max(1, Number(query.page) || 1),
      limit: Math.max(1, Math.min(Number(query.limit) || 50, 100)),
    });
  }
  @Get('interest-configs/by-category/:category') interest(@Param('category') category: string) {
    return db.interestConfig.findFirst({ where: { productCategories: { has: category as never }, isActive: true } });
  }
  @Post('contracts/quote') quoteContract(@Body() dto: ContractQuoteDto) { return new ContractQuoteService(db).resolve(dto, actor); }
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
  @Get('customers/search') searchCustomers(@Query('q') q = '') {
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
  await seedTradeInShop(db, 'LOCAL PREVIEW BRANCH');
  await seedTradeInAppraisal(db);
  await seedPreviewStock(db);
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
  await seedPreviewPortfolio(db, actor.id);
  const salesFixture = await seedPreviewSales(db, actor);
  await seedPreviewExternalFinanceSale(db, actor.id);
  const module = await Test.createTestingModule({
    controllers: [
      TradeInController, ContactsController, ProductPhotosController,
      ContractDocumentsController, DocumentsController,
      RoomCreditController,
      RoomAssistanceController,
      OcrController,
      CustomerCreditCheckController,
      GlobalCreditCheckController,
      PreviewController,
    ],
    providers: [
      ...tradeInProviders(db, storageForPreview as StorageService),
      ProductPhotosService, DocumentsService, ContractDocumentsService, ContractFileAccessGuard,
      { provide: SettingsService, useValue: { findAll: () => db.systemConfig.findMany() } },
      { provide: NotificationsService, useValue: { send: () => { throw new Error('Document preview cannot send notifications'); } } },
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
  process.env.PUPPETEER_EXECUTABLE_PATH ||= chromium.executablePath();
  const documentsFixture = await seedPreviewDocuments(db, module.get(DocumentsService), actor.id);
  const app = module.createNestApplication({ logger: false });
  app.use(json({ limit: '20mb' }));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.use((req, res, next) => {
    req.url = req.url.replace(/^\/api\/admin(?=\/|$)/, '/api');
    const path = req.path;
    // Explicit app-shell fixtures. Unsupported endpoints must not masquerade as empty data.
    if (req.method === 'GET') {
      const shellData = {
        '/api/settings/test-mode': { enabled: false },
        '/api/overdue/collections-flag': { enabled: false },
        '/api/staff-chat/appointments/due': [],
        '/api/staff-chat/staff/online': [],
        '/api/staff-chat/unread-count': { unread: 0 },
        '/api/notifications/logs/stats': { total: 0, sent: 0, failed: 0, pending: 0 },
      };
      if (Object.prototype.hasOwnProperty.call(shellData, path)) return res.json(shellData[path]);
    }
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
      /^\/api\/(trade-ins|contacts|admin\/product-holds|promotions|gfin-config|documents|preview|auth\/me|credit-checks|ocr\/bank-statement|products|contracts|interest-configs|sales|bookings)/.test(path) || path === '/api/customers' || path === '/api/users' ||
      /^\/api\/customers\/(search|[^/]+(?:\/credit-check.*)?)$/.test(path) ||
      /^\/api\/staff-chat\/rooms(?:\/(counts|[^/]+(?:\/(messages|customer|prepare-offer|credit-check.*))?))?$/.test(
        path,
      ) ||
      path === '/api/staff-chat/ai/settings' || path === '/api/reports/finance-portfolio' ||
      path === '/api/settings/ui-flags' || path === '/api/branches' || path === '/api/companies' || path === '/api/overdue/pipeline' || path === '/api/purchase-orders/qc-pending' ||
      /^\/api\/dashboard\/(kpis|monthly-trend|status-distribution|branch-comparison|monthly-revenue|top-overdue|aging-summary|watch-list|alerts|staff-performance)$/.test(path) ||
      /^\/api\/reports\/(entity-profit|comparative-pl)$/.test(path)
    )
      return next();
    return res.status(501).json({ message: 'เมนูนี้ยังไม่รองรับใน local preview', code: 'LOCAL_PREVIEW_UNSUPPORTED' });
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
    saleUrl: `http://localhost:${process.env.CREDIT_PREVIEW_PORT || 5187}/sales?saleId=${salesFixture.saleId}`,
    documentUrl: `http://localhost:${process.env.CREDIT_PREVIEW_PORT || 5187}/contracts/${documentsFixture.contractId}`,
    bookingUrl: `http://localhost:${process.env.CREDIT_PREVIEW_PORT || 5187}/bookings?bookingId=${salesFixture.bookingId}`,
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
