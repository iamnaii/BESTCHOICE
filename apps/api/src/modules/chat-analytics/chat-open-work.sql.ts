import { Prisma } from '@prisma/client';
import type { ChatWorkActor } from '@installment/shared';
import type { ChatAnalyticsQueryDto } from './dto/chat-analytics-query.dto';
import { analyticsRoomSql } from './chat-analytics-sql';
import { commentWorkSql } from '../staff-chat/services/chat-work-sql';
/** Current rows, deliberately independent of the response cohort's dates. */
export function openWorkEvidence(actor: ChatWorkActor, q: ChatAnalyticsQueryDto) {
  const room = analyticsRoomSql(actor, q);
  const staff = (id: Prisma.Sql) => (q.staffId ? Prisma.sql`${id}=${q.staffId}` : Prisma.sql`TRUE`);
  return Prisma.sql`WITH open_work AS (
 SELECT 'ROOM'::text AS kind,r.id,r.id AS room_id,COALESCE(r.display_name,'ห้องแชท') AS title,r.waiting_since AS occurred_at,'ROOM'::text AS target_type,r.id AS target_id
 FROM chat_rooms r LEFT JOIN users room_owner ON room_owner.id=r.assigned_to_id WHERE ${room} AND r.waiting_since IS NOT NULL AND ${staff(Prisma.sql`r.assigned_to_id`)}
 UNION ALL SELECT 'TASK',t.id,t.room_id,t.title,t.due_date,CASE WHEN s.id IS NOT NULL THEN 'SERVICE_REQUEST' ELSE 'TODO' END,COALESCE(s.id,t.id)
 FROM todos t JOIN chat_rooms r ON r.id=t.room_id LEFT JOIN users room_owner ON room_owner.id=r.assigned_to_id LEFT JOIN chat_service_requests s ON s.todo_id=t.id AND s.deleted_at IS NULL
 WHERE ${room} AND t.deleted_at IS NULL AND t.status IN ('TODO','DOING','REVIEW') AND ${staff(Prisma.sql`t.assignee_id`)}
 UNION ALL SELECT 'COMMENT',c.id,NULL::text,'คอมเมนต์ Facebook',c.waiting_since,'FACEBOOK_COMMENT',c.id
 FROM facebook_comment_threads c WHERE ${commentWorkSql(actor, q)} AND ${!q.channel || q.channel === 'FACEBOOK' ? Prisma.sql`TRUE` : Prisma.sql`FALSE`} AND c.status='OPEN' AND c.root_deleted=FALSE AND c.waiting_since IS NOT NULL AND ${staff(Prisma.sql`c.assignee_id`)}
 )`;
}
