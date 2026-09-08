import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRepossessionDto, UpdateRepossessionDto, REPOSSESSION_RETURN_REASONS } from './dto/create-repossession.dto';
import { ConditionGrade, RepossessionStatus, ProductStatus } from '@prisma/client';
import { d, dAdd, dSub } from '../../utils/decimal.util';
import { computePayoffQuote } from '../contracts/compute-payoff-quote';
import { JournalAutoService } from '../journal/journal-auto.service';
import {
  RepossessionJP5Template,
  RepossessionJePreview,
} from '../journal/cpa-templates/repossession-jp5.template';
import { RefundPayoutTemplate } from '../journal/cpa-templates/refund-payout.template';
import { RefundWaiveTemplate } from '../journal/cpa-templates/refund-waive.template';
import { TradeInValuationService } from '../trade-in/services/trade-in-valuation.service';
import { TradeInLifecycleService } from '../trade-in/services/trade-in-lifecycle.service';
import { ShopCollectShopLegs } from '../journal/cpa-templates/shop-collect-shop-legs.template';
import { shopCollectTypedBalance } from '../interco-settlement/interco-typed-balance';
import { CreditNoteDocumentService } from '../receipts/services/credit-note-document.service';
import { CreditNoteDeliveryService } from '../receipts/services/credit-note-delivery.service';
import { Decimal } from '@prisma/client/runtime/library';
import { validatePeriodOpen } from '../../utils/period-lock.util';
import { isFutureBkkDay, bkkYearMonth } from '../../utils/date.util';
import { getBranchScope } from '../auth/branch-access.util';
import { syncPriceRowsFromColumns } from '../../utils/product-price-sync.util';
import { countPhotoAngles } from '../quality-control/photo-angles.util';

/** Authenticated request user — service-level branch scoping (BranchGuard delegates to us). */
export type RequestUser = { id: string; role?: string; branchId?: string | null };

const TWO_DP = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

// Valid status transitions for repossession workflow
// 2026-09-05: "ขายแล้ว" ตั้งด้วยมือไม่ได้อีกต่อไป — ขายเครื่องยึดผ่าน POS แล้ว
// SaleWriterService.closeRepossessionOnSale ปิดรายการให้เอง (พร้อมราคาขายจริง + JE ฝั่ง SHOP)
const VALID_TRANSITIONS: Record<string, string[]> = {
  REPOSSESSED: ['UNDER_REPAIR', 'READY_FOR_SALE'],
  UNDER_REPAIR: ['READY_FOR_SALE'],
  READY_FOR_SALE: [],
};

/** ราคาเดียว (2026-09-05): มีค่าเมื่อส่งราคาประเมินมาเท่านั้น — ไม่มี 'MARKET' อีกต่อไป */
type MarketValueSource = 'APPRAISAL' | null;

/** ยึดได้ไหม ณ ตอน preview — สถานะสัญญา + strict mode (กติกาเดียวกับ create()) */
/** ข้อความด่านยึดที่ preview (`eligibility`) และ `create()` ต้องใช้ตัวเดียวกัน (review 2026-09-05) */
export const ZERO_OUTSTANDING_MSG =
  'สัญญานี้ไม่มียอดค้างชำระ — ผ่อนครบแล้วเครื่องเป็นของลูกค้า ยึดคืนไม่ได้ (ถ้ายอดค้างหายเพราะข้อมูลผิด ให้ตรวจงวดชำระของสัญญาก่อน)';
export const RE_REPOSSESSION_MSG =
  'เครื่องนี้เคยถูกยึดคืนมาแล้ว — ระบบรองรับการยึดเครื่องเดียวกันได้ครั้งเดียว (แจ้งผู้ดูแลระบบ)';

export interface RepossessionEligibility {
  canRepossess: boolean;
  reason: string | null;
}

/** ราคากลางแนะนำจากตารางรับซื้อมือสอง สำหรับเกรดที่เลือกบนหน้ายึด (preview-only) */
export interface RepossessionValuationHint {
  grade: string;
  found: boolean;
  suggestedPrice: number | null;
  note: string | null;
}

@Injectable()
export class RepossessionsService {
  private readonly logger = new Logger(RepossessionsService.name);

  constructor(
    private prisma: PrismaService,
    private journalAutoService: JournalAutoService,
    private repossessionJP5Template: RepossessionJP5Template,
    private refundPayoutTemplate: RefundPayoutTemplate,
    private refundWaiveTemplate: RefundWaiveTemplate,
    private creditNoteDocumentService: CreditNoteDocumentService,
    private cnDeliveryService: CreditNoteDeliveryService,
  ) {}

  /** ตารางรับซื้อมือสอง — สร้างภายในเพราะพึ่งแค่ PrismaService (ไม่แตะ constructor ที่มี 4 จุดสร้างใน spec) */
  private readonly valuationService = new TradeInValuationService(this.prisma);

  /** ขาคู่ฝั่ง SHOP ของการยึด (2026-09-05) — สร้างภายในด้วยเหตุผลเดียวกับ valuationService */
  private readonly shopLegs = new ShopCollectShopLegs(this.journalAutoService);

  /** ราคาประเมินต่างจากตารางรับซื้อเกินสัดส่วนนี้ → ต้องระบุเหตุผลในหมายเหตุ (ตัวเลขชุดเดียวกับหน้ารับซื้อ ±15%) */
  /** ±15% — ชุดเดียวกับหน้ารับซื้อ (`TradeInLifecycleService.PRICE_CEILING_RATIO` = 1.15) */
  static readonly TABLE_DEVIATION_LIMIT = new Prisma.Decimal(
    TradeInLifecycleService.PRICE_CEILING_RATIO,
  ).minus(1);

  /**
   * ราคาตารางรับซื้อของเครื่องนี้ที่เกรดที่เลือก (null = ไม่มีในตาราง / ค้นไม่ได้).
   * อ่านอย่างเดียว ล้มเหลวต้องไม่ล้มการยึด — ตารางเป็นตัวช่วย ไม่ใช่ด่านบังคับ
   */
  private async lookupTableBase(
    product: { brand: string | null; model: string | null; storage: string | null },
    grade: string,
  ): Promise<RepossessionValuationHint | null> {
    if (!product.brand || !product.model) return null;
    try {
      const v = await this.valuationService.lookupValuation(
        product.brand,
        product.model,
        product.storage ?? '',
        grade,
      );
      return { grade, found: v.found, suggestedPrice: v.suggestedPrice, note: v.note };
    } catch (err) {
      this.logger.warn(
        `valuation lookup failed (${product.brand} ${product.model} ${grade}): ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  async findAll(
    filters: { status?: string; branchId?: string; page?: number; limit?: number },
    user?: RequestUser,
  ) {
    const where: Record<string, unknown> = { deletedAt: null };

    if (filters.status) {
      where.status = filters.status;
    }

    const scope = getBranchScope(user);
    if (user && !scope.all) {
      // Branch-scoped role (BM) — บังคับสาขาตัวเอง ไม่สน branchId จาก client
      if (!scope.branchId) {
        return { data: [], total: 0, page: 1, limit: filters.limit || 20, totalPages: 0 };
      }
      where.contract = { branchId: scope.branchId };
    } else if (filters.branchId) {
      where.contract = { branchId: filters.branchId };
    }

    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(200, Math.max(1, filters.limit || 20));

    const [data, total] = await Promise.all([
      this.prisma.repossession.findMany({
        where,
        include: {
          contract: {
            select: {
              id: true,
              contractNumber: true,
              customer: { select: { id: true, name: true, phone: true } },
              branch: { select: { id: true, name: true } },
              sellingPrice: true,
              financedAmount: true,
            },
          },
          product: {
            select: { id: true, name: true, brand: true, model: true, imeiSerial: true, status: true },
          },
          appraisedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.repossession.count({ where }),
    ]);

    // Phase 3 Task 6 — batch-attach the ใบลดหนี้ (CN) auto-issued at JP5
    // repossession time (CreditNoteDocumentService.issueForContract, source
    // REPOSSESSION), so RepossessionsPage can render a "ใบลดหนี้"/resend
    // action without a per-row Receipt lookup. Two small batched queries
    // (never per-row) scoped to just the contracts on this page.
    const contractIds = data.map((r) => r.contract.id).filter(Boolean);
    const receiptByContractId = new Map<
      string,
      { id: string; receiptNumber: string; contractId: string }
    >();
    if (contractIds.length) {
      const receipts = await this.prisma.receipt.findMany({
        where: { contractId: { in: contractIds }, cnSource: 'REPOSSESSION', deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, receiptNumber: true, contractId: true },
      });
      for (const r of receipts) {
        if (r.contractId && !receiptByContractId.has(r.contractId)) {
          receiptByContractId.set(r.contractId, r);
        }
      }
    }
    const cnReceiptIds = [...receiptByContractId.values()].map((r) => r.id);
    const lastStatusByReceiptId = new Map<string, string>();
    if (cnReceiptIds.length) {
      const logs = await this.prisma.notificationLog.findMany({
        where: { category: 'CREDIT_NOTE', relatedId: { in: cnReceiptIds } },
        orderBy: { createdAt: 'desc' },
        select: { relatedId: true, status: true },
      });
      for (const log of logs) {
        if (log.relatedId && !lastStatusByReceiptId.has(log.relatedId)) {
          lastStatusByReceiptId.set(log.relatedId, log.status);
        }
      }
    }
    // ยอด 11-2107 SHOP_COLLECT คงค้างต่อสัญญา (2026-09-05) — ปุ่ม "รับโอนหน้าร้าน" โชว์เฉพาะ
    // แถวที่ยังมียอดให้ล้าง (เดิมโชว์ทุกแถวแล้วไป 400 ตอนกด). helper เดียวกับ guard ตอนยกเลิกสัญญา.
    const outstandingByContract = new Map<string, Prisma.Decimal>(
      await Promise.all(
        contractIds.map(
          async (cid) => [cid, await shopCollectTypedBalance(this.prisma, cid)] as const,
        ),
      ),
    );
    // "รอถ่ายรูป n/6" บนแถวพร้อมขาย (2026-09-07) — นับมุมจากตารางรูป ไม่โหลด base64
    const photoAngles = await countPhotoAngles(
      this.prisma,
      data.map((r) => r.product.id),
    );
    const dataWithCn = data.map((r) => {
      const cn = receiptByContractId.get(r.contract.id);
      return {
        ...r,
        product: { ...r.product, photoAngles: photoAngles.get(r.product.id) ?? 0 },
        shopCollectOutstanding: (
          outstandingByContract.get(r.contract.id) ?? new Prisma.Decimal(0)
        ).toFixed(2),
        creditNote: cn
          ? {
              receiptId: cn.id,
              receiptNumber: cn.receiptNumber,
              lastDeliveryStatus: lastStatusByReceiptId.get(cn.id) ?? null,
            }
          : null,
      };
    });

    return { data: dataWithCn, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Preview repossession P&L calculation for a contract.
   * Used by frontend to show live breakdown before creating.
   */
  async previewCalculation(
    contractId: string,
    options: {
      appraisalPrice?: number;
      discountPct?: number;
      customerRefundEnabled?: boolean;
      depositAccountCode?: string;
      collectedByShop?: boolean;
      /** เกรดสภาพ A-D — ถ้าส่งมา preview จะค้นตารางรับซื้อ (TradeInValuation) ให้เป็นราคากลางแนะนำ */
      conditionGrade?: string;
    },
    user?: RequestUser,
  ) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            brand: true,
            model: true,
            storage: true,
            costPrice: true,
            status: true,
          },
        },
        customer: { select: { id: true, name: true, phone: true } },
        payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
      },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    const scope = getBranchScope(user);
    if (user && !scope.all) {
      // ตอบ 404 เดียวกับ "ไม่มีอยู่" — ไม่ยืนยันว่ามีสัญญาของสาขาอื่น
      if (!scope.branchId || contract.branchId !== scope.branchId) {
        throw new NotFoundException('ไม่พบสัญญา');
      }
    }

    if (!contract.totalMonths || contract.totalMonths <= 0) {
      throw new BadRequestException('ข้อมูลสัญญาผิดพลาด: จำนวนงวดต้องมากกว่า 0');
    }

    // ยึดได้ไหม (2026-09-05): กติกาชุดเดียวกับ create() — บอกล่วงหน้าบนจอ แทนปล่อยให้กด
    // ยืนยันแล้วชน 400 (ปุ่ม "คืนเครื่อง" ในวิซาร์ดรับชำระเปิด overlay นี้กับสัญญา ACTIVE/OVERDUE/
    // DEFAULT ซึ่งใต้ strict mode ยึดไม่ได้เลย)
    const strictConfig = await this.prisma.systemConfig.findUnique({
      where: { key: 'jp5_require_terminated_status' },
    });
    const requireTerminated = strictConfig?.value === 'true';
    let eligibility: RepossessionEligibility = { canRepossess: true, reason: null };
    if (!['TERMINATED', 'DEFAULT', 'OVERDUE'].includes(contract.status)) {
      eligibility = {
        canRepossess: false,
        reason:
          'สัญญานี้ไม่อยู่ในสถานะที่ยึดคืนได้ — ต้องบอกเลิกสัญญาแล้ว (TERMINATED) หรือ DEFAULT/OVERDUE',
      };
    } else if (requireTerminated && contract.status !== 'TERMINATED') {
      eligibility = {
        canRepossess: false,
        reason:
          'ต้องส่งหนังสือบอกเลิกสัญญาก่อนยึดเครื่อง — เมื่อสัญญาเป็น "บอกเลิกแล้ว" ให้กดยึดจากหน้ายึดคืน รายการ "รอยึดเครื่อง"',
      };
    }
    if (eligibility.canRepossess && contract.product.status === 'REPOSSESSED') {
      eligibility = { canRepossess: false, reason: 'สินค้านี้ถูกยึดคืนแล้ว' };
    }
    if (eligibility.canRepossess) {
      // Repossession.productId @unique — เครื่องที่เคยมีแถวยึด (ยึด→ขายต่อ→ผ่อนใหม่→ค้างอีก) บันทึกซ้ำไม่ได้
      const priorRepossession = await this.prisma.repossession.findFirst({
        where: { productId: contract.productId, deletedAt: null },
        select: { id: true },
      });
      if (priorRepossession) eligibility = { canRepossess: false, reason: RE_REPOSSESSION_MSG };
    }

    // Use Prisma.Decimal throughout — chained Math.round on JS numbers
    // accumulates float drift on long installment plans (24+ months) and
    // can show users the wrong refund/profit by a few baht.
    let totalPaid = new Prisma.Decimal(0);
    // ยอดลูกหนี้คงค้างตามบัญชี (สูตรเดียวกับ create()) — ใช้ gate JOURNAL AUTO
    // ให้ตรงกับเงื่อนไขที่ create() จะลง JE จริง (outstanding > 0) เท่านั้น
    let outstandingForJe = new Prisma.Decimal(0);
    let remainingMonths = 0;
    for (const p of contract.payments) {
      if (p.status !== 'PAID') {
        remainingMonths += 1;
        const lateFee = p.lateFeeWaived ? new Prisma.Decimal(0) : new Prisma.Decimal(p.lateFee);
        outstandingForJe = outstandingForJe.add(p.amountDue).sub(p.amountPaid).add(lateFee);
      }
      totalPaid = totalPaid.add(p.amountPaid);
    }
    // ไม่มียอดค้าง = ผ่อนครบ เครื่องเป็นของลูกค้า — กติกาเดียวกับ create() (review 2026-09-05)
    if (eligibility.canRepossess && outstandingForJe.lte(0)) {
      eligibility = { canRepossess: false, reason: ZERO_OUTSTANDING_MSG };
    }

    // ยอดปิดสัญญา = สูตรเดียวกับปิดสัญญาก่อนกำหนด (computePayoffQuote — owner
    // 2026-07-20: ยอดยึดคืนต้องตรงกับ JP4 quote เสมอ). จุดที่เคยเพี้ยน: สูตรเก่า
    // หักส่วนลดจากฐาน ex-VAT และเอาค่าปรับไปหาร 1.07 + โดนส่วนลดด้วย
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
      discountPctInput: options.discountPct,
      payments: contract.payments,
    });
    const closingAmount = new Prisma.Decimal(quote.totalPayoff);
    // ราคาเดียว (2026-09-05): ราคาที่ใช้คำนวณกำไร/ขาดทุน = ราคาประเมินเท่านั้น — ตรงกับ create()
    // ทุกไบต์ (create ไม่อ่าน marketValue จาก DTO). ไม่มีราคาประเมิน = ยังคำนวณไม่ได้ (source null);
    // ไม่ถอยไป costPrice — ต้นทุนซื้อเข้าไม่ใช่ราคากลาง เคยทำให้จอโชว์เลขที่ไม่มีวันถูกบันทึกจริง
    const marketValueSource: MarketValueSource =
      options.appraisalPrice != null ? 'APPRAISAL' : null;
    const marketValue = new Prisma.Decimal(options.appraisalPrice ?? 0);

    // ราคากลางแนะนำจากตารางรับซื้อมือสอง (ยี่ห้อ+รุ่น+ความจุ+เกรด) — ตารางเดียวกับ
    // หน้ารับซื้อ (TradeInValuationService.lookupValuation). ไม่พบ = ให้พนักงานกรอกเอง.
    // preview-only: ล้มเหลวต้องไม่ล้มทั้ง response (pattern เดียวกับ journalPreview)
    const valuation = options.conditionGrade
      ? await this.lookupTableBase(contract.product, options.conditionGrade)
      : null;
    // คำตัดสินเจ้าของ 2026-09-05: ไม่มีเงินคืนส่วนต่างให้ลูกค้า (ปพพ. ม.574 ไม่บังคับคืน) —
    // supersede คำสั่ง 2026-08-08 ข้อ 2; options.customerRefundEnabled ถูกละเลยใน preview และ
    // create() ปฏิเสธเมื่อส่ง true. กำไร/ขาดทุนบนจอ = ราคาประเมิน − ยอดปิดสัญญา
    const customerRefund = new Prisma.Decimal(0);
    const profitLoss = TWO_DP(marketValue.sub(closingAmount));
    // ถังพักงวดสุดท้ายที่ยอดปิด "ดูดซับจริง" — clamp ด้วยยอดในถังจริงอีกชั้น
    const parkReliefPreview = Prisma.Decimal.max(
      0,
      Prisma.Decimal.min(
        d(quote.rescheduleAdvanceApplied),
        d(contract.rescheduleAdvanceBalance ?? 0),
      ),
    );

    // JOURNAL AUTO preview (owner 2026-07-20) — dry-run JP5 ผ่าน buildJe ตัวเดียว
    // กับตอน post จริงใน create() จึงตรงกันเสมอ. Mirror create(): repoValue =
    // appraisalPrice (ไม่ใช่ marketValue), deposit = 11-2107 เมื่อตั้งลูกหนี้-
    // หน้าร้าน ไม่งั้น KBank 11-1201. Preview fail ต้องไม่ล้มทั้ง response.
    let journalPreview: RepossessionJePreview | null = null;
    if (outstandingForJe.greaterThan(0)) {
      const previewDepositCode = options.collectedByShop
        ? '11-2107'
        : (options.depositAccountCode ?? '11-1201');
      try {
        journalPreview = await this.repossessionJP5Template.previewJe({
          contractId,
          depositAccountCode: previewDepositCode,
          repossessionValue: new Prisma.Decimal(options.appraisalPrice ?? 0),
          collectedByShop: options.collectedByShop === true,
          customerRefund: customerRefund.gt(0) ? customerRefund : undefined,
          // ถังพักงวดสุดท้ายที่ยอดปิดดูดซับจริง → Dr 21-1103 (คำสั่งเจ้าของ
          // 2026-08-16 §จุดหัก 3). ต้องส่งทั้ง preview และ create ไม่งั้น
          // preview ≠ posted
          parkRelief: parkReliefPreview.gt(0) ? parkReliefPreview : undefined,
        });
      } catch (err) {
        this.logger.warn(
          `JP5 preview failed for contract ${contractId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    // Internally calculated with Decimal for precision; return as numbers
    // since frontend uses .toLocaleString() and numeric comparisons.
    // The Decimal accumulators above guarantee no float drift; the .toNumber()
    // at the end is safe because each value is already rounded to 2 decimals.
    return {
      contract: {
        id: contract.id,
        contractNumber: contract.contractNumber,
        customer: contract.customer,
        product: {
          name: contract.product.name,
          brand: contract.product.brand,
          model: contract.product.model,
        },
        totalMonths: contract.totalMonths,
        monthlyPayment: Number(contract.monthlyPayment),
        sellingPrice: Number(contract.sellingPrice),
        financedAmount: Number(contract.financedAmount),
        storeCommission: Number(contract.storeCommission || 0),
      },
      calculation: {
        remainingMonths,
        totalPaid: TWO_DP(totalPaid).toNumber(),
        outstandingBalance: quote.remainingBalance,
        principalExVat: quote.remainingExVat,
        financeCost: quote.financeCost,
        remainingCost: quote.remainingCost,
        grossProfit: quote.grossProfit,
        discountPct: quote.discountPercent,
        discountAmount: quote.discountAmount,
        unpaidLateFees: quote.unpaidLateFees,
        rescheduleAdvanceApplied: quote.rescheduleAdvanceApplied,
        closingAmount: closingAmount.toNumber(),
        marketValue: TWO_DP(marketValue).toNumber(),
        marketValueSource,
        customerRefundEnabled: false,
        customerRefund: customerRefund.toNumber(),
        profitLoss: profitLoss.toNumber(),
      },
      journalPreview,
      valuation,
      eligibility,
    };
  }

  async findOne(id: string, user?: RequestUser) {
    const repo = await this.prisma.repossession.findUnique({
      where: { id },
      include: {
        contract: {
          include: {
            customer: true,
            branch: { select: { id: true, name: true } },
            payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
          },
        },
        product: { include: { prices: true } },
        appraisedBy: { select: { id: true, name: true } },
      },
    });
    if (!repo) throw new NotFoundException('ไม่พบข้อมูลการยึดคืน');

    const scope = getBranchScope(user);
    if (user && !scope.all) {
      // ตอบ 404 เดียวกับ "ไม่มีอยู่" — ไม่ยืนยันว่ามี record ของสาขาอื่น
      if (!scope.branchId || repo.contract.branchId !== scope.branchId) {
        throw new NotFoundException('ไม่พบข้อมูลการยึดคืน');
      }
    }

    return repo;
  }

  /**
   * Create repossession record and update contract/product statuses
   */
  async create(dto: CreateRepossessionDto, userId: string) {
    if (dto.returnReason != null && !Object.prototype.hasOwnProperty.call(REPOSSESSION_RETURN_REASONS, dto.returnReason)) {
      throw new BadRequestException('กรุณาเลือกเหตุผลคืนเครื่องที่ถูกต้อง');
    }
    if (dto.returnReason === 'OTHER' && !dto.notes?.trim()) {
      throw new BadRequestException('กรุณาระบุรายละเอียดเหตุผลคืนเครื่อง');
    }
    // คำตัดสินเจ้าของ 2026-09-05: ไม่มีเงินคืนส่วนต่างให้ลูกค้า — ปฏิเสธตรงๆ แทนละเลยเงียบๆ
    if (dto.customerRefundEnabled) {
      throw new BadRequestException(
        'ระบบไม่มีเงินคืนส่วนต่างให้ลูกค้าแล้ว (คำตัดสินเจ้าของ 2026-09-05) — กรุณาเอาตัวเลือก "คืนเงินส่วนต่างให้ลูกค้า" ออก',
      );
    }
    // Validate condition grade
    const validGrades = ['A', 'B', 'C', 'D'];
    if (!validGrades.includes(dto.conditionGrade)) {
      throw new BadRequestException(`เกรดสภาพต้องเป็น ${validGrades.join(', ')}`);
    }

    // วันที่รับเงิน/ลงบัญชี (mirror JP4 early payoff): drives the JP5 JE
    // entryDate + period-lock guard. Backdate allowed while the period is
    // open; future dates rejected on BKK calendar days.
    const paymentDate = dto.paymentDate ? new Date(dto.paymentDate) : new Date();
    if (isFutureBkkDay(paymentDate)) {
      throw new BadRequestException('วันที่รับเงินต้องไม่เป็นวันในอนาคต');
    }
    // คำสั่งเจ้าของ 2026-08-08 (ข้อ 3): ใบลดหนี้ (CN) ออกวันที่/เลขที่เดือนปัจจุบันเสมอ
    // → JE ต้องอยู่เดือนเดียวกัน ไม่งั้นงวด ภ.พ.30 ของ VAT reversal กับเอกสารแยกกัน
    if (bkkYearMonth(paymentDate) !== bkkYearMonth(new Date())) {
      throw new BadRequestException(
        'วันที่รับเงินย้อนหลังได้เฉพาะภายในเดือนปัจจุบัน (ใบลดหนี้ต้องอยู่งวดภาษีเดียวกับ JE)',
      );
    }
    // Period-lock guard (mirror JP4 J3): cannot book a repossession JE into a
    // closed (FINANCE) accounting period. Repossessions previously had no
    // guard at all — JEs always landed on "now", which masked the gap.
    // Missing FINANCE row must fail LOUD (mirror resolveFinanceCompanyId in
    // contract-payment.service) — validatePeriodOpen silently no-ops without
    // a companyId, which would quietly disable the guard this exists to add.
    const financeCompany = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    if (!financeCompany) {
      throw new InternalServerErrorException('FINANCE company not configured');
    }
    await validatePeriodOpen(this.prisma, paymentDate, financeCompany.id);
    // ขาคู่ SHOP (2026-09-05) โพสต์ในสมุด SHOP — ต้องมีบริษัท + งวดบัญชีฝั่งนั้นเปิดด้วย
    const shopCompany = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'SHOP', deletedAt: null },
      select: { id: true },
    });
    if (!shopCompany) {
      throw new InternalServerErrorException('SHOP company not configured');
    }
    await validatePeriodOpen(this.prisma, paymentDate, shopCompany.id);

    const result = await this.prisma
      .$transaction(async (tx) => {
        const contract = await tx.contract.findUnique({
          where: { id: dto.contractId },
          include: {
            product: true,
            // mirror previewCalculation — แถว soft-deleted ห้ามเข้าสูตรยอดปิด/JP5 gate
            payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
          },
        });

        if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
        // CPA Manual Termination Policy (ปพพ.386 + termination_policy.docx):
        //   ยึดเครื่อง (JP5) ต้องมีหนังสือบอกเลิกสัญญาดิสแพตช์แล้ว = status='TERMINATED'
        //   หากยังไม่ได้ส่งหนังสือ → ห้ามยึด · ต้องสร้าง CONTRACT_TERMINATION_60D letter
        //   ผ่าน /api/contract-letters/:id/dispatch ก่อน
        // Allow TERMINATED (after letter dispatch) · DEFAULT/OVERDUE for legacy compat
        // (existing contracts pre-Manual-Termination workflow may still be DEFAULT)
        if (!['TERMINATED', 'DEFAULT', 'OVERDUE'].includes(contract.status)) {
          throw new BadRequestException(
            'สัญญานี้ไม่อยู่ในสถานะที่สามารถยึดคืนได้ — ต้องเป็น TERMINATED (ส่งหนังสือบอกเลิกแล้ว) หรือ DEFAULT/OVERDUE',
          );
        }
        // Strict mode: require TERMINATED (letter dispatched) — flagged via SystemConfig
        const strictTerminationConfig = await tx.systemConfig.findUnique({
          where: { key: 'jp5_require_terminated_status' },
        });
        const requireTerminated = strictTerminationConfig?.value === 'true';
        if (requireTerminated && contract.status !== 'TERMINATED') {
          throw new BadRequestException(
            'JP5 strict mode: ต้องส่งหนังสือบอกเลิกสัญญา (CONTRACT_TERMINATION_60D) ก่อนยึดเครื่อง — ' +
              'เมื่อสัญญาเป็น TERMINATED แล้ว ให้กดยึดเครื่องจากหน้ายึดคืน (/repossessions) รายการ "รอยึดเครื่อง"',
          );
        }

        // Check if product is already repossessed
        if (contract.product.status === 'REPOSSESSED') {
          throw new BadRequestException('สินค้านี้ถูกยึดคืนแล้ว');
        }
        // Repossession.productId @unique — loop ยึด→ขายต่อ→ผ่อนใหม่→ยึดซ้ำ ชนด่านนี้ก่อน JP5 (ไม่ใช่ P2002 กลางทาง)
        const priorRepossession = await tx.repossession.findFirst({
          where: { productId: contract.productId, deletedAt: null },
          select: { id: true },
        });
        if (priorRepossession) {
          throw new ConflictException(RE_REPOSSESSION_MSG);
        }

        if (!contract.totalMonths || contract.totalMonths <= 0) {
          throw new BadRequestException('ข้อมูลสัญญาผิดพลาด: จำนวนงวดต้องมากกว่า 0');
        }

        // Calculate outstanding balance (รวมค่าปรับ) — ใช้เฉพาะ gate JP5 + audit
        // trail/return (ยอดลูกหนี้คงค้างตามบัญชีจริง) ไม่ใช่ฐานคำนวณยอดปิด
        let outstandingBalance = new Prisma.Decimal(0);
        let totalPaid = new Prisma.Decimal(0);
        let remainingMonths = 0;
        for (const p of contract.payments) {
          if (p.status !== 'PAID') {
            const lateFee = p.lateFeeWaived ? new Prisma.Decimal(0) : d(p.lateFee);
            outstandingBalance = dAdd(
              outstandingBalance,
              dSub(dAdd(d(p.amountDue), lateFee), d(p.amountPaid)),
            );
            remainingMonths += 1;
          }
          totalPaid = dAdd(totalPaid, d(p.amountPaid));
        }

        // review 2026-09-05: ไม่มียอดค้าง = ผ่อนครบ เครื่องเป็นของลูกค้า (ปพพ. ม.572) — ยึดไม่ได้
        // และห้ามปล่อยให้เครื่องไหลเข้าสต็อก SHOP โดยไม่มีใบรับเข้า (JP5+intake ไม่โพสต์ → S11-2002
        // จะติดลบตอนขายต่อ). preview.eligibility ใช้กติกาเดียวกัน
        if (outstandingBalance.lte(0)) {
          throw new BadRequestException(ZERO_OUTSTANDING_MSG);
        }

        // ─── ยอดปิดสัญญา = สูตรเดียวกับปิดสัญญาก่อนกำหนด (computePayoffQuote) ───
        // owner 2026-07-20: ยอดยึดคืนต้องตรงกับ JP4 quote เสมอ — ต้องตรงกับ
        // previewCalculation ด้านบนเสมอด้วย (เรียกฟังก์ชันเดียวกัน)
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
          discountPctInput: dto.discountPct,
          payments: contract.payments,
        });
        const financeCost = new Prisma.Decimal(quote.financeCost);
        const remainingCost = new Prisma.Decimal(quote.remainingCost);
        const discountPct = quote.discountPercent;
        const discountAmount = new Prisma.Decimal(quote.discountAmount);
        const closingAmount = new Prisma.Decimal(quote.totalPayoff);
        // ราคาเดียว (คำตัดสินเจ้าของ 2026-09-05): ราคาประเมิน = ราคาที่หน้าร้านรับเครื่อง = ยอดที่ลงบัญชี.
        // ตารางรับซื้อเป็นตัวเทียบ: เก็บ snapshot ไว้ในคอลัมน์ marketValue (ไม่มีในตาราง = ราคาประเมิน)
        // และบังคับเหตุผลเมื่อต่างจากตารางเกิน ±15% (ตัวเลขชุดเดียวกับหน้ารับซื้อ)
        const appraisal = d(dto.appraisalPrice);
        const table = await this.lookupTableBase(contract.product, dto.conditionGrade);
        const tableBase =
          table?.found && table.suggestedPrice != null ? d(table.suggestedPrice) : null;
        if (tableBase && tableBase.gt(0)) {
          const deviation = appraisal.sub(tableBase).div(tableBase).abs();
          if (deviation.gt(RepossessionsService.TABLE_DEVIATION_LIMIT) && !dto.notes?.trim()) {
            throw new BadRequestException(
              `ราคาประเมิน ${appraisal.toFixed(2)} ฿ ต่างจากตารางรับซื้อ (เกรด ${dto.conditionGrade}: ${tableBase.toFixed(2)} ฿) ` +
                `${deviation.mul(100).toDecimalPlaces(0)}% เกิน 15% — กรุณาระบุเหตุผลในหมายเหตุ`,
            );
          }
        }
        const marketValue = tableBase ?? appraisal;
        const customerRefund = new Prisma.Decimal(0);
        // กำไร/ขาดทุนบนจอ = ราคาประเมิน − ยอดปิดสัญญา (ต้องตรงกับ previewCalculation เสมอ)
        const profitLoss = TWO_DP(appraisal.sub(closingAmount));
        // ถังพักงวดสุดท้าย (คำสั่งเจ้าของ 2026-08-16 §จุดหัก 3): ยอดปิดหักเงินก้อนนี้
        // ให้ลูกค้าไปแล้ว → ต้องปลดหนี้ 21-1103 จริงใน JE ด้วย ไม่งั้นเครดิตผีค้าง
        // บนสัญญาที่ยึดไปแล้ว + plug ขาดทุน/กำไรเพี้ยน (บั๊ก C-3). ยอดที่ปลด = ยอดที่
        // ยอดปิดดูดซับจริง (ส่วนที่ส่วนลดกินไปคงค้างในถังตามเดิม), clamp ด้วยยอดในถัง
        const parkRelief = Prisma.Decimal.max(
          0,
          Prisma.Decimal.min(
            d(quote.rescheduleAdvanceApplied),
            d(contract.rescheduleAdvanceBalance ?? 0),
          ),
        );

        // Create repossession
        const repossession = await tx.repossession.create({
          data: {
            contractId: dto.contractId,
            productId: contract.productId,
            repossessedDate: new Date(dto.repossessedDate),
            conditionGrade: dto.conditionGrade as ConditionGrade,
            appraisalPrice: dto.appraisalPrice,
            appraisedById: userId,
            repairCost: dto.repairCost || 0,
            resellPrice: dto.resellPrice,
            notes: dto.returnReason
              ? [`เหตุผลคืนเครื่อง: ${REPOSSESSION_RETURN_REASONS[dto.returnReason]}`, dto.notes?.trim()]
                  .filter(Boolean).join('\n')
              : dto.notes,
            status: 'REPOSSESSED',
            marketValue,
            remainingMonths,
            financeCost,
            remainingCost,
            discountPct,
            discountAmount,
            closingAmount,
            customerRefundEnabled: dto.customerRefundEnabled || false,
            customerRefund,
            profitLoss,
          },
        });

        // Update contract status
        await tx.contract.update({
          where: { id: dto.contractId },
          data: { status: 'CLOSED_BAD_DEBT' },
        });

        // Auto bad-debt write-off journal: ตัด HP Receivable ที่เหลือออกจากบัญชี.
        // (Audit finding J4: closes the silent accounting gap where
        // repossessions left outstanding receivable on the books with no
        // balancing entry.)
        // Phase A.4b: replaced createBadDebtWriteOffJournal (old stub) with
        // RepossessionJP5Template. Template handles both loss and gain paths and
        // closes out remaining HP Receivable (spec §6.5).
        // repossessionValue = appraisalValue from dto (amount FINANCE recovers from asset).
        //
        // Wave 1 / Task 3: JP5 ห่อใน outer $transaction พร้อม contract+product
        // status updates. ปพพ.ม.392 — เลิกสัญญาต้องกลับสู่ฐานะเดิม. ก่อนหน้านี้
        // .catch() fire-and-forget ทำให้ contract status commit แต่ JE อาจ fail
        // ลูกหนี้ค้างใน ledger ตลอดกาล. ตอนนี้ ถ้า JE fail ทุกอย่าง rollback.
        let creditNote: { outcome: string; receiptId?: string } | undefined;
        if (outstandingBalance.greaterThan(0)) {
          const repoValue =
            dto.appraisalPrice != null ? new Decimal(String(dto.appraisalPrice)) : new Decimal('0');
          // Owner rule 2026-07-08: direct FINANCE receipt = KBank (11-1201) only.
          // collectedByShop mirrors JP4 early payoff — the shop takes the device
          // (and any money) so FINANCE books Dr 11-2107 ลูกหนี้-หน้าร้าน instead;
          // cleared later via POST /contracts/:id/shop-collect-settlement (the
          // settlement sums 11-2107 lines by metadata.contractId, so JP5 debits
          // are covered by the same endpoint as JP4).
          const depositAccountCode = dto.collectedByShop
            ? '11-2107'
            : (dto.depositAccountCode ?? '11-1201');
          const jp5Result = await this.repossessionJP5Template.execute(
            {
              contractId: dto.contractId,
              depositAccountCode,
              repossessionValue: repoValue,
              collectedByShop: dto.collectedByShop === true,
              postedAt: paymentDate,
              customerRefund: customerRefund.gt(0) ? customerRefund : undefined,
              parkRelief: parkRelief.gt(0) ? parkRelief : undefined,
            },
            tx,
          );

          // ขาคู่ฝั่ง SHOP (คำตัดสินเจ้าของ 2026-09-05 — ปิด "ASYMMETRY ที่รู้ตัว" ต้นทาง JP5):
          // SHOP รับเครื่องเข้าสต็อกมือสองที่ราคาประเมิน คู่กับที่ FINANCE ลง Dr ไปพอดี —
          // ค้างจ่าย (Cr S21-1104 typed SHOP_COLLECT) หรือโอนให้แล้ว (Cr S11-1202). tx เดียวกับ JP5.
          // ราคาประเมิน 0 (DTO ยอมรับ — เครื่องไม่มีมูลค่า) → SHOP รับเครื่องเข้าโดยไม่มีต้นทุน ไม่มีใบรับเข้า
          if (repoValue.gt(0)) {
            await this.shopLegs.postRepossessionIntake(
              {
                contractId: dto.contractId,
                contractNumber: contract.contractNumber,
                productId: contract.productId,
                appraisal: repoValue,
                collectedByShop: dto.collectedByShop === true,
                shopCompanyId: shopCompany.id,
                postedAt: paymentDate,
              },
              tx,
            );
          }

          // ปลดถังพักให้ตรงกับขา Dr 21-1103 ที่ JP5 ลงจริง (template clamp ด้วยยอด
          // GL 21-1103 อีกชั้น จึงต้องอ่านค่าที่ลงจริงกลับมา ไม่ใช่ค่าที่ส่งเข้าไป)
          // d() = defensive: a test double / older stub of the template may return
          // only { entryNo }; 0 relief must never crash the repossession flow.
          const postedParkRelief = d(jp5Result.parkRelief);
          if (postedParkRelief.gt(0)) {
            await tx.contract.update({
              where: { id: dto.contractId },
              data: { rescheduleAdvanceBalance: { decrement: postedParkRelief } },
            });
            await tx.auditLog.create({
              data: {
                userId,
                action: 'RESCHEDULE_ADVANCE_CONSUMED',
                entity: 'contract',
                entityId: dto.contractId,
                newValue: {
                  parkRelief: postedParkRelief.toFixed(2),
                  beforeParkBalance: d(contract.rescheduleAdvanceBalance ?? 0).toFixed(2),
                  afterParkBalance: dSub(
                    d(contract.rescheduleAdvanceBalance ?? 0),
                    postedParkRelief,
                  ).toFixed(2),
                  repossessionId: repossession.id,
                  source: 'REPOSSESSION_PARK_RELIEF',
                },
              },
            });
          }

          // Task 5 (2026-07-26, ECL-per-installment plan §2.4) — JP5 already
          // released any remaining 11-2102 GL balance for this contract back to
          // 51-1103 (see RepossessionJP5Template). Mark the DB-side
          // BadDebtProvision rows REVERSED to match — the contract is
          // derecognized, so there's no more receivable left to provide
          // against. Same convention as BadDebtService.calculateProvisions'
          // "REVERSE stale ACTIVE rows" step.
          await tx.badDebtProvision.updateMany({
            where: { status: 'ACTIVE', contractId: dto.contractId, deletedAt: null },
            data: { status: 'REVERSED' },
          });

          // Mirrors SHOP_COLLECT_PAYOFF — forensic trail that the repossession
          // value is parked as a shop receivable awaiting settlement.
          if (dto.collectedByShop) {
            await tx.auditLog.create({
              data: {
                userId,
                action: 'SHOP_COLLECT_REPOSSESSION',
                entity: 'contract',
                entityId: dto.contractId,
                newValue: {
                  shopReceivable: '11-2107',
                  shopReceivableType: 'SHOP_COLLECT',
                  repossessionValue: repoValue.toFixed(2),
                  repossessionId: repossession.id,
                },
              },
            });
          }

          // Phase 3 Task 3: auto-issue ใบลดหนี้ (CN) for any accrued-unpaid
          // installments written off by JP5 — MUST run inside this same tx
          // (atomic with the JE: throw here rolls back JP5 + status updates
          // too). LINE delivery of the CN is intentionally NOT triggered here
          // (Task 5) — that must happen only after the $transaction commits,
          // or a rollback would hand the customer a link to a receipt that
          // never existed.
          const cnResult = await this.creditNoteDocumentService.issueForContract(
            {
              contractId: dto.contractId,
              source: 'REPOSSESSION',
              sourceJournalEntryNo: jp5Result.entryNo,
              actorUserId: userId,
            },
            tx,
          );
          creditNote = {
            outcome: cnResult.outcome,
            receiptId: cnResult.outcome === 'ISSUED' ? cnResult.receiptId : undefined,
          };
        }

        // Update product status + กรรมสิทธิ์กลับ SHOP (สมุด SHOP ตั้งสต็อกแล้ว) + มือถือกลายเป็นมือสอง
        // (บัญชี S11-2002 / ขายต่อผ่าน POS ต้องลง Cr S11-2002 ไม่ใช่ S11-2001 — 2026-09-05)
        await tx.product.update({
          where: { id: contract.productId },
          data: {
            status: 'REPOSSESSED',
            ownedByCompanyId: shopCompany.id,
            ...(contract.product.category === 'PHONE_NEW'
              ? { category: 'PHONE_USED' as const }
              : {}),
          },
        });

        // Audit log for repossession
        // Wave 3 / Task 4 (W-1): Decimal objects serialize to non-deterministic
        // JSON (`{ s, e, d }`). Convert to fixed-precision strings so audit
        // history remains human-readable and diff-able.
        await tx.auditLog.create({
          data: {
            userId,
            action: 'REPOSSESSION',
            entity: 'repossession',
            entityId: repossession.id,
            newValue: {
              contractId: dto.contractId,
              contractNumber: contract.contractNumber,
              productId: contract.productId,
              conditionGrade: dto.conditionGrade,
              ...(dto.returnReason ? { returnReason: dto.returnReason, returnReasonLabel: REPOSSESSION_RETURN_REASONS[dto.returnReason] } : {}),
              appraisalPrice: dto.appraisalPrice,
              outstandingBalance: outstandingBalance.toFixed(2),
              totalPaid: totalPaid.toFixed(2),
            },
            ipAddress: '',
          },
        });

        this.logger.log(`Repossession created for contract ${contract.contractNumber}`);

        return {
          ...repossession,
          outstandingBalance: outstandingBalance.toNumber(),
          totalPaid: totalPaid.toNumber(),
          loss: outstandingBalance.sub(d(dto.appraisalPrice)).toNumber(),
          creditNote,
        };
      })
      .catch((err: unknown) => {
        // ตาข่ายของ Repossession.productId @unique — ถ้าด่าน findFirst ด้านบนแพ้ race → 409 ไทย ไม่ใช่ raw 500
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException(RE_REPOSSESSION_MSG);
        }
        throw err;
      });

    // Phase 3 Task 5: LINE delivery of the auto-issued CN fires ONLY after the
    // $transaction above has committed — firing it from inside the tx would
    // risk handing the customer a link to a receipt a later rollback erased.
    // Fire-and-forget: never await, never let a delivery failure surface to
    // the caller (RepossessionsController already returned successfully by
    // the time this resolves).
    if (result.creditNote?.outcome === 'ISSUED' && result.creditNote.receiptId) {
      void this.cnDeliveryService
        .deliver(result.creditNote.receiptId)
        .catch((err) => Sentry.captureException(err));
    }

    return result;
  }

  /**
   * Task 2 (คำสั่งเจ้าของ 2026-08-08 ข้อ 2): จ่ายเงินคืนส่วนต่างลูกค้าที่ JP5
   * ตั้งไว้ที่ 21-1107 ตอนยึดเครื่อง — Dr 21-1107 / Cr depositAccountCode.
   * findOne(id, user) ให้ branch scope ฟรี (404 แทน 403 ถ้าข้ามสาขา). ต้อง
   * ติ๊ก "ตั้งลูกหนี้เงินคืน" ไว้ตอนยึดจริง (customerRefundEnabled) ไม่งั้น
   * ไม่มี 21-1107 ให้ล้าง — RefundPayoutTemplate เองก็จะ throw ถ้ายอดคงเหลือ
   * เป็น 0 อยู่แล้ว แต่เช็คตรงนี้ก่อนให้ error message เจาะจงกว่า.
   *
   * I3 (review): period-lock guard — mirror create()'s guard so a refund JE
   * cannot post into a CLOSED FINANCE period. Missing FINANCE row fails LOUD
   * (same pattern as create()) instead of silently no-opping the guard.
   */
  async refundPayment(
    id: string,
    user: RequestUser,
    dto: { depositAccountCode: string; amount: number; requestId?: string },
  ) {
    const repo = await this.findOne(id, user);

    if (!repo.customerRefundEnabled) {
      throw new BadRequestException('ไม่ได้ติ๊กคืนเงินส่วนต่างไว้ตอนยึด');
    }

    const financeCompany = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    if (!financeCompany) {
      throw new InternalServerErrorException('FINANCE company not configured');
    }
    await validatePeriodOpen(this.prisma, new Date(), financeCompany.id);

    const payoutResult = await this.prisma.$transaction(
      async (tx) => {
        const result = await this.refundPayoutTemplate.execute(
          {
            contractId: repo.contractId,
            depositAccountCode: dto.depositAccountCode,
            amount: dto.amount,
            postedById: user.id,
            requestId: dto.requestId,
          },
          tx,
        );

        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'REFUND_PAYOUT',
            entity: 'repossession',
            entityId: id,
            newValue: {
              amount: new Prisma.Decimal(dto.amount).toFixed(2),
              depositAccountCode: dto.depositAccountCode,
              requestId: dto.requestId ?? null,
              deduped: result.deduped,
            },
          },
        });

        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return { success: true, repossessionId: id, ...payoutResult };
  }

  /**
   * คำสั่งเจ้าของ 2026-08-08 เพิ่มเติม: ล้างหนี้ 21-1107 ที่เหลือทั้งหมดเข้ารายได้
   * จากการยึดสินค้า (41-1102) เมื่อเจ้าของตัดสินใจ "ไม่คืนเงิน" ส่วนต่างที่ JP5
   * ตั้งไว้ตอนยึดเครื่อง — Dr 21-1107 / Cr 41-1102. mirror ของ refundPayment
   * ทุกจุด (findOne branch scope → customerRefundEnabled check → FINANCE
   * company resolve → period guard → $transaction Serializable) ต่างกันแค่
   * ไม่มี amount input (เคลียร์ทั้งยอดคงเหลือเสมอ).
   */
  async waiveRefund(id: string, user: RequestUser, dto: { requestId?: string }) {
    const repo = await this.findOne(id, user);

    if (!repo.customerRefundEnabled) {
      throw new BadRequestException('ไม่ได้ติ๊กคืนเงินส่วนต่างไว้ตอนยึด');
    }

    const financeCompany = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    if (!financeCompany) {
      throw new InternalServerErrorException('FINANCE company not configured');
    }
    await validatePeriodOpen(this.prisma, new Date(), financeCompany.id);

    const waiveResult = await this.prisma.$transaction(
      async (tx) => {
        const result = await this.refundWaiveTemplate.execute(
          {
            contractId: repo.contractId,
            postedById: user.id,
            requestId: dto.requestId,
          },
          tx,
        );

        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'REFUND_WAIVED',
            entity: 'repossession',
            entityId: id,
            newValue: {
              contractId: repo.contractId,
              waivedAmount: result.waivedAmount,
              requestId: dto.requestId ?? null,
              deduped: result.deduped,
            },
          },
        });

        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return { success: true, repossessionId: id, ...waiveResult };
  }

  /**
   * Update repossession (repair cost, resell price, status) with workflow validation
   */
  async update(id: string, dto: UpdateRepossessionDto, user?: RequestUser) {
    const repo = await this.findOne(id, user);

    const data: Record<string, unknown> = {};
    if (dto.repairCost !== undefined) data.repairCost = dto.repairCost;
    if (dto.resellPrice !== undefined) data.resellPrice = dto.resellPrice;
    if (dto.notes !== undefined) data.notes = dto.notes;

    // เครื่องที่ขายแล้ว: repairCost/resellPrice ถูกใช้คำนวณกำไรในรายงานไปแล้ว —
    // แก้ย้อนหลังโดยไม่มี JE = ตัวเลขรายงานเปลี่ยนเงียบๆ ไม่มี audit trail
    if (repo.status === 'SOLD' && (dto.repairCost !== undefined || dto.resellPrice !== undefined)) {
      throw new BadRequestException(
        'เครื่องที่ขายแล้วแก้ไขค่าซ่อม/ราคาขายไม่ได้ (แก้ไขได้เฉพาะหมายเหตุ)',
      );
    }

    // แถวที่ประกาศขายแล้ว (READY_FOR_SALE) ห้ามล้างราคาขายเป็น 0 ผ่าน self-transition/PATCH ตรง
    if (
      repo.status === 'READY_FOR_SALE' &&
      dto.resellPrice !== undefined &&
      new Prisma.Decimal(dto.resellPrice).lessThanOrEqualTo(0)
    ) {
      throw new BadRequestException('กรุณาระบุราคาขายต่อมากกว่า 0');
    }

    // 2026-09-05: ขายเครื่องยึดต้องผ่าน POS เท่านั้น (ลง JE ฝั่ง SHOP + ปิดรายการยึดให้เอง)
    if (dto.status === 'SOLD' && repo.status !== 'SOLD') {
      throw new BadRequestException(
        'ตั้ง "ขายแล้ว" ด้วยมือไม่ได้ — กด "พร้อมขาย" (ตั้งสองราคา) แล้วถ่ายรูป 6 มุมให้ครบ เครื่องจะเข้าคลังเอง จากนั้นขายผ่านหน้าขาย (POS) หรือเปิดสัญญาผ่อนใหม่ ระบบจะปิดรายการยึดพร้อมลงบัญชีให้เอง',
      );
    }

    // ฟอร์มหน้าเว็บส่งสถานะปัจจุบันติดมาด้วยเสมอ — สถานะเดิมไม่ใช่การเปลี่ยนสถานะ
    // (เช็คแบบ inline แทนตัวแปร statusChanged แยก — TS ไม่ narrow dto.status ผ่าน
    // boolean ที่เก็บแยกเมื่อ dto.status เป็น property access ไม่ใช่ local variable)
    if (dto.status !== undefined && dto.status !== repo.status) {
      // Validate status transition
      const currentStatus = repo.status;
      const allowedTransitions = VALID_TRANSITIONS[currentStatus] || [];

      if (!allowedTransitions.includes(dto.status)) {
        throw new BadRequestException(
          `ไม่สามารถเปลี่ยนสถานะจาก ${currentStatus} เป็น ${dto.status} ได้ (สถานะที่อนุญาต: ${allowedTransitions.join(', ') || 'ไม่มี'})`,
        );
      }

      // Validate resell price is set when marking as READY_FOR_SALE or SOLD
      // Wave 3 / Task 4 (W-2): use Decimal comparison instead of Number() cast
      // to avoid float precision drift on large amounts.
      if (['READY_FOR_SALE', 'SOLD'].includes(dto.status)) {
        const resellPrice =
          dto.resellPrice != null
            ? new Prisma.Decimal(dto.resellPrice)
            : new Prisma.Decimal(repo.resellPrice ?? 0);
        if (resellPrice.lessThanOrEqualTo(0)) {
          throw new BadRequestException('กรุณาระบุราคาขายต่อก่อนเปลี่ยนสถานะ');
        }
      }

      data.status = dto.status as RepossessionStatus;

      // พร้อมขาย = ประตูเดียวคือ `markReadyForSale` (ปุ่ม "พร้อมขาย" — 2026-09-07 ต้องตั้ง
      // สองราคาแล้วส่งเครื่องเข้าคิวรอถ่ายรูป) — PATCH สถานะตรงจะได้ราคาผ่อนเก่าติดเครื่องไป
      if (dto.status === 'READY_FOR_SALE') {
        throw new BadRequestException(
          'เปลี่ยนเป็น พร้อมขาย ผ่านปุ่ม "พร้อมขาย" ในหน้ายึดเครื่องเท่านั้น (ต้องตั้งราคาเงินสด + ราคาผ่อน แล้วเครื่องจะเข้าคิวรอถ่ายรูป)',
        );
      }

      // Update product status based on repossession status
      // SOLD ไม่มีในตารางนี้อีกต่อไป (2026-09-05) — ปิดผ่าน POS/เปิดสัญญาใหม่เท่านั้น (ด่านด้านบน)
      // READY_FOR_SALE ไม่มีในตารางนี้ (ด่านด้านบน) — ตั้งผ่าน markReadyForSale เท่านั้น
      const productStatusMap: Record<string, ProductStatus> = {
        UNDER_REPAIR: 'REPOSSESSED',
      };

      // Use transaction to ensure product status and repossession update are atomic
      const newProductStatus = productStatusMap[dto.status];
      if (newProductStatus) {
        const updatedRepo = await this.prisma.$transaction(async (tx) => {
          await tx.product.update({
            where: { id: repo.product.id },
            data: { status: newProductStatus },
          });
          return tx.repossession.update({
            where: { id },
            data,
            include: {
              contract: {
                select: { contractNumber: true, customer: { select: { name: true } } },
              },
              product: { select: { name: true, brand: true, model: true } },
            },
          });
        });

        return updatedRepo;
      }
    }

    return this.prisma.repossession.update({
      where: { id },
      data,
      include: {
        contract: {
          select: { contractNumber: true, customer: { select: { name: true } } },
        },
        product: { select: { name: true, brand: true, model: true } },
      },
    });
  }

  /**
   * "พร้อมขาย" — ตั้งราคาขายสองราคาแล้วส่งเครื่องยึดคืนเข้าคิว "รอถ่ายรูป" เหมือนเครื่องรับซื้อ
   * (คำสั่งเจ้าของ 2026-09-07 — เดิมเครื่องเป็น REFURBISHED แล้วต้องไปกด "นำเข้าคลังพร้อมขาย"
   * โดยไม่มีรูปสักใบ)
   *
   * - สถานะเครื่อง → PHOTO_PENDING: ถ่ายครบ 6 มุมแล้ว `ProductPhotosService.completePhotos`
   *   พาเข้า IN_STOCK เอง (ด่านราคาผ่านเพราะราคาตั้งที่นี่แล้ว)
   * - ราคา: เงินสด = ราคาขายต่อ, ผ่อน = `installmentPrice` — ต้องมาทั้งคู่ เพราะเครื่องยังถือ
   *   ราคาผ่อนตอนเป็นเครื่องใหม่ (ไม่มี flow ล้างราคา — ดู .claude/rules/database.md)
   * - รูป 6 มุมชุดเก่า (ถ้าเครื่องเคยเป็นมือสองมาก่อน) ถูกล้าง — สภาพเปลี่ยนไปแล้ว ต้องถ่ายใหม่
   * - costPrice = ราคาประเมิน (R-007 / TAS 2) ตามเดิม, กลับคลังหลักตามเดิม
   */
  async markReadyForSale(
    id: string,
    prices: { resellPrice: number; installmentPrice: number },
    user?: RequestUser,
  ) {
    const repo = await this.findOne(id, user);
    const { resellPrice, installmentPrice } = prices;

    if (repo.status !== 'UNDER_REPAIR' && repo.status !== 'REPOSSESSED') {
      throw new BadRequestException('สถานะไม่ถูกต้อง ต้องเป็น REPOSSESSED หรือ UNDER_REPAIR');
    }

    if (!resellPrice || resellPrice <= 0) {
      throw new BadRequestException('กรุณาระบุราคาขายต่อ');
    }
    if (!installmentPrice || installmentPrice <= 0) {
      throw new BadRequestException('กรุณาระบุราคาผ่อน');
    }

    // Use transaction to ensure all updates are atomic
    return this.prisma.$transaction(async (tx) => {
      // Find main warehouse for re-stocking
      const mainWarehouse = await tx.branch.findFirst({
        where: { isMainWarehouse: true, isActive: true },
      });

      // R-007: Adjust costPrice to appraised/fair value per TAS 2 when refurbishing
      // Wave 3 / Task 4 (W-2): Decimal arithmetic preserves precision; fall back
      // to resellPrice when appraisal is zero/null.
      const appraisalPrice = new Prisma.Decimal(repo.appraisalPrice ?? 0);
      await tx.product.update({
        where: { id: repo.product.id },
        data: {
          status: 'PHOTO_PENDING',
          costPrice: appraisalPrice.greaterThan(0)
            ? appraisalPrice
            : new Prisma.Decimal(resellPrice),
          ...(mainWarehouse ? { branchId: mainWarehouse.id } : {}),
        },
      });

      // B0 §2.1: คอลัมน์ราคาเป็นแหล่งจริง — write-through สร้าง/อัปเดตแถว ProductPrice ให้เอง
      const cashPrice = new Prisma.Decimal(resellPrice);
      const installment = new Prisma.Decimal(installmentPrice);
      await tx.product.update({
        where: { id: repo.product.id },
        data: { cashPrice, installmentPrice: installment },
      });
      await syncPriceRowsFromColumns(tx, repo.product.id, {
        cashPrice,
        installmentPrice: installment,
      });

      // รูป 6 มุมชุดเก่าใช้ไม่ได้แล้ว — เครื่องต้องถูกถ่ายใหม่ในคิว
      await tx.productPhoto.updateMany({
        where: { productId: repo.product.id },
        data: {
          front: null,
          back: null,
          left: null,
          right: null,
          top: null,
          bottom: null,
          isCompleted: false,
        },
      });

      return tx.repossession.update({
        where: { id },
        data: { status: 'READY_FOR_SALE', resellPrice },
      });
    });
  }

  /**
   * Get profit/loss summary (aggregate + itemized)
   */
  async getProfitLossSummary(page = 1, limit = 50) {
    const safeLimit = Math.min(limit, 100);
    const where = { status: 'SOLD' as const, deletedAt: null as Date | null };

    const [repos, total, aggregation] = await Promise.all([
      this.prisma.repossession.findMany({
        where,
        include: {
          contract: {
            select: { contractNumber: true, customer: { select: { name: true } } },
          },
          product: {
            select: { name: true, brand: true, model: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.repossession.count({ where }),
      this.prisma.repossession.aggregate({
        where,
        _sum: { appraisalPrice: true, repairCost: true, resellPrice: true },
      }),
    ]);

    const data = repos.map((r) => {
      const appraisal = new Prisma.Decimal(r.appraisalPrice ?? 0);
      const repair = new Prisma.Decimal(r.repairCost ?? 0);
      const resell = new Prisma.Decimal(r.resellPrice ?? 0);
      const profit = resell.sub(appraisal).sub(repair);

      return {
        id: r.id,
        contract: r.contract.contractNumber,
        customer: r.contract.customer.name,
        product: `${r.product.brand} ${r.product.model}`,
        conditionGrade: r.conditionGrade,
        appraisalPrice: appraisal.toNumber(),
        repairCost: repair.toNumber(),
        resellPrice: resell.toNumber(),
        profit: profit.toNumber(),
        marginPct: resell.greaterThan(0)
          ? profit.div(resell).mul(100).toDecimalPlaces(1).toString()
          : '0',
      };
    });

    const totalAppraisal = new Prisma.Decimal(aggregation._sum.appraisalPrice ?? 0);
    const totalRepairCost = new Prisma.Decimal(aggregation._sum.repairCost ?? 0);
    const totalResellPrice = new Prisma.Decimal(aggregation._sum.resellPrice ?? 0);

    return {
      summary: {
        count: total,
        totalAppraisal: totalAppraisal.toNumber(),
        totalRepairCost: totalRepairCost.toNumber(),
        totalResellPrice: totalResellPrice.toNumber(),
        totalProfit: totalResellPrice.sub(totalAppraisal).sub(totalRepairCost).toNumber(),
      },
      data,
      total,
      page,
      limit: safeLimit,
    };
  }
}
