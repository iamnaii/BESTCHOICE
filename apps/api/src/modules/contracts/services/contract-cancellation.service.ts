import { Injectable, NotFoundException, BadRequestException, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import { ContractCancellationTemplate } from '../../journal/cpa-templates/contract-cancellation.template';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { shopCollectTypedBalance } from '../../interco-settlement/interco-typed-balance';

/**
 * ContractCancellationService — contract-cancellation workflow:
 * request / approve (guards + sweep-reversal $tx + restore) / reject /
 * list-pending. Phase 3 Task 2 (workbook 2026-08-19 spec §6, Flow C-1).
 *
 * The cancellation template is read through a late-bound accessor
 * (`getCancellationTemplate`) supplied by the facade rather than captured at
 * construction time. This preserves the existing test hack where the spec
 * mutates the facade's private `cancellationTemplate` field AFTER the testing
 * module is built — the accessor resolves the field lazily inside
 * approveCancellation, so the late-set mock still applies. The company
 * resolver (SHOP companyId for the product restore) uses the same accessor
 * pattern for the same reason.
 */
@Injectable()
export class ContractCancellationService {
  constructor(
    private prisma: PrismaService,
    private getCancellationTemplate: () => ContractCancellationTemplate | undefined,
    private getCompanyResolver: () => CompanyResolverService | undefined = () => undefined,
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
      // ── Phase 3 guards (C-1) — all inside the tx, before any JE posts ──
      const contract = cancellation.contract;
      if (contract.status !== 'ACTIVE') {
        throw new BadRequestException(
          'ยกเลิกได้เฉพาะสัญญาสถานะ ACTIVE — สัญญาที่เดินไปแล้วใช้เส้นทางยึดเครื่อง (JP5)',
        );
      }
      const paid = await tx.payment.findFirst({
        where: {
          contractId: contract.id,
          deletedAt: null,
          OR: [{ status: 'PAID' }, { amountPaid: { gt: 0 } }],
        },
        select: { id: true },
      });
      if (paid) {
        throw new BadRequestException(
          'มีการชำระเงินบนสัญญาแล้ว — ต้อง void ใบเสร็จทั้งหมดก่อนยกเลิก (ระบบออกใบลดหนี้ให้อัตโนมัติ)',
        );
      }
      const openItem = await tx.interCoSettlementItem.findFirst({
        where: {
          contractId: contract.id,
          deletedAt: null,
          batch: { status: { in: ['DRAFT', 'PENDING_APPROVAL'] }, deletedAt: null },
        },
        include: { batch: { select: { batchNumber: true } } },
      });
      if (openItem) {
        throw new BadRequestException(
          `สัญญาอยู่ในรอบจ่าย ${openItem.batch.batchNumber} ที่ยังไม่อนุมัติ — ถอน/ยกเลิกรอบก่อนจึงจะยกเลิกสัญญาได้`,
        );
      }
      // refundAmount deprecated (Phase 3): เงินคืนลูกค้า (เงินดาวน์) เป็นขั้นตอน
      // ฝั่ง SHOP หลังยกเลิก — sweep คืน Cr S21-2001 โดยโครงสร้างอยู่แล้ว.
      // DTO field คงไว้ (back-compat) แต่ approve ปฏิเสธค่า > 0.
      if (new Decimal(cancellation.refundAmount.toString()).gt(0)) {
        throw new BadRequestException(
          'refundAmount ไม่รองรับแล้ว — เงินคืนลูกค้า (เงินดาวน์) จัดการฝั่ง SHOP หลังยกเลิก',
        );
      }
      // หน้าร้านถือเงินลูกค้าที่รับแทน (11-2107 SHOP_COLLECT) ยังไม่ settle —
      // sweep จงใจ exclude flow นี้ (เงินสดจริง) จึงต้องเคลียร์ก่อนยกเลิก
      const shopCollectBal = await shopCollectTypedBalance(tx, contract.id);
      if (shopCollectBal.abs().gt('0.01')) {
        throw new BadRequestException(
          'มีเงินที่หน้าร้านรับแทนยัง settle ไม่ครบ (11-2107) — เคลียร์ก่อนยกเลิก',
        );
      }

      // Post sweep reversal chain + ECL release (template — Phase 3 C-1)
      const jeResult = await template.execute(
        { contractId: cancellation.contractId, cancellationId },
        tx,
      );

      // Find the JE id by entryNumber to store FK
      const reversalJE = await tx.journalEntry.findUniqueOrThrow({
        where: { entryNumber: jeResult.entryNumber },
        select: { id: true },
      });

      // ── Restore (pattern exchange-cancel): product back to SHOP stock +
      // soft-delete schedule rows so crons/queues stop seeing the contract ──
      const now = new Date();
      const companyResolver = this.getCompanyResolver();
      if (!companyResolver) {
        throw new InternalServerErrorException(
          'CompanyResolverService not available — check module wiring',
        );
      }
      const shopCompanyId = await companyResolver.getShopCompanyId(tx);
      await tx.product.update({
        where: { id: contract.productId },
        data: { status: 'IN_STOCK', ownedByCompanyId: shopCompanyId } as never,
      });
      await tx.payment.updateMany({
        where: { contractId: contract.id, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.installmentSchedule.updateMany({
        where: { contractId: contract.id, deletedAt: null },
        data: { deletedAt: now },
      });

      // Update ContractCancellation → APPROVED
      await tx.contractCancellation.update({
        where: { id: cancellationId },
        data: {
          status: 'APPROVED',
          approvedById: approverId,
          approvedAt: now,
          reversalJournalEntryId: reversalJE.id,
        },
      });

      // Update Contract → CANCELED
      await tx.contract.update({
        where: { id: cancellation.contractId },
        data: { status: 'CANCELED' },
      });

      // Audit log — เก็บ reversal ทั้งชุด (count + ids + first entryNumber)
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
            reversalCount: jeResult.reversalJeIds.length,
            reversalJeIds: jeResult.reversalJeIds,
            refundAmount: cancellation.refundAmount.toString(),
          },
        },
      });

      return {
        cancellationId,
        status: 'APPROVED',
        reversalEntryNumber: jeResult.entryNumber,
        reversalCount: jeResult.reversalJeIds.length,
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
