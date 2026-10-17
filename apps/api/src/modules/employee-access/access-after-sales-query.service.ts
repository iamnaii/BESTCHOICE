import { Injectable, NotFoundException } from '@nestjs/common';
import { AfterSalesStage } from '@prisma/client';
import { ListCasesDto } from '../after-sales/dto/list-cases.dto';
import { currentDomainAccess } from './access-execution-context';
import {
  AccessAfterSalesSourceService,
  currentAfterSalesWhere,
} from './access-after-sales-source.service';
import {
  AccessAfterSalesProjectionService,
  AfterSalesReadView,
} from './access-after-sales-projection.service';
const TAB_STAGES: Record<string, readonly AfterSalesStage[]> = {
  ACTIVE: ['RECEIVED', 'IN_REPAIR', 'AWAITING_APPROVAL'],
  AWAITING_APPROVAL: ['AWAITING_APPROVAL'],
  READY: ['READY_FOR_PICKUP'],
  DONE: ['CLOSED', 'CANCELLED'],
};
@Injectable()
export class AccessAfterSalesQueryService {
  constructor(
    private readonly sources: AccessAfterSalesSourceService,
    private readonly projection: AccessAfterSalesProjectionService,
  ) {}
  async get(id: string) {
    return this.projection.project(id, await this.sources.resolve(id));
  }
  async byTicket(ticketId: string) {
    const tx = currentDomainAccess()!.client;
    const row = await tx.afterSalesCase.findFirst({
      where: { repairTicketId: ticketId, AND: currentAfterSalesWhere() },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('ไม่พบเคส');
    const facts = await this.sources.resolve(row.id);
    if (!facts.repairAccess) throw new NotFoundException('ไม่พบเคส');
    return { id: row.id };
  }
  async list(dto: ListCasesDto) {
    const tx = currentDomainAccess()!.client;
    const rows: AfterSalesReadView[] = [];
    let cursor: string | undefined;
    // Scope first; deterministic bounded DB batches, without a global scan cutoff.
    for (;;) {
      const batch = await tx.afterSalesCase.findMany({
        where: { AND: [currentAfterSalesWhere(), dto.branchId ? { branchId: dto.branchId } : {}] },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const candidate of batch) rows.push(await this.get(candidate.id));
      if (batch.length < 100) break;
      cursor = batch[batch.length - 1].id;
    }
    const tab = dto.tab ?? 'ACTIVE';
    const query = dto.q?.toLocaleLowerCase();
    let selected = rows.filter((row) => TAB_STAGES[tab].includes(row.stage));
    // Search only projected fields; denied history/customer/Contract never contributes.
    if (query)
      selected = selected.filter((row) =>
        [
          row.caseNumber,
          row.deviceImei,
          row.customer?.name,
          row.customer?.phone,
          row.contract?.contractNumber,
        ].some((value) => value?.toLocaleLowerCase().includes(query)),
      );
    if (dto.stale) selected = selected.filter((row) => row.stale === true);
    selected.sort((a, b) =>
      tab === 'DONE'
        ? (b.closedAt?.getTime() ?? b.cancelledAt?.getTime() ?? b.receivedAt.getTime()) -
            (a.closedAt?.getTime() ?? a.cancelledAt?.getTime() ?? a.receivedAt.getTime()) ||
          a.id.localeCompare(b.id)
        : Number(b.stale) - Number(a.stale) ||
          (a.stageSince ?? a.receivedAt).getTime() - (b.stageSince ?? b.receivedAt).getTime() ||
          a.id.localeCompare(b.id),
    );
    const page = dto.page ?? 1,
      limit = dto.limit ?? 50;
    return {
      data: selected.slice((page - 1) * limit, page * limit),
      total: selected.length,
      page,
      limit,
      truncated: false,
      summary: dto.summary ? this.summary(rows) : undefined,
    };
  }
  private summary(rows: AfterSalesReadView[]) {
    const open = rows.filter((row) => !['CLOSED', 'CANCELLED'].includes(row.stage));
    const monthStart = new Date(
      new Date().toLocaleString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7) +
        '-01T00:00:00+07:00',
    );
    const tickets = rows.flatMap((row) =>
      row.repairTicket?.status === 'CLOSED' &&
      row.repairTicket.returnedToCustomerAt &&
      row.repairTicket.returnedToCustomerAt >= monthStart
        ? [row.repairTicket]
        : [],
    );
    const sum = (payer: string) => {
      if (rows.some((row) => !row.stageVerified)) return null;
      const contributors = tickets.filter((ticket) => ticket.payer === payer);
      return contributors.some((ticket) => ticket.actualCost == null)
        ? null
        : contributors.reduce((total, ticket) => total + Number(ticket.actualCost), 0);
    };
    const isExchange = (row: AfterSalesReadView) =>
      row.outcome === 'SAME_MODEL_EXCHANGE' || row.outcome === 'PRICED_EXCHANGE';
    return {
      open: open.length,
      openRepair: open.filter((row) => row.outcome === 'REPAIR').length,
      openExchange: open.filter(isExchange).length,
      stale: open.filter((row) => row.stale === true).length,
      awaitingApproval: open.filter((row) => row.stage === 'AWAITING_APPROVAL').length,
      repairCostShop: sum('SHOP'),
      repairCostCustomer: sum('CUSTOMER'),
      supplierClaims: tickets.filter((ticket) => ticket.payer === 'SUPPLIER_CLAIM').length,
      exchanges: rows.filter(
        (row) => isExchange(row) && row.closedAt && row.closedAt >= monthStart && !row.cancelledAt,
      ).length,
      currentStageUnavailable: rows.filter((row) => !row.stageVerified).length,
    };
  }
}
