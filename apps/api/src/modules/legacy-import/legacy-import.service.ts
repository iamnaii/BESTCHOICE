/**
 * Legacy Import Service — นำเข้าข้อมูลจากโปรแกรมเขียว (in-process, no subprocess)
 *
 * Phases:
 *   1. Wipe customer-related tables
 *   2. Ensure placeholders (company FINANCE, branch, legacy user)
 *   3. Import customers
 *   4. Import products + contracts + payments
 *   5. Validate 10 rules
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, ProductCategory, ProductStatus, PlanType, ContractStatus, ContractWorkflowStatus, PaymentStatus, UserRole } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { parseCsv } from './utils/csv-parser';
import { formatFullAddress } from './utils/thai-address';

type CsvRow = Record<string, string | null>;

export interface LegacyJobState {
  startedAt: Date;
  phase: string;
  logs: string[];
  done: boolean;
  error?: string;
  summary?: any;
}

@Injectable()
export class LegacyImportService {
  private readonly logger = new Logger('LegacyImport');
  private currentJob: LegacyJobState | null = null;

  getStatus(): LegacyJobState | { idle: true } {
    return this.currentJob || { idle: true };
  }

  isRunning(): boolean {
    return !!this.currentJob && !this.currentJob.done;
  }

  constructor(private readonly prisma: PrismaService) {}

  async execute(): Promise<void> {
    this.currentJob = { startedAt: new Date(), phase: 'starting', logs: [], done: false };
    const job = this.currentJob;
    const log = (msg: string) => {
      job.logs.push(msg);
      this.logger.log(msg);
    };

    try {
      log('═══ Legacy Import Started ═══');

      // Phase 1: Wipe
      job.phase = 'wipe';
      log('\n[1/5] Wiping customer-related data...');
      const wipeResult = await this.wipe();
      log(`  deleted ${wipeResult.total} rows total`);

      // Phase 2: Placeholders
      job.phase = 'placeholders';
      log('\n[2/5] Ensuring placeholders...');
      const ph = await this.ensurePlaceholders(log);

      // Phase 3-4: Customers + Contracts
      job.phase = 'import';
      log('\n[3/5] Importing customers...');
      const csvDir = this.findCsvDir();
      log(`  CSV dir: ${csvDir}`);
      const customerResult = await this.importCustomers(csvDir);
      log(`  customers: ${customerResult.created} created, ${customerResult.updated} updated, ${customerResult.skipped} skipped, ${customerResult.errors.length} errors`);

      log('\n[4/5] Importing products + contracts + payments...');
      const mainResult = await this.importMain(csvDir, ph);
      log(`  products:  ${mainResult.productsCreated} created, ${mainResult.productsUpdated} updated`);
      log(`  contracts: ${mainResult.contractsCreated} created, ${mainResult.contractsUpdated} updated`);
      log(`  payments:  ${mainResult.paymentsCreated} created, ${mainResult.paymentsUpdated} updated`);
      if (mainResult.errors.length > 0) log(`  errors:    ${mainResult.errors.length}`);

      // Phase 5: Validate
      job.phase = 'validate';
      log('\n[5/5] Validating...');
      const validation = await this.validate();
      for (const line of validation.summary) log('  ' + line);

      job.summary = {
        wipe: wipeResult,
        customers: customerResult,
        main: mainResult,
        validation,
      };
      job.phase = 'done';
      job.done = true;
      log('\n═══ DONE ═══');
    } catch (e: any) {
      job.error = e.message;
      job.done = true;
      log(`\n💥 FATAL: ${e.message}`);
      this.logger.error(e);
    }
  }

  // ─────────────────────────────────────────────────────────
  // File path resolution
  // ─────────────────────────────────────────────────────────
  private findCsvDir(): string {
    const candidates = [
      process.env.LEGACY_CSV_DIR,
      path.resolve(process.cwd(), 'ข้อมูลโปรแกรมเขียว4-7-2026'),
      path.resolve(process.cwd(), '../ข้อมูลโปรแกรมเขียว4-7-2026'),
      path.resolve(process.cwd(), '../../ข้อมูลโปรแกรมเขียว4-7-2026'),
      '/app/ข้อมูลโปรแกรมเขียว4-7-2026',
    ].filter(Boolean) as string[];
    for (const c of candidates) {
      if (fs.existsSync(path.join(c, 'bestchoice_member.csv'))) return c;
    }
    throw new Error(`CSV dir not found. Tried: ${candidates.join(', ')}`);
  }

  private loadCsv(csvDir: string, name: string): CsvRow[] {
    const file = path.join(csvDir, name);
    if (!fs.existsSync(file)) throw new Error(`CSV not found: ${file}`);
    return parseCsv(fs.readFileSync(file, 'utf-8'));
  }

  // ─────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────
  private parseDate(s: string | null): Date | null {
    if (!s || s === 'NULL' || s === '0000-00-00' || s === '0000-00-00 00:00:00') return null;
    const d = new Date(s.replace(' ', 'T'));
    return isNaN(d.getTime()) ? null : d;
  }

  private parseMoney(s: string | null): Prisma.Decimal {
    if (!s || s === 'NULL') return new Prisma.Decimal(0);
    const n = parseFloat(s);
    return new Prisma.Decimal(isNaN(n) ? 0 : n);
  }

  private parseInt0(s: string | null): number {
    if (!s || s === 'NULL') return 0;
    const n = parseInt(s, 10);
    return isNaN(n) ? 0 : n;
  }

  private s(val: string | null | undefined): string | null {
    if (!val || val === 'NULL') return null;
    return val.trim() || null;
  }

  private joinAddress(addr: string | null, tambon: string | null, zipcode: string | null): string | null {
    return formatFullAddress(this.s(addr), this.s(tambon), this.s(zipcode));
  }

  // ─────────────────────────────────────────────────────────
  // Phase 1: Wipe
  // ─────────────────────────────────────────────────────────
  private async wipe() {
    const order = [
      'paymentEvidence', 'paymentLink', 'receipt', 'signature', 'eDocument', 'contractDocument',
      'loyaltyRedemption', 'loyaltyPoint', 'salesCommission', 'badDebtProvision', 'interCompanyTransaction',
      'repossession', 'kycVerification', 'creditCheck', 'pDPAConsent', 'dSARRequest', 'customerAccessToken',
      'promotionUsage', 'tradeIn', 'callLog', 'payment', 'sale', 'contract', 'customer',
    ];
    let total = 0;
    for (const model of order) {
      try {
        const result = await (this.prisma as any)[model].deleteMany();
        total += result.count;
      } catch (e: any) {
        // Skip missing models silently
      }
    }
    return { total };
  }

  // ─────────────────────────────────────────────────────────
  // Phase 2: Placeholders
  // ─────────────────────────────────────────────────────────
  private async ensurePlaceholders(log: (m: string) => void) {
    let company = await this.prisma.companyInfo.findUnique({ where: { companyCode: 'FINANCE' } });
    if (!company) {
      company = await this.prisma.companyInfo.create({
        data: {
          companyCode: 'FINANCE',
          nameTh: 'BESTCHOICE FINANCE',
          taxId: '0000000000000',
          address: '-',
          directorName: '-',
          vatRegistered: true,
          vatRate: new Prisma.Decimal(0.07),
        },
      });
      log(`  ✓ created company FINANCE`);
    }

    let branch = await this.prisma.branch.findFirst({ where: { name: 'Best Choice Phone (Legacy)' } });
    if (!branch) {
      branch = await this.prisma.branch.create({
        data: { name: 'Best Choice Phone (Legacy)', location: 'Imported from โปรแกรมเขียว', companyId: company.id },
      });
      log(`  ✓ created branch Legacy`);
    }

    let user = await this.prisma.user.findUnique({ where: { email: 'legacy-import@bestchoice.com' } });
    if (!user) {
      const password = await bcrypt.hash('!disabled-' + Date.now(), 10);
      user = await this.prisma.user.create({
        data: {
          email: 'legacy-import@bestchoice.com',
          password,
          name: 'Legacy Import (โปรแกรมเขียว)',
          role: UserRole.SALES,
          branchId: branch.id,
          isActive: false,
        },
      });
      log(`  ✓ created legacy-import user`);
    }

    return { companyId: company.id, branchId: branch.id, salespersonId: user.id };
  }

  // ─────────────────────────────────────────────────────────
  // Phase 3: Customers
  // ─────────────────────────────────────────────────────────
  private async importCustomers(csvDir: string) {
    const members = this.loadCsv(csvDir, 'bestchoice_member.csv');
    const orders = this.loadCsv(csvDir, 'bestchoice_order.csv');
    const contracts = this.loadCsv(csvDir, 'bestchoice_contract.csv');

    const ordersByMember: Record<string, CsvRow[]> = {};
    for (const o of orders) {
      const code = this.s(o.ref_member_code);
      if (!code) continue;
      (ordersByMember[code] ||= []).push(o);
    }
    const contractByCode: Record<string, CsvRow> = {};
    for (const c of contracts) {
      const code = this.s(c.CODE);
      if (code) contractByCode[code] = c;
    }

    const stats = { created: 0, updated: 0, skipped: 0, errors: [] as string[] };

    for (const m of members) {
      try {
        const memberCode = this.s(m.code);
        const nationalId = this.s(m.member_identity_number);
        if (!nationalId) {
          stats.skipped++;
          continue;
        }

        const memberOrders = ordersByMember[memberCode || ''] || [];
        const latestOrder = memberOrders.sort((a, b) => (this.s(b.created_at) || '').localeCompare(this.s(a.created_at) || ''))[0];

        const references: any[] = [];
        if (latestOrder) {
          const contractCode = this.s(latestOrder.ref_contract_code);
          if (contractCode && contractByCode[contractCode]) {
            const c = contractByCode[contractCode];
            if (this.s(c.guarantor_name)) {
              references.push({ role: 'guarantor', name: this.s(c.guarantor_name), relationship: this.s(c.guarantor_relationship), phone: this.s(c.guarantor_mobile) });
            }
            for (const idx of [1, 2, 3]) {
              const name = this.s(c[`contact${idx}_name`]);
              if (name) {
                references.push({ role: `contact${idx}`, name, relationship: this.s(c[`contact${idx}_relationship`]), phone: this.s(c[`contact${idx}_mobile`]) });
              }
            }
          }
        }

        const fullName = `${this.s(m.member_name) || ''} ${this.s(m.member_surname) || ''}`.trim();
        const idCardImg = this.s(m.member_identity_image);

        const data: Prisma.CustomerCreateInput = {
          nationalId,
          name: fullName || 'ไม่ระบุ',
          nickname: this.s(m.member_nickname),
          phone: this.s(m.member_tel) || '0000000000',
          birthDate: this.parseDate(m.member_birth_date),
          addressIdCard: this.joinAddress(m.member_address, m.member_districts, m.member_zipcode),
          legacyMemberCode: memberCode,
          documents: idCardImg ? [idCardImg] : [],
          references: references.length > 0 ? (references as any) : Prisma.DbNull,
        };

        if (latestOrder) {
          data.lineId = this.s(latestOrder.member_line);
          data.facebookLink = this.s(latestOrder.member_facebook);
          data.addressCurrent = this.joinAddress(latestOrder.contact_address, latestOrder.contact_districts, latestOrder.contact_zipcode);
          data.addressWork = this.joinAddress(latestOrder.work_address, latestOrder.work_districts, latestOrder.work_zipcode);
          data.workplace = this.s(latestOrder.work_place);
          data.occupation = this.s(latestOrder.work_position);
          data.occupationDetail = this.s(latestOrder.member_career);
          const income = this.parseMoney(latestOrder.member_monthly_income);
          if (income.gt(0)) data.salary = income;
        }

        const existing = await this.prisma.customer.findUnique({ where: { nationalId } });
        if (existing) {
          await this.prisma.customer.update({ where: { id: existing.id }, data: { ...data, nationalId: undefined } as any });
          stats.updated++;
        } else {
          await this.prisma.customer.create({ data });
          stats.created++;
        }
      } catch (e: any) {
        stats.errors.push(`member ${m.code}: ${e.message}`);
      }
    }
    return stats;
  }

  // ─────────────────────────────────────────────────────────
  // Phase 4: Products + Contracts + Payments
  // ─────────────────────────────────────────────────────────
  private async importMain(csvDir: string, ph: { branchId: string; salespersonId: string }) {
    const orders = this.loadCsv(csvDir, 'bestchoice_order.csv');
    const details = this.loadCsv(csvDir, 'bestchoice_order_detail.csv');
    const contracts = this.loadCsv(csvDir, 'bestchoice_contract.csv');
    const installments = this.loadCsv(csvDir, 'bestchoice_order_installment.csv');

    const detailByOrderCode: Record<string, CsvRow> = {};
    for (const d of details) {
      const code = this.s(d.ref_order_code);
      if (code) detailByOrderCode[code] = d;
    }
    const contractByCode: Record<string, CsvRow> = {};
    for (const c of contracts) {
      const code = this.s(c.CODE);
      if (code) contractByCode[code] = c;
    }
    const installmentsByContract: Record<string, CsvRow[]> = {};
    for (const inst of installments) {
      const code = this.s(inst.ref_contract_code);
      if (!code) continue;
      (installmentsByContract[code] ||= []).push(inst);
    }

    const stats = {
      productsCreated: 0, productsUpdated: 0,
      contractsCreated: 0, contractsUpdated: 0,
      paymentsCreated: 0, paymentsUpdated: 0,
      errors: [] as string[],
    };

    for (const order of orders) {
      try {
        const orderCode = this.s(order.code);
        const contractCode = this.s(order.ref_contract_code);
        const memberNationalId = this.s(order.member_identity_number);
        if (!orderCode || !contractCode || !memberNationalId) continue;

        const detail = detailByOrderCode[orderCode];
        const legacyContract = contractByCode[contractCode];
        if (!detail || !legacyContract) {
          stats.errors.push(`order ${orderCode}: missing detail/contract`);
          continue;
        }

        const customer = await this.prisma.customer.findUnique({ where: { nationalId: memberNationalId } });
        if (!customer) {
          stats.errors.push(`contract ${contractCode}: customer not found`);
          continue;
        }

        // Product
        const imei = this.s(detail.mobile_imei) || this.s(detail.ref_product_code);
        if (!imei) {
          stats.errors.push(`contract ${contractCode}: no IMEI`);
          continue;
        }
        const productType = this.s(detail.product_type);
        const category: ProductCategory = productType === '1' ? ProductCategory.PHONE_NEW : ProductCategory.PHONE_USED;
        const productName = this.s(detail.ref_product_name) || 'Unknown';
        const modelMatch = productName.match(/^(\S+\s+\S+(?:\s+(?:Pro|Pro Max|Plus|Mini|Max))?)/);
        const model = modelMatch ? modelMatch[1] : productName;

        const productData: any = {
          name: productName,
          brand: this.s(detail.ref_product_brand) || 'Unknown',
          model,
          color: this.s(detail.ref_product_color),
          storage: this.s(detail.ref_product_storage),
          imeiSerial: imei,
          serialNumber: this.s(detail.mobile_serial_no),
          category,
          costPrice: this.parseMoney(detail.ref_product_price),
          branchId: ph.branchId,
          status: ProductStatus.SOLD_INSTALLMENT,
          legacyProductCode: `${contractCode}/${imei}`,
        };

        let productId: string;
        const existingProduct = await this.prisma.product.findUnique({ where: { legacyProductCode: productData.legacyProductCode } });
        if (existingProduct) {
          productId = existingProduct.id;
          await this.prisma.product.update({ where: { id: productId }, data: productData });
          stats.productsUpdated++;
        } else {
          const imeiClash = await this.prisma.product.findUnique({ where: { imeiSerial: imei } });
          if (imeiClash) {
            productId = imeiClash.id;
            await this.prisma.product.update({ where: { id: productId }, data: { legacyProductCode: productData.legacyProductCode } });
            stats.productsUpdated++;
          } else {
            const created = await this.prisma.product.create({ data: productData });
            productId = created.id;
            stats.productsCreated++;
          }
        }

        // Contract financial fields
        const totalMonths = this.parseInt0(detail.installment_number);
        const monthlyPayment = this.parseMoney(detail.installment_amount);
        const sellingPrice = this.parseMoney(detail.ref_product_price);
        const downPayment = this.parseMoney(detail.deposit);
        const installmentTotal = this.parseMoney(detail.installment_total);
        const rawFinance = this.parseMoney(detail.finance);
        const rawCommission = this.parseMoney(detail.commission_admin);
        const rawVat = this.parseMoney(detail.sales_tax);

        const financedAmount = rawFinance.gt(0) ? rawFinance : sellingPrice.minus(downPayment);
        const storeCommission = rawCommission.gt(0) ? rawCommission : financedAmount.mul(new Prisma.Decimal('0.10'));
        const vatAmount = rawVat;
        const interestTotalRaw = installmentTotal.minus(financedAmount).minus(storeCommission).minus(vatAmount);
        const interestTotal = interestTotalRaw.gte(0) ? interestTotalRaw : new Prisma.Decimal(0);
        const interestRate = financedAmount.gt(0)
          ? new Prisma.Decimal(interestTotal.div(financedAmount).toFixed(4))
          : new Prisma.Decimal(0);

        // Status
        const contractInstallments = installmentsByContract[contractCode] || [];
        const allPaid = contractInstallments.length > 0 && contractInstallments.every((i) => this.s(i.ins_status) === '4');
        const canceledAt = this.parseDate(legacyContract.canceled_at);
        const baddebtAt = this.parseDate(legacyContract.baddebt_at);

        let status: ContractStatus;
        if (baddebtAt) {
          status = ContractStatus.CLOSED_BAD_DEBT;
        } else if (allPaid && canceledAt) {
          status = ContractStatus.EXCHANGED;
        } else if (canceledAt) {
          status = ContractStatus.CLOSED_BAD_DEBT;
        } else if (allPaid) {
          status = ContractStatus.COMPLETED;
        } else {
          const now = new Date();
          const hasOverdue = contractInstallments.some((i) => {
            if (this.s(i.ins_status) === '4') return false;
            const due = this.parseDate(i.ins_due_date);
            return due && due < now;
          });
          status = hasOverdue ? ContractStatus.OVERDUE : ContractStatus.ACTIVE;
        }

        const contractData: any = {
          contractNumber: contractCode,
          customerId: customer.id,
          productId,
          branchId: ph.branchId,
          salespersonId: ph.salespersonId,
          planType: PlanType.STORE_WITH_INTEREST,
          sellingPrice,
          downPayment,
          interestRate,
          totalMonths,
          interestTotal,
          financedAmount,
          storeCommission,
          vatAmount: vatAmount.gt(0) ? vatAmount : null,
          vatPct: vatAmount.gt(0) ? new Prisma.Decimal('0.0700') : null,
          monthlyPayment,
          status,
          workflowStatus: ContractWorkflowStatus.APPROVED,
          reviewedAt: this.parseDate(legacyContract.approved_at) || this.parseDate(order.created_at) || new Date(),
          reviewedById: ph.salespersonId,
          notes: [
            this.s(legacyContract.contract_remark),
            canceledAt && `[ยกเลิกจากระบบเก่า ${canceledAt.toISOString().slice(0, 10)}] ${this.s(legacyContract.canceled_remark) || ''}`.trim(),
            this.s(legacyContract.baddebt_remark) && `[หนี้สูญ] ${this.s(legacyContract.baddebt_remark)}`,
          ].filter(Boolean).join('\n') || null,
          createdAt: this.parseDate(order.created_at) || new Date(),
          legacyContractCode: contractCode,
        };

        let contractId: string;
        const existingContract = await this.prisma.contract.findUnique({ where: { legacyContractCode: contractCode } });
        if (existingContract) {
          contractId = existingContract.id;
          await this.prisma.contract.update({ where: { id: contractId }, data: contractData });
          stats.contractsUpdated++;
        } else {
          const created = await this.prisma.contract.create({ data: contractData });
          contractId = created.id;
          stats.contractsCreated++;
        }

        // Payments
        const sortedInstallments = [...contractInstallments].sort((a, b) => {
          const da = this.parseDate(a.ins_due_date)?.getTime() || 0;
          const db = this.parseDate(b.ins_due_date)?.getTime() || 0;
          return da - db;
        });
        for (let idx = 0; idx < sortedInstallments.length; idx++) {
          const inst = sortedInstallments[idx];
          try {
            const instCode = this.s(inst.code);
            if (!instCode) continue;
            const installmentNo = idx + 1;
            const uniqueLegacyCode = `${contractCode}#${instCode}`;
            const insStatus = this.s(inst.ins_status);
            const dueDate = this.parseDate(inst.ins_due_date) || new Date();
            const amountDue = this.parseMoney(inst.ins_amount);
            const amountPaid = this.parseMoney(inst.ins_paid);

            let pStatus: PaymentStatus;
            if (insStatus === '4') {
              pStatus = PaymentStatus.PAID;
            } else if (amountPaid.gt(0) && amountPaid.lt(amountDue)) {
              pStatus = PaymentStatus.PARTIALLY_PAID;
            } else if (dueDate < new Date()) {
              pStatus = PaymentStatus.OVERDUE;
            } else {
              pStatus = PaymentStatus.PENDING;
            }
            const paidAt = pStatus === PaymentStatus.PAID ? this.parseDate(inst.updated_at) : null;

            const paymentData: any = {
              contractId,
              installmentNo,
              dueDate,
              amountDue,
              amountPaid,
              status: pStatus,
              paidDate: paidAt,
              paidAt,
              recordedById: ph.salespersonId,
              notes: this.s(inst.ins_remark),
              legacyInstallmentCode: uniqueLegacyCode,
            };

            const existingPayment = await this.prisma.payment.findUnique({ where: { legacyInstallmentCode: uniqueLegacyCode } });
            if (existingPayment) {
              await this.prisma.payment.update({ where: { id: existingPayment.id }, data: paymentData });
              stats.paymentsUpdated++;
            } else {
              await this.prisma.payment.create({ data: paymentData });
              stats.paymentsCreated++;
            }
          } catch (e: any) {
            stats.errors.push(`installment ${inst.code}: ${e.message}`);
          }
        }
      } catch (e: any) {
        stats.errors.push(`order ${order.code}: ${e.message}`);
      }
    }
    return stats;
  }

  // ─────────────────────────────────────────────────────────
  // Phase 5: Validate
  // ─────────────────────────────────────────────────────────
  private async validate() {
    const contracts = await this.prisma.contract.findMany({
      where: { legacyContractCode: { not: null } },
      include: { payments: true, customer: true },
    });

    const tol = 2;
    const near = (a: number, b: number, t = tol) => Math.abs(a - b) <= t;
    const issues: { rule: string; contract: string; detail: string }[] = [];
    const counts: Record<string, number> = { R1: 0, R2: 0, R3: 0, R4: 0, R5: 0, R6: 0, R7: 0, R8: 0, R9: 0, R10: 0 };

    for (const c of contracts) {
      const sp = Number(c.sellingPrice);
      const dp = Number(c.downPayment);
      const fa = Number(c.financedAmount);
      const sc = Number(c.storeCommission || 0);
      const vat = Number(c.vatAmount || 0);
      const it = Number(c.interestTotal);
      const mp = Number(c.monthlyPayment);
      const tm = c.totalMonths;
      const ir = Number(c.interestRate);
      const isDraft = c.payments.length === 0;

      const actualTotal = tm * mp;
      if (!near(actualTotal, fa + sc + it + vat)) counts.R1++;
      if (!near(dp + fa, sp)) counts.R2++;
      if (!isDraft && c.payments.length !== tm) counts.R3++;
      if (!isDraft) {
        const sumDue = c.payments.reduce((a, p) => a + Number(p.amountDue), 0);
        if (!near(sumDue, actualTotal, 10)) counts.R4++;
      }
      if (c.status === ContractStatus.COMPLETED && c.payments.some((p) => p.status !== PaymentStatus.PAID)) counts.R5++;
      if (c.status === ContractStatus.CLOSED_BAD_DEBT && c.payments.length > 0 && c.payments.every((p) => p.status === PaymentStatus.PAID)) counts.R6++;
      if (!near(sc, fa * 0.10)) counts.R7++;
      if (ir <= 0 && fa > 0) counts.R8++;
      if (!c.legacyContractCode) counts.R9++;
      if (!c.customer.legacyMemberCode) counts.R10++;
    }

    const statusDist: Record<string, number> = {};
    for (const c of contracts) statusDist[c.status] = (statusDist[c.status] || 0) + 1;

    const totals = contracts.reduce(
      (acc, c) => {
        acc.financed += Number(c.financedAmount);
        acc.commission += Number(c.storeCommission || 0);
        acc.interest += Number(c.interestTotal);
        acc.down += Number(c.downPayment);
        return acc;
      },
      { financed: 0, commission: 0, interest: 0, down: 0 }
    );

    const totalIssues = Object.values(counts).reduce((a, b) => a + b, 0);
    const summary: string[] = [
      `Total contracts: ${contracts.length}`,
      `Total issues:    ${totalIssues}`,
      ...Object.entries(counts).map(([k, v]) => `  ${k}: ${v === 0 ? '✅ PASS' : v + ' violations'}`),
      `Status: ${JSON.stringify(statusDist)}`,
      `Totals: financed=${totals.financed.toLocaleString()} commission=${totals.commission.toLocaleString()} interest=${totals.interest.toLocaleString()} down=${totals.down.toLocaleString()}`,
    ];
    return { totalIssues, counts, statusDist, totals, summary };
  }
}
