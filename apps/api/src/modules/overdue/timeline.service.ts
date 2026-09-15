import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { contractEventSources, type TimelineEvent } from './contract-event-sources';

export type { TimelineEvent, TimelineEventType } from './contract-event-sources';

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

    const rows = await contractEventSources(this.prisma, [contractId]);
    const events = rows.map((row) => row.event);
    events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return events.slice(0, 100);
  }
}
