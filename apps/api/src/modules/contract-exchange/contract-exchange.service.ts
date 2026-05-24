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
import { SubmitExchangeRequestDto } from './dto/submit-exchange-request.dto';
import { ExchangeNewContract1ATemplate } from '../journal/cpa-templates/exchange-new-contract-1a.template';
import { ExchangeCloseOld21_1106Template } from '../journal/cpa-templates/exchange-close-old-21-1106.template';
import { ExchangeClearVendor21_1106Template } from '../journal/cpa-templates/exchange-clear-vendor-21-1106.template';

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

@Injectable()
export class ContractExchangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly t1a: ExchangeNewContract1ATemplate,
    private readonly t2: ExchangeCloseOld21_1106Template,
    private readonly t3: ExchangeClearVendor21_1106Template,
  ) {}

  async submit(dto: SubmitExchangeRequestDto, user: RequestUser) {
    // 1. Old contract must exist + ACTIVE + not deleted
    const oldContract = await this.prisma.contract.findUnique({
      where: { id: dto.oldContractId },
    });
    if (!oldContract || oldContract.deletedAt) {
      throw new NotFoundException('ไม่พบสัญญาเดิม');
    }

    // Branch scoping (in-service because the DTO doesn't carry branchId — see
    // issue #1086 item 2). BranchGuard isn't reachable from oldContractId
    // without an extra controller-level resolver; doing the check here keeps
    // the existing controller surface area unchanged.
    if (!hasCrossBranchAccess(user) && oldContract.branchId !== user.branchId) {
      throw new ForbiddenException('ไม่สามารถสร้างคำขอเปลี่ยนเครื่องของสาขาอื่นได้');
    }

    if (oldContract.status !== 'ACTIVE') {
      throw new BadRequestException(`สัญญาเดิมสถานะ ${oldContract.status} — ต้องเป็น ACTIVE`);
    }

    // 2. Old + new products: same brand+model+storage+sellingPrice; new IN_STOCK
    // We cast to ProductPriceSnapshot — test mocks expose `sellingPrice`,
    // production Prisma returns `installmentPrice`. The helper below normalises both.
    const [oldRaw, newRaw] = await Promise.all([
      this.prisma.product.findUnique({ where: { id: dto.oldProductId } }) as Promise<ProductPriceSnapshot | null>,
      this.prisma.product.findUnique({ where: { id: dto.newProductId } }) as Promise<ProductPriceSnapshot | null>,
    ]);

    if (!oldRaw) throw new NotFoundException('ไม่พบเครื่องเดิม');
    if (!newRaw) throw new NotFoundException('ไม่พบเครื่องใหม่');

    const oldProduct = oldRaw as any;
    const newProduct = newRaw as any;

    // Resolve whichever price field is populated (installmentPrice in prod, sellingPrice in tests).
    // Return null when both fields are null/missing so the caller can reject — silently
    // coercing to 0 would let two null-priced products pass the same-price check.
    // (Issue #1086 item 1.)
    const resolvePriceOrNull = (p: any): Decimal | null => {
      const raw = p?.sellingPrice ?? p?.installmentPrice;
      if (raw === null || raw === undefined) return null;
      return new Decimal((raw as { toString(): string } | string).toString());
    };

    const oldPrice = resolvePriceOrNull(oldProduct);
    const newPrice = resolvePriceOrNull(newProduct);
    if (oldPrice === null || newPrice === null) {
      throw new BadRequestException('ราคาเครื่องไม่ถูกตั้งค่า — ตรวจสอบเครื่องในระบบ');
    }

    if (newProduct.status !== 'IN_STOCK') {
      throw new BadRequestException('เครื่องใหม่ต้องอยู่ในสต็อก (IN_STOCK)');
    }
    if (
      oldProduct.brand !== newProduct.brand ||
      oldProduct.model !== newProduct.model ||
      oldProduct.storage !== newProduct.storage
    ) {
      throw new BadRequestException('เครื่องใหม่ต้องเป็นรุ่นเดียวกัน (brand/model/storage)');
    }
    if (!oldPrice.equals(newPrice)) {
      throw new BadRequestException(`ราคาเครื่องใหม่ต้องเท่ากับเครื่องเดิม (${oldPrice} vs ${newPrice})`);
    }

    // 3. Create PENDING request
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.prisma as any).contractExchangeRequest.create({
      data: {
        oldContractId: dto.oldContractId,
        oldProductId: dto.oldProductId,
        newProductId: dto.newProductId,
        conditionNote: dto.conditionNote,
        conditionPhotos: dto.conditionPhotos ?? [],
        status: 'PENDING',
        requestedById: user.id,
      },
    });
  }

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

      // 4. Create new contract (mirror old plan w/ remaining months)
      const newContract = await tx.contract.create({
        data: {
          contractNumber: `EX-${Date.now()}`,
          customerId: old.customerId,
          productId: req.newProductId,
          branchId: old.branchId,
          salespersonId: old.salespersonId,
          status: 'ACTIVE',
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
          creditBalance: new Decimal(0),
          contractDate: new Date(),
          exchangedFromContractId: old.id,
        } as any,
      });

      // 5. Post JE chain atomically
      const buyback = newFinanced.plus(newCommission);
      const oldOutstanding = await this.computeOldOutstanding(tx, old, paidCount);

      const je1a = await this.t1a.execute(newContract.id, tx);
      const je2 = await this.t2.execute(
        {
          oldContractId: old.id,
          buyback,
          oldGrossOutstanding: oldOutstanding.gross,
          oldVatReceivableOutstanding: oldOutstanding.vatReceivable,
          oldUnearnedInterestOutstanding: oldOutstanding.unearnedInterest,
          oldDeferredVatOutstanding: oldOutstanding.deferredVat,
        },
        tx,
      );
      const je3 = await this.t3.execute(
        {
          newContractId: newContract.id,
          buyback,
          newVendorYodjat: newFinanced,
          newVendorCommission: newCommission,
        },
        tx,
      );

      // 6. Status flips
      await tx.contract.update({
        where: { id: old.id },
        data: { status: 'EXCHANGED', exchangedAt: new Date() } as any,
      });
      await tx.product.update({
        where: { id: req.oldProductId },
        data: { status: 'REFURBISHED' },
      });

      // 7. Link request to outputs
      await (tx as any).contractExchangeRequest.update({
        where: { id },
        data: {
          newContractId: newContract.id,
          je1aId: je1a.id,
          je2Id: je2.id,
          je3Id: je3.id,
        },
      });

      // 8. Audit
      await this.audit.log({
        action: 'EXCHANGE_REQUEST_APPROVED',
        entity: 'contract_exchange_request',
        entityId: id,
        userId,
        newValue: {
          oldContractId: old.id,
          newContractId: newContract.id,
          buyback: buyback.toString(),
          remainingMonths,
        },
      });

      return { id, newContractId: newContract.id, je1aId: je1a.id, je2Id: je2.id, je3Id: je3.id };
    });
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

  private async computeOldOutstanding(
    tx: Prisma.TransactionClient,
    old: {
      id: string;
      totalMonths: number;
      monthlyPayment: { toString(): string };
      vatAmount: { toString(): string } | null;
      interestTotal: { toString(): string };
    },
    paidCount: number,
  ) {
    const remaining = old.totalMonths - paidCount;
    const monthly = new Decimal(old.monthlyPayment.toString());
    const totalVat = old.vatAmount ? new Decimal(old.vatAmount.toString()) : new Decimal(0);
    const vatPerMonth = totalVat.div(old.totalMonths);
    const grossExclVatPerMonth = monthly.minus(vatPerMonth);
    return {
      gross: grossExclVatPerMonth.times(remaining).toDecimalPlaces(2),
      vatReceivable: vatPerMonth.times(remaining).toDecimalPlaces(2),
      unearnedInterest: new Decimal(old.interestTotal.toString())
        .div(old.totalMonths)
        .times(remaining)
        .toDecimalPlaces(2),
      deferredVat: vatPerMonth.times(remaining).toDecimalPlaces(2),
    };
  }
}
