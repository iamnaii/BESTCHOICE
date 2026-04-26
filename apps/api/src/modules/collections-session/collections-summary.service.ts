import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { LineMessagePayload } from '../line-oa/dto/webhook-event.dto';
import { UserRole } from '@prisma/client';
import { bangkokStartOfDay } from '../../utils/date.util';

interface CollectorSummary {
  name: string;
  pending: number;
  done: number;
  skipped: number;
  total: number;
}

@Injectable()
export class CollectionsSummaryService {
  private readonly logger = new Logger(CollectionsSummaryService.name);

  constructor(
    private prisma: PrismaService,
    private line: LineOaService,
  ) {}

  async sendDailySummary(date: Date): Promise<{ recipients: number; sent: number }> {
    const dateOnly = bangkokStartOfDay(date);

    const collectors = await this.prisma.user.findMany({
      where: {
        role: UserRole.SALES,
        deletedAt: null,
      },
      select: { id: true, name: true },
    });
    const collectorMap = new Map(collectors.map((c) => [c.id, c.name]));

    // Exclude CANCELLED — those are emergency mid-day "ปิด session" rows that
    // got pushed back to pool. Counting them in any total would inflate the
    // collector's day artificially.
    const buckets = await this.prisma.dailyAssignment.groupBy({
      by: ['collectorId', 'status'],
      where: {
        date: dateOnly,
        collectorId: { not: null },
        deletedAt: null,
        status: { not: 'CANCELLED' },
      },
      _count: { _all: true },
    });

    const byCollector = new Map<string, CollectorSummary>();
    for (const b of buckets) {
      if (!b.collectorId) continue;
      const name = collectorMap.get(b.collectorId) ?? '???';
      const row = byCollector.get(b.collectorId) ?? {
        name,
        pending: 0,
        done: 0,
        skipped: 0,
        total: 0,
      };
      const c = b._count._all;
      if (b.status === 'PENDING' || b.status === 'IN_PROGRESS') row.pending += c;
      else if (b.status === 'DONE') row.done += c;
      else if (b.status === 'SKIPPED') row.skipped += c;
      row.total += c;
      byCollector.set(b.collectorId, row);
    }

    const message = this.formatMessage(dateOnly, Array.from(byCollector.values()));

    const owners = await this.prisma.user.findMany({
      where: {
        role: UserRole.OWNER,
        deletedAt: null,
        lineId: { not: null },
      },
      select: { id: true, lineId: true, name: true },
    });

    const results = await Promise.allSettled(
      owners.map((owner) =>
        this.line.pushMessage(owner.lineId!, [
          { type: 'text', text: message } as LineMessagePayload,
        ]),
      ),
    );
    const sent = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - sent;
    if (failed > 0) {
      this.logger.warn(`Daily summary: ${failed} OWNERs failed to receive`);
    }

    this.logger.log(`Daily summary: ${sent}/${owners.length} OWNERs notified`);
    return { recipients: owners.length, sent };
  }

  formatMessage(date: Date, rows: CollectorSummary[]): string {
    const dateLabel = date.toLocaleDateString('th-TH', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const lines: string[] = [`สรุปงานเก็บเงิน ${dateLabel}`, ''];

    if (rows.length === 0) {
      lines.push('— ไม่มีงานวันนี้ —');
      return lines.join('\n');
    }

    rows.sort((a, b) => b.total - a.total);
    let totalDone = 0;
    let totalAll = 0;

    for (const r of rows) {
      const pct = r.total === 0 ? 0 : Math.round((r.done / r.total) * 100);
      const tail = r.pending > 0 ? ` · ค้าง ${r.pending}` : '';
      lines.push(`▸ ${r.name}: ${r.done}/${r.total} (${pct}%)${tail}`);
      totalDone += r.done;
      totalAll += r.total;
    }

    if (rows.length > 1) {
      const overallPct = totalAll === 0 ? 0 : Math.round((totalDone / totalAll) * 100);
      lines.push('');
      lines.push(`รวม: ${totalDone}/${totalAll} (${overallPct}%)`);
    }

    return lines.join('\n');
  }
}

