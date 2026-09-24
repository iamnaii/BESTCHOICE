import {
  JOURNEY_EVENT_GROUPS,
  JOURNEY_HEARD_FROM_LABELS,
  JOURNEY_LOST_REASON_LABELS,
  type JourneyEntryKind,
  type JourneyEvent,
  type JourneyEventGroup,
  type JourneyStage,
} from '@installment/shared';
import { roomAssignmentScope } from '../../credit-check/services/room-credit-access';
import { JOURNEY_DATA_SCHEMAS } from '../journey-data-schemas';
import {
  asActorType,
  asRecord,
  dbTimeRange,
  finalizeSource,
  roleSeesGroup,
  scanTake,
  staffActor,
  whenAny,
  type JourneySource,
} from './journey-window';

type ShownKind = Exclude<JourneyEntryKind, 'CREDIT_CHECK_OPENED_BY'>; // credit.source.ts ใช้เติมผู้เปิดแทน
const VIEWS: Record<
  ShownKind,
  { group: JourneyEventGroup; stage: JourneyStage | null; title: string }
> = {
  CONTRACT_ACTIVATED: { group: 'sale', stage: 'PURCHASED', title: 'เริ่มผ่อนสัญญา' },
  CONTRACT_REVIEWED: { group: 'sale', stage: 'CREDIT', title: 'ผู้จัดการตรวจสัญญา' },
  DEVICE_RETURNED: { group: 'sale', stage: null, title: 'คืนเครื่อง' },
  EARLY_PAYOFF: { group: 'sale', stage: null, title: 'ปิดยอดก่อนกำหนด' },
  CREDIT_AI_SCORED: { group: 'credit', stage: 'CREDIT', title: 'AI ประเมินเครดิตแล้ว' },
  BOT_HANDOFF: { group: 'chat', stage: null, title: 'บอทส่งต่อพนักงาน' },
  CONTACT_ADDED: { group: 'chat', stage: 'IDENTIFIED', title: 'ได้เบอร์/เลขบัตรลูกค้าแล้ว' },
  LINE_LINKED: { group: 'chat', stage: 'IDENTIFIED', title: 'ผูก LINE แล้ว' },
  PRODUCT_LINK_CLICK: { group: 'chat', stage: 'CONTACTED', title: 'กดมาจากสินค้าบนเว็บ' },
  PLACEHOLDER_MERGED: {
    group: 'chat',
    stage: 'IDENTIFIED',
    title: 'รวมประวัติแชทเข้ากับลูกค้าคนนี้',
  },
  TOUCHPOINT: { group: 'chat', stage: null, title: 'พนักงานบันทึกการติดต่อ' },
  HEARD_FROM: { group: 'chat', stage: null, title: 'ลูกค้าบอกว่ารู้จักร้าน' },
  MARKED_LOST: { group: 'chat', stage: null, title: 'ติดป้ายหลุด' },
  REOPENED: { group: 'chat', stage: null, title: 'เปิดใหม่' },
};
const TOUCH_CHANNELS: Record<string, string> = {
  PHONE: 'โทร',
  FB_APP: 'แชทในแอป FB',
  LINE_APP: 'LINE',
  WALK_IN: 'หน้าร้าน',
  OTHER: 'อื่น ๆ',
};
const OUTCOMES: Record<string, string> = {
  APPOINTED: 'นัดแล้ว',
  VISITED: 'มาร้านแล้ว',
  THINKING: 'ขอคิดก่อน',
  BUDGET: 'งบ/ดาวน์ไม่พอ',
  NO_ANSWER: 'ไม่รับสาย',
  BOUGHT_ELSEWHERE: 'ซื้อที่อื่น',
  NOT_INTERESTED: 'ไม่สนใจ',
};
// ป้ายรู้จักร้านจาก / เหตุผลหลุด = JOURNEY_HEARD_FROM_LABELS / JOURNEY_LOST_REASON_LABELS ของ shared (ชุดเดียวกับ summary และเว็บ)
/** ชุดเดียวกับ apps/web/src/pages/CustomersPage/components/ProspectFilterBar.tsx:30-36 */
const TAG_LABELS: Record<string, string> = {
  VIP: 'VIP',
  HIGH_RISK: 'เสี่ยงสูง',
  NEW: 'ลูกค้าใหม่',
  LOYAL: 'ลูกค้าประจำ',
  BLACKLIST: 'BLACKLIST',
  RETURNED_DEVICE: 'เคยคืนเครื่อง',
};

const isShownKind = (kind: string): kind is ShownKind =>
  Object.prototype.hasOwnProperty.call(VIEWS, kind);

/** kind ที่แสดงของชุดกลุ่ม (ลำดับตาม VIEWS) — ให้ DB กรอง ไม่ใช่ตัดหลังดึง */
const kindsOf = (groups: ReadonlySet<JourneyEventGroup>): ShownKind[] =>
  (Object.keys(VIEWS) as ShownKind[]).filter((kind) => groups.has(VIEWS[kind].group));

/** data ผ่าน zod ของ kind อีกรอบก่อนส่งออก — ไม่ผ่าน/ไม่มี schema = ไม่ส่ง metadata */
function whitelisted(kind: string, data: unknown): Record<string, unknown> | undefined {
  const schema = (
    JOURNEY_DATA_SCHEMAS as unknown as Partial<
      Record<string, { safeParse(input: unknown): { success: boolean; data?: unknown } }>
    >
  )[kind];
  if (!schema || data === null || data === undefined) return undefined;
  const parsed = schema.safeParse(data);
  const record = parsed.success ? asRecord(parsed.data) : {};
  return Object.keys(record).length ? record : undefined;
}

interface TagRow {
  id: string;
  tag: string;
  createdAt: Date;
  deletedAt: Date | null;
}
/** absorbPlaceholder soft-delete แท็กที่ปลายทางมีอยู่แล้ว — ไม่ใช่การถอดจริง: มีแถวแท็กเดียวกันสร้างไม่เกิน 2 วินาทีหลังเวลาลบและยังอยู่ ณ เวลานั้น */
const isMergeDuplicate = (row: TagRow, all: readonly TagRow[]) =>
  !!row.deletedAt &&
  all.some(
    (o) =>
      o.id !== row.id &&
      o.tag === row.tag &&
      o.createdAt.getTime() <= row.deletedAt!.getTime() + 2000 &&
      (!o.deletedAt || o.deletedAt > row.deletedAt!),
  );

/**
 * แถว entries + แท็ก ของกลุ่มที่ขอ — kind กรองที่ DB (แถวของกลุ่มหนึ่งไม่ดันอีกกลุ่มหลุด take) · แท็ก (กลุ่ม system) อ่านเฉพาะเมื่อขอ system
 * หน้า GET /customers/:id/journey ใช้ entriesSourceFor(กลุ่มที่ resolve แล้ว) — แถวของกลุ่มที่ไม่ได้ขอ/บทบาทไม่เห็นไม่กินขอบ limit+1 · กลุ่มที่ไม่มี kind และไม่ใช่ system = ไม่ยิง DB
 */
export function entriesSourceFor(groups: ReadonlySet<JourneyEventGroup>): JourneySource {
  const kinds = kindsOf(groups);
  const withTags = groups.has('system');
  return async (prisma, customerIds, window, actor) => {
    const [rows, tags] = await Promise.all([
      whenAny(kinds, () =>
        prisma.customerJourneyEntry.findMany({
          where: {
            customerId: { in: customerIds },
            deletedAt: null,
            kind: { in: kinds },
            occurredAt: dbTimeRange(window),
          },
          // ไม่ select note (ข้อความอิสระ) ทุกกรณี
          select: {
            id: true,
            kind: true,
            origin: true,
            occurredAt: true,
            actorType: true,
            roomId: true,
            refType: true,
            refId: true,
            data: true,
            channel: true,
            outcome: true,
            lostReason: true,
            heardFrom: true,
            actorUser: { select: { id: true, name: true } },
          },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: scanTake(window),
        }),
      ),
      whenAny(withTags ? customerIds : [], () =>
        prisma.customerTag.findMany({
          where: { customerId: { in: customerIds } },
          select: {
            id: true,
            tag: true,
            source: true,
            createdAt: true,
            deletedAt: true,
            appliedBy: { select: { id: true, name: true } },
          },
        }),
      ),
    ]);
    const roomIds = [
      ...new Set(rows.map((r) => r.roomId).filter((id): id is string => id !== null)),
    ];
    const roomScope = roomAssignmentScope(actor); // กติกาห้องที่ดูแล (ด่านเดียวกับ room-manager) — ว่าง = บทบาทนี้ไม่จำกัดห้อง
    const visibleRooms = Object.keys(roomScope).length
      ? new Set(
          (
            await whenAny(roomIds, () =>
              prisma.chatRoom.findMany({
                where: { id: { in: roomIds }, ...roomScope },
                select: { id: true },
              }),
            )
          ).map((r) => r.id),
        )
      : null;
    const seesChat = roleSeesGroup(actor.role, 'chat');
    const events: JourneyEvent[] = [];

    for (const row of rows) {
      const kind = row.kind;
      // DB กรอง kind แล้ว — ตรวจกลุ่มซ้ำฝั่งโค้ด · kind ที่ยังไม่มีใน VIEWS ถูกทิ้ง
      if (
        !isShownKind(kind) ||
        !groups.has(VIEWS[kind].group) ||
        (row.roomId && visibleRooms && !visibleRooms.has(row.roomId))
      )
        continue;
      const data = whitelisted(kind, row.data);
      const title =
        kind === 'TOUCHPOINT'
          ? `ติดต่อทาง${TOUCH_CHANNELS[row.channel ?? ''] ?? 'อื่น ๆ'}: ${OUTCOMES[row.outcome ?? ''] ?? 'บันทึกแล้ว'}`
          : kind === 'HEARD_FROM'
            ? `ลูกค้าบอกว่ารู้จักร้านจาก${JOURNEY_HEARD_FROM_LABELS[row.heardFrom ?? ''] ?? 'อื่น ๆ'}`
            : kind === 'MARKED_LOST'
              ? `ติดป้ายหลุด: ${JOURNEY_LOST_REASON_LABELS[row.lostReason ?? ''] ?? 'อื่น ๆ'}`
              : kind === 'PLACEHOLDER_MERGED' && typeof data?.roomCount === 'number'
                ? `รวมประวัติแชท ${data.roomCount} ห้องเข้ากับลูกค้าคนนี้`
                : VIEWS[kind].title;
      const href =
        row.refType === 'contract' && row.refId
          ? `/contracts/${row.refId}`
          : row.roomId && seesChat
            ? `/inbox/${row.roomId}`
            : undefined;
      const type = asActorType(row.actorType);
      events.push({
        id: `entry-${row.id}`,
        type: kind,
        group: VIEWS[kind].group,
        stage:
          kind === 'TOUCHPOINT' && (row.outcome === 'APPOINTED' || row.outcome === 'VISITED')
            ? 'INTERESTED'
            : VIEWS[kind].stage,
        timestamp: row.occurredAt.toISOString(),
        title,
        actor: row.actorUser ? { type, id: row.actorUser.id, name: row.actorUser.name } : { type },
        reliability: 'exact',
        origin: row.origin === 'MANUAL' ? 'MANUAL' : 'SYSTEM_ENTRY',
        ...(href ? { href } : {}),
        ...(data ? { metadata: data } : {}),
      });
    }
    for (const tag of tags) {
      if (isMergeDuplicate(tag, tags)) continue;
      const label = TAG_LABELS[tag.tag] ?? tag.tag;
      const common = {
        group: 'system',
        stage: null,
        reliability: 'exact',
        origin: 'SOURCE',
      } as const;
      events.push({
        ...common,
        id: `tag-${tag.id}`,
        type: 'TAG_ADDED',
        timestamp: tag.createdAt.toISOString(),
        title: `ติดแท็ก ${label}`,
        actor: tag.appliedBy
          ? staffActor(tag.appliedBy)
          : { type: tag.source === 'AUTO' ? 'SYSTEM' : 'STAFF' },
      });
      if (tag.deletedAt)
        events.push({
          ...common,
          id: `tag-removed-${tag.id}`,
          type: 'TAG_REMOVED',
          timestamp: tag.deletedAt.toISOString(),
          title: `ถอดแท็ก ${label}`,
          actor: null,
        }); // ผู้ถอดไม่ได้บันทึก
    }
    return finalizeSource(events, window);
  };
}

/** ทุกกลุ่ม — สำหรับผู้เรียกที่ต้องการทุกกลุ่มจริง (หน้าไทม์ไลน์ใช้ entriesSourceFor(groups) ผ่าน sourcesForGroups) */
export const entriesSource: JourneySource = entriesSourceFor(new Set(JOURNEY_EVENT_GROUPS));
