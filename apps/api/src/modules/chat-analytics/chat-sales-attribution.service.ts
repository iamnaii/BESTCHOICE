import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  JOURNEY_STAGES,
  type ChatWorkActor,
  type Company,
  type ChatLinkedSale,
  type ChatAnalyticsSales,
  type ChatAnalyticsFunnel,
  type ChatFunnelCustomer,
} from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { assertExportRowCount, EXPORT_ROW_LIMIT } from '../../common/helpers/export-snapshot';
import { scopedJourneyEvidence } from '../customer-journey/journey-summary.service';
import { ChatAnalyticsV2Service } from './chat-analytics-v2.service';
import { cycleEvidence } from './chat-analytics-sql';
import { documentBranchSql, salesEvidence, matchedSaleSql } from './chat-sales-evidence.sql';
import { ChatAnalyticsQueryDto, ChatFunnelDetailsDto } from './dto/chat-analytics-query.dto';

export function businessSaleKey(company: Company, id: string, contractId: string | null) {
  return company === 'FINANCE'
    ? `FINANCE:contract:${id}`
    : contractId
      ? `SHOP:contract:${contractId}`
      : `SHOP:sale:${id}`;
}
export function salesBasis(company: Company) {
  return company === 'SHOP'
    ? 'ยอดสุทธิหลังส่วนลดตามใบขายเดิม ไม่รวมใบยกเลิก; ไม่หักรายการคืนเงินที่บันทึกแยก และไม่ใช่เงินรับจริง'
    : 'เงินต้นเดิมของสัญญาที่เข้าเกณฑ์ ตามวันที่สร้างสัญญา ไม่ใช่ยอดขายปลีกหรือยอดรับชำระ';
}
@Injectable()
export class ChatSalesAttributionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: ChatAnalyticsV2Service,
  ) {}
  private async scope(
    tx: Prisma.TransactionClient,
    actor: ChatWorkActor,
    input: ChatAnalyticsQueryDto,
    observed: Date,
  ) {
    const context = await this.analytics.context(tx, actor, input);
    const cycles = await cycleEvidence(tx, context.actor, context.q, observed);
    return {
      ...context,
      meta: await this.analytics.metadata(tx, context.actor, context.q, observed, cycles),
    };
  }
  private async readSales(
    tx: Prisma.TransactionClient,
    input: ChatAnalyticsQueryDto,
    actor: ChatWorkActor,
    observed: Date,
    exporting = false,
  ): Promise<ChatAnalyticsSales> {
    const { actor: current, q, meta } = await this.scope(tx, actor, input, observed);
    const evidence = salesEvidence(current, q, observed);
    const [counts] = await tx.$queryRaw<
      Array<{
        amount: Prisma.Decimal | null;
        documentCount: number;
        customerCount: number;
        unmatchedCount: number;
        unknownSalespersonCount: number;
      }>
    >`${evidence} SELECT
  SUM(amount) FILTER(WHERE ${matchedSaleSql}) AS amount,
  COUNT(*) FILTER(WHERE ${matchedSaleSql})::integer AS "documentCount",
  COUNT(DISTINCT canonical_id) FILTER(WHERE ${matchedSaleSql})::integer AS "customerCount",
  COUNT(*) FILTER(WHERE NOT (${matchedSaleSql}))::integer AS "unmatchedCount",
  COUNT(*) FILTER(WHERE ${matchedSaleSql} AND (salesperson_id IS NULL OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=salesperson_id AND u.is_system_user=FALSE)))::integer AS "unknownSalespersonCount" FROM attributed_sales s`;
    if (exporting) assertExportRowCount(counts.documentCount);
    const page = exporting ? 1 : q.page,
      limit = exporting ? EXPORT_ROW_LIMIT : q.limit;
    type Row = {
      id: string;
      number: string;
      type: 'SALE' | 'CONTRACT';
      canonicalId: string;
      customerName: string | null;
      salespersonId: string | null;
      salespersonName: string | null;
      contractId: string | null;
      amount: Prisma.Decimal;
      createdAt: Date;
      firstInboundAt: Date | null;
    };
    const rows = await tx.$queryRaw<
      Row[]
    >`${evidence} SELECT s.id,s.number,s.type,s.canonical_id AS "canonicalId",c.name AS "customerName",
  CASE WHEN u.is_system_user=FALSE THEN s.salesperson_id END AS "salespersonId",CASE WHEN u.is_system_user=FALSE THEN u.name END AS "salespersonName",s.contract_id AS "contractId",s.amount,s.created_at AS "createdAt",s.first_at AS "firstInboundAt"
  FROM attributed_sales s LEFT JOIN customers c ON c.id=s.canonical_id LEFT JOIN users u ON u.id=s.salesperson_id WHERE ${matchedSaleSql} ORDER BY s.created_at DESC,s.id LIMIT ${limit} OFFSET ${(page - 1) * limit}`;
    const data: ChatLinkedSale[] = rows.map((r) => ({
      id: r.id,
      businessSaleKey: businessSaleKey(q.company, r.id, r.contractId),
      number: r.number,
      type: r.type,
      customerId: r.canonicalId,
      customerName: r.customerName,
      salespersonId: r.salespersonId,
      salespersonName: r.salespersonName,
      amount: r.amount.toFixed(2),
      createdAt: r.createdAt.toISOString(),
      firstInboundAt: r.firstInboundAt?.toISOString() ?? null,
    }));
    return {
      ...meta,
      ...counts,
      amount: (counts.amount ?? new Prisma.Decimal(0)).toFixed(2),
      basis: salesBasis(q.company),
      cohortDefinition:
        'เอกสารในช่วงวันที่ ซึ่งลูกค้าที่รวมตัวตนแล้วมีหลักฐานทักแชทในขอบเขตนี้ก่อนเอกสาร; เชื่อมโยงกับแชท ไม่ใช่หลักฐานว่าแชททำให้เกิดยอดขาย',
      data,
      total: counts.documentCount,
      page,
      limit,
    };
  }
  sales(input: ChatAnalyticsQueryDto, actor: ChatWorkActor, observed = new Date()) {
    return this.prisma.$transaction((tx) => this.readSales(tx, input, actor, observed), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }
  exportSales(input: ChatAnalyticsQueryDto, actor: ChatWorkActor, observed = new Date()) {
    return this.prisma.$transaction((tx) => this.readSales(tx, input, actor, observed, true), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 60000,
    });
  }
  private journey(current: ChatWorkActor, q: ChatAnalyticsQueryDto, observed: Date) {
    return Prisma.sql`${salesEvidence(current, q, observed)}${scopedJourneyEvidence({ ...q, observed, contractBranch: documentBranchSql(current, q, Prisma.sql`k.branch_id`) })}`;
  }
  async funnel(
    input: ChatAnalyticsQueryDto,
    actor: ChatWorkActor,
    observed = new Date(),
  ): Promise<ChatAnalyticsFunnel> {
    return this.prisma.$transaction(
      async (tx) => {
        const { actor: current, q, meta } = await this.scope(tx, actor, input, observed);
        const evidence = this.journey(current, q, observed);
        const [count] = await tx.$queryRaw<
          Array<{ total: number }>
        >`${evidence} SELECT COUNT(*)::integer AS total FROM journey`;
        const steps = await tx.$queryRaw<
          ChatAnalyticsFunnel['steps']
        >`${evidence} SELECT stage,COUNT(*) FILTER(WHERE proven AND stage_index>=idx)::integer AS reached,COUNT(*) FILTER(WHERE NOT proven AND stage_index>idx)::integer AS skipped FROM journey_steps GROUP BY stage,idx ORDER BY idx`;
        const lossReasons = await tx.$queryRaw<
          ChatAnalyticsFunnel['lossReasons']
        >`${evidence} SELECT current_loss AS reason,COUNT(*)::integer AS count FROM journey WHERE current_loss IS NOT NULL GROUP BY current_loss ORDER BY current_loss`;
        return {
          ...meta,
          stageBasis: 'CURRENT',
          customerCount: count.total,
          steps: JOURNEY_STAGES.map(
            (stage) => steps.find((s) => s.stage === stage) ?? { stage, reached: 0, skipped: 0 },
          ),
          lossReasons,
          cohortDefinition:
            'ลูกค้าที่รวมตัวตนแล้ว ทักครั้งแรกที่มีหลักฐานในบริษัท/ช่องทาง/ห้องที่เข้าถึงได้ภายในช่วงวันที่; ขั้นปัจจุบัน ณ เวลาที่แสดง',
          scopeNotes: [
            'ไม่ใช้วันที่สร้างห้องแทนหลักฐานการทัก; ประวัติที่ถูกลบถาวรหรือนำเข้าไม่ครบอาจย้อนสร้างไม่ได้',
            'ใช้หลักฐาน Journey ที่ระบุห้องในขอบเขต และเอกสารที่มีสิทธิ์ตามสาขา; ไม่นำแคชข้ามบริษัทหรือบันทึกที่ไม่ระบุขอบเขตมาปะ',
            'ตัวกรองพนักงานของ funnel ใช้ผู้ดูแลห้องปัจจุบัน; ยอดขายใช้เจ้าของเอกสาร; lost ยังอยู่ในจำนวนลูกค้าทั้งหมด',
          ],
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async funnelDetails(input: ChatFunnelDetailsDto, actor: ChatWorkActor, observed = new Date()) {
    return this.prisma.$transaction(
      async (tx) => {
        const { actor: current, q, meta } = await this.scope(tx, actor, input, observed);
        const evidence = this.journey(current, q, observed);
        if (
          !JOURNEY_STAGES.includes(input.stage) ||
          !['reached', 'skipped', 'lost', 'all'].includes(input.state)
        )
          throw new BadRequestException('ไม่รู้จักขั้นหรือสถานะ');
        const predicate =
          input.state === 'lost'
            ? Prisma.sql`current_loss IS NOT NULL`
            : input.state === 'all'
              ? Prisma.sql`TRUE`
              : input.state === 'skipped'
                ? Prisma.sql`NOT proven AND stage_index>idx`
                : Prisma.sql`proven AND stage_index>=idx`;
        const [count] = await tx.$queryRaw<
          Array<{ total: number }>
        >`${evidence} SELECT COUNT(*)::integer AS total FROM journey_steps WHERE stage=${input.stage} AND ${predicate}`;
        const rows = await tx.$queryRaw<
          Array<{
            customerId: string;
            name: string;
            firstInboundAt: Date;
            stageIndex: number;
            lostReason: string | null;
          }>
        >`${evidence} SELECT customer_id AS "customerId",name,first_at AS "firstInboundAt",stage_index AS "stageIndex",current_loss AS "lostReason" FROM journey_steps WHERE stage=${input.stage} AND ${predicate} ORDER BY first_at,customer_id LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`;
        const data: ChatFunnelCustomer[] = rows.map(({ stageIndex, firstInboundAt, ...r }) => ({
          ...r,
          firstInboundAt: firstInboundAt.toISOString(),
          stage: JOURNEY_STAGES[stageIndex],
        }));
        return { ...meta, data, total: count.total, page: q.page, limit: q.limit };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
