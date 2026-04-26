import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ActionDto } from './dto/action.dto';
import { SkipDto } from './dto/skip.dto';

const ETA_PER_CONTRACT_MIN = 5;

@Injectable()
export class CollectionsSessionService {
  constructor(private prisma: PrismaService) {}

  async getMySession(userId: string) {
    const today = startOfDay(new Date());

    const assignments = await this.prisma.dailyAssignment.findMany({
      where: {
        date: today,
        collectorId: userId,
        deletedAt: null,
      },
      include: {
        contract: {
          include: {
            customer: { select: { id: true, name: true, phone: true, lineId: true } },
            branch: { select: { id: true, name: true } },
            assignedTo: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [
        { escalationFlag: 'desc' },
        { position: 'asc' },
      ],
    });

    const pending = assignments.filter((a) => a.status === 'PENDING' || a.status === 'IN_PROGRESS');
    const done = assignments.filter((a) => a.status === 'DONE' || a.status === 'SKIPPED');

    // For severity ordering inside Focus mode: pull the latest snapshot
    // for these contracts to know daysOverdue.
    const contractIds = pending.map((a) => a.contractId);
    const snapshots =
      contractIds.length > 0
        ? await this.prisma.contractDailySnapshot.findMany({
            where: { contractId: { in: contractIds } },
            orderBy: { date: 'desc' },
            distinct: ['contractId'],
            select: { contractId: true, daysOverdue: true },
          })
        : [];
    const daysOverdueMap = new Map(snapshots.map((s) => [s.contractId, s.daysOverdue]));

    const ordered = [...pending].sort((a, b) => {
      if (a.escalationFlag !== b.escalationFlag) return a.escalationFlag ? -1 : 1;
      const ago = daysOverdueMap.get(a.contractId) ?? 0;
      const bgo = daysOverdueMap.get(b.contractId) ?? 0;
      if (ago !== bgo) return bgo - ago;
      const aHasPhone = !!(a.contract as any).customer?.phone;
      const bHasPhone = !!(b.contract as any).customer?.phone;
      if (aHasPhone !== bHasPhone) return aHasPhone ? -1 : 1;
      return a.position - b.position;
    });

    const callsCount = pending.filter((a) => !!(a.contract as any).customer?.phone).length;
    const lineCount = pending.filter(
      (a) => !!(a.contract as any).customer?.lineId && !(a.contract as any).customer?.phone,
    ).length;

    const summary =
      pending.length === 0 && done.length > 0 ? this.buildSummary(done) : undefined;

    // Attach daysOverdue to each pending row so the frontend can render
    // severity panels without a second query.
    const withDays = ordered.map((a) => ({
      ...a,
      contract: {
        ...a.contract,
        daysOverdue: daysOverdueMap.get(a.contractId) ?? 0,
      },
    }));

    return {
      contracts: withDays,
      target: {
        count: pending.length,
        etaMinutes: pending.length * ETA_PER_CONTRACT_MIN,
      },
      breakdown: {
        calls: callsCount,
        lines: lineCount,
        severe: pending.filter((a) => (daysOverdueMap.get(a.contractId) ?? 0) >= 30).length,
        medium: pending.filter((a) => {
          const d = daysOverdueMap.get(a.contractId) ?? 0;
          return d >= 8 && d < 30;
        }).length,
        light: pending.filter((a) => (daysOverdueMap.get(a.contractId) ?? 0) < 8).length,
      },
      summary,
    };
  }

  async startSession(userId: string) {
    const today = startOfDay(new Date());
    await this.prisma.dailyAssignment.updateMany({
      where: { date: today, collectorId: userId, status: 'PENDING', startedAt: null },
      data: { startedAt: new Date() },
    });
    return { sessionStartedAt: new Date() };
  }

  async recordAction(assignmentId: string, userId: string, dto: ActionDto) {
    const row = await this.prisma.dailyAssignment.findFirst({
      where: { id: assignmentId, collectorId: userId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('ไม่พบรายการในคิวของคุณ');

    await this.prisma.dailyAssignment.update({
      where: { id: assignmentId },
      data: {
        outcome: dto.outcome,
        status: 'DONE',
        completedAt: new Date(),
        notes: dto.notes,
        paymentId: dto.paymentId,
        lineMessageId: dto.lineMessageId,
      },
    });

    const next = await this.prisma.dailyAssignment.findFirst({
      where: {
        date: row.date,
        collectorId: userId,
        status: 'PENDING',
        deletedAt: null,
      },
      orderBy: [{ escalationFlag: 'desc' }, { position: 'asc' }],
    });

    return { nextContractId: next?.contractId ?? null };
  }

  async skip(assignmentId: string, userId: string, dto: SkipDto) {
    const row = await this.prisma.dailyAssignment.findFirst({
      where: { id: assignmentId, collectorId: userId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('ไม่พบรายการในคิวของคุณ');

    if (dto.reason === 'WRONG_QUEUE') {
      await this.prisma.dailyAssignment.update({
        where: { id: assignmentId },
        data: {
          collectorId: null,
          status: 'PENDING',
          skipReason: dto.reason,
          skipNote: dto.note,
        },
      });
    } else {
      await this.prisma.dailyAssignment.update({
        where: { id: assignmentId },
        data: {
          status: 'SKIPPED',
          completedAt: new Date(),
          skipReason: dto.reason,
          skipNote: dto.note,
        },
      });
    }

    const next = await this.prisma.dailyAssignment.findFirst({
      where: {
        date: row.date,
        collectorId: userId,
        status: 'PENDING',
        deletedAt: null,
      },
      orderBy: [{ escalationFlag: 'desc' }, { position: 'asc' }],
    });

    return { nextContractId: next?.contractId ?? null };
  }

  private buildSummary(done: any[]) {
    const callsConnected = done.filter((a) => a.outcome === 'CALL_CONNECTED').length;
    const callsNoAnswer = done.filter((a) => a.outcome === 'CALL_NO_ANSWER').length;
    const lineSent = done.filter((a) => a.outcome === 'LINE_SENT').length;
    const skipped = done.filter((a) => a.status === 'SKIPPED').length;
    const startedAt = done.reduce<Date | null>(
      (min, a) => (a.startedAt && (!min || a.startedAt < min) ? a.startedAt : min),
      null,
    );
    const finishedAt = done.reduce<Date | null>(
      (max, a) => (a.completedAt && (!max || a.completedAt > max) ? a.completedAt : max),
      null,
    );
    const elapsedMinutes =
      startedAt && finishedAt
        ? Math.round((finishedAt.getTime() - startedAt.getTime()) / 60000)
        : 0;

    return {
      total: done.length,
      callsConnected,
      callsNoAnswer,
      lineSent,
      skipped,
      elapsedMinutes,
    };
  }
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
