import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { ReceiptVoidReversalTemplate } from '../journal/cpa-templates/receipt-void-reversal.template';
import { ReceiptNumberService } from './services/receipt-number.service';
import { ReceiptIssuanceService } from './services/receipt-issuance.service';
import { ReceiptVoidService } from './services/receipt-void.service';
import { ReceiptQueryService } from './services/receipt-query.service';
import { ReceiptPdfService } from './services/receipt-pdf.service';

/**
 * Receipts facade. Preserves the original 8-method public surface + the 4-arg
 * constructor (signature compat for the positional-args test site +
 * the PaymentsService consumer + the NestJS module DI). Behavior is delegated
 * to internally-constructed sub-services:
 *   - ReceiptNumberService  — shared RT-YYYYMM-NNNNN sequencer (tx-aware)
 *   - ReceiptIssuanceService — generateReceipt ($tx, NO JE) + sendReceiptToCustomer
 *   - ReceiptVoidService     — voidReceipt ($tx, reversal JE core) — regulated
 *   - ReceiptQueryService    — read-only queries
 *   - ReceiptPdfService      — pure PDF rendering
 *
 * journalAutoService is injected for ctor-signature compatibility but is UNUSED
 * here — it is intentionally not wired into any sub-service.
 */
@Injectable()
export class ReceiptsService {
  private readonly numbers: ReceiptNumberService;
  private readonly issuance: ReceiptIssuanceService;
  private readonly void: ReceiptVoidService;
  private readonly query: ReceiptQueryService;
  private readonly pdf: ReceiptPdfService;

  constructor(
    private prisma: PrismaService,
    private journalAutoService: JournalAutoService,
    private receiptVoidReversalTemplate: ReceiptVoidReversalTemplate,
    @Inject(forwardRef(() => LineOaService))
    private lineOaService?: LineOaService,
  ) {
    this.numbers = new ReceiptNumberService(this.prisma);
    this.issuance = new ReceiptIssuanceService(this.prisma, this.lineOaService, this.numbers);
    this.void = new ReceiptVoidService(this.prisma, this.receiptVoidReversalTemplate, this.numbers);
    this.query = new ReceiptQueryService(this.prisma);
    this.pdf = new ReceiptPdfService(this.query);
  }

  /** Auto-generate e-Receipt after payment recording. */
  generateReceipt(
    contractId: string,
    paymentId: string | null,
    receiptType: string,
    amount: number,
    installmentNo: number | null,
    paymentMethod: string | null,
    transactionRef: string | null,
    issuedById: string,
    paidDate?: Date,
  ) {
    return this.issuance.generateReceipt(
      contractId,
      paymentId,
      receiptType,
      amount,
      installmentNo,
      paymentMethod,
      transactionRef,
      issuedById,
      paidDate,
    );
  }

  /** List receipts with search, filter, pagination */
  findAll(filters: {
    search?: string;
    receiptType?: string;
    dateFrom?: string;
    dateTo?: string;
    branchId?: string;
    page?: number;
    limit?: number;
  }) {
    return this.query.findAll(filters);
  }

  /** Get receipts for a contract */
  getContractReceipts(contractId: string, includeVoided = false) {
    return this.query.getContractReceipts(contractId, includeVoided);
  }

  /** Get a single receipt */
  getReceipt(id: string) {
    return this.query.getReceipt(id);
  }

  /** Get receipt by number */
  getReceiptByNumber(receiptNumber: string) {
    return this.query.getReceiptByNumber(receiptNumber);
  }

  /** Void a receipt (posts a reversal JE for each matched POSTED receipt JE) */
  voidReceipt(
    id: string,
    reason: string,
    issuedById: string,
    approvedById: string,
    userRole?: string,
  ) {
    return this.void.voidReceipt(id, reason, issuedById, approvedById, userRole);
  }

  /** Manually push the receipt to the customer's LINE OA. */
  sendReceiptToCustomer(id: string) {
    return this.issuance.sendReceiptToCustomer(id);
  }

  /** Generate the e-Receipt PDF using Puppeteer + the Thai tax-invoice layout. */
  generatePDF(id: string): Promise<Buffer> {
    return this.pdf.generatePDF(id);
  }
}
