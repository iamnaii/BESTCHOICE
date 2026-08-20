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
import { AuditService, AuditEntry } from '../audit/audit.service';
import { hasCrossBranchAccess } from '../auth/branch-access.util';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { ExchangeCancelReversalTemplate } from '../journal/cpa-templates/exchange-cancel-reversal.template';
import {
  C2_REDIRECTS,
  C2_REDIRECT_SOURCES,
  C2_REDIRECT_STAMP,
  TYPED_LENS_ACCOUNTS,
} from '../journal/cpa-templates/contract-cancellation.template';

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
    // FINALIZED-path audit is deferred to AFTER the tx commits (Task 5):
    // `AuditService.log` opens its OWN root-client $transaction — awaiting it
    // while this tx still holds a pool connection is the nested-tx pattern
    // doctrine R-1 forbids (P2028 pool starvation under load), and an audit row
    // must describe a COMMITTED cancel anyway (inside-tx write + later rollback
    // = phantom audit row). MEMO/PRE_FINALIZE audits are untouched.
    let pendingAudit: AuditEntry | null = null;
    const result = await this.prisma.$transaction(async (tx) => {
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

      // ── Phase 3 Task 5 (C-2, workbook §5.5) ──
      // Guard เปิด: สัญญาใหม่อยู่ใน batch DRAFT/PENDING_APPROVAL — snapshot ของ
      // รอบยังอ้างเจ้าหนี้ที่กำลังจะถูก sweep → ต้องถอน/ยกเลิกรอบก่อน
      // (pattern เดียวกับ ContractCancellationService Task 2)
      const openItem = await tx.interCoSettlementItem.findFirst({
        where: {
          contractId: req.newContractId,
          deletedAt: null,
          batch: { status: { in: ['DRAFT', 'PENDING_APPROVAL'] }, deletedAt: null },
        },
        include: { batch: { select: { batchNumber: true } } },
      });
      if (openItem) {
        throw new BadRequestException(
          `สัญญาใหม่อยู่ในรอบจ่าย ${openItem.batch.batchNumber} ที่ยังไม่อนุมัติ — ถอน/ยกเลิกรอบก่อนจึงจะยกเลิกเปลี่ยนเครื่องได้`,
        );
      }

      // Detect C-2: สัญญาใหม่ถูกตัดจ่ายผ่านรอบจ่าย INTER-CO POSTED แล้ว —
      // เจ้าหนี้ 21-1101/21-1102 (และลูกหนี้ S11-3001/S11-3002) ถูก batch ล้าง
      // ไปแล้ว mirror ตรงจะทำติดลบ → redirect เป็นลูกหนี้เรียกคืน 11-2107
      // [PAYOUT_RECALL] / เจ้าหนี้ S21-3001 (ชุดเดียวกับ generic Task 3).
      // settledDeductions = Σ swapCreditAmount ที่รอบนั้นหักไว้ — เงินที่
      // FINANCE ไม่เคยจ่ายจริง จึงไม่ใช่ยอดเรียกคืน (net = settled − deductions).
      const postedItems = await tx.interCoSettlementItem.findMany({
        where: {
          contractId: req.newContractId,
          deletedAt: null,
          itemType: 'SETTLEMENT',
          batch: { status: 'POSTED', deletedAt: null },
        },
        include: { batch: { select: { batchNumber: true } } },
      });
      const settledTotal = postedItems.reduce(
        (s, i) => s.plus(i.financedGl.toString()).plus(i.commissionGl.toString()),
        new Decimal(0),
      );
      const settledShopTotal = postedItems.reduce(
        (s, i) => s.plus(i.shopFinancedGl.toString()).plus(i.shopCommissionGl.toString()),
        new Decimal(0),
      );
      const settledDeductions = postedItems.reduce(
        (s, i) => s.plus(i.swapCreditAmount.toString()),
        new Decimal(0),
      );
      const isC2 = settledTotal.gt(0);
      const batchNumbers = postedItems.map((i) => i.batch.batchNumber);

      // 1) mirror-reverse ทุก JE (รวม A.5 ECL — GL 11-2102 คืนทันที, ECL cron delta เป็น no-op)
      const jeIds = [req.je1aId, req.je2Id, req.je3Id, req.je4Id, req.eclReversalJeId].filter(
        (x: string | null): x is string => !!x,
      );

      // Defensive check (C-2 เท่านั้น — ชุดเดียวกับ generic template Task 3):
      // สแกน sweep candidates ชุดเดียวกับที่ engine จะ mirror (explicit jeIds ∪
      // metadata.contractId sweep, skip เงื่อนไขเดียวกับ engine) — JE ใดมีทั้ง
      // บรรทัด redirect source (21-1101/21-1102/S11-3001/S11-3002) และบรรทัด/
      // ประเภทบัญชี typed (11-2107/S21-3001) ในใบเดียว redirect stamp
      // PAYOUT_RECALL ทั้งใบจะทับความหมาย typed เดิม (เลนส์ Phase 2 อ่าน type
      // ระดับ JE) → hand-JV ผิดปกติ reject ก่อน sweep เริ่ม.
      if (isC2) {
        const candidates = await tx.journalEntry.findMany({
          where: {
            OR: [
              { id: { in: jeIds } },
              { metadata: { path: ['contractId'], equals: req.newContractId } as never },
            ],
            status: 'POSTED',
            deletedAt: null,
          },
          include: { lines: true },
        });
        for (const je of candidates) {
          const meta = (je.metadata ?? {}) as Record<string, unknown>;
          if (meta['reversed'] === true) continue;
          if (meta['flow'] === 'exchange-cancel') continue;
          if (meta['tag'] === 'REVERSAL') continue;
          const redirectSourceLine = je.lines.find((l) =>
            C2_REDIRECT_SOURCES.includes(l.accountCode),
          );
          const typedLine = je.lines.find((l) => TYPED_LENS_ACCOUNTS.includes(l.accountCode));
          const hasTypedStamp = typeof meta['shopReceivableType'] === 'string';
          if (redirectSourceLine && (typedLine || hasTypedStamp)) {
            throw new BadRequestException(
              `ใบสำคัญ ${je.entryNumber} ของสัญญาใหม่มีทั้งบรรทัดเจ้าหนี้/ลูกหนี้รอบจ่าย (${redirectSourceLine.accountCode}) ` +
                'และบรรทัด/ประเภทบัญชีลูกหนี้เรียกคืน (11-2107/S21-3001) ในใบเดียวกัน — ' +
                'ระบบ redirect เป็น PAYOUT_RECALL ให้ไม่ได้ (จะทับความหมายประเภทเดิม) กรุณาตรวจสอบ/กลับรายการใบนี้ด้วยมือก่อนยกเลิกเปลี่ยนเครื่อง',
            );
          }
        }
      }

      const { reversalJeIds, redirectedTotals } = await this.reversalTemplate.reverse(
        {
          jeIds,
          newContractId: req.newContractId,
          // C-2 เท่านั้น: redirect เจ้าหนี้/ลูกหนี้รอบจ่ายที่ตัดจ่ายแล้ว →
          // ลูกหนี้เรียกคืน [PAYOUT_RECALL]. flowLabel/descriptionPrefix ไม่ส่ง —
          // คงค่า default ของ exchange ('exchange-cancel' / '[ยกเลิกเปลี่ยนเครื่อง]')
          // ทุก byte. C-1 ห้ามมี key พวกนี้เลย (พฤติกรรมเดิมเป๊ะ).
          ...(isC2
            ? { redirects: C2_REDIRECTS, redirectStamp: C2_REDIRECT_STAMP }
            : {}),
        },
        tx,
      );

      // Cross-check (C-2 — สูตรเดียวกับ generic Task 3/4): ยอดที่ redirect เข้า
      // แต่ละสมุดต้องเท่ากับ Σ settled จาก item SETTLEMENT ใน batch POSTED
      // (±0.01) แยกสมุด — hand-JV ที่แตะเฉพาะสมุดเดียวต้องโดนจับ. throw ใน tx
      // ให้ sweep ทั้งชุด rollback (ห้ามยกเลิกบนตัวเลขที่เพี้ยน).
      if (isC2) {
        const redirected = redirectedTotals['11-2107'] ?? new Decimal(0);
        if (redirected.minus(settledTotal).abs().gt('0.01')) {
          throw new BadRequestException(
            `ยอดเรียกคืน (${redirected.toFixed(2)}) ไม่ตรงกับยอดที่ตัดจ่ายใน batch POSTED (${settledTotal.toFixed(2)}) — มีรายการเดินบัญชีผิดปกติ ตรวจสอบก่อนยกเลิก`,
          );
        }
        // ฝั่ง SHOP: redirect เป็นขา Cr ⇒ redirectedTotals (Σ Dr−Cr) ติดลบ —
        // ยอดเจ้าหนี้เรียกคืนที่ตั้งจริง = .neg()
        const redirectedShop = (redirectedTotals['S21-3001'] ?? new Decimal(0)).neg();
        if (redirectedShop.minus(settledShopTotal).abs().gt('0.01')) {
          throw new BadRequestException(
            `ยอดเรียกคืนฝั่งร้าน (${redirectedShop.toFixed(2)}) ไม่ตรงกับยอดที่ตัดจ่ายฝั่งร้านใน batch POSTED (${settledShopTotal.toFixed(2)}) — มีรายการเดินบัญชีผิดปกติ ตรวจสอบก่อนยกเลิก`,
          );
        }
      }

      // 2) no penalty — owner removed the cancellation-fee rule entirely
      // (2026-07-31). Window collapses to a single label; penalty fields
      // stay always-null (see literal `null` used below instead of
      // `penalty?.toFixed(2)` — TS narrows an always-null binding to the
      // `null` literal type under control-flow analysis either way).
      const penalty: Decimal | null = null;
      const penaltyJeId: string | null = null;
      // C-2 (Task 5): ป้าย window แยกสำหรับยกเลิกหลังตัดจ่าย — รายงาน/audit
      // แยกเคสได้ (เงินต้องถูกเรียกคืนผ่านคิว recall ของรอบจ่าย)
      const window = isC2 ? 'AFTER_PAYOUT' : 'FREE';

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
      pendingAudit = {
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
          // C-2: ยอดเรียกคืนสุทธิ = เงินสดที่ FINANCE โอนจริงในรอบจ่าย
          // (settled gross − เครดิตสวอปที่รอบนั้นหักไว้แล้ว) + รอบที่เกี่ยวข้อง
          ...(isC2
            ? { recallAmount: settledTotal.minus(settledDeductions).toFixed(2), batchNumbers }
            : {}),
        },
      };
      return { id, cancelWindow: window, penaltyAmount: null };
    });
    if (pendingAudit) await this.audit.log(pendingAudit);
    return result;
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
