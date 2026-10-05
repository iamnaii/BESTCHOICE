import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CUSTOMER_BOUGHT_SALE_TYPES, type ChatSalesContext, type ChatWorkActor, type WorkScope } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { JourneySummaryService } from '../../customer-journey/journey-summary.service';
import { salesBranchWhere } from '../../sales/services/sales-read-policy';
import { ChatWorkAccessService } from './chat-work-access.service';

@Injectable()
export class ChatSalesContextService {
  constructor(private readonly prisma: PrismaService, private readonly access: ChatWorkAccessService, private readonly summaries: JourneySummaryService) {}
  async creditEvidence(roomId: string, analysisId: string, actor: ChatWorkActor, scope: WorkScope) {
    return this.prisma.$transaction(async tx => {
      await this.access.assertRoom(roomId, actor, scope, tx);
      const analysis = await tx.roomCreditAnalysis.findFirst({ where: { id: analysisId, roomId, deletedAt: null, status: 'COMPLETED' }, select: { id: true, result: true, createdAt: true } });
      if (!analysis) throw new NotFoundException('ไม่พบผลตรวจเครดิตในห้องนี้');
      return analysis;
    });
  }
  async get(roomId: string, authenticated: ChatWorkActor, scope: WorkScope): Promise<ChatSalesContext> {
    const actor = await this.access.currentActor(authenticated);
    const room = await this.access.assertRoom(roomId, actor, scope);
    let customerId = room.customerId;
    let journey: ChatSalesContext['journey'] = null;
    const visited = new Set<string>();
    while (customerId) {
      if (visited.has(customerId) || visited.size >= 20) throw new ConflictException('ข้อมูลการรวมลูกค้าต้องได้รับการตรวจสอบ');
      visited.add(customerId);
      const result = await this.summaries.summary(customerId, actor);
      if ('redirectToCustomerId' in result) customerId = result.redirectToCustomerId;
      else { journey = result; break; }
    }
    const [todos, analyses] = await Promise.all([
      this.prisma.todo.findMany({ where: { roomId, deletedAt: null, status: { in: ['TODO', 'DOING', 'REVIEW'] } }, orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }], take: 5, select: { id: true, title: true, dueDate: true } }),
      this.prisma.roomCreditAnalysis.findMany({ where: { roomId, deletedAt: null, status: 'COMPLETED' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 3, select: { id: true, createdAt: true } }),
    ]);
    const evidenceLinks: ChatSalesContext['evidenceLinks'] = [
      ...todos.map(todo => ({ kind: 'APPOINTMENT' as const, id: todo.id, label: todo.title })),
      ...analyses.map(analysis => ({ kind: 'CREDIT' as const, id: analysis.id, label: `ผลตรวจเครดิต ${new Intl.DateTimeFormat('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(analysis.createdAt)}` })),
    ];
    if (customerId && journey?.stage === 'PURCHASED' && scope.company === 'SHOP') {
      // Use the original sale read policy and bought-type constants. No finance document IDs or amounts leak into this projection.
      const purchases = await this.prisma.sale.findMany({ where: { ...salesBranchWhere(actor, scope.branchId), customerId, deletedAt: null, saleType: { in: [...CUSTOMER_BOUGHT_SALE_TYPES] } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 3, select: { id: true, saleNumber: true } });
      evidenceLinks.push(...purchases.map(sale => ({ kind: 'PURCHASE' as const, id: sale.id, label: `ใบขาย ${sale.saleNumber}`, href: `/sales?saleId=${encodeURIComponent(sale.id)}` })));
    }
    // Preparing a suggested offer is not a persisted sale event. Never infer OFFER evidence from draft text.
    const currentActor = await this.access.currentActor(authenticated);
    const currentRoom = await this.access.assertRoom(roomId, currentActor, scope);
    const grants = (value: ChatWorkActor) => JSON.stringify([value.role, value.branchId, [...(value.accessibleCompanies ?? [])].sort()]);
    if (currentRoom.customerId !== room.customerId || grants(currentActor) !== grants(actor))
      throw new ConflictException('ข้อมูลลูกค้าหรือสิทธิ์เปลี่ยนไป กรุณาโหลดใหม่');
    const next = todos[0];
    return { customerId, journey, nextAction: next ? { todoId: next.id, title: next.title, dueAt: next.dueDate?.toISOString() ?? null } : null, evidenceLinks };
  }
}
