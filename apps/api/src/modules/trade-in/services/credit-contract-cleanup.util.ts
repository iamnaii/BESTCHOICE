import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { creditSnapshot } from './trade-in-credit.service';

/** Keep a canceled credit purchase out of sales/receivable/commission reports.
 * Runs in the contract transaction; settled money must be unwound first. */
export async function cleanupCreditContractSale(tx: Prisma.TransactionClient,
  contract: { id: string; status: string; tradeInCreditSnapshot?: Prisma.JsonValue }, actorId: string, reason: string) {
  if (!creditSnapshot(contract.tradeInCreditSnapshot)) return;
  const sales = await tx.sale.findMany({ where: { contractId: contract.id, deletedAt: null } });
  if (!sales.length) return;
  const ids = sales.map(s => s.id);
  if (sales.some(s => s.onlineOrderId || s.bundleProductIds.length) || await tx.booking.findFirst({
    where: { convertedToSaleId: { in: ids }, deletedAt: null }, select: { id: true } })) {
    throw new BadRequestException('รายการเทิร์นนี้ผูกการจอง/คำสั่งซื้อหรือของแถม ต้องยกเลิกรายการที่เกี่ยวข้องก่อน');
  }
  const receivables = await tx.financeReceivable.findMany({ where: { saleId: { in: ids }, deletedAt: null } });
  const interCompany = await tx.interCompanyTransaction.findMany({ where: {
    OR: [{ contractId: contract.id }, { saleId: { in: ids } }], deletedAt: null } });
  if (receivables.some(r => ['RECEIVED', 'PARTIALLY_RECEIVED'].includes(r.status) || Number(r.receivedAmount) > 0)
    || interCompany.some(r => r.status === 'RECONCILED' || r.reconciledAt || r.journalEntryId)) {
    throw new BadRequestException('รายการนี้รับเงินหรือกระทบยอดแล้ว ต้องกลับรายการรับเงินที่เกี่ยวข้องก่อนคืนเครดิตเทิร์น');
  }
  if (contract.status === 'DRAFT' && await tx.interCoSettlementItem.findFirst({ where: {
    contractId: contract.id, deletedAt: null, batch: { status: { in: ['DRAFT', 'PENDING_APPROVAL', 'POSTED'] }, deletedAt: null } }, select: { id: true } })) {
    throw new BadRequestException('ร่างสัญญานี้อยู่ในชุดจ่ายระหว่างบริษัท ต้องยกเลิกชุดจ่ายก่อน');
  }
  const commissions = await tx.salesCommission.findMany({ where: {
    OR: [{ contractId: contract.id }, { saleId: { in: ids } }], deletedAt: null, status: { not: 'CLAWED_BACK' } } });
  if (commissions.some(c => !['PENDING', 'APPROVED'].includes(c.status) || c.paidAt || Number(c.paidAmount) > 0)) {
    throw new BadRequestException('ค่าคอมรายการนี้จ่ายแล้ว ต้องเรียกคืนค่าคอมก่อนคืนเครดิตเทิร์น');
  }
  const payouts = commissions.length ? await tx.commissionPayout.findMany({ where: { deletedAt: null,
    OR: commissions.map(c => ({ salespersonId: c.salespersonId, period: c.period })) } }) : [];
  const covering = payouts.filter(p => commissions.some(c => c.salespersonId === p.salespersonId
    && c.period === p.period && (!p.generatedAt || c.createdAt <= p.generatedAt)));
  if (covering.some(p => !['DRAFT', 'CANCELLED'].includes(p.status))) {
    throw new BadRequestException('ค่าคอมรายการนี้อยู่ในรอบจ่ายที่อนุมัติแล้ว ต้องยกเลิกรอบจ่ายก่อนคืนเครดิตเทิร์น');
  }
  const now = new Date();
  for (const payout of covering.filter(p => p.status === 'DRAFT')) {
    const result = await tx.commissionPayout.updateMany({ where: { id: payout.id, status: 'DRAFT', deletedAt: null }, data: { deletedAt: now } });
    if (result.count !== 1) throw new ConflictException('รอบจ่ายค่าคอมเปลี่ยนแล้ว กรุณาตรวจใหม่');
  }
  if (commissions.length) {
    const result = await tx.salesCommission.updateMany({ where: { id: { in: commissions.map(c => c.id) },
      status: { in: ['PENDING', 'APPROVED'] }, paidAt: null, OR: [{ paidAmount: null }, { paidAmount: 0 }], deletedAt: null },
      data: { status: 'CLAWED_BACK', clawbackAt: now, clawbackPercent: 100, clawbackReason: reason } });
    if (result.count !== commissions.length) throw new ConflictException('สถานะค่าคอมเปลี่ยนแล้ว กรุณาตรวจใหม่');
  }
  for (const receivable of receivables) {
    const result = await tx.financeReceivable.updateMany({ where: { id: receivable.id, status: receivable.status,
      receivedAmount: receivable.receivedAmount, deletedAt: null }, data: { deletedAt: now } });
    if (result.count !== 1) throw new ConflictException('สถานะรับเงินเปลี่ยนแล้ว กรุณาตรวจใหม่');
  }
  for (const item of interCompany) {
    const result = await tx.interCompanyTransaction.updateMany({ where: { id: item.id, status: item.status,
      journalEntryId: null, reconciledAt: null, deletedAt: null }, data: { status: 'CANCELLED', deletedAt: now } });
    if (result.count !== 1) throw new ConflictException('สถานะกระทบยอดเปลี่ยนแล้ว กรุณาตรวจใหม่');
  }
  await tx.sale.updateMany({ where: { id: { in: ids } }, data: { deletedAt: now, voidReason: reason, voidedById: actorId } });
}
