import { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { ContractPaymentService } from '../../src/modules/contracts/contract-payment.service';
import type { EarlyPayoffDto } from '../../src/modules/contracts/dto/contract.dto';
import type { ReceiptsService } from '../../src/modules/receipts/receipts.service';
import { PaymentApprovalController } from '../../src/modules/payments/payment-approval.controller';
import {
  parsePaymentApprovalPermissions,
  PAYMENT_APPROVAL_PERMISSIONS_KEY,
  type PaymentApprovalPermission,
} from '../../src/modules/payments/services/payment-approval-permissions';

/**
 * DB-backed fixture support only. Existing money suites run serially in a
 * disposable PostgreSQL database. The real request creator freezes the exact
 * snapshot/quote; the real financial handler checks identity, permission, SoD
 * and consumes the request. No approval or journal logic is mocked here.
 */
async function withAssignedPermission<T>(
  prisma: PrismaClient,
  approverId: string,
  permission: PaymentApprovalPermission,
  run: (rememberRequest: (id: string) => void) => Promise<T>,
): Promise<T> {
  const previous = await prisma.systemConfig.findUnique({
    where: { key: PAYMENT_APPROVAL_PERMISSIONS_KEY },
  });
  const assignments = parsePaymentApprovalPermissions(previous?.deletedAt ? null : previous?.value);
  assignments[approverId] = [...new Set([...(assignments[approverId] ?? []), permission])];
  await prisma.systemConfig.upsert({
    where: { key: PAYMENT_APPROVAL_PERMISSIONS_KEY },
    update: { value: JSON.stringify(assignments), deletedAt: null },
    create: { key: PAYMENT_APPROVAL_PERMISSIONS_KEY, value: JSON.stringify(assignments) },
  });
  let requestId: string | undefined;
  try {
    const result = await run((id) => { requestId = id; });
    const request = await prisma.paymentApprovalRequest.findUniqueOrThrow({ where: { id: requestId! } });
    if (request.status !== 'APPROVED' || request.reviewedById !== approverId) {
      throw new Error('Financial fixture did not consume its real payment approval');
    }
    return result;
  } finally {
    // Remove only this helper's fixture request; immutable audit evidence stays.
    try {
      if (requestId) await prisma.paymentApprovalRequest.deleteMany({ where: { id: requestId } });
    } finally {
      if (previous) {
        await prisma.systemConfig.update({ where: { key: PAYMENT_APPROVAL_PERMISSIONS_KEY },
          data: { value: previous.value, deletedAt: previous.deletedAt } });
      } else {
        await prisma.systemConfig.deleteMany({ where: { key: PAYMENT_APPROVAL_PERMISSIONS_KEY } });
      }
    }
  }
}

export function voidReceiptWithApproval(
  prisma: PrismaClient,
  receipts: ReceiptsService,
  receiptId: string,
  reason: string,
  requestedById: string,
  approverId: string,
  userRole?: string,
) {
  return withAssignedPermission(prisma, approverId, 'VOID_RECEIPT', async (rememberRequest) => {
    const controller = new PaymentApprovalController(prisma as PrismaService, undefined as never, receipts, undefined as never);
    const request = await controller.create({ action: 'VOID_RECEIPT', targetId: receiptId, reason, payload: {} }, requestedById);
    rememberRequest(request.id);
    return receipts.voidReceipt(receiptId, reason, requestedById, approverId, userRole,
      { requestId: request.id, actorId: approverId, reason: 'ผู้อนุมัติตรวจสอบรายการทดสอบแล้ว' });
  });
}

export function earlyPayoffWithApproval(
  prisma: PrismaClient,
  service: ContractPaymentService,
  contractId: string,
  requestedById: string,
  dto: EarlyPayoffDto,
  approverId = requestedById,
) {
  return withAssignedPermission(prisma, approverId, 'EARLY_PAYOFF', async (rememberRequest) => {
    const controller = new PaymentApprovalController(prisma as PrismaService, undefined as never, undefined as never, service);
    const request = await controller.create({ action: 'EARLY_PAYOFF', targetId: contractId,
      reason: 'ขออนุมัติปิดสัญญาสำหรับการทดสอบ', payload: { ...dto } }, requestedById);
    rememberRequest(request.id);
    return service.earlyPayoff(contractId, requestedById, dto,
      { requestId: request.id, actorId: approverId, reason: 'OWNER ตรวจสอบและอนุมัติรายการทดสอบของตนเอง' });
  });
}
