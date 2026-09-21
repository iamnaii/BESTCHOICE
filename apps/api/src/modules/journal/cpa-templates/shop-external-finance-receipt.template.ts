import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyResolverService } from '../company-resolver.service';
import {
  EXTERNAL_FINANCE_RECEIVABLE_CODE,
  EXTERNAL_FINANCE_FEE_CODE,
  externalFinanceAccountsReady,
} from './external-finance-accounts';

/**
 * รับเงินจากบริษัทไฟแนนซ์ภายนอก — ล้างลูกหนี้ (C1, ครึ่งหลัง)
 *
 * ## JE
 *
 *   Dr <ธนาคาร/เงินสดสาขา>              [receivedAmount]
 *   Dr S51-1106 ค่าธรรมเนียมไฟแนนซ์      [feeAmount]        ← ออกเฉพาะเมื่อ > 0
 *     Cr S11-3101 ลูกหนี้ไฟแนนซ์ภายนอก    [receivedAmount + feeAmount]
 *
 * บริษัทไฟแนนซ์หักค่าธรรมเนียมก่อนโอนจริง — `FinanceReceivable` เก็บไว้แล้วที่
 * `commissionRate` / `commissionAmount` / `netExpectedAmount` ⇒ เงินที่เข้าบัญชี
 * น้อยกว่ายอดลูกหนี้ที่ตั้งไว้ ส่วนต่างเป็นค่าใช้จ่ายในการขาย ไม่ใช่ส่วนลด
 *
 * ## ⛔ สองด่านที่ต้องผ่านก่อนโพสต์
 *
 * **1. ผังพร้อมหรือยัง** — เหมือน `ShopExternalFinanceSaleTemplate`
 *
 * **2. ต้องเป็นลูกหนี้ *ภายนอก* จริง** — ตาราง `FinanceReceivable` ถือ **ลูกหนี้
 * ภายในเครือด้วย**: เส้นทางขายผ่อนเก่าทาง `POST /sales` (ถอดแล้ว 2026-09-20 — แถวเก่ายังอยู่ในฐาน)
 * สร้างแถว `financeCompany = 'BESTCHOICE FINANCE'` สำหรับการขายผ่อนของเราเอง ซึ่งล้างผ่าน **รอบจ่าย INTER-CO**
 * (`S11-3001`/`S11-3002`) อยู่แล้ว ⇒ ถ้าโพสต์ใบนี้ให้แถวภายในเครือด้วย
 * **จะล้างลูกหนี้ซ้ำสองทาง** และทำให้ยอดกระทบยอดระหว่างกิจการเพี้ยนถาวร
 *
 * ผู้เรียกต้องส่ง `isExternal` ที่ตัดสินจาก `externalFinanceCompanyId`/`financeCompany`
 * มาแล้ว — template ปฏิเสธถ้าไม่ใช่ภายนอก (throw ไม่ใช่ skip เงียบ ๆ เพราะการเรียก
 * ผิดประเภทคือบั๊กของผู้เรียก ไม่ใช่สภาพปกติที่ต้องรอ)
 */
export interface ShopExternalFinanceReceiptInput {
  /** กันโพสต์ซ้ำ — ใช้ `shop-ext-finance-receipt:<financeReceivableId>:<seq>` */
  idempotencyKey: string;
  financeReceivableId: string;
  saleId?: string;
  /** ต้องเป็น true — กันโพสต์ทับลูกหนี้ภายในเครือที่ล้างผ่านรอบจ่าย INTER-CO */
  isExternal: boolean;
  /** บัญชีที่เงินเข้าจริง (ต้องขึ้นต้น S) */
  depositAccountCode: string;
  /** เงินที่รับเข้าบัญชีจริง */
  receivedAmount: Decimal;
  /** ค่าธรรมเนียมที่ไฟแนนซ์หักไว้ — 0 ได้ */
  feeAmount: Decimal;
  financeCompany?: string;
  postedAt?: Date;
}

@Injectable()
export class ShopExternalFinanceReceiptTemplate {
  private readonly logger = new Logger(ShopExternalFinanceReceiptTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly companyResolver: CompanyResolverService,
  ) {}

  /** คืน `null` เมื่อผังยังไม่พร้อม (รอคำวินิจฉัยผู้สอบ) */
  async execute(
    input: ShopExternalFinanceReceiptInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; journalEntryId: string } | null> {
    const zero = new Decimal(0);
    const received = new Decimal(input.receivedAmount.toString());
    const fee = new Decimal(input.feeAmount.toString());

    if (!input.isExternal) {
      throw new BadRequestException(
        'ShopExternalFinanceReceipt: ใช้ได้เฉพาะลูกหนี้ไฟแนนซ์ภายนอก — ' +
          'ลูกหนี้ภายในเครือ (BESTCHOICE FINANCE) ล้างผ่านรอบจ่าย INTER-CO เท่านั้น',
      );
    }
    if (received.lt(zero) || fee.lt(zero)) {
      throw new BadRequestException('ShopExternalFinanceReceipt: จำนวนเงินติดลบไม่ได้');
    }
    const cleared = received.plus(fee);
    if (!cleared.gt(zero)) {
      throw new BadRequestException(
        'ShopExternalFinanceReceipt: receivedAmount + feeAmount ต้องมากกว่า 0',
      );
    }
    if (!input.depositAccountCode.startsWith('S')) {
      throw new BadRequestException(
        `ShopExternalFinanceReceipt: depositAccountCode ต้องเป็นฝั่ง SHOP; พบ ${input.depositAccountCode}`,
      );
    }

    const who = input.financeCompany ?? 'บริษัทไฟแนนซ์';

    const run = async (
      tx: Prisma.TransactionClient,
    ): Promise<{ entryNo: string; journalEntryId: string } | null> => {
      const existing = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'shop-external-finance-receipt' } as any },
            { metadata: { path: ['idempotencyKey'], equals: input.idempotencyKey } as any },
          ],
          deletedAt: null,
        },
      });
      if (existing) {
        this.logger.log(
          `ShopExternalFinanceReceiptTemplate idempotency — JE ${existing.entryNumber} already exists for ${input.idempotencyKey}`,
        );
        return { entryNo: existing.entryNumber, journalEntryId: existing.id };
      }

      if (!(await externalFinanceAccountsReady(tx))) {
        this.logger.warn(
          `ShopExternalFinanceReceiptTemplate ข้าม — ผังบัญชียังไม่พร้อม ` +
            `(รอคำวินิจฉัยผู้สอบ ข้อ 3 รอบ 3) · ลูกหนี้ ${input.financeReceivableId}`,
        );
        return null;
      }

      const lines: JeLineInput[] = [];
      if (received.gt(zero)) {
        lines.push({
          accountCode: input.depositAccountCode,
          dr: received,
          cr: zero,
          description: `รับเงินจาก ${who}`,
        });
      }
      if (fee.gt(zero)) {
        lines.push({
          accountCode: EXTERNAL_FINANCE_FEE_CODE,
          dr: fee,
          cr: zero,
          description: `ค่าธรรมเนียมที่ ${who} หักไว้`,
        });
      }
      lines.push({
        accountCode: EXTERNAL_FINANCE_RECEIVABLE_CODE,
        dr: zero,
        cr: cleared,
        description: `ล้างลูกหนี้ ${who}`,
      });

      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
      const result = await this.journal.createAndPost(
        {
          description: `รับเงินจากไฟแนนซ์ภายนอก — ${who} (SHOP)`,
          reference: `finance-receivable:${input.financeReceivableId}:receipt`,
          metadata: {
            tag: 'SHOP_EXTERNAL_FINANCE_RECEIPT',
            flow: 'shop-external-finance-receipt',
            idempotencyKey: input.idempotencyKey,
            financeReceivableId: input.financeReceivableId,
            saleId: input.saleId ?? null,
            companyCode: 'SHOP',
            receivedAmount: received.toFixed(2),
            feeAmount: fee.toFixed(2),
            clearedAmount: cleared.toFixed(2),
            financeCompany: input.financeCompany ?? null,
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
