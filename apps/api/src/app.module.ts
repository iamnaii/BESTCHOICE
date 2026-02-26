import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { BranchesModule } from './modules/branches/branches.module';
// Supplier Management (Phase 2 step-by-step modules)
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { ProductsModule } from './modules/products/products.module';
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
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ReportsModule } from './modules/reports/reports.module';
import { MigrationModule } from './modules/migration/migration.module';
import { AuditModule } from './modules/audit/audit.module';
import { UsersModule } from './modules/users/users.module';
import { SettingsModule } from './modules/settings/settings.module';
import { AuditInterceptor } from './modules/audit/audit.interceptor';
import { SecurityMiddleware } from './modules/audit/security.middleware';
import { AddressModule } from './modules/address/address.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,
        limit: 30, // Allow 30 req/sec (dashboard fires many parallel queries)
      },
    ]),
    PrismaModule,
    AuthModule,
    BranchesModule,
    // Supplier Management (Phase 2 step-by-step modules)
    SuppliersModule,
    ProductsModule,
    InspectionsModule,
    StickersModule,
    CustomersModule,
    ContractsModule,
    DocumentsModule,
    PaymentsModule,
    CronModule,
    // MASTER: Operations
    OverdueModule,
    ExchangeModule,
    RepossessionsModule,
    PurchaseOrdersModule,
    // MASTER: Communication
    NotificationsModule,
    // MASTER: Intelligence
    DashboardModule,
    ReportsModule,
    // MASTER: Polish
    MigrationModule,
    AuditModule,
    // MASTER: Management
    UsersModule,
    SettingsModule,
    AddressModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
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
