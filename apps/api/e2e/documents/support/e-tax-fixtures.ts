import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { RdApiClient, RdSubmitConfig } from '../../../src/modules/e-tax-xml/rd-client/rd-api.client';
import { ETaxAutoSubmitCron } from '../../../src/modules/e-tax-xml/etax-auto-submit.cron';
import { computeInstallmentBreakdown } from '../../../src/modules/journal/compute-installment-breakdown';
import { generatePaymentSchedule } from '../../../src/utils/installment.util';
import { TEST_DOC_PREFIX, TEST_NAME_PREFIX } from '../../../src/utils/test-data-markers';
import { syntheticNationalId } from './fixtures';
import { STANDARD_17K_12M } from './receipts-fixtures';

/**
 * DOC-07 (issue #1566) fixtures. The e-Tax document center reads Payment rows
 * (status PAID, vatAmount > 0) whose contract belongs to a branch of the
 * selected company — so the world's branches get a company, and contracts get
 * their payment schedule from the application's own generator (per-installment
 * principal / interest / commission / VAT split), exactly as ContractQuoteService
 * does when a contract is created in the app.
 */

/** Attach a world branch to the SHOP or FINANCE legal entity; returns the company id. */
export async function attachBranchToCompany(prisma: PrismaService, branchId: string, companyCode: 'SHOP' | 'FINANCE'): Promise<string> {
  const company = await prisma.companyInfo.findFirstOrThrow({ where: { companyCode, deletedAt: null }, select: { id: true } });
  await prisma.branch.update({ where: { id: branchId }, data: { companyId: company.id } });
  return company.id;
}

export interface VatInstallment { installmentNo: number; paymentId: string; amountDue: string; vatAmount: string; dueDate: Date }
export interface VatContract {
  id: string;
  contractNumber: string;
  productId: string;
  branchId: string;
  customerId: string;
  months: number;
  installments: VatInstallment[];
}

export interface VatContractInput {
  prefix: string;
  label: string;
  branchId: string;
  customerId: string;
  salespersonId: string;
  paymentDueDay?: number;
}

/**
 * ACTIVE FINANCE contract on the CPA golden money (17K/12M) whose 12 Payment rows
 * come from `generatePaymentSchedule` with breakdown totals — the same call the
 * contract quote makes — so every row carries `vatAmount` (99.17, last row 99.13).
 * `activateContract` (receipts-fixtures) must be called afterwards for the 1A journal.
 */
export async function createVatContract(prisma: PrismaService, input: VatContractInput): Promise<VatContract> {
  const money = STANDARD_17K_12M;
  const breakdown = computeInstallmentBreakdown({
    financedAmount: money.financedAmount, storeCommission: money.storeCommission, interestTotal: money.interestTotal, vatAmount: money.vatAmount, totalMonths: money.months,
  });
  const monthlyPayment = breakdown.installmentTotal.toNumber();
  const scheduleTotal = new Prisma.Decimal(money.financedAmount).plus(money.storeCommission).plus(money.interestTotal).plus(money.vatAmount).toNumber();
  const product = await prisma.product.create({ data: {
    name: `${TEST_NAME_PREFIX} iPhone e-Tax ${input.label} ${input.prefix}`, brand: 'Apple', model: 'iPhone (ทดสอบระบบ)', category: 'PHONE_NEW',
    branchId: input.branchId, costPrice: '8000', cashPrice: money.sellingPrice, installmentPrice: money.sellingPrice,
    imeiSerial: `${TEST_DOC_PREFIX}${input.prefix}-ET-${input.label}`, status: 'IN_STOCK',
  } });
  const contract = await prisma.contract.create({ data: {
    contractNumber: `${TEST_DOC_PREFIX}${input.prefix}-ET-${input.label}`, customerId: input.customerId, productId: product.id,
    branchId: input.branchId, salespersonId: input.salespersonId, planType: 'STORE_WITH_INTEREST',
    sellingPrice: money.sellingPrice, downPayment: money.downPayment, financedAmount: money.financedAmount, interestRate: money.interestRate,
    totalMonths: money.months, interestTotal: money.interestTotal, storeCommission: money.storeCommission, vatAmount: money.vatAmount,
    vatPct: money.vatPct, monthlyPayment: monthlyPayment.toFixed(2), paymentDueDay: input.paymentDueDay ?? 5, status: 'ACTIVE',
  } });
  const rows = generatePaymentSchedule(contract.id, money.months, scheduleTotal, monthlyPayment, input.paymentDueDay ?? 5, {
    principal: Number(money.financedAmount), interestTotal: Number(money.interestTotal), storeCommission: Number(money.storeCommission), vatAmount: Number(money.vatAmount),
  }, new Date());
  await prisma.payment.createMany({ data: rows });
  const principal = new Prisma.Decimal(money.financedAmount).div(money.months).toDecimalPlaces(2);
  const interest = new Prisma.Decimal(money.interestTotal).div(money.months).toDecimalPlaces(2);
  for (const row of rows) {
    await prisma.installmentSchedule.create({ data: { contractId: contract.id, installmentNo: row.installmentNo, dueDate: row.dueDate, principal, interest, amountDue: row.amountDue.toFixed(2) } });
  }
  const payments = await prisma.payment.findMany({ where: { contractId: contract.id }, orderBy: { installmentNo: 'asc' }, select: { id: true, installmentNo: true, amountDue: true, vatAmount: true, dueDate: true } });
  return {
    id: contract.id, contractNumber: contract.contractNumber, productId: product.id, branchId: input.branchId, customerId: input.customerId, months: money.months,
    installments: payments.map((p) => ({ installmentNo: p.installmentNo, paymentId: p.id, amountDue: p.amountDue.toFixed(2), vatAmount: (p.vatAmount ?? new Prisma.Decimal(0)).toFixed(2), dueDate: p.dueDate })),
  };
}

/** A buyer whose name and registered address are long enough to push the invoice onto continuation pages. */
export async function createLongAddressCustomer(prisma: PrismaService, prefix: string): Promise<{ id: string; name: string; nationalId: string; address: string }> {
  const name = `${TEST_NAME_PREFIX} ห้างหุ้นส่วนจำกัด ทดสอบระบบ ชื่อยาวมากสำหรับตรวจการตัดบรรทัดของใบกำกับภาษี สาขาที่ 00001 (${prefix})`;
  const parts: string[] = [];
  for (let i = 1; i <= 18; i += 1) parts.push(`เลขที่ ${i}/${100 + i} หมู่ที่ ${i} ซอยทดสอบระบบ ${i} ถนนทดสอบระบบสายยาว แขวงทดสอบระบบ เขตทดสอบระบบ กรุงเทพมหานคร 10${String(i).padStart(3, '0')}`);
  const address = `${parts.join(' · ')} — ข้อมูลทดสอบระบบ ลบได้`;
  const row = await prisma.customer.create({ data: {
    name, phone: '0800000002', nationalId: syntheticNationalId(), birthDate: new Date('1985-06-15'), addressIdCard: address, addressCurrent: address,
  } });
  return { id: row.id, name: row.name, nationalId: row.nationalId as string, address };
}

export interface SyntheticCertificate { certPath: string; password: string; subject: string; commonName: string }

/**
 * Self-signed RSA certificate packed as PKCS#12 with openssl (LibreSSL/OpenSSL
 * legacy PBE so node-forge can open it). Test-only material: 2-day validity, not
 * issued by any CA — it proves the signing code path, not RD acceptance.
 */
export function synthesizeCertificate(dir: string): SyntheticCertificate {
  mkdirSync(dir, { recursive: true });
  const key = join(dir, 'synthetic-etax.key.pem');
  const cert = join(dir, 'synthetic-etax.cert.pem');
  const p12 = join(dir, 'synthetic-etax.p12');
  const commonName = 'SYNTHETIC e-Tax signer (test only)';
  const subject = `/CN=${commonName}/O=TEST NOT A REAL CA/C=TH`;
  const password = 'synthetic-test-only';
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', subject], { stdio: 'pipe' });
  execFileSync('openssl', ['pkcs12', '-export', '-inkey', key, '-in', cert, '-out', p12, '-passout', `pass:${password}`, '-name', 'synthetic-etax'], { stdio: 'pipe' });
  return { certPath: p12, password, subject, commonName };
}

export interface RdCall { op: 'submit' | 'checkStatus' | 'ping'; at: string; endpoint: string; username: string; signedXmlSha256?: string; rdSubmissionId?: string; verdict?: string }
export interface SyntheticRd {
  calls: RdCall[];
  /** Verdict the next submit returns. */
  submitVerdict: 'ACCEPT' | 'REJECT';
  /** Status the next checkStatus returns. */
  pollStatus: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  restore(): void;
}

/**
 * Replace the Revenue Department client with scripted verdicts (jest spies on the
 * prototype, so the service's own instance is covered) and mute the hourly
 * auto-submit job. Nothing leaves the process.
 */
export function installSyntheticRd(): SyntheticRd {
  const rd: SyntheticRd = { calls: [], submitVerdict: 'ACCEPT', pollStatus: 'ACCEPTED', restore: () => undefined };
  const spies = [
    jest.spyOn(RdApiClient.prototype, 'submit').mockImplementation(async (signedXml: string, config: RdSubmitConfig) => {
      const verdict = rd.submitVerdict;
      rd.calls.push({ op: 'submit', at: new Date().toISOString(), endpoint: config.endpoint, username: config.username, signedXmlSha256: createHash('sha256').update(signedXml).digest('hex'), verdict });
      return verdict === 'ACCEPT'
        ? { accepted: true, submissionId: `RD-SYNTHETIC-${rd.calls.length}`, rawResponse: { synthetic: true, result_code: 'ACCEPTED' } }
        : { accepted: false, reason: 'SYNTHETIC RD: schema rejected (test verdict)', rawResponse: { synthetic: true, result_code: 'REJECTED' } };
    }),
    jest.spyOn(RdApiClient.prototype, 'checkStatus').mockImplementation(async (rdSubmissionId: string, config: RdSubmitConfig) => {
      rd.calls.push({ op: 'checkStatus', at: new Date().toISOString(), endpoint: config.endpoint, username: config.username, rdSubmissionId, verdict: rd.pollStatus });
      return { status: rd.pollStatus, rawResponse: { synthetic: true, status: rd.pollStatus } };
    }),
    jest.spyOn(RdApiClient.prototype, 'ping').mockImplementation(async (config: RdSubmitConfig) => {
      rd.calls.push({ op: 'ping', at: new Date().toISOString(), endpoint: config.endpoint, username: config.username });
      return { ok: true, detail: 'SYNTHETIC RD (jest spy) — no network' };
    }),
    jest.spyOn(ETaxAutoSubmitCron.prototype, 'tick').mockResolvedValue(undefined),
  ];
  rd.restore = () => spies.forEach((spy) => spy.mockRestore());
  return rd;
}

export const SYNTHETIC_RD_CONFIG = { rdEndpoint: 'http://127.0.0.1:9/etaxws-synthetic', rdUsername: 'synthetic-user', rdPassword: 'synthetic-pass' } as const;

/** Bangkok calendar year/month of a moment — the e-Tax list is filtered by paidDate month. */
export function bangkokYearMonth(at = new Date()): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: 'numeric' }).formatToParts(at);
  return { year: Number(parts.find((p) => p.type === 'year')!.value), month: Number(parts.find((p) => p.type === 'month')!.value) };
}

/** Thai-locale Buddhist date the invoice PDF prints (mirrors ETaxService.formatThaiDate). */
export function thaiInvoiceDate(at: Date): string {
  return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'long', year: 'numeric' }).format(at);
}
