import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyResolverService } from '../journal/company-resolver.service';

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
   * Money values are emitted via `.toString()` to preserve Decimal precision
   * (matches the "DO NOT Number() on Prisma.Decimal in export" rule).
   */
  async exportJournalWithPeakCodes(
    periodStart: Date,
    periodEnd: Date,
  ): Promise<{ csv: string; rowCount: number; skippedLineCount: number; unresolvedSubCodeCount: number }> {
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

    // 3) Resolve per-line contact sub-codes in two batched lookups (never per line).
    const contractIds = new Set<string>();
    const documentIds = new Set<string>();
    for (const ln of lines) {
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
    if (contractIds.size > 0) {
      const contracts = await this.prisma.contract.findMany({
        where: { id: { in: [...contractIds] } },
        select: { id: true, customer: { select: { contact: { select: { peakContactCode: true } } } } },
      });
      for (const c of contracts) {
        contactByContract.set(c.id, c.customer?.contact?.peakContactCode ?? null);
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
    for (const ln of lines) {
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
    };
  }
}
