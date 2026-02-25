import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { BranchesModule } from './modules/branches/branches.module';
import { OverdueModule } from './modules/overdue/overdue.module';
import { ExchangeModule } from './modules/exchange/exchange.module';
import { RepossessionsModule } from './modules/repossessions/repossessions.module';
import { PurchaseOrdersModule } from './modules/purchase-orders/purchase-orders.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ReportsModule } from './modules/reports/reports.module';
import { MigrationModule } from './modules/migration/migration.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuditInterceptor } from './modules/audit/audit.interceptor';
import { SecurityMiddleware } from './modules/audit/security.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
    }),
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,
        limit: 10,
      },
      {
        name: 'login',
        ttl: 900000, // 15 minutes
        limit: 5,
      },
    ]),
    PrismaModule,
    AuthModule,
    BranchesModule,
    // Phase 3: Operations
    OverdueModule,
    ExchangeModule,
    RepossessionsModule,
    PurchaseOrdersModule,
    // Phase 4: Communication
    NotificationsModule,
    // Phase 5: Intelligence
    DashboardModule,
    ReportsModule,
    // Phase 6: Polish
    MigrationModule,
    AuditModule,
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
