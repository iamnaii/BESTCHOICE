import { Injectable, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccountRoleService } from '../account-role.service';
import { CompanyResolverService } from '../company-resolver.service';

/**
 * Template — Payroll (PR เงินเดือนงวด).
 *
 * Spec §4.4 — aggregates PayrollLine[] into single balanced JE.
 * คำสั่งเจ้าของ 2026-08-06 — เอกสารสังกัดฝั่งเดียวผ่าน PayrollDetail.entityScope:
 *
 *   SHOP (default — พนักงานสาขา, companyId = SHOP):
 *     Dr S52-1201 เงินเดือนพนักงานสาขา        (Σ baseSalary)
 *     Dr S52-1205 เงินสมทบ ปกส. นายจ้าง-สาขา   (Σ ssoEmployee)  [if Σ > 0]
 *       Cr S21-3101 ภ.ง.ด. 1 ค้างจ่าย - SHOP   (Σ whtAmount)    [if Σ > 0]
 *       Cr S21-3105 ปกส. พนักงานค้างนำส่ง       (Σ ssoEmployee)  [if Σ > 0]
 *       Cr S21-3106 ปกส. นายจ้างค้างนำส่ง       (Σ ssoEmployee)  [if Σ > 0]
 *       Cr depositAccountCode (S11-XXXX)       (Σ netPaid)
 *
 *   FINANCE (พนักงานส่วนกลาง, companyId = FINANCE — B2 fix: เดิม post SHOP
 *   companyId คู่กับรหัสผัง FINANCE ทำให้ JE ตกทุก scope filter ของรายงาน):
 *     Dr 53-1101 / Dr 53-1102 / Cr 21-3101 / Cr 21-3105 / Cr 21-3106 / Cr 11-XXXX
 *
 * Account codes are role-resolved (AccountRoleService) — owner can remap in
 * admin UI without redeploying. When the CPA's full SHOP chart renumbering
 * lands (payroll → 53-11XX per the 2026-08-06 chart image), only the
 * account_role_map rows change.
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
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly roles: AccountRoleService,
    private readonly companyResolver: CompanyResolverService,
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

      // Idempotency (app-level; DB-level partial unique index on
      // (metadata.flow, metadata.idempotencyKey) backs this up below).
      if (doc.journalEntryId) {
        const existing = await tx.journalEntry.findUnique({ where: { id: doc.journalEntryId } });
        return { entryNo: existing?.entryNumber ?? doc.journalEntryId };
      }

      if (!doc.payroll || doc.payroll.lines.length === 0) {
        throw new BadRequestException(`Payroll ${documentId} missing payroll detail or lines`);
      }
      if (!doc.depositAccountCode) {
        throw new BadRequestException(`Payroll ${documentId} requires depositAccountCode`);
      }

      const scope: 'SHOP' | 'FINANCE' =
        doc.payroll.entityScope === 'FINANCE' ? 'FINANCE' : 'SHOP';

      // Defense in depth — create-service already pins the cash leg to the
      // scope's chart; re-assert here so a hand-edited row can't cross books.
      const depositIsShop = doc.depositAccountCode.startsWith('S');
      if ((scope === 'SHOP') !== depositIsShop) {
        throw new BadRequestException(
          `Payroll ${doc.number}: บัญชีจ่าย ${doc.depositAccountCode} ไม่ตรงฝั่งเอกสาร (${scope})`,
        );
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
      const rolePrefix = scope === 'SHOP' ? 'shop_' : '';
      const codePayrollExpense = this.roles.code(`${rolePrefix}payroll_expense`);
      const codeSsoExpense = this.roles.code(`${rolePrefix}payroll_sso_expense`);
      const codeWhtPayroll = this.roles.code(`${rolePrefix}wht_payroll`);
      const codeSsoEmployee = this.roles.code(`${rolePrefix}sso_employee`);
      const codeSsoEmployer = this.roles.code(`${rolePrefix}sso_employer`);

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

      const companyId =
        scope === 'SHOP'
          ? await this.companyResolver.getShopCompanyId(tx)
          : await this.companyResolver.getFinanceCompanyId(tx);

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
            entityScope: scope,
            employeeCount: doc.payroll.lines.length,
            flow: 'expense-payroll',
            // DB partial unique index journal_entries_idempotency_idx on
            // (flow, idempotencyKey) — a concurrent double-post now fails at
            // the DB even if both writers read journalEntryId as null.
            idempotencyKey: `expense-payroll:${doc.id}`,
          },
          postedAt: doc.documentDate,
          companyId,
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
}
