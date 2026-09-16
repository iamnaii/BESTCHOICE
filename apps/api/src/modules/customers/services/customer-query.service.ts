import { assertExportRowCount, EXPORT_ROW_LIMIT, readExportSnapshot } from '../../../common/helpers/export-snapshot';
import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { ContractStatus, CreditCheckStatus, CustomerCreditCheckStatus, Prisma } from '@prisma/client';
import {
  CUSTOMER_BOUGHT_CONTRACT_STATUSES,
  CUSTOMER_BOUGHT_SALE_TYPES,
  CUSTOMER_INSTALLMENT_STATE_STATUSES,
  CHAT_SOURCE_PREFIX,
  chatLogoOf,
  chatSourceChannel,
  chatSourceOf,
  type CustomerInstallmentState,
  type ProspectSource,
} from '@installment/shared';
import { isChatPlaceholder, PLACEHOLDER_FIELDS_SELECT } from '../../chat-prospects/chat-placeholder';
import { PrismaService } from '../../../prisma/prisma.service';
import { paginatedResponse } from '../../../common/helpers/pagination.helper';
import { decryptPII, isEncrypted } from '../../../utils/crypto.util';
import { decryptReferencesJson } from '../../../utils/pii.util';
import { bangkokCalendarParts, bangkokDateRange, bangkokDateString } from '../../../utils/date.util';
import { CustomerTierService } from '../customer-tier.service';
import { CustomerPiiService } from '../customer-pii.service';
import { CustomerPurchaseSummaryService, type CustomerPurchaseSummary } from './customer-purchase-summary.service';
import { CustomerChatRoomsService } from './customer-chat-rooms.service';
import { CUSTOMER_TIERS } from '../dto/customers-list-query.dto';
import { buildContractProgress } from './customer-contract-progress';

/** อ่านจาก enum ที่ Prisma generate — เพิ่มค่าใน schema แล้วรายการนี้ตามเองโดยไม่ต้องแก้ */
const CREDIT_CHECK_STATUSES = Object.values(CreditCheckStatus) as string[];
const CUSTOMER_CREDIT_CHECK_STATUSES = Object.values(CustomerCreditCheckStatus) as string[];

const BOUGHT_CONTRACT_STATUSES = [...CUSTOMER_BOUGHT_CONTRACT_STATUSES] as ContractStatus[];
const BOUGHT_SALE_TYPES = [...CUSTOMER_BOUGHT_SALE_TYPES];

/**
 * "ซื้อกับเราแล้ว" — มีสัญญาที่ไม่ใช่ร่าง **หรือ** มีใบขายสด/ไฟแนนซ์นอก
 *
 * 🔴 D1 (คำตัดสินชั่วคราว — รอเจ้าของเคาะ): DRAFT / EXCHANGED / DEFECT_EXCHANGED
 * **ไม่** นับว่าซื้อแล้ว · แถว Sale ถูกสร้างตอน activate สัญญาเท่านั้น
 * (contract-workflow.service.ts) ⇒ คนที่มีแต่สัญญาร่างยังไม่ได้ซื้ออะไรเลย
 * รายการสถานะอยู่ที่ CUSTOMER_BOUGHT_CONTRACT_STATUSES ใน packages/shared จุดเดียว
 */
export const BOUGHT_WHERE: Prisma.CustomerWhereInput = {
  OR: [
    { contracts: { some: { deletedAt: null, status: { in: BOUGHT_CONTRACT_STATUSES } } } },
    { sales: { some: { deletedAt: null, saleType: { in: BOUGHT_SALE_TYPES } } } },
  ],
};

/**
 * "ผู้สนใจ" — ยังไม่เคยซื้อ
 *
 * 🔴 ต้องเขียนด้วย `none` ไม่ใช่ `NOT: { OR: [...] }` — NOT คู่กับ relation ที่เป็น
 * nullable เจอ 3VL ของ SQL แล้วทิ้งแถวเงียบ ๆ (เคยเป็นบั๊ก prod: inbox ข้อความหาย PR #1351)
 */
const PROSPECT_WHERE: Prisma.CustomerWhereInput = {
  AND: [
    { contracts: { none: { deletedAt: null, status: { in: BOUGHT_CONTRACT_STATUSES } } } },
    { sales: { none: { deletedAt: null, saleType: { in: BOUGHT_SALE_TYPES } } } },
  ],
};

/** ไม่ได้มาจากบอทขาย — เขียนเป็น OR กับ null เพราะ `not` เพียว ๆ ทิ้งแถวที่คอลัมน์เป็น NULL (3VL) */
const NOT_BOT_WHERE: Prisma.CustomerWhereInput = {
  OR: [{ acquisitionSource: null }, { acquisitionSource: { not: { startsWith: 'AI_CHAT' } } }],
};

/**
 * "มาจากแชท" — ที่มาติดตัวขึ้นต้น CHAT_ (ผู้สนใจอัตโนมัติ + ที่เคยเป็นผู้สนใจอัตโนมัติมาก่อน)
 *
 * 🔴 R16: ต้องเป็นค่าคงที่ตัวเดียว ใช้ร่วมกันทั้ง KPI "มาจากแชท" (kpiPredicates) และตัวกรอง
 * `fromChat=true` — ห้ามเขียนสูตรซ้ำสองที่ ไม่งั้นการ์ด KPI กับตัวกรองจะ drift กันได้
 */
const CHAT_SOURCE_WHERE: Prisma.CustomerWhereInput = {
  acquisitionSource: { startsWith: CHAT_SOURCE_PREFIX },
};

/** ตรงข้ามของ CHAT_SOURCE_WHERE (`fromChat=false`) — OR กับ null กัน 3VL เหมือน NOT_BOT_WHERE */
const NOT_CHAT_SOURCE_WHERE: Prisma.CustomerWhereInput = {
  OR: [{ acquisitionSource: null }, { acquisitionSource: { not: { startsWith: CHAT_SOURCE_PREFIX } } }],
};

const NO_ROOM_WHERE: Prisma.CustomerWhereInput = { chatRooms: { none: { deletedAt: null } } };

/**
 * "ติดต่อล่าสุด" — ต้องใช้กติกาเดียวกับคอลัมน์ในตาราง ไม่งั้นการ์ด KPI กับแถวขัดกันเอง
 *
 * `CustomerChatRoomsService` คำนวณ `lastContactAt = room.lastCustomerAt ?? room.lastMessageAt`
 * (ลูกค้าพิมพ์จริงมาก่อน ถ้าห้องนั้นลูกค้ายังไม่เคยพิมพ์เลยจึงถอยไปใช้เวลาข้อความล่าสุดของห้อง)
 *
 * 🔴 ก่อนหน้านี้ตัวกรอง/KPI เช็คเฉพาะ `lastCustomerAt` ⇒ ห้องที่ลูกค้ายังไม่เคยพิมพ์
 * โชว์ "เมื่อวาน" ในคอลัมน์ แต่การ์ด "คุยกันใน 7 วัน" นับเป็น 0 (เห็นจริงบน local preview)
 */
function contactedWithin(asOf: Date, daysAgo: number): Prisma.CustomerWhereInput {
  const since = bkkDaysAgo(asOf, daysAgo);
  return {
    chatRooms: {
      some: {
        deletedAt: null,
        OR: [{ lastCustomerAt: { gte: since } }, { lastCustomerAt: null, lastMessageAt: { gte: since } }],
      },
    },
  };
}

/** เงียบเกิน N วัน = มีห้องแชท แต่ไม่มีห้องไหนเข้าเกณฑ์ "ติดต่อภายใน N วัน" เลย */
function silentBeyond(asOf: Date, daysAgo: number): Prisma.CustomerWhereInput {
  const since = bkkDaysAgo(asOf, daysAgo);
  return {
    chatRooms: {
      some: { deletedAt: null },
      none: {
        deletedAt: null,
        OR: [{ lastCustomerAt: { gte: since } }, { lastCustomerAt: null, lastMessageAt: { gte: since } }],
      },
    },
  };
}

/** ที่มา → ช่องทางห้องแชทที่นับว่าตรง (LINE แตกเป็นสองช่องทาง) */
const SOURCE_CHANNELS: Record<string, Prisma.ChatRoomWhereInput['channel']> = {
  FACEBOOK: { in: ['FACEBOOK'] },
  TIKTOK: { in: ['TIKTOK'] },
  WEB: { in: ['WEB'] },
  LINE: { in: ['LINE_FINANCE', 'LINE_SHOP'] },
};

/** ดึงรายชื่อ ChatChannel ออกจาก entry ของ SOURCE_CHANNELS (ทุก entry เป็นรูป `{ in: [...] }` เสมอ) */
function channelsOf(filter: Prisma.ChatRoomWhereInput['channel']): string[] {
  return (filter as { in?: readonly string[] } | undefined)?.in?.slice() ?? [];
}

/**
 * ที่มา → ค่า acquisitionSource ของผู้สนใจอัตโนมัติที่นับว่าตรง (ห้องถูกลบไปแล้วก็ยังกรองได้)
 *
 * 🔴 R17: ต้อง derive จาก SOURCE_CHANNELS ผ่าน chatSourceOf เสมอ ห้ามเขียนเป็น literal map แยก —
 * ถ้าเพิ่มช่องทางใหม่ใน SOURCE_CHANNELS แล้วลืมแก้ที่นี่ SOURCE_CHAT_VALUES[ช่องใหม่] จะเป็น
 * undefined ⇒ `{ acquisitionSource: { in: undefined } }` ที่ Prisma ตัดเงื่อนไข undefined ทิ้ง
 * ⇒ ทั้ง OR กลายเป็น always-true และ `?source=<ช่องใหม่>` จะคืนลูกค้าที่ไม่ใช่บอททุกคนเงียบ ๆ
 */
const SOURCE_CHAT_VALUES: Record<string, string[]> = Object.fromEntries(
  Object.entries(SOURCE_CHANNELS).map(([source, filter]) => [source, channelsOf(filter).map(chatSourceOf)]),
);

function assertEnumValue(value: string, allowed: string[], label: string): void {
  if (allowed.includes(value)) return;
  throw new BadRequestException(`${label}ไม่ถูกต้อง: "${value}" (ค่าที่รับได้: ${allowed.join(', ')})`);
}

/**
 * ตัวกรองของ GET /customers ทั้งชุดในออบเจ็กต์เดียว
 *
 * 🔴 เคยเป็นพารามิเตอร์เรียงตำแหน่ง 13 ตัว และ facade (CustomersService.findAll)
 * ส่งต่อแค่ 11 ตัว ⇒ ตัวกรองที่เพิ่มใหม่ "หน้าจอไม่สน แต่ Excel สน" เงียบ ๆ
 * ห้ามกลับไปเป็น positional และห้ามแทรกพารามิเตอร์ก่อน db/asOf
 */
export interface CustomersReadFilters {
  /** ไม่ส่ง = ทุกคน · 'customers' = ซื้อแล้ว · 'prospects' = ยังไม่ซื้อ */
  view?: string;
  search?: string;
  /** ชื่อพ้องของ search */
  q?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
  tier?: string;
  branchId?: string;
  purchase?: string;
  state?: string;
  purchasedWithin?: string;
  /** ชื่อพ้องของ purchasedWithin */
  bought?: string;
  source?: string;
  /** ใช้ได้ทั้งสองแท็บ (Task 13) — สตริง 'true'/'false' เหมือน hasOverdue */
  fromChat?: string;
  tag?: string;
  contacted?: string;
  assignedToId?: string;
  /** ชื่อพ้องของ assignedToId */
  owner?: string;
  creditCheckStatus?: string;
  /** ชื่อพ้องของ creditCheckStatus */
  precheck?: string;
  contractStatus?: string;
  /** สตริง 'true'/'false' จาก query string (boolean ยังรับได้สำหรับผู้เรียกในโค้ด) */
  hasOverdue?: boolean | string;
  creditStatus?: string;
}

/** ช่วงเวลา "ซื้อล่าสุด" → ช่วง UTC ของปฏิทินกรุงเทพ (ห้ามใช้ new Date(y, m, 1) ซึ่งอิงเขตเวลาเครื่อง) */
function purchasedWithinRange(window: string, asOf: Date): { gte?: Date; lt?: Date } {
  const dayMs = 86_400_000;
  switch (window) {
    case '30d':
      return bangkokDateRange(bangkokDateString(new Date(asOf.getTime() - 29 * dayMs)));
    case '90d':
      return bangkokDateRange(bangkokDateString(new Date(asOf.getTime() - 89 * dayMs)));
    case 'ytd': {
      const { year } = bangkokCalendarParts(asOf);
      return bangkokDateRange(`${year}-01-01`);
    }
    case 'over1y':
      // "เกิน 1 ปี" = ซื้อครั้งล่าสุดก่อนหน้านั้น ⇒ คืนขอบบนตัวเดียว ซึ่งผู้เรียกเอาไป
      // ใช้เป็น **จุดตัดของการปฏิเสธ** (ห้ามมีใบซื้อตั้งแต่วันนั้นขึ้นไป) ไม่ใช่ช่วงแบบ some
      return bangkokDateRange(undefined, bangkokDateString(new Date(asOf.getTime() - 365 * dayMs)));
    default:
      throw new BadRequestException(`ช่วงเวลา "ซื้อล่าสุด" ไม่ถูกต้อง: "${window}"`);
  }
}

/** ต้นวันตามปฏิทินกรุงเทพของ "วันนี้ − n วัน" */
function bkkDaysAgo(asOf: Date, days: number): Date {
  return bangkokDateRange(bangkokDateString(new Date(asOf.getTime() - days * 86_400_000))).gte!;
}

/**
 * "ที่มา" ของผู้สนใจ — อนุมาน ไม่ใช่คอลัมน์
 * ลำดับ: acquisitionSource ขึ้นต้น AI_CHAT → BOT · ไม่งั้นที่มาติดตัวจากตอนทักครั้งแรก
 * (acquisitionSource ขึ้นต้น CHAT_ — ยังกรองได้แม้ห้องแชทถูกลบไปแล้ว ชนะห้องล่าสุด)
 * · ไม่งั้นช่องทางห้องแชทล่าสุด · ไม่งั้นมีคนแนะนำ → REFERRAL · ไม่งั้น WALK_IN
 * (ดู packages/shared/customer-sort.ts)
 */
function deriveSource(
  acquisitionSource: string | null,
  newestChannel: string | null,
  referredById: string | null,
): ProspectSource {
  if (acquisitionSource?.startsWith('AI_CHAT')) return 'BOT';
  const chatChannel = chatSourceChannel(acquisitionSource);
  if (chatChannel) return chatLogoOf(chatChannel);
  if (newestChannel) return chatLogoOf(newestChannel);
  if (referredById) return 'REFERRAL';
  return 'WALK_IN';
}

/**
 * ตัดคอลัมน์ที่ลงท้าย Encrypted ออกทุกตัว
 *
 * 🔴 เดิมเขียนมือแค่ nationalIdEncrypted + phoneEncrypted ⇒ คอลัมน์เข้ารหัสตัวใดที่ถูก
 * select เพิ่มในอนาคตจะหลุดเป็น ciphertext ออก API ทันที (PDPA) ลูปนี้กันไว้ล่วงหน้า
 */
function stripEncrypted<T extends Record<string, unknown>>(row: T): T {
  const clean = { ...row };
  for (const key of Object.keys(clean)) {
    if (key.endsWith('Encrypted')) delete clean[key];
  }
  return clean;
}

const CUSTOMER_SELECT = {
  id: true,
  nationalId: true,
  nationalIdEncrypted: true,
  name: true,
  nickname: true,
  phone: true,
  phoneEncrypted: true,
  occupation: true,
  salary: true,
  lineIdFinance: true,
  lineIdShop: true,
  createdAt: true,
  acquisitionSource: true,
  referredById: true,
  // 🔴 คอลัมน์ "เครดิต" ของแท็บลูกค้าอ่านค่านี้ (CustomerCreditCheckStatus) ไม่ใช่
  // latestCreditStatus ซึ่งเป็นสถานะของ **ใบตรวจ** (CreditCheckStatus) คนละ enum
  // คนละแผนที่ป้าย — แถวต้องพกมาทั้งสองค่า ฝั่งเว็บจึงเลือกแผนที่ถูกใบได้
  // เป็นคอลัมน์ scalar บน Customer ⇒ ไม่มี query เพิ่ม
  creditCheckStatus: true,
  _count: { select: { contracts: true } },
  contracts: {
    where: { deletedAt: null },
    select: { status: true },
  },
  creditChecks: {
    where: { deletedAt: null },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: { status: true, aiScore: true },
  },
} satisfies Prisma.CustomerSelect;

/**
 * แท็บผู้สนใจ — ไม่มี tier / purchase / warranty / _count เพราะคนที่ยังไม่เคยซื้อ
 * ทุกค่านั้นเป็นค่าคงที่ (ดู PLAN §1.3) · แท็ก + สถานะเครดิตอ่านตรงจาก select ไม่ต้องยิงเพิ่ม
 */
const PROSPECT_SELECT = {
  id: true,
  nationalId: true,
  nationalIdEncrypted: true,
  name: true,
  nickname: true,
  phone: true,
  phoneEncrypted: true,
  createdAt: true,
  creditCheckStatus: true,
  acquisitionSource: true,
  referredById: true,
  tags: { where: { deletedAt: null }, select: { tag: true } },
  creditChecks: {
    where: { deletedAt: null },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: { status: true, aiScore: true },
  },
} satisfies Prisma.CustomerSelect;

/**
 * Read-path slice of the decomposed CustomersService.
 *
 * Owns the list/detail/search read aggregations + the read-path PII decrypt
 * helpers (decryptCustomerPII / decryptCustomerList), the piiKey/hashSalt
 * getters, and the inline decrypt fallback that keeps working when
 * piiService is NOT injected (legacy spec DI omits it on purpose to exercise
 * this path). `findOne` here is the shared existence-guard used by the write
 * + analytics slices.
 */
@Injectable()
export class CustomerQueryService {
  constructor(
    private prisma: PrismaService,
    private readonly tierService: CustomerTierService,
    private readonly purchaseSummary: CustomerPurchaseSummaryService,
    private readonly chatRooms: CustomerChatRoomsService,
    @Optional() private readonly piiService?: CustomerPiiService,
  ) {}

  /**
   * รายชื่อลูกค้า/ผู้สนใจของหน้า /customers (และ Excel export ซึ่งใช้เส้นทางเดียวกัน)
   *
   * โครงสร้าง where: ตัวกรองใหม่ **ทุกตัว** ลงใน AND เท่านั้น
   *   - `where.OR`        เป็นของ search คนเดียว
   *   - `where.contracts` เป็นช่องเดียวที่ hasOverdue/contractStatus ใช้ร่วมกัน
   * ใส่คีย์ซ้ำ = ตัวหลังชนะเงียบ ๆ (มีเทสล็อกรูปร่างไว้ที่ customer-query-pagination.spec.ts)
   */
  async findAll(
    filters: CustomersReadFilters = {},
    db: Prisma.TransactionClient = this.prisma,
    asOf = new Date(),
  ) {
    const view = filters.view;
    // ค่าที่สะกดผิดต้องไม่ตกเป็น "ทุกคน" เงียบ ๆ — findAll ถูกเรียกตรงจาก preview/e2e ด้วย
    if (view && view !== 'customers' && view !== 'prospects') {
      throw new BadRequestException(`มุมมองไม่ถูกต้อง: "${view}" (ค่าที่รับได้: customers, prospects หรือไม่ส่ง = ทุกคน)`);
    }
    const isProspects = view === 'prospects';
    const search = filters.search ?? filters.q;
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 50;
    const { sortBy, sortOrder } = filters;
    const purchasedWithin = filters.purchasedWithin ?? filters.bought;
    const assignedToId = filters.assignedToId ?? filters.owner;
    // ตัวกรองของแท็บตรงข้ามถูกมองข้าม — URL ที่แก้มือ (?view=prospects&purchase=CASH)
    // จะต้องไม่กรองแบบมองไม่เห็น (ฝั่งเว็บ gate ตอนอ่านอีกชั้น)
    //
    // 🔴 ต้อง gate **ทุกตัว** ไม่ใช่บางตัว: ?view=prospects&branchId=X คืนศูนย์แถวเสมอ
    // (ผู้สนใจไม่มีสัญญา/ใบขายให้ join สาขา) และ ?view=prospects&tier=GOLD พา
    // request เข้าสาขา findMany แบบไม่จำกัดจำนวนก่อน paginate เพื่อไม่ได้อะไรเลย
    const purchase = isProspects ? undefined : filters.purchase;
    const state = purchase === 'INSTALLMENT' ? filters.state : undefined;
    const boughtWindow = isProspects ? undefined : purchasedWithin;
    const tier = isProspects ? undefined : filters.tier;
    const branchId = isProspects ? undefined : filters.branchId;
    const contractStatus = isProspects ? undefined : filters.contractStatus;
    const creditStatus = isProspects ? undefined : filters.creditStatus;
    // 🔴 `hasOverdue` มาจาก query string เป็น **สตริง** — DTO เก็บเป็น string เพราะ
    // ValidationPipe ของแอปเปิด enableImplicitConversion ซึ่งรัน Boolean('false') === true
    // ก่อน @Transform จะได้ทำงาน ⇒ ?hasOverdue=false เคยเปิดตัวกรอง (ดู DTO)
    const hasOverdue = !isProspects && (filters.hasOverdue === true || filters.hasOverdue === 'true');
    const creditCheckStatus = isProspects ? (filters.creditCheckStatus ?? filters.precheck) : undefined;
    // 🔴 "ที่มา" ใช้ได้ทั้งสองแท็บ (Task 13) — ต่างจากตัวกรองอื่นข้างบน/ล่างที่ยัง gate เฉพาะ
    // แท็บผู้สนใจ: ลูกค้าที่ซื้อแล้วก็มี "ที่มา" เหมือนกัน (มาจากแชท/คนแนะนำ/walk-in)
    const source = filters.source;
    const contacted = isProspects ? filters.contacted : undefined;
    const owner = isProspects ? assignedToId : undefined;
    const tags = isProspects
      ? (filters.tag ?? '').split(',').map(value => value.trim()).filter(Boolean)
      : [];

    const where: Prisma.CustomerWhereInput = { deletedAt: null };
    /** ตัวกรองทั้งหมด **ยกเว้น** มุมมอง — viewCounts นับจากชุดนี้ (ดู §2.7) */
    const filterAnd: Prisma.CustomerWhereInput[] = [];

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { nationalId: { contains: search } },
        { nickname: { contains: search, mode: 'insensitive' } },
        ...(isProspects
          // ชื่อในแชทไม่ได้เข้ารหัส จึง contains ตรง ๆ ได้
          ? [{ chatRooms: { some: { deletedAt: null, displayName: { contains: search, mode: 'insensitive' as const } } } }]
          : [
              { contracts: { some: { deletedAt: null, contractNumber: { contains: search, mode: 'insensitive' as const } } } },
              { sales: { some: { deletedAt: null, saleNumber: { contains: search, mode: 'insensitive' as const } } } },
              // IMEI ของ "เครื่องหลัก" เท่านั้น — Sale.bundleProductIds เป็น String[] ไม่มี relation
              { contracts: { some: { deletedAt: null, product: { imeiSerial: { contains: search } } } } },
              { sales: { some: { deletedAt: null, product: { imeiSerial: { contains: search } } } } },
            ]),
      ];
    }

    // ตัวกรองเดิม: สถานะสัญญา + สาขา ต้องชี้สัญญา "ใบเดียวกัน" ⇒ ช่อง where.contracts ช่องเดียว
    let branchHandled = false;
    if (hasOverdue || contractStatus) {
      where.contracts = { some: { deletedAt: null,
        ...(hasOverdue ? { status: { in: ['OVERDUE', 'DEFAULT'] as ContractStatus[] } } : { status: contractStatus as ContractStatus }),
        ...(branchId ? { branchId } : {}),
      } };
      if (branchId) branchHandled = true;
    }

    // สองตัวกรองนี้อ่านคนละฟิลด์และคนละ enum — ห้ามสลับกัน:
    //   creditStatus      → CreditCheck.status        (PENDING/APPROVED/REJECTED/MANUAL_REVIEW)
    //   creditCheckStatus → Customer.creditCheckStatus (NONE/PRE_CHECK_PASSED/
    //                                                   FULL_CHECK_PASSED/REJECTED/UNDER_REVIEW)
    // ค่าที่ไม่ใช่สมาชิกของ enum ปลายทางทำให้ Prisma โยน validation error = HTTP 500
    // (ก่อนหน้านี้หน้าจอลูกค้าส่ง APPROVED/PENDING/MANUAL_REVIEW เข้า `creditCheckStatus`
    // ซึ่งเป็นสมาชิกของ CreditCheckStatus ไม่ใช่ CustomerCreditCheckStatus) — ตรวจก่อน
    // เพื่อให้ได้ 400 พร้อมข้อความไทยแทน
    if (creditStatus) {
      assertEnumValue(creditStatus, CREDIT_CHECK_STATUSES, 'สถานะใบตรวจเครดิต');
      where.creditChecks = { some: { status: creditStatus as CreditCheckStatus, deletedAt: null } };
    }

    if (creditCheckStatus) {
      assertEnumValue(creditCheckStatus, CUSTOMER_CREDIT_CHECK_STATUSES, 'สถานะเครดิตของลูกค้า');
      where.creditCheckStatus = creditCheckStatus as CustomerCreditCheckStatus;
    }

    // การซื้อ — สาขาถูกยัดเข้า some เดียวกันเพื่อให้ "สัญญา/ใบขายใบเดียวกัน" ตรงทั้งคู่
    if (purchase === 'INSTALLMENT') {
      const statuses = state
        ? (CUSTOMER_INSTALLMENT_STATE_STATUSES[state as CustomerInstallmentState] as ContractStatus[] | undefined)
        : BOUGHT_CONTRACT_STATUSES;
      if (!statuses) throw new BadRequestException(`สถานะการผ่อนไม่ถูกต้อง: "${state}"`);
      filterAnd.push({ contracts: { some: { deletedAt: null, status: { in: statuses }, ...(branchId ? { branchId } : {}) } } });
      if (branchId) branchHandled = true;
    } else if (purchase === 'CASH' || purchase === 'EXTERNAL_FINANCE') {
      filterAnd.push({ sales: { some: { deletedAt: null, saleType: purchase, ...(branchId ? { branchId } : {}) } } });
      if (branchId) branchHandled = true;
    }

    // 🔴 สาขาต้อง OR ข้าม sales ด้วย — Customer ไม่มีคอลัมน์ branchId และลูกค้าเงินสด
    // ไม่มีสัญญาเลย เวอร์ชันเดิมที่ดูแต่ contracts ทำให้คนซื้อสดหายทั้งสาขา
    if (branchId && !branchHandled) {
      filterAnd.push({ OR: [
        { contracts: { some: { deletedAt: null, branchId } } },
        { sales: { some: { deletedAt: null, branchId } } },
      ] });
    }

    if (boughtWindow) {
      const range = purchasedWithinRange(boughtWindow, asOf);
      if (boughtWindow === 'over1y') {
        // 🔴 "ลูกค้าเก่าที่หายไป" เป็นคำถามแบบ **ปฏิเสธ** ไม่ใช่ some: คนที่ซื้อเมื่อ 2 ปีก่อน
        // **และ** ซื้ออีกเมื่อวานนี้ ผ่านเงื่อนไข some ที่มีขอบบนได้เต็ม ๆ ⇒ ลูกค้าที่ยัง
        // ซื้อซ้ำอยู่เคยโผล่ในรายการ "หายไป" สูตรที่ถูกคือ ยังเป็นลูกค้า + ไม่มีใบซื้อใด
        // ตั้งแต่จุดตัดขึ้นไปเลย
        //
        // เขียนด้วย `none` ไม่ใช่ `NOT: { some }` — NOT คู่กับ relation ที่ nullable เจอ 3VL
        // ของ SQL แล้วทิ้งแถวเงียบ ๆ (บั๊ก prod PR #1351) กฎเดียวกับ PROSPECT_WHERE
        const sinceCutoff = { gte: range.lt! };
        filterAnd.push({ AND: [
          BOUGHT_WHERE,
          { contracts: { none: { deletedAt: null, status: { in: BOUGHT_CONTRACT_STATUSES }, createdAt: sinceCutoff } } },
          { sales: { none: { deletedAt: null, saleType: { in: BOUGHT_SALE_TYPES }, createdAt: sinceCutoff } } },
        ] });
      } else {
        // 30d / 90d / ytd เป็นคำถามแบบ "มีใบซื้อในช่วงนี้" ⇒ some ถูกต้องแล้ว
        filterAnd.push({ OR: [
          { contracts: { some: { deletedAt: null, status: { in: BOUGHT_CONTRACT_STATUSES }, createdAt: range } } },
          { sales: { some: { deletedAt: null, saleType: { in: BOUGHT_SALE_TYPES }, createdAt: range } } },
        ] });
      }
    }

    if (source) {
      if (source === 'BOT') {
        filterAnd.push({ acquisitionSource: { startsWith: 'AI_CHAT' } });
      } else if (SOURCE_CHANNELS[source]) {
        // "มีห้องแชทช่องทางนี้" + ไม่ได้มาจากบอท — ไม่ใช่ "ห้องล่าสุดเป็นช่องทางนี้"
        // (ห้องล่าสุดเป็น aggregate ของ relation ซึ่ง Prisma where ทำไม่ได้) prod ยังไม่มี
        // ลูกค้าที่มีห้องซ้ำช่องทาง ⇒ ผลเท่ากัน แต่ถ้าวันหนึ่งมี คอลัมน์กับตัวกรองอาจไม่ตรงกัน
        //
        // 🔴 OR กับ acquisitionSource CHAT_* — ผู้สนใจอัตโนมัติที่ห้องแชทถูกลบไปแล้ว (รวม
        // เข้าคนจริง / ลบห้อง) ยังต้องกรองด้วยที่มาติดตัวได้ ไม่งั้นหลุดจากตัวกรองทั้งที่ยัง
        // มีป้าย "มาจากแชท" ติดอยู่
        filterAnd.push(NOT_BOT_WHERE, {
          OR: [
            { chatRooms: { some: { deletedAt: null, channel: SOURCE_CHANNELS[source] } } },
            { acquisitionSource: { in: SOURCE_CHAT_VALUES[source] } },
          ],
        });
      } else if (source === 'REFERRAL') {
        filterAnd.push(NOT_BOT_WHERE, NO_ROOM_WHERE, { referredById: { not: null } });
      } else if (source === 'WALK_IN') {
        filterAnd.push(NOT_BOT_WHERE, NO_ROOM_WHERE, { referredById: null });
      } else {
        throw new BadRequestException(`ที่มาไม่ถูกต้อง: "${source}"`);
      }
    }

    // 🔴 fromChat ใช้ได้ทั้งสองแท็บเหมือน source (Task 13 fix round, R16) — ต้อง push
    // constant เดียวกับที่ KPI ใช้ (CHAT_SOURCE_WHERE/NOT_CHAT_SOURCE_WHERE) ไม่ใช่ copy เงื่อนไข
    // ขึ้นมาใหม่ ไม่งั้น KPI กับตัวกรองจะ drift กันได้ในอนาคต
    if (filters.fromChat === 'true') {
      filterAnd.push(CHAT_SOURCE_WHERE);
    } else if (filters.fromChat === 'false') {
      filterAnd.push(NOT_CHAT_SOURCE_WHERE);
    }

    if (tags.length) {
      // deletedAt: null บังคับ — @@unique([customerId, tag, deletedAt]) ทำให้แท็บที่ถอดแล้วยังเป็นแถวอยู่
      filterAnd.push({ tags: { some: { deletedAt: null, tag: { in: tags as Prisma.EnumCustomerTagTypeFilter['in'] } } } });
    }

    if (contacted) {
      if (contacted === 'none') filterAnd.push(NO_ROOM_WHERE);
      else if (contacted === 'silent30') {
        filterAnd.push(silentBeyond(asOf, 29));
      } else {
        const days = contacted === 'today' ? 0 : contacted === '7d' ? 6 : contacted === '30d' ? 29 : null;
        if (days === null) throw new BadRequestException(`ช่วงเวลา "ติดต่อล่าสุด" ไม่ถูกต้อง: "${contacted}"`);
        filterAnd.push(contactedWithin(asOf, days));
      }
    }

    if (owner) {
      // ไม่มี Customer.assignedToId — ผู้ดูแลอยู่บนห้องแชท
      filterAnd.push({ chatRooms: { some: { deletedAt: null, assignedToId: owner === 'unassigned' ? null : owner } } });
    }

    const filterBaseWhere: Prisma.CustomerWhereInput = filterAnd.length ? { ...where, AND: filterAnd } : where;
    const viewPredicate = isProspects ? PROSPECT_WHERE : view === 'customers' ? BOUGHT_WHERE : null;
    const scopedWhere: Prisma.CustomerWhereInput = viewPredicate
      ? { ...where, AND: [...filterAnd, viewPredicate] }
      : filterBaseWhere;

    if (limit > 200) assertExportRowCount(await db.customer.count({ where: scopedWhere }));

    // Determine sort order
    const order = sortOrder === 'asc' ? 'asc' : 'desc';
    let orderBy: Prisma.CustomerOrderByWithRelationInput = { createdAt: 'desc' };

    // 🔴 เรียงได้จริงแค่ 4 คีย์: name / createdAt / contractCount (ที่นี่) + creditScore
    // (สาขาในหน่วยความจำข้างล่าง) · lastPurchaseAt / lastContactAt เป็น aggregate ของ
    // relation ซึ่ง Prisma orderBy ทำไม่ได้ ⇒ ตกมาที่ createdAt desc เงียบ ๆ เหมือนคีย์ที่ไม่รู้จัก
    // ดู HONOURED_CUSTOMER_SORT_KEYS ใน dto/customers-list-query.dto.ts
    if (sortBy === 'name') {
      orderBy = { name: order };
    } else if (sortBy === 'createdAt') {
      orderBy = { createdAt: order };
    } else if (sortBy === 'contractCount') {
      orderBy = { contracts: { _count: order } };
    }
    // Derived filters must be resolved before pagination. Fetch only IDs/scores
    // here; PII and full customer rows remain bounded to the requested page.
    let matchedIds: string[] | undefined;
    let tierById: Awaited<ReturnType<CustomerTierService['getCustomerTiers']>> | undefined;
    if (tier || sortBy === 'creditScore') {
      if (tier && !(CUSTOMER_TIERS as readonly string[]).includes(tier)) {
        throw new BadRequestException('ระดับลูกค้าไม่ถูกต้อง');
      }
      const candidates = await db.customer.findMany({
        where: scopedWhere, orderBy: [orderBy, { id: 'asc' }],
        select: { id: true, creditChecks: { where: { deletedAt: null },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { aiScore: true } } },
      });
      if (tier) tierById = await this.tierService.getCustomerTiers(candidates.map(customer => customer.id), db, asOf);
      const matching = tier ? candidates.filter(customer => tierById!.get(customer.id)?.tier === tier) : candidates;
      if (sortBy === 'creditScore') matching.sort((a, b) => {
        const aScore = a.creditChecks[0]?.aiScore, bScore = b.creditChecks[0]?.aiScore;
        if (aScore == null && bScore != null) return 1;
        if (bScore == null && aScore != null) return -1;
        const delta = aScore == null || bScore == null ? 0 : aScore - bScore;
        return (order === 'asc' ? delta : -delta) || a.id.localeCompare(b.id);
      });
      matchedIds = matching.map(customer => customer.id);
    }
    const selectedIds = matchedIds?.slice((page - 1) * limit, page * limit);

    /**
     * 🔴 `tier` ถูกคลี่ในหน่วยความจำ (ไม่มี predicate ใน where) ⇒ count ทุกนัดต้องถูก
     * บีบเข้าชุด id ที่ผ่าน tier ด้วย ไม่งั้น KPI/viewCounts จะโตกว่า `total` เอง
     * (?tier=GOLD เคยโชว์ KPI ของฐานทั้งก้อน ใหญ่กว่า total 10-200 เท่า)
     *
     * ใช้เฉพาะกรณีที่ **tier** เป็นตัวกรอง — `sortBy=creditScore` ก็สร้าง matchedIds
     * เหมือนกันแต่เป็นแค่การจัดเรียง ชุดนั้นพก predicate ของมุมมองมาด้วย ถ้าเอาไปบีบ
     * viewCounts ตัวเลขของแท็บตรงข้ามจะกลายเป็น 0 ทุกครั้งที่เรียงด้วยคะแนนเครดิต
     */
    const tierScope: Prisma.CustomerWhereInput[] = tier && matchedIds ? [{ id: { in: matchedIds } }] : [];

    // KPI + viewCounts ถูกทิ้งจากซองตอบของ export (export-snapshot.ts คืนแค่ data/total/asOf)
    // ⇒ ไม่ต้องยิง count 7 นัดทับ 10,000 แถวในทรานแซกชัน read-only
    const wantsSummary = limit <= 200;
    const kpiPredicates: Prisma.CustomerWhereInput[] = !wantsSummary ? [] : isProspects
      ? [
          contactedWithin(asOf, 6),
          { creditCheckStatus: 'UNDER_REVIEW' },
          // PRE_CHECK_PASSED เขียนไม่ได้จริงในโค้ดปัจจุบัน (checkType default FULL) ⇒ นับรวมสองค่า
          { creditCheckStatus: { in: ['PRE_CHECK_PASSED', 'FULL_CHECK_PASSED'] } },
          silentBeyond(asOf, 29),
        ]
      : [
          { contracts: { some: { deletedAt: null, status: { in: BOUGHT_CONTRACT_STATUSES } } } },
          { sales: { some: { deletedAt: null, saleType: 'CASH' } } },
          { sales: { some: { deletedAt: null, saleType: 'EXTERNAL_FINANCE' } } },
          { contracts: { some: { deletedAt: null, status: { in: ['OVERDUE', 'DEFAULT'] } } } },
          // KPI "มาจากแชท" — นับด้วยที่มาติดตัว (acquisitionSource CHAT_*) ไม่ใช่ห้องแชทปัจจุบัน
          // ⇒ ยังนับได้แม้ห้องแชทถูกลบไปแล้ว/ถูกรวมเข้าคนจริงแล้ว
          // 🔴 R16: ใช้ค่าคงที่เดียวกับตัวกรอง fromChat=true (CHAT_SOURCE_WHERE) ห้ามเขียนสูตรซ้ำ
          CHAT_SOURCE_WHERE,
        ];

    const [data, total, kpiCounts, viewCountPair] = await Promise.all([
      db.customer.findMany({
        where: selectedIds ? { AND: [scopedWhere, { id: { in: selectedIds } }] } : scopedWhere,
        orderBy: [orderBy, { id: 'asc' }],
        skip: selectedIds ? 0 : (page - 1) * limit,
        take: limit,
        select: isProspects ? PROSPECT_SELECT : CUSTOMER_SELECT,
      }),
      matchedIds ? Promise.resolve(matchedIds.length) : db.customer.count({ where: scopedWhere }),
      // KPI ทุกใบผูกกับ where ของหน้านี้ (filter-scoped) — เดิมนับทั้งฐานโดยไม่สนตัวกรองเลย
      Promise.all(kpiPredicates.map(predicate => db.customer.count({ where: { AND: [scopedWhere, predicate, ...tierScope] } }))),
      // viewCounts นับจาก filterBaseWhere ซึ่ง **ไม่มี** เงื่อนไขมุมมอง ⇒ ตัวเลขบนสวิตช์แท็บ
      // เคารพ search/สาขา/ตัวกรอง แต่ไม่เคารพแท็บที่กำลังเปิด (แบบเดียวกับ products-stock-groups)
      wantsSummary
        ? Promise.all([
            db.customer.count({ where: { AND: [filterBaseWhere, BOUGHT_WHERE, ...tierScope] } }),
            db.customer.count({ where: { AND: [filterBaseWhere, PROSPECT_WHERE, ...tierScope] } }),
          ])
        : Promise.resolve([0, 0]),
    ]);

    // Phase 3 SP4 — strict mode resolved once per request; null piiService
    // (legacy spec injection) treats as non-strict.
    const strict = this.piiService ? await this.piiService.isStrictMode(db) : false;

    type RawRow = Record<string, unknown> & { id: string };
    let rows = data as unknown as RawRow[];
    if (selectedIds) {
      const position = new Map(selectedIds.map((id, index) => [id, index]));
      rows = [...rows].sort((a, b) => position.get(a.id)! - position.get(b.id)!);
    }
    const pageIds = rows.map(row => row.id);

    // 🔴 การเพิ่มข้อมูลต่อหน้าทั้งหมดอยู่ใน Promise.all เดียว และทุกตัวรับ `db` ต่อ
    // ⇒ จำนวน query คงที่ต่อหน้า และ export ไม่หลุดออกนอก snapshot ของตัวเอง
    // tier เรียกได้ **ครั้งเดียว** ต่อหน้า (e2e sales-export-snapshot ล็อกไว้)
    const [pageTiers, purchaseById, chatById] = await Promise.all([
      isProspects
        ? Promise.resolve(new Map<string, { tier: string }>())
        : (tierById ?? this.tierService.getCustomerTiers(pageIds, db, asOf)),
      isProspects
        ? Promise.resolve(new Map<string, CustomerPurchaseSummary>())
        : this.purchaseSummary.forCustomers(pageIds, db),
      this.chatRooms.forCustomers(pageIds, db),
    ]);

    const summary = isProspects
      ? { total, contacted7d: kpiCounts[0] ?? 0, checkingCredit: kpiCounts[1] ?? 0, prechecked: kpiCounts[2] ?? 0, silent30d: kpiCounts[3] ?? 0 }
      : { total, installment: kpiCounts[0] ?? 0, cash: kpiCounts[1] ?? 0, externalFinance: kpiCounts[2] ?? 0, overdue: kpiCounts[3] ?? 0, fromChat: kpiCounts[4] ?? 0 };
    const viewCounts = { customers: viewCountPair[0], prospects: viewCountPair[1] };

    const shaped = rows.map(row => {
      const chat = chatById.get(row.id);
      const chatRooms = chat?.chatRooms ?? [];
      const latestCredit = (row.creditChecks as Array<{ status: string; aiScore: number | null }> | undefined)?.[0] ?? null;

      if (isProspects) {
        const decrypted = this.decryptCustomerPII(row, { strict }) as RawRow;
        return {
          id: row.id,
          name: decrypted.name as string,
          nickname: (decrypted.nickname ?? null) as string | null,
          phone: (decrypted.phone ?? null) as string | null,
          nationalId: (decrypted.nationalId ?? null) as string | null,
          createdAt: row.createdAt as Date,
          source: deriveSource(
            (row.acquisitionSource ?? null) as string | null,
            chatRooms[0]?.channel ?? null,
            (row.referredById ?? null) as string | null,
          ),
          acquisitionSourceRaw: (row.acquisitionSource ?? null) as string | null,
          chatPlaceholder: isChatPlaceholder({
            acquisitionSource: (row.acquisitionSource ?? null) as string | null,
            phone: (decrypted.phone ?? null) as string | null,
            nationalId: (decrypted.nationalId ?? null) as string | null,
          }),
          tags: (row.tags ?? []) as Array<{ tag: string }>,
          creditCheckStatus: row.creditCheckStatus as string,
          latestCreditScore: latestCredit?.aiScore ?? null,
          lastContactAt: chat?.lastContactAt ?? null,
          lastContactSource: chat?.lastContactSource ?? null,
          assignedTo: chat?.assignedTo ?? null,
          chatRooms,
        };
      }

      const contracts = (row.contracts ?? []) as Array<{ status: string }>;
      const activeContracts = contracts.filter(contract => contract.status === 'ACTIVE').length;
      const overdueContracts = contracts.filter(contract => ['OVERDUE', 'DEFAULT'].includes(contract.status)).length;
      // ที่มา (Task 13) ต้องอ่านค่าดิบก่อนตัด acquisitionSource/referredById ออกจาก rest ด้านล่าง —
      // ทั้งสองคอลัมน์นี้ไม่ใช่ฟิลด์ที่ตั้งใจส่งออกตรง ๆ (ไม่ใช่คอลัมน์ใหม่ของตาราง — แค่ที่มา
      // ที่อนุมานแล้ว/ค่าดิบสำหรับ debug) เหมือนกับแท็บผู้สนใจข้างบน
      const source = deriveSource(
        (row.acquisitionSource ?? null) as string | null,
        chatRooms[0]?.channel ?? null,
        (row.referredById ?? null) as string | null,
      );
      const acquisitionSourceRaw = (row.acquisitionSource ?? null) as string | null;
      // relation ชั่วคราวทุกตัวต้องถูกถอดออกจากคำตอบ ไม่งั้น payload บวมและหลุดข้อมูลที่ไม่ได้ตั้งใจส่ง
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { contracts: _c, creditChecks: _cc, tags: _t, acquisitionSource: _as, referredById: _rb, ...rest } = row;
      // Phase 5: decrypt PII fields, then strip EVERY encrypted column from the response
      const decrypted = this.decryptCustomerPII(rest as RawRow, { strict }) as RawRow;
      const purchaseSummary = purchaseById.get(row.id);
      return {
        ...stripEncrypted(decrypted),
        activeContracts,
        overdueContracts,
        latestCreditStatus: latestCredit?.status || null,
        latestCreditScore: latestCredit?.aiScore ?? null,
        source,
        acquisitionSourceRaw,
        // Task 13 fix round (R15) — ก่อนหน้านี้แท็บลูกค้า/ไม่มี view ไม่เคยคำนวณ chatPlaceholder
        // เลย (มีแค่ฝั่งผู้สนใจด้านบน) ทั้งที่ picker หลายจุด (BookingsPage, credit-check) เรียก
        // GET /customers โดยไม่ส่ง view=prospects แล้วคาดหวัง flag นี้เพื่อโชว์ "จากแชท · ยังไม่มีเบอร์"
        // ต้องอ่าน acquisitionSourceRaw/decrypted ที่คำนวณไว้แล้วข้างบน ห้ามพึ่ง ...rest เพราะ
        // acquisitionSource ถูกตัดออกจาก rest ไปแล้ว
        chatPlaceholder: isChatPlaceholder({
          acquisitionSource: acquisitionSourceRaw,
          phone: (decrypted.phone ?? null) as string | null,
          nationalId: (decrypted.nationalId ?? null) as string | null,
        }),
        tier: pageTiers.get(row.id)?.tier ?? 'NEW',
        purchase: purchaseSummary?.purchase ?? null,
        latestPurchase: purchaseSummary?.latestPurchase ?? null,
        warranty: purchaseSummary?.warranty ?? null,
        installmentBalance: purchaseSummary?.installmentBalance ?? null,
        chatRooms,
      };
    });

    return { ...paginatedResponse(shaped, total, page, limit), summary, viewCounts };
  }

  exportRows(filters: CustomersReadFilters) {
    return readExportSnapshot(this.prisma, (tx, asOf) =>
      this.findAll({ ...filters, page: 1, limit: EXPORT_ROW_LIMIT + 1 }, tx, asOf));
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        contracts: {
          select: {
            id: true,
            contractNumber: true,
            status: true,
            sellingPrice: true,
            monthlyPayment: true,
            totalMonths: true,
            createdAt: true,
            product: { select: { id: true, name: true, brand: true, model: true } },
            branch: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        // ประวัติการซื้อที่ **ไม่ผ่านสัญญาผ่อน** (ขายสด / ไฟแนนซ์นอก) — ก่อนหน้านี้ไม่มี
        // ที่ไหนแสดงเลย ลูกค้าเงินสดจึงเปิดโปรไฟล์มาเห็น "สัญญา (0)" เหมือนไม่เคยซื้ออะไร
        // ทั้งที่แถว Sale มีอยู่ (คำสั่งเจ้าของ 2026-08-27 "เก็บประวัติไว้")
        // กรอง contractId: null กันใบขายของสัญญาผ่อนโผล่ซ้ำกับแท็บสัญญา
        sales: {
          where: { contractId: null, deletedAt: null },
          select: {
            id: true,
            saleNumber: true,
            saleType: true,
            netAmount: true,
            createdAt: true,
            shopWarrantyEndDate: true,
            product: { select: { id: true, brand: true, model: true, imeiSerial: true } },
            branch: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        _count: { select: { contracts: true, referrals: true } },
        referredBy: { select: { id: true, name: true, phone: true } },
      },
    });
    if (!customer || customer.deletedAt) throw new NotFoundException('ไม่พบลูกค้า');
    // Phase 5: decrypt PII before returning. Phase 3 SP4 also enforces
    // strict-mode rejection — if PDPA_STRICT_MODE=true and the row hasn't
    // been backfilled, BadRequestException is thrown with a clear message.
    const strict = this.piiService ? await this.piiService.isStrictMode() : false;
    const decrypted = this.decryptCustomerPII(customer as unknown as Record<string, unknown>, { strict }) as typeof customer;
    return {
      ...decrypted,
      chatPlaceholder: isChatPlaceholder({
        acquisitionSource: decrypted.acquisitionSource ?? null,
        phone: decrypted.phone ?? null,
        nationalId: decrypted.nationalId ?? null,
      }),
    };
  }

  /**
   * หน้า /customers/:id เท่านั้น — findOne + ข้อมูลที่หน้ารายชื่อคำนวณอยู่แล้ว (ตัวเดียวกัน ห้ามเขียนสูตรใหม่)
   * findOne เดิมไม่แตะ: ถูกใช้เป็นด่านเช็คว่ามีลูกค้าอยู่ใน getReferrals/getChatSummary ถ้าเติม query ลงไปทุกจุดจะช้าลง
   */
  async findDetail(id: string) {
    const base = await this.findOne(id);
    const OPEN_STATUSES = ['ACTIVE', 'OVERDUE', 'DEFAULT'] as const;

    const [purchaseMap, chatMap, tags, openContracts] = await Promise.all([
      this.purchaseSummary.forCustomers([id]),
      this.chatRooms.forCustomers([id]),
      this.prisma.customerTag.findMany({ where: { customerId: id, deletedAt: null }, select: { tag: true } }),
      this.prisma.contract.findMany({
        where: { customerId: id, deletedAt: null, status: { in: [...OPEN_STATUSES] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true, contractNumber: true, status: true, monthlyPayment: true, totalMonths: true, createdAt: true,
          mdmLockedAt: true, shopWarrantyEndDate: true,
          branch: { select: { name: true } },
          product: { select: { brand: true, model: true, storage: true, imeiSerial: true, warrantyExpireDate: true } },
        },
      }),
    ]);

    const openIds = openContracts.map((contract) => contract.id);
    const [payments, lastCalls] = openIds.length
      ? await Promise.all([
          this.prisma.payment.findMany({
            where: { contractId: { in: openIds }, deletedAt: null },
            select: { contractId: true, installmentNo: true, status: true, dueDate: true, amountDue: true, amountPaid: true },
          }),
          // โทรล่าสุดของแต่ละสัญญา: findFirst ทีละใบ (ใช้ @@index([contractId]) + LIMIT 1) — `distinct` ของ Prisma
          // ที่ไม่เปิด nativeDistinct จะดึงทุกแถวของทุกสัญญามากรองในหน่วยความจำ
          Promise.all(
            openIds.map((contractId) =>
              this.prisma.callLog.findFirst({
                where: { contractId, deletedAt: null },
                orderBy: [{ calledAt: 'desc' }, { id: 'desc' }],
                select: { contractId: true, calledAt: true, result: true, notes: true, caller: { select: { name: true } } },
              }),
            ),
          ),
        ])
      : [[], []];

    const purchase = purchaseMap.get(id);
    const chat = chatMap.get(id);
    const chatRooms = chat?.chatRooms ?? [];
    return {
      ...base,
      tags,
      source: deriveSource(base.acquisitionSource ?? null, chatRooms[0]?.channel ?? null, base.referredById ?? null),
      purchase: purchase?.purchase ?? null,
      latestPurchase: purchase?.latestPurchase ?? null,
      warranty: purchase?.warranty ?? null,
      installmentBalance: purchase?.installmentBalance ?? null,
      chatRooms,
      lastContactAt: chat?.lastContactAt ?? null,
      assignedTo: chat?.assignedTo ?? null,
      openContracts: buildContractProgress({
        contracts: openContracts,
        payments,
        lastCalls: lastCalls.filter((call): call is NonNullable<typeof call> => call !== null),
        now: new Date(),
      }),
    };
  }

  async getReferrals(id: string) {
    await this.findOne(id);
    const referrals = await this.prisma.customer.findMany({
      where: { referredById: id, deletedAt: null },
      select: {
        id: true,
        name: true,
        phone: true,
        createdAt: true,
        _count: { select: { contracts: true } },
        contracts: {
          where: { deletedAt: null },
          select: { status: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      total: referrals.length,
      referrals: referrals.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        createdAt: r.createdAt,
        contractCount: r._count.contracts,
        hasActiveContract: r.contracts.some((c) => c.status === 'ACTIVE'),
      })),
    };
  }

  async search(q: string) {
    const rows = await this.prisma.customer.findMany({
      where: {
        deletedAt: null,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
          { nationalId: { contains: q } },
        ],
      },
      select: {
        id: true,
        name: true,
        // phone / nationalId (+ acquisitionSource/deletedAt สำหรับธง chatPlaceholder — A8) มาจาก select กลาง (R6)
        ...PLACEHOLDER_FIELDS_SELECT,
        phoneEncrypted: true,
        nationalIdEncrypted: true,
        _count: { select: { contracts: true } },
        contracts: {
          where: {
            deletedAt: null,
            status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] },
          },
          select: { id: true },
        },
      },
      take: 10,
      orderBy: { name: 'asc' },
    });
    // Phase 5: decrypt PII, then project only the fields callers expect
    const strict = this.piiService ? await this.piiService.isStrictMode() : false;
    return this.decryptCustomerList(rows as unknown as Record<string, unknown>[], { strict }).map((r) => ({
      id: r['id'],
      name: r['name'],
      phone: r['phone'],
      nationalId: r['nationalId'],
      _count: r['_count'],
      activeContractCount: (r['contracts'] as unknown[]).length,
      // A8 — นิยามเดียวกับ findAll/findOne (เบอร์/เลขบัตรที่ถอดรหัสแล้ว) · acquisitionSource ดิบไม่ออกไปกับคำตอบ
      chatPlaceholder: isChatPlaceholder({
        acquisitionSource: (r['acquisitionSource'] ?? null) as string | null,
        phone: (r['phone'] ?? null) as string | null,
        nationalId: (r['nationalId'] ?? null) as string | null,
      }),
    }));
  }

  /**
   * Compact summary for chat inbox assistant sidebar.
   * Returns name, phone, and lightweight counts (active contracts,
   * overdue installments, total outstanding). Cheaper than
   * `getChatSummary`, which pulls full payment/call/chat history.
   */
  async getSummary(customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true, name: true, phone: true },
    });
    if (!customer) {
      throw new NotFoundException('ไม่พบข้อมูลลูกค้า');
    }

    const activeContracts = await this.prisma.contract.count({
      where: {
        customerId,
        deletedAt: null,
        status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] },
      },
    });

    const overdueCount = await this.prisma.payment.count({
      where: {
        contract: { customerId, deletedAt: null },
        deletedAt: null,
        status: 'OVERDUE',
      },
    });

    const outstanding = await this.prisma.payment.aggregate({
      where: {
        contract: { customerId, deletedAt: null },
        deletedAt: null,
        status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
      },
      _sum: { amountDue: true },
    });

    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone ?? null,
      activeContracts,
      overdueCount,
      totalOutstandingThb: Number(outstanding._sum.amountDue ?? 0),
    };
  }

  private get piiKey(): string {
    return process.env.PII_ENCRYPTION_KEY || '';
  }

  /**
   * Phase 5 read-path: decrypt PII columns into the legacy field names.
   * After backfill (Phase 3 production step), every encrypted column should
   * be populated. We still gracefully fall back to the legacy plaintext
   * column if encrypted is NULL — supports rolling deploy + rollback safety.
   */
  private decryptCustomerPII<T extends Record<string, unknown>>(c: T | null, opts: { strict?: boolean } = {}): T | null {
    // Phase 3 SP4 — delegate to CustomerPiiService when injected (also
    // surfaces strict-mode rejection). Falls back to inline logic so legacy
    // tests that construct CustomersService without the new dependency
    // continue to work.
    if (this.piiService) {
      return this.piiService.decryptCustomerFields(c, opts);
    }
    if (!c) return c;
    const key = this.piiKey;
    if (!key) return c;

    const dec = (encField: string, legacyField: string): string | null | undefined => {
      const enc = c[encField] as string | null | undefined;
      if (enc && typeof enc === 'string' && isEncrypted(enc)) {
        return decryptPII(enc, key);
      }
      return c[legacyField] as string | null | undefined;
    };

    return {
      ...c,
      nationalId: dec('nationalIdEncrypted', 'nationalId'),
      phone: dec('phoneEncrypted', 'phone'),
      phoneSecondary: dec('phoneSecondaryEncrypted', 'phoneSecondary'),
      email: dec('emailEncrypted', 'email'),
      addressIdCard: dec('addressIdCardEncrypted', 'addressIdCard'),
      addressCurrent: dec('addressCurrentEncrypted', 'addressCurrent'),
      addressWork: dec('addressWorkEncrypted', 'addressWork'),
      guardianNationalId: dec('guardianNationalIdEncrypted', 'guardianNationalId'),
      guardianPhone: dec('guardianPhoneEncrypted', 'guardianPhone'),
      guardianAddress: dec('guardianAddressEncrypted', 'guardianAddress'),
      references: c['referencesEncrypted']
        ? decryptReferencesJson(c['referencesEncrypted'], key)
        : c['references'],
    } as T;
  }

  /**
   * Decrypt a list of customer rows.
   */
  private decryptCustomerList<T extends Record<string, unknown>>(rows: T[], opts: { strict?: boolean } = {}): T[] {
    return rows.map((r) => this.decryptCustomerPII(r, opts) as T);
  }
}
