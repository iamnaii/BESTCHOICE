import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ShopHomeModule } from './shop-home.module';
import { ShopHomeService } from './shop-home.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AppCacheModule } from '../../cache/cache.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { AuditModule } from '../audit/audit.module';
import { ContactsModule } from '../contacts/contacts.module';
import { EmployeesModule } from '../employees/employees.module';
import { GfinConfigModule } from '../gfin-config/gfin-config.module';
import { IntercoSettlementModule } from '../interco-settlement/interco-settlement.module';
import { MetricsModule } from '../metrics/metrics.module';
import { PiiModule } from '../pii/pii.module';
import { RepairTicketsModule } from '../repair-tickets/repair-tickets.module';
import { ShopBotDefenseModule } from '../shop-bot-defense/shop-bot-defense.module';
import { StaffNotifyModule } from '../staff-notify/staff-notify.module';
import { StorageModule } from '../storage/storage.module';
import { WebhookSecurityModule } from '../webhook-security/webhook-security.module';

/**
 * ตรวจการต่อ DI ของ ShopHomeModule โดยไม่ต่อฐานข้อมูล — ทุก service ที่ ShopHomeService inject
 * ต้องถูก export จาก module เจ้าของ (SalesModule, BookingsModule, AfterSalesModule, ShopTendersModule,
 * InventoryModule, PurchaseOrdersModule, ProductsModule, AccountingModule). `nest build` ไม่จับข้อนี้.
 * module ที่ AppModule ให้แบบ global ต้องใส่เองเมื่อ compile เฉพาะส่วน.
 */
describe('ShopHomeModule wiring', () => {
  beforeAll(() => {
    // JwtStrategy (ผ่าน AuthModule ที่ module ย่อย import) ต้องมี secret ตอนสร้าง — ค่าหลอกพอสำหรับ compile
    process.env.JWT_SECRET ??= 'wiring-spec-secret';
  });

  it('compile ได้และ resolve ShopHomeService พร้อม dependency ครบ', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        ScheduleModule.forRoot(),
        PrismaModule,
        AppCacheModule,
        AiUsageModule,
        AuditModule,
        ContactsModule,
        EmployeesModule,
        GfinConfigModule,
        IntercoSettlementModule,
        MetricsModule,
        PiiModule,
        RepairTicketsModule,
        ShopBotDefenseModule,
        // ก้อน 7 A16 — @Global ใน AppModule; StaffNotificationService (ChatbotFinanceModule) inject StaffNotifyService
        StaffNotifyModule,
        StorageModule,
        WebhookSecurityModule,
        ShopHomeModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
    expect(module.get(ShopHomeService)).toBeInstanceOf(ShopHomeService);
  });
});
