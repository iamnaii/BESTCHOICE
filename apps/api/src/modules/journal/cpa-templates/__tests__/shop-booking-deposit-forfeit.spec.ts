import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { ShopBookingDepositTemplate } from '../shop-booking-deposit.template';
import { ShopBookingForfeitTemplate } from '../shop-booking-forfeit.template';

/**
 * A5 (คำวินิจฉัยผู้สอบบัญชี 2026-08-25) — ใบจองต้องลงบัญชี
 *
 * ก่อนหน้านี้โมดูล bookings ไม่โพสต์ JE เลย ⇒ เงินมัดจำที่รับจริงไม่เคยขึ้นสมุด SHOP
 * และ S21-2002 เป็นบัญชีตายไม่มีผู้สร้างรายการ
 *
 * ผู้สอบสั่ง: บันทึก "ตอนรับเงิน" · ริบมัดจำเข้า S41-1203 "ต้องไม่รวม VAT"
 */
describe('A5 — เงินมัดจำใบจอง (รับเงิน + ริบ)', () => {
  const d = (v: string | number) => new Decimal(v);

  const makeJournal = () => ({
    createAndPost: vi.fn().mockResolvedValue({ id: 'je-1', entryNumber: 'JE-X' }),
  });
  const makeCompanyResolver = () => ({
    getShopCompanyId: vi.fn().mockResolvedValue('company-shop'),
  });
  const makeTx = (overrides: Record<string, unknown> = {}) => ({
    journalEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      ...(overrides.journalEntry as object),
    },
  });

  describe('รับเงินมัดจำ — ShopBookingDepositTemplate', () => {
    it('Dr เงินสดสาขา / Cr S21-2002 เท่ากัน และผูก companyId ฝั่ง SHOP', async () => {
      const journal = makeJournal();
      const t = new ShopBookingDepositTemplate(
        journal as never,
        {} as never,
        makeCompanyResolver() as never,
      );

      await t.execute(
        {
          idempotencyKey: 'booking-deposit:bk-1',
          bookingId: 'bk-1',
          bookingNumber: 'BK-001',
          cashAccountCode: 'S11-1101',
          depositAmount: d('2000'),
        },
        makeTx() as never,
      );

      const arg = journal.createAndPost.mock.calls[0][0];
      expect(arg.companyId).toBe('company-shop');
      expect(arg.lines).toHaveLength(2);

      const dr = arg.lines.find((l: { accountCode: string }) => l.accountCode === 'S11-1101');
      const cr = arg.lines.find((l: { accountCode: string }) => l.accountCode === 'S21-2002');
      expect(dr.dr.toFixed(2)).toBe('2000.00');
      expect(cr.cr.toFixed(2)).toBe('2000.00');

      expect(arg.metadata.flow).toBe('shop-booking-deposit');
      expect(arg.metadata.bookingId).toBe('bk-1');
      // reference ต้องผูก bookingId — กันชน partial unique index เหมือนบั๊ก F1 ของขายสด
      expect(arg.reference).toBe('booking:bk-1:deposit');
    });

    it('ปฏิเสธรหัสบัญชีฝั่ง FINANCE — กัน JE ลงผิดสมุด', async () => {
      const t = new ShopBookingDepositTemplate(
        makeJournal() as never,
        {} as never,
        makeCompanyResolver() as never,
      );

      // 11-1101 คือเงินสดฝั่ง FINANCE — PayDepositDto เดิมบังคับรหัสชุดนี้
      // ถ้าหลุดเข้ามาจะได้ "ใบผูก SHOP แต่ใช้รหัส FINANCE" ซึ่งหายจากรายงานทั้งสองฝั่ง
      await expect(
        t.execute(
          {
            idempotencyKey: 'booking-deposit:bk-2',
            bookingId: 'bk-2',
            cashAccountCode: '11-1101',
            depositAmount: d('2000'),
          },
          makeTx() as never,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('โพสต์ซ้ำไม่ได้ — คืนใบเดิม', async () => {
      const journal = makeJournal();
      const t = new ShopBookingDepositTemplate(
        journal as never,
        {} as never,
        makeCompanyResolver() as never,
      );
      const tx = makeTx({
        journalEntry: { findFirst: vi.fn().mockResolvedValue({ id: 'je-old', entryNumber: 'JE-OLD' }) },
      });

      const r = await t.execute(
        {
          idempotencyKey: 'booking-deposit:bk-3',
          bookingId: 'bk-3',
          cashAccountCode: 'S11-1201',
          depositAmount: d('500'),
        },
        tx as never,
      );

      expect(r.entryNo).toBe('JE-OLD');
      expect(journal.createAndPost).not.toHaveBeenCalled();
    });
  });

  describe('ริบมัดจำ — ShopBookingForfeitTemplate', () => {
    /** tx ที่ตอบว่า "ยังไม่เคยริบ" แต่ "มี JE รับมัดจำแล้ว" */
    const txWithDepositJe = () => ({
      journalEntry: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null) // idempotency probe
          .mockResolvedValueOnce({ id: 'je-deposit' }), // deposit-JE guard
      },
    });

    it('Dr S21-2002 / Cr S41-1203 — ย้ายหนี้สินเป็นรายได้ ไม่แตะเงินสด', async () => {
      const journal = makeJournal();
      const t = new ShopBookingForfeitTemplate(
        journal as never,
        {} as never,
        makeCompanyResolver() as never,
      );

      await t.execute(
        {
          idempotencyKey: 'booking-forfeit:bk-1',
          bookingId: 'bk-1',
          bookingNumber: 'BK-001',
          depositAmount: d('2000'),
        },
        txWithDepositJe() as never,
      );

      const arg = journal.createAndPost.mock.calls[0][0];
      expect(arg.lines).toHaveLength(2);
      expect(
        arg.lines.find((l: { accountCode: string }) => l.accountCode === 'S21-2002').dr.toFixed(2),
      ).toBe('2000.00');
      expect(
        arg.lines.find((l: { accountCode: string }) => l.accountCode === 'S41-1203').cr.toFixed(2),
      ).toBe('2000.00');

      // ไม่มีบรรทัดเงินสด/ธนาคารเลย — เงินเข้าลิ้นชักไปแล้วตั้งแต่วันวางมัดจำ
      const cashLines = arg.lines.filter((l: { accountCode: string }) =>
        /^S11-1[12]/.test(l.accountCode),
      );
      expect(cashLines).toHaveLength(0);
    });

    it('ผู้สอบระบุว่าไม่มี VAT — ต้องไม่มีบรรทัดภาษี และ stamp กำกับไว้', async () => {
      const journal = makeJournal();
      const t = new ShopBookingForfeitTemplate(
        journal as never,
        {} as never,
        makeCompanyResolver() as never,
      );

      await t.execute(
        {
          idempotencyKey: 'booking-forfeit:bk-vat',
          bookingId: 'bk-vat',
          depositAmount: d('1070'),
        },
        txWithDepositJe() as never,
      );

      const arg = journal.createAndPost.mock.calls[0][0];
      expect(arg.metadata.vatApplicable).toBe(false);
      const vatLines = arg.lines.filter((l: { accountCode: string }) =>
        /2101|2102|2105|4101/.test(l.accountCode),
      );
      expect(vatLines).toHaveLength(0);
      // เต็มจำนวน ไม่ถอด VAT ออก
      expect(
        arg.lines.find((l: { accountCode: string }) => l.accountCode === 'S41-1203').cr.toFixed(2),
      ).toBe('1070.00');
    });

    it('ใบจองยุคก่อนฟีเจอร์ (ไม่มี JE รับมัดจำ) → ข้าม ไม่โพสต์ ไม่ throw', async () => {
      const journal = makeJournal();
      const t = new ShopBookingForfeitTemplate(
        journal as never,
        {} as never,
        makeCompanyResolver() as never,
      );
      // idempotency probe = null, deposit-JE guard = null
      const tx = { journalEntry: { findFirst: vi.fn().mockResolvedValue(null) } };

      const r = await t.execute(
        {
          idempotencyKey: 'booking-forfeit:bk-legacy',
          bookingId: 'bk-legacy',
          depositAmount: d('2000'),
        },
        tx as never,
      );

      // ถ้าโพสต์ จะเครดิตรายได้ทั้งที่ไม่มีหนี้สินให้ปลด ⇒ S21-2002 ติดลบถาวร
      expect(r).toBeNull();
      expect(journal.createAndPost).not.toHaveBeenCalled();
    });
  });
});
