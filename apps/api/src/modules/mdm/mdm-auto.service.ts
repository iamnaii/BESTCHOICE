import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FINANCE_LINE_RECIPIENT_SELECT,
  financeLineRecipient,
} from '../line-oa/services/otp-verified-customer';
import { LineMessagePayload } from '../line-oa/dto/webhook-event.dto';
import { LineOaService } from '../line-oa/line-oa.service';
import { MDM_AUTO_LOCK_AUDIT } from '../notifications/services/collections-notifier.service';
import { MdmService } from './mdm.service';

export interface MdmAutoSettings {
  autoLockEnabled: boolean;
  autoLockDays: number;
  autoUnlockEnabled: boolean;
  notifyLine: boolean;
}

export interface AutoLockResult {
  locked: number;
  skipped: number;
  failed: number;
}

@Injectable()
export class MdmAutoService {
  private readonly logger = new Logger(MdmAutoService.name);

  constructor(
    private prisma: PrismaService,
    private mdmService: MdmService,
    private lineOaService: LineOaService,
  ) {}

  // ─── Settings ───────────────────────────────────────────

  async getSettings(): Promise<MdmAutoSettings> {
    const keys = [
      'mdm.autoLockEnabled',
      'mdm.autoLockDays',
      'mdm.autoUnlockEnabled',
      'mdm.notifyLine',
    ];

    const rows = await this.prisma.systemConfig.findMany({
      where: { key: { in: keys } },
    });

    const map = new Map(rows.map((r) => [r.key, r.value]));

    return {
      autoLockEnabled: map.get('mdm.autoLockEnabled') === 'true',
      autoLockDays: parseInt(map.get('mdm.autoLockDays') ?? '30', 10) || 30,
      autoUnlockEnabled: map.get('mdm.autoUnlockEnabled') === 'true',
      notifyLine: map.get('mdm.notifyLine') !== 'false', // default true
    };
  }

  // ─── Auto Lock ──────────────────────────────────────────

  /**
   * Called by cron daily. Locks overdue contracts that exceed the configured days threshold.
   *
   * Task 30 รอบ 4 m1 — **ไม่ส่งแจ้งล็อกถึงลูกค้าตอนนี้** (01:30 — เดิมส่ง `mdm.lock_notice` ทันทีทาง Flex ของแม่แบบซึ่งไม่ผ่านด่านเวลาทำการ):
   * ล็อกสำเร็จแล้วลงแถว audit ของรอบระบบ (`MDM_AUTO_LOCK_AUDIT` · `ip_address = 'system-cron'`) ใน tx เดียวกับ `mdmLockedAt` — รอบเช้า 08:05
   * (`CollectionsNotifierService.sendOvernightCollectionsNotices`) อ่านแล้วแจ้งเครื่องที่ยังล็อกอยู่ · เดิมรอบนี้ไม่มีแถว audit เลยและ `mdmLockedAt`
   * แยกล็อกอัตโนมัติจากพนักงานกดล็อก (`MdmService.lockContract` ตั้งค่าเดียวกัน) ไม่ได้ · เวลาล็อกไม่เปลี่ยน
   */
  async autoLockOverdueContracts(): Promise<AutoLockResult> {
    const settings = await this.getSettings();

    if (!settings.autoLockEnabled) {
      this.logger.debug('MDM auto-lock disabled — skipping');
      return { locked: 0, skipped: 0, failed: 0 };
    }

    // Find overdue/default contracts that are not yet MDM-locked and have an IMEI
    // Limit to 80 per run to stay within MDM rate limit (100 req/60s — each lock needs ~2 calls)
    const contracts = await this.prisma.contract.findMany({
      where: {
        status: { in: ['OVERDUE', 'DEFAULT'] },
        mdmLockedAt: null,
        deletedAt: null,
        product: {
          imeiSerial: { not: null },
        },
      },
      include: {
        product: { select: { id: true, imeiSerial: true } },
        payments: {
          where: {
            status: { in: ['OVERDUE', 'PENDING'] },
            dueDate: { lt: new Date() },
            paidAt: null,
          },
          orderBy: { dueDate: 'asc' },
          take: 1,
        },
      },
      take: 80,
      orderBy: { createdAt: 'asc' },
    });

    let locked = 0;
    let skipped = 0;
    let failed = 0;

    // ผู้บันทึกแถว audit — ไม่มี = ไม่ล็อกเลย (ล็อกโดยไม่มีแถว = แจ้งลูกค้าหายเงียบ) · ข้อความเดียวกับรอบเปลี่ยนสถานะ 00:30 ซึ่งต้องมีก่อนอยู่แล้ว
    const systemUser =
      contracts.length > 0
        ? await this.prisma.user.findFirst({ where: { isSystemUser: true }, select: { id: true } })
        : null;
    if (contracts.length > 0 && !systemUser) {
      throw new ServiceUnavailableException(
        'SYSTEM user not found — seed collections-foundation must run first',
      );
    }

    for (const contract of contracts) {
      const imei = contract.product?.imeiSerial;
      if (!imei) {
        skipped++;
        continue;
      }

      // Calculate daysOverdue from oldest unpaid payment's dueDate
      const oldestDue = contract.payments[0]?.dueDate;
      if (!oldestDue) {
        skipped++;
        continue;
      }

      const daysOverdue = Math.floor((Date.now() - oldestDue.getTime()) / (1000 * 60 * 60 * 24));

      if (daysOverdue < settings.autoLockDays) {
        skipped++;
        continue;
      }

      try {
        // Throttle: 1s delay between MDM calls to stay within 100 req/60s
        if (locked + failed > 0) {
          await new Promise((r) => setTimeout(r, 1000));
        }

        const reason = `ค้างชำระ ${daysOverdue} วัน (สัญญา ${contract.contractNumber})`;

        // (Audit finding P1) Call the MDM API FIRST, then write the DB.
        // The previous order wrote `mdmLockedAt` optimistically and rolled
        // back on failure — but a process kill / OOM between the two await
        // calls left the DB marked locked while the device was unlocked,
        // a phantom-lock state with no reconciliation path. Rollback only
        // covered explicit error returns, not abrupt termination.
        let result: { success: boolean; message?: string };
        try {
          result = await this.mdmService.lockDeviceByImei(imei, reason);
        } catch (err) {
          this.logger.error(
            `MDM auto-lock: API error for contract ${contract.contractNumber}: ${err instanceof Error ? err.message : err}`,
          );
          throw err;
        }

        if (result.success) {
          await this.prisma.$transaction([
            this.prisma.contract.update({
              where: { id: contract.id },
              data: { mdmLockedAt: new Date() },
            }),
            this.prisma.auditLog.create({
              data: {
                userId: systemUser!.id,
                action: MDM_AUTO_LOCK_AUDIT.action,
                entity: 'contract',
                entityId: contract.id,
                newValue: {
                  source: MDM_AUTO_LOCK_AUDIT.source,
                  reason,
                  daysOverdue,
                  notifyCustomer: settings.notifyLine,
                },
                ipAddress: 'system-cron',
              },
            }),
          ]);

          this.logger.log(
            `MDM auto-lock: locked ${imei} for contract ${contract.contractNumber} (${daysOverdue} days overdue)`,
          );

          locked++;
        } else {
          this.logger.warn(
            `MDM auto-lock: failed to lock ${imei} for contract ${contract.contractNumber} — ${result.message}`,
          );
          Sentry.captureMessage(`MDM auto-lock failed: ${contract.contractNumber}`, {
            level: 'warning',
            extra: { imei, daysOverdue, result },
          });
          failed++;
        }
      } catch (err) {
        this.logger.error(
          `MDM auto-lock: unexpected error for contract ${contract.contractNumber}`,
          err,
        );
        Sentry.captureException(err, {
          tags: { kind: 'mdm-auto-lock' },
          extra: { contractId: contract.id, imei },
        });
        failed++;
      }
    }

    return { locked, skipped, failed };
  }

  // ─── Auto Unlock ────────────────────────────────────────

  /**
   * Called after payment is received. Non-blocking — errors are logged but not thrown.
   */
  async autoUnlockAfterPayment(contractId: string): Promise<void> {
    try {
      const settings = await this.getSettings();

      if (!settings.autoUnlockEnabled) {
        return;
      }

      const contract = await this.prisma.contract.findUnique({
        where: { id: contractId },
        include: {
          product: { select: { id: true, imeiSerial: true } },
          customer: { select: { id: true, name: true, ...FINANCE_LINE_RECIPIENT_SELECT } },
        },
      });

      if (!contract) {
        this.logger.warn(`MDM auto-unlock: contract ${contractId} not found`);
        return;
      }

      // Only unlock if currently locked
      if (!contract.mdmLockedAt) {
        return;
      }

      const imei = contract.product?.imeiSerial;
      if (!imei) {
        return;
      }

      // Check if there are any remaining unpaid overdue payments
      const overdueCount = await this.prisma.payment.count({
        where: {
          contractId,
          status: 'OVERDUE',
          paidAt: null,
          deletedAt: null,
        },
      });

      if (overdueCount > 0) {
        this.logger.debug(
          `MDM auto-unlock: contract ${contract.contractNumber} still has ${overdueCount} overdue payments — not unlocking`,
        );
        return;
      }

      const result = await this.mdmService.unlockDeviceByImei(imei);

      if (result.success) {
        await this.prisma.contract.update({
          where: { id: contractId },
          data: { mdmLockedAt: null },
        });

        this.logger.log(
          `MDM auto-unlock: unlocked ${imei} for contract ${contract.contractNumber}`,
        );

        if (settings.notifyLine) {
          await this.notifyCustomerUnlock(contract);
        }
      } else {
        this.logger.warn(
          `MDM auto-unlock: failed to unlock ${imei} for contract ${contract.contractNumber} — ${result.message}`,
        );
        Sentry.captureMessage(`MDM auto-unlock failed: ${contract.contractNumber}`, {
          level: 'warning',
          extra: { imei, result },
        });
      }
    } catch (err) {
      // Non-blocking — log but do not rethrow
      this.logger.error(`MDM auto-unlock: unexpected error for contract ${contractId}`, err);
      Sentry.captureException(err, {
        tags: { kind: 'mdm-auto-unlock' },
        extra: { contractId },
      });
    }
  }

  // ─── LINE Notifications ─────────────────────────────────

  private async notifyCustomerUnlock(contract: {
    contractNumber: string;
    customer: { name: string; lineLinks: { lineUserId: string }[] } | null;
  }): Promise<void> {
    // ปลายทาง LINE การเงิน = แถว OTP ของลูกค้า (Task 22 I-1 ง) ไม่ใช่คอลัมน์ line_id_finance ที่อาจค้าง
    const lineId = financeLineRecipient(contract.customer);
    if (!lineId) return;

    try {
      const message =
        `✅ แจ้งเตือนจาก BESTCHOICE\n` +
        `สัญญาเลขที่: ${contract.contractNumber}\n` +
        `ขอบคุณสำหรับการชำระค่างวด เครื่องของท่านได้รับการปลดล็อคแล้ว`;

      await this.lineOaService.pushMessage(
        lineId,
        [{ type: 'text', text: message } as LineMessagePayload],
        'line-finance',
      );
      this.logger.log(
        `MDM unlock LINE notify sent to customer (contract ${contract.contractNumber})`,
      );
    } catch (err) {
      this.logger.warn(
        `MDM unlock LINE notify failed for contract ${contract.contractNumber}: ${err}`,
      );
    }
  }
}
