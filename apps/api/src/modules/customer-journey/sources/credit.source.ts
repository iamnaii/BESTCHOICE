import type { JourneyEvent } from '@installment/shared';
import { creditHistoryAccess, roomAssignmentScope } from '../../credit-check/services/room-credit-access';
import { JOURNEY_CHAT_ROLES, asRecord, bahtText, dbTimeRange, finalizeSource, scanTake, staffActor, whenAny, type JourneySource } from './journey-window';

const DECISION_TITLES: Record<string, string> = { APPROVED: 'อนุมัติเครดิต', REJECTED: 'ไม่อนุมัติเครดิต', MANUAL_REVIEW: 'ส่งตรวจเครดิตเพิ่ม', PENDING: 'ตั้งผลเครดิตกลับเป็นรอตรวจ' };

/** กลุ่ม credit · สิทธิ์ creditHistoryAccess · ไม่อ่าน aiAnalysis/statementFiles · ไม่คัด overrideReason/evidenceNotes */
export const creditSource: JourneySource = async (prisma, customerIds, window, actor) => {
  const range = dbTimeRange(window);
  const take = scanTake(window);
  const seesChat = JOURNEY_CHAT_ROLES.has(actor.role);
  const checks = await prisma.creditCheck.findMany({
    where: { customerId: { in: customerIds }, deletedAt: null, ...creditHistoryAccess(actor) },
    select: { id: true, createdAt: true, roomAnalysis: { select: { roomId: true } } },
  });
  const checkIds = checks.map((check) => check.id);
  const newestFirst = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
  const [openers, analyses, decisions, approvals] = await Promise.all([
    whenAny(checkIds, () => prisma.customerJourneyEntry.findMany({ where: { kind: 'CREDIT_CHECK_OPENED_BY', refId: { in: checkIds }, deletedAt: null }, select: { refId: true, actorUser: { select: { id: true, name: true } } } })),
    whenAny(seesChat ? customerIds : [], () => prisma.roomCreditAnalysis.findMany({
      where: { status: 'COMPLETED', deletedAt: null, createdAt: range, room: { is: { customerId: { in: customerIds }, ...roomAssignmentScope(actor) } } },
      select: { id: true, roomId: true, createdAt: true }, orderBy: newestFirst, take,
    })),
    whenAny(checkIds, () => prisma.auditLog.findMany({ where: { action: 'CREDIT_CHECK_OVERRIDE', entity: 'credit_check', entityId: { in: checkIds }, createdAt: range }, select: { id: true, createdAt: true, newValue: true, user: { select: { id: true, name: true } } }, orderBy: newestFirst, take })),
    whenAny(checkIds, () => prisma.creditApproval.findMany({ where: { creditCheckId: { in: checkIds }, deletedAt: null, createdAt: range }, select: { id: true, createdAt: true, approvedMonthlyPayment: true, approvedBy: { select: { id: true, name: true } } }, orderBy: newestFirst, take })),
  ]);
  const openerOf = new Map(openers.map((row) => [row.refId, row.actorUser] as const));
  const events: JourneyEvent[] = checks.map((check): JourneyEvent => {
    const roomId = check.roomAnalysis?.roomId;
    const opener = openerOf.get(check.id);
    return {
      id: `credit-${check.id}`, type: 'CREDIT_CHECK_OPENED', group: 'credit', stage: 'CREDIT', timestamp: check.createdAt.toISOString(),
      title: roomId ? 'เปิดตรวจเครดิต (จากสเตทเม้นในแชท)' : 'เปิดตรวจเครดิต (ที่ร้าน)',
      actor: opener ? staffActor(opener) : null, // ผู้เปิดมีตั้งแต่ entry CREDIT_CHECK_OPENED_BY ขึ้น prod
      reliability: roomId ? 'approximate' : 'exact', origin: 'SOURCE', // นำเข้าจากแชท created_at ย้อนเป็นเวลา OCR
      ...(roomId && seesChat ? { href: `/inbox/${roomId}` } : {}),
    };
  });
  for (const a of analyses) events.push({ id: `statement-${a.id}`, type: 'CHAT_STATEMENT_ANALYZED', group: 'credit', stage: 'CREDIT', timestamp: a.createdAt.toISOString(), title: 'วิเคราะห์สเตทเม้นจากแชทแล้ว', actor: { type: 'STAFF' }, reliability: 'exact', origin: 'SOURCE', href: `/inbox/${a.roomId}` });
  for (const d of decisions) {
    const status = String(asRecord(d.newValue).status ?? '');
    events.push({ id: `creditdecision-${d.id}`, type: 'CREDIT_DECISION', group: 'credit', stage: 'CREDIT', timestamp: d.createdAt.toISOString(), title: DECISION_TITLES[status] ?? 'ปรับผลตรวจเครดิต', actor: staffActor(d.user), reliability: 'exact', origin: 'SOURCE', metadata: { status } });
  }
  for (const ap of approvals) events.push({ id: `creditapproval-${ap.id}`, type: 'CREDIT_LIMIT_APPROVED', group: 'credit', stage: 'CREDIT', timestamp: ap.createdAt.toISOString(), title: `อนุมัติค่างวดไม่เกิน ${bahtText(ap.approvedMonthlyPayment)} บาท/เดือน`, actor: staffActor(ap.approvedBy), reliability: 'exact', origin: 'SOURCE' });
  return finalizeSource(events, window);
};
