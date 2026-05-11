import { Injectable, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

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
 * Thai SSO law: both employee and employer contribute 5% (cap 750/person).
 * Per-line `ssoEmployee` is reused for the employer side since by law they
 * match — if the rates ever diverge, add a separate `ssoEmployer` field to
 * PayrollLine.
 */
@Injectable()
export class PayrollTemplate {
  private shopCompanyIdCache: string | null = null;

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    documentId: string,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string }> {
    const exec = async (tx: Prisma.TransactionClient): Promise<{ entryNo: string }> => {
      const doc = await tx.expenseDocument.findUniqueOrThrow({
        where: { id: documentId },
        include: { payroll: { include: { lines: true } } },
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

      const lines: JeLineInput[] = [
        {
          accountCode: '53-1101',
          dr: sumBase,
          cr: zero,
          description: `เงินเดือน-ค่าจ้าง งวด ${doc.payroll.payrollPeriod}`,
        },
      ];
      // Employer-side SSO: by Thai law, employer contributes the same amount
      // as the employee (5% of base salary, capped at 750/person). Hence we
      // reuse `sumSso` (which currently captures the employee deduction) for
      // the employer expense + payable.
      if (sumSso.gt(zero)) {
        lines.push({
          accountCode: '53-1102',
          dr: sumSso,
          cr: zero,
          description: `เงินสมทบประกันสังคม (นายจ้าง) งวด ${doc.payroll.payrollPeriod}`,
        });
      }
      if (sumWht.gt(zero)) {
        lines.push({
          accountCode: '21-3101',
          dr: zero,
          cr: sumWht,
          description: 'หัก ณ ที่จ่าย ภงด.1',
        });
      }
      if (sumSso.gt(zero)) {
        lines.push({
          accountCode: '21-3105',
          dr: zero,
          cr: sumSso,
          description: 'เงินสมทบประกันสังคม-พนักงานค้างนำส่ง',
        });
        lines.push({
          accountCode: '21-3106',
          dr: zero,
          cr: sumSso,
          description: 'เงินสมทบประกันสังคม-นายจ้างค้างนำส่ง',
        });
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
