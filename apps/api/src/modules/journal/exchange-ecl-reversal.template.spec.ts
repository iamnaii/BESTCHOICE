import { Decimal } from '@prisma/client/runtime/library';
import { ExchangeEclReversalTemplate } from './cpa-templates/exchange-ecl-reversal.template';

describe('ExchangeEclReversalTemplate (A.5 — workbook Case 4, spec §7.4)', () => {
  let createAndPost: jest.Mock;
  let findMany: jest.Mock;
  let template: ExchangeEclReversalTemplate;

  beforeEach(() => {
    createAndPost = jest.fn().mockResolvedValue({ id: 'je5', entryNumber: 'JE-202607-9999' });
    findMany = jest.fn();
    const journal = { createAndPost } as any;
    const prisma = { journalLine: { findMany } } as any;
    template = new ExchangeEclReversalTemplate(journal, prisma);
  });

  it('GL 11-2102 = 567 → Dr 11-2102 / Cr 51-1103 = 567.00 (workbook Case 4 golden, CPA 2026-08-01 single-standard)', async () => {
    findMany.mockResolvedValue([{ debit: new Decimal(0), credit: new Decimal('567') }]);
    const result = await template.execute({ oldContractId: 'c1', requestId: 'req-1' });
    expect(result).not.toBeNull();
    const input = createAndPost.mock.calls[0][0];
    const dr = input.lines.find((l: any) => l.accountCode === '11-2102');
    const cr = input.lines.find((l: any) => l.accountCode === '51-1103');
    expect(dr.dr.toString()).toBe('567');
    expect(cr.cr.toString()).toBe('567');
    expect(input.metadata.flow).toBe('exchange-ecl-reversal');
    // C1b: request-scoped key — re-exchange after cancel must not collide
    expect(input.metadata.idempotencyKey).toBe('c1:req-1');
    expect(input.metadata.contractId).toBe('c1'); // ให้ glContractBalance เห็น → 11-2102 net 0
  });

  it('ไม่มี provision (GL = 0) → return null ไม่ post', async () => {
    findMany.mockResolvedValue([]);
    const result = await template.execute({ oldContractId: 'c1', requestId: 'req-1' });
    expect(result).toBeNull();
    expect(createAndPost).not.toHaveBeenCalled();
  });

  it('GL ติดลบ (anomaly) → return null + ไม่ post (Sentry warning)', async () => {
    findMany.mockResolvedValue([{ debit: new Decimal('100'), credit: new Decimal(0) }]);
    const result = await template.execute({ oldContractId: 'c1', requestId: 'req-1' });
    expect(result).toBeNull();
    expect(createAndPost).not.toHaveBeenCalled();
  });
});
