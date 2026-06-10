import {
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ContractLetterService } from '../contract-letter.service';
import { MdmLockService } from '../mdm-lock.service';
import { OwnerAlertHelper } from '../owner-alert.helper';
import { OverdueKpiService } from '../kpi.service';
import { OverdueAnalyticsService } from './overdue-analytics.service';

/**
 * Manual dunning-governance actions (approve/reject/hold/assign/escalate).
 *
 * Extracted from OverdueService as part of the behaviour-preserving decompose.
 * Each method wraps a $transaction (contract.update + auditLog pairs). `escalate`
 * re-enters the analytics seam via this.analytics.getBrokenPromiseCount.
 *
 * Bodies are verbatim from the original OverdueService (only dep resolution +
 * import paths + the getBrokenPromiseCount→analytics.getBrokenPromiseCount
 * indirection changed).
 */
export class DunningGovernanceService {
  private readonly logger = new Logger(DunningGovernanceService.name);

  constructor(
    private prisma: PrismaService,
    private letterService: ContractLetterService,
    private mdmLockService: MdmLockService,
    private ownerAlertHelper: OwnerAlertHelper,
    private kpiService: OverdueKpiService,
    private analytics: OverdueAnalyticsService,
  ) {}

  /**
   * T4-C2: approve the auto-escalator's proposal to flip a contract into
   * FINAL_WARNING or LEGAL_ACTION. Restricted to OWNER/FINANCE_MANAGER since
   * the downstream message is legally sensitive. Returns the updated contract
   * so the caller can dispatch the actual notification.
   */
  async approveDunningEscalation(contractId: string, userId: string, userRole: string) {
    const allowed = ['OWNER', 'FINANCE_MANAGER'];
    if (!allowed.includes(userRole)) {
      throw new ForbiddenException(
        `สิทธิ์อนุมัติ dunning escalation เฉพาะ ${allowed.join(' / ')}`,
      );
    }

    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: {
        id: true,
        contractNumber: true,
        dunningStage: true,
        pendingDunningStage: true,
      },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');
    if (!contract.pendingDunningStage) {
      throw new BadRequestException('สัญญานี้ไม่มี dunning escalation รออนุมัติ');
    }

    const now = new Date();
    const target = contract.pendingDunningStage;

    const [updated] = await this.prisma.$transaction([
      this.prisma.contract.update({
        where: { id: contractId },
        data: {
          dunningStage: target,
          dunningEscalatedAt: now,
          dunningLastActionAt: now,
          pendingDunningStage: null,
          pendingDunningSince: null,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          userId,
          action: 'DUNNING_ESCALATION_APPROVED',
          entity: 'contract',
          entityId: contractId,
          oldValue: { dunningStage: contract.dunningStage, pendingDunningStage: target },
          newValue: { dunningStage: target },
        },
      }),
    ]);

    return updated;
  }

  async rejectDunningEscalation(
    contractId: string,
    userId: string,
    userRole: string,
    reason: string,
  ) {
    const allowed = ['OWNER', 'FINANCE_MANAGER'];
    if (!allowed.includes(userRole)) {
      throw new ForbiddenException(
        `สิทธิ์ปฏิเสธ dunning escalation เฉพาะ ${allowed.join(' / ')}`,
      );
    }
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('ต้องระบุเหตุผลการปฏิเสธ (≥ 5 ตัวอักษร)');
    }

    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: { id: true, pendingDunningStage: true, dunningStage: true },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');
    if (!contract.pendingDunningStage) {
      throw new BadRequestException('สัญญานี้ไม่มี dunning escalation รออนุมัติ');
    }

    await this.prisma.$transaction([
      this.prisma.contract.update({
        where: { id: contractId },
        data: { pendingDunningStage: null, pendingDunningSince: null },
      }),
      this.prisma.auditLog.create({
        data: {
          userId,
          action: 'DUNNING_ESCALATION_REJECTED',
          entity: 'contract',
          entityId: contractId,
          oldValue: { pendingDunningStage: contract.pendingDunningStage },
          newValue: { rejectedReason: reason.trim() },
        },
      }),
    ]);
    return { success: true };
  }

  /**
   * T3-C11: Place a manual hold on auto-escalation for a contract. Blocks
   * the overdue cron from flipping status/stages while a human is actively
   * working the customer. Default hold is 48h from now.
   *
   * Roles: OWNER / FINANCE_MANAGER / BRANCH_MANAGER — anyone below that has
   * no business overriding collections automation.
   */
  async holdAutoEscalation(
    contractId: string,
    userId: string,
    userRole: string,
    hoursFromNow = 48,
  ) {
    const allowed = ['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER'];
    if (!allowed.includes(userRole)) {
      throw new ForbiddenException(
        `สิทธิ์กด hold escalation เฉพาะ ${allowed.join(' / ')}`,
      );
    }
    if (!Number.isFinite(hoursFromNow) || hoursFromNow <= 0 || hoursFromNow > 168) {
      throw new BadRequestException('ระยะเวลา hold ต้องอยู่ระหว่าง 1 ถึง 168 ชั่วโมง');
    }

    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: { id: true, contractNumber: true, blockAutoEscalation: true },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    const now = new Date();
    const until = new Date(now.getTime() + hoursFromNow * 60 * 60 * 1000);

    const [updated] = await this.prisma.$transaction([
      this.prisma.contract.update({
        where: { id: contractId },
        data: { blockAutoEscalation: until },
      }),
      this.prisma.auditLog.create({
        data: {
          userId,
          action: 'HOLD_AUTO_ESCALATION',
          entity: 'contract',
          entityId: contractId,
          oldValue: { blockAutoEscalation: contract.blockAutoEscalation },
          newValue: { blockAutoEscalation: until, hoursFromNow },
        },
      }),
    ]);

    return { ...updated, holdUntil: until };
  }

  /**
   * Assign a collections agent to a contract
   */
  async assignCollector(contractId: string, assignedToId: string) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    return this.prisma.contract.update({
      where: { id: contractId },
      data: { assignedToId, assignedAt: new Date() },
    });
  }

  /**
   * Escalation Guardrail action — ใช้เมื่อลูกค้าผิดนัด ≥ threshold:
   *   - LETTER → สร้าง ContractLetter (CONTRACT_TERMINATION_60D)
   *   - MDM → propose MDM lock (รอ approve)
   *   - LEGAL → set dunningStage='LEGAL_ACTION' + AuditLog (SoD: OWNER/FINANCE_MANAGER)
   * แจ้ง Owner ทุกครั้งที่ escalate (สำคัญเพราะเป็น decision point ของบริษัท)
   */
  async escalate(
    contractId: string,
    callerId: string,
    callerRole: string,
    action: 'LETTER' | 'MDM' | 'LEGAL',
    reason: string,
  ) {
    // SoD: LEGAL is the legal-handover lane. Mirrors approveDunningEscalation
    // — only OWNER/FINANCE_MANAGER can flip a contract into LEGAL_ACTION.
    if (action === 'LEGAL' && callerRole !== 'OWNER' && callerRole !== 'FINANCE_MANAGER') {
      throw new ForbiddenException('เฉพาะ OWNER หรือ FINANCE_MANAGER เท่านั้นที่ส่งให้ทนายได้');
    }

    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      include: { customer: { select: { name: true } } },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('ต้องระบุเหตุผล (≥ 5 ตัวอักษร)');
    }

    const brokenCount = await this.analytics.getBrokenPromiseCount(contractId);
    const now = new Date();
    let resultPayload: unknown;

    switch (action) {
      case 'LETTER': {
        const letter = await this.letterService.createIfNotExists(
          contractId,
          'CONTRACT_TERMINATION_60D',
        );
        await this.prisma.auditLog.create({
          data: {
            userId: callerId,
            action: 'CONTRACT_ESCALATED_LETTER',
            entity: 'contract',
            entityId: contractId,
            newValue: { reason, brokenPromiseCount: brokenCount, letterId: letter?.id ?? null },
          },
        });
        resultPayload = letter;
        break;
      }
      case 'MDM': {
        const mdm = await this.mdmLockService.proposeManual(contractId, callerId, reason);
        await this.prisma.auditLog.create({
          data: {
            userId: callerId,
            action: 'CONTRACT_ESCALATED_MDM',
            entity: 'contract',
            entityId: contractId,
            newValue: { reason, brokenPromiseCount: brokenCount, mdmRequestId: (mdm as { id?: string })?.id ?? null },
          },
        });
        resultPayload = mdm;
        break;
      }
      case 'LEGAL': {
        // Atomic: contract update + audit row land together. Also clear
        // pendingDunningStage/Since so a later approveDunningEscalation
        // cannot downgrade LEGAL_ACTION back to a parked FINAL_WARNING.
        const [updated] = await this.prisma.$transaction([
          this.prisma.contract.update({
            where: { id: contractId },
            data: {
              dunningStage: 'LEGAL_ACTION',
              dunningEscalatedAt: now,
              dunningLastActionAt: now,
              pendingDunningStage: null,
              pendingDunningSince: null,
            },
          }),
          this.prisma.auditLog.create({
            data: {
              userId: callerId,
              action: 'CONTRACT_ESCALATED_LEGAL',
              entity: 'contract',
              entityId: contractId,
              newValue: { reason, brokenPromiseCount: brokenCount },
            },
          }),
        ]);
        resultPayload = updated;
        break;
      }
    }

    // Owner alert (best-effort, non-blocking)
    try {
      const labels: Record<typeof action, string> = {
        LETTER: 'ส่งจดหมายเตือน',
        MDM: 'เสนอล็อคเครื่อง',
        LEGAL: 'ส่งให้ทนาย',
      };
      await this.ownerAlertHelper.sendToAllOwners(
        `Escalation: ${labels[action]} — ${contract.customer.name} (สัญญา ${contract.contractNumber}) ผิดนัด ${brokenCount} ครั้ง`,
        contractId,
      );
    } catch (err) {
      this.logger.warn(
        `escalate: owner alert failed for contract ${contractId}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }

    this.kpiService.invalidate();

    return {
      action,
      contractId,
      brokenPromiseCount: brokenCount,
      result: resultPayload,
    };
  }
}
