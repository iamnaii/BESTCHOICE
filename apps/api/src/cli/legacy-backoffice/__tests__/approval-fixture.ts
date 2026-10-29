import { Prisma, PrismaClient } from '@prisma/client';
import type { ContractPaymentService } from '../../../modules/contracts/contract-payment.service';
import type { EarlyPayoffDto } from '../../../modules/contracts/dto/contract.dto';
import type { ReceiptsService } from '../../../modules/receipts/receipts.service';
import { INSTALLMENT_MONEY_RECEIPT_TYPES } from '../../../modules/receipts/receipt-types.constants';
import { createEarlyPayoffRequest } from '../../../modules/payments/services/early-payoff-request';
import {
  parsePaymentApprovalPermissions,
  PAYMENT_APPROVAL_PERMISSIONS_KEY,
  type PaymentApprovalPermission,
} from '../../../modules/payments/services/payment-approval-permissions';
import {
  approvalJson,
  paymentApprovalSnapshot,
} from '../../../modules/payments/services/payment-approval-request.util';

/**
 * คำขออนุมัติจริงสำหรับเทสต์ฐานข้อมูลของ Task 11 (ไม่ใช่ spec) — ทำงานแบบ `e2e/helpers/payment-approval.ts` แต่ไม่ import
 * `PaymentApprovalController` (กราฟ import ของมันทำให้ ts-jest ใช้หน่วยความจำเกิน 4 GB ตอนคอมไพล์ครั้งแรก):
 * - ปิดยอด: `createEarlyPayoffRequest` ตัวเดียวกับที่ controller เรียก
 * - ยกเลิกใบเสร็จ: `paymentApprovalSnapshot` + แถวคำขอรูปเดียวกับ controller (สิทธิ์ `VOID_RECEIPT`)
 * ผู้ใช้ปลายทาง (`ContractPaymentService.earlyPayoff` / `ReceiptsService.voidReceipt`) ตรวจและใช้คำขอด้วย
 * `consumePaymentApproval` ของจริง · ลบเฉพาะคำขอของตัวเองและคืนค่าการกำหนดสิทธิ์เดิม
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
    const result = await run((id) => {
      requestId = id;
    });
    const request = await prisma.paymentApprovalRequest.findUniqueOrThrow({
      where: { id: requestId! },
    });
    if (request.status !== 'APPROVED' || request.reviewedById !== approverId) {
      throw new Error('fixture: คำขออนุมัติไม่ถูกใช้โดยรายการจริง');
    }
    return result;
  } finally {
    try {
      if (requestId) await prisma.paymentApprovalRequest.deleteMany({ where: { id: requestId } });
    } finally {
      if (previous) {
        await prisma.systemConfig.update({
          where: { key: PAYMENT_APPROVAL_PERMISSIONS_KEY },
          data: { value: previous.value, deletedAt: previous.deletedAt },
        });
      } else {
        await prisma.systemConfig.deleteMany({ where: { key: PAYMENT_APPROVAL_PERMISSIONS_KEY } });
      }
    }
  }
}

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable };

/** ปิดยอดก่อนกำหนดผ่านคำขออนุมัติจริง — ผู้ขอ = ผู้อนุมัติ = OWNER (แบบ e2e helper) */
export function earlyPayoffApproved(
  prisma: PrismaClient,
  service: ContractPaymentService,
  contractId: string,
  ownerId: string,
  dto: EarlyPayoffDto,
) {
  return withAssignedPermission(prisma, ownerId, 'EARLY_PAYOFF', async (rememberRequest) => {
    const request = await prisma.$transaction(
      (tx) =>
        createEarlyPayoffRequest(tx, service, {
          targetId: contractId,
          userId: ownerId,
          reason: 'ขออนุมัติปิดสัญญาสำหรับการทดสอบ',
          payload: { ...dto },
        }),
      SERIALIZABLE,
    );
    rememberRequest(request.id);
    return service.earlyPayoff(contractId, ownerId, dto, {
      requestId: request.id,
      actorId: ownerId,
      reason: 'OWNER ตรวจสอบและอนุมัติรายการทดสอบของตนเอง',
    });
  });
}

/** ยกเลิกใบเสร็จผ่านคำขออนุมัติจริง — ผู้อนุมัติต้องไม่ใช่ผู้ขอ */
export function voidReceiptApproved(
  prisma: PrismaClient,
  receipts: ReceiptsService,
  receiptId: string,
  reason: string,
  requestedById: string,
  approverId: string,
) {
  return withAssignedPermission(prisma, approverId, 'VOID_RECEIPT', async (rememberRequest) => {
    const request = await prisma.$transaction(async (tx) => {
      const { contract, snapshot } = await paymentApprovalSnapshot(tx, 'VOID_RECEIPT', receiptId);
      const receipt = await tx.receipt.findUniqueOrThrow({ where: { id: receiptId } });
      const affected = receipt.paymentId
        ? await tx.receipt.findMany({
            where: {
              paymentId: receipt.paymentId,
              deletedAt: null,
              isVoided: false,
              receiptType: { in: [...INSTALLMENT_MONEY_RECEIPT_TYPES] },
            },
          })
        : [receipt];
      return tx.paymentApprovalRequest.create({
        data: {
          action: 'VOID_RECEIPT',
          targetId: receiptId,
          contractId: contract.id,
          requestedById,
          reason,
          requiredPermissions: ['VOID_RECEIPT'],
          payload: approvalJson({}),
          snapshot,
          reviewSummary: approvalJson({
            amount: affected
              .reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0))
              .toFixed(2),
            receiptNumbers: affected.map((row) => row.receiptNumber),
          }),
        },
      });
    }, SERIALIZABLE);
    rememberRequest(request.id);
    return receipts.voidReceipt(receiptId, reason, requestedById, approverId, undefined, {
      requestId: request.id,
      actorId: approverId,
      reason: 'ผู้อนุมัติตรวจสอบรายการทดสอบแล้ว',
    });
  });
}
