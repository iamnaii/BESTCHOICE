import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { bangkokCalendarParts, daysInMonth } from '../../utils/date.util';
import { DEVICE_RETURN_TODO_TAG } from './device-return-notify.service';

/** ใบค้างยืนยันเกินกี่วันจึงเตือน (spec §8) */
const STALE_DAYS = 3;
/** เหลือกี่วันก่อนสิ้นเดือน BKK จึงเตือนแรง (spec §8: ≤ 2 วัน) */
const MONTH_END_WINDOW_DAYS = 2;
const DAY_MS = 86_400_000;

interface PendingRow {
  id: string;
  docNumber: string;
  createdAt: Date;
  contract: { contractNumber: string };
  customer: { name: string };
  receivingBranch: { name: string };
}

/**
 * เตือน FINANCE เรื่องใบรับเครื่องคืนที่ค้างยืนยัน (spec 2026-09-20 §8 "ช่องว่างข้ามเดือน"):
 * confirm บังคับ paymentDate เดือนปัจจุบัน ⇒ ใบที่สร้าง 30 ก.ย. แต่ยืนยัน 2 ต.ค. ได้ JE/ใบลดหนี้เดือน ต.ค.
 * จึงต้องดันให้ยืนยันก่อนสิ้นเดือน.
 *
 * - Todo MEDIUM ต่อใบที่ PENDING_CONFIRM เกิน 3 วัน — dedup ต่อใบ (tag + docNumber ใน title + ยังไม่ DONE)
 * - Todo HIGH หนึ่งใบต่อเดือนเมื่อวันนี้อยู่ใน 2 วันสุดท้ายของเดือน BKK และมีใบค้างใด ๆ (dedup ด้วย
 *   `สิ้นเดือน yyyy-MM` ใน title) — แม้ใบจะยังไม่ถึง 3 วันก็เตือน เพราะรอไม่ได้ข้ามเดือน
 *
 * doctrine R-1 (pattern shop-receivable-aging.cron.ts): root PrismaService เท่านั้น, ไม่อยู่บนเส้นทางเงิน,
 * ห้าม throw ออกจาก tick (outer try/catch + per-row try/catch). ไม่แตะ GL/สถานะใบ.
 */
@Injectable()
export class DeviceReturnPendingCron {
  private readonly logger = new Logger(DeviceReturnPendingCron.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Daily 09:20 BKK — staggered หลัง 09:07 (interco aging) / 09:15 (letters) */
  @Cron('20 9 * * *', { timeZone: 'Asia/Bangkok' })
  async tick(): Promise<{
    pending: number;
    stale: number;
    todosCreated: number;
    monthEnd: boolean;
    monthEndTodoCreated: boolean;
  }> {
    try {
      const now = new Date();
      const pending: PendingRow[] = await this.prisma.deviceReturn.findMany({
        where: { status: 'PENDING_CONFIRM', deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          docNumber: true,
          createdAt: true,
          contract: { select: { contractNumber: true } },
          customer: { select: { name: true } },
          receivingBranch: { select: { name: true } },
        },
      });

      // bangkokCalendarParts คืน month แบบ 0-indexed (ตรงกับ daysInMonth)
      const { year, month, day } = bangkokCalendarParts(now);
      const monthEnd = day >= daysInMonth(year, month) - MONTH_END_WINDOW_DAYS + 1;
      const yyyyMm = `${year}-${String(month + 1).padStart(2, '0')}`;

      if (pending.length === 0) {
        return { pending: 0, stale: 0, todosCreated: 0, monthEnd, monthEndTodoCreated: false };
      }

      const staleRows = pending.filter(
        (r) => now.getTime() - r.createdAt.getTime() >= STALE_DAYS * DAY_MS,
      );

      const systemUser = await this.prisma.user.findFirst({
        where: { isSystemUser: true, deletedAt: null },
        select: { id: true },
      });
      if (!systemUser) {
        // ไม่มีช่องทาง Todo เลย — Sentry เป็นช่องทางเดียวที่เหลือ
        Sentry.captureMessage('device-return pending cron: SYSTEM user missing — Todos skipped', {
          level: 'warning',
          tags: { subsystem: 'device-return', cron: 'device-return-pending' },
          extra: { pending: pending.length, stale: staleRows.length, monthEnd },
        });
        this.logger.error(
          `[device-return] ไม่พบผู้ใช้ SYSTEM — ข้ามการสร้าง Todo (ค้าง ${pending.length} ใบ, เกิน ${STALE_DAYS} วัน ${staleRows.length} ใบ)`,
        );
        return {
          pending: pending.length,
          stale: staleRows.length,
          todosCreated: 0,
          monthEnd,
          monthEndTodoCreated: false,
        };
      }

      let todosCreated = 0;
      for (const row of staleRows) {
        try {
          const ageDays = Math.floor((now.getTime() - row.createdAt.getTime()) / DAY_MS);
          if (await this.hasOpenTodo(row.docNumber)) continue;
          await this.prisma.todo.create({
            data: {
              title: `ใบรับเครื่องคืน ${row.docNumber} รอ FINANCE ยืนยันเกิน ${ageDays} วัน (สัญญา ${row.contract.contractNumber})`,
              description:
                `ลูกค้า ${row.customer.name} · สาขาที่รับ ${row.receivingBranch.name} · สร้างเมื่อ ${this.bkkDate(row.createdAt)}\n` +
                `ยืนยัน/ส่งกลับที่หน้ายึดคืน → ตาราง "รอ FINANCE ยืนยัน" (ยืนยันได้เฉพาะเดือนปัจจุบัน — ใบข้ามเดือนจะได้ JE/ใบลดหนี้เดือนถัดไป)\n` +
                `deviceReturnId: ${row.id}`,
              priority: 'MEDIUM',
              tags: [DEVICE_RETURN_TODO_TAG],
              createdById: systemUser.id,
            },
          });
          todosCreated++;
        } catch (err) {
          Sentry.captureException(err, {
            tags: { subsystem: 'device-return', cron: 'device-return-pending' },
            extra: { deviceReturnId: row.id, docNumber: row.docNumber },
          });
          this.logger.error(
            `[device-return] สร้าง Todo ของใบ ${row.docNumber} ล้มเหลว: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      let monthEndTodoCreated = false;
      if (monthEnd) {
        try {
          const marker = `สิ้นเดือน ${yyyyMm}`;
          if (!(await this.hasOpenTodo(marker))) {
            const list = pending.map(
              (r) =>
                `• ${r.docNumber} (สัญญา ${r.contract.contractNumber} · ${r.customer.name} · สาขา ${r.receivingBranch.name})`,
            );
            await this.prisma.todo.create({
              data: {
                title: `ใบรับเครื่องคืนค้างยืนยัน ${pending.length} ใบ ก่อน${marker} — ยืนยันภายในเดือนนี้ ไม่งั้น JE/ใบลดหนี้ตกเดือนถัดไป`,
                description:
                  `การยืนยันบังคับวันลงบัญชีเดือนปัจจุบัน (ใบลดหนี้ต้องอยู่งวดภาษีเดียวกับ JE) — ใบที่ค้างข้ามเดือนจะลงบัญชีเดือนถัดไป\n` +
                  list.join('\n') +
                  `\nข้อมูล ณ ${this.bkkDate(now)} (เวลาไทย)`,
                priority: 'HIGH',
                tags: [DEVICE_RETURN_TODO_TAG],
                createdById: systemUser.id,
              },
            });
            monthEndTodoCreated = true;
          }
        } catch (err) {
          Sentry.captureException(err, {
            tags: { subsystem: 'device-return', cron: 'device-return-pending', step: 'month-end' },
          });
          this.logger.error(
            `[device-return] สร้าง Todo สิ้นเดือนล้มเหลว: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      this.logger.log(
        `[device-return] pending=${pending.length} stale=${staleRows.length} todosCreated=${todosCreated} monthEnd=${monthEnd} monthEndTodoCreated=${monthEndTodoCreated}`,
      );
      return {
        pending: pending.length,
        stale: staleRows.length,
        todosCreated,
        monthEnd,
        monthEndTodoCreated,
      };
    } catch (outerErr) {
      Sentry.captureException(outerErr, {
        tags: { subsystem: 'device-return', cron: 'device-return-pending', scope: 'tick' },
      });
      this.logger.error(
        `[device-return] tick ล้มเหลว: ${outerErr instanceof Error ? outerErr.message : String(outerErr)}`,
      );
      return { pending: 0, stale: 0, todosCreated: 0, monthEnd: false, monthEndTodoCreated: false };
    }
  }

  /** dedup: Todo tag device-return ที่ title มีข้อความนี้และยังไม่ DONE */
  private async hasOpenTodo(titleContains: string): Promise<boolean> {
    const existing = await this.prisma.todo.findFirst({
      where: {
        tags: { has: DEVICE_RETURN_TODO_TAG },
        title: { contains: titleContains },
        status: { not: 'DONE' },
        deletedAt: null,
      },
      select: { id: true },
    });
    return !!existing;
  }

  /** yyyy-mm-dd ตามเวลาไทย */
  private bkkDate(date: Date): string {
    return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  }
}
