import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { resolve } from 'path';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { BranchesModule } from './modules/branches/branches.module';
// Supplier Management (Phase 2 step-by-step modules)
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { ProductsModule } from './modules/products/products.module';
import { ProductPhotosModule } from './modules/product-photos/product-photos.module';
import { InspectionsModule } from './modules/inspections/inspections.module';
import { StickersModule } from './modules/stickers/stickers.module';
import { CustomersModule } from './modules/customers/customers.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { CronModule } from './modules/cron/cron.module';
// MASTER-only modules
import { OverdueModule } from './modules/overdue/overdue.module';
import { ExchangeModule } from './modules/exchange/exchange.module';
import { RepossessionsModule } from './modules/repossessions/repossessions.module';
import { PurchaseOrdersModule } from './modules/purchase-orders/purchase-orders.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { NotificationQueueModule } from './modules/notifications/notification-queue.module';
import { SchedulerModule } from './modules/notifications/scheduler.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ReportsModule } from './modules/reports/reports.module';
import { MigrationModule } from './modules/migration/migration.module';
import { AuditModule } from './modules/audit/audit.module';
import { UsersModule } from './modules/users/users.module';
import { SettingsModule } from './modules/settings/settings.module';
import { StockAdjustmentsModule } from './modules/stock-adjustments/stock-adjustments.module';
import { SalesModule } from './modules/sales/sales.module';
import { ReorderPointsModule } from './modules/reorder-points/reorder-points.module';
import { BranchReceivingModule } from './modules/branch-receiving/branch-receiving.module';
import { StockCountModule } from './modules/stock-count/stock-count.module';
import { InterestConfigModule } from './modules/interest-config/interest-config.module';
import { PricingTemplatesModule } from './modules/pricing-templates/pricing-templates.module';
import { ContractDocumentsModule } from './modules/contract-documents/contract-documents.module';
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
import { ExpensesModule } from './modules/expenses/expenses.module';
import { AuditInterceptor } from './modules/audit/audit.interceptor';
import { SecurityMiddleware } from './modules/audit/security.middleware';
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
    AuthModule,
    BranchesModule,
    // Supplier Management (Phase 2 step-by-step modules)
    SuppliersModule,
    ProductsModule,
    ProductPhotosModule,
    InspectionsModule,
    StickersModule,
    CustomersModule,
    ContractsModule,
    InterestConfigModule,
    PricingTemplatesModule,
    ContractDocumentsModule,
    CreditCheckModule,
    OcrModule,
    SalesModule,
    DocumentsModule,
    PaymentsModule,
    CronModule,
    // MASTER: Operations
    OverdueModule,
    ExchangeModule,
    RepossessionsModule,
    PurchaseOrdersModule,
    StockAdjustmentsModule,
    ReorderPointsModule,
    BranchReceivingModule,
    StockCountModule,
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
    ExpensesModule,
    // MASTER: Management
    UsersModule,
    SettingsModule,
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
    consumer.apply(SecurityMiddleware).forRoutes('*');
  }
}
