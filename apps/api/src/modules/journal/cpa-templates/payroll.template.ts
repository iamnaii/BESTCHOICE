import { Injectable, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccountRoleService } from '../account-role.service';

/**
 * Template — Payroll (PR เงินเดือนงวด).
 *
 * Spec §4.4 — aggregates PayrollLine[] into single balanced JE.
 *
 *   Dr 53-1101 เงินเดือน-ค่าจ้าง           (Σ baseSalary)
 *   Dr 53-1102 เงินสมทบประกันสังคม-นายจ้าง  (Σ ssoEmployee)   [if Σ > 0]
 *     Cr 21-3101 ภ.ง.ด. 1 ค้างจ่าย         (Σ whtAmount)      [if Σ > 0]
 *     Cr 21-3105 SSO พนักงานค้างนำส่ง       (Σ ssoEmployee)   [if Σ > 0]
 *     Cr 21-3106 SSO นายจ้างค้างนำส่ง       (Σ ssoEmployee)   [if Σ > 0]
 *     Cr depositAccountCode                (Σ netPaid)
 *
 * Line-level data stays in PayrollLine[]. ภงด.1 file generation deferred.
 *
 * Account code notes (Fix Report P0-3, 2026-05-11):
 *   - WHT employee   = 21-3101 (ภ.ง.ด. 1 ค้างจ่าย — employee income tax payable)
 *   - SSO employee   = 21-3105 (NEW — dedicated SSO payable)
 *   - SSO employer   = 21-3106 (NEW — dedicated SSO payable, employer side)
 *   - SSO employer expense = 53-1102 (เงินสมทบประกันสังคม)
 *
 * Thai SSO law: both employee and employer contribute 5% (cap is period-effective:
 * 875 in 2569+, 1000 in 2572+, 1150 in 2575+ — see `sso_config` table).
 * Per-line `ssoEmployee` is reused for the employer side since by law they
 * match — if the rates ever diverge, add a separate `ssoEmployer` field to
 * PayrollLine. Cap enforcement lives in `SsoConfigService.validateContribution`
 * (called from `ExpenseDocumentsService.createPayroll`).
 */
@Injectable()
export class PayrollTemplate {
  private shopCompanyIdCache: string | null = null;

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly roles: AccountRoleService,
  ) {}

  async execute(
    documentId: string,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string }> {
    const exec = async (tx: Prisma.TransactionClient): Promise<{ entryNo: string }> => {
      const doc = await tx.expenseDocument.findUniqueOrThrow({
        where: { id: documentId },
        include: {
          payroll: {
            include: {
              lines: {
                include: {
                  customIncome: true,
                  customDeduction: true,
                },
              },
            },
          },
        },
      });

      // Idempotency
      if (doc.journalEntryId) {
        const existing = await tx.journalEntry.findUnique({ where: { id: doc.journalEntryId } });
        return { entryNo: existing?.entryNumber ?? doc.journalEntryId };
      }

      if (!doc.payroll || doc.payroll.lines.length === 0) {
        throw new Error(`Payroll ${documentId} missing payroll detail or lines`);
      }
      if (!doc.depositAccountCode) {
        throw new BadRequestException(`Payroll ${documentId} requires depositAccountCode`);
      }

      const zero = new Decimal(0);
      const sumBase = doc.payroll.lines.reduce(
        (s: Decimal, l: { baseSalary: Decimal }) => s.plus(l.baseSalary.toString()),
        zero,
      );
      const sumSso = doc.payroll.lines.reduce(
        (s: Decimal, l: { ssoEmployee: Decimal }) => s.plus(l.ssoEmployee.toString()),
        zero,
      );
      const sumWht = doc.payroll.lines.reduce(
        (s: Decimal, l: { whtAmount: Decimal }) => s.plus(l.whtAmount.toString()),
        zero,
      );
      const sumNet = doc.payroll.lines.reduce(
        (s: Decimal, l: { netPaid: Decimal }) => s.plus(l.netPaid.toString()),
        zero,
      );

      // Resolve account codes via role map (Fix Report P1-3 — POC integration).
      // Owner can edit the mappings in admin UI without redeploying.
      const codePayrollExpense = this.roles.code('payroll_expense');
      const codeSsoExpense = this.roles.code('payroll_sso_expense');
      const codeWhtPayroll = this.roles.code('wht_payroll');
      const codeSsoEmployee = this.roles.code('sso_employee');
      const codeSsoEmployer = this.roles.code('sso_employer');

      const lines: JeLineInput[] = [
        {
          accountCode: codePayrollExpense,
          dr: sumBase,
          cr: zero,
          description: `เงินเดือน-ค่าจ้าง งวด ${doc.payroll.payrollPeriod}`,
        },
      ];
      // Employer-side SSO: by Thai law, employer contributes the same amount
      // as the employee (5% of base salary, capped per period in sso_config —
      // 875 in 2569+). Hence we reuse `sumSso` (which currently captures the
      // employee deduction) for the employer expense + payable.
      if (sumSso.gt(zero)) {
        lines.push({
          accountCode: codeSsoExpense,
          dr: sumSso,
          cr: zero,
          description: `เงินสมทบประกันสังคม (นายจ้าง) งวด ${doc.payroll.payrollPeriod}`,
        });
      }
      if (sumWht.gt(zero)) {
        lines.push({
          accountCode: codeWhtPayroll,
          dr: zero,
          cr: sumWht,
          description: 'หัก ณ ที่จ่าย ภงด.1',
        });
      }
      if (sumSso.gt(zero)) {
        lines.push({
          accountCode: codeSsoEmployee,
          dr: zero,
          cr: sumSso,
          description: 'เงินสมทบประกันสังคม-พนักงานค้างนำส่ง',
        });
        lines.push({
          accountCode: codeSsoEmployer,
          dr: zero,
          cr: sumSso,
          description: 'เงินสมทบประกันสังคม-นายจ้างค้างนำส่ง',
        });
      }
      // C2 — Custom Income lines: Dr each accountCode for its amount.
      // Aggregate by accountCode across all payroll lines so JE stays compact.
      // The expense increases (Dr) regardless of isTaxable — the flag only
      // controls the WHT base, not the bookkeeping.
      const incomeByAccount = new Map<string, Decimal>();
      for (const l of doc.payroll.lines) {
        for (const ci of l.customIncome ?? []) {
          const prev = incomeByAccount.get(ci.accountCode) ?? zero;
          incomeByAccount.set(
            ci.accountCode,
            prev.plus(new Decimal(ci.amount.toString())),
          );
        }
      }
      for (const [accountCode, amount] of incomeByAccount) {
        if (amount.gt(zero)) {
          lines.push({
            accountCode,
            dr: amount,
            cr: zero,
            description: `รายได้พิเศษ ${accountCode} งวด ${doc.payroll.payrollPeriod}`,
          });
        }
      }

      // C2 — Custom Deduction lines: Cr each accountCode for its amount.
      // Reduces net cash (already netted into sumNet upstream at service).
      // Typical use: loan repayment Cr's 11-21XX (employee AR offset).
      const deductionByAccount = new Map<string, Decimal>();
      for (const l of doc.payroll.lines) {
        for (const cd of l.customDeduction ?? []) {
          const prev = deductionByAccount.get(cd.accountCode) ?? zero;
          deductionByAccount.set(
            cd.accountCode,
            prev.plus(new Decimal(cd.amount.toString())),
          );
        }
      }
      for (const [accountCode, amount] of deductionByAccount) {
        if (amount.gt(zero)) {
          lines.push({
            accountCode,
            dr: zero,
            cr: amount,
            description: `รายการหัก ${accountCode} งวด ${doc.payroll.payrollPeriod}`,
          });
        }
      }

      lines.push({
        accountCode: doc.depositAccountCode,
        dr: zero,
        cr: sumNet,
        description: `จ่ายเงินเดือนสุทธิ ${sumNet.toFixed(2)} ฿`,
      });

      const shopCompanyId = await this.getShopCompanyId(tx);

      const result = await this.journal.createAndPost(
        {
          description: `เงินเดือนงวด ${doc.payroll.payrollPeriod} — ${doc.number}`,
          reference: doc.id,
          metadata: {
            tag: 'PAYROLL',
            documentId: doc.id,
            documentNumber: doc.number,
            documentType: doc.documentType,
            payrollPeriod: doc.payroll.payrollPeriod,
            employeeCount: doc.payroll.lines.length,
            flow: 'expense-payroll',
          },
          postedAt: doc.documentDate,
          companyId: shopCompanyId,
          lines,
        },
        tx,
      );

      await tx.expenseDocument.update({
        where: { id: doc.id },
        data: {
          status: 'POSTED',
          paidAt: doc.documentDate,
          journalEntryId: result.id,
          netPayment: sumNet,
        },
      });

      return { entryNo: result.entryNumber };
    };

    return outerTx ? exec(outerTx) : this.prisma.$transaction(exec);
  }

  private async getShopCompanyId(tx: Prisma.TransactionClient): Promise<string> {
    if (this.shopCompanyIdCache) return this.shopCompanyIdCache;
    const co = await tx.companyInfo.findFirst({
      where: { companyCode: 'SHOP', deletedAt: null },
      select: { id: true },
    });
    if (!co) throw new Error('SHOP companyInfo not found — seed required');
    this.shopCompanyIdCache = co.id;
    return co.id;
  }
}
