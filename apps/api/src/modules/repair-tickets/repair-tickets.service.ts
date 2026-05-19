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
import { formatDevice } from './utils/format-device';

/** SystemConfig key — CoA code for repair income when payer=CUSTOMER. Default: 42-1106 */
const REPAIR_INCOME_ACCOUNT_CODE_KEY = 'REPAIR_INCOME_ACCOUNT_CODE';
const REPAIR_INCOME_ACCOUNT_CODE_DEFAULT = '42-1106';
/** SystemConfig key — CoA expense code for repair cost when payer=SHOP. Default: 53-1306 */
const REPAIR_EXPENSE_ACCOUNT_CODE_KEY = 'REPAIR_EXPENSE_ACCOUNT_CODE';
const REPAIR_EXPENSE_ACCOUNT_CODE_DEFAULT = '53-1306';

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

      if (ticket.payer === 'SHOP' && ticket.actualCost && ticket.repairSupplierId) {
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
            // NOTE: Number(Decimal) is used only to cross the module-boundary DTO
            // that expects a Prisma.Decimal. The Decimal precision is preserved
            // because actualCost has already been stored as Decimal(12,2) in DB.
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
      } else if (ticket.payer === 'CUSTOMER' && ticket.actualCost) {
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
        fromStatus: 'OPEN', // placeholder — precise from-state can be looked up if needed
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
