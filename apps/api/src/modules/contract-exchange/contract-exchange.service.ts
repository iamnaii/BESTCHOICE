import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { hasCrossBranchAccess } from '../auth/branch-access.util';
import { SubmitExchangeRequestDto } from './dto/submit-exchange-request.dto';
import { ExchangeNewContract1ATemplate } from '../journal/cpa-templates/exchange-new-contract-1a.template';
import { ExchangeCloseOld21_1106Template } from '../journal/cpa-templates/exchange-close-old-21-1106.template';
import { ExchangeClearVendor21_1106Template } from '../journal/cpa-templates/exchange-clear-vendor-21-1106.template';
import { ShopExchangeReturnTemplate } from '../journal/cpa-templates/shop-exchange-return.template';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { computeExchangeTier, ExchangeTier } from './exchange-tier.util';
import { computeExchangePlan } from './exchange-plan.util';
import { glContractBalance } from '../journal/gl-contract-balance';

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
}

@Injectable()
export class ContractExchangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly t1a: ExchangeNewContract1ATemplate,
    private readonly t2: ExchangeCloseOld21_1106Template,
    private readonly t3: ExchangeClearVendor21_1106Template,
    private readonly t4: ShopExchangeReturnTemplate,
    private readonly companyResolver: CompanyResolverService,
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
      this.prisma.product.findUnique({ where: { id: dto.oldProductId } }) as Promise<ProductPriceSnapshot | null>,
      this.prisma.product.findUnique({ where: { id: dto.newProductId } }) as Promise<ProductPriceSnapshot | null>,
    ]);
    if (!oldRaw) throw new NotFoundException('ไม่พบเครื่องเดิม');
    if (!newRaw) throw new NotFoundException('ไม่พบเครื่องใหม่');
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

    // ขาเงินสดจะเกิดเมื่อ buyback ≠ vendorSum — บังคับเลือกบัญชีเงินตั้งแต่ submit
    const vendorSum = plan.financedAmount.plus(plan.storeCommission);
    if (!buyback.equals(vendorSum) && !dto.depositAccountCode) {
      throw new BadRequestException('กรุณาเลือกบัญชีเงินสด/ธนาคาร (ราคารับซื้อไม่เท่ากับเจ้าหนี้สัญญาใหม่)');
    }

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
      // TODO(Task 8): pass role + dto when approve() gains tier enforcement
      const approved = await this.approve(request.id, user.id);
      return { ...request, status: 'APPROVED', autoApproved: true, newContractId: approved.newContractId };
    }
    return request;
  }

  async buildPreview(params: {
    oldContractId: string;
    newProductId?: string;
    buybackPrice?: string;
    deviceCondition?: string;
    newTotalMonths?: number;
    newInterestRate?: string;
  }) {
    const oldContract = await this.prisma.contract.findUnique({ where: { id: params.oldContractId } });
    if (!oldContract || oldContract.deletedAt) throw new NotFoundException('ไม่พบสัญญาเดิม');
    const oldProduct = (await this.prisma.product.findUnique({
      where: { id: oldContract.productId },
    })) as any;

    const outstanding = await this.computeOldOutstanding(this.prisma as any, params.oldContractId);
    const ncv = outstanding.gross.minus(outstanding.unearnedInterest);
    const grossRemainingInclVat = outstanding.gross.plus(outstanding.vatReceivable);

    // Blockers (spec §7.0) — เตือนตั้งแต่ preview จะได้ไม่ไปตายตอน finalize
    const bal2103 = await glContractBalance(this.prisma as any, params.oldContractId, '11-2103', 'dr');
    const bal21_1103 = await glContractBalance(this.prisma as any, params.oldContractId, '21-1103', 'cr');
    const overdueBlocked = bal2103.abs().gte('0.005');
    const advanceBlocked =
      bal21_1103.gte('0.005') ||
      new Decimal(oldContract.advanceBalance.toString()).gt(0) ||
      new Decimal((oldContract as any).creditBalance?.toString() ?? '0').gt(0);
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
          mode = this.detectMode(oldProduct, newProduct, newPrice, new Decimal(oldContract.sellingPrice.toString()));
          if (mode === 'PRICED' && params.newTotalMonths) {
            const rate = params.newInterestRate
              ? new Decimal(params.newInterestRate)
              : new Decimal(oldContract.interestRate.toString());
            plan = computeExchangePlan({ newPrice, months: params.newTotalMonths, monthlyRate: rate });
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
      expectedPl = buyback.minus(grossRemainingInclVat); // − = loss (Dr 51-1102), + = gain (Cr 41-1102)
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
  async approve(id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
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
        include: { oldContract: true },
      });
      const old = req.oldContract;

      // 3. Remaining-installment plan
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
      const newInterest = monthlyPayment.times(remainingMonths).minus(newFinanced);

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
          totalMonths: remainingMonths,
          monthlyPayment,
          financedAmount: newFinanced,
          storeCommission: newCommission,
          interestTotal: newInterest,
          interestRate: old.interestRate,
          vatAmount: old.vatAmount,
          sellingPrice: old.sellingPrice,
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

      // 6. Link request to new contract (jeXIds are written later by
      // finalizeAfterActivation when the JE chain actually posts).
      await (tx as any).contractExchangeRequest.update({
        where: { id },
        data: {
          newContractId: newContract.id,
        },
      });

      // 7. Audit
      await this.audit.log({
        action: 'EXCHANGE_REQUEST_APPROVED',
        entity: 'contract_exchange_request',
        entityId: id,
        userId,
        newValue: {
          oldContractId: old.id,
          newContractId: newContract.id,
          remainingMonths,
          // Highlight the deferred-finalization design so an auditor scanning
          // the log understands no money has moved at this point.
          phase: 'awaiting-sign-then-activate',
        },
      });

      return {
        id,
        newContractId: newContract.id,
      };
    });
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
   *   - A.3 ExchangeClearVendor21_1106Template — clear vendor liability
   *   - A.4 ShopExchangeReturnTemplate — re-intake old device into SHOP inventory
   *   - flip OLD contract → EXCHANGED
   *   - flip OLD product → REFURBISHED + ownedByCompanyId = SHOP
   *   - write je*Id refs onto the exchange request
   *   - EXCHANGE_FINALIZED + EXCHANGE_DEVICE_RETURNED_TO_SHOP audit logs
   */
  async finalizeAfterActivation(
    newContract: ExchangeContractForFinalize,
    tx: Prisma.TransactionClient,
  ): Promise<{ je1aId: string; je2Id: string; je3Id: string; je4Id: string }> {
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

    // 3. Outstanding from the real ledger (not straight-line proration).
    const newFinanced = new Decimal(newContract.financedAmount.toString());
    const newCommission = newContract.storeCommission
      ? new Decimal(newContract.storeCommission.toString())
      : new Decimal(0);
    const buyback = newFinanced.plus(newCommission);
    const oldOutstanding = await this.computeOldOutstanding(tx, oldContractId);

    // 4. JE A.1 — open new HP receivable
    const je1a = await this.t1a.execute(newContract.id, tx);

    // 5. JE A.2 — close old contract's outstanding
    const je2 = await this.t2.execute(
      {
        oldContractId,
        buyback,
        oldGrossOutstanding: oldOutstanding.gross,
        oldVatReceivableOutstanding: oldOutstanding.vatReceivable,
        oldUnearnedInterestOutstanding: oldOutstanding.unearnedInterest,
        oldDeferredVatOutstanding: oldOutstanding.deferredVat,
      },
      tx,
    );

    // 6. JE A.3 — clear vendor liability for the new contract
    const je3 = await this.t3.execute(
      {
        newContractId: newContract.id,
        buyback,
        newVendorYodjat: newFinanced,
        newVendorCommission: newCommission,
      },
      tx,
    );

    // 7. JE A.4 — SHOP re-intake the old device.
    // Old product must have a costPrice so the inventory line lands correctly.
    const oldProduct = await tx.product.findUniqueOrThrow({
      where: { id: request.oldProductId },
      select: { id: true, costPrice: true },
    });
    if (oldProduct.costPrice == null) {
      throw new InternalServerErrorException(
        'ไม่พบ costPrice ของเครื่องเดิม — ตั้งค่าก่อน finalize เปลี่ยนเครื่อง',
      );
    }
    const cost = new Decimal(oldProduct.costPrice.toString());
    const je4 = await this.t4.execute(
      { oldProductId: request.oldProductId, oldContractId, cost },
      tx,
    );

    // 8. Old-side status flips
    await tx.contract.update({
      where: { id: oldContractId },
      data: { status: 'EXCHANGED', exchangedAt: new Date() } as any,
    });
    await tx.product.update({
      where: { id: request.oldProductId },
      data: { status: 'REFURBISHED', ownedByCompanyId: shopCompanyId } as any,
    });

    // 9. Link the JE ids onto the request row for traceability
    await (tx as any).contractExchangeRequest.update({
      where: { id: request.id },
      data: {
        je1aId: je1a.id,
        je2Id: je2.id,
        je3Id: je3.id,
        je4Id: je4.id,
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
        jeIds: { je1aId: je1a.id, je2Id: je2.id, je3Id: je3.id, je4Id: je4.id },
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
        cost: cost.toString(),
      },
    });

    return {
      je1aId: je1a.id,
      je2Id: je2.id,
      je3Id: je3.id,
      je4Id: je4.id,
    };
  }

  async reject(id: string, reason: string, userId: string) {
    if (reason.trim().length < 10) {
      throw new BadRequestException('เหตุผลปฏิเสธอย่างน้อย 10 ตัวอักษร');
    }
    return this.prisma.$transaction(async (tx) => {
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
      await this.audit.log({
        action: 'EXCHANGE_REQUEST_REJECTED',
        entity: 'contract_exchange_request',
        entityId: id,
        userId,
        newValue: { reason },
      });
      return (tx as any).contractExchangeRequest.findUniqueOrThrow({ where: { id } });
    });
  }

  async listPending(): Promise<any[]> {
    return (this.prisma as any).contractExchangeRequest.findMany({
      where: { status: 'PENDING', deletedAt: null },
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
