import { Prisma, PrismaClient } from '@prisma/client';

/**
 * แหล่ง event ของสัญญา (โทรติดตาม · ชำระ · แจ้งเตือน · สถานะ/MDM · หนังสือ) — แยกออกมาจาก OverdueTimelineService.getFullTimeline
 * ใช้ร่วมกันระหว่าง GET /overdue/contracts/:id/full-timeline (ผลลัพธ์เดิม ล็อกด้วย timeline.service.golden.spec.ts)
 * และ source ของแท็บการเดินทางของลูกค้า (รับหลายสัญญา + ช่วงเวลา + keyset)
 * PAYMENT ยังใช้ updatedAt ตามเดิม — การเปลี่ยนเป็น paidDate เป็น PR แยก
 */

export type TimelineEventType =
  | 'CALL'
  | 'PAYMENT'
  | 'DUNNING_ACTION'
  | 'STATUS_CHANGE'
  | 'MDM'
  | 'LETTER';

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  timestamp: string;
  title: string;
  subtitle?: string;
  metadata?: Record<string, unknown>;
}

export interface ContractEventRow {
  contractId: string;
  /** ผู้โทร · ผู้บันทึกรับชำระ · ผู้กดส่งแจ้งเตือน · ผู้ทำรายการ audit · ผู้ส่งหนังสือ — null เมื่อระบบทำเอง */
  actorUserId: string | null;
  /**
   * รูปเดียวกับที่หน้า Collections ได้รับ
   * 🚨 PDPA: metadata.notes ของ CALL (callLog.notes) และ subtitle ของ DUNNING_ACTION (messageContent) มีไว้ให้หน้า Collections เท่านั้น
   * ผู้เรียกฝั่งการเดินทางของลูกค้าต้องสร้าง event ใหม่จาก field ที่อนุญาต ห้ามส่งต่อ subtitle/metadata ดิบ
   */
  event: TimelineEvent;
}

export interface ContractEventWindow {
  /** keyset ของการเรียง timestamp DESC, id DESC — คืนเฉพาะ event ที่ (timestamp, id) น้อยกว่าคู่นี้ */
  before?: { ts: string; id: string };
  /** ขอบล่าง รวมค่าที่เท่ากัน */
  from?: Date;
  /** ขอบบน รวมค่าที่เท่ากัน */
  to?: Date;
  /** จำนวนแถวสูงสุดต่อ source — ไม่ส่ง = CONTRACT_EVENT_SOURCE_TAKE (พฤติกรรมเดิมของ full-timeline) */
  limit?: number;
}

export type ContractEventPrisma = Pick<
  PrismaClient,
  'callLog' | 'payment' | 'dunningAction' | 'auditLog' | 'contractLetter'
>;

export const CONTRACT_EVENT_SOURCE_TAKE = 50;

const CALL_RESULT_LABELS: Record<string, string> = {
  NO_ANSWER: 'ไม่รับสาย',
  ANSWERED: 'รับสาย',
  PROMISED: 'นัดชำระ',
  REFUSED: 'ปฏิเสธ',
  WRONG_NUMBER: 'เบอร์ผิด',
  OTHER: 'อื่น ๆ',
};

function formatAuditTitle(action: string, newValue: Record<string, unknown> | null): string {
  switch (action) {
    case 'STATUS_CHANGE':
      return `สถานะสัญญาเปลี่ยน: ${newValue?.from ?? '?'} → ${newValue?.to ?? '?'}`;
    case 'DUNNING_ESCALATION_APPROVED':
      return `อนุมัติเลื่อนระดับเตือน: ${newValue?.dunningStage ?? '?'}`;
    case 'MDM_LOCK_APPROVED':
      return 'ล็อคเครื่องแล้ว';
    case 'MDM_UNLOCK':
      return 'ปลดล็อคเครื่องแล้ว';
    default:
      return action;
  }
}

/** ขอบบนใช้ค่าที่น้อยกว่าระหว่าง to กับเวลาของ cursor — กรองซ้ำแบบละเอียดด้วย isBeforeCursor หลังอ่าน */
function timeRange(window: ContractEventWindow): Prisma.DateTimeFilter | null {
  const uppers: number[] = [];
  if (window.to) uppers.push(window.to.getTime());
  if (window.before) uppers.push(new Date(window.before.ts).getTime());
  if (!window.from && uppers.length === 0) return null;
  return {
    ...(window.from ? { gte: window.from } : {}),
    ...(uppers.length > 0 ? { lte: new Date(Math.min(...uppers)) } : {}),
  };
}

function isBeforeCursor(event: TimelineEvent, before: ContractEventWindow['before']): boolean {
  if (!before) return true;
  const cursorTs = new Date(before.ts).toISOString();
  return event.timestamp < cursorTs || (event.timestamp === cursorTs && event.id < before.id);
}

export async function contractEventSources(
  prisma: ContractEventPrisma,
  contractIds: string[],
  window: ContractEventWindow = {},
): Promise<ContractEventRow[]> {
  if (contractIds.length === 0) return [];
  const take = window.limit ?? CONTRACT_EVENT_SOURCE_TAKE;
  const range = timeRange(window);

  const [calls, payments, dunningActions, audits, letters] = await Promise.all([
    prisma.callLog.findMany({
      where: { contractId: { in: contractIds }, ...(range ? { calledAt: range } : {}) },
      include: { caller: { select: { id: true, name: true } } },
      orderBy: { calledAt: 'desc' },
      take,
    }),
    prisma.payment.findMany({
      where: { contractId: { in: contractIds }, status: 'PAID', ...(range ? { updatedAt: range } : {}) },
      orderBy: { updatedAt: 'desc' },
      take,
    }),
    prisma.dunningAction.findMany({
      where: { contractId: { in: contractIds }, deletedAt: null, ...(range ? { createdAt: range } : {}) },
      include: { dunningRule: { select: { name: true, channel: true } } },
      orderBy: { createdAt: 'desc' },
      take,
    }),
    prisma.auditLog.findMany({
      where: {
        entity: { in: ['contract', 'mdm_lock_request'] },
        entityId: { in: contractIds },
        action: {
          in: [
            'STATUS_CHANGE',
            'DUNNING_ESCALATION_APPROVED',
            'MDM_LOCK_APPROVED',
            'MDM_UNLOCK',
          ],
        },
        ...(range ? { createdAt: range } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    }),
    prisma.contractLetter.findMany({
      where: {
        contractId: { in: contractIds },
        deletedAt: null,
        status: { in: ['DISPATCHED', 'DELIVERED'] },
        ...(range ? { OR: [{ dispatchedAt: range }, { dispatchedAt: null, createdAt: range }] } : {}),
      },
      orderBy: { dispatchedAt: 'desc' },
      take,
    }),
  ]);

  const rows: ContractEventRow[] = [];

  for (const c of calls) {
    rows.push({
      contractId: c.contractId,
      actorUserId: c.callerId ?? null,
      event: {
        id: `call-${c.id}`,
        type: 'CALL',
        timestamp: c.calledAt.toISOString(),
        title: CALL_RESULT_LABELS[c.result] ?? c.result,
        subtitle: c.caller?.name ?? undefined,
        metadata: {
          result: c.result,
          notes: c.notes ?? undefined,
          settlementDate: c.settlementDate ?? undefined,
          // P2 (Customer 360) — voice memo surfaced inline on the Collections timeline.
          callLogId: c.id,
          voiceMemoUrl: c.voiceMemoUrl ?? undefined,
          voiceMemoTier: c.voiceMemoTier ?? undefined,
        },
      },
    });
  }

  for (const p of payments) {
    rows.push({
      contractId: p.contractId,
      actorUserId: p.recordedById ?? null,
      event: {
        id: `payment-${p.id}`,
        type: 'PAYMENT',
        timestamp: p.updatedAt.toISOString(),
        title: `ชำระ ${Number(p.amountPaid.toFixed(2)).toLocaleString('th-TH')} ฿ (งวด ${p.installmentNo})`,
        metadata: { amount: p.amountPaid.toString(), method: p.paymentMethod ?? undefined },
      },
    });
  }

  for (const d of dunningActions) {
    rows.push({
      contractId: d.contractId,
      actorUserId: d.executedById ?? null,
      event: {
        id: `dunning-${d.id}`,
        type: 'DUNNING_ACTION',
        timestamp: d.createdAt.toISOString(),
        title: `ส่ง ${d.channel}: ${d.dunningRule.name}`,
        subtitle:
          d.messageContent
            ? d.messageContent.substring(0, 80) + (d.messageContent.length > 80 ? '…' : '')
            : undefined,
        metadata: { status: d.status, channel: d.channel },
      },
    });
  }

  for (const a of audits) {
    const isMdm = a.action.startsWith('MDM_');
    rows.push({
      contractId: a.entityId,
      actorUserId: a.userId ?? null,
      event: {
        id: `audit-${a.id}`,
        type: isMdm ? 'MDM' : 'STATUS_CHANGE',
        timestamp: a.createdAt.toISOString(),
        title: formatAuditTitle(a.action, a.newValue as Record<string, unknown> | null),
        metadata: { action: a.action, newValue: a.newValue ?? undefined },
      },
    });
  }

  for (const l of letters) {
    rows.push({
      contractId: l.contractId,
      actorUserId: l.dispatchedById ?? null,
      event: {
        id: `letter-${l.id}`,
        type: 'LETTER',
        timestamp: (l.dispatchedAt ?? l.createdAt).toISOString(),
        title: `ส่งหนังสือ: ${l.letterType} (EMS: ${l.trackingNumber ?? '—'})`,
        metadata: { status: l.status, letterNumber: l.letterNumber },
      },
    });
  }

  return rows.filter((row) => isBeforeCursor(row.event, window.before));
}
