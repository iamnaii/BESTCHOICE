import { Test } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { ExchangeBuybackReceivable11_2107Template } from './cpa-templates/exchange-buyback-receivable-11-2107.template';
import { JournalAutoService } from './journal-auto.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * A.3 หลังคำสั่งเจ้าของ 2026-08-03 (supersedes D5 สำหรับเปลี่ยนเครื่อง):
 * ตั้งลูกหนี้ 11-2107 ล้าง 21-1106 — ไม่มีขาเงินสด ไม่แตะ 21-1101/21-1102.
 */
describe('ExchangeBuybackReceivable11_2107Template', () => {
  let template: ExchangeBuybackReceivable11_2107Template;
  let journal: any;

  beforeEach(async () => {
    journal = { createAndPost: jest.fn().mockResolvedValue({ id: 'je-uuid', entryNumber: 'JV-X' }) };
    const mod = await Test.createTestingModule({
      providers: [
        ExchangeBuybackReceivable11_2107Template,
        { provide: PrismaService, useValue: {} },
        { provide: JournalAutoService, useValue: journal },
      ],
    }).compile();
    template = mod.get(ExchangeBuybackReceivable11_2107Template);
  });

  it('posts exactly 2 lines: Dr 11-2107 = Cr 21-1106 = buyback, balanced', async () => {
    await template.execute({ newContractId: 'nc1', buyback: new Decimal('8000') });
    const lines = journal.createAndPost.mock.calls[0][0].lines;
    expect(lines).toHaveLength(2);
    expect(lines.find((l: any) => l.accountCode === '11-2107').dr.toFixed(2)).toBe('8000.00');
    expect(lines.find((l: any) => l.accountCode === '21-1106').cr.toFixed(2)).toBe('8000.00');
    const drSum = lines.reduce((s: Decimal, l: any) => s.plus(l.dr), new Decimal(0));
    const crSum = lines.reduce((s: Decimal, l: any) => s.plus(l.cr), new Decimal(0));
    expect(drSum.toFixed(2)).toBe('8000.00');
    expect(drSum.toFixed(2)).toBe(crSum.toFixed(2));
  });

  it('NEVER touches the vendor payables (21-1101/21-1102) — they stay outstanding for the INTER-CO batch', async () => {
    await template.execute({ newContractId: 'nc1', buyback: new Decimal('12000') });
    const lines = journal.createAndPost.mock.calls[0][0].lines;
    expect(lines.find((l: any) => l.accountCode === '21-1101')).toBeUndefined();
    expect(lines.find((l: any) => l.accountCode === '21-1102')).toBeUndefined();
  });

  it('NEVER posts a cash/bank leg — no same-day money movement on an exchange', async () => {
    // buyback ทั้งสูงและต่ำกว่าเจ้าหนี้สัญญาใหม่ ก็ยังไม่มีขาเงินสด (ไม่มีการแตกกรณีแล้ว)
    for (const amount of ['8000', '11000', '12000']) {
      journal.createAndPost.mockClear();
      await template.execute({ newContractId: 'nc1', buyback: new Decimal(amount) });
      const lines = journal.createAndPost.mock.calls[0][0].lines;
      expect(lines.find((l: any) => /^11-1[12]0[123]$/.test(l.accountCode))).toBeUndefined();
      expect(lines.find((l: any) => l.accountCode.startsWith('S'))).toBeUndefined();
    }
  });

  it('buyback <= 0 → throw ภาษาไทย', async () => {
    await expect(
      template.execute({ newContractId: 'nc1', buyback: new Decimal('0') }),
    ).rejects.toThrow('ราคารับซื้อ');
    expect(journal.createAndPost).not.toHaveBeenCalled();
  });

  it('idempotencyKey = newContractId + contractId stamped (cancel sweep hook)', async () => {
    await template.execute({ newContractId: 'nc1', buyback: new Decimal('8000') });
    const meta = journal.createAndPost.mock.calls[0][0].metadata;
    expect(meta.flow).toBe('exchange-buyback-receivable-11-2107');
    expect(meta.idempotencyKey).toBe('nc1');
    expect(meta.contractId).toBe('nc1');
    expect(meta.buyback).toBe('8000');
  });
});
