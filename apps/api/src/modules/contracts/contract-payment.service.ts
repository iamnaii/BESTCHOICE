import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Inject,
  forwardRef,
  ForbiddenException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { EarlyPayoffJP4Template } from '../journal/cpa-templates/early-payoff-jp4.template';
import { ShopCollectSettlementTemplate } from '../journal/cpa-templates/shop-collect-settlement.template';
import { ShopCollectShopLegs } from '../journal/cpa-templates/shop-collect-shop-legs.template';
import { shopCollectShopBalance } from '../interco-settlement/interco-typed-balance';
import { EclStageReverseTemplate } from '../journal/cpa-templates/ecl-stage-reverse.template';
import { glContractBalance } from '../journal/gl-contract-balance';
import {
  EARLY_PAYOFF_ROUNDING_TOLERANCE,
  buildEarlyPayoffJournal,
} from '../journal/compute-early-payoff-je';
import { emitDeferredWarnings, type DeferredWarning } from '../journal/deferred-warning';
import { computeInstallmentBreakdown } from '../journal/compute-installment-breakdown';
import { reconstructPriorCleared } from '../journal/reconstruct-prior';
import { computePayoffQuote } from './compute-payoff-quote';
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { journeyDedupeKey } from '../customer-journey/journey-data-schemas';
import { Decimal } from '@prisma/client/runtime/library';
import { validatePeriodOpen } from '../../utils/period-lock.util';
import { isFutureBkkDay } from '../../utils/date.util';
import { EarlyPayoffDto, ShopCollectSettlementDto } from './dto/contract.dto';
import {
  consumePaymentApproval,
  type PaymentApprovalContext,
  canonical,
} from '../payments/services/payment-approval-request.util';
import { d, dAdd, dSub, dRound } from '../../utils/decimal.util';

/**
 * ปิดสัญญาด้วยสลิปที่ตรวจแล้ว (คำสั่งเจ้าของ 2026-09-24: "ยอดตรงกับสลิป ปิดยอดได้เลยไม่ต้องอนุมัติ")
 * — ทางเข้าที่สองของ earlyPayoff() คู่กับคิวอนุมัติ. ผู้เรียก (EarlyPayoffSlipService) ตรวจ 5 ข้อ
 * และเซ็นตั๋วไว้แล้ว; ใน tx ยังตรวจซ้ำว่ายอดปิดสดยังตรง + ลายนิ้วมือสลิปยังไม่ถูกใช้ (unique)
 */
export interface SlipMatchAuthorization {
  /** key ในที่เก็บไฟล์ (เก็บลง PaymentEvidence.imageUrl เหมือนบอท) */
  imageKey: string;
  /** ลายนิ้วมือสลิป — สูตรเดียวกับบอท (slip-checks.slipFingerprint) */
  hash: string;
  /** ยอดที่อ่านได้จากสลิป — ต้องเท่ายอดปิดสด ±0.01 */
  amount: number;
  refNo: string | null;
  bankName: string | null;
  date: string | null;
  confidence: number;
}

/**
 * คำขออนุมัติปิดยอดอนุมัติ "ตัวเงิน" ของ quote (PR5): ทุกฟิลด์ยกเว้น `journalPreview` — ยอดที่ลูกค้าจ่าย ส่วนลด %
 * งวดคงเหลือ ฯลฯ มาจากตารางงวดและคอลัมน์สัญญา ส่วนรายการบัญชีใน preview อ่านยอดในบัญชี จึงเปลี่ยนได้เมื่อรอบตั้งลูกหนี้งวด
 * (2A) ลงระหว่างส่งคำขอกับกดอนุมัติ ทั้งที่ยอดเงินเท่าเดิม · รายการที่ลงสร้างจากยอดในบัญชีในธุรกรรมตอนทำรายการ
 * (`buildEarlyPayoffJournal`) — snapshot ของคำขอยังเก็บทั้งก้อนเหมือนเดิม.
 */
function earlyPayoffApprovalMoney(summary: unknown): unknown {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return summary;
  return Object.fromEntries(Object.entries(summary).filter(([key]) => key !== 'journalPreview'));
}

@Injectable()
export class ContractPaymentService {
  private readonly logger = new Logger(ContractPaymentService.name);
  constructor(
    private prisma: PrismaService,
    private productsService: ProductsService,
    private journalAutoService: JournalAutoService,
    private earlyPayoffJP4Template: EarlyPayoffJP4Template,
    private shopCollectSettlementTemplate: ShopCollectSettlementTemplate,
    // forwardRef: ContractsModule → ReceiptsModule → LineOaModule → ContractsModule cycle.
    @Inject(forwardRef(() => ReceiptsService))
    private receiptsService: ReceiptsService,
    // C1 (2026-07-30): releases any leftover 11-2102 ECL allowance on early payoff.
    private eclStageReverseTemplate: EclStageReverseTemplate,
    // การเดินทางของลูกค้า (2026-09-24): เขียน EARLY_PAYOFF หลัง commit — optional เพื่อให้ spec ที่ new ด้วยมือ 10 ไฟล์ไม่ต้องส่ง
    @Optional() private journeyEntries?: JourneyEntryWriter,
  ) {}

  /**
   * F-3-027 part 2/3 follow-up: Resolve FINANCE companyId for HP installment
   * journal entries triggered by early payoff. Mirrors PaymentsService helper —
   * payments on installment contracts post to FINANCE-side accounts and must
   * pass companyId explicitly (Task 9 will validate via allowedCompanies).
   */
  private async resolveFinanceCompanyId(): Promise<string> {
    const financeCompany = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    if (!financeCompany) {
      throw new InternalServerErrorException('FINANCE company not configured');
    }
    return financeCompany.id;
  }

  /**
   * Phase A.1b: Resolve SHOP companyId for the SHOP-side commission JE leg
   * triggered by early payoff. Returns null if SHOP not configured —
   * JournalAutoService will skip the commission entry rather than fail.
   */
  private async resolveShopCompanyId(): Promise<string | null> {
    const shop = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'SHOP', deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return shop?.id ?? null;
  }

  async getSchedule(id: string) {
    await this.findOne(id);
    return this.prisma.payment.findMany({
      where: { contractId: id, deletedAt: null },
      orderBy: { installmentNo: 'asc' },
    });
  }

  /**
   * ค่าปรับค้างที่ "ยังไม่เคยลง Cr 42-1103" (NETTED) — สำหรับขา JE ปิดยอดเท่านั้น.
   *
   * 2B partial (FEE-FIRST, PR #1313) ลงรายได้ค่าปรับตอนรับเงินโดยไม่ reset
   * Payment.lateFee — ค่าดิบใน DB จึงรวมค่าปรับที่รับรู้รายได้ไปแล้ว. ขา JE ต้อง
   * หักส่วนที่ลงแล้วออก (reconstruct จาก JE เดิม — กลไกเดียวกับ
   * payment-receipt.template) ไม่งั้น Cr 42-1103 ถูกลงซ้ำ.
   *
   * หมายเหตุ: ยอดเก็บลูกค้า (quote.totalPayoff/unpaidLateFees) ใช้ค่าดิบต่อไป —
   * ถูกต้องแล้ว: เงินค่าปรับที่จ่ายผ่าน partial อยู่ใน amountPaid ซึ่งสูตร quote
   * หักเป็น advance อยู่แล้ว จึงหักลบกันเองพอดี.
   */
  private async computeUnbookedLateFees(
    client: Prisma.TransactionClient | PrismaService,
    contract: {
      id: string;
      financedAmount: Prisma.Decimal;
      storeCommission: Prisma.Decimal | null;
      interestTotal: Prisma.Decimal;
      vatAmount: Prisma.Decimal | null;
      totalMonths: number;
    },
    payments: Array<{
      installmentNo: number;
      status: string;
      lateFee: Prisma.Decimal;
      lateFeeWaived: boolean | null;
    }>,
  ): Promise<Decimal> {
    const feeRows = payments.filter(
      (p) => p.status !== 'PAID' && !p.lateFeeWaived && d(p.lateFee).gt(0),
    );
    if (feeRows.length === 0) return new Decimal(0);

    // installmentTotal ใช้เป็น discriminator ของ legacy-2B ใน reconstructPriorCleared
    const { installmentExclVat, vatPerInst } = computeInstallmentBreakdown({
      financedAmount: contract.financedAmount.toString(),
      storeCommission:
        contract.storeCommission != null ? contract.storeCommission.toString() : null,
      interestTotal: contract.interestTotal.toString(),
      vatAmount: contract.vatAmount != null ? contract.vatAmount.toString() : null,
      totalMonths: contract.totalMonths,
    });
    const installmentTotal = installmentExclVat.plus(vatPerInst);

    const scheds = await client.installmentSchedule.findMany({
      where: { contractId: contract.id, deletedAt: null },
      select: { id: true, installmentNo: true },
    });
    const schedByNo = new Map(scheds.map((s) => [s.installmentNo, s.id]));

    let total = new Decimal(0);
    for (const p of feeRows) {
      const schedId = schedByNo.get(p.installmentNo);
      if (!schedId) {
        // ไม่มี schedule row (ข้อมูล legacy) → ไม่มี JE เดิมให้ชน — นับเต็ม
        total = total.plus(d(p.lateFee));
        continue;
      }
      const { priorLateFeeBooked } = await reconstructPriorCleared(
        client,
        schedId,
        installmentTotal,
      );
      const remaining = d(p.lateFee).minus(priorLateFeeBooked);
      if (remaining.gt(0)) total = total.plus(remaining);
    }
    return total;
  }

  /**
   * คำนวณยอดปิดสัญญาก่อนกำหนด (FINANCE perspective)
   *
   * Logic:
   *   (1) รวมค้างชำระ      = ค่างวด × งวดคงเหลือ (รวม VAT)
   *   (2) ยอดชำระล่วงหน้า  = creditBalance + partialPayments
   *   (3) คงเหลือยอดค้าง   = (1) - (2)
   *   (4) ค่างวดไม่รวม VAT = (3) ÷ (1 + vatPct)
   *   (5) ต้นทุนยอดค้าง    = ((sellingPrice - downPayment) + storeCommission) ÷ totalMonths × งวดคงเหลือ
   *                          (ยอดจัดจริง + ค่าคอมที่ FINANCE จ่ายให้ SHOP, เฉลี่ยต่อง่วด)
   *   (6) กำไรขั้นต้น      = (4) - (5)
   *   (7) ส่วนลด           = (6) × discountPct
   *   (8) ยอดชำระปิดยอด    = (3) - (7)
   */
  async getEarlyPayoffQuote(
    id: string,
    discountPctInput?: number,
    depositAccountCode?: string,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const contract = await this.findOne(id, client);
    if (!['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status)) {
      throw new BadRequestException('สัญญาต้องอยู่ในสถานะ ACTIVE, OVERDUE หรือ DEFAULT');
    }
    if (!contract.totalMonths || contract.totalMonths <= 0) {
      throw new BadRequestException('ข้อมูลสัญญาผิดพลาด: จำนวนงวดต้องมากกว่า 0');
    }

    // Align with EarlyPayoffJP4Template.execute: count distinct installment
    // schedules NOT covered by a PAID Payment row (Set lookup) — instead of
    // simply counting PAID payments. Both yield the same number under
    // 1:1 invariant, but using the same shape as the template guarantees
    // preview and post never drift if the data model evolves (e.g.,
    // multiple Payment rows per installment from PARTIAL flows).
    const allInstNos = await client.installmentSchedule.findMany({
      where: { contractId: contract.id, deletedAt: null },
      select: { installmentNo: true },
    });
    const paidInstNos = new Set(
      contract.payments.filter((p) => p.status === 'PAID').map((p) => p.installmentNo),
    );
    const unpaidInsts = allInstNos.filter((i) => !paidInstNos.has(i.installmentNo));
    const remainingMonths = unpaidInsts.length;
    if (remainingMonths <= 0) {
      throw new BadRequestException('ไม่มีงวดค้างชำระ ไม่จำเป็นต้องปิดก่อนกำหนด');
    }

    // สูตรทั้งหมดอยู่ใน computePayoffQuote — single source of truth ที่
    // RepossessionsService (JP5) ใช้ด้วย เพื่อให้ยอดปิดยึดคืน = ยอดปิดก่อนกำหนดเสมอ
    const quote = computePayoffQuote({
      monthlyPayment: contract.monthlyPayment,
      remainingMonths,
      totalMonths: contract.totalMonths,
      creditBalance: contract.creditBalance,
      rescheduleAdvanceBalance: contract.rescheduleAdvanceBalance,
      vatPct: contract.vatPct,
      sellingPrice: contract.sellingPrice,
      downPayment: contract.downPayment,
      storeCommission: contract.storeCommission,
      discountPctInput,
      payments: contract.payments,
    });
    const discountPercent = quote.discountPercent;

    // ── JE preview (PR5 — ตามยอดในบัญชี · buildEarlyPayoffJournal) ─────────────
    // ฟังก์ชันเดียวกับที่ earlyPayoff() ใช้ลงรายการ ⇒ preview ที่ UI/LIFF เห็น === รายการที่ลงจริง
    // (คำขออนุมัติเก็บ quote นี้ทั้งก้อน — earlyPayoff() คำนวณซ้ำในธุรกรรมแล้วเทียบเฉพาะตัวเงิน ไม่เทียบ journalPreview).
    // เงินสด = เงินที่ลูกค้าจ่าย (totalPayoff) · 52-1106 = ลูกหนี้ตามบัญชี − เงินที่รับ − เงินของลูกค้าที่หัก
    // (คำตอบฝ่ายบัญชี เล่ม 1 ข้อ 5.1–5.4). Cash dimension: caller-provided > fallback 11-1201
    // (KBank — owner rule 2026-07-08: direct FINANCE receipt is KBank-only)
    const epDepositCode = depositAccountCode ?? '11-1201';
    const je = await buildEarlyPayoffJournal(client, {
      contract,
      depositAccountCode: epDepositCode,
      cashReceived: quote.totalPayoff,
      // ขา JE ใช้ค่าปรับ NETTED (หัก Cr 42-1103 ที่เคยลงผ่าน partial แล้ว) —
      // กัน double-book; quote.unpaidLateFees (ยอดเก็บ/แถว UI) เป็นค่าดิบโดยตั้งใจ
      unpaidLateFees: await this.computeUnbookedLateFees(client, contract, contract.payments),
      // ถังพักงวดสุดท้ายที่ยอดปิดหักให้ → ขา Dr 21-1103 แทนเงินสด (คำสั่งเจ้าของ 2026-08-16 §จุดหัก 3)
      parkReliefApplied: quote.rescheduleAdvanceApplied,
      // เงินรับล่วงหน้าถังรวมที่ยอดปิดหักให้ → ขา Dr 21-1103 บรรทัดของตัวเอง (PR5ข — เจ้าของเคาะ 01/10/2569)
      advanceReliefApplied: quote.advanceBalanceApplied,
      quoteDiscountAmount: quote.discountAmount,
      discountPercent,
    });

    // Resolve all account names from CoA so preview shows real labels.
    const epCodes = je.lines.map((l) => l.accountCode);
    const epCoaRows = await client.chartOfAccount.findMany({
      where: { code: { in: epCodes } },
      select: { code: true, name: true },
    });
    const epNameMap = new Map(epCoaRows.map((r) => [r.code, r.name]));
    const nameOf = (code: string) => epNameMap.get(code) ?? code;

    // Per-line UI descriptions (human-facing). Only the money — accountCode +
    // debit + credit, shared via buildEarlyPayoffJournal — must match the posting;
    // the ledger words its descriptions differently and that's intentional.
    // บรรทัดที่ PR5 เพิ่ม (11-2103 · 21-5101 · 53-1503) และบรรทัด 21-1103 ของถังรวม (PR5ข) ไม่มีคำอธิบาย — การ์ดแสดง
    // ชื่อบัญชีจากผังบัญชี
    const epDescriptions: Record<string, string> = {
      [epDepositCode]: `รับ ${je.cashReceived.toFixed(2)} ฿ ปิดยอด`,
      '21-1103': `หักเงินพักปรับดิว ${je.parkRelief.toFixed(2)}`,
      '11-2106': `ยกเลิกค่าอนาคต ${je.deferredInterest.toFixed(2)}`,
      '21-2102': `ล้าง 21-2102 ${je.deferredVat.toFixed(2)}`,
      '52-1106': `ส่วนลดดอกเบี้ย ${discountPercent}%`,
      '11-2101': `ล้าง Gross ${je.ledger.gross.toFixed(2)}`,
      '11-2105': `ล้าง 11-2105 ${je.ledger.vatReceivable.toFixed(2)}`,
      '41-1101': 'รับรู้รายได้',
      '21-2101': `VAT ถึงกำหนด ${je.deferredVat.toFixed(2)}`,
      '42-1103': `ค่าปรับค้างชำระ ${je.lateFees.toFixed(2)} (ไม่คิด VAT)`,
    };

    type JeLine = {
      accountCode: string;
      accountName: string;
      debit: string;
      credit: string;
      description: string;
    };
    const jeLines: JeLine[] = je.lines.map((l) => ({
      accountCode: l.accountCode,
      accountName: nameOf(l.accountCode),
      debit: l.dr.toFixed(2),
      credit: l.cr.toFixed(2),
      description: l.generalAdvance ? '' : (epDescriptions[l.accountCode] ?? ''),
    }));

    let jeTotalDr = new Decimal(0);
    let jeTotalCr = new Decimal(0);
    for (const l of jeLines) {
      jeTotalDr = jeTotalDr.plus(l.debit);
      jeTotalCr = jeTotalCr.plus(l.credit);
    }
    const jeIsBalanced = jeTotalDr.toFixed(2) === jeTotalCr.toFixed(2);

    return {
      monthlyPayment: dRound(d(contract.monthlyPayment)).toNumber(),
      remainingMonths,
      totalRemaining: quote.totalRemaining,
      advancePayment: quote.advancePayment,
      remainingBalance: quote.remainingBalance,
      remainingExVat: quote.remainingExVat,
      remainingCost: quote.remainingCost,
      grossProfit: quote.grossProfit,
      discountPct: discountPercent, // percentage 0-100
      discountAmount: quote.discountAmount,
      unpaidLateFees: quote.unpaidLateFees,
      totalPayoff: quote.totalPayoff,
      // ยอดถังพักที่ยอดปิดดูดซับจริง — earlyPayoff() ใช้ต่อเป็นขา Dr 21-1103
      rescheduleAdvanceApplied: quote.rescheduleAdvanceApplied,
      // เงินรับล่วงหน้าถังรวมที่ยอดปิดหัก (PR5ข) — บรรทัดของตัวเองบนหน้าปิดยอด · ขา Dr 21-1103 บรรทัดที่สอง
      advanceBalanceApplied: quote.advanceBalanceApplied,
      journalPreview: {
        lines: jeLines,
        totalDebit: jeTotalDr.toFixed(2),
        totalCredit: jeTotalCr.toFixed(2),
        isBalanced: jeIsBalanced,
      },
    };
  }

  async earlyPayoff(
    id: string,
    userId: string,
    dto: EarlyPayoffDto,
    approvalContext?: PaymentApprovalContext,
    slipMatch?: SlipMatchAuthorization,
  ) {
    if (!approvalContext && !slipMatch)
      throw new ForbiddenException('กรุณาส่งคำขอปิดยอดผ่านหน้ารออนุมัติ หรือแนบสลิปที่ยอดตรง');
    // Resolve cash dimension once: dto > 11-1201 (KBank). Owner rule 2026-07-08:
    // direct FINANCE receipt is KBank-only — cash collected at a branch goes
    // through collectedByShop → 11-2107 instead.
    const depositAccountCode = dto.depositAccountCode ?? '11-1201';
    // Shop-collect substitution: server overrides depositAccountCode with 11-2107
    // when collectedByShop=true. The DTO's @IsIn([KBANK_ACCOUNT_CODE]) validator
    // stays intact — the client never names 11-2107 directly.
    const effectiveDepositCode = dto.collectedByShop ? '11-2107' : depositAccountCode;
    let quote = await this.getEarlyPayoffQuote(id, dto.discountPct, effectiveDepositCode);
    const paidDate = dto.paymentDate ? new Date(dto.paymentDate) : new Date();
    // Future check on BKK calendar days (mirror the payment wizard).
    if (isFutureBkkDay(paidDate)) {
      throw new BadRequestException('วันที่ชำระต้องไม่เป็นวันในอนาคต');
    }

    // referenceNo / slipUrl are OPTIONAL for every method — stored on the Payment
    // rows when supplied, never required. The overlay sends BANK_TRANSFER with no
    // ref (owner 2026-07-20, PR #1365 dropped the Ref field); a non-CASH guard
    // here 400-ed every UI payoff from 2026-07-20 until 2026-09-05. Neither the
    // payment wizard nor the repossession flow requires a ref either — do not
    // re-add one here without a matching UI field.

    // F-3-027 part 2/3 follow-up + Phase A.1b: resolve FINANCE + SHOP
    // companyIds once BEFORE the transaction (and BEFORE the per-installment
    // loop) so the early-payoff JE callers pass both explicitly to
    // JournalAutoService.
    const financeCompanyId = await this.resolveFinanceCompanyId();
    const shopCompanyId = await this.resolveShopCompanyId();

    // Period-lock guard (audit finding J3): cannot back-date an early payoff
    // into a closed (FINANCE) accounting period.
    await validatePeriodOpen(this.prisma, paidDate, financeCompanyId);

    // สัญญาณเตือน (คอลัมน์เงินของลูกค้าไม่ตรงยอดในบัญชี) — ส่งหลังธุรกรรม commit เท่านั้น
    let epWarnings: readonly DeferredWarning[] = [];
    await this.prisma.$transaction(
      async (tx) => {
        if (approvalContext) {
          const approval = await consumePaymentApproval(tx, approvalContext, 'EARLY_PAYOFF', id);
          if (approval.requestedById !== userId)
            throw new ForbiddenException('ผู้ขออนุมัติไม่ตรงกับผู้ทำรายการ');
          quote = await this.getEarlyPayoffQuote(id, dto.discountPct, effectiveDepositCode, tx);
          if (
            canonical(earlyPayoffApprovalMoney(quote)) !==
            canonical(earlyPayoffApprovalMoney(approval.reviewSummary))
          ) {
            throw new ConflictException('ยอดปิดสัญญาเปลี่ยนแล้ว กรุณาส่งขออนุมัติใหม่');
          }
        } else {
          // ทางสลิปตรง — ตรวจซ้ำในทรานแซกชันเดียวกับ JE: ยอดปิดสดยังตรงกับสลิป และสลิปยังไม่ถูกใช้
          // (SlipFingerprint.hash unique — ชนกับสลิปที่ลูกค้าเคยส่งบอทหรือปิดยอดไปแล้ว → 409)
          const match = slipMatch!;
          quote = await this.getEarlyPayoffQuote(id, dto.discountPct, effectiveDepositCode, tx);
          // เทียบเป็นสตางค์ กันเศษ float (11106.01 − 11106 = 0.0100000000002)
          if (Math.round(Math.abs(quote.totalPayoff - match.amount) * 100) > 1) {
            throw new ConflictException(
              'ยอดปิดสัญญาเปลี่ยนแล้ว ไม่ตรงกับสลิป กรุณาแนบสลิปใหม่หรือส่งขออนุมัติ',
            );
          }
          try {
            await tx.slipFingerprint.create({ data: { hash: match.hash, contractId: id } });
          } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
              throw new ConflictException('สลิปนี้ถูกใช้บันทึกรายการอื่นไปแล้ว');
            }
            throw err;
          }
          await tx.paymentEvidence.create({
            data: {
              contractId: id,
              imageUrl: match.imageKey,
              amount: match.amount,
              status: 'APPROVED',
              reviewedById: userId,
              reviewedAt: new Date(),
              reviewNote: 'EARLY_PAYOFF_SLIP_MATCH',
            },
          });
          // audit ใน tx (atomic กับ JE) — แถวนี้บอกว่า "ปิดโดยไม่ผ่านคิวอนุมัติเพราะสลิปตรง" ใครกด ยอดเท่าไร
          await tx.auditLog.create({
            data: {
              userId,
              action: 'EARLY_PAYOFF_SLIP_MATCHED',
              entity: 'contract',
              entityId: id,
              newValue: {
                totalPayoff: quote.totalPayoff.toFixed(2),
                slipAmount: match.amount.toFixed(2),
                refNo: match.refNo,
                bankName: match.bankName,
                slipDate: match.date,
                confidence: match.confidence,
                imageKey: match.imageKey,
                hash: match.hash,
              },
            },
          });
        }

        const freshContract = await tx.contract.findUnique({
          where: { id },
          select: { status: true, contractNumber: true, branchId: true },
        });
        if (!freshContract || !['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(freshContract.status)) {
          throw new BadRequestException('สถานะสัญญาไม่อนุญาตให้ปิดก่อนกำหนด');
        }

        const unpaidPayments = await tx.payment.findMany({
          where: { contractId: id, status: { not: 'PAID' }, deletedAt: null },
          orderBy: { installmentNo: 'asc' },
        });

        // Distribute totalPayoff across unpaid installments (FIFO).
        // We update each Payment row individually but post ONE aggregated JE
        // at the end via createEarlyPayoffJournal — per-installment JEs were
        // unbalanced when discount > 0 (cash partial vs full breakdown).
        // Snapshot the breakdown BEFORE any updates so the JE math reflects
        // the as-of-payoff state, not the post-update partial payment.
        const installmentSnapshots = unpaidPayments.map((p) => ({
          amountDue: p.amountDue,
          amountPaidBefore: p.amountPaid,
          monthlyPrincipal: p.monthlyPrincipal,
          monthlyInterest: p.monthlyInterest,
          monthlyCommission: p.monthlyCommission,
          vatAmount: p.vatAmount,
          lateFee: p.lateFee,
          lateFeeWaived: p.lateFeeWaived,
        }));

        let remainingPayoff = d(quote.totalPayoff);
        for (const payment of unpaidPayments) {
          const lateFee = payment.lateFeeWaived ? d(0) : d(payment.lateFee);
          const owed = dSub(dAdd(payment.amountDue, lateFee), payment.amountPaid);
          const owedNum = owed.toNumber();
          const payAmountNum = Math.min(remainingPayoff.toNumber(), Math.max(0, owedNum));
          const payAmount = d(payAmountNum);
          remainingPayoff = dSub(remainingPayoff, payAmount);

          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: 'PAID',
              paidDate,
              amountPaid: dAdd(payment.amountPaid, payAmount).toDecimalPlaces(2),
              paymentMethod: dto.paymentMethod as PaymentMethod,
              recordedById: userId,
              evidenceUrl: dto.slipUrl ?? payment.evidenceUrl,
              gatewayRef: dto.referenceNo ?? payment.gatewayRef,
              notes: dto.notes ? `[ปิดก่อนกำหนด] ${dto.notes}` : '[ปิดก่อนกำหนด]',
            },
          });
        }

        // PR5 (คำตอบฝ่ายบัญชี เล่ม 1 ข้อ 5.1–5.4 · 29/09/2569): รายการ JP4 ล้างตามยอดในบัญชีของสัญญา —
        // buildEarlyPayoffJournal ตัวเดียวกับที่ getEarlyPayoffQuote() ใช้ทำ preview ⇒ ที่ลงที่นี่ = รายการที่เห็นก่อนกด
        // (preview === posted). เงินสด = quote.totalPayoff (เงินที่รับจริง — ก้อนเดียวกับที่กระจายเข้าแถว Payment
        // ข้างบนและพิมพ์ในใบเสร็จ) · 52-1106 = ลูกหนี้ตามบัญชี − เงินที่รับ − เงินของลูกค้าที่หัก (ส่วนที่เหลือให้สมดุล
        // — แทน ACCOUNTANT NOTE Wave-1 #11 เดิมที่เงินสดในรายการคิดจากงวด × ยอดต่องวด ไม่เท่าเงินที่รับ).
        // The JP4 template can't be called directly here: it also creates Payment
        // rows, which were already updated above (duplicate conflict).
        {
          const epContract = await tx.contract.findUniqueOrThrow({ where: { id } });
          const epUnpaid = installmentSnapshots.length;
          // ค่าปรับเข้า JE เป็นยอด NETTED — หัก Cr 42-1103 ที่เคยลงผ่านใบเสร็จ
          // partial (FEE-FIRST) แล้ว กัน double-book (owner 2026-07-20 + review
          // 2026-07-20). ใช้ unpaidPayments (สถานะก่อน flip PAID ข้างบน) + JE
          // history ใน tx — JE ปิดยอดของรอบนี้ยังไม่ post จึงไม่ปนเข้ามา
          const epLateFees = await this.computeUnbookedLateFees(tx, epContract, unpaidPayments);
          // ถังพักงวดสุดท้าย (คำสั่งเจ้าของ 2026-08-16 §จุดหัก 3): quote หักเงินก้อนนี้ออกจากยอดที่ลูกค้าจ่าย →
          // Dr 21-1103 แทนเงินสด · clamp ด้วยคอลัมน์ถังพักและยอด 21-1103 ในบัญชี ณ ตอนอยู่ใน tx (R-3 — กติกาเดียวกับ
          // JP5) · เงินเกินของลูกค้า 21-5101 = min(คอลัมน์ที่ยอดปิดหักให้, ยอดในบัญชี) (X2) · ทั้งหมดใน buildEarlyPayoffJournal
          const epJe = await buildEarlyPayoffJournal(tx, {
            contract: epContract,
            depositAccountCode: effectiveDepositCode,
            cashReceived: quote.totalPayoff,
            unpaidLateFees: epLateFees,
            parkReliefApplied: quote.rescheduleAdvanceApplied,
            // PR5ข: เงินรับล่วงหน้าถังรวมที่ยอดปิดหักให้ — clamp ด้วยคอลัมน์ถังรวมและยอด 21-1103 ในบัญชีที่เหลือหลังเงินพัก
            advanceReliefApplied: quote.advanceBalanceApplied,
            quoteDiscountAmount: quote.discountAmount,
            discountPercent: quote.discountPct,
          });
          // เงินที่รับ + เงินของลูกค้าที่หัก เกินลูกหนี้ตามบัญชีเกิน 1.00 → ไม่มีบัญชีรับยอดนั้น (ไม่ใช่เศษสตางค์ และไม่ใช่
          // ส่วนลด) — ปฏิเสธทั้งธุรกรรม (ฝ่ายบัญชียังไม่ระบุวิธีลง · accounting.md "ปิดยอดก่อนกำหนด (JP4)")
          if (epJe.excessReceived.gt(0)) {
            throw new Error(
              `early payoff ${id}: money received + customer money exceed the contract ledger receivable by ` +
                `${epJe.excessReceived.toFixed(2)} (> 1.00) — not posted`,
            );
          }
          // คอลัมน์ไม่ตรงบัญชี / 52-1106 ต่างจากส่วนลดบนหน้าจอเกิน 1.00 — ส่งหลัง commit
          epWarnings = epJe.warnings;

          // Ledger-side line descriptions (the preview words them differently —
          // only the money, shared via buildEarlyPayoffJournal, must match).
          const epDescriptions: Record<string, string> = {
            [effectiveDepositCode]: dto.collectedByShop
              ? `หน้าร้านรับ ${epJe.cashReceived.toFixed(2)} ฿ ปิดยอด (ลูกหนี้-หน้าร้าน)`
              : `รับ ${epJe.cashReceived.toFixed(2)} ฿ ปิดยอด`,
            '21-1103': 'หักเงินพักปรับดิว (ปิดสัญญาก่อนกำหนด)',
            '11-2106': 'ยกเลิกรายได้รอตัดบัญชี-ดอกเบี้ย',
            '21-2102': 'ล้างภาษีขายรอเรียกเก็บ',
            '52-1106': 'ส่วนลดดอกเบี้ย-ปิดยอดก่อนกำหนด',
            '11-2101': 'ล้างลูกหนี้ Gross (excl. VAT)',
            '11-2105': 'ล้างลูกหนี้ภาษีขายรอฯ',
            '41-1101': 'รับรู้รายได้ดอกเบี้ย',
            '21-2101': 'ภาษีขาย ภ.พ.30 ถึงกำหนด',
            '42-1103': 'ค่าปรับชำระล่าช้า',
          };

          // Build metadata — stamp shop-collect flags when applicable
          const jeMetadata: Prisma.JsonObject = {
            tag: 'JP4',
            flow: 'early-payoff',
            contractId: id,
            unpaidInstallments: epUnpaid,
            discount: epJe.discount.toFixed(2),
            interestDiscountPercent: quote.discountPct,
            lateFees: epJe.lateFees.toFixed(2),
            // PR5: ฐานของรายการ — เงินที่รับ · ลูกหนี้ตามบัญชีที่ล้าง · ส่วนลดตามสูตรยอดปิด (ต่างจาก 52-1106 ได้เศษสตางค์)
            cashReceived: epJe.cashReceived.toFixed(2),
            receivableCleared: epJe.receivableCleared.toFixed(2),
            quoteDiscountAmount: d(quote.discountAmount).toFixed(2),
            ...(epJe.parkRelief.gt(0) ? { parkRelief: epJe.parkRelief.toFixed(2) } : {}),
            ...(epJe.advanceRelief.gt(0) ? { advanceRelief: epJe.advanceRelief.toFixed(2) } : {}),
            ...(epJe.creditRelief.gt(0) ? { creditRelief: epJe.creditRelief.toFixed(2) } : {}),
            ...(epJe.roundingGain.gt(0) ? { roundingGain: epJe.roundingGain.toFixed(2) } : {}),
            // ส่วนของ 52-1106 ที่เกินฐานข้อ 5.2 (% ส่วนลด × ดอกเบี้ยรอตัดบัญชี) — เกิน 1.00 เท่านั้น (ไม่นับเศษสตางค์)
            ...(epJe.discountBeyondDeferredBase.gt(EARLY_PAYOFF_ROUNDING_TOLERANCE)
              ? { discountBeyondDeferredBase: epJe.discountBeyondDeferredBase.toFixed(2) }
              : {}),
            ...(dto.collectedByShop
              ? {
                  collectedByShop: true,
                  shopReceivable: '11-2107',
                  shopReceivableType: 'SHOP_COLLECT',
                }
              : {}),
          };

          await this.journalAutoService.createAndPost(
            {
              description: `ปิดยอดก่อนกำหนด — สัญญา ${freshContract.contractNumber} (${epUnpaid} งวดคงเหลือ)`,
              reference: `${id}:early-payoff`,
              // Backdate fix (2026-07-09): dto.paymentDate already drove
              // Payment.paidDate + the period-lock guard, but the JE landed on
              // "now" — a backdated payoff split the Payment date and the
              // ledger date across months. Thread the same date through.
              postedAt: paidDate,
              metadata: jeMetadata,
              lines: epJe.lines.map((l) => ({
                accountCode: l.accountCode,
                dr: l.dr,
                cr: l.cr,
                description: l.generalAdvance ? '' : (epDescriptions[l.accountCode] ?? ''),
              })),
            },
            tx,
          );

          // ปลดถังพักงวดสุดท้ายให้ตรงกับขา Dr 21-1103 ที่เพิ่งลง — ต้องอยู่ใน tx
          // เดียวกับ JE. ส่วนที่ยอดปิดดูดซับไม่หมด (ส่วนลดกินไปบางส่วน / ชน
          // max(0,…)) คงค้างในถังตามเดิม ไม่ปลดเกินที่ลูกค้าได้ลดจริง.
          if (epJe.parkRelief.gt(0)) {
            await tx.contract.update({
              where: { id },
              data: { rescheduleAdvanceBalance: { decrement: epJe.parkRelief } },
            });
            await tx.auditLog.create({
              data: {
                userId,
                action: 'RESCHEDULE_ADVANCE_CONSUMED',
                entity: 'contract',
                entityId: id,
                newValue: {
                  parkRelief: epJe.parkRelief.toFixed(2),
                  beforeParkBalance: d(epContract.rescheduleAdvanceBalance ?? 0).toFixed(2),
                  afterParkBalance: dSub(
                    d(epContract.rescheduleAdvanceBalance ?? 0),
                    epJe.parkRelief,
                  ).toFixed(2),
                  source: 'EARLY_PAYOFF_PARK_RELIEF',
                },
              },
            });
          }

          // PR5ข (เจ้าของเคาะ 01/10/2569): ถังรวมลดเท่าบรรทัด Dr 21-1103 ของถังรวมที่เพิ่งลง — tx เดียวกับ JE (แบบเดียวกับ
          // ถังพักข้างบน) · ส่วนที่ยอดปิดหักไม่หมด (ถังรวมใหญ่กว่ายอดค้าง) คงค้างในคอลัมน์ = ยอดในบัญชี
          if (epJe.advanceRelief.gt(0)) {
            await tx.contract.update({
              where: { id },
              data: { advanceBalance: { decrement: epJe.advanceRelief } },
            });
          }

          // AuditLog for shop-collect payoff path
          if (dto.collectedByShop) {
            await tx.auditLog.create({
              data: {
                userId,
                action: 'SHOP_COLLECT_PAYOFF',
                entity: 'contract',
                entityId: id,
                newValue: {
                  shopReceivable: '11-2107',
                  shopReceivableType: 'SHOP_COLLECT',
                  // PR5: ยอดที่หน้าร้านรับแทน = Dr 11-2107 = เงินที่ลูกค้าจ่าย (รวมค่าปรับ)
                  cashReceived: epJe.cashReceived.toFixed(2),
                  lateFees: epJe.lateFees.toFixed(2),
                  unpaidInstallments: epUnpaid,
                },
              },
            });
          }
        }

        // Reset credit balance (used up by the early payoff) — PR5: รายการ JP4 ล้าง 21-5101 เท่าที่ยอดปิดหักให้และมีในบัญชี
        // (X2) · ยอดในบัญชีที่เกินคอลัมน์ยังเป็นเงินของลูกค้า ค้างใน 21-5101 (สัญญาณเตือนหลัง commit)
        const updated = await tx.contract.update({
          where: { id },
          data: {
            status: 'EARLY_PAYOFF',
            creditBalance: 0,
          },
          select: { productId: true },
        });

        // C1 (2026-07-30 owner decision): early payoff derecognizes the HP
        // receivable in full — any ECL allowance still sitting on 11-2102 for
        // this contract is now stale and must release back to P&L. Same
        // convention as the JP5/write-off consume-then-release helper
        // (glContractBalance + EclStageReverseTemplate), minus the "consume"
        // leg — JP4 has no loss to net the provision against.
        await this.releaseEclOnPayoff(tx, id);

        // Ownership release: FINANCE → null. Customer owns the device once
        // the contract is closed via payoff, same semantics as COMPLETED.
        if (updated?.productId) {
          try {
            await this.productsService.transferOwnership(updated.productId, null, tx);
          } catch (err) {
            this.logger.error(
              `Failed to release product ownership on early payoff for contract ${id}: ${err instanceof Error ? err.message : err}`,
            );
          }
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    emitDeferredWarnings(epWarnings);

    // Issue the EARLY_PAYOFF receipt (post-commit; generateReceipt has its own tx +
    // sequence lock). Mirrors the normal recordPayment path — a receipt failure must
    // NOT roll back the committed payoff, so it's logged and swallowed.
    let receiptNumber: string | null = null;
    try {
      const receipt = await this.receiptsService.generateReceipt(
        id,
        null,
        'EARLY_PAYOFF',
        quote.totalPayoff,
        null,
        dto.paymentMethod,
        dto.referenceNo ?? null,
        userId,
        paidDate, // D4 backdating — ใบเสร็จลงวันที่รับเงินจริง (ตรงกับ Payment/JE)
      );
      receiptNumber = receipt?.receiptNumber ?? null;
    } catch (err) {
      this.logger.error(
        `Failed to generate EARLY_PAYOFF receipt for contract ${id}: ${err instanceof Error ? err.message : err}`,
      );
    }

    // การเดินทางของลูกค้า (เจ้าของ 2026-09-24 "ไม่มีประวัติว่าลูกค้าปิดยอด"): เขียนหลัง tx commit
    // เหมือน CONTRACT_ACTIVATED — recordAfterCommit ไม่โยน และห้ามทำให้ปิดยอดที่สำเร็จแล้วล้มเหลว
    // data = เลขสัญญา/เลขใบเสร็จ/ยอดปิดเท่านั้น (PDPA — ไม่คัดลอกข้อมูลลูกค้า)
    if (this.journeyEntries) {
      try {
        const closed = await this.prisma.contract.findUnique({
          where: { id },
          select: { customerId: true, contractNumber: true },
        });
        if (closed) {
          await this.journeyEntries.recordAfterCommit({
            customerId: closed.customerId,
            kind: 'EARLY_PAYOFF',
            occurredAt: paidDate,
            actorType: 'STAFF',
            actorUserId: userId,
            refType: 'contract',
            refId: id,
            data: {
              contractNumber: closed.contractNumber,
              receiptNumber,
              totalPayoff: quote.totalPayoff,
            },
            dedupeKey: journeyDedupeKey('EARLY_PAYOFF', id),
          });
        }
      } catch (err) {
        this.logger.error(
          `Failed to record EARLY_PAYOFF journey entry for contract ${id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return { ...quote, status: 'EARLY_PAYOFF', paidDate };
  }

  /**
   * Task 3: Shop→FINANCE settlement — posts `Dr depositAccountCode / Cr 11-2107`.
   * Call this after a `collectedByShop` early payoff when the shop remits the
   * collected cash to FINANCE, clearing the Dr 11-2107 receivable.
   */
  async shopCollectSettlement(id: string, userId: string, dto: ShopCollectSettlementDto) {
    await this.prisma.$transaction(
      async (tx) => {
        const result = await this.shopCollectSettlementTemplate.execute(
          {
            contractId: id,
            depositAccountCode: dto.depositAccountCode,
            amount: dto.amount,
            postedById: userId,
            requestId: dto.requestId,
          },
          tx,
        );

        // ขาคู่ฝั่ง SHOP (2026-09-05): Dr S21-1104 / Cr S11-1202 — เฉพาะเมื่อสมุด SHOP มี
        // เจ้าหนี้ SHOP_COLLECT ของสัญญานี้คุ้มยอด (ต้นทาง JP5 หลังฟีเจอร์นี้). แถวต้นทาง JP4
        // หรือแถวก่อนฟีเจอร์ไม่มีขา Cr S21-1104 มาก่อน → ข้ามพร้อม flag ไม่ดัน S21-1104 ติดลบ.
        // ใบ FINANCE ที่ dedupe (requestId ซ้ำ) → ไม่โพสต์ซ้ำเช่นกัน.
        let shopLegEntryNo: string | null = null;
        let shopLegSkipped: 'DEDUPED' | 'NO_SHOP_PAYABLE' | null = null;
        if (result.deduped) {
          shopLegSkipped = 'DEDUPED';
        } else {
          const amount = new Prisma.Decimal(String(dto.amount));
          const shopPayable = await shopCollectShopBalance(tx, id);
          if (shopPayable.plus('0.01').gte(amount)) {
            const shopCompany = await tx.companyInfo.findFirst({
              where: { companyCode: 'SHOP', deletedAt: null },
              select: { id: true },
            });
            if (!shopCompany) throw new InternalServerErrorException('SHOP company not configured');
            const shopLeg = await new ShopCollectShopLegs(this.journalAutoService).postSettlement(
              {
                contractId: id,
                amount,
                shopCompanyId: shopCompany.id,
                requestId: dto.requestId,
              },
              tx,
            );
            shopLegEntryNo = shopLeg.entryNumber;
          } else {
            shopLegSkipped = 'NO_SHOP_PAYABLE';
          }
        }

        await tx.auditLog.create({
          data: {
            userId,
            action: 'SHOP_COLLECT_SETTLED',
            entity: 'contract',
            entityId: id,
            newValue: {
              depositAccountCode: dto.depositAccountCode,
              amount: String(dto.amount),
              requestId: dto.requestId ?? null,
              deduped: result.deduped,
              shopLegEntryNo,
              shopLegSkipped,
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return { success: true, contractId: id };
  }

  /**
   * C1 (owner decision 2026-07-30): early payoff (JP4) never touched 11-2102 —
   * once the contract leaves the daily bad-debt-provision cron's scope
   * (ACTIVE/OVERDUE/DEFAULT/TERMINATED only), any ECL allowance still booked
   * on 11-2102 for it would sit on the balance sheet forever, with stale
   * ACTIVE BadDebtProvision rows never reconciled.
   *
   * Mirrors the JP5/write-off release convention exactly (see
   * `RepossessionsService.create` + `glContractBalance` +
   * `EclStageReverseTemplate`), minus the "consume against loss" leg — JP4 is
   * a full cash settlement with no derecognition loss to net the provision
   * against, so the entire GL balance (if any) releases straight to P&L.
   *
   * `EclStageReverseTemplate.execute` self-skips when reverseAmount <= 0, so
   * calling this twice on an already-released contract posts nothing new
   * (idempotent) — the GL balance nets to 0 after the first release.
   */
  private async releaseEclOnPayoff(
    tx: Prisma.TransactionClient,
    contractId: string,
  ): Promise<void> {
    const bal = await glContractBalance(tx, contractId, '11-2102', 'cr');
    // Negative 11-2102 = GL anomaly (Dr > Cr — e.g. past mis-posted JE). Same
    // alarm-and-skip convention as JP5/write-off (M1 hardening) — never
    // auto-heal, surface for manual investigation instead.
    if (bal.lt(0)) {
      Sentry.captureMessage('JP4 payoff: negative 11-2102 balance', {
        level: 'warning',
        tags: { subsystem: 'bad-debt' },
        extra: { contractId, balance: bal.toFixed(2) },
      });
    }
    if (bal.gt(0)) {
      const activeRow = await tx.badDebtProvision.findFirst({
        where: { contractId, status: 'ACTIVE', deletedAt: null },
        orderBy: { provisionDate: 'desc' },
      });
      await this.eclStageReverseTemplate.execute(
        {
          contractId,
          reverseAmount: bal,
          fromBucket: activeRow?.agingBucket ?? 'CURRENT',
          toBucket: 'CURRENT',
        },
        tx,
      );
    }

    // ALWAYS mark ACTIVE rows REVERSED — the contract is now settled in full,
    // so there is no more receivable left to provide against. Same convention
    // as RepossessionsService's "REVERSE stale ACTIVE rows" step after JP5.
    await tx.badDebtProvision.updateMany({
      where: { status: 'ACTIVE', contractId, deletedAt: null },
      data: { status: 'REVERSED' },
    });
  }

  /** Shared findOne - reuses Prisma query for contract with full includes */
  private async findOne(id: string, client: Prisma.TransactionClient = this.prisma) {
    const contract = await client.contract.findUnique({
      where: { id },
      include: {
        customer: true,
        product: { include: { prices: true } },
        branch: { select: { id: true, name: true } },
        salesperson: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
        interestConfig: true,
        payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
        signatures: true,
        eDocuments: true,
        contractDocuments: {
          orderBy: { createdAt: 'desc' },
          include: { uploadedBy: { select: { id: true, name: true } } },
        },
        creditCheck: {
          include: {
            checkedBy: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
    return contract;
  }
}
