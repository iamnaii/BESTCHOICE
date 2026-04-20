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
import { ExchangeModule } from './modules/exchange/exchange.module';
import { DefectExchangeModule } from './modules/defect-exchange/defect-exchange.module';
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
import { CompanyModule } from './modules/company/company.module';
import { InterCompanyModule } from './modules/inter-company/inter-company.module';
import { JournalModule } from './modules/journal/journal.module';
import { ChartOfAccountsModule } from './modules/chart-of-accounts/chart-of-accounts.module';
import { TaxModule } from './modules/tax/tax.module';
import { CommissionModule } from './modules/commission/commission.module';
import { TradeInModule } from './modules/trade-in/trade-in.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { WarrantyModule } from './modules/warranty/warranty.module';
import { AssetModule } from './modules/asset/asset.module';
import { TodosModule } from './modules/todos/todos.module';
import { ChatbotFinanceModule } from './modules/chatbot-finance/chatbot-finance.module';
import { ChatEngineModule } from './modules/chat-engine/chat-engine.module';
import { ChatAdaptersModule } from './modules/chat-adapters/chat-adapters.module';
import { FacebookDomainModule } from './modules/facebook-domain/facebook-domain.module';
import { StaffChatModule } from './modules/staff-chat/staff-chat.module';
import { ChatAnalyticsModule } from './modules/chat-analytics/chat-analytics.module';
import { CsatModule } from './modules/csat/csat.module';
import { AdsTrackingModule } from './modules/ads-tracking/ads-tracking.module';
import { CrmModule } from './modules/crm/crm.module';
import { BroadcastModule } from './modules/broadcast/broadcast.module';
import { HealthModule } from './modules/health/health.module';
import { PeakModule } from './modules/peak/peak.module';
import { MdmModule } from './modules/mdm/mdm.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { LoyaltyModule } from './modules/loyalty/loyalty.module';
import { DataAuditModule } from './modules/data-audit/data-audit.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { AuditInterceptor } from './modules/audit/audit.interceptor';
import { SecurityMiddleware } from './modules/audit/security.middleware';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { AdminPrefixMiddleware } from './common/middleware/admin-prefix.middleware';
import { CsrfGuard } from './guards/csrf.guard';
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
    ExchangeModule,
    DefectExchangeModule,
    RepossessionsModule,
    PurchaseOrdersModule,
    InventoryModule,
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
    // Company Info (multi-entity foundation)
    CompanyModule,
    // Inter-Company (SHOP ↔ FINANCE)
    InterCompanyModule,
    // Journal Entries (double-entry accounting)
    JournalModule,
    ChartOfAccountsModule,
    // Tax Reports (ภ.พ.30, ภ.ง.ด.3, ภ.ง.ด.53)
    TaxModule,
    // Sales Commission
    CommissionModule,
    // Trade-In & Promotions
    TradeInModule,
    PromotionsModule,
    // Warranty
    WarrantyModule,
    // Fixed Asset & Depreciation
    AssetModule,
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
    // Staff Chat — WebSocket gateway + REST controller for unified inbox
    StaffChatModule,
    // Chat Analytics — response time, resolution rate, channel volume
    ChatAnalyticsModule,
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
    // Integrations — manage external service credentials (OWNER only)
    IntegrationsModule,
    // Loyalty Program (สะสมแต้ม + referral)
    LoyaltyModule,
    // MASTER: Management
    UsersModule,
    SettingsModule,
    WebhooksModule,
    AnalyticsModule,
    // Data Audit — automated DB health checks (OWNER only)
    DataAuditModule,
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
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // AdminPrefixMiddleware runs first: strip /api/admin/* prefix before any other middleware
    // so that RequestIdMiddleware and SecurityMiddleware see the rewritten URL.
    consumer.apply(AdminPrefixMiddleware).forRoutes('*');
    // RequestIdMiddleware must run before SecurityMiddleware so Sentry scope is tagged first.
    consumer.apply(RequestIdMiddleware).forRoutes('*');
    consumer.apply(SecurityMiddleware).forRoutes('*');
  }
}
