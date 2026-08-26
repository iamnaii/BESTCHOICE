import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyResolverService } from '../company-resolver.service';

/**
 * คืนเงินมัดจำเมื่อยกเลิกใบจอง (A5, คำวินิจฉัยผู้สอบ 2026-08-25)
 *
 * `BookingsService.cancel` คืนมัดจำ **เต็มจำนวน** เมื่อยกเลิกก่อนใบจองหมดอายุ
 * (ถ้าหมดอายุแล้วจะเป็นเส้นทาง `autoExpire` = ริบ ไม่ใช่คืน)
 *
 * ## JE
 *
 *   Dr S21-2002 เงินรับล่วงหน้า - มัดจำสินค้า  [depositAmount]
 *     Cr <บัญชีเงินสด/ธนาคารของสาขา>          [depositAmount]
 *
 * ## ต่างจาก `ShopBookingDepositAppliedTemplate` อย่างไร
 *
 * บรรทัดบัญชีเหมือนกันทุกประการ แต่เป็น **คนละเหตุการณ์ทางธุรกิจ**:
 *
 * | | ล้างเข้าการขาย | คืนเงิน (ใบนี้) |
 * |---|---|---|
 * | เงินสดจริง | **ไม่ออก** — ปรับที่นับซ้ำเฉย ๆ | **ออกจริง** คืนให้ลูกค้า |
 * | ปลายทางของมัดจำ | กลายเป็นรายได้ผ่านใบขาย | กลับไปหาลูกค้า |
 * | มีใบขายคู่ไหม | มี | ไม่มี |
 *
 * แยกเป็นคนละ `flow` เพื่อให้ดูรายงานย้อนหลังแยกออกว่ามัดจำก้อนไหนจบลงอย่างไร
 * — ถ้ารวมเป็นใบเดียวกันจะนับ "เงินสดจ่ายคืนลูกค้า" ปนกับ "รายการปรับบัญชี"
 * (สไตล์เดียวกับ `ShopDownPaymentTemplate` / `ShopDownPaymentReversalTemplate`
 * ที่แยกกันทั้งที่เป็นกระจกกัน)
 */
export interface ShopBookingRefundInput {
  /** กันโพสต์ซ้ำ — ใช้ `booking-refund:<bookingId>` */
  idempotencyKey: string;
  bookingId: string;
  bookingNumber?: string;
  /** ต้องเป็นรหัสฝั่ง SHOP */
  cashAccountCode: string;
  depositAmount: Decimal;
  cancelReason?: string;
  postedAt?: Date;
}

@Injectable()
export class ShopBookingRefundTemplate {
  private readonly logger = new Logger(ShopBookingRefundTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly companyResolver: CompanyResolverService,
  ) {}

  /** คืน `null` เมื่อใบจองนั้นไม่มี JE ตั้งหนี้มัดจำ (ยุคก่อนฟีเจอร์นี้) */
  async execute(
    input: ShopBookingRefundInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; journalEntryId: string } | null> {
    const zero = new Decimal(0);
    const deposit = new Decimal(input.depositAmount.toString());
    if (!deposit.gt(zero)) {
      throw new BadRequestException('ShopBookingRefund: depositAmount must be > 0');
    }
    if (!input.cashAccountCode.startsWith('S')) {
      throw new BadRequestException(
        `ShopBookingRefund: cashAccountCode must be SHOP-side (S-prefix); got ${input.cashAccountCode}`,
      );
    }

    const label = input.bookingNumber ?? input.bookingId;
    const lines: JeLineInput[] = [
      {
        accountCode: 'S21-2002',
        dr: deposit,
        cr: zero,
        description: `ล้างเงินรับล่วงหน้า - ยกเลิกใบจอง ${label}`,
      },
      {
        accountCode: input.cashAccountCode,
        dr: zero,
        cr: deposit,
        description: `คืนเงินมัดจำให้ลูกค้า - ใบจอง ${label}`,
      },
    ];

    const run = async (
      tx: Prisma.TransactionClient,
    ): Promise<{ entryNo: string; journalEntryId: string } | null> => {
      const existing = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'shop-booking-refund' } as any },
            { metadata: { path: ['idempotencyKey'], equals: input.idempotencyKey } as any },
          ],
          deletedAt: null,
        },
      });
      if (existing) {
        this.logger.log(
          `ShopBookingRefundTemplate idempotency — JE ${existing.entryNumber} already exists for ${input.idempotencyKey}`,
        );
        return { entryNo: existing.entryNumber, journalEntryId: existing.id };
      }

      // ด่านเดียวกับขาริบ/ขาล้าง: ไม่มีขาตั้งหนี้ = ปลดไม่ได้
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
          `ShopBookingRefundTemplate ข้าม — ใบจอง ${label} ไม่มี JE รับมัดจำ ` +
            `(วางมัดจำก่อนฟีเจอร์นี้ขึ้น) · forward-only`,
        );
        return null;
      }

      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
      const result = await this.journal.createAndPost(
        {
          description: `คืนเงินมัดจำ — ยกเลิกใบจอง ${label} (SHOP)`,
          reference: `booking:${input.bookingId}:refund`,
          metadata: {
            tag: 'SHOP_BOOKING_REFUND',
            flow: 'shop-booking-refund',
            idempotencyKey: input.idempotencyKey,
            bookingId: input.bookingId,
            bookingNumber: input.bookingNumber ?? null,
            companyCode: 'SHOP',
            depositAmount: deposit.toFixed(2),
            cancelReason: input.cancelReason ?? null,
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
