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
import { CHAT_SOURCE_PREFIX } from '@installment/shared';

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

/** เหตุที่ไม่เขียนเบอร์หลัก — ids เท่านั้น ห้ามใส่ชื่อ/เบอร์ของลูกค้าคนอื่น (PDPA) */
export interface PhoneConflict {
  reason: 'AMBIGUOUS' | 'IDENTITY_CONFLICT' | 'ABSORB_FAILED' | 'NOT_PLACEHOLDER';
  customerIds: string[];
}

type Db = PrismaService | Prisma.TransactionClient;

const OWNER_SELECT = { id: true, lineIdShop: true, lineIdFinance: true, facebookUserId: true } as const;
type PhoneOwner = Prisma.CustomerGetPayload<{ select: typeof OWNER_SELECT }>;

const BOUND_SELECT = { id: true, phone: true, phoneSecondary: true, acquisitionSource: true, nationalId: true } as const;

interface LeadRoom {
  channel: ChatChannel;
  lineUserId: string | null;
  externalUserId: string | null;
}

/**
 * แผนที่ตัดสินก่อนเปิดทรานแซกชันหลัก (absorb / ensureForRoom เปิดทรานแซกชันของตัวเอง — ห้ามซ้อน)
 * - BOUND: อัปเดตลูกค้าที่ห้องถืออยู่ (เขียนเบอร์หลักได้เมื่อยังไม่มีเจ้าของเบอร์ — เช็คซ้ำในทรานแซกชัน)
 * - DEFER: อัปเดตลูกค้าคนนั้นโดยห้ามเขียนเบอร์หลัก (เบอร์ไปช่องสำรองถ้าว่าง)
 * - ATTACH: lead จบที่เจ้าของเบอร์ (absorb แล้ว หรือผูกห้องด้วยเบอร์) — ไม่แตะชื่อ/เบอร์ของเขา
 * - MATCHED_LINE: composite match (lineIdShop + เบอร์) — อัปเดตชื่อ+ที่มาตามเดิม
 * - CREATE: สร้างลูกค้า AI_CHAT ใหม่ (เบอร์หลักเช็คเจ้าของซ้ำในทรานแซกชัน) · มี conflict = เบอร์ไปช่องสำรอง
 */
type LeadPlan =
  | { kind: 'BOUND'; customerId: string }
  | { kind: 'DEFER'; customerId: string; conflict: PhoneConflict }
  | { kind: 'ATTACH'; customerId: string; outcome: 'ABSORBED' | 'LINKED_BY_PHONE'; absorbedPlaceholderId: string | null }
  | { kind: 'MATCHED_LINE'; customerId: string; acquisitionSource: string | null }
  | { kind: 'CREATE'; conflict: PhoneConflict | null };

/** ห้องกับเจ้าของเบอร์ชนตัวตนกัน = ตัวตนของช่องทางนี้มีค่าทั้งสองฝั่งและไม่ตรงกัน (แบบ selfLinkByPhone) */
function identityConflict(room: LeadRoom, o: PhoneOwner): boolean {
  let roomKey: string | null;
  let stored: string | null;
  switch (room.channel) {
    case ChatChannel.LINE_SHOP:
      roomKey = room.lineUserId;
      stored = o.lineIdShop;
      break;
    case ChatChannel.LINE_FINANCE:
      roomKey = room.lineUserId;
      stored = o.lineIdFinance;
      break;
    case ChatChannel.FACEBOOK:
      roomKey = room.externalUserId;
      stored = o.facebookUserId;
      break;
    default:
      return false;
  }
  return !!roomKey && !!stored && roomKey !== stored;
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
   * และ phoneHash (แถว strict mode ที่ไม่มี plaintext) · take 2 พอบอกว่า 0 / 1 / หลายคน
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

  /** (ผู้เรียกส่งเจ้าของ ≥1 คน) 1 คนที่รวม/ผูกได้ → owner · หลายคน / ไม่ใช่ placeholder / ชนตัวตน → conflict */
  private classifyOwners(
    room: LeadRoom,
    owners: PhoneOwner[],
    opts: { placeholder: boolean },
  ): { owner: PhoneOwner } | { conflict: PhoneConflict } {
    if (owners.length > 1) return { conflict: { reason: 'AMBIGUOUS', customerIds: ids(owners) } };
    if (!opts.placeholder) return { conflict: { reason: 'NOT_PLACEHOLDER', customerIds: ids(owners) } };
    if (identityConflict(room, owners[0])) {
      return { conflict: { reason: 'IDENTITY_CONFLICT', customerIds: ids(owners) } };
    }
    return { owner: owners[0] };
  }

  private async planBound(room: LeadRoom, customerId: string, phone: string | null): Promise<LeadPlan> {
    const c = await this.prisma.customer.findUnique({ where: { id: customerId }, select: BOUND_SELECT });
    const placeholder = !!c && isChatPlaceholder(c);
    const aiOwned = c?.acquisitionSource?.startsWith('AI_CHAT') ?? false;
    const phoneChanged = !!c && !!phone && c.phone !== phone;
    if (!phone || !phoneChanged || !(placeholder || aiOwned)) return { kind: 'BOUND', customerId };

    const owners = await this.findPhoneOwners(this.prisma, phone, customerId);
    if (owners.length === 0) return { kind: 'BOUND', customerId };
    const verdict = this.classifyOwners(room, owners, { placeholder });
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

    // Branch 2 (ไม่ match) / Branch 3 (FB/Web/TikTok): ห้ามสร้างคนที่สองที่ถือเบอร์หลักเดียวกัน (R25)
    // เจ้าของ 1 คนที่ไม่ชนตัวตน → ผูกห้องเข้าคนนั้น (ห้องถัดไปของผู้ใช้คนนี้ผูกตามผ่านห้องพี่น้อง)
    const owners = await this.findPhoneOwners(this.prisma, phone);
    if (owners.length === 0) return { kind: 'CREATE', conflict: null };
    const verdict = this.classifyOwners(room, owners, { placeholder: true });
    if ('owner' in verdict) {
      return { kind: 'ATTACH', customerId: verdict.owner.id, outcome: 'LINKED_BY_PHONE', absorbedPlaceholderId: null };
    }
    // ไม่แน่ใจว่าเป็นใคร → ใช้ผู้สนใจของห้องนี้ (หาเจอด้วยตัวตนที่แข็งกว่า หรือสร้าง placeholder) แล้วเก็บเบอร์เป็นช่องสำรอง
    const ensured = await this.prospects.ensureForRoom(roomId);
    if (ensured) return { kind: 'DEFER', customerId: ensured.customerId, conflict: verdict.conflict };
    return { kind: 'CREATE', conflict: verdict.conflict };
  }

  /**
   * อัปเดตลูกค้าที่ห้องถือ (Branch 1) — ชื่อ + ที่มา (Ruling R14) + เบอร์
   * - บอทสร้างเอง (AI_CHAT*) / placeholder → เขียนเบอร์หลักได้ ถ้าไม่มีคนอื่นถือเบอร์ (เช็คซ้ำในทรานแซกชัน)
   * - พนักงานผูกไว้ หรือ deferred → ห้ามทับเบอร์หลัก เก็บเป็นเบอร์สำรองเมื่อช่องสำรองว่าง
   * เบอร์ใหม่ที่ลูกค้าเพิ่งพิมพ์ต้องไม่ถูกทิ้ง (บั๊กจริง 2026-08-22: ลูกค้าให้เบอร์ใหม่
   * บอทขอซ้ำ 2 รอบ แต่ customers.phone ยังเป็นเบอร์จาก capture รอบแรก)
   */
  private async updateBound(
    tx: Prisma.TransactionClient,
    customerId: string,
    phone: string | null,
    customerName: string,
    initialConflict: PhoneConflict | null,
  ): Promise<{ outcome: PhoneOutcome; conflict: PhoneConflict | null; contactAdded: boolean }> {
    const c = await tx.customer.findUnique({ where: { id: customerId }, select: BOUND_SELECT });
    const placeholder = !!c && isChatPlaceholder(c);
    const aiOwned = c?.acquisitionSource?.startsWith('AI_CHAT') ?? false;
    const phoneChanged = !!c && !!phone && c.phone !== phone;

    const data: Prisma.CustomerUpdateInput = {
      name: customerName,
      // ผู้สนใจอัตโนมัติ: ที่มายังเป็นช่องทางที่ทักมา (CHAT_*) ไม่ใช่บอท — สเปค 3.4
      // Ruling R14: ที่มา CHAT_* ห้ามถูกทับแม้เติมเบอร์จนไม่ใช่ placeholder แล้วก็ตาม
      ...(placeholder || isChatSourced(c?.acquisitionSource) ? {} : { acquisitionSource: 'AI_CHAT_RETURN' }),
    };
    let conflict = initialConflict;
    let outcome: PhoneOutcome = conflict ? 'DEFERRED' : 'UNCHANGED';
    let contactAdded = false;

    if (phone && phoneChanged) {
      let writePrimary = !conflict && (placeholder || aiOwned);
      if (writePrimary) {
        const owners = await this.findPhoneOwners(tx, phone, customerId);
        if (owners.length > 0) {
          // มีเจ้าของโผล่ระหว่างทาง — ไม่ absorb ในทรานแซกชัน (absorb เปิดทรานแซกชันของตัวเอง)
          writePrimary = false;
          conflict = { reason: 'AMBIGUOUS', customerIds: ids(owners) };
          outcome = 'DEFERRED';
        }
      }
      if (writePrimary) {
        Object.assign(data, this.primaryPhoneFields(phone));
        outcome = 'FILLED';
        contactAdded = isBlankContact(c?.phone);
      } else if (!c?.phoneSecondary) {
        Object.assign(data, this.secondaryPhoneFields(phone));
        if (!conflict) outcome = 'SECONDARY';
      }
    }
    await tx.customer.update({ where: { id: customerId }, data });
    return { outcome, conflict, contactAdded };
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

    // เบอร์ว่าง = ไม่มีเบอร์ (ห้ามโยน — error ของ tool ทำให้ทั้งเทิร์นของบอทล้ม)
    const phone = normalizeThaiPhone(input.phone) || null;

    // R25: capture_lead ห้ามเขียนเบอร์หลักที่ลูกค้าคนอื่น (ยังไม่ถูกลบ) ถืออยู่แล้ว
    // ห้องที่ชี้ลูกค้าที่ถูก soft-delete = ห้องยังไม่มีเจ้าของ
    const boundId = room.customerId && !room.customer?.deletedAt ? room.customerId : null;
    const plan = boundId
      ? await this.planBound(room, boundId, phone)
      : await this.planUnbound(room.id, room, phone);

    let outcome: PhoneOutcome = 'UNCHANGED';
    let conflict: PhoneConflict | null = null;
    const absorbedPlaceholderId = plan.kind === 'ATTACH' ? plan.absorbedPlaceholderId : null;

    const { customerId, contactAddedFor } = await this.prisma.$transaction(async (tx) => {
      let cId: string;
      let contactAdded: string | null = null;

      if (plan.kind === 'BOUND' || plan.kind === 'DEFER') {
        // Branch 1 (หรือผู้สนใจที่ ensureForRoom คืนมา) — room.customerId ไม่ถูกเปลี่ยนเป็นคนอื่น
        const r = await this.updateBound(
          tx, plan.customerId, phone, input.customerName, plan.kind === 'DEFER' ? plan.conflict : null,
        );
        ({ outcome, conflict } = r);
        if (r.contactAdded) contactAdded = plan.customerId;
        cId = plan.customerId;
      } else if (plan.kind === 'ATTACH') {
        // จับคู่ด้วยเบอร์อย่างเดียว อ่อนกว่าตัวตน ⇒ ห้ามแตะชื่อ/เบอร์ของเจ้าของ (ชื่อที่พิมพ์อาจเป็นของคนอื่น)
        // อ่านที่มาในทรานแซกชัน — absorb (Ruling R24) อาจเพิ่งยก CHAT_* มาให้
        const o = await tx.customer.findUnique({ where: { id: plan.customerId }, select: { acquisitionSource: true } });
        if (!isChatSourced(o?.acquisitionSource)) {
          await tx.customer.update({ where: { id: plan.customerId }, data: { acquisitionSource: 'AI_CHAT_RETURN' } });
        }
        outcome = plan.outcome;
        cId = plan.customerId;
      } else if (plan.kind === 'MATCHED_LINE') {
        await tx.customer.update({
          where: { id: plan.customerId },
          data: {
            name: input.customerName,
            // Ruling R14: เหมือน Branch 1 — ลูกค้าที่จับคู่ได้อาจเป็นอดีต placeholder ที่
            // ได้เบอร์มาจากห้องอื่นแล้ว (ที่มายังเป็น CHAT_*) ห้ามทับด้วย AI_CHAT_RETURN
            ...(isChatSourced(plan.acquisitionSource) ? {} : { acquisitionSource: 'AI_CHAT_RETURN' }),
          },
        });
        outcome = 'MATCHED_LINE';
        cId = plan.customerId;
      } else {
        // สร้างใหม่ — เช็คเจ้าของเบอร์ซ้ำก่อนเขียน (ไม่มี advisory lock เหมือนฝั่งพนักงาน)
        conflict = plan.conflict;
        if (phone && !conflict) {
          const owners = await this.findPhoneOwners(tx, phone);
          if (owners.length > 0) conflict = { reason: 'AMBIGUOUS', customerIds: ids(owners) };
        }
        const phoneData = !phone
          ? { phone: null }
          : conflict
            ? { phone: null, ...this.secondaryPhoneFields(phone) }
            : this.primaryPhoneFields(phone);
        const created = await tx.customer.create({
          data: {
            name: input.customerName,
            ...phoneData,
            chatConsent: true,
            chatConsentAt: new Date(),
            lineIdShop: room.lineUserId, // null for non-LINE channels — correct
            status: 'ACTIVE',
            acquisitionSource: 'AI_CHAT',
          },
        });
        outcome = conflict ? 'DEFERRED' : 'CREATED';
        cId = created.id;
      }

      await tx.chatRoom.update({
        where: { id: input.roomId },
        data: {
          customerId: cId,
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
            phone,
            productId: input.productId ?? null,
            packageChoice: input.packageChoice ?? null,
            productNote: input.productNote ?? null,
            downAmount: input.downAmount,
            address: input.address ?? null,
            visitPlan: input.visitPlan ?? null,
            phoneOutcome: outcome,
            phoneConflict: conflict ? { reason: conflict.reason, customerIds: conflict.customerIds } : null,
            absorbedPlaceholderId,
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
