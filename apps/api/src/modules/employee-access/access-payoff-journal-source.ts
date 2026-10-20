import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { currentDomainAccess } from './access-execution-context';
import { permissionScopes } from './access-context';

/** Full canonical preview aggregates real books without a company predicate.
 * R130 therefore requires both complete business books before inspecting any
 * contributor, even when a particular case happens to have no SHOP entries. */
export async function payoffJournalReadable(contractId: string): Promise<boolean> {
  const ctx = currentDomainAccess()!;
  const actor = { id: ctx.snapshot.userId, access: ctx.snapshot };
  for (const company of ['SHOP', 'FINANCE'] as const) {
    for (const permission of [
      'journal.read',
      'sensitive.cost.read',
      'sensitive.profit.read',
    ] as const) {
      if (!permissionScopes(actor, permission, company).some((tuple) => tuple.scope === 'COMPANY'))
        return false;
    }
  }
  const tx = ctx.client;
  // AccessResourceService already holds the live business-company locks.
  const books = await tx.companyInfo.findMany({
    where: { companyCode: { in: ['SHOP', 'FINANCE'] }, isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (books.length !== 2) return false;
  const feeRows = await tx.payment.findMany({
    where: {
      contractId,
      deletedAt: null,
      status: { not: 'PAID' },
      lateFeeWaived: false,
      lateFee: { gt: 0 },
    },
    select: { installmentNo: true },
  });
  const feeSchedules = await tx.installmentSchedule.findMany({
    where: {
      contractId,
      deletedAt: null,
      installmentNo: { in: feeRows.map((row) => row.installmentNo) },
    },
    select: { id: true },
  });
  // Exact canonical contributor union:
  // glContractBalance's seven accounts on live POSTED Contract metadata, and
  // reconstructPriorCleared's receipt/2B schedule metadata (which deliberately
  // has no status/deleted predicate). Never drop an input to change the math.
  const where: Prisma.JournalEntryWhereInput = {
    OR: [
      {
        status: 'POSTED',
        deletedAt: null,
        metadata: { path: ['contractId'], equals: contractId },
        lines: {
          some: {
            accountCode: {
              in: ['11-2101', '11-2103', '11-2105', '11-2106', '21-2102', '21-1103', '21-5101'],
            },
          },
        },
      },
      ...feeSchedules.map((schedule) => ({
        AND: [
          { metadata: { path: ['installmentScheduleId'], equals: schedule.id } },
          {
            OR: [
              { metadata: { path: ['tag'], equals: 'receipt' } },
              { metadata: { path: ['tag'], equals: '2B' } },
            ],
          },
        ],
      })),
    ],
  };
  const candidates = await tx.journalEntry.findMany({
    where,
    select: { id: true },
    orderBy: { id: 'asc' },
    take: 10001,
  });
  if (candidates.length > 10000) throw new ForbiddenException('ไม่มีสิทธิ์ดำเนินการกับข้อมูลนี้');
  const ids = candidates.map((row) => row.id);
  if (ids.length) {
    await tx.$queryRaw`SELECT id FROM journal_entries WHERE id=ANY(${ids}::text[]) ORDER BY id FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM journal_lines WHERE journal_entry_id=ANY(${ids}::text[]) ORDER BY id FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM company_info WHERE id IN (
      SELECT company_id FROM journal_entries WHERE id=ANY(${ids}::text[])
    ) ORDER BY id FOR SHARE`;
  }
  const entries = await tx.journalEntry.findMany({
    where,
    select: { companyId: true },
  });
  // JournalEntry has persisted companyId and no branch/assignment. Full COMPANY
  // authority above is the actual source proof; Contract assignment is irrelevant.
  const liveBookIds = new Set(books.map((book) => book.id));
  if (entries.some((entry) => !liveBookIds.has(entry.companyId)))
    throw new ForbiddenException('ไม่มีสิทธิ์ดำเนินการกับข้อมูลนี้');
  return true;
}
