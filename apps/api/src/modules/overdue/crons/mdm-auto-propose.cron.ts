import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { MdmLockService } from '../mdm-lock.service';
import { OwnerAlertHelper } from '../owner-alert.helper';

@Injectable()
export class MdmAutoProposeCron {
  private readonly logger = new Logger(MdmAutoProposeCron.name);

  constructor(
    private prisma: PrismaService,
    private mdmLockService: MdmLockService,
    private ownerAlertHelper: OwnerAlertHelper,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async run(): Promise<{ uncontactable: number; noPromise: number }> {
    try {
      const enabledCfg = await this.prisma.systemConfig.findUnique({
        where: { key: 'mdm_auto_propose_enabled' },
      });
      if (enabledCfg?.value !== 'true') {
        this.logger.log('mdm_auto_propose_enabled=false — skipping');
        return { uncontactable: 0, noPromise: 0 };
      }

      const uncontactableHours = Number(
        (
          await this.prisma.systemConfig.findUnique({
            where: { key: 'mdm_uncontactable_threshold_hours' },
          })
        )?.value ?? 72,
      );
      const noPromiseDays = Number(
        (
          await this.prisma.systemConfig.findUnique({
            where: { key: 'mdm_no_promise_threshold_days' },
          })
        )?.value ?? 3,
      );

      const now = new Date();
      const hoursAgo = new Date(now.getTime() - uncontactableHours * 60 * 60 * 1000);
      const daysAgo = new Date(now.getTime() - noPromiseDays * 24 * 60 * 60 * 1000);

      // M2: resolve SYSTEM user once per run — was being refetched per contract
      // in MdmLockService.proposeAuto (N+1 query). Runs of 100+ contracts now
      // save 99+ pointless user lookups.
      const systemUser = await this.prisma.user.findFirst({
        where: { isSystemUser: true },
        select: { id: true },
      });
      const systemUserId = systemUser?.id;

      // UNCONTACTABLE_3D — >=3 NO_ANSWER in window, no ANSWERED/PROMISED interleaved
      const uncontactable = await this.prisma.$queryRaw<{ contract_id: string }[]>`
        SELECT "contract_id"
        FROM "call_logs"
        WHERE "called_at" >= ${hoursAgo}
          AND "result" = 'NO_ANSWER'
        GROUP BY "contract_id"
        HAVING COUNT(*) >= 3
          AND NOT EXISTS (
            SELECT 1 FROM "call_logs" c2
            WHERE c2."contract_id" = "call_logs"."contract_id"
              AND c2."called_at" >= ${hoursAgo}
              AND c2."result" IN ('ANSWERED','PROMISED')
          )
      `;

      for (const { contract_id } of uncontactable) {
        try {
          await this.mdmLockService.proposeAuto(
            contract_id,
            'UNCONTACTABLE_3D',
            `ติดต่อไม่ได้ ${uncontactableHours}h ที่ผ่านมา (NO_ANSWER ≥ 3 ครั้ง)`,
            systemUserId,
          );
        } catch (err) {
          Sentry.captureException(err, {
            tags: { cron: 'mdm-auto-propose', trigger: 'UNCONTACTABLE_3D' },
            extra: { contractId: contract_id },
          });
        }
      }

      // NO_PROMISE_3D — OVERDUE >= N days, no future settlement, no recent payment
      const flaggedSet = new Set(uncontactable.map((r) => r.contract_id));
      const noPromiseContracts = await this.prisma.contract.findMany({
        where: {
          status: 'OVERDUE',
          deletedAt: null,
          payments: {
            some: {
              dueDate: { lt: daysAgo },
              status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
            },
          },
          callLogs: {
            none: {
              result: 'PROMISED',
              settlementDate: { gte: now },
            },
          },
        },
        select: { id: true },
      });

      let noPromiseCount = 0;
      for (const { id } of noPromiseContracts) {
        if (flaggedSet.has(id)) continue; // already handled by UNCONTACTABLE branch
        try {
          await this.mdmLockService.proposeAuto(
            id,
            'NO_PROMISE_3D',
            `ค้าง ≥ ${noPromiseDays} วัน ไม่มีนัดชำระและไม่จ่าย`,
            systemUserId,
          );
          noPromiseCount++;
        } catch (err) {
          Sentry.captureException(err, {
            tags: { cron: 'mdm-auto-propose', trigger: 'NO_PROMISE_3D' },
            extra: { contractId: id },
          });
        }
      }

      this.logger.log(
        `MDM auto-propose: uncontactable=${uncontactable.length}, no_promise=${noPromiseCount}`,
      );

      // Alert OWNER if anything new was proposed
      const totalProposed = uncontactable.length + noPromiseCount;
      if (totalProposed > 0) {
        try {
          const msg = `[ติดตามหนี้] มีคำขอล็อคเครื่องใหม่ ${totalProposed} รายการรออนุมัติ (ติดต่อไม่ได้ ${uncontactable.length} / ไม่มีนัด ${noPromiseCount}) เปิด /collections แท็บ "อนุมัติ" เพื่อตรวจ`;
          await this.ownerAlertHelper.sendToAllOwners(msg, 'mdm-auto-propose');
        } catch (err) {
          Sentry.captureException(err, { tags: { cron: 'mdm-auto-propose', step: 'owner-alert' } });
        }
      }

      return { uncontactable: uncontactable.length, noPromise: noPromiseCount };
    } catch (err) {
      Sentry.captureException(err, { tags: { cron: 'mdm-auto-propose' } });
      this.logger.error(`mdm-auto-propose failed: ${err instanceof Error ? err.message : err}`);
      return { uncontactable: 0, noPromise: 0 };
    }
  }
}
