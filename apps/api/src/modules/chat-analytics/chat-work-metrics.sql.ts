import { Prisma } from '@prisma/client';
import type { ChatWorkActor, ChatWorkMetric } from '@installment/shared';
import type { ChatAnalyticsQueryDto } from './dto/chat-analytics-query.dto';
import { analyticsRoomSql } from './chat-analytics-sql';
import { commentWorkSql } from '../staff-chat/services/chat-work-sql';
/** One SQL evidence relation feeds both aggregate cards and paginated drilldowns. */
export function workEvidence(actor: ChatWorkActor, q: ChatAnalyticsQueryDto, observed: Date) {
  const room = analyticsRoomSql(actor, q),
    now = Prisma.sql`${observed.toISOString()}::timestamp`;
  const period = (at: Prisma.Sql) =>
    Prisma.sql`${at}>=${q.from}::timestamp AND ${at}<${q.to}::timestamp AND ${at}<=${now}`;
  const staff = (id: Prisma.Sql) => (q.staffId ? Prisma.sql`${id}=${q.staffId}` : Prisma.sql`TRUE`);
  const rows: Prisma.Sql[] = [];
  const events: {
    metric: ChatWorkMetric;
    kind: string;
    predicate: Prisma.Sql;
    at?: Prisma.Sql;
    staff?: Prisma.Sql;
  }[] = [
    { metric: 'HANDOFF_CREATED', kind: 'CHAT_HANDOFF', predicate: Prisma.sql`e.kind='CREATED'` },
    {
      metric: 'HANDOFF_ACCEPTED',
      kind: 'CHAT_HANDOFF',
      predicate: Prisma.sql`e.from_status='TODO' AND e.to_status='DOING'`,
    },
    {
      metric: 'HANDOFF_COMPLETED',
      kind: 'CHAT_HANDOFF',
      predicate: Prisma.sql`e.to_status='DONE' AND e.from_status IS DISTINCT FROM 'DONE'`,
    },
    {
      metric: 'FOLLOW_UP_DUE',
      kind: 'CHAT_FOLLOW_UP',
      predicate: Prisma.sql`e.created_at<=${now}`,
      at: Prisma.sql`e.to_due_at`,
      staff: Prisma.sql`e.to_assignee_id`,
    },
    {
      metric: 'FOLLOW_UP_COMPLETED',
      kind: 'CHAT_FOLLOW_UP',
      predicate: Prisma.sql`e.to_status='DONE' AND e.from_status IS DISTINCT FROM 'DONE'`,
    },
  ];
  for (const event of events) {
    const at = event.at ?? Prisma.sql`e.created_at`;
    rows.push(
      Prisma.sql`SELECT ${event.metric}::text AS metric,t.id,t.room_id,t.title,${at} AS occurred_at,'TODO'::text AS target_type,t.id AS target_id FROM todo_work_events e JOIN todos t ON t.id=e.todo_id JOIN chat_rooms r ON r.id=t.room_id LEFT JOIN users room_owner ON room_owner.id=r.assigned_to_id WHERE ${room} AND t.deleted_at IS NULL AND t.work_kind::text=${event.kind} AND ${event.predicate} AND ${period(at)} AND ${staff(event.staff ?? Prisma.sql`e.actor_id`)}`,
    );
  }
  for (const [kind, metric] of [
    ['CHAT_HANDOFF', 'HANDOFF_OVERDUE'],
    ['CHAT_FOLLOW_UP', 'FOLLOW_UP_OVERDUE'],
    ['CHAT_SERVICE', 'SERVICE_OVERDUE'],
  ] as const) {
    rows.push(
      Prisma.sql`SELECT ${metric}::text AS metric,t.id,t.room_id,t.title,t.due_date AS occurred_at,${kind === 'CHAT_SERVICE' ? 'SERVICE_REQUEST' : 'TODO'}::text AS target_type,${kind === 'CHAT_SERVICE' ? Prisma.sql`s.id` : Prisma.sql`t.id`} AS target_id FROM todos t JOIN chat_rooms r ON r.id=t.room_id LEFT JOIN users room_owner ON room_owner.id=r.assigned_to_id LEFT JOIN chat_service_requests s ON s.todo_id=t.id AND s.deleted_at IS NULL WHERE ${room} AND t.deleted_at IS NULL AND t.work_kind::text=${kind} AND t.status IN ('TODO','DOING','REVIEW') AND t.due_date<${now} AND ${staff(Prisma.sql`t.assignee_id`)} AND ${kind === 'CHAT_SERVICE' ? Prisma.sql`s.id IS NOT NULL` : Prisma.sql`TRUE`}`,
    );
  }
  for (const [metric, predicate, at] of [
    ['SERVICE_CREATED', Prisma.sql`e.kind='CREATE'`, Prisma.sql`e.created_at`],
    ['SERVICE_LINKED', Prisma.sql`e.kind='LINK_CASE'`, Prisma.sql`e.created_at`],
    [
      'SERVICE_RESOLVED',
      Prisma.sql`(e.to_status='RESOLVED' AND e.from_status IS DISTINCT FROM 'RESOLVED') OR (e.kind='CASE_TERMINAL_OBSERVED' AND t.status='DONE')`,
      Prisma.sql`CASE WHEN e.kind='CASE_TERMINAL_OBSERVED' THEN t.completed_at ELSE e.created_at END`,
    ],
  ] as const) {
    rows.push(
      Prisma.sql`SELECT ${metric}::text AS metric,s.id,s.room_id,'รับเรื่องหลังการขาย'::text AS title,${at} AS occurred_at,'SERVICE_REQUEST'::text AS target_type,s.id AS target_id FROM chat_service_request_events e JOIN chat_service_requests s ON s.id=e.request_id JOIN todos t ON t.id=s.todo_id JOIN chat_rooms r ON r.id=s.room_id LEFT JOIN users room_owner ON room_owner.id=r.assigned_to_id WHERE ${room} AND s.deleted_at IS NULL AND t.deleted_at IS NULL AND (${predicate}) AND ${period(at)} AND ${staff(Prisma.sql`e.actor_id`)}`,
    );
  }
  if (!q.channel || q.channel === 'FACEBOOK') {
    const scope = commentWorkSql(actor, q);
    rows.push(
      Prisma.sql`SELECT 'COMMENT_RECEIVED'::text AS metric,c.id,NULL::text AS room_id,'คอมเมนต์สาธารณะ'::text AS title,e.created_at AS occurred_at,'FACEBOOK_COMMENT'::text AS target_type,c.id AS target_id FROM facebook_comment_events e JOIN facebook_comment_threads c ON c.id=e.thread_id WHERE ${scope} AND e.verb IN ('ADD','EDIT') AND (e.payload->'from'->>'id') IS NOT NULL AND (e.payload->'from'->>'id')<>c.page_id AND ${period(Prisma.sql`e.created_at`)} AND ${q.staffId ? Prisma.sql`FALSE` : Prisma.sql`TRUE`}`,
    );
    rows.push(
      Prisma.sql`SELECT 'COMMENT_CONFIRMED'::text AS metric,e.id,NULL::text AS room_id,'คำตอบคอมเมนต์ที่ยืนยันแล้ว'::text AS title,e.confirmed_at AS occurred_at,'FACEBOOK_COMMENT'::text AS target_type,c.id AS target_id FROM facebook_comment_replies e JOIN facebook_comment_threads c ON c.id=e.thread_id WHERE ${scope} AND e.status='CONFIRMED' AND ${period(Prisma.sql`e.confirmed_at`)} AND ${staff(Prisma.sql`e.author_id`)}`,
    );
    rows.push(
      Prisma.sql`SELECT 'COMMENT_UNRESOLVED'::text AS metric,c.id,NULL::text AS room_id,'คอมเมนต์รอตอบ'::text AS title,c.waiting_since AS occurred_at,'FACEBOOK_COMMENT'::text AS target_type,c.id AS target_id FROM facebook_comment_threads c WHERE ${scope} AND c.status='OPEN' AND NOT c.root_deleted AND c.waiting_since IS NOT NULL AND ${staff(Prisma.sql`c.assignee_id`)}`,
    );
  }
  return Prisma.sql`WITH raw_work AS (${Prisma.join(rows, ' UNION ALL ')}),work AS (SELECT DISTINCT ON(metric,id) * FROM raw_work ORDER BY metric,id,occurred_at ASC NULLS LAST)`;
}
