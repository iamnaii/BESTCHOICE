import { BadRequestException, ConflictException } from '@nestjs/common';
import { Customer, PaymentMethod, Prisma } from '@prisma/client';

/** Must run after lockCreditCustomer, in the same transaction as the credit claim. */
export async function assertCustomerContractPolicy(tx: Prisma.TransactionClient, customerId: string, role: string, override = false) {
  const activeContracts = await tx.contract.findMany({ where: { customerId, deletedAt: null,
    status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] } }, select: { id: true, contractNumber: true, status: true } });
  const canOverride = ['OWNER', 'BRANCH_MANAGER'].includes(role);
  if (activeContracts.length && !(canOverride && override)) throw new ConflictException({
    message: 'ลูกค้ายังมีสัญญาที่กำลังผ่อนอยู่ ไม่สามารถเปิดสัญญาใหม่ได้',
    code: 'CUSTOMER_HAS_ACTIVE_CONTRACT', activeContracts, canOverride,
  });
}

export function customerContractSnapshot(customer: Customer): Prisma.InputJsonValue {
  return {
    name: customer.name, prefix: customer.prefix, nickname: customer.nickname, nationalId: customer.nationalId,
    phone: customer.phone, phoneSecondary: customer.phoneSecondary, email: customer.email,
    lineIdFinance: customer.lineIdFinance, lineIdShop: customer.lineIdShop,
    occupation: customer.occupation, salary: customer.salary?.toString() ?? null, workplace: customer.workplace,
    addressIdCard: customer.addressIdCard, addressCurrent: customer.addressCurrent, addressWork: customer.addressWork,
    references: customer.references, birthDate: customer.birthDate, facebookLink: customer.facebookLink,
    facebookName: customer.facebookName, googleMapLink: customer.googleMapLink,
  };
}

/** Omitted method is a compatibility default only for a NEW receipt. Never backfill historical contracts. */
export function contractDownTender(amount: string | number, method?: string | null, reference?: string) {
  if (new Prisma.Decimal(amount).lte(0)) return { downPaymentMethod: null, downPaymentReference: null, downPaymentReceivedAt: null };
  if (method != null && !['CASH', 'BANK_TRANSFER', 'QR_EWALLET'].includes(method)) throw new BadRequestException('วิธีรับเงินดาวน์ไม่ถูกต้อง');
  return { downPaymentMethod: (method ?? 'CASH') as PaymentMethod, downPaymentReference: reference?.trim() || null,
    downPaymentReceivedAt: new Date() };
}
