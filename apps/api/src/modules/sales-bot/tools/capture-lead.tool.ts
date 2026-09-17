import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { ChatChannel, Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  IChatGateway,
  CHAT_GATEWAY_TOKEN,
} from '../../chat-engine/interfaces/chat-gateway.interface';
import { isChatPlaceholder } from '../../chat-prospects/chat-placeholder';
import { CustomerMergeService, SYSTEM_ACTOR } from '../../chat-prospects/customer-merge.service';
import { ChatProspectService } from '../../chat-prospects/chat-prospect.service';
import { CustomerPiiService } from '../../customers/customer-pii.service';
import { JourneyEntryWriter } from '../../customer-journey/journey-entry-writer.service';
import { contactAddedEntry, isBlankContact } from '../../customer-journey/chat-identity-entries';
import { normalizeThaiPhone } from '../../../utils/thai-phone.util';
import { CHAT_SOURCE_PREFIX, chatSourceOf } from '@installment/shared';

/**
 * ที่มา CHAT_* (ผู้สนใจจากแชท) ต้องคงอยู่ตลอดไป ไม่ว่าจะยังเป็น placeholder อยู่หรือไม่ —
 * ต่างจาก isChatPlaceholder ที่ต้องการทั้ง phone==null และ nationalId==null ด้วย:
 * ลูกค้าที่ capture_lead เติมเบอร์ให้แล้วในรอบก่อน (ไม่ใช่ placeholder แล้ว) ก็ยังห้ามถูก
 * ทับที่มาในรอบถัดไป (Ruling R14, task-12 fix round 1)
 */
function isChatSourced(source: string | null | undefined): boolean {
  return !!source?.startsWith(CHAT_SOURCE_PREFIX);
}

export const CAPTURE_LEAD_TOOL = {
  name: 'capture_lead',
  description:
    'Call after customer confirms purchase (says "เอา/โอเค/สนใจ"). Captures lead, creates Customer draft, initiates handoff to staff for KYC verification. Never invites the customer to transfer money. ' +
    'Works for BOTH in-stock sales (pass productId + packageChoice from search_products/calculate_installment) ' +
    'AND order-taking of out-of-stock models (omit productId/packageChoice, pass productNote instead — never invent a productId).',
  input_schema: {
    type: 'object',
    properties: {
      customerName: { type: 'string', description: 'ชื่อลูกค้า (ขออย่างน้อย firstname)' },
      phone: { type: 'string', description: 'เบอร์โทร 10 หลัก' },
      address: {
        type: 'string',
        description:
          'ที่อยู่ — ห้ามถามลูกค้าเด็ดขาด (ร้านไม่มีบริการจัดส่ง ลูกค้ารับเครื่องที่ร้าน) ใส่เฉพาะเมื่อลูกค้าพิมพ์มาเอง',
      },
      visitPlan: {
        type: 'string',
        description: 'แผนเข้ามาที่ร้าน/ช่วงที่วางแผนซื้อ ตามคำลูกค้า เช่น "เสาร์นี้บ่าย" "สิ้นเดือน"',
      },
      productId: {
        type: 'string',
        description: 'productId จาก search_products — เฉพาะของที่มีในสต็อก (ห้ามแต่งเอง)',
      },
      packageChoice: {
        type: 'string',
        enum: ['A', 'B', 'C'],
        description: 'แพ็คผ่อนที่ลูกค้าเลือก (A=ดาวน์เบา, B=กลาง, C=หนัก) — เฉพาะของในสต็อก',
      },
      productNote: {
        type: 'string',
        description:
          'กรณีรับออเดอร์ (ของไม่มีในสต็อก ไม่มี productId): รุ่น+ความจุ+มือ 1/มือสอง+เรทที่เลือก เช่น "iPhone 15 Plus 128GB มือสอง สั่งเข้า เรทร้าน"',
      },
      downAmount: { type: 'number', description: 'ยอดดาวน์ของเรท/แพ็คที่ลูกค้าเลือก (บันทึกไว้ให้ทีมงาน — ไม่ได้ใช้ส่ง QR)' },
    },
    required: ['customerName', 'phone', 'downAmount'],
  },
};

export interface CaptureLeadInput {
  customerName: string;
  phone: string;
  address?: string;
  visitPlan?: string;
  productId?: string;
  packageChoice?: 'A' | 'B' | 'C';
  productNote?: string;
  downAmount: number;
  roomId: string;
}

export interface CaptureLeadResult {
  customerId: string;
  promptPayQr: string | null;
  downAmount: number;
  handoffMessage: string;
}

/** ผลของเบอร์ที่ลูกค้าพิมพ์ — บันทึกใน AuditLog AI_LEAD_CAPTURED (newValue.phoneOutcome) */
export type PhoneOutcome =
  | 'UNCHANGED'
  | 'FILLED'
  | 'SECONDARY'
  | 'DEFERRED'
  | 'ABSORBED'
  | 'LINKED_BY_PHONE'
  | 'MATCHED_LINE'
  | 'CREATED';

/**
 * เหตุที่ไม่เขียนเบอร์หลัก — ids เท่านั้น ห้ามใส่ชื่อ/เบอร์ของลูกค้าคนอื่น (PDPA)
 * - AMBIGUOUS: ตอนวางแผนเจอเจ้าของเบอร์ ≥2 คน
 * - IDENTITY_CONFLICT: เจ้าของเบอร์ถือตัวตนช่องทางเดียวกันของคนอื่นอยู่ (คอลัมน์ หรือห้องแชท)
 * - ABSORB_FAILED: รวม placeholder เข้าเจ้าของเบอร์ไม่สำเร็จ
 * - NOT_PLACEHOLDER: ลูกค้าที่บอทสร้างเองแต่ไม่ใช่ placeholder — ไม่รวมอัตโนมัติ
 * - OWNER_APPEARED: ตรวจซ้ำในทรานแซกชันแล้วพบเจ้าของเบอร์ที่ตอนวางแผนยังไม่มี (แข่งกัน) — กี่คนก็ได้
 */
export interface PhoneConflict {
  reason: 'AMBIGUOUS' | 'IDENTITY_CONFLICT' | 'ABSORB_FAILED' | 'NOT_PLACEHOLDER' | 'OWNER_APPEARED';
  customerIds: string[];
}

type Db = PrismaService | Prisma.TransactionClient;

/** เบอร์ที่ใช้ได้ — กติกาเดียวกับ DTO ฝั่งพนักงาน (@Matches(/^0[0-9]{9}$/)) */
const VALID_PHONE = /^0\d{9}$/;

const ROOM_KEY_SELECT = { channel: true, lineUserId: true, externalUserId: true } as const;

const OWNER_SELECT = {
  id: true,
  lineIdShop: true,
  lineIdFinance: true,
  facebookUserId: true,
  chatRooms: { where: { deletedAt: null }, select: ROOM_KEY_SELECT },
} as const;
type PhoneOwner = Prisma.CustomerGetPayload<{ select: typeof OWNER_SELECT }>;

const BOUND_SELECT = {
  id: true,
  phone: true,
  phoneHash: true,
  phoneSecondary: true,
  acquisitionSource: true,
  nationalId: true,
  deletedAt: true,
  mergedIntoId: true,
} as const;
type BoundRow = Prisma.CustomerGetPayload<{ select: typeof BOUND_SELECT }>;

interface LeadRoom {
  channel: ChatChannel;
  lineUserId: string | null;
  externalUserId: string | null;
}

/**
 * แผนที่ตัดสินก่อนเปิดทรานแซกชันหลัก (absorb / ensureForRoom เปิดทรานแซกชันของตัวเอง — ห้ามซ้อน)
 * - BOUND: อัปเดตลูกค้าคนนั้น (เขียนเบอร์หลักได้เมื่อยังไม่มีเจ้าของเบอร์ — เช็คซ้ำในทรานแซกชัน)
 * - DEFER: อัปเดตลูกค้าคนนั้นโดยห้ามเขียนเบอร์หลัก (เบอร์ไปช่องสำรองถ้าว่าง)
 * - WEAK: ห้องนี้เคยจบ lead ที่ลูกค้าคนนี้ด้วยเบอร์อย่างเดียว (ABSORBED / LINKED_BY_PHONE) —
 *   capture รอบถัดไปก็ยังห้ามแตะชื่อ/เบอร์หลักของเขา
 * - ATTACH: lead จบที่เจ้าของเบอร์ (absorb แล้ว หรือผูกห้องด้วยเบอร์) — ไม่แตะชื่อ/เบอร์ของเขา
 * - MATCHED_LINE: composite match (lineIdShop + เบอร์) — อัปเดตชื่อ+ที่มาตามเดิม
 * - CREATE: สร้างลูกค้าใหม่ (เบอร์หลักเช็คเจ้าของซ้ำในทรานแซกชัน) · มี conflict = เบอร์ไปช่องสำรอง
 */
type LeadPlan =
  | { kind: 'BOUND'; customerId: string }
  | { kind: 'DEFER'; customerId: string; conflict: PhoneConflict }
  | { kind: 'WEAK'; customerId: string }
  | { kind: 'ATTACH'; customerId: string; outcome: 'ABSORBED' | 'LINKED_BY_PHONE'; absorbedPlaceholderId: string | null }
  | { kind: 'MATCHED_LINE'; customerId: string; acquisitionSource: string | null }
  | { kind: 'CREATE'; conflict: PhoneConflict | null };

const LINE_CHANNELS: ReadonlySet<ChatChannel> = new Set([ChatChannel.LINE_SHOP, ChatChannel.LINE_FINANCE]);

function roomKeyOf(r: LeadRoom): string | null {
  return LINE_CHANNELS.has(r.channel) ? r.lineUserId : r.externalUserId;
}

function storedIdentity(channel: ChatChannel, o: PhoneOwner): string | null {
  switch (channel) {
    case ChatChannel.LINE_SHOP:
      return o.lineIdShop;
    case ChatChannel.LINE_FINANCE:
      return o.lineIdFinance;
    case ChatChannel.FACEBOOK:
      return o.facebookUserId;
    default:
      return null;
  }
}

/**
 * ห้องกับเจ้าของเบอร์ชนตัวตนกัน = ตัวตนของช่องทางนี้มีค่าทั้งสองฝั่งและไม่ตรงกัน (แบบ selfLinkByPhone)
 * ดูทั้งคอลัมน์ตัวตนของเจ้าของ และห้องแชทช่องทางเดียวกันที่ผูกกับเจ้าของอยู่ — การผูกห้องโดยพนักงาน
 * (linkCustomer) และการผูกด้วยเบอร์ของบอทเอง ไม่ได้เติมคอลัมน์ตัวตน
 */
function identityConflict(room: LeadRoom, o: PhoneOwner): boolean {
  const key = roomKeyOf(room);
  if (!key) return false;
  const stored = storedIdentity(room.channel, o);
  if (stored && stored !== key) return true;
  return (o.chatRooms ?? []).some((r) => {
    if (r.channel !== room.channel) return false;
    const other = roomKeyOf(r);
    return !!other && other !== key;
  });
}

function ids(owners: PhoneOwner[]): string[] {
  return owners.map((o) => o.id);
}

@Injectable()
export class CaptureLeadTool {
  private readonly logger = new Logger(CaptureLeadTool.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pii: CustomerPiiService,
    private readonly merge: CustomerMergeService,
    private readonly prospects: ChatProspectService,
    @Optional() private readonly journey?: JourneyEntryWriter,
    @Optional()
    @Inject(CHAT_GATEWAY_TOKEN)
    private readonly gateway?: IChatGateway,
  ) {}

  /**
   * ลูกค้าที่ยังมีชีวิตคนอื่นที่ถือเบอร์นี้เป็นเบอร์หลัก — ดูทั้งคอลัมน์ phone (แถวที่บอทเขียนยุคก่อน)
   * และ phoneHash (แถว strict mode ที่ไม่มี plaintext; ไม่ได้ตั้ง salt = ดู phone อย่างเดียว)
   * · take 2 พอบอกว่า 0 / 1 / หลายคน
   */
  private findPhoneOwners(db: Db, phone: string, excludeId?: string): Promise<PhoneOwner[]> {
    const hashWhere = this.pii.searchByHash('phone', phone);
    return db.customer.findMany({
      where: {
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        OR: [{ phone }, ...(hashWhere ? [hashWhere] : [])],
      },
      select: OWNER_SELECT,
      take: 2,
    });
  }

  /** เบอร์หลักของลูกค้าคนนี้ตรงกับเบอร์ที่พิมพ์ — แถว hash-only เทียบด้วย hash */
  private samePhone(c: BoundRow, phone: string): boolean {
    if (c.phone === phone) return true;
    return !!c.phoneHash && c.phoneHash === this.pii.searchByHash('phone', phone)?.phoneHash;
  }

  /** placeholder ตามนิยามกลาง และต้องไม่มีเบอร์แบบ hash-only ด้วย */
  private isPlaceholder(c: BoundRow): boolean {
    return isChatPlaceholder(c) && !c.phoneHash;
  }

  /** เบอร์หลัก + hash/encrypted (dual-write แบบฝั่งพนักงาน — assertContactNotDuplicate หาด้วย phoneHash) */
  private primaryPhoneFields(phone: string) {
    const enc = this.pii.encryptCustomerFields({ phone });
    return { phone, phoneHash: enc.phoneHash, phoneEncrypted: enc.phoneEncrypted };
  }

  private secondaryPhoneFields(phone: string) {
    const enc = this.pii.encryptCustomerFields({ phoneSecondary: phone });
    return { phoneSecondary: phone, phoneSecondaryEncrypted: enc.phoneSecondaryEncrypted };
  }

  /** absorb placeholder เข้าเจ้าของเบอร์ — ล้ม = คืน false (ผู้เรียกไปทาง deferred) ไม่โยนต่อ */
  private async tryAbsorb(placeholderId: string, ownerId: string): Promise<boolean> {
    try {
      await this.merge.absorbPlaceholder(placeholderId, ownerId, SYSTEM_ACTOR);
      return true;
    } catch (err) {
      this.logger.warn(
        `[capture_lead] absorb ${placeholderId} → ${ownerId} failed, phone deferred: ${err instanceof Error ? err.message : String(err)}`,
      );
      Sentry.captureException(err, { tags: { kind: 'chat-prospect' } });
      return false;
    }
  }

  /** ห้องนี้เคยจบ lead ที่ลูกค้าคนนี้ด้วยการจับคู่เบอร์อย่างเดียวหรือไม่ (อ่านจาก AI_LEAD_CAPTURED ของห้องนี้) */
  private async boundByPhoneOnly(roomId: string, customerId: string): Promise<boolean> {
    const row = await this.prisma.auditLog.findFirst({
      where: {
        action: 'AI_LEAD_CAPTURED',
        entity: 'customer',
        entityId: customerId,
        AND: [
          { newValue: { path: ['roomId'], equals: roomId } },
          {
            OR: [
              { newValue: { path: ['phoneOnlyBinding'], equals: true } },
              { newValue: { path: ['phoneOutcome'], equals: 'ABSORBED' } },
              { newValue: { path: ['phoneOutcome'], equals: 'LINKED_BY_PHONE' } },
            ],
          },
        ],
      },
      select: { id: true },
    });
    return !!row;
  }

  /** (ผู้เรียกส่งเจ้าของ ≥1 คน) 1 คนที่รวม/ผูกได้ → owner · หลายคน / ไม่ใช่ placeholder / ชนตัวตน → conflict */
  private classifyOwners(
    rooms: LeadRoom[],
    owners: PhoneOwner[],
    opts: { placeholder: boolean },
  ): { owner: PhoneOwner } | { conflict: PhoneConflict } {
    if (owners.length > 1) return { conflict: { reason: 'AMBIGUOUS', customerIds: ids(owners) } };
    if (!opts.placeholder) return { conflict: { reason: 'NOT_PLACEHOLDER', customerIds: ids(owners) } };
    if (rooms.some((r) => identityConflict(r, owners[0]))) {
      return { conflict: { reason: 'IDENTITY_CONFLICT', customerIds: ids(owners) } };
    }
    return { owner: owners[0] };
  }

  private async planBound(roomId: string, room: LeadRoom, customerId: string, phone: string | null): Promise<LeadPlan> {
    const c = await this.prisma.customer.findUnique({ where: { id: customerId }, select: BOUND_SELECT });
    if (!c) return { kind: 'BOUND', customerId };
    if (await this.boundByPhoneOnly(roomId, customerId)) return { kind: 'WEAK', customerId };
    const placeholder = this.isPlaceholder(c);
    // "บอทเป็นเจ้าของ" = บอทสร้างเองเท่านั้น (AI_CHAT) — AI_CHAT_RETURN คือลูกค้าจริงที่บอทแตะ ห้ามทับเบอร์หลัก
    const aiOwned = c.acquisitionSource === 'AI_CHAT';
    const phoneChanged = !!phone && !this.samePhone(c, phone);
    if (!phone || !phoneChanged || !(placeholder || aiOwned)) return { kind: 'BOUND', customerId };

    const owners = await this.findPhoneOwners(this.prisma, phone, customerId);
    if (owners.length === 0) return { kind: 'BOUND', customerId };
    // absorb ย้ายทุกห้องของ placeholder ⇒ ต้องไม่ชนตัวตนในห้องไหนเลย ไม่ใช่แค่ห้องนี้
    const ownRooms =
      placeholder && owners.length === 1
        ? await this.prisma.chatRoom.findMany({ where: { customerId, deletedAt: null }, select: ROOM_KEY_SELECT })
        : [];
    const verdict = this.classifyOwners([room, ...(ownRooms ?? [])], owners, { placeholder });
    if ('conflict' in verdict) return { kind: 'DEFER', customerId, conflict: verdict.conflict };
    if (await this.tryAbsorb(customerId, verdict.owner.id)) {
      return { kind: 'ATTACH', customerId: verdict.owner.id, outcome: 'ABSORBED', absorbedPlaceholderId: customerId };
    }
    return { kind: 'DEFER', customerId, conflict: { reason: 'ABSORB_FAILED', customerIds: ids(owners) } };
  }

  private async planUnbound(roomId: string, room: LeadRoom, phone: string | null): Promise<LeadPlan> {
    if (!phone) return { kind: 'CREATE', conflict: null };

    // Branch 2: LINE — composite match (lineIdShop + เบอร์) ปลอดภัย · เบอร์ดูทั้ง plaintext และ hash
    if (room.lineUserId) {
      const hashWhere = this.pii.searchByHash('phone', phone);
      const existing = await this.prisma.customer.findFirst({
        where: { deletedAt: null, lineIdShop: room.lineUserId, OR: [{ phone }, ...(hashWhere ? [hashWhere] : [])] },
        select: { id: true, acquisitionSource: true },
      });
      if (existing) return { kind: 'MATCHED_LINE', customerId: existing.id, acquisitionSource: existing.acquisitionSource };
    }

    // ตัวตนที่แข็งกว่าเบอร์มาก่อน (ห้องพี่น้อง / LINE link / lineId) — เจอ = ปฏิบัติเหมือนห้องผูกกับคนนั้นแล้ว
    const key = roomKeyOf(room);
    if (key) {
      const known = await this.prospects.findExistingCustomerId(this.prisma, room.channel, key);
      if (known) return this.planBound(roomId, room, known, phone);
    }

    // Branch 2 (ไม่ match) / Branch 3 (FB/Web/TikTok): ห้ามสร้างคนที่สองที่ถือเบอร์หลักเดียวกัน (R25)
    // เจ้าของ 1 คนที่ไม่ชนตัวตน → ผูกห้องเข้าคนนั้น (ห้องถัดไปของผู้ใช้คนนี้ผูกตามผ่านห้องพี่น้อง)
    const owners = await this.findPhoneOwners(this.prisma, phone);
    if (owners.length === 0) return { kind: 'CREATE', conflict: null };
    const verdict = this.classifyOwners([room], owners, { placeholder: true });
    if ('owner' in verdict) {
      return { kind: 'ATTACH', customerId: verdict.owner.id, outcome: 'LINKED_BY_PHONE', absorbedPlaceholderId: null };
    }
    // ไม่แน่ใจว่าเป็นใคร → ใช้ผู้สนใจของห้องนี้ (สร้าง placeholder) แล้วเก็บเบอร์เป็นช่องสำรอง
    const ensured = await this.prospects.ensureForRoom(roomId);
    if (ensured) return { kind: 'DEFER', customerId: ensured.customerId, conflict: verdict.conflict };
    return { kind: 'CREATE', conflict: verdict.conflict };
  }

  /** ตามสาย mergedIntoId ไปหาลูกค้าที่ยังมีชีวิต (ถูกรวม/ลบระหว่างวางแผนกับทรานแซกชัน) — ไม่เจอ = null */
  private async resolveLive(tx: Prisma.TransactionClient, id: string): Promise<BoundRow | null> {
    let cur: string | null = id;
    for (let hop = 0; cur && hop < 4; hop++) {
      const row: BoundRow | null = await tx.customer.findUnique({ where: { id: cur }, select: BOUND_SELECT });
      if (!row) return null;
      if (!row.deletedAt) return row;
      cur = row.mergedIntoId;
    }
    return null;
  }

  /**
   * อัปเดตลูกค้าที่ lead จบ
   * FULL (ห้องถือลูกค้าคนนี้ด้วยตัวตน) — ชื่อ + ที่มา (Ruling R14) + เบอร์
   * - บอทสร้างเอง (AI_CHAT) / placeholder → เขียนเบอร์หลักได้ ถ้าไม่มีคนอื่นถือเบอร์ (เช็คซ้ำในทรานแซกชัน)
   * - พนักงานผูกไว้ หรือ deferred → ห้ามทับเบอร์หลัก เก็บเป็นเบอร์สำรองเมื่อช่องสำรองว่าง
   * - ที่มา CHAT_* และ AI_CHAT คงเดิม — AI_CHAT_RETURN ใช้กับลูกค้าที่บอทไม่ได้สร้างเท่านั้น
   * WEAK (จับคู่ด้วยเบอร์อย่างเดียว) — ไม่แตะชื่อ/เบอร์หลัก · ที่มาไม่ใช่ CHAT_* → AI_CHAT_RETURN ·
   *   เบอร์ที่ต่างจากเบอร์หลักไปช่องสำรองเมื่อว่าง
   * เบอร์ใหม่ที่ลูกค้าเพิ่งพิมพ์ต้องไม่ถูกทิ้ง (บั๊กจริง 2026-08-22: ลูกค้าให้เบอร์ใหม่
   * บอทขอซ้ำ 2 รอบ แต่ customers.phone ยังเป็นเบอร์จาก capture รอบแรก)
   */
  private async updateCustomer(
    tx: Prisma.TransactionClient,
    c: BoundRow,
    mode: 'FULL' | 'WEAK',
    phone: string | null,
    customerName: string,
    initialConflict: PhoneConflict | null,
  ): Promise<{ outcome: PhoneOutcome; conflict: PhoneConflict | null; contactAdded: boolean }> {
    const placeholder = this.isPlaceholder(c);
    const aiOwned = c.acquisitionSource === 'AI_CHAT';
    const phoneChanged = !!phone && !this.samePhone(c, phone);

    let data: Prisma.CustomerUpdateInput;
    if (mode === 'WEAK') {
      const keep = isChatSourced(c.acquisitionSource) || c.acquisitionSource === 'AI_CHAT_RETURN';
      data = keep ? {} : { acquisitionSource: 'AI_CHAT_RETURN' };
    } else {
      // ผู้สนใจอัตโนมัติ: ที่มายังเป็นช่องทางที่ทักมา (CHAT_*) ไม่ใช่บอท — สเปค 3.4
      // Ruling R14: ที่มา CHAT_* ห้ามถูกทับแม้เติมเบอร์จนไม่ใช่ placeholder แล้วก็ตาม
      const keep = placeholder || isChatSourced(c.acquisitionSource) || aiOwned;
      data = { name: customerName, ...(keep ? {} : { acquisitionSource: 'AI_CHAT_RETURN' }) };
    }
    let conflict = initialConflict;
    let outcome: PhoneOutcome = conflict ? 'DEFERRED' : 'UNCHANGED';
    let contactAdded = false;

    if (phone && phoneChanged) {
      let writePrimary = mode === 'FULL' && !conflict && (placeholder || aiOwned);
      if (writePrimary) {
        const owners = await this.findPhoneOwners(tx, phone, c.id);
        if (owners.length > 0) {
          // มีเจ้าของโผล่ระหว่างทาง — ไม่ absorb ในทรานแซกชัน (absorb เปิดทรานแซกชันของตัวเอง)
          writePrimary = false;
          conflict = { reason: 'OWNER_APPEARED', customerIds: ids(owners) };
          outcome = 'DEFERRED';
        }
      }
      if (writePrimary) {
        Object.assign(data, this.primaryPhoneFields(phone));
        outcome = 'FILLED';
        contactAdded = isBlankContact(c.phone) && !c.phoneHash;
      } else if (!c.phoneSecondary) {
        Object.assign(data, this.secondaryPhoneFields(phone));
        if (!conflict) outcome = 'SECONDARY';
      }
    }
    if (Object.keys(data).length > 0) await tx.customer.update({ where: { id: c.id }, data });
    return { outcome, conflict, contactAdded };
  }

  /**
   * สร้างลูกค้าใหม่ — เช็คเจ้าของเบอร์ซ้ำก่อนเขียน (ไม่มี advisory lock เหมือนฝั่งพนักงาน)
   * มี conflict → เบอร์ไปช่องสำรอง และถ้าห้องมีรหัสผู้ใช้ ตั้งที่มาเป็น CHAT_* ของห้อง ⇒ เป็นผู้สนใจอัตโนมัติ
   * ที่ capture รอบหน้า/พนักงานรวมเข้าเจ้าของเบอร์ได้ ไม่ค้างเป็นแถวซ้ำถาวร
   */
  private async createLead(
    tx: Prisma.TransactionClient,
    room: LeadRoom,
    phone: string | null,
    customerName: string,
    initialConflict: PhoneConflict | null,
  ): Promise<{ id: string; outcome: PhoneOutcome; conflict: PhoneConflict | null }> {
    let conflict = initialConflict;
    if (phone && !conflict) {
      const owners = await this.findPhoneOwners(tx, phone);
      if (owners.length > 0) conflict = { reason: 'OWNER_APPEARED', customerIds: ids(owners) };
    }
    const phoneData = !phone
      ? { phone: null }
      : conflict
        ? { phone: null, ...this.secondaryPhoneFields(phone) }
        : this.primaryPhoneFields(phone);
    const created = await tx.customer.create({
      data: {
        name: customerName,
        ...phoneData,
        chatConsent: true,
        chatConsentAt: new Date(),
        lineIdShop: room.lineUserId, // null for non-LINE channels — correct
        status: 'ACTIVE',
        acquisitionSource: conflict && roomKeyOf(room) ? chatSourceOf(room.channel) : 'AI_CHAT',
      },
    });
    return { id: created.id, outcome: conflict ? 'DEFERRED' : 'CREATED', conflict };
  }

  async run(input: CaptureLeadInput): Promise<CaptureLeadResult> {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: input.roomId },
      select: {
        id: true,
        channel: true,
        lineUserId: true,
        externalUserId: true,
        customerId: true,
        customer: { select: { deletedAt: true } },
      },
    });
    if (!room) {
      throw new Error(`Room not found: ${input.roomId}`);
    }

    // System user required for AuditLog.userId (AI-driven action has no human staff).
    // Same pattern as cron jobs: e.g. installment-accrual.cron.ts:145
    const systemUser = await this.prisma.user.findFirst({
      where: { isSystemUser: true },
      select: { id: true },
    });
    if (!systemUser) {
      throw new Error('System user (isSystemUser=true) not found — required for AI audit logs');
    }

    const configs = await this.prisma.systemConfig.findMany({
      where: {
        key: { in: ['shop_bot_central_branch_id', 'shop_bot_lead_handoff_enabled'] },
        deletedAt: null,
      },
    });
    const configMap = new Map(configs.map((c) => [c.key, c.value]));
    const branchId = configMap.get('shop_bot_central_branch_id');
    // สวิตช์ช่วงทดสอบ (คำสั่งเจ้าของ 2026-08-23 "อย่าเพิ่งติดสถานะ"): 'false' = เก็บ lead ตามปกติ
    // แต่ไม่ปักธง handoff → บอทคุยต่อได้ไม่ต้อง #reset · ไม่มีแถว/ค่าอื่น = ปักธงตามดีไซน์ (go-live)
    const handoffAfterLead = configMap.get('shop_bot_lead_handoff_enabled') !== 'false';

    // Validate central branch is configured — it's required downstream when
    // SALES converts this lead into a Contract (Contract.branchId is NOT NULL).
    // Customer model itself has no branchId, so we don't store it on Customer —
    // we just fail-fast here so leads aren't captured into a system that can't
    // convert them.
    if (!branchId) {
      throw new Error('shop_bot_central_branch_id not configured');
    }

    // เบอร์ว่าง/รูปแบบผิด = ไม่มีเบอร์ (ห้ามโยน — error ของ tool ทำให้ทั้งเทิร์นของบอทล้ม)
    // เบอร์ผิดรูปแบบห้ามใช้หาเจ้าของ/รวม/ผูก/เขียน — เก็บไว้ใน audit ให้ทีมโทรกลับเท่านั้น
    const typedPhone = normalizeThaiPhone(input.phone) || null;
    const phone = typedPhone && VALID_PHONE.test(typedPhone) ? typedPhone : null;

    // ไม่มีกุญแจ/salt PII = เขียนเบอร์ไม่ได้ — ล้มตั้งแต่ตรงนี้ ก่อน absorb/ensureForRoom จะเปลี่ยนอะไรไปแล้ว
    if (phone) this.pii.encryptCustomerFields({ phone });

    // R25: capture_lead ห้ามเขียนเบอร์หลักที่ลูกค้าคนอื่น (ยังไม่ถูกลบ) ถืออยู่แล้ว
    // ห้องที่ชี้ลูกค้าที่ถูก soft-delete = ห้องยังไม่มีเจ้าของ
    const boundId = room.customerId && !room.customer?.deletedAt ? room.customerId : null;
    const plan = boundId
      ? await this.planBound(room.id, room, boundId, phone)
      : await this.planUnbound(room.id, room, phone);

    let outcome: PhoneOutcome = 'UNCHANGED';
    let conflict: PhoneConflict | null = null;
    let phoneOnly = plan.kind === 'WEAK';
    const absorbedPlaceholderId = plan.kind === 'ATTACH' ? plan.absorbedPlaceholderId : null;

    const { customerId, contactAddedFor } = await this.prisma.$transaction(async (tx) => {
      let cId: string | null = null;
      let contactAdded: string | null = null;
      let createConflict: PhoneConflict | null = plan.kind === 'CREATE' ? plan.conflict : null;

      if (plan.kind === 'BOUND' || plan.kind === 'DEFER' || plan.kind === 'WEAK') {
        const initial = plan.kind === 'DEFER' ? plan.conflict : null;
        const c = await this.resolveLive(tx, plan.customerId);
        if (c && c.id === plan.customerId) {
          const r = await this.updateCustomer(
            tx, c, plan.kind === 'WEAK' ? 'WEAK' : 'FULL', phone, input.customerName, initial,
          );
          ({ outcome, conflict } = r);
          if (r.contactAdded) contactAdded = c.id;
          cId = c.id;
        } else if (c) {
          // ถูกรวมเข้าคนอื่นระหว่างทาง (เช่น absorb พร้อมกัน) → จบที่ผู้รับรวม แบบไม่แตะชื่อ/เบอร์หลัก
          const r = await this.updateCustomer(tx, c, 'WEAK', phone, input.customerName, initial);
          ({ outcome, conflict } = r);
          phoneOnly = true;
          cId = c.id;
        } else {
          createConflict = initial;
        }
      } else if (plan.kind === 'ATTACH') {
        // จับคู่ด้วยเบอร์อย่างเดียว อ่อนกว่าตัวตน ⇒ ห้ามแตะชื่อ/เบอร์ของเจ้าของ (ชื่อที่พิมพ์อาจเป็นของคนอื่น)
        // อ่านในทรานแซกชัน — absorb (Ruling R24) อาจเพิ่งยก CHAT_* มาให้ และเจ้าของอาจถูกรวม/ลบไปแล้ว
        const o = await this.resolveLive(tx, plan.customerId);
        let stillOwner = !!o;
        if (o && plan.outcome === 'LINKED_BY_PHONE' && phone) {
          const owners = await this.findPhoneOwners(tx, phone);
          const same = owners.length === 1 && owners[0].id === o.id && !identityConflict(room, owners[0]);
          if (!same && o.id === plan.customerId) {
            stillOwner = false;
            createConflict = owners.length > 0 ? { reason: 'OWNER_APPEARED', customerIds: ids(owners) } : null;
          }
        }
        if (o && stillOwner) {
          await this.updateCustomer(tx, o, 'WEAK', phone, input.customerName, null);
          outcome = plan.outcome;
          phoneOnly = true;
          cId = o.id;
        }
      } else if (plan.kind === 'MATCHED_LINE') {
        await tx.customer.update({
          where: { id: plan.customerId },
          data: {
            name: input.customerName,
            // Ruling R14: เหมือน Branch 1 — ลูกค้าที่จับคู่ได้อาจเป็นอดีต placeholder ที่
            // ได้เบอร์มาจากห้องอื่นแล้ว (ที่มายังเป็น CHAT_*) ห้ามทับด้วย AI_CHAT_RETURN
            ...(isChatSourced(plan.acquisitionSource) || plan.acquisitionSource === 'AI_CHAT'
              ? {}
              : { acquisitionSource: 'AI_CHAT_RETURN' }),
          },
        });
        outcome = 'MATCHED_LINE';
        cId = plan.customerId;
      }

      if (!cId) {
        const created = await this.createLead(tx, room, phone, input.customerName, createConflict);
        ({ outcome, conflict } = created);
        phoneOnly = false;
        cId = created.id;
      }

      // ห้องถูกผูกกับลูกค้าที่ยังมีชีวิตคนอื่นระหว่างทาง (พนักงานผูกเอง) → ไม่ทับ
      const current = await tx.chatRoom.findUnique({
        where: { id: input.roomId },
        select: { customerId: true, customer: { select: { deletedAt: true } } },
      });
      const keepBinding =
        !!current?.customerId &&
        current.customerId !== cId &&
        !current.customer?.deletedAt &&
        current.customerId !== boundId;
      if (keepBinding) {
        this.logger.warn(`[capture_lead] room ${input.roomId} re-bound concurrently — lead ended on ${cId}`);
      }
      await tx.chatRoom.update({
        where: { id: input.roomId },
        data: {
          ...(keepBinding ? {} : { customerId: cId }),
          ...(handoffAfterLead
            ? { handoffMode: true, handoffReason: 'lead_captured', handoffTaggedAt: new Date() }
            : {}),
        },
      });

      await tx.auditLog.create({
        data: {
          userId: systemUser.id,
          action: 'AI_LEAD_CAPTURED',
          entity: 'customer',
          entityId: cId,
          newValue: {
            customerName: input.customerName,
            phone: typedPhone,
            productId: input.productId ?? null,
            packageChoice: input.packageChoice ?? null,
            productNote: input.productNote ?? null,
            downAmount: input.downAmount,
            address: input.address ?? null,
            visitPlan: input.visitPlan ?? null,
            roomId: input.roomId,
            phoneValid: typedPhone === null ? null : phone !== null,
            phoneOutcome: outcome,
            phoneConflict: conflict ? { reason: conflict.reason, customerIds: conflict.customerIds } : null,
            absorbedPlaceholderId,
            phoneOnlyBinding: phoneOnly,
          },
        },
      });

      return { customerId: cId, contactAddedFor: contactAdded };
    });

    if (contactAddedFor) {
      await this.journey?.recordAfterCommit(
        contactAddedEntry({
          customerId: contactAddedFor,
          fields: ['phone'],
          via: 'CAPTURE_LEAD',
          actorUserId: null,
          occurredAt: new Date(),
        }),
      );
    }

    // Real-time refresh so the "ต้องตอบ" badge + "รอตอบ" filter chip
    // light up in UnifiedInboxPage's ConversationList immediately.
    this.gateway?.emitRoomUpdate(input.roomId, {
      roomId: input.roomId,
      handoffMode: handoffAfterLead,
      customerId,
    });

    // ปิดการขาย = ส่งต่อทีมงาน **ห้ามชวนลูกค้าโอนเงิน/ส่ง QR ในแชท** (คำสั่งเจ้าของ 2026-08-22)
    // ลูกค้าต้องผ่านตรวจเอกสาร + เข้ามาดูเครื่องที่ร้านก่อนเสมอ ค่อยจ่ายดาวน์หน้าร้าน
    // (เดิมโค้ดบังคับปิดท้ายว่า "จะส่ง QR ดาวน์ X บาทให้ในแชทนี้" ทุกครั้ง ซึ่งขัดกับ
    //  คำสั่งสอนบอทเองที่เขียนว่า "ยังไม่ต้องโอนอะไรทั้งนั้น มาดูเครื่องก่อนได้ค่ะ")
    const promptPayQr: string | null = null;
    // ประโยคท้าย = privacy notice ตาม พ.ร.บ.คุ้มครองข้อมูลฯ (ใช้ข้อมูลเพื่อคำสั่งซื้อนี้เท่านั้น)
    const pdpaNote = 'ข้อมูลชื่อ-เบอร์จะใช้ติดต่อเรื่องคำสั่งซื้อนี้เท่านั้นนะคะ';
    const handoffMessage =
      `ทีมงานจะเช็คเอกสารแล้วติดต่อกลับไปนะคะ 🙏 ` +
      `ยังไม่ต้องโอนอะไรทั้งนั้น แวะมาดูเครื่องที่ร้านก่อนได้เลยค่ะ ${pdpaNote}`;

    return {
      customerId,
      promptPayQr,
      downAmount: input.downAmount,
      handoffMessage,
    };
  }
}
