import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRepossessionDto, UpdateRepossessionDto } from './dto/create-repossession.dto';
import { ConditionGrade, RepossessionStatus, ProductStatus } from '@prisma/client';
import { d, dAdd, dSub } from '../../utils/decimal.util';
import { JournalAutoService } from '../journal/journal-auto.service';
import { RepossessionJP5Template } from '../journal/cpa-templates/repossession-jp5.template';
import { Decimal } from '@prisma/client/runtime/library';

// VAT rate used to back out principal from VAT-inclusive amounts
const VAT_RATE = new Prisma.Decimal('1.07');
const TWO_DP = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

// Valid status transitions for repossession workflow
const VALID_TRANSITIONS: Record<string, string[]> = {
  REPOSSESSED: ['UNDER_REPAIR', 'READY_FOR_SALE'],
  UNDER_REPAIR: ['READY_FOR_SALE'],
  READY_FOR_SALE: ['SOLD'],
};

@Injectable()
export class RepossessionsService {
  private readonly logger = new Logger(RepossessionsService.name);

  constructor(
    private prisma: PrismaService,
    private journalAutoService: JournalAutoService,
    private repossessionJP5Template: RepossessionJP5Template,
  ) {}

  async findAll(filters: { status?: string; branchId?: string; page?: number; limit?: number }) {
    const where: Record<string, unknown> = { deletedAt: null };

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.branchId) {
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
            select: { id: true, name: true, brand: true, model: true, imeiSerial: true },
          },
          appraisedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.repossession.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Preview repossession P&L calculation for a contract.
   * Used by frontend to show live breakdown before creating.
   */
  async previewCalculation(contractId: string, options: { marketValue?: number; discountPct?: number; customerRefundEnabled?: boolean }) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        product: { select: { id: true, name: true, brand: true, model: true, costPrice: true } },
        customer: { select: { id: true, name: true, phone: true } },
        payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
      },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    // Use Prisma.Decimal throughout — chained Math.round on JS numbers
    // accumulates float drift on long installment plans (24+ months) and
    // can show users the wrong refund/profit by a few baht.
    let outstandingBalance = new Prisma.Decimal(0);
    let totalPaid = new Prisma.Decimal(0);
    let remainingMonths = 0;
    for (const p of contract.payments) {
      if (['PENDING', 'OVERDUE', 'PARTIALLY_PAID'].includes(p.status)) {
        const lateFee = p.lateFeeWaived ? new Prisma.Decimal(0) : new Prisma.Decimal(p.lateFee);
        outstandingBalance = outstandingBalance
          .add(p.amountDue)
          .sub(p.amountPaid)
          .add(lateFee);
        remainingMonths += 1;
      }
      totalPaid = totalPaid.add(p.amountPaid);
    }

    const financeCost = new Prisma.Decimal(contract.financedAmount).add(contract.storeCommission || 0);
    const remainingCost = TWO_DP(
      financeCost.div(contract.totalMonths).mul(remainingMonths),
    );
    const discountPct = new Prisma.Decimal(options.discountPct ?? 50);
    const principalExVat = TWO_DP(outstandingBalance.div(VAT_RATE));
    const discountableBase = Prisma.Decimal.max(0, principalExVat.sub(remainingCost));
    const discountAmount = TWO_DP(discountableBase.mul(discountPct).div(100));
    const closingAmount = TWO_DP(principalExVat.sub(discountAmount));
    // marketValue: ถ้าไม่ระบุให้ใช้ costPrice เป็น fallback
    const marketValue = new Prisma.Decimal(options.marketValue ?? contract.product.costPrice ?? 0);
    const customerRefund = options.customerRefundEnabled
      ? TWO_DP(Prisma.Decimal.max(0, marketValue.sub(closingAmount)))
      : new Prisma.Decimal(0);
    const profitLoss = TWO_DP(marketValue.sub(remainingCost).sub(customerRefund));

    // Internally calculated with Decimal for precision; return as numbers
    // since frontend uses .toLocaleString() and numeric comparisons.
    // The Decimal accumulators above guarantee no float drift; the .toNumber()
    // at the end is safe because each value is already rounded to 2 decimals.
    return {
      contract: {
        id: contract.id,
        contractNumber: contract.contractNumber,
        customer: contract.customer,
        product: { name: contract.product.name, brand: contract.product.brand, model: contract.product.model },
        totalMonths: contract.totalMonths,
        monthlyPayment: Number(contract.monthlyPayment),
        sellingPrice: Number(contract.sellingPrice),
        financedAmount: Number(contract.financedAmount),
        storeCommission: Number(contract.storeCommission || 0),
      },
      calculation: {
        remainingMonths,
        totalPaid: TWO_DP(totalPaid).toNumber(),
        outstandingBalance: TWO_DP(outstandingBalance).toNumber(),
        principalExVat: principalExVat.toNumber(),
        financeCost: TWO_DP(financeCost).toNumber(),
        remainingCost: remainingCost.toNumber(),
        discountPct: discountPct.toNumber(),
        discountAmount: discountAmount.toNumber(),
        closingAmount: closingAmount.toNumber(),
        marketValue: TWO_DP(marketValue).toNumber(),
        customerRefundEnabled: options.customerRefundEnabled || false,
        customerRefund: customerRefund.toNumber(),
        profitLoss: profitLoss.toNumber(),
      },
    };
  }

  async findOne(id: string) {
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
    return repo;
  }

  /**
   * Create repossession record and update contract/product statuses
   */
  async create(dto: CreateRepossessionDto, userId: string) {
    // Validate condition grade
    const validGrades = ['A', 'B', 'C', 'D'];
    if (!validGrades.includes(dto.conditionGrade)) {
      throw new BadRequestException(`เกรดสภาพต้องเป็น ${validGrades.join(', ')}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const contract = await tx.contract.findUnique({
        where: { id: dto.contractId },
        include: { product: true, payments: true },
      });

      if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
      if (!['DEFAULT', 'OVERDUE'].includes(contract.status)) {
        throw new BadRequestException('สัญญานี้ไม่อยู่ในสถานะที่สามารถยึดคืนได้');
      }

      // Check if product is already repossessed
      if (contract.product.status === 'REPOSSESSED') {
        throw new BadRequestException('สินค้านี้ถูกยึดคืนแล้ว');
      }

      // Calculate outstanding balance for profit/loss
      let outstandingBalance = new Prisma.Decimal(0);
      let totalPaid = new Prisma.Decimal(0);
      let remainingMonths = 0;
      for (const p of contract.payments) {
        if (['PENDING', 'OVERDUE', 'PARTIALLY_PAID'].includes(p.status)) {
          const lateFee = p.lateFeeWaived ? new Prisma.Decimal(0) : d(p.lateFee);
          outstandingBalance = dAdd(outstandingBalance, dSub(dAdd(d(p.amountDue), lateFee), d(p.amountPaid)));
          remainingMonths += 1;
        }
        totalPaid = dAdd(totalPaid, d(p.amountPaid));
      }

      // ─── FINANCE P&L Calculation (ex-VAT, FINANCE perspective) ───
      // ต้นทุน FINANCE = financedAmount + storeCommission (เงินที่ FINANCE จ่ายให้ SHOP)
      const financeCost = TWO_DP(dAdd(d(contract.financedAmount), d(contract.storeCommission || 0)));
      // ต้นทุนคงเหลือ = (ต้นทุน ÷ งวดทั้งหมด) × งวดคงค้าง
      const remainingCost = TWO_DP(financeCost.div(contract.totalMonths).mul(remainingMonths));
      // ส่วนลดให้ลูกค้า (default 50%)
      const discountPct = dto.discountPct ?? 50;
      // ค่างวดไม่รวม VAT = outstanding ÷ 1.07 (สำหรับโปรไฟล์ลูกค้าปิดบัญชีเอง — ไม่ใช้ในสูตรกำไร FINANCE)
      const principalExVat = TWO_DP(outstandingBalance.div(VAT_RATE));
      const discountAmount = TWO_DP(Prisma.Decimal.max(0, principalExVat.sub(remainingCost)).mul(discountPct).div(100));
      const closingAmount = TWO_DP(principalExVat.sub(discountAmount));
      // ราคากลางจาก trade-in pricing (auto) หรือจาก dto
      const marketValue = d(dto.marketValue ?? dto.appraisalPrice);
      // กำไร/ขาดทุน = ราคากลาง - ต้นทุนคงเหลือ - เงินคืนลูกค้า (ถ้าคืน)
      const customerRefund = dto.customerRefundEnabled
        ? TWO_DP(Prisma.Decimal.max(0, marketValue.sub(closingAmount)))
        : new Prisma.Decimal(0);
      const profitLoss = TWO_DP(marketValue.sub(remainingCost).sub(customerRefund));

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
          notes: dto.notes,
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
      if (outstandingBalance.greaterThan(0)) {
        const repoValue = dto.appraisalPrice != null
          ? new Decimal(String(dto.appraisalPrice))
          : new Decimal('0');
        await this.repossessionJP5Template.execute(
          {
            contractId: dto.contractId,
            depositAccountCode: '11-1101',
            repossessionValue: repoValue,
          },
          tx,
        );
      }

      // Update product status
      await tx.product.update({
        where: { id: contract.productId },
        data: {
          status: 'REPOSSESSED',
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
      };
    });
  }

  /**
   * Update repossession (repair cost, resell price, status) with workflow validation
   */
  async update(id: string, dto: UpdateRepossessionDto, userId?: string) {
    const repo = await this.findOne(id);

    const data: Record<string, unknown> = {};
    if (dto.repairCost !== undefined) data.repairCost = dto.repairCost;
    if (dto.resellPrice !== undefined) data.resellPrice = dto.resellPrice;
    if (dto.notes !== undefined) data.notes = dto.notes;

    if (dto.status) {
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
        const resellPrice = dto.resellPrice != null
          ? new Prisma.Decimal(dto.resellPrice)
          : new Prisma.Decimal(repo.resellPrice ?? 0);
        if (resellPrice.lessThanOrEqualTo(0)) {
          throw new BadRequestException('กรุณาระบุราคาขายต่อก่อนเปลี่ยนสถานะ');
        }
      }

      data.status = dto.status as RepossessionStatus;

      // Update product status based on repossession status
      const productStatusMap: Record<string, ProductStatus> = {
        UNDER_REPAIR: 'REPOSSESSED',
        READY_FOR_SALE: 'REFURBISHED',
        SOLD: 'SOLD_RESELL',
      };

      // If marking as SOLD, link to resell contract if provided
      if (dto.status === 'SOLD' && dto.soldContractId) {
        data.soldContractId = dto.soldContractId;
      }

      // Use transaction to ensure product status and repossession update are atomic
      const newProductStatus = productStatusMap[dto.status];
      if (newProductStatus) {
        const updatedRepo = await this.prisma.$transaction(async (tx) => {
          const productUpdateData: Record<string, unknown> = { status: newProductStatus };
          // R-007: Adjust costPrice to appraised/fair value per TAS 2 when moving to REFURBISHED
          // Wave 3 / Task 4 (W-2): Decimal arithmetic to preserve precision.
          if (dto.status === 'READY_FOR_SALE') {
            const appraisalPrice = dto.resellPrice != null
              ? new Prisma.Decimal(dto.resellPrice)
              : new Prisma.Decimal(repo.appraisalPrice ?? 0);
            if (appraisalPrice.greaterThan(0)) {
              productUpdateData.costPrice = appraisalPrice;
            }
          }
          await tx.product.update({
            where: { id: repo.product.id },
            data: productUpdateData,
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

        // Post resale JE after the main $transaction commits (non-blocking, no tx-poison risk).
        // bookValue = costPrice (adjusted to appraisalPrice at READY_FOR_SALE per R-007) + repairCost
        if (dto.status === 'SOLD' && userId) {
          // Wave 3 / Task 4 (W-2): build Decimal directly from repo value
          // (skip Number() round-trip that loses precision on large amounts).
          const resellPrice = dto.resellPrice != null
            ? new Prisma.Decimal(dto.resellPrice)
            : new Prisma.Decimal(repo.resellPrice ?? 0);
          const costPrice = new Prisma.Decimal(
            (repo.product as unknown as { costPrice?: number | Prisma.Decimal })?.costPrice ?? 0,
          );
          const repairCost = new Prisma.Decimal(repo.repairCost ?? 0);
          const bookValue = costPrice.add(repairCost);

          // Phase A.4b: Repossession resale JE deferred to Phase A.5 (SHOP-side accounting).
          // TODO Phase A.5: implement RepossessionResaleSHOPTemplate for SHOP-side JE.
          this.logger.warn(
            `Repossession resale JE skipped for repossession ${id} — deferred to A.5 SHOP-side accounting`,
          );
        }

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
   * Mark repossessed product as ready for sale with pricing
   * Creates ProductPrice and moves product to REFURBISHED + back to main warehouse
   */
  async markReadyForSale(id: string, resellPrice: number) {
    const repo = await this.findOne(id);

    if (repo.status !== 'UNDER_REPAIR' && repo.status !== 'REPOSSESSED') {
      throw new BadRequestException('สถานะไม่ถูกต้อง ต้องเป็น REPOSSESSED หรือ UNDER_REPAIR');
    }

    if (!resellPrice || resellPrice <= 0) {
      throw new BadRequestException('กรุณาระบุราคาขายต่อ');
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
          status: 'REFURBISHED',
          costPrice: appraisalPrice.greaterThan(0) ? appraisalPrice : new Prisma.Decimal(resellPrice),
          stockInDate: new Date(),
          ...(mainWarehouse ? { branchId: mainWarehouse.id } : {}),
        },
      });

      // Create/update selling price for refurbished product
      const existingPrice = await tx.productPrice.findFirst({
        where: { productId: repo.product.id, isDefault: true },
      });
      if (existingPrice) {
        await tx.productPrice.update({
          where: { id: existingPrice.id },
          data: { amount: resellPrice, label: 'ราคาขายต่อ (Refurbished)' },
        });
      } else {
        await tx.productPrice.create({
          data: {
            productId: repo.product.id,
            label: 'ราคาขายต่อ (Refurbished)',
            amount: resellPrice,
            isDefault: true,
          },
        });
      }

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
