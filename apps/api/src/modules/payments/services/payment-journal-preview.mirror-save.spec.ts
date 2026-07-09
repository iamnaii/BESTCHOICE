import { PaymentJournalPreviewService } from './payment-journal-preview.service';

/**
 * QA #1347 follow-up (2026-07-09): the preview's "consolidated 2A+2B" branch
 * predates PR-843/I2 — since then the SAVE path (PaymentReceiptTemplate) ALWAYS
 * posts `Cr 11-2103` and the nightly 2A cron backfills the accrual (the cron
 * accrues dueDate<=today rows regardless of PAID status). A non-accrued
 * installment preview must therefore mirror the save (Cr 11-2103), not show
 * consolidated legs (11-2101 / 41-1101 / 11-2106 / 21-2102 / 11-2105 / 21-2101)
 * that will never post. The `accrualMode` chip still explains the 2A state.
 */
describe('PaymentJournalPreviewService — preview mirrors the save (QA #1347 follow-up)', () => {
  const CONSOLIDATED_ONLY_CODES = ['11-2101', '41-1101', '11-2106', '21-2102', '11-2105', '21-2101'];

  function buildService(accrualJournalEntryId: string | null) {
    const contract = {
      id: 'c1',
      totalMonths: 12,
      interestTotal: '3000',
      monthlyPayment: '1515.83',
      vatAmount: '1190',
      advanceBalance: '0',
    };
    const prisma = {
      installmentSchedule: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'inst-1',
          contractId: 'c1',
          installmentNo: 1,
          accrualJournalEntryId,
          dueDate: new Date('2026-06-08'), // past due → BACKFILL classification
          contract,
        }),
      },
      journalEntry: { findMany: jest.fn().mockResolvedValue([]) },
      chartOfAccount: { findMany: jest.fn().mockResolvedValue([]) },
    } as never;
    return new PaymentJournalPreviewService(prisma, undefined);
  }

  it('non-accrued installment: live lines credit 11-2103 (what the save posts), no consolidated legs', async () => {
    const svc = buildService(null);

    const preview = await svc.previewJournal({
      contractId: 'c1',
      installmentNo: 1,
      amountReceived: 1515.83,
      depositAccountCode: '11-1101',
    } as never);

    const codes = preview.lines.map((l: { accountCode: string }) => l.accountCode);
    expect(codes).toContain('11-2103');
    for (const consolidatedCode of CONSOLIDATED_ONLY_CODES) {
      expect(codes).not.toContain(consolidatedCode);
    }
    // ยอด Cr 11-2103 = ค่างวดเต็ม (mirror PaymentReceiptTemplate)
    const line2103 = preview.lines.find((l: { accountCode: string }) => l.accountCode === '11-2103');
    expect(line2103?.credit).toBe('1515.83');
    expect(preview.isBalanced).toBe(true);
    // ป้ายอธิบายสถานะ 2A ยังคงบอกว่า cron จะ backfill (ไม่ใช่ 2B_ONLY)
    expect(preview.accrualMode).toBe('CONSOLIDATED_BACKFILL');
  });

  it('accrued installment: unchanged — live lines credit 11-2103 and accrualMode=2B_ONLY', async () => {
    const svc = buildService('JE-202606-00001');

    const preview = await svc.previewJournal({
      contractId: 'c1',
      installmentNo: 1,
      amountReceived: 1515.83,
      depositAccountCode: '11-1101',
    } as never);

    const codes = preview.lines.map((l: { accountCode: string }) => l.accountCode);
    expect(codes).toContain('11-2103');
    expect(preview.accrualMode).toBe('2B_ONLY');
    expect(preview.isBalanced).toBe(true);
  });
});
