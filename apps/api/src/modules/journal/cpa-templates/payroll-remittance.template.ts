import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccountRoleService } from '../account-role.service';
import { CompanyResolverService } from '../company-resolver.service';
import { validatePeriodOpen } from '../../../utils/period-lock.util';
import { bkkBusinessDate } from '../../expense-documents/bkk-business-date.util';
import {
  CASH_ACCOUNT_CODES,
  SHOP_CASH_ACCOUNT_CODES,
} from '../../../constants/cash-account.constants';

/**
 * Payroll remittance JEs — นำส่ง ปกส. (สปส.1-10) + ภ.ง.ด.1 (payroll round 2,
 * คำสั่งเจ้าของ 2026-08-06 "ทำเลยสิ").
 *
 * Design D1 (2026-08-06-payroll-round2-3-design.md): remittance is PER BOOK —
 * each side clears its own payables from its own bank. Paying the whole entity
 * from one bank would need a SHOP-side inter-company payable account, which is
 * the open CPA question (interco spec §11) — do NOT invent that JE here.
 *
 *   SSO  (scope):  Dr <sso_employee payable> X + Dr <sso_employer payable> X
 *                     Cr <cash/bank of that book> 2X
 *   PND1 (scope):  Dr <wht_payroll payable> W / Cr <cash/bank of that book> W
 *
 * Amounts = Σ PayrollLine of POSTED (non-voided, non-deleted) payroll docs of
 * (period, scope) — matches the figures on the filed form, NOT the whole GL
 * balance (which may hold several unremitted periods).
 *
 * Guards:
 *   - deposit account must belong to the scope's chart (S11-XXXX vs 11-XXXX)
 *   - live GL balance of each payable (per company) must cover the amount
 *   - idempotency `sso-remit:<scope>:<period>` / `pnd1-remit:<scope>:<period>`
 *     (pre-checked + DB partial unique index journal_entries_idempotency_idx)
 *   - period-open guard on payDate for the scope's company
 */
@Injectable()
export class PayrollRemittanceTemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly roles: AccountRoleService,
    private readonly companyResolver: CompanyResolverService,
  ) {}

  async executeSso(opts: {
    scope: 'SHOP' | 'FINANCE';
    period: string; // YYYY-MM
    depositAccountCode: string;
    payDate?: Date;
  }): Promise<{ entryNo: string; amountPerSide: string; total: string; employeeCount: number }> {
    return this.prisma.$transaction(async (tx) => {
      const { scope, period, depositAccountCode } = opts;
      this.assertDepositMatchesScope(scope, depositAccountCode);
      const payDate = bkkBusinessDate(opts.payDate ?? new Date());

      const { sum, count } = await this.periodSums(tx, scope, period, 'ssoEmployee');
      if (sum.lte(0)) {
        throw new BadRequestException(
          `ไม่มียอดเงินสมทบประกันสังคมในงวด ${period} (ฝั่ง ${scope}) — ตรวจว่าใบเงินเดือน POST แล้ว`,
        );
      }

      const flow = 'sso-remittance';
      const idempotencyKey = `sso-remit:${scope}:${period}`;
      await this.assertNotRemitted(tx, flow, idempotencyKey, period, scope);

      const rolePrefix = scope === 'SHOP' ? 'shop_' : '';
      const codeEmp = this.roles.code(`${rolePrefix}sso_employee`);
      const codeEr = this.roles.code(`${rolePrefix}sso_employer`);

      const companyId =
        scope === 'SHOP'
          ? await this.companyResolver.getShopCompanyId(tx)
          : await this.companyResolver.getFinanceCompanyId(tx);
      await validatePeriodOpen(tx, payDate, companyId);

      // GL cover check — both payables independently.
      await this.assertGlCovers(tx, companyId, codeEmp, sum, 'เงินสมทบ ปกส. (พนักงาน)');
      await this.assertGlCovers(tx, companyId, codeEr, sum, 'เงินสมทบ ปกส. (นายจ้าง)');

      const zero = new Decimal(0);
      const lines: JeLineInput[] = [
        {
          accountCode: codeEmp,
          dr: sum,
          cr: zero,
          description: `นำส่งเงินสมทบ ปกส. ส่วนพนักงาน งวด ${period}`,
        },
        {
          accountCode: codeEr,
          dr: sum,
          cr: zero,
          description: `นำส่งเงินสมทบ ปกส. ส่วนนายจ้าง งวด ${period}`,
        },
        {
          accountCode: depositAccountCode,
          dr: zero,
          cr: sum.mul(2),
          description: `จ่าย สปส.1-10 งวด ${period} (${count} คน)`,
        },
      ];

      const result = await this.postWithIdempotencyTranslation(
        {
          description: `นำส่งประกันสังคม สปส.1-10 งวด ${period} — ฝั่ง ${scope}`,
          reference: idempotencyKey,
          metadata: {
            tag: 'SSO_REMIT',
            flow,
            idempotencyKey,
            period,
            entityScope: scope,
            employeeCount: count,
          },
          postedAt: payDate,
          companyId,
          lines,
        },
        tx,
        period,
        scope,
      );

      return {
        entryNo: result.entryNumber,
        amountPerSide: sum.toFixed(2),
        total: sum.mul(2).toFixed(2),
        employeeCount: count,
      };
    });
  }

  async executePnd1(opts: {
    scope: 'SHOP' | 'FINANCE';
    period: string; // YYYY-MM
    depositAccountCode: string;
    payDate?: Date;
  }): Promise<{ entryNo: string; total: string; employeeCount: number }> {
    return this.prisma.$transaction(async (tx) => {
      const { scope, period, depositAccountCode } = opts;
      this.assertDepositMatchesScope(scope, depositAccountCode);
      const payDate = bkkBusinessDate(opts.payDate ?? new Date());

      const { sum, count } = await this.periodSums(tx, scope, period, 'whtAmount');
      if (sum.lte(0)) {
        throw new BadRequestException(
          `ไม่มียอดภาษีหัก ณ ที่จ่าย (ภ.ง.ด.1) ในงวด ${period} (ฝั่ง ${scope})`,
        );
      }

      const flow = 'pnd1-remittance';
      const idempotencyKey = `pnd1-remit:${scope}:${period}`;
      await this.assertNotRemitted(tx, flow, idempotencyKey, period, scope);

      const rolePrefix = scope === 'SHOP' ? 'shop_' : '';
      const codeWht = this.roles.code(`${rolePrefix}wht_payroll`);

      const companyId =
        scope === 'SHOP'
          ? await this.companyResolver.getShopCompanyId(tx)
          : await this.companyResolver.getFinanceCompanyId(tx);
      await validatePeriodOpen(tx, payDate, companyId);
      await this.assertGlCovers(tx, companyId, codeWht, sum, 'ภ.ง.ด.1 ค้างจ่าย');

      const zero = new Decimal(0);
      const lines: JeLineInput[] = [
        {
          accountCode: codeWht,
          dr: sum,
          cr: zero,
          description: `นำส่ง ภ.ง.ด.1 งวด ${period}`,
        },
        {
          accountCode: depositAccountCode,
          dr: zero,
          cr: sum,
          description: `จ่ายสรรพากร ภ.ง.ด.1 งวด ${period} (${count} คน)`,
        },
      ];

      const result = await this.postWithIdempotencyTranslation(
        {
          description: `นำส่งภาษีหัก ณ ที่จ่าย ภ.ง.ด.1 งวด ${period} — ฝั่ง ${scope}`,
          reference: idempotencyKey,
          metadata: {
            tag: 'PND1_REMIT',
            flow,
            idempotencyKey,
            period,
            entityScope: scope,
            employeeCount: count,
          },
          postedAt: payDate,
          companyId,
          lines,
        },
        tx,
        period,
        scope,
      );

      return { entryNo: result.entryNumber, total: sum.toFixed(2), employeeCount: count };
    });
  }

  // ── shared helpers ──────────────────────────────────────────────────────

  /**
   * Review W2 (2026-08-06) — a true double-submit race can slip past the
   * findFirst pre-check; the DB partial unique index
   * `journal_entries_idempotency_idx` (flow + idempotencyKey) then rejects the
   * second insert with P2002. Translate that into the same friendly Thai
   * message the pre-check produces (pattern: bad-debt-provision.template).
   */
  private async postWithIdempotencyTranslation(
    input: Parameters<JournalAutoService['createAndPost']>[0],
    tx: Prisma.TransactionClient,
    period: string,
    scope: string,
  ): Promise<{ id: string; entryNumber: string }> {
    try {
      return await this.journal.createAndPost(input, tx);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException(
          `งวด ${period} (ฝั่ง ${scope}) นำส่งไปแล้ว (double-submit) — รีเฟรชหน้าจอเพื่อดูรายการล่าสุด`,
        );
      }
      throw e;
    }
  }

  private assertDepositMatchesScope(scope: 'SHOP' | 'FINANCE', code: string): void {
    const allowed: readonly string[] =
      scope === 'SHOP' ? SHOP_CASH_ACCOUNT_CODES : CASH_ACCOUNT_CODES;
    if (!allowed.includes(code)) {
      throw new BadRequestException(
        scope === 'SHOP'
          ? `ฝั่ง SHOP ต้องจ่ายจากบัญชีของหน้าร้าน (S11-XXXX) — พบ ${code}`
          : `ฝั่ง FINANCE ต้องจ่ายจากบัญชีของ FINANCE (11-XXXX) — พบ ${code}`,
      );
    }
  }

  /** Σ field over PayrollLine of POSTED docs in (period, scope) + จำนวนคนที่มียอด. */
  private async periodSums(
    tx: Prisma.TransactionClient,
    scope: 'SHOP' | 'FINANCE',
    period: string,
    field: 'ssoEmployee' | 'whtAmount',
  ): Promise<{ sum: Decimal; count: number }> {
    const lines = await tx.payrollLine.findMany({
      where: {
        [field]: { gt: 0 },
        payroll: {
          payrollPeriod: period,
          entityScope: scope,
          document: {
            status: 'POSTED',
            journalEntryId: { not: null },
            deletedAt: null,
          },
        },
      },
      select: { ssoEmployee: true, whtAmount: true },
    });
    const sum = lines.reduce(
      (s, l) =>
        s.plus((field === 'ssoEmployee' ? l.ssoEmployee : l.whtAmount).toString()),
      new Decimal(0),
    );
    return { sum, count: lines.length };
  }

  private async assertNotRemitted(
    tx: Prisma.TransactionClient,
    flow: string,
    idempotencyKey: string,
    period: string,
    scope: string,
  ): Promise<void> {
    const existing = await tx.journalEntry.findFirst({
      where: {
        deletedAt: null,
        status: 'POSTED',
        metadata: { path: ['idempotencyKey'], equals: idempotencyKey } as never,
      },
      select: { entryNumber: true },
    });
    if (existing) {
      throw new BadRequestException(
        `งวด ${period} (ฝั่ง ${scope}) นำส่งไปแล้ว — ${existing.entryNumber}. ` +
          'หากต้องแก้ไข ให้กลับรายการ JE เดิมก่อน',
      );
    }
  }

  /** Live GL balance (Cr − Dr) of the payable must cover the remit amount. */
  private async assertGlCovers(
    tx: Prisma.TransactionClient,
    companyId: string,
    accountCode: string,
    amount: Decimal,
    label: string,
  ): Promise<void> {
    const agg = await tx.journalLine.aggregate({
      where: {
        accountCode,
        deletedAt: null,
        journalEntry: { status: 'POSTED', deletedAt: null, companyId },
      },
      _sum: { credit: true, debit: true },
    });
    const balance = new Decimal((agg._sum.credit ?? 0).toString()).minus(
      (agg._sum.debit ?? 0).toString(),
    );
    if (balance.lt(amount)) {
      throw new BadRequestException(
        `ยอดค้างบัญชี ${accountCode} (${label}) มี ${balance.toFixed(2)} บาท ` +
          `น้อยกว่ายอดนำส่ง ${amount.toFixed(2)} บาท — งวดนี้อาจถูกนำส่งแล้ว หรือใบเงินเดือนถูกกลับรายการ`,
      );
    }
  }
}
