import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyResolverService } from '../company-resolver.service';
import { ShopAccountResolver } from '../shop-account-resolver.service';

/**
 * SHOP — จ่ายเงินผู้จัดจำหน่าย / มัดจำ (ก้อน 2 · คำตัดสินเจ้าของ 2026-10-05 · คำตอบฝ่ายบัญชี 2026-09-30 ข้อ 9).
 * ทุกรายการติด `supplierId` ใน metadata — บัญชีย่อยเจ้าหนี้ตามผู้จัดจำหน่าย (คำตอบฝ่ายบัญชี 2026-10-05 ข้อ 1)
 * อ่านจาก metadata นี้ ไม่ต้องเพิ่มรหัสบัญชีในผัง
 *
 *   DEPOSIT          Dr S11-4201 เงินมัดจำจ่ายล่วงหน้า        / Cr S11-1202 ธนาคารหน้าร้าน (จ่ายออก)
 *   SETTLEMENT       Dr S21-1101 / S21-1102 เจ้าหนี้ (ตามที่ปัน) / Cr S11-1202
 *   DEPOSIT_APPLIED  Dr S21-1101 / S21-1102                    / Cr S11-4201   (หักมัดจำเข้าเจ้าหนี้ตอนรับของ — อัตโนมัติ)
 *   DEPOSIT_REFUND   Dr S11-1201 ธนาคารรับเข้า (ส่วนที่ได้คืน) + Dr S53-1105 (ส่วนที่ได้คืนไม่ครบ) / Cr S11-4201
 *   DEPOSIT_FORFEIT  Dr S53-1105 ค่าใช้จ่าย - มัดจำที่ไม่ได้คืน  / Cr S11-4201
 *
 * เงินสดไม่มีในเมนูนี้ (เจ้าของ: โอนธนาคารเท่านั้น) — บัญชีธนาคารที่รับได้จึงมีแค่ S11-1201 / S11-1202.
 * `reverse()` = ยกเลิกรายการที่บันทึกผิด: กลับทุกบรรทัดของ JE เดิม ลงวันที่ที่กดยกเลิก (ข้อสมมติ ง)
 */
export type SupplierPaymentJeKind = 'DEPOSIT' | 'SETTLEMENT' | 'DEPOSIT_APPLIED' | 'DEPOSIT_REFUND' | 'DEPOSIT_FORFEIT';

export interface ShopSupplierPaymentInput {
  /** `po-payment:<paymentId>` */
  idempotencyKey: string;
  kind: SupplierPaymentJeKind;
  poId: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  paymentId: string;
  /** ยอดรวมของรายการ (> 0) */
  amount: Decimal;
  /** SETTLEMENT / DEPOSIT_APPLIED — บรรทัดเจ้าหนี้ที่ปันแล้ว (S21-1101 / S21-1102) รวมต้องเท่า amount */
  payableLines?: { accountCode: string; amount: Decimal }[];
  /** DEPOSIT / SETTLEMENT = S11-1202 · DEPOSIT_REFUND = S11-1201 · อื่นไม่ใช้ */
  bankAccountCode?: string;
  /** DEPOSIT_REFUND — ส่วนที่ได้คืนไม่ครบ (ลง S53-1105) · 0/ไม่ส่ง = ได้คืนครบ */
  shortfall?: Decimal;
  /** DEPOSIT_APPLIED — ใบรับของที่ทำให้เกิดเจ้าหนี้ */
  receivingId?: string;
  grNumber?: string;
  description?: string;
  postedAt?: Date;
}

export interface ShopSupplierPaymentReverseInput {
  journalEntryId: string;
  /** `po-payment-void:<paymentId>` */
  idempotencyKey: string;
  reason: string;
  postedAt?: Date;
}

const FLOW = 'shop-supplier-payment';
const TAG = 'SHOP_SUPPLIER_PAYMENT';
const REVERSAL_TAG = 'SHOP_SUPPLIER_PAYMENT_REVERSAL';

export const SUPPLIER_DEPOSIT_ACCOUNT = 'S11-4201';
export const SUPPLIER_DEPOSIT_FORFEIT_ACCOUNT = 'S53-1105';

const PAYABLE_ACCOUNTS: Record<string, string> = {
  'S21-1101': 'เจ้าหนี้ - ซัพพลายเออร์มือถือ',
  'S21-1102': 'เจ้าหนี้ - อุปกรณ์เสริม',
};
const BANK_ACCOUNTS: Record<string, string> = {
  [ShopAccountResolver.SHOP_RECEIVING_BANK]: 'ธนาคารหน้าร้าน (รับเข้า)',
  [ShopAccountResolver.SHOP_PAYING_BANK]: 'ธนาคารหน้าร้าน (จ่ายออก)',
};
const KIND_LABEL: Record<SupplierPaymentJeKind, string> = {
  DEPOSIT: 'มัดจำผู้จัดจำหน่าย',
  SETTLEMENT: 'ชำระค่าสินค้าผู้จัดจำหน่าย',
  DEPOSIT_APPLIED: 'หักมัดจำเข้าเจ้าหนี้ผู้จัดจำหน่าย',
  DEPOSIT_REFUND: 'รับเงินมัดจำคืนจากผู้จัดจำหน่าย (ยกเลิกใบสั่งซื้อ)',
  DEPOSIT_FORFEIT: 'มัดจำผู้จัดจำหน่ายไม่ได้คืน (ยกเลิกใบสั่งซื้อ)',
};

@Injectable()
export class ShopSupplierPaymentTemplate {
  private readonly logger = new Logger(ShopSupplierPaymentTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly companyResolver: CompanyResolverService,
  ) {}

  async execute(
    input: ShopSupplierPaymentInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; journalEntryId: string }> {
    const lines = this.buildLines(input);
    const run = async (tx: Prisma.TransactionClient) => {
      const existing = await this.findExisting(tx, input.idempotencyKey);
      if (existing) return existing;
      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
      const result = await this.journal.createAndPost(
        {
          description:
            input.description ??
            `${KIND_LABEL[input.kind]} ${input.supplierName} ใบสั่งซื้อ ${input.poNumber}` +
              (input.grNumber ? ` · ${input.grNumber}` : '') +
              ' (SHOP)',
          reference: `po:${input.poId}:payment:${input.paymentId}`,
          metadata: {
            tag: TAG,
            flow: FLOW,
            idempotencyKey: input.idempotencyKey,
            kind: input.kind,
            poId: input.poId,
            poNumber: input.poNumber,
            supplierId: input.supplierId,
            supplierName: input.supplierName,
            paymentId: input.paymentId,
            bankAccountCode: input.bankAccountCode ?? null,
            companyCode: 'SHOP',
            amount: new Decimal(input.amount.toString()).toFixed(2),
            ...(input.receivingId ? { receivingId: input.receivingId, grNumber: input.grNumber ?? null } : {}),
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

  /** ยกเลิกรายการที่บันทึกผิด — กลับทุกบรรทัดของ JE เดิม (สลับ Dr/Cr) ลงวันที่ที่กดยกเลิก */
  async reverse(
    input: ShopSupplierPaymentReverseInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; journalEntryId: string }> {
    const run = async (tx: Prisma.TransactionClient) => {
      const existing = await this.findExisting(tx, input.idempotencyKey);
      if (existing) return existing;
      const original = await tx.journalEntry.findUnique({
        where: { id: input.journalEntryId },
        include: { lines: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } } },
      });
      const meta = (original?.metadata ?? null) as Record<string, unknown> | null;
      if (!original || !meta || meta.tag !== TAG) {
        throw new BadRequestException('ไม่พบรายการบัญชีของการจ่ายเงินผู้จัดจำหน่ายที่จะกลับรายการ');
      }
      if (original.lines.length === 0) {
        throw new BadRequestException(`รายการบัญชี ${original.entryNumber} ไม่มีบรรทัดให้กลับรายการ`);
      }
      const lines: JeLineInput[] = original.lines.map((line) => ({
        accountCode: line.accountCode,
        dr: new Decimal(line.credit.toString()),
        cr: new Decimal(line.debit.toString()),
        description: `กลับรายการ ${line.description ?? line.accountCode}`,
      }));
      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
      const result = await this.journal.createAndPost(
        {
          description: `ยกเลิกรายการจ่ายเงินผู้จัดจำหน่าย ${original.entryNumber} — ${input.reason} (SHOP)`,
          reference: `po:${String(meta.poId)}:payment:${String(meta.paymentId)}:void`,
          metadata: {
            tag: REVERSAL_TAG,
            flow: FLOW,
            idempotencyKey: input.idempotencyKey,
            reversesEntryId: original.id,
            reversesEntryNo: original.entryNumber,
            reason: input.reason,
            kind: meta.kind ?? null,
            poId: meta.poId ?? null,
            poNumber: meta.poNumber ?? null,
            supplierId: meta.supplierId ?? null,
            supplierName: meta.supplierName ?? null,
            paymentId: meta.paymentId ?? null,
            bankAccountCode: meta.bankAccountCode ?? null,
            companyCode: 'SHOP',
            amount: meta.amount ?? null,
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
    this.logger.log(`ShopSupplierPaymentTemplate idempotency — JE ${existing.entryNumber} for ${idempotencyKey}`);
    return { entryNo: existing.entryNumber, journalEntryId: existing.id };
  }

  private buildLines(input: ShopSupplierPaymentInput): JeLineInput[] {
    const zero = new Decimal(0);
    const amount = new Decimal(input.amount.toString());
    if (!amount.gt(zero)) {
      throw new BadRequestException(`ShopSupplierPayment: amount must be > 0; got ${amount.toFixed(2)}`);
    }
    const bank = (code: string | undefined) => {
      if (!code || !(code in BANK_ACCOUNTS)) {
        throw new BadRequestException(
          `ShopSupplierPayment: bankAccountCode must be ${ShopAccountResolver.SHOP_RECEIVING_BANK} or ${ShopAccountResolver.SHOP_PAYING_BANK}; got ${code ?? 'none'}`,
        );
      }
      return code;
    };
    const payable = (): JeLineInput[] => {
      const rows = input.payableLines ?? [];
      if (rows.length === 0) throw new BadRequestException('ShopSupplierPayment: payableLines required');
      let total = zero;
      const out = rows.map((row) => {
        if (!(row.accountCode in PAYABLE_ACCOUNTS)) {
          throw new BadRequestException(`ShopSupplierPayment: payable account must be S21-1101 or S21-1102; got ${row.accountCode}`);
        }
        const value = new Decimal(row.amount.toString());
        if (!value.gt(zero)) throw new BadRequestException('ShopSupplierPayment: payable line must be > 0');
        total = total.add(value);
        return { accountCode: row.accountCode, dr: value, cr: zero, description: PAYABLE_ACCOUNTS[row.accountCode] };
      });
      if (!total.equals(amount)) {
        throw new BadRequestException(
          `ShopSupplierPayment: payable lines ${total.toFixed(2)} must equal amount ${amount.toFixed(2)}`,
        );
      }
      return out;
    };

    switch (input.kind) {
      case 'DEPOSIT': {
        const code = bank(input.bankAccountCode);
        return [
          { accountCode: SUPPLIER_DEPOSIT_ACCOUNT, dr: amount, cr: zero, description: 'มัดจำจ่ายล่วงหน้าผู้จัดจำหน่าย' },
          { accountCode: code, dr: zero, cr: amount, description: BANK_ACCOUNTS[code] },
        ];
      }
      case 'SETTLEMENT': {
        const code = bank(input.bankAccountCode);
        return [...payable(), { accountCode: code, dr: zero, cr: amount, description: BANK_ACCOUNTS[code] }];
      }
      case 'DEPOSIT_APPLIED':
        return [...payable(), { accountCode: SUPPLIER_DEPOSIT_ACCOUNT, dr: zero, cr: amount, description: 'หักมัดจำเข้าเจ้าหนี้' }];
      case 'DEPOSIT_REFUND': {
        const code = bank(input.bankAccountCode);
        const shortfall = new Decimal((input.shortfall ?? zero).toString());
        if (shortfall.lt(zero) || shortfall.gt(amount)) {
          throw new BadRequestException(`ShopSupplierPayment: shortfall must be between 0 and ${amount.toFixed(2)}`);
        }
        const refunded = amount.sub(shortfall);
        const lines: JeLineInput[] = [];
        if (refunded.gt(zero)) lines.push({ accountCode: code, dr: refunded, cr: zero, description: 'รับเงินมัดจำคืน' });
        if (shortfall.gt(zero)) {
          lines.push({ accountCode: SUPPLIER_DEPOSIT_FORFEIT_ACCOUNT, dr: shortfall, cr: zero, description: 'มัดจำที่ได้คืนไม่ครบ' });
        }
        lines.push({ accountCode: SUPPLIER_DEPOSIT_ACCOUNT, dr: zero, cr: amount, description: 'ล้างมัดจำจ่ายล่วงหน้า' });
        return lines;
      }
      case 'DEPOSIT_FORFEIT':
        return [
          { accountCode: SUPPLIER_DEPOSIT_FORFEIT_ACCOUNT, dr: amount, cr: zero, description: 'มัดจำที่ไม่ได้คืน' },
          { accountCode: SUPPLIER_DEPOSIT_ACCOUNT, dr: zero, cr: amount, description: 'ล้างมัดจำจ่ายล่วงหน้า' },
        ];
      default:
        throw new BadRequestException(`ShopSupplierPayment: unknown kind ${String(input.kind)}`);
    }
  }
}
