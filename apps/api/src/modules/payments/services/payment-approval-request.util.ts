import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasCrossBranchAccess } from '../../auth/branch-access.util';
import {
  getPaymentApprovalPermissions,
  type PaymentApprovalPermission,
  PAYMENT_APPROVAL_USER_ROLES,
} from './payment-approval-permissions';

export const PAYMENT_APPROVAL_ACTIONS = [
  'RECORD_PAYMENT',
  'WAIVE_LATE_FEE',
  'VOID_RECEIPT',
  'EARLY_PAYOFF',
] as const;
export type PaymentApprovalAction = (typeof PAYMENT_APPROVAL_ACTIONS)[number];
/** Internal argument only: controllers must never deserialize this from a request body. */
export interface PaymentApprovalContext {
  requestId: string;
  actorId: string;
  reason?: string;
}

export function approvalJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value));
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

/** Snapshot the scope affected by the action, including every receipt a void reverses. */
export async function paymentApprovalSnapshot(
  tx: Prisma.TransactionClient,
  action: PaymentApprovalAction,
  targetId: string,
) {
  let contractId = targetId;
  if (action === 'VOID_RECEIPT') {
    const receipt = await tx.receipt.findFirst({ where: { id: targetId, deletedAt: null } });
    if (!receipt || receipt.isVoided) throw new BadRequestException('ไม่พบใบเสร็จที่กลับรายการได้');
    contractId = receipt.contractId;
  } else if (action !== 'EARLY_PAYOFF') {
    const payment = await tx.payment.findFirst({ where: { id: targetId, deletedAt: null } });
    if (!payment) throw new NotFoundException('ไม่พบงวดชำระ');
    contractId = payment.contractId;
  }
  const contract = await tx.contract.findFirst({
    where: { id: contractId, deletedAt: null },
    select: {
      id: true,
      contractNumber: true,
      branchId: true,
      status: true,
      updatedAt: true,
      advanceBalance: true,
      creditBalance: true,
      rescheduleAdvanceBalance: true,
    },
  });
  if (!contract) throw new NotFoundException('ไม่พบสัญญา');
  const payments = await tx.payment.findMany({
    where: { contractId, deletedAt: null },
    orderBy: { installmentNo: 'asc' },
    select: {
      id: true,
      installmentNo: true,
      amountDue: true,
      amountPaid: true,
      lateFee: true,
      lateFeeWaived: true,
      status: true,
      dueDate: true,
      updatedAt: true,
    },
  });
  const receipts = await tx.receipt.findMany({
    where: { contractId, deletedAt: null },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      paymentId: true,
      receiptNumber: true,
      receiptType: true,
      amount: true,
      isVoided: true,
      updatedAt: true,
    },
  });
  const policy = await tx.systemConfig.findMany({
    where: {
      key: { in: ['late_fee_tier1_amount', 'late_fee_tier2_amount', 'late_fee_tier2_min_days'] },
      deletedAt: null,
    },
    orderBy: { key: 'asc' },
    select: { key: true, value: true },
  });
  return {
    contract,
    snapshot: approvalJson({
      contract,
      payments,
      receipts,
      policy,
      ...(action === 'EARLY_PAYOFF'
        ? { quoteDay: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }) }
        : {}),
    }),
  };
}

export function assertApprovalBranch(
  user: { role: string; branchId: string | null },
  branchId: string,
) {
  if (!hasCrossBranchAccess(user) && (!user.branchId || user.branchId !== branchId)) {
    throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงรายการต่างสาขา');
  }
}

/** Financial handlers call this BEFORE their first write, in the SAME transaction as the JE. */
export async function consumePaymentApproval(
  tx: Prisma.TransactionClient,
  context: PaymentApprovalContext | undefined,
  action: PaymentApprovalAction,
  targetId: string,
) {
  if (!context) throw new ForbiddenException('รายการนี้ต้องส่งขออนุมัติและให้ผู้มีสิทธิกดอนุมัติ');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment-approval:${context.requestId}`}))`;
  const request = await tx.paymentApprovalRequest.findFirst({
    where: { id: context.requestId, deletedAt: null },
  });
  if (!request || request.action !== action || request.targetId !== targetId) {
    throw new ForbiddenException('คำขออนุมัติไม่ตรงกับรายการ');
  }
  if (request.status !== 'PENDING') throw new ConflictException('คำขอนี้ดำเนินการแล้ว');
  const permission = await getPaymentApprovalPermissions(tx, context.actorId);
  if (
    !request.requiredPermissions.length ||
    !request.requiredPermissions.every((key) =>
      permission.permissions.includes(key as PaymentApprovalPermission),
    )
  ) {
    throw new ForbiddenException('ไม่มีสิทธิ์อนุมัติรายการประเภทนี้');
  }
  const { contract, snapshot } = await paymentApprovalSnapshot(tx, action, targetId);
  assertApprovalBranch(permission.user, contract.branchId);
  const requester = await getPaymentApprovalPermissions(tx, request.requestedById);
  assertApprovalBranch(requester.user, contract.branchId);
  if (!PAYMENT_APPROVAL_USER_ROLES.includes(requester.user.role))
    throw new ForbiddenException('ผู้ขอไม่มีสิทธิ์ทำรายการแล้ว');
  if (request.requestedById === context.actorId) {
    if (permission.user.role !== 'OWNER')
      throw new ForbiddenException('ต้องให้ผู้มีสิทธิอีกคนอนุมัติ');
    if (!context.reason?.trim())
      throw new BadRequestException('OWNER ต้องระบุเหตุผลเมื่ออนุมัติรายการของตนเอง');
  }
  if (canonical(snapshot) !== canonical(request.snapshot)) {
    throw new ConflictException(
      'ยอดหรือข้อมูลรายการเปลี่ยนแล้ว กรุณายกเลิกคำขอเดิมและส่งขออนุมัติใหม่',
    );
  }
  const changed = await tx.paymentApprovalRequest.updateMany({
    where: { id: request.id, status: 'PENDING' },
    data: {
      status: 'APPROVED',
      reviewedById: context.actorId,
      reviewedAt: new Date(),
      reviewReason: context.reason?.trim() || null,
    },
  });
  if (changed.count !== 1) throw new ConflictException('คำขอนี้ดำเนินการแล้ว');
  await tx.auditLog.create({
    data: {
      userId: context.actorId,
      action: 'PAYMENT_APPROVAL_APPROVED',
      entity: 'payment_approval',
      entityId: request.id,
      newValue: approvalJson({
        action,
        targetId,
        requestedById: request.requestedById,
        reason: context.reason || request.reason,
        selfApproved: request.requestedById === context.actorId,
      }),
    },
  });
  return {
    requestedById: request.requestedById,
    approverId: context.actorId,
    payload: request.payload,
    reviewSummary: request.reviewSummary,
  };
}
