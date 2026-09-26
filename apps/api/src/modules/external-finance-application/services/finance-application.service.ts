import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExternalFinanceActorType, ExternalFinanceDocSlot, ExternalFinanceEventKind, Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import {
  DEFAULT_PRECHECK_TEMPLATE, buildPrecheckMessage, precheckMissingFields, computeAgeYears, renderHand,
  PRECHECK_FIELD_LABELS, type PrecheckField, type PrecheckValues,
} from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { hashLockKey } from '../../../utils/advisory-lock.util';
import { encryptPII, decryptPII } from '../../../utils/crypto.util';
import { CustomerPiiService } from '../../customers/customer-pii.service';
import { CustomersService } from '../../customers/customers.service';
import { isChatPlaceholder, PLACEHOLDER_FIELDS_SELECT } from '../../chat-prospects/chat-placeholder';
import { StorageService } from '../../storage/storage.service';
import { FinanceApplicationNumberService } from './finance-application-number.service';
import { GfinLineGroupService } from './gfin-line-group.service';
import { FinanceActor, GFIN_COMPANY_NAME, REQUIRED_SLOTS, SHARE_TTL_DAYS, SLOT_LABELS } from '../constants';
import { applyTransition, isClosed } from '../finance-application-status.util';
import { ResendFinanceApplicationDto, SendFinanceApplicationDto, StaffResultDto, UpdateFinanceApplicationDto, UpdateFinanceCustomerFieldsDto } from '../dto/finance-application.dto';
import { newShareToken } from '../finance-share-token.util';

const OPEN_STATUSES = ['DRAFT', 'SENT', 'ACKNOWLEDGED', 'MORE_INFO'] as const;
const EDITABLE_STATUSES = ['DRAFT', 'MORE_INFO'] as const;
/** CAS ของการเปลี่ยนสถานะฝั่งพนักงานแพ้คำขออื่นที่เปลี่ยนสถานะไปก่อน (minor 9 — แบบเดียวกับ FinanceShareService.reply) */
const STALE_STATUS_MSG = 'ใบยื่นเปลี่ยนสถานะไปแล้ว กรุณาโหลดใหม่แล้วลองอีกครั้ง';
const DAY_MS = 86400000;

export const applicationInclude = {
  files: { where: { deletedAt: null }, orderBy: [{ slot: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] },
  events: { orderBy: { createdAt: 'asc' } },
  // phone ถอดผ่าน CustomerPiiService.decryptCustomerFields (ต้องมี phoneEncrypted ให้มันอ่าน) —
  // name/occupation/birthDate เป็น plaintext ในสคีมานี้ (ไม่มีคอลัมน์ nameEncrypted/occupationEncrypted)
  customer: { select: { id: true, name: true, phone: true, phoneEncrypted: true, occupation: true, birthDate: true } },
  product: { select: { id: true, name: true, brand: true, model: true, storage: true, color: true, imeiSerial: true, serialNumber: true, category: true, batteryHealth: true, hasBox: true, accessoriesIncluded: true, status: true } },
  financeCompany: { select: { id: true, name: true, lineGroupId: true, precheckTemplate: true } },
  sentBy: { select: { id: true, name: true } },
} satisfies Prisma.ExternalFinanceApplicationInclude;

/** แถวใบยื่นที่โหลดครบ (รวมห้อง) — ใช้ภายใน service เท่านั้น เพราะยังมีคอลัมน์ลิงก์สาธารณะอยู่ */
type LoadedApplication = Prisma.ExternalFinanceApplicationGetPayload<{ include: typeof applicationInclude & { room: true } }>;

type ShareSecrets = { shareTokenHash: string | null; shareTokenEnc: string | null };
/**
 * ตัด hash/โทเคนเข้ารหัสของลิงก์สาธารณะออกก่อนคืนให้เว็บทุกครั้ง (minor 8) — URL ของลิงก์ขอผ่าน
 * `GET :id/share-link` เท่านั้น
 */
export function toApplicationView<T extends ShareSecrets>(row: T): Omit<T, keyof ShareSecrets> {
  const view: Record<string, unknown> = { ...row };
  delete view.shareTokenHash;
  delete view.shareTokenEnc;
  return view as Omit<T, keyof ShareSecrets>;
}

/** วันเกิดจากช่องวันที่ของเว็บ (YYYY-MM-DD) — ต้องเป็นอดีตและไม่เก่าเกินจริง */
function parseBirthDate(raw: string): Date {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new BadRequestException('วันเกิดไม่ถูกต้อง');
  if (date.getTime() > Date.now()) throw new BadRequestException('วันเกิดต้องไม่เป็นวันในอนาคต');
  if (date.getUTCFullYear() < 1900) throw new BadRequestException('วันเกิดไม่ถูกต้อง');
  return date;
}

export interface PreviewResult {
  text: string;
  values: PrecheckValues;
  missingFields: PrecheckField[];
  missingRequiredSlots: ExternalFinanceDocSlot[];
  warnings: string[];
  canSend: boolean;
}

@Injectable()
export class FinanceApplicationService {
  private readonly logger = new Logger(FinanceApplicationService.name);
  constructor(
    private prisma: PrismaService,
    private numbers: FinanceApplicationNumberService,
    private pii: CustomerPiiService,
    private config: ConfigService,
    private storage: StorageService,
    private customers: CustomersService,
    private lineGroup: GfinLineGroupService,
  ) {}

  /** กติกาเดียวกับตรวจเครดิต (room-credit.service.ts:92-98): SALES เข้าได้เฉพาะห้องว่างหรือห้องตัวเอง */
  async access(db: Prisma.TransactionClient | PrismaService, roomId: string, actor: FinanceActor) {
    const room = await db.chatRoom.findFirst({ where: { id: roomId, deletedAt: null } });
    if (!room) throw new NotFoundException('ไม่พบห้องแชท');
    if (actor.role === 'SALES' && room.assignedToId && room.assignedToId !== actor.id)
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงห้องแชทนี้');
    return room;
  }

  async addEvent(
    db: Prisma.TransactionClient | PrismaService,
    applicationId: string,
    kind: ExternalFinanceEventKind,
    actorType: ExternalFinanceActorType,
    fields: { actorUserId?: string | null; actorName?: string | null; note?: string | null; meta?: Prisma.InputJsonValue } = {},
  ) {
    return db.externalFinanceApplicationEvent.create({ data: { applicationId, kind, actorType, ...fields } });
  }

  private async gfinCompanyId(db: Prisma.TransactionClient | PrismaService) {
    // แถวถูก seed ด้วย migration แล้ว — upsert เผื่อฐานที่ยังไม่รัน migration (แบบ sale-writer.service.ts:85-94)
    const company = await db.externalFinanceCompany.upsert({
      where: { name: GFIN_COMPANY_NAME }, create: { name: GFIN_COMPANY_NAME, isActive: true }, update: {},
    });
    return company.id;
  }

  /**
   * ลูกค้าของห้องที่ใช้ตั้งต้นใบยื่นได้ — "ผู้สนใจอัตโนมัติจากแชท" (placeholder) ไม่นับ (C1):
   * เกือบทุกห้องถูกผูก placeholder อัตโนมัติ (`ChatProspectService.ensureForRoom`) ชื่อ = ชื่อโปรไฟล์แชท
   * ไม่มีเบอร์/เลขบัตร — ถ้าคัดลอกมาใบยื่นจะข้ามขั้นอ่านบัตร/สร้างลูกค้าไปเลย
   */
  private async realCustomerId(customerId: string | null): Promise<string | null> {
    if (!customerId) return null;
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true, ...PLACEHOLDER_FIELDS_SELECT },
    });
    return customer && !isChatPlaceholder(customer) ? customer.id : null;
  }

  async createDraft(roomId: string, actor: FinanceActor) {
    const room = await this.access(this.prisma, roomId, actor);
    const seedCustomerId = await this.realCustomerId(room.customerId ?? null);
    const app = await this.prisma.$transaction(async (tx) => {
      // ล็อกระดับห้องก่อนเช็คใบเปิด — กัน createDraft พร้อมกันสองคำขอสร้างซ้ำ (finding รอบ 1)
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${hashLockKey(`finance-app-room:${roomId}`)})`);
      // เฉพาะใบที่ยังเปิด — ใบปิดแล้วที่เป็น "ใบล่าสุด" ของห้อง (listForRoom) ต้องไม่กันการเริ่มใบใหม่ (I1)
      const open = await tx.externalFinanceApplication.findFirst({
        where: { roomId, deletedAt: null, status: { in: [...OPEN_STATUSES] } },
        include: applicationInclude,
      });
      if (open) return open;
      const number = await this.numbers.next(tx);
      const created = await tx.externalFinanceApplication.create({
        data: {
          number, roomId, status: 'DRAFT', createdById: actor.id, branchId: actor.branchId ?? null,
          customerId: seedCustomerId, financeCompanyId: await this.gfinCompanyId(tx),
        },
        include: applicationInclude,
      });
      await this.addEvent(tx, created.id, 'CREATED', 'STAFF', { actorUserId: actor.id });
      return created;
    });
    return toApplicationView(app);
  }

  /**
   * ใบปัจจุบันของห้อง + ประวัติ: ห้องผูกลูกค้า → ทุกใบของลูกค้า (ทุกห้อง) ไม่งั้นเฉพาะห้องนี้ (spec §5.1)
   * `current` = ใบที่ยังเปิดของห้องนี้ ไม่มีก็ใบล่าสุดของห้องนี้ (ปิดแล้วก็ได้ — I1: การ์ดสถานะปิด /
   * "เมื่อผ่านแล้ว" / "เริ่มใบยื่นใหม่" / จุดเหลืองของผล GFIN ต้องยังเห็น) · SALES: ประวัติข้ามห้องไม่รวม
   * ใบของห้องที่คนอื่นดูแล (กติกาเดียวกับ access())
   */
  async listForRoom(roomId: string, actor: FinanceActor) {
    const room = await this.access(this.prisma, roomId, actor);
    const scope: Prisma.ExternalFinanceApplicationWhereInput = room.customerId
      ? { OR: [{ roomId }, { customerId: room.customerId }] }
      : { roomId };
    const salesScope: Prisma.ExternalFinanceApplicationWhereInput = actor.role === 'SALES'
      ? { room: { OR: [{ assignedToId: null }, { assignedToId: actor.id }] } }
      : {};
    const rows = await this.prisma.externalFinanceApplication.findMany({
      where: { deletedAt: null, AND: [scope, salesScope] }, include: applicationInclude, orderBy: { createdAt: 'desc' },
    });
    const own = rows.filter((r) => r.roomId === roomId);
    const current = own.find((r) => !isClosed(r.status)) ?? own[0] ?? null;
    return {
      current: current ? toApplicationView(current) : null,
      history: rows.filter((r) => r.id !== current?.id).map(toApplicationView),
      // PR 2 (spec §6.1 "กลุ่มไลน์ปลายทาง"): แท็บโชว์ชื่อกลุ่ม + พร้อมส่ง/บอทไม่อยู่ในกลุ่ม
      lineGroup: await this.lineGroup.status(),
    };
  }

  /** โหลดใบยื่นเต็มแถว (มีคอลัมน์ลิงก์) + ตรวจสิทธิ์ห้อง — ใช้ภายในเท่านั้น ห้ามคืนตรงให้ controller */
  private async load(id: string, actor: FinanceActor): Promise<LoadedApplication> {
    const app = await this.prisma.externalFinanceApplication.findFirst({
      where: { id, deletedAt: null }, include: { ...applicationInclude, room: true },
    });
    if (!app) throw new NotFoundException('ไม่พบใบยื่น');
    await this.access(this.prisma, app.roomId, actor);
    return app;
  }

  async get(id: string, actor: FinanceActor) {
    return toApplicationView(await this.load(id, actor));
  }

  private async reloadView(db: Prisma.TransactionClient | PrismaService, id: string) {
    return toApplicationView(await db.externalFinanceApplication.findUniqueOrThrow({ where: { id }, include: applicationInclude }));
  }

  async update(id: string, dto: UpdateFinanceApplicationDto, actor: FinanceActor) {
    const app = await this.load(id, actor);
    if (!EDITABLE_STATUSES.includes(app.status as (typeof EDITABLE_STATUSES)[number]))
      throw new ConflictException('แก้ได้เฉพาะใบยื่นที่ยังเป็นร่างหรือ GFIN ขอเอกสารเพิ่ม');
    if (dto.productId) {
      const product = await this.prisma.product.findFirst({ where: { id: dto.productId, deletedAt: null }, select: { id: true, status: true } });
      if (!product) throw new NotFoundException('ไม่พบสินค้า');
      if (!['IN_STOCK', 'RESERVED'].includes(product.status))
        throw new BadRequestException('เลือกได้เฉพาะเครื่องที่พร้อมขายหรือจองอยู่');
    }
    if (dto.customerId) {
      const customer = await this.prisma.customer.findFirst({ where: { id: dto.customerId, deletedAt: null }, select: { id: true } });
      if (!customer) throw new NotFoundException('ไม่พบลูกค้า');
    }
    const productChanged = dto.productId !== undefined && (dto.productId || null) !== app.productId;
    const { view, staleKeys } = await this.prisma.$transaction(async (tx) => {
      let staleKeys: string[] = [];
      if (productChanged) {
        // เปลี่ยนเครื่อง = รูป 6 มุมจากสต๊อกของเครื่องเดิมที่ยังไม่ส่ง ต้องไม่ติดไปกับใบ (I3) — ไฟล์ที่ส่งแล้วคงไว้เป็นหลักฐาน
        // ล็อกเดียวกับ attach() ของไฟล์ → fromProduct ของเครื่องเดิมที่วิ่งค้างอยู่แนบรูปเข้ามาหลังเราล้างไม่ได้
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${hashLockKey(`finance-app-files:${id}`)})`);
        const stale = await tx.externalFinanceApplicationFile.findMany({
          where: { applicationId: id, deletedAt: null, sentAt: null, source: 'PRODUCT_PHOTO' },
          select: { id: true, storageKey: true },
        });
        if (stale.length) {
          await tx.externalFinanceApplicationFile.updateMany({ where: { id: { in: stale.map((f) => f.id) } }, data: { deletedAt: new Date() } });
        }
        staleKeys = stale.flatMap((f) => (f.storageKey ? [f.storageKey] : []));
      }
      const cas = await tx.externalFinanceApplication.updateMany({
        where: { id, deletedAt: null, status: { in: [...EDITABLE_STATUSES] } },
        data: {
          ...(dto.productId !== undefined ? { productId: dto.productId || null } : {}),
          ...(dto.customerId !== undefined ? { customerId: dto.customerId || null } : {}),
          ...(dto.occupationOverride !== undefined ? { occupationOverride: dto.occupationOverride || null } : {}),
          ...(dto.messageOverride !== undefined ? { messageOverride: dto.messageOverride || null } : {}),
        },
      });
      if (cas.count === 0) throw new ConflictException(STALE_STATUS_MSG);
      return { view: await this.reloadView(tx, id), staleKeys };
    });
    await this.deleteStoredObjects(staleKeys, id);
    return view;
  }

  /** ลบไฟล์ใน storage หลัง commit — best effort (แถวถูก soft-delete ไปแล้ว ไฟล์ค้างไม่ทำให้ส่งผิด แค่เปลืองที่) */
  private async deleteStoredObjects(keys: string[], applicationId: string) {
    for (const key of keys) {
      try {
        await this.storage.delete(key);
      } catch (err) {
        this.logger.warn(`[finance-app] could not delete stale product photo app=${applicationId} key=${key}: ${(err as Error)?.message ?? err}`);
      }
    }
  }

  /**
   * เติมเบอร์/วันเกิดของลูกค้าที่ผูกกับใบยื่น (ขั้นที่ 1) — ทางเฉพาะของฟีเจอร์นี้ เพราะ `PATCH /customers/:id`
   * เปิดแค่ OWNER/BRANCH_MANAGER (C1) · กติกาเขียนเบอร์ทั้งหมด (normalize · ล็อกเบอร์หลัก · 409 เบอร์ซ้ำ ·
   * เข้ารหัส/hash · บันทึกการเดินทาง) ใช้ของ `CustomerWriteService.update` ตัวเดียวกับหน้าลูกค้า
   * ขอบเขตแคบโดยตั้งใจ: ผ่านกติกาห้องของ `load()` · เฉพาะใบร่าง/ขอเพิ่ม · เฉพาะลูกค้าจริง (ไม่ใช่ผู้สนใจอัตโนมัติ —
   * ทางนั้นคือ "เพิ่มเบอร์/ข้อมูล" ของ fill-contact) · เติมได้เฉพาะช่องที่ยังว่าง (แก้ค่าที่มีอยู่ = หน้ารายละเอียดลูกค้า)
   */
  async updateCustomerFields(id: string, dto: UpdateFinanceCustomerFieldsDto, actor: FinanceActor) {
    const app = await this.load(id, actor);
    if (!EDITABLE_STATUSES.includes(app.status as (typeof EDITABLE_STATUSES)[number]))
      throw new ConflictException('แก้ข้อมูลลูกค้าได้เฉพาะใบยื่นที่ยังเป็นร่างหรือ GFIN ขอเอกสารเพิ่ม');
    if (dto.phone === undefined && dto.birthDate === undefined) throw new BadRequestException('กรุณาระบุเบอร์โทรหรือวันเกิด');
    if (!app.customerId) throw new BadRequestException('ใบยื่นนี้ยังไม่ผูกลูกค้า — ผูกลูกค้าในขั้นที่ 1 ก่อน');
    const customer = await this.prisma.customer.findFirst({
      where: { id: app.customerId, deletedAt: null },
      select: { id: true, birthDate: true, phoneEncrypted: true, ...PLACEHOLDER_FIELDS_SELECT },
    });
    if (!customer) throw new NotFoundException('ไม่พบลูกค้าของใบยื่นนี้');
    if (isChatPlaceholder(customer)) {
      throw new ConflictException('ลูกค้าของใบยื่นนี้ยังเป็นผู้สนใจอัตโนมัติจากแชท — กด "เพิ่มเบอร์/ข้อมูลลูกค้า" ในขั้นที่ 1 ของแท็บ GFIN ก่อน');
    }
    const current = this.pii.decryptCustomerFields(customer as Record<string, unknown>) as { phone?: string | null };
    if (dto.phone !== undefined && current?.phone?.trim()) {
      throw new ConflictException('ลูกค้าคนนี้มีเบอร์โทรแล้ว — ให้เจ้าของหรือผู้จัดการสาขาแก้ที่หน้ารายละเอียดลูกค้า');
    }
    if (dto.birthDate !== undefined && customer.birthDate) {
      throw new ConflictException('ลูกค้าคนนี้มีวันเกิดแล้ว — ให้เจ้าของหรือผู้จัดการสาขาแก้ที่หน้ารายละเอียดลูกค้า');
    }
    const birthDate = dto.birthDate !== undefined ? parseBirthDate(dto.birthDate) : undefined;
    await this.customers.update(
      customer.id,
      { ...(dto.phone !== undefined ? { phone: dto.phone } : {}), ...(birthDate ? { birthDate: birthDate.toISOString() } : {}) },
      { id: actor.id, role: actor.role },
    );
    return this.get(id, actor);
  }

  private baseUrl(): string {
    const base = this.config.get<string>('SHARE_PAGE_BASE_URL') || this.config.get<string>('PAYMENT_LINK_BASE_URL') || 'https://bestchoicephone.app';
    return base.replace(/\/+$/, '');
  }

  private shareUrl(rawToken: string): string {
    return `${this.baseUrl()}/api/g/${rawToken}`;
  }

  private piiKey(): string {
    const key = this.config.get<string>('PII_ENCRYPTION_KEY');
    if (!key) throw new ServiceUnavailableException('ยังไม่ได้ตั้งค่า PII_ENCRYPTION_KEY');
    return key;
  }

  private modelLabel(product: { name: string | null; brand: string | null; model: string | null; storage: string | null } | null): string | null {
    if (!product) return null;
    const base = (product.name || `${product.brand ?? ''} ${product.model ?? ''}`).trim();
    if (!base) return null;
    return product.storage && !base.includes(product.storage) ? `${base} ${product.storage}` : base;
  }

  /** ค่า 7 ช่อง + จำนวนไฟล์ — ถอดรหัส PII ของลูกค้าผ่าน CustomerPiiService (ห้ามอ่านคอลัมน์ plaintext ตรง ๆ) */
  private async buildValues(app: LoadedApplication, staffName: string | null, link: string | null): Promise<PrecheckValues> {
    const customer = app.customer ? (this.pii.decryptCustomerFields(app.customer as Record<string, unknown>) as typeof app.customer) : null;
    return {
      customerName: customer?.name ?? null,
      occupation: app.occupationOverride ?? customer?.occupation ?? null,
      model: this.modelLabel(app.product),
      hand: app.product ? renderHand(app.product.category) : null,
      imei: app.product?.imeiSerial ?? null,
      phone: customer?.phone ?? null,
      age: computeAgeYears(customer?.birthDate ?? null),
      staffName,
      fileCount: app.files.length,
      link,
    };
  }

  private async staffName(actor: FinanceActor): Promise<string | null> {
    if (actor.name) return actor.name;
    const user = await this.prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } });
    return user?.name ?? null;
  }

  private renderText(app: { messageOverride: string | null; financeCompany?: { precheckTemplate: string | null } | null }, values: PrecheckValues): string {
    const linkLine = `เอกสารทั้งหมด ${values.fileCount} ไฟล์: ${values.link ?? '{{link}}'}`;
    if (app.messageOverride?.trim()) return `${app.messageOverride.trim()}\n${linkLine}`;
    // PR 2 (spec §4.2): แม่แบบของบริษัทที่ตั้งในหน้าตั้งค่า — ว่าง = แม่แบบในโค้ด §7
    return buildPrecheckMessage(app.financeCompany?.precheckTemplate?.trim() || DEFAULT_PRECHECK_TEMPLATE, values);
  }

  private readiness(app: LoadedApplication, values: PrecheckValues) {
    const missingFields = precheckMissingFields(values);
    const present = new Set(app.files.map((f) => f.slot));
    const missingRequiredSlots = REQUIRED_SLOTS.filter((slot) => !present.has(slot));
    const warnings: string[] = [];
    if (!present.has('DEVICE_SCREEN')) warnings.push('ยังไม่มีรูปหน้าจอตั้งค่าเครื่อง — ส่งได้ แต่ GFIN อาจขอเพิ่ม');
    if (!present.has('DEVICE_PHOTO')) warnings.push('ยังไม่มีรูปเครื่อง 6 มุม');
    if (app.product && !['IN_STOCK', 'RESERVED'].includes(app.product.status)) warnings.push('สถานะเครื่องเปลี่ยนไปจากตอนเลือก — ตรวจสต๊อกก่อนส่ง');
    const blockers = [
      ...(!app.customer ? ['ยังไม่ผูกลูกค้า'] : []),
      ...(!app.product ? ['ยังไม่เลือกเครื่อง'] : []),
      ...missingFields.map((f) => `ข้อมูลไม่ครบ: ${PRECHECK_FIELD_LABELS[f]}`),
      ...missingRequiredSlots.map((s) => `ยังไม่มีไฟล์ช่อง "${SLOT_LABELS[s]}"`),
    ];
    return { missingFields, missingRequiredSlots, warnings, blockers, canSend: blockers.length === 0 };
  }

  async preview(id: string, actor: FinanceActor): Promise<PreviewResult> {
    const app = await this.load(id, actor);
    const values = await this.buildValues(app, await this.staffName(actor), null);
    const r = this.readiness(app, values);
    return { text: this.renderText(app, values), values, missingFields: r.missingFields, missingRequiredSlots: r.missingRequiredSlots, warnings: r.warnings, canSend: r.canSend };
  }

  async send(id: string, dto: SendFinanceApplicationDto, actor: FinanceActor) {
    const app = await this.load(id, actor); // access() ก่อนเสมอ — กัน SALES ข้ามห้องโผล่ผ่านทาง via:'BOT' (review fix round 1)
    // PR 2: ตรวจกลุ่มปลายทางก่อนแตะอะไร — ไม่พร้อม = 400 ชี้ทางแก้ (ใบยัง DRAFT ไม่มีโทเคน)
    const target = dto.via === 'BOT' ? await this.lineGroup.requireSendTarget() : null;
    const values = await this.buildValues(app, await this.staffName(actor), null);
    const r = this.readiness(app, values);
    if (!r.canSend) throw new BadRequestException(`ยังส่งไม่ได้: ${r.blockers.join(' · ')}`);
    const nextStatus = applyTransition(app.status, 'SEND');
    const token = newShareToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SHARE_TTL_DAYS * DAY_MS);
    const shareUrl = this.shareUrl(token.raw);
    const messageText = this.renderText(app, { ...values, link: shareUrl });
    const summary = { customerName: values.customerName, occupation: values.occupation, model: values.model, hand: values.hand, imei: values.imei, phone: values.phone, age: values.age, fileCount: values.fileCount };
    const pushedRef: { value: { requestId: string | null } | null } = { value: null };
    try {
      const application = await this.prisma.$transaction(async (tx) => {
        // CAS บนสถานะที่อ่านมา (minor 9) — กดส่งซ้ำ/ยกเลิกพร้อมกันต้องได้ 409 ไม่ใช่ออกโทเคนทับกัน
        const cas = await tx.externalFinanceApplication.updateMany({
          where: { id: app.id, status: app.status, deletedAt: null },
          data: {
            status: nextStatus, sentAt: now, sentById: actor.id, sentVia: dto.via, messageText, summary,
            shareTokenHash: token.hash, shareTokenEnc: encryptPII(token.raw, this.piiKey()), shareExpiresAt: expiresAt, shareRevokedAt: null,
          },
        });
        if (cas.count === 0) throw new ConflictException(STALE_STATUS_MSG);
        await tx.externalFinanceApplicationFile.updateMany({ where: { applicationId: app.id, deletedAt: null, sentAt: null }, data: { sentAt: now } });
        if (target) {
          // push ใน tx (spec §5.1 "push ล้มเหลว ไม่เปลี่ยนสถานะ"): LINE โยน → rollback ทั้งก้อน = สถานะ/โทเคน/ไฟล์ไม่ขยับ
          // row lock ค้างไม่เกิน timeout ของ LINE client (10s) — ปริมาณต่ำ (ไม่กี่ใบ/วัน) ยอมรับได้ · precedent: PaySolutions gateway+DB ใน $transaction
          pushedRef.value = await this.lineGroup.pushText(target.groupId, messageText);
          await tx.externalFinanceApplication.update({ where: { id: app.id }, data: { lineRequestId: pushedRef.value.requestId } });
        }
        await this.addEvent(tx, app.id, 'SENT', 'STAFF', {
          actorUserId: actor.id,
          meta: { via: dto.via, fileCount: values.fileCount, ...(pushedRef.value ? { lineRequestId: pushedRef.value.requestId, groupName: target?.groupName ?? null } : {}) },
        });
        return this.reloadView(tx, app.id);
      }, { timeout: 20_000 });
      return { application, messageText, shareUrl, pushed: !!pushedRef.value, groupName: target?.groupName ?? null };
    } catch (err) {
      if (pushedRef.value) {
        // push ถึง GFIN แล้วแต่ commit ล้ม — GFIN ถือลิงก์ที่ตอบ 410 · ต้องมีคนตามแก้ (Review Focus 6)
        Sentry.captureMessage('[gfin] LINE push succeeded but the send transaction failed — partner holds a link that now resolves to 410', {
          level: 'error', tags: { subsystem: 'gfin' }, extra: { applicationId: app.id, requestId: pushedRef.value.requestId },
        });
      }
      throw err;
    }
  }

  async getShareLink(id: string, actor: FinanceActor) {
    const app = await this.load(id, actor);
    if (!app.shareTokenEnc) throw new NotFoundException('ใบยื่นนี้ยังไม่ได้ส่ง จึงยังไม่มีลิงก์');
    return { url: this.shareUrl(decryptPII(app.shareTokenEnc, this.piiKey())), expiresAt: app.shareExpiresAt, revokedAt: app.shareRevokedAt };
  }

  /**
   * ลิงก์ที่ถูกยกเลิกต้องตายถาวร (I2): ต่ออายุ/ส่งเพิ่มหลังยกเลิก = ออกโทเคนใหม่ (hash + ตัวเข้ารหัสใหม่)
   * ไม่ใช่ปลด `shareRevokedAt` ของโทเคนเดิม · แทนพาธลิงก์ใน `messageText` ที่ส่งไปแล้วด้วยของใหม่ ให้ปุ่ม
   * "คัดลอกข้อความอีกครั้ง" และข้อความบนหน้าลิงก์ได้ลิงก์ที่ใช้ได้จริง
   */
  private rotateShare(app: LoadedApplication) {
    const token = newShareToken();
    const oldRaw = app.shareTokenEnc ? decryptPII(app.shareTokenEnc, this.piiKey()) : null;
    const messageText = app.messageText && oldRaw
      ? app.messageText.split(`/api/g/${oldRaw}`).join(`/api/g/${token.raw}`)
      : app.messageText;
    return {
      url: this.shareUrl(token.raw),
      data: { shareTokenHash: token.hash, shareTokenEnc: encryptPII(token.raw, this.piiKey()), shareRevokedAt: null, messageText },
    };
  }

  /** ส่งเพิ่มเฉพาะไฟล์ที่ยังไม่เคยส่ง — ลิงก์เดิม ต่ออายุ 7 วัน (spec §5.1) · ลิงก์ถูกยกเลิกไว้ = ออกลิงก์ใหม่ (I2) · PR 2: via BOT = push ข้อความสั้นเข้ากลุ่ม */
  async resend(id: string, dto: ResendFinanceApplicationDto, actor: FinanceActor) {
    const app = await this.load(id, actor);
    const via = dto.via ?? 'COPY';
    const target = via === 'BOT' ? await this.lineGroup.requireSendTarget() : null;
    const nextStatus = applyTransition(app.status, 'RESEND');
    const pending = app.files.filter((f) => !f.sentAt);
    if (!pending.length) throw new BadRequestException('ไม่มีไฟล์ใหม่ให้ส่งเพิ่ม');
    if (!app.shareTokenEnc) throw new NotFoundException('ใบยื่นนี้ยังไม่ได้ส่ง จึงยังไม่มีลิงก์');
    const rotation = app.shareRevokedAt ? this.rotateShare(app) : null;
    const url = rotation?.url ?? this.shareUrl(decryptPII(app.shareTokenEnc, this.piiKey()));
    const now = new Date();
    const messageText = rotation
      ? `ส่งเอกสารเพิ่ม ${pending.length} ไฟล์ (ใบยื่น ${app.number}) ลิงก์ใหม่ (ลิงก์เดิมถูกยกเลิกแล้ว): ${url}`
      : `ส่งเอกสารเพิ่ม ${pending.length} ไฟล์ (ใบยื่น ${app.number}) ลิงก์เดิม: ${url}`;
    const pushedRef: { value: { requestId: string | null } | null } = { value: null };
    try {
      const application = await this.prisma.$transaction(async (tx) => {
        const cas = await tx.externalFinanceApplication.updateMany({
          where: { id: app.id, status: app.status, shareTokenHash: app.shareTokenHash, deletedAt: null },
          data: { status: nextStatus, shareExpiresAt: new Date(now.getTime() + SHARE_TTL_DAYS * DAY_MS), ...(rotation?.data ?? {}) },
        });
        if (cas.count === 0) throw new ConflictException(STALE_STATUS_MSG);
        await tx.externalFinanceApplicationFile.updateMany({ where: { applicationId: app.id, deletedAt: null, sentAt: null }, data: { sentAt: now } });
        if (target) {
          pushedRef.value = await this.lineGroup.pushText(target.groupId, messageText);
          await tx.externalFinanceApplication.update({ where: { id: app.id }, data: { lineRequestId: pushedRef.value.requestId } });
        }
        await this.addEvent(tx, app.id, 'RESENT', 'STAFF', {
          actorUserId: actor.id,
          meta: { via, fileCount: pending.length, ...(rotation ? { rotated: true } : {}), ...(pushedRef.value ? { lineRequestId: pushedRef.value.requestId, groupName: target?.groupName ?? null } : {}) },
        });
        return this.reloadView(tx, app.id);
      }, { timeout: 20_000 });
      return { application, messageText, shareUrl: url, rotated: !!rotation, pushed: !!pushedRef.value, groupName: target?.groupName ?? null };
    } catch (err) {
      if (pushedRef.value) {
        Sentry.captureMessage('[gfin] LINE push succeeded but the resend transaction failed', { level: 'error', tags: { subsystem: 'gfin' }, extra: { applicationId: app.id, requestId: pushedRef.value.requestId } });
      }
      throw err;
    }
  }

  /** ต่ออายุ 7 วัน — เฉพาะใบที่ยังเปิด (ใบยกเลิก/ปิดแล้วห้ามเปิดลิงก์กลับ) · ลิงก์ถูกยกเลิกไว้ = ออกลิงก์ใหม่ (I2) */
  async extendShare(id: string, actor: FinanceActor) {
    const app = await this.load(id, actor);
    if (!app.shareTokenHash || !app.shareTokenEnc) throw new NotFoundException('ยังไม่มีลิงก์');
    if (isClosed(app.status)) throw new ConflictException('ใบยื่นปิดแล้ว ต่ออายุลิงก์ไม่ได้ — ถ้าต้องยื่นอีกครั้ง กด "เริ่มใบยื่นใหม่"');
    const expiresAt = new Date(Date.now() + SHARE_TTL_DAYS * DAY_MS);
    const rotation = app.shareRevokedAt ? this.rotateShare(app) : null;
    await this.prisma.$transaction(async (tx) => {
      const cas = await tx.externalFinanceApplication.updateMany({
        where: { id: app.id, shareTokenHash: app.shareTokenHash, deletedAt: null, status: { in: [...OPEN_STATUSES] } },
        data: { shareExpiresAt: expiresAt, ...(rotation?.data ?? {}) },
      });
      if (cas.count === 0) throw new ConflictException(STALE_STATUS_MSG);
      await this.addEvent(tx, app.id, 'LINK_EXTENDED', 'STAFF', { actorUserId: actor.id, meta: { expiresAt: expiresAt.toISOString(), ...(rotation ? { rotated: true } : {}) } });
    });
    const url = rotation?.url ?? this.shareUrl(decryptPII(app.shareTokenEnc, this.piiKey()));
    return { expiresAt, url, rotated: !!rotation };
  }

  async revokeShare(id: string, actor: FinanceActor) {
    const app = await this.load(id, actor);
    if (!app.shareTokenHash) throw new NotFoundException('ยังไม่มีลิงก์');
    await this.prisma.$transaction(async (tx) => {
      await tx.externalFinanceApplication.update({ where: { id: app.id }, data: { shareRevokedAt: new Date() } });
      await this.addEvent(tx, app.id, 'LINK_REVOKED', 'STAFF', { actorUserId: actor.id });
    });
    return { success: true };
  }

  async staffResult(id: string, dto: StaffResultDto, actor: FinanceActor) {
    const app = await this.load(id, actor);
    const event = dto.result === 'APPROVED' ? 'STAFF_APPROVED' : dto.result === 'REJECTED' ? 'STAFF_REJECTED' : 'STAFF_MORE_INFO';
    const nextStatus = applyTransition(app.status, event);
    const closes = nextStatus === 'APPROVED' || nextStatus === 'REJECTED';
    return this.prisma.$transaction(async (tx) => {
      const cas = await tx.externalFinanceApplication.updateMany({
        where: { id: app.id, status: app.status, deletedAt: null },
        data: { status: nextStatus, resultSource: 'STAFF', closedAt: closes ? new Date() : null },
      });
      if (cas.count === 0) throw new ConflictException(STALE_STATUS_MSG);
      await this.addEvent(tx, app.id, 'STAFF_RESULT', 'STAFF', { actorUserId: actor.id, note: dto.note ?? null, meta: { result: dto.result } });
      return this.reloadView(tx, app.id);
    });
  }

  async cancel(id: string, actor: FinanceActor) {
    const app = await this.load(id, actor);
    const nextStatus = applyTransition(app.status, 'CANCEL');
    return this.prisma.$transaction(async (tx) => {
      const cas = await tx.externalFinanceApplication.updateMany({
        where: { id: app.id, status: app.status, deletedAt: null },
        data: { status: nextStatus, closedAt: new Date(), shareRevokedAt: app.shareTokenHash ? new Date() : null },
      });
      if (cas.count === 0) throw new ConflictException(STALE_STATUS_MSG);
      await this.addEvent(tx, app.id, 'CANCELLED', 'STAFF', { actorUserId: actor.id });
      return this.reloadView(tx, app.id);
    });
  }
}
