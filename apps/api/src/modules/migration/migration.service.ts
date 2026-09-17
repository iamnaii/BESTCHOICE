import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ImportCustomerDto, ImportContractDto, BulkImportDto } from './dto/import.dto';
import { generateContractNumber } from '../../utils/sequence.util';
import { normalizeThaiPhone } from '../../utils/thai-phone.util';
import { CustomerPiiService } from '../customers/customer-pii.service';
import { lockCustomerPhone } from '../customers/customer-phone-lock';
import { findLivePhoneOwner } from '../customers/customer-phone-owner';

/** เบอร์หลักของแถวนำเข้าเป็นของลูกค้าคนอื่นที่ยังไม่ถูกลบ (คำตัดสินเจ้าของ 2026-09-17 — ห้ามสองคนถือเบอร์หลักเดียวกัน) */
export const IMPORT_PHONE_TAKEN_MSG = 'เบอร์โทรนี้เป็นของลูกค้าคนอื่นในระบบแล้ว';

/** เลขบัตรของแถวนำเข้าชนกับลูกค้าเดิมที่ข้อมูลเลขบัตรไม่ตรงกัน (plaintext กับ hash อยู่คนละแถว) */
export const IMPORT_NATIONAL_ID_CONFLICT_MSG =
  'เลขบัตร ปชช. นี้ซ้ำกับลูกค้าในระบบที่ข้อมูลเลขบัตรไม่ตรงกัน — ต้องตรวจสอบด้วยมือ';

export interface ImportResult {
  success: number;
  failed: number;
  errors: { row: number; field?: string; message: string }[];
}

@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);

  constructor(
    private prisma: PrismaService,
    private pii: CustomerPiiService,
  ) {}

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
      // normalize ก่อนตรวจ/ล็อก/เขียน — กติกาเดียวกับผู้เขียนเบอร์หลักทุกทาง (hash ต้องมาจากค่าเดียวกัน)
      const phone = normalizeThaiPhone(c.phone) || '';
      if (!phone) {
        result.errors.push({ row, field: 'phone', message: 'เบอร์โทรห้ามว่าง' });
        result.failed++;
        continue;
      }
      const phoneSecondary =
        c.phoneSecondary === undefined ? undefined : normalizeThaiPhone(c.phoneSecondary) || '';

      try {
        const plain = {
          name: c.name,
          phone,
          phoneSecondary,
          // Legacy CSV `lineId` maps to `lineIdFinance` — historical imports were
          // all finance-side (FINANCE OA was the only customer LINE channel before
          // SHOP OA was added). Shop LINE IDs must be backfilled separately.
          lineIdFinance: c.lineId,
          addressIdCard: c.addressIdCard,
          addressCurrent: c.addressCurrent,
          occupation: c.occupation,
          workplace: c.workplace,
        };
        // dual-write เฉพาะคอลัมน์ PII ที่แถวนี้เขียนจริง (undefined = ไม่แตะ)
        const enc = this.pii.encryptCustomerFields({
          nationalId: c.nationalId,
          phone,
          phoneSecondary,
          addressIdCard: c.addressIdCard,
          addressCurrent: c.addressCurrent,
        });
        const encrypted = {
          nationalIdEncrypted: enc.nationalIdEncrypted,
          nationalIdHash: enc.nationalIdHash,
          phoneEncrypted: enc.phoneEncrypted,
          phoneHash: enc.phoneHash,
          phoneSecondaryEncrypted: enc.phoneSecondaryEncrypted,
          addressIdCardEncrypted: enc.addressIdCardEncrypted,
          addressCurrentEncrypted: enc.addressCurrentEncrypted,
        };

        const outcome = await this.prisma.$transaction(async (tx) => {
          // ล็อกเบอร์หลักเป็นคำสั่งแรก (.claude/rules/database.md "ล็อกเบอร์หลักของลูกค้า")
          await lockCustomerPhone(tx, this.pii, phone);
          // แถวที่นำเข้าจะไปแตะ = เลขบัตรเดียวกัน (plaintext หรือ hash — แถวที่เหลือแต่ hash ก็คือคนเดียวกัน)
          // unique ทั้งสองคอลัมน์ครอบแถวที่ถูกลบด้วย จึงไม่กรอง deletedAt · ไม่นับเป็นเจ้าของเบอร์คนอื่น
          const nationalIdHash = enc.nationalIdHash;
          const target = await tx.customer.findFirst({
            where: {
              OR: [{ nationalId: c.nationalId }, ...(nationalIdHash ? [{ nationalIdHash }] : [])],
            },
            select: { id: true },
          });
          // นิยามเจ้าของเดียวกับ skip-tracing — ข้ามแถวที่ hash ค้างแต่ plaintext เป็นเบอร์อื่น
          const owner = await findLivePhoneOwner(
            tx,
            phone,
            enc.phoneHash,
            target ? [target.id] : [],
          );
          if (owner) return 'PHONE_TAKEN' as const;

          if (target) {
            await tx.customer.update({
              where: { id: target.id },
              // ไม่แตะ plaintext nationalId (เหมือน upsert เดิม) — แถวที่เหลือแต่ hash คงสภาพ strict
              data: { ...plain, ...encrypted },
            });
          } else {
            await tx.customer.create({
              data: { nationalId: c.nationalId, ...plain, ...encrypted },
            });
          }
          return 'OK' as const;
        });

        if (outcome === 'PHONE_TAKEN') {
          result.errors.push({ row, field: 'phone', message: IMPORT_PHONE_TAKEN_MSG });
          result.failed++;
          continue;
        }
        result.success++;
      } catch (err) {
        if ((err as { code?: string })?.code === 'P2002') {
          // unique ของ customers มีแค่ national_id / national_id_hash — เช่น แถวหนึ่งถือ plaintext อีกแถวถือ hash
          result.errors.push({ row, field: 'nationalId', message: IMPORT_NATIONAL_ID_CONFLICT_MSG });
          result.failed++;
          continue;
        }
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

        // Calculate financials (pure arithmetic — outside the tx)
        const principal = c.sellingPrice - c.downPayment;
        const interestTotal = principal * c.interestRate * c.totalMonths;
        const financedAmount = principal + interestTotal;
        const monthlyPayment = financedAmount / c.totalMonths;

        // Per-row atomicity: Product + Contract + Payments commit together or
        // not at all, so a failure mid-row leaves NO orphan Product (status
        // SOLD_INSTALLMENT) or Contract with a missing/partial payment schedule,
        // and no burnt contract-number sequence. Deliberately PER-ROW, not one
        // tx around the whole import: a multi-thousand-row historical import in
        // a single tx would hold one connection + locks for the entire run
        // (timeout/lock-contention risk) and turn one bad row into an
        // all-or-nothing rollback, destroying the per-row success/failed
        // reporting this method promises.
        await this.prisma.$transaction(async (tx) => {
          // Placeholder product for the imported contract
          const product = await tx.product.create({
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

          // Generate on the tx client so the sequence read rolls back with the
          // row if a later write fails.
          const contractNumber = await generateContractNumber(tx);

          const contract = await tx.contract.create({
            data: {
              contractNumber,
              customerId: customer.id,
              productId: product.id,
              branchId: branch.id,
              salespersonId: salesperson.id,
              planType: 'STORE_DIRECT',
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
              await tx.payment.create({
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
            await tx.payment.createMany({ data: payments });
          }
        });

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
