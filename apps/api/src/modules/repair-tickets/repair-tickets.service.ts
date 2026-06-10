import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ExpenseDocumentsService } from '../expense-documents/expense-documents.service';
import { OtherIncomeService } from '../other-income/other-income.service';
import { SettingsService } from '../settings/settings.service';
import { RepairTicketDocNumberService } from './services/doc-number.service';
import { RepairTicketLifecycleService } from './services/repair-ticket-lifecycle.service';
import { RepairTicketQueryService } from './services/repair-ticket-query.service';
import { RepairWarrantyService } from './services/repair-warranty.service';
import { CreateRepairTicketDto } from './dto/create-repair-ticket.dto';
import { SendDto } from './dto/send.dto';
import { MarkRepairedDto } from './dto/mark-repaired.dto';
import { SendBackDto } from './dto/send-back.dto';
import { CancelDto } from './dto/cancel.dto';
import { ReplaceDto } from './dto/replace.dto';
import { ReturnToCustomerDto } from './dto/return-to-customer.dto';
import { UpdateRepairTicketDto } from './dto/update-repair-ticket.dto';
import { ListRepairTicketsDto } from './dto/list-repair-tickets.dto';
import { WarrantyPreviewDto } from './dto/warranty-preview.dto';
import { WarrantyLookupDto } from './dto/warranty-lookup.dto';

type ReqUser = { id: string; role: string; branchId?: string | null };

/**
 * Facade for the repair-ticket domain. Keeps the 14-method public surface +
 * the exact 6-dep constructor (settings is injected but unused — kept for
 * signature stability) and delegates to 3 internally-constructed sub-services:
 *   - RepairTicketLifecycleService — all writes + the 10 $transaction blocks
 *   - RepairTicketQueryService     — read-only branch-scoped list/detail
 *   - RepairWarrantyService        — warranty preview/lookup/IMEI lookup
 */
@Injectable()
export class RepairTicketsService {
  private readonly lifecycle: RepairTicketLifecycleService;
  private readonly query: RepairTicketQueryService;
  private readonly warranty: RepairWarrantyService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly expenseDocs: ExpenseDocumentsService,
    private readonly otherIncome: OtherIncomeService,
    private readonly settings: SettingsService,
    private readonly docNumber: RepairTicketDocNumberService,
  ) {
    this.lifecycle = new RepairTicketLifecycleService(
      this.prisma,
      this.audit,
      this.expenseDocs,
      this.otherIncome,
      this.docNumber,
    );
    this.query = new RepairTicketQueryService(this.prisma);
    this.warranty = new RepairWarrantyService(this.prisma, this.audit);
  }

  // ─── Lifecycle (writes) ────────────────────────────────────────────────────

  async create(dto: CreateRepairTicketDto, user: ReqUser) {
    return this.lifecycle.create(dto, user);
  }

  async send(id: string, dto: SendDto, user: ReqUser) {
    return this.lifecycle.send(id, dto, user);
  }

  async markRepaired(id: string, dto: MarkRepairedDto, user: ReqUser) {
    return this.lifecycle.markRepaired(id, dto, user);
  }

  async sendBack(id: string, dto: SendBackDto, user: ReqUser) {
    return this.lifecycle.sendBack(id, dto, user);
  }

  async cancel(id: string, dto: CancelDto, user: ReqUser) {
    return this.lifecycle.cancel(id, dto, user);
  }

  async replace(id: string, dto: ReplaceDto, user: ReqUser) {
    return this.lifecycle.replace(id, dto, user);
  }

  async returnToCustomer(id: string, dto: ReturnToCustomerDto, user: ReqUser) {
    return this.lifecycle.returnToCustomer(id, dto, user);
  }

  async update(id: string, dto: UpdateRepairTicketDto, user: ReqUser) {
    return this.lifecycle.update(id, dto, user);
  }

  async recalcWarranty(id: string, user: ReqUser) {
    return this.lifecycle.recalcWarranty(id, user);
  }

  async softDelete(id: string, user: ReqUser) {
    return this.lifecycle.softDelete(id, user);
  }

  /**
   * PUBLIC helper — also called by defect-exchange.service within its own
   * $transaction. The defaulted-tx signature is preserved so external callers
   * can thread their own tx unchanged.
   */
  async markReplaced(
    id: string,
    replacementContractId: string,
    user: ReqUser,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return this.lifecycle.markReplaced(id, replacementContractId, user, tx);
  }

  // ─── Query (read-only) ──────────────────────────────────────────────────────

  async findAll(dto: ListRepairTicketsDto, user: ReqUser) {
    return this.query.findAll(dto, user);
  }

  async findOne(id: string, user: ReqUser) {
    return this.query.findOne(id, user);
  }

  // ─── Warranty (read-only lookup/preview) ────────────────────────────────────

  async warrantyPreview(dto: WarrantyPreviewDto, user: ReqUser) {
    return this.warranty.warrantyPreview(dto, user);
  }

  async warrantyLookup(dto: WarrantyLookupDto, user: ReqUser) {
    return this.warranty.warrantyLookup(dto, user);
  }

  async lookupByImei(imei: string, user: ReqUser) {
    return this.warranty.lookupByImei(imei, user);
  }
}
