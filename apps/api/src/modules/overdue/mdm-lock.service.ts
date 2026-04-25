import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MdmLockStatus, MdmLockTrigger } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DunningEngineService } from './dunning-engine.service';

// Z3: BRANCH_MANAGER added — branch-level approval authority for parity with
// Approval-tab visibility, late-fee-waiver, and legal-case approvals.
const APPROVE_ROLES = ['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER'] as const;

@Injectable()
export class MdmLockService {
  constructor(
    private prisma: PrismaService,
    private dunningEngine: DunningEngineService,
  ) {}

  /**
   * Auto-propose from a cron. No user — uses the SYSTEM user as proposer. Idempotent:
   * skips if the contract already has a PENDING or APPROVED request pending.
   */
  /**
   * @param systemUserId — optional; cron can pre-resolve SYSTEM user once per run
   * and pass here to avoid N+1 user lookups across many contracts (M2 fix).
   */
  async proposeAuto(
    contractId: string,
    trigger: MdmLockTrigger,
    reason: string,
    systemUserId?: string,
  ) {
    return this.createIfNoneActive(contractId, systemUserId ?? null, trigger, reason, true);
  }

  /**
   * Manual propose from a collector. Validates reason length (≥ 5 chars).
   */
  async proposeManual(contractId: string, userId: string, reason: string) {
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('ต้องระบุเหตุผลการเสนอล็อคเครื่อง (≥ 5 ตัวอักษร)');
    }
    return this.createIfNoneActive(contractId, userId, 'MANUAL_COLLECTOR', reason.trim(), true);
  }

  private async createIfNoneActive(
    contractId: string,
    userId: string | null,
    trigger: MdmLockTrigger,
    reason: string,
    includeWallpaper: boolean,
  ) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    const existing = await this.prisma.mdmLockRequest.findFirst({
      where: {
        contractId,
        status: { in: ['PENDING', 'APPROVED'] },
        deletedAt: null,
      },
    });
    if (existing) return existing;

    const proposerId = userId ?? (await this.getSystemUserIdOrThrow());

    return this.prisma.mdmLockRequest.create({
      data: {
        contractId,
        status: 'PENDING',
        trigger,
        includeWallpaper,
        proposedById: proposerId,
        reason,
      },
    });
  }

  /**
   * Approve a pending MDM lock request and execute it.
   *
   * @param options.includeWallpaper — Optional approver override. When
   *   provided, this takes precedence over the proposer's `includeWallpaper`
   *   field on the request. When omitted, falls back to the proposer's
   *   choice. This lets OWNER/FINANCE_MANAGER decide at approve-time whether
   *   the wallpaper ships, instead of being locked into the proposer's
   *   decision (D2 UX).
   */
  async approve(
    requestId: string,
    approverId: string,
    approverRole?: string,
    options: { includeWallpaper?: boolean } = {},
  ) {
    const role = await this.resolveRole(approverId, approverRole);
    if (!(APPROVE_ROLES as readonly string[]).includes(role)) {
      throw new ForbiddenException(`สิทธิ์อนุมัติล็อคเครื่องเฉพาะ ${APPROVE_ROLES.join(' / ')}`);
    }

    const req = await this.prisma.mdmLockRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('ไม่พบคำขอ');
    if (req.status !== 'PENDING') {
      throw new BadRequestException('คำขอนี้ไม่อยู่ในสถานะรออนุมัติ');
    }

    // Approver override takes precedence; otherwise use proposer's choice.
    const effectiveIncludeWallpaper =
      options.includeWallpaper !== undefined ? options.includeWallpaper : req.includeWallpaper;

    const wallpaperUrl = effectiveIncludeWallpaper
      ? (
          await this.prisma.systemConfig.findUnique({ where: { key: 'mdm_lock_wallpaper_url' } })
        )?.value ?? null
      : null;

    const now = new Date();
    const [updated] = await this.prisma.$transaction([
      this.prisma.mdmLockRequest.update({
        where: { id: requestId },
        data: {
          status: MdmLockStatus.EXECUTED_MANUAL,
          approvedById: approverId,
          approvedAt: now,
          wallpaperUrlUsed: wallpaperUrl,
        },
      }),
      this.prisma.contract.update({
        where: { id: req.contractId },
        data: {
          deviceLocked: true,
          deviceLockedAt: now,
          wallpaperChanged: effectiveIncludeWallpaper,
          wallpaperChangedAt: effectiveIncludeWallpaper ? now : null,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: approverId,
          action: 'MDM_LOCK_APPROVED',
          entity: 'mdm_lock_request',
          entityId: requestId,
          newValue: {
            trigger: req.trigger,
            includeWallpaper: effectiveIncludeWallpaper,
            proposerIncludeWallpaper: req.includeWallpaper,
          },
        },
      }),
    ]);

    // Fire LINE — non-fatal
    try {
      await this.dunningEngine.executeEventTrigger('DEVICE_LOCKED', req.contractId, null, null);
    } catch {
      // engine already logs
    }

    return updated;
  }

  async reject(requestId: string, rejectorId: string, reason: string, rejectorRole?: string) {
    const role = await this.resolveRole(rejectorId, rejectorRole);
    if (!(APPROVE_ROLES as readonly string[]).includes(role)) {
      throw new ForbiddenException(`สิทธิ์ปฏิเสธคำขอเฉพาะ ${APPROVE_ROLES.join(' / ')}`);
    }
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('ต้องระบุเหตุผลการปฏิเสธ (≥ 5 ตัวอักษร)');
    }

    const req = await this.prisma.mdmLockRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('ไม่พบคำขอ');
    if (req.status !== 'PENDING') {
      throw new BadRequestException('คำขอนี้ไม่อยู่ในสถานะรออนุมัติ');
    }

    return this.prisma.mdmLockRequest.update({
      where: { id: requestId },
      data: {
        status: MdmLockStatus.REJECTED,
        rejectedById: rejectorId,
        rejectedReason: reason.trim(),
      },
    });
  }

  async unlock(requestId: string, unlockerId: string, unlockerRole?: string) {
    const role = await this.resolveRole(unlockerId, unlockerRole);
    if (!(APPROVE_ROLES as readonly string[]).includes(role)) {
      throw new ForbiddenException(`สิทธิ์ปลดล็อคเฉพาะ ${APPROVE_ROLES.join(' / ')}`);
    }

    const req = await this.prisma.mdmLockRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('ไม่พบคำขอ');
    if (req.status !== MdmLockStatus.EXECUTED_MANUAL && req.status !== MdmLockStatus.EXECUTED_API) {
      throw new BadRequestException('คำขอนี้ยังไม่ถูก execute');
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.mdmLockRequest.update({
        where: { id: requestId },
        data: { status: MdmLockStatus.UNLOCKED },
      }),
      this.prisma.contract.update({
        where: { id: req.contractId },
        data: { deviceLocked: false, wallpaperChanged: false },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: unlockerId,
          action: 'MDM_UNLOCK',
          entity: 'mdm_lock_request',
          entityId: requestId,
        },
      }),
    ]);

    try {
      await this.dunningEngine.executeEventTrigger('DEVICE_UNLOCKED', req.contractId, null, null);
    } catch {
      // non-fatal
    }

    return updated;
  }

  /**
   * Z8: Fetch a single MdmLockRequest by id for the undo live-check. Returns
   * the row including contract context so the FE can decide whether to
   * proceed with reverse — only PENDING is undoable.
   */
  async getById(requestId: string) {
    const req = await this.prisma.mdmLockRequest.findFirst({
      where: { id: requestId, deletedAt: null },
      include: {
        contract: { select: { id: true, contractNumber: true, branchId: true } },
        proposedBy: { select: { id: true, name: true } },
      },
    });
    if (!req) throw new NotFoundException('ไม่พบคำขอ');
    return req;
  }

  /**
   * Z8: Soft-delete a PENDING MdmLockRequest. Authorization:
   *   - OWNER may delete any pending request
   *   - The original proposer may delete their own pending request
   * Anything else → ForbiddenException. Non-PENDING → BadRequestException
   * (the FE live-check should have prevented this; defence-in-depth).
   */
  async deleteIfPending(requestId: string, userId: string, userRole: string) {
    const req = await this.prisma.mdmLockRequest.findFirst({
      where: { id: requestId, deletedAt: null },
    });
    if (!req) throw new NotFoundException('ไม่พบคำขอ');
    if (req.status !== MdmLockStatus.PENDING) {
      throw new BadRequestException('คำขอไม่อยู่ในสถานะรออนุมัติแล้ว');
    }
    const isOwner = userRole === 'OWNER';
    const isOriginator = req.proposedById === userId;
    if (!isOwner && !isOriginator) {
      throw new ForbiddenException('ยกเลิกได้เฉพาะ OWNER หรือผู้เสนอเท่านั้น');
    }

    const now = new Date();
    const [updated] = await this.prisma.$transaction([
      this.prisma.mdmLockRequest.update({
        where: { id: requestId },
        data: { deletedAt: now },
      }),
      this.prisma.auditLog.create({
        data: {
          userId,
          action: 'MDM_LOCK_PROPOSAL_CANCELLED',
          entity: 'mdm_lock_request',
          entityId: requestId,
          newValue: { reason: 'undo' },
        },
      }),
    ]);
    return updated;
  }

  /**
   * For the approval tab: pending requests visible to the caller. OWNER/FM see all;
   * BRANCH_MANAGER sees only their branch. SALES not granted (no controller route).
   */
  async getPendingByRole(userRole: string, userBranchId?: string) {
    const branchFilter =
      userRole === 'BRANCH_MANAGER' && userBranchId
        ? { contract: { branchId: userBranchId } }
        : {};

    return this.prisma.mdmLockRequest.findMany({
      where: { status: MdmLockStatus.PENDING, ...branchFilter },
      include: {
        contract: {
          select: {
            id: true,
            contractNumber: true,
            customer: { select: { id: true, name: true, phone: true } },
            branch: { select: { id: true, name: true } },
          },
        },
        proposedBy: { select: { id: true, name: true } },
      },
      orderBy: { proposedAt: 'asc' },
      take: 200,
    });
  }

  private async resolveRole(userId: string, providedRole?: string): Promise<string> {
    if (providedRole) return providedRole;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user) throw new NotFoundException('ไม่พบผู้ใช้งาน');
    return user.role;
  }

  private async getSystemUserIdOrThrow(): Promise<string> {
    const u = await this.prisma.user.findFirst({
      where: { isSystemUser: true },
      select: { id: true },
    });
    if (!u) {
      // H1: ServiceUnavailableException → 503 so ops alerting correctly
      // categorizes this as a config/seed gap rather than a crash.
      throw new ServiceUnavailableException(
        'SYSTEM user not found — seed collections-foundation must run first',
      );
    }
    return u.id;
  }
}
