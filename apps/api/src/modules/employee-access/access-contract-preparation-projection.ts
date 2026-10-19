import {
  AccessResource,
  ContractPreparationRead,
  PermissionKey,
  canAccess,
} from '@installment/shared';
import { Prisma } from '@prisma/client';
import { currentDomainAccess } from './access-execution-context';
import { preparationScope } from './access-contract-preparation-source';
import { shopServiceOriginWhere } from './access-service-origin';
import { financeContractReadWhere } from './access-party-scope';
import { productScopeWhere } from './access-query-scope';
import { CustomerPiiService } from '../customers/customer-pii.service';
import { PrismaService } from '../../prisma/prisma.service';
import { partyIdentityView } from './access-party-source.service';

export const preparationReadSelect = {
  id: true,
  contractNumber: true,
  branchId: true,
  salespersonId: true,
  customerId: true,
  productId: true,
  bundleProductIds: true,
  assignedToId: true,
  createdAt: true,
  updatedAt: true,
  workflowStatus: true,
  planType: true,
  sellingPrice: true,
  downPayment: true,
  interestRate: true,
  totalMonths: true,
  interestTotal: true,
  financedAmount: true,
  monthlyPayment: true,
  paymentDueDay: true,
  hasOwnershipClause: true,
  hasRepossessionClause: true,
  hasEarlyPayoffClause: true,
  hasNoTransferClause: true,
  hasAcknowledgement: true,
  branch: { select: { id: true, name: true } },
  promotionTerms: { select: { id: true } },
} satisfies Prisma.ContractSelect;
type Row = Prisma.ContractGetPayload<{ select: typeof preparationReadSelect }>;
const productSelect = {
  id: true,
  name: true,
  brand: true,
  model: true,
  category: true,
  imeiSerial: true,
  serialNumber: true,
  color: true,
  storage: true,
} satisfies Prisma.ProductSelect;

/** Bounded R112 evidence: only this actual parent, no sibling-history traversal.
 * Optional FINANCE evidence needs independent canonical case read and customer
 * read; its absence never blocks the SHOP shell. */
export class PreparationReadProjection {
  private readonly ctx = currentDomainAccess()!;
  readonly live = new Set<'SHOP' | 'FINANCE'>();
  async initialize() {
    for (const row of await this.ctx.client.companyInfo.findMany({
      where: { companyCode: { in: ['SHOP', 'FINANCE'] }, isActive: true, deletedAt: null },
      select: { companyCode: true },
    }))
      this.live.add(row.companyCode as 'SHOP' | 'FINANCE');
    return this;
  }
  private scope(permission: PermissionKey, company: 'SHOP' | 'FINANCE') {
    return preparationScope(this.ctx.snapshot, permission, company);
  }
  customerWhere(): Prisma.ContractWhereInput {
    const scope = this.scope('customers.read', 'SHOP');
    const shop = scope.tuples.map((tuple) => ({
      AND: [
        shopServiceOriginWhere({
          ...scope,
          tuples: [
            {
              ...tuple,
              scope:
                tuple.scope === 'ASSIGNED'
                  ? tuple.branchIds.length
                    ? 'BRANCHES'
                    : 'COMPANY'
                  : tuple.scope,
            },
          ],
        }),
        {
          customer: {
            deletedAt: null,
            mergedIntoId: null,
            ...(tuple.scope === 'ASSIGNED'
              ? {
                  assignedToId: this.ctx.snapshot.userId,
                  assignedTo: { isActive: true, deletedAt: null, isSystemUser: false },
                }
              : {}),
          },
        },
      ],
    }));
    const lanes = [
      ...shop,
      ...(this.live.has('FINANCE')
        ? [
            {
              AND: [
                financeContractReadWhere(this.scope('contracts.read', 'FINANCE')),
                financeContractReadWhere(this.scope('customers.read', 'FINANCE')),
                { customer: { deletedAt: null, mergedIntoId: null } },
              ],
            },
          ]
        : []),
    ];
    return lanes.length ? { OR: lanes } : { id: { in: [] } };
  }
  /** Lock current identities before their names/IDs contribute to page or count.
   * The exact same-parent proof makes this set bounded by the Contract envelope. */
  async lockCustomers(ids: readonly string[]) {
    if (!ids.length) return;
    await this.ctx.client.$queryRaw`SELECT c.id FROM customers c WHERE c.id IN (
      SELECT customer_id FROM contracts WHERE id=ANY(${[...ids]}::text[])
    ) ORDER BY c.id FOR SHARE OF c`;
  }
  async lockProducts(rows: readonly Row[]) {
    const ids = [
      ...new Set(rows.flatMap((row) => [row.productId, ...row.bundleProductIds])),
    ].sort();
    if (!ids.length) return;
    const db = this.ctx.client;
    await db.$queryRaw`SELECT id FROM products WHERE id=ANY(${ids}::text[]) ORDER BY id FOR SHARE`;
    await db.$queryRaw`SELECT b.id FROM branches b WHERE b.id IN (
      SELECT branch_id FROM products WHERE id=ANY(${ids}::text[])
    ) ORDER BY b.id FOR SHARE OF b`;
    await db.$queryRaw`SELECT ci.id FROM company_info ci WHERE ci.id IN (
      SELECT COALESCE(p.owned_by_company_id, b.company_id) FROM products p
      JOIN branches b ON b.id=p.branch_id WHERE p.id=ANY(${ids}::text[])
    ) ORDER BY ci.id FOR SHARE OF ci`;
  }
  async lockDocuments(rows: readonly Row[]) {
    const ids = rows
      .filter((row) =>
        canAccess(this.ctx.snapshot, 'documents.read', { company: 'SHOP', branchId: row.branchId }),
      )
      .map((row) => row.id)
      .sort();
    if (!ids.length) return;
    const db = this.ctx.client;
    await db.$queryRaw`SELECT id FROM signatures WHERE contract_id=ANY(${ids}::text[]) AND deleted_at IS NULL ORDER BY id FOR SHARE`;
    await db.$queryRaw`SELECT id FROM e_documents WHERE contract_id=ANY(${ids}::text[]) AND deleted_at IS NULL ORDER BY id FOR SHARE`;
    const metadata = rows
      .filter(
        (row) =>
          ids.includes(row.id) &&
          canAccess(this.ctx.snapshot, 'contract-documents.read', {
            company: 'SHOP',
            branchId: row.branchId,
          }),
      )
      .map((row) => row.id)
      .sort();
    if (metadata.length)
      await db.$queryRaw`SELECT id FROM contract_documents WHERE contract_id=ANY(${metadata}::text[]) AND deleted_at IS NULL ORDER BY id FOR SHARE`;
  }
  private customerSources(row: Row, assignedToId: string | null): AccessResource[] {
    const snapshot = this.ctx.snapshot;
    const shop: AccessResource = {
      company: 'SHOP',
      branchId: row.branchId,
      assignedUserIds: assignedToId ? [assignedToId] : [],
    };
    const finance: AccessResource = {
      company: 'FINANCE',
      branchId: row.branchId,
      assignedUserIds: row.assignedToId ? [row.assignedToId] : [],
    };
    return [
      ...(canAccess(snapshot, 'customers.read', shop) ? [shop] : []),
      ...(this.live.has('FINANCE') &&
      canAccess(snapshot, 'contracts.read', finance) &&
      canAccess(snapshot, 'customers.read', finance)
        ? [finance]
        : []),
    ];
  }
  async project(row: Row): Promise<ContractPreparationRead> {
    const db = this.ctx.client;
    const snapshot = this.ctx.snapshot;
    const source = { company: 'SHOP' as const, branchId: row.branchId };
    const documents = canAccess(snapshot, 'documents.read', source);
    const documentMetadata = documents && canAccess(snapshot, 'contract-documents.read', source);
    let customer: ContractPreparationRead['customer'] = null;
    if (await db.contract.count({ where: { id: row.id, AND: this.customerWhere() } })) {
      const identity = await db.customer.findFirst({
        where: { id: row.customerId, deletedAt: null, mergedIntoId: null },
        select: {
          id: true,
          name: true,
          phone: true,
          phoneEncrypted: true,
          nationalId: true,
          nationalIdEncrypted: true,
          assignedToId: true,
        },
      });
      if (identity) {
        const pii = new CustomerPiiService(db as PrismaService);
        const decrypted = pii.decryptCustomerFields(identity, {
          strict: await pii.isStrictMode(db),
        })!;
        customer = {
          id: identity.id,
          name: identity.name,
          phone: decrypted.phone ?? null,
          nationalId:
            partyIdentityView(decrypted, snapshot, this.customerSources(row, identity.assignedToId))
              .nationalId ?? null,
        };
      }
    }
    const products = await db.product.findMany({
      where: {
        id: { in: [row.productId, ...row.bundleProductIds] },
        deletedAt: null,
        OR: [...this.live].map((company) =>
          productScopeWhere(this.scope('products.read', company)),
        ),
      },
      select: productSelect,
    });
    const byId = new Map(products.map((product) => [product.id, product]));
    const product = byId.get(row.productId) ?? null;
    const bundlePermission = [...this.live].some((company) =>
      this.scope('products.read', company).tuples.some(
        (tuple) =>
          tuple.scope === 'COMPANY' || (tuple.scope === 'BRANCHES' && tuple.branchIds.length),
      ),
    );
    const completeBundles =
      [...this.live].every((company) =>
        this.scope('products.read', company).tuples.some((tuple) => tuple.scope === 'COMPANY'),
      ) && row.bundleProductIds.every((id) => byId.has(id));
    const bundleProducts = bundlePermission
      ? row.bundleProductIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
      : null;
    const signatures = documents
      ? (
          await db.signature.findMany({
            where: { contractId: row.id, deletedAt: null },
            select: { id: true, signerType: true, signedAt: true },
            orderBy: { id: 'asc' },
          })
        ).map((value) => ({ ...value, signedAt: value.signedAt.toISOString() }))
      : null;
    const eDocuments = documents
      ? (
          await db.eDocument.findMany({
            where: { contractId: row.id, deletedAt: null },
            select: { id: true, documentType: true, createdAt: true },
            orderBy: { id: 'asc' },
          })
        ).map((value) => ({ ...value, createdAt: value.createdAt.toISOString() }))
      : null;
    const contractDocuments = documentMetadata
      ? (
          await db.contractDocument.findMany({
            where: { contractId: row.id, deletedAt: null },
            select: {
              id: true,
              documentType: true,
              version: true,
              isLatest: true,
              createdAt: true,
            },
            orderBy: { id: 'asc' },
          })
        ).map((value) => ({ ...value, createdAt: value.createdAt.toISOString() }))
      : null;
    return {
      view: 'SHOP_PREPARATION',
      applicationState: 'PRE_ACTIVATION',
      id: row.id,
      contractNumber: row.contractNumber,
      branchId: row.branchId,
      branch: row.branch,
      salespersonId: row.salespersonId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      workflowStatus: row.workflowStatus,
      planType: row.planType,
      sellingPrice: row.sellingPrice.toString(),
      downPayment: row.downPayment.toString(),
      interestRate: row.interestRate.toString(),
      totalMonths: row.totalMonths,
      interestTotal: row.interestTotal.toString(),
      financedAmount: row.financedAmount.toString(),
      monthlyPayment: row.monthlyPayment.toString(),
      paymentDueDay: row.paymentDueDay,
      hasNamedTerms: row.promotionTerms !== null,
      hasOwnershipClause: row.hasOwnershipClause,
      hasRepossessionClause: row.hasRepossessionClause,
      hasEarlyPayoffClause: row.hasEarlyPayoffClause,
      hasNoTransferClause: row.hasNoTransferClause,
      hasAcknowledgement: row.hasAcknowledgement,
      customer,
      product,
      bundleProducts,
      signatures,
      eDocuments,
      contractDocuments,
      credit: null,
      kyc: null,
      pdpa: null,
      lessor: null,
      availability: {
        customer: customer ? 'VISIBLE_CURRENT' : 'UNAVAILABLE',
        product: product ? 'VISIBLE_CURRENT' : 'UNAVAILABLE',
        bundles: completeBundles ? 'VISIBLE_CURRENT' : bundlePermission ? 'PARTIAL' : 'UNAVAILABLE',
        signatures: documents ? 'VISIBLE_CURRENT' : 'UNAVAILABLE',
        eDocuments: documents ? 'VISIBLE_CURRENT' : 'UNAVAILABLE',
        contractDocuments: documentMetadata ? 'VISIBLE_CURRENT' : 'UNAVAILABLE',
        credit: 'UNAVAILABLE',
        kyc: 'UNAVAILABLE',
        pdpa: 'UNAVAILABLE',
        lessor: 'UNAVAILABLE',
      },
    };
  }
}
