import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyResolverService } from '../company-resolver.service';

/**
 * ริบเงินมัดจำใบจอง — ลูกค้าไม่มารับสินค้าตามกำหนด (คำวินิจฉัยผู้สอบบัญชี 2026-08-25)
 *
 * ผู้สอบอนุมัติบัญชี **`S41-1203 รายได้จากการริบเงินมัดจำ`** และระบุว่า
 * **"ต้องไม่รวม VAT"** ⇒ ไม่มีขาภาษีขายในรายการนี้
 *
 * ## JE (SHOP ฝั่งเดียว — ไม่แตะเงินสด)
 *
 *   Dr S21-2002 เงินรับล่วงหน้า - มัดจำสินค้า  [depositAmount]
 *     Cr S41-1203 รายได้จากการริบเงินมัดจำ      [depositAmount]
 *
 * **ไม่มีขาเงินสด** เพราะเงินเข้าลิ้นชักไปแล้วตั้งแต่วันวางมัดจำ
 * (`ShopBookingDepositTemplate`) — การริบเป็นแค่การย้ายจาก **หนี้สิน** (เงินที่ต้องคืน)
 * ไปเป็น **รายได้** (เงินที่เป็นของร้านแล้ว) ไม่มีเงินไหลเข้าออกเพิ่ม
 *
 * ## ⚠️ ด่านสำคัญ — ต้องมีขาตั้งหนี้ก่อนถึงจะริบได้
 *
 * ใบจองที่วางมัดจำ **ก่อน** ฟีเจอร์นี้ขึ้น ไม่มี JE ตั้ง `S21-2002` ไว้เลย
 * (โมดูล bookings ไม่เคยโพสต์ JE) ⇒ ถ้าริบโดยไม่ตรวจ จะเครดิตรายได้ทั้งที่
 * **ไม่มีหนี้สินให้ปลด** ⇒ `S21-2002` ติดลบถาวร
 *
 * จึงตรวจว่ามี JE `shop-booking-deposit` ของใบจองนั้นอยู่จริงก่อนเสมอ —
 * ไม่มี = ข้ามเงียบ ๆ (คืน `null`) ไม่ throw เพราะ cron ต้องเดินต่อได้
 * นี่คือกติกา **forward-only** เดียวกับที่ใช้ทั้งโปรเจกต์
 */
export interface ShopBookingForfeitInput {
  /** กันโพสต์ซ้ำ — ใช้ `booking-forfeit:<bookingId>` */
  idempotencyKey: string;
  bookingId: string;
  bookingNumber?: string;
  depositAmount: Decimal;
  postedAt?: Date;
}

@Injectable()
export class ShopBookingForfeitTemplate {
  private readonly logger = new Logger(ShopBookingForfeitTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly companyResolver: CompanyResolverService,
  ) {}

  /**
   * คืน `null` เมื่อข้ามอย่างตั้งใจ (ไม่มีขาตั้งหนี้จากยุคก่อนฟีเจอร์นี้)
   */
  async execute(
    input: ShopBookingForfeitInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; journalEntryId: string } | null> {
    const zero = new Decimal(0);
    const deposit = new Decimal(input.depositAmount.toString());
    if (!deposit.gt(zero)) {
      throw new BadRequestException('ShopBookingForfeit: depositAmount must be > 0');
    }

    const label = input.bookingNumber ?? input.bookingId;
    const lines: JeLineInput[] = [
      {
        accountCode: 'S21-2002',
        dr: deposit,
        cr: zero,
        description: `ล้างเงินรับล่วงหน้า - ริบมัดจำใบจอง ${label}`,
      },
      {
        accountCode: 'S41-1203',
        dr: zero,
        cr: deposit,
        description: `รายได้จากการริบเงินมัดจำ ${label}`,
      },
    ];

    const run = async (
      tx: Prisma.TransactionClient,
    ): Promise<{ entryNo: string; journalEntryId: string } | null> => {
      const existing = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'shop-booking-forfeit' } as any },
            { metadata: { path: ['idempotencyKey'], equals: input.idempotencyKey } as any },
          ],
          deletedAt: null,
        },
      });
      if (existing) {
        this.logger.log(
          `ShopBookingForfeitTemplate idempotency — JE ${existing.entryNumber} already exists for ${input.idempotencyKey}`,
        );
        return { entryNo: existing.entryNumber, journalEntryId: existing.id };
      }

      // ด่าน: ต้องมีขาตั้งหนี้ (JE รับมัดจำ) ก่อน ไม่งั้น S21-2002 จะติดลบ
      const depositJe = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'shop-booking-deposit' } as any },
            { metadata: { path: ['bookingId'], equals: input.bookingId } as any },
          ],
          status: 'POSTED',
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!depositJe) {
        this.logger.warn(
          `ShopBookingForfeitTemplate ข้าม — ใบจอง ${label} ไม่มี JE รับมัดจำ ` +
            `(วางมัดจำก่อนฟีเจอร์นี้ขึ้น) จึงไม่มีหนี้สินให้ปลด · forward-only`,
        );
        return null;
      }

      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
      const result = await this.journal.createAndPost(
        {
          description: `ริบเงินมัดจำ — ใบจอง ${label} (SHOP)`,
          reference: `booking:${input.bookingId}:forfeit`,
          metadata: {
            tag: 'SHOP_BOOKING_FORFEIT',
            flow: 'shop-booking-forfeit',
            idempotencyKey: input.idempotencyKey,
            bookingId: input.bookingId,
            bookingNumber: input.bookingNumber ?? null,
            companyCode: 'SHOP',
            depositAmount: deposit.toFixed(2),
            // ผู้สอบระบุชัดว่าไม่มี VAT — stamp ไว้กันคนรุ่นหลังเติมขาภาษีเข้ามา
            vatApplicable: false,
          },
          postedAt: input.postedAt ?? new Date(),
          companyId: shopCompanyId,
          lines,
        },
        tx,
      );
      return { entryNo: result.entryNumber, journalEntryId: result.id };
    };

    return outerTx ? run(outerTx) : this.prisma.$transaction(run);
  }
}
