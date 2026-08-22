import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import { ContractCancellationTemplate } from '../../journal/cpa-templates/contract-cancellation.template';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { shopCollectTypedBalance } from '../../interco-settlement/interco-typed-balance';

/**
 * ContractCancellationService — contract-cancellation workflow:
 * request / approve (guards + sweep-reversal $tx + restore) / reject /
 * list-pending. Phase 3 Tasks 2-3 (workbook 2026-08-19 spec §6, Flow C-1/C-2 —
 * C-2 = ยกเลิกหลังตัดจ่ายรอบจ่าย INTER-CO: detect item SETTLEMENT ใน batch
 * POSTED → template redirect เจ้าหนี้เป็นลูกหนี้เรียกคืน [PAYOUT_RECALL]).
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
/**
 * Per-contract fold of the POSTED SETTLEMENT snapshot — the single C-2 detect
 * source (Phase 3 Task 7): shared by `approveCancellation` (isC2/settledTotal/
 * settledShopTotal for the template cross-checks), `listPendingCancellations`
 * (settledInBatch badge + recallAmount forecast), and the exchange-cancel path
 * (`ExchangeCancelService` — same formula, ห้ามมีสำเนาที่สอง).
 */
export interface SettledPayout {
  /** Σ financedGl + commissionGl — gross เจ้าหนี้ที่ batch ล้างไป (= ยอด redirect 11-2107) */
  settledTotal: Decimal;
  /** Σ shopFinancedGl + shopCommissionGl — ฝั่ง SHOP (template cross-check S21-3001) */
  settledShopTotal: Decimal;
  /** Σ swapCreditAmount + recallAmount — ส่วนที่ถูกหักกลบในรอบ (เงินไม่เคยโอนจริง) */
  settledDeductions: Decimal;
  batchNumbers: string[];
}

/**
 * C-2 detect (Phase 3 Task 3 — workbook Case 3A กรณี 2, refactored to a shared
 * helper in Task 7; exported for the exchange-cancel path — pattern
 * C2_REDIRECTS): Σ snapshot ของ item SETTLEMENT ใน batch POSTED ต่อสัญญา.
 * RECALL item ไม่นับ — มันคือ "ถูกหักเรียกคืนไปแล้ว" ไม่ใช่ "ถูกจ่าย".
 *
 * `settledDeductions` = Σ(swapCreditAmount + recallAmount) ของ item ชุดเดียวกัน
 * — เงินส่วนที่ถูกหักกลบในรอบ ไม่เคยโอนจริง ⇒ ยอดเรียกคืนสุทธิที่ C-2 จะเหลือ
 * ให้ตามเก็บ = settledTotal − settledDeductions (นิยามเดียวกับ net ของ
 * `IntercoPendingService.getPendingRecalls`). แถว SETTLEMENT มี recallAmount = 0
 * โดยนิยาม — รวมไว้เพื่อให้สูตรตรงกับ totalDeduction ของ batch แบบไบต์ต่อไบต์.
 */
export async function settledPayoutByContract(
  client: Prisma.TransactionClient,
  contractIds: string[],
): Promise<Map<string, SettledPayout>> {
  if (contractIds.length === 0) return new Map();
  const postedItems = await client.interCoSettlementItem.findMany({
    where: {
      contractId: { in: contractIds },
      deletedAt: null,
      itemType: 'SETTLEMENT',
      batch: { status: 'POSTED', deletedAt: null },
    },
    include: { batch: { select: { batchNumber: true } } },
  });
  const map = new Map<string, SettledPayout>();
  for (const item of postedItems) {
    const entry = map.get(item.contractId) ?? {
      settledTotal: new Decimal(0),
      settledShopTotal: new Decimal(0),
      settledDeductions: new Decimal(0),
      batchNumbers: [] as string[],
    };
    entry.settledTotal = entry.settledTotal
      .plus(item.financedGl.toString())
      .plus(item.commissionGl.toString());
    entry.settledShopTotal = entry.settledShopTotal
      .plus(item.shopFinancedGl.toString())
      .plus(item.shopCommissionGl.toString());
    entry.settledDeductions = entry.settledDeductions
      .plus(item.swapCreditAmount.toString())
      .plus(item.recallAmount.toString());
    entry.batchNumbers.push(item.batch.batchNumber);
    map.set(item.contractId, entry);
  }
  return map;
}

@Injectable()
export class ContractCancellationService {
  private readonly logger = new Logger(ContractCancellationService.name);

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

    const run = async (tx: Prisma.TransactionClient) => {
      // ── Phase 3 guards (C-1) — all inside the tx, before any JE posts ──
      // Re-read the contract INSIDE the tx (Fix Round 1 — Minor #5): the
      // pre-tx snapshot could race a concurrent JP5/termination flipping the
      // status between findUnique above and this transaction.
      const contract = await tx.contract.findUniqueOrThrow({
        where: { id: cancellation.contractId },
        select: {
          id: true,
          status: true,
          productId: true,
          advanceBalance: true,
          creditBalance: true,
          rescheduleAdvanceBalance: true,
        },
      });
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
      // เงินรับล่วงหน้า/เครดิต/ถังพักปรับดิวค้างบนสัญญา (Fix Round 1 —
      // Important #3, family เดียวกับ guard ของ exchange finalize): เงินพวกนี้
      // เข้ามาเป็นเงินสดจริง (เช่น 6a fee ที่ไม่ set amountPaid — หลุด guard
      // Payment PAID) — ยกเลิกทั้งที่ยังค้างจะทิ้ง ghost balance ไว้บนสัญญา
      // CANCELED โดยไม่มีทางใช้/คืน
      const parkTotal = new Decimal(contract.advanceBalance.toString())
        .plus(contract.creditBalance.toString())
        .plus(contract.rescheduleAdvanceBalance.toString());
      if (parkTotal.gt(0)) {
        throw new BadRequestException(
          'มีเงินรับล่วงหน้า/เครดิตค้างบนสัญญา — ใช้หรือคืนเงินก่อนยกเลิก',
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

      // ── C-2 detect (Phase 3 Task 3 — workbook Case 3A กรณี 2): สัญญาที่ถูก
      // ตัดจ่ายผ่านรอบจ่าย INTER-CO POSTED แล้ว — เจ้าหนี้ 21-1101/21-1102 (และ
      // ลูกหนี้ S11-3001/S11-3002) ถูก batch ล้างไปแล้ว mirror ตรงจะทำติดลบ →
      // template redirect เป็นลูกหนี้เรียกคืน 11-2107 [PAYOUT_RECALL] / S21-3001.
      // (สูตรอยู่ใน settledPayoutByContract — helper เดียวกับ
      // listPendingCancellations, Task 7 refactor. ฝั่ง SHOP (Task 4 fold):
      // settledShopTotal ให้ template cross-check redirect S21-3001 แยกสมุด —
      // สัญญา legacyNoShop มี snapshot ฝั่ง SHOP = 0 → expected 0.)
      const settled = (await settledPayoutByContract(tx, [contract.id])).get(contract.id);
      const settledTotal = settled?.settledTotal ?? new Decimal(0);
      const settledShopTotal = settled?.settledShopTotal ?? new Decimal(0);
      const settledDeductions = settled?.settledDeductions ?? new Decimal(0);
      const isC2 = settledTotal.gt(0);
      const batchNumbers = settled?.batchNumbers ?? [];

      // Post sweep reversal chain + ECL release (template — Phase 3 C-1/C-2)
      const jeResult = await template.execute(
        {
          contractId: cancellation.contractId,
          cancellationId,
          isC2,
          settledTotal,
          settledShopTotal,
        },
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

      // Audit log — เก็บ reversal ทั้งชุด (count + ids + first entryNumber).
      // C-2 ใช้ action แยก + บันทึกยอดเรียกคืนและรอบจ่ายที่เคยตัดจ่าย
      await tx.auditLog.create({
        data: {
          userId: approverId,
          action: isC2 ? 'CONTRACT_CANCELED_AFTER_PAYOUT' : 'CONTRACT_CANCELED',
          entity: 'contract',
          entityId: cancellation.contractId,
          oldValue: {
            status: contract.status, // tx-consistent re-read, not the pre-tx snapshot
            cancellationId,
          },
          newValue: {
            status: 'CANCELED',
            reversalEntryNumber: jeResult.entryNumber,
            reversalCount: jeResult.reversalJeIds.length,
            reversalJeIds: jeResult.reversalJeIds,
            refundAmount: cancellation.refundAmount.toString(),
            // C-2: recallAmount = net เงินสดที่ FINANCE โอนจริง (settled gross −
            // deductions ที่รอบหักไว้) — นิยามเดียวกับ exchange audit / list API /
            // recall queue; settledTotal (gross) เก็บคู่กันไว้ตรวจย้อน redirect
            ...(isC2
              ? {
                  settledTotal: settledTotal.toFixed(2),
                  recallAmount: settledTotal.minus(settledDeductions).toFixed(2),
                  batchNumbers,
                }
              : {}),
          },
        },
      });

      return {
        cancellationId,
        status: 'APPROVED',
        reversalEntryNumber: jeResult.entryNumber,
        reversalCount: jeResult.reversalJeIds.length,
      };
    };

    // SERIALIZABLE (Phase 5 Task 5 ข้อ 2 — ปิด TOCTOU ข้ามโมดูลที่ guard ปิดไม่ได้).
    //
    // การตัดสิน C-1 vs C-2 อ่าน `InterCoSettlementItem` + สถานะ batch ซึ่ง
    // `IntercoSettlementService.approveBatch` เป็นคนเขียน และ approveBatch เอง
    // ก็อ่านยอด GL 21-1101/21-1102/S11-3001/S11-3002 ของสัญญาที่ **การยกเลิกนี้**
    // เป็นคนเขียน ⇒ rw-conflict สองทิศ. หน้าต่างที่ guard ปิดไม่ได้: การยกเลิก
    // ผ่าน guard "ไม่มี item ใน batch DRAFT/PENDING_APPROVAL" ตอนที่ยัง**ไม่มี
    // รอบจ่าย** แล้วรอบจ่ายถูก create→submit→approve จนจบในหน้าต่างนั้น ⇒ ยกเลิก
    // เดินเส้น C-1 mirror-reverse เจ้าหนี้ที่รอบจ่ายเพิ่งล้างไป = เจ้าหนี้ติดลบ
    // และเงินที่ FINANCE โอนให้หน้าร้านไม่มีลูกหนี้เรียกคืน (C-2 ควรตั้งให้).
    //
    // `approveBatch` เป็น Serializable มาตั้งแต่ Phase 4 แต่ SSI ต้องการให้
    // **ทั้งคู่** เป็น Serializable จึงจะเห็นกัน — writer ใต้ READ COMMITTED ไม่
    // ลงทะเบียน rw-conflict กับ SIRead lock ของใครเลย. พิสูจน์ด้วยเทสสองคอนเนกชัน
    // (contract-cancellation.integration.spec.ts "TOCTOU" — ก่อนแก้ ทั้งสองฝั่ง
    // commit สำเร็จพร้อมกันจริง แล้วเจ้าหนี้ติดลบ). ต้นทุนต่ำ: ยกเลิกสัญญาเป็น
    // งานมืออนุมัติทีละใบ ไม่ใช่เส้นทางรับเงินที่รันถี่; ด่านอื่นทั้งหมด (status /
    // paid / open-batch guard / cross-check / DB idempotency index) ยังทำงาน
    // เหมือนเดิมทุกประการ — ชั้นนี้เป็นตาข่ายสุดท้าย.
    try {
      return await this.prisma.$transaction(run, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (err) {
      // ผู้แพ้ SSI race (Postgres 40001 → Prisma P2034) โผล่ได้ทั้งกลาง tx และ
      // ตอน commit — แปลเป็น 409 ไทย ไม่ใช่ raw 500 (pattern เดียวกับ
      // `approveBatch`/`settleRecallCash`). tx ทั้งก้อน roll back ⇒ ไม่มีทาง
      // ยกเลิกซ้ำหรือลงบัญชีครึ่งทาง
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
        this.logger.warn(
          `[cancellation] write conflict (P2034) on cancellation ${cancellationId} — rejecting with 409, approver should retry`,
        );
        // `SentryExceptionFilter` จับเฉพาะ status >= 500 — 409 ใบนี้จึงมองไม่เห็น
        // จาก monitoring ถ้าไม่ยิงเอง. จำเป็นเป็นพิเศษกับ Serializable ที่เพิ่ง
        // เปิดใช้: spike ของ P2034 = lock contention จริงที่ต้องรู้ก่อนจะกวนงาน
        // อนุมัติของผู้ใช้ (runbook เดียวกับ Phase 4)
        Sentry.captureMessage('[cancellation] P2034 write-conflict translated to 409', {
          level: 'warning',
          extra: { cancellationId, approverId },
        });
        throw new ConflictException(
          'คำขอยกเลิกนี้ชนกับรายการอื่นที่กำลังบันทึกอยู่ (write conflict) — ตรวจสอบที่หน้าจ่ายให้หน้าร้าน (INTER-CO) ว่าสัญญาถูกจัดเข้ารอบจ่ายไปแล้วหรือไม่ แล้วกดอนุมัติอีกครั้ง',
        );
      }
      // ผู้แพ้ของ double-approve (Phase 4 Task 6): ด่านแรกคือ guard
      // "สัญญาต้อง ACTIVE" ที่อ่านใน tx — แต่คำขอที่สองที่อ่านสถานะ **ก่อน**
      // คำขอแรก commit จะผ่าน guard นั้นแล้วไปชน DB partial unique index
      // `journal_entries_idempotency_idx` (flow + idempotencyKey ของ mirror
      // ใบเดียวกัน — sweep engine ตั้งคีย์ต่อ JE ต้นทาง) ⇒ P2002 หลุดออกไป
      // เป็น raw 500. แปลเป็น 409 ไทย; tx ทั้งก้อน roll back ⇒ ไม่มีทางอนุมัติ
      // ซ้ำสองรอบ (pattern เดียวกับ W2 ของ `IntercoSettlementService`).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('คำขอยกเลิกนี้ถูกดำเนินการไปแล้ว (คำขอซ้ำ)');
      }
      throw err;
    }
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
   *
   * Phase 3 Task 7 — each row also exposes:
   * - `settledInBatch`: สัญญาถูกตัดจ่ายผ่านรอบจ่าย INTER-CO POSTED แล้ว (= approve
   *   จะเดินเส้นทาง C-2 ตั้งลูกหนี้เรียกคืน แทนการกลับรายการทั้งชุดแบบ C-1)
   * - `recallAmount`: ยอดเรียกคืนสุทธิที่จะตั้ง (settledTotal − settledDeductions,
   *   2dp string) — null เมื่อยังไม่ตัดจ่าย. สูตรเดียวกับ C-2 detect ใน
   *   `approveCancellation` ผ่าน helper `settledPayoutByContract` (ห้าม duplicate).
   */
  async listPendingCancellations() {
    const rows = await this.prisma.contractCancellation.findMany({
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

    const settledMap = await settledPayoutByContract(
      this.prisma as unknown as Prisma.TransactionClient,
      rows.map((r) => r.contractId),
    );

    return rows.map((row) => {
      const settled = settledMap.get(row.contractId);
      const settledInBatch = !!settled && settled.settledTotal.gt(0);
      return {
        ...row,
        settledInBatch,
        recallAmount: settledInBatch
          ? settled.settledTotal.minus(settled.settledDeductions).toFixed(2)
          : null,
      };
    });
  }
}
