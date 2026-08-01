import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IntercoPendingService, PendingContract } from './interco-pending.service';
import { IntercoBatchNumberService } from './interco-batch-number.service';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { CreateBatchDto } from './dto/create-batch.dto';

const DEFAULT_FINANCE_BANK_CODE = '11-1201';
/** Batch statuses that "lock" a contract out of the pending queue (spec §4). */
const OPEN_BATCH_STATUSES = ['PENDING_APPROVAL', 'POSTED'] as const;

interface BuiltSnapshot {
  items: Array<{
    contractId: string;
    financedGl: Prisma.Decimal;
    commissionGl: Prisma.Decimal;
    shopFinancedGl: Prisma.Decimal;
    shopCommissionGl: Prisma.Decimal;
    legacyNoShop: boolean;
  }>;
  totalFinanced: Prisma.Decimal;
  totalCommission: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  shopPostedAmount: Prisma.Decimal;
}

/**
 * เมนู "จ่ายให้หน้าร้าน (INTER-CO)" — batch lifecycle (DRAFT → PENDING_APPROVAL,
 * withdraw, cancel, update-while-DRAFT). `approveBatch`/`reverseBatch` (the
 * paired-JE half) land in Task 4 — do NOT call PairedJournalService here.
 *
 * Maker–checker (spec §6): create/submit/withdraw/update are maker-only
 * server-side checks; approve/reverse role + maker≠approver enforcement is
 * Task 4's job. `cancelBatch` intentionally has NO maker/role check here —
 * the controller (Task 5) gates it by role; this method only guards status.
 *
 * Spec: docs/superpowers/specs/2026-07-30-interco-settlement-batch-design.md §3, §4, §6
 */
@Injectable()
export class IntercoSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pendingService: IntercoPendingService,
    private readonly batchNumberService: IntercoBatchNumberService,
  ) {}

  /**
   * Snapshots the 4 GL amounts + legacyNoShop per contract straight from the
   * pending engine (never from `Contract.financedAmount/storeCommission` —
   * spec F4) and computes batch totals. Throws with the offending contract
   * NUMBER (falling back to raw id if the contract lookup itself comes up
   * empty) when any requested id is missing from the pending queue — i.e.
   * it doesn't exist, was never activated, or is already settled inside
   * another PENDING_APPROVAL/POSTED batch (pending engine excludes those by
   * construction — spec §4).
   */
  private async buildSnapshot(
    tx: Prisma.TransactionClient,
    contractIds: string[],
  ): Promise<BuiltSnapshot> {
    if (new Set(contractIds).size !== contractIds.length) {
      throw new BadRequestException('มีสัญญาซ้ำในรายการที่เลือก');
    }

    const pending = await this.pendingService.getPendingContracts(tx);
    const pendingByContractId = new Map<string, PendingContract>(
      pending.map((p) => [p.contractId, p]),
    );

    const missingIds = contractIds.filter((id) => !pendingByContractId.has(id));
    if (missingIds.length > 0) {
      const labels = await this.resolveContractLabels(tx, missingIds);
      throw new BadRequestException(
        `สัญญา ${labels.join(', ')} ไม่อยู่ในคิวรอจ่าย หรืออยู่ในรอบจ่ายอื่นแล้ว`,
      );
    }

    let totalFinanced = new Prisma.Decimal(0);
    let totalCommission = new Prisma.Decimal(0);
    let shopPostedAmount = new Prisma.Decimal(0);

    const items = contractIds.map((contractId) => {
      const p = pendingByContractId.get(contractId)!;
      totalFinanced = totalFinanced.plus(p.financedGl);
      totalCommission = totalCommission.plus(p.commissionGl);
      if (!p.legacyNoShop) {
        shopPostedAmount = shopPostedAmount.plus(p.shopFinancedGl).plus(p.shopCommissionGl);
      }
      return {
        contractId,
        financedGl: p.financedGl,
        commissionGl: p.commissionGl,
        shopFinancedGl: p.shopFinancedGl,
        shopCommissionGl: p.shopCommissionGl,
        legacyNoShop: p.legacyNoShop,
      };
    });

    return {
      items,
      totalFinanced,
      totalCommission,
      totalAmount: totalFinanced.plus(totalCommission),
      shopPostedAmount,
    };
  }

  /** Best-effort contract-number lookup for error messages — falls back to the raw id. */
  private async resolveContractLabels(
    tx: Prisma.TransactionClient,
    ids: string[],
  ): Promise<string[]> {
    const contracts = await tx.contract.findMany({
      where: { id: { in: ids } },
      select: { id: true, contractNumber: true },
    });
    const byId = new Map(contracts.map((c) => [c.id, c.contractNumber]));
    return ids.map((id) => byId.get(id) ?? id);
  }

  async createBatch(dto: CreateBatchDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const snapshot = await this.buildSnapshot(tx, dto.contractIds);
      const batchNumber = await this.batchNumberService.next(tx);

      const batch = await tx.interCoSettlementBatch.create({
        data: {
          batchNumber,
          status: 'DRAFT',
          transferDate: new Date(dto.transferDate),
          financeBankCode: dto.financeBankCode ?? DEFAULT_FINANCE_BANK_CODE,
          shopBankCode: dto.shopBankCode ?? ShopAccountResolver.SHOP_RECEIVING_BANK,
          totalFinanced: snapshot.totalFinanced,
          totalCommission: snapshot.totalCommission,
          totalAmount: snapshot.totalAmount,
          shopPostedAmount: snapshot.shopPostedAmount,
          transferRef: dto.transferRef,
          slipFileKey: dto.slipFileKey,
          note: dto.note,
          makerId: userId,
          items: { create: snapshot.items },
        },
        include: { items: true },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'INTERCO_BATCH_CREATED',
          entity: 'interco_settlement_batch',
          entityId: batch.id,
          newValue: {
            batchNumber: batch.batchNumber,
            contractIds: dto.contractIds,
            totalAmount: snapshot.totalAmount.toFixed(2),
            shopPostedAmount: snapshot.shopPostedAmount.toFixed(2),
          },
        },
      });

      return batch;
    });
  }

  /** DRAFT-only, maker-only, full re-snapshot per spec §6 ("DRAFT แก้ได้"). */
  async updateBatch(id: string, dto: CreateBatchDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.interCoSettlementBatch.findUnique({ where: { id } });
      if (!batch || batch.deletedAt) throw new NotFoundException('ไม่พบรอบจ่าย');
      if (batch.makerId !== userId) {
        throw new ForbiddenException('เฉพาะผู้สร้างรอบจึงจะแก้ไขได้');
      }
      if (batch.status !== 'DRAFT') {
        throw new BadRequestException('แก้ไขได้เฉพาะรอบสถานะร่าง (DRAFT) เท่านั้น');
      }

      const snapshot = await this.buildSnapshot(tx, dto.contractIds);

      // Hard delete (not soft) is deliberate here: (batchId, contractId) is a
      // plain (non-partial) unique index, so soft-deleting old items would
      // collide with a re-created row for any contract that stays in the
      // edited set. These item rows are a pure recomputable GL snapshot that
      // only becomes financial evidence once the batch leaves DRAFT (no JE
      // references them yet) — matches the plan's literal "delete items +
      // recreate" for this DRAFT-only path.
      await tx.interCoSettlementItem.deleteMany({ where: { batchId: id } });

      const updated = await tx.interCoSettlementBatch.update({
        where: { id },
        data: {
          transferDate: new Date(dto.transferDate),
          financeBankCode: dto.financeBankCode,
          shopBankCode: dto.shopBankCode,
          totalFinanced: snapshot.totalFinanced,
          totalCommission: snapshot.totalCommission,
          totalAmount: snapshot.totalAmount,
          shopPostedAmount: snapshot.shopPostedAmount,
          transferRef: dto.transferRef,
          slipFileKey: dto.slipFileKey,
          note: dto.note,
          items: { create: snapshot.items },
        },
        include: { items: true },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'INTERCO_BATCH_UPDATED',
          entity: 'interco_settlement_batch',
          entityId: id,
          newValue: {
            batchNumber: batch.batchNumber,
            contractIds: dto.contractIds,
            totalAmount: snapshot.totalAmount.toFixed(2),
          },
        },
      });

      return updated;
    });
  }

  async submitBatch(id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.interCoSettlementBatch.findUnique({
        where: { id },
        include: { items: { where: { deletedAt: null } } },
      });
      if (!batch || batch.deletedAt) throw new NotFoundException('ไม่พบรอบจ่าย');
      if (batch.makerId !== userId) {
        throw new ForbiddenException('เฉพาะผู้สร้างรอบจึงจะส่งอนุมัติได้');
      }
      if (batch.status !== 'DRAFT') {
        throw new BadRequestException('ส่งอนุมัติได้เฉพาะรอบสถานะร่าง (DRAFT) เท่านั้น');
      }

      // Re-validate: none of this batch's contracts may have been grabbed by
      // another batch that is now PENDING_APPROVAL/POSTED since createBatch
      // snapshotted them (race between two makers).
      const contractIds = batch.items.map((i) => i.contractId);
      if (contractIds.length > 0) {
        const clashes = await tx.interCoSettlementItem.findMany({
          where: {
            contractId: { in: contractIds },
            batchId: { not: id },
            deletedAt: null,
            batch: { status: { in: [...OPEN_BATCH_STATUSES] }, deletedAt: null },
          },
          include: { contract: { select: { contractNumber: true } } },
        });
        if (clashes.length > 0) {
          const labels = clashes.map((c) => c.contract.contractNumber);
          throw new BadRequestException(
            `สัญญา ${labels.join(', ')} ไม่อยู่ในคิวรอจ่าย หรืออยู่ในรอบจ่ายอื่นแล้ว`,
          );
        }
      }

      const updated = await tx.interCoSettlementBatch.update({
        where: { id },
        data: { status: 'PENDING_APPROVAL' },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'INTERCO_BATCH_SUBMITTED',
          entity: 'interco_settlement_batch',
          entityId: id,
          newValue: { batchNumber: batch.batchNumber },
        },
      });

      return updated;
    });
  }

  async withdrawBatch(id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.interCoSettlementBatch.findUnique({ where: { id } });
      if (!batch || batch.deletedAt) throw new NotFoundException('ไม่พบรอบจ่าย');
      if (batch.makerId !== userId) {
        throw new ForbiddenException('เฉพาะผู้สร้างรอบจึงจะถอนกลับได้');
      }
      if (batch.status !== 'PENDING_APPROVAL') {
        throw new BadRequestException('ถอนกลับได้เฉพาะรอบที่รอการอนุมัติ (PENDING_APPROVAL) เท่านั้น');
      }

      const updated = await tx.interCoSettlementBatch.update({
        where: { id },
        data: { status: 'DRAFT' },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'INTERCO_BATCH_WITHDRAWN',
          entity: 'interco_settlement_batch',
          entityId: id,
          newValue: { batchNumber: batch.batchNumber },
        },
      });

      return updated;
    });
  }

  /**
   * DRAFT/PENDING_APPROVAL → CANCELLED. Intentionally NOT maker/role gated
   * here (plan Task 3) — the controller (Task 5) applies the role check.
   * Only status is enforced: POSTED/REVERSED/already-CANCELLED can never be
   * cancelled this way (reverse an existing POSTED batch instead — Task 4).
   */
  async cancelBatch(id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.interCoSettlementBatch.findUnique({ where: { id } });
      if (!batch || batch.deletedAt) throw new NotFoundException('ไม่พบรอบจ่าย');
      if (batch.status !== 'DRAFT' && batch.status !== 'PENDING_APPROVAL') {
        throw new BadRequestException('ยกเลิกได้เฉพาะรอบสถานะร่างหรือรอการอนุมัติเท่านั้น');
      }

      const updated = await tx.interCoSettlementBatch.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'INTERCO_BATCH_CANCELLED',
          entity: 'interco_settlement_batch',
          entityId: id,
          newValue: { batchNumber: batch.batchNumber, previousStatus: batch.status },
        },
      });

      return updated;
    });
  }

  async listBatches(query: { status?: string; page?: number; limit?: number }) {
    const where: Prisma.InterCoSettlementBatchWhereInput = { deletedAt: null };
    if (query.status) {
      where.status = query.status as Prisma.InterCoSettlementBatchWhereInput['status'];
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(200, Math.max(1, query.limit || 50));

    const [data, total] = await Promise.all([
      this.prisma.interCoSettlementBatch.findMany({
        where,
        include: {
          maker: { select: { id: true, name: true } },
          approver: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.interCoSettlementBatch.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /** Batch + items (with contractNumber/customer) + both JE entryNumbers (FK-by-value lookup). */
  async getBatch(id: string) {
    const batch = await this.prisma.interCoSettlementBatch.findUnique({
      where: { id },
      include: {
        maker: { select: { id: true, name: true } },
        approver: { select: { id: true, name: true } },
        items: {
          where: { deletedAt: null },
          include: {
            contract: {
              select: { id: true, contractNumber: true, customer: { select: { name: true } } },
            },
          },
        },
      },
    });
    if (!batch || batch.deletedAt) throw new NotFoundException('ไม่พบรอบจ่าย');

    const [financeJe, shopJe] = await Promise.all([
      batch.financeJournalEntryId
        ? this.prisma.journalEntry.findUnique({
            where: { id: batch.financeJournalEntryId },
            select: { entryNumber: true },
          })
        : null,
      batch.shopJournalEntryId
        ? this.prisma.journalEntry.findUnique({
            where: { id: batch.shopJournalEntryId },
            select: { entryNumber: true },
          })
        : null,
    ]);

    return {
      ...batch,
      financeEntryNumber: financeJe?.entryNumber ?? null,
      shopEntryNumber: shopJe?.entryNumber ?? null,
    };
  }
}
