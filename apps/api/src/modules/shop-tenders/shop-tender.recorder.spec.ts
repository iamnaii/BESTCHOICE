import { Prisma } from '@prisma/client';
import { ShopTenderRecorder } from './shop-tender.recorder';
import { normalizeTenders } from './shop-tender.util';

const D = (v: number | string) => new Prisma.Decimal(v);

function build() {
  const journal = { createAndPost: jest.fn().mockResolvedValue({ id: 'je-split', entryNumber: 'JV-1' }) };
  const companies = { getShopCompanyId: jest.fn().mockResolvedValue('shop-co') };
  const accounts = {
    resolveInflowCashAccount: jest.fn(async (_branch: string, method: string) => (method === 'CASH' ? 'S11-1101' : 'S11-1201')),
  };
  const reversal = { reverse: jest.fn().mockResolvedValue({ reversalJeIds: ['je-rev'], redirectedTotals: {} }) };
  const tx = {
    shopTender: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    journalEntry: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const recorder = new ShopTenderRecorder({} as never, { journal, companies, accounts, reversal } as never);
  return { recorder, journal, accounts, reversal, tx: tx as unknown as Prisma.TransactionClient, raw: tx };
}

describe('ShopTenderRecorder.recordInflow', () => {
  it('writes one IN row per tender with the logged-in actor as receiver, and posts no split JE for a single method', async () => {
    const { recorder, journal, tx, raw } = build();
    const tenders = normalizeTenders([{ method: 'CASH', amount: 12500 }], 12500);

    const result = await recorder.recordInflow(tx, {
      kind: 'CASH_SALE', branchId: 'b1', actorId: 'u-login', doc: { saleId: 's1' }, docNumber: 'SL-1', tenders,
    });

    expect(raw.shopTender.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        direction: 'IN', kind: 'CASH_SALE', branchId: 'b1', actorId: 'u-login', saleId: 's1',
        method: 'CASH', reference: null, seq: 1, seqTotal: 1,
      })],
    });
    expect(journal.createAndPost).not.toHaveBeenCalled();
    expect(result).toEqual({ primaryAccountCode: 'S11-1101', splitJournalEntryId: null });
  });

  it('moves the non-primary part out of the primary account with one balanced split JE (cash first)', async () => {
    const { recorder, journal, tx } = build();
    const tenders = normalizeTenders(
      [{ method: 'CASH', amount: 5000 }, { method: 'BANK_TRANSFER', amount: 4900, reference: '014820931177' }],
      9900,
    );

    const result = await recorder.recordInflow(tx, {
      kind: 'CASH_SALE', branchId: 'b1', actorId: 'u1', doc: { saleId: 's1' }, docNumber: 'SL-1', tenders,
    });

    expect(result).toEqual({ primaryAccountCode: 'S11-1101', splitJournalEntryId: 'je-split' });
    const [je] = journal.createAndPost.mock.calls[0];
    expect(je.companyId).toBe('shop-co');
    expect(je.reference).toBe('sale:s1:tender-split');
    expect(je.lines.map((l: { accountCode: string; dr: Prisma.Decimal; cr: Prisma.Decimal }) => [l.accountCode, l.dr.toString(), l.cr.toString()])).toEqual([
      ['S11-1201', '4900', '0'],
      ['S11-1101', '0', '4900'],
    ]);
    // ใบขาย: ต้องมี saleId ให้ sweep ตอนยกเลิกใบขาย mirror ไปด้วย
    expect(je.metadata).toMatchObject({ flow: 'shop-tender-split', saleId: 's1', tenderDocType: 'sale', tenderDocId: 's1',
      idempotencyKey: 'shop-tender-split:sale:s1' });
  });

  it('sums every row that lands in the other account (transfer first, then cash + cash)', async () => {
    const { recorder, journal, tx } = build();
    const tenders = normalizeTenders(
      [
        { method: 'QR_EWALLET', amount: 3000, reference: 'QR5569012044' },
        { method: 'CASH', amount: 1500 },
        { method: 'BANK_TRANSFER', amount: 2000, reference: 'TR-0000001' },
        { method: 'CASH', amount: 500 },
      ],
      7000,
    );
    await recorder.recordInflow(tx, { kind: 'BOOKING_DEPOSIT', branchId: 'b1', actorId: 'u1', doc: { bookingId: 'bk1' }, tenders });

    const [je] = journal.createAndPost.mock.calls[0];
    // primary = S11-1201 (QR) · โอนอีกก้อนลงบัญชีเดียวกัน ไม่ต้องย้าย · เงินสดสองก้อนรวม 2,000 ย้ายเข้าลิ้นชัก
    expect(je.lines.map((l: { accountCode: string; dr: Prisma.Decimal; cr: Prisma.Decimal }) => [l.accountCode, l.dr.toString(), l.cr.toString()])).toEqual([
      ['S11-1101', '2000', '0'],
      ['S11-1201', '0', '2000'],
    ]);
  });

  it('never tags a contract split JE with contractId — contract sweeps trip on any cash line they find', async () => {
    const { recorder, journal, tx } = build();
    const tenders = normalizeTenders(
      [{ method: 'CASH', amount: 2000 }, { method: 'QR_EWALLET', amount: 3000, reference: 'QR5569012044' }],
      5000,
    );
    await recorder.recordInflow(tx, { kind: 'CONTRACT_DOWN', branchId: 'b1', actorId: 'u1', doc: { contractId: 'c1' }, tenders });

    const [je] = journal.createAndPost.mock.calls[0];
    expect(je.metadata).toMatchObject({ tenderDocType: 'contract', tenderDocId: 'c1' });
    expect(je.metadata).not.toHaveProperty('contractId');
    expect(je.metadata).not.toHaveProperty('saleId');
  });

  it('is idempotent: an existing split JE for the document is reused, not posted twice', async () => {
    const { recorder, journal, tx, raw } = build();
    raw.journalEntry.findFirst.mockResolvedValue({ id: 'je-old', entryNumber: 'JV-0' });
    const tenders = normalizeTenders(
      [{ method: 'CASH', amount: 1 }, { method: 'BANK_TRANSFER', amount: 2, reference: 'TR-0000001' }], 3);
    const result = await recorder.recordInflow(tx, { kind: 'CASH_SALE', branchId: 'b1', actorId: 'u1', doc: { saleId: 's1' }, tenders });
    expect(journal.createAndPost).not.toHaveBeenCalled();
    expect(result.splitJournalEntryId).toBe('je-old');
  });

  it('does nothing when there is no money to receive', async () => {
    const { recorder, journal, tx, raw } = build();
    const result = await recorder.recordInflow(tx, { kind: 'CONTRACT_DOWN', branchId: 'b1', actorId: 'u1', doc: { contractId: 'c1' }, tenders: [] });
    expect(raw.shopTender.createMany).not.toHaveBeenCalled();
    expect(journal.createAndPost).not.toHaveBeenCalled();
    expect(result).toEqual({ primaryAccountCode: null, splitJournalEntryId: null });
  });
});

describe('ShopTenderRecorder — account resolver', () => {
  it('uses the resolver its caller was injected with, never a second one built from prisma', async () => {
    // บัญชีของ JE แยกยอดต้องมาจากแหล่งเดียวกับ JE รับเงินหลักของเอกสาร (CI 2026-09-20: e2e ที่ฉีด resolver
    // จำลอง + สาขาที่ไม่ได้ตั้งบัญชีลิ้นชัก ได้ 400 เพราะ recorder สร้าง resolver ของตัวเองไปอ่านสาขาจริง)
    const accounts = { resolveInflowCashAccount: jest.fn().mockResolvedValue('S11-1101') };
    const prisma = { branch: { findUnique: jest.fn() } };
    const tx = { shopTender: { createMany: jest.fn().mockResolvedValue({ count: 1 }) }, branch: { findUnique: jest.fn() } };
    const recorder = new ShopTenderRecorder(prisma as never, { accounts } as never);

    const result = await recorder.recordInflow(tx as unknown as Prisma.TransactionClient, {
      kind: 'CONTRACT_DOWN', branchId: 'branch-without-till', actorId: 'u1', doc: { contractId: 'c1' },
      tenders: normalizeTenders([{ method: 'CASH', amount: 2000 }], 2000),
    });

    expect(result.primaryAccountCode).toBe('S11-1101');
    expect(accounts.resolveInflowCashAccount).toHaveBeenCalledWith('branch-without-till', 'CASH', tx);
    expect(tx.branch.findUnique).not.toHaveBeenCalled();
    expect(prisma.branch.findUnique).not.toHaveBeenCalled();
  });
});

describe('ShopTenderRecorder.recordRefund', () => {
  const inRows = [
    { id: 't1', kind: 'CONTRACT_DOWN', branchId: 'b1', method: 'CASH', amount: D(2000), reference: null, seq: 1, seqTotal: 2, saleId: null, contractId: 'c1', bookingId: null },
    { id: 't2', kind: 'CONTRACT_DOWN', branchId: 'b1', method: 'QR_EWALLET', amount: D(3000), reference: 'QR5569012044', seq: 2, seqTotal: 2, saleId: null, contractId: 'c1', bookingId: null },
  ];

  it('mirrors every un-refunded IN row as an OUT row paid by whoever cancelled, and reverses the split JE', async () => {
    const { recorder, reversal, tx, raw } = build();
    raw.shopTender.findMany.mockResolvedValue(inRows);
    raw.journalEntry.findFirst.mockResolvedValue({ id: 'je-split', entryNumber: 'JV-1' });

    const count = await recorder.recordRefund(tx, { doc: { contractId: 'c1' }, kinds: ['CONTRACT_DOWN'], actorId: 'u-cancel', reverseSplitJe: true,
      descriptionPrefix: '[ลบร่างสัญญา]' });

    expect(count).toBe(2);
    expect(raw.shopTender.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { direction: 'IN', kind: { in: ['CONTRACT_DOWN'] }, contractId: 'c1', reversedBy: { none: {} } },
    }));
    expect(raw.shopTender.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ direction: 'OUT', kind: 'CONTRACT_DOWN_REFUND', actorId: 'u-cancel', method: 'CASH', reversesTenderId: 't1', contractId: 'c1', seq: 1, seqTotal: 2 }),
        expect.objectContaining({ direction: 'OUT', kind: 'CONTRACT_DOWN_REFUND', actorId: 'u-cancel', method: 'QR_EWALLET', reference: 'QR5569012044', reversesTenderId: 't2' }),
      ],
    });
    expect(reversal.reverse).toHaveBeenCalledWith(
      expect.objectContaining({ jeIds: ['je-split'], flowLabel: 'shop-tender-split-reversed', descriptionPrefix: '[ลบร่างสัญญา]' }), tx);
  });

  it('leaves the split JE alone for a sale void — the saleId sweep already mirrors it', async () => {
    const { recorder, reversal, tx, raw } = build();
    raw.shopTender.findMany.mockResolvedValue([{ ...inRows[0], kind: 'CASH_SALE', saleId: 's1', contractId: null }]);
    await recorder.recordRefund(tx, { doc: { saleId: 's1' }, kinds: ['CASH_SALE', 'EXTERNAL_FINANCE_DOWN'], actorId: 'u1', reverseSplitJe: false });
    expect(raw.shopTender.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ kind: 'SALE_VOID_REFUND', saleId: 's1' })] });
    expect(reversal.reverse).not.toHaveBeenCalled();
  });

  it('writes nothing for a legacy document that has no IN rows', async () => {
    const { recorder, reversal, tx, raw } = build();
    const count = await recorder.recordRefund(tx, { doc: { bookingId: 'bk-old' }, kinds: ['BOOKING_DEPOSIT'], actorId: 'u1', reverseSplitJe: true });
    expect(count).toBe(0);
    expect(raw.shopTender.createMany).not.toHaveBeenCalled();
    expect(reversal.reverse).not.toHaveBeenCalled();
  });
});

describe('ShopTenderRecorder.recordPayout', () => {
  it('records a trade-in payout as one OUT row and maps the trade-in TRANSFER method', async () => {
    const { recorder, tx, raw } = build();
    await recorder.recordPayout(tx, { tradeInId: 'ti1', branchId: 'b1', actorId: 'u1', method: 'TRANSFER', amount: D(4500) });
    expect(raw.shopTender.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ direction: 'OUT', kind: 'TRADE_IN_PAYOUT', tradeInId: 'ti1', method: 'BANK_TRANSFER', actorId: 'u1', reference: null })],
    });
  });

  it('skips a zero payout', async () => {
    const { recorder, tx, raw } = build();
    await recorder.recordPayout(tx, { tradeInId: 'ti1', branchId: 'b1', actorId: 'u1', method: 'CASH', amount: D(0) });
    expect(raw.shopTender.createMany).not.toHaveBeenCalled();
  });
});
