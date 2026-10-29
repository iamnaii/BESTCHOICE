import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import {
  isExcludedFromPeakExport,
  isExcludedLegacyInterestLine,
  isLegacyInterestAccount,
  peakExportContractId,
  peakExportOriginalEntryId,
} from './peak-export-exclusion';

// ============================================================
// P3-SP3: PEAK CSV export (journal lines tagged with PEAK code)
// ============================================================

/**
 * FINANCE mapping v5 (ฝ่ายบัญชี 19/10/2569 · เจ้าของ 20/10 "ทำรหัสย่อยได้เลย"):
 * accounts whose sub-code source is `contact` resolve the PEAK contact code
 * ("รหัสผู้ติดต่อ" C00xxx) PER LINE. Which party a line belongs to depends on
 * the account, so the rule is explicit per account rather than inferred:
 *   - receivables / advances of a contract → the contract's customer's Contact
 *   - vendor payables → the expense document's supplier's Contact
 * Accounts the file marks `contact` but whose counterparty is a single fixed
 * party (21-1101 / 21-1102 / 11-2107 = SHOP · 11-4104 = LINE) are NOT resolved
 * here — the owner maps those rows as `fixed` with that party's PEAK contact
 * code once the accountant supplies it; until then they export blank and are
 * counted in `unresolvedSubCodeCount`.
 */
const CUSTOMER_CONTACT_ACCOUNTS = new Set(['11-2101', '11-2103', '11-2104', '11-2105', '21-1103']);
const VENDOR_CONTACT_ACCOUNTS = new Set(['21-1104']);

interface PeakAccountMapping {
  name: string;
  peakCode: string;
  /** Fixed sub-code (source = fixed) or null. */
  peakSubCode: string | null;
  peakSubCodeSource: string;
}

type JsonMeta = Record<string, unknown> | null | undefined;

function metaString(meta: JsonMeta, key: string): string | null {
  const v = meta && typeof meta === 'object' ? (meta as Record<string, unknown>)[key] : undefined;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

@Injectable()
export class PeakExportService {
  constructor(
    private prisma: PrismaService,
    private companyResolver: CompanyResolverService,
  ) {}

  /**
   * Build a CSV of POSTED journal lines within `[periodStart, periodEnd]`
   * joined with their `ChartOfAccount.peakCode`. Lines whose account has no
   * PEAK mapping are SKIPPED (returned `skippedLineCount`) so the caller can
   * surface a warning. Date range is capped at ~6 months (186 days) so accidental
   * "give me everything" queries don't dump millions of rows.
   *
   * Output columns:
   *   entryDate, entryNumber, peakCode, peakSubCode, accountCode, accountName,
   *   debit, credit, description, reference
   *
   * `peakSubCode` (FINANCE mapping v5 · 19/10/2569): the fixed sub-code for a
   * `fixed` source, or the per-line PEAK contact code for a `contact` source
   * (see CUSTOMER_CONTACT_ACCOUNTS / VENDOR_CONTACT_ACCOUNTS). A contact line
   * whose party has no PEAK contact code — or whose account is not in those
   * lists — exports an empty cell and is counted in `unresolvedSubCodeCount`
   * so the UI can tell the accountant which contacts still need a code.
   * `bank` / `cashbox` sources have no per-line resolver (cash and bank
   * accounts are mapped `fixed`) and count as unresolved too.
   *
   * Legacy-backoffice contracts (spec ร่าง 5 §5.6 · `peak-export-exclusion.ts`): PEAK already holds
   * them (receivable + the full revenue incl. interest, booked at signing), so the file never carries
   *   - whole entries whose `metadata.flow` is a legacy opening / prior-receipt marker
   *     → `excludedEntryCount` (distinct entries)
   *   - 11-2106 / 41-1101 lines of an entry whose `metadata.contractId` is a contract with
   *     `legacyContractCode` → `excludedLegacyInterestLineCount`
   * A reversal / mirror (`metadata.originalEntryId`, or a `JournalService.void` reversal with
   * `referenceType = 'REVERSAL'`) inherits its ORIGINAL entry's flow, and its contractId when it
   * has none of its own, for both rules. Excluded lines are counted there only — never in
   * `skippedLineCount` / `unresolvedSubCodeCount`. `legacyUnbalancedEntryCount` = entries that
   * balanced before the interest drop and do not after (known gap — see step 3b).
   *
   * Money values are emitted via `.toString()` to preserve Decimal precision
   * (matches the "DO NOT Number() on Prisma.Decimal in export" rule).
   */
  async exportJournalWithPeakCodes(
    periodStart: Date,
    periodEnd: Date,
  ): Promise<{
    csv: string;
    rowCount: number;
    skippedLineCount: number;
    unresolvedSubCodeCount: number;
    excludedEntryCount: number;
    excludedLegacyInterestLineCount: number;
    legacyUnbalancedEntryCount: number;
  }> {
    // Guard: max 186 days (~6 months) per spec — protects DB + filesystem.
    const ms = periodEnd.getTime() - periodStart.getTime();
    const MAX_DAYS = 186;
    if (ms < 0) {
      throw new BadRequestException('วันที่สิ้นสุดต้องไม่อยู่ก่อนวันเริ่มต้น');
    }
    if (ms > MAX_DAYS * 24 * 60 * 60 * 1000) {
      throw new BadRequestException('ช่วงเวลาส่งออกต้องไม่เกิน 6 เดือนต่อครั้ง');
    }

    // 1) Build a peakCode lookup for every account that has one. Single query
    //    is cheaper than joining inline because there are ~110 accounts total.
    const mappedAccounts = await this.prisma.chartOfAccount.findMany({
      where: { deletedAt: null, peakCode: { not: null } },
      select: { code: true, name: true, peakCode: true, peakSubCode: true, peakSubCodeSource: true },
    });
    const peakByCode = new Map<string, PeakAccountMapping>(
      mappedAccounts.map((a) => [
        a.code,
        {
          name: a.name,
          peakCode: a.peakCode!,
          peakSubCode: a.peakSubCodeSource === 'fixed' ? (a.peakSubCode ?? null) : null,
          peakSubCodeSource: a.peakSubCodeSource ?? 'none',
        },
      ]),
    );

    // Also load account names for un-mapped lines so we can report what was skipped.
    const allAccounts = await this.prisma.chartOfAccount.findMany({
      where: { deletedAt: null },
      select: { code: true, name: true },
    });
    const nameByCode = new Map(allAccounts.map((a) => [a.code, a.name]));

    // 2) Fetch journal lines in range. Order by entryDate then entryNumber so
    //    the CSV is deterministic for reconciliation diffs.
    // X5: scope to FINANCE company so SHOP (S-prefix) entries never leak into
    //     the PEAK CSV that the CPA uploads to peakaccount.com.
    const financeCompanyId = await this.companyResolver.getFinanceCompanyId();
    const lines = await this.prisma.journalLine.findMany({
      where: {
        deletedAt: null,
        journalEntry: {
          status: 'POSTED',
          entryDate: { gte: periodStart, lte: periodEnd },
          deletedAt: null,
          companyId: financeCompanyId,
        },
      },
      select: {
        accountCode: true,
        debit: true,
        credit: true,
        description: true,
        journalEntry: {
          select: {
            entryNumber: true,
            entryDate: true,
            description: true,
            referenceType: true,
            referenceId: true,
            // contractId / documentId stamps drive the per-line contact lookup
            metadata: true,
          },
        },
      },
      orderBy: [
        { journalEntry: { entryDate: 'asc' } },
        { journalEntry: { entryNumber: 'asc' } },
      ],
    });

    // 2b) Legacy-backoffice entries (spec ร่าง 5 §5.6): filtered AFTER the query so the query and
    //     every non-legacy row stay exactly as before. Opening entries and prior-receipt markers
    //     are dropped whole (by `flow`, never `tag` — markers carry tag 2B like real receipts).
    //     Reversals / mirrors are judged by their ORIGINAL entry (one level), loaded in one batch
    //     regardless of the window, status or soft-delete (a voided original is VOIDED).
    const originalIds = new Set<string>();
    for (const ln of lines) {
      const id = peakExportOriginalEntryId(ln.journalEntry);
      if (id) originalIds.add(id);
    }
    const originalById = new Map<string, { metadata: unknown }>();
    if (originalIds.size > 0) {
      const originals = await this.prisma.journalEntry.findMany({
        where: { id: { in: [...originalIds] } },
        select: { id: true, metadata: true },
      });
      for (const o of originals) originalById.set(o.id, { metadata: o.metadata });
    }
    const originalOf = (je: (typeof lines)[number]['journalEntry']) => {
      const id = peakExportOriginalEntryId(je);
      return id ? (originalById.get(id) ?? null) : null;
    };
    const excludedEntryNumbers = new Set<string>();
    const kept = lines.filter((ln) => {
      if (!isExcludedFromPeakExport(ln.journalEntry, originalOf(ln.journalEntry))) return true;
      excludedEntryNumbers.add(ln.journalEntry.entryNumber); // entryNumber is @unique
      return false;
    });

    // 3) Resolve per-line contact sub-codes in two batched lookups (never per line).
    //    The contract lookup also returns `legacyContractCode` for the interest-line filter (3b),
    //    so 11-2106 / 41-1101 lines add their contract to the same batch — mapped or not. Contact
    //    sub-codes still read the entry's OWN metadata only (unchanged output for non-legacy data).
    const contractIds = new Set<string>();
    const documentIds = new Set<string>();
    const interestContractIdOf = (je: (typeof lines)[number]['journalEntry']) =>
      peakExportContractId(je, originalOf(je));
    for (const ln of kept) {
      if (isLegacyInterestAccount(ln.accountCode)) {
        const id = interestContractIdOf(ln.journalEntry);
        if (id) contractIds.add(id);
      }
      const mapping = peakByCode.get(ln.accountCode);
      if (!mapping || mapping.peakSubCodeSource !== 'contact') continue;
      const meta = ln.journalEntry.metadata as JsonMeta;
      if (CUSTOMER_CONTACT_ACCOUNTS.has(ln.accountCode)) {
        const id = metaString(meta, 'contractId');
        if (id) contractIds.add(id);
      } else if (VENDOR_CONTACT_ACCOUNTS.has(ln.accountCode)) {
        const id = metaString(meta, 'documentId');
        if (id) documentIds.add(id);
      }
    }
    const contactByContract = new Map<string, string | null>();
    const legacyByContract = new Map<string, { legacyContractCode: string | null }>();
    if (contractIds.size > 0) {
      const contracts = await this.prisma.contract.findMany({
        where: { id: { in: [...contractIds] } },
        select: {
          id: true,
          legacyContractCode: true,
          customer: { select: { contact: { select: { peakContactCode: true } } } },
        },
      });
      for (const c of contracts) {
        contactByContract.set(c.id, c.customer?.contact?.peakContactCode ?? null);
        legacyByContract.set(c.id, { legacyContractCode: c.legacyContractCode ?? null });
      }
    }
    const contactByDocument = new Map<string, string | null>();
    if (documentIds.size > 0) {
      const docs = await this.prisma.expenseDocument.findMany({
        where: { id: { in: [...documentIds] } },
        select: { id: true, vendorSupplier: { select: { contact: { select: { peakContactCode: true } } } } },
      });
      for (const d of docs) {
        contactByDocument.set(d.id, d.vendorSupplier?.contact?.peakContactCode ?? null);
      }
    }
    let unresolvedSubCodes = 0;
    const subCodeFor = (accountCode: string, mapping: PeakAccountMapping, meta: JsonMeta): string | null => {
      switch (mapping.peakSubCodeSource) {
        case 'none':
          return null;
        case 'fixed':
          return mapping.peakSubCode;
        case 'contact': {
          let code: string | null = null;
          if (CUSTOMER_CONTACT_ACCOUNTS.has(accountCode)) {
            const id = metaString(meta, 'contractId');
            code = id ? (contactByContract.get(id) ?? null) : null;
          } else if (VENDOR_CONTACT_ACCOUNTS.has(accountCode)) {
            const id = metaString(meta, 'documentId');
            code = id ? (contactByDocument.get(id) ?? null) : null;
          }
          if (!code) unresolvedSubCodes++;
          return code;
        }
        default:
          // bank / cashbox: no per-line resolver yet (those accounts are mapped fixed)
          unresolvedSubCodes++;
          return null;
      }
    };

    // 3b) Interest lines of legacy contracts (spec ร่าง 5): 11-2106 / 41-1101 never go to PEAK —
    //     PEAK recognised that interest in full when the contract was signed. Checked before the
    //     PEAK-code mapping so the count is the same whether or not those accounts are mapped yet.
    //     Balance: in the 2A / JP4 / JP5 / write-off / void-reversal templates the two lines are an
    //     equal Dr 11-2106 / Cr 41-1101 pair, so the rest of the entry still balances.
    //     KNOWN GAP — awaiting the accounting firm (not decided): exchange-close-old-21-1106 debits
    //     11-2106 with no 41-1101 pair, so a legacy contract's close-old entry (and its
    //     exchange-cancel mirror) exports unbalanced by the unearned interest. How PEAK should book
    //     that side is open. `legacyUnbalancedEntryCount` / X-Legacy-Unbalanced-Entries flags every
    //     entry that balanced before this drop and not after; entries already unbalanced in the file
    //     because of unmapped (skipped) lines are not counted. Nothing in this path asserts balance.
    let excludedLegacyInterestLines = 0;
    const droppedNetByEntry = new Map<string, Prisma.Decimal>();
    const exportable = kept.filter((ln) => {
      const id = interestContractIdOf(ln.journalEntry);
      if (!isExcludedLegacyInterestLine(ln, id ? legacyByContract.get(id) : null)) return true;
      excludedLegacyInterestLines++;
      const no = ln.journalEntry.entryNumber;
      const net = new Prisma.Decimal(ln.debit).minus(new Prisma.Decimal(ln.credit));
      droppedNetByEntry.set(no, (droppedNetByEntry.get(no) ?? new Prisma.Decimal(0)).plus(net));
      return false;
    });
    let legacyUnbalancedEntries = 0;
    if (droppedNetByEntry.size > 0) {
      const keptNetByEntry = new Map<string, Prisma.Decimal>();
      for (const ln of kept) {
        const no = ln.journalEntry.entryNumber;
        if (!droppedNetByEntry.has(no)) continue;
        const net = new Prisma.Decimal(ln.debit).minus(new Prisma.Decimal(ln.credit));
        keptNetByEntry.set(no, (keptNetByEntry.get(no) ?? new Prisma.Decimal(0)).plus(net));
      }
      for (const [no, dropped] of droppedNetByEntry) {
        const before = keptNetByEntry.get(no) ?? new Prisma.Decimal(0);
        if (before.isZero() && !before.minus(dropped).isZero()) legacyUnbalancedEntries++;
      }
    }

    // 4) Render rows; skip un-mapped accounts.
    const escape = (v: string | null | undefined) => {
      if (v == null) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const header = [
      'entryDate',
      'entryNumber',
      'peakCode',
      'peakSubCode',
      'accountCode',
      'accountName',
      'debit',
      'credit',
      'description',
      'reference',
    ].join(',');

    const body: string[] = [];
    let skipped = 0;
    for (const ln of exportable) {
      const mapping = peakByCode.get(ln.accountCode);
      if (!mapping) {
        skipped++;
        continue;
      }
      const ref = ln.journalEntry.referenceType
        ? `${ln.journalEntry.referenceType}:${ln.journalEntry.referenceId ?? ''}`
        : '';
      body.push(
        [
          ln.journalEntry.entryDate.toISOString().slice(0, 10),
          escape(ln.journalEntry.entryNumber),
          escape(mapping.peakCode),
          escape(subCodeFor(ln.accountCode, mapping, ln.journalEntry.metadata as JsonMeta)),
          escape(ln.accountCode),
          escape(nameByCode.get(ln.accountCode) ?? mapping.name),
          // String form keeps full Decimal precision — never Number()
          new Prisma.Decimal(ln.debit).toString(),
          new Prisma.Decimal(ln.credit).toString(),
          escape(ln.description ?? ln.journalEntry.description),
          escape(ref),
        ].join(','),
      );
    }

    return {
      // UTF-8 BOM so Excel renders Thai correctly.
      csv: '﻿' + [header, ...body].join('\n'),
      rowCount: body.length,
      skippedLineCount: skipped,
      unresolvedSubCodeCount: unresolvedSubCodes,
      excludedEntryCount: excludedEntryNumbers.size,
      excludedLegacyInterestLineCount: excludedLegacyInterestLines,
      legacyUnbalancedEntryCount: legacyUnbalancedEntries,
    };
  }
}
