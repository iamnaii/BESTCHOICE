import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyResolverService } from '../company-resolver.service';
import { SHOP_PETTY_CASH_ACCOUNT, SUPPLIER_PAYMENT_ACCOUNTS, isBankSupplierPaymentAccount } from '../supplier-payment-accounts';

/**
 * SHOP — เติม / คืนเงินสดย่อย S11-1106 (ข้อ 20.2 · คำตอบฝ่ายบัญชี 16/10/2569 · เจ้าของเคาะ 18/10/2569).
 *
 *   TOP_UP   Dr S11-1106 เงินสด - เงินสดย่อย / Cr ธนาคารหน้าร้านที่เลือก (ค่าเริ่มต้น S11-1202 จ่ายออก)
 *   RETURN   Dr ธนาคารหน้าร้านที่เลือก (ค่าเริ่มต้น S11-1201 รับเข้า) / Cr S11-1106
 *
 * ธนาคารต้นทาง/ปลายทางต้องเป็นบัญชีธนาคารใน `SUPPLIER_PAYMENT_ACCOUNTS` (S11-1201 / S11-1202) — ไม่รับ S11-1106 เอง
 * ด่านวงเงิน/ยอดคงเหลือ/วันที่อยู่ที่ `ShopPettyCashService` (template ลงตามที่สั่งอย่างเดียว · idempotent ด้วย idempotencyKey)
 */
export type ShopPettyCashJeKind = 'TOP_UP' | 'RETURN';

export interface ShopPettyCashInput {
  /** `petty-cash:<movementId>` */
  idempotencyKey: string;
  kind: ShopPettyCashJeKind;
  movementId: string;
  /** > 0 */
  amount: Decimal;
  /** S11-1202 / S11-1201 */
  bankAccountCode: string;
  postedAt?: Date;
  description?: string;
}

const FLOW = 'shop-petty-cash';
const TAG = 'SHOP_PETTY_CASH';

export const SHOP_PETTY_CASH_FLOW = FLOW;
export const SHOP_PETTY_CASH_TAG = TAG;

const KIND_LABEL: Record<ShopPettyCashJeKind, string> = {
  TOP_UP: 'เติมเงินสดย่อย',
  RETURN: 'คืนเงินสดย่อย',
};

@Injectable()
export class ShopPettyCashTemplate {
  private readonly logger = new Logger(ShopPettyCashTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly companyResolver: CompanyResolverService,
  ) {}

  async execute(
    input: ShopPettyCashInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; journalEntryId: string }> {
    const lines = this.buildLines(input);
    const bankLabel = SUPPLIER_PAYMENT_ACCOUNTS[input.bankAccountCode].label;
    const run = async (tx: Prisma.TransactionClient) => {
      const existing = await this.findExisting(tx, input.idempotencyKey);
      if (existing) return existing;
      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
      const result = await this.journal.createAndPost(
        {
          description:
            input.description ??
            (input.kind === 'TOP_UP'
              ? `${KIND_LABEL.TOP_UP}จาก ${bankLabel} ${input.bankAccountCode} (SHOP)`
              : `${KIND_LABEL.RETURN}เข้า ${bankLabel} ${input.bankAccountCode} (SHOP)`),
          reference: input.idempotencyKey,
          metadata: {
            tag: TAG,
            flow: FLOW,
            idempotencyKey: input.idempotencyKey,
            kind: input.kind,
            movementId: input.movementId,
            bankAccountCode: input.bankAccountCode,
            companyCode: 'SHOP',
            amount: new Decimal(input.amount.toString()).toFixed(2),
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

  private buildLines(input: ShopPettyCashInput): JeLineInput[] {
    const amount = new Decimal(input.amount.toString());
    if (!amount.isFinite() || amount.lte(0)) {
      throw new BadRequestException('ยอดเงินสดย่อยต้องมากกว่า 0');
    }
    if (!isBankSupplierPaymentAccount(input.bankAccountCode)) {
      throw new BadRequestException(
        `บัญชีธนาคารไม่ถูกต้อง — เลือกได้เฉพาะธนาคารหน้าร้าน (S11-1202 จ่ายออก / S11-1201 รับเข้า) ไม่ใช่ ${input.bankAccountCode}`,
      );
    }
    const zero = new Decimal(0);
    const petty: JeLineInput = {
      accountCode: SHOP_PETTY_CASH_ACCOUNT,
      dr: input.kind === 'TOP_UP' ? amount : zero,
      cr: input.kind === 'TOP_UP' ? zero : amount,
      description: `${KIND_LABEL[input.kind]} S11-1106`,
    };
    const bank: JeLineInput = {
      accountCode: input.bankAccountCode,
      dr: input.kind === 'RETURN' ? amount : zero,
      cr: input.kind === 'RETURN' ? zero : amount,
      description: `${KIND_LABEL[input.kind]} ${SUPPLIER_PAYMENT_ACCOUNTS[input.bankAccountCode].label}`,
    };
    return input.kind === 'TOP_UP' ? [petty, bank] : [bank, petty];
  }

  private async findExisting(tx: Prisma.TransactionClient, idempotencyKey: string) {
    const existing = await tx.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: FLOW } as any },
          { metadata: { path: ['idempotencyKey'], equals: idempotencyKey } as any },
        ],
        deletedAt: null,
      },
    });
    if (!existing) return null;
    this.logger.log(`ShopPettyCashTemplate idempotency — JE ${existing.entryNumber} for ${idempotencyKey}`);
    return { entryNo: existing.entryNumber, journalEntryId: existing.id };
  }
}
