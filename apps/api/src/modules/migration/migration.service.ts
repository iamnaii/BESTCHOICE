import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ImportCustomerDto, ImportContractDto, BulkImportDto } from './dto/import.dto';

export interface ImportResult {
  success: number;
  failed: number;
  errors: { row: number; field?: string; message: string }[];
}

@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Validate Thai national ID (13 digits with checksum)
   */
  private validateNationalId(id: string): boolean {
    if (!/^\d{13}$/.test(id)) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += parseInt(id[i]) * (13 - i);
    }
    const checkDigit = (11 - (sum % 11)) % 10;
    return checkDigit === parseInt(id[12]);
  }

  /**
   * Import customers from CSV/JSON data
   */
  async importCustomers(customers: ImportCustomerDto[]): Promise<ImportResult> {
    const result: ImportResult = { success: 0, failed: 0, errors: [] };

    for (let i = 0; i < customers.length; i++) {
      const row = i + 1;
      const c = customers[i];

      // Validate
      if (!c.name?.trim()) {
        result.errors.push({ row, field: 'name', message: 'ชื่อห้ามว่าง' });
        result.failed++;
        continue;
      }
      if (!c.nationalId?.trim()) {
        result.errors.push({ row, field: 'nationalId', message: 'เลขบัตร ปชช. ห้ามว่าง' });
        result.failed++;
        continue;
      }
      if (!this.validateNationalId(c.nationalId)) {
        result.errors.push({ row, field: 'nationalId', message: 'เลขบัตร ปชช. ไม่ถูกต้อง' });
        result.failed++;
        continue;
      }
      if (!c.phone?.trim()) {
        result.errors.push({ row, field: 'phone', message: 'เบอร์โทรห้ามว่าง' });
        result.failed++;
        continue;
      }

      try {
        // Upsert: if nationalId exists, update; else create
        await this.prisma.customer.upsert({
          where: { nationalId: c.nationalId },
          update: {
            name: c.name,
            phone: c.phone,
            phoneSecondary: c.phoneSecondary,
            lineId: c.lineId,
            addressIdCard: c.addressIdCard,
            addressCurrent: c.addressCurrent,
            occupation: c.occupation,
            workplace: c.workplace,
          },
          create: {
            nationalId: c.nationalId,
            name: c.name,
            phone: c.phone,
            phoneSecondary: c.phoneSecondary,
            lineId: c.lineId,
            addressIdCard: c.addressIdCard,
            addressCurrent: c.addressCurrent,
            occupation: c.occupation,
            workplace: c.workplace,
          },
        });
        result.success++;
      } catch (err) {
        result.errors.push({ row, message: err instanceof Error ? err.message : 'Unknown error' });
        result.failed++;
      }
    }

    this.logger.log(`Customer import: ${result.success} success, ${result.failed} failed`);
    return result;
  }

  /**
   * Import contracts with payment schedules
   */
  async importContracts(contracts: ImportContractDto[]): Promise<ImportResult> {
    const result: ImportResult = { success: 0, failed: 0, errors: [] };

    for (let i = 0; i < contracts.length; i++) {
      const row = i + 1;
      const c = contracts[i];

      try {
        // Look up customer by national ID
        const customer = await this.prisma.customer.findUnique({
          where: { nationalId: c.customerNationalId },
        });
        if (!customer) {
          result.errors.push({ row, field: 'customerNationalId', message: `ไม่พบลูกค้า: ${c.customerNationalId}` });
          result.failed++;
          continue;
        }

        // Look up branch by name
        const branch = await this.prisma.branch.findFirst({
          where: { name: { contains: c.branchName, mode: 'insensitive' } },
        });
        if (!branch) {
          result.errors.push({ row, field: 'branchName', message: `ไม่พบสาขา: ${c.branchName}` });
          result.failed++;
          continue;
        }

        // Look up salesperson
        const salesperson = await this.prisma.user.findFirst({
          where: { email: c.salespersonEmail },
        });
        if (!salesperson) {
          result.errors.push({ row, field: 'salespersonEmail', message: `ไม่พบพนักงาน: ${c.salespersonEmail}` });
          result.failed++;
          continue;
        }

        // Create a placeholder product for imported contracts
        const product = await this.prisma.product.create({
          data: {
            name: c.productName,
            brand: 'Imported',
            model: c.productName,
            category: 'PHONE_USED',
            costPrice: 0,
            branchId: branch.id,
            status: 'SOLD_INSTALLMENT',
          },
        });

        // Generate contract number
        const lastContract = await this.prisma.contract.findFirst({
          orderBy: { contractNumber: 'desc' },
          select: { contractNumber: true },
        });
        const nextNum = lastContract
          ? parseInt(lastContract.contractNumber.replace(/\D/g, '')) + 1
          : 1;
        const contractNumber = `CT${String(nextNum).padStart(6, '0')}`;

        // Calculate financials
        const principal = c.sellingPrice - c.downPayment;
        const interestTotal = principal * c.interestRate * c.totalMonths;
        const financedAmount = principal + interestTotal;
        const monthlyPayment = financedAmount / c.totalMonths;

        const contract = await this.prisma.contract.create({
          data: {
            contractNumber,
            customerId: customer.id,
            productId: product.id,
            branchId: branch.id,
            salespersonId: salesperson.id,
            planType: c.planType as 'STORE_DIRECT' | 'CREDIT_CARD' | 'STORE_WITH_INTEREST',
            sellingPrice: c.sellingPrice,
            downPayment: c.downPayment,
            interestRate: c.interestRate,
            totalMonths: c.totalMonths,
            interestTotal,
            financedAmount,
            monthlyPayment,
            status: c.status as 'ACTIVE' | 'OVERDUE' | 'COMPLETED',
            createdAt: c.createdAt ? new Date(c.createdAt) : undefined,
          },
        });

        // Create payment schedule
        if (c.payments && c.payments.length > 0) {
          for (const p of c.payments) {
            await this.prisma.payment.create({
              data: {
                contractId: contract.id,
                installmentNo: p.installmentNo,
                dueDate: new Date(p.dueDate),
                amountDue: p.amountDue,
                amountPaid: p.amountPaid,
                status: p.status as 'PENDING' | 'PAID' | 'PARTIALLY_PAID' | 'OVERDUE',
                paidDate: p.paidDate ? new Date(p.paidDate) : null,
              },
            });
          }
        } else {
          // Auto-generate payment schedule
          const createdAt = c.createdAt ? new Date(c.createdAt) : new Date();
          const payments: { contractId: string; installmentNo: number; dueDate: Date; amountDue: number; status: 'PENDING' }[] = [];
          for (let m = 1; m <= c.totalMonths; m++) {
            const dueDate = new Date(createdAt.getFullYear(), createdAt.getMonth() + m, 1);
            payments.push({
              contractId: contract.id,
              installmentNo: m,
              dueDate,
              amountDue: monthlyPayment,
              status: 'PENDING' as const,
            });
          }
          await this.prisma.payment.createMany({ data: payments });
        }

        result.success++;
      } catch (err) {
        result.errors.push({ row, message: err instanceof Error ? err.message : 'Unknown error' });
        result.failed++;
      }
    }

    this.logger.log(`Contract import: ${result.success} success, ${result.failed} failed`);
    return result;
  }

  /**
   * Bulk import customers and contracts
   */
  async bulkImport(dto: BulkImportDto) {
    const results: { customers?: ImportResult; contracts?: ImportResult } = {};

    if (dto.customers && dto.customers.length > 0) {
      results.customers = await this.importCustomers(dto.customers);
    }

    if (dto.contracts && dto.contracts.length > 0) {
      results.contracts = await this.importContracts(dto.contracts);
    }

    return results;
  }

  /**
   * Get migration status / data count summary
   */
  async getMigrationStatus() {
    const [customers, contracts, payments, products, branches, users] = await Promise.all([
      this.prisma.customer.count({ where: { deletedAt: null } }),
      this.prisma.contract.count({ where: { deletedAt: null } }),
      this.prisma.payment.count(),
      this.prisma.product.count({ where: { deletedAt: null } }),
      this.prisma.branch.count({ where: { isActive: true } }),
      this.prisma.user.count({ where: { isActive: true } }),
    ]);

    return { customers, contracts, payments, products, branches, users };
  }
}
