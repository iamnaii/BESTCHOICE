import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { resolve } from 'path';

import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../../modules/audit/audit.module';
import { AiUsageModule } from '../../modules/ai-usage/ai-usage.module';
import { WebhookSecurityModule } from '../../modules/webhook-security/webhook-security.module';
import { ShopBotDefenseModule } from '../../modules/shop-bot-defense/shop-bot-defense.module';
import { ContractsModule } from '../../modules/contracts/contracts.module';
import { PaymentsModule } from '../../modules/payments/payments.module';
import { SalesModule } from '../../modules/sales/sales.module';
import { BookingsModule } from '../../modules/bookings/bookings.module';
import { ExpenseDocumentsModule } from '../../modules/expense-documents/expense-documents.module';
import { OtherIncomeModule } from '../../modules/other-income/other-income.module';
// ⚠ เอกพจน์ — modules/assets/ มีแต่ไฟล์ spec ลอย ไม่มี module (ดู task brief R3)
import { AssetModule } from '../../modules/asset/asset.module';
import { EquityModule } from '../../modules/equity/equity.module';

/**
 * โมดูลสำหรับโหมดเดินเรื่อง (เฟส 3 ของ test-pack) เท่านั้น
 *
 * R3 — ห้าม import AppModule เด็ดขาด: app.module.ts:170 มี ScheduleModule.forRoot()
 * ซึ่งจะลงทะเบียน cron ทั้ง 17 ตัว (2A accrual 00:01, ECL 00:30, VAT 60 วัน 02:00, ฯลฯ)
 * ตอน onApplicationBootstrap — และไม่มี env flag ปิด cron (grep DISABLE_CRON /
 * CRON_ENABLED แล้วไม่พบ). ScheduleModule.forRoot() อยู่ที่ app.module.ts ที่เดียว
 * ⇒ ไม่ import AppModule = ไม่มี timer ใดถูกตั้ง. คลาส *Cron ที่ติดมากับ feature module
 * (GhostSaleCron, BookingExpireCron, ExpenseRecurringCron ฯลฯ) ถูก instantiate ได้
 * แต่ @Cron decorator เป็นแค่ metadata — ไม่มี SchedulerOrchestrator ก็ไม่มี timer.
 * ด่านพิสูจน์เชิงประจักษ์คือ smoke test: process ต้องจบเอง (timer/socket ค้าง = จบไม่ได้).
 *
 * หมายเหตุ BullMQ (ตรวจแล้ว ไม่ใช่ความเสี่ยง): ContractsModule/ExpenseDocumentsModule
 * import NotificationsModule จริง แต่ NotificationQueueModule.register() (ตัวที่ลาก Redis)
 * ถูกเรียกจาก app.module.ts:216 ที่เดียว และไม่มีใครนอกโมดูลนั้นฉีด NotificationQueueService.
 *
 * ถ้า Nest บ่นว่า provider ตัวไหน resolve ไม่ได้ ให้เพิ่ม "module ต้นทางของ provider นั้น"
 * เข้า imports — ห้ามแก้ด้วยการ import AppModule เพื่อความสะดวก.
 *
 * รายการ import:
 * - ConfigModule.forRoot — AuthModule (ติดมากับ ExpenseDocumentsModule) ใช้ ConfigService
 *   ใน JwtModule.registerAsync; ปกติ AppModule เป็นคน forRoot ให้ จึงต้อง forRoot เองที่นี่
 *   (envFilePath ชุดเดียวกับ app.module.ts + เพิ่ม candidate จากตำแหน่งไฟล์นี้ใต้ src/)
 * - PrismaModule (@Global) — PrismaService ของทุก service
 * - AuditModule (@Global) — AuditService ที่เกือบทุก service เขียน audit log ผ่าน
 * - ContractsModule — ContractWorkflowService.activate (JE 1A + SHOP leg)
 * - PaymentsModule — PaymentsService.recordPayment (JE 2B + ใบเสร็จ)
 * - SalesModule — SalesService.create (ขายสด / ขายผ่านไฟแนนซ์ภายนอก)
 * - BookingsModule — BookingsService.payDeposit (เงินมัดจำ Cr S21-2002)
 * - ExpenseDocumentsModule — ExpenseDocumentsService.post (ใบค่าใช้จ่าย)
 * - OtherIncomeModule — OtherIncomeService.post (รายได้อื่น)
 * - AssetModule — AssetService.post (JE ซื้อทรัพย์สิน)
 * - EquityModule — EquityService.post (เอกสารส่วนของผู้ถือหุ้น)
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        resolve(__dirname, '..', '..', '..', '..', '..', '.env'), // monorepo root (จาก src/cli/test-pack)
        resolve(__dirname, '..', '..', '..', '.env'), // apps/api/.env (จาก src/cli/test-pack)
        resolve(__dirname, '..', '..', '..', '..', '.env'), // apps/.env / dist variant
        '.env',
      ],
    }),
    // controller หลายตัวในโมดูลที่ลากมา @UseGuards(UserThrottlerGuard) — Nest instantiate
    // guard เป็น injectable ตอน bootstrap จึงต้องมี THROTTLER:MODULE_OPTIONS (config เดียวกับ
    // app.module.ts — ไม่มี cron/timer ค้างจาก module นี้ตอนไม่มี request)
    ThrottlerModule.forRoot([{ name: 'short', ttl: 1000, limit: 200 }]),
    PrismaModule,
    AuditModule,
    // @Global modules ที่ปกติ AppModule import ครั้งเดียวให้ทั้งแอป — ต้อง import เองที่นี่
    AiUsageModule, // OcrService (ติดมากับ ContractsModule → OcrModule) ฉีด AiUsageService
    WebhookSecurityModule, // LineFinanceWebhookGuard (ติดมากับ ChatbotFinanceModule) ฉีด WebhookAnomalyService
    ShopBotDefenseModule, // guard ของ shop-* storefront (ติดมาทางเดียวกัน) ฉีด ShopBotDefenseService

    ContractsModule,
    PaymentsModule,
    SalesModule,
    BookingsModule,
    ExpenseDocumentsModule,
    OtherIncomeModule,
    AssetModule,
    EquityModule,
  ],
})
export class TestPackModule {}
