import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { ExecuteDefectExchangeDto } from './dto/defect-exchange.dto';
import { generateContractNumber } from '../../utils/sequence.util';
import { Decimal } from '@prisma/client/runtime/library';

const DEFECT_WINDOW_DAYS = 7;
const ELIGIBLE_CATEGORIES = ['PHONE_USED'];

@Injectable()
export class DefectExchangeService {
  private readonly logger = new Logger(DefectExchangeService.name);

  constructor(
    private prisma: PrismaService,
    private journalAutoService: JournalAutoService,
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
    };
  }

  /**
   * Execute a 7-day defect exchange (MANAGER only):
   *   - Close old contract → DEFECT_EXCHANGED
   *   - Create new contract with IDENTICAL terms
   *   - Transfer already-paid amounts as credit to new contract (amountPaid)
   *   - Old product → DEFECT_RETURN
   *   - New product → RESERVED (→ SOLD_INSTALLMENT on activate)
   *   - Reversal journal on old + new activation journal (net zero until new activates)
   */
  async execute(dto: ExecuteDefectExchangeDto, userId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const elig = await this.checkEligibility(dto.oldContractId, dto.newProductId);
        if (!elig.eligible) {
          throw new BadRequestException(`ไม่เข้าเกณฑ์: ${elig.reasons.join(', ')}`);
        }

        const oldContract = await tx.contract.findUnique({
          where: { id: dto.oldContractId },
          include: { product: true, payments: true },
        });
        if (!oldContract) throw new NotFoundException('ไม่พบสัญญา');

        const newProductRec = await tx.product.findUnique({ where: { id: dto.newProductId } });
        if (!newProductRec) throw new NotFoundException('ไม่พบสินค้าใหม่');

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

        // TODO Phase A.5: implement DefectExchangeReversalTemplate (reverse CONTRACT + CONTRACT_COGS JEs)
        // originalJe and cogsJe lookups preserved below for when A.5 is ready
        const originalJe = await tx.journalEntry.findFirst({
          where: { referenceType: 'CONTRACT', referenceId: oldContract.id, deletedAt: null },
          orderBy: { createdAt: 'asc' },
        });
        if (originalJe) {
          this.logger.warn(
            `[Phase A.4] Defect exchange reversal JE skipped for contract ${oldContract.contractNumber} (CONTRACT) — TODO Phase A.5: implement DefectExchangeReversalTemplate`,
          );
        }
        const cogsJe = await tx.journalEntry.findFirst({
          where: { referenceType: 'CONTRACT_COGS', referenceId: oldContract.id, deletedAt: null },
          orderBy: { createdAt: 'asc' },
        });
        if (cogsJe) {
          this.logger.warn(
            `[Phase A.4] Defect exchange reversal JE skipped for contract ${oldContract.contractNumber} (CONTRACT_COGS) — TODO Phase A.5: implement DefectExchangeReversalTemplate`,
          );
        }

        // Total paid by customer on old contract = down payment + sum of installment payments received
        const paidInstallments = oldContract.payments
          .filter((p) => p.status === 'PAID' || Number(p.amountPaid) > 0)
          .reduce((sum, p) => sum.add(new Decimal(p.amountPaid)), new Decimal(0));

        // Create new contract — copy terms verbatim, link to old
        const contractNumber = await generateContractNumber(tx);
        const newContract = await tx.contract.create({
          data: {
            contractNumber,
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

        // Copy payment schedule from old (same dueDates, same amountDue, but reset amountPaid/status)
        const newPayments = oldContract.payments
          .sort((a, b) => a.installmentNo - b.installmentNo)
          .map((p) => ({
            contractId: newContract.id,
            installmentNo: p.installmentNo,
            dueDate: p.dueDate,
            amountDue: p.amountDue,
          }));
        if (newPayments.length > 0) {
          await tx.payment.createMany({ data: newPayments });
        }

        // If customer had already paid installments, credit them to new contract via creditBalance
        if (paidInstallments.greaterThan(0)) {
          await tx.contract.update({
            where: { id: newContract.id },
            data: { creditBalance: paidInstallments },
          });
        }

        // Reserve new product (will flip to SOLD_INSTALLMENT on activation)
        await tx.product.update({
          where: { id: dto.newProductId },
          data: { status: 'RESERVED' },
        });

        // Audit log
        await tx.auditLog.create({
          data: {
            userId,
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
              transferredCredit: paidInstallments.toNumber(),
              supplierClaimEligible: elig.supplierClaimEligible,
            },
            ipAddress: '',
          },
        });

        this.logger.log(
          `Defect exchange: ${oldContract.contractNumber} → ${contractNumber} (credit ${paidInstallments})`,
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
            creditBalance: paidInstallments.toNumber(),
          },
          supplierClaimEligible: elig.supplierClaimEligible,
        };
      },
      { isolationLevel: 'Serializable' },
    );
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
