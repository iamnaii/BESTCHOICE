import { Test } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { ExchangeClearVendor21_1106Template } from './cpa-templates/exchange-clear-vendor-21-1106.template';
import { JournalAutoService } from './journal-auto.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ExchangeClearVendor21_1106Template', () => {
  let template: ExchangeClearVendor21_1106Template;
  let journal: any;

  beforeEach(async () => {
    journal = { createAndPost: jest.fn().mockResolvedValue({ id: 'je-uuid', entryNumber: 'JV-X' }) };
    const mod = await Test.createTestingModule({
      providers: [
        ExchangeClearVendor21_1106Template,
        { provide: PrismaService, useValue: {} },
        { provide: JournalAutoService, useValue: journal },
      ],
    }).compile();
    template = mod.get(ExchangeClearVendor21_1106Template);
  });

  it('perfect-offset: posts Dr 21-1101 + Dr 21-1102 = Cr 21-1106 (no cash leg)', async () => {
    await template.execute({
      newContractId: 'new',
      buyback: new Decimal('11000'),
      newVendorYodjat: new Decimal('10000'),
      newVendorCommission: new Decimal('1000'),
    });
    const lines = journal.createAndPost.mock.calls[0][0].lines;
    expect(lines.find((l: any) => l.accountCode === '21-1101').dr.toFixed(2)).toBe('10000.00');
    expect(lines.find((l: any) => l.accountCode === '21-1102').dr.toFixed(2)).toBe('1000.00');
    expect(lines.find((l: any) => l.accountCode === '21-1106').cr.toFixed(2)).toBe('11000.00');
    // No cash account (11-11xx or 11-12xx)
    expect(lines.find((l: any) => /^11-1[12]/.test(l.accountCode))).toBeUndefined();
    // Balanced
    const drSum = lines.reduce((s: Decimal, l: any) => s.plus(l.dr), new Decimal(0));
    const crSum = lines.reduce((s: Decimal, l: any) => s.plus(l.cr), new Decimal(0));
    expect(drSum.toFixed(2)).toBe(crSum.toFixed(2));
  });

  it('cash leg when buyback != vendor sum (refund customer path — was defensive-throw pre-Device-Swap)', async () => {
    await template.execute({
      newContractId: 'new',
      buyback: new Decimal('11000'),
      newVendorYodjat: new Decimal('10000'),
      newVendorCommission: new Decimal('500'),
      depositAccountCode: '11-1201',
    });
    const lines = journal.createAndPost.mock.calls[0][0].lines;
    const cash = lines.find((l: any) => l.accountCode === '11-1201');
    expect(cash.dr.toFixed(2)).toBe('500.00');
    expect(cash.cr.toFixed(2)).toBe('0.00');
    const drSum = lines.reduce((s: Decimal, l: any) => s.plus(l.dr), new Decimal(0));
    const crSum = lines.reduce((s: Decimal, l: any) => s.plus(l.cr), new Decimal(0));
    expect(drSum.toFixed(2)).toBe(crSum.toFixed(2));
  });

  describe('A.3 with cash legs (Device Swap 2026-07, spec §7.3)', () => {
    // vendorSum = 10,000 + 1,000 = 11,000 (workbook fixture)
    const yodjat = new Decimal('10000');
    const comm = new Decimal('1000');

    it('Case 2A: buyback 8,000 < vendorSum → Cr เงินสด 3,000 (FINANCE โอนเพิ่มให้ SHOP)', async () => {
      await template.execute(
        {
          newContractId: 'nc1',
          buyback: new Decimal('8000'),
          newVendorYodjat: yodjat,
          newVendorCommission: comm,
          depositAccountCode: '11-1201',
        },
        undefined,
      );
      const input = journal.createAndPost.mock.calls[0][0];
      const cash = input.lines.find((l: any) => l.accountCode === '11-1201');
      expect(cash.cr.toString()).toBe('3000');
      expect(cash.dr.toString()).toBe('0');
      // balance: Dr 11,000 = Cr 8,000 + 3,000
      const drSum = input.lines.reduce((s: Decimal, l: any) => s.plus(l.dr), new Decimal(0));
      const crSum = input.lines.reduce((s: Decimal, l: any) => s.plus(l.cr), new Decimal(0));
      expect(drSum.toString()).toBe(crSum.toString());
    });

    it('Case 2G: buyback 12,000 > vendorSum → Dr เงินสด 1,000 (คืนเงินลูกค้า)', async () => {
      await template.execute(
        {
          newContractId: 'nc1',
          buyback: new Decimal('12000'),
          newVendorYodjat: yodjat,
          newVendorCommission: comm,
          depositAccountCode: '11-1101',
        },
        undefined,
      );
      const input = journal.createAndPost.mock.calls[0][0];
      const cash = input.lines.find((l: any) => l.accountCode === '11-1101');
      expect(cash.dr.toString()).toBe('1000');
    });

    it('Case 2F: buyback = vendorSum → ไม่มีขาเงินสด (พฤติกรรม SP2 เดิม)', async () => {
      await template.execute(
        { newContractId: 'nc1', buyback: new Decimal('11000'), newVendorYodjat: yodjat, newVendorCommission: comm },
        undefined,
      );
      const input = journal.createAndPost.mock.calls[0][0];
      expect(input.lines).toHaveLength(3);
    });

    it('ต่างจาก vendorSum แต่ไม่ส่ง depositAccountCode → throw ภาษาไทย', async () => {
      await expect(
        template.execute(
          { newContractId: 'nc1', buyback: new Decimal('8000'), newVendorYodjat: yodjat, newVendorCommission: comm },
          undefined,
        ),
      ).rejects.toThrow('ต้องระบุบัญชีเงินสด');
    });

    it('idempotencyKey = newContractId + contractId stamped', async () => {
      await template.execute(
        { newContractId: 'nc1', buyback: new Decimal('11000'), newVendorYodjat: yodjat, newVendorCommission: comm },
        undefined,
      );
      const meta = journal.createAndPost.mock.calls[0][0].metadata;
      expect(meta.idempotencyKey).toBe('nc1');
      expect(meta.contractId).toBe('nc1');
    });
  });
});
