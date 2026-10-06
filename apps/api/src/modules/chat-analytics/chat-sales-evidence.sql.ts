import { Prisma } from '@prisma/client';
import { CUSTOMER_BOUGHT_CONTRACT_STATUSES, type ChatWorkActor } from '@installment/shared';
import { getBranchScope } from '../auth/branch-access.util';
import { salesBranchWhere } from '../sales/services/sales-read-policy';
import { completedSaleSql } from '../sales/services/completed-sale-policy';
import { analyticsRoomSql } from './chat-analytics-sql';
import type { ChatAnalyticsQueryDto } from './dto/chat-analytics-query.dto';

export function documentBranchSql(
  actor: ChatWorkActor,
  q: ChatAnalyticsQueryDto,
  column: Prisma.Sql,
) {
  salesBranchWhere(actor, q.branchId); // Keep the canonical report authorization, including no-branch denial.
  const b = getBranchScope(actor);
  const id = b.all ? q.branchId : b.branchId;
  return id ? Prisma.sql`${column}=${id}` : Prisma.sql`TRUE`;
}
/** Documents are never multiplied by rooms, aliases, line items or sale-contract joins. */
export function salesEvidence(actor: ChatWorkActor, q: ChatAnalyticsQueryDto, observed: Date) {
  const now = observed.toISOString();
  const shop = Prisma.sql`SELECT s.id,s.sale_number AS number,'SALE'::text AS type,s.customer_id,s.salesperson_id,s.contract_id,s.created_at,s.net_amount AS amount
 FROM sales s LEFT JOIN contracts k ON k.id=s.contract_id
 WHERE s.deleted_at IS NULL AND ${completedSaleSql} AND ${documentBranchSql(actor, q, Prisma.sql`s.branch_id`)} AND s.created_at<=${now}::timestamp`;
  const finance = Prisma.sql`SELECT k.id,k.contract_number AS number,'CONTRACT'::text AS type,k.customer_id,k.salesperson_id,NULL::text AS contract_id,k.created_at,k.financed_amount AS amount
 FROM contracts k WHERE k.deleted_at IS NULL AND k.status::text IN (${Prisma.join([...CUSTOMER_BOUGHT_CONTRACT_STATUSES])}) AND ${documentBranchSql(actor, q, Prisma.sql`k.branch_id`)} AND k.created_at<=${now}::timestamp`;
  return Prisma.sql`WITH RECURSIVE family(customer_id,member_id,path) AS (
 SELECT id,id,ARRAY[id] FROM customers WHERE deleted_at IS NULL AND merged_into_id IS NULL
 UNION ALL SELECT f.customer_id,m.id,f.path||m.id FROM family f JOIN customers m ON m.merged_into_id=f.member_id WHERE NOT m.id=ANY(f.path)
 ), scoped_rooms AS (
 SELECT r.*,f.customer_id AS canonical_id FROM chat_rooms r JOIN family f ON f.member_id=r.customer_id LEFT JOIN users room_owner ON room_owner.id=r.assigned_to_id WHERE ${analyticsRoomSql(actor, q)}
 ), inbound AS (
 SELECT r.id AS room_id,r.canonical_id AS customer_id,m.created_at AS at FROM scoped_rooms r JOIN chat_messages m ON m.room_id=r.id WHERE m.role='CUSTOMER' AND m.created_at<=${now}::timestamp
 UNION ALL SELECT r.id,r.canonical_id,c.started_at FROM scoped_rooms r JOIN chat_response_cycles c ON c.room_id=r.id WHERE c.origin='LIVE' AND c.deleted_at IS NULL AND c.first_customer_message_id IS NOT NULL AND c.started_at<=${now}::timestamp
 ), contacts AS (
 SELECT customer_id,MIN(at) AS first_at,MAX(at) AS last_at FROM inbound GROUP BY customer_id
 ), documents AS (${q.company === 'SHOP' ? shop : finance}),
 attributed_sales AS (
 SELECT DISTINCT ON (d.id) d.*,f.customer_id AS canonical_id,c.first_at FROM documents d LEFT JOIN family f ON f.member_id=d.customer_id LEFT JOIN contacts c ON c.customer_id=f.customer_id
 WHERE d.created_at>=${q.from}::timestamp AND d.created_at<${q.to}::timestamp AND ${q.staffId ? Prisma.sql`d.salesperson_id=${q.staffId}` : Prisma.sql`TRUE`} ORDER BY d.id
 )`;
}
export const matchedSaleSql = Prisma.sql`s.canonical_id IS NOT NULL AND s.first_at IS NOT NULL AND s.first_at<=s.created_at`;
