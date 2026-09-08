import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CreditApproval, CreditCheck, Customer, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { ApproveCreditAffordabilityDto, CreditAffordabilityDto } from '../dto/credit-affordability.dto';
import { calculateAffordability, CREDIT_AFFORDABILITY_POLICY } from './credit-affordability';
import { creditHistoryAccess, CreditHistoryActor } from './room-credit-access';
import { lockCreditCustomer, lockCreditCheck } from './room-credit-history';

type Tx = Prisma.TransactionClient;
type Commitment = { id: string; contractNumber: string; monthlyPayment: number };
export const approvalHistoryInclude = {
  where: { deletedAt: null }, orderBy: { createdAt: 'desc' as const }, take: 1,
  include: { approvedBy: { select: { id: true, name: true } } },
};
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function customerFinancialHash(customer: Customer) {
  return hash([customer.salary, customer.salaryPayDay, customer.occupation, customer.workplace]);
}

function sourceFinancialHash(check: CreditCheck) {
  return hash([check.aiAnalysis, check.statementFiles, check.salarySlipFiles, check.salaryVerified,
    check.salaryPayDay, check.statementAvgIncome, check.statementAvgExpense, check.statementAvgBalance]);
}

/** A pending/part-paid installment remains a contractual monthly obligation. */
async function readCommitments(tx: Tx, customerId: string, excludeContractId?: string | null) {
  const excluded = excludeContractId ? [excludeContractId] : [];
  if (excludeContractId) {
    const replacement = await tx.contract.findUnique({ where: { id: excludeContractId, customerId, deletedAt: null },
      select: { exchangedFromContractId: true, exchangeRequestsAsNew: {
        where: { status: 'APPROVED', deletedAt: null },
        select: { oldContractId: true, oldContract: { select: { customerId: true } } },
      } } });
    if (replacement?.exchangedFromContractId && replacement.exchangeRequestsAsNew?.some(request =>
      request.oldContractId === replacement.exchangedFromContractId && request.oldContract.customerId === customerId)) {
      excluded.push(replacement.exchangedFromContractId);
    }
  }
  const contracts = await tx.contract.findMany({
    where: { customerId, deletedAt: null, ...(excluded.length ? { id: { notIn: excluded } } : {}),
      status: { in: ['DRAFT', 'ACTIVE', 'OVERDUE', 'DEFAULT', 'TERMINATED', 'CLOSED_BAD_DEBT'] } },
    orderBy: { id: 'asc' },
    select: { id: true, contractNumber: true, monthlyPayment: true,
      payments: { where: { deletedAt: null }, select: { amountDue: true, status: true } } },
  });
  const commitments: Commitment[] = [];
  for (const contract of contracts) {
    const unpaid = contract.payments.filter(payment => payment.status !== 'PAID');
    const amount = unpaid.length
      ? Prisma.Decimal.max(...unpaid.map(payment => payment.amountDue))
      : contract.payments.length ? new Prisma.Decimal(0) : new Prisma.Decimal(contract.monthlyPayment);
    if (amount.gt(0)) commitments.push({ id: contract.id, contractNumber: contract.contractNumber,
      monthlyPayment: amount.toNumber() });
  }
  return { commitments, internalMonthlyDebt: commitments.reduce(
    (sum, item) => sum.plus(item.monthlyPayment), new Prisma.Decimal(0)).toNumber() };
}

function validateBasis(input: CreditAffordabilityDto) {
  calculateAffordability({ ...input, internalMonthlyDebt: 0 });
  if (!Number.isInteger(input.salaryPayDay) || input.salaryPayDay < 1 || input.salaryPayDay > 31) {
    throw new BadRequestException('กรุณายืนยันวันเงินเดือนออก 1–31 (31 คือสิ้นเดือน)');
  }
  if (typeof input.evidenceNotes !== 'string' || input.evidenceNotes.trim().length < 20) {
    throw new BadRequestException('กรุณาระบุหลักฐานรายได้ รายจ่าย หนี้ และวันรับเงินอย่างน้อย 20 ตัวอักษร');
  }
}

async function readContext(tx: Tx, creditCheckId: string, input: CreditAffordabilityDto, actor?: CreditHistoryActor) {
  validateBasis(input);
  const check = await tx.creditCheck.findUnique({
    where: { id: creditCheckId, deletedAt: null, AND: creditHistoryAccess(actor) }, include: { customer: true },
  });
  if (!check || check.customer.deletedAt) throw new NotFoundException('ไม่พบข้อมูลตรวจเครดิต');
  if (check.checkType !== 'FULL') throw new BadRequestException('ต้องตรวจเครดิต FULL ก่อนอนุมัติยอดผ่อน');
  const latest = await tx.creditCheck.findFirst({
    where: { customerId: check.customerId, checkType: 'FULL', deletedAt: null },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true },
  });
  if (latest?.id !== check.id) throw new ConflictException('มีผลตรวจเครดิตใหม่แล้ว กรุณาพิจารณาผลล่าสุด');
  const debts = await readCommitments(tx, check.customerId, check.contractId);
  // A review replaces the one outstanding offer, rather than creating a second reservation.
  const openApprovals = await tx.creditApproval.findMany({
    where: { customerId: check.customerId, usedByContractId: null, supersededAt: null, deletedAt: null },
    orderBy: { id: 'asc' }, select: { id: true, approvedMonthlyPayment: true },
  });
  const boundApprovals = check.contractId ? await tx.creditApproval.findMany({
    where: { usedByContractId: check.contractId, supersededAt: null, deletedAt: null },
    orderBy: { id: 'asc' }, select: { id: true, approvedMonthlyPayment: true },
  }) : [];
  const calculated = calculateAffordability({ ...input, internalMonthlyDebt: debts.internalMonthlyDebt });
  const sourceHash = sourceFinancialHash(check);
  const customerHash = customerFinancialHash(check.customer);
  const contextToken = hash({ input: [input.verifiedMonthlyIncome, input.livingExpenses,
    input.externalMonthlyDebt, input.salaryPayDay, input.evidenceNotes], sourceHash, customerHash, status: check.status,
    latestId: latest.id, contractId: check.contractId, commitments: debts.commitments, openApprovals, boundApprovals });
  return { check, sourceHash, customerHash, preview: { creditCheckId, ...input, ...debts, ...calculated,
    contextToken, replacingPendingApproval: openApprovals.length > 0 } };
}

export class CreditApprovalService {
  constructor(private prisma: PrismaService) {}

  async preview(creditCheckId: string, input: CreditAffordabilityDto, actor?: CreditHistoryActor) {
    return this.prisma.$transaction(async tx => {
      const check = await tx.creditCheck.findUnique({ where: { id: creditCheckId, deletedAt: null } });
      if (!check) throw new NotFoundException('ไม่พบข้อมูลตรวจเครดิต');
      await lockCreditCustomer(tx, check.customerId);
      await lockCreditCheck(tx, creditCheckId);
      return (await readContext(tx, creditCheckId, input, actor)).preview;
    });
  }

  /** Caller already holds the customer lock and writes status + audit in the same transaction. */
  async approveInTransaction(tx: Tx, check: CreditCheck, input: ApproveCreditAffordabilityDto, userId: string) {
    const basis: CreditAffordabilityDto = { verifiedMonthlyIncome: input.verifiedMonthlyIncome,
      livingExpenses: input.livingExpenses, externalMonthlyDebt: input.externalMonthlyDebt,
      salaryPayDay: input.salaryPayDay, evidenceNotes: input.evidenceNotes };
    const context = await readContext(tx, check.id, basis);
    if (context.preview.contextToken !== input.contextToken) {
      throw new ConflictException('ข้อมูลประกอบการอนุมัติเปลี่ยนแล้ว กรุณาคำนวณและตรวจยอดใหม่');
    }
    if (input.confirmed !== true) throw new BadRequestException('กรุณายืนยันตัวเลขและหลักฐานก่อนอนุมัติ');
    if (!Number.isFinite(input.approvedMonthlyPayment) || input.approvedMonthlyPayment <= 0 ||
      input.approvedMonthlyPayment > context.preview.maximumMonthlyPayment) {
      throw new BadRequestException(`ยอดอนุมัติต้องมากกว่า 0 และไม่เกิน ${context.preview.maximumMonthlyPayment.toLocaleString('th-TH')} บาท/เดือน`);
    }
    if (!check.statementFiles.length && !check.salarySlipFiles?.length) {
      throw new BadRequestException('กรุณาแนบเอกสารรายได้ก่อนอนุมัติยอดผ่อน');
    }
    let firstPaymentDue: Date | undefined;
    if (check.contractId) {
      const contract = await tx.contract.findUnique({ where: { id: check.contractId, deletedAt: null },
        include: { payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } } } });
      if (!contract || contract.customerId !== check.customerId) throw new BadRequestException('ไม่พบสัญญาที่ผูกกับผลเครดิต');
      assertApprovalAmounts({ approvedMonthlyPayment: new Prisma.Decimal(input.approvedMonthlyPayment), salaryPayDay: input.salaryPayDay },
        { paymentDueDay: contract.paymentDueDay,
          monthlyAmounts: contract.payments.length ? contract.payments.map(payment => Number(payment.amountDue)) : [Number(contract.monthlyPayment)] });
      firstPaymentDue = contract.payments[0]?.dueDate;
    }
    const now = new Date();
    await tx.creditApproval.updateMany({
      where: { customerId: check.customerId, deletedAt: null, supersededAt: null,
        OR: [{ usedByContractId: null }, ...(check.contractId ? [{ usedByContractId: check.contractId }] : [])] },
      data: { supersededAt: now },
    });
    return tx.creditApproval.create({ data: {
      creditCheckId: check.id, customerId: check.customerId, approvedById: userId,
      policyVersion: CREDIT_AFFORDABILITY_POLICY,
      ...basis, internalMonthlyDebt: context.preview.internalMonthlyDebt,
      remainingIncome: context.preview.remainingIncome,
      maximumMonthlyPayment: context.preview.maximumMonthlyPayment,
      approvedMonthlyPayment: input.approvedMonthlyPayment,
      sourceFinancialHash: context.sourceHash, customerFinancialHash: context.customerHash,
      commitments: context.preview.commitments,
      ...(check.contractId ? { usedByContractId: check.contractId, usedAt: now, usedFirstPaymentDue: firstPaymentDue } : {}),
    } });
  }
}

export interface ContractCreditTerms {
  customerId: string;
  contractId: string;
  creditApprovalId?: string;
  monthlyAmounts: number[];
  paymentDueDay: number | null | undefined;
  firstPaymentDue?: Date;
  actor?: CreditHistoryActor;
}

export function assertApprovalAmounts(approval: Pick<CreditApproval, 'approvedMonthlyPayment' | 'salaryPayDay'>,
  terms: Pick<ContractCreditTerms, 'monthlyAmounts' | 'paymentDueDay'>) {
  if (terms.paymentDueDay !== approval.salaryPayDay) {
    throw new BadRequestException('วันครบกำหนดชำระต้องตรงกับวันเงินเดือนในผลอนุมัติ');
  }
  if (!terms.monthlyAmounts.length || terms.monthlyAmounts.some(amount =>
    !Number.isFinite(amount) || amount <= 0 || new Prisma.Decimal(amount).toDecimalPlaces(2).gt(approval.approvedMonthlyPayment))) {
    throw new BadRequestException(`ค่างวดทุกงวดต้องไม่เกินยอดอนุมัติ ${approval.approvedMonthlyPayment.toString()} บาท/เดือน กรุณาปรับเงินดาวน์หรือแผนผ่อน`);
  }
}

async function validateCurrentApproval(tx: Tx,
  approval: CreditApproval & { creditCheck: CreditCheck; customer: Customer }, terms: ContractCreditTerms) {
  await lockCreditCheck(tx, approval.creditCheckId);
  const currentCheck = await tx.creditCheck.findUnique({ where: { id: approval.creditCheckId, deletedAt: null } });
  if (!currentCheck) throw new BadRequestException('ไม่พบผลตรวจเครดิตที่อนุมัติ');
  approval = { ...approval, creditCheck: currentCheck };
  if (approval.creditCheck.checkType !== 'FULL' || approval.creditCheck.status !== 'APPROVED' ||
    approval.creditCheck.deletedAt || approval.customer.deletedAt || approval.policyVersion !== CREDIT_AFFORDABILITY_POLICY) {
    throw new BadRequestException('กรุณาอนุมัติยอดผ่อนจากผลตรวจเครดิต FULL ก่อนทำสัญญา');
  }
  const latest = await tx.creditCheck.findFirst({
    where: { customerId: terms.customerId, checkType: 'FULL', deletedAt: null },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true },
  });
  if (latest?.id !== approval.creditCheckId || sourceFinancialHash(approval.creditCheck) !== approval.sourceFinancialHash ||
    customerFinancialHash(approval.customer) !== approval.customerFinancialHash) {
    throw new ConflictException('ข้อมูลการเงินหรือผลตรวจเครดิตเปลี่ยนแล้ว กรุณาประเมินยอดอนุมัติใหม่');
  }
  const debts = await readCommitments(tx, terms.customerId, terms.contractId);
  const previous = approval.commitments as unknown as Commitment[];
  if (debts.commitments.some(item => !previous.some(old => old.id === item.id && old.monthlyPayment >= item.monthlyPayment))) {
    throw new ConflictException('มีภาระผ่อนใหม่หรือค่างวดเพิ่มขึ้น กรุณาประเมินยอดอนุมัติใหม่');
  }
  const calculated = calculateAffordability({ verifiedMonthlyIncome: Number(approval.verifiedMonthlyIncome),
    livingExpenses: Number(approval.livingExpenses), externalMonthlyDebt: Number(approval.externalMonthlyDebt),
    internalMonthlyDebt: debts.internalMonthlyDebt });
  if (new Prisma.Decimal(approval.approvedMonthlyPayment).gt(calculated.maximumMonthlyPayment)) {
    throw new ConflictException('ยอดอนุมัติเดิมเกินเพดานจากภาระล่าสุด กรุณาประเมินใหม่');
  }
  assertApprovalAmounts(approval, terms);
}

/** Claim once, inside the same transaction that creates the contract and its payments. */
export async function claimCreditApproval(tx: Tx, terms: ContractCreditTerms) {
  await lockCreditCustomer(tx, terms.customerId);
  const approval = await tx.creditApproval.findFirst({
    where: { customerId: terms.customerId, ...(terms.creditApprovalId ? { id: terms.creditApprovalId } : {}),
      usedByContractId: null, supersededAt: null, deletedAt: null,
      creditCheck: { is: { deletedAt: null, AND: creditHistoryAccess(terms.actor) } } },
    include: { creditCheck: true, customer: true }, orderBy: { createdAt: 'desc' },
  });
  if (!approval) throw new BadRequestException('ต้องมีผลอนุมัติยอดผ่อนที่ยังไม่ใช้ก่อนสร้างสัญญา');
  await validateCurrentApproval(tx, approval, terms);
  const claimed = await tx.creditApproval.updateMany({
    where: { id: approval.id, usedByContractId: null, supersededAt: null, deletedAt: null },
    data: { usedByContractId: terms.contractId, usedAt: new Date(), usedFirstPaymentDue: terms.firstPaymentDue },
  });
  if (claimed.count !== 1) throw new ConflictException('ผลอนุมัตินี้ถูกใช้แล้ว กรุณาประเมินใหม่');
  const linked = await tx.creditCheck.updateMany({
    where: { id: approval.creditCheckId, contractId: null, deletedAt: null, status: 'APPROVED' },
    data: { contractId: terms.contractId },
  });
  if (linked.count !== 1) throw new ConflictException('ผลตรวจเครดิตนี้ผูกกับสัญญาอื่นแล้ว');
  return approval;
}

/** Re-read the persisted approval before changing money or activating any newly financed contract. */
export async function assertContractCreditApproval(tx: Tx, terms: ContractCreditTerms) {
  await lockCreditCustomer(tx, terms.customerId);
  const approval = await tx.creditApproval.findFirst({
    where: { usedByContractId: terms.contractId, customerId: terms.customerId, supersededAt: null, deletedAt: null },
    include: { creditCheck: true, customer: true },
  });
  if (!approval) throw new BadRequestException('สัญญานี้ยังไม่มีผลอนุมัติยอดผ่อน กรุณาพิจารณายอดในหน้าตรวจเครดิต');
  await validateCurrentApproval(tx, approval, terms);
  if (approval.usedFirstPaymentDue && approval.usedFirstPaymentDue.getTime() !== terms.firstPaymentDue?.getTime()) {
    throw new ConflictException('วันครบกำหนดงวดแรกเปลี่ยนแล้ว กรุณาพิจารณาสัญญาและยอดอนุมัติใหม่');
  }
  return approval;
}


/** An exchange starts a fresh review while retaining the original room/document ACL. */
export async function bindExchangeCreditCheck(tx: Tx, customerId: string, contractId: string, actor: CreditHistoryActor) {
  await lockCreditCustomer(tx, customerId);
  const check = await tx.creditCheck.findFirst({
    where: { customerId, checkType: 'FULL', deletedAt: null, AND: creditHistoryAccess(actor) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  if (!check || check.contractId) {
    throw new BadRequestException('กรุณาวิเคราะห์สเตทเม้นรอบใหม่ของลูกค้าก่อนเปลี่ยนเครื่อง แล้วพิจารณายอดผ่อนบนสัญญาใหม่');
  }
  await lockCreditCheck(tx, check.id);
  const linked = await tx.creditCheck.updateMany({
    where: { id: check.id, contractId: null, deletedAt: null },
    data: { contractId },
  });
  if (linked.count !== 1) throw new ConflictException('ผลเครดิตถูกใช้แล้ว กรุณาวิเคราะห์รอบใหม่');
  await tx.creditApproval.updateMany({
    where: { creditCheckId: check.id, usedByContractId: null, supersededAt: null, deletedAt: null },
    data: { supersededAt: new Date() },
  });
}
