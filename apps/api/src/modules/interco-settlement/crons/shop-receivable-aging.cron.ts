import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { readBoolFlag, readIntFlag } from '../../../utils/config.util';
import {
  IntercoAgingService,
  ShopReceivableAgingRow,
  ShopReceivableOverdueArm,
  overdueArms,
} from '../interco-aging.service';

/** tag ของ Todo — dedup อ่านค่านี้ตัวเดียว (อย่า hardcode ซ้ำที่อื่น) */
export const AGING_TODO_TAG = 'interco-aging';

const DEFAULT_THRESHOLD_DAYS = 30;
/** clamp ของ readIntFlag — 1 วัน (เตือนทันที) ถึง 10 ปี */
const MIN_THRESHOLD_DAYS = 1;
const MAX_THRESHOLD_DAYS = 3650;

interface ArmView {
  arm: ShopReceivableOverdueArm;
  label: string;
  amount: Prisma.Decimal;
  ageDays: number;
  howTo: string;
}

/** 8000 → "8,000.00" (ผ่าน Decimal.toFixed — ไม่แปลงเป็น Number ตามกติกาเงิน) */
function formatAmount(value: Prisma.Decimal): string {
  const [intPart, decPart] = value.toFixed(2).split('.');
  const sign = intPart.startsWith('-') ? '-' : '';
  const digits = sign ? intPart.slice(1) : intPart;
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${decPart}`;
}

/**
 * แจ้งเตือนลูกหนี้-หน้าร้าน (11-2107) ที่ค้างเกินเกณฑ์ — Phase 4 spec §6 ข้อ 2.
 *
 * อ่านยอด/อายุจาก `IntercoAgingService.getShopReceivableAging` ตัวเดียว **ห้าม
 * คำนวณ typed balance เองในไฟล์นี้** (engine เดียวกับ endpoint + แท็บ UI +
 * reconcile cron ⇒ ยอดในกล่อง Todo กับบนหน้าจอมาจากก้อนเดียวกันเสมอ) และตัดสิน
 * "ค้างเกินกำหนด" ด้วย `overdueArms()` ซึ่งเป็นฟังก์ชันเดียวกับที่ service ใช้
 * ประกอบ `totals.overdueCount` — ปักด้วยเทสต์ anti-drift
 * (`flagged === totals.overdueCount`).
 *
 * หมายเหตุเรื่อง "เกณฑ์วัน": cron อ่านจาก SystemConfig
 * `shop_receivable_aging_alert_days` ส่วนแท็บ UI ส่ง `thresholdDays` มาทาง query
 * (ค่าเริ่มต้น 30 ฝั่ง FE) — ถ้าผู้ดูแลแก้ค่า config เป็นเลขอื่น ป้าย "ค้างเกิน
 * เกณฑ์" บนหน้าจอจะยังใช้ 30 จนกว่าจะส่ง query ให้ตรงกัน (ยอด/อายุยังตรงกันเสมอ
 * เพราะมาจาก engine เดียว). ตราบใดที่ยังไม่มีใครแก้ config เลข 30 ตรงกันทุกชั้น.
 *
 * **แถว `legacyOneBook` ถูกกันออกทั้งแถว (คำตัดสิน Task 3):** swap ยุคก่อน Phase 1
 * มี 11-2107 แต่ไม่มีขาคู่ S21-3001 และ "ล้าง" ผ่าน shop-collect ซึ่ง stamp
 * `SHOP_COLLECT` ⇒ คอลัมน์ typed ของแถวนั้นค้าง +8,000 / −8,000 ถาวรแม้ยอดบัญชี
 * จริงเป็น 0 (spec §11.4 = **สภาพปกติ ไม่ใช่ anomaly**). ถ้า alert ตามคอลัมน์
 * typed จะเตือนเท็จทุกวันตลอดไป และถ้า alert เฉพาะแขน `shopCollect` ก็ยังบอกยอด
 * ผิด เพราะคอลัมน์นั้นบนแถว legacy คือ (หนี้ shop-collect จริง − ขาล้างเครดิต
 * legacy) ปนกัน — เตือนด้วยตัวเลขผิดคือทางลัดไปสู่การถูกเมิน. หนี้จริงของแถว
 * legacy **ไม่หายจากสายตาคน**: (1) แท็บ "อายุลูกหนี้หน้าร้าน" โชว์ทุกแถวรวม legacy
 * พร้อม `totals.legacyOneBookNet` = ยอด 11-2107 จริงระดับสัญญา, (2) tick นี้ log
 * warn สรุปจำนวนแถว legacy + ยอดรวมทุกวัน, (3) reconcile cron รายเดือน (Task 4)
 * เป็นตาข่ายสุดท้ายของความผิดปกติข้ามสมุด.
 *
 * doctrine R-1: root `PrismaService` เท่านั้น, ไม่อยู่บนเส้นทางเงิน, **ห้าม throw
 * ออกจาก tick** — outer try/catch + per-row try/catch (pattern `ap-due-alerts.cron.ts`).
 */
@Injectable()
export class ShopReceivableAgingCron {
  private readonly logger = new Logger(ShopReceivableAgingCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aging: IntercoAgingService,
  ) {}

  /** Daily 09:07 BKK — staggered หลัง 09:00/09:03 jobs (ตาม pattern ap-due-alerts). */
  @Cron('7 9 * * *', { timeZone: 'Asia/Bangkok' })
  async tick(): Promise<{
    enabled: boolean;
    flagged: number;
    todosCreated: number;
    skipped: number;
  }> {
    try {
      const enabled = await readBoolFlag(this.prisma, 'shop_receivable_aging_alerts_enabled', true);
      if (!enabled) {
        this.logger.debug('[interco-aging] alerts disabled — skipping');
        return { enabled: false, flagged: 0, todosCreated: 0, skipped: 0 };
      }

      const thresholdDays = await readIntFlag(
        this.prisma,
        'shop_receivable_aging_alert_days',
        DEFAULT_THRESHOLD_DAYS,
        MIN_THRESHOLD_DAYS,
        MAX_THRESHOLD_DAYS,
      );

      // threshold ตัวเดียวกันถูกส่งเข้า service ⇒ totals.overdueCount ที่ service
      // คืนมาเป็นเกณฑ์เดียวกับที่ลูปด้านล่างใช้เป๊ะ
      const result = await this.aging.getShopReceivableAging(new Date(), thresholdDays);

      // แถว legacy: ไม่ alert (ดู jsdoc คลาส) แต่ log สรุปให้เห็นทุกวัน
      const legacyRows = result.rows.filter((r) => r.legacyOneBook);
      if (legacyRows.length > 0) {
        this.logger.warn(
          `[interco-aging] ข้าม ${legacyRows.length} สัญญา legacy สมุดเดียว (spec §11.4) — ` +
            `ยอด 11-2107 คงเหลือรวม ${formatAmount(result.totals.legacyOneBookNet)} บาท ` +
            `(ดูรายละเอียดที่แท็บอายุลูกหนี้หน้าร้าน)`,
        );
      }

      const overdue = result.rows.filter(
        (r) => !r.legacyOneBook && overdueArms(r, thresholdDays).length > 0,
      );
      const flagged = overdue.length;

      this.logger.log(
        `[interco-aging] ลูกหนี้-หน้าร้านค้างเกิน ${thresholdDays} วัน: ${flagged} สัญญา ` +
          `(รวมกลุ่มระหว่างกิจการ ${formatAmount(result.totals.intercoNet)} บาท / ` +
          `หน้าร้านรับแทน ${formatAmount(result.totals.shopCollect)} บาท)`,
      );
      if (flagged === 0) {
        return { enabled: true, flagged: 0, todosCreated: 0, skipped: 0 };
      }

      // SYSTEM user ดึงครั้งเดียว — ไม่มี = สร้าง Todo ไม่ได้ แต่ Sentry ยังต้อง
      // ยิงครบทุกแถว (pattern `alarmResidualParkOnCompletion`: alarm มาก่อน Todo)
      const systemUser = await this.prisma.user.findFirst({
        where: { isSystemUser: true, deletedAt: null },
        select: { id: true },
      });
      if (!systemUser) {
        this.logger.error(
          `[interco-aging] ไม่พบผู้ใช้ SYSTEM — ข้ามการสร้าง Todo ${flagged} ใบ (Sentry-alarmed)`,
        );
      }

      let todosCreated = 0;
      let skipped = 0;

      for (const row of overdue) {
        try {
          const views = this.buildArmViews(row, thresholdDays);
          this.alarm(row, views, thresholdDays);

          if (!systemUser) {
            skipped++;
            continue;
          }

          // dedup: แถวเดิมค้างข้ามวัน (ปกติมาก — รอรอบจ่าย) ต้องไม่สร้าง Todo ซ้ำ
          const existing = await this.prisma.todo.findFirst({
            where: {
              tags: { has: AGING_TODO_TAG },
              title: { contains: row.contractNumber },
              status: { not: 'DONE' },
              deletedAt: null,
            },
            select: { id: true },
          });
          if (existing) {
            skipped++;
            continue;
          }

          await this.prisma.todo.create({
            data: {
              title: this.buildTitle(row, views),
              description: this.buildDescription(row, views, thresholdDays),
              priority: 'MEDIUM',
              tags: [AGING_TODO_TAG],
              createdById: systemUser.id,
            },
          });
          todosCreated++;
        } catch (err) {
          skipped++;
          Sentry.captureException(err, {
            tags: { cron: 'shop-receivable-aging' },
            extra: { contractId: row.contractId, contractNumber: row.contractNumber },
          });
          this.logger.error(
            `[interco-aging] แจ้งเตือนสัญญา ${row.contractNumber} ล้มเหลว: ` +
              `${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      this.logger.log(
        `[interco-aging] เสร็จสิ้น: flagged=${flagged} todosCreated=${todosCreated} skipped=${skipped}`,
      );
      return { enabled: true, flagged, todosCreated, skipped };
    } catch (outerErr) {
      // DB/service ล่มทั้งก้อน — ห้ามทำให้ scheduler ตาย, tick ถัดไปลองใหม่เอง
      Sentry.captureException(outerErr, {
        tags: { cron: 'shop-receivable-aging', scope: 'tick' },
      });
      this.logger.error(
        `[interco-aging] tick ล้มเหลว: ${
          outerErr instanceof Error ? outerErr.message : String(outerErr)
        }`,
      );
      return { enabled: false, flagged: 0, todosCreated: 0, skipped: 0 };
    }
  }

  /** แปลงแขนที่เกินเกณฑ์เป็นข้อมูลสำหรับข้อความ (label + ยอด + อายุ + วิธีล้าง) */
  private buildArmViews(row: ShopReceivableAgingRow, thresholdDays: number): ArmView[] {
    const arms = overdueArms(row, thresholdDays);
    const views: ArmView[] = [];
    if (arms.includes('INTERCO')) {
      views.push({
        arm: 'INTERCO',
        label: 'กลุ่มระหว่างกิจการ',
        amount: row.intercoNet,
        ageDays: row.intercoAgeDays ?? thresholdDays,
        howTo:
          'ล้างได้ 2 ทาง — (1) หักกลบในรอบจ่าย INTER-CO (เลือกสัญญานี้เข้ารอบ) ' +
          'หรือ (2) รับเงินสดคืนจากหน้าร้านที่เมนูรับเงินสดคืน',
      });
    }
    if (arms.includes('SHOP_COLLECT')) {
      views.push({
        arm: 'SHOP_COLLECT',
        label: 'หน้าร้านรับเงินแทน',
        amount: row.shopCollect,
        ageDays: row.shopCollectAgeDays ?? thresholdDays,
        howTo: 'ล้างโดยรับโอนจากหน้าร้าน (บันทึกรับเงินที่หน้าร้านเก็บแทน — Dr เงินสด/ธนาคาร / Cr 11-2107)',
      });
    }
    // แขนที่แก่ที่สุดขึ้นก่อน — ใช้เป็นหัวเรื่องของ Todo
    return views.sort((a, b) => b.ageDays - a.ageDays);
  }

  private buildTitle(row: ShopReceivableAgingRow, views: ArmView[]): string {
    const primary = views[0];
    return (
      `ลูกหนี้-หน้าร้าน ${row.contractNumber} ค้างเกิน ${primary.ageDays} วัน ` +
      `(${primary.label} ${formatAmount(primary.amount)} บาท)`
    );
  }

  private buildDescription(
    row: ShopReceivableAgingRow,
    views: ArmView[],
    thresholdDays: number,
  ): string {
    const lines: string[] = [
      `ลูกหนี้-หน้าร้าน (11-2107) ของสัญญา ${row.contractNumber} (${row.customerName}) ` +
        `ค้างเกินเกณฑ์ ${thresholdDays} วัน:`,
    ];

    for (const v of views) {
      lines.push(`• ${v.label} ${formatAmount(v.amount)} บาท · ค้าง ${v.ageDays} วัน`);
      if (v.arm === 'INTERCO') {
        lines.push(
          `   - เครดิตเปลี่ยนเครื่อง (SWAP_CREDIT) ${formatAmount(row.swapCreditGross)} บาท · ` +
            `เรียกคืนจากยกเลิก (PAYOUT_RECALL) ${formatAmount(row.payoutRecallGross)} บาท · ` +
            `หักไปแล้วในรอบจ่าย ${formatAmount(row.settledDeduction)} บาท`,
        );
      }
      lines.push(`   - วิธีล้าง: ${v.howTo}`);
    }

    if (row.bookMismatch) {
      lines.push(
        `⚠ สองสมุดไม่ตรงกัน: ฝั่ง FINANCE ${formatAmount(row.intercoNet)} บาท vs ` +
          `ฝั่ง SHOP (S21-3001) ${formatAmount(row.shopMirrorNet)} บาท — ` +
          `ตรวจก่อนหักกลบ/รับเงิน (ห้ามโพสต์ข้างเดียว)`,
      );
    }

    lines.push(
      `ดูรายละเอียดที่หน้าจ่ายให้หน้าร้าน → แท็บ "อายุลูกหนี้หน้าร้าน" · contractId: ${row.contractId}`,
    );
    return lines.join('\n');
  }

  private alarm(row: ShopReceivableAgingRow, views: ArmView[], thresholdDays: number): void {
    Sentry.captureMessage('Shop receivable aged past threshold', {
      level: 'warning',
      tags: { subsystem: 'interco-netting' },
      extra: {
        contractId: row.contractId,
        contractNumber: row.contractNumber,
        thresholdDays,
        overdueArms: views.map((v) => v.arm).join(','),
        intercoNet: row.intercoNet.toFixed(2),
        intercoAgeDays: row.intercoAgeDays,
        shopCollect: row.shopCollect.toFixed(2),
        shopCollectAgeDays: row.shopCollectAgeDays,
        shopMirrorNet: row.shopMirrorNet.toFixed(2),
        bookMismatch: row.bookMismatch,
      },
    });
  }
}
