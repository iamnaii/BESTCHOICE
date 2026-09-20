import { Injectable, Logger } from '@nestjs/common';
import { LineChannelType } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/** tag ของ Todo ทุกใบในโมดูลนี้ (NO_LINE fallback + cron เตือนใบค้าง) — dedup อ่านค่านี้ตัวเดียว */
export const DEVICE_RETURN_TODO_TAG = 'device-return';

export type DeviceReturnLineEvent = 'DEVICE_RETURNED' | 'DEVICE_RETURN_CANCELED';

const RETURN_KIND_LABEL: Record<string, string> = {
  VOLUNTARY: 'คืนเครื่องเอง',
  REPOSSESSION: 'ยึดคืนหลังบอกเลิกสัญญา',
};

const SENTRY_TAGS = { subsystem: 'device-return' } as const;

/**
 * ไลน์แจ้งลูกค้าของใบรับเครื่องคืน (spec 2026-09-20 §5.5 — D3 ไม่มีลายเซ็น ใช้ข้อความทางเดียวแทน).
 * ส่งผ่านตัวส่งกลาง `NotificationsService.sendFromTemplate` (NotificationLog + retry + แม่แบบแก้เองได้
 * ที่ /notifications) — **ไม่ส่ง fallbackPhone** (ไลน์เท่านั้น ไม่ตก SMS). ผู้รับ = lineLinks FINANCE
 * ก่อน แล้วค่อย lineIdFinance (ตรรกะเดียวกับ credit-note-delivery.service.ts:108).
 *
 * NEVER throws — ผู้เรียก (create/reject/cancel/resend) await ได้โดยไม่ต้อง try/catch; ทุกทางล้ม
 * (ใบไม่พบ, dispatcher throw, เขียน DB ล้ม) ถูกกลืน + Sentry. ผลส่งเก็บบนใบ
 * (lineNotifyStatus SENT/FAILED/NO_LINE) — FAILED ให้ dispatcher retry เองผ่านคิว + ปุ่ม "ส่งซ้ำ";
 * NO_LINE → Todo MEDIUM tag device-return (dedup ต่อใบ) ให้สาขาแจ้งลูกค้าช่องทางอื่น.
 */
@Injectable()
export class DeviceReturnNotifyService {
  private readonly logger = new Logger(DeviceReturnNotifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async notify(deviceReturnId: string, eventType: DeviceReturnLineEvent): Promise<void> {
    try {
      const dr = await this.prisma.deviceReturn.findUnique({
        where: { id: deviceReturnId },
        include: {
          receivingBranch: { select: { name: true } },
          product: { select: { brand: true, model: true, storage: true } },
          contract: { select: { contractNumber: true } },
          customer: {
            select: {
              id: true,
              name: true,
              lineIdFinance: true,
              lineLinks: {
                where: { channel: LineChannelType.FINANCE, unlinkedAt: null, deletedAt: null },
                select: { lineUserId: true },
                take: 1,
              },
            },
          },
        },
      });
      if (!dr || dr.deletedAt) {
        this.logger.warn(
          `[device-return] notify ${eventType}: ใบ ${deviceReturnId} ไม่พบ/ถูกลบ — ข้าม`,
        );
        return;
      }

      const lineUserId = dr.customer.lineLinks[0]?.lineUserId ?? dr.customer.lineIdFinance ?? null;
      if (!lineUserId) {
        await this.record(dr.id, 'NO_LINE', null);
        await this.createNoLineTodo(
          dr.id,
          dr.docNumber,
          dr.contract.contractNumber,
          dr.customer.name,
        );
        return;
      }

      const data: Record<string, string> = {
        customerName: dr.customer.name,
        docNumber: dr.docNumber,
        contractNumber: dr.contract.contractNumber,
        deviceName: [dr.product.brand, dr.product.model, dr.product.storage]
          .filter(Boolean)
          .join(' '),
        branchName: dr.receivingBranch.name,
        receivedDate: this.bkkDate(dr.deviceReceivedAt),
        grade: dr.conditionGrade,
        returnKindLabel: RETURN_KIND_LABEL[dr.returnKind] ?? dr.returnKind,
      };

      let result: { id: string | null; status: string };
      try {
        result = await this.notifications.sendFromTemplate(eventType, data, lineUserId, {
          customerId: dr.customer.id,
          relatedId: dr.id,
        });
      } catch (err) {
        // แม่แบบหาย / dispatcher พัง — ห้ามขวางการรับเครื่อง (spec §5.5: การส่งไม่สำเร็จไม่ขวางการยืนยัน)
        this.logger.error(
          `[device-return] ส่งไลน์ ${eventType} ใบ ${dr.docNumber} ล้มเหลว: ${err instanceof Error ? err.message : String(err)}`,
        );
        Sentry.captureException(err, {
          tags: { ...SENTRY_TAGS, eventType },
          extra: { deviceReturnId },
        });
        await this.record(dr.id, 'FAILED', null);
        return;
      }

      await this.record(dr.id, result.status === 'SENT' ? 'SENT' : 'FAILED', result.id || null);
    } catch (err) {
      this.logger.error(
        `[device-return] notify ${eventType} ใบ ${deviceReturnId} พังนอกเส้นทางส่ง: ${err instanceof Error ? err.message : String(err)}`,
      );
      Sentry.captureException(err, {
        tags: { ...SENTRY_TAGS, eventType },
        extra: { deviceReturnId },
      });
    }
  }

  /** dd/MM/yyyy ตามเวลาไทย — ค.ศ. เพื่อไม่สับสนกับเลขที่ใบ (DR-YYYYMMDD) */
  private bkkDate(date: Date): string {
    return date.toLocaleDateString('en-GB', {
      timeZone: 'Asia/Bangkok',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  private async record(
    id: string,
    lineNotifyStatus: 'SENT' | 'FAILED' | 'NO_LINE',
    lineNotificationId: string | null,
  ): Promise<void> {
    await this.prisma.deviceReturn.update({
      where: { id },
      data: { lineNotifyStatus, lineNotifiedAt: new Date(), lineNotificationId },
    });
  }

  /** Dedup existing NO_LINE titles only; FINANCE reminders for the same document remain independent. */
  private async createNoLineTodo(
    deviceReturnId: string,
    docNumber: string,
    contractNumber: string,
    customerName: string,
  ): Promise<void> {
    const systemUser = await this.prisma.user.findFirst({
      where: { isSystemUser: true },
      select: { id: true },
    });
    if (!systemUser) {
      Sentry.captureMessage('device-return: NO_LINE but SYSTEM user missing — Todo skipped', {
        level: 'warning',
        tags: SENTRY_TAGS,
        extra: { deviceReturnId, docNumber },
      });
      return;
    }
    const existing = await this.prisma.todo.findFirst({
      where: {
        tags: { has: DEVICE_RETURN_TODO_TAG },
        title: {
          contains: docNumber,
          startsWith: `แจ้งลูกค้าไม่ได้ ไม่มีไลน์ผูก — ใบรับเครื่องคืน ${docNumber} (`,
        },
        status: { not: 'DONE' },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existing) return;
    await this.prisma.todo.create({
      data: {
        title: `แจ้งลูกค้าไม่ได้ ไม่มีไลน์ผูก — ใบรับเครื่องคืน ${docNumber} (${customerName})`,
        description:
          `ลูกค้าของสัญญา ${contractNumber} ยังไม่ผูก LINE การเงิน ระบบส่งข้อความรับเครื่องคืนไม่ได้ — ` +
          `แจ้งลูกค้าทางโทรศัพท์/หน้าร้าน แล้วชวนผูกไลน์ · deviceReturnId: ${deviceReturnId}`,
        priority: 'MEDIUM',
        tags: [DEVICE_RETURN_TODO_TAG],
        createdById: systemUser.id,
      },
    });
  }
}
