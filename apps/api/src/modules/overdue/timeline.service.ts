import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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

const CALL_RESULT_LABELS: Record<string, string> = {
  NO_ANSWER: 'ไม่รับสาย',
  ANSWERED: 'รับสาย',
  PROMISED: 'นัดชำระ',
  REFUSED: 'ปฏิเสธ',
  WRONG_NUMBER: 'เบอร์ผิด',
  OTHER: 'อื่น ๆ',
};

@Injectable()
export class OverdueTimelineService {
  constructor(private prisma: PrismaService) {}

  async getFullTimeline(contractId: string): Promise<TimelineEvent[]> {
    // Verify contract exists (avoid leaking other tenants' data via guessed IDs)
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: { id: true },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    const [calls, payments, dunningActions, audits, letters] = await Promise.all([
      this.prisma.callLog.findMany({
        where: { contractId },
        include: { caller: { select: { id: true, name: true } } },
        orderBy: { calledAt: 'desc' },
        take: 50,
      }),
      this.prisma.payment.findMany({
        where: { contractId, status: 'PAID' },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      }),
      this.prisma.dunningAction.findMany({
        where: { contractId, deletedAt: null },
        include: { dunningRule: { select: { name: true, channel: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.auditLog.findMany({
        where: {
          entity: { in: ['contract', 'mdm_lock_request'] },
          entityId: contractId,
          action: {
            in: [
              'STATUS_CHANGE',
              'DUNNING_ESCALATION_APPROVED',
              'MDM_LOCK_APPROVED',
              'MDM_UNLOCK',
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.contractLetter.findMany({
        where: { contractId, deletedAt: null, status: { in: ['DISPATCHED', 'DELIVERED'] } },
        orderBy: { dispatchedAt: 'desc' },
        take: 50,
      }),
    ]);

    const events: TimelineEvent[] = [];

    for (const c of calls) {
      events.push({
        id: `call-${c.id}`,
        type: 'CALL',
        timestamp: c.calledAt.toISOString(),
        title: CALL_RESULT_LABELS[c.result] ?? c.result,
        subtitle: c.caller?.name ?? undefined,
        metadata: {
          result: c.result,
          notes: c.notes ?? undefined,
          settlementDate: c.settlementDate ?? undefined,
          // P2 Task 4 — voice memo surfaced inline on Customer 360 timeline.
          callLogId: c.id,
          voiceMemoUrl: c.voiceMemoUrl ?? undefined,
          voiceMemoTier: c.voiceMemoTier ?? undefined,
        },
      });
    }

    for (const p of payments) {
      events.push({
        id: `payment-${p.id}`,
        type: 'PAYMENT',
        timestamp: p.updatedAt.toISOString(),
        title: `ชำระ ${Number(p.amountPaid.toFixed(2)).toLocaleString('th-TH')} ฿ (งวด ${p.installmentNo})`,
        metadata: { amount: p.amountPaid.toString(), method: p.paymentMethod ?? undefined },
      });
    }

    for (const d of dunningActions) {
      events.push({
        id: `dunning-${d.id}`,
        type: 'DUNNING_ACTION',
        timestamp: d.createdAt.toISOString(),
        title: `ส่ง ${d.channel}: ${d.dunningRule.name}`,
        subtitle:
          d.messageContent
            ? d.messageContent.substring(0, 80) + (d.messageContent.length > 80 ? '…' : '')
            : undefined,
        metadata: { status: d.status, channel: d.channel },
      });
    }

    for (const a of audits) {
      const isMdm = a.action.startsWith('MDM_');
      events.push({
        id: `audit-${a.id}`,
        type: isMdm ? 'MDM' : 'STATUS_CHANGE',
        timestamp: a.createdAt.toISOString(),
        title: this.formatAuditTitle(a.action, a.newValue as Record<string, unknown> | null),
        metadata: { action: a.action, newValue: a.newValue ?? undefined },
      });
    }

    for (const l of letters) {
      events.push({
        id: `letter-${l.id}`,
        type: 'LETTER',
        timestamp: (l.dispatchedAt ?? l.createdAt).toISOString(),
        title: `ส่งหนังสือ: ${l.letterType} (EMS: ${l.trackingNumber ?? '—'})`,
        metadata: { status: l.status, letterNumber: l.letterNumber },
      });
    }

    events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return events.slice(0, 100);
  }

  private formatAuditTitle(
    action: string,
    newValue: Record<string, unknown> | null,
  ): string {
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
}
