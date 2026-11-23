import { Prisma, PrismaClient } from '@prisma/client';
import { hashImportValue as hash } from './canonicalize';
import { readImportDatabaseIdentity } from './plan';
import { normalizeSupplierAlias, supplierPhone, validateSupplierInputs } from './supplier-input';
import type { SupplierInput, SupplierIssue } from './supplier-types';
export type SupplierPlanContext = {
  canonicalSetId: string;
  workbookSha256: string;
  workbookPath?: string;
  codeRevision: string;
  accessCompanyCode: 'SHOP';
  accessBranchId: string;
  cutoverAt: string;
  dbIdentity: string;
  matchTargets: Record<string, string>;
  reviewedArchivedTargets?: Record<string, string[]>;
};
export type PlannedSupplierItem = {
  supplierRef: string;
  payload: SupplierInput;
  disposition: 'CREATE' | 'MATCH' | 'CONFLICT';
  targetId: string | null;
  reason: string | null;
  dependencyFingerprint: string;
};
export type SupplierImportPlan = {
  version: 1;
  kind: 'SUPPLIER';
  batchId: string;
  context: SupplierPlanContext;
  inputHash: string;
  planHash: string;
  items: PlannedSupplierItem[];
  issues: SupplierIssue[];
};
export const supplierInclude = {
  paymentMethods: { orderBy: { id: 'asc' as const } },
  contact: true,
};
export type SupplierTarget = Prisma.SupplierGetPayload<{ include: typeof supplierInclude }>;
export const supplierTargetFingerprint = async (tx: Prisma.TransactionClient, id: string) =>
  hash(await tx.supplier.findUniqueOrThrow({ where: { id }, include: supplierInclude }));
export function supplierPlanHash(plan: SupplierImportPlan) {
  const { planHash: _, ...content } = plan;
  return hash(content);
}
export function supplierBatchId(context: SupplierPlanContext) {
  const h = hash(['tooltify-suppliers', context.canonicalSetId]);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export async function assertSupplierContext(tx: Prisma.TransactionClient, c: SupplierPlanContext) {
  if (
    c.accessCompanyCode !== 'SHOP' ||
    !c.canonicalSetId?.trim() ||
    !/^[a-f0-9]{64}$/.test(c.workbookSha256) ||
    !c.codeRevision ||
    !Number.isFinite(Date.parse(c.cutoverAt))
  )
    throw Error('SUPPLIER_CONTEXT_INVALID');
  if ((await readImportDatabaseIdentity(tx)).fingerprint !== c.dbIdentity)
    throw Error('IMPORT_DATABASE_IDENTITY_MISMATCH');
  const branch = await tx.branch.findUnique({
    where: { id: c.accessBranchId },
    include: { company: true },
  });
  if (!branch || branch.deletedAt || !branch.isActive || branch.company?.companyCode !== 'SHOP')
    throw Error('SUPPLIER_ORIGIN_SCOPE_MISMATCH');
}
function paymentContent(target: SupplierTarget) {
  return target.paymentMethods
    .filter((p) => !p.deletedAt)
    .map((p) => ({
      paymentMethod: p.paymentMethod,
      bankName: p.bankName,
      bankAccountName: p.bankAccountName,
      bankAccountNumber: p.bankAccountNumber,
      creditTermDays: p.creditTermDays,
      isDefault: p.isDefault,
    }))
    .sort((a, b) => hash(a).localeCompare(hash(b)));
}
export function desiredPayments(row: SupplierInput) {
  return [
    {
      paymentMethod: 'CREDIT',
      bankName: null,
      bankAccountName: null,
      bankAccountNumber: null,
      creditTermDays: row.creditTermDays,
      isDefault: true,
    },
    ...row.bankAccounts.map((b) => ({
      paymentMethod: 'BANK_TRANSFER',
      ...b,
      creditTermDays: row.creditTermDays,
      isDefault: false,
    })),
  ].sort((a, b) => hash(a).localeCompare(hash(b)));
}
function matches(target: SupplierTarget, row: SupplierInput, c: SupplierPlanContext) {
  return (
    !target.deletedAt &&
    target.isActive &&
    target.accessCompanyCode === c.accessCompanyCode &&
    target.accessBranchId === c.accessBranchId &&
    target.type === row.type &&
    target.name === row.legalName &&
    target.phone === supplierPhone(row) &&
    target.hasVat === row.hasVat &&
    target.taxId === row.taxId &&
    target.branchCode === row.branchCode &&
    target.address === row.address &&
    target.lineId === row.lineId &&
    target.contactName === row.contactName &&
    !!target.contact &&
    !target.contact.deletedAt &&
    target.contact.isActive &&
    target.contact.accessCompanyCode === c.accessCompanyCode &&
    target.contact.accessBranchId === c.accessBranchId &&
    target.contact.name === row.legalName &&
    target.contact.roles.includes('SUPPLIER') &&
    hash(paymentContent(target)) === hash(desiredPayments(row))
  );
}
const accountKey = (s: string) => s.replace(/[\s-]/g, '');
export async function evaluateSupplier(
  tx: Prisma.TransactionClient,
  row: SupplierInput,
  c: SupplierPlanContext,
): Promise<PlannedSupplierItem> {
  const all = await tx.supplier.findMany({ include: supplierInclude, orderBy: { id: 'asc' } });
  const names = new Set(
    [row.legalName, row.displayName, ...row.aliases]
      .filter((v): v is string => !!v)
      .map(normalizeSupplierAlias),
  );
  const accounts = new Set(
    row.bankAccounts.flatMap((b) => (b.bankAccountNumber ? [accountKey(b.bankAccountNumber)] : [])),
  );
  const explicit = c.matchTargets[row.supplierRef];
  const observedCandidates = all.filter(
    (s) =>
      s.id === explicit ||
      names.has(normalizeSupplierAlias(s.name)) ||
      (!!row.taxId && s.taxId === row.taxId) ||
      s.paymentMethods.some(
        (p) => p.bankAccountNumber && accounts.has(accountKey(p.bankAccountNumber)),
      ),
  );
  const reviewed = c.reviewedArchivedTargets?.[row.supplierRef] ?? [];
  const validArchivedReview =
    Array.isArray(reviewed) &&
    reviewed.length === new Set(reviewed).size &&
    reviewed.every(
      (id) => typeof id === 'string' && observedCandidates.some((s) => s.id === id && s.deletedAt),
    );
  const candidates = observedCandidates.filter((s) => !reviewed.includes(s.id) || !s.deletedAt);
  const contacts = row.taxId
    ? await tx.contact.findMany({ where: { taxId: row.taxId }, orderBy: { id: 'asc' } })
    : [];
  let reason: string | null = null,
    targetId: string | null = null;
  const bad = validateSupplierInputs([row]).issues;
  if (bad.length) reason = bad[0].code;
  else if (!validArchivedReview) reason = 'INVALID_ARCHIVED_SUPPLIER_REVIEW';
  else if (
    contacts.some(
      (x) =>
        x.deletedAt ||
        !x.isActive ||
        x.name !== row.legalName ||
        !x.roles.includes('SUPPLIER') ||
        x.accessCompanyCode !== c.accessCompanyCode ||
        x.accessBranchId !== c.accessBranchId,
    )
  )
    reason = 'SUPPLIER_CONTACT_CONFLICT';
  else if (explicit) {
    if (candidates.length !== 1 || candidates[0].id !== explicit || !matches(candidates[0], row, c))
      reason = 'SUPPLIER_MATCH_CONFLICT';
    else targetId = explicit;
  } else if (candidates.length) reason = 'SUPPLIER_EXISTING_TARGET_REQUIRES_REVIEW';
  return {
    supplierRef: row.supplierRef,
    payload: row,
    disposition: reason ? 'CONFLICT' : targetId ? 'MATCH' : 'CREATE',
    targetId,
    reason,
    dependencyFingerprint: hash({ candidates: observedCandidates, contacts }),
  };
}
export async function planSuppliers(
  db: PrismaClient,
  rows: SupplierInput[],
  context: SupplierPlanContext,
): Promise<SupplierImportPlan> {
  return db.$transaction(
    async (tx) => {
      await assertSupplierContext(tx, context);
      if (
        rows.some(
          (r) =>
            !r.evidenceRefs.length ||
            r.evidenceRefs.some((e) => e.workbookSha256 !== context.workbookSha256),
        )
      )
        throw Error('SUPPLIER_EVIDENCE_HASH_MISMATCH');
      const inputHash = hash({ rows, context });
      const batchId = supplierBatchId(context);
      const old = await tx.tooltifyImportBatch.findUnique({ where: { id: batchId } });
      if (old) {
        const saved = (
          old.reconciliationSnapshot as unknown as { supplierPlan: SupplierImportPlan }
        ).supplierPlan;
        if (
          old.kind !== 'SUPPLIER' ||
          old.deletedAt ||
          old.status === 'ROLLED_BACK' ||
          !saved ||
          saved.inputHash !== inputHash ||
          supplierPlanHash(saved) !== old.planHash
        )
          throw Error('IMPORT_BATCH_INPUT_CHANGED');
        return saved;
      }
      const issues = validateSupplierInputs(rows).issues;
      const targets = new Map<string, string>();
      for (const row of rows) {
        const target = context.matchTargets[row.supplierRef];
        if (!target) continue;
        if (targets.has(target))
          issues.push({
            supplierRef: row.supplierRef,
            code: 'SUPPLIER_TARGET_CONFLICT',
            field: 'matchTargets',
            evidenceRef: row.evidenceRefs[0] ?? null,
          });
        targets.set(target, row.supplierRef);
      }
      const items: PlannedSupplierItem[] = [];
      for (const row of rows) {
        const item = await evaluateSupplier(tx, row, context);
        items.push(item);
        if (
          item.reason &&
          !issues.some((i) => i.supplierRef === row.supplierRef && i.code === item.reason)
        )
          issues.push({
            supplierRef: row.supplierRef,
            code: item.reason,
            field: 'target',
            evidenceRef: row.evidenceRefs[0] ?? null,
          });
      }
      if (!rows.length) throw Error('SUPPLIER_INPUT_EMPTY');
      const plan: SupplierImportPlan = {
        version: 1,
        kind: 'SUPPLIER',
        batchId,
        context,
        inputHash,
        planHash: '',
        items,
        issues,
      };
      plan.planHash = supplierPlanHash(plan);
      return plan;
    },
    { isolationLevel: 'Serializable', timeout: 30000 },
  );
}
