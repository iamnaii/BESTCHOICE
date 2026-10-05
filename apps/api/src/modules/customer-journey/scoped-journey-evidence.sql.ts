import { Prisma } from '@prisma/client';
import {
  CUSTOMER_BOUGHT_CONTRACT_STATUSES,
  CUSTOMER_BOUGHT_SALE_TYPES,
  type Company,
} from '@installment/shared';
/** Read-only scoped projection of journey-state.sql. Consumes family/scoped_rooms/contacts/documents CTEs.
 * Never expose the global customer cache through a company-limited report. Unscoped manual entries
 * cannot prove company membership. Bought statuses/types remain the shared BOUGHT_WHERE authority.
 */
export function scopedJourneyEvidence(options: {
  company: Company;
  from: string;
  to: string;
  observed: Date;
  staffId?: string;
  contractBranch: Prisma.Sql;
}) {
  const { company, from, to, observed, staffId, contractBranch } = options;
  const now = observed.toISOString();
  return Prisma.sql`, scoped_entries AS (
 SELECT e.*,f.customer_id AS canonical_id FROM customer_journey_entries e JOIN family f ON f.member_id=e.customer_id
 JOIN scoped_rooms r ON r.id=e.room_id AND r.canonical_id=f.customer_id
 WHERE e.deleted_at IS NULL AND e.occurred_at<=${now}::timestamp
 ), scoped_contracts AS (
 SELECT k.*,f.customer_id AS canonical_id FROM contracts k JOIN family f ON f.member_id=k.customer_id
 WHERE k.deleted_at IS NULL AND ${contractBranch} AND k.created_at<=${now}::timestamp
 ), journey_facts AS (
 SELECT c.customer_id,u.name,c.first_at,c.last_at,
 (u.phone IS NOT NULL OR u.national_id IS NOT NULL OR EXISTS(SELECT 1 FROM scoped_entries e WHERE e.canonical_id=c.customer_id AND e.kind='IDENTIFIED')) AS identified,
 (EXISTS(SELECT 1 FROM scoped_entries e WHERE e.canonical_id=c.customer_id AND e.kind='TOUCHPOINT' AND e.outcome IN ('APPOINTED','VISITED'))
 OR EXISTS(SELECT 1 FROM scoped_rooms r JOIN todos t ON t.room_id=r.id WHERE r.canonical_id=c.customer_id AND t.deleted_at IS NULL AND t.due_date IS NOT NULL AND t.created_at<=${now}::timestamp)) AS interested,
 (EXISTS(SELECT 1 FROM scoped_rooms r JOIN room_credit_analyses a ON a.room_id=r.id WHERE r.canonical_id=c.customer_id AND a.deleted_at IS NULL AND a.status='COMPLETED' AND a.created_at<=${now}::timestamp)
 OR EXISTS(SELECT 1 FROM scoped_contracts k WHERE k.canonical_id=c.customer_id)) AS credit,
 (EXISTS(SELECT 1 FROM scoped_contracts k WHERE k.canonical_id=c.customer_id AND k.status::text IN (${Prisma.join([...CUSTOMER_BOUGHT_CONTRACT_STATUSES])}))
 OR ${company === 'SHOP' ? Prisma.sql`EXISTS(SELECT 1 FROM documents d JOIN family f ON f.member_id=d.customer_id WHERE f.customer_id=c.customer_id AND d.type='SALE' AND EXISTS(SELECT 1 FROM sales s WHERE s.id=d.id AND s.sale_type::text IN (${Prisma.join([...CUSTOMER_BOUGHT_SALE_TYPES])})))` : Prisma.sql`FALSE`}) AS purchased,
 lm.kind AS lost_kind,lm.lost_reason,lm.occurred_at AS lost_at,
 (SELECT MAX(e.occurred_at) FROM scoped_entries e WHERE e.canonical_id=c.customer_id AND e.kind='TOUCHPOINT') AS touched_at
 FROM contacts c JOIN customers u ON u.id=c.customer_id
 LEFT JOIN LATERAL(SELECT e.kind,e.lost_reason,e.occurred_at FROM scoped_entries e WHERE e.canonical_id=c.customer_id AND e.kind IN ('MARKED_LOST','REOPENED') ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1) lm ON TRUE
 WHERE c.first_at>=${from}::timestamp AND c.first_at<${to}::timestamp
 AND ${staffId ? Prisma.sql`EXISTS(SELECT 1 FROM scoped_rooms r WHERE r.canonical_id=c.customer_id AND r.assigned_to_id=${staffId})` : Prisma.sql`TRUE`}
 ), journey AS (
 SELECT *,CASE WHEN purchased THEN 4 WHEN credit THEN 3 WHEN interested THEN 2 WHEN identified THEN 1 ELSE 0 END AS stage_index,
 CASE WHEN NOT purchased AND lost_kind='MARKED_LOST' AND last_at<=lost_at AND (touched_at IS NULL OR touched_at<=lost_at) THEN COALESCE(lost_reason,'OTHER') END AS current_loss
 FROM journey_facts
 ), journey_steps AS (
 SELECT j.*,s.stage,s.idx,s.proven FROM journey j CROSS JOIN LATERAL(VALUES
 ('CONTACTED',0,TRUE),('IDENTIFIED',1,j.identified),('INTERESTED',2,j.interested),('CREDIT',3,j.credit),('PURCHASED',4,j.purchased)) s(stage,idx,proven)
 )`;
}
