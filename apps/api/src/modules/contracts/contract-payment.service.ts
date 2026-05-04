import { Injectable, Logger, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { EarlyPayoffJP4Template } from '../journal/cpa-templates/early-payoff-jp4.template';
import { Decimal } from '@prisma/client/runtime/library';
import { validatePeriodOpen } from '../../utils/period-lock.util';
import { EarlyPayoffDto } from './dto/contract.dto';
import { d, dAdd, dSub, dMul, dDiv, dRound, dSum, dGte } from '../../utils/decimal.util';

@Injectable()
export class ContractPaymentService {
  private readonly logger = new Logger(ContractPaymentService.name);
  constructor(
    private prisma: PrismaService,
    private productsService: ProductsService,
    private journalAutoService: JournalAutoService,
    private earlyPayoffJP4Template: EarlyPayoffJP4Template,
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
  async getEarlyPayoffQuote(id: string, discountPctInput?: number) {
    const contract = await this.findOne(id);
    if (!['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status)) {
      throw new BadRequestException('สัญญาต้องอยู่ในสถานะ ACTIVE, OVERDUE หรือ DEFAULT');
    }
    if (!contract.totalMonths || contract.totalMonths <= 0) {
      throw new BadRequestException('ข้อมูลสัญญาผิดพลาด: จำนวนงวดต้องมากกว่า 0');
    }

    const fullyPaidCount = contract.payments.filter(p => p.status === 'PAID').length;
    const remainingMonths = contract.totalMonths - fullyPaidCount;
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
    const discountPct =
      discountPctInput != null ? Math.max(0, Math.min(50, discountPctInput)) / 100 : 0.5;
    const discountAmount = grossProfit > 0 ? round2(dMul(grossProfit, discountPct)) : 0;

    // (8) ยอดชำระปิดยอด
    const totalPayoff = Math.max(0, round2(dSub(remainingBalance, discountAmount)));

    // Late fees (ไม่ลด — ตามนโยบาย "ไม่คิด VAT ค่าปรับ")
    const unpaidLateFees = dSum(
      contract.payments
        .filter(p => p.status !== 'PAID' && !p.lateFeeWaived)
        .map(p => d(p.lateFee)),
    ).toNumber();

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
    };
  }

  async earlyPayoff(id: string, userId: string, dto: EarlyPayoffDto) {
    const quote = await this.getEarlyPayoffQuote(id, dto.discountPct);
    const paidDate = dto.paymentDate ? new Date(dto.paymentDate) : new Date();

    // Require reference for non-cash methods
    if (dto.paymentMethod !== 'CASH' && !dto.referenceNo && !dto.slipUrl) {
      throw new BadRequestException('กรุณาระบุเลขที่อ้างอิงหรือแนบสลิปสำหรับการชำระแบบโอน/QR');
    }

    // Period-lock guard (audit finding J3): cannot back-date an early payoff
    // into a closed accounting period.
    await validatePeriodOpen(this.prisma, paidDate);

    // F-3-027 part 2/3 follow-up + Phase A.1b: resolve FINANCE + SHOP
    // companyIds once BEFORE the transaction (and BEFORE the per-installment
    // loop) so the early-payoff JE callers pass both explicitly to
    // JournalAutoService.
    const financeCompanyId = await this.resolveFinanceCompanyId();
    const shopCompanyId = await this.resolveShopCompanyId();

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

        // Phase A.4b: replaced createEarlyPayoffJournal (old stub) with inline
        // createAndPost mirroring JP4 template's JE structure.
        // Payment rows are already updated above — JP4 template cannot be called
        // directly here because it also creates Payment rows (duplicate conflict).
        // JE accounts mirror EarlyPayoffJP4Template.execute() spec §6.4.
        {
          const ep0 = new Decimal(0);
          const epUnpaid = installmentSnapshots.length;
          const epContract = await tx.contract.findUniqueOrThrow({ where: { id } });
          const epUnpaidD = new Decimal(epUnpaid);
          const epTotal = new Decimal(epContract.totalMonths);
          const epFinanced = new Decimal(epContract.financedAmount.toString());
          const epCommission = epContract.storeCommission != null
            ? new Decimal(epContract.storeCommission.toString())
            : epFinanced.times('0.10').toDecimalPlaces(2);
          const epInterest = new Decimal(epContract.interestTotal.toString());
          const epGrossExclVat = epFinanced.plus(epCommission).plus(epInterest);
          const epVat = epContract.vatAmount != null
            ? new Decimal(epContract.vatAmount.toString())
            : epGrossExclVat.times('0.07').toDecimalPlaces(2);
          const epInstallmentExclVat = epGrossExclVat.div(epTotal).toDecimalPlaces(2, Decimal.ROUND_DOWN);
          const epInterestPerInst = epInterest.div(epTotal).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
          const epVatPerInst = epVat.div(epTotal).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
          const epRemainingGross = epInstallmentExclVat.times(epUnpaidD);
          const epRemainingDeferredInterest = epInterestPerInst.times(epUnpaidD);
          const epRemainingDeferredVat = epVatPerInst.times(epUnpaidD);
          const epDiscount = epRemainingDeferredInterest
            .times(new Decimal(quote.discountPct))
            .div(100)
            .toDecimalPlaces(2);
          const epSettlement = epRemainingGross.minus(epDiscount).plus(epRemainingDeferredVat);

          await this.journalAutoService.createAndPost(
            {
              description: `ปิดยอดก่อนกำหนด — สัญญา ${freshContract.contractNumber} (${epUnpaid} งวดคงเหลือ)`,
              reference: `${id}:early-payoff`,
              metadata: {
                tag: 'JP4',
                flow: 'early-payoff',
                contractId: id,
                unpaidInstallments: epUnpaid,
                discount: epDiscount.toFixed(2),
                interestDiscountPercent: quote.discountPct,
              },
              lines: [
                { accountCode: '11-1101', dr: epSettlement, cr: ep0, description: `รับ ${epSettlement.toFixed(2)} ฿ ปิดยอด` },
                { accountCode: '11-2106', dr: epRemainingDeferredInterest, cr: ep0, description: 'ยกเลิกรายได้รอตัดบัญชี-ดอกเบี้ย' },
                { accountCode: '21-2102', dr: epRemainingDeferredVat, cr: ep0, description: 'ล้างภาษีขายรอเรียกเก็บ' },
                { accountCode: '52-1106', dr: epDiscount, cr: ep0, description: 'ส่วนลดดอกเบี้ย-ปิดยอดก่อนกำหนด' },
                { accountCode: '11-2101', dr: ep0, cr: epRemainingGross, description: 'ล้างลูกหนี้ Gross (excl. VAT)' },
                { accountCode: '11-2105', dr: ep0, cr: epRemainingDeferredVat, description: 'ล้างลูกหนี้ภาษีขายรอฯ' },
                { accountCode: '41-1101', dr: ep0, cr: epRemainingDeferredInterest, description: 'รับรู้รายได้ดอกเบี้ย' },
                { accountCode: '21-2101', dr: ep0, cr: epRemainingDeferredVat, description: 'ภาษีขาย ภ.พ.30 ถึงกำหนด' },
              ],
            },
            tx,
          );
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

    return { ...quote, status: 'EARLY_PAYOFF', paidDate };
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
