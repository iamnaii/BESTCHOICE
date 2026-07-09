import { Injectable, Logger, NotFoundException, BadRequestException, InternalServerErrorException, Inject, forwardRef } from '@nestjs/common';
import { PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { EarlyPayoffJP4Template } from '../journal/cpa-templates/early-payoff-jp4.template';
import { ShopCollectSettlementTemplate } from '../journal/cpa-templates/shop-collect-settlement.template';
import { computeEarlyPayoffJE } from '../journal/compute-early-payoff-je';
import { Decimal } from '@prisma/client/runtime/library';
import { validatePeriodOpen } from '../../utils/period-lock.util';
import { isFutureBkkDay } from '../../utils/date.util';
import { EarlyPayoffDto, ShopCollectSettlementDto } from './dto/contract.dto';
import { d, dAdd, dSub, dMul, dDiv, dRound, dRoundDown, dSum, dGte } from '../../utils/decimal.util';

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
  async getEarlyPayoffQuote(id: string, discountPctInput?: number, depositAccountCode?: string) {
    const contract = await this.findOne(id);
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
    const allInstNos = await this.prisma.installmentSchedule.findMany({
      where: { contractId: contract.id, deletedAt: null },
      select: { installmentNo: true },
    });
    const paidInstNos = new Set(
      contract.payments.filter((p) => p.status === 'PAID').map((p) => p.installmentNo),
    );
    const remainingMonths = allInstNos.filter((i) => !paidInstNos.has(i.installmentNo)).length;
    if (remainingMonths <= 0) {
      throw new BadRequestException('ไม่มีงวดค้างชำระ ไม่จำเป็นต้องปิดก่อนกำหนด');
    }

    const round2 = (v: Prisma.Decimal) => dRound(v).toNumber();
    const monthlyPayment = d(contract.monthlyPayment);

    // (1) รวมค้างชำระ (รวม VAT)
    const totalRemaining = round2(dMul(monthlyPayment, remainingMonths));

    // (2) ยอดชำระล่วงหน้า / partial credit
    const creditBalance = d(contract.creditBalance);
    const paidPayments = contract.payments.filter(p => p.status === 'PARTIALLY_PAID');
    const partialPaid = dSum(paidPayments.map(p => d(p.amountPaid)));
    const advancePayment = round2(dAdd(creditBalance, partialPaid));

    // (3) คงเหลือยอดค้าง
    const remainingBalance = round2(dSub(totalRemaining, advancePayment));

    // (4) ค่างวดไม่รวม VAT
    const vatPct = d(contract.vatPct);
    const remainingExVat = vatPct.gt(0)
      ? round2(dDiv(remainingBalance, dAdd(1, vatPct)))
      : remainingBalance;

    // (5) ต้นทุนยอดค้าง = ยอดจัดจริง + commission
    // หมายเหตุ: contract.financedAmount ในระบบเก็บ "ยอดรวมที่ลูกค้าต้องจ่าย"
    // (principal + commission + interest + VAT) ไม่ใช่ยอดจัดล้วน
    // ดังนั้นต้องคำนวณ principal จาก sellingPrice - downPayment
    const truePrincipal = dSub(contract.sellingPrice, contract.downPayment);
    const financeCost = dAdd(truePrincipal, d(contract.storeCommission));
    const remainingCost = round2(dMul(dDiv(financeCost, contract.totalMonths), remainingMonths));

    // (6) กำไรขั้นต้น (อาจติดลบเคสขาดทุน — แสดงค่าจริง)
    const grossProfit = round2(dSub(remainingExVat, remainingCost));

    // (7) ส่วนลด (default 50%, max 50% ตามนโยบาย)
    // ถ้ากำไรติดลบ → ส่วนลด = 0 (ไม่ลดเพิ่ม ไม่บวกเพิ่ม)
    // ปัดเศษส่วนลด "ลง" (ROUND_DOWN) — เศษครึ่งสตางค์ไม่ปัดขึ้นเป็นส่วนลด
    // ยอดปิดสัญญาจึงปัดเข้าข้าง FINANCE (owner policy 2026-07-02).
    const discountPercent =
      discountPctInput != null ? Math.max(0, Math.min(50, discountPctInput)) : 50;
    const discountPct = discountPercent / 100;
    const discountAmount = grossProfit > 0 ? dRoundDown(dMul(grossProfit, discountPct)).toNumber() : 0;

    // (8) ยอดชำระปิดยอด
    const totalPayoff = Math.max(0, round2(dSub(remainingBalance, discountAmount)));

    // Late fees (ไม่ลด — ตามนโยบาย "ไม่คิด VAT ค่าปรับ")
    const unpaidLateFees = dSum(
      contract.payments
        .filter(p => p.status !== 'PAID' && !p.lateFeeWaived)
        .map(p => d(p.lateFee)),
    ).toNumber();

    // ── JE preview (single source of truth — computeEarlyPayoffJE) ───────────
    // Computed from contract fields via the SAME pure function the ledger
    // posting (earlyPayoff()) and the JP4 template use, so the preview shown to
    // the UI/LIFF is byte-for-byte the JE that gets posted on confirm.
    // Cash dimension: caller-provided > fallback 11-1201 (KBank — owner rule
    // 2026-07-08: direct FINANCE receipt is KBank-only)
    const epDepositCode = depositAccountCode ?? '11-1201';
    const je = computeEarlyPayoffJE({
      depositAccountCode: epDepositCode,
      financedAmount: contract.financedAmount.toString(),
      storeCommission: contract.storeCommission != null ? contract.storeCommission.toString() : null,
      interestTotal: contract.interestTotal.toString(),
      vatAmount: contract.vatAmount != null ? contract.vatAmount.toString() : null,
      totalMonths: contract.totalMonths,
      unpaidCount: remainingMonths,
      interestDiscountPercent: discountPercent,
    });

    // Resolve all account names from CoA so preview shows real labels.
    const epCodes = je.lines.map((l) => l.accountCode);
    const epCoaRows = await this.prisma.chartOfAccount.findMany({
      where: { code: { in: epCodes } },
      select: { code: true, name: true },
    });
    const epNameMap = new Map(epCoaRows.map((r) => [r.code, r.name]));
    const nameOf = (code: string) => epNameMap.get(code) ?? code;

    // Per-line UI descriptions (human-facing). Only the money — accountCode +
    // debit + credit, shared via computeEarlyPayoffJE — must match the posting;
    // the ledger words its descriptions differently and that's intentional.
    const epDescriptions: Record<string, string> = {
      [epDepositCode]: `รับ ${je.settlement.toFixed(2)} ฿ ปิดยอด`,
      '11-2106': `ยกเลิกค่าอนาคต ${je.remainingDeferredInterest.toFixed(2)}`,
      '21-2102': `ล้าง 21-2102 ${je.remainingDeferredVat.toFixed(2)}`,
      '52-1106': `ส่วนลดดอกเบี้ย ${discountPercent}%`,
      '11-2101': `ล้าง Gross ${je.remainingGross.toFixed(2)}`,
      '11-2105': `ล้าง 11-2105 ${je.remainingDeferredVat.toFixed(2)}`,
      '41-1101': 'รับรู้รายได้',
      '21-2101': `VAT ถึงกำหนด ${je.settleVat.toFixed(2)}`,
    };

    type JeLine = { accountCode: string; accountName: string; debit: string; credit: string; description: string };
    const jeLines: JeLine[] = je.lines.map((l) => ({
      accountCode: l.accountCode,
      accountName: nameOf(l.accountCode),
      debit: l.dr.toFixed(2),
      credit: l.cr.toFixed(2),
      description: epDescriptions[l.accountCode] ?? '',
    }));

    let jeTotalDr = new Decimal(0);
    let jeTotalCr = new Decimal(0);
    for (const l of jeLines) {
      jeTotalDr = jeTotalDr.plus(l.debit);
      jeTotalCr = jeTotalCr.plus(l.credit);
    }
    const jeIsBalanced = jeTotalDr.toFixed(2) === jeTotalCr.toFixed(2);

    return {
      monthlyPayment: round2(monthlyPayment),
      remainingMonths,
      totalRemaining,
      advancePayment,
      remainingBalance,
      remainingExVat,
      remainingCost,
      grossProfit,
      discountPct: discountPct * 100, // return as percentage 0-100
      discountAmount,
      unpaidLateFees,
      totalPayoff: round2(dAdd(totalPayoff, unpaidLateFees)),
      journalPreview: {
        lines: jeLines,
        totalDebit: jeTotalDr.toFixed(2),
        totalCredit: jeTotalCr.toFixed(2),
        isBalanced: jeIsBalanced,
      },
    };
  }

  async earlyPayoff(id: string, userId: string, dto: EarlyPayoffDto) {
    // Resolve cash dimension once: dto > 11-1201 (KBank). Owner rule 2026-07-08:
    // direct FINANCE receipt is KBank-only — cash collected at a branch goes
    // through collectedByShop → 11-2107 instead.
    const depositAccountCode = dto.depositAccountCode ?? '11-1201';
    // Shop-collect substitution: server overrides depositAccountCode with 11-2107
    // when collectedByShop=true. The DTO's @IsIn([KBANK_ACCOUNT_CODE]) validator
    // stays intact — the client never names 11-2107 directly.
    const effectiveDepositCode = dto.collectedByShop ? '11-2107' : depositAccountCode;
    const quote = await this.getEarlyPayoffQuote(id, dto.discountPct, effectiveDepositCode);
    const paidDate = dto.paymentDate ? new Date(dto.paymentDate) : new Date();
    // Future check on BKK calendar days (mirror the payment wizard).
    if (isFutureBkkDay(paidDate)) {
      throw new BadRequestException('วันที่ชำระต้องไม่เป็นวันในอนาคต');
    }

    // Require reference for non-cash methods
    if (dto.paymentMethod !== 'CASH' && !dto.referenceNo && !dto.slipUrl) {
      throw new BadRequestException('กรุณาระบุเลขที่อ้างอิงหรือแนบสลิปสำหรับการชำระแบบโอน/QR');
    }

    // F-3-027 part 2/3 follow-up + Phase A.1b: resolve FINANCE + SHOP
    // companyIds once BEFORE the transaction (and BEFORE the per-installment
    // loop) so the early-payoff JE callers pass both explicitly to
    // JournalAutoService.
    const financeCompanyId = await this.resolveFinanceCompanyId();
    const shopCompanyId = await this.resolveShopCompanyId();

    // Period-lock guard (audit finding J3): cannot back-date an early payoff
    // into a closed (FINANCE) accounting period.
    await validatePeriodOpen(this.prisma, paidDate, financeCompanyId);

    await this.prisma.$transaction(
      async (tx) => {
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
          const payAmountNum = Math.min(
            remainingPayoff.toNumber(),
            Math.max(0, owedNum),
          );
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
              notes: dto.notes
                ? `[ปิดก่อนกำหนด] ${dto.notes}`
                : '[ปิดก่อนกำหนด]',
            },
          });
        }

        // Phase A.4b → Wave-4: post the early-payoff JE via the SINGLE source of
        // truth computeEarlyPayoffJE — the SAME function getEarlyPayoffQuote()
        // uses for the preview — so what is posted here is byte-for-byte the JE
        // the customer was quoted (preview === posted, guaranteed).
        // The JP4 template can't be called directly here: it also creates Payment
        // rows, which were already updated above (duplicate conflict).
        //
        // ACCOUNTANT NOTE (Wave-1 #11): the JE cash debit (computeEarlyPayoffJE
        // settlement = remainingGross − discount + deferred VAT) is the
        // per-installment breakdown, while the cash the customer is QUOTED
        // (quote.totalPayoff) is monthlyPayment-based, nets out creditBalance/
        // advance, and discounts GROSS PROFIT. The two bases can diverge — the
        // FIFO loop above distributes quote.totalPayoff; reconciling the payoff
        // cash basis is an accounting-policy decision left unchanged pending sign-off.
        {
          const epContract = await tx.contract.findUniqueOrThrow({ where: { id } });
          const epUnpaid = installmentSnapshots.length;
          const epJe = computeEarlyPayoffJE({
            depositAccountCode: effectiveDepositCode,
            financedAmount: epContract.financedAmount.toString(),
            storeCommission: epContract.storeCommission != null ? epContract.storeCommission.toString() : null,
            interestTotal: epContract.interestTotal.toString(),
            vatAmount: epContract.vatAmount != null ? epContract.vatAmount.toString() : null,
            totalMonths: epContract.totalMonths,
            unpaidCount: epUnpaid,
            // quote.discountPct is a PERCENTAGE 0..100 (getEarlyPayoffQuote returns
            // `discountPct * 100`); computeEarlyPayoffJE divides by 100 internally.
            interestDiscountPercent: quote.discountPct,
          });

          // Ledger-side line descriptions (the preview words them differently —
          // only the money, shared via computeEarlyPayoffJE, must match).
          const epDescriptions: Record<string, string> = {
            [effectiveDepositCode]: dto.collectedByShop
              ? `หน้าร้านรับ ${epJe.settlement.toFixed(2)} ฿ ปิดยอด (ลูกหนี้-หน้าร้าน)`
              : `รับ ${epJe.settlement.toFixed(2)} ฿ ปิดยอด`,
            '11-2106': 'ยกเลิกรายได้รอตัดบัญชี-ดอกเบี้ย',
            '21-2102': 'ล้างภาษีขายรอเรียกเก็บ',
            '52-1106': 'ส่วนลดดอกเบี้ย-ปิดยอดก่อนกำหนด',
            '11-2101': 'ล้างลูกหนี้ Gross (excl. VAT)',
            '11-2105': 'ล้างลูกหนี้ภาษีขายรอฯ',
            '41-1101': 'รับรู้รายได้ดอกเบี้ย',
            '21-2101': 'ภาษีขาย ภ.พ.30 ถึงกำหนด',
          };

          // Build metadata — stamp shop-collect flags when applicable
          const jeMetadata: Prisma.JsonObject = {
            tag: 'JP4',
            flow: 'early-payoff',
            contractId: id,
            unpaidInstallments: epUnpaid,
            discount: epJe.discount.toFixed(2),
            interestDiscountPercent: quote.discountPct,
            ...(dto.collectedByShop ? { collectedByShop: true, shopReceivable: '11-2107' } : {}),
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
                description: epDescriptions[l.accountCode] ?? '',
              })),
            },
            tx,
          );

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
                  settlement: epJe.settlement.toFixed(2),
                  unpaidInstallments: epUnpaid,
                },
              },
            });
          }
        }

        // Reset credit balance (used up by the early payoff)
        const updated = await tx.contract.update({
          where: { id },
          data: {
            status: 'EARLY_PAYOFF',
            creditBalance: 0,
          },
          select: { productId: true },
        });

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

    // Issue the EARLY_PAYOFF receipt (post-commit; generateReceipt has its own tx +
    // sequence lock). Mirrors the normal recordPayment path — a receipt failure must
    // NOT roll back the committed payoff, so it's logged and swallowed.
    try {
      await this.receiptsService.generateReceipt(
        id,
        null,
        'EARLY_PAYOFF',
        quote.totalPayoff,
        null,
        dto.paymentMethod,
        dto.referenceNo ?? null,
        userId,
      );
    } catch (err) {
      this.logger.error(
        `Failed to generate EARLY_PAYOFF receipt for contract ${id}: ${err instanceof Error ? err.message : err}`,
      );
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
        await this.shopCollectSettlementTemplate.execute(
          {
            contractId: id,
            depositAccountCode: dto.depositAccountCode,
            amount: dto.amount,
            postedById: userId,
          },
          tx,
        );

        await tx.auditLog.create({
          data: {
            userId,
            action: 'SHOP_COLLECT_SETTLED',
            entity: 'contract',
            entityId: id,
            newValue: {
              depositAccountCode: dto.depositAccountCode,
              amount: String(dto.amount),
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return { success: true, contractId: id };
  }

  /** Shared findOne - reuses Prisma query for contract with full includes */
  private async findOne(id: string) {
    const contract = await this.prisma.contract.findUnique({
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
