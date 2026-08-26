import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { ShopExternalFinanceSaleTemplate } from '../shop-external-finance-sale.template';
import { ShopExternalFinanceReceiptTemplate } from '../shop-external-finance-receipt.template';
import {
  EXTERNAL_FINANCE_RECEIVABLE_CODE,
  EXTERNAL_FINANCE_FEE_CODE,
} from '../external-finance-accounts';

/**
 * C1 (คำวินิจฉัยผู้สอบ 2026-08-25 "แก้ไปข้างหน้าเหมือนกัน")
 *
 * การขายผ่านบริษัทไฟแนนซ์ภายนอกไม่เคยลงบัญชีฝั่ง SHOP เลย
 *
 * ⛔ ยัง **ปิดอยู่** จนกว่าผู้สอบจะเคาะบัญชี S11-3101 + S51-1106
 *    (คำถามรอบ 3 ข้อ 3) — เทสชุดนี้ปักทั้งพฤติกรรม "ตอนยังปิด"
 *    และ "ตอนเปิดแล้ว" ไว้ล่วงหน้า เพื่อให้วันที่เพิ่มบัญชีเข้าผัง
 *    ไม่ต้องเขียนเทสใหม่ แค่ seed แล้วมันทำงาน
 */
describe('C1 — ขายผ่านไฟแนนซ์ภายนอก', () => {
  const d = (v: string | number) => new Decimal(v);

  const makeJournal = () => ({
    createAndPost: vi.fn().mockResolvedValue({ id: 'je-1', entryNumber: 'JE-X' }),
  });
  const makeCompanyResolver = () => ({
    getShopCompanyId: vi.fn().mockResolvedValue('company-shop'),
  });

  /** tx ที่ผังยังไม่มีบัญชีใหม่ (สภาพวันนี้) */
  const txAccountsMissing = () => ({
    journalEntry: { findFirst: vi.fn().mockResolvedValue(null) },
    chartOfAccount: { findMany: vi.fn().mockResolvedValue([]) },
  });
  /** tx ที่ผังพร้อมแล้ว (หลังผู้สอบเคาะ + seed:coa) */
  const txAccountsReady = () => ({
    journalEntry: { findFirst: vi.fn().mockResolvedValue(null) },
    chartOfAccount: {
      findMany: vi.fn().mockResolvedValue([
        { code: EXTERNAL_FINANCE_RECEIVABLE_CODE },
        { code: EXTERNAL_FINANCE_FEE_CODE },
      ]),
    },
  });

  const saleInput = {
    idempotencyKey: 'shop-ext-finance-sale:sale-1',
    saleId: 'sale-1',
    saleNumber: 'SA-001',
    productId: 'prod-1',
    cashAccountCode: 'S11-1101',
    inventoryAccountCode: 'S11-2001',
    cogsAccountCode: 'S50-1101',
    revenueAccountCode: 'S41-1101',
    downPayment: d('3000'),
    financeAmount: d('17000'),
    netAmount: d('20000'),
    inventoryCost: d('15000'),
    financeCompany: 'GFIN',
  };

  describe('ด่านผัง — ยังไม่เคาะบัญชี = ไม่โพสต์', () => {
    it('ขาย: ผังไม่มีบัญชี → คืน null ไม่ throw (การขายต้องไม่ล่ม)', async () => {
      const journal = makeJournal();
      const t = new ShopExternalFinanceSaleTemplate(
        journal as never,
        {} as never,
        makeCompanyResolver() as never,
      );

      const r = await t.execute(saleInput, txAccountsMissing() as never);

      expect(r).toBeNull();
      expect(journal.createAndPost).not.toHaveBeenCalled();
    });

    it('รับเงิน: ผังไม่มีบัญชี → คืน null ไม่ throw', async () => {
      const journal = makeJournal();
      const t = new ShopExternalFinanceReceiptTemplate(
        journal as never,
        {} as never,
        makeCompanyResolver() as never,
      );

      const r = await t.execute(
        {
          idempotencyKey: 'k',
          financeReceivableId: 'fr-1',
          isExternal: true,
          depositAccountCode: 'S11-1201',
          receivedAmount: d('16500'),
          feeAmount: d('500'),
        },
        txAccountsMissing() as never,
      );

      expect(r).toBeNull();
      expect(journal.createAndPost).not.toHaveBeenCalled();
    });
  });

  describe('เมื่อผังพร้อมแล้ว — ขาย', () => {
    it('Dr เงินสด + Dr ลูกหนี้ = Cr รายได้ · แยกคู่ต้นทุน/สต็อก', async () => {
      const journal = makeJournal();
      const t = new ShopExternalFinanceSaleTemplate(
        journal as never,
        {} as never,
        makeCompanyResolver() as never,
      );

      await t.execute(saleInput, txAccountsReady() as never);

      const arg = journal.createAndPost.mock.calls[0][0];
      const line = (code: string) =>
        arg.lines.find((l: { accountCode: string }) => l.accountCode === code);

      expect(line('S11-1101').dr.toFixed(2)).toBe('3000.00');
      expect(line(EXTERNAL_FINANCE_RECEIVABLE_CODE).dr.toFixed(2)).toBe('17000.00');
      expect(line('S41-1101').cr.toFixed(2)).toBe('20000.00');
      expect(line('S50-1101').dr.toFixed(2)).toBe('15000.00');
      expect(line('S11-2001').cr.toFixed(2)).toBe('15000.00');

      // สมดุล
      const dr = arg.lines.reduce((a: number, l: { dr: { toNumber(): number } }) => a + l.dr.toNumber(), 0);
      const cr = arg.lines.reduce((a: number, l: { cr: { toNumber(): number } }) => a + l.cr.toNumber(), 0);
      expect(dr).toBeCloseTo(cr, 2);

      // reference ไม่ชนรูปของขายสด (sale:<id>:<productId>) — บทเรียนบั๊ก F1
      expect(arg.reference).toBe('sale:sale-1:external-finance');
      expect(arg.metadata.saleId).toBe('sale-1');
    });

    it('ไม่มีเงินดาวน์ → ไม่มีบรรทัดเงินสด ลูกหนี้รับเต็มยอด', async () => {
      const journal = makeJournal();
      const t = new ShopExternalFinanceSaleTemplate(
        journal as never,
        {} as never,
        makeCompanyResolver() as never,
      );

      await t.execute(
        { ...saleInput, downPayment: d(0), financeAmount: d('20000') },
        txAccountsReady() as never,
      );

      const arg = journal.createAndPost.mock.calls[0][0];
      expect(
        arg.lines.find((l: { accountCode: string }) => l.accountCode === 'S11-1101'),
      ).toBeUndefined();
      expect(
        arg.lines.find(
          (l: { accountCode: string }) => l.accountCode === EXTERNAL_FINANCE_RECEIVABLE_CODE,
        ).dr.toFixed(2),
      ).toBe('20000.00');
    });

    it('ดาวน์ + ยอดไฟแนนซ์ ไม่เท่ายอดขาย → ปฏิเสธ (ไม่เชื่อ DTO)', async () => {
      const t = new ShopExternalFinanceSaleTemplate(
        makeJournal() as never,
        {} as never,
        makeCompanyResolver() as never,
      );

      await expect(
        t.execute(
          { ...saleInput, downPayment: d('3000'), financeAmount: d('16000') },
          txAccountsReady() as never,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('เมื่อผังพร้อมแล้ว — รับเงิน', () => {
    it('Dr ธนาคาร + Dr ค่าธรรมเนียม = Cr ลูกหนี้ (ล้างเต็มยอดที่ตั้งไว้)', async () => {
      const journal = makeJournal();
      const t = new ShopExternalFinanceReceiptTemplate(
        journal as never,
        {} as never,
        makeCompanyResolver() as never,
      );

      await t.execute(
        {
          idempotencyKey: 'shop-ext-finance-receipt:fr-1:1',
          financeReceivableId: 'fr-1',
          saleId: 'sale-1',
          isExternal: true,
          depositAccountCode: 'S11-1201',
          receivedAmount: d('16500'),
          feeAmount: d('500'),
          financeCompany: 'GFIN',
        },
        txAccountsReady() as never,
      );

      const arg = journal.createAndPost.mock.calls[0][0];
      const line = (code: string) =>
        arg.lines.find((l: { accountCode: string }) => l.accountCode === code);

      expect(line('S11-1201').dr.toFixed(2)).toBe('16500.00');
      expect(line(EXTERNAL_FINANCE_FEE_CODE).dr.toFixed(2)).toBe('500.00');
      // ล้างลูกหนี้เต็ม 17,000 ไม่ใช่แค่เงินที่รับเข้า 16,500
      expect(line(EXTERNAL_FINANCE_RECEIVABLE_CODE).cr.toFixed(2)).toBe('17000.00');
    });

    it('ไม่มีค่าธรรมเนียม → ไม่มีบรรทัดค่าใช้จ่าย', async () => {
      const journal = makeJournal();
      const t = new ShopExternalFinanceReceiptTemplate(
        journal as never,
        {} as never,
        makeCompanyResolver() as never,
      );

      await t.execute(
        {
          idempotencyKey: 'k2',
          financeReceivableId: 'fr-2',
          isExternal: true,
          depositAccountCode: 'S11-1201',
          receivedAmount: d('17000'),
          feeAmount: d(0),
        },
        txAccountsReady() as never,
      );

      const arg = journal.createAndPost.mock.calls[0][0];
      expect(
        arg.lines.find((l: { accountCode: string }) => l.accountCode === EXTERNAL_FINANCE_FEE_CODE),
      ).toBeUndefined();
    });

    it('⚠️ ลูกหนี้ภายในเครือ → throw ไม่ใช่ข้ามเงียบ (กันล้างซ้ำกับรอบจ่าย INTER-CO)', async () => {
      const journal = makeJournal();
      const t = new ShopExternalFinanceReceiptTemplate(
        journal as never,
        {} as never,
        makeCompanyResolver() as never,
      );

      // FinanceReceivable ถือลูกหนี้ภายในเครือด้วย (financeCompany='BESTCHOICE FINANCE')
      // ซึ่งล้างผ่าน S11-3001/S11-3002 ในรอบจ่ายอยู่แล้ว — โพสต์ใบนี้ให้ด้วย = ล้างซ้ำสองทาง
      await expect(
        t.execute(
          {
            idempotencyKey: 'k3',
            financeReceivableId: 'fr-internal',
            isExternal: false,
            depositAccountCode: 'S11-1201',
            receivedAmount: d('17000'),
            feeAmount: d(0),
            financeCompany: 'BESTCHOICE FINANCE',
          },
          txAccountsReady() as never,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(journal.createAndPost).not.toHaveBeenCalled();
    });
  });
});
