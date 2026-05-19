import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ExpenseDocumentsService } from '../expense-documents/expense-documents.service';
import { OtherIncomeService } from '../other-income/other-income.service';
import { SettingsService } from '../settings/settings.service';
import { RepairTicketDocNumberService } from './services/doc-number.service';
import { detectWarrantyStatus, defaultPayer } from './utils/detect-warranty-status';
import { CreateRepairTicketDto } from './dto/create-repair-ticket.dto';

type ReqUser = { id: string; role: string; branchId?: string | null };

@Injectable()
export class RepairTicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    // Injected for future use by send/receive/replace flows (PR3+)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private readonly expenseDocs: ExpenseDocumentsService,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private readonly otherIncome: OtherIncomeService,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
}
