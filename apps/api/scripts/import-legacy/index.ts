/**
 * Legacy Data Import Script (โปรแกรมเขียว → BESTCHOICE)
 *
 * Usage:
 *   npx tsx scripts/import-legacy/index.ts --csv-dir "../../ข้อมูลโปรแกรมเขียว4-7-2026"
 *   npx tsx scripts/import-legacy/index.ts --csv-dir "..." --dry-run
 *
 * What it does:
 *   1. Ensures placeholder Company (FINANCE), Branch, Salesperson user exist
 *   2. Imports customers (merge member.csv + order.csv, dedupe by nationalId)
 *   3. Imports products (1 per contract, IMEI as unique key)
 *   4. Imports contracts (data-driven status from installments + canceled/baddebt)
 *   5. Imports payments (installment schedule)
 *
 * Idempotent: safe to re-run. Uses legacy_*_code fields to upsert.
 */
import { PrismaClient, Prisma, ProductCategory, ProductStatus, PlanType, ContractStatus, ContractWorkflowStatus, PaymentStatus, UserRole } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as bcrypt from 'bcrypt';
import { parseCsv } from './csv';
import { formatFullAddress } from './thai-address';

// ============================================================
// CLI ARGS
// ============================================================
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const csvDirArg = args.indexOf('--csv-dir');
const csvDir = csvDirArg >= 0 ? args[csvDirArg + 1] : path.resolve(__dirname, '../../../../ข้อมูลโปรแกรมเขียว4-7-2026');

const prisma = new PrismaClient();

// ============================================================
// PARSERS
// ============================================================
function parseDate(s: string | null): Date | null {
  if (!s || s === 'NULL' || s === '0000-00-00' || s === '0000-00-00 00:00:00') return null;
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

function parseMoney(s: string | null): Prisma.Decimal {
  if (!s || s === 'NULL') return new Prisma.Decimal(0);
  const n = parseFloat(s);
  return new Prisma.Decimal(isNaN(n) ? 0 : n);
}

function parseInt0(s: string | null): number {
  if (!s || s === 'NULL') return 0;
  const n = parseInt(s, 10);
  return isNaN(n) ? 0 : n;
}

function s(val: string | null): string | null {
  if (!val || val === 'NULL') return null;
  return val.trim() || null;
}

function joinAddress(addr: string | null, district: string | null, _amphure: string | null, _province: string | null, zipcode: string | null): string | null {
  // ใช้ tambon code (district field) lookup ชื่อจริงจาก thai-tambon.json
  // _amphure / _province ของเก่าเป็น PK ตัวเลขภายใน — ทิ้งไป ใช้ที่ derive จาก tambon code แทน
  return formatFullAddress(s(addr), s(district), s(zipcode));
}

function loadCsv(name: string): Record<string, string | null>[] {
  const file = path.join(csvDir, name);
  if (!fs.existsSync(file)) {
    throw new Error(`CSV file not found: ${file}`);
  }
  const content = fs.readFileSync(file, 'utf-8');
  return parseCsv(content);
}

// ============================================================
// REPORT
// ============================================================
const report = {
  startedAt: new Date(),
  dryRun,
  customers: { created: 0, updated: 0, skipped: 0, errors: [] as string[] },
  products: { created: 0, updated: 0, errors: [] as string[] },
  contracts: { created: 0, updated: 0, errors: [] as string[] },
  payments: { created: 0, updated: 0, errors: [] as string[] },
  placeholders: { companyId: '', branchId: '', salespersonId: '' },
};

// ============================================================
// PHASE A: PLACEHOLDERS (idempotent)
// ============================================================
async function ensurePlaceholders() {
  console.log('\n📦 Ensuring placeholders...');

  // 1. Company FINANCE
  let company = await prisma.companyInfo.findUnique({ where: { companyCode: 'FINANCE' } });
  if (!company) {
    if (dryRun) {
      console.log('  [dry-run] would create CompanyInfo FINANCE');
      company = { id: '<dry-finance-id>' } as any;
    } else {
      company = await prisma.companyInfo.create({
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
      console.log(`  ✓ created company FINANCE (${company.id})`);
    }
  } else {
    console.log(`  ✓ company FINANCE exists (${company.id})`);
  }
  report.placeholders.companyId = company!.id;

  // 2. Branch placeholder (ของ legacy)
  let branch = await prisma.branch.findFirst({ where: { name: 'Best Choice Phone (Legacy)' } });
  if (!branch) {
    if (dryRun) {
      console.log('  [dry-run] would create Branch Best Choice Phone (Legacy)');
      branch = { id: '<dry-branch-id>' } as any;
    } else {
      branch = await prisma.branch.create({
        data: {
          name: 'Best Choice Phone (Legacy)',
          location: 'Imported from โปรแกรมเขียว',
          companyId: company!.id,
        },
      });
      console.log(`  ✓ created branch Legacy (${branch.id})`);
    }
  } else {
    console.log(`  ✓ legacy branch exists (${branch.id})`);
  }
  report.placeholders.branchId = branch!.id;

  // 3. Salesperson user placeholder
  let user = await prisma.user.findUnique({ where: { email: 'legacy-import@bestchoice.com' } });
  if (!user) {
    if (dryRun) {
      console.log('  [dry-run] would create User legacy-import');
      user = { id: '<dry-user-id>' } as any;
    } else {
      const password = await bcrypt.hash('!disabled-' + Date.now(), 10);
      user = await prisma.user.create({
        data: {
          email: 'legacy-import@bestchoice.com',
          password,
          name: 'Legacy Import (โปรแกรมเขียว)',
          role: UserRole.SALES,
          branchId: branch!.id,
          isActive: false, // disabled — for record-keeping only
        },
      });
      console.log(`  ✓ created legacy-import user (${user.id})`);
    }
  } else {
    console.log(`  ✓ legacy-import user exists (${user.id})`);
  }
  report.placeholders.salespersonId = user!.id;
}

// ============================================================
// PHASE B: CUSTOMERS (merge member + order, dedupe by nationalId)
// ============================================================
async function importCustomers() {
  console.log('\n👥 Importing customers...');
  const members = loadCsv('bestchoice_member.csv');
  const orders = loadCsv('bestchoice_order.csv');
  const contracts = loadCsv('bestchoice_contract.csv');

  // Build lookup: order_code → order, contract_code → contract
  const ordersByMember: Record<string, Record<string, string | null>[]> = {};
  for (const o of orders) {
    const code = s(o.ref_member_code);
    if (!code) continue;
    (ordersByMember[code] ||= []).push(o);
  }
  const contractByCode: Record<string, Record<string, string | null>> = {};
  for (const c of contracts) {
    const code = s(c.CODE);
    if (code) contractByCode[code] = c;
  }
  const orderByCode: Record<string, Record<string, string | null>> = {};
  for (const o of orders) {
    const code = s(o.code);
    if (code) orderByCode[code] = o;
  }

  for (const m of members) {
    try {
      const memberCode = s(m.code);
      const nationalId = s(m.member_identity_number);
      if (!nationalId) {
        report.customers.skipped++;
        report.customers.errors.push(`member ${memberCode}: no nationalId`);
        continue;
      }

      // Find latest order for this member (richest data)
      const memberOrders = ordersByMember[memberCode || ''] || [];
      const latestOrder = memberOrders.sort((a, b) => (s(b.created_at) || '').localeCompare(s(a.created_at) || ''))[0];

      // Build references from contract (guarantor + 3 contacts)
      const references: any[] = [];
      if (latestOrder) {
        const contractCode = s(latestOrder.ref_contract_code);
        if (contractCode && contractByCode[contractCode]) {
          const c = contractByCode[contractCode];
          if (s(c.guarantor_name)) {
            references.push({ role: 'guarantor', name: s(c.guarantor_name), relationship: s(c.guarantor_relationship), phone: s(c.guarantor_mobile) });
          }
          for (const idx of [1, 2, 3]) {
            const name = s(c[`contact${idx}_name`]);
            if (name) {
              references.push({ role: `contact${idx}`, name, relationship: s(c[`contact${idx}_relationship`]), phone: s(c[`contact${idx}_mobile`]) });
            }
          }
        }
      }

      const fullName = `${s(m.member_name) || ''} ${s(m.member_surname) || ''}`.trim();
      const idCardImg = s(m.member_identity_image);

      const data: Prisma.CustomerCreateInput = {
        nationalId,
        name: fullName || 'ไม่ระบุ',
        nickname: s(m.member_nickname),
        phone: s(m.member_tel) || '0000000000',
        birthDate: parseDate(m.member_birth_date),
        addressIdCard: joinAddress(m.member_address, m.member_districts, m.member_amphures, m.member_province, m.member_zipcode),
        legacyMemberCode: memberCode,
        documents: idCardImg ? [idCardImg] : [],
        references: references.length > 0 ? (references as any) : Prisma.DbNull,
      };

      // Augment from latest order
      if (latestOrder) {
        data.lineId = s(latestOrder.member_line);
        data.facebookLink = s(latestOrder.member_facebook);
        data.addressCurrent = joinAddress(latestOrder.contact_address, latestOrder.contact_districts, latestOrder.contact_amphures, latestOrder.contact_province, latestOrder.contact_zipcode);
        data.addressWork = joinAddress(latestOrder.work_address, latestOrder.work_districts, latestOrder.work_amphures, latestOrder.work_province, latestOrder.work_zipcode);
        data.workplace = s(latestOrder.work_place);
        data.occupation = s(latestOrder.work_position);
        data.occupationDetail = s(latestOrder.member_career);
        const income = parseMoney(latestOrder.member_monthly_income);
        if (income.gt(0)) data.salary = income;
      }

      if (dryRun) {
        report.customers.created++;
        continue;
      }

      // Upsert by nationalId (natural dedup key)
      const existing = await prisma.customer.findUnique({ where: { nationalId } });
      if (existing) {
        await prisma.customer.update({
          where: { id: existing.id },
          data: { ...data, nationalId: undefined } as any,
        });
        report.customers.updated++;
      } else {
        await prisma.customer.create({ data });
        report.customers.created++;
      }
    } catch (e: any) {
      report.customers.errors.push(`member ${m.code}: ${e.message}`);
    }
  }
  console.log(`  ✓ customers: ${report.customers.created} created, ${report.customers.updated} updated, ${report.customers.skipped} skipped, ${report.customers.errors.length} errors`);
}

// ============================================================
// PHASE C: PRODUCTS + CONTRACTS + PAYMENTS
// ============================================================
async function importContractsProductsPayments() {
  console.log('\n📱 Importing products + contracts + payments...');
  const orders = loadCsv('bestchoice_order.csv');
  const details = loadCsv('bestchoice_order_detail.csv');
  const contracts = loadCsv('bestchoice_contract.csv');
  const installments = loadCsv('bestchoice_order_installment.csv');

  // Lookups
  const detailByOrderCode: Record<string, Record<string, string | null>> = {};
  for (const d of details) {
    const code = s(d.ref_order_code);
    if (code) detailByOrderCode[code] = d;
  }
  const contractByCode: Record<string, Record<string, string | null>> = {};
  for (const c of contracts) {
    const code = s(c.CODE);
    if (code) contractByCode[code] = c;
  }
  const installmentsByContract: Record<string, Record<string, string | null>[]> = {};
  for (const inst of installments) {
    const code = s(inst.ref_contract_code);
    if (!code) continue;
    (installmentsByContract[code] ||= []).push(inst);
  }

  for (const order of orders) {
    try {
      const orderCode = s(order.code);
      const contractCode = s(order.ref_contract_code);
      const memberNationalId = s(order.member_identity_number);
      if (!orderCode || !contractCode || !memberNationalId) continue;

      const detail = detailByOrderCode[orderCode];
      const legacyContract = contractByCode[contractCode];
      if (!detail) {
        report.contracts.errors.push(`order ${orderCode}: missing detail`);
        continue;
      }
      if (!legacyContract) {
        report.contracts.errors.push(`order ${orderCode}: missing contract ${contractCode}`);
        continue;
      }

      // Find customer (might not exist if was skipped)
      const customer = dryRun ? { id: '<dry-cust-id>' } : await prisma.customer.findUnique({ where: { nationalId: memberNationalId } });
      if (!customer) {
        report.contracts.errors.push(`contract ${contractCode}: customer ${memberNationalId} not found`);
        continue;
      }

      // ----- PRODUCT -----
      const imei = s(detail.mobile_imei) || s(detail.ref_product_code);
      if (!imei) {
        report.contracts.errors.push(`contract ${contractCode}: no IMEI`);
        continue;
      }
      const productType = s(detail.product_type);
      const category: ProductCategory = productType === '1' ? ProductCategory.PHONE_NEW : ProductCategory.PHONE_USED;
      const brand = s(detail.ref_product_brand) || 'Unknown';
      const productName = s(detail.ref_product_name) || 'Unknown';
      // Parse model from name: "iPhone 13 128 Gb สีน้ำเงิน" → model="iPhone 13"
      const modelMatch = productName.match(/^(\S+\s+\S+(?:\s+(?:Pro|Pro Max|Plus|Mini|Max))?)/);
      const model = modelMatch ? modelMatch[1] : productName;

      const productData = {
        name: productName,
        brand,
        model,
        color: s(detail.ref_product_color),
        storage: s(detail.ref_product_storage),
        imeiSerial: imei,
        serialNumber: s(detail.mobile_serial_no),
        category,
        costPrice: parseMoney(detail.ref_product_price),
        branchId: report.placeholders.branchId,
        status: ProductStatus.SOLD_INSTALLMENT,
        legacyProductCode: `${contractCode}/${imei}`,
      };

      let productId: string;
      if (dryRun) {
        productId = '<dry-product-id>';
        report.products.created++;
      } else {
        const existingProduct = await prisma.product.findUnique({ where: { legacyProductCode: productData.legacyProductCode } });
        if (existingProduct) {
          productId = existingProduct.id;
          await prisma.product.update({ where: { id: productId }, data: productData });
          report.products.updated++;
        } else {
          // imeiSerial collision check (เพราะ unique)
          const imeiClash = await prisma.product.findUnique({ where: { imeiSerial: imei } });
          if (imeiClash) {
            // ผูก legacyCode เข้า product เดิม
            productId = imeiClash.id;
            await prisma.product.update({ where: { id: productId }, data: { legacyProductCode: productData.legacyProductCode } });
            report.products.updated++;
          } else {
            const created = await prisma.product.create({ data: productData });
            productId = created.id;
            report.products.created++;
          }
        }
      }

      // ----- CONTRACT -----
      const totalMonths = parseInt0(detail.installment_number);
      const monthlyPayment = parseMoney(detail.installment_amount);
      // ⚠️ Legacy field semantics (ไม่ตรงกับชื่อ field):
      //   - detail.finance        = ยอดจัดจริง (บาง row=0 เพราะ data quality เก่า → fallback)
      //   - detail.finance_amount = installment_total (ยอดรวมที่ลูกค้าต้องผ่อน) ไม่ใช่ยอดจัด!
      //   - detail.commission_admin = ค่าคอมร้าน (บาง row=0 → คำนวณ 10%)
      //   - detail.sales_tax      = VAT (บาง row=0 = ไม่มี VAT)
      //   - detail.installment_total = รวมผ่อนทั้งสัญญา (= monthly × months)
      const sellingPrice = parseMoney(detail.ref_product_price);
      const downPayment = parseMoney(detail.deposit);
      const installmentTotal = parseMoney(detail.installment_total);
      const rawFinance = parseMoney(detail.finance);
      const rawCommission = parseMoney(detail.commission_admin);
      const rawVat = parseMoney(detail.sales_tax);

      // financedAmount: ใช้ field finance ถ้ามีค่า, fallback = selling - down
      const financedAmount = rawFinance.gt(0) ? rawFinance : sellingPrice.minus(downPayment);

      // storeCommission: ใช้ค่า explicit ถ้ามี, fallback 10% ของยอดจัด
      const storeCommission = rawCommission.gt(0) ? rawCommission : financedAmount.mul(new Prisma.Decimal('0.10'));

      // VAT: ใช้ค่าจริงจาก data เก่า (row เก่าๆ = 0)
      const vatAmount = rawVat;

      // interestTotal = installment_total - ยอดจัด - คอม - VAT
      const interestTotalRaw = installmentTotal.minus(financedAmount).minus(storeCommission).minus(vatAmount);
      const interestTotal = interestTotalRaw.gte(0) ? interestTotalRaw : new Prisma.Decimal(0);

      // interestRate = ดอกเบี้ย / ยอดจัด (effective rate ต่อสัญญา)
      const interestRate = financedAmount.gt(0)
        ? new Prisma.Decimal(interestTotal.div(financedAmount).toFixed(4))
        : new Prisma.Decimal(0);

      // Status: data-driven from installments + canceled/baddebt
      const contractInstallments = installmentsByContract[contractCode] || [];
      const allPaid = contractInstallments.length > 0 && contractInstallments.every((i) => s(i.ins_status) === '4');
      const canceledAt = parseDate(legacyContract.canceled_at);
      const baddebtAt = parseDate(legacyContract.baddebt_at);

      let status: ContractStatus;
      if (baddebtAt) {
        status = ContractStatus.CLOSED_BAD_DEBT;
      } else if (allPaid && canceledAt) {
        // ผ่อนครบแล้ว + flag canceled = น่าจะเป็นเคสแลกเครื่อง (EXCHANGED) ในระบบเก่า
        status = ContractStatus.EXCHANGED;
      } else if (canceledAt) {
        // ลูกค้ายกเลิก/คืนเครื่องก่อนผ่อนครบ → ปิดสัญญาแบบไม่จบ
        status = ContractStatus.CLOSED_BAD_DEBT;
      } else if (allPaid) {
        status = ContractStatus.COMPLETED;
      } else {
        // มีงวดค้าง — เช็คว่า overdue หรือไม่
        const now = new Date();
        const hasOverdue = contractInstallments.some((i) => {
          if (s(i.ins_status) === '4') return false;
          const due = parseDate(i.ins_due_date);
          return due && due < now;
        });
        status = hasOverdue ? ContractStatus.OVERDUE : ContractStatus.ACTIVE;
      }

      const contractData = {
        contractNumber: contractCode,
        customerId: customer.id,
        productId,
        branchId: report.placeholders.branchId,
        salespersonId: report.placeholders.salespersonId,
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
        reviewedAt: parseDate(legacyContract.approved_at) || parseDate(order.created_at) || new Date(),
        reviewedById: report.placeholders.salespersonId,
        notes: [
          s(legacyContract.contract_remark),
          canceledAt && `[ยกเลิกจากระบบเก่า ${canceledAt.toISOString().slice(0, 10)}] ${s(legacyContract.canceled_remark) || ''}`.trim(),
          s(legacyContract.baddebt_remark) && `[หนี้สูญ] ${s(legacyContract.baddebt_remark)}`,
        ].filter(Boolean).join('\n') || null,
        createdAt: parseDate(order.created_at) || new Date(),
        legacyContractCode: contractCode,
      };

      let contractId: string;
      if (dryRun) {
        contractId = '<dry-contract-id>';
        report.contracts.created++;
      } else {
        const existingContract = await prisma.contract.findUnique({ where: { legacyContractCode: contractCode } });
        if (existingContract) {
          contractId = existingContract.id;
          await prisma.contract.update({ where: { id: contractId }, data: contractData as any });
          report.contracts.updated++;
        } else {
          const created = await prisma.contract.create({ data: contractData as any });
          contractId = created.id;
          report.contracts.created++;
        }
      }

      // ----- PAYMENTS -----
      // Sort by due_date เพื่อกำหนด installmentNo เป็น sequential 1..N
      // (ทนต่อ malformed codes ในข้อมูลเก่า เช่น "1","2" หรือ "IBCP-XXX-IBCP-XXX-1")
      const sortedInstallments = [...contractInstallments].sort((a, b) => {
        const da = parseDate(a.ins_due_date)?.getTime() || 0;
        const db = parseDate(b.ins_due_date)?.getTime() || 0;
        return da - db;
      });
      for (let idx = 0; idx < sortedInstallments.length; idx++) {
        const inst = sortedInstallments[idx];
        try {
          const instCode = s(inst.code);
          if (!instCode) continue;
          const installmentNo = idx + 1;
          // legacyCode prefix ด้วย contract code เพื่อ uniqueness (ทนต่อ malformed code)
          const uniqueLegacyCode = `${contractCode}#${instCode}`;
          const insStatus = s(inst.ins_status);
          const dueDate = parseDate(inst.ins_due_date) || new Date();
          const amountDue = parseMoney(inst.ins_amount);
          const amountPaid = parseMoney(inst.ins_paid);

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

          const paidAt = pStatus === PaymentStatus.PAID ? parseDate(inst.updated_at) : null;

          const paymentData = {
            contractId,
            installmentNo,
            dueDate,
            amountDue,
            amountPaid,
            status: pStatus,
            paidDate: paidAt,
            paidAt,
            recordedById: report.placeholders.salespersonId,
            notes: s(inst.ins_remark),
            legacyInstallmentCode: uniqueLegacyCode,
          };

          if (dryRun) {
            report.payments.created++;
            continue;
          }

          const existingPayment = await prisma.payment.findUnique({ where: { legacyInstallmentCode: uniqueLegacyCode } });
          if (existingPayment) {
            await prisma.payment.update({ where: { id: existingPayment.id }, data: paymentData as any });
            report.payments.updated++;
          } else {
            await prisma.payment.create({ data: paymentData as any });
            report.payments.created++;
          }
        } catch (e: any) {
          report.payments.errors.push(`installment ${inst.code}: ${e.message}`);
        }
      }
    } catch (e: any) {
      report.contracts.errors.push(`order ${order.code}: ${e.message}`);
    }
  }

  console.log(`  ✓ products: ${report.products.created} created, ${report.products.updated} updated, ${report.products.errors.length} errors`);
  console.log(`  ✓ contracts: ${report.contracts.created} created, ${report.contracts.updated} updated, ${report.contracts.errors.length} errors`);
  console.log(`  ✓ payments: ${report.payments.created} created, ${report.payments.updated} updated, ${report.payments.errors.length} errors`);
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Legacy Data Import (โปรแกรมเขียว → BESTCHOICE)');
  console.log('═══════════════════════════════════════════════');
  console.log(`Mode:    ${dryRun ? '🟡 DRY-RUN (no DB writes)' : '🔴 LIVE (will write to DB)'}`);
  console.log(`CSV dir: ${csvDir}`);

  await ensurePlaceholders();
  await importCustomers();
  await importContractsProductsPayments();

  // Write report
  const reportPath = path.resolve(__dirname, `import-report-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log('\n═══════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════');
  console.log(`Customers: ${report.customers.created} created, ${report.customers.updated} updated, ${report.customers.skipped} skipped`);
  console.log(`Products:  ${report.products.created} created, ${report.products.updated} updated`);
  console.log(`Contracts: ${report.contracts.created} created, ${report.contracts.updated} updated`);
  console.log(`Payments:  ${report.payments.created} created, ${report.payments.updated} updated`);
  const totalErrors = report.customers.errors.length + report.products.errors.length + report.contracts.errors.length + report.payments.errors.length;
  console.log(`Errors:    ${totalErrors}`);
  console.log(`Report:    ${reportPath}`);
  if (totalErrors > 0) {
    console.log('\n⚠️  First 10 errors:');
    [...report.customers.errors, ...report.products.errors, ...report.contracts.errors, ...report.payments.errors].slice(0, 10).forEach((e) => console.log('  - ' + e));
  }
}

main()
  .catch((e) => {
    console.error('💥 FATAL:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
