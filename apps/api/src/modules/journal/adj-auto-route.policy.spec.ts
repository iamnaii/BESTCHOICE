import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PaymentReceipt2BTemplate } from './cpa-templates/payment-receipt-2b.template';

/**
 * D1.1.6.3 — adj_auto_route SystemConfig toggle (PaymentReceipt2B).
 *
 * When `adj_auto_route` is FALSE and the rounding remainder would have to be
 * auto-routed to 52-1104 / 53-1503, the JE template throws
 * BadRequestException('Auto-routing disabled — manual adjustment required').
 *
 * Default behaviour (no SystemConfig row) is "true" — the templates auto-
 * route as before. We test the flag-OFF branch in isolation here because the
 * happy path (route + post JE) is covered by the (currently jest-excluded)
 * CPA integration specs at `cpa-templates/*.spec.ts`.
 */
describe('PaymentReceipt2BTemplate — adj_auto_route flag-off branch (D1.1.6.3)', () => {
  // Standard 17k/12m CPA contract → installmentTotal = 1515.83
  const standardContract = {
    totalMonths: 12,
    financedAmount: new Decimal('15000'),
    storeCommission: new Decimal('1500'),
    interestTotal: new Decimal('500'),
    vatAmount: new Decimal('1190'),
  };
  const installmentTotal = '1515.83';

  function buildInstallment(): any {
    return {
      id: 'inst-1',
      installmentNo: 1,
      dueDate: new Date(),
      vat60dayJournalEntryId: null,
      contract: { id: 'c-1', contractNumber: 'C-1', ...standardContract },
    };
  }

  function buildMockPrisma(adjAutoRouteValue: string | null) {
    return {
      installmentSchedule: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(buildInstallment()),
      },
      systemConfig: {
        findFirst: jest.fn().mockImplementation((args: any) => {
          if (args?.where?.key === 'adj_auto_route') {
            return Promise.resolve(
              adjAutoRouteValue === null ? null : { value: adjAutoRouteValue },
            );
          }
          return Promise.resolve(null);
        }),
      },
    } as any;
  }

  const journalMock: any = { createAndPost: jest.fn() };

  it('flag=false + underpay rounding → throws "Auto-routing disabled"', async () => {
    const prisma = buildMockPrisma('false');
    const tpl = new PaymentReceipt2BTemplate(journalMock, prisma);
    await expect(
      tpl.execute({
        installmentScheduleId: 'inst-1',
        amountReceived: new Decimal(installmentTotal).minus('0.50'),
        depositAccountCode: '11-1101',
        toleranceApproverId: 'approver-1',
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Auto-routing disabled'),
    });
  });

  it('flag=false + overpay rounding → throws "Auto-routing disabled"', async () => {
    const prisma = buildMockPrisma('false');
    const tpl = new PaymentReceipt2BTemplate(journalMock, prisma);
    await expect(
      tpl.execute({
        installmentScheduleId: 'inst-1',
        amountReceived: new Decimal(installmentTotal).plus('0.50'),
        depositAccountCode: '11-1101',
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Auto-routing disabled'),
    });
  });

  it('flag=true (explicit) + underpay rounding → does NOT throw the auto-route guard', async () => {
    // With flag=true, the auto-route guard is satisfied. The test still
    // expects rejection because the journal post path will fail (the mock
    // for $transaction is not wired here) — but the rejection MUST NOT be
    // the "Auto-routing disabled" BadRequestException.
    const prisma = buildMockPrisma('true');
    const tpl = new PaymentReceipt2BTemplate(journalMock, prisma);
    await expect(
      tpl.execute({
        installmentScheduleId: 'inst-1',
        amountReceived: new Decimal(installmentTotal).minus('0.50'),
        depositAccountCode: '11-1101',
        toleranceApproverId: 'approver-1',
      }),
    ).rejects.not.toMatchObject({
      message: expect.stringContaining('Auto-routing disabled'),
    });
  });

  it('flag=false + missing approver → still throws approver error first (fail-fast order preserved)', async () => {
    // Approver-required check runs BEFORE the auto-route flag check, so the
    // operator gets the actionable "missing approver" error rather than the
    // configuration-level "disabled" message.
    const prisma = buildMockPrisma('false');
    const tpl = new PaymentReceipt2BTemplate(journalMock, prisma);
    await expect(
      tpl.execute({
        installmentScheduleId: 'inst-1',
        amountReceived: new Decimal(installmentTotal).minus('0.50'),
        depositAccountCode: '11-1101',
        // toleranceApproverId intentionally omitted
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('approver'),
    });
  });
});
