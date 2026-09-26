// PR 3 Task 4 — cron: เตือนรับเครื่องครบ N วัน (default 7) + จังหวะ 3 ("ปิดเคส") ของคำขอ
// เปลี่ยนเครื่องมีราคา (PRICED_EXCHANGE) ที่ contract engine ปิดให้เองตอนเปิดใช้สัญญาใหม่ —
// จุดนั้นไม่มี after-sales hook เลย (ต่างจาก RECEIVED/READY/CLOSED ของ REPAIR/MEMO ที่ Task 3
// เรียก `notifyMoment` ตรงจาก request handler ได้) จึงต้องมี cron มาจับแทน.
//
// ทั้งสองงานคุยกับ `AfterSalesLineService` เท่านั้น (`notifyMoment` / `hasLineAttempt`) — cron นี้
// ไม่รู้จัก repair-ticket/contract-exchange internals ใด ๆ และไม่คิดกติกา "since"/"reconcile" ใหม่
// ซ้ำ (ใช้ `reconcileStage`/`RECONCILE_SELECT` จาก Task 2 (list/summary ใช้ตัวเดียวกัน) และ
// `stageSince` จาก Task 1/2). ไม่ throw ออกจาก tick — per-row try/catch + outer try/catch ตาม
// doctrine ของ cron ทุกตัวในระบบ (pattern `device-return-pending.cron.ts`).

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { readBoolFlag, readIntFlag } from '../../../utils/config.util';
import { AfterSalesLineService } from '../services/after-sales-line.service';
import { reconcileStage, RECONCILE_SELECT } from '../services/after-sales-stage-reconcile';
import { stageSince } from '../utils/after-sales-stage.util';
import { AFTER_SALES_LINE_EVENT_TYPE } from '../utils/after-sales-line-copy.util';

const DAY_MS = 86_400_000;

/** จังหวะ 3 กันย้อนส่งของเก่าหลัง deploy — เฉพาะเคสที่ engine ปิดให้ภายใน N วันที่ผ่านมา */
const CLOSED_WINDOW_DAYS = 3;

/** เพดานอายุของการเตือนให้มารับ — รอบแรกหลัง deploy ต้องไม่เตือนเคสที่ค้างนานมาก (น่าจะส่งมอบไปแล้วแต่ไม่ได้บันทึก) */
const PICKUP_REMINDER_MAX_AGE_DAYS = 30;

/**
 * Ruling PF-2 — `ROW_SELECT` ของ `after-sales-query.service.ts` เป็น private และคงไว้เป็น
 * private ต่อไป. select ของคิว "เตือนรับเครื่อง" ต่อ `RECONCILE_SELECT` ที่ export จาก
 * `after-sales-stage-reconcile.ts` (ตัวเดียวกับที่ `after-sales-case.service.ts`/
 * `after-sales-exchange.service.ts` ใช้ reconcile อยู่แล้ว) เพิ่มเฉพาะฟิลด์ที่ `stageSince`
 * ต้องใช้ (`receivedAt`/`approvedAt` + `repairTicket.sentToRepairAt`/`repairedAt`) — ไม่ export
 * อะไรใหม่จาก query service และไม่คัด select มือซ้ำ. แถวที่ได้ยังตรง `ReconcilableCase`
 * (superset เชิงโครงสร้าง) จึงส่งเข้า `reconcileStage` ได้ตรง ๆ.
 */
const READY_SELECT = {
  ...RECONCILE_SELECT,
  receivedAt: true,
  approvedAt: true,
  repairTicket: {
    select: { ...RECONCILE_SELECT.repairTicket.select, sentToRepairAt: true, repairedAt: true },
  },
} satisfies Prisma.AfterSalesCaseSelect;

export interface AfterSalesLineTickResult {
  reminded: number;
  closedNotified: number;
  skipped: number;
  failed: number;
}

@Injectable()
export class AfterSalesLineCron {
  private readonly logger = new Logger(AfterSalesLineCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly line: AfterSalesLineService,
  ) {}

  @Cron('0 10 * * *', { timeZone: 'Asia/Bangkok' })
  async run(): Promise<void> {
    await this.tick();
  }

  async tick(now = new Date()): Promise<AfterSalesLineTickResult> {
    const out: AfterSalesLineTickResult = {
      reminded: 0,
      closedNotified: 0,
      skipped: 0,
      failed: 0,
    };
    try {
      if (!(await readBoolFlag(this.prisma, 'after_sales_line_enabled', true))) {
        // สวิตช์ปิด — คืนศูนย์ทุกช่องตรง ๆ (ไม่ใช่ sentinel -1: ค่าติดลบในตัวนับคือกับดักของ
        // แดชบอร์ด/สรุปที่บวกตัวเลขนี้เข้ากับตัวอื่นโดยไม่รู้ว่ามันคือ "ปิดอยู่")
        this.logger.log('after-sales line cron: disabled by after_sales_line_enabled');
        return out;
      }
      const days = await readIntFlag(this.prisma, 'after_sales_pickup_reminder_days', 7, 1, 60);

      // (1) เตือนรับเครื่องครบ N วัน — ผู้สมัคร: stored stage READY_FOR_PICKUP; reconcile ก่อน
      // ตัดสินเสมอ (เหมือน list/summary) — ใบซ่อมที่ถูกปิดนอก after-sales proxy ต้องไม่ถูกเตือน
      const ready = await this.prisma.afterSalesCase.findMany({
        where: { deletedAt: null, stage: 'READY_FOR_PICKUP' },
        select: READY_SELECT,
      });
      for (const row of ready) {
        try {
          const r = await reconcileStage(this.prisma, row);
          if (r.stage !== 'READY_FOR_PICKUP') {
            out.skipped++;
            continue;
          }
          const since = stageSince(
            'READY_FOR_PICKUP',
            row.repairTicket,
            row.receivedAt,
            row.approvedAt,
          );
          const age = now.getTime() - since.getTime();
          if (age < days * DAY_MS || age > PICKUP_REMINDER_MAX_AGE_DAYS * DAY_MS) {
            out.skipped++;
            continue;
          }
          if (await this.line.hasLineAttempt(row.id, AFTER_SALES_LINE_EVENT_TYPE.PICKUP_REMINDER)) {
            out.skipped++;
            continue;
          }
          const res = await this.line.notifyMoment(row.id, 'PICKUP_REMINDER', null);
          if (res.status === 'SENT') out.reminded++;
          else out.skipped++;
        } catch (e) {
          out.failed++;
          Sentry.captureException(e, {
            tags: { subsystem: 'after-sales-line', cron: 'after-sales-line', step: 'reminder' },
            extra: { caseId: row.id },
          });
        }
      }

      // (2) จังหวะ 3 ของเคสมีราคาที่ contract engine ปิดให้ตอนเปิดใช้สัญญาใหม่ (ไม่มี after-sales
      // hook ตรงจุดนั้น — reconcileStage เป็นทางเดียวที่ทำให้ stage กลายเป็น CLOSED). หน้าต่าง
      // 3 วันกันย้อนส่งเคสเก่าที่ปิดไปแล้วก่อน deploy งานนี้.
      const closed = await this.prisma.afterSalesCase.findMany({
        where: {
          deletedAt: null,
          outcome: 'PRICED_EXCHANGE',
          stage: 'CLOSED',
          cancelledAt: null,
          closedAt: { gte: new Date(now.getTime() - CLOSED_WINDOW_DAYS * DAY_MS) },
        },
        select: { id: true },
      });
      for (const c of closed) {
        try {
          if (await this.line.hasLineAttempt(c.id, AFTER_SALES_LINE_EVENT_TYPE.CLOSED)) {
            out.skipped++;
            continue;
          }
          const res = await this.line.notifyMoment(c.id, 'CLOSED', null);
          if (res.status === 'SENT') out.closedNotified++;
          else out.skipped++;
        } catch (e) {
          out.failed++;
          Sentry.captureException(e, {
            tags: { subsystem: 'after-sales-line', cron: 'after-sales-line', step: 'closed' },
            extra: { caseId: c.id },
          });
        }
      }

      this.logger.log(`after-sales line cron: ${JSON.stringify(out)}`);
      return out;
    } catch (err) {
      Sentry.captureException(err, {
        tags: { subsystem: 'after-sales-line', cron: 'after-sales-line', scope: 'tick' },
      });
      this.logger.error(
        'after-sales line cron failed',
        err instanceof Error ? err.stack : String(err),
      );
      return out;
    }
  }
}
