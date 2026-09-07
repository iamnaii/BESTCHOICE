import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { CreditCheckStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { OverrideCreditCheckDto } from '../dto/credit-check.dto';
import { lockCreditCustomer, lockCreditCheck } from './room-credit-history';
import { CreditApprovalService } from './credit-approval';

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
  readonly approval: CreditApprovalService;
  constructor(private prisma: PrismaService) {
    this.approval = new CreditApprovalService(prisma);
  }

  /**
   * ผลตรวจเครดิต → สถานะบนตัวลูกค้า
   *
   * ต้องอัปเดตคู่กันเสมอ ไม่งั้น "อนุมัติในคิวตรวจเครดิตแล้ว แต่หน้าลูกค้ายังขึ้นว่า
   * รอผู้จัดการตรวจ" — ซึ่งเป็นอาการที่เจ้าของเจอจริง เพราะ `runPreCheck` เขียนสองตาราง
   * พร้อมกันตอนตรวจ แต่ตอน override เดิมแตะแค่ตาราง CreditCheck
   *
   * แยก PRE / FULL เพราะ `CustomerCreditCheckStatus` มีสองค่าสำหรับ "ผ่าน"
   */
  private customerStatusFor(
    checkType: string,
    status: string,
  ): 'PRE_CHECK_PASSED' | 'FULL_CHECK_PASSED' | 'REJECTED' | 'UNDER_REVIEW' | null {
    if (status === 'APPROVED') return checkType === 'FULL' ? 'FULL_CHECK_PASSED' : 'PRE_CHECK_PASSED';
    if (status === 'REJECTED') return 'REJECTED';
    if (status === 'MANUAL_REVIEW') return 'UNDER_REVIEW';
    return null;
  }

  async overrideById(
    creditCheckId: string,
    dto: OverrideCreditCheckDto,
    userId: string,
    userRole: string,
  ) {
    const target = await this.prisma.creditCheck.findUnique({ where: { id: creditCheckId } });
    if (!target || target.deletedAt) throw new NotFoundException('ไม่พบข้อมูลตรวจสอบเครดิต');

    return this.prisma.$transaction(async (tx) => {
      // Share the import lock, then re-read so a concurrent decision cannot
      // bypass the override policy or overwrite the customer's latest result.
      await lockCreditCustomer(tx, target.customerId);
      await lockCreditCheck(tx, creditCheckId);
      const creditCheck = await tx.creditCheck.findUnique({ where: { id: creditCheckId } });
      if (!creditCheck || creditCheck.deletedAt) throw new NotFoundException('ไม่พบข้อมูลตรวจสอบเครดิต');
      this.enforceOverridePolicy(creditCheck.status, dto.status, userRole, !!dto.affordability);
      let approvalId: string | null = null;
      if (dto.status === 'APPROVED' && creditCheck.checkType === 'FULL') {
        if (!dto.affordability) throw new BadRequestException('กรุณายืนยันข้อมูลและระบุยอดผ่อนที่อนุมัติก่อนอนุมัติเครดิต');
        const approval = await this.approval.approveInTransaction(tx, creditCheck, dto.affordability, userId);
        approvalId = approval.id;
      } else if (dto.affordability) {
        throw new BadRequestException('ยอดผ่อนที่อนุมัติใช้ได้กับการอนุมัติผล FULL เท่านั้น');
      }
      if (dto.status !== 'APPROVED') {
        await tx.creditApproval.updateMany({
          where: { creditCheckId, supersededAt: null, deletedAt: null }, data: { supersededAt: new Date() },
        });
      }

      const updated = await tx.creditCheck.update({
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
          approvals: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1,
            include: { approvedBy: { select: { id: true, name: true } } } },
        },
      });
      // Match findLatestByCustomer: a FULL check takes precedence over PRE.
      const latest = await tx.creditCheck.findFirst({
        where: { customerId: creditCheck.customerId, checkType: 'FULL', deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      }) ?? await tx.creditCheck.findFirst({
        where: { customerId: creditCheck.customerId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      const customerStatus = latest?.id === creditCheckId
        ? this.customerStatusFor(creditCheck.checkType, dto.status)
        : null;
      if (customerStatus) {
        await tx.customer.update({
          where: { id: creditCheck.customerId },
          data: { creditCheckStatus: customerStatus },
        });
      }
      await tx.auditLog.create({
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
            customerCreditCheckStatus: customerStatus,
            approvalId,
          },
        },
      });
      return updated;
    });
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
    hasAffordability = false,
  ) {
    if (!['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER'].includes(userRole)) {
      throw new ForbiddenException('ไม่มีสิทธิ์พิจารณาเครดิต');
    }
    const validStatuses = ['APPROVED', 'REJECTED', 'MANUAL_REVIEW'];
    if (!validStatuses.includes(requestedStatus)) {
      throw new BadRequestException('สถานะไม่ถูกต้อง');
    }
    if (currentStatus === requestedStatus && !(requestedStatus === 'APPROVED' && hasAffordability)) {
      throw new BadRequestException('สถานะเดิมกับที่ขอเปลี่ยน — ไม่ต้องใช้ override');
    }
    if (currentStatus === 'REJECTED' && requestedStatus !== 'REJECTED') {
      const allowed = ['OWNER', 'FINANCE_MANAGER'];
      if (!allowed.includes(userRole)) {
        throw new ForbiddenException(
          'การทบทวนผลที่ถูกปฏิเสธต้องได้รับอนุมัติจากผู้จัดการการเงินหรือเจ้าของ',
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

    return this.overrideById(creditCheck.id, dto, userId, userRole);
  }
}
