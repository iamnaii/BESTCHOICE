import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StaffNotifyService } from '../staff-notify/staff-notify.service';
import { bangkokDateString } from '../../utils/date.util';

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
    @Optional() private readonly staffNotify?: StaffNotifyService,
  ) {}

  async sendDailySummary(date: Date): Promise<{ recipients: number; sent: number }> {
    const dateOnly = startOfDay(date);

    const collectors = await this.prisma.user.findMany({
      where: {
        role: 'SALES' as any,
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

    // ก้อน 7 A16 — ผ่านท่อกลาง (เจ้าของ+ผจก.การเงิน ตามสวิตช์ collections.daily_summary) · วันละครั้ง
    if (!this.staffNotify) {
      this.logger.warn('Daily summary: StaffNotifyService unavailable, skipping');
      return { recipients: 0, sent: 0 };
    }
    const [title, ...rest] = message.split('\n');
    const res = await this.staffNotify.notify('collections.daily_summary', {
      title,
      lines: rest.filter((l) => l.trim().length > 0),
      link: '/collections',
      dedupeKey: bangkokDateString(dateOnly),
    });
    this.logger.log(`Daily summary: ${res.sent}/${res.recipients} notified`);
    return { recipients: res.recipients, sent: res.sent };
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

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
