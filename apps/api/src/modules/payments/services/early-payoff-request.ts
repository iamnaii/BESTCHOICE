import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { ContractPaymentService } from '../../contracts/contract-payment.service';
import { EarlyPayoffDto } from '../../contracts/dto/contract.dto';
import {
  approvalJson,
  MANAGED_PAYOFF_SOURCE_KEY,
  ManagedPayoffRequestSource,
  paymentApprovalSnapshot,
} from './payment-approval-request.util';

/** The existing approval controller and managed bridge share this producer.
 * The caller owns authorization and the exact Serializable transaction. This
 * creates a request only; neither a quote nor a request constitutes approval. */
export async function createEarlyPayoffRequest(
  tx: Prisma.TransactionClient,
  payment: ContractPaymentService,
  input: {
    targetId: string;
    userId: string;
    reason: string;
    payload: Record<string, unknown>;
    managedSource?: ManagedPayoffRequestSource;
  },
) {
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 1000)
    throw new BadRequestException('กรุณาระบุเหตุผลที่ขออนุมัติไม่เกิน 1000 ตัวอักษร');
  const dto = plainToInstance(EarlyPayoffDto, input.payload);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) throw new BadRequestException('ข้อมูลคำขอปิดยอดไม่ถูกต้อง');
  if (
    dto.discountPct !== undefined &&
    (typeof dto.discountPct !== 'number' ||
      !Number.isFinite(dto.discountPct) ||
      dto.discountPct < 0 ||
      dto.discountPct > 100)
  )
    throw new BadRequestException('ส่วนลดต้องอยู่ระหว่าง 0 ถึง 100');
  dto.paymentDate ??= new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment-approval-create:EARLY_PAYOFF:${input.targetId}`}))`;
  if (
    await tx.paymentApprovalRequest.findFirst({
      where: {
        action: 'EARLY_PAYOFF',
        targetId: input.targetId,
        status: 'PENDING',
        deletedAt: null,
      },
    })
  )
    throw new ConflictException('รายการนี้มีคำขอรออนุมัติแล้ว');
  const { contract, snapshot } = await paymentApprovalSnapshot(tx, 'EARLY_PAYOFF', input.targetId);
  const reviewSummary = await payment.getEarlyPayoffQuote(
    contract.id,
    dto.discountPct,
    dto.collectedByShop ? '11-2107' : dto.depositAccountCode,
    tx,
  );
  const request = await tx.paymentApprovalRequest.create({
    data: {
      id: randomUUID(),
      action: 'EARLY_PAYOFF',
      targetId: input.targetId,
      contractId: contract.id,
      requestedById: input.userId,
      reason: input.reason.trim(),
      requiredPermissions: ['EARLY_PAYOFF'],
      payload: approvalJson(dto),
      snapshot: input.managedSource
        ? approvalJson({
            ...(snapshot as object),
            [MANAGED_PAYOFF_SOURCE_KEY]: input.managedSource,
          })
        : snapshot,
      reviewSummary: approvalJson(reviewSummary),
    },
  });
  await tx.auditLog.create({
    data: {
      userId: input.userId,
      action: 'PAYMENT_APPROVAL_REQUESTED',
      entity: 'payment_approval',
      entityId: request.id,
      newValue: approvalJson(
        input.managedSource
          ? {
              action: request.action,
              targetId: request.targetId,
              requestedById: input.userId,
              sourceVersion: input.managedSource.version,
              status: 'PENDING',
            }
          : {
              action: request.action,
              targetId: request.targetId,
              reason: request.reason,
              payload: request.payload,
            },
      ),
    },
  });
  return request;
}
