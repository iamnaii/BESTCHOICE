import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateExchangeDto } from './dto/create-exchange.dto';
import { Decimal } from '@prisma/client/runtime/library';
import { generateContractNumber } from '../../utils/sequence.util';
import { calculateInstallment } from '../../utils/installment.util';

@Injectable()
export class ExchangeService {
  private readonly logger = new Logger(ExchangeService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Calculate exchange quote - outstanding balance + new device cost
   */
  async getExchangeQuote(oldContractId: string, newProductId: string, newPriceId: string) {
    const oldContract = await this.prisma.contract.findUnique({
      where: { id: oldContractId },
      include: {
        payments: { orderBy: { installmentNo: 'asc' } },
        customer: { select: { id: true, name: true } },
        product: { select: { id: true, name: true, brand: true, model: true } },
      },
    });

    if (!oldContract) throw new NotFoundException('ไม่พบสัญญาเดิม');
    if (!['ACTIVE', 'OVERDUE'].includes(oldContract.status)) {
      throw new BadRequestException('สัญญานี้ไม่สามารถเปลี่ยนเครื่องได้');
    }

    const newProduct = await this.prisma.product.findUnique({
      where: { id: newProductId },
      include: { prices: true },
    });

    if (!newProduct) throw new NotFoundException('ไม่พบสินค้าใหม่');
    if (newProduct.status !== 'IN_STOCK') {
      throw new BadRequestException('สินค้าใหม่ไม่พร้อมจำหน่าย');
    }

    const newPrice = newProduct.prices.find((p) => p.id === newPriceId);
    if (!newPrice) throw new NotFoundException('ไม่พบราคาที่เลือก');

    // Calculate outstanding balance (all unpaid payments)
    let remainingPrincipal = new Decimal(0);
    let totalLateFees = new Decimal(0);

    for (const payment of oldContract.payments) {
      if (payment.status !== 'PAID') {
        const unpaid = payment.amountDue.minus(payment.amountPaid);
        remainingPrincipal = remainingPrincipal.plus(unpaid);
        totalLateFees = totalLateFees.plus(payment.lateFee);
      }
    }

    const outstandingBalance = remainingPrincipal.plus(totalLateFees);

    const decNewPrice = new Decimal(newPrice.amount);
    const decDifference = decNewPrice.minus(outstandingBalance);

    return {
      oldContract: {
        id: oldContract.id,
        contractNumber: oldContract.contractNumber,
        customer: oldContract.customer,
        product: oldContract.product,
        remainingPrincipal: remainingPrincipal.toNumber(),
        totalLateFees: totalLateFees.toNumber(),
        outstandingBalance: outstandingBalance.toNumber(),
      },
      newProduct: {
        id: newProduct.id,
        name: newProduct.name,
        brand: newProduct.brand,
        model: newProduct.model,
        selectedPrice: {
          label: newPrice.label,
          amount: decNewPrice.toNumber(),
        },
      },
      summary: {
        outstandingBalance: outstandingBalance.toNumber(),
        newProductPrice: decNewPrice.toNumber(),
        difference: decDifference.toNumber(),
      },
    };
  }

  /**
   * Execute device exchange: close old contract + create new one
   */
  async executeExchange(dto: CreateExchangeDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Validate old contract
      const oldContract = await tx.contract.findUnique({
        where: { id: dto.oldContractId },
        include: { payments: true, customer: true },
      });

      if (!oldContract) throw new NotFoundException('ไม่พบสัญญาเดิม');
      if (!['ACTIVE', 'OVERDUE'].includes(oldContract.status)) {
        throw new BadRequestException('สัญญานี้ไม่สามารถเปลี่ยนเครื่องได้');
      }

      // Validate new product
      const newProduct = await tx.product.findUnique({
        where: { id: dto.newProductId },
        include: { prices: true },
      });

      if (!newProduct) throw new NotFoundException('ไม่พบสินค้าใหม่');
      if (newProduct.status !== 'IN_STOCK') {
        throw new BadRequestException('สินค้าใหม่ไม่พร้อมจำหน่าย');
      }

      const newPrice = newProduct.prices.find((p) => p.id === dto.newPriceId);
      if (!newPrice) throw new NotFoundException('ไม่พบราคาที่เลือก');

      // Get interest rate and min down payment config
      let interestRate = dto.newInterestRate;
      if (!interestRate) {
        const config = await tx.systemConfig.findUnique({ where: { key: 'interest_rate' } });
        interestRate = config ? parseFloat(config.value) : 0.08;
      }
      const minDownConfig = await tx.systemConfig.findUnique({ where: { key: 'min_down_payment_pct' } });
      const minDownPct = minDownConfig ? parseFloat(minDownConfig.value) : 0.15;

      // Calculate outstanding balance from old contract (using Decimal for precision)
      let decOutstanding = new Decimal(0);
      for (const payment of oldContract.payments) {
        if (payment.status !== 'PAID') {
          const unpaid = payment.amountDue.minus(payment.amountPaid).plus(payment.lateFee);
          decOutstanding = decOutstanding.plus(unpaid);
        }
      }

      // Calculate new contract using Decimal arithmetic
      const decSellingPrice = new Decimal(newPrice.amount);
      const decDownPayment = new Decimal(dto.newDownPayment);
      const downPayment = dto.newDownPayment;
      const totalMonths = dto.newTotalMonths;
      const sellingPrice = decSellingPrice.toNumber();

      // Validate down payment >= minimum percentage (Decimal comparison)
      const decMinDown = decSellingPrice.mul(minDownPct);
      if (decDownPayment.lessThan(decMinDown)) {
        throw new BadRequestException(
          `เงินดาวน์ต้องไม่น้อยกว่า ${(minDownPct * 100).toFixed(0)}% ของราคาสินค้า (ขั้นต่ำ ${decMinDown.toNumber().toLocaleString()} บาท)`,
        );
      }

      // Read min/max months from config
      const [minMonthsConfig, maxMonthsConfig] = await Promise.all([
        tx.systemConfig.findUnique({ where: { key: 'min_installment_months' } }),
        tx.systemConfig.findUnique({ where: { key: 'max_installment_months' } }),
      ]);
      const minMonths = minMonthsConfig ? parseInt(minMonthsConfig.value) : 6;
      const maxMonths = maxMonthsConfig ? parseInt(maxMonthsConfig.value) : 12;

      if (totalMonths < minMonths || totalMonths > maxMonths) {
        throw new BadRequestException(`จำนวนงวดต้องอยู่ระหว่าง ${minMonths}-${maxMonths} เดือน`);
      }

      // Load store commission and VAT config
      const storeCommConfig = await tx.systemConfig.findUnique({ where: { key: 'store_commission_pct' } });
      const vatConfig = await tx.systemConfig.findUnique({ where: { key: 'vat_pct' } });
      const storeCommissionPct = storeCommConfig ? parseFloat(storeCommConfig.value) : 0.10;
      const vatPct = vatConfig ? parseFloat(vatConfig.value) : 0.07;

      // Include outstanding balance from old contract in the new principal
      // Use Decimal addition then convert for the utility function
      const totalPrincipal = decSellingPrice.plus(decOutstanding).toNumber();
      const result = calculateInstallment(
        totalPrincipal,
        downPayment,
        interestRate,
        totalMonths,
        storeCommissionPct,
        vatPct,
      );
      const { financedAmount, monthlyPayment, interestTotal } = result;

      // Generate new contract number
      const contractNumber = await generateContractNumber(tx);

      // Close old contract
      await tx.contract.update({
        where: { id: dto.oldContractId },
        data: { status: 'EXCHANGED' },
      });

      // Return old product to stock
      await tx.product.update({
        where: { id: oldContract.productId },
        data: { status: 'QC_PENDING' },
      });

      // Reserve new product
      await tx.product.update({
        where: { id: dto.newProductId },
        data: { status: 'RESERVED' },
      });

      // Look up InterestConfig for the new product
      const newProductFull = await tx.product.findUnique({ where: { id: dto.newProductId } });
      const interestConfigRecord = newProductFull
        ? await tx.interestConfig.findFirst({
            where: { isActive: true, productCategories: { has: newProductFull.category } },
          })
        : null;

      // Create new contract (DRAFT + CREATING workflow - requires approval)
      const newContract = await tx.contract.create({
        data: {
          contractNumber,
          customerId: oldContract.customerId,
          productId: dto.newProductId,
          branchId: oldContract.branchId,
          salespersonId: userId,
          planType: oldContract.planType,
          sellingPrice,
          downPayment,
          interestRate,
          totalMonths,
          interestTotal,
          financedAmount,
          monthlyPayment,
          status: 'DRAFT',
          workflowStatus: 'CREATING',
          paymentDueDay: oldContract.paymentDueDay,
          interestConfigId: interestConfigRecord?.id,
          parentContractId: dto.oldContractId,
          notes: dto.notes || `เปลี่ยนเครื่องจากสัญญา ${oldContract.contractNumber}`,
        },
      });

      // Create payment schedule with custom due day inherited from old contract
      const now = new Date();
      const dueDay = oldContract.paymentDueDay || 1;
      const payments: { contractId: string; installmentNo: number; dueDate: Date; amountDue: number }[] = [];
      for (let i = 1; i <= totalMonths; i++) {
        const dueMonth = now.getMonth() + i;
        const dueYear = now.getFullYear() + Math.floor(dueMonth / 12);
        const adjustedMonth = dueMonth % 12;
        // Clamp dueDay to last day of the target month to prevent overflow
        // (e.g., day 31 in a 30-day month would roll into next month)
        const lastDayOfMonth = new Date(dueYear, adjustedMonth + 1, 0).getDate();
        const clampedDay = Math.min(dueDay, lastDayOfMonth);
        // Last installment adjusts for Math.ceil rounding to avoid overcharging
        const isLast = i === totalMonths;
        const amount = isLast ? financedAmount - monthlyPayment * (totalMonths - 1) : monthlyPayment;
        payments.push({
          contractId: newContract.id,
          installmentNo: i,
          dueDate: new Date(dueYear, adjustedMonth, clampedDay),
          amountDue: amount,
        });
      }

      await tx.payment.createMany({ data: payments });

      // Reserve new product (will become SOLD_INSTALLMENT when contract is activated after approval)
      // Note: product was already reserved above, this is now redundant but kept for clarity

      // Audit log for exchange
      await tx.auditLog.create({
        data: {
          userId,
          action: 'EXCHANGE',
          entity: 'contract',
          entityId: newContract.id,
          newValue: {
            oldContractId: oldContract.id,
            oldContractNumber: oldContract.contractNumber,
            newContractId: newContract.id,
            newContractNumber: contractNumber,
            newProductId: dto.newProductId,
            outstandingBalance: decOutstanding.toNumber(),
            downPayment,
            totalMonths,
            monthlyPayment,
          },
          ipAddress: '',
        },
      });

      this.logger.log(`Exchange completed: ${oldContract.contractNumber} → ${contractNumber}`);

      return {
        oldContract: { id: oldContract.id, contractNumber: oldContract.contractNumber, status: 'EXCHANGED' },
        newContract: {
          id: newContract.id,
          contractNumber: newContract.contractNumber,
          status: 'DRAFT',
          workflowStatus: 'CREATING',
          monthlyPayment,
          totalMonths,
          financedAmount,
        },
      };
    }, { isolationLevel: 'Serializable' });
  }
}
