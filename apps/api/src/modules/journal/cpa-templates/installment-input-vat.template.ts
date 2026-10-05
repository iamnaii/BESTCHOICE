import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyResolverService } from '../company-resolver.service';
import { invoiceAgeMonths } from '../input-vat/input-vat-eligibility';
import { bangkokDateString } from '../../../utils/date.util';

/**
 * FINANCE — ภาษีซื้อของเครื่องที่ขายผ่อน (ก้อน 5 · ฝ่ายบัญชี 05/10/2569 ข้อ 2.4 แบบ ก · เจ้าของเคาะ 42-1108)
 *
 *   Dr 11-4101 ภาษีซื้อ                                   [receivedVat ของเครื่องหลัก]
 *      Cr 42-1108 รายได้อื่น-ภาษีซื้อของสินค้าที่ขายผ่อน   [receivedVat]
 *
 * - ลง**วันเปิดสัญญา** (postedAt เดียวกับ 1A) · ใบกำกับมาทีหลัง: ลงวันเปิดสัญญาเช่นกัน เว้นงวดเดือนนั้นปิด → วันนี้ + `postedOnInvoiceDate`
 * - stamp `metadata.contractId` ให้ตัวกวาดยกเลิกสัญญา (`ContractCancellationTemplate` / `ExchangeCancelReversalTemplate`)
 *   กระจกให้เอง — template นี้จึง**ไม่มี reverse()** · ห้าม stamp saleId / shopReceivableType / paymentId / installmentScheduleId
 * - ไม่ตรวจงวดบัญชีเอง — ด่านเดียวกับ 1A (1A ลงได้ ภาษีซื้อก็ลงได้); เส้นทางเคลมย้อนตรวจงวดก่อนเรียก (claim.ts)
 * - ไม่มีด่านอายุใบกำกับ (ฝ่ายบัญชียืนยัน 2 ครั้ง) — เก็บ `invoiceAgeMonths` ไว้แสดง/เตือนเท่านั้น
 */
export const INSTALLMENT_INPUT_VAT_FLOW = 'finance-input-vat-installment';
export const INSTALLMENT_INPUT_VAT_TAG = 'INSTALLMENT_INPUT_VAT';
export const INPUT_VAT_ACCOUNT = '11-4101';
export const INSTALLMENT_INPUT_VAT_INCOME_ACCOUNT = '42-1108';

export const installmentInputVatKey = (contractId: string): string => `input-vat:${contractId}`;

export interface InstallmentInputVatInput {
  contractId: string;
  contractNumber: string;
  productId: string;
  receivingId: string;
  grNumber: string;
  /** receivedVat ของเครื่องหลัก (> 0) */
  amount: Decimal;
  taxInvoiceNumber: string;
  taxInvoiceDate: Date;
  /** วันเปิดสัญญา (หรือวันนี้เมื่องวดเดือนเปิดสัญญาปิดแล้ว) */
  postedAt: Date;
  postedOnInvoiceDate?: boolean;
}

@Injectable()
export class InstallmentInputVatTemplate {
  private readonly logger = new Logger(InstallmentInputVatTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly companyResolver: CompanyResolverService,
  ) {}

  async execute(
    input: InstallmentInputVatInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; journalEntryId: string }> {
    const lines = this.buildLines(input);
    const key = installmentInputVatKey(input.contractId);
    const run = async (tx: Prisma.TransactionClient) => {
      const existing = await tx.journalEntry.findFirst({
        where: {
          AND: [
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { metadata: { path: ['flow'], equals: INSTALLMENT_INPUT_VAT_FLOW } as any },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { metadata: { path: ['idempotencyKey'], equals: key } as any },
          ],
          deletedAt: null,
        },
      });
      if (existing) {
        this.logger.log(`InstallmentInputVatTemplate idempotency — JE ${existing.entryNumber} for ${key}`);
        return { entryNo: existing.entryNumber, journalEntryId: existing.id };
      }
      const financeCompanyId = await this.companyResolver.getFinanceCompanyId(tx);
      const result = await this.journal.createAndPost(
        {
          description: `ภาษีซื้อเครื่องขายผ่อน สัญญา ${input.contractNumber} · ใบกำกับ ${input.taxInvoiceNumber} (FINANCE)`,
          reference: key,
          metadata: {
            tag: INSTALLMENT_INPUT_VAT_TAG,
            flow: INSTALLMENT_INPUT_VAT_FLOW,
            idempotencyKey: key,
            contractId: input.contractId,
            contractNumber: input.contractNumber,
            productId: input.productId,
            receivingId: input.receivingId,
            grNumber: input.grNumber,
            taxInvoiceNumber: input.taxInvoiceNumber,
            taxInvoiceDate: bangkokDateString(input.taxInvoiceDate),
            invoiceAgeMonths: invoiceAgeMonths(input.taxInvoiceDate, input.postedAt),
            companyCode: 'FINANCE',
            amount: new Decimal(input.amount.toString()).toFixed(2),
            ...(input.postedOnInvoiceDate ? { postedOnInvoiceDate: true } : {}),
          },
          postedAt: input.postedAt,
          companyId: financeCompanyId,
          lines,
        },
        tx,
      );
      return { entryNo: result.entryNumber, journalEntryId: result.id };
    };
    return outerTx ? run(outerTx) : this.prisma.$transaction(run);
  }

  private buildLines(input: InstallmentInputVatInput): JeLineInput[] {
    const amount = new Decimal(input.amount.toString());
    if (!amount.gt(0)) {
      throw new BadRequestException(`InstallmentInputVat: amount must be > 0; got ${amount.toFixed(2)}`);
    }
    const zero = new Decimal(0);
    return [
      { accountCode: INPUT_VAT_ACCOUNT, dr: amount, cr: zero, description: `ภาษีซื้อ — ใบกำกับ ${input.taxInvoiceNumber}` },
      { accountCode: INSTALLMENT_INPUT_VAT_INCOME_ACCOUNT, dr: zero, cr: amount, description: 'รายได้อื่น-ภาษีซื้อของสินค้าที่ขายผ่อน' },
    ];
  }
}
