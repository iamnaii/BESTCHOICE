import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { CreditCheckStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { OverrideCreditCheckDto } from '../dto/credit-check.dto';

/**
 * Override sub-service for credit-check. Plain class (NOT @Injectable) —
 * instantiated internally by the CreditCheckService facade.
 *
 * Owns: overrideById, override + private enforceOverridePolicy. Both override
 * paths wrap the status update + audit-log write in ONE $transaction so the
 * evidence trail never drifts out of sync with the status change — the
 * $transaction blocks are kept whole (update + auditLog.create together).
 */
export class CreditCheckOverrideService {
  constructor(private prisma: PrismaService) {}

  async overrideById(
    creditCheckId: string,
    dto: OverrideCreditCheckDto,
    userId: string,
    userRole: string,
  ) {
    const creditCheck = await this.prisma.creditCheck.findUnique({ where: { id: creditCheckId } });
    if (!creditCheck || creditCheck.deletedAt) throw new NotFoundException('ไม่พบข้อมูลตรวจสอบเครดิต');

    this.enforceOverridePolicy(creditCheck.status, dto.status, userRole);

    // T4-C4: wrap update + audit-log write in one transaction so the
    // evidence trail never drifts out of sync with the status change.
    const [updated] = await this.prisma.$transaction([
      this.prisma.creditCheck.update({
        where: { id: creditCheckId },
        data: {
          status: dto.status as CreditCheckStatus,
          reviewNotes: dto.reviewNotes,
          checkedById: userId,
          checkedAt: new Date(),
          // Freeze the AI decision at the first override so future audits can
          // compare final vs original. Don't overwrite on repeat overrides.
          originalStatus: creditCheck.originalStatus ?? creditCheck.status,
          originalScore: creditCheck.originalScore ?? creditCheck.aiScore,
          overriddenAt: new Date(),
          overriddenById: userId,
          overrideReason: dto.overrideReason,
        },
        include: {
          customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
          checkedBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.auditLog.create({
        data: {
          userId,
          action: 'CREDIT_CHECK_OVERRIDE',
          entity: 'credit_check',
          entityId: creditCheckId,
          oldValue: {
            status: creditCheck.status,
            aiScore: creditCheck.aiScore,
          },
          newValue: {
            status: dto.status,
            overrideReason: dto.overrideReason,
            attachmentIds: dto.attachmentIds ?? [],
            userRole,
          },
        },
      }),
    ]);

    return updated;
  }

  /**
   * Enforce the override policy.
   * - status must be one of the three valid values
   * - must be a real change (no no-op overrides that pad the audit trail)
   * - escalating REJECTED → APPROVED (AI said no, human says yes) is the
   *   riskiest move and is restricted to OWNER / FINANCE_MANAGER
   */
  private enforceOverridePolicy(
    currentStatus: CreditCheckStatus,
    requestedStatus: string,
    userRole: string,
  ) {
    const validStatuses = ['APPROVED', 'REJECTED', 'MANUAL_REVIEW'];
    if (!validStatuses.includes(requestedStatus)) {
      throw new BadRequestException('สถานะไม่ถูกต้อง');
    }
    if (currentStatus === requestedStatus) {
      throw new BadRequestException('สถานะเดิมกับที่ขอเปลี่ยน — ไม่ต้องใช้ override');
    }
    if (currentStatus === 'REJECTED' && requestedStatus === 'APPROVED') {
      const allowed = ['OWNER', 'FINANCE_MANAGER'];
      if (!allowed.includes(userRole)) {
        throw new ForbiddenException(
          'การเปลี่ยนผลจาก REJECTED เป็น APPROVED ต้องได้รับอนุมัติจากผู้จัดการการเงินหรือเจ้าของ',
        );
      }
    }
  }

  async override(
    contractId: string,
    dto: OverrideCreditCheckDto,
    userId: string,
    userRole: string,
  ) {
    const creditCheck = await this.prisma.creditCheck.findUnique({ where: { contractId } });
    if (!creditCheck || creditCheck.deletedAt) throw new NotFoundException('ไม่พบข้อมูลตรวจสอบเครดิต');

    this.enforceOverridePolicy(creditCheck.status, dto.status, userRole);

    // T4-C4: atomic update + audit — same contract of evidence preservation
    // as overrideById().
    const [updated] = await this.prisma.$transaction([
      this.prisma.creditCheck.update({
        where: { contractId },
        data: {
          status: dto.status as CreditCheckStatus,
          reviewNotes: dto.reviewNotes,
          checkedById: userId,
          checkedAt: new Date(),
          originalStatus: creditCheck.originalStatus ?? creditCheck.status,
          originalScore: creditCheck.originalScore ?? creditCheck.aiScore,
          overriddenAt: new Date(),
          overriddenById: userId,
          overrideReason: dto.overrideReason,
        },
        include: {
          customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
          checkedBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.auditLog.create({
        data: {
          userId,
          action: 'CREDIT_CHECK_OVERRIDE',
          entity: 'credit_check',
          entityId: creditCheck.id,
          oldValue: {
            status: creditCheck.status,
            aiScore: creditCheck.aiScore,
          },
          newValue: {
            status: dto.status,
            overrideReason: dto.overrideReason,
            attachmentIds: dto.attachmentIds ?? [],
            userRole,
          },
        },
      }),
    ]);

    return updated;
  }
}
