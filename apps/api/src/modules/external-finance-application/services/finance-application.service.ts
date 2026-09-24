import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, NotImplementedException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExternalFinanceActorType, ExternalFinanceDocSlot, ExternalFinanceEventKind, Prisma } from '@prisma/client';
import {
  DEFAULT_PRECHECK_TEMPLATE, buildPrecheckMessage, precheckMissingFields, computeAgeYears, renderHand,
  PRECHECK_FIELD_LABELS, type PrecheckField, type PrecheckValues,
} from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { hashLockKey } from '../../../utils/advisory-lock.util';
import { encryptPII, decryptPII } from '../../../utils/crypto.util';
import { CustomerPiiService } from '../../customers/customer-pii.service';
import { FinanceApplicationNumberService } from './finance-application-number.service';
import { FinanceActor, GFIN_COMPANY_NAME, REQUIRED_SLOTS, SHARE_TTL_DAYS, SLOT_LABELS } from '../constants';
import { applyTransition, isClosed } from '../finance-application-status.util';
import { SendFinanceApplicationDto, StaffResultDto, UpdateFinanceApplicationDto } from '../dto/finance-application.dto';
import { newShareToken } from '../finance-share-token.util';

const OPEN_STATUSES = ['DRAFT', 'SENT', 'ACKNOWLEDGED', 'MORE_INFO'] as const;
const EDITABLE_STATUSES = ['DRAFT', 'MORE_INFO'] as const;

export const applicationInclude = {
  files: { where: { deletedAt: null }, orderBy: [{ slot: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] },
  events: { orderBy: { createdAt: 'asc' } },
  // phone ถอดผ่าน CustomerPiiService.decryptCustomerFields (ต้องมี phoneEncrypted ให้มันอ่าน) —
  // name/occupation/birthDate เป็น plaintext ในสคีมานี้ (ไม่มีคอลัมน์ nameEncrypted/occupationEncrypted)
  customer: { select: { id: true, name: true, phone: true, phoneEncrypted: true, occupation: true, birthDate: true } },
  product: { select: { id: true, name: true, brand: true, model: true, storage: true, imeiSerial: true, serialNumber: true, category: true, batteryHealth: true, hasBox: true, accessoriesIncluded: true, status: true } },
  sentBy: { select: { id: true, name: true } },
} satisfies Prisma.ExternalFinanceApplicationInclude;

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
  constructor(
    private prisma: PrismaService,
    private numbers: FinanceApplicationNumberService,
    private pii: CustomerPiiService,
    private config: ConfigService,
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

  async createDraft(roomId: string, actor: FinanceActor) {
    const room = await this.access(this.prisma, roomId, actor);
    return this.prisma.$transaction(async (tx) => {
      // ล็อกระดับห้องก่อนเช็คใบเปิด — กัน createDraft พร้อมกันสองคำขอสร้างซ้ำ (finding รอบ 1)
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${hashLockKey(`finance-app-room:${roomId}`)})`);
      const open = await tx.externalFinanceApplication.findFirst({
        where: { roomId, deletedAt: null, status: { in: [...OPEN_STATUSES] } },
        include: applicationInclude,
      });
      if (open) return open;
      const number = await this.numbers.next(tx);
      const app = await tx.externalFinanceApplication.create({
        data: {
          number, roomId, status: 'DRAFT', createdById: actor.id, branchId: actor.branchId ?? null,
          customerId: room.customerId ?? null, financeCompanyId: await this.gfinCompanyId(tx),
        },
        include: applicationInclude,
      });
      await this.addEvent(tx, app.id, 'CREATED', 'STAFF', { actorUserId: actor.id });
      return app;
    });
  }

  /** ใบเปิดของห้อง + ประวัติ: ห้องผูกลูกค้า → ทุกใบของลูกค้า (ทุกห้อง) ไม่งั้นเฉพาะห้องนี้ (spec §5.1) */
  async listForRoom(roomId: string, actor: FinanceActor) {
    const room = await this.access(this.prisma, roomId, actor);
    const where: Prisma.ExternalFinanceApplicationWhereInput = room.customerId
      ? { deletedAt: null, OR: [{ roomId }, { customerId: room.customerId }] }
      : { deletedAt: null, roomId };
    const rows = await this.prisma.externalFinanceApplication.findMany({
      where, include: applicationInclude, orderBy: { createdAt: 'desc' },
    });
    const current = rows.find((r) => r.roomId === roomId && !isClosed(r.status)) ?? null;
    return { current, history: rows.filter((r) => r.id !== current?.id) };
  }

  async get(id: string, actor: FinanceActor) {
    const app = await this.prisma.externalFinanceApplication.findFirst({
      where: { id, deletedAt: null }, include: { ...applicationInclude, room: true },
    });
    if (!app) throw new NotFoundException('ไม่พบใบยื่น');
    await this.access(this.prisma, app.roomId, actor);
    return app;
  }

  async update(id: string, dto: UpdateFinanceApplicationDto, actor: FinanceActor) {
    const app = await this.get(id, actor);
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
    return this.prisma.externalFinanceApplication.update({
      where: { id },
      data: {
        ...(dto.productId !== undefined ? { productId: dto.productId } : {}),
        ...(dto.customerId !== undefined ? { customerId: dto.customerId } : {}),
        ...(dto.occupationOverride !== undefined ? { occupationOverride: dto.occupationOverride || null } : {}),
        ...(dto.messageOverride !== undefined ? { messageOverride: dto.messageOverride || null } : {}),
      },
      include: applicationInclude,
    });
  }

  private baseUrl(): string {
    const base = this.config.get<string>('SHARE_PAGE_BASE_URL') || this.config.get<string>('PAYMENT_LINK_BASE_URL') || 'https://bestchoicephone.app';
    return base.replace(/\/+$/, '');
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
  private async buildValues(app: Awaited<ReturnType<FinanceApplicationService['get']>>, staffName: string | null, link: string | null): Promise<PrecheckValues> {
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

  private renderText(app: { messageOverride: string | null }, values: PrecheckValues): string {
    const linkLine = `เอกสารทั้งหมด ${values.fileCount} ไฟล์: ${values.link ?? '{{link}}'}`;
    if (app.messageOverride?.trim()) return `${app.messageOverride.trim()}\n${linkLine}`;
    return buildPrecheckMessage(DEFAULT_PRECHECK_TEMPLATE, values);
  }

  private readiness(app: Awaited<ReturnType<FinanceApplicationService['get']>>, values: PrecheckValues) {
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
    const app = await this.get(id, actor);
    const values = await this.buildValues(app, await this.staffName(actor), null);
    const r = this.readiness(app, values);
    return { text: this.renderText(app, values), values, missingFields: r.missingFields, missingRequiredSlots: r.missingRequiredSlots, warnings: r.warnings, canSend: r.canSend };
  }

  async send(id: string, dto: SendFinanceApplicationDto, actor: FinanceActor) {
    if (dto.via === 'BOT') throw new NotImplementedException('ส่งด้วยบอทจะเปิดใน PR 2 — ใช้ "คัดลอกข้อความ + ลิงก์" ไปก่อน');
    const app = await this.get(id, actor);
    const values = await this.buildValues(app, await this.staffName(actor), null);
    const r = this.readiness(app, values);
    if (!r.canSend) throw new BadRequestException(`ยังส่งไม่ได้: ${r.blockers.join(' · ')}`);
    const nextStatus = applyTransition(app.status, 'SEND');
    const token = newShareToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SHARE_TTL_DAYS * 86400000);
    const shareUrl = `${this.baseUrl()}/api/g/${token.raw}`;
    const messageText = this.renderText(app, { ...values, link: shareUrl });
    const summary = { customerName: values.customerName, occupation: values.occupation, model: values.model, hand: values.hand, imei: values.imei, phone: values.phone, age: values.age, fileCount: values.fileCount };
    const application = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.externalFinanceApplication.update({
        where: { id: app.id },
        data: {
          status: nextStatus, sentAt: now, sentById: actor.id, sentVia: dto.via, messageText, summary,
          shareTokenHash: token.hash, shareTokenEnc: encryptPII(token.raw, this.piiKey()), shareExpiresAt: expiresAt, shareRevokedAt: null,
        },
        include: applicationInclude,
      });
      await tx.externalFinanceApplicationFile.updateMany({ where: { applicationId: app.id, deletedAt: null, sentAt: null }, data: { sentAt: now } });
      await this.addEvent(tx, app.id, 'SENT', 'STAFF', { actorUserId: actor.id, meta: { via: dto.via, fileCount: values.fileCount } });
      return updated;
    });
    return { application, messageText, shareUrl };
  }

  async getShareLink(id: string, actor: FinanceActor) {
    const app = await this.get(id, actor);
    if (!app.shareTokenEnc) throw new NotFoundException('ใบยื่นนี้ยังไม่ได้ส่ง จึงยังไม่มีลิงก์');
    return { url: `${this.baseUrl()}/api/g/${decryptPII(app.shareTokenEnc, this.piiKey())}`, expiresAt: app.shareExpiresAt, revokedAt: app.shareRevokedAt };
  }

  /** ส่งเพิ่มเฉพาะไฟล์ที่ยังไม่เคยส่ง — ลิงก์เดิม ต่ออายุเป็น 7 วันนับจากวันนี้ (spec §5.1) */
  async resend(id: string, actor: FinanceActor) {
    const app = await this.get(id, actor);
    const nextStatus = applyTransition(app.status, 'RESEND');
    const pending = app.files.filter((f) => !f.sentAt);
    if (!pending.length) throw new BadRequestException('ไม่มีไฟล์ใหม่ให้ส่งเพิ่ม');
    const { url } = await this.getShareLink(id, actor);
    const now = new Date();
    const messageText = `ส่งเอกสารเพิ่ม ${pending.length} ไฟล์ (ใบยื่น ${app.number}) ลิงก์เดิม: ${url}`;
    const application = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.externalFinanceApplication.update({
        where: { id: app.id },
        data: { status: nextStatus, shareExpiresAt: new Date(now.getTime() + SHARE_TTL_DAYS * 86400000), shareRevokedAt: null },
        include: applicationInclude,
      });
      await tx.externalFinanceApplicationFile.updateMany({ where: { applicationId: app.id, deletedAt: null, sentAt: null }, data: { sentAt: now } });
      await this.addEvent(tx, app.id, 'RESENT', 'STAFF', { actorUserId: actor.id, meta: { fileCount: pending.length } });
      return updated;
    });
    return { application, messageText, shareUrl: url };
  }

  async extendShare(id: string, actor: FinanceActor) {
    const app = await this.get(id, actor);
    if (!app.shareTokenHash) throw new NotFoundException('ยังไม่มีลิงก์');
    const expiresAt = new Date(Date.now() + SHARE_TTL_DAYS * 86400000);
    await this.prisma.$transaction(async (tx) => {
      await tx.externalFinanceApplication.update({ where: { id: app.id }, data: { shareExpiresAt: expiresAt, shareRevokedAt: null } });
      await this.addEvent(tx, app.id, 'LINK_EXTENDED', 'STAFF', { actorUserId: actor.id, meta: { expiresAt: expiresAt.toISOString() } });
    });
    return { expiresAt };
  }

  async revokeShare(id: string, actor: FinanceActor) {
    const app = await this.get(id, actor);
    if (!app.shareTokenHash) throw new NotFoundException('ยังไม่มีลิงก์');
    await this.prisma.$transaction(async (tx) => {
      await tx.externalFinanceApplication.update({ where: { id: app.id }, data: { shareRevokedAt: new Date() } });
      await this.addEvent(tx, app.id, 'LINK_REVOKED', 'STAFF', { actorUserId: actor.id });
    });
    return { success: true };
  }

  async staffResult(id: string, dto: StaffResultDto, actor: FinanceActor) {
    const app = await this.get(id, actor);
    const event = dto.result === 'APPROVED' ? 'STAFF_APPROVED' : dto.result === 'REJECTED' ? 'STAFF_REJECTED' : 'STAFF_MORE_INFO';
    const nextStatus = applyTransition(app.status, event);
    const closes = nextStatus === 'APPROVED' || nextStatus === 'REJECTED';
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.externalFinanceApplication.update({
        where: { id: app.id },
        data: { status: nextStatus, resultSource: 'STAFF', closedAt: closes ? new Date() : null },
        include: applicationInclude,
      });
      await this.addEvent(tx, app.id, 'STAFF_RESULT', 'STAFF', { actorUserId: actor.id, note: dto.note ?? null, meta: { result: dto.result } });
      return updated;
    });
  }

  async cancel(id: string, actor: FinanceActor) {
    const app = await this.get(id, actor);
    const nextStatus = applyTransition(app.status, 'CANCEL');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.externalFinanceApplication.update({
        where: { id: app.id },
        data: { status: nextStatus, closedAt: new Date(), shareRevokedAt: app.shareTokenHash ? new Date() : null },
        include: applicationInclude,
      });
      await this.addEvent(tx, app.id, 'CANCELLED', 'STAFF', { actorUserId: actor.id });
      return updated;
    });
  }
}
