import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductCategory } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, AuditEntry } from '../audit/audit.service';
import { hasCrossBranchAccess } from '../auth/branch-access.util';
import { SubmitExchangeRequestDto } from './dto/submit-exchange-request.dto';
import { ApproveExchangeRequestDto } from './dto/approve-exchange-request.dto';
import { ExchangeNewContract1ATemplate } from '../journal/cpa-templates/exchange-new-contract-1a.template';
import { ExchangeCloseOld21_1106Template } from '../journal/cpa-templates/exchange-close-old-21-1106.template';
import { ExchangeBuybackReceivable11_2107Template } from '../journal/cpa-templates/exchange-buyback-receivable-11-2107.template';
import { ShopExchangeReturnTemplate } from '../journal/cpa-templates/shop-exchange-return.template';
import { ExchangeEclReversalTemplate } from '../journal/cpa-templates/exchange-ecl-reversal.template';
import { ShopInventoryTransferTemplate } from '../journal/cpa-templates/shop-inventory-transfer.template';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { computeExchangeTier, ExchangeTier } from './exchange-tier.util';
import { computeExchangePlan } from './exchange-plan.util';
import { glContractBalance } from '../journal/gl-contract-balance';
import { preemptReservationsInTx } from '../../utils/reservation-preempt.util';

/**
 * Subset of the request user that submit() needs to perform branch scoping.
 * Matches the shape attached to `request.user` by JwtAuthGuard.
 */
interface RequestUser {
  id: string;
  role?: string | null;
  branchId?: string | null;
}

/** Minimal product shape for same-price validation */
interface ProductPriceSnapshot {
  id: string;
  brand: string;
  model: string;
  storage: string | null;
  status: string;
  /** installmentPrice is the authoritative "same-price" field for installment exchanges */
  installmentPrice: { toString(): string } | string | null;
}

/**
 * Minimal contract shape needed by finalizeAfterActivation.
 * Mirrors the subset of `Contract` columns the JE chain + flips require.
 */
export interface ExchangeContractForFinalize {
  id: string;
  productId: string;
  exchangedFromContractId: string;
  financedAmount: Prisma.Decimal | string | number;
  storeCommission: Prisma.Decimal | string | number | null;
  /**
   * F2 (SHOP-leg wiring, CPA ตอบข้อ 3 2026-08-01) — needed to post
   * ShopInventoryTransferTemplate at the same moment ContractWorkflowService
   * posts it for a normal activation. Sourced from the SAME pre-tx
   * `findOne(id)` snapshot the normal path already trusts for
   * `contract.product.category`/`costPrice` (contract-workflow.service.ts) —
   * not re-fetched inside the tx, so behavior/race characteristics match
   * the existing normal-activation precedent exactly.
   */
  contractNumber: string;
  downPayment: Prisma.Decimal | string | number;
  productCategory: ProductCategory;
  productCostPrice: Prisma.Decimal | string | number | null;
}

@Injectable()
export class ContractExchangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly t1a: ExchangeNewContract1ATemplate,
    private readonly t2: ExchangeCloseOld21_1106Template,
    private readonly t3: ExchangeBuybackReceivable11_2107Template,
    private readonly t4: ShopExchangeReturnTemplate,
    private readonly t5: ExchangeEclReversalTemplate,
    private readonly companyResolver: CompanyResolverService,
    private readonly shopInventoryTransferTemplate: ShopInventoryTransferTemplate,
    private readonly shopAccountResolver: ShopAccountResolver,
  ) {}

  async submit(dto: SubmitExchangeRequestDto, user: RequestUser) {
    const oldContract = await this.prisma.contract.findUnique({
      where: { id: dto.oldContractId },
    });
    if (!oldContract || oldContract.deletedAt) {
      throw new NotFoundException('ไม่พบสัญญาเดิม');
    }
    if (!hasCrossBranchAccess(user) && oldContract.branchId !== user.branchId) {
      throw new ForbiddenException('ไม่สามารถสร้างคำขอเปลี่ยนเครื่องของสาขาอื่นได้');
    }
    if (oldContract.status !== 'ACTIVE') {
      throw new BadRequestException(`สัญญาเดิมสถานะ ${oldContract.status} — ต้องเป็น ACTIVE`);
    }

    const [oldRaw, newRaw] = await Promise.all([
      this.prisma.product.findUnique({
        where: { id: dto.oldProductId },
      }) as Promise<ProductPriceSnapshot | null>,
      this.prisma.product.findUnique({
        where: { id: dto.newProductId },
      }) as Promise<ProductPriceSnapshot | null>,
    ]);
    if (!oldRaw) throw new NotFoundException('ไม่พบเครื่องเดิม');
    if (!newRaw) throw new NotFoundException('ไม่พบเครื่องใหม่');
    // I6 (final review 2026-07-29): the submitted oldProductId must be the
    // device actually on the contract — a mismatched id would return the WRONG
    // device to SHOP stock at finalize (A.4 + product flips key off it).
    if (oldContract.productId !== dto.oldProductId) {
      throw new BadRequestException('เครื่องเดิมไม่ตรงกับสัญญา');
    }
    const oldProduct = oldRaw as any;
    const newProduct = newRaw as any;

    const resolvePriceOrNull = (p: any): Decimal | null => {
      const raw = p?.sellingPrice ?? p?.installmentPrice;
      if (raw === null || raw === undefined) return null;
      return new Decimal((raw as { toString(): string } | string).toString());
    };
    const newPrice = resolvePriceOrNull(newProduct);
    if (newPrice === null) {
      throw new BadRequestException('ราคาเครื่องใหม่ไม่ถูกตั้งค่า — ตรวจสอบเครื่องในระบบ');
    }
    if (newProduct.status !== 'IN_STOCK') {
      throw new BadRequestException('เครื่องใหม่ต้องอยู่ในสต็อก (IN_STOCK)');
    }

    const mode = this.detectMode(
      oldProduct,
      newProduct,
      newPrice,
      new Decimal(oldContract.sellingPrice.toString()),
    );

    // ---------- MEMO (workbook Case 1): ไม่มี JE, ไม่มีราคารับซื้อ ----------
    if (mode === 'MEMO') {
      if (dto.buybackPrice !== undefined) {
        throw new BadRequestException(
          'รุ่นเดิม+ราคาเดิม = เปลี่ยนแบบไม่มีรายการบัญชี (MEMO) — ห้ามระบุราคารับซื้อ',
        );
      }
      return (this.prisma as any).contractExchangeRequest.create({
        data: {
          oldContractId: dto.oldContractId,
          oldProductId: dto.oldProductId,
          newProductId: dto.newProductId,
          conditionNote: dto.conditionNote,
          conditionPhotos: dto.conditionPhotos ?? [],
          status: 'PENDING',
          mode: 'MEMO',
          requestedById: user.id,
        },
      });
    }

    // ---------- PRICED (workbook Cases 2A-2G) ----------
    if (!dto.buybackPrice) throw new BadRequestException('กรุณาระบุราคารับซื้อเครื่องเดิม');
    if (!dto.deviceCondition) throw new BadRequestException('กรุณาระบุสภาพเครื่องเดิม (A-D)');
    if (!dto.newTotalMonths) throw new BadRequestException('กรุณาระบุจำนวนงวดของสัญญาใหม่');
    const buyback = new Decimal(dto.buybackPrice);
    if (buyback.lte(0)) throw new BadRequestException('ราคารับซื้อต้องมากกว่า 0');

    const rate = dto.newInterestRate
      ? new Decimal(dto.newInterestRate)
      : new Decimal(oldContract.interestRate.toString());
    if (rate.lt(0) || rate.gt('0.15')) {
      throw new BadRequestException('อัตราดอกเบี้ยต่อเดือนต้องอยู่ระหว่าง 0 ถึง 0.15');
    }
    const plan = computeExchangePlan({ newPrice, months: dto.newTotalMonths, monthlyRate: rate });

    // Snapshot NCV + ราคากลาง + tier ณ ตอน submit (enforce ซ้ำตอน approve — spec §6)
    const outstanding = await this.computeOldOutstanding(this.prisma as any, dto.oldContractId);
    const ncv = outstanding.gross.minus(outstanding.unearnedInterest);
    const basePrice = await this.lookupBasePrice(oldProduct, dto.deviceCondition);
    const marketCheckPct = await this.configNumber('exchange_market_check_pct', 15);
    const tier: ExchangeTier = computeExchangeTier({ buyback, ncv, basePrice, marketCheckPct });

    // depositAccountCode ไม่บังคับแล้ว (คำสั่งเจ้าของ 2026-08-03): เส้นทาง
    // เปลี่ยนเครื่องไม่มีการเคลื่อนไหวเงินสดในวัน finalize อีกต่อไป — A.3 ตั้ง
    // ลูกหนี้ 11-2107 แทนขาเงินสด และเจ้าหนี้สัญญาใหม่ค้างไว้ให้รอบจ่ายปกติ.
    // เหตุผลเดิมที่บังคับ (final review 2026-07-29) คือขาเงินสดของ A.3 + penalty
    // JE ตอน cancel — penalty ถูกยกเลิกไปแล้ว 2026-07-31, ขาเงินสดถูกถอด
    // 2026-08-03 → ไม่มีผู้อ่านค่านี้เหลืออยู่ในเส้นทางนี้แล้ว. คอลัมน์
    // `ContractExchangeRequest.depositAccountCode` ยังคงอยู่ (ข้อมูลย้อนหลัง)
    // และยังรับค่ามาบันทึกได้ถ้าไคลเอนต์ส่งมา แต่ไม่มีผลต่อ JE ใดๆ.

    const request = await (this.prisma as any).contractExchangeRequest.create({
      data: {
        oldContractId: dto.oldContractId,
        oldProductId: dto.oldProductId,
        newProductId: dto.newProductId,
        conditionNote: dto.conditionNote,
        conditionPhotos: dto.conditionPhotos ?? [],
        status: 'PENDING',
        mode: 'PRICED',
        buybackPrice: buyback,
        deviceCondition: dto.deviceCondition,
        approvalTier: tier,
        ncvSnapshot: ncv,
        basePriceSnapshot: basePrice,
        depositAccountCode: dto.depositAccountCode,
        newTotalMonths: dto.newTotalMonths,
        newInterestRate: rate,
        newMonthlyPayment: plan.monthlyPayment,
        newInterestTotal: plan.interestTotal,
        newVatAmount: plan.vatAmount,
        newStoreCommission: plan.storeCommission,
        requestedById: user.id,
      },
    });

    // AUTO tier — อนุมัติทันที (audit ระบุ auto)
    if (tier === 'AUTO') {
      const approved = await this.approve(request.id, user, {});
      return {
        ...request,
        status: 'APPROVED',
        autoApproved: true,
        newContractId: approved.newContractId,
      };
    }
    return request;
  }

  async buildPreview(
    params: {
      oldContractId: string;
      newProductId?: string;
      buybackPrice?: string;
      deviceCondition?: string;
      newTotalMonths?: number;
      newInterestRate?: string;
    },
    user: RequestUser,
  ) {
    const oldContract = await this.prisma.contract.findUnique({
      where: { id: params.oldContractId },
    });
    if (!oldContract || oldContract.deletedAt) throw new NotFoundException('ไม่พบสัญญาเดิม');
    // Task 8 (carry-over from Task 7 review): same in-service branch scoping as
    // submit() — without it any SALES user could read any contract's NCV/GL by UUID.
    if (!hasCrossBranchAccess(user) && oldContract.branchId !== user.branchId) {
      throw new ForbiddenException('ไม่สามารถดูข้อมูลสัญญาของสาขาอื่นได้');
    }
    const oldProduct = (await this.prisma.product.findUnique({
      where: { id: oldContract.productId },
    })) as any;

    const outstanding = await this.computeOldOutstanding(this.prisma as any, params.oldContractId);
    const ncv = outstanding.gross.minus(outstanding.unearnedInterest);
    const grossRemainingInclVat = outstanding.gross.plus(outstanding.vatReceivable);

    // Blockers (spec §7.0) — เตือนตั้งแต่ preview จะได้ไม่ไปตายตอน finalize
    const bal2103 = await glContractBalance(
      this.prisma as any,
      params.oldContractId,
      '11-2103',
      'dr',
    );
    const bal21_1103 = await glContractBalance(
      this.prisma as any,
      params.oldContractId,
      '21-1103',
      'cr',
    );
    const overdueBlocked = bal2103.abs().gte('0.005');
    const advanceBlocked =
      bal21_1103.gte('0.005') ||
      new Decimal(oldContract.advanceBalance.toString()).gt(0) ||
      new Decimal((oldContract as any).creditBalance?.toString() ?? '0').gt(0) ||
      // Park-at-last-installment (2026-08-16): unswept reschedule-fee credit is
      // also unreconciled customer money — same treatment as advanceBalance/
      // creditBalance above (block, don't silently orphan it on a swapped-away
      // contract).
      new Decimal((oldContract as any).rescheduleAdvanceBalance?.toString() ?? '0').gt(0);
    const hasUnpaidLateFee = !!(await this.prisma.payment.findFirst({
      where: {
        contractId: params.oldContractId,
        status: { not: 'PAID' },
        dueDate: { lt: new Date() },
        lateFee: { gt: 0 },
        deletedAt: null,
      },
      select: { id: true },
    }));

    let mode: 'MEMO' | 'PRICED' | null = null;
    let plan: ReturnType<typeof computeExchangePlan> | null = null;
    if (params.newProductId) {
      const newProduct = (await this.prisma.product.findUnique({
        where: { id: params.newProductId },
      })) as any;
      if (newProduct) {
        const raw = newProduct.sellingPrice ?? newProduct.installmentPrice;
        const newPrice = raw != null ? new Decimal(raw.toString()) : null;
        if (newPrice) {
          mode = this.detectMode(
            oldProduct,
            newProduct,
            newPrice,
            new Decimal(oldContract.sellingPrice.toString()),
          );
          if (mode === 'PRICED' && params.newTotalMonths) {
            const rate = params.newInterestRate
              ? new Decimal(params.newInterestRate)
              : new Decimal(oldContract.interestRate.toString());
            plan = computeExchangePlan({
              newPrice,
              months: params.newTotalMonths,
              monthlyRate: rate,
            });
          }
        }
      }
    }

    let tier: ExchangeTier | null = null;
    let basePrice: Decimal | null = null;
    let marketMin: Decimal | null = null;
    let expectedPl: Decimal | null = null;
    const marketCheckPct = await this.configNumber('exchange_market_check_pct', 15);
    if (params.buybackPrice && params.deviceCondition) {
      const buyback = new Decimal(params.buybackPrice);
      basePrice = await this.lookupBasePrice(oldProduct, params.deviceCondition);
      marketMin = basePrice
        ? basePrice.times(new Decimal(100).minus(marketCheckPct).div(100)).toDecimalPlaces(2)
        : null;
      tier = computeExchangeTier({ buyback, ncv, basePrice, marketCheckPct });
      // วิธีสุทธิ (A.2 NET method, workbook 2026-08-19) — mirror plug ของ
      // ExchangeCloseOld21_1106Template: (buyback + unearned + deferredVat)
      // − (gross + vatRec [Cr 11-2105] + vatRec [Cr 21-2101]).
      // − = loss (Dr 51-1102), + = gain (Cr 41-1102)
      expectedPl = buyback
        .plus(outstanding.unearnedInterest)
        .plus(outstanding.deferredVat)
        .minus(outstanding.gross)
        .minus(outstanding.vatReceivable)
        .minus(outstanding.vatReceivable);
    }

    return {
      mode,
      ncv: ncv.toFixed(2),
      grossRemainingInclVat: grossRemainingInclVat.toFixed(2),
      unearnedInterest: outstanding.unearnedInterest.toFixed(2),
      basePrice: basePrice?.toFixed(2) ?? null,
      marketMin: marketMin?.toFixed(2) ?? null,
      marketCheckPct,
      tier,
      expectedPl: expectedPl?.toFixed(2) ?? null,
      plan: plan
        ? {
            financedAmount: plan.financedAmount.toFixed(2),
            storeCommission: plan.storeCommission.toFixed(2),
            interestTotal: plan.interestTotal.toFixed(2),
            vatAmount: plan.vatAmount.toFixed(2),
            monthlyPayment: plan.monthlyPayment.toFixed(2),
          }
        : null,
      blockers: { overdueBlocked, advanceBlocked },
      hasUnpaidLateFee,
    };
  }

  /**
   * Sign-then-activate flow (SP2 v2): approve() now ONLY creates a DRAFT
   * exchange contract + marks the request APPROVED + reserves the new product.
   *
   * The JE chain (A.1 → A.2 → A.3 → A.4) and the old-contract / old-product
   * status flips are deferred to `finalizeAfterActivation()` which fires from
   * `ContractWorkflowService.activate()` once the customer has signed.
   *
   * Why: the new contract has a different contractNumber + IMEI than the
   * original. If the debtor disputes the swap and never signed, the JE chain
   * already posted would represent an unsigned obligation. Owner direction
   * (option B): post NO journal entries until the customer signs + OWNER/BM/FM
   * activates the new contract via the existing "เปิดใช้สัญญา" flow.
   *
   * Convention: DRAFT + workflowStatus=APPROVED is the pre-existing pattern
   * for "ready to sign then activate" (see ContractWorkflowService.activate),
   * so we don't need a new lifecycle state.
   */
  async approve(id: string, user: RequestUser, dto: ApproveExchangeRequestDto) {
    // Tier-role enforcement ที่ service (spec §6) — controller เปิด OWNER+BM แล้ว
    const pre = await (this.prisma as any).contractExchangeRequest.findUnique({
      where: { id },
      include: { oldContract: { select: { branchId: true } } },
    });
    if (!pre || pre.deletedAt) throw new NotFoundException('ไม่พบคำขอเปลี่ยนเครื่อง');
    // I7 (final review 2026-07-29): BM must not approve another branch's request
    // by UUID — same in-service branch scoping as submit()/buildPreview().
    if (!hasCrossBranchAccess(user) && pre.oldContract?.branchId !== user.branchId) {
      throw new ForbiddenException('ไม่สามารถอนุมัติคำขอของสาขาอื่นได้');
    }
    if (pre.mode === 'PRICED' && pre.approvalTier === 'ESCALATE' && user.role !== 'OWNER') {
      throw new ForbiddenException(
        'ราคารับซื้อต่ำกว่า 70% ของมูลค่าคงเหลือ — ต้องให้ผู้จัดการใหญ่ (OWNER) อนุมัติเท่านั้น',
      );
    }

    if (pre.mode === 'MEMO') {
      return this.approveMemo(id, user.id, dto);
    }
    return this.approvePriced(id, user.id);
  }

  /** MEMO (workbook Case 1): เปลี่ยน device บนสัญญาเดิม — ไม่มี JE, ไม่มีสัญญาใหม่ (spec §8) */
  private async approveMemo(id: string, userId: string, dto: ApproveExchangeRequestDto) {
    if (!dto.memoAddendumSigned || !dto.memoMdmSwapped) {
      throw new BadRequestException(
        'ต้องยืนยัน checklist ก่อนอนุมัติ: บันทึกแนบท้ายสัญญา (ADDENDUM) + สลับ MDM เครื่องเก่า/ใหม่',
      );
    }
    // audit หลัง commit (doctrine R-1 / pattern เดียวกับ FINALIZED path ของ
    // `ExchangeCancelService`): `AuditService.log` เปิด `$transaction` ของ root
    // client เอง (hash chain ต้อง atomic) — await มันขณะที่ tx นี้ยังถือ
    // connection = nested root-tx ⇒ P2028 และ `log()` กลืน error ทิ้ง ⇒ ไม่มี
    // แถว audit เลย (พิสูจน์ด้วย DB จริงใน Task 4: MEMO approve 4 ครั้ง → 0 แถว).
    // แถม audit ต้องบรรยาย "งานที่ commit แล้ว" อยู่แล้ว — เขียนใน tx ที่อาจ
    // roll back = phantom audit row.
    let pendingAudit: AuditEntry | null = null;
    const result = await this.prisma.$transaction(async (tx) => {
      const lock = await (tx as any).contractExchangeRequest.updateMany({
        where: { id, status: 'PENDING', deletedAt: null },
        data: {
          status: 'APPROVED',
          approvedById: userId,
          approvedAt: new Date(),
          memoAppliedAt: new Date(),
        },
      });
      if (lock.count !== 1) {
        throw new ConflictException('คำขออาจถูกอนุมัติแล้ว หรือสถานะเปลี่ยน');
      }
      const req = await (tx as any).contractExchangeRequest.findUniqueOrThrow({
        where: { id },
        include: { oldContract: true, newProduct: true },
      });
      // Task 8 review fix 3: approval can happen days after submit — the old
      // contract may have closed (early payoff / repossession) in between.
      if (req.oldContract.status !== 'ACTIVE') {
        throw new BadRequestException(
          `สัญญาเดิมสถานะ ${req.oldContract.status} — เปลี่ยนเครื่องไม่ได้`,
        );
      }
      // Phase 5 Task 2: เครื่องใหม่ต้องยังไม่ถูก soft-delete — การลบสินค้าไม่แตะ
      // `product.status` ดังนั้นเช็คสถานะอย่างเดียวจับไม่ได้ และ approve ก็สั่ง
      // `product.update` ตรง ๆ ได้สำเร็จบนแถวที่ถูกลบแล้ว (Prisma ไม่กรอง soft-delete ให้)
      // ⇒ สัญญาจะผูกกับเครื่องที่หลุด partial unique index ของ IMEI ไปแล้ว
      if (!req.newProduct || (req.newProduct as { deletedAt?: Date | null }).deletedAt) {
        throw new BadRequestException(
          'เครื่องใหม่ถูกลบออกจากระบบแล้ว — เปลี่ยนเครื่องไม่ได้ กรุณารับเครื่องเข้าสต็อกใหม่แล้วส่งคำขอใหม่',
        );
      }
      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
      const oldProduct = await tx.product.findUniqueOrThrow({
        where: { id: req.oldProductId },
        select: { status: true, ownedByCompanyId: true } as any,
      });

      // เครื่องใหม่รับสถานะ/ownership ของเครื่องเดิม (FINANCE ถือกรรมสิทธิ์ระหว่างผ่อน)
      await tx.product.update({
        where: { id: req.newProductId },
        data: {
          status: (oldProduct as any).status,
          ownedByCompanyId: (oldProduct as any).ownedByCompanyId,
        } as any,
      });
      // B5: เครื่องใหม่หลุดจาก IN_STOCK แล้ว (รับสถานะเครื่องเดิม) — ตัด hold ของเว็บใน tx เดียวกัน
      await preemptReservationsInTx(tx, [req.newProductId]);
      await tx.product.update({
        where: { id: req.oldProductId },
        data: { status: 'REFURBISHED', ownedByCompanyId: shopCompanyId } as any,
      });
      // หัวใจ MEMO: สัญญาเดิม-สถานะเดิม-ตารางเดิม แค่ชี้ product ใหม่
      await tx.contract.update({
        where: { id: req.oldContractId },
        data: { productId: req.newProductId },
      });

      pendingAudit = {
        action: 'EXCHANGE_MEMO_APPLIED',
        entity: 'contract_exchange_request',
        entityId: id,
        userId,
        newValue: {
          contractId: req.oldContractId,
          oldProductId: req.oldProductId,
          newProductId: req.newProductId,
          checklist: { addendumSigned: true, mdmSwapped: true },
          note: 'Memo-only swap — no JE (workbook Case 1, TFRS 9 modification)',
        },
      };
      return { id, newContractId: null as string | null, mode: 'MEMO' };
    });
    if (pendingAudit) await this.audit.log(pendingAudit);
    return result;
  }

  /** PRICED: เดิมคือ approve() ทั้งก้อน — เปลี่ยนเฉพาะที่มาของแผนผ่อน (Device Swap 2026-07) */
  private async approvePriced(id: string, userId: string) {
    // audit หลัง commit — เหตุผลเดียวกับ `approveMemo` (nested root-tx = P2028)
    let pendingAudit: AuditEntry | null = null;
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Lock-acquire (race-safe via updateMany count===1)
      const lock = await (tx as any).contractExchangeRequest.updateMany({
        where: { id, status: 'PENDING', deletedAt: null },
        data: {
          status: 'APPROVED',
          approvedById: userId,
          approvedAt: new Date(),
        },
      });
      if (lock.count !== 1) {
        throw new ConflictException('คำขออาจถูกอนุมัติแล้ว หรือสถานะเปลี่ยน');
      }

      // 2. Re-fetch with full data
      const req = await (tx as any).contractExchangeRequest.findUniqueOrThrow({
        where: { id },
        include: { oldContract: true, newProduct: true },
      });
      const old = req.oldContract;
      // Phase 5 Task 2: เครื่องใหม่ต้องยังไม่ถูก soft-delete — การลบสินค้าไม่แตะ
      // `product.status` ดังนั้นเช็คสถานะอย่างเดียวจับไม่ได้ และ approve ก็สั่ง
      // `product.update` ตรง ๆ ได้สำเร็จบนแถวที่ถูกลบแล้ว (Prisma ไม่กรอง soft-delete ให้)
      // ⇒ สัญญาจะผูกกับเครื่องที่หลุด partial unique index ของ IMEI ไปแล้ว
      if (!req.newProduct || (req.newProduct as { deletedAt?: Date | null }).deletedAt) {
        throw new BadRequestException(
          'เครื่องใหม่ถูกลบออกจากระบบแล้ว — เปลี่ยนเครื่องไม่ได้ กรุณารับเครื่องเข้าสต็อกใหม่แล้วส่งคำขอใหม่',
        );
      }

      // 3. Installment plan for the new contract.
      //    Device Swap 2026-07: server-computed snapshot from submit() when
      //    present; legacy fallback (in-flight PENDING rows created before
      //    deploy) clones the remaining installments like SP2 did.
      let planFields: {
        totalMonths: number;
        monthlyPayment: Decimal;
        financedAmount: Decimal;
        storeCommission: Decimal;
        interestTotal: Decimal;
        interestRate: Decimal;
        vatAmount: Decimal | null;
        sellingPrice: Decimal;
      };
      const usedSnapshot = req.newTotalMonths != null;
      if (usedSnapshot) {
        // Task 8 review fix 3: approval can happen days after submit — the
        // old contract may have closed (early payoff / repossession) since.
        // (Legacy branch keeps its remainingMonths<=0 guard instead.)
        if (old.status !== 'ACTIVE') {
          throw new BadRequestException(`สัญญาเดิมสถานะ ${old.status} — เปลี่ยนเครื่องไม่ได้`);
        }
        // Same price resolver submit() uses (sellingPrice ?? installmentPrice).
        // Legacy product rows may still carry null prices — fail loudly
        // instead of creating a contract financed at 0.
        const rawNewPrice = req.newProduct?.sellingPrice ?? req.newProduct?.installmentPrice;
        if (rawNewPrice == null) {
          throw new BadRequestException(
            'ราคาผ่อนของเครื่องใหม่ไม่ถูกตั้งค่า — ตรวจสอบเครื่องในระบบก่อนอนุมัติ',
          );
        }
        const newPrice = new Decimal(rawNewPrice.toString());
        // Task 8 review fix 2 — price-drift guard: recompute the plan off the
        // LIVE product price. If it no longer reproduces the submit-time
        // monthlyPayment snapshot, the price list moved while the request was
        // pending — refuse rather than silently book stale numbers.
        const livePlan = computeExchangePlan({
          newPrice,
          months: req.newTotalMonths,
          monthlyRate: new Decimal(req.newInterestRate.toString()),
        });
        if (!livePlan.monthlyPayment.equals(new Decimal(req.newMonthlyPayment.toString()))) {
          throw new BadRequestException(
            'ราคาเครื่องหรือแผนผ่อนเปลี่ยนไประหว่างรออนุมัติ — กรุณาส่งคำขอเปลี่ยนเครื่องใหม่',
          );
        }
        planFields = {
          totalMonths: req.newTotalMonths,
          monthlyPayment: new Decimal(req.newMonthlyPayment.toString()),
          financedAmount: newPrice,
          storeCommission: new Decimal(req.newStoreCommission.toString()),
          interestTotal: new Decimal(req.newInterestTotal.toString()),
          interestRate: new Decimal(req.newInterestRate.toString()),
          vatAmount: new Decimal(req.newVatAmount.toString()),
          sellingPrice: newPrice,
        };
      } else {
        // Legacy fallback (in-flight PENDING ก่อน deploy): clone งวดคงเหลือแบบ SP2 เดิม
        const paidCount = await tx.payment.count({
          where: { contractId: old.id, status: 'PAID', deletedAt: null },
        });
        const remainingMonths = old.totalMonths - paidCount;
        if (remainingMonths <= 0) {
          throw new BadRequestException('สัญญาเดิมจ่ายครบงวดแล้ว — เปลี่ยนเครื่องไม่ได้');
        }
        const monthlyPayment = new Decimal(old.monthlyPayment.toString());
        const newFinanced = new Decimal(old.financedAmount.toString());
        const newCommission = old.storeCommission
          ? new Decimal(old.storeCommission.toString())
          : new Decimal(0);
        planFields = {
          totalMonths: remainingMonths,
          monthlyPayment,
          financedAmount: newFinanced,
          storeCommission: newCommission,
          interestTotal: monthlyPayment.times(remainingMonths).minus(newFinanced),
          interestRate: new Decimal(old.interestRate.toString()),
          // Task 8 review fix 1: pass null THROUGH (template derives 7% from
          // null; Decimal(0) would mean "book zero VAT" and kill the fallback)
          vatAmount: old.vatAmount ? new Decimal(old.vatAmount.toString()) : null,
          sellingPrice: new Decimal(old.sellingPrice.toString()),
        };
      }

      // 4. Create new contract as DRAFT (sign-then-activate gate).
      // Issue #1086 item 4 — use EXCH-YYYYMMDD-NNNN to avoid grep-collision
      // with ExpenseDocument's EX- prefix.
      //
      // workflowStatus = 'APPROVED' because the OWNER's exchange-request
      // approval IS the workflow approval — the customer doesn't need a
      // second review pass before signing.
      //
      // PDPA consent: Contract.pdpaConsentId is @unique so we can't reuse
      // the old contract's consent row. Clone it for the new contract — same
      // customer + same consent semantics + fresh row id satisfies the unique
      // constraint AND keeps the audit trail per-contract.
      let clonedPdpaConsentId: string | null = null;
      if (old.pdpaConsentId) {
        const oldConsent = await tx.pDPAConsent.findUnique({
          where: { id: old.pdpaConsentId },
        });
        if (oldConsent) {
          const cloned = await tx.pDPAConsent.create({
            data: {
              customerId: oldConsent.customerId,
              consentVersion: oldConsent.consentVersion,
              privacyNoticeText: oldConsent.privacyNoticeText,
              purposes: oldConsent.purposes,
              status: oldConsent.status,
              grantedAt: oldConsent.grantedAt,
              ipAddress: oldConsent.ipAddress,
              deviceInfo: oldConsent.deviceInfo,
              signatureImage: oldConsent.signatureImage,
            },
          });
          clonedPdpaConsentId = cloned.id;
        }
      }
      const contractNumber = await this.nextExchangeContractNumber(tx);
      const newContract = await tx.contract.create({
        data: {
          contractNumber,
          customerId: old.customerId,
          productId: req.newProductId,
          branchId: old.branchId,
          salespersonId: old.salespersonId,
          status: 'DRAFT',
          workflowStatus: 'APPROVED',
          pdpaConsentId: clonedPdpaConsentId,
          planType: old.planType,
          totalMonths: planFields.totalMonths,
          monthlyPayment: planFields.monthlyPayment,
          financedAmount: planFields.financedAmount,
          storeCommission: planFields.storeCommission,
          interestTotal: planFields.interestTotal,
          interestRate: planFields.interestRate,
          vatAmount: planFields.vatAmount,
          sellingPrice: planFields.sellingPrice,
          // Same-price exchange: customer pays ฿0 at swap (spec v3). Copying
          // old.downPayment would distort payment-history view and corrupt
          // early-payoff calcs that reference downPayment. (Issue #1086 item 5.)
          downPayment: new Decimal(0),
          advanceBalance: new Decimal(0),
          exchangedFromContractId: old.id,
        } as any,
      });

      // 5. Reserve the new product so it can't be sold to anyone else
      // between approval and activation. The new-contract activation flow
      // (ContractWorkflowService.activate) accepts both RESERVED and IN_STOCK,
      // and flips to SOLD_INSTALLMENT once the customer signs.
      await tx.product.update({
        where: { id: req.newProductId },
        data: { status: 'RESERVED' } as any,
      });
      // B5: เครื่องใหม่ถูกจองไว้รอ activate — ตัด hold ของเว็บใน tx เดียวกัน (เปลี่ยนเครื่องระหว่างสัญญา)
      await preemptReservationsInTx(tx, [req.newProductId]);

      // 6. Link request to new contract (jeXIds are written later by
      // finalizeAfterActivation when the JE chain actually posts).
      await (tx as any).contractExchangeRequest.update({
        where: { id },
        data: {
          newContractId: newContract.id,
        },
      });

      // 7. Audit (ยิงหลัง commit — ดูเหตุผลบนหัว method)
      pendingAudit = {
        action: 'EXCHANGE_REQUEST_APPROVED',
        entity: 'contract_exchange_request',
        entityId: id,
        userId,
        newValue: {
          oldContractId: old.id,
          newContractId: newContract.id,
          // Task 8 review fix 4: snapshot plan = a FULL new plan, so the key
          // is totalMonths; legacy clone keeps the historical remainingMonths.
          ...(usedSnapshot
            ? { totalMonths: planFields.totalMonths }
            : { remainingMonths: planFields.totalMonths }),
          // Highlight the deferred-finalization design so an auditor scanning
          // the log understands no money has moved at this point.
          phase: 'awaiting-sign-then-activate',
        },
      };

      return {
        id,
        newContractId: newContract.id as string | null,
        mode: 'PRICED',
      };
    });
    if (pendingAudit) await this.audit.log(pendingAudit);
    return result;
  }

  /**
   * Sign-then-activate flow (SP2 v2): fire the JE chain + old-side flips
   * AFTER the customer signs the new contract and OWNER/BM/FM activates it.
   *
   * Called from `ContractWorkflowService.activate()` inside its `$transaction`
   * when the contract being activated has `exchangedFromContractId` non-null.
   * The new contract is already flipped to ACTIVE + the new product to
   * SOLD_INSTALLMENT + ownership transferred to FINANCE by the caller — this
   * method only handles the EXCHANGE-specific side-effects:
   *
   *   - A.1 ExchangeNewContract1ATemplate — open new HP receivable
   *   - A.2 ExchangeCloseOld21_1106Template — close old contract's outstanding
   *   - A.3 ExchangeBuybackReceivable11_2107Template — ตั้งลูกหนี้-หน้าร้าน
   *     11-2107 ล้างบัญชีพัก 21-1106 (ไม่มีขาเงินสด, เจ้าหนี้สัญญาใหม่ค้างไว้)
   *   - A.4 ShopExchangeReturnTemplate — re-intake old device into SHOP inventory
   *   - flip OLD contract → EXCHANGED
   *   - flip OLD product → REFURBISHED + ownedByCompanyId = SHOP
   *   - write je*Id refs onto the exchange request
   *   - EXCHANGE_FINALIZED + EXCHANGE_DEVICE_RETURNED_TO_SHOP audit logs
   */
  async finalizeAfterActivation(
    newContract: ExchangeContractForFinalize,
    tx: Prisma.TransactionClient,
  ): Promise<{
    je1aId: string;
    je2Id: string;
    je3Id: string;
    je4Id: string;
    je5Id: string | null;
  }> {
    // 1. Resolve SHOP companyId
    const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);

    // 2. Look up the request that birthed this contract, and the linked old
    // contract + old product. We trust the caller's contract object for the
    // new-side identity but re-fetch the request so this method is idempotent
    // on its own (a callsite can pass just the contract).
    const oldContractId = newContract.exchangedFromContractId;
    const request = await (tx as any).contractExchangeRequest.findFirst({
      where: {
        newContractId: newContract.id,
        oldContractId,
        deletedAt: null,
      },
    });
    if (!request) {
      throw new InternalServerErrorException(
        'ไม่พบ contract_exchange_request สำหรับสัญญานี้ — ไม่สามารถ finalize ได้',
      );
    }

    // ---- Pre-flight guards (spec §7.0) ----
    const bal2103 = await glContractBalance(tx, oldContractId, '11-2103', 'dr');
    if (bal2103.abs().gte('0.005')) {
      throw new BadRequestException(
        `มีงวดค้างชำระ (11-2103 = ${bal2103.toFixed(2)}) — เคลียร์งวดค้างก่อนเปลี่ยนเครื่อง`,
      );
    }
    const bal21_1103 = await glContractBalance(tx, oldContractId, '21-1103', 'cr');
    const oldC = await tx.contract.findUniqueOrThrow({
      where: { id: oldContractId },
      select: { advanceBalance: true, creditBalance: true, rescheduleAdvanceBalance: true },
    });
    // I-6 — OWNER DECISION PENDING (2026-08-17). This guard is KEPT AS-IS on purpose.
    // Note the asymmetry between the buckets it blocks on: `advanceBalance` is a
    // TRANSIENT block (the next 2A accrual FIFOs it into the following installment,
    // so it clears itself within a month), whereas `rescheduleAdvanceBalance` (ถังพัก
    // งวดสุดท้าย) is by design relieved ONLY at the last installment / JP4 / JP5 —
    // there is NO staff-facing path to "ใช้หรือคืนเงิน" it mid-contract, which is
    // exactly what the Thai message above tells the user to do. Consequence: from the
    // moment a contract is rescheduled until its final installment, device swap on
    // that contract is blocked outright — and reschedules are routine.
    // Deliberately NOT auto-resolved here: every candidate resolution moves customer
    // money and needs the owner (and probably CPA) to rule first. The owner must pick
    // ONE of:
    //   (a) carry the park balance over to the new contract (needs a transfer JE +
    //       column move at finalize),
    //   (b) net it into the buyback price of the swapped-in device (changes A.3 /
    //       11-2107 arithmetic), or
    //   (c) provide an explicit clear-out path (refund / income) staff can run before
    //       the swap — the same refund-vs-income question as the I-5 residual alarm in
    //       `payment-helpers.ts` (`RESIDUAL_PARK_TODO_TAG`).
    // Until that ruling lands, blocking is the safe behaviour: it refuses to silently
    // orphan the customer's parked money on a contract that is being swapped away.
    if (
      bal21_1103.gte('0.005') ||
      new Decimal(oldC.advanceBalance.toString()).gt(0) ||
      new Decimal((oldC as any).creditBalance?.toString() ?? '0').gt(0) ||
      // Park-at-last-installment (2026-08-16) — see preview guard above.
      new Decimal((oldC as any).rescheduleAdvanceBalance?.toString() ?? '0').gt(0)
    ) {
      throw new BadRequestException(
        'มีเงินรับล่วงหน้า/เครดิตค้างบนสัญญาเดิม — ใช้หรือคืนเงินก่อนเปลี่ยนเครื่อง',
      );
    }

    // 3. Outstanding from the real ledger (not straight-line proration).
    const newFinanced = new Decimal(newContract.financedAmount.toString());
    const newCommission = newContract.storeCommission
      ? new Decimal(newContract.storeCommission.toString())
      : new Decimal(0);
    const buyback = request.buybackPrice
      ? new Decimal(request.buybackPrice.toString())
      : newFinanced.plus(newCommission); // legacy same-price fallback
    const oldOutstanding = await this.computeOldOutstanding(tx, oldContractId);

    // 4. JE A.1 — open new HP receivable
    const je1a = await this.t1a.execute(newContract.id, tx);

    // 4b. SHOP-side inventory transfer (F2 — CPA ตอบข้อ 3, 2026-08-01):
    // an exchange's new contract must book the SAME SHOP mirror
    // (COGS + revenue/receivables) a normal activation gets — otherwise
    // SHOP's own books never show the revenue/COGS/receivable for the new
    // device at all.
    //
    // เจ้าของสั่ง 2026-08-03 (SUPERSEDES D5 สำหรับเส้นทางนี้): S11-3001/S11-3002
    // ที่ leg นี้ตั้งขึ้น **ค้างไว้ตามปกติ** ไม่ถูกล้างทันทีอีกต่อไป —
    // `ExchangeShopInstantSettlementTemplate` (เพิ่ม 2026-08-02 ตาม D5) ถูกลบทิ้ง
    // พร้อมกับที่ A.3 เลิกจ่ายเงินสดฝั่ง FINANCE. ทั้งสองฝั่งไปล้างที่รอบจ่าย
    // "จ่ายให้หน้าร้าน (INTER-CO)" เหมือนสัญญาขายปกติ — สัญญาเปลี่ยนเครื่อง
    // จึง**ปรากฏ**ในคิว `IntercoPendingService.getPendingContracts()` แล้ว
    // (21-1101/21-1102 ค้าง) พร้อม `legacyNoShop = false` (S11-3001/S11-3002 ค้าง).
    //
    // Financing identity: `approvePriced` ALWAYS hardcodes downPayment=0 on
    // the new contract (customer pays ฿0 at swap — the "down" already lives
    // on the old contract's history), in BOTH the snapshot and legacy
    // fallback branches. So down+financed === financed always, regardless
    // of branch. Rather than trust `contract.sellingPrice` (the legacy
    // fallback branch clones `old.financedAmount`, which is NOT guaranteed
    // to equal `old.sellingPrice` when the old contract carried its own
    // down payment), salePrice is reconstructed as down+financed — same
    // "D-8" pattern `ContractWorkflowService.activate` uses for normal
    // contracts — so the template's financing-identity assertion holds by
    // construction instead of by coincidence.
    if (newContract.productCostPrice == null) {
      throw new InternalServerErrorException(
        'ไม่พบ costPrice ของเครื่องใหม่ — ตั้งค่าก่อน finalize เปลี่ยนเครื่อง',
      );
    }
    const newDownAmount = new Decimal(newContract.downPayment.toString());
    const shopAcc = this.shopAccountResolver.resolveProductAccounts(newContract.productCategory);
    await this.shopInventoryTransferTemplate.execute(
      {
        // Same idempotencyKey SHAPE ContractWorkflowService.activate uses
        // (`shop-inventory-transfer:${contract.id}`) so a contract can never
        // double-post regardless of which activation path it goes through.
        idempotencyKey: `shop-inventory-transfer:${newContract.id}`,
        contractId: newContract.id,
        contractNumber: newContract.contractNumber,
        productId: newContract.productId,
        inventoryAccountCode: shopAcc.inventoryAccountCode,
        cogsAccountCode: shopAcc.cogsAccountCode,
        revenueAccountCode: shopAcc.revenueAccountCode,
        costPrice: new Decimal(newContract.productCostPrice.toString()),
        salePrice: newDownAmount.plus(newFinanced),
        downAmount: newDownAmount,
        financedAmount: newFinanced,
        commission: newCommission,
      },
      tx,
    );

    // 5. JE A.2 — close old contract's outstanding
    // requestId keys the idempotency (C1b) so a re-exchange after cancel
    // doesn't collide with the first lifecycle's still-POSTED JEs.
    const je2 = await this.t2.execute(
      {
        oldContractId,
        requestId: request.id,
        buyback,
        oldGrossOutstanding: oldOutstanding.gross,
        oldVatReceivableOutstanding: oldOutstanding.vatReceivable,
        oldUnearnedInterestOutstanding: oldOutstanding.unearnedInterest,
        oldDeferredVatOutstanding: oldOutstanding.deferredVat,
      },
      tx,
    );

    // 6. JE A.3 — ตั้งลูกหนี้-หน้าร้าน 11-2107 ล้างบัญชีพัก 21-1106
    // (คำสั่งเจ้าของ 2026-08-03): ไม่มีขาเงินสด และไม่แตะ 21-1101/21-1102 ของ
    // สัญญาใหม่ — เจ้าหนี้นั้นค้างไว้ให้รอบจ่าย INTER-CO ปกติ. `buyback` คือ
    // ยอดเดียวกับที่ A.2 พักไว้ที่ 21-1106 ดังนั้น 21-1106 net = 0 เสมอ.
    const je3 = await this.t3.execute({ newContractId: newContract.id, buyback }, tx);

    // 7. JE A.4 — SHOP ซื้อเครื่องเดิมคืนที่ราคารับซื้อ (workbook 2026-08-19 Phase 1).
    // costPrice เดิมยังต้องมี (data quality) และถูก snapshot ไว้ให้ cancel restore.
    const oldProduct = await tx.product.findUniqueOrThrow({
      where: { id: request.oldProductId },
      select: { id: true, costPrice: true },
    });
    if (oldProduct.costPrice == null) {
      throw new InternalServerErrorException(
        'ไม่พบ costPrice ของเครื่องเดิม — ตั้งค่าก่อน finalize เปลี่ยนเครื่อง',
      );
    }
    const previousCostPrice = new Decimal(oldProduct.costPrice.toString());
    const je4 = await this.t4.execute(
      {
        oldProductId: request.oldProductId,
        oldContractId,
        requestId: request.id,
        buyback,
        newContractId: newContract.id,
      },
      tx,
    );

    // JE A.5 — ECL reversal on derecognition (workbook Case 4, synchronous ใน tx เดียวกัน)
    const je5 = await this.t5.execute({ oldContractId, requestId: request.id }, tx);
    if (je5) {
      await (tx as any).badDebtProvision.updateMany({
        where: { contractId: oldContractId, status: 'ACTIVE', deletedAt: null },
        data: { status: 'REVERSED' },
      });
    }

    // 8. Old-side status flips
    await tx.contract.update({
      where: { id: oldContractId },
      data: { status: 'EXCHANGED', exchangedAt: new Date() } as any,
    });
    await tx.product.update({
      where: { id: request.oldProductId },
      // costPrice = ราคารับซื้อ (ต้นทุนจริงของ SHOP — COGS ตอนขายซ้ำใช้ค่านี้);
      // ค่าเดิม snapshot ไว้ที่ request.previousCostPrice ให้ cancel restore
      data: {
        status: 'REFURBISHED',
        ownedByCompanyId: shopCompanyId,
        costPrice: buyback,
      } as any,
    });

    // 9. Link the JE ids onto the request row for traceability
    await (tx as any).contractExchangeRequest.update({
      where: { id: request.id },
      data: {
        je1aId: je1a.id,
        je2Id: je2.id,
        je3Id: je3.id,
        je4Id: je4.id,
        eclReversalJeId: je5?.id ?? null,
        previousCostPrice,
      },
    });

    // 10. Audit — one event for the finalize (umbrella), one for the SHOP
    // ownership flip so it's greppable independently.
    await this.audit.log({
      action: 'EXCHANGE_FINALIZED',
      entity: 'contract_exchange_request',
      entityId: request.id,
      newValue: {
        oldContractId,
        newContractId: newContract.id,
        buyback: buyback.toString(),
        jeIds: {
          je1aId: je1a.id,
          je2Id: je2.id,
          je3Id: je3.id,
          je4Id: je4.id,
          je5Id: je5?.id ?? null,
        },
      },
    });
    await this.audit.log({
      action: 'EXCHANGE_DEVICE_RETURNED_TO_SHOP',
      entity: 'product',
      entityId: request.oldProductId,
      newValue: {
        exchangeRequestId: request.id,
        oldContractId,
        jeId: je4.id,
        ownedByCompanyId: shopCompanyId,
        buyback: buyback.toString(),
        previousCostPrice: previousCostPrice.toString(),
      },
    });

    return {
      je1aId: je1a.id,
      je2Id: je2.id,
      je3Id: je3.id,
      je4Id: je4.id,
      je5Id: je5?.id ?? null,
    };
  }

  async reject(id: string, reason: string, userId: string) {
    if (reason.trim().length < 10) {
      throw new BadRequestException('เหตุผลปฏิเสธอย่างน้อย 10 ตัวอักษร');
    }
    // audit หลัง commit — เหตุผลเดียวกับ `approveMemo` (nested root-tx = P2028)
    let pendingAudit: AuditEntry | null = null;
    const result = await this.prisma.$transaction(async (tx) => {
      const lock = await (tx as any).contractExchangeRequest.updateMany({
        where: { id, status: 'PENDING', deletedAt: null },
        data: {
          status: 'REJECTED',
          rejectionReason: reason,
          approvedById: userId,
          approvedAt: new Date(),
        },
      });
      if (lock.count !== 1) {
        throw new ConflictException('คำขออาจถูกตอบกลับแล้ว');
      }
      pendingAudit = {
        action: 'EXCHANGE_REQUEST_REJECTED',
        entity: 'contract_exchange_request',
        entityId: id,
        userId,
        newValue: { reason },
      };
      return (tx as any).contractExchangeRequest.findUniqueOrThrow({ where: { id } });
    });
    if (pendingAudit) await this.audit.log(pendingAudit);
    return result;
  }

  async listPending(user: RequestUser): Promise<any[]> {
    // I7 (final review 2026-07-29): BM sees only their own branch's queue —
    // cross-branch roles (OWNER/FM/ACC) see everything.
    const where: Record<string, unknown> = { status: 'PENDING', deletedAt: null };
    if (!hasCrossBranchAccess(user)) {
      where.oldContract = { branchId: user.branchId };
    }
    return (this.prisma as any).contractExchangeRequest.findMany({
      where,
      include: {
        oldContract: {
          include: { customer: { select: { id: true, name: true, phone: true } } },
        },
        oldProduct: true,
        newProduct: true,
        requestedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * APPROVED requests from the last 90 days — feeds the "อนุมัติแล้ว
   * (ยกเลิกได้ภายใน 30 วัน)" table on ExchangeRequestsPage. `updatedAt` is
   * touched by both approve() (approvedAt set in the same updateMany) and
   * finalizeAfterActivation/cancel, so a 90-day window on it comfortably
   * covers the 30-day cancel-eligibility window this list exists to serve.
   */
  async listRecent(user: RequestUser): Promise<any[]> {
    const since = new Date(Date.now() - 90 * 86_400_000);
    // I7: same branch scoping as listPending — BM sees only their own branch.
    const where: Record<string, unknown> = {
      status: 'APPROVED',
      deletedAt: null,
      updatedAt: { gte: since },
    };
    if (!hasCrossBranchAccess(user)) {
      where.oldContract = { branchId: user.branchId };
    }
    return (this.prisma as any).contractExchangeRequest.findMany({
      where,
      include: {
        oldContract: {
          select: {
            id: true,
            contractNumber: true,
            exchangedAt: true,
            customer: { select: { name: true } },
          },
        },
        newContract: { select: { id: true, contractNumber: true, status: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
  }

  /** SystemConfig ตัวเลข — fallback เมื่อ row หาย/parse ไม่ได้ */
  private async configNumber(key: string, fallback: number): Promise<number> {
    const row = await this.prisma.systemConfig.findFirst({
      where: { key, deletedAt: null },
      select: { value: true },
    });
    const n = row ? parseFloat(row.value) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  /** ราคากลางเครื่องเดิมจากตารางตีราคา (null = ไม่มี row) */
  private async lookupBasePrice(
    p: { brand: string; model: string; storage: string | null },
    condition: string,
  ): Promise<Decimal | null> {
    const row = await this.prisma.tradeInValuation.findFirst({
      where: {
        brand: p.brand,
        model: p.model,
        storage: p.storage ?? '',
        condition,
        deletedAt: null,
      },
      select: { basePrice: true },
    });
    return row ? new Decimal(row.basePrice.toString()) : null;
  }

  /** MEMO เมื่อรุ่นเดียวกันและราคาเครื่องใหม่ = ราคาบนสัญญาเดิม (spec §4 — กัน price-list drift) */
  private detectMode(
    oldProduct: { brand: string; model: string; storage: string | null },
    newProduct: { brand: string; model: string; storage: string | null },
    newPrice: Decimal,
    oldContractSellingPrice: Decimal,
  ): 'MEMO' | 'PRICED' {
    const sameModel =
      oldProduct.brand === newProduct.brand &&
      oldProduct.model === newProduct.model &&
      oldProduct.storage === newProduct.storage;
    return sameModel && newPrice.equals(oldContractSellingPrice) ? 'MEMO' : 'PRICED';
  }

  /**
   * Compute the actual outstanding balance per account for the old contract,
   * from the real ledger (journal_lines). Replaces the previous straight-line
   * proration which silently missed:
   *   - reschedules (21-1103 reclassifications, JP6a/6b)
   *   - VAT 60-day mandatory entries (21-2103)
   *   - tolerance over/under (53-1503 / 52-1104)
   *   - late fees, partial payments
   *   - early-payoff discounts (52-1106)
   *
   * Aggregation rules per account (sign convention = absolute outstanding,
   * so caller can use values directly as Cr amounts in the JE A.2 closing):
   *   - 11-2101 HP Receivable Gross  : Dr - Cr (debit-normal asset)
   *   - 11-2105 VAT Receivable       : Dr - Cr (debit-normal asset)
   *   - 11-2106 Unearned Interest    : Cr - Dr (contra-asset, credit-normal)
   *   - 21-2102 Deferred VAT Output  : Cr - Dr (liability, credit-normal)
   *
   * Lines are scoped to the contract via metadata.contractId (the consistent
   * tag across all templates) OR JournalEntry.referenceId (some templates set
   * this to the contractId — e.g. ContractActivation1ATemplate). Both filters
   * are ORed so a template using either convention is captured.
   */
  private async computeOldOutstanding(
    tx: Prisma.TransactionClient,
    oldContractId: string,
  ): Promise<{
    gross: Decimal;
    vatReceivable: Decimal;
    unearnedInterest: Decimal;
    deferredVat: Decimal;
  }> {
    const accounts = ['11-2101', '11-2105', '11-2106', '21-2102'];
    const lines = await tx.journalLine.findMany({
      where: {
        accountCode: { in: accounts },
        deletedAt: null,
        journalEntry: {
          deletedAt: null,
          status: 'POSTED',
          OR: [
            { referenceId: oldContractId },
            {
              metadata: {
                path: ['contractId'],
                equals: oldContractId,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any,
            },
          ],
        },
      },
      select: { accountCode: true, debit: true, credit: true },
    });

    const sums = new Map<string, { dr: Decimal; cr: Decimal }>();
    for (const code of accounts) sums.set(code, { dr: new Decimal(0), cr: new Decimal(0) });
    for (const line of lines) {
      const entry = sums.get(line.accountCode)!;
      entry.dr = entry.dr.plus(new Decimal(line.debit.toString()));
      entry.cr = entry.cr.plus(new Decimal(line.credit.toString()));
    }

    const debitNormal = (code: string) => {
      const s = sums.get(code)!;
      return s.dr.minus(s.cr).toDecimalPlaces(2);
    };
    const creditNormal = (code: string) => {
      const s = sums.get(code)!;
      return s.cr.minus(s.dr).toDecimalPlaces(2);
    };

    return {
      gross: debitNormal('11-2101'),
      vatReceivable: debitNormal('11-2105'),
      unearnedInterest: creditNormal('11-2106'),
      deferredVat: creditNormal('21-2102'),
    };
  }

  /**
   * Generate next exchange-contract number in format EXCH-YYYYMMDD-NNNN.
   * Sequence resets at Asia/Bangkok midnight. Advisory lock per BKK-day
   * prevents race conditions when 2 exchanges are approved concurrently.
   *
   * Issue #1086 item 4 — must NOT use EX- prefix (collides with the
   * ExpenseDocument grep used by accounting reports). Mirrors the
   * `RepairTicketDocNumberService` BKK-day-bounds + advisory-lock pattern.
   */
  private async nextExchangeContractNumber(
    tx: Prisma.TransactionClient,
    now: Date = new Date(),
  ): Promise<string> {
    const yyyymmdd = this.bkkYyyymmdd(now);
    const lockKey = this.hashLockKey(`exch:${yyyymmdd}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    const last = await tx.contract.findFirst({
      where: { contractNumber: { startsWith: `EXCH-${yyyymmdd}-` } },
      orderBy: { contractNumber: 'desc' },
      select: { contractNumber: true },
    });
    const lastSeq = last ? parseInt(last.contractNumber.split('-')[2], 10) || 0 : 0;
    const seq = String(lastSeq + 1).padStart(4, '0');
    return `EXCH-${yyyymmdd}-${seq}`;
  }

  private bkkYyyymmdd(date: Date): string {
    const parts = date.toLocaleString('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const [y, m, d] = parts.split('-').map((s) => parseInt(s, 10));
    return `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
  }

  private hashLockKey(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = (h * 31 + key.charCodeAt(i)) | 0;
    }
    return h;
  }
}
