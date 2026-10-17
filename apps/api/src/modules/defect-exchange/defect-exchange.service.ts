import { bindExchangeCreditCheck } from '../credit-check/services/credit-approval';
import { lockCreditCustomer } from '../credit-check/services/room-credit-history';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { DefectExchangeReversalTemplate } from '../journal/cpa-templates/defect-exchange-reversal.template';
import { markInputVatReversedIfSwept } from '../journal/input-vat/installment-input-vat.claim';
import { RepairTicketsService } from '../repair-tickets/repair-tickets.service';
import { ExecuteDefectExchangeDto } from './dto/defect-exchange.dto';
import { generateContractNumber } from '../../utils/sequence.util';
import { preemptReservationsInTx } from '../../utils/reservation-preempt.util';
import { assertSameTestSide, TEST_SIDE_CUSTOMER_SELECT } from '../../utils/test-data-markers';
import { Decimal } from '@prisma/client/runtime/library';
import { readStringFlag } from '../../utils/config.util';
import { captureProductDisclosure } from '../../utils/product-disclosure.util';
import { SHOP_WARRANTY_DAYS_CONFIG_KEY } from '../warranty/shop-warranty-policy';
import { ReceiptVoidReversalTemplate } from '../journal/cpa-templates/receipt-void-reversal.template';
import { ReceiptNumberService } from '../receipts/services/receipt-number.service';
import { glContractBalance } from '../journal/gl-contract-balance';
import { validatePeriodOpen } from '../../utils/period-lock.util';
import { emitDeferredWarnings, type DeferredWarning } from '../journal/deferred-warning';
import { Prisma } from '@prisma/client';
import { voidReceiptInTx, storedTaxColumnsOf } from '../receipts/services/receipt-void-core';
import { unmirrorableCashMessage } from '../journal/cpa-templates/defect-exchange-reversal.template';
import { CONTRACT_ADVANCE_COLUMNS_CLEARED, readContractCloseAdvances } from '../journal/contract-close-advances';
import { ADVANCE_VAT_META, advanceVatOutstanding } from '../journal/advance-vat';
import {
  buildCreditInLines,
  buildCreditOutLines,
  DEFECT_EXCHANGE_CN_SOURCE,
  DEFECT_EXCHANGE_CREDIT_IN_FLOW,
  DEFECT_EXCHANGE_CREDIT_OUT_FLOW,
  DEFECT_EXCHANGE_REDIRECT,
  DEFECT_EXCHANGE_SUSPENSE_ACCOUNT,
  DEFECT_EXCHANGE_TAG,
  estimateCreditToTransfer,
  exchangeMoneyBlockers,
  listReceiptsToCreditNote,
  sumReceiptAmounts,
} from './defect-exchange-credit';

type ReqUser = { id: string; role: string; branchId?: string | null };

const DEFECT_WINDOW_DAYS = 7;
const ELIGIBLE_CATEGORIES = ['PHONE_USED'];

@Injectable()
export class DefectExchangeService {
  private readonly logger = new Logger(DefectExchangeService.name);

  constructor(
    private prisma: PrismaService,
    private journalAutoService: JournalAutoService,
    private defectExchangeReversalTemplate: DefectExchangeReversalTemplate,
    private repairTickets: RepairTicketsService,
    /** 15ข — กระจกรับชำระ (redirect ขาเงินสด → 21-1106) + กลับ 2A ที่ลง ณ วันรับเงิน · export จาก JournalModule */
    private receiptVoidReversal: ReceiptVoidReversalTemplate,
    /** 15ข — เลขที่ใบลดหนี้ (advisory lock เดียวกับใบเสร็จ) · provide ตรงใน DefectExchangeModule (ReceiptsModule ไม่ export) */
    private receiptNumbers: ReceiptNumberService,
  ) {}

  /**
   * Check if a contract is eligible for 7-day defect exchange
   * and if the replacement product matches the rules (same model + storage).
   */
  async checkEligibility(oldContractId: string, newProductId?: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: oldContractId },
      include: {
        product: true,
        payments: { where: { deletedAt: null } },
      },
    });

    if (!contract || contract.deletedAt) {
      throw new NotFoundException('ไม่พบสัญญา');
    }

    const reasons: string[] = [];
    if (contract.tradeInCreditSnapshot) reasons.push('สัญญาที่ใช้เครดิตเทิร์นยังไม่รองรับการเปลี่ยนเครื่อง ต้องตรวจการคืนเครดิตก่อน');

    // Must be ACTIVE
    if (!['ACTIVE', 'OVERDUE'].includes(contract.status)) {
      reasons.push('สัญญาต้องอยู่ในสถานะ ACTIVE เท่านั้น');
    }

    // Used phone only
    if (!ELIGIBLE_CATEGORIES.includes(contract.product.category)) {
      reasons.push('เปลี่ยนเครื่องได้เฉพาะมือสอง (PHONE_USED)');
    }

    // Within 7 days from deviceReceivedAt (fallback to shopWarrantyStartDate, then createdAt)
    const baseDate = contract.deviceReceivedAt || contract.shopWarrantyStartDate || contract.createdAt;
    const windowEnd = new Date(baseDate);
    windowEnd.setDate(windowEnd.getDate() + DEFECT_WINDOW_DAYS);
    const now = new Date();
    const daysRemaining = Math.ceil((windowEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (now > windowEnd) {
      reasons.push(`พ้นกำหนด 7 วันแล้ว (รับเครื่องเมื่อ ${baseDate.toISOString().slice(0, 10)})`);
    }

    // 15ข — ด่านเงิน (spec §5): ปรับดิว / กวาด 42-1106 / คำขอ void ค้าง / ปิดยอด / ใบลดหนี้กำพร้า — เหตุผลเหล่านี้
    // ไม่ใช่เหตุผลกรอบ 7 วัน ⇒ หลังการขายบล็อกเสมอแม้ ผจก. ข้ามกรอบ (WINDOW_REASON_RE ไม่จับ)
    reasons.push(...(await exchangeMoneyBlockers(this.prisma, contract)));
    // 15ข — ใบรับเงินที่จะออกใบลดหนี้ + เงินของลูกค้าที่ค้างในบัญชี → เครดิตที่จะย้ายไปสัญญาใหม่ (กล่องยืนยันหลังการขาย)
    const receiptsToCreditNote = await listReceiptsToCreditNote(this.prisma, contract.id);
    // ประมาณการต้องเท่ากับที่ขั้น ก/ค/ข จะทำจริง (ผู้ตรวจอิสระ I2): จำลองจากรายการบัญชีของสัญญาด้วยตัวจำแนกเดียวกับ template
    // — ไม่ใช่ Σ ใบ + ยอดถังตอนนี้ (นับซ้ำ/ตกหล่นเมื่อมีใบที่จ่ายด้วยเครดิต หรือเงินที่รอบกลางคืนหักเข้างวดโดยไม่มีใบ)
    const contractEntries = await this.prisma.journalEntry.findMany({
      where: {
        AND: [{ metadata: { path: ['contractId'], equals: contract.id } } as Prisma.JournalEntryWhereInput],
        status: 'POSTED',
        deletedAt: null,
      },
      select: { entryNumber: true, metadata: true, lines: { select: { accountCode: true, debit: true, credit: true } } },
    });
    const estimate = estimateCreditToTransfer({
      entries: contractEntries,
      livePaymentIds: new Set(receiptsToCreditNote.map((r) => r.paymentId).filter((x): x is string => !!x)),
      ledgerAdvance: await glContractBalance(this.prisma, contract.id, '21-1103', 'cr'),
      ledgerCredit: await glContractBalance(this.prisma, contract.id, '21-5101', 'cr'),
    });
    // รายการเงินสดที่ขั้น ค จะปฏิเสธ — บอกในกล่องยืนยันตั้งแต่ตอน preview (ไม่ใช่ 400 ตอนกดยืนยัน)
    if (estimate.unmirrorable.length > 0) {
      reasons.push(unmirrorableCashMessage(estimate.unmirrorable.join(', '), contract.contractNumber));
    }
    const creditToTransfer = estimate.estimate;
    const ledgerAdvance = estimate.advanceAfter;
    const ledgerCredit = estimate.creditAfter;

    let newProduct: { id: string; brand: string; model: string; storage: string | null; category: string; status: string } | null = null;
    let supplierClaimEligible = false;

    if (newProductId) {
      const p = await this.prisma.product.findUnique({
        where: { id: newProductId },
        select: {
          id: true, brand: true, model: true, storage: true, category: true, status: true,
          shopWarrantyDays: true, stockInDate: true, supplierId: true,
        },
      });
      if (!p || p.status !== 'IN_STOCK') {
        reasons.push('สินค้าใหม่ไม่พร้อมจำหน่าย');
      } else {
        // Q2: รุ่น+ความจุต้องตรง (สีเปลี่ยนได้)
        const oldP = contract.product;
        if (p.brand !== oldP.brand || p.model !== oldP.model || p.storage !== oldP.storage) {
          reasons.push(`รุ่น/ความจุ ไม่ตรงกับของเดิม (${oldP.brand} ${oldP.model} ${oldP.storage ?? ''})`);
        }
      }
      newProduct = p && { id: p.id, brand: p.brand, model: p.model, storage: p.storage, category: p.category, status: p.status };

      // Supplier warranty eligibility on the OLD device (for claiming back)
      const old = contract.product;
      if (old.supplierId && old.stockInDate && old.shopWarrantyDays) {
        const warrantyEnd = new Date(old.stockInDate);
        warrantyEnd.setDate(warrantyEnd.getDate() + old.shopWarrantyDays);
        supplierClaimEligible = now <= warrantyEnd;
      }
    }

    return {
      eligible: reasons.length === 0,
      reasons,
      daysRemaining,
      windowEnd,
      oldContract: {
        id: contract.id,
        contractNumber: contract.contractNumber,
        product: {
          id: contract.product.id,
          brand: contract.product.brand,
          model: contract.product.model,
          storage: contract.product.storage,
          imeiSerial: contract.product.imeiSerial,
        },
        paidAmount: contract.payments
          .reduce((sum, p) => sum.add(new Decimal(p.amountPaid)), new Decimal(0))
          .toNumber(),
      },
      newProduct,
      supplierClaimEligible,
      receiptsToCreditNote: receiptsToCreditNote.map((r) => ({
        id: r.id,
        receiptNumber: r.receiptNumber,
        receiptType: r.receiptType,
        installmentNo: r.installmentNo,
        paidDate: r.paidDate.toISOString(),
        paymentMethod: r.paymentMethod,
        amount: new Decimal(r.amount.toString()).toFixed(2),
        vatAmount: r.vatAmount == null ? null : new Decimal(r.vatAmount.toString()).toFixed(2),
      })),
      creditToTransfer: creditToTransfer.toFixed(2),
      ledgerAdvance: ledgerAdvance.toFixed(2),
      ledgerCredit: ledgerCredit.toFixed(2),
    };
  }

  /**
   * Execute a 7-day defect exchange (MANAGER only):
   *   - 15ข (ก) ใบรับเงินทุกใบของสัญญาเดิม → ใบลดหนี้ + un-pay + กลับ 2A ก่อนครบกำหนด · กระจกรับชำระย้ายขาเงินสด → 21-1106
   *   - Close old contract → DEFECT_EXCHANGED · old product → DEFECT_RETURN
   *   - (ค) reverse remaining JEs (1A · 2A ที่ครบกำหนด · SHOP legs) — ข้าม flow เครดิต/เงินลูกค้า
   *   - (ข) เงินของลูกค้าที่เหลือ (21-1103 + 21-5101) → 21-1106 + กลับภาษีที่พัก
   *   - Create new contract with IDENTICAL terms · (ง) Dr 21-1106 / Cr 21-5101 = T + creditBalance
   *   - New product → RESERVED (→ SOLD_INSTALLMENT on activate; activate ใช้เครดิตชำระงวดอัตโนมัติ)
   * Spec: docs/superpowers/specs/2026-10-17-defect-exchange-credit-note-design.md §3
   */
  async execute(dto: ExecuteDefectExchangeDto, user: ReqUser | string) {
    // Support legacy string userId calls (e.g. existing controller) as well as
    // the new full-user object required for bypass-window role checks.
    const reqUser: ReqUser =
      typeof user === 'string' ? { id: user, role: 'BRANCH_MANAGER' } : user;

    // 15ข — ทุกรายการลงวันนี้ (ใบลดหนี้/กระจก/การย้ายเครดิต) ⇒ งวดบัญชี FINANCE ของวันนี้ต้องเปิด (ด่านเดียวกับ void)
    const finance = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    await validatePeriodOpen(this.prisma, new Date(), finance?.id);
    /** สัญญาณเตือนจาก core/void และคอลัมน์ไม่ตรงบัญชี — ส่งหลัง commit เท่านั้น */
    const warnings: DeferredWarning[] = [];

    const result = await this.prisma.$transaction(
      async (tx) => {
        // === bypass-window guards (must run before eligibility check) ===
        if (dto.bypassWindowCheck) {
          if (!dto.originRepairTicketId && !dto.originAfterSalesCaseId) {
            throw new BadRequestException(
              'bypassWindowCheck ต้องระบุ originRepairTicketId หรือ originAfterSalesCaseId',
            );
          }
          if (!['OWNER', 'BRANCH_MANAGER'].includes(reqUser.role)) {
            throw new ForbiddenException(
              'สิทธิ์ไม่พอ — bypass ทำได้เฉพาะ OWNER/BRANCH_MANAGER',
            );
          }
          if (dto.originRepairTicketId) {
            const ticket = await tx.repairTicket.findUnique({
              where: { id: dto.originRepairTicketId, deletedAt: null },
            });
            if (!ticket) {
              throw new NotFoundException('ไม่พบ repair ticket');
            }
            if (!['OPEN', 'IN_PROGRESS', 'READY_FOR_PICKUP'].includes(ticket.status)) {
              throw new BadRequestException(
                'repair ticket อยู่ในสถานะ terminal — ไม่สามารถ replace ได้',
              );
            }
          } else {
            // M5 — เคสต้องยังเปิดอยู่และยังไม่เคยยืนยันเปลี่ยนเครื่อง (ไม่งั้นเคสที่ปิดแล้วใช้เป็น "ตั๋วข้ามกรอบ" ได้)
            const asCase = await tx.afterSalesCase.findFirst({
              where: {
                id: dto.originAfterSalesCaseId,
                deletedAt: null,
                stage: { notIn: ['CLOSED', 'CANCELLED'] },
                replacementContractId: null,
              },
              select: { contractId: true, outcome: true, cancelledAt: true },
            });
            if (!asCase) {
              throw new NotFoundException('ไม่พบเคสหลังการขายที่ยังเปิดอยู่');
            }
            if (
              asCase.contractId !== dto.oldContractId ||
              asCase.cancelledAt ||
              !['SAME_MODEL_EXCHANGE', 'REPAIR'].includes(asCase.outcome ?? '')
            ) {
              throw new BadRequestException(
                'เคสหลังการขายไม่ตรงกับสัญญา หรือไม่ใช่เคสเปลี่ยนรุ่นเดิม',
              );
            }
          }
        } else {
          // === normal 7-day eligibility check ===
          const elig = await this.checkEligibility(dto.oldContractId, dto.newProductId);
          if (!elig.eligible) {
            throw new BadRequestException(`ไม่เข้าเกณฑ์: ${elig.reasons.join(', ')}`);
          }
        }

        // supplierClaimEligible is only relevant in the normal (non-bypass) path.
        // For bypass we default to false — the exchange is admin-forced, supplier claim
        // determination can be done separately if needed.
        let supplierClaimEligible = false;
        if (!dto.bypassWindowCheck) {
          // We already validated eligibility above; re-fetch just the supplier claim flag.
          const eligForClaim = await this.checkEligibility(dto.oldContractId, dto.newProductId);
          supplierClaimEligible = eligForClaim.supplierClaimEligible;
        }

        // 15ข (เจ้าของ 17/10/2569 ทำตามคำตอบฝ่ายบัญชีข้อ 15 ข): ด่าน C-6 "มีรายการชำระแล้ว → ปฏิเสธ" ถูกถอด —
        // ใบรับเงินของสัญญาเดิมได้ใบลดหนี้ และเงินย้ายเป็นเครดิตสัญญาใหม่ (ขั้น ก–ง ด้านล่าง).

        const oldContract = await tx.contract.findUnique({
          where: { id: dto.oldContractId },
          include: {
            product: true,
            payments: true,
            // test-data fence (spec 2026-09-05 §5.4): โหลดลูกค้ามาเข้ารั้วคู่กับเครื่องใหม่
            customer: { select: TEST_SIDE_CUSTOMER_SELECT },
          },
        });
        if (!oldContract) throw new NotFoundException('ไม่พบสัญญา');
        if (oldContract.tradeInCreditSnapshot) throw new BadRequestException('สัญญาที่ใช้เครดิตเทิร์นยังไม่รองรับการเปลี่ยนเครื่อง ต้องตรวจการคืนเครดิตก่อน');
        await lockCreditCustomer(tx, oldContract.customerId);

        // 15ข — ด่านเงินใน tx (ทั้งทางปกติและ bypass ซึ่งข้าม checkEligibility): ปรับดิว / กวาด 42-1106 / คำขอ void ค้าง /
        // ปิดยอด / ใบลดหนี้กำพร้า (spec §5) — ก่อนเขียนอะไรทั้งสิ้น
        const moneyBlockers = await exchangeMoneyBlockers(tx, oldContract);
        if (moneyBlockers.length > 0) throw new BadRequestException(moneyBlockers[0]);

        const newProductRec = await tx.product.findUnique({
          where: { id: dto.newProductId },
          // รั้วต้องเห็น PO ต้นทาง (อุปกรณ์เสริมไร้ IMEI จาก PO ทดสอบ) — ชนิดของรั้วบังคับ
          include: { po: { select: { poNumber: true } } },
        });
        if (!newProductRec) throw new NotFoundException('ไม่พบสินค้าใหม่');
        // test-data fence (spec 2026-09-05 §5.4 — แก้หลัง final review): เคลมเปลี่ยนเครื่องสืบทอด
        // "ลูกค้า" แต่เลือก "เครื่อง" ใหม่จากสต็อก (ตรงรุ่น/ความจุ — เครื่องทดสอบที่ seed ก็ผ่าน)
        // ⇒ คู่ใหม่ ต้องอยู่ฝั่งเดียวกัน. ตรวจตรงนี้ = ก่อนเขียนอะไรทั้งสิ้น (ปิดสัญญาเดิม /
        // กลับรายการ JE / สร้างสัญญาใหม่ / จองเครื่อง) และครอบทาง replace จากใบซ่อม
        // (`bypassWindowCheck` ข้าม checkEligibility แต่เดินผ่านบรรทัดนี้เหมือนกัน)
        assertSameTestSide(oldContract.customer, newProductRec);

        // 15ข — ยอดบัญชีพักของสัญญาเดิมก่อนเริ่ม: T ของสัญญาใหม่ = ส่วนที่ขั้น ก/ข เพิ่มเข้ามา (delta) — สัญญาเดิมที่เป็นลูกของ
        // การเปลี่ยนเครื่องครั้งก่อนถือ Dr credit-in ของตัวเองอยู่ (Review Focus 2) จึงต้องวัดจากจุดนี้ ไม่ใช่ยอดสุทธิ
        const suspenseBefore = await glContractBalance(tx, oldContract.id, DEFECT_EXCHANGE_SUSPENSE_ACCOUNT, 'cr');

        // 15ข — เลขที่สัญญาใหม่ต้องรู้ก่อนออกใบลดหนี้ (เหตุผลการยกเลิกอ้างถึง)
        const contractNumber = await generateContractNumber(tx);

        // === 15ข ขั้น ก — ใบรับเงินทุกใบที่ยังมีผล → ใบลดหนี้ (สัญญาเดิมยัง ACTIVE/OVERDUE ตรงนี้ จึงผ่านด่านสถานะของ core) ===
        const liveReceipts = await listReceiptsToCreditNote(tx, oldContract.id);
        const creditNoteNumbers: string[] = [];
        const voidedReceiptNumbers: string[] = [];
        for (const row of liveReceipts) {
          const fresh = await tx.receipt.findUnique({ where: { id: row.id } });
          // ถูกยกเลิกไปแล้วในฐานะใบพี่น้องของใบก่อนหน้า (paymentId เดียวกัน) — core จัดการให้แล้ว
          if (!fresh || fresh.isVoided || fresh.deletedAt) continue;
          const out = await voidReceiptInTx(
            tx,
            { reversal: this.receiptVoidReversal, numbers: this.receiptNumbers },
            {
              receipt: fresh,
              reason: `เปลี่ยนเครื่องตำหนิภายใน 7 วัน → สัญญา ${contractNumber}`,
              issuedById: reqUser.id,
              approvedById: reqUser.id,
              userRole: reqUser.role,
              // ใบตั้งแต่ PR3 เก็บค่า ณ ตอนออก — ใบเก่ากว่านั้น (prod ไม่มี) ได้ใบลดหนี้แบบยอดอย่างเดียว
              creditNoteMoney: storedTaxColumnsOf,
              policy: { skipAgeLimit: true, cnSource: DEFECT_EXCHANGE_CN_SOURCE, redirect: DEFECT_EXCHANGE_REDIRECT },
            },
          );
          warnings.push(...out.warnings);
          creditNoteNumbers.push(out.creditNote.receiptNumber, ...out.siblingCreditNoteNumbers);
          voidedReceiptNumbers.push(fresh.receiptNumber, ...out.siblingReceiptNumbers);
        }
        // Σ ยอดใบที่ถูกยกเลิกจริง (ใบพี่น้องรวมอยู่ในรายการอยู่แล้ว) — ใช้เป็นเพดานตรวจทาน ไม่ใช่ตัวตั้ง T:
        // ใบที่จ่ายด้วยเครดิต/เงินรับล่วงหน้าไม่มีขาเงินสด กระจกของมันคืน 21-5101/21-1103 ซึ่งขั้น ข ย้ายให้แล้ว
        const voidedRows =
          liveReceipts.length > 0
            ? await tx.receipt.findMany({
                where: { id: { in: liveReceipts.map((r) => r.id) }, isVoided: true },
                select: { amount: true },
              })
            : [];
        const receiptsVoided = sumReceiptAmounts(voidedRows);

        // Close old contract
        await tx.contract.update({
          where: { id: dto.oldContractId },
          data: {
            status: 'DEFECT_EXCHANGED',
            notes: [oldContract.notes, `เปลี่ยนเครื่องเพราะตำหนิ: ${dto.defectReason}`].filter(Boolean).join('\n'),
          },
        });

        // Old product → DEFECT_RETURN (so shop can decide repair vs supplier claim)
        await tx.product.update({
          where: { id: oldContract.productId },
          data: { status: 'DEFECT_RETURN' },
        });

        // === 15ข ขั้น ค — Phase A.5a: reverse the remaining JEs (1A · 2A ที่ครบกำหนด · SHOP legs). ===
        // Must run in the same outer tx so an exchange that fails to reverse cleanly rolls back the
        // contract status update. ข้าม flow เครดิต/รายการเงินสดของลูกค้า (template) — ขั้น ข ย้ายให้เอง.
        await this.defectExchangeReversalTemplate.reverseContract(oldContract.id, tx);
        // ก้อน 5 — JE ภาษีซื้อของสัญญาเดิมถูกกลับไปพร้อมกัน → สถานะบนสัญญาตามสมุด (PENDING_INVOICE = ถอนสิทธิ์เคลมย้อน)
        await markInputVatReversedIfSwept(tx, oldContract.id);

        // === 15ข ขั้น ข — เงินของลูกค้าที่เหลือ (21-1103 ทุกถัง + 21-5101) → 21-1106 + กลับภาษีที่พักทั้งก้อน ===
        // ผู้ตรวจอิสระ I1: อ่านคอลัมน์สดหลังขั้น ก/ค — การยกเลิกใบคืนค่า advanceBalance/creditBalance ให้สัญญาเดิมแล้ว (receipt-void-core)
        // ถ้าใช้ snapshot ก่อนขั้น ก จะเตือน "คอลัมน์ไม่ตรงบัญชี" เท็จทุกครั้งที่สัญญาเดิมมีใบที่จ่ายด้วยเครดิต/หักเงินรับล่วงหน้า
        const oldColumns = await tx.contract.findUniqueOrThrow({
          where: { id: oldContract.id },
          select: { id: true, contractNumber: true, advanceBalance: true, rescheduleAdvanceBalance: true, creditBalance: true },
        });
        const close = await readContractCloseAdvances(tx, oldColumns, 'defect-exchange');
        warnings.push(...close.warnings);
        const moneyOut = close.advance.plus(close.credit);
        let creditOutEntryNo: string | null = null;
        const vatOut = await advanceVatOutstanding(tx, oldContract.id);
        if (moneyOut.gt(0)) {
          const posted = await this.journalAutoService.createAndPost(
            {
              description: `[เปลี่ยนเครื่องตำหนิ] โอนเงินของลูกค้าที่เหลือเป็นเครดิตสัญญาใหม่ — สัญญา ${oldContract.contractNumber} → ${contractNumber}`,
              reference: `defect-exchange-credit-out:${oldContract.id}`,
              metadata: {
                tag: DEFECT_EXCHANGE_TAG,
                flow: DEFECT_EXCHANGE_CREDIT_OUT_FLOW,
                idempotencyKey: `defect-exchange-credit-out:${oldContract.id}`,
                contractId: oldContract.id,
                newContractNumber: contractNumber,
                advance: close.advance.toFixed(2),
                credit: close.credit.toFixed(2),
                amount: moneyOut.toFixed(2),
                ...(vatOut.gt(0) ? { [ADVANCE_VAT_META.consume]: vatOut.toFixed(2) } : {}),
              },
              lines: buildCreditOutLines(close.advance, close.credit, vatOut),
            },
            tx,
          );
          creditOutEntryNo = posted.entryNumber;
        } else if (vatOut.gt(0.01)) {
          warnings.push({
            message: '[defect-exchange] advance VAT outstanding with no customer money left to transfer',
            tags: { module: 'defect-exchange', action: 'defect-exchange-orphan-advance-vat' },
            extra: { contractId: oldContract.id, contractNumber: oldContract.contractNumber, advanceVatOutstanding: vatOut.toFixed(2) },
          });
        }
        // คอลัมน์เงินของลูกค้าบนสัญญาเดิมเป็นศูนย์ในธุรกรรมเดียวกัน (เงินอยู่ที่ 21-1106 → สัญญาใหม่)
        await tx.contract.update({ where: { id: oldContract.id }, data: CONTRACT_ADVANCE_COLUMNS_CLEARED });

        // Create new contract — copy terms verbatim, link to old
        const newContract = await tx.contract.create({
          data: {
            contractNumber,
            productDisclosure: captureProductDisclosure(newProductRec, await readStringFlag(tx, SHOP_WARRANTY_DAYS_CONFIG_KEY, '')),
            customerId: oldContract.customerId,
            productId: dto.newProductId,
            branchId: oldContract.branchId,
            salespersonId: oldContract.salespersonId,
            planType: oldContract.planType,
            sellingPrice: oldContract.sellingPrice,
            downPayment: oldContract.downPayment,
            interestRate: oldContract.interestRate,
            totalMonths: oldContract.totalMonths,
            interestTotal: oldContract.interestTotal,
            financedAmount: oldContract.financedAmount,
            storeCommission: oldContract.storeCommission,
            vatAmount: oldContract.vatAmount,
            vatPct: oldContract.vatPct,
            monthlyPayment: oldContract.monthlyPayment,
            paymentDueDay: oldContract.paymentDueDay,
            interestConfigId: oldContract.interestConfigId,
            parentContractId: oldContract.id,
            status: 'DRAFT',
            workflowStatus: 'CREATING',
            notes: `เปลี่ยนเครื่องจากสัญญา ${oldContract.contractNumber} (ภายใน 7 วัน)\nอาการ: ${dto.defectReason}${dto.notes ? '\n' + dto.notes : ''}`,
          },
        });

        await bindExchangeCreditCheck(tx, oldContract.customerId, newContract.id, reqUser);

        // Copy payment schedule from old (same dueDates, same amountDue, but reset amountPaid/status).
        // The per-installment breakdown (principal/interest/commission/VAT) MUST be carried over —
        // PaymentReceipt2BTemplate splits each collection into those ledger lines, so dropping them
        // (Wave-1 #20) left the exchanged contract's future payment JEs with no VAT/interest split.
        const newPayments = oldContract.payments
          .sort((a, b) => a.installmentNo - b.installmentNo)
          .map((p) => ({
            contractId: newContract.id,
            installmentNo: p.installmentNo,
            dueDate: p.dueDate,
            amountDue: p.amountDue,
            monthlyPrincipal: p.monthlyPrincipal,
            monthlyInterest: p.monthlyInterest,
            monthlyCommission: p.monthlyCommission,
            vatAmount: p.vatAmount,
          }));
        if (newPayments.length > 0) {
          await tx.payment.createMany({ data: newPayments });
        }

        // === 15ข ขั้น ง — ตั้งเครดิตสัญญาใหม่ T = ส่วนที่ขั้น ก (ขาเงินสดที่ย้าย) + ข (เงินค้าง) เพิ่มเข้า 21-1106 ของสัญญาเดิม ===
        // อ่านจากสมุด (delta ก่อน/หลัง) — ไม่ใช่ Σ ใบ + ข: ใบที่จ่ายด้วยเครดิตไม่มีขาเงินสด กระจกคืน 21-5101 แล้ว ข ย้ายให้
        // (นับซ้ำถ้าบวกยอดใบ). ตรวจทานขอบเขต: ข ≤ T ≤ ข + Σ ใบ — นอกช่วง = บัญชีพักมีรายการที่ไม่รู้จัก ห้ามเดา ⇒
        // ทั้ง tx rollback (500 + Sentry ให้ฝ่ายบัญชีตรวจ)
        const suspenseAfter = await glContractBalance(tx, oldContract.id, DEFECT_EXCHANGE_SUSPENSE_ACCOUNT, 'cr');
        const transferred = suspenseAfter.minus(suspenseBefore);
        const cashFromReceipts = transferred.minus(moneyOut);
        if (transferred.lt(0) || cashFromReceipts.lt(-0.01) || cashFromReceipts.gt(receiptsVoided.plus(0.01))) {
          throw new Error(
            `[defect-exchange] 21-1106 ของสัญญา ${oldContract.contractNumber} เพิ่มขึ้น ${transferred.toFixed(2)} ` +
              `(เงินค้างที่ย้าย ${moneyOut.toFixed(2)} · ใบที่ยกเลิก ${receiptsVoided.toFixed(2)}) — บัญชีพักมีรายการที่ไม่รู้จัก ต้องตรวจก่อน`,
          );
        }
        let creditInEntryNo: string | null = null;
        if (transferred.gt(0)) {
          const posted = await this.journalAutoService.createAndPost(
            {
              description: `[เปลี่ยนเครื่องตำหนิ] รับโอนเครดิตจากสัญญา ${oldContract.contractNumber} — สัญญา ${contractNumber}`,
              reference: `defect-exchange-credit-in:${newContract.id}`,
              metadata: {
                tag: DEFECT_EXCHANGE_TAG,
                flow: DEFECT_EXCHANGE_CREDIT_IN_FLOW,
                idempotencyKey: `defect-exchange-credit-in:${newContract.id}`,
                contractId: newContract.id,
                exchangeOf: oldContract.id,
                exchangeOfContractNumber: oldContract.contractNumber,
                amount: transferred.toFixed(2),
                receiptsVoided: receiptsVoided.toFixed(2),
                cashFromReceipts: cashFromReceipts.toFixed(2),
                ledgerMoved: moneyOut.toFixed(2),
              },
              lines: buildCreditInLines(transferred),
            },
            tx,
          );
          creditInEntryNo = posted.entryNumber;
          await tx.contract.update({
            where: { id: newContract.id },
            data: { creditBalance: transferred },
          });
        }

        // Reserve new product (will flip to SOLD_INSTALLMENT on activation)
        // #1679 รอบแก้ 1: CAS where IN_STOCK — RESERVED ไม่มีเจ้าของในสคีมา; ด่าน checkEligibility อ่านนอก tx และทาง
        // bypassWindowCheck ไม่ตรวจสถานะเครื่องใหม่เลย ⇒ update ตรง ๆ ทับเครื่องที่ใบจอง PAID/ร่างสัญญาอื่นถืออยู่ได้
        // count 0 → ทั้ง tx rollback (สัญญาเดิมไม่ถูกปิด · JE ไม่ถูกกลับ · ไม่มีสัญญาใหม่)
        const reserved = await tx.product.updateMany({
          where: { id: dto.newProductId, status: 'IN_STOCK', deletedAt: null },
          data: { status: 'RESERVED' },
        });
        if (reserved.count !== 1) {
          throw new ConflictException(
            'เครื่องใหม่ไม่อยู่ในสต็อกพร้อมขายแล้ว (ถูกขาย ถูกจอง หรือถูกใบจองล็อกไว้) — เปลี่ยนเครื่องไม่ได้ กรุณาเลือกเครื่องอื่นที่พร้อมขายแล้วทำรายการใหม่',
          );
        }
        // B5: เครื่องใหม่ถูกจองไว้แล้ว — ตัด hold ของเว็บใน tx เดียวกัน (เคลมเปลี่ยนเครื่อง)
        await preemptReservationsInTx(tx, [dto.newProductId]);

        // === repair-ticket handoff (bypass path only) ===
        if (dto.bypassWindowCheck && dto.originRepairTicketId) {
          // Customer match check — repair ticket customer must match the new contract customer.
          const ticketForMatch = await tx.repairTicket.findUnique({
            where: { id: dto.originRepairTicketId },
            select: { customerId: true },
          });
          if (ticketForMatch && ticketForMatch.customerId !== newContract.customerId) {
            throw new ForbiddenException(
              'customer mismatch — repair ticket vs new contract',
            );
          }

          await this.repairTickets.markReplaced(
            dto.originRepairTicketId,
            newContract.id,
            reqUser,
            tx,
          );

          await tx.auditLog.create({
            data: {
              userId: reqUser.id,
              action: 'DEFECT_EXCHANGE_WINDOW_BYPASSED',
              entity: 'defect_exchange',
              entityId: newContract.id,
              newValue: { originRepairTicketId: dto.originRepairTicketId },
              ipAddress: '',
            },
          });
        } else if (dto.bypassWindowCheck && dto.originAfterSalesCaseId) {
          await tx.auditLog.create({
            data: {
              userId: reqUser.id,
              action: 'DEFECT_EXCHANGE_WINDOW_BYPASSED',
              entity: 'defect_exchange',
              entityId: newContract.id,
              newValue: { originAfterSalesCaseId: dto.originAfterSalesCaseId },
              ipAddress: '',
            },
          });
        }

        // Audit log
        await tx.auditLog.create({
          data: {
            userId: reqUser.id,
            action: 'DEFECT_EXCHANGE',
            entity: 'contract',
            entityId: newContract.id,
            newValue: {
              oldContractId: oldContract.id,
              oldContractNumber: oldContract.contractNumber,
              newContractId: newContract.id,
              newContractNumber: contractNumber,
              oldProductId: oldContract.productId,
              newProductId: dto.newProductId,
              defectReason: dto.defectReason,
              photoUrls: dto.photoUrls ?? [],
              transferredCredit: transferred.toFixed(2),
              creditNoteNumbers,
              voidedReceiptNumbers,
              receiptsVoided: receiptsVoided.toFixed(2),
              cashFromReceipts: cashFromReceipts.toFixed(2),
              ledgerAdvanceMoved: close.advance.toFixed(2),
              ledgerCreditMoved: close.credit.toFixed(2),
              creditOutEntryNo,
              creditInEntryNo,
              supplierClaimEligible,
            },
            ipAddress: '',
          },
        });

        this.logger.log(
          `Defect exchange: ${oldContract.contractNumber} → ${contractNumber} (credit ${transferred.toFixed(2)} · CN ${creditNoteNumbers.length})`,
        );

        return {
          oldContract: {
            id: oldContract.id,
            contractNumber: oldContract.contractNumber,
            status: 'DEFECT_EXCHANGED',
          },
          newContract: {
            id: newContract.id,
            contractNumber,
            status: 'DRAFT',
            workflowStatus: 'CREATING',
            creditBalance: transferred.toNumber(),
          },
          supplierClaimEligible,
          creditNoteNumbers,
          voidedReceiptNumbers,
          transferredCredit: transferred.toFixed(2),
          creditOutEntryNo,
          creditInEntryNo,
        };
      },
      { isolationLevel: 'Serializable' },
    );
    emitDeferredWarnings(warnings);
    return result;
  }

  /**
   * List defect-exchange history — read from AuditLog to avoid adding a new model.
   */
  async list(filters: { branchId?: string; from?: string; to?: string }) {
    const where: Record<string, unknown> = { action: 'DEFECT_EXCHANGE' };
    if (filters.from || filters.to) {
      where.createdAt = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
    }
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true, createdAt: true, userId: true, entityId: true, newValue: true,
        user: { select: { id: true, email: true, name: true } },
      },
    });
    return rows;
  }
}
