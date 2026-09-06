import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { getBranchScope } from '../auth/branch-access.util';
import {
  collectAccountCodes,
  toContractJeView,
  type ContractJeView,
} from './contract-je-view.util';

export type ContractJeBook = 'FINANCE' | 'SHOP' | null;

export interface ContractJournalEntryView extends ContractJeView {
  /** สมุดที่ JE ใบนี้อยู่ — FINANCE / SHOP (companyCode ของ JE) · null = ไม่รู้จัก */
  companyCode: ContractJeBook;
}

interface ScopedUser {
  role?: string | null;
  branchId?: string | null;
}

const LINE_SELECT = {
  where: { deletedAt: null },
  orderBy: { id: 'asc' as const },
  select: { accountCode: true, debit: true, credit: true, description: true },
};

const ENTRY_INCLUDE = {
  lines: LINE_SELECT,
  company: { select: { companyCode: true } },
};

function toBook(code: string | null | undefined): ContractJeBook {
  return code === 'FINANCE' || code === 'SHOP' ? code : null;
}

/**
 * "บันทึกบัญชีของสัญญา" — every POSTED JE that stamps `metadata.contractId`
 * (both books, every flow: 1A/2A/2B/JP4/JP5/refund/shop-collect/ECL/SHOP legs)
 * plus the reversal JEs that point back at them (receipt void stamps
 * `originalEntryId`; the sweep engine — contract cancellation, exchange cancel,
 * interco reverse — stamps `reversesEntryId`).
 *
 * Deliberately NOT included: INTER-CO settlement batch JEs (they stamp
 * `metadata.items[]`, never a top-level contractId — see accounting.md) and
 * JEs keyed only by `metadata.newContractId`.
 *
 * Read-only. Branch scope mirrors `repossessions.service.findOne`: a
 * branch-scoped role asking for another branch's contract gets the same 404
 * as "does not exist" so the response never confirms the contract's existence.
 */
@Injectable()
export class ContractJournalQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async listForContract(
    contractId: string,
    user?: ScopedUser | null,
  ): Promise<ContractJournalEntryView[]> {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { id: true, branchId: true, deletedAt: true },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    const scope = getBranchScope(user);
    if (user && !scope.all) {
      if (!scope.branchId || contract.branchId !== scope.branchId) {
        throw new NotFoundException('ไม่พบสัญญา');
      }
    }

    const primary = await this.prisma.journalEntry.findMany({
      where: {
        status: 'POSTED',
        deletedAt: null,
        metadata: { path: ['contractId'], equals: contractId },
      },
      include: ENTRY_INCLUDE,
      orderBy: { postedAt: 'asc' },
    });

    const reversals = primary.length
      ? await this.prisma.journalEntry.findMany({
          where: {
            status: 'POSTED',
            deletedAt: null,
            OR: primary.flatMap((e) => [
              { metadata: { path: ['originalEntryId'], equals: e.id } },
              { metadata: { path: ['reversesEntryId'], equals: e.id } },
            ]),
          },
          include: ENTRY_INCLUDE,
          orderBy: { postedAt: 'asc' },
        })
      : [];

    const seen = new Set<string>();
    const all = [...primary, ...reversals].filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
    all.sort(
      (a, b) =>
        (a.postedAt?.getTime() ?? 0) - (b.postedAt?.getTime() ?? 0) ||
        a.entryNumber.localeCompare(b.entryNumber),
    );

    const codes = collectAccountCodes(all);
    const coaRows = codes.length
      ? await this.prisma.chartOfAccount.findMany({
          where: { code: { in: codes } },
          select: { code: true, name: true },
        })
      : [];
    const nameByCode = new Map(coaRows.map((r) => [r.code, r.name]));

    return all.map((e) => ({
      ...toContractJeView(e, nameByCode),
      companyCode: toBook(e.company?.companyCode),
    }));
  }
}
