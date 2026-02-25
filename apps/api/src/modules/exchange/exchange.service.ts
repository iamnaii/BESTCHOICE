import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateExchangeDto } from './dto/create-exchange.dto';
import { Decimal } from '@prisma/client/runtime/library';

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

    // Calculate outstanding balance
    let remainingPrincipal = new Decimal(0);
    let remainingInterest = new Decimal(0);
    let totalLateFees = new Decimal(0);

    for (const payment of oldContract.payments) {
      if (['PENDING', 'OVERDUE', 'PARTIALLY_PAID'].includes(payment.status)) {
        const unpaid = payment.amountDue.minus(payment.amountPaid);
        remainingPrincipal = remainingPrincipal.plus(unpaid);
        totalLateFees = totalLateFees.plus(payment.lateFee);
      }
    }

    const outstandingBalance = remainingPrincipal.plus(totalLateFees);

    return {
      oldContract: {
        id: oldContract.id,
        contractNumber: oldContract.contractNumber,
        customer: oldContract.customer,
        product: oldContract.product,
        remainingPrincipal: Number(remainingPrincipal),
        totalLateFees: Number(totalLateFees),
        outstandingBalance: Number(outstandingBalance),
      },
      newProduct: {
        id: newProduct.id,
        name: newProduct.name,
        brand: newProduct.brand,
        model: newProduct.model,
        selectedPrice: {
          label: newPrice.label,
          amount: Number(newPrice.amount),
        },
      },
      summary: {
        outstandingBalance: Number(outstandingBalance),
        newProductPrice: Number(newPrice.amount),
        difference: Number(newPrice.amount) - Number(outstandingBalance),
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
        interestRate = config ? Number(config.value) : 0.08;
      }
      const minDownConfig = await tx.systemConfig.findUnique({ where: { key: 'min_down_payment_pct' } });
      const minDownPct = minDownConfig ? Number(minDownConfig.value) : 0.15;

      // Calculate new contract
      const sellingPrice = Number(newPrice.amount);
      const downPayment = dto.newDownPayment;
      const totalMonths = dto.newTotalMonths;

      // Validate down payment >= minimum percentage
      if (downPayment < sellingPrice * minDownPct) {
        throw new BadRequestException(
          `เงินดาวน์ต้องไม่น้อยกว่า ${(minDownPct * 100).toFixed(0)}% ของราคาสินค้า (ขั้นต่ำ ${(sellingPrice * minDownPct).toLocaleString()} บาท)`,
        );
      }

      // Validate total months
      if (totalMonths < 6 || totalMonths > 12) {
        throw new BadRequestException('จำนวนงวดต้องอยู่ระหว่าง 6-12 เดือน');
      }

      const interestTotal = sellingPrice * interestRate * totalMonths;
      const financedAmount = sellingPrice - downPayment + interestTotal;
      const monthlyPayment = financedAmount / totalMonths;

      // Generate new contract number
      const lastContract = await tx.contract.findFirst({
        orderBy: { contractNumber: 'desc' },
        select: { contractNumber: true },
      });
      const nextNum = lastContract
        ? parseInt(lastContract.contractNumber.replace(/\D/g, '')) + 1
        : 1;
      const contractNumber = `CT${String(nextNum).padStart(6, '0')}`;

      // Close old contract
      await tx.contract.update({
        where: { id: dto.oldContractId },
        data: { status: 'EXCHANGED' },
      });

      // Return old product to stock
      await tx.product.update({
        where: { id: oldContract.productId },
        data: { status: 'IN_STOCK' },
      });

      // Reserve new product
      await tx.product.update({
        where: { id: dto.newProductId },
        data: { status: 'RESERVED' },
      });

      // Create new contract
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
          status: 'ACTIVE',
          parentContractId: dto.oldContractId,
          notes: dto.notes || `เปลี่ยนเครื่องจากสัญญา ${oldContract.contractNumber}`,
        },
      });

      // Create payment schedule with proper date handling (avoids month overflow bug)
      const now = new Date();
      const payments: { contractId: string; installmentNo: number; dueDate: Date; amountDue: number }[] = [];
      for (let i = 1; i <= totalMonths; i++) {
        const dueDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
        // Ensure the date is correct even when month overflows (e.g., month 13+ wraps to next year)
        // JavaScript's Date constructor handles this automatically, but we normalize to 1st of month
        dueDate.setDate(1);
        dueDate.setHours(0, 0, 0, 0);
        payments.push({
          contractId: newContract.id,
          installmentNo: i,
          dueDate,
          amountDue: monthlyPayment,
        });
      }

      await tx.payment.createMany({ data: payments });

      // Update new product status to SOLD_INSTALLMENT
      await tx.product.update({
        where: { id: dto.newProductId },
        data: { status: 'SOLD_INSTALLMENT' },
      });

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
          monthlyPayment,
          totalMonths,
          financedAmount,
        },
      };
    });
  }
}
