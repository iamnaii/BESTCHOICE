import { Prisma } from '@prisma/client';

/** All writers (link and analysis completion) hold the same ChatRoom row lock. */
export async function lockCreditRoom(tx: Prisma.TransactionClient, roomId: string) {
  await tx.$queryRaw`SELECT id FROM chat_rooms WHERE id = ${roomId} FOR UPDATE`;
}

/** Compatible with the FK KEY SHARE held when another room links this customer. */
export async function lockCreditCustomer(tx: Prisma.TransactionClient, customerId: string) {
  await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId} FOR NO KEY UPDATE`;
}

/** Legacy OCR writers update this row directly; lock it after the customer, then re-read. */
export async function lockCreditCheck(tx: Prisma.TransactionClient, creditCheckId: string) {
  await tx.$queryRaw`SELECT id FROM credit_checks WHERE id = ${creditCheckId} FOR UPDATE`;
}

export function creditFileUrl(roomId: string, fileId: string) {
  return `/staff-chat/rooms/${roomId}/credit-check/files/${fileId}`;
}

/** Import once, never invoke the legacy scoring job or overwrite a reviewed record. */
export async function linkRoomCreditHistory(
  tx: Prisma.TransactionClient,
  roomId: string,
  customerId: string,
) {
  const analyses = await tx.roomCreditAnalysis.findMany({
    where: { roomId, status: 'COMPLETED', creditCheckId: null, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  if (!analyses.length) return;
  // Serialize the summary with manager decisions, which also update this customer.
  await lockCreditCustomer(tx, customerId);
  const importedIds = new Set<string>();
  for (const analysis of analyses) {
    const result = analysis.result as Record<string, Prisma.JsonValue>;
    const amount = (key: string) =>
      typeof result[key] === 'number' && Number.isFinite(result[key])
        ? new Prisma.Decimal(result[key] as number)
        : null;
    const check = await tx.creditCheck.create({
      data: {
        createdAt: analysis.createdAt,
        customerId,
        status: 'MANUAL_REVIEW',
        checkType: 'FULL',
        bankName: typeof result.bankName === 'string' ? result.bankName : null,
        statementBankName: typeof result.bankName === 'string' ? result.bankName : null,
        statementMonths: typeof result.statementMonths === 'number' ? result.statementMonths : 0,
        statementFiles: analysis.fileIds.map((id) => creditFileUrl(roomId, id)),
        statementAvgIncome: amount('monthlyIncome'),
        statementAvgExpense: amount('monthlyExpense'),
        statementAvgBalance: amount('averageBalance'),
        aiAnalysis: { ...result, source: 'chat-statement', roomId, roomAnalysisId: analysis.id },
        aiScore: null,
        aiSummary: 'อ่านสเตทเม้นจากแชทแล้ว — รอผู้จัดการพิจารณาตัวเลขและเอกสาร',
      },
    });
    await tx.roomCreditAnalysis.update({
      where: { id: analysis.id },
      data: { creditCheckId: check.id },
    });
    importedIds.add(check.id);
  }
  const latest = await tx.creditCheck.findFirst({
    where: { customerId, checkType: 'FULL', deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true },
  });
  if (latest && importedIds.has(latest.id) && latest.status === 'MANUAL_REVIEW') {
    await tx.customer.update({
      where: { id: customerId },
      data: { creditCheckStatus: 'UNDER_REVIEW' },
    });
  }
}
