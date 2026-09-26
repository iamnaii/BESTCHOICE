// PR 3 Task 2 — AfterSalesLineService: ที่เดียวที่ส่ง LINE ของเคสหลังการขาย
//
// notifyMoment(caseId, moment, actorId) ส่ง LINE ให้ลูกค้า 1 จังหวะ (RECEIVED/READY/CLOSED/
// PICKUP_REMINDER) แล้วบันทึกผลเป็น AfterSalesEvent เสมอ — ไม่ throw ไม่ว่ากรณีใด เพื่อให้
// ผู้เรียก (Task 3 case/repair/exchange services, Task 4 cron) เรียกแบบ `void` หลัง commit ได้
// โดยไม่ต้อง try/catch ของตัวเอง. hasLineAttempt ให้ cron ใช้กันส่งซ้ำ (หนึ่งความพยายามต่อจังหวะ).
//
// PII: `customer.lineIdShop` อยู่ในเมธอดนี้เท่านั้น — ห้ามหลุดไปที่ template `data`, event `note`,
// หรือ logger call ใด ๆ (test (e) ปักไว้).

import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { IntegrationConfigService } from '../../integrations/integration-config.service';
import { readBoolFlag } from '../../../utils/config.util';
import { stageSince } from '../utils/after-sales-stage.util';
import {
  AFTER_SALES_LINE_EVENT_TYPE,
  AfterSalesLineMoment,
  buildLiffLine,
  buildLineData,
  lineEventNote,
  lineEventTag,
  LineCaseRow,
} from '../utils/after-sales-line-copy.util';

type NotifyResult = {
  status: 'SENT' | 'NO_LINK' | 'DISABLED' | 'FAILED' | 'BLOCKED' | 'SKIPPED_DUP';
};

/** สถานะจาก NotificationsService.sendFromTemplate ที่นับว่า "อยู่ระหว่างส่ง/ส่งแล้ว" ไม่ใช่ถูกบล็อก */
const IN_FLIGHT_STATUSES = new Set(['SENT', 'PENDING', 'RETRY_PENDING', 'DELAYED']);

interface ReplacementInfo {
  brand: string;
  model: string;
  storage: string | null;
  imeiSerial: string | null;
  shopWarrantyEndDate: string | null;
}

/** select ที่ `notifyMoment` โหลดเคสมาด้วย — `satisfies` กันไม่ให้ select กับ type ที่ใช้จริงเพี้ยนกัน */
const CASE_FOR_LINE_SELECT = {
  id: true,
  caseNumber: true,
  outcome: true,
  symptom: true,
  deviceBrand: true,
  deviceModel: true,
  deviceImei: true,
  warrantySnapshot: true,
  replacementProductId: true,
  replacementContractId: true,
  // final fix I-5 — PRICED_EXCHANGE: เครื่อง/สัญญาที่คุ้มครองเครื่องทดแทนอยู่บนคำขอ ไม่ใช่บนเคส
  exchangeRequest: {
    select: { mode: true, oldContractId: true, newContractId: true, newProductId: true },
  },
  stage: true,
  receivedAt: true,
  approvedAt: true,
  customer: { select: { id: true, lineIdShop: true } },
  branch: { select: { name: true } },
  repairTicket: {
    select: {
      payer: true,
      estimatedCost: true,
      actualCost: true,
      sentToRepairAt: true,
      repairedAt: true,
    },
  },
} satisfies Prisma.AfterSalesCaseSelect;

type CaseForLine = Prisma.AfterSalesCaseGetPayload<{ select: typeof CASE_FOR_LINE_SELECT }>;

@Injectable()
export class AfterSalesLineService {
  private readonly logger = new Logger(AfterSalesLineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly integrationConfig: IntegrationConfigService,
  ) {}

  /**
   * ใช้โดย cron (Task 4) กันส่งซ้ำ — cron ส่งแต่ละจังหวะของตัวเองได้ไม่เกินหนึ่งครั้งต่อเคส.
   * ความพยายามที่ไม่ผูก LINE / ส่งไม่สำเร็จ / ถูกบล็อก / ปิดสวิตช์ ก็นับเป็นความพยายามแล้ว: ตรวจแถว
   * AfterSalesEvent ที่ note ขึ้นต้นด้วย tag ของ eventType ไม่ว่า kind ใด (LINE_SENT /
   * LINE_SKIPPED_NO_LINK / NOTE) — การส่งซ้ำหลังล้มเป็นหน้าที่ของคิว retry ของ dispatcher ไม่ใช่ cron
   * (final fix I-1: เดิมนับเฉพาะ LINE_SENT ⇒ เคสไม่ผูก LINE งอกแถวทุกวัน และ FAILED ส่งซ้ำวันถัดไป)
   */
  async hasLineAttempt(caseId: string, eventType: string): Promise<boolean> {
    const hit = await this.prisma.afterSalesEvent.findFirst({
      where: { caseId, note: { startsWith: lineEventTag(eventType) } },
      select: { id: true },
    });
    return !!hit;
  }

  /** ห้าม throw — ผู้เรียกใช้ `void` หลัง commit */
  async notifyMoment(
    caseId: string,
    moment: AfterSalesLineMoment,
    actorId: string | null,
  ): Promise<NotifyResult> {
    const eventType = AFTER_SALES_LINE_EVENT_TYPE[moment];
    try {
      const c = await this.prisma.afterSalesCase.findFirst({
        where: { id: caseId, deletedAt: null },
        select: CASE_FOR_LINE_SELECT,
      });

      if (!c) {
        Sentry.captureMessage('after-sales line: case not found', {
          level: 'warning',
          tags: { subsystem: 'after-sales-line' },
          extra: { caseId, moment },
        });
        return { status: 'FAILED' };
      }

      const enabled = await readBoolFlag(this.prisma, 'after_sales_line_enabled', true);
      if (!enabled) {
        // `await` here (not a bare `return this.record(...)`) is load-bearing: a bare return
        // hands back the un-awaited promise, so a later rejection (e.g. the DB write itself
        // fails) would skip this function's own `catch` below and reject `notifyMoment`'s
        // promise straight through to the caller — breaking the "never throws" contract.
        return await this.record(
          caseId,
          'NOTE',
          lineEventNote(eventType, 'DISABLED'),
          actorId,
          'DISABLED',
        );
      }

      const to = c.customer.lineIdShop; // PII — อยู่ในเมธอดนี้เท่านั้น ห้ามหลุดเข้า data/note/log
      if (!to) {
        return await this.record(
          caseId,
          'LINE_SKIPPED_NO_LINK',
          lineEventNote(eventType, 'NO_LINK'),
          actorId,
          'NO_LINK',
        );
      }

      const replacement = await this.loadReplacement(c);
      const liffId = await this.integrationConfig.getValue('line-shop', 'liffId').catch(() => null);
      const liffLine = buildLiffLine(
        liffId ?? null,
        moment === 'CLOSED' ? 'ประกันของฉัน' : 'ดูสถานะเคส',
      );
      // readyAt: stageSince ของ READY_FOR_PICKUP เท่านั้น — ใช้ตัวช่วยเดียวกับหน้าเคส
      // (after-sales-stage.util.ts) ไม่คิดกติกา "since" ใหม่ซ้ำที่นี่
      const readyAt =
        c.stage === 'READY_FOR_PICKUP'
          ? stageSince('READY_FOR_PICKUP', c.repairTicket, c.receivedAt, c.approvedAt)
          : null;
      const data = buildLineData(this.toLineCaseRow(c, replacement, readyAt), moment, liffLine);

      const res = await this.notifications.sendFromTemplate(eventType, data, to, {
        customerId: c.customer.id,
        relatedId: caseId,
      });

      if (IN_FLIGHT_STATUSES.has(res.status)) {
        return await this.record(
          caseId,
          'LINE_SENT',
          lineEventNote(eventType, 'SENT'),
          actorId,
          'SENT',
        );
      }
      if (res.status === 'FAILED') {
        // final fix I-2 — dispatcher RESOLVE (ไม่ throw) ด้วย FAILED หลังส่ง 3 ครั้งไม่ผ่าน และตั้ง
        // log เป็น RETRY_PENDING ไว้ในคิว retry แล้ว (notification-dispatch.service.ts send() →
        // markForRetry) — เป็นความล้มเหลว ไม่ใช่การบล็อก: บอกพนักงานตามจริงว่าระบบจะลองส่งซ้ำเอง
        // + แจ้ง Sentry (ไม่มี PII — ห้าม lineIdShop/ชื่อลูกค้า) แบบเดียวกับ warranty-line-notifier
        Sentry.captureMessage('after-sales line: dispatcher returned FAILED', {
          level: 'warning',
          tags: { subsystem: 'after-sales-line', moment },
          extra: { caseId, notificationId: res.id ?? null },
        });
        return await this.record(
          caseId,
          'NOTE',
          lineEventNote(eventType, 'FAILED', 'ระบบจะลองส่งซ้ำอัตโนมัติ'),
          actorId,
          'FAILED',
        );
      }
      // BLOCKED (TEMPLATE_INACTIVE / compliance) — ตั้งใจปิด ไม่ยิง Sentry
      return await this.record(
        caseId,
        'NOTE',
        lineEventNote(eventType, 'BLOCKED', res.blockReason ?? res.status),
        actorId,
        'BLOCKED',
      );
    } catch (err) {
      Sentry.captureException(err, { tags: { subsystem: 'after-sales-line', moment } });
      this.logger.warn(
        `LINE ${eventType} ของเคส ${caseId} ส่งไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.record(
        caseId,
        'NOTE',
        lineEventNote(
          eventType,
          'FAILED',
          err instanceof Error ? err.message.slice(0, 80) : undefined,
        ),
        actorId,
        'FAILED',
      ).catch(() => undefined);
      return { status: 'FAILED' };
    }
  }

  /**
   * product ทดแทน + shopWarrantyEndDate ของ "สัญญาที่คุ้มครองเครื่องนั้นอยู่จริง" (final fix I-5) —
   * ไม่มีเครื่องทดแทน = ไม่มีการแลกเปลี่ยน (คืน null):
   * - เครื่อง = `replacementProductId` ?? `exchangeRequest.newProductId` (PRICED ไม่เคยตั้ง
   *   replacementProductId บนเคส)
   * - สัญญา: SAME_MODEL / CASH_SAME_MODEL (และ REPAIR ที่เปลี่ยนรุ่นเดิม) → `replacementContractId` ·
   *   PRICED_EXCHANGE → MEMO ย้ายเครื่องบนสัญญาเดิม (วันประกันไม่ได้เริ่มใหม่) = `oldContractId`,
   *   PRICED = สัญญาใหม่ `newContractId`
   */
  private async loadReplacement(c: CaseForLine): Promise<ReplacementInfo | null> {
    const productId = c.replacementProductId ?? c.exchangeRequest?.newProductId ?? null;
    if (!productId) return null;
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { brand: true, model: true, storage: true, imeiSerial: true },
    });
    if (!product) return null; // ถูกลบ/ไม่พบ — ไม่รู้จักเครื่องทดแทนแล้ว

    const coveringContractId =
      c.outcome === 'PRICED_EXCHANGE' && c.exchangeRequest
        ? c.exchangeRequest.mode === 'MEMO'
          ? c.exchangeRequest.oldContractId
          : c.exchangeRequest.newContractId
        : c.replacementContractId;

    let shopWarrantyEndDate: string | null = null;
    if (coveringContractId) {
      const contract = await this.prisma.contract.findFirst({
        where: { id: coveringContractId, deletedAt: null },
        select: { shopWarrantyEndDate: true },
      });
      shopWarrantyEndDate = contract?.shopWarrantyEndDate
        ? contract.shopWarrantyEndDate.toISOString()
        : null;
    }

    return {
      brand: product.brand,
      model: product.model,
      storage: product.storage,
      imeiSerial: product.imeiSerial,
      shopWarrantyEndDate,
    };
  }

  /**
   * แปลงแถว `AfterSalesCase` (+ replacement ที่โหลดแยก) ให้เข้ากับ `LineCaseRow` (Task 1) — mapper
   * นี้เป็น private ของ service นี้ตาม Ruling PF-1 (LineCaseRow คือ contract, ไม่ใช่ mapper).
   *
   * กับดักที่ต้องแปลง:
   * - `warrantySnapshot` เป็น Json ของ DB คนละคีย์กับ `LineCaseRow.warrantySnapshot` —
   *   map `shopWarrantyEnd → shopWarrantyEndDate`, `manufacturerWarrantyEnd → manufacturerWarrantyEndDate`.
   *   (`AfterSalesCaseService.buildCreateData` เขียนคีย์เป็น `shopWarrantyEndDate` ตรงชื่ออยู่แล้ว
   *   ผ่าน spread ของ `AfterSalesLookupService`'s `warranty` object — รองรับทั้งสองชื่อคีย์กัน
   *   ข้อมูลเก่า/สคีมาที่ยังไม่ sync กับโค้ดจริง) — snapshot ที่ไม่มี `status` เป็น string ถือว่า
   *   malformed/missing → ทั้งก้อนเป็น null.
   * - `repairTicket.estimatedCost`/`actualCost` เป็น Prisma.Decimal → string ผ่าน `.toString()`.
   * - `deviceStorage` ไม่มีคอลัมน์บน `AfterSalesCase` → เว้นว่างไว้ (undefined).
   * - `readyAt` คำนวณโดยผู้เรียก (`stageSince('READY_FOR_PICKUP', ...)` เฉพาะเมื่อ
   *   `c.stage === 'READY_FOR_PICKUP'`) แล้วส่งเข้ามาตรง ๆ — mapper นี้แค่วางค่าที่ได้รับ
   *   ไม่คำนวณเอง เพราะ `stageSince` เป็นกติกาเดียวกับหน้าเคส ห้ามมีสำเนาที่สอง
   */
  private toLineCaseRow(
    c: CaseForLine,
    replacement: ReplacementInfo | null,
    readyAt: Date | null,
  ): LineCaseRow {
    return {
      caseNumber: c.caseNumber,
      outcome: c.outcome,
      symptom: c.symptom,
      deviceBrand: c.deviceBrand,
      deviceModel: c.deviceModel,
      deviceImei: c.deviceImei,
      branch: { name: c.branch.name },
      warrantySnapshot: this.mapWarrantySnapshot(c.warrantySnapshot),
      repairTicket: c.repairTicket
        ? {
            payer: c.repairTicket.payer,
            estimatedCost: c.repairTicket.estimatedCost
              ? c.repairTicket.estimatedCost.toString()
              : null,
            actualCost: c.repairTicket.actualCost ? c.repairTicket.actualCost.toString() : null,
          }
        : null,
      replacement,
      readyAt,
      stage: c.stage,
    };
  }

  private mapWarrantySnapshot(json: Prisma.JsonValue): LineCaseRow['warrantySnapshot'] {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
    const obj = json as Record<string, unknown>;
    const status = obj.status;
    if (typeof status !== 'string') return null; // malformed/missing → ทั้งก้อนเป็น null
    return {
      status,
      shopWarrantyEndDate: this.firstStringField(obj, ['shopWarrantyEndDate', 'shopWarrantyEnd']),
      manufacturerWarrantyEndDate: this.firstStringField(obj, [
        'manufacturerWarrantyEndDate',
        'manufacturerWarrantyEnd',
      ]),
    };
  }

  private firstStringField(obj: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === 'string') return value;
    }
    return null;
  }

  private async record(
    caseId: string,
    kind: 'LINE_SENT' | 'LINE_SKIPPED_NO_LINK' | 'NOTE',
    note: string,
    actorId: string | null,
    status: NotifyResult['status'],
  ): Promise<NotifyResult> {
    await this.prisma.afterSalesEvent.create({ data: { caseId, kind, note, actorId } });
    return { status };
  }
}
