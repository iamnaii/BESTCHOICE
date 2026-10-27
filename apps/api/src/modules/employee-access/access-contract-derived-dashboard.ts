import type { ContractDocumentDashboardRead } from '@installment/shared';
import { Prisma } from '@prisma/client';
import { resolveSignatureRequirements } from '@installment/shared';
import { PartyQueryPlan } from './access-party-query-plan';
import { categoryAvailability, derivedLabels } from './access-contract-derived-children';

const REQUIRED_DOCS = ['ID_CARD_COPY', 'KYC_SELFIE', 'DEVICE_PHOTO', 'DEVICE_IMEI_PHOTO'];
const AUDIT_ACTIONS = ['UPLOAD', 'VIEW', 'DOWNLOAD', 'PRINT', 'DELETE', 'HASH_MISMATCH'];
export async function contractDerivedDashboard(
  plan: PartyQueryPlan,
  where: Prisma.ContractWhereInput,
): Promise<ContractDocumentDashboardRead> {
  const db = plan.db;
  const rows = await db.contract.findMany({
    where,
    select: {
      id: true,
      contractNumber: true,
      customerId: true,
      branchId: true,
      workflowStatus: true,
      updatedAt: true,
      branch: { select: { id: true, name: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  const documents = categoryAvailability(plan, 'documents.read');
  const history = categoryAvailability(plan, 'contract-documents.read');
  const payments = categoryAvailability(plan, 'payments.read');
  const [docRows, historyRows, paymentContracts, overdueContracts] = await Promise.all([
    documents !== 'UNAVAILABLE'
      ? db.contract.findMany({
          where: { AND: [where, plan.finance('documents.read')] },
          select: {
            id: true,
            eDocuments: { where: { deletedAt: null }, select: { documentType: true } },
            signatures: { where: { deletedAt: null }, select: { signerType: true } },
          },
        })
      : null,
    history !== 'UNAVAILABLE'
      ? db.contract.findMany({
          where: { AND: [where, plan.finance('contract-documents.read')] },
          select: { id: true },
        })
      : null,
    payments !== 'UNAVAILABLE'
      ? db.contract.count({ where: { AND: [where, plan.finance('payments.read')] } })
      : null,
    payments !== 'UNAVAILABLE'
      ? db.contract.count({
          where: {
            AND: [where, plan.finance('payments.read'), { status: { in: ['OVERDUE', 'DEFAULT'] } }],
          },
        })
      : null,
  ]);
  const docStates = new Map(
    docRows?.map((row) => [
      row.id,
      {
        docs: REQUIRED_DOCS.every((type) =>
          row.eDocuments.some((doc) => doc.documentType === type),
        ),
        signatures: resolveSignatureRequirements(row.signatures, false).complete,
      },
    ]),
  );
  const labels = await derivedLabels(plan, rows);
  const byBranch = new Map<
    string,
    {
      branchId: string;
      branchName: string;
      total: number;
      documentContracts: number | null;
      documented: number | null;
      pendingDocs: number | null;
      pendingSigs: number | null;
    }
  >();
  let fullyDocumented = 0,
    pendingDocuments = 0,
    pendingSignatures = 0,
    pendingApproval = 0;
  for (const row of rows) {
    let branch = byBranch.get(row.branchId);
    if (!branch) {
      branch = {
        branchId: row.branchId,
        branchName: row.branch.name,
        total: 0,
        documentContracts: docRows ? 0 : null,
        documented: docRows ? 0 : null,
        pendingDocs: docRows ? 0 : null,
        pendingSigs: docRows ? 0 : null,
      };
      byBranch.set(row.branchId, branch);
    }
    branch.total++;
    if (['PENDING_REVIEW', 'CREATING'].includes(row.workflowStatus)) pendingApproval++;
    const state = docStates.get(row.id);
    if (state) {
      branch.documentContracts!++;
      if (state.docs && state.signatures) {
        fullyDocumented++;
        branch.documented!++;
      }
      if (!state.docs) {
        pendingDocuments++;
        branch.pendingDocs!++;
      }
      if (!state.signatures) {
        pendingSignatures++;
        branch.pendingSigs!++;
      }
    }
  }
  const now = Date.now();
  const slaAlerts = rows
    .filter((row) => ['PENDING_REVIEW', 'CREATING'].includes(row.workflowStatus))
    .map((row) => ({
      id: row.id,
      contractNumber: row.contractNumber,
      customerName: labels.customers.get(row.customerId)?.name ?? null,
      workflowStatus: row.workflowStatus,
      hoursWaiting: Math.round((now - row.updatedAt.getTime()) / 3600000),
      branchName: row.branch.name,
    }))
    .filter((row) => row.hoursWaiting >= 24)
    .sort((a, b) => b.hoursWaiting - a.hoursWaiting || a.id.localeCompare(b.id))
    .slice(0, 20);
  let recentActivity:
    | {
        id: string;
        contractNumber: string;
        customerName: string | null;
        action: string;
        createdAt: string;
        branchName: string;
      }[]
    | null = historyRows ? [] : null;
  if (historyRows?.length) {
    const ids = historyRows.map((row) => row.id);
    // Retained soft-deleted documents can prove historical audit. Mismatched/unproven
    // document identities cannot consume a slot or influence the history ranking.
    await db.$queryRaw(
      Prisma.sql`SELECT d.id FROM contract_documents d WHERE d.contract_id IN (${Prisma.join(ids)}) AND EXISTS (SELECT 1 FROM document_audit_logs a WHERE a.document_id=d.id AND a.contract_id=d.contract_id) ORDER BY d.id FOR SHARE`,
    );
    const audits = await db.$queryRaw<
      { id: string; contractId: string; action: string; createdAt: Date }[]
    >(Prisma.sql`
      SELECT a.id,a.contract_id AS "contractId",a.action,a.created_at AS "createdAt"
      FROM document_audit_logs a JOIN contract_documents d ON d.id=a.document_id AND d.contract_id=a.contract_id
      WHERE a.contract_id IN (${Prisma.join(ids)}) AND a.action IN (${Prisma.join(AUDIT_ACTIONS)})
      ORDER BY a.created_at DESC,a.id DESC LIMIT 20`);
    const parents = new Map(rows.map((row) => [row.id, row]));
    recentActivity = audits.map((a) => {
      const row = parents.get(a.contractId)!;
      return {
        id: a.id,
        contractNumber: row.contractNumber,
        customerName: labels.customers.get(row.customerId)?.name ?? null,
        action: a.action,
        createdAt: a.createdAt.toISOString(),
        branchName: row.branch.name,
      };
    });
  }
  return {
    scope: 'authorized-sources' as const,
    categoryScope: 'authorized-sources' as const,
    availability: { documents, documentHistory: history, payments },
    totalContracts: rows.length,
    documentContracts: docRows?.length ?? null,
    paymentContracts,
    fullyDocumented: docRows ? fullyDocumented : null,
    pendingDocuments: docRows ? pendingDocuments : null,
    pendingSignatures: docRows ? pendingSignatures : null,
    pendingApproval,
    overdueContracts,
    byBranch: [...byBranch.values()],
    recentActivity,
    slaAlerts,
  };
}
