import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { hasCrossBranchAccess } from '../auth/branch-access.util';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { ExchangeCancelReversalTemplate } from '../journal/cpa-templates/exchange-cancel-reversal.template';

/** Subset of request.user the cancel path needs (id + branch scoping — I7). */
interface CancelRequestUser {
  id: string;
  role?: string | null;
  branchId?: string | null;
}

/** จำนวนวันปฏิทิน BKK ระหว่าง 2 เวลา (0 = วันเดียวกัน) */
export function bkkDayDiff(from: Date, to: Date): number {
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  const [fy, fm, fd] = fmt(from).split('-').map(Number);
  const [ty, tm, td] = fmt(to).split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

@Injectable()
export class ExchangeCancelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly companyResolver: CompanyResolverService,
    private readonly reversalTemplate: ExchangeCancelReversalTemplate,
  ) {}

  async cancel(id: string, reason: string, user: CancelRequestUser) {
    return this.prisma.$transaction(async (tx) => {
      const req = await (tx as any).contractExchangeRequest.findUnique({
        where: { id },
        include: { oldContract: true, newContract: true },
      });
      if (!req || req.deletedAt) throw new NotFoundException('ไม่พบคำขอเปลี่ยนเครื่อง');
      if (req.status !== 'APPROVED') {
        throw new BadRequestException(
          `ยกเลิกได้เฉพาะคำขอที่อนุมัติแล้ว (สถานะปัจจุบัน: ${req.status})`,
        );
      }
      // I7 (final review 2026-07-29): BM must not cancel another branch's swap
      // by UUID — same in-service branch scoping as submit()/approve().
      if (!hasCrossBranchAccess(user) && req.oldContract.branchId !== user.branchId) {
        throw new ForbiddenException('ไม่สามารถยกเลิกคำขอของสาขาอื่นได้');
      }
      const now = new Date();
      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
      const financeCompanyId = await this.companyResolver.getFinanceCompanyId(tx);

      // ---------- MEMO: สลับกลับ ไม่มี JE ----------
      if (req.mode === 'MEMO') {
        // I4 (final review 2026-07-29): MEMO cancel blindly swaps productId
        // back — guard that the contract is still in the post-MEMO state
        // (ACTIVE + pointing at the request's NEW product). Anything else
        // (early payoff, repossession, a later swap) makes the blind revert
        // corrupt real state.
        if (
          req.oldContract.status !== 'ACTIVE' ||
          req.oldContract.productId !== req.newProductId
        ) {
          throw new BadRequestException(
            'สัญญาสถานะเปลี่ยนไป หรือเครื่องบนสัญญาไม่ตรงกับคำขอ — ยกเลิกแบบ MEMO ไม่ได้',
          );
        }
        // Owner decision 2026-07-31: cancellation windows removed entirely —
        // MEMO cancel allowed at ANY time. `days` kept for audit context only.
        const days = bkkDayDiff(req.memoAppliedAt ?? req.approvedAt ?? req.createdAt, now);
        const newProd = await tx.product.findUniqueOrThrow({
          where: { id: req.newProductId },
          select: { status: true, ownedByCompanyId: true },
        });
        await tx.contract.update({
          where: { id: req.oldContractId },
          data: { productId: req.oldProductId },
        });
        await tx.product.update({
          where: { id: req.oldProductId },
          data: { status: newProd.status, ownedByCompanyId: newProd.ownedByCompanyId } as any,
        });
        await tx.product.update({
          where: { id: req.newProductId },
          data: { status: 'IN_STOCK', ownedByCompanyId: shopCompanyId } as any,
        });
        // MEMO: distinct window label for reporting — MEMO cancels never had a
        // penalty, and (owner decision 2026-07-31) no time cap either.
        await this.markCanceled(tx, id, user.id, reason, 'MEMO', null, [], now);
        await this.audit.log({
          action: 'EXCHANGE_MEMO_CANCELED',
          entity: 'contract_exchange_request',
          entityId: id,
          userId: user.id,
          newValue: { reason, days },
        });
        return { id, cancelWindow: 'MEMO', penaltyAmount: null };
      }

      // ---------- PRE_FINALIZE: อนุมัติแล้วแต่ยังไม่ activate (ไม่มี JE) ----------
      // exchangedAt ถูก set atomic พร้อม JE chain ใน finalizeAfterActivation —
      // มันคือสัญญาณ finalized ตัวจริง (ห้าม AND กับ newContract.status: สัญญาใหม่
      // ที่ finalize แล้วแต่ COMPLETED/TERMINATED ต้องถูก REJECT ไม่ใช่หลุดไป
      // PRE_FINALIZE ซึ่งจะ soft-delete สัญญาจริงโดยไม่มี reversal/paid-guard/window)
      const finalized = !!req.oldContract.exchangedAt;
      if (!finalized) {
        if (req.newContractId) {
          // CAS soft-delete (final review 2026-07-29): guard on status=DRAFT so
          // a concurrent activation (DRAFT → ACTIVE + JE chain in its own tx)
          // can't race us into soft-deleting a just-finalized real contract.
          // C1a: null exchangedFromContractId (@unique) in the same write —
          // a dead EXCH- contract must not brick the old contract's next
          // exchange attempt (history stays on the request row).
          const casDelete = await tx.contract.updateMany({
            where: { id: req.newContractId, status: 'DRAFT', deletedAt: null },
            data: { deletedAt: now, exchangedFromContractId: null } as any,
          });
          if (casDelete.count !== 1) {
            throw new ConflictException(
              'สัญญาใหม่ถูกเปิดใช้งานไปแล้วระหว่างยกเลิก — โหลดหน้าใหม่แล้วลองอีกครั้ง',
            );
          }
          await tx.product.update({
            where: { id: req.newProductId },
            data: { status: 'IN_STOCK' } as any,
          });
        }
        await this.markCanceled(tx, id, user.id, reason, 'PRE_FINALIZE', null, [], now);
        await this.audit.log({
          action: 'EXCHANGE_CANCELED',
          entity: 'contract_exchange_request',
          entityId: id,
          userId: user.id,
          newValue: { reason, window: 'PRE_FINALIZE' },
        });
        return { id, cancelWindow: 'PRE_FINALIZE', penaltyAmount: null };
      }

      // ---------- FINALIZED (มี JE แล้ว) ----------
      // Status guard: finalized แต่สัญญาใหม่ไม่ ACTIVE (COMPLETED/TERMINATED/ฯลฯ)
      // = ยกเลิก swap ไม่ได้แล้ว
      if (req.newContract?.status !== 'ACTIVE') {
        throw new BadRequestException(
          `สัญญาใหม่สถานะ ${req.newContract?.status ?? 'ไม่พบ'} — ยกเลิกเปลี่ยนเครื่องไม่ได้`,
        );
      }
      // Owner decision 2026-07-31: cancellation windows + penalty removed
      // entirely — cancel allowed at ANY time as long as zero payments have
      // posted on the new contract (guard below). `days` kept for audit
      // context only — it no longer gates anything.
      const exchangedAt: Date = req.oldContract.exchangedAt;
      const days = bkkDayDiff(exchangedAt, now);

      const paid = await tx.payment.findFirst({
        where: {
          contractId: req.newContractId,
          deletedAt: null,
          OR: [{ status: 'PAID' }, { amountPaid: { gt: 0 } }],
        },
        select: { id: true },
      });
      if (paid) {
        throw new BadRequestException(
          'มีการชำระเงินบนสัญญาใหม่แล้ว — ต้อง void ใบเสร็จทั้งหมดก่อนยกเลิก',
        );
      }

      // 1) mirror-reverse ทุก JE (รวม A.5 ECL — GL 11-2102 คืนทันที, ECL cron delta เป็น no-op)
      const jeIds = [req.je1aId, req.je2Id, req.je3Id, req.je4Id, req.eclReversalJeId].filter(
        (x: string | null): x is string => !!x,
      );
      const { reversalJeIds } = await this.reversalTemplate.reverse(
        { jeIds, newContractId: req.newContractId },
        tx,
      );

      // 2) no penalty — owner removed the cancellation-fee rule entirely
      // (2026-07-31). Window collapses to a single label; penalty fields
      // stay always-null (see literal `null` used below instead of
      // `penalty?.toFixed(2)` — TS narrows an always-null binding to the
      // `null` literal type under control-flow analysis either way).
      const penalty: Decimal | null = null;
      const penaltyJeId: string | null = null;
      const window = 'FREE';

      // 3) restore states (spec §9 step 3)
      await tx.contract.update({
        where: { id: req.oldContractId },
        data: { status: 'ACTIVE', exchangedAt: null } as any, // overdue cron จัดสถานะจริงต่อ; 2A cron backfill งวดที่พลาดใน tick ถัดไป
      });
      await tx.product.update({
        where: { id: req.oldProductId },
        data: {
          status: 'SOLD_INSTALLMENT',
          ownedByCompanyId: financeCompanyId,
          // Restore costPrice เดิมก่อน A.4 เขียนทับเป็นราคารับซื้อ (workbook 2026-08-19
          // Phase 1) — null = finalize ก่อนฟีเจอร์นี้ ไม่แตะ (forward-only)
          ...(req.previousCostPrice != null ? { costPrice: req.previousCostPrice } : {}),
        } as any,
      });
      await tx.contract.update({
        where: { id: req.newContractId },
        // C1a: null exchangedFromContractId (@unique) — the CANCELED EXCH-
        // contract must not brick a future re-exchange of the same old
        // contract (P2002 at contract.create). History lives on the request
        // row (oldContractId + newContractId).
        data: { status: 'CANCELED', exchangedFromContractId: null } as any,
      });
      // I3 (final review 2026-07-29): the daily ECL cron may have created
      // BadDebtProvision rows for the NEW contract during the ≤30-day window.
      // Their JEs are mirror-reversed by the sweep above — reverse the DB rows
      // too or they sit ACTIVE forever on a CANCELED contract.
      await (tx as any).badDebtProvision.updateMany({
        where: { contractId: req.newContractId, status: 'ACTIVE', deletedAt: null },
        data: { status: 'REVERSED' },
      });
      await tx.payment.updateMany({
        where: { contractId: req.newContractId, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.installmentSchedule.updateMany({
        where: { contractId: req.newContractId, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.product.update({
        where: { id: req.newProductId },
        data: { status: 'IN_STOCK', ownedByCompanyId: shopCompanyId } as any,
      });

      await this.markCanceled(tx, id, user.id, reason, window, penalty, reversalJeIds, now, penaltyJeId);
      await this.audit.log({
        action: 'EXCHANGE_CANCELED',
        entity: 'contract_exchange_request',
        entityId: id,
        userId: user.id,
        newValue: {
          reason,
          window,
          days,
          penaltyAmount: null,
          reversalCount: reversalJeIds.length,
        },
      });
      return { id, cancelWindow: window, penaltyAmount: null };
    });
  }

  private async markCanceled(
    tx: Prisma.TransactionClient,
    id: string,
    userId: string,
    reason: string,
    window: string,
    penalty: Decimal | null,
    reversalJeIds: string[],
    now: Date,
    penaltyJeId: string | null = null,
  ) {
    const lock = await (tx as any).contractExchangeRequest.updateMany({
      where: { id, status: 'APPROVED', deletedAt: null },
      data: {
        status: 'CANCELED',
        canceledAt: now,
        canceledById: userId,
        cancelReason: reason,
        cancelWindow: window,
        penaltyAmount: penalty,
        penaltyJeId,
        reversalJeIds,
      },
    });
    if (lock.count !== 1) throw new ConflictException('คำขอถูกยกเลิกไปแล้ว หรือสถานะเปลี่ยน');
  }
}
