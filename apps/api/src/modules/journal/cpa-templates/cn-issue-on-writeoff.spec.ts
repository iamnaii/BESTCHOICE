import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../__tests__/scenario-helpers';
import { ContractActivation1ATemplate } from './contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from './installment-accrual-2a.template';
import { BadDebtProvisionTemplate } from './bad-debt-provision.template';
import { BadDebtWriteOffTemplate } from './bad-debt-writeoff.template';
import { EclStageReverseTemplate } from './ecl-stage-reverse.template';
import { JournalAutoService } from '../journal-auto.service';
import { BadDebtService } from '../../accounting/bad-debt.service';
import { ConsecutiveMissedService } from '../../overdue/consecutive-missed.service';
import { CreditNoteDocumentService } from '../../receipts/services/credit-note-document.service';

const prisma = new PrismaClient();

/**
 * Phase 3 Task 3 — end-to-end (real DB) proof that BadDebtService.writeOffBadDebt
 * atomically posts the write-off JE AND issues the auto-CN (ใบลดหนี้) in the
 * SAME $transaction, via the real CreditNoteDocumentService (Task 2) — not a
 * mock. Golden numbers mirror bad-debt-writeoff.template.spec.ts's "mixed
 * accrued/deferred" case (17k/12 fixture, 3 accrued-unpaid installments,
 * no explicit Payment rows so writeOffBadDebt's outstandingAmount tier-gate
 * computes 0 — tier 1, any BM/FM/OWNER approver is fine):
 *   amountBeforeVat=4,249.98 / vatAmount=297.51 / amount=4,547.49
 */
function buildService(journal: JournalAutoService) {
  return new BadDebtService(
    prisma as any,
    journal,
    new BadDebtProvisionTemplate(journal, prisma as any),
    new BadDebtWriteOffTemplate(journal, prisma as any),
    new EclStageReverseTemplate(journal, prisma as any),
    new ConsecutiveMissedService(prisma as any),
    new CreditNoteDocumentService(prisma as any),
  );
}

describe('BadDebtService.writeOffBadDebt — auto-issues CN atomically with the write-off JE', () => {
  let journal: JournalAutoService;
  let contractId: string;
  let writerId: string;
  let approverId: string;

  beforeAll(async () => {
    // Same comprehensive wipe list as bad-debt-writeoff.template.spec.ts's
    // setup() — this spec exercises the same JE + additionally creates a
    // Receipt (CN), so `receipt` must be included (it already is here).
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.receipt.deleteMany({});
    await prisma.eDocument.deleteMany({});
    await prisma.signature.deleteMany({});
    await prisma.contractDocument.deleteMany({});
    await prisma.partialPaymentLink.deleteMany({});
    await prisma.warrantyAuditLog.deleteMany({});
    // NOTE: badDebtWriteOffAuditLog is NOT wiped here — a DB trigger (T1-C7)
    // makes it immutable (DELETE forbidden), same class as AuditLog. This
    // spec is the first to actually exercise BadDebtService.writeOffBadDebt()
    // end-to-end (bad-debt-writeoff.template.spec.ts only calls the JE
    // template directly, which never writes this table), so leftover rows
    // from prior runs are expected and harmless — scoped by contractId,
    // never collide with a fresh seedStandard17k12m() contract.
    await prisma.promiseSlot.deleteMany({});
    await prisma.callLog.deleteMany({});
    await prisma.dunningAction.deleteMany({});
    await prisma.repossession.deleteMany({});
    await prisma.badDebtProvision.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    // Guard (self-healing rerun): a contract this spec previously wrote off
    // has a permanent badDebtWriteOffAuditLog row pointing at it (immutable —
    // see note above), which makes an UNSCOPED `contract.deleteMany({})`
    // fail with a FK violation on any second local run. Exclude those
    // contractIds so the blanket wipe still clears everything else.
    // (Known project gotcha — same class as the documented "docker down -v
    // ก่อน seed" fix for immutable audit-log triggers; see memory notes.)
    const poisoned = await prisma.badDebtWriteOffAuditLog.findMany({
      select: { contractId: true },
    });
    await prisma.contract.deleteMany({
      where: { id: { notIn: poisoned.map((p) => p.contractId) } },
    });
    await prisma.todo.deleteMany({});
    await seedFinanceCoa(prisma);

    // SYSTEM user (isSystemUser) — CreditNoteDocumentService's dirty-gate path
    // needs one, though this scenario's clean-path never reaches it.
    if (!(await prisma.user.findFirst({ where: { isSystemUser: true } }))) {
      await prisma.user.create({
        data: {
          email: 'system-cn-writeoff-spec@bestchoice.com',
          password: 'x',
          name: 'SYSTEM',
          role: 'OWNER',
          isSystemUser: true,
        },
      });
    }

    // FM writer + OWNER approver — segregation of duties (writeOffBadDebt
    // rejects writer === approver).
    const writer = await prisma.user.upsert({
      where: { email: 'fm-cn-writeoff-spec@bestchoice.com' },
      create: {
        email: 'fm-cn-writeoff-spec@bestchoice.com',
        password: 'x',
        name: 'FM Writer',
        role: 'FINANCE_MANAGER',
      },
      update: {},
    });
    const approver = await prisma.user.upsert({
      where: { email: 'owner-cn-writeoff-spec@bestchoice.com' },
      create: {
        email: 'owner-cn-writeoff-spec@bestchoice.com',
        password: 'x',
        name: 'Owner Approver',
        role: 'OWNER',
      },
      update: {},
    });
    writerId = writer.id;
    approverId = approver.id;

    journal = new JournalAutoService(prisma as any);

    const c = await seedStandard17k12m(prisma);
    contractId = c.id;
    // 1A — contract activation JE (creates 11-2101 gross AR balance)
    await new ContractActivation1ATemplate(journal, prisma as any).execute(contractId);

    // 2A × 3 — accrue the first 3 installments (creates the accrued-unpaid
    // set the CN reads: installmentSchedule.accrualJournalEntryId != null,
    // no Payment row → not PAID → counted as accrued-unpaid).
    const insts = await prisma.installmentSchedule.findMany({
      where: { contractId },
      orderBy: { installmentNo: 'asc' },
      take: 3,
    });
    const accrual = new InstallmentAccrual2ATemplate(journal, prisma as any);
    for (const inst of insts) await accrual.execute(inst.id);

    // ปพพ.386 gate — writeOffBadDebt requires TERMINATED.
    await prisma.contract.update({ where: { id: contractId }, data: { status: 'TERMINATED' } });
  });

  afterAll(async () => {
    // Scoped to this spec's own contractId — mirrors ecl-terminated-base.spec.ts's
    // afterAll convention (do NOT touch unscoped shared tables here).
    await prisma.receipt.deleteMany({ where: { contractId } });
    // badDebtWriteOffAuditLog rows are immutable (see beforeAll note) — left in place.
    await prisma.badDebtProvision.deleteMany({ where: { contractId } });
    await prisma.payment.deleteMany({ where: { contractId } });
    await prisma.installmentSchedule.deleteMany({ where: { contractId } });
    // NOT hard-deleted: the badDebtWriteOffAuditLog row this test just wrote
    // permanently FK-references this contract (Restrict, by design — T1-C7
    // financial evidence trail), so `contract.deleteMany` would always throw
    // here. Soft-delete instead (matches "no hard delete" convention) —
    // excluded from every `deletedAt: null` query in the app; the next run
    // of this spec's beforeAll skips it via the badDebtWriteOffAuditLog guard.
    await prisma.contract.update({
      where: { id: contractId },
      data: { deletedAt: new Date() },
    });
    await prisma.$disconnect();
  });

  it('posts the write-off JE and issues a CN Receipt row in the same $transaction', async () => {
    const service = buildService(journal);

    const result = await service.writeOffBadDebt(contractId, writerId, approverId, 'ทดสอบ ECL Phase 3 Task 3');

    expect(result.status).toBe('CLOSED_BAD_DEBT');
    // Return value carries the CN outcome (Task 3 binding requirement — the
    // tx closure must return the cn outcome/receiptId for Task 5 to use).
    expect(result.creditNote).toBeDefined();
    expect(result.creditNote!.outcome).toBe('ISSUED');
    expect(result.creditNote!.receiptId).toBeDefined();

    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'write-off' } } as any,
          { metadata: { path: ['contractId'], equals: contractId } } as any,
        ],
      },
    });
    expect(je).toBeDefined();

    const receipt = await prisma.receipt.findUnique({
      where: { id: result.creditNote!.receiptId! },
    });
    expect(receipt).toBeDefined();
    expect(receipt!.receiptNumber).toMatch(/^RT-\d{6}-\d{5}$/);
    expect(receipt!.receiptType).toBe('CREDIT_NOTE');
    expect(receipt!.cnSource).toBe('WRITE_OFF');
    expect(receipt!.sourceJournalEntryId).toBe(je!.id);
    expect(new Decimal(receipt!.amount.toString()).toFixed(2)).toBe('4547.49');
    expect(new Decimal(receipt!.vatAmount!.toString()).toFixed(2)).toBe('297.51');
    expect(new Decimal(receipt!.amountBeforeVat!.toString()).toFixed(2)).toBe('4249.98');
    expect(receipt!.publicToken).not.toBeNull();
    expect(receipt!.publicTokenExpiresAt).not.toBeNull();
    expect(receipt!.publicTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('is idempotent at the CN layer — re-running issueForContract for the same contract+source skips', async () => {
    // The contract is already CLOSED_BAD_DEBT after the previous test, so a
    // second writeOffBadDebt call would fail the status gate before ever
    // reaching CN issuance. Exercise the CN idempotency guard directly
    // instead (mirrors credit-note-document.service.spec.ts's SKIPPED_DUPLICATE
    // case, but against the real row this spec's first test just created).
    const cnService = new CreditNoteDocumentService(prisma as any);
    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'write-off' } } as any,
          { metadata: { path: ['contractId'], equals: contractId } } as any,
        ],
      },
    });

    const result = await prisma.$transaction((tx) =>
      cnService.issueForContract(
        {
          contractId,
          source: 'WRITE_OFF',
          sourceJournalEntryNo: je!.entryNumber,
          actorUserId: writerId,
        },
        tx,
      ),
    );

    expect(result).toEqual({ outcome: 'SKIPPED_DUPLICATE' });
  });
});
