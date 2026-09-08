import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { hasCrossBranchAccess } from '../auth/branch-access.util';
import { PaymentsService } from './payments.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { ContractPaymentService } from '../contracts/contract-payment.service';
import { INSTALLMENT_MONEY_RECEIPT_TYPES } from '../receipts/receipt-types.constants';
import { RecordPaymentDto } from './dto/payment.dto';
import { EarlyPayoffDto } from '../contracts/dto/contract.dto';
import {
  getPaymentApprovalPermissions,
  type PaymentApprovalPermission,
  PAYMENT_APPROVAL_USER_ROLES,
} from './services/payment-approval-permissions';
import {
  PAYMENT_APPROVAL_ACTIONS,
  type PaymentApprovalAction,
  type PaymentApprovalContext,
  approvalJson,
  assertApprovalBranch,
  paymentApprovalSnapshot,
} from './services/payment-approval-request.util';

class CreatePaymentApprovalDto {
  @IsIn(PAYMENT_APPROVAL_ACTIONS) action!: PaymentApprovalAction;
  @IsUUID() targetId!: string;
  @IsString() @MaxLength(1000) reason!: string;
  @IsObject() payload!: Record<string, unknown>;
}
class PaymentApprovalDecisionDto {
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

async function validated<T extends object>(
  type: new () => T,
  input: Record<string, unknown>,
): Promise<T> {
  const dto = plainToInstance(type, input);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length)
    throw new BadRequestException(
      errors.flatMap((error) => Object.values(error.constraints ?? {})),
    );
  return dto;
}

@Controller('payments/approval-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
export class PaymentApprovalController {
  constructor(
    private prisma: PrismaService,
    private payments: PaymentsService,
    private receipts: ReceiptsService,
    private contractPayment: ContractPaymentService,
  ) {}

  @Post()
  async create(@Body() input: CreatePaymentApprovalDto, @CurrentUser('id') userId: string) {
    if (!input.reason?.trim()) throw new BadRequestException('กรุณาระบุเหตุผลที่ขออนุมัติ');
    let payload: object = {};
    let requiredPermissions: PaymentApprovalPermission[];
    if (input.action === 'RECORD_PAYMENT') {
      const dto = await validated(RecordPaymentDto, input.payload);
      if (dto.waiverApproverId || dto.toleranceApproverId)
        throw new BadRequestException('ระบบระบุผู้อนุมัติจากบัญชีที่กดอนุมัติจริง');
      if (
        !['NORMAL', 'PARTIAL', 'UNDERPAY', 'OVERPAY', 'OVERPAY_ADVANCE'].includes(
          dto.case ?? 'NORMAL',
        )
      ) {
        throw new BadRequestException('ประเภทการรับเงินไม่รองรับคำขอนี้');
      }
      requiredPermissions = [];
      if ((dto.lateFeeWaiverAmount ?? 0) > 0) {
        if (!dto.lateFeeWaiverReasonCode)
          throw new BadRequestException('กรุณาระบุเหตุผลการอนุโลมค่าปรับ');
        requiredPermissions.push('WAIVE_LATE_FEE');
      }
      if (dto.case === 'UNDERPAY' || dto.case === 'OVERPAY')
        requiredPermissions.push('PAYMENT_TOLERANCE');
      if (!requiredPermissions.length) throw new BadRequestException('รับเงินปกติไม่ต้องขออนุมัติ');
      payload = dto;
    } else if (input.action === 'EARLY_PAYOFF') {
      const dto = await validated(EarlyPayoffDto, input.payload);
      if (
        dto.discountPct !== undefined &&
        (typeof dto.discountPct !== 'number' ||
          !Number.isFinite(dto.discountPct) ||
          dto.discountPct < 0 ||
          dto.discountPct > 100)
      )
        throw new BadRequestException('ส่วนลดต้องอยู่ระหว่าง 0 ถึง 100');
      dto.paymentDate ??= new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
      payload = dto;
      requiredPermissions = ['EARLY_PAYOFF'];
    } else {
      if (Object.keys(input.payload).length)
        throw new BadRequestException('คำขอนี้ใช้ข้อมูลจากรายการต้นฉบับเท่านั้น');
      requiredPermissions = [input.action === 'VOID_RECEIPT' ? 'VOID_RECEIPT' : 'WAIVE_LATE_FEE'];
    }
    return this.prisma.$transaction(
      async (tx) => {
        const { user } = await getPaymentApprovalPermissions(tx, userId);
        if (!PAYMENT_APPROVAL_USER_ROLES.includes(user.role))
          throw new ForbiddenException('ไม่มีสิทธิ์สร้างคำขอรับชำระ');
        const { contract, snapshot } = await paymentApprovalSnapshot(
          tx,
          input.action,
          input.targetId,
        );
        assertApprovalBranch(user, contract.branchId);
        let reviewSummary: object = {};
        if (input.action === 'EARLY_PAYOFF') {
          const dto = payload as EarlyPayoffDto;
          reviewSummary = await this.contractPayment.getEarlyPayoffQuote(
            contract.id,
            dto.discountPct,
            dto.collectedByShop ? '11-2107' : dto.depositAccountCode,
            tx,
          );
        }
        if (input.action === 'VOID_RECEIPT') {
          const receipt = await tx.receipt.findUniqueOrThrow({ where: { id: input.targetId } });
          const affected =
            receipt.paymentId &&
            INSTALLMENT_MONEY_RECEIPT_TYPES.includes(
              receipt.receiptType as 'PAYMENT' | 'INSTALLMENT',
            )
              ? await tx.receipt.findMany({
                  where: {
                    paymentId: receipt.paymentId,
                    deletedAt: null,
                    isVoided: false,
                    receiptType: { in: [...INSTALLMENT_MONEY_RECEIPT_TYPES] },
                  },
                })
              : [receipt];
          reviewSummary = {
            amount: affected
              .reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0))
              .toFixed(2),
            receiptNumbers: affected.map((row) => row.receiptNumber),
          };
        }
        if (input.action === 'RECORD_PAYMENT') {
          const payment = await tx.payment.findUniqueOrThrow({ where: { id: input.targetId } });
          const dto = payload as RecordPaymentDto;
          if (
            payment.contractId !== dto.contractId ||
            payment.installmentNo !== dto.installmentNo ||
            payment.status === 'PAID'
          ) {
            throw new BadRequestException('งวดชำระไม่ตรงกับคำขอ หรือชำระครบแล้ว');
          }
          dto.paidDate ??= new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
        }
        if (input.action === 'WAIVE_LATE_FEE') {
          const payment = await tx.payment.findUniqueOrThrow({ where: { id: input.targetId } });
          if (payment.amountPaid.gt(0))
            throw new BadRequestException(
              'งวดนี้รับชำระบางส่วนแล้ว กรุณาขออนุโลมค่าปรับคงเหลือผ่านหน้าบันทึกรับชำระ',
            );
          reviewSummary = {
            lateFeeWaiverAmount: payment.lateFee.toFixed(2),
            installmentNo: payment.installmentNo,
          };
          if (payment.lateFeeWaived || payment.lateFee.lte(0))
            throw new BadRequestException('งวดนี้ไม่มีค่าปรับให้อนุโลม');
        }
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment-approval-create:${input.action}:${input.targetId}`}))`;
        if (
          await tx.paymentApprovalRequest.findFirst({
            where: {
              action: input.action,
              targetId: input.targetId,
              status: 'PENDING',
              deletedAt: null,
            },
          })
        ) {
          throw new ConflictException('รายการนี้มีคำขอรออนุมัติแล้ว กรุณาตรวจที่รายการรออนุมัติ');
        }
        const request = await tx.paymentApprovalRequest.create({
          data: {
            id: randomUUID(),
            action: input.action,
            targetId: input.targetId,
            contractId: contract.id,
            requestedById: userId,
            reason: input.reason.trim(),
            requiredPermissions,
            payload: approvalJson(payload),
            snapshot,
            reviewSummary: approvalJson(reviewSummary),
          },
        });
        await tx.auditLog.create({
          data: {
            userId,
            action: 'PAYMENT_APPROVAL_REQUESTED',
            entity: 'payment_approval',
            entityId: request.id,
            newValue: approvalJson({
              action: request.action,
              targetId: request.targetId,
              reason: request.reason,
              payload: request.payload,
            }),
          },
        });
        return request;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  @Get()
  async list(@CurrentUser('id') userId: string, @Query('contractId') contractId?: string) {
    const actor = await getPaymentApprovalPermissions(this.prisma, userId);
    const contracts = await this.prisma.contract.findMany({
      where: {
        deletedAt: null,
        ...(contractId ? { id: contractId } : {}),
        ...(!hasCrossBranchAccess(actor.user)
          ? { branchId: actor.user.branchId ?? '__unassigned__' }
          : {}),
      },
      select: { id: true, contractNumber: true },
    });
    const requests = await this.prisma.paymentApprovalRequest.findMany({
      where: {
        deletedAt: null,
        status: 'PENDING',
        contractId: { in: contracts.map((c) => c.id) },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: requests.map((r) => r.requestedById) } },
      select: { id: true, name: true },
    });
    return {
      data: requests.map((request) => ({
        ...request,
        contractNumber: contracts.find((c) => c.id === request.contractId)?.contractNumber,
        requestedByName: users.find((u) => u.id === request.requestedById)?.name ?? '—',
        canApprove:
          request.requiredPermissions.every((key) =>
            actor.permissions.includes(key as PaymentApprovalPermission),
          ) &&
          (request.requestedById !== userId || actor.user.role === 'OWNER'),
      })),
    };
  }

  @Post(':id/approve')
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @Body() decision: PaymentApprovalDecisionDto,
  ) {
    const request = await this.prisma.paymentApprovalRequest.findFirst({
      where: { id, deletedAt: null },
    });
    if (!request || request.status !== 'PENDING')
      throw new ConflictException('ไม่พบคำขอที่รออนุมัติ');
    const actor = await getPaymentApprovalPermissions(this.prisma, actorId);
    const contract = await this.prisma.contract.findUniqueOrThrow({
      where: { id: request.contractId },
    });
    assertApprovalBranch(actor.user, contract.branchId);
    if (
      !request.requiredPermissions.length ||
      !request.requiredPermissions.every((key) =>
        actor.permissions.includes(key as PaymentApprovalPermission),
      )
    )
      throw new ForbiddenException('ไม่มีสิทธิ์อนุมัติรายการประเภทนี้');
    if (request.requestedById === actorId) {
      if (actor.user.role !== 'OWNER') throw new ForbiddenException('ต้องให้ผู้มีสิทธิอีกคนอนุมัติ');
      if (!decision.reason?.trim()) throw new BadRequestException('OWNER ต้องระบุเหตุผลเมื่ออนุมัติรายการของตนเอง');
    }
    // The actual permission, branch, snapshot and status checks run again inside
    // each financial transaction. A selected user ID is never an authority.
    const context: PaymentApprovalContext = { requestId: id, actorId, reason: decision.reason };
    const payload = request.payload as Record<string, unknown>;
    try {
    switch (request.action) {
      case 'RECORD_PAYMENT': {
        const dto = plainToInstance(RecordPaymentDto, payload);
        const methods: Record<string, string> = {
          CASH: 'CASH',
          TRANSFER: 'BANK_TRANSFER',
          QR: 'QR_EWALLET',
          PAYSOLUTIONS: 'BANK_TRANSFER',
          CARD: 'CARD',
        };
        return await this.payments.recordPayment(
          dto.contractId,
          dto.installmentNo,
          dto.amount,
          dto.wizardMethod ? methods[dto.wizardMethod] : dto.paymentMethod,
          request.requestedById,
          dto.slipUrl || dto.evidenceUrl,
          [dto.notes, dto.memo].filter(Boolean).join('\n') || undefined,
          dto.referenceNumber || dto.transactionRef || `APPROVAL-${id}`,
          dto.depositAccountCode,
          request.requiredPermissions.includes('PAYMENT_TOLERANCE') ? actorId : undefined,
          dto.case,
          dto.consumeAdvance ?? true,
          dto.paidDate ? new Date(dto.paidDate) : undefined,
          dto.lateFeeWaiverAmount,
          dto.lateFeeWaiverReasonCode,
          actorId,
          true,
          dto.additionalLateFee ?? 0,
          context,
        );
      }
      case 'WAIVE_LATE_FEE':
        return await this.payments.waiveLateFee(
          request.targetId,
          request.reason,
          request.requestedById,
          actorId,
          undefined,
          context,
        );
      case 'VOID_RECEIPT':
        return await this.receipts.voidReceipt(
          request.targetId,
          request.reason,
          request.requestedById,
          actorId,
          undefined,
          context,
        );
      case 'EARLY_PAYOFF':
        return await this.contractPayment.earlyPayoff(
          request.targetId,
          request.requestedById,
          plainToInstance(EarlyPayoffDto, payload),
          context,
        );
      default:
        throw new BadRequestException('ไม่รองรับคำขอประเภทนี้');
    }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) throw new ConflictException('รายการถูกเปลี่ยนแปลงระหว่างดำเนินการ กรุณาโหลดรายการรออนุมัติใหม่');
      throw error;
    }
  }

  @Post(':id/reject')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @Body() decision: PaymentApprovalDecisionDto,
  ) {
    if (!decision.reason?.trim()) throw new BadRequestException('กรุณาระบุเหตุผลที่ไม่อนุมัติ');
    return this.decide(id, actorId, 'REJECTED', decision.reason);
  }

  @Post(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') actorId: string) {
    return this.decide(id, actorId, 'CANCELLED', 'ผู้ขอยกเลิกคำขอ');
  }

  private decide(id: string, actorId: string, status: 'REJECTED' | 'CANCELLED', reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const actor = await getPaymentApprovalPermissions(tx, actorId);
      const request = await tx.paymentApprovalRequest.findFirst({ where: { id, deletedAt: null } });
      if (!request || request.status !== 'PENDING')
        throw new ConflictException('ไม่พบคำขอที่รออนุมัติ');
      const contract = await tx.contract.findUniqueOrThrow({ where: { id: request.contractId } });
      assertApprovalBranch(actor.user, contract.branchId);
      if (status === 'CANCELLED') {
        if (request.requestedById !== actorId && actor.user.role !== 'OWNER')
          throw new ForbiddenException('ยกเลิกได้เฉพาะคำขอของตนเอง');
      } else if (
        !request.requiredPermissions.every((key) =>
          actor.permissions.includes(key as PaymentApprovalPermission),
        ) ||
        (request.requestedById === actorId && actor.user.role !== 'OWNER')
      ) {
        throw new ForbiddenException('ไม่มีสิทธิ์พิจารณาคำขอนี้');
      }
      const changed = await tx.paymentApprovalRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status,
          reviewedById: actorId,
          reviewedAt: new Date(),
          reviewReason: reason.trim(),
        },
      });
      if (changed.count !== 1) throw new ConflictException('คำขอนี้ดำเนินการแล้ว');
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: `PAYMENT_APPROVAL_${status}`,
          entity: 'payment_approval',
          entityId: id,
          newValue: { status, reason: reason.trim() },
        },
      });
      return { id, status };
    });
  }
}
