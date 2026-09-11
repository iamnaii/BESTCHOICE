import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import type { PlanType } from '@prisma/client';
import { resolveCompanyAccess } from '@installment/shared';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { TEST_CUSTOMER_ADDRESS, TEST_DOC_PREFIX, TEST_NAME_PREFIX, TEST_NOTE_MARKER } from '../../../src/utils/test-data-markers';

/**
 * Synthetic company / branches / users / customer / signed contracts for the
 * documents harness. Every row carries the repo's test markers
 * (src/utils/test-data-markers.ts) and a per-run prefix so several runs or
 * domains can share one disposable database without colliding.
 *
 * Users are created with real bcrypt hashes so scenarios log in through
 * POST /auth/login exactly like the web app.
 */
export const SIGNATURE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

export type WorldRole = 'owner' | 'branchManagerA' | 'salesA' | 'salesB' | 'accountant' | 'financeManager';
export interface WorldUser { id: string; email: string; role: string; branchId: string | null; password: string }
export interface WorldContract { id: string; contractNumber: string; productId: string; branchId: string; customerId: string }
export interface DocumentsWorld {
  prefix: string;
  password: string;
  branches: { a: { id: string; name: string }; b: { id: string; name: string } };
  users: Record<WorldRole, WorldUser>;
  customer: { id: string; name: string };
  contracts: { a: WorldContract; b: WorldContract };
}

export function syntheticNationalId(): string {
  // 13 digits, never a real checksum-valid pattern from a person: starts with 7 + timestamp tail.
  return `79${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
}

export async function seedDocumentsWorld(prisma: PrismaService, options: { prefix?: string } = {}): Promise<DocumentsWorld> {
  const prefix = options.prefix ?? `DOCS-${randomUUID().slice(0, 8).toUpperCase()}`;
  const password = `Docs!${prefix.slice(-8)}`;
  const hashed = await bcrypt.hash(password, 10);

  for (const [companyCode, nameTh] of [['SHOP', 'บริษัทหน้าร้าน'], ['FINANCE', 'บริษัทไฟแนนซ์']] as const) {
    await prisma.companyInfo.upsert({
      where: { companyCode },
      update: {},
      create: {
        companyCode, nameTh: `${TEST_NAME_PREFIX} ${nameTh}`, nameEn: `SYNTHETIC ${companyCode}`, taxId: '0000000000000',
        address: TEST_CUSTOMER_ADDRESS, phone: '020000000', directorName: `${TEST_NAME_PREFIX} ผู้ลงนาม`, directorPosition: 'กรรมการ',
      },
    });
  }

  const branch = async (label: string) => {
    const row = await prisma.branch.create({ data: { name: `${TEST_NAME_PREFIX} ${prefix} สาขา ${label}`, location: TEST_CUSTOMER_ADDRESS, phone: '020000000' } });
    return { id: row.id, name: row.name };
  };
  const a = await branch('A');
  const b = await branch('B');

  const user = async (key: string, role: string, branchId: string | null): Promise<WorldUser> => {
    const access = resolveCompanyAccess(role, [], null);
    const row = await prisma.user.create({ data: {
      email: `${prefix.toLowerCase()}.${key.toLowerCase()}@example.invalid`, password: hashed, name: `${TEST_NAME_PREFIX} ${role} ${key}`, role: role as never,
      branchId, accessibleCompanies: [...access.accessible], primaryCompany: access.primary,
    } });
    return { id: row.id, email: row.email, role, branchId, password };
  };
  const users: Record<WorldRole, WorldUser> = {
    owner: await user('owner', 'OWNER', null),
    branchManagerA: await user('manager-a', 'BRANCH_MANAGER', a.id),
    salesA: await user('sales-a', 'SALES', a.id),
    salesB: await user('sales-b', 'SALES', b.id),
    accountant: await user('accountant', 'ACCOUNTANT', null),
    financeManager: await user('finance', 'FINANCE_MANAGER', null),
  };

  const customerRow = await prisma.customer.create({ data: {
    name: `${TEST_NAME_PREFIX} ลูกค้าเอกสาร ${prefix}`, phone: '0800000001', nationalId: syntheticNationalId(), birthDate: new Date('1990-01-01'),
    addressIdCard: TEST_CUSTOMER_ADDRESS, addressCurrent: TEST_CUSTOMER_ADDRESS, lineIdFinance: `TEST-NOT-SENT-${prefix}`,
  } });
  const customer = { id: customerRow.id, name: customerRow.name };

  const contracts = {
    a: await createSignedContract(prisma, { prefix, label: 'A', branchId: a.id, customerId: customer.id, salespersonId: users.salesA.id }),
    b: await createSignedContract(prisma, { prefix, label: 'B', branchId: b.id, customerId: customer.id, salespersonId: users.salesB.id }),
  };
  return { prefix, password, branches: { a, b }, users, customer, contracts };
}

export interface SignedContractInput {
  prefix: string;
  label: string;
  branchId: string;
  customerId: string;
  salespersonId: string;
  months?: number;
  planType?: PlanType;
  /** Skip the four signatures to model an unsigned contract. */
  unsigned?: boolean;
}

/** A fully signed STORE_DIRECT contract with PDPA consent and an installment schedule. */
export async function createSignedContract(prisma: PrismaService, input: SignedContractInput): Promise<WorldContract> {
  const months = input.months ?? 6;
  const product = await prisma.product.create({ data: {
    name: `${TEST_NAME_PREFIX} iPhone เอกสาร ${input.label} ${input.prefix}`, brand: 'Apple', model: 'iPhone (ทดสอบระบบ)', category: 'PHONE_NEW',
    branchId: input.branchId, costPrice: '6000', cashPrice: '10000', installmentPrice: '10000', imeiSerial: `${TEST_DOC_PREFIX}${input.prefix}-${input.label}`,
  } });
  const consent = await prisma.pDPAConsent.create({ data: {
    customerId: input.customerId, consentVersion: 'docs-harness', privacyNoticeText: `${TEST_NOTE_MARKER} ประกาศความเป็นส่วนตัวตัวอย่าง`,
    status: 'GRANTED', grantedAt: new Date(), signatureImage: SIGNATURE_PNG,
  } });
  const monthly = '1413.33';
  const firstDue = new Date();
  firstDue.setMonth(firstDue.getMonth() + 1, 5);
  const payments = Array.from({ length: months }, (_, index) => {
    const dueDate = new Date(firstDue);
    dueDate.setMonth(firstDue.getMonth() + index);
    return { installmentNo: index + 1, dueDate, amountDue: monthly };
  });
  const contract = await prisma.contract.create({ data: {
    contractNumber: `${TEST_DOC_PREFIX}${input.prefix}-${input.label}`, planType: input.planType ?? 'STORE_DIRECT', branchId: input.branchId,
    customerId: input.customerId, productId: product.id, salespersonId: input.salespersonId, pdpaConsentId: consent.id,
    sellingPrice: '10000', downPayment: '2000', interestRate: '0.01', totalMonths: months, interestTotal: '480', financedAmount: '8000', monthlyPayment: monthly,
    payments: { create: payments },
    ...(input.unsigned ? {} : { signatures: { create: (['CUSTOMER', 'COMPANY', 'WITNESS_1', 'WITNESS_2'] as const).map((signerType) => ({ signerType, signatureImage: SIGNATURE_PNG })) } }),
  } });
  return { id: contract.id, contractNumber: contract.contractNumber, productId: product.id, branchId: input.branchId, customerId: input.customerId };
}
