import { currentDomainAccess } from '../employee-access/access-execution-context';
import { permissionScopes } from '../employee-access/access-context';
import { ForbiddenException } from '@nestjs/common';
import { PermissionKey } from '@installment/shared';
import { AccessRepairSourceService } from '../employee-access/access-repair-source.service';
import { Injectable, Optional } from '@nestjs/common';
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
 * Facade for the repair-ticket domain. Keeps the public repair surface and
 * six legacy constructor dependencies plus optional access integration, and
 * delegates to three internally constructed sub-services. Managed calls fail
 * closed without the source service/current execution:
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
    @Optional() private readonly access?: AccessRepairSourceService,
  ) {
    this.lifecycle = new RepairTicketLifecycleService(
      this.prisma,
      this.audit,
      this.expenseDocs,
      this.otherIncome,
      this.docNumber,
      this.access,
    );
    this.query = new RepairTicketQueryService(this.prisma);
    this.warranty = new RepairWarrantyService(this.prisma, this.audit);
  }

  /** Service-to-service callers must join an owned current-authority execution.
   * A caller's after-sales grant never implies a repair grant. */
  private async authorize(
    method: string,
    user: ReqUser,
    id?: string,
    body: Record<string, unknown> = {},
  ) {
    const ctx = currentDomainAccess();
    if (!ctx) {
      if (
        (
          await this.prisma.user.findUnique({
            where: { id: user.id },
            select: { accessManaged: true },
          })
        )?.accessManaged
      )
        throw new ForbiddenException('ต้องตรวจสิทธิ์ปัจจุบันในธุรกรรมก่อนดำเนินการ');
      return;
    }
    if (!this.access || ctx.snapshot.userId !== user.id || ctx.scope.company !== 'SHOP')
      throw new ForbiddenException('แหล่งสิทธิ์งานซ่อมไม่ถูกต้อง');
    const permission: PermissionKey =
      method === 'create'
        ? 'repair-tickets.create'
        : method === 'replace'
          ? 'defect-exchanges.create'
          : ['findOne', 'findAll', 'warrantyPreview', 'warrantyLookup', 'lookupByImei'].includes(
                method,
              )
            ? 'repair-tickets.read'
            : 'repair-tickets.update';
    if (id || method === 'create')
      await this.access.resolve(ctx.client, ctx.snapshot, permission, method, id, body, true);
    else {
      if (
        !permissionScopes({ id: user.id, access: ctx.snapshot }, permission, 'SHOP').some(
          (t) => t.scope === 'COMPANY' || (t.scope === 'BRANCHES' && t.branchIds.length),
        )
      )
        throw new ForbiddenException('ไม่มีสิทธิ์อ่านงานซ่อม');
      if (body.customerId)
        await this.access.customer(ctx.client, ctx.snapshot, String(body.customerId));
      if (body.repairSupplierId)
        await this.access.supplier(ctx.client, ctx.snapshot, String(body.repairSupplierId));
      if (method === 'warrantyPreview')
        await this.access.warrantySelection(
          ctx.client,
          ctx.snapshot,
          { customerId: body.customerId, productId: body.productId, contractId: body.contractId },
          true,
        );
    }
  }

  // ─── Lifecycle (writes) ────────────────────────────────────────────────────

  async create(dto: CreateRepairTicketDto, user: ReqUser) {
    await this.authorize('create', user, undefined, { ...dto });
    return this.lifecycle.create(dto, user);
  }

  /**
   * PUBLIC helper — also called by AfterSalesCaseService within its own
   * $transaction so the repair ticket and the after-sales case are written
   * atomically in one commit. Does not open a tx and does not call audit
   * (per createInTx's own contract) — the caller's tx owns both.
   */
  async createInTx(dto: CreateRepairTicketDto, user: ReqUser, tx: Prisma.TransactionClient) {
    return this.lifecycle.createInTx(dto, user, tx);
  }

  async send(id: string, dto: SendDto, user: ReqUser) {
    await this.authorize('send', user, id, { ...dto });
    return this.lifecycle.send(id, dto, user);
  }

  async markRepaired(id: string, dto: MarkRepairedDto, user: ReqUser) {
    await this.authorize('markRepaired', user, id, { ...dto });
    return this.lifecycle.markRepaired(id, dto, user);
  }

  async sendBack(id: string, dto: SendBackDto, user: ReqUser) {
    await this.authorize('sendBack', user, id, { ...dto });
    return this.lifecycle.sendBack(id, dto, user);
  }

  async cancel(id: string, dto: CancelDto, user: ReqUser) {
    await this.authorize('cancel', user, id, { ...dto });
    return this.lifecycle.cancel(id, dto, user);
  }

  async replace(id: string, dto: ReplaceDto, user: ReqUser) {
    await this.authorize('replace', user, id, { ...dto });
    return this.lifecycle.replace(id, dto, user);
  }

  async returnToCustomer(id: string, dto: ReturnToCustomerDto, user: ReqUser) {
    await this.authorize('returnToCustomer', user, id, { ...dto });
    return this.lifecycle.returnToCustomer(id, dto, user);
  }

  async update(id: string, dto: UpdateRepairTicketDto, user: ReqUser) {
    await this.authorize('update', user, id, { ...dto });
    return this.lifecycle.update(id, dto, user);
  }

  async recalcWarranty(id: string, user: ReqUser) {
    await this.authorize('recalcWarranty', user, id);
    return this.lifecycle.recalcWarranty(id, user);
  }

  async softDelete(id: string, user: ReqUser) {
    await this.authorize('softDelete', user, id);
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
    await this.authorize('findAll', user, undefined, { ...dto });
    return this.query.findAll(dto, user);
  }

  async findOne(id: string, user: ReqUser) {
    await this.authorize('findOne', user, id);
    return this.query.findOne(id, user);
  }

  // ─── Warranty (read-only lookup/preview) ────────────────────────────────────

  async warrantyPreview(dto: WarrantyPreviewDto, user: ReqUser) {
    await this.authorize('warrantyPreview', user, undefined, { ...dto });
    return this.warranty.warrantyPreview(dto, user);
  }

  async warrantyLookup(dto: WarrantyLookupDto, user: ReqUser) {
    await this.authorize('warrantyLookup', user, undefined, { ...dto });
    return this.warranty.warrantyLookup(dto, user);
  }

  async lookupByImei(imei: string, user: ReqUser) {
    await this.authorize('lookupByImei', user);
    return this.warranty.lookupByImei(imei, user);
  }
}
