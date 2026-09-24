import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import archiver from 'archiver';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { hashShareToken } from '../finance-share-token.util';
import { applyTransition, isClosed } from '../finance-application-status.util';
import { SLOT_LABELS, SLOT_ORDER } from '../constants';
import { FinanceShareReplyDto } from '../dto/finance-share-reply.dto';
import { FinanceApplicationNotifyService } from './finance-application-notify.service';
import type { SharePageGroup } from './finance-share-page.util';

const GONE_MSG = 'ไม่พบเอกสาร หรือลิงก์หมดอายุแล้ว';
const VIEW_DEDUPE_MS = 5 * 60 * 1000;
const EXT_BY_MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf' };

const shareInclude = { files: { where: { deletedAt: null }, orderBy: [{ slot: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] } } satisfies Prisma.ExternalFinanceApplicationInclude;
export type ShareApp = Prisma.ExternalFinanceApplicationGetPayload<{ include: typeof shareInclude }>;
export type ShareResolution = { state: 'OK'; app: ShareApp } | { state: 'GONE'; reason: 'NOT_FOUND' | 'EXPIRED' | 'REVOKED' | 'PURGED' };

@Injectable()
export class FinanceShareService {
  private readonly logger = new Logger(FinanceShareService.name);
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private notify: FinanceApplicationNotifyService,
  ) {}

  async resolve(rawToken: string): Promise<ShareResolution> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return { state: 'GONE', reason: 'NOT_FOUND' };
    const app = await this.prisma.externalFinanceApplication.findFirst({
      where: { shareTokenHash: hashShareToken(rawToken), deletedAt: null }, include: shareInclude,
    });
    if (!app) return { state: 'GONE', reason: 'NOT_FOUND' };
    if (app.shareRevokedAt) return { state: 'GONE', reason: 'REVOKED' };
    if (app.filesPurgedAt) return { state: 'GONE', reason: 'PURGED' };
    if (!app.shareExpiresAt || app.shareExpiresAt < new Date()) return { state: 'GONE', reason: 'EXPIRED' };
    return { state: 'OK', app };
  }

  private async resolveOrThrow(rawToken: string): Promise<ShareApp> {
    const r = await this.resolve(rawToken);
    if (r.state !== 'OK') throw new NotFoundException(GONE_MSG);
    return r.app;
  }

  /** จัดกลุ่มไฟล์ตามช่อง (ลำดับ SLOT_ORDER) — ใช้ทั้งหน้า HTML และ zip */
  groups(app: ShareApp, urlFor: (fileId: string) => string): SharePageGroup[] {
    return SLOT_ORDER.map((slot) => ({
      slot, label: SLOT_LABELS[slot],
      files: app.files.filter((f) => f.slot === slot && f.storageKey).map((f) => ({ id: f.id, mimeType: f.mimeType, size: f.size, originalName: f.originalName, url: urlFor(f.id) })),
    }));
  }

  async recordView(appId: string, ipHash: string, userAgent: string | undefined) {
    const recent = await this.prisma.externalFinanceApplicationEvent.findFirst({
      where: { applicationId: appId, kind: 'LINK_VIEWED', createdAt: { gte: new Date(Date.now() - VIEW_DEDUPE_MS) }, meta: { path: ['ipHash'], equals: ipHash } },
      select: { id: true },
    });
    if (recent) return;
    await this.prisma.externalFinanceApplicationEvent.create({ data: { applicationId: appId, kind: 'LINK_VIEWED', actorType: 'PARTNER', meta: { ipHash, userAgent: (userAgent ?? '').slice(0, 200) } } });
    await this.prisma.externalFinanceApplication.update({ where: { id: appId }, data: { shareViewCount: { increment: 1 }, shareLastViewedAt: new Date(), lastPartnerEventAt: new Date() } });
  }

  async fileStream(rawToken: string, fileId: string) {
    const app = await this.resolveOrThrow(rawToken);
    const file = app.files.find((f) => f.id === fileId && f.storageKey);
    if (!file?.storageKey) throw new NotFoundException(GONE_MSG);
    return { file, stream: await this.storage.getStream(file.storageKey), appId: app.id };
  }

  /** รายการ entry ของ zip แยกออกมาให้เทสต์ได้โดยไม่ต้องอ่าน storage */
  async zipStream(rawToken: string) {
    const app = await this.resolveOrThrow(rawToken);
    const entries: { name: string; storageKey: string }[] = [];
    let n = 0;
    for (const group of this.groups(app, () => '')) {
      group.files.forEach((f, i) => {
        const original = app.files.find((x) => x.id === f.id)!;
        const ext = EXT_BY_MIME[f.mimeType] ?? 'bin';
        n += 1;
        // spec §5.2: ชื่อแบน `01-ลูกค้าถือบัตร.jpg` … ช่องที่มีหลายไฟล์ต่อท้าย -1, -2 (ป้ายช่องตัด "/" และ "(ถ้ามี)" ออก)
        const label = group.label.replace(/\s*\(ถ้ามี\)/, '').replace(/[\\/:*?"<>|]/g, '-');
        const suffix = group.files.length > 1 ? `-${i + 1}` : '';
        entries.push({ name: `${String(n).padStart(2, '0')}-${label}${suffix}.${ext}`, storageKey: original.storageKey! });
      });
    }
    const archive = archiver('zip', { zlib: { level: 6 } });
    const load = async () => {
      for (const entry of entries) archive.append(await this.storage.getStream(entry.storageKey), { name: entry.name });
      await archive.finalize();
    };
    return { filename: `${app.number}.zip`, archive, entries, load, appId: app.id };
  }

  async reply(rawToken: string, dto: FinanceShareReplyDto, ipHash: string) {
    const app = await this.resolveOrThrow(rawToken);
    if (isClosed(app.status)) throw new ConflictException('ใบยื่นนี้ปิดแล้ว ร้านไม่รับผลเพิ่ม — ติดต่อร้านในกลุ่มไลน์');
    const event = ({ ACK: 'PARTNER_ACK', MORE_INFO: 'PARTNER_MORE_INFO', APPROVED: 'PARTNER_APPROVED', REJECTED: 'PARTNER_REJECTED' } as const)[dto.action];
    // "รับเรื่องแล้ว" ซ้ำบนใบที่รับแล้ว = จดเหตุการณ์อย่างเดียว ไม่ 409 (กดซ้ำจากมือถือเป็นเรื่องปกติ)
    const nextStatus = event === 'PARTNER_ACK' && app.status === 'ACKNOWLEDGED' ? app.status : applyTransition(app.status, event);
    const closes = nextStatus === 'APPROVED' || nextStatus === 'REJECTED';
    await this.prisma.$transaction(async (tx) => {
      // TOCTOU fix (fix round 1 Important 3): `app.status` was read outside this transaction —
      // a concurrent STAFF_* result, CANCEL, or a second partner reply could have changed the
      // row's status in between. CAS on (id, status) so a stale write never silently overwrites
      // whatever the concurrent writer landed (e.g. CANCELLED → APPROVED).
      const updated = await tx.externalFinanceApplication.updateMany({
        where: { id: app.id, status: app.status, deletedAt: null },
        data: { status: nextStatus, ...(closes || nextStatus === 'MORE_INFO' ? { resultSource: 'PARTNER_LINK' } : {}), lastPartnerEventAt: new Date(), closedAt: closes ? new Date() : null },
      });
      if (updated.count === 0) throw new ConflictException('ใบยื่นเปลี่ยนสถานะไปแล้ว กรุณาโหลดหน้าใหม่');
      await tx.externalFinanceApplicationEvent.create({ data: { applicationId: app.id, kind: event, actorType: 'PARTNER', actorName: dto.name.trim().slice(0, 80), note: dto.note?.trim() || null, meta: { ipHash } } });
    });
    try { await this.notify.partnerReplied(app.id); } catch (err) { this.logger.warn(`notify partnerReplied failed app=${app.id}: ${(err as Error).message}`); }
    return { status: nextStatus };
  }
}
