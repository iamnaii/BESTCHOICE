import { CustomerPiiService } from '../customers/customer-pii.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { ContractReadMetadata } from '@installment/shared';
import { PartyQueryPlan } from './access-party-query-plan';
import { AccessPartySourceService, partyIdentityView } from './access-party-source.service';
import { AccessResourceService } from './access-resource.service';
import { currentDomainAccess } from './access-execution-context';

// Explicit finite read contract. Mutation/business getters remain untouched.
export const contractReadSelect = {
  id: true,
  contractNumber: true,
  branchId: true,
  customerId: true,
  productId: true,
  bundleProductIds: true,
  planType: true,
  sellingPrice: true,
  downPayment: true,
  interestRate: true,
  totalMonths: true,
  interestTotal: true,
  financedAmount: true,
  monthlyPayment: true,
  paymentDueDay: true,
  vatAmount: true,
  vatPct: true,
  status: true,
  workflowStatus: true,
  reviewedAt: true,
  createdAt: true,
  updatedAt: true,
  deviceReceivedAt: true,
  shopWarrantyStartDate: true,
  shopWarrantyEndDate: true,
  hasOwnershipClause: true,
  hasRepossessionClause: true,
  hasEarlyPayoffClause: true,
  hasNoTransferClause: true,
  hasAcknowledgement: true,
  advanceBalance: true,
  rescheduleAdvanceBalance: true,
  creditBalance: true,
  dunningStage: true,
  dunningEscalatedAt: true,
  dunningLastActionAt: true,
  pendingDunningStage: true,
  pendingDunningSince: true,
  noAnswerCount: true,
  keptPromiseCount: true,
  needsSkipTracing: true,
  lastContactDate: true,
  deviceLocked: true,
  deviceLockedAt: true,
  wallpaperChanged: true,
  wallpaperChangedAt: true,
  mdmLockedAt: true,
  branch: { select: { id: true, name: true } },
} satisfies Prisma.ContractSelect;
type Row = Prisma.ContractGetPayload<{ select: typeof contractReadSelect }>;
const collectionFields = [
  'dunningStage',
  'dunningEscalatedAt',
  'dunningLastActionAt',
  'pendingDunningStage',
  'pendingDunningSince',
  'noAnswerCount',
  'keptPromiseCount',
  'needsSkipTracing',
  'lastContactDate',
] as const;
const mdmFields = [
  'deviceLocked',
  'deviceLockedAt',
  'wallpaperChanged',
  'wallpaperChangedAt',
  'mdmLockedAt',
] as const;
const paymentFields = ['advanceBalance', 'rescheduleAdvanceBalance', 'creditBalance'] as const;
const productSelect = {
  id: true,
  name: true,
  brand: true,
  model: true,
  category: true,
  status: true,
  imeiSerial: true,
  serialNumber: true,
  color: true,
  storage: true,
  costPrice: true,
  cashPrice: true,
  installmentPrice: true,
} satisfies Prisma.ProductSelect;
const customerSelect = {
  id: true,
  name: true,
  prefix: true,
  nickname: true,
  phone: true,
  phoneSecondary: true,
  email: true,
  birthDate: true,
  nationalId: true,
  nationalIdEncrypted: true,
  guardianNationalId: true,
  guardianNationalIdEncrypted: true,
  guardianName: true,
  guardianPhone: true,
  guardianRelation: true,
  guardianAddress: true,
  addressIdCard: true,
  addressCurrent: true,
  occupation: true,
  salary: true,
  salaryPayDay: true,
  workplace: true,
  addressWork: true,
  phoneEncrypted: true,
  phoneSecondaryEncrypted: true,
  emailEncrypted: true,
  addressIdCardEncrypted: true,
  addressCurrentEncrypted: true,
  addressWorkEncrypted: true,
  guardianPhoneEncrypted: true,
  guardianAddressEncrypted: true,
} satisfies Prisma.CustomerSelect;
export class ContractReadProjection {
  constructor(
    private readonly plan: PartyQueryPlan,
    private readonly sources: AccessPartySourceService,
    private readonly resources: AccessResourceService,
  ) {}
  private async product(id: string) {
    const db = this.plan.db;
    const row = await db.product.findFirst({
      where: { id, AND: this.plan.product },
      select: productSelect,
    });
    if (!row) return null;
    const source = await this.resources.product(db, id);
    return {
      ...row,
      costPrice: this.plan.allows('sensitive.cost.read', source) ? row.costPrice : null,
    };
  }
  async project(row: Row) {
    const { customerId, productId, bundleProductIds, ...base } = row;
    const db = this.plan.db;
    const source = await this.sources.financeContract(db, row.id);
    const permits = (permission: Parameters<PartyQueryPlan['allows']>[0]) =>
      this.plan.allows(permission, source);
    const paymentsAllowed = permits('payments.read'),
      documentsAllowed = permits('documents.read');
    const collectionsAllowed = permits('collections.read'),
      mdmAllowed = permits('mdm.read');
    const customer = await db.customer.findFirst({
      where: { id: customerId, AND: this.plan.customer },
      select: customerSelect,
    });
    let identity: Record<string, unknown> | null = null;
    if (customer) {
      const evidence = await this.plan.customerSources(customerId);
      if (evidence.length) {
        const pii = new CustomerPiiService(db as PrismaService);
        const decrypted = pii.decryptCustomerFields(customer, {
          strict: await pii.isStrictMode(db),
        })!;
        identity = {
          ...Object.fromEntries(
            Object.entries(decrypted).filter(
              ([key]) => key in customerSelect && !key.endsWith('Encrypted'),
            ),
          ),
          ...partyIdentityView(
            decrypted,
            currentDomainAccess()!.snapshot,
            evidence,
            'customers.read',
          ),
        };
      }
    }
    const product = await this.product(productId);
    const bundleProducts: NonNullable<Awaited<ReturnType<ContractReadProjection['product']>>>[] =
      [];
    let bundleSourcesProven = true;
    for (const id of bundleProductIds) {
      const value = await this.product(id);
      if (value) bundleProducts.push(value);
      else bundleSourcesProven = false;
    }
    // A mixed-company collection is explicitly scoped unless COMPANY permission
    // covers every live product owner. Never compare hidden/visible row counts.
    const bundlesComplete = [...this.plan.live].every((company) =>
      this.plan.company('products.read', company),
    );
    const bundlesAllowed = [...this.plan.live].some((company) =>
      this.plan.has('products.read', company),
    );
    const payments = paymentsAllowed
      ? await db.payment.findMany({
          where: { contractId: row.id, deletedAt: null },
          orderBy: [{ installmentNo: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            installmentNo: true,
            dueDate: true,
            amountDue: true,
            amountPaid: true,
            paidDate: true,
            paymentMethod: true,
            lateFee: true,
            lateFeeWaived: true,
            status: true,
            monthlyPrincipal: true,
            monthlyInterest: true,
            monthlyCommission: true,
            vatAmount: true,
          },
        })
      : null;
    const signatures = documentsAllowed
      ? await db.signature.findMany({
          where: { contractId: row.id, deletedAt: null },
          select: { id: true, signerType: true, signedAt: true },
          orderBy: { id: 'asc' },
        })
      : null;
    const eDocuments = documentsAllowed
      ? await db.eDocument.findMany({
          where: { contractId: row.id, deletedAt: null },
          select: { id: true, documentType: true, createdAt: true },
          orderBy: { id: 'asc' },
        })
      : null;
    const contractDocuments = documentsAllowed
      ? await db.contractDocument.findMany({
          where: { contractId: row.id, deletedAt: null },
          select: { id: true, documentType: true, version: true, isLatest: true, createdAt: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        })
      : null;
    // Same-contract credit only: an unknown/unlinked customer check is not proof.
    const creditAllowed = permits('credit-checks.read');
    const credit = creditAllowed
      ? await db.creditCheck.findFirst({
          where: { contractId: row.id, deletedAt: null },
          select: {
            id: true,
            customerId: true,
            status: true,
            checkType: true,
            aiScore: true,
            riskScore: true,
            salaryVerified: true,
            checkedAt: true,
          },
        })
      : null;
    const creditProven = creditAllowed && (!credit || credit.customerId === customerId);
    const creditCheck =
      credit && creditProven
        ? {
            id: credit.id,
            status: credit.status,
            checkType: credit.checkType,
            aiScore: credit.aiScore,
            riskScore: credit.riskScore,
            salaryVerified: credit.salaryVerified,
            checkedAt: credit.checkedAt,
          }
        : null;
    const availability: ContractReadMetadata['availability'] = {
      customer: identity ? 'VISIBLE_CURRENT' : 'UNAVAILABLE',
      product: product ? 'VISIBLE_CURRENT' : 'UNAVAILABLE',
      bundles:
        bundlesComplete && bundleSourcesProven
          ? 'VISIBLE_CURRENT'
          : bundlesAllowed
            ? 'PARTIAL'
            : 'UNAVAILABLE',
      payments: paymentsAllowed ? 'VISIBLE_CURRENT' : 'UNAVAILABLE',
      documents: documentsAllowed ? 'VISIBLE_CURRENT' : 'UNAVAILABLE',
      credit: creditProven ? 'VISIBLE_CURRENT' : 'UNAVAILABLE',
      collections: collectionsAllowed ? 'VISIBLE_CURRENT' : 'UNAVAILABLE',
      mdm: mdmAllowed ? 'VISIBLE_CURRENT' : 'UNAVAILABLE',
      receipts: 'UNAVAILABLE',
      chat: 'UNAVAILABLE',
      journal: 'UNAVAILABLE',
    };
    return {
      ...base,
      ...Object.fromEntries(
        collectionFields.map((key) => [key, collectionsAllowed ? row[key] : null]),
      ),
      ...Object.fromEntries(mdmFields.map((key) => [key, mdmAllowed ? row[key] : null])),
      ...Object.fromEntries(paymentFields.map((key) => [key, paymentsAllowed ? row[key] : null])),
      status: paymentsAllowed ? row.status : null,
      customerId: identity ? customerId : null,
      customer: identity,
      productId: product ? productId : null,
      product,
      bundleProductIds: bundlesAllowed ? bundleProducts.map((p) => p.id) : null,
      bundleProducts: bundlesAllowed ? bundleProducts : null,
      payments,
      signatures,
      eDocuments,
      contractDocuments,
      creditCheck,
      _count: {
        payments: payments?.length ?? null,
        contractDocuments: contractDocuments?.length ?? null,
      },
      receipts: null,
      chatRooms: null,
      journalEntries: null,
      scope: 'authorized-sources' as const,
      availability,
    };
  }
}
