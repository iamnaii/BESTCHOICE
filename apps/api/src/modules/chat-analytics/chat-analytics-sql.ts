import { Prisma } from '@prisma/client';
import type { ChatWorkActor, ChatCycleMetric } from '@installment/shared';
import type { ChatAnalyticsQueryDto } from './dto/chat-analytics-query.dto';
import { roomWorkSql } from '../staff-chat/services/chat-work-sql';
import { policyFromVersion } from '../chat-engine/services/chat-sla-policy';
export function analyticsRoomSql(actor: ChatWorkActor, q: ChatAnalyticsQueryDto) {
  return Prisma.sql`${roomWorkSql(actor, q)} AND ${q.channel ? Prisma.sql`r.channel::text=${q.channel}` : Prisma.sql`TRUE`}`;
}
// Same seven-day Bangkok windows as F1; cumulative work minutes avoid per-cycle generate_series.
function businessMinutes(at: Prisma.Sql) {
  const start = Prisma.sql`x.started_at`;
  const clock = (v: Prisma.Sql) =>
    Prisma.sql`GREATEST(0,LEAST((p.close_hour-p.open_hour)*60,EXTRACT(EPOCH FROM (${v}+INTERVAL '7 hours')::time)/60-p.open_hour*60))`;
  return Prisma.sql`CASE WHEN ${at} IS NULL OR ${at}<${start} OR p.open_hour IS NULL THEN NULL ELSE
 (((${at}+INTERVAL '7 hours')::date-(${start}+INTERVAL '7 hours')::date)*(p.close_hour-p.open_hour)*60 + ${clock(at)}-${clock(start)})::double precision END`;
}
export async function cycleEvidence(
  tx: Prisma.TransactionClient,
  actor: ChatWorkActor,
  q: ChatAnalyticsQueryDto,
  observed: Date,
) {
  const scope = analyticsRoomSql(actor, q);
  const versions = await tx.$queryRaw<
    { version: string }[]
  >`SELECT DISTINCT c.policy_version AS version FROM chat_response_cycles c JOIN chat_rooms r ON r.id=c.room_id LEFT JOIN users room_owner ON room_owner.id=r.assigned_to_id WHERE ${scope} AND c.deleted_at IS NULL AND c.started_at>=${q.from}::timestamp AND c.started_at<${q.to}::timestamp`;
  const policies: Prisma.Sql[] = [];
  for (const { version } of versions) {
    try {
      const p = policyFromVersion(version);
      policies.push(
        Prisma.sql`(${version}::text,${q.company === 'SHOP' ? p.shopOpen : p.financeOpen}::integer,${q.company === 'SHOP' ? p.shopClose : p.financeClose}::integer,${p.ownerMinutes}::integer)`,
      );
    } catch {
      /* Explicit coverage exclusion, never replace historical policy. */
    }
  }
  if (!policies.length)
    policies.push(Prisma.sql`(''::text,NULL::integer,NULL::integer,NULL::integer)`);
  return Prisma.sql`WITH policy(version,open_hour,close_hour,owner_minutes) AS (VALUES ${Prisma.join(policies)}), raw_cycles AS (
 SELECT c.*,r.display_name,
 CASE WHEN c.first_human_sent_at<=${observed.toISOString()}::timestamp THEN c.first_human_sent_at END AS human_at,
 CASE WHEN c.first_bot_sent_at<=${observed.toISOString()}::timestamp THEN c.first_bot_sent_at END AS bot_at,
 CASE WHEN c.ended_at<=${observed.toISOString()}::timestamp THEN c.ended_at END AS end_at
 FROM chat_response_cycles c JOIN chat_rooms r ON r.id=c.room_id LEFT JOIN users room_owner ON room_owner.id=r.assigned_to_id
 WHERE ${scope} AND c.deleted_at IS NULL AND c.started_at>=${q.from}::timestamp AND c.started_at<${q.to}::timestamp AND c.started_at<=${observed.toISOString()}::timestamp
 AND ${q.staffId ? Prisma.sql`(CASE WHEN c.first_human_sent_at<=${observed.toISOString()}::timestamp THEN c.first_human_staff_id ELSE c.assigned_at_open_id END)=${q.staffId}` : Prisma.sql`TRUE`}
 ), measured AS (
 SELECT x.*,p.owner_minutes,${businessMinutes(Prisma.sql`x.human_at`)} AS human_minutes,${businessMinutes(Prisma.sql`x.bot_at`)} AS bot_minutes,
 ${businessMinutes(Prisma.sql`COALESCE(x.human_at,x.end_at,${observed.toISOString()}::timestamp)`)} AS wait_minutes
 FROM raw_cycles x LEFT JOIN policy p ON p.version=x.policy_version
 ), live AS (SELECT * FROM measured WHERE origin='LIVE' AND merged_into_id IS NULL)`;
}
export const responseAggregate = Prisma.sql`
 COUNT(*)::integer AS cycles,COUNT(DISTINCT room_id)::integer AS rooms,
 COUNT(*) FILTER(WHERE human_at IS NOT NULL)::integer AS "nResponded",
 COUNT(*) FILTER(WHERE human_at IS NULL AND end_at IS NULL)::integer AS "nAwaiting",
 COUNT(*) FILTER(WHERE human_at IS NULL AND end_at IS NOT NULL AND end_reason='RESOLVED')::integer AS "nResolvedWithoutReply",
 percentile_disc(0.5) WITHIN GROUP(ORDER BY human_minutes) AS "humanMedianMinutes",
 percentile_disc(0.9) WITHIN GROUP(ORDER BY human_minutes) AS "humanP90Minutes",
 COUNT(human_minutes)::integer AS "humanSamples",
 percentile_disc(0.5) WITHIN GROUP(ORDER BY bot_minutes) AS "botMedianMinutes",
 percentile_disc(0.9) WITHIN GROUP(ORDER BY bot_minutes) AS "botP90Minutes",
 COUNT(bot_minutes)::integer AS "botSamples",
 COUNT(*) FILTER(WHERE wait_minutes>=owner_minutes)::integer AS "slaBreached",
 COUNT(wait_minutes)::integer AS "slaSamples"`;
export function cycleMetricSql(metric: ChatCycleMetric) {
  return {
    ALL: Prisma.sql`TRUE`,
    RESPONDED: Prisma.sql`human_at IS NOT NULL`,
    AWAITING: Prisma.sql`human_at IS NULL AND end_at IS NULL`,
    RESOLVED: Prisma.sql`human_at IS NULL AND end_at IS NOT NULL AND end_reason='RESOLVED'`,
    BOT: Prisma.sql`bot_at IS NOT NULL`,
    SLA: Prisma.sql`wait_minutes>=owner_minutes`,
    UNKNOWN: Prisma.sql`human_at IS NOT NULL AND first_human_staff_id IS NULL`,
  }[metric];
}
