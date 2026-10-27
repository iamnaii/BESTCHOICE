import { BadRequestException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { Company, ContractReadAvailability, canAccess } from '@installment/shared';
import { AccessResourceService } from './access-resource.service';
import { AccessPartySourceService } from './access-party-source.service';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { currentDomainAccess } from './access-execution-context';
import { PartyQueryPlan } from './access-party-query-plan';
import { requestedAccessCompany } from './access-shop-boundaries';
import { collectAccountCodes, toContractJeView } from '../journal/contract-je-view.util';
import {
  CONTRACT_JOURNAL_LINE_LIMIT,
  discoverContractJournal,
  journalOverflow,
  loadContractJournalSources,
} from './access-contract-journal-sources';
import { ContractJournalProof } from './access-contract-journal-proof';

export const CONTRACT_JOURNAL_READ_ROUTES = ['ContractsController.listJournalEntries'] as const;
const permissions = ['journal.read', 'sensitive.cost.read', 'sensitive.profit.read'] as const;

@Injectable()
export class AccessContractJournalBoundary implements OnModuleInit {
  constructor(
    private readonly resources: AccessResourceService,
    private readonly sources: AccessPartySourceService,
  ) {}
  onModuleInit() {
    ACCESS_BOUNDARIES.set(CONTRACT_JOURNAL_READ_ROUTES[0], async (req, snapshot, permission) => {
      if (requestedAccessCompany(req) !== 'FINANCE')
        throw new ForbiddenException('คำขอนี้อยู่ในงานการเงิน');
      const id = String(req.params?.id ?? '');
      return {
        kind: 'collection',
        company: 'FINANCE',
        execute: async () =>
          (
            await this.resources.execute(
              snapshot.userId,
              permission,
              'FINANCE',
              async (tx, _current, lock) => ({
                company: 'FINANCE',
                resources: [await this.sources.financeContract(tx, id, lock)],
                productIds: [],
              }),
              async () => {
                if (Object.keys(req.query ?? {}).some((key) => key !== 'company'))
                  throw new BadRequestException('คำขอไม่ถูกต้อง');
                const ctx = currentDomainAccess()!;
                const tx = ctx.client;
                const plan = await PartyQueryPlan.create(tx, this.sources);
                const companies = await tx.companyInfo.findMany({
                  where: {
                    companyCode: { in: ['FINANCE', 'SHOP'] },
                    deletedAt: null,
                    isActive: true,
                  },
                  select: { id: true, companyCode: true },
                });
                const books = new Map(companies.map((c) => [c.id, c.companyCode as Company]));
                // Authority-only availability never compares hidden or unknown row sets.
                const availability = await journalAvailability(plan, books);
                const entries = await discoverContractJournal(tx, id);
                const sources = await loadContractJournalSources(plan, id, entries);
                const proof = new ContractJournalProof(id, entries, sources, books);
                const proven = entries.flatMap((e) => {
                  const p = proof.prove(e);
                  return p && permissions.every((key) => canAccess(ctx.snapshot, key, p.source))
                    ? [p]
                    : [];
                });
                const byId = new Map(proven.map((p) => [p.entry.id, p]));
                const ids = [...byId.keys()];
                // Probe scalar lengths, never the arbitrary code string, before
                // the CoA lookup or shared formatter's code-as-name fallback.
                const lineIds = ids.length
                  ? await tx.$queryRaw<Array<{ id: string; codeLength: number }>>`
                  SELECT id, length(account_code) AS "codeLength" FROM journal_lines
                  WHERE journal_entry_id=ANY(${ids}::text[]) AND deleted_at IS NULL
                  ORDER BY id LIMIT ${CONTRACT_JOURNAL_LINE_LIMIT + 1}`
                  : [];
                if (
                  lineIds.length > CONTRACT_JOURNAL_LINE_LIMIT ||
                  lineIds.some((line) => line.codeLength > 64)
                )
                  throw journalOverflow();
                if (lineIds.length)
                  await tx.$queryRaw`SELECT id FROM journal_lines WHERE id=ANY(${lineIds.map((l) => l.id)}::text[]) ORDER BY id FOR SHARE`;
                const rows = ids.length
                  ? await tx.journalEntry.findMany({
                      where: { id: { in: ids }, status: 'POSTED', deletedAt: null },
                      orderBy: [{ postedAt: 'asc' }, { entryNumber: 'asc' }],
                      select: {
                        id: true,
                        entryNumber: true,
                        entryDate: true,
                        postedAt: true,
                        lines: {
                          where: { deletedAt: null },
                          orderBy: { id: 'asc' },
                          select: { accountCode: true, debit: true, credit: true },
                        },
                      },
                    })
                  : [];
                const receiptAmounts = ids.length
                  ? await tx.$queryRaw<
                      Array<{
                        id: string;
                        deltaApplied: string | null;
                        lateFeePortion: string | null;
                      }>
                    >`
            SELECT id,
              CASE WHEN jsonb_typeof(metadata->'deltaApplied')='string' AND metadata->>'deltaApplied' ~ '^[0-9]{1,12}(\\.[0-9]{1,2})?$' THEN metadata->>'deltaApplied' ELSE NULL END AS "deltaApplied",
              CASE WHEN jsonb_typeof(metadata->'lateFeePortion')='string' AND metadata->>'lateFeePortion' ~ '^[0-9]{1,12}(\\.[0-9]{1,2})?$' THEN metadata->>'lateFeePortion' ELSE NULL END AS "lateFeePortion"
            FROM journal_entries WHERE id=ANY(${ids}::text[])`
                  : [];
                const amountsById = new Map(receiptAmounts.map((a) => [a.id, a]));
                const codes = collectAccountCodes(
                  rows.map((row) => ({
                    lines: row.lines.map((line) => ({ ...line, description: '' })),
                  })),
                );
                const accounts = codes.length
                  ? await tx.chartOfAccount.findMany({
                      where: { code: { in: codes }, deletedAt: null },
                      select: { code: true, name: true },
                      take: CONTRACT_JOURNAL_LINE_LIMIT + 1,
                    })
                  : [];
                if (
                  accounts.length > CONTRACT_JOURNAL_LINE_LIMIT ||
                  accounts.some((a) => a.code.length > 64 || a.name.length > 500)
                )
                  throw journalOverflow();
                const names = new Map(accounts.map((a) => [a.code, a.name]));
                const paymentReadable = !!(await tx.contract.count({
                  where: { id, AND: plan.finance('payments.read') },
                }));
                return {
                  scope: 'AUTHORIZED_PROVEN_SOURCES' as const,
                  availability,
                  data: rows.map((row) => {
                    const p = byId.get(row.id)!;
                    const pairedReversal = proven.find((other) => other.originalId === row.id);
                    const metadata = {
                      deltaApplied: amountsById.get(row.id)?.deltaApplied ?? null,
                      lateFeePortion: amountsById.get(row.id)?.lateFeePortion ?? null,
                      tag: p.entry.meta.tag,
                      flow: p.entry.meta.flow,
                      paymentId: paymentReadable ? (p.paymentId ?? null) : null,
                      reversed: !!pairedReversal,
                      reversedByEntryNumber: pairedReversal?.entry.entryNumber ?? null,
                      originalEntryId: p.originalId && byId.has(p.originalId) ? p.originalId : null,
                    };
                    return {
                      ...toContractJeView(
                        {
                          ...row,
                          description: p.label,
                          metadata,
                          lines: row.lines.map((line) => ({ ...line, description: '' })),
                        },
                        names,
                      ),
                      companyCode: p.source.company,
                    };
                  }),
                };
              },
              false,
              { domain: 'parties', isolationLevel: 'Serializable', maxAttempts: 3 },
            )
          ).result,
      };
    });
  }
}

/** Availability describes a possible authorized source, not rows found today.
 * FINANCE families are central. SHOP also has genuine operational branches.
 * ASSIGNED has no matching journal source assignment and is never widened. */
async function journalAvailability(
  plan: PartyQueryPlan,
  books: Map<string, Company>,
): Promise<Record<Company, ContractReadAvailability>> {
  const result: Record<Company, ContractReadAvailability> = {
    FINANCE: 'UNAVAILABLE',
    SHOP: 'UNAVAILABLE',
  };
  for (const book of ['FINANCE', 'SHOP'] as const) {
    if (permissions.every((permission) => plan.company(permission, book))) {
      result[book] = 'VISIBLE_CURRENT';
      continue;
    }
    if (book === 'FINANCE') continue;
    const restrictions = permissions
      .filter((permission) => !plan.company(permission, book))
      .map(
        (permission) =>
          new Set(
            plan
              .scope(permission, book)
              .tuples.filter((tuple) => tuple.scope === 'BRANCHES')
              .flatMap((tuple) => tuple.branchIds),
          ),
      );
    const common = [...restrictions[0]].filter((branchId) =>
      restrictions.every((ids) => ids.has(branchId)),
    );
    const companyId = [...books].find(([, code]) => code === book)?.[0];
    if (!common.length || !companyId) continue;
    // These assignment branches are already locked by AccessResourceService.
    const branch = await plan.db.branch.findFirst({
      where: { id: { in: common }, companyId, isActive: true, deletedAt: null },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    if (branch) result[book] = 'VISIBLE_CURRENT';
  }
  return result;
}
