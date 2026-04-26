import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AutoAssignService } from '../collections-session/auto-assign.service';
import { TransferDto } from './dto/transfer.dto';

@Injectable()
export class CollectionsManageService {
  constructor(
    private prisma: PrismaService,
    private autoAssign: AutoAssignService,
  ) {}

  async getBoard(branchScope?: string[]) {
    const today = startOfDay(new Date());
    const collectors = await this.prisma.user.findMany({
      where: {
        role: 'SALES' as any,
        deletedAt: null,
        ...(branchScope ? { branchId: { in: branchScope } } : {}),
      },
      select: {
        id: true,
        name: true,
        collectionsActive: true,
        branch: { select: { id: true, name: true } },
      },
    });

    const assignments = await this.prisma.dailyAssignment.findMany({
      where: { date: today, deletedAt: null },
      include: {
        contract: {
          select: {
            id: true,
            contractNumber: true,
            customer: { select: { id: true, name: true, phone: true } },
            branch: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { position: 'asc' },
    });

    // Pull daysOverdue + outstanding from latest snapshot per contract.
    const contractIds = assignments.map((a) => a.contractId);
    const snapshots =
      contractIds.length > 0
        ? await this.prisma.contractDailySnapshot.findMany({
            where: { contractId: { in: contractIds } },
            orderBy: { date: 'desc' },
            distinct: ['contractId'],
            select: { contractId: true, daysOverdue: true, outstanding: true },
          })
        : [];
    const snapshotMap = new Map(snapshots.map((s) => [s.contractId, s]));

    const enriched = assignments.map((a) => {
      const snap = snapshotMap.get(a.contractId);
      return {
        ...a,
        contract: {
          ...a.contract,
          daysOverdue: snap?.daysOverdue ?? 0,
          outstanding: snap?.outstanding ?? null,
        },
      };
    });

    const byCollector = new Map<string, any[]>();
    const pool: any[] = [];
    for (const a of enriched) {
      if (a.collectorId) {
        if (!byCollector.has(a.collectorId)) byCollector.set(a.collectorId, []);
        byCollector.get(a.collectorId)!.push(a);
      } else {
        pool.push(a);
      }
    }

    return {
      date: today,
      collectors: collectors.map((c) => {
        const items = byCollector.get(c.id) ?? [];
        const done = items.filter((a) => a.status === 'DONE' || a.status === 'SKIPPED').length;
        return {
          id: c.id,
          name: c.name,
          branch: c.branch,
          active: c.collectionsActive,
          assignments: items,
          progress: { total: items.length, done },
        };
      }),
      pool: {
        items: pool.filter((a) => !a.escalationFlag),
        escalation: pool.filter((a) => a.escalationFlag),
      },
      lockedAt: assignments.find((a) => a.lockedAt)?.lockedAt ?? null,
    };
  }

  async assignContract(assignmentId: string, toCollectorId: string | null) {
    const row = await this.prisma.dailyAssignment.findUnique({ where: { id: assignmentId } });
    if (!row) throw new NotFoundException('ไม่พบรายการ');

    return this.prisma.dailyAssignment.update({
      where: { id: assignmentId },
      data: {
        collectorId: toCollectorId,
        source: 'MANAGER_OVERRIDE',
      },
    });
  }

  async lock() {
    const today = startOfDay(new Date());
    return this.prisma.dailyAssignment.updateMany({
      where: { date: today, lockedAt: null, status: 'PENDING' },
      data: { lockedAt: new Date() },
    });
  }

  async transfer(dto: TransferDto) {
    const today = startOfDay(new Date());
    const items = await this.prisma.dailyAssignment.findMany({
      where: {
        date: today,
        collectorId: dto.fromCollectorId,
        status: 'PENDING',
        deletedAt: null,
      },
      orderBy: { position: 'asc' },
      take: dto.count,
    });
    if (items.length === 0) return { moved: 0 };
    await this.prisma.dailyAssignment.updateMany({
      where: { id: { in: items.map((i) => i.id) } },
      data: { collectorId: dto.toCollectorId, source: 'MANAGER_OVERRIDE' },
    });
    return { moved: items.length };
  }

  async closeSession(collectorId: string) {
    const today = startOfDay(new Date());
    return this.prisma.dailyAssignment.updateMany({
      where: { date: today, collectorId, status: 'PENDING' },
      data: { collectorId: null, source: 'MANAGER_OVERRIDE' },
    });
  }

  async autoBalance() {
    return this.autoAssign.runForDate(new Date());
  }
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
