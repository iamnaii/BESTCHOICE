import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InterCoItemType, Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { IntercoPendingService, PendingContract } from './interco-pending.service';
import { IntercoBatchNumberService } from './interco-batch-number.service';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { ShopCollectSettlementTemplate } from '../journal/cpa-templates/shop-collect-settlement.template';
import { CreateBatchDto } from './dto/create-batch.dto';
import { SettleRecallCashDto } from './dto/settle-recall-cash.dto';
import { PairedJournalService } from '../journal/paired-journal.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { JournalAutoService, JeLineInput } from '../journal/journal-auto.service';
import { glContractBalance } from '../journal/gl-contract-balance';
import {
  recallFinanceBalance,
  recallShopBalance,
  swapCreditFinanceBalance,
  swapCreditShopBalance,
} from './interco-typed-balance';
import { validatePeriodOpen } from '../../utils/period-lock.util';
import { StorageService } from '../storage/storage.service';

const DEFAULT_FINANCE_BANK_CODE = '11-1201';
/** SHOP leg ของเส้นทางรับเงินสดคืน (Phase 3 Task 6) — Dr S21-3001 / Cr เงินสด SHOP */
const RECALL_CASH_SHOP_FLOW = 'interco-recall-cash-shop';
/** Batch statuses that "lock" a contract out of the pending queue (spec §4). */
const OPEN_BATCH_STATUSES = ['PENDING_APPROVAL', 'POSTED'] as const;
/** Drift-guard tolerance on the 4 GL lens amounts (spec §5.1). */
const DRIFT_TOLERANCE = new Prisma.Decimal('0.01');

/** Batch + items + per-item contractNumber — shape approve/reverse work with. */
type BatchWithItems = Prisma.InterCoSettlementBatchGetPayload<{
  include: {
    items: {
      include: { contract: { select: { contractNumber: true } } };
    };
  };
}>;

interface BuiltSnapshotItem {
  contractId: string;
  itemType: InterCoItemType;
  financedGl: Prisma.Decimal;
  commissionGl: Prisma.Decimal;
  shopFinancedGl: Prisma.Decimal;
  shopCommissionGl: Prisma.Decimal;
  legacyNoShop: boolean;
  /** Snapshot เครดิตเปลี่ยนเครื่อง (11-2107 SWAP_CREDIT) — 0 เมื่อไม่ใช่ swap/ไม่ eligible */
  swapCreditAmount: Prisma.Decimal;
  /** Snapshot ยอดเรียกคืน (11-2107 PAYOUT_RECALL) — ใช้เฉพาะแถว RECALL */
  recallAmount: Prisma.Decimal;
}

interface BuiltSnapshot {
  items: BuiltSnapshotItem[];
  totalFinanced: Prisma.Decimal;
  totalCommission: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  shopPostedAmount: Prisma.Decimal;
  /** Σ swapCreditAmount + recallAmount ของทุก item (Phase 2 หักกลบ) */
  totalDeduction: Prisma.Decimal;
  /** เงินโอนจริงฝั่ง FINANCE = totalAmount − totalDeduction */
  netTransferAmount: Prisma.Decimal;
  /** เงินรับจริงฝั่ง SHOP = shopPostedAmount − totalDeduction */
  shopNetAmount: Prisma.Decimal;
}

/**
 * เมนู "จ่ายให้หน้าร้าน (INTER-CO)" — batch lifecycle (DRAFT → PENDING_APPROVAL,
 * withdraw, cancel, update-while-DRAFT). `approveBatch`/`reverseBatch` (the
 * paired-JE half) land in Task 4 — do NOT call PairedJournalService here.
 *
 * Maker–checker (spec §6): create/submit/withdraw/update are maker-only
 * server-side checks. approve/reverse are gated by ROLE at the controller
 * (`@Roles('OWNER','FINANCE_MANAGER')`); the hard "approver ≠ maker" rule was
 * retired 2026-08-03 (owner: คุมด้วยการกำหนดสิทธิแทน) and is now opt-in via
 * SystemConfig `interco_maker_checker_enabled` (default OFF — see
 * `approveBatch` step 1b). `cancelBatch` intentionally has NO maker/role check
 * here — the controller (Task 5) gates it by role; this method only guards status.
 *
 * Spec: docs/superpowers/specs/2026-07-30-interco-settlement-batch-design.md §3, §4, §6
 */
@Injectable()
export class IntercoSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pendingService: IntercoPendingService,
    private readonly batchNumberService: IntercoBatchNumberService,
    private readonly pairedJournal: PairedJournalService,
    private readonly companyResolver: CompanyResolverService,
    private readonly journalAuto: JournalAutoService,
    private readonly storage: StorageService,
    private readonly shopCollectTemplate: ShopCollectSettlementTemplate,
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
   *
   * Phase 2 (หักกลบ 11-2107 — spec §4.1/§5.1): the lens amounts stay GROSS —
   * the snapshot captures them as-is and layers the deduction on top:
   *   - SETTLEMENT items carry `swapCreditAmount` (= swapCreditGl when
   *     eligible, else 0 — legacy/mixed-era swaps enter WITHOUT a deduction).
   *   - RECALL rows (Flow C-2) come from `getPendingRecalls` and have no
   *     payable/receivable of their own (all 4 GL snapshots = 0,
   *     legacyNoShop = false) — only `recallAmount`.
   *   - totals: totalDeduction = Σ(swapCredit + recall);
   *     netTransferAmount = totalAmount − totalDeduction;
   *     shopNetAmount = shopPostedAmount − totalDeduction — both must be ≥ 0
   *     (เงินสดส่วนที่หักเกินต้องเรียกคืนผ่านช่องทางรับโอนจากหน้าร้าน ไม่ใช่รอบจ่าย).
   */
  private async buildSnapshot(
    tx: Prisma.TransactionClient,
    contractIds: string[],
    recallContractIds?: string[],
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

    const zero = new Prisma.Decimal(0);
    let totalFinanced = zero;
    let totalCommission = zero;
    let shopPostedAmount = zero;

    const items: BuiltSnapshotItem[] = contractIds.map((contractId) => {
      const p = pendingByContractId.get(contractId)!;
      this.assertNonNegativeGl(p);
      const payable = p.financedGl.plus(p.commissionGl);
      // สองสมุดมียอดทั้งคู่แต่ไม่เท่ากัน (±0.01) — GL ผิดปกติ ห้ามหักเดาข้างใดข้างหนึ่ง
      // (legacy swap ที่ SHOP = 0 ไม่เข้าเงื่อนไขนี้ — เข้ารอบได้แบบไม่หัก)
      if (p.swapCreditGl.gt(0) && p.shopBuybackPayableGl.gt(0) && !p.swapCreditEligible) {
        throw new BadRequestException(
          `ยอดเครดิตเปลี่ยนเครื่องสองสมุดไม่ตรงกัน สัญญา ${p.contractNumber} ` +
            `(FINANCE ${p.swapCreditGl.toFixed(2)} / SHOP ${p.shopBuybackPayableGl.toFixed(2)}) — ตรวจสอบ GL ก่อนสร้างรอบ`,
        );
      }
      const swapCreditAmount = p.swapCreditEligible ? p.swapCreditGl : zero;
      // Workbook guard ("คงสูตร IF ห้ามลบ"): ราคารับซื้อต้องน้อยกว่าเจ้าหนี้ของสัญญานั้น
      if (swapCreditAmount.gte(payable) && swapCreditAmount.gt(0)) {
        throw new BadRequestException(
          `ราคารับซื้อ (${swapCreditAmount.toFixed(2)}) ต้องน้อยกว่าเจ้าหนี้สัญญา ${p.contractNumber} ` +
            `(${payable.toFixed(2)}) — กรณีนี้ไม่เกิดตามนโยบายธุรกิจ ตรวจสอบ GL ก่อน`,
        );
      }
      totalFinanced = totalFinanced.plus(p.financedGl);
      totalCommission = totalCommission.plus(p.commissionGl);
      if (!p.legacyNoShop) {
        shopPostedAmount = shopPostedAmount.plus(p.shopFinancedGl).plus(p.shopCommissionGl);
      }
      return {
        contractId,
        itemType: 'SETTLEMENT' as const,
        financedGl: p.financedGl,
        commissionGl: p.commissionGl,
        shopFinancedGl: p.shopFinancedGl,
        shopCommissionGl: p.shopCommissionGl,
        legacyNoShop: p.legacyNoShop,
        swapCreditAmount,
        recallAmount: zero,
      };
    });

    // RECALL rows (Flow C-2 — spec §4.1)
    const recallIds = [...new Set(recallContractIds ?? [])];
    if (recallIds.some((id) => contractIds.includes(id))) {
      throw new BadRequestException('สัญญาเดียวกันอยู่ทั้งรายการจ่ายและรายการเรียกคืนไม่ได้');
    }
    if (recallIds.length > 0) {
      const recalls = await this.pendingService.getPendingRecalls(tx);
      const byId = new Map(recalls.map((r) => [r.contractId, r]));
      for (const id of recallIds) {
        const r = byId.get(id);
        if (!r) {
          const labels = await this.resolveContractLabels(tx, [id]);
          throw new BadRequestException(
            `สัญญา ${labels[0]} ไม่อยู่ในคิวเรียกคืน หรืออยู่ในรอบจ่ายอื่นแล้ว`,
          );
        }
        if (r.recallGl.minus(r.shopRecallGl).abs().gt('0.01')) {
          throw new BadRequestException(
            `ยอดเรียกคืนสองสมุดไม่ตรงกัน สัญญา ${r.contractNumber} ` +
              `(FINANCE ${r.recallGl.toFixed(2)} / SHOP ${r.shopRecallGl.toFixed(2)}) — ตรวจสอบ GL ก่อนสร้างรอบ`,
          );
        }
        items.push({
          contractId: id,
          itemType: 'RECALL' as const,
          financedGl: zero,
          commissionGl: zero,
          shopFinancedGl: zero,
          shopCommissionGl: zero,
          legacyNoShop: false,
          swapCreditAmount: zero,
          recallAmount: r.recallGl,
        });
      }
    }

    const totalAmount = totalFinanced.plus(totalCommission);
    const totalDeduction = items.reduce(
      (s, i) => s.plus(i.swapCreditAmount).plus(i.recallAmount),
      zero,
    );
    const netTransferAmount = totalAmount.minus(totalDeduction);
    const shopNetAmount = shopPostedAmount.minus(totalDeduction);
    if (netTransferAmount.lt(0) || shopNetAmount.lt(0)) {
      // ระบุสมุดที่ติดลบ (final review minor 3): SHOP ติดลบฝ่ายเดียวเกิดได้เมื่อ
      // รอบมีสัญญา legacyNoShop (shopPostedAmount < totalAmount).
      const negativeBooks: string[] = [];
      if (netTransferAmount.lt(0)) negativeBooks.push('ฝั่ง FINANCE');
      if (shopNetAmount.lt(0)) {
        negativeBooks.push('ฝั่ง SHOP — รอบมีสัญญา legacy ที่ไม่มีลูกหนี้ฝั่งร้าน');
      }
      throw new BadRequestException(
        `ยอดหักรวม (${totalDeduction.toFixed(2)}) เกินยอดจ่ายของรอบ (${negativeBooks.join(' และ ')}) — ` +
          'เลือกสัญญาเพิ่มให้ยอดพอ หรือเรียกเงินสดคืนผ่านช่องทางรับโอนจากหน้าร้านแทน',
      );
    }

    return {
      items,
      totalFinanced,
      totalCommission,
      totalAmount,
      shopPostedAmount,
      totalDeduction,
      netTransferAmount,
      shopNetAmount,
    };
  }

  /**
   * Final-review W1: `IntercoPendingService`'s HAVING clause nets 21-1101 +
   * 21-1102 together — if a stray JV drives ONE component negative while the
   * combined total stays positive, the pending row still surfaces. Left
   * unguarded, `buildFinanceLines`/`buildShopLines` would emit a Dr line with
   * a negative amount (the JE still balances Dr=Cr in raw sum, but the line
   * is booked on the wrong side of the ledger). Guard here — before the
   * amount ever reaches a snapshot/JE — for all 4 GL components.
   */
  private assertNonNegativeGl(p: PendingContract): void {
    const checks: Array<{ value: Prisma.Decimal; code: string }> = [
      { value: p.financedGl, code: '21-1101' },
      { value: p.commissionGl, code: '21-1102' },
      { value: p.shopFinancedGl, code: 'S11-3001' },
      { value: p.shopCommissionGl, code: 'S11-3002' },
      // Phase 2 lens components — a negative typed balance means an over-
      // cleared/stray JV on the swap-credit pair; same alarm-and-reject
      // posture as W1 (never let a wrong-sign amount reach a snapshot).
      { value: p.swapCreditGl, code: '11-2107' },
      { value: p.shopBuybackPayableGl, code: 'S21-3001' },
    ];
    for (const { value, code } of checks) {
      if (value.lt(0)) {
        Sentry.captureMessage('Interco settlement: negative GL component on pending contract', {
          level: 'warning',
          tags: { subsystem: 'interco-settlement' },
          extra: {
            contractId: p.contractId,
            contractNumber: p.contractNumber,
            accountCode: code,
            value: value.toFixed(2),
          },
        });
        throw new BadRequestException(
          `พบยอด GL ติดลบบนสัญญา ${p.contractNumber} (บัญชี ${code}) — ตรวจสอบ JV ผิดปกติก่อนสร้างรอบ`,
        );
      }
    }
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
      const snapshot = await this.buildSnapshot(tx, dto.contractIds, dto.recallContractIds);
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
          totalDeduction: snapshot.totalDeduction,
          netTransferAmount: snapshot.netTransferAmount,
          shopNetAmount: snapshot.shopNetAmount,
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
            recallContractIds: dto.recallContractIds ?? [],
            totalAmount: snapshot.totalAmount.toFixed(2),
            shopPostedAmount: snapshot.shopPostedAmount.toFixed(2),
            totalDeduction: snapshot.totalDeduction.toFixed(2),
            netTransferAmount: snapshot.netTransferAmount.toFixed(2),
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

      const snapshot = await this.buildSnapshot(tx, dto.contractIds, dto.recallContractIds);

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
          totalDeduction: snapshot.totalDeduction,
          netTransferAmount: snapshot.netTransferAmount,
          shopNetAmount: snapshot.shopNetAmount,
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
            recallContractIds: dto.recallContractIds ?? [],
            totalAmount: snapshot.totalAmount.toFixed(2),
            totalDeduction: snapshot.totalDeduction.toFixed(2),
            netTransferAmount: snapshot.netTransferAmount.toFixed(2),
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
      //
      // Type-aware per item (Phase 2): a RECALL row's contract BY DEFINITION
      // carries a permanent SETTLEMENT item in some old POSTED batch (Flow
      // C-2 = ยกเลิกหลังตัดจ่าย) — counting that as a clash would make every
      // batch with a recall row structurally unsubmittable. Mirror
      // `getPendingRecalls`'s settled gate instead: RECALL rows clash only
      // with other RECALL items; SETTLEMENT rows keep the any-type clash
      // (same as `getPendingContracts`'s gate).
      const settlementIds = batch.items
        .filter((i) => i.itemType !== 'RECALL')
        .map((i) => i.contractId);
      const recallIds = batch.items
        .filter((i) => i.itemType === 'RECALL')
        .map((i) => i.contractId);
      const clashConditions: Prisma.InterCoSettlementItemWhereInput[] = [];
      if (settlementIds.length > 0) {
        clashConditions.push({ contractId: { in: settlementIds } });
      }
      if (recallIds.length > 0) {
        clashConditions.push({ contractId: { in: recallIds }, itemType: 'RECALL' });
      }
      if (clashConditions.length > 0) {
        const clashes = await tx.interCoSettlementItem.findMany({
          where: {
            OR: clashConditions,
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

  /**
   * Attaches a slip/proof-of-transfer file to a batch (spec §6 — "แนบสลิป:
   * upload S3 (optional)"). Maker-only, DRAFT/PENDING_APPROVAL only (mirrors
   * the update/withdraw guard — once POSTED the batch + its evidence are
   * frozen). Reuses the house S3 upload pattern from
   * `OtherIncomeService.uploadAttachment` (magic-byte re-check on top of the
   * controller's Content-Type validator, safe filename, `StorageService`).
   */
  async uploadSlip(id: string, file: Express.Multer.File, userId: string) {
    const batch = await this.prisma.interCoSettlementBatch.findUnique({ where: { id } });
    if (!batch || batch.deletedAt) throw new NotFoundException('ไม่พบรอบจ่าย');
    if (batch.makerId !== userId) {
      throw new ForbiddenException('เฉพาะผู้สร้างรอบจึงจะแนบสลิปได้');
    }
    if (batch.status !== 'DRAFT' && batch.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('แนบสลิปได้เฉพาะรอบสถานะร่างหรือรอการอนุมัติเท่านั้น');
    }

    if (!this.matchesMimeMagicBytes(file)) {
      throw new BadRequestException(
        'ประเภทไฟล์ไม่ตรงกับเนื้อหา (รองรับเฉพาะ PDF, JPEG, PNG, WEBP)',
      );
    }

    const decodedName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    // eslint-disable-next-line no-control-regex
    const safeName = decodedName.replace(/[<>:"/\\|?*\x00-\s]/g, '_');
    const key = `interco-slips/${id}/${Date.now()}-${randomUUID()}-${safeName}`;

    await this.storage.upload(key, file.buffer, file.mimetype);

    try {
      return await this.prisma.interCoSettlementBatch.update({
        where: { id },
        data: { slipFileKey: key },
      });
    } catch (err) {
      await this.storage.delete(key).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Confirms the uploaded file's first bytes match the declared mimetype —
   * defence-in-depth on top of the controller's Content-Type-based
   * `FileTypeValidator` (client-controlled header). Mirrors
   * `OtherIncomeService.matchesMimeMagicBytes` (PDF/JPEG/PNG/WEBP only).
   */
  private matchesMimeMagicBytes(file: Express.Multer.File): boolean {
    const buf = file.buffer;
    if (!buf || buf.length < 12) return false;
    const mime = file.mimetype;

    if (mime === 'application/pdf') {
      // %PDF-
      return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d;
    }
    if (mime === 'image/jpeg') {
      // FF D8 FF
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    }
    if (mime === 'image/png') {
      // 89 50 4E 47 0D 0A 1A 0A
      return (
        buf[0] === 0x89 &&
        buf[1] === 0x50 &&
        buf[2] === 0x4e &&
        buf[3] === 0x47 &&
        buf[4] === 0x0d &&
        buf[5] === 0x0a &&
        buf[6] === 0x1a &&
        buf[7] === 0x0a
      );
    }
    if (mime === 'image/webp') {
      // 'RIFF'....'WEBP'
      return (
        buf[0] === 0x52 &&
        buf[1] === 0x49 &&
        buf[2] === 0x46 &&
        buf[3] === 0x46 &&
        buf[8] === 0x57 &&
        buf[9] === 0x45 &&
        buf[10] === 0x42 &&
        buf[11] === 0x50
      );
    }
    return false;
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

  /**
   * PENDING_APPROVAL → POSTED. Posts the paired JE (or a FINANCE-only JE when
   * every item is `legacyNoShop`) inside ONE `$transaction`, per spec §5:
   *   1. load + status (+ optional SoD approver ≠ maker — only when
   *      SystemConfig `interco_maker_checker_enabled` = 'true'; default OFF)
   *   2. re-check no item's contract got grabbed by another open batch
   *   3. drift guard — live GL (via `glContractBalance`, which reads straight
   *      off `journal_lines`/`journal_entries` and has NO notion of batch
   *      status) vs the item snapshot, ±0.01 — this sidesteps the pending
   *      engine's own "settled" exclusion entirely (this batch's own
   *      PENDING_APPROVAL items would otherwise be invisible to
   *      `IntercoPendingService.getPendingContracts`), so no change to that
   *      service's public interface was needed
   *   4. period guard both companies (FINANCE + SHOP) against `postedAt`
   *      (`postedAtOverride` when given — D4 backdated-round support; the
   *      controller/DTO layer (Task 5) parses the ISO string into a Date)
   *   5. post JE(s)
   *   6. best-effort mark matching `InterCompanyTransaction` rows RECONCILED
   *   7. batch → POSTED + audit `INTERCO_BATCH_APPROVED`
   *   8. AFTER the tx commits: fire-and-forget `alarmNettingResiduals` (spec
   *      §4.7 — alarm-only, never awaited/thrown on the money path; root
   *      prisma, doctrine R-1)
   */
  async approveBatch(id: string, userId: string, postedAtOverride?: Date) {
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. load + status
      const batch = (await tx.interCoSettlementBatch.findUnique({
        where: { id },
        include: {
          items: {
            where: { deletedAt: null },
            include: { contract: { select: { contractNumber: true } } },
          },
        },
      })) as BatchWithItems | null;
      if (!batch || batch.deletedAt) throw new NotFoundException('ไม่พบรอบจ่าย');
      if (batch.status !== 'PENDING_APPROVAL') {
        throw new BadRequestException(
          'อนุมัติได้เฉพาะรอบที่รอการอนุมัติ (PENDING_APPROVAL) เท่านั้น',
        );
      }
      // 1b. Maker–checker (opt-in, DEFAULT OFF — คำสั่งเจ้าของ 2026-08-03).
      //     กิจการเล็ก คุมการอนุมัติด้วย "การกำหนดสิทธิ" (`@Roles('OWNER',
      //     'FINANCE_MANAGER')` ที่ controller) แทนกฎตายตัว "ผู้อนุมัติต้องไม่ใช่
      //     ผู้สร้าง" — คนเดียวกันสร้างแล้วอนุมัติเองได้ ถ้ามีสิทธิ. เปิด SoD
      //     กลับได้โดยไม่ต้องแก้โค้ด: ตั้ง SystemConfig `interco_maker_checker_enabled`
      //     = 'true'. ไม่ seed คีย์นี้ — แถวหาย/ค่าอื่นใดที่ไม่ใช่สตริง 'true' = OFF
      //     (config-read shape เดียวกับ OTHER_INCOME_MAKER_CHECKER_ENABLED และ
      //     `jp5_require_terminated_status`). อ่านใน tx เดียวกับที่โพสต์ JE เพื่อให้
      //     ค่าที่ใช้ตัดสินเป็นค่าเดียวกันตลอดการอนุมัติรอบนี้.
      //     หมายเหตุ audit: `makerId`/`approverId` ยังถูกบันทึกครบทั้งบน batch และใน
      //     AuditLog `INTERCO_BATCH_APPROVED` เสมอ แม้จะเป็นคนเดียวกัน.
      const makerCheckerConfig = await tx.systemConfig.findUnique({
        where: { key: 'interco_maker_checker_enabled' },
      });
      const makerCheckerEnabled = makerCheckerConfig?.value === 'true';
      if (makerCheckerEnabled && batch.makerId === userId) {
        throw new ForbiddenException('ผู้อนุมัติต้องไม่ใช่ผู้สร้างรอบ');
      }

      const contractIds = batch.items.map((i) => i.contractId);

      // 2. re-check no item's contract got grabbed by another PENDING_APPROVAL/POSTED batch.
      //    Type-aware per item (Phase 2 — same split as submitBatch): a RECALL
      //    row's contract BY DEFINITION carries a permanent SETTLEMENT item in
      //    some old POSTED batch (Flow C-2 = ยกเลิกหลังตัดจ่าย) — counting that
      //    as a clash would make every batch with a recall row structurally
      //    unapprovable. RECALL rows clash only with other RECALL items;
      //    SETTLEMENT rows keep the any-type clash (double-pay guard).
      const clashSettlementIds = batch.items
        .filter((i) => i.itemType !== 'RECALL')
        .map((i) => i.contractId);
      const clashRecallIds = batch.items
        .filter((i) => i.itemType === 'RECALL')
        .map((i) => i.contractId);
      const clashConditions: Prisma.InterCoSettlementItemWhereInput[] = [];
      if (clashSettlementIds.length > 0) {
        clashConditions.push({ contractId: { in: clashSettlementIds } });
      }
      if (clashRecallIds.length > 0) {
        clashConditions.push({ contractId: { in: clashRecallIds }, itemType: 'RECALL' });
      }
      if (clashConditions.length > 0) {
        const clashes = await tx.interCoSettlementItem.findMany({
          where: {
            OR: clashConditions,
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

      // 3. drift guard — live GL vs snapshot, ±0.01, per item (Phase 2: typed
      //    11-2107/S21-3001 balances included — spec §5.1)
      const driftedContractNumbers: string[] = [];
      for (const item of batch.items) {
        // Final review C1 ด่าน (i) — กันหักซ้ำกับ settleShopCollect: JE settle
        // เป็นประเภท SHOP_COLLECT ซึ่ง typed lens ด้านล่างกรองทิ้งโดยนิยาม แต่
        // มันลดยอด 11-2107 จริงของสัญญา. เช็คด้วย UNTYPED balance (ตาม
        // metadata.contractId, ไม่กรองประเภท) − Σ deduction ที่ batch POSTED
        // อื่นหักไปแล้ว (batch JE ไม่ stamp contractId — "หักแล้ว" อ่านจาก item
        // table ตาม architecture ruling, ไม่ใช่ GL metadata): ส่วนที่เหลือต้อง
        // ยังคุ้มยอดหักของ item นี้ ไม่งั้น approve จะ Cr 11-2107 เกินของจริง
        // (บัญชีติดลบ / SHOP ได้เงินสองเด้ง).
        const deduction = item.swapCreditAmount.plus(item.recallAmount);
        // Σ deduction ที่ batch POSTED **อื่น** เคยหักไปแล้ว (ทุก itemType) —
        // ใช้ร่วมกันทั้งด่าน (i) และเช็ค NET ของแถว RECALL ด้านล่าง. batch
        // ปัจจุบันยัง PENDING_APPROVAL จึงไม่เข้า filter POSTED โดยสถานะอยู่แล้ว
        // แต่ exclude ด้วย `batchId: { not: id }` ให้ชัดตาม pattern ด่าน (i).
        let priorPostedDeductions = new Prisma.Decimal(0);
        if (deduction.gt(0)) {
          const [untypedBal, priorItems] = await Promise.all([
            glContractBalance(tx, item.contractId, '11-2107', 'dr'),
            tx.interCoSettlementItem.findMany({
              where: {
                contractId: item.contractId,
                batchId: { not: id },
                deletedAt: null,
                batch: { status: 'POSTED', deletedAt: null },
              },
              select: { swapCreditAmount: true, recallAmount: true },
            }),
          ]);
          priorPostedDeductions = priorItems.reduce(
            (s, i) => s.plus(i.swapCreditAmount).plus(i.recallAmount),
            new Prisma.Decimal(0),
          );
          if (untypedBal.minus(priorPostedDeductions).lt(deduction.minus(DRIFT_TOLERANCE))) {
            driftedContractNumbers.push(item.contract.contractNumber);
            continue;
          }
        }
        if (item.itemType === 'RECALL') {
          // RECALL rows have no payable/receivable snapshot of their own —
          // both books' typed PAYOUT_RECALL balances, **net of deductions
          // already posted in other batches**, must still equal the
          // snapshotted recallAmount (สูตร NET — Phase 3 Task 4, carry b:
          // snapshot จาก `getPendingRecalls` เป็น net อยู่แล้ว live จึงต้อง
          // เทียบสูตรเดียวกัน). เคสหลักคือ swap ที่ถูกยกเลิกหลังเคยถูกหัก
          // เครดิต 8,000 ในรอบเก่า: typed gross = 11,000 แต่ยอดเรียกคืนจริง
          // (และ snapshot) = 3,000 — เทียบ gross ตรงๆ จะ reject รอบ recall
          // ที่ถูกต้องตลอดกาล.
          const [recallFin, recallShop] = await Promise.all([
            recallFinanceBalance(tx, item.contractId),
            recallShopBalance(tx, item.contractId),
          ]);
          const netFin = recallFin.minus(priorPostedDeductions);
          const netShop = recallShop.minus(priorPostedDeductions);
          if (
            netFin.minus(item.recallAmount).abs().gt(DRIFT_TOLERANCE) ||
            netShop.minus(item.recallAmount).abs().gt(DRIFT_TOLERANCE)
          ) {
            driftedContractNumbers.push(item.contract.contractNumber);
          }
          continue;
        }
        const [financedGl, commissionGl, shopFinancedGl, shopCommissionGl, scFin, scShop] =
          await Promise.all([
            glContractBalance(tx, item.contractId, '21-1101', 'cr'),
            glContractBalance(tx, item.contractId, '21-1102', 'cr'),
            glContractBalance(tx, item.contractId, 'S11-3001', 'dr'),
            glContractBalance(tx, item.contractId, 'S11-3002', 'dr'),
            swapCreditFinanceBalance(tx, item.contractId),
            swapCreditShopBalance(tx, item.contractId),
          ]);
        let drifted =
          financedGl.minus(item.financedGl).abs().gt(DRIFT_TOLERANCE) ||
          commissionGl.minus(item.commissionGl).abs().gt(DRIFT_TOLERANCE) ||
          shopFinancedGl.minus(item.shopFinancedGl).abs().gt(DRIFT_TOLERANCE) ||
          shopCommissionGl.minus(item.shopCommissionGl).abs().gt(DRIFT_TOLERANCE);
        if (item.swapCreditAmount.gt(0)) {
          // (ก) แถวที่หักเครดิต: live ทั้งสองสมุดต้องเท่ากับ snapshot ±0.01
          if (
            scFin.minus(item.swapCreditAmount).abs().gt(DRIFT_TOLERANCE) ||
            scShop.minus(item.swapCreditAmount).abs().gt(DRIFT_TOLERANCE)
          ) {
            drifted = true;
          }
        } else if (scFin.gt(DRIFT_TOLERANCE) && scShop.gt(DRIFT_TOLERANCE)) {
          // (ข) snapshot ไม่มีหัก (0) แต่ live มีเครดิต NETTABLE — สองสมุดครบ
          // (ทั้ง 11-2107 [SWAP_CREDIT] และ S21-3001) — เครดิตที่หักได้จริงโผล่
          // หลัง snapshot (legacy swap ที่เพิ่งได้ S21-3001 หรือ JE แทรก) =
          // drift; จ่าย gross ทั้งที่มีเครดิต nettable ค้างจะทำให้เครดิตนั้น
          // ไม่มีเจ้าหนี้เหลือให้หักตลอดกาล.
          // เครดิตสมุดเดียว (scFin > 0 แต่ scShop = 0 — swap ที่ finalize ก่อน
          // Phase 1, spec §11.4) จงใจ **ไม่ใช่ drift**: มันหักไม่ได้โดยโครงสร้าง
          // อยู่แล้ว (ฝั่ง SHOP ไม่มี S21-3001 ให้ Dr → ใบ SHOP ไม่ balance) —
          // ต้องจ่ายเต็มในรอบปกติ แล้วปล่อย 11-2107 ล้างผ่าน shop-collect
          // ตามเดิม. ถ้านับเป็น drift รอบที่มี legacy swap จะอนุมัติไม่ได้
          // ตลอดกาล (cancel → สร้างใหม่ก็ snapshot 0 เท่าเดิม — deadlock).
          drifted = true;
        }
        if (drifted) driftedContractNumbers.push(item.contract.contractNumber);
      }
      if (driftedContractNumbers.length > 0) {
        throw new BadRequestException(
          `ยอด GL ของสัญญา ${driftedContractNumbers.join(', ')} เปลี่ยนไปจากตอนสร้างรอบ ` +
            '(มีรายการเดินบัญชีแทรกระหว่างทาง) — กรุณายกเลิกรอบนี้แล้วสร้างรอบใหม่',
        );
      }

      // 4. period guard — both companies
      const financeCompanyId = await this.companyResolver.getFinanceCompanyId(tx);
      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
      const postedAt = postedAtOverride ?? batch.transferDate;
      await this.guardPeriodOpen(tx, postedAt, financeCompanyId, 'FINANCE');
      await this.guardPeriodOpen(tx, postedAt, shopCompanyId, 'SHOP');

      // 5. post JE(s) — metadata carries per-item type + deduction amounts, but
      //    deliberately NO top-level contractId/shopReceivableType (architecture
      //    ruling: batch JEs must never enter the typed per-contract lens —
      //    settledness lives on InterCoSettlementItem, not the GL metadata).
      const itemsMetadata = batch.items.map((i) => ({
        contractId: i.contractId,
        type: i.itemType,
        financed: i.financedGl.toFixed(2),
        commission: i.commissionGl.toFixed(2),
        swapCredit: i.swapCreditAmount.toFixed(2),
        recall: i.recallAmount.toFixed(2),
      }));
      const netTransferMetadata = (batch.netTransferAmount ?? batch.totalAmount).toFixed(2);
      const financeDescription = `จ่ายให้หน้าร้าน รอบ ${batch.batchNumber} (โอนจริง ${this.formatBkkDate(batch.transferDate)})`;
      const shopLines = this.buildShopLines(batch);
      const financeLines = this.buildFinanceLines(batch, financeDescription);

      let financeJournalEntryId: string;
      let shopJournalEntryId: string | null = null;

      try {
        if (shopLines.length > 0) {
          const shopDescription = `รับโอนจาก FINANCE รอบ ${batch.batchNumber} (โอนจริง ${this.formatBkkDate(batch.transferDate)})`;
          const paired = await this.pairedJournal.postPaired(
            {
              shop: {
                companyCode: 'SHOP',
                description: shopDescription,
                metadata: {
                  flow: 'interco-settlement-batch',
                  idempotencyKey: `interco:${batch.id}:SHOP`,
                  settlementBatchId: batch.id,
                  batchNumber: batch.batchNumber,
                  transferDate: batch.transferDate.toISOString(),
                  netTransferAmount: netTransferMetadata,
                  items: itemsMetadata,
                },
                postedAt,
                lines: shopLines,
              },
              finance: {
                companyCode: 'FINANCE',
                description: financeDescription,
                metadata: {
                  flow: 'interco-settlement-batch',
                  idempotencyKey: `interco:${batch.id}:FINANCE`,
                  settlementBatchId: batch.id,
                  batchNumber: batch.batchNumber,
                  transferDate: batch.transferDate.toISOString(),
                  netTransferAmount: netTransferMetadata,
                  items: itemsMetadata,
                },
                postedAt,
                lines: financeLines,
              },
              batchRef: batch.id,
            },
            tx,
          );
          financeJournalEntryId = paired.financeJournalEntryId;
          shopJournalEntryId = paired.shopJournalEntryId;
        } else {
          const finance = await this.journalAuto.createAndPost(
            {
              description: financeDescription,
              metadata: {
                flow: 'interco-settlement-batch',
                idempotencyKey: `interco:${batch.id}:FINANCE`,
                settlementBatchId: batch.id,
                batchNumber: batch.batchNumber,
                transferDate: batch.transferDate.toISOString(),
                netTransferAmount: netTransferMetadata,
                items: itemsMetadata,
              },
              postedAt,
              companyId: financeCompanyId,
              lines: financeLines,
            },
            tx,
          );
          financeJournalEntryId = finance.id;
        }
      } catch (err) {
        // W2 (final review): the DB-level `journal_entries_idempotency_idx`
        // partial unique index (flow, idempotencyKey) is the second line of
        // defense against a concurrent double-approve race — the LOSER of
        // that race must not see a raw 500. Translate P2002 into a friendly
        // Thai 409; the whole `$transaction` rolls back so the batch is
        // never marked POSTED twice.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException('รอบจ่ายนี้ถูกลงบัญชีไปแล้ว (คำขอซ้ำ)');
        }
        throw err;
      }

      // 6. best-effort mark matching InterCompanyTransaction rows RECONCILED
      await tx.interCompanyTransaction.updateMany({
        where: { contractId: { in: contractIds }, status: { not: 'RECONCILED' } },
        data: { status: 'RECONCILED' },
      });

      // 7. batch → POSTED + audit
      const posted = await tx.interCoSettlementBatch.update({
        where: { id },
        data: {
          status: 'POSTED',
          approverId: userId,
          postedAt,
          financeJournalEntryId,
          shopJournalEntryId,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'INTERCO_BATCH_APPROVED',
          entity: 'interco_settlement_batch',
          entityId: id,
          newValue: {
            batchNumber: batch.batchNumber,
            postedAt: postedAt.toISOString(),
            financeJournalEntryId,
            shopJournalEntryId,
            totalAmount: batch.totalAmount.toFixed(2),
            shopPostedAmount: batch.shopPostedAmount.toFixed(2),
          },
        },
      });

      return posted;
    });

    // spec §4.7 — alarm อย่างเดียว ห้าม throw/await บนเส้นทางเงิน (doctrine
    // R-1: root prisma เท่านั้น — method ไม่รับ tx client โดยลายเซ็น)
    void this.alarmNettingResiduals(id).catch((e) => Sentry.captureException(e));
    return result;
  }

  /**
   * ตรวจ residual หลัง approve (spec §4.7) — ภายใต้สถาปัตยกรรม "เลนส์ gross +
   * item gate": batch JE ไม่ stamp contractId (กันรั่วเข้า payable lens) จึงไม่
   * ลด typed balance ต่อสัญญา — residual ที่แท้จริง = typed gross − Σ deduction
   * ของสัญญานั้นใน batch สถานะ POSTED ทั้งหมด. ค่าปกติ = 0 พอดี (เครดิตถูกหัก
   * ครบรอบเดียว); > 0 = เครดิตงอกหลัง snapshot/หักไม่ครบ; < 0 = หักซ้ำ.
   *
   * สูตร COMBINED ต่อสัญญา (Phase 3 Task 4 — ปิด carry b): typed gross =
   * SWAP_CREDIT + PAYOUT_RECALL **รวมสองประเภท** ต่อสมุด, เทียบกับ Σ deduction
   * ทุก itemType ใน batch POSTED. เหตุผล: สัญญา swap ที่ถูกยกเลิก (C-2) มี
   * ประวัติข้ามประเภทบนสัญญาเดียว — SWAP_CREDIT ถูก mirror ตอน cancel จน typed
   * เหลือ 0 ขณะที่ deduction 8,000 ของมันยังค้างถาวรใน item table, ส่วน
   * PAYOUT_RECALL ถือ gross 11,000 ของ redirect. เทียบทีละประเภทตาม itemType
   * ของแถว (สูตรเดิม) จะ false-alarm ทันที (เช่น item swap รอบเก่า: 0 −
   * Σposted 11,000 = −11,000 ทั้งที่ทุกอย่างถูกต้อง) — ระดับที่ invariant
   * "= 0" ถือจริงคือระดับสัญญา ไม่ใช่ระดับประเภท.
   * Alarm-only — ห้าม throw (fire-and-forget จาก `approveBatch` หลัง tx commit).
   */
  private async alarmNettingResiduals(batchId: string): Promise<void> {
    const batch = await this.prisma.interCoSettlementBatch.findUnique({
      where: { id: batchId },
      include: { items: { where: { deletedAt: null } } },
    });
    if (!batch || batch.status !== 'POSTED') return;
    for (const item of batch.items) {
      const deduction = item.itemType === 'RECALL' ? item.recallAmount : item.swapCreditAmount;
      if (deduction.lte(0)) continue;
      const [swapFin, swapShop, recFin, recShop] = await Promise.all([
        swapCreditFinanceBalance(this.prisma, item.contractId),
        swapCreditShopBalance(this.prisma, item.contractId),
        recallFinanceBalance(this.prisma, item.contractId),
        recallShopBalance(this.prisma, item.contractId),
      ]);
      const fin = swapFin.plus(recFin);
      const shop = swapShop.plus(recShop);
      // Σ deduction ของสัญญานี้ในทุก batch POSTED (รวมรอบนี้เอง)
      const postedItems = await this.prisma.interCoSettlementItem.findMany({
        where: {
          contractId: item.contractId,
          deletedAt: null,
          batch: { status: 'POSTED', deletedAt: null },
        },
        select: { swapCreditAmount: true, recallAmount: true },
      });
      const postedDeduction = postedItems.reduce(
        (s, i) => s.plus(i.swapCreditAmount).plus(i.recallAmount),
        new Prisma.Decimal(0),
      );
      const finResidual = fin.minus(postedDeduction);
      const shopResidual = shop.minus(postedDeduction);
      if (finResidual.abs().gt('0.01') || shopResidual.abs().gt('0.01')) {
        Sentry.captureMessage('Interco netting: residual balance after approve', {
          level: 'warning',
          tags: { subsystem: 'interco-netting' },
          extra: {
            batchId,
            contractId: item.contractId,
            itemType: item.itemType,
            typedFinanceGross: fin.toFixed(2),
            typedShopGross: shop.toFixed(2),
            postedDeduction: postedDeduction.toFixed(2),
            financeResidual: finResidual.toFixed(2),
            shopResidual: shopResidual.toFixed(2),
          },
        });
      }
    }
  }

  /**
   * POSTED → REVERSED. Mirror-reverses BOTH JEs (swap Dr/Cr per line, same
   * companyId, `tag: 'REVERSAL'` + `reversesEntryId` back-ref — the house
   * pattern from `ExchangeCancelReversalTemplate`) — no metadata sweep needed
   * here (unlike the exchange module) because no OTHER JE ever carries this
   * batch's metadata; the batch row itself holds both JE ids directly.
   */
  async reverseBatch(id: string, userId: string, reason: string) {
    if (!reason || reason.trim().length < 10) {
      throw new BadRequestException('เหตุผลย้อนกลับต้องมีอย่างน้อย 10 ตัวอักษร');
    }

    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.interCoSettlementBatch.findUnique({ where: { id } });
      if (!batch || batch.deletedAt) throw new NotFoundException('ไม่พบรอบจ่าย');
      if (batch.status !== 'POSTED') {
        throw new BadRequestException('ย้อนกลับได้เฉพาะรอบที่อนุมัติแล้ว (POSTED) เท่านั้น');
      }

      const jeIds = [batch.financeJournalEntryId, batch.shopJournalEntryId].filter(
        (x): x is string => !!x,
      );
      const jes = await tx.journalEntry.findMany({
        where: { id: { in: jeIds }, status: 'POSTED', deletedAt: null },
        include: { lines: true },
      });
      if (jes.length !== jeIds.length) {
        throw new BadRequestException('ไม่พบ JE ต้นฉบับครบทั้งสองใบ — ไม่สามารถย้อนกลับได้');
      }

      let financeReversalId: string | null = null;
      let shopReversalId: string | null = null;

      for (const je of jes) {
        const meta = (je.metadata ?? {}) as Record<string, unknown>;
        const reversedLines: JeLineInput[] = je.lines.map((l) => ({
          accountCode: l.accountCode,
          dr: new Prisma.Decimal(l.credit.toString()),
          cr: new Prisma.Decimal(l.debit.toString()),
          description: `[ย้อนกลับรอบจ่าย] ${l.description ?? ''}`.trim(),
        }));

        let result: { id: string; entryNumber: string };
        try {
          result = await this.journalAuto.createAndPost(
            {
              description: `[ย้อนกลับรอบจ่าย] ${batch.batchNumber} — ${je.description}`,
              reference: `${je.id}:interco-settlement-reverse`,
              companyId: je.companyId,
              metadata: {
                tag: 'REVERSAL',
                flow: 'interco-settlement-batch-reverse',
                idempotencyKey: `interco-reverse:${je.id}`,
                originalEntryId: je.id,
                reversesEntryId: je.id,
                settlementBatchId: batch.id,
              },
              lines: reversedLines,
            },
            tx,
          );
        } catch (err) {
          // W2 (final review) — same DB-index race as approveBatch, mirrored
          // here for the reversal path.
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            throw new ConflictException('การย้อนกลับรอบจ่ายนี้ถูกลงบัญชีไปแล้ว (คำขอซ้ำ)');
          }
          throw err;
        }

        if (je.id === batch.financeJournalEntryId) financeReversalId = result.id;
        if (je.id === batch.shopJournalEntryId) shopReversalId = result.id;

        await tx.journalEntry.update({
          where: { id: je.id },
          data: {
            metadata: {
              ...(meta as Prisma.InputJsonObject),
              reversed: true,
              reversedByEntryNumber: result.entryNumber,
            },
          },
        });
      }

      const updated = await tx.interCoSettlementBatch.update({
        where: { id },
        data: { status: 'REVERSED', reverseReason: reason },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'INTERCO_BATCH_REVERSED',
          entity: 'interco_settlement_batch',
          entityId: id,
          newValue: {
            batchNumber: batch.batchNumber,
            reason,
            financeReversalJeId: financeReversalId,
            shopReversalJeId: shopReversalId,
          },
        },
      });

      return updated;
    });
  }

  /**
   * เส้นทางรับเงินสดคืนจากยกเลิกสัญญา (Flow C-2 — Phase 3 Task 6, spec §5.4
   * ทางเลือกที่สองนอกจากหักกลบรอบจ่าย): SHOP โอนเงินสดคืนยอดเรียกคืน แทนการ
   * รอหักในรอบจ่ายถัดไป. โพสต์สองใบใน `$transaction` เดียว:
   *
   *   FINANCE — reuse `ShopCollectSettlementTemplate` + `typeStamp:
   *   'PAYOUT_RECALL'` → `Dr <financeDepositAccountCode> / Cr 11-2107`
   *   (stamp `shopReceivableType: 'PAYOUT_RECALL'` + `metadata.contractId`
   *   ⇒ typed recall lens หักตรงประเภทต่อสัญญา — ต่างจากขา batch ที่ไม่
   *   stamp; template gate (ii) เดิม (untyped − Σ POSTED deductions + block
   *   PENDING deduction batch) เดินครบทุกด่านเหมือน caller เดิม)
   *
   *   SHOP — `Dr S21-3001 / Cr <shopPayoutAccountCode>` (default 'S11-1201')
   *   ผ่าน `journalAuto.createAndPost` ตรงๆ (JE 2 บรรทัด — ไม่มี template
   *   class ตาม brief; `PairedJournalService` ไม่จำเป็นเพราะสองใบอยู่ใน tx
   *   เดียวอยู่แล้ว)
   *
   * Guards (ตามลำดับ):
   *   0. idempotency requestId — เช็คก่อน guard คิวทั้งหมด: retry หลัง settle
   *      เต็มจำนวน สัญญาหลุดคิวไปแล้ว ต้องคืนผลเดิมไม่ใช่ reject
   *   1. ไม่มี RECALL item ใน batch เปิด (DRAFT/PENDING_APPROVAL) — settled
   *      gate ของคิวจับ PENDING อยู่แล้ว แต่ต้องได้ข้อความไทยชี้รอบ + block
   *      DRAFT ด้วย (กันเงินก้อนเดียวถูกรับสดที่นี่และหักในรอบพร้อมกัน)
   *   2. สัญญาอยู่ในคิวเรียกคืน (`getPendingRecalls` — ยอด NET of POSTED
   *      deductions ตาม Phase 3 Task 4)
   *   3. ยอดเรียกคืนสองสมุดตรงกัน ±0.01 (mirror guard ของ `buildSnapshot` —
   *      ห้ามโพสต์ข้างเดียวบนสมุดที่ยอดไม่หนุนกัน)
   *   4. amount ≤ recallGl net + 0.01
   */
  async settleRecallCash(
    contractId: string,
    dto: SettleRecallCashDto,
    userId: string,
  ): Promise<{ financeEntryNo: string; shopEntryNo: string; deduped: boolean }> {
    const amount = new Prisma.Decimal(String(dto.amount));
    if (amount.lte(0)) {
      throw new BadRequestException('ยอดรับเงินคืนต้องมากกว่า 0');
    }
    const amountStr = amount.toFixed(2);
    const shopPayoutAccountCode =
      dto.shopPayoutAccountCode ?? ShopAccountResolver.SHOP_RECEIVING_BANK;

    // SERIALIZABLE — doctrine ของ template ตัวเดียวกัน (ดู comment ใน
    // shop-collect-settlement.template.ts รอบ catch P2002/P2034): guard
    // "amount ≤ net" อ่าน journal_lines แล้วค่อย insert แถวที่เปลี่ยนผล
    // การอ่านนั้น — ภายใต้ READ COMMITTED สองคำขอพร้อมกัน**คนละ requestId**
    // บนสัญญาเดียวจะผ่าน guard ทั้งคู่ (idempotency จับไม่ได้ — key ต่างกัน)
    // ⇒ over-settle (typed recall ติดลบ, เงินสดเดบิตเกิน). SSI ทำให้ผู้แพ้
    // ถูก abort ด้วย 40001 (Prisma P2034) — แปลเป็น 409 ใน catch ด้านล่าง.
    const run = async (tx: Prisma.TransactionClient) => {
      // 0. idempotency — SHOP leg เป็น marker: สองใบโพสต์ใน tx เดียว ดังนั้น
      //    "มีใบ SHOP" ⇔ "มีใบ FINANCE" เสมอ. contractId เป็นส่วนหนึ่งของ
      //    เงื่อนไข (กัน requestId ชนข้ามสัญญา — pattern เดียวกับ template).
      const shopDupe = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: RECALL_CASH_SHOP_FLOW } } as Prisma.JournalEntryWhereInput,
            { metadata: { path: ['requestId'], equals: dto.requestId } } as Prisma.JournalEntryWhereInput,
            { metadata: { path: ['contractId'], equals: contractId } } as Prisma.JournalEntryWhereInput,
          ],
          deletedAt: null,
        },
      });
      if (shopDupe) {
        const dupeMeta = shopDupe.metadata as Record<string, unknown> | null;
        const bookedAmount = dupeMeta?.['amount'];
        if (typeof bookedAmount !== 'string' || bookedAmount !== amountStr) {
          throw new ConflictException(
            `คำขอนี้ถูกบันทึกไปแล้วที่ยอด ${typeof bookedAmount === 'string' ? bookedAmount : 'ไม่ทราบยอด'} ฿ — ` +
              'กรุณาปิดหน้าต่างรับเงินคืนแล้วเปิดใหม่ หากต้องการบันทึกยอดใหม่',
          );
        }
        const financeDupe = await tx.journalEntry.findFirst({
          where: {
            AND: [
              { metadata: { path: ['flow'], equals: 'shop-collect-settlement' } } as Prisma.JournalEntryWhereInput,
              { metadata: { path: ['requestId'], equals: dto.requestId } } as Prisma.JournalEntryWhereInput,
              { metadata: { path: ['contractId'], equals: contractId } } as Prisma.JournalEntryWhereInput,
            ],
            deletedAt: null,
          },
        });
        return {
          financeEntryNo: financeDupe?.entryNumber ?? '',
          shopEntryNo: shopDupe.entryNumber,
          deduped: true,
        };
      }

      // 1. RECALL item ใน batch เปิด → reject พร้อมชื่อรอบ
      const openRecallItem = await tx.interCoSettlementItem.findFirst({
        where: {
          contractId,
          itemType: 'RECALL',
          deletedAt: null,
          batch: { status: { in: ['DRAFT', 'PENDING_APPROVAL'] }, deletedAt: null },
        },
        include: { batch: { select: { batchNumber: true, status: true } } },
      });
      if (openRecallItem) {
        throw new BadRequestException(
          `สัญญานี้มีรายการเรียกคืนในรอบจ่าย ${openRecallItem.batch.batchNumber} ` +
            `(สถานะ ${openRecallItem.batch.status}) — รอผลอนุมัติ ถอน หรือยกเลิกรอบก่อนรับเงินสดคืน`,
        );
      }

      // 2. อยู่ในคิวเรียกคืน (ยอด net) + 3. สองสมุดตรงกัน + 4. ไม่เกิน net
      const recalls = await this.pendingService.getPendingRecalls(tx);
      const recall = recalls.find((r) => r.contractId === contractId);
      if (!recall) {
        throw new BadRequestException(
          'สัญญานี้ไม่อยู่ในคิวเรียกคืน — ไม่มียอดเรียกคืนค้าง หรืออยู่ในรอบจ่ายอื่นแล้ว',
        );
      }
      if (recall.recallGl.minus(recall.shopRecallGl).abs().gt('0.01')) {
        throw new BadRequestException(
          `ยอดเรียกคืนสองสมุดไม่ตรงกัน สัญญา ${recall.contractNumber} ` +
            `(FINANCE ${recall.recallGl.toFixed(2)} / SHOP ${recall.shopRecallGl.toFixed(2)}) — ` +
            'ตรวจสอบ GL ก่อนรับเงินคืน',
        );
      }
      if (amount.gt(recall.recallGl.plus('0.01'))) {
        throw new BadRequestException(
          `ยอดรับเงินคืน ${amountStr} ฿ เกินยอดเรียกคืนคงเหลือ ${recall.recallGl.toFixed(2)} ฿ ไม่อนุญาต`,
        );
      }

      // FINANCE leg — template เดิม + typeStamp (guards/idempotency ของ
      // template เดินครบทุกด่าน รวม gate (ii) untyped − POSTED deductions)
      const finance = await this.shopCollectTemplate.execute(
        {
          contractId,
          depositAccountCode: dto.financeDepositAccountCode,
          amount: dto.amount,
          postedById: userId,
          requestId: dto.requestId,
          typeStamp: 'PAYOUT_RECALL',
        },
        tx,
      );
      if (finance.deduped) {
        // SHOP pre-check (ด่าน 0) ไม่พบใบ แต่ template พบ requestId เดิม —
        // แปลว่า requestId นี้ถูกใช้ไปแล้วกับ flow settleShopCollect (คนละ
        // เส้นทาง): โพสต์ SHOP leg เดี่ยวต่อไปจะได้ใบขาเดียว — ห้าม.
        throw new ConflictException(
          'requestId นี้ถูกใช้ไปแล้วกับรายการรับโอนจากหน้าร้าน (shop-collect) — กรุณาสร้างคำขอใหม่',
        );
      }

      // SHOP leg — Dr S21-3001 / Cr เงินสด/ธนาคาร SHOP
      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
      let shopJe: { id: string; entryNumber: string };
      try {
        shopJe = await this.journalAuto.createAndPost(
          {
            description: `จ่ายเงินคืน FINANCE — เรียกคืนจากยกเลิกสัญญา ${recall.contractNumber}`,
            reference: `${contractId}:${RECALL_CASH_SHOP_FLOW}:${dto.requestId}`,
            companyId: shopCompanyId,
            metadata: {
              flow: RECALL_CASH_SHOP_FLOW,
              // สมมาตรกับ FINANCE leg (template: `${contractId}:${requestId}`) —
              // requestId reuse ข้ามสัญญาจะไม่ชน DB unique index ของสัญญาอื่น
              // (โพสต์อิสระตาม semantics ของ template) แทนที่จะได้ 409 ผิดบริบท.
              idempotencyKey: `${contractId}:${dto.requestId}:SHOP`,
              contractId,
              requestId: dto.requestId,
              amount: amountStr,
              shopPayoutAccountCode,
              shopReceivableType: 'PAYOUT_RECALL',
            },
            lines: [
              {
                accountCode: 'S21-3001',
                dr: amount,
                cr: new Prisma.Decimal(0),
                description: `ล้างเจ้าหนี้ FINANCE-เรียกคืนยกเลิก ${recall.contractNumber}`,
              },
              {
                accountCode: shopPayoutAccountCode,
                dr: new Prisma.Decimal(0),
                cr: amount,
                description: `จ่ายเงินคืน FINANCE ${amountStr} ฿`,
              },
            ],
          },
          tx,
        );
      } catch (err) {
        // Race เดียวกับ W2: ผู้แพ้ของ double-submit ชน DB unique index
        // (flow + idempotencyKey) — แปลงเป็น 409 ไทย ไม่ใช่ raw 500;
        // tx ทั้งก้อน (รวมใบ FINANCE) roll back.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException(
            'รายการนี้กำลังถูกบันทึกอยู่ (กดยืนยันซ้ำพร้อมกัน) — กรุณารอสักครู่ แล้วตรวจสอบรายการก่อนลองใหม่',
          );
        }
        throw err;
      }

      await tx.auditLog.create({
        data: {
          userId,
          action: 'INTERCO_RECALL_CASH_SETTLED',
          entity: 'contract',
          entityId: contractId,
          newValue: {
            contractNumber: recall.contractNumber,
            amount: amountStr,
            financeDepositAccountCode: dto.financeDepositAccountCode,
            shopPayoutAccountCode,
            requestId: dto.requestId,
            financeEntryNo: finance.entryNo,
            shopEntryNo: shopJe.entryNumber,
            recallNetBefore: recall.recallGl.toFixed(2),
          },
        },
      });

      return { financeEntryNo: finance.entryNo, shopEntryNo: shopJe.entryNumber, deduped: false };
    };

    try {
      return await this.prisma.$transaction(run, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (err) {
      // ผู้แพ้ SSI race (40001 → Prisma P2034) โผล่ได้ทั้งกลาง tx และตอน
      // commit — แปลเป็น 409 ไทยให้ client ลองใหม่ได้ ไม่ใช่ raw 500
      // (pattern เดียวกับ template's P2034 catch + W2). ConflictException/
      // BadRequestException จากใน tx ผ่าน catch นี้ออกไปตามเดิม.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
        throw new ConflictException(
          'มีการบันทึกรายการนี้พร้อมกันจากอีกจุดหนึ่ง (write conflict) — กรุณาลองใหม่อีกครั้ง',
        );
      }
      throw err;
    }
  }

  /**
   * Dr 21-1101 per SETTLEMENT contract (always) + Dr 21-1102 per contract
   * (skip zero) + Cr 11-2107 per deduction (swap credit / recall — Phase 2
   * หักกลบ, workbook จุดที่ 3) + Cr bank = netTransferAmount (skip when 0 —
   * รอบที่หักจนเงินโอนจริงเป็นศูนย์ต้องไม่มีบรรทัดธนาคาร). RECALL rows carry
   * no payable snapshot of their own — they contribute ONLY the Cr 11-2107
   * leg (never a zero-amount Dr 21-1101 line).
   */
  private buildFinanceLines(batch: BatchWithItems, description: string): JeLineInput[] {
    const zero = new Prisma.Decimal(0);
    const lines: JeLineInput[] = [];
    for (const item of batch.items) {
      if (item.itemType === 'RECALL') continue;
      lines.push({
        accountCode: '21-1101',
        dr: item.financedGl,
        cr: zero,
        description: `ล้างเจ้าหนี้ยอดจัด ${item.contract.contractNumber}`,
      });
    }
    for (const item of batch.items) {
      if (item.commissionGl.gt(0)) {
        lines.push({
          accountCode: '21-1102',
          dr: item.commissionGl,
          cr: zero,
          description: `ล้างเจ้าหนี้ค่าคอม ${item.contract.contractNumber}`,
        });
      }
    }
    for (const item of batch.items) {
      const deduction = item.itemType === 'RECALL' ? item.recallAmount : item.swapCreditAmount;
      if (deduction.gt(0)) {
        lines.push({
          accountCode: '11-2107',
          dr: zero,
          cr: deduction,
          description:
            item.itemType === 'RECALL'
              ? `หักเรียกคืนจากยกเลิก ${item.contract.contractNumber}`
              : `หักเครดิตเปลี่ยนเครื่อง ${item.contract.contractNumber}`,
        });
      }
    }
    // Pre-Phase 2 batches have no netTransferAmount snapshot — fall back to
    // the gross total (identical: their totalDeduction is definitionally 0).
    const netCash = batch.netTransferAmount ?? batch.totalAmount;
    if (netCash.gt(0)) {
      lines.push({
        accountCode: batch.financeBankCode,
        dr: zero,
        cr: netCash,
        description,
      });
    }
    return lines;
  }

  /**
   * Dr shopBankCode = shopNetAmount (skip when 0) + Dr S21-3001 per deduction
   * row (ล้างเจ้าหนี้ FINANCE ฝั่ง SHOP — Phase 2 หักกลบ, ทั้ง SWAP_CREDIT ของ
   * settlement items และ RECALL rows) + Cr S11-3001 per-contract (always) +
   * Cr S11-3002 per-contract (skip zero) — settlement legs ONLY over
   * SETTLEMENT items with `legacyNoShop=false`. Empty array = no SHOP half at
   * all (caller skips `postPaired` and posts FINANCE alone via
   * `JournalAutoService`).
   */
  private buildShopLines(batch: BatchWithItems): JeLineInput[] {
    const zero = new Prisma.Decimal(0);
    const shopItems = batch.items.filter((i) => i.itemType === 'SETTLEMENT' && !i.legacyNoShop);
    const deductionItems = batch.items.filter((i) =>
      (i.itemType === 'RECALL' ? i.recallAmount : i.swapCreditAmount).gt(0),
    );
    if (shopItems.length === 0 && deductionItems.length === 0) return [];

    const lines: JeLineInput[] = [];
    // Pre-Phase 2 batches have no shopNetAmount snapshot — fall back to the
    // gross posted amount (identical: their totalDeduction is definitionally 0).
    const shopNet = batch.shopNetAmount ?? batch.shopPostedAmount;
    if (shopNet.gt(0)) {
      lines.push({
        accountCode: batch.shopBankCode,
        dr: shopNet,
        cr: zero,
        description: `รับโอนจาก FINANCE รอบ ${batch.batchNumber}`,
      });
    }
    for (const item of deductionItems) {
      const deduction = item.itemType === 'RECALL' ? item.recallAmount : item.swapCreditAmount;
      lines.push({
        accountCode: 'S21-3001',
        dr: deduction,
        cr: zero,
        description:
          item.itemType === 'RECALL'
            ? `ล้างเจ้าหนี้ FINANCE-เรียกคืนยกเลิก ${item.contract.contractNumber}`
            : `ล้างเจ้าหนี้ FINANCE-ค่าเครื่องรับคืน ${item.contract.contractNumber}`,
      });
    }
    for (const item of shopItems) {
      lines.push({
        accountCode: 'S11-3001',
        dr: zero,
        cr: item.shopFinancedGl,
        description: `ล้างลูกหนี้ FINANCE-ยอดจัด ${item.contract.contractNumber}`,
      });
    }
    for (const item of shopItems) {
      if (item.shopCommissionGl.gt(0)) {
        lines.push({
          accountCode: 'S11-3002',
          dr: zero,
          cr: item.shopCommissionGl,
          description: `ล้างลูกหนี้ FINANCE-ค่าคอม ${item.contract.contractNumber}`,
        });
      }
    }
    return lines;
  }

  /**
   * `validatePeriodOpen` throws a company-agnostic BadRequestException — this
   * wraps it so the message names WHICH company's period is closed (spec D4:
   * the maker needs to know whether to pick a different postedAt or ask an
   * OWNER to reopen the period) since approve guards FINANCE and SHOP
   * independently.
   */
  private async guardPeriodOpen(
    tx: Prisma.TransactionClient,
    postedAt: Date,
    companyId: string,
    label: 'FINANCE' | 'SHOP',
  ): Promise<void> {
    try {
      await validatePeriodOpen(tx, postedAt, companyId);
    } catch (err) {
      if (err instanceof BadRequestException) {
        throw new BadRequestException(
          `งวดบัญชีฝั่ง ${label} ปิดแล้ว (${err.message}) — เลือกวันที่ลงบัญชีในเดือนที่ยังเปิดอยู่ ` +
            '(ระบบจะบันทึกวันโอนจริงไว้ในรายละเอียด JE เสมอ) หรือให้ OWNER เปิดงวดนี้ก่อนอนุมัติ',
        );
      }
      throw err;
    }
  }

  private formatBkkDate(date: Date): string {
    return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  }
}
