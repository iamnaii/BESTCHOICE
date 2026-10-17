import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CUSTOMER_BOUGHT_CONTRACT_STATUSES, CUSTOMER_BOUGHT_SALE_TYPES } from '@installment/shared';
import type { PartyJourneyPlan } from '../employee-access/access-party-journey-plan';
import type { JourneyStateRow } from './journey-summary.builder';
/** The canonical CTE and loss/staff-reply formulas have one source. The system
 * writer still consumes the full file, including its frozen-history upsert. */
export function canonicalJourneySql() {
  const sql = readFileSync(join(__dirname, 'sql', 'journey-state.sql'), 'utf8');
  const marker = '\nINSERT INTO customer_journey_states (';
  const end = sql.indexOf(marker),
    start = sql.indexOf('WITH target AS (');
  if (start < 0 || end < start || sql.indexOf(marker, end + 1) >= 0)
    throw new Error('Canonical Journey SQL boundary changed');
  return { readCte: sql.slice(start + 5, end), writeSql: sql };
}
export interface JourneyReadState extends JourneyStateRow {
  bought: boolean;
  firstPurchaseKind: string | null;
}
export async function readManagedJourneyState(
  plan: PartyJourneyPlan,
  now = new Date(),
): Promise<JourneyReadState> {
  const values: unknown[] = [
    [plan.targetId],
    [...CUSTOMER_BOUGHT_CONTRACT_STATUSES],
    [...CUSTOMER_BOUGHT_SALE_TYPES],
    now.toISOString(),
  ];
  const array = (ids: Iterable<string>) => {
    values.push([...ids]);
    return `$${values.length}::text[]`;
  };
  const customerIds = array(new Set([plan.targetId, ...plan.ids.customer]));
  const family = array(plan.family);
  const bindings: string[] = [
    `customers AS (SELECT id,${plan.ids.customer.has(plan.targetId) ? 'created_at' : 'NULL::timestamp AS created_at'},updated_at,deleted_at,merged_into_id,
    CASE WHEN acquisition_source IN ('WALK_IN','REFERRAL') THEN acquisition_source ELSE NULL END AS acquisition_source,
    ${plan.referrerAllowed ? 'referred_by_id' : 'NULL::text AS referred_by_id'}, ${plan.identitySensitive ? 'phone' : 'NULL::text'} AS phone,
    ${plan.identitySensitive ? 'national_id' : 'NULL::text'} AS national_id
    FROM public.customers WHERE id=ANY(${customerIds}))`,
  ];
  const tables = [
    ['chat_rooms', 'chatRoom'],
    ['contracts', 'contract'],
    ['sales', 'sale'],
    ['bookings', 'booking'],
    ['trade_ins', 'tradeIn'],
    ['credit_checks', 'creditCheck'],
    ['room_credit_analyses', 'roomCreditAnalysis'],
    ['customer_journey_entries', 'customerJourneyEntry'],
    ['customer_line_links', 'customerLineLink'],
    ['online_orders', 'onlineOrder'],
    ['online_installment_applications', 'onlineInstallmentApplication'],
    ['product_reservations', 'productReservation'],
    ['saving_plans', 'savingPlan'],
    ['audit_logs', 'auditLead'],
    ['ads_attributions', 'adsAttribution'],
    ['ads_campaigns', 'adsCampaign'],
  ] as const;
  for (const [table, key] of tables)
    bindings.push(
      `${table} AS (SELECT * FROM public.${table} WHERE id=ANY(${array(plan.ids[key])}))`,
    );
  bindings.push(`chat_messages AS (SELECT id,room_id,created_at,role,type,external_message_id,outbound_sent_at,staff_id,
    CASE WHEN room_id=ANY(${array(plan.ids.chatFileRoom)}) THEN media_url ELSE NULL END AS media_url
    FROM public.chat_messages WHERE room_id=ANY(${array(plan.ids.chatRoom)}))`);
  bindings.push(
    `todos AS (SELECT id,room_id,created_at,deleted_at,due_date FROM public.todos WHERE room_id=ANY(${array(plan.ids.chatRoom)}))`,
  );
  let cte = canonicalJourneySql().readCte;
  const begin = cte.indexOf('family AS ('),
    end = cte.indexOf('\nrooms AS (', begin);
  if (begin < 0 || end < 0) throw new Error('Canonical family boundary changed');
  cte =
    cte.slice(0, begin) +
    `family AS (SELECT t.id AS customer_id,unnest(${family}) AS member_id FROM target t),` +
    cte.slice(end);
  const sql = `WITH ${bindings.join(',\n')},${cte}
 SELECT stage, CASE stage WHEN 'PURCHASED' THEN first_purchase_at WHEN 'CREDIT' THEN credit_at WHEN 'INTERESTED' THEN interested_at WHEN 'IDENTIFIED' THEN identified_at ELSE contacted_at END AS "stageEnteredAt",
 path,contacted_at AS "contactedAt",identified_at AS "identifiedAt",interested_at AS "interestedAt",credit_at AS "creditAt",first_purchase_at AS "firstPurchaseAt",first_purchase_kind AS "firstPurchaseKind",first_staff_reply_at AS "firstStaffReplyAt",first_channel AS "firstChannel",first_source AS "firstSource",first_ad_campaign_id AS "firstAdCampaignId",heard_from AS "heardFrom",last_customer_at AS "lastCustomerAt",last_touch_at AS "lastTouchAt",lost_at AS "lostAt",CASE WHEN lost_at IS NOT NULL THEN lost_mark_reason END AS "lostReason",$4::timestamp AS "computedAt",bought FROM resolved`;
  // SQL text is the fixed checked-in canonical formula plus finite trusted table
  // bindings. Every value, including IDs and timestamp, remains parameterized.
  const rows = await plan.db.$queryRawUnsafe<JourneyReadState[]>(sql, ...values);
  if (!rows[0]) throw new Error('Authorized Journey target disappeared');
  return rows[0];
}
