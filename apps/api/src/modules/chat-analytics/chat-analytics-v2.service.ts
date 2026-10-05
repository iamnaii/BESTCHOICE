import { getBranchScope } from '../auth/branch-access.util';
import { hasCompanyAccess } from '@installment/shared';
import { openWorkEvidence } from './chat-open-work.sql';
import { workEvidence } from './chat-work-metrics.sql';
import { syncClosedServiceWork } from '../staff-chat/services/chat-service-case-state';
import {
  CHAT_WORK_METRICS,
  type ChatAnalyticsWork,
  type ChatWorkMetricDetail,
  type ChatOpenWorkDetail,
} from '@installment/shared';
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  ChatWorkActor,
  ChatAnalyticsMeta,
  ChatAnalyticsOverview,
  ChatResponseMetrics,
  ChatStaffMetrics,
  ChatCycleDetail,
} from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ChatWorkAccessService,
  WORK_CHANNELS,
} from '../staff-chat/services/chat-work-access.service';
import {
  ChatAnalyticsQueryDto,
  ChatCycleDetailsDto,
  ChatWorkDetailsDto,
  ChatOpenWorkDto,
} from './dto/chat-analytics-query.dto';
import {
  analyticsRoomSql,
  cycleEvidence,
  cycleMetricSql,
  responseAggregate,
} from './chat-analytics-sql';
@Injectable()
export class ChatAnalyticsV2Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChatWorkAccessService,
  ) {}
  async context(
    tx: Prisma.TransactionClient,
    authenticated: ChatWorkActor,
    input: ChatAnalyticsQueryDto,
  ) {
    const from = new Date(input.from),
      to = new Date(input.to);
    if (
      !Number.isFinite(from.getTime()) ||
      !Number.isFinite(to.getTime()) ||
      to <= from ||
      to.getTime() - from.getTime() > 366 * 86400000 ||
      input.asOf ||
      ![input.from, input.to].every((s) => /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(s))
    )
      throw new BadRequestException(
        'เลือกช่วงวันที่ไม่เกิน 366 วัน พร้อมเขตเวลา งานค้างแสดง ณ ปัจจุบันเท่านั้น',
      );
    const actor = await this.access.currentActor(authenticated, tx);
    const q = { ...input, from: from.toISOString(), to: to.toISOString() };
    const room = await this.access.roomWhere(actor, q, tx);
    if (q.channel && !WORK_CHANNELS[q.company].some((c) => c === q.channel))
      throw new BadRequestException('ช่องทางไม่อยู่ในบริษัทนี้');
    if (
      (
        await tx.systemConfig.findFirst({
          where: { key: 'chat_analytics_v2_enabled', deletedAt: null },
        })
      )?.value !== 'true'
    )
      throw new ForbiddenException('ยังไม่เปิดรายงานงานแชท');
    return {
      actor,
      q,
      room: {
        AND: [
          room,
          ...(q.channel ? [{ channel: q.channel as Prisma.EnumChatChannelFilter['equals'] }] : []),
        ],
      } satisfies Prisma.ChatRoomWhereInput,
    };
  }
  async metadata(
    tx: Prisma.TransactionClient,
    actor: ChatWorkActor,
    q: ChatAnalyticsQueryDto,
    observed: Date,
    evidence: Prisma.Sql,
  ): Promise<ChatAnalyticsMeta> {
    const [coverage] = await tx.$queryRaw<ChatAnalyticsMeta['coverage'][]>`${evidence} SELECT
   (SELECT MIN(c.started_at) FROM chat_response_cycles c JOIN chat_rooms r ON r.id=c.room_id LEFT JOIN users room_owner ON room_owner.id=r.assigned_to_id WHERE ${analyticsRoomSql(actor, q)} AND c.deleted_at IS NULL AND c.origin='LIVE' AND c.merged_into_id IS NULL)::text AS "from",
   COUNT(*) FILTER(WHERE origin='LEGACY_OPEN')::integer AS "legacyExcluded",
   COUNT(*) FILTER(WHERE origin='LIVE' AND merged_into_id IS NULL AND human_at IS NOT NULL AND first_human_staff_id IS NULL)::integer AS "unknownStaffCycles",
   COUNT(*) FILTER(WHERE origin='LIVE' AND merged_into_id IS NULL AND owner_minutes IS NULL)::integer AS "unknownPolicyCycles",
   COUNT(*) FILTER(WHERE merged_into_id IS NOT NULL)::integer AS "mergedExcluded" FROM measured`;
    // timestamp without time zone is stored as UTC; make the wire representation explicit.
    if (coverage.from)
      coverage.from = new Date(coverage.from.replace(' ', 'T') + 'Z').toISOString();
    return {
      period: {
        from: q.from,
        to: q.to,
        company: q.company,
        ...(q.branchId ? { branchId: q.branchId } : {}),
        ...(q.channel ? { channel: q.channel } : {}),
        ...(q.staffId ? { staffId: q.staffId } : {}),
      },
      observedAt: observed.toISOString(),
      coverage,
      cohortDefinition:
        'รอบที่เริ่มในช่วงวันที่ รวมคำตอบที่ยืนยันแล้วจนถึงเวลาที่แสดง; เวลารอตามเวลาทำงานและนโยบายของแต่ละรอบ',
    };
  }
  private async syncWork(authenticated: ChatWorkActor, input: ChatAnalyticsQueryDto) {
    const { room } = await this.prisma.$transaction((tx) => this.context(tx, authenticated, input));
    await syncClosedServiceWork(this.prisma, room);
  }
  async overview(
    authenticated: ChatWorkActor,
    input: ChatAnalyticsQueryDto,
    observed = new Date(),
  ): Promise<ChatAnalyticsOverview> {
    await this.syncWork(authenticated, input);
    return this.prisma.$transaction(
      async (tx) => {
        const { actor, q } = await this.context(tx, authenticated, input),
          evidence = await cycleEvidence(tx, actor, q, observed);
        const [responses] = await tx.$queryRaw<
          ChatResponseMetrics[]
        >`${evidence} SELECT ${responseAggregate} FROM live`;
        const [openWorkNow] = await tx.$queryRaw<
          ChatAnalyticsOverview['openWorkNow'][]
        >`${openWorkEvidence(actor, q)} SELECT COUNT(*) FILTER(WHERE kind='ROOM')::integer AS "roomWaits",COUNT(*) FILTER(WHERE kind='TASK')::integer AS "activeTasks",COUNT(*) FILTER(WHERE kind='COMMENT')::integer AS comments,COUNT(*)::integer AS "totalItems" FROM open_work`;

        return {
          ...(await this.metadata(tx, actor, q, observed, evidence)),
          responses,
          openWorkNow,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async staff(authenticated: ChatWorkActor, input: ChatAnalyticsQueryDto, observed = new Date()) {
    return this.prisma.$transaction(
      async (tx) => {
        const { actor, q } = await this.context(tx, authenticated, input),
          evidence = await cycleEvidence(tx, actor, q, observed);
        // Only acknowledged human replies appear in performance rows. Owner at open is a separate drilldown field.
        const rows = await tx.$queryRaw<
          (ChatStaffMetrics & { total: number })[]
        >`${evidence} SELECT first_human_staff_id AS "staffId", COALESCE(MAX(u.name),CASE WHEN first_human_staff_id IS NULL THEN 'ไม่ทราบผู้ตอบ' ELSE 'พนักงานเดิม' END) AS name, ${responseAggregate}, COUNT(*) OVER()::integer AS total FROM live LEFT JOIN users u ON u.id=live.first_human_staff_id WHERE human_at IS NOT NULL GROUP BY first_human_staff_id ORDER BY first_human_staff_id NULLS LAST LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`;
        // A separate grouped count handles pages past the end without inventing a zero total.
        const [count] = await tx.$queryRaw<
          { total: number }[]
        >`${evidence} SELECT COUNT(*)::integer AS total FROM (SELECT first_human_staff_id FROM live WHERE human_at IS NOT NULL GROUP BY first_human_staff_id) groups`;
        return {
          ...(await this.metadata(tx, actor, q, observed, evidence)),
          data: rows.map(({ total: _total, ...r }) => r),
          total: count.total,
          page: q.page,
          limit: q.limit,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async cycles(authenticated: ChatWorkActor, input: ChatCycleDetailsDto, observed = new Date()) {
    return this.prisma.$transaction(
      async (tx) => {
        const { actor, q } = await this.context(tx, authenticated, input),
          evidence = await cycleEvidence(tx, actor, q, observed);
        const predicate = cycleMetricSql(input.metric);
        if (!predicate) throw new BadRequestException('ไม่รู้จักตัวชี้วัด');
        const selection = Prisma.sql`${evidence}, selected AS (${input.metric === 'ROOMS' ? Prisma.sql`SELECT DISTINCT ON(room_id) * FROM live ORDER BY room_id,started_at,id` : Prisma.sql`SELECT * FROM live WHERE ${predicate}`})`;
        const rows = await tx.$queryRaw<
          Array<
            Omit<ChatCycleDetail, 'startedAt' | 'firstHumanSentAt' | 'firstBotSentAt'> & {
              startedAt: Date;
              firstHumanSentAt: Date | null;
              firstBotSentAt: Date | null;
            }
          >
        >`${selection} SELECT id,room_id AS "roomId",COALESCE(display_name,'ห้องแชท') AS title,started_at AS "startedAt",human_at AS "firstHumanSentAt",bot_at AS "firstBotSentAt",first_human_staff_id AS "staffId",(SELECT name FROM users u WHERE u.id=selected.first_human_staff_id) AS "staffName",(SELECT name FROM users u WHERE u.id=selected.assigned_at_open_id) AS "assignedAtOpenName",assigned_at_open_id AS "assignedAtOpenId",human_minutes AS "humanMinutes",bot_minutes AS "botMinutes" FROM selected ORDER BY started_at,id LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`;
        const [count] = await tx.$queryRaw<
          { total: number }[]
        >`${selection} SELECT COUNT(*)::integer AS total FROM selected`;
        return {
          ...(await this.metadata(tx, actor, q, observed, evidence)),
          data: rows.map((r) => ({
            ...r,
            startedAt: r.startedAt.toISOString(),
            firstHumanSentAt: r.firstHumanSentAt?.toISOString() ?? null,
            firstBotSentAt: r.firstBotSentAt?.toISOString() ?? null,
          })),
          total: count.total,
          page: q.page,
          limit: q.limit,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async work(
    authenticated: ChatWorkActor,
    input: ChatAnalyticsQueryDto,
    observed = new Date(),
  ): Promise<ChatAnalyticsWork> {
    // Read the canonical closure before counting current active work, same path as the queue.
    await this.syncWork(authenticated, input);
    return this.prisma.$transaction(
      async (tx) => {
        const { actor, q, room } = await this.context(tx, authenticated, input),
          cycles = await cycleEvidence(tx, actor, q, observed);
        const evidence = workEvidence(actor, q, observed);
        const rows = await tx.$queryRaw<
          { metric: string; count: number }[]
        >`${evidence} SELECT metric,COUNT(*)::integer AS count FROM work GROUP BY metric`;
        const metrics = new Map(rows.map((r) => [r.metric, r.count]));
        const n = (key: string) => metrics.get(key) ?? 0;
        const unknownCaseClosureTimes = await tx.chatServiceRequest.count({
          where: {
            room,
            deletedAt: null,
            status: 'LINKED',
            todo: {
              status: 'DONE',
              completedAt: null,
              deletedAt: null,
              ...(q.staffId ? { assigneeId: q.staffId } : {}),
            },
          },
        });
        return {
          ...(await this.metadata(tx, actor, q, observed, cycles)),
          handoffs: {
            created: n('HANDOFF_CREATED'),
            accepted: n('HANDOFF_ACCEPTED'),
            completed: n('HANDOFF_COMPLETED'),
            overdueNow: n('HANDOFF_OVERDUE'),
          },
          followUps: {
            due: n('FOLLOW_UP_DUE'),
            completed: n('FOLLOW_UP_COMPLETED'),
            overdueNow: n('FOLLOW_UP_OVERDUE'),
          },
          comments: {
            received: q.staffId ? null : n('COMMENT_RECEIVED'),
            confirmedReplies: n('COMMENT_CONFIRMED'),
            unresolvedNow: n('COMMENT_UNRESOLVED'),
          },
          serviceRequests: {
            created: n('SERVICE_CREATED'),
            linkedToCase: n('SERVICE_LINKED'),
            resolved: n('SERVICE_RESOLVED'),
            overdueNow: n('SERVICE_OVERDUE'),
          },
          unknownCaseClosureTimes,
          filterNotes: [
            'ผู้ตอบใช้คนที่ส่งสำเร็จ; รอบที่ยังไม่ตอบใช้ผู้รับผิดชอบตอนเปิดรอบ',
            'งานในช่วงใช้ผู้สร้าง/ผู้ดำเนินการ; นัดใช้ผู้รับงานในประวัตินัด; งานค้างใช้ผู้รับผิดชอบปัจจุบัน',
            ...(q.staffId
              ? ['คอมเมนต์ขาเข้าไม่มีหลักฐานผู้ดูแล ณ เวลารับ จึงไม่แสดงจำนวนแยกพนักงาน']
              : []),
          ],
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async workDetails(
    authenticated: ChatWorkActor,
    input: ChatWorkDetailsDto,
    observed = new Date(),
  ) {
    if (input.metric === 'COMMENT_RECEIVED' && input.staffId)
      throw new BadRequestException(
        'คอมเมนต์ขาเข้าไม่มีหลักฐานผู้ดูแล ณ เวลารับ กรุณาล้างตัวกรองพนักงาน',
      );
    if (!CHAT_WORK_METRICS.includes(input.metric))
      throw new BadRequestException('ไม่รู้จักตัวชี้วัด');
    await this.syncWork(authenticated, input);
    return this.prisma.$transaction(
      async (tx) => {
        const { actor, q } = await this.context(tx, authenticated, input),
          cycles = await cycleEvidence(tx, actor, q, observed),
          evidence = workEvidence(actor, q, observed);
        const rows = await tx.$queryRaw<
          Array<Omit<ChatWorkMetricDetail, 'occurredAt'> & { occurredAt: Date | null }>
        >`${evidence} SELECT id,room_id AS "roomId",title,occurred_at AS "occurredAt",target_type AS "targetType",target_id AS "targetId" FROM work WHERE metric=${input.metric} ORDER BY occurred_at,id LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`;
        const [count] = await tx.$queryRaw<
          { total: number }[]
        >`${evidence} SELECT COUNT(*)::integer AS total FROM work WHERE metric=${input.metric}`;
        return {
          ...(await this.metadata(tx, actor, q, observed, cycles)),
          data: rows.map((r) => ({ ...r, occurredAt: r.occurredAt?.toISOString() ?? null })),
          total: count.total,
          page: q.page,
          limit: q.limit,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async openWork(authenticated: ChatWorkActor, input: ChatOpenWorkDto, observed = new Date()) {
    if (!['ALL', 'ROOM', 'TASK', 'COMMENT'].includes(input.metric))
      throw new BadRequestException('ไม่รู้จักตัวชี้วัด');
    await this.syncWork(authenticated, input);
    return this.prisma.$transaction(
      async (tx) => {
        const { actor, q } = await this.context(tx, authenticated, input),
          cycles = await cycleEvidence(tx, actor, q, observed),
          evidence = openWorkEvidence(actor, q);
        const predicate =
          input.metric === 'ALL' ? Prisma.sql`TRUE` : Prisma.sql`kind=${input.metric}`;
        const [count] = await tx.$queryRaw<
          { total: number }[]
        >`${evidence} SELECT COUNT(*)::integer AS total FROM open_work WHERE ${predicate}`;
        const rows = await tx.$queryRaw<
          Array<Omit<ChatOpenWorkDetail, 'occurredAt'> & { occurredAt: Date | null }>
        >`${evidence} SELECT kind,id,room_id AS "roomId",title,occurred_at AS "occurredAt",target_type AS "targetType",target_id AS "targetId" FROM open_work WHERE ${predicate} ORDER BY occurred_at NULLS LAST,kind,id LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`;
        return {
          ...(await this.metadata(tx, actor, q, observed, cycles)),
          data: rows.map((r) => ({ ...r, occurredAt: r.occurredAt?.toISOString() ?? null })),
          total: count.total,
          page: q.page,
          limit: q.limit,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async filterOptions(authenticated: ChatWorkActor, input: ChatAnalyticsQueryDto) {
    return this.prisma.$transaction(async (tx) => {
      const { actor, q } = await this.context(tx, authenticated, input);
      const b = getBranchScope(actor);
      const branchId = b.all ? q.branchId : b.branchId;
      const branches = await tx.branch.findMany({
        where: { deletedAt: null, ...(!b.all ? { id: b.branchId! } : {}) },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
      const users = await tx.user.findMany({
        where: {
          isSystemUser: false,
          ...(branchId ? { branchId } : {}),
          role: { in: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES'] },
        },
        select: { id: true, name: true, role: true, accessibleCompanies: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      });
      return {
        branches,
        staff: users
          .filter((u) => hasCompanyAccess(u.role, u.accessibleCompanies, q.company))
          .map(({ id, name }) => ({ id, name })),
      };
    });
  }
}
