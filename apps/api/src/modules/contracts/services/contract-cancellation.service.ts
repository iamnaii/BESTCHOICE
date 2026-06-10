import { Injectable, NotFoundException, BadRequestException, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import { ContractCancellationTemplate } from '../../journal/cpa-templates/contract-cancellation.template';

/**
 * ContractCancellationService — contract-cancellation workflow:
 * request / approve (reversal-JE $tx) / reject / list-pending.
 *
 * The cancellation template is read through a late-bound accessor
 * (`getCancellationTemplate`) supplied by the facade rather than captured at
 * construction time. This preserves the existing test hack where the spec
 * mutates the facade's private `cancellationTemplate` field AFTER the testing
 * module is built — the accessor resolves the field lazily inside
 * approveCancellation, so the late-set mock still applies.
 */
@Injectable()
export class ContractCancellationService {
  constructor(
    private prisma: PrismaService,
    private getCancellationTemplate: () => ContractCancellationTemplate | undefined,
  ) {}

  /**
   * Request a cancellation for an existing contract.
   *
   * Business rules:
   * - Cannot cancel an already-CANCELED contract.
   * - Cannot create a second PENDING cancellation for the same contract.
   */
  async requestCancellation(
    contractId: string,
    userId: string,
    reason: string,
    refundAmount: number,
  ) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { id: true, contractNumber: true, status: true, deletedAt: true },
    });
    if (!contract || contract.deletedAt) {
      throw new NotFoundException('ไม่พบสัญญา');
    }
    if (contract.status === 'CANCELED') {
      throw new BadRequestException('สัญญานี้ถูกยกเลิกไปแล้ว');
    }

    const pending = await this.prisma.contractCancellation.findFirst({
      where: { contractId, status: 'PENDING', deletedAt: null },
    });
    if (pending) {
      throw new ConflictException('มีคำขอยกเลิกสัญญาที่รอดำเนินการอยู่แล้ว');
    }

    const cancellation = await this.prisma.contractCancellation.create({
      data: {
        contractId,
        requestedById: userId,
        reason,
        refundAmount: new Decimal(refundAmount),
        status: 'PENDING',
      },
      include: {
        contract: { select: { id: true, contractNumber: true, status: true } },
        requestedBy: { select: { id: true, name: true } },
      },
    });

    return cancellation;
  }

  /**
   * Approve a pending cancellation: posts reversal JE, sets contract to CANCELED.
   * Wrapped in a $transaction for full atomicity.
   */
  async approveCancellation(cancellationId: string, approverId: string) {
    const cancellation = await this.prisma.contractCancellation.findUnique({
      where: { id: cancellationId },
      include: { contract: true },
    });
    if (!cancellation || cancellation.deletedAt) {
      throw new NotFoundException('ไม่พบคำขอยกเลิกสัญญา');
    }
    if (cancellation.status !== 'PENDING') {
      throw new BadRequestException(
        `ไม่สามารถอนุมัติได้ สถานะปัจจุบัน: ${cancellation.status}`,
      );
    }

    const cancellationTemplate = this.getCancellationTemplate();
    if (!cancellationTemplate) {
      throw new InternalServerErrorException(
        'ContractCancellationTemplate not available — check module wiring',
      );
    }

    const template = cancellationTemplate;

    const result = await this.prisma.$transaction(async (tx) => {
      // Post reversal JE (+ optional refund JE)
      const jeResult = await template.execute(
        {
          contractId: cancellation.contractId,
          cancellationId,
          refundAmount: new Decimal(cancellation.refundAmount.toString()),
        },
        tx,
      );

      // Find the JE id by entryNumber to store FK
      const reversalJE = await tx.journalEntry.findUniqueOrThrow({
        where: { entryNumber: jeResult.entryNumber },
        select: { id: true },
      });

      // Update ContractCancellation → APPROVED
      await tx.contractCancellation.update({
        where: { id: cancellationId },
        data: {
          status: 'APPROVED',
          approvedById: approverId,
          approvedAt: new Date(),
          reversalJournalEntryId: reversalJE.id,
        },
      });

      // Update Contract → CANCELED
      await tx.contract.update({
        where: { id: cancellation.contractId },
        data: { status: 'CANCELED' },
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          userId: approverId,
          action: 'CONTRACT_CANCELED',
          entity: 'contract',
          entityId: cancellation.contractId,
          oldValue: {
            status: cancellation.contract.status,
            cancellationId,
          },
          newValue: {
            status: 'CANCELED',
            reversalEntryNumber: jeResult.entryNumber,
            refundEntryNumber: jeResult.refundEntryNumber ?? null,
            refundAmount: cancellation.refundAmount.toString(),
          },
        },
      });

      return {
        cancellationId,
        status: 'APPROVED',
        reversalEntryNumber: jeResult.entryNumber,
        refundEntryNumber: jeResult.refundEntryNumber,
      };
    });

    return result;
  }

  /**
   * Reject a pending cancellation (no JE needed).
   */
  async rejectCancellation(
    cancellationId: string,
    approverId: string,
    reason: string,
  ) {
    const cancellation = await this.prisma.contractCancellation.findUnique({
      where: { id: cancellationId },
      select: { id: true, status: true, deletedAt: true },
    });
    if (!cancellation || cancellation.deletedAt) {
      throw new NotFoundException('ไม่พบคำขอยกเลิกสัญญา');
    }
    if (cancellation.status !== 'PENDING') {
      throw new BadRequestException(
        `ไม่สามารถปฏิเสธได้ สถานะปัจจุบัน: ${cancellation.status}`,
      );
    }

    const updated = await this.prisma.contractCancellation.update({
      where: { id: cancellationId },
      data: {
        status: 'REJECTED',
        approvedById: approverId,
        approvedAt: new Date(),
      },
      include: {
        contract: { select: { id: true, contractNumber: true } },
        requestedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: approverId,
        action: 'CANCELLATION_REJECTED',
        entity: 'contract',
        entityId: updated.contractId,
        oldValue: { cancellationId, status: 'PENDING' },
        newValue: { status: 'REJECTED', reason },
      },
    });

    return updated;
  }

  /**
   * List all PENDING cancellation requests (for FM/OWNER approval queue).
   */
  async listPendingCancellations() {
    return this.prisma.contractCancellation.findMany({
      where: { status: 'PENDING', deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: {
        contract: {
          select: {
            id: true,
            contractNumber: true,
            status: true,
            customer: { select: { id: true, name: true, phone: true } },
          },
        },
        requestedBy: { select: { id: true, name: true } },
      },
    });
  }
}
