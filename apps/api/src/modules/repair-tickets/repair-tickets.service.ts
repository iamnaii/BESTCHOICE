import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ExpenseDocumentsService } from '../expense-documents/expense-documents.service';
import { OtherIncomeService } from '../other-income/other-income.service';
import { SettingsService } from '../settings/settings.service';
import { RepairTicketDocNumberService } from './services/doc-number.service';
import { detectWarrantyStatus, defaultPayer } from './utils/detect-warranty-status';
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
import { hasCrossBranchAccess } from '../auth/branch-access.util';
import { formatDevice } from './utils/format-device';

/** SystemConfig key — CoA code for repair income when payer=CUSTOMER. Default: S42-1101 */
const REPAIR_INCOME_ACCOUNT_CODE_KEY = 'REPAIR_INCOME_ACCOUNT_CODE';
const REPAIR_INCOME_ACCOUNT_CODE_DEFAULT = 'S42-1101';
/** SystemConfig key — CoA expense code for repair cost when payer=SHOP. Default: S51-1105 */
const REPAIR_EXPENSE_ACCOUNT_CODE_KEY = 'REPAIR_EXPENSE_ACCOUNT_CODE';
const REPAIR_EXPENSE_ACCOUNT_CODE_DEFAULT = 'S51-1105';

type ReqUser = { id: string; role: string; branchId?: string | null };

@Injectable()
export class RepairTicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly expenseDocs: ExpenseDocumentsService,
    private readonly otherIncome: OtherIncomeService,
    private readonly settings: SettingsService,
    private readonly docNumber: RepairTicketDocNumberService,
  ) {}

  async create(dto: CreateRepairTicketDto, user: ReqUser) {
    return this.prisma.$transaction(async (tx) => {
      // Validate contract exists when contractId is provided
      const contract = dto.contractId
        ? await tx.contract.findUnique({
            where: { id: dto.contractId, deletedAt: null },
            select: { id: true, deviceReceivedAt: true, shopWarrantyEndDate: true },
          })
        : null;
      if (dto.contractId && !contract) throw new NotFoundException('ไม่พบสัญญา');

      // Validate product exists when productId is provided
      const product = dto.productId
        ? await tx.product.findUnique({
            where: { id: dto.productId, deletedAt: null },
            select: { id: true, warrantyExpireDate: true },
          })
        : null;
      if (dto.productId && !product) throw new NotFoundException('ไม่พบสินค้า');

      // Auto-detect warranty status and default payer
      const warrantyStatus = detectWarrantyStatus({ contract, product });
      const payer = dto.payer ?? defaultPayer(warrantyStatus);

      // Generate ticket number (advisory-locked per BKK-day, RT-YYYYMMDD-NNNN)
      const ticketNumber = await this.docNumber.nextTicketNumber(tx as Prisma.TransactionClient);

      const ticket = await tx.repairTicket.create({
        data: {
          ticketNumber,
          status: 'OPEN',
          customerId: dto.customerId,
          contractId: dto.contractId ?? null,
          productId: dto.productId ?? null,
          deviceBrand: dto.deviceBrand ?? null,
          deviceModel: dto.deviceModel ?? null,
          deviceImei: dto.deviceImei ?? null,
          deviceSerial: dto.deviceSerial ?? null,
          defectDescription: dto.defectDescription,
          warrantyStatus,
          repairSupplierId: dto.repairSupplierId ?? null,
          estimatedCost:
            dto.estimatedCost != null ? new Prisma.Decimal(dto.estimatedCost) : null,
          payer,
          notes: dto.notes ?? null,
          branchId: dto.branchId,
          createdById: user.id,
        },
      });

      // Initial status log entry
      await tx.repairStatusLog.create({
        data: {
          ticketId: ticket.id,
          fromStatus: 'OPEN',
          toStatus: 'OPEN',
          changedById: user.id,
          note: 'รับเครื่องเข้า',
        },
      });

      // Audit trail
      await this.audit.log({
        userId: user.id,
        action: 'REPAIR_TICKET_CREATED',
        entity: 'repair_ticket',
        entityId: ticket.id,
        newValue: { ticketNumber, warrantyStatus, payer },
      });

      return ticket;
    });
  }

  // ─── State Machine Transitions ────────────────────────────────────────────

  /** OPEN → IN_PROGRESS: send device to repair center */
  async send(id: string, dto: SendDto, user: ReqUser) {
    return this.prisma.$transaction(async (tx) => {
      // Pre-validate supplier
      const supplier = await tx.supplier.findUnique({
        where: { id: dto.repairSupplierId, deletedAt: null },
      });
      if (!supplier) throw new NotFoundException('ไม่พบศูนย์ซ่อม');
      if (supplier.isRepairCenter === false)
        throw new BadRequestException('Supplier ไม่ใช่ศูนย์ซ่อม');

      const sentAt = dto.sentToRepairAt ? new Date(dto.sentToRepairAt) : new Date();

      const updated = await tx.repairTicket.updateMany({
        where: { id, status: 'OPEN', deletedAt: null },
        data: {
          status: 'IN_PROGRESS',
          sentToRepairAt: sentAt,
          repairSupplierId: dto.repairSupplierId,
          externalClaimNo: dto.externalClaimNo ?? null,
          estimatedCost:
            dto.estimatedCost != null ? new Prisma.Decimal(dto.estimatedCost) : undefined,
        },
      });
      if (updated.count === 0) throw new ConflictException('สถานะถูกเปลี่ยนไปแล้ว (ต้องเป็น OPEN)');

      await tx.repairStatusLog.create({
        data: {
          ticketId: id,
          fromStatus: 'OPEN',
          toStatus: 'IN_PROGRESS',
          changedById: user.id,
          note: dto.externalClaimNo ?? null,
        },
      });

      await this.audit.log({
        userId: user.id,
        action: 'REPAIR_TICKET_SENT',
        entity: 'repair_ticket',
        entityId: id,
        newValue: {
          repairSupplierId: dto.repairSupplierId,
          externalClaimNo: dto.externalClaimNo,
          estimatedCost: dto.estimatedCost,
        },
      });

      return tx.repairTicket.findUnique({ where: { id } });
    });
  }

  /** IN_PROGRESS → READY_FOR_PICKUP: repair center has fixed the device */
  async markRepaired(id: string, dto: MarkRepairedDto, user: ReqUser) {
    return this.prisma.$transaction(async (tx) => {
      const repairedAt = dto.repairedAt ? new Date(dto.repairedAt) : new Date();

      const updated = await tx.repairTicket.updateMany({
        where: { id, status: 'IN_PROGRESS', deletedAt: null },
        data: {
          status: 'READY_FOR_PICKUP',
          repairedAt,
          actualCost: new Prisma.Decimal(dto.actualCost),
          payer: dto.payer,
        },
      });
      if (updated.count === 0)
        throw new ConflictException('สถานะถูกเปลี่ยนไปแล้ว (ต้องเป็น IN_PROGRESS)');

      await tx.repairStatusLog.create({
        data: {
          ticketId: id,
          fromStatus: 'IN_PROGRESS',
          toStatus: 'READY_FOR_PICKUP',
          changedById: user.id,
        },
      });

      await this.audit.log({
        userId: user.id,
        action: 'REPAIR_TICKET_MARKED_REPAIRED',
        entity: 'repair_ticket',
        entityId: id,
        newValue: { actualCost: dto.actualCost, payer: dto.payer },
      });

      return tx.repairTicket.findUnique({ where: { id } });
    });
  }

  /** READY_FOR_PICKUP → IN_PROGRESS: QC fail — send back for rework */
  async sendBack(id: string, dto: SendBackDto, user: ReqUser) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.repairTicket.updateMany({
        where: { id, status: 'READY_FOR_PICKUP', deletedAt: null },
        data: { status: 'IN_PROGRESS', repairedAt: null },
      });
      if (updated.count === 0)
        throw new ConflictException('สถานะถูกเปลี่ยนไปแล้ว (ต้องเป็น READY_FOR_PICKUP)');

      await tx.repairStatusLog.create({
        data: {
          ticketId: id,
          fromStatus: 'READY_FOR_PICKUP',
          toStatus: 'IN_PROGRESS',
          changedById: user.id,
          note: dto.note,
        },
      });

      await this.audit.log({
        userId: user.id,
        action: 'REPAIR_TICKET_SENT_BACK',
        entity: 'repair_ticket',
        entityId: id,
        newValue: { note: dto.note },
      });

      return tx.repairTicket.findUnique({ where: { id } });
    });
  }

  /** OPEN|IN_PROGRESS|READY_FOR_PICKUP → CANCELLED */
  async cancel(id: string, dto: CancelDto, user: ReqUser) {
    return this.prisma.$transaction(async (tx) => {
      // Read current status first for accurate status log
      const ticket = await tx.repairTicket.findUnique({
        where: { id, deletedAt: null },
        select: { status: true },
      });
      if (!ticket) throw new NotFoundException('ไม่พบ ticket');

      const fromStatus = ticket.status;

      const updated = await tx.repairTicket.updateMany({
        where: {
          id,
          status: { in: ['OPEN', 'IN_PROGRESS', 'READY_FOR_PICKUP'] },
          deletedAt: null,
        },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      if (updated.count === 0)
        throw new ConflictException(
          'สถานะถูกเปลี่ยนไปแล้ว (ต้องเป็น OPEN/IN_PROGRESS/READY_FOR_PICKUP)',
        );

      await tx.repairStatusLog.create({
        data: {
          ticketId: id,
          fromStatus,
          toStatus: 'CANCELLED',
          changedById: user.id,
          note: dto.note,
        },
      });

      await this.audit.log({
        userId: user.id,
        action: 'REPAIR_TICKET_CANCELLED',
        entity: 'repair_ticket',
        entityId: id,
        newValue: { note: dto.note },
      });

      return tx.repairTicket.findUnique({ where: { id } });
    });
  }

  /** OPEN|IN_PROGRESS|READY_FOR_PICKUP → REPLACED (validates customer match) */
  async replace(id: string, dto: ReplaceDto, user: ReqUser) {
    return this.prisma.$transaction(async (tx) => {
      const ticket = await tx.repairTicket.findUnique({ where: { id, deletedAt: null } });
      if (!ticket) throw new NotFoundException('ไม่พบ ticket');

      const contract = await tx.contract.findUnique({
        where: { id: dto.replacementContractId, deletedAt: null },
      });
      if (!contract) throw new NotFoundException('ไม่พบ replacement contract');

      if (contract.customerId !== ticket.customerId) {
        throw new ForbiddenException('customer ของ replacement contract ไม่ตรงกับ ticket');
      }

      return this.markReplaced(id, dto.replacementContractId, user, tx);
    });
  }

  // ─── READY_FOR_PICKUP → CLOSED ─────────────────────────────────────────────

  /**
   * Customer picks up device. Transitions READY_FOR_PICKUP → CLOSED.
   *
   * Cross-module atomic auto-document creation (all inside one $transaction):
   *   - payer=SHOP        → creates DRAFT ExpenseDocument (REPAIR_SERVICE type)
   *                         linked to repair supplier; accountant posts later.
   *   - payer=CUSTOMER    → creates DRAFT OtherIncome linked to customer;
   *                         accountant posts + collects payment separately.
   *   - payer=SUPPLIER_CLAIM → no doc created (supplier handles billing externally).
   *
   * The FK pointers (expenseDocumentId / otherIncomeId) on RepairTicket are
   * @unique, so a second call after CLOSED will hit the CAS guard (count === 0)
   * long before it can create a duplicate document.
   */
  async returnToCustomer(id: string, dto: ReturnToCustomerDto, user: ReqUser) {
    return this.prisma.$transaction(async (tx) => {
      const returnedAt = dto.returnedToCustomerAt ? new Date(dto.returnedToCustomerAt) : new Date();

      // 1. CAS guard — atomically flip READY_FOR_PICKUP → CLOSED
      const updated = await tx.repairTicket.updateMany({
        where: { id, status: 'READY_FOR_PICKUP', deletedAt: null },
        data: { status: 'CLOSED', returnedToCustomerAt: returnedAt },
      });
      if (updated.count === 0) {
        throw new ConflictException('สถานะถูกเปลี่ยนไปแล้ว (ต้องเป็น READY_FOR_PICKUP)');
      }

      // 2. Load ticket with relations needed for doc creation
      const ticket = await tx.repairTicket.findUnique({
        where: { id },
        include: {
          customer: { select: { id: true, name: true } },
          product: { select: { brand: true, model: true, storage: true } },
          contract: { select: { product: { select: { brand: true, model: true, storage: true } } } },
        },
      });
      if (!ticket) throw new NotFoundException('ไม่พบ ticket');

      const deviceLabel = formatDevice(ticket);

      // 3. Auto-create draft doc based on payer
      let expenseDocumentId: string | null = null;
      let otherIncomeId: string | null = null;

      // W10: Prisma.Decimal(0) is truthy — use .gt(0) to avoid creating $0 drafts.
      if (
        ticket.payer === 'SHOP' &&
        ticket.actualCost &&
        new Prisma.Decimal(ticket.actualCost).gt(0) &&
        ticket.repairSupplierId
      ) {
        // Look up expense account code from SystemConfig (inside tx for consistency)
        const accountCode =
          (await tx.systemConfig
            .findFirst({ where: { key: REPAIR_EXPENSE_ACCOUNT_CODE_KEY, deletedAt: null } })
            .then((r) => r?.value ?? REPAIR_EXPENSE_ACCOUNT_CODE_DEFAULT)) ??
          REPAIR_EXPENSE_ACCOUNT_CODE_DEFAULT;

        // Fetch supplier name for the expense doc vendorName field
        const supplier = await tx.supplier.findUnique({
          where: { id: ticket.repairSupplierId },
          select: { name: true },
        });

        const doc = await this.expenseDocs.createDraftForRepair(
          {
            vendorName: supplier?.name ?? ticket.repairSupplierId,
            vendorSupplierId: ticket.repairSupplierId,
            // actualCost is Prisma.Decimal from DB — passed through unchanged (no Number() drift).
            amount: ticket.actualCost,
            accountCode,
            description: `ค่าซ่อม ${deviceLabel}: ${ticket.defectDescription.slice(0, 60)}`,
            branchId: ticket.branchId,
            createdById: user.id,
            metadata: { flow: 'repair-ticket-close', repairTicketId: ticket.id },
          },
          tx,
        );
        expenseDocumentId = doc.id;
      } else if (
        ticket.payer === 'CUSTOMER' &&
        ticket.actualCost &&
        new Prisma.Decimal(ticket.actualCost).gt(0)
      ) {
        const accountCode =
          (await tx.systemConfig
            .findFirst({ where: { key: REPAIR_INCOME_ACCOUNT_CODE_KEY, deletedAt: null } })
            .then((r) => r?.value ?? REPAIR_INCOME_ACCOUNT_CODE_DEFAULT)) ??
          REPAIR_INCOME_ACCOUNT_CODE_DEFAULT;

        const oi = await this.otherIncome.createDraftForRepair(
          {
            accountCode,
            counterpartyName: ticket.customer.name,
            customerId: ticket.customerId,
            amount: ticket.actualCost,
            description: `ค่าบริการซ่อม ${deviceLabel}`,
            receivedAt: returnedAt,
            branchId: ticket.branchId,
            createdById: user.id,
            metadata: { flow: 'repair-ticket-close', repairTicketId: ticket.id },
          },
          tx,
        );
        otherIncomeId = oi.id;
      }
      // payer === 'SUPPLIER_CLAIM' → no doc; supplier bills externally

      // 4. Link doc FKs back to ticket (only when a doc was created)
      if (expenseDocumentId !== null || otherIncomeId !== null) {
        await tx.repairTicket.update({
          where: { id },
          data: {
            expenseDocumentId: expenseDocumentId ?? null,
            otherIncomeId: otherIncomeId ?? null,
          },
        });
      }

      // 5. Status log
      await tx.repairStatusLog.create({
        data: {
          ticketId: id,
          fromStatus: 'READY_FOR_PICKUP',
          toStatus: 'CLOSED',
          changedById: user.id,
        },
      });

      // 6. Audit log
      await this.audit.log({
        userId: user.id,
        action: 'REPAIR_TICKET_RETURNED',
        entity: 'repair_ticket',
        entityId: id,
        newValue: {
          expenseDocumentId,
          otherIncomeId,
          actualCost: ticket.actualCost?.toString() ?? null,
          payer: ticket.payer,
        },
      });

      return {
        ticket: { ...ticket, status: 'CLOSED' as const },
        expenseDocumentId,
        otherIncomeId,
      };
    });
  }

  // ─── Query Methods ────────────────────────────────────────────────────────

  /** Paginated list with filtering + branch scoping. */
  async findAll(dto: ListRepairTicketsDto, user: ReqUser) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 50;
    const skip = (page - 1) * limit;

    const where: Prisma.RepairTicketWhereInput = { deletedAt: null };
    if (dto.status) where.status = dto.status;
    if (dto.customerId) where.customerId = dto.customerId;
    if (dto.repairSupplierId) where.repairSupplierId = dto.repairSupplierId;
    if (dto.from || dto.to) {
      where.createdAt = {};
      if (dto.from) where.createdAt.gte = new Date(dto.from);
      if (dto.to) where.createdAt.lte = new Date(dto.to);
    }

    // Branch scope — OWNER/ACCOUNTANT/FINANCE_MANAGER are cross-branch
    if (!hasCrossBranchAccess(user)) {
      if (user.branchId) {
        where.branchId = user.branchId;
      }
      // no branchId on user → scope to guaranteed-empty set
      else {
        return { data: [], total: 0, page, limit };
      }
    } else if (dto.branchId) {
      where.branchId = dto.branchId;
    }

    // Search across ticketNumber / customer.name / deviceImei
    if (dto.q) {
      where.OR = [
        { ticketNumber: { contains: dto.q, mode: 'insensitive' } },
        { customer: { name: { contains: dto.q, mode: 'insensitive' } } },
        { deviceImei: { contains: dto.q, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.repairTicket.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true } },
          repairSupplier: { select: { id: true, name: true } },
        },
      }),
      this.prisma.repairTicket.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /** Full detail with relations + timeline. Branch-scoped defense. */
  async findOne(id: string, user: ReqUser) {
    const ticket = await this.prisma.repairTicket.findUnique({
      where: { id, deletedAt: null },
      include: {
        customer: true,
        contract: { include: { product: true } },
        product: true,
        repairSupplier: true,
        branch: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        expenseDocument: { select: { id: true, number: true, status: true, totalAmount: true } },
        otherIncome: { select: { id: true, docNumber: true, status: true, totalAmount: true } },
        replacementContract: { select: { id: true, contractNumber: true } },
        statusLogs: {
          include: { changedBy: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!ticket) throw new NotFoundException('ไม่พบ ticket');

    if (!hasCrossBranchAccess(user) && user.branchId && ticket.branchId !== user.branchId) {
      throw new ForbiddenException('ไม่สามารถเข้าถึงสาขาอื่นได้');
    }
    return ticket;
  }

  /** OPEN-only edit of non-status fields. */
  async update(id: string, dto: UpdateRepairTicketDto, user: ReqUser) {
    return this.prisma.$transaction(async (tx) => {
      const ticket = await tx.repairTicket.findUnique({ where: { id, deletedAt: null } });
      if (!ticket) throw new NotFoundException('ไม่พบ ticket');
      if (ticket.status !== 'OPEN') {
        throw new ConflictException('แก้ไขได้เฉพาะ status=OPEN');
      }

      const updated = await tx.repairTicket.update({
        where: { id },
        data: {
          defectDescription: dto.defectDescription,
          repairSupplierId: dto.repairSupplierId,
          estimatedCost:
            dto.estimatedCost != null ? new Prisma.Decimal(dto.estimatedCost) : undefined,
          notes: dto.notes,
        },
      });

      await this.audit.log({
        userId: user.id,
        action: 'REPAIR_TICKET_EDITED',
        entity: 'repair_ticket',
        entityId: id,
        oldValue: {
          defectDescription: ticket.defectDescription,
          repairSupplierId: ticket.repairSupplierId,
          estimatedCost: ticket.estimatedCost,
          notes: ticket.notes,
        },
        newValue: {
          defectDescription: updated.defectDescription,
          repairSupplierId: updated.repairSupplierId,
          estimatedCost: updated.estimatedCost,
          notes: updated.notes,
        },
      });

      return updated;
    });
  }

  /** OPEN-only re-detection of warranty status from live contract/product. */
  async recalcWarranty(id: string, user: ReqUser) {
    return this.prisma.$transaction(async (tx) => {
      const ticket = await tx.repairTicket.findUnique({ where: { id, deletedAt: null } });
      if (!ticket) throw new NotFoundException('ไม่พบ ticket');
      if (ticket.status !== 'OPEN') {
        throw new ConflictException('recalc warranty ทำได้เฉพาะ status=OPEN');
      }

      const contract = ticket.contractId
        ? await tx.contract.findUnique({ where: { id: ticket.contractId } })
        : null;
      const product = ticket.productId
        ? await tx.product.findUnique({ where: { id: ticket.productId } })
        : null;
      const warrantyStatus = detectWarrantyStatus({ contract, product });

      const updated = await tx.repairTicket.update({
        where: { id },
        data: { warrantyStatus },
      });

      await this.audit.log({
        userId: user.id,
        action: 'REPAIR_TICKET_WARRANTY_RECALC',
        entity: 'repair_ticket',
        entityId: id,
        newValue: { oldStatus: ticket.warrantyStatus, newStatus: warrantyStatus },
      });

      return updated;
    });
  }

  /** OWNER-only, CANCELLED-only soft-delete. I6: update + audit are atomic. */
  async softDelete(id: string, user: ReqUser) {
    return this.prisma.$transaction(async (tx) => {
      const ticket = await tx.repairTicket.findUnique({
        where: { id, deletedAt: null },
      });
      if (!ticket) throw new NotFoundException('ไม่พบ ticket');
      if (ticket.status !== 'CANCELLED') {
        throw new ConflictException('soft-delete ทำได้เฉพาะ status=CANCELLED');
      }
      await tx.repairTicket.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await this.audit.log({
        userId: user.id,
        action: 'REPAIR_TICKET_SOFT_DELETED',
        entity: 'repair_ticket',
        entityId: id,
      });
    });
  }

  /**
   * Private helper — shared by warrantyPreview and warrantyLookup.
   * Computes the 3 warranty day-remaining windows using BKK calendar-day arithmetic.
   * Mirrors the logic in detectWarrantyStatus (UTC+7 offset).
   */
  private computeWarrantyWindows(
    deviceReceivedAt: Date | null | undefined,
    shopWarrantyEndDate: Date | null | undefined,
    warrantyExpireDate: Date | null | undefined,
  ): { sevenDayDefect: number | null; shopWarranty: number | null; mfrWarranty: number | null } {
    const now = new Date();

    // BKK calendar-day arithmetic (UTC+7 offset) — consistent with detectWarrantyStatus
    function bkkCalendarDay(d: Date): Date {
      const shifted = new Date(d.getTime() + 7 * 60 * 60 * 1000);
      return new Date(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
    }

    const sevenDayDefect =
      deviceReceivedAt != null
        ? Math.max(
            0,
            Math.floor(
              (bkkCalendarDay(deviceReceivedAt).getTime() +
                7 * 86400_000 -
                bkkCalendarDay(now).getTime()) /
                86400_000,
            ),
          )
        : null;

    // W1: use BKK calendar-day math for shopWarranty + mfrWarranty (same as sevenDayDefect)
    // so all 3 windows are measured with consistent BKK midnight boundaries.
    const shopWarranty =
      shopWarrantyEndDate != null
        ? Math.max(
            0,
            Math.floor(
              (bkkCalendarDay(shopWarrantyEndDate).getTime() - bkkCalendarDay(now).getTime()) /
                86400_000,
            ),
          )
        : null;

    const mfrWarranty =
      warrantyExpireDate != null
        ? Math.max(
            0,
            Math.floor(
              (bkkCalendarDay(warrantyExpireDate).getTime() - bkkCalendarDay(now).getTime()) /
                86400_000,
            ),
          )
        : null;

    return { sevenDayDefect, shopWarranty, mfrWarranty };
  }

  /**
   * Server-side warranty decision for the wizard Step 3 routing.
   * Determines warranty status, smart-default flow, days-remaining windows,
   * and eligibility flags without any re-implementation in the frontend.
   */
  async warrantyPreview(dto: WarrantyPreviewDto, user: ReqUser) {
    if (!dto.customerId && !dto.contractId && !dto.productId) {
      throw new BadRequestException(
        'ต้องระบุ customerId หรือ productId หรือ contractId อย่างน้อย 1 อย่าง',
      );
    }

    const contract = dto.contractId
      ? await this.prisma.contract.findUnique({
          where: { id: dto.contractId, deletedAt: null },
          include: { product: true },
        })
      : null;

    const product = dto.productId
      ? await this.prisma.product.findUnique({
          where: { id: dto.productId, deletedAt: null },
        })
      : (contract?.product ?? null);

    // detectWarrantyStatus accepts { contract?, product? } — BKK calendar-day arithmetic inside
    const warrantyStatus = detectWarrantyStatus({ contract, product });

    const { sevenDayDefect, shopWarranty, mfrWarranty } = this.computeWarrantyWindows(
      contract?.deviceReceivedAt,
      contract?.shopWarrantyEndDate,
      product?.warrantyExpireDate,
    );

    // C2: tie forExchange to warrantyStatus === IN_7DAY_DEFECT (source of truth from detectWarrantyStatus).
    // Do NOT use sevenDayDefect > 0 — on day-7 exactly, sevenDayDefect === 0 yet warrantyStatus
    // is still IN_7DAY_DEFECT (daysSinceReceipt === 7 <= 7). sevenDayDefect is Math.max(0, ...)
    // so it bottoms out at 0 regardless of days-past-7, making sevenDayDefect === 0 ambiguous.
    // Using warrantyStatus directly is the single source of truth.
    const forExchange =
      warrantyStatus === 'IN_7DAY_DEFECT' &&
      !!contract &&
      contract.status === 'ACTIVE' &&
      product?.category === 'PHONE_USED';

    const defaultFlow: 'repair' | 'exchange' =
      warrantyStatus === 'IN_7DAY_DEFECT' && forExchange ? 'exchange' : 'repair';
    const alternativeFlow: 'repair' | null = defaultFlow === 'exchange' ? 'repair' : null;
    const defaultPayerValue = defaultPayer(warrantyStatus);

    // Audit log (fire-and-forget — non-blocking, throttled per-user upstream)
    // C1: do NOT include dto in the log — it contains UUIDs (customerId/contractId/productId) = PII
    this.audit
      .log({
        userId: user.id,
        action: 'WARRANTY_LOOKED_UP',
        entity: 'repair_ticket',
        newValue: {
          searchMode: 'preview',
          inputType: dto.contractId ? 'contract' : dto.productId ? 'product' : 'customer',
          resultCount: 1,
        },
      })
      .catch(() => {});

    return {
      warrantyStatus,
      defaultFlow,
      alternativeFlow,
      defaultPayer: defaultPayerValue,
      daysRemaining: { sevenDayDefect, shopWarranty, mfrWarranty },
      eligibility: { forExchange, forRepair: true },
      blockingReasons: undefined as string[] | undefined,
    };
  }

  /**
   * Standalone warranty lookup for the /insurance/warranty-check page.
   * Three search modes: by customerId, by imei/serial, or by contractNumber.
   * Returns customer info + all matching devices with warranty windows + eligibility flags.
   * No ticket is created — read-only lookup only.
   */
  async warrantyLookup(dto: WarrantyLookupDto, user: ReqUser) {
    if (!dto.customerId && !dto.imei && !dto.serial && !dto.contractNumber) {
      throw new BadRequestException('ต้องระบุ search input อย่างน้อย 1 อย่าง');
    }

    const branchScope = hasCrossBranchAccess(user)
      ? {}
      : { branchId: user.branchId ?? undefined };

    let contracts: any[] = [];
    let customer: any = null;

    if (dto.customerId) {
      // C3: verify customer exists — throw if not, but empty devices is OK (customer has no phones)
      customer = await this.prisma.customer.findUnique({
        where: { id: dto.customerId, deletedAt: null },
      });
      if (!customer) throw new NotFoundException('ไม่พบลูกค้า');
      contracts = await this.prisma.contract.findMany({
        where: { customerId: dto.customerId, deletedAt: null, ...branchScope },
        include: { product: true, customer: true },
      });
    } else if (dto.imei || dto.serial) {
      const search = dto.imei ?? dto.serial!;
      // C3: exact-match lookup — throw NotFoundException when the device doesn't exist at all
      const product = await this.prisma.product.findFirst({
        where: { imeiSerial: search, deletedAt: null },
        include: {
          contracts: {
            where: { deletedAt: null, ...branchScope },
            include: { customer: true },
          },
        },
      });
      if (!product) {
        throw new NotFoundException(`ไม่พบเครื่องที่ ${dto.imei ? 'IMEI' : 'Serial'} นี้`);
      }
      if (product.contracts?.length) {
        customer = product.contracts[0].customer;
        contracts = product.contracts.map((c: any) => ({ ...c, product }));
      } else {
        // Product exists but no contract in scope — walk-in style row (no contract)
        contracts = [
          {
            product,
            customer: null,
            deviceReceivedAt: null,
            shopWarrantyEndDate: null,
            status: 'NO_CONTRACT',
          },
        ];
      }
    } else if (dto.contractNumber) {
      // C3: exact-match lookup — throw NotFoundException when contract doesn't exist at all
      const c = await this.prisma.contract.findFirst({
        where: { contractNumber: dto.contractNumber, deletedAt: null, ...branchScope },
        include: { product: true, customer: true },
      });
      if (!c) throw new NotFoundException(`ไม่พบสัญญาเลขที่ ${dto.contractNumber}`);
      customer = c.customer;
      contracts = [c];
    }

    const devices = contracts
      .map((c: any) => {
        const warrantyWindows = this.computeWarrantyWindows(
          c.deviceReceivedAt,
          c.shopWarrantyEndDate,
          c.product?.warrantyExpireDate,
        );

        // C2: use detectWarrantyStatus as the single source of truth for the 7-day boundary.
        // sevenDayDefect bottoms at 0 via Math.max, making sevenDayDefect === 0 ambiguous
        // (could be day-7 in-window OR any expired day). warrantyStatus === IN_7DAY_DEFECT
        // correctly captures the inclusive-7 boundary from BKK calendar-day arithmetic.
        const warrantyStatus = detectWarrantyStatus({ contract: c, product: c.product });
        const forExchange =
          warrantyStatus === 'IN_7DAY_DEFECT' &&
          !!c.id &&
          c.status === 'ACTIVE' &&
          c.product?.category === 'PHONE_USED';

        return {
          product: c.product
            ? {
                id: c.product.id,
                brand: c.product.brand,
                model: c.product.model,
                imeiSerial: c.product.imeiSerial ?? null,
              }
            : null,
          contract: c.id
            ? { id: c.id, contractNumber: c.contractNumber, status: c.status }
            : null,
          warrantyWindows,
          eligibility: { forExchange, forRepair: true },
        };
      })
      .filter((d: any) => d.product !== null);

    // Audit log (fire-and-forget — non-blocking)
    this.audit
      .log({
        userId: user.id,
        action: 'WARRANTY_LOOKED_UP',
        entity: 'repair_ticket',
        newValue: {
          searchMode: dto.customerId
            ? 'customer'
            : dto.imei
              ? 'imei'
              : dto.serial
                ? 'serial'
                : 'contract',
          resultCount: devices.length,
        },
      })
      .catch(() => {});

    return { customer, devices };
  }

  /**
   * IMEI-based lookup for the insurance wizard Step 1 pre-fill.
   * Finds the product by IMEI/serial, then the most recent non-deleted Sale for that product.
   * Returns structured data covering product, customer, contract, and computed warranty status.
   * No audit log — read-only, called frequently during wizard UX.
   */
  async lookupByImei(imei: string, user: ReqUser) {
    const product = await this.prisma.product.findFirst({
      where: { imeiSerial: imei, deletedAt: null },
      select: {
        id: true,
        brand: true,
        model: true,
        storage: true,
        imeiSerial: true,
        category: true,
        warrantyExpireDate: true,
      },
    });

    if (!product) return { found: false } as const;

    // Branch scoping: SALES + BRANCH_MANAGER (non-cross-branch roles) only see
    // Sales from their own branch. OWNER / FINANCE_MANAGER / ACCOUNTANT see all.
    // Without this, scanning a foreign branch's IMEI leaks customer name/phone
    // — PDPA violation. Mirrors warrantyLookup's branchScope at line ~795.
    const branchScope = hasCrossBranchAccess(user)
      ? {}
      : { branchId: user.branchId ?? undefined };

    const sale = await this.prisma.sale.findFirst({
      where: { productId: product.id, deletedAt: null, ...branchScope },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        saleType: true,
        createdAt: true,
        customer: { select: { id: true, name: true, phone: true } },
        contract: {
          select: {
            id: true,
            contractNumber: true,
            status: true,
            deviceReceivedAt: true,
            shopWarrantyEndDate: true,
          },
        },
      },
    });

    // Use canonical detectWarrantyStatus utility (handles IN_MANUFACTURER + BKK
    // calendar-day arithmetic correctly). Never duplicate this logic — see W8
    // discipline in detect-warranty-status.ts.
    const warrantyStatus = detectWarrantyStatus({
      contract: sale?.contract ?? null,
      product,
    });

    return {
      found: true,
      product: {
        id: product.id,
        brand: product.brand,
        model: product.model,
        storage: product.storage,
        imeiSerial: product.imeiSerial,
        category: product.category,
      },
      sale: sale ? { id: sale.id, saleType: sale.saleType } : null,
      customer: sale?.customer ?? null,
      contract: sale?.contract
        ? {
            id: sale.contract.id,
            contractNumber: sale.contract.contractNumber,
            status: sale.contract.status,
          }
        : null,
      warrantyStatus,
      daysRemainingIn7Day: this.computeDaysRemainingIn7Day(sale?.contract),
      // วันที่ซื้อ + วันที่หมดประกัน (both warranties when present)
      purchasedAt: sale?.createdAt ?? null,
      shopWarrantyEndDate: sale?.contract?.shopWarrantyEndDate ?? null,
      manufacturerWarrantyEndDate: product.warrantyExpireDate ?? null,
    } as const;
  }

  private computeDaysRemainingIn7Day(contract: { deviceReceivedAt?: Date | null } | null | undefined): number | null {
    if (!contract?.deviceReceivedAt) return null;
    // BKK calendar-day arithmetic (matches detect-warranty-status.ts convention).
    // A device received at 23:00 BKK on day 0 → still has 7 days remaining at midnight UTC.
    const bkkOffsetMs = 7 * 60 * 60 * 1000;
    const toBkkMidnight = (d: Date) => {
      const bkk = new Date(d.getTime() + bkkOffsetMs);
      return new Date(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate());
    };
    const daysSince =
      (toBkkMidnight(new Date()).getTime() - toBkkMidnight(new Date(contract.deviceReceivedAt)).getTime()) /
      86_400_000;
    const remaining = 7 - daysSince;
    return remaining < 0 ? 0 : Math.ceil(remaining);
  }

  /**
   * PUBLIC helper — also called by defect-exchange.service (PR3) within its own $transaction.
   * Accepts an optional `tx` parameter; defaults to `this.prisma` for standalone use.
   */
  async markReplaced(
    id: string,
    replacementContractId: string,
    user: ReqUser,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const replacedAt = new Date();

    // W1: read actual status before CAS so RepairStatusLog reflects the real
    // from-state (matches cancel() pattern — not a placeholder).
    const before = await tx.repairTicket.findUnique({
      where: { id, deletedAt: null },
      select: { status: true },
    });
    if (!before) throw new NotFoundException('ไม่พบ ticket');
    const fromStatus = before.status;

    const updated = await tx.repairTicket.updateMany({
      where: { id, status: { in: ['OPEN', 'IN_PROGRESS', 'READY_FOR_PICKUP'] }, deletedAt: null },
      data: { status: 'REPLACED', replacedAt, replacementContractId },
    });
    if (updated.count === 0) {
      throw new ConflictException(
        'สถานะถูกเปลี่ยนไปแล้ว — replace ทำได้เฉพาะ OPEN/IN_PROGRESS/READY_FOR_PICKUP',
      );
    }

    await tx.repairStatusLog.create({
      data: {
        ticketId: id,
        fromStatus,
        toStatus: 'REPLACED',
        changedById: user.id,
        note: `replacement contract ${replacementContractId}`,
      },
    });

    await this.audit.log({
      userId: user.id,
      action: 'REPAIR_TICKET_REPLACED',
      entity: 'repair_ticket',
      entityId: id,
      newValue: { replacementContractId },
    });

    return tx.repairTicket.findUnique({ where: { id } });
  }
}
