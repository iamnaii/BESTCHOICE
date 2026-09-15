import { Injectable, NotFoundException } from '@nestjs/common';
import { JOURNEY_DEFAULT_GROUPS, JOURNEY_HIDDEN_GROUPS, type JourneyEventGroup, type JourneyListResponse, type JourneyRedirect } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { JourneyListQueryDto } from './dto/journey-list-query.dto';
import { chatSource } from './sources/chat.source';
import { collectionsSource } from './sources/collections.source';
import { creditSource } from './sources/credit.source';
import { entriesSource } from './sources/entries.source';
import { decodeJourneyCursor, mergeJourneyPage, type JourneyActor, type JourneySource, type JourneyWindow } from './sources/journey-window';
import { paymentSource } from './sources/payment.source';
import { pointsSource } from './sources/points.source';
import { saleSource } from './sources/sale.source';
import { serviceSource } from './sources/service.source';

export const DEFAULT_JOURNEY_LIMIT = 30;

const SOURCES_BY_GROUP: Record<JourneyEventGroup, readonly JourneySource[]> = {
  chat: [chatSource, entriesSource], credit: [creditSource, entriesSource], sale: [saleSource, entriesSource],
  payment: [paymentSource], collections: [collectionsSource], service: [serviceSource], points: [pointsSource], system: [entriesSource],
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
  const hidden = new Set<JourneyEventGroup>(JOURNEY_HIDDEN_GROUPS[role] ?? []);
  return new Set((requested?.length ? requested : JOURNEY_DEFAULT_GROUPS).filter((g) => !hidden.has(g)));
}

export const sourcesForGroups = (groups: ReadonlySet<JourneyEventGroup>): JourneySource[] => [...new Set([...groups].flatMap((g) => SOURCES_BY_GROUP[g]))];

@Injectable()
export class CustomerJourneyService {
  constructor(private readonly prisma: PrismaService) {}

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
    const groups = resolveJourneyGroups(query.groups, actor.role);
    const window: JourneyWindow = { limit: query.limit ?? DEFAULT_JOURNEY_LIMIT, before, from: query.from ? new Date(query.from) : undefined, to: query.to ? new Date(query.to) : undefined };
    const perSource = await Promise.all(sourcesForGroups(groups).map((source) => source(this.prisma, [customerId, ...mergedCustomerIds], window, actor)));
    const { events, nextCursor } = mergeJourneyPage(perSource, window.limit, groups);
    return { customerId, mergedCustomerIds, events, nextCursor, notRecorded: [...JOURNEY_NOT_RECORDED] };
  }
}
