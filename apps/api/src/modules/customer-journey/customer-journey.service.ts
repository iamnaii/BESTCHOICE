import { Injectable, NotFoundException } from '@nestjs/common';
import {
  JOURNEY_DEFAULT_GROUPS,
  JOURNEY_EVENT_GROUPS,
  type JourneyEvent,
  type JourneyEventGroup,
  type JourneyListResponse,
  type JourneyRedirect,
  type JourneySummary,
} from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { JourneyListInclude, JourneyListQueryDto } from './dto/journey-list-query.dto';
import { JourneySummaryService } from './journey-summary.service';
import { chatSource } from './sources/chat.source';
import { collectionsSource } from './sources/collections.source';
import { creditSource } from './sources/credit.source';
import { entriesSourceFor } from './sources/entries.source';
import { decodeJourneyCursor, mergeJourneyPage, roleSeesGroup, type JourneyActor, type JourneySource, type JourneyWindow } from './sources/journey-window';
import { paymentSource } from './sources/payment.source';
import { pointsSource } from './sources/points.source';
import { saleSource } from './sources/sale.source';
import { serviceSource } from './sources/service.source';

export const DEFAULT_JOURNEY_LIMIT = 30;
/** เพดานตัวเลขบนชิปกรองของหน้าแรก — ถึงเพดาน = "อย่างน้อยเท่านี้" (ไม่นับทั้งประวัติ เพื่อไม่ยิงทุกแหล่งแบบไม่จำกัด) */
export const JOURNEY_COUNT_CAP = 100;

/** แหล่งเฉพาะกลุ่ม — บันทึก entries/แท็กมาจาก entriesSourceFor(groups) ตัวเดียวที่ sourcesForGroups ต่อท้ายให้ */
const SOURCES_BY_GROUP: Record<JourneyEventGroup, readonly JourneySource[]> = {
  chat: [chatSource], credit: [creditSource], sale: [saleSource],
  payment: [paymentSource], collections: [collectionsSource], service: [serviceSource], points: [pointsSource], system: [],
};

/** ข้อความท้ายแท็บ "ระบบยังไม่เก็บ" (synthesis notRecordedToday ที่พนักงานต้องรู้) */
export const JOURNEY_NOT_RECORDED: readonly string[] = [
  'ใครในทีมตอบแชทในแอป Facebook (แสดงเป็น "ร้าน" ไม่ทราบชื่อ)',
  'ผู้เปิดตรวจเครดิต ผล AI ประเมินเครดิต และบอทส่งต่อพนักงาน ก่อนวันที่ระบบเริ่มเก็บ',
  'รอบตีกลับสัญญาก่อนรอบล่าสุด ก่อนวันที่ระบบเริ่มเก็บ',
  'เวลาที่ได้เบอร์ของผู้สนใจ และเวลาผูก LINE ร้าน ก่อนวันที่ระบบเริ่มเก็บ',
  'ลูกค้ากดมาจากโฆษณา (ยังไม่มีข้อมูลโฆษณาเข้าระบบ)',
  'ลูกค้าหน้าร้านรู้จักร้านจากไหน',
  'ผู้ถอดแท็ก การบล็อก/เลิกติดตาม LINE และการเข้าชมเว็บ',
];

/** ไม่ส่ง groups = JOURNEY_DEFAULT_GROUPS · ตัด JOURNEY_HIDDEN_GROUPS[role] (ACCOUNTANT ไม่เห็นแชท · SALES ไม่เห็นยอดชำระ/ติดตามหนี้ — รอเจ้าของเคาะ ข้อ 5 · ชุดเดียวกับเว็บ) */
export function resolveJourneyGroups(requested: readonly JourneyEventGroup[] | undefined, role: string): Set<JourneyEventGroup> {
  return new Set((requested?.length ? requested : JOURNEY_DEFAULT_GROUPS).filter((g) => roleSeesGroup(role, g)));
}

/** แหล่งจากตารางโดเมนของกลุ่มชุดนี้ (ไม่รวม entries) */
const domainSourcesFor = (groups: ReadonlySet<JourneyEventGroup>): JourneySource[] => [...new Set([...groups].flatMap((g) => SOURCES_BY_GROUP[g]))];

/**
 * แหล่งของกลุ่มที่ resolve แล้ว + entriesSourceFor(groups) หนึ่งตัว (DB กรอง kind ตามกลุ่มชุดนี้ · แท็กเฉพาะ system)
 * ⇒ บันทึกของกลุ่มที่ไม่ได้ขอหรือบทบาทไม่เห็นไม่ถูกอ่านและไม่กินขอบ limit+1 ของ mergeJourneyPage (หน้าไม่สั้น/ว่างทั้งที่มี cursor)
 */
export const sourcesForGroups = (groups: ReadonlySet<JourneyEventGroup>): JourneySource[] => [...domainSourcesFor(groups), entriesSourceFor(groups)];

/** นับเหตุการณ์ต่อกลุ่ม (id ไม่ซ้ำ) เฉพาะกลุ่มที่บทบาทเห็น ไม่เกิน JOURNEY_COUNT_CAP */
export function countJourneyGroups(lists: readonly JourneyEvent[][], groups: ReadonlySet<JourneyEventGroup>): Partial<Record<JourneyEventGroup, number>> {
  const counts: Partial<Record<JourneyEventGroup, number>> = {};
  const seen = new Set<string>();
  for (const event of lists.flat()) {
    if (!groups.has(event.group) || seen.has(event.id)) continue;
    seen.add(event.id);
    counts[event.group] = Math.min((counts[event.group] ?? 0) + 1, JOURNEY_COUNT_CAP);
  }
  return counts;
}

const isRedirect = (value: JourneySummary | JourneyRedirect): value is JourneyRedirect => 'redirectToCustomerId' in value;

@Injectable()
export class CustomerJourneyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly summaries: JourneySummaryService,
  ) {}

  async list(customerId: string, query: JourneyListQueryDto, actor: JourneyActor): Promise<JourneyListResponse | JourneyRedirect> {
    const before = query.cursor ? decodeJourneyCursor(query.cursor) : undefined;
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, deletedAt: true, mergedIntoId: true } });
    if (!customer) throw new NotFoundException('ไม่พบลูกค้า');
    if (customer.deletedAt) {
      // ลิงก์เก่าที่ชี้ placeholder — chain ถูกยุบเหลือชั้นเดียวตอนรวม
      if (customer.mergedIntoId) return { redirectToCustomerId: customer.mergedIntoId };
      throw new NotFoundException('ไม่พบลูกค้า');
    }
    const merged = await this.prisma.customer.findMany({ where: { mergedIntoId: customerId }, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const mergedCustomerIds = merged.map((row) => row.id);
    const ids = [customerId, ...mergedCustomerIds];
    const groups = resolveJourneyGroups(query.groups, actor.role);
    const window: JourneyWindow = { limit: query.limit ?? DEFAULT_JOURNEY_LIMIT, before, from: query.from ? new Date(query.from) : undefined, to: query.to ? new Date(query.to) : undefined };
    const notRecorded = [...JOURNEY_NOT_RECORDED];
    // include มีผลเฉพาะหน้าแรก — หน้าที่มี cursor ไม่แนบ counts/summary
    const include = new Set<JourneyListInclude>(before ? [] : (query.include ?? []));
    const summaryPromise = include.has('summary') ? this.summaries.summary(customerId, actor) : Promise.resolve(null);

    if (!include.has('counts')) {
      // หน้าถัดไป หรือหน้าแรกที่ไม่ขอ counts (การ์ดกิจกรรมล่าสุด · summary อย่างเดียว): เฉพาะแหล่งของกลุ่มที่ขอ ด้วย limit จริง
      const [perSource, summary] = await Promise.all([
        Promise.all(sourcesForGroups(groups).map((source) => source(this.prisma, ids, window, actor))),
        summaryPromise,
      ]);
      const { events, nextCursor } = mergeJourneyPage(perSource, window.limit, groups);
      return { customerId, mergedCustomerIds, ...(summary && !isRedirect(summary) ? { summary } : {}), events, nextCursor, notRecorded };
    }

    // include=counts: สแกนทุกแหล่งที่บทบาทเห็นครั้งเดียวด้วยเพดาน JOURNEY_COUNT_CAP — ใช้ทั้งตัวเลขบนชิปและตัดหน้า
    // entries สแกนทีละกลุ่ม: สแกนก้อนเดียวแล้วตัดที่เพดาน แถวใหม่ของกลุ่มหนึ่ง (เช่นแท็กระบบ) จะดันแถวเก่าของอีกกลุ่มหลุด ตัวเลขชิปจะต่ำเกินจริง
    // ทุกกลุ่มที่บทบาทเห็น — กลุ่มที่ไม่มี kind ใน entries และไม่ใช่ system entriesSourceFor ไม่ยิง DB (ความรู้กลุ่ม→kind อยู่ที่ entries.source.ts ที่เดียว)
    const countGroups = resolveJourneyGroups([...JOURNEY_EVENT_GROUPS], actor.role);
    const scanWindow: JourneyWindow = { ...window, limit: Math.max(window.limit, JOURNEY_COUNT_CAP) };
    const domainSources = domainSourcesFor(countGroups);
    const entryGroups = [...countGroups];
    const [domainScans, entryScans, summary] = await Promise.all([
      Promise.all(domainSources.map((source) => source(this.prisma, ids, scanWindow, actor))),
      Promise.all(entryGroups.map((group) => entriesSourceFor(new Set([group]))(this.prisma, ids, scanWindow, actor))),
      summaryPromise,
    ]);
    // finalizeSource เรียงแล้วตัด ⇒ ส่วนต้น limit+1 ของผลสแกนคือผลเดียวกับการเรียกด้วย limit จริง
    // entries ต่อกลุ่มเป็นแหล่งย่อยที่ไม่ทับกัน รวมหน้าได้เหมือนแหล่งแยก · groups ⊆ countGroups (กรองบทบาทชุดเดียวกัน)
    const byDomainSource = new Map(domainSources.map((source, index) => [source, domainScans[index]] as const));
    const byEntryGroup = new Map(entryGroups.map((group, index) => [group, entryScans[index]] as const));
    const perSource = [
      ...domainSourcesFor(groups).map((source) => byDomainSource.get(source) ?? []),
      ...[...groups].map((group) => byEntryGroup.get(group) ?? []),
    ].map((list) => list.slice(0, window.limit + 1));
    const { events, nextCursor } = mergeJourneyPage(perSource, window.limit, groups);
    return {
      customerId,
      mergedCustomerIds,
      // ถูกรวมระหว่างคำขอ (summary ตอบ redirect) → ไม่แนบ ให้คำขอถัดไปได้ redirect เอง
      ...(summary && !isRedirect(summary) ? { summary } : {}),
      events,
      nextCursor,
      counts: countJourneyGroups([...domainScans, ...entryScans], countGroups),
      notRecorded,
    };
  }

  /** GET /customers/:id/journey/summary — ตรรกะอยู่ที่ JourneySummaryService */
  summary(customerId: string, actor: JourneyActor): Promise<JourneySummary | JourneyRedirect> {
    return this.summaries.summary(customerId, actor);
  }
}
