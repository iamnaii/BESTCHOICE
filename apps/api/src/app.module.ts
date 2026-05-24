import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { resolve } from 'path';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { PiiModule } from './modules/pii/pii.module';
import { AuthModule } from './modules/auth/auth.module';
import { BranchesModule } from './modules/branches/branches.module';
// Supplier Management (Phase 2 step-by-step modules)
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { ProductsModule } from './modules/products/products.module';
import { QualityControlModule } from './modules/quality-control/quality-control.module';
import { StickersModule } from './modules/stickers/stickers.module';
import { CustomersModule } from './modules/customers/customers.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { PaymentsModule } from './modules/payments/payments.module';
// MASTER-only modules
import { OverdueModule } from './modules/overdue/overdue.module';
import { LegalCaseModule } from './modules/legal-case/legal-case.module';
import { LateFeeWaiverModule } from './modules/late-fee-waiver/late-fee-waiver.module';
import { CustomerTagsModule } from './modules/customer-tags/customer-tags.module';
import { SmsTemplatesModule } from './modules/sms-templates/sms-templates.module';
import { FilterPresetsModule } from './modules/filter-presets/filter-presets.module';
import { DefectExchangeModule } from './modules/defect-exchange/defect-exchange.module';
import { ContractExchangeModule } from './modules/contract-exchange/contract-exchange.module';
import { RepairTicketsModule } from './modules/repair-tickets/repair-tickets.module';
import { RepossessionsModule } from './modules/repossessions/repossessions.module';
import { PurchaseOrdersModule } from './modules/purchase-orders/purchase-orders.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { NotificationQueueModule } from './modules/notifications/notification-queue.module';
import { SchedulerModule } from './modules/notifications/scheduler.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ReportsModule } from './modules/reports/reports.module';
import { MigrationModule } from './modules/migration/migration.module';
import { AuditModule } from './modules/audit/audit.module';
import { WebhookSecurityModule } from './modules/webhook-security/webhook-security.module';
import { AiUsageModule } from './modules/ai-usage/ai-usage.module';
import { RefundsModule } from './modules/refunds/refunds.module';
import { ReceivableReconModule } from './modules/receivable-recon/receivable-recon.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { UsersModule } from './modules/users/users.module';
import { SettingsModule } from './modules/settings/settings.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { SalesModule } from './modules/sales/sales.module';
import { InterestConfigModule } from './modules/interest-config/interest-config.module';
import { PricingTemplatesModule } from './modules/pricing-templates/pricing-templates.module';
import { CreditCheckModule } from './modules/credit-check/credit-check.module';
import { OcrModule } from './modules/ocr/ocr.module';
import { PDPAModule } from './modules/pdpa/pdpa.module';
import { ReceiptsModule } from './modules/receipts/receipts.module';
import { CustomerAccessModule } from './modules/customer-access/customer-access.module';
import { LineOaModule } from './modules/line-oa/line-oa.module';
import { KycModule } from './modules/kyc/kyc.module';
import { StorageModule } from './modules/storage/storage.module';
import { EmailModule } from './modules/email/email.module';
import { InviteModule } from './modules/invite/invite.module';
import { PaySolutionsModule } from './modules/paysolutions/paysolutions.module';
import { FinanceReceivableModule } from './modules/finance-receivable/finance-receivable.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { OtherIncomeModule } from './modules/other-income/other-income.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { ExpenseDocumentsModule } from './modules/expense-documents/expense-documents.module';
import { PaymentMethodConfigModule } from './modules/payment-method-config/payment-method-config.module';
import { CompanyModule } from './modules/company/company.module';
import { InterCompanyModule } from './modules/inter-company/inter-company.module';
import { IntercompanyModule } from './modules/intercompany/intercompany.module';
import { JournalModule } from './modules/journal/journal.module';
import { ChartOfAccountsModule } from './modules/chart-of-accounts/chart-of-accounts.module';
import { BankAccountsModule } from './modules/bank-accounts/bank-accounts.module';
import { TaxModule } from './modules/tax/tax.module';
import { ETaxModule } from './modules/e-tax/e-tax.module';
import { ETaxXmlModule } from './modules/e-tax-xml/e-tax-xml.module';
import { CommissionModule } from './modules/commission/commission.module';
import { TradeInModule } from './modules/trade-in/trade-in.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { WarrantyModule } from './modules/warranty/warranty.module';
import { AssetModule } from './modules/asset/asset.module';
import { DepreciationModule } from './modules/depreciation/depreciation.module';
import { TodosModule } from './modules/todos/todos.module';
import { ChatbotFinanceModule } from './modules/chatbot-finance/chatbot-finance.module';
import { ChatEngineModule } from './modules/chat-engine/chat-engine.module';
import { ChatAdaptersModule } from './modules/chat-adapters/chat-adapters.module';
import { FacebookDomainModule } from './modules/facebook-domain/facebook-domain.module';
import { FacebookAppReviewModule } from './modules/facebook-app-review/facebook-app-review.module';
import { StaffChatModule } from './modules/staff-chat/staff-chat.module';
import { ChatAnalyticsModule } from './modules/chat-analytics/chat-analytics.module';
import { ChatHistoryExtractorModule } from './modules/chat-history-extractor/chat-history-extractor.module';
import { ChatIntentRouterModule } from './modules/chat-intent-router/chat-intent-router.module';
import { SalesBotModule } from './modules/sales-bot/sales-bot.module';
import { ChatAiDraftModule } from './modules/chat-ai-draft/chat-ai-draft.module';
import { AiSettingsModule } from './modules/ai-settings/ai-settings.module';
import { CsatModule } from './modules/csat/csat.module';
import { AdsTrackingModule } from './modules/ads-tracking/ads-tracking.module';
import { CrmModule } from './modules/crm/crm.module';
import { BroadcastModule } from './modules/broadcast/broadcast.module';
import { HealthModule } from './modules/health/health.module';
import { PeakModule } from './modules/peak/peak.module';
import { MdmModule } from './modules/mdm/mdm.module';
import { YeastarModule } from './modules/yeastar/yeastar.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { SearchModule } from './modules/search/search.module';
import { LoyaltyModule } from './modules/loyalty/loyalty.module';
import { ShopTrackingModule } from './modules/shop-tracking/shop-tracking.module';
import { ShopBotDefenseModule } from './modules/shop-bot-defense/shop-bot-defense.module';
import { ShopReservationModule } from './modules/shop-reservation/shop-reservation.module';
import { ShopCatalogModule } from './modules/shop-catalog/shop-catalog.module';
import { ShopAuthSocialModule } from './modules/shop-auth-social/shop-auth-social.module';
import { ShopLineChatModule } from './modules/shop-line-chat/shop-line-chat.module';
import { ShopShippingModule } from './modules/shop-shipping/shop-shipping.module';
import { ShopCartModule } from './modules/shop-cart/shop-cart.module';
import { ShopCheckoutModule } from './modules/shop-checkout/shop-checkout.module';
import { ShopOrdersModule } from './modules/shop-orders/shop-orders.module';
import { ShopMeModule } from './modules/shop-me/shop-me.module';
import { ShopCsModule } from './modules/shop-cs/shop-cs.module';
import { ShopReviewsModule } from './modules/shop-reviews/shop-reviews.module';
import { ShopTradeInModule } from './modules/shop-trade-in/shop-trade-in.module';
import { ShopBuybackModule } from './modules/shop-buyback/shop-buyback.module';
import { ShopInstallmentApplyModule } from './modules/shop-installment-apply/shop-installment-apply.module';
import { ShopSavingPlanModule } from './modules/shop-saving-plan/shop-saving-plan.module';
import { ShopPublicConfigModule } from './modules/shop-public-config/shop-public-config.module';
import { DataAuditModule } from './modules/data-audit/data-audit.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { TwoFactorModule } from './modules/two-factor/two-factor.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { CollectionsSessionModule } from './modules/collections-session/collections-session.module';
// P3-SP2 — Off-site backup replication (GCS cross-region sync)
import { BackupModule } from './modules/backup/backup.module';
// SP7.4 — External Finance Companies + Commission (SHOP-side GFIN/Krungsri)
import { ExternalFinanceModule } from './modules/external-finance/external-finance.module';
// P4-SP2 — Finance Tax (VAT/WHT monthly aggregation + auto-journal history)
import { FinanceTaxModule } from './modules/finance-tax/finance-tax.module';
// Task 18 — GFIN admin config (max prices, overprice rules, rate factors)
import { GfinConfigModule } from './modules/gfin-config/gfin-config.module';
import { AuditInterceptor } from './modules/audit/audit.interceptor';
import { SecurityMiddleware } from './modules/audit/security.middleware';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { EntityScopeMiddleware } from './middleware/entity-scope.middleware';
import { SentryEntityTagMiddleware } from './middleware/sentry-entity-tag.middleware';
// SP7.10 — Maintenance-mode toggle for cutover window (MAINTENANCE_MODE=true blocks writes)
import { MaintenanceModeMiddleware } from './middleware/maintenance-mode.middleware';
// D1.1.3.1 — One-shot startup warning for VAT_RATE/vat_pct orphan keys.
import { VatRateBootstrapService } from './utils/vat-rate-bootstrap.service';
import { CsrfGuard } from './guards/csrf.guard';
import { JwtAudienceGuard } from './modules/auth/guards/jwt-audience.guard';
import { AppCacheModule } from './cache/cache.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        resolve(__dirname, '..', '..', '..', '..', '.env'),  // monorepo root (from dist/src/)
        resolve(__dirname, '..', '..', '..', '.env'),         // monorepo root (from dist/)
        resolve(__dirname, '..', '..', '.env'),               // apps/api/.env (from dist/src/)
        resolve(__dirname, '..', '.env'),                     // apps/api/.env (from dist/)
        '.env',
      ],
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,
        limit: 200, // Allow 200 req/sec per IP (supports 20+ concurrent employees on same network)
      },
    ]),
    AppCacheModule,
    StorageModule,
    PrismaModule,
    PiiModule,
    AuthModule,
    BranchesModule,
    // Supplier Management (Phase 2 step-by-step modules)
    SuppliersModule,
    ProductsModule,
    QualityControlModule,
    StickersModule,
    CustomersModule,
    ContractsModule,
    InterestConfigModule,
    PricingTemplatesModule,
    CreditCheckModule,
    OcrModule,
    SalesModule,
    PaymentsModule,
    // MASTER: Operations
    OverdueModule,
    LegalCaseModule,
    LateFeeWaiverModule,
    CustomerTagsModule,
    SmsTemplatesModule,
    FilterPresetsModule,
    DefectExchangeModule,
    // SP2 — Same-price contract exchange
    ContractExchangeModule,
    // SP5 Phase 2 — Insurance / Repair Ticket
    RepairTicketsModule,
    RepossessionsModule,
    PurchaseOrdersModule,
    InventoryModule,
    CollectionsSessionModule,
    // MASTER: Communication
    NotificationsModule,
    NotificationQueueModule.register(),
    SchedulerModule,
    // MASTER: Intelligence
    DashboardModule,
    ReportsModule,
    // MASTER: Polish
    MigrationModule,
    AuditModule,
    WebhookSecurityModule,
    AiUsageModule,
    RefundsModule,
    ReceivableReconModule,
    MetricsModule,
    // Legal Compliance & PDPA
    PDPAModule,
    KycModule,
    ReceiptsModule,
    CustomerAccessModule,
    // LINE OA Integration
    LineOaModule,
    // Email
    EmailModule,
    // Invite
    InviteModule,
    // Payment Gateway
    PaySolutionsModule,
    // Finance Receivable
    FinanceReceivableModule,
    // Expense Management
    AccountingModule,
    // Other Income (รายได้อื่น — FINANCE only)
    OtherIncomeModule,
    // P2-SP4 — การจอง / มัดจำ (SHOP-side reservation + deposit)
    BookingsModule,
    // Expense Documents (เอกสารค่าใช้จ่าย — accrual workflow)
    ExpenseDocumentsModule,
    // Payment method ↔ Cash account mapping (cashier wizard filter)
    PaymentMethodConfigModule,
    // Company Info (multi-entity foundation)
    CompanyModule,
    // Inter-Company (SHOP ↔ FINANCE)
    InterCompanyModule,
    // Inter-company settlement (Phase A.3 W-5 — pays Due-to-SHOP)
    IntercompanyModule,
    // Journal Entries (double-entry accounting)
    JournalModule,
    ChartOfAccountsModule,
    // SP6 — Bank/Cash account directory (mirrors CoA 11-1101..1203)
    BankAccountsModule,
    // Tax Reports (ภ.พ.30, ภ.ง.ด.1/3/53)
    TaxModule,
    // e-Tax Invoice (Phase 1: list + PDF + CSV)
    ETaxModule,
    // P2-SP5 — e-Tax XML submission to สรรพากร (scaffolding, cert pluggable)
    ETaxXmlModule,
    // Sales Commission
    CommissionModule,
    // Trade-In & Promotions
    TradeInModule,
    PromotionsModule,
    // Warranty
    WarrantyModule,
    // Fixed Asset & Depreciation
    AssetModule,
    DepreciationModule,
    // Todos / Task management
    TodosModule,
    // Chatbot Finance — น้องเบส (LINE OA "ชำระค่างวด BESTCHOICE")
    ChatbotFinanceModule,
    // Unified Chat Engine — foundation for multi-channel chat system
    ChatEngineModule,
    // Chat Channel Adapters (LINE Finance/Shop, Facebook, TikTok, Web)
    ChatAdaptersModule,
    // Facebook Domain — IDomainHandler for Facebook Messenger business logic
    FacebookDomainModule,
    // Facebook App Review — OWNER-only endpoints to exercise Graph API permissions
    FacebookAppReviewModule,
    // Staff Chat — WebSocket gateway + REST controller for unified inbox
    StaffChatModule,
    // Chat Analytics — response time, resolution rate, channel volume
    ChatAnalyticsModule,
    // Chat History Extractor — pull past LINE/FB conversations → AiTrainingPair (OWNER only)
    ChatHistoryExtractorModule,
    // Chat Intent Router — classify inbound message to sales/service/handoff via Claude Haiku
    ChatIntentRouterModule,
    // Sales Bot — Claude Sonnet tool-use loop (search products, calculate installment, promotions, handoff)
    SalesBotModule,
    // Chat AI Draft orchestrator — router → bot → draft ChatMessage (Week 1 Hybrid C: staff approval required)
    ChatAiDraftModule,
    // AI Settings — per-bot mode (OFF/HYBRID/FULL) + confidence thresholds (singleton row)
    AiSettingsModule,
    // CSAT — customer satisfaction survey after chat resolution
    CsatModule,
    // Ads Attribution — campaign tracking + ROI
    AdsTrackingModule,
    // CRM Pipeline — lead tracking + customer scoring
    CrmModule,
    // Broadcast — mass messaging to customers across chat channels
    BroadcastModule,
    // Health check — liveness probe for Cloud Run / load balancers
    HealthModule,
    // External integrations (scaffold — activate when credentials are available)
    PeakModule,
    MdmModule,
    // Yeastar PBX — CDR logging, click-to-call, extension management
    YeastarModule,
    // Integrations — manage external service credentials (OWNER only)
    IntegrationsModule,
    // Loyalty Program (สะสมแต้ม + referral)
    LoyaltyModule,
    // Online Shop — visitor analytics
    ShopTrackingModule,
    // Online Shop — bot defense + rate limiting
    ShopBotDefenseModule,
    // Online Shop — 15-min product reservation for online buyers
    ShopReservationModule,
    // Online Shop — read-only product catalog (grouped listing + detail)
    ShopCatalogModule,
    // Online Shop — LINE + Facebook OAuth login + phone binding
    ShopAuthSocialModule,
    // Online Shop — contact form → LINE OA staff notification
    ShopLineChatModule,
    // Online Shop — static shipping rate table (Phase 2)
    ShopShippingModule,
    // Online Shop — session-based cart from active reservations (Phase 2)
    ShopCartModule,
    // Online Shop — checkout (validate promo/loyalty, place order) (Phase 2)
    ShopCheckoutModule,
    // Online Shop — OnlineOrder CRUD + OnlineOrderSaleAdapter (Phase 2)
    ShopOrdersModule,
    // Online Shop — customer address book (/api/shop/me/addresses) (Phase 2)
    ShopMeModule,
    // Online Shop — customer service (cancel + refund request) (Phase 3)
    ShopCsModule,
    // Online Shop — product reviews (verified purchase + moderation) (Phase 3)
    ShopReviewsModule,
    // Online Shop — customer online trade-in submission (exchange flow) (Phase 3)
    ShopTradeInModule,
    // Online Shop — customer online buyback (pure cash-out flow) (Phase 3)
    ShopBuybackModule,
    // Online Shop — installment application (customer submit + admin review) (Phase 3)
    ShopInstallmentApplyModule,
    // Online Shop — ออมดาวน์ (saving plan) + reminder cron (Phase 3)
    ShopSavingPlanModule,
    // Online Shop — public runtime config (GA4 / FB Pixel IDs) (Phase 3 follow-up)
    ShopPublicConfigModule,
    // MASTER: Management
    UsersModule,
    SettingsModule,
    WebhooksModule,
    AnalyticsModule,
    SearchModule,
    // Data Audit — automated DB health checks (OWNER only)
    DataAuditModule,
    // Two-Factor Authentication management (enroll, confirm, disable, backup codes)
    TwoFactorModule,
    // Reporting — weekly PDF analytics report + compliance dashboard (P3 D1+D2)
    ReportingModule,
    // P3-SP2 — Off-site backup replication (GCS cross-region sync, daily 03:30 BKK)
    BackupModule,
    // SP7.4 — External Finance Companies + Commission (SHOP-side GFIN/Krungsri)
    ExternalFinanceModule,
    // P4-SP2 — Finance Tax (VAT/WHT monthly aggregation + auto-journal history)
    FinanceTaxModule,
    // Task 18 — GFIN admin config (max prices, overprice rules, rate factors)
    GfinConfigModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
    // JwtAudienceGuard runs globally after per-controller JwtAuthGuard sets req.user.
    // When req.user is not yet set (public/unauthenticated paths), the guard defers
    // and lets JwtAuthGuard handle the 401 response.
    {
      provide: APP_GUARD,
      useClass: JwtAudienceGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
    // D1.1.3.1 — VAT_RATE orphan-key bootstrap warning. No exports, no
    // controllers — just a one-shot OnModuleInit that warns when both the
    // canonical VAT_RATE and a legacy vat_pct/vat_rate row coexist.
    VatRateBootstrapService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // NOTE: AdminPrefixMiddleware is applied at Express level in main.ts
    // (not here) because forRoutes('*') doesn't reliably run before the
    // NestJS routing layer rejects unknown /api/admin/* paths with 404.
    // SP7.10 — MaintenanceModeMiddleware runs FIRST to gate writes during cutover.
    // Activate: MAINTENANCE_MODE=true env + Cloud Run redeploy.
    consumer.apply(MaintenanceModeMiddleware).forRoutes('*');
    // RequestIdMiddleware must run before SecurityMiddleware so Sentry scope is tagged first.
    consumer.apply(RequestIdMiddleware).forRoutes('*');
    consumer.apply(SecurityMiddleware).forRoutes('*');
    // SP7.1 — Resolves req.entityScope after auth (runs after JwtAuthGuard populates req.user).
    consumer.apply(EntityScopeMiddleware).forRoutes('*');
    // SP7.8 — Tags the Sentry request scope with entity_scope (SHOP|FINANCE) for error segmentation.
    consumer.apply(SentryEntityTagMiddleware).forRoutes('*');
  }
}
