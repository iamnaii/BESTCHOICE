import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Prisma, ShopPettyCashMovementKind } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { ShopPettyCashTemplate } from '../journal/cpa-templates/shop-petty-cash.template';
import { isBankSupplierPaymentAccount } from '../journal/supplier-payment-accounts';
import { isPeriodClosedForBackdating } from '../purchase-orders/services/supplier-doc.util';
import { parsePaidAt } from '../purchase-orders/services/supplier-payment.util';
import { validatePeriodOpen } from '../../utils/period-lock.util';
import { bangkokCalendarParts } from '../../utils/date.util';
import { formatDateShort, formatMonthName } from '../../utils/thai-date.util';
import { EVIDENCE_IMAGE_MAX_BYTES, evidenceImageExtension, isEvidenceImage } from '../../utils/upload-image.util';
import {
  SHOP_PETTY_CASH_ACCOUNT,
  SHOP_PETTY_CASH_AUDIT,
  SHOP_PETTY_CASH_BANKS,
  SHOP_PETTY_CASH_DEFAULT_BANK,
  SHOP_PETTY_CASH_EVIDENCE_PREFIX,
  SHOP_PETTY_CASH_LIMIT_KEY,
  SHOP_PETTY_CASH_MAX_LIMIT,
  SHOP_PETTY_CASH_PERIOD_TODO_TAG,
  shopPettyCashBankLabel,
} from './shop-petty-cash.constants';
import type {
  ShopPettyCashLimitView,
  ShopPettyCashMovementView,
  ShopPettyCashMovementsPage,
  ShopPettyCashRecordResult,
  ShopPettyCashRow,
  ShopPettyCashSummary,
} from './shop-petty-cash.types';
import { classifyPettyCashLine, computeHeadroom, resolveLimit, thaiMonthRange, withRunningBalance, type PettyCashLedgerLine } from './shop-petty-cash.util';

export interface RecordShopPettyCashInput {
  amount: number;
  /** S11-1202 / S11-1201 — ไม่ส่ง = ค่าเริ่มต้นตามชนิด (เติม: จ่ายออก · คืน: รับเข้า) */
  bankAccountCode?: string;
  /** YYYY-MM-DD วันที่ถอน/ฝาก (ปฏิทินไทย) */
  movedAt: string;
  note?: string;
  /** รหัสคำขอจากหน้าจอ — ส่งซ้ำได้รายการเดิม */
  requestId?: string;
}

export interface ShopPettyCashActor {
  id: string;
  role: string;
}

const ZERO = new Decimal(0);
const KIND_LABEL: Record<ShopPettyCashMovementKind, string> = { TOP_UP: 'เติมเงินสดย่อย', RETURN: 'คืนเงินสดย่อย' };
const LINE_SELECT = {
  id: true,
  debit: true,
  credit: true,
  createdAt: true,
  journalEntry: { select: { id: true, entryNumber: true, entryDate: true, description: true, metadata: true, createdById: true } },
} as const;

type LedgerLineRow = Prisma.JournalLineGetPayload<{ select: typeof LINE_SELECT }>;

/** 9,000.00 — ข้อความถึงผู้ใช้ (ตัวเลขในสตริงไม่ใช่ค่าที่โปรแกรมอ่านต่อ) */
const money = (value: Decimal): string =>
  Number(value.toFixed(2)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function toMoney(value: number, label = 'จำนวนเงิน'): Decimal {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new BadRequestException(`${label}ไม่ถูกต้อง`);
  const amount = new Decimal(value).toDecimalPlaces(2);
  if (!amount.gt(ZERO)) throw new BadRequestException(`${label}ต้องมากกว่า 0`);
  return amount;
}

/**
 * เงินสดย่อยหน้าร้าน S11-1106 — เติม / คืน / วงเงิน (ข้อ 20.2 · คำตอบฝ่ายบัญชี 16/10/2569 · เจ้าของเคาะ 18/10/2569 mockup Q9YhHKUhw7kkawVfcu6yZz).
 *
 * กติกา:
 *   - ยอดคงเหลือ = ยอดสุทธิ S11-1106 ในสมุด SHOP (query เดียวกับด่าน "เงินสดไม่พอ" ของเมนูจ่ายผู้จัดจำหน่าย) — ไม่ใช่ตาราง movements
 *   - เติม ≤ วงเงิน − คงเหลือ · คืน ≤ คงเหลือ · วงเงิน = SystemConfig `shop_petty_cash_limit` (ไม่มี = 20,000)
 *   - ธนาคารต้นทาง/ปลายทาง = S11-1202 / S11-1201 เท่านั้น · หลักฐานไม่บังคับ (20.3) เก็บเป็น key ใน StorageService
 *   - วันที่ ≤ วันนี้ ย้อนหลัง ≤ 365 วัน · งวดปิดแล้ว → ลงวันที่บันทึก + Todo แจ้งฝ่ายบัญชี (แบบจ่ายผู้จัดจำหน่าย)
 *   - advisory lock `shop-petty-cash` ใน tx — กดพร้อมกันสองคนต่อคิว ไม่เกินวงเงินทั้งคู่
 *   - requestId เดิม + ชนิด/ยอด/บัญชีเดิม = คืนรายการเดิม · ค่าต่าง = 409 · ไม่มี void (ผิดให้เติม/คืนกลับ)
 */
@Injectable()
export class ShopPettyCashService {
  private readonly logger = new Logger(ShopPettyCashService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly template: ShopPettyCashTemplate,
    private readonly companies: CompanyResolverService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────────── อ่าน ─────────────────────────────

  async getSummary(now: Date = new Date()): Promise<ShopPettyCashSummary> {
    const shopCompanyId = await this.companies.getShopCompanyId(this.prisma);
    const [balance, limit] = await Promise.all([this.balanceOf(this.prisma, shopCompanyId), this.limitOf(this.prisma)]);
    const range = thaiMonthRange(undefined, now);
    const [opening, lines] = await Promise.all([
      this.balanceOf(this.prisma, shopCompanyId, { lt: range.start }),
      this.linesIn(this.prisma, shopCompanyId, range.start, range.end),
    ]);
    const totals = { topUps: bucket(), returns: bucket(), supplierPayments: bucket(), other: bucket() };
    let net = ZERO;
    for (const line of lines) {
      const cls = classifyPettyCashLine(toLedgerLine(line));
      const delta = new Decimal(line.debit.toString()).sub(line.credit.toString());
      net = net.add(delta);
      const target =
        cls.kind === 'TOP_UP' ? totals.topUps
        : cls.kind === 'RETURN' ? totals.returns
        : cls.kind === 'SUPPLIER_PAYMENT' || cls.kind === 'SUPPLIER_PAYMENT_REVERSAL' ? totals.supplierPayments
        : totals.other;
      target.amount = target.amount.add(delta.abs());
      target.count += 1;
    }
    const { headroom, overLimit } = computeHeadroom(limit.value, balance);
    return {
      accountCode: SHOP_PETTY_CASH_ACCOUNT,
      balance: balance.toFixed(2),
      limit: { value: limit.value.toFixed(2), source: limit.source, updatedAt: limit.updatedAt?.toISOString() ?? null },
      headroom: headroom.toFixed(2),
      overLimit: overLimit.toFixed(2),
      month: {
        key: range.key,
        label: range.label,
        opening: opening.toFixed(2),
        closing: opening.add(net).toFixed(2),
        topUps: { amount: totals.topUps.amount.toFixed(2), count: totals.topUps.count },
        returns: { amount: totals.returns.amount.toFixed(2), count: totals.returns.count },
        supplierPayments: { amount: totals.supplierPayments.amount.toFixed(2), count: totals.supplierPayments.count },
        other: { amount: totals.other.amount.toFixed(2), count: totals.other.count },
        net: net.toFixed(2),
      },
      banks: SHOP_PETTY_CASH_BANKS.map((b) => ({ ...b })),
      defaultBank: { ...SHOP_PETTY_CASH_DEFAULT_BANK },
      asOf: now.toISOString(),
    };
  }

  async listMovements(month?: string, now: Date = new Date()): Promise<ShopPettyCashMovementsPage> {
    const range = thaiMonthRange(month, now);
    const shopCompanyId = await this.companies.getShopCompanyId(this.prisma);
    const [opening, lines] = await Promise.all([
      this.balanceOf(this.prisma, shopCompanyId, { lt: range.start }),
      this.linesIn(this.prisma, shopCompanyId, range.start, range.end),
    ]);
    const classified = lines.map((line) => ({ line, cls: classifyPettyCashLine(toLedgerLine(line)) }));
    const movementIds = classified.map((c) => c.cls.movementId).filter((id): id is string => !!id);
    const movements = movementIds.length
      ? await this.prisma.shopPettyCashMovement.findMany({
          where: { id: { in: movementIds } },
          select: { id: true, note: true, evidenceKey: true, createdById: true },
        })
      : [];
    const movementById = new Map(movements.map((m) => [m.id, m]));
    const userIds = new Set<string>();
    for (const { line, cls } of classified) {
      const mv = cls.movementId ? movementById.get(cls.movementId) : null;
      const uid = mv?.createdById ?? line.journalEntry.createdById;
      if (uid) userIds.add(uid);
    }
    const names = await this.userNames([...userIds]);
    const ranked = withRunningBalance(
      opening,
      classified.map(({ line, cls }, index) => ({
        date: line.journalEntry.entryDate,
        seq: index,
        inAmount: new Decimal(line.debit.toString()),
        outAmount: new Decimal(line.credit.toString()),
        line,
        cls,
      })),
    );
    const rows: ShopPettyCashRow[] = ranked.rows.map(({ line, cls, inAmount, outAmount, balanceAfter }) => {
      const mv = cls.movementId ? movementById.get(cls.movementId) : null;
      const uid = mv?.createdById ?? line.journalEntry.createdById;
      return {
        id: line.id,
        journalEntryId: line.journalEntry.id,
        journalEntryNo: line.journalEntry.entryNumber,
        date: line.journalEntry.entryDate.toISOString(),
        kind: cls.kind,
        label: cls.label,
        bankAccountCode: cls.bankAccountCode,
        bankLabel: cls.bankAccountCode ? shopPettyCashBankLabel(cls.bankAccountCode) : null,
        po: cls.po,
        movementId: cls.movementId,
        hasEvidence: !!mv?.evidenceKey,
        note: mv?.note ?? null,
        inAmount: inAmount.toFixed(2),
        outAmount: outAmount.toFixed(2),
        balanceAfter: balanceAfter.toFixed(2),
        createdByName: uid ? (names.get(uid) ?? null) : null,
      };
    });
    return { month: { key: range.key, label: range.label }, opening: opening.toFixed(2), closing: ranked.closing.toFixed(2), rows };
  }

  async getEvidence(movementId: string) {
    const row = await this.prisma.shopPettyCashMovement.findFirst({ where: { id: movementId, deletedAt: null }, select: { evidenceKey: true } });
    if (!row) throw new NotFoundException('ไม่พบรายการเงินสดย่อย');
    if (!row.evidenceKey) throw new NotFoundException('รายการนี้ไม่มีรูปหลักฐาน');
    return { key: row.evidenceKey, stream: await this.storage.getStream(row.evidenceKey) };
  }

  // ───────────────────────────── เติม / คืน ─────────────────────────────

  async record(
    kind: ShopPettyCashMovementKind,
    input: RecordShopPettyCashInput,
    actor: ShopPettyCashActor,
    file?: Express.Multer.File,
    now: Date = new Date(),
  ): Promise<ShopPettyCashRecordResult> {
    const amount = toMoney(input.amount);
    const bankAccountCode = input.bankAccountCode?.trim() || SHOP_PETTY_CASH_DEFAULT_BANK[kind];
    if (!isBankSupplierPaymentAccount(bankAccountCode)) {
      throw new BadRequestException('บัญชีธนาคารไม่ถูกต้อง — เลือกได้เฉพาะธนาคารหน้าร้าน (จ่ายออก S11-1202 / รับเข้า S11-1201)');
    }
    const movedAt = parsePaidAt(input.movedAt, now);
    const note = input.note?.trim() || null;
    if (note && note.length > 500) throw new BadRequestException('หมายเหตุยาวเกิน 500 ตัวอักษร');
    const requestId = input.requestId?.trim() || null;
    if (file && (!isEvidenceImage(file) || file.size > EVIDENCE_IMAGE_MAX_BYTES)) {
      throw new BadRequestException('รองรับเฉพาะรูป JPEG, PNG หรือ WEBP ขนาดไม่เกิน 5MB');
    }

    // อัปโหลดก่อนเปิด tx (ไม่ถือคอนเนกชันระหว่างรอ storage) — tx ล้มแล้วลบทิ้ง ไม่ให้รูปค้าง
    let evidenceKey: string | null = null;
    if (file) {
      const { year, month, day } = bangkokCalendarParts(now);
      const yyyymmdd = `${year}${String(month + 1).padStart(2, '0')}${String(day).padStart(2, '0')}`;
      evidenceKey = `${SHOP_PETTY_CASH_EVIDENCE_PREFIX}/${yyyymmdd}/${randomUUID()}.${evidenceImageExtension(file.mimetype)}`;
      await this.storage.upload(evidenceKey, file.buffer, file.mimetype);
    }

    let outcome: { row: MovementRow; journalEntryNo: string | null; duplicate: boolean; periodClosed: boolean };
    try {
      outcome = await this.prisma.$transaction(
        async (tx) => {
          // ต่อคิวทุกการเติม/คืน — ยอดคงเหลือ/วงเงินอ่านหลังได้ล็อกเท่านั้น (กดพร้อมกันสองคนไม่เกินวงเงินทั้งคู่)
          // $executeRaw ไม่ใช่ $queryRaw — pg_advisory_xact_lock คืน void ที่ Prisma deserialize ไม่ได้ (แบบ customer-phone-lock)
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('shop-petty-cash'))`;
          const shopCompanyId = await this.companies.getShopCompanyId(tx);

          if (requestId) {
            const existing = await tx.shopPettyCashMovement.findFirst({ where: { requestId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
            if (existing) {
              if (existing.kind !== kind || !existing.amount.equals(amount) || existing.bankAccountCode !== bankAccountCode) {
                throw new ConflictException('คำขอนี้ถูกบันทึกไปแล้วด้วยยอดหรือบัญชีที่ต่างจากที่ส่งมา — รีเฟรชหน้าแล้วตรวจรายการก่อนบันทึกใหม่');
              }
              const je = existing.journalEntryId
                ? await tx.journalEntry.findUnique({ where: { id: existing.journalEntryId }, select: { entryNumber: true } })
                : null;
              return { row: existing, journalEntryNo: je?.entryNumber ?? null, duplicate: true, periodClosed: false };
            }
          }

          const balance = await this.balanceOf(tx, shopCompanyId);
          if (kind === 'TOP_UP') {
            const limit = await this.limitOf(tx);
            const { headroom } = computeHeadroom(limit.value, balance);
            if (amount.gt(headroom)) {
              throw new BadRequestException(
                `เติมได้อีกไม่เกิน ${money(headroom)} บาท (วงเงิน ${money(limit.value)} − คงเหลือ ${money(balance)}) — ` +
                  (headroom.lte(0) ? 'ยอดถึงวงเงินแล้ว ตั้งวงเงินใหม่หรือคืนเงินก่อน' : 'ลดยอดที่เติมหรือตั้งวงเงินใหม่ก่อน'),
              );
            }
          } else if (amount.gt(balance)) {
            throw new BadRequestException(`คืนได้ไม่เกินยอดคงเหลือ ${money(balance)} บาท — เงินสดย่อยติดลบไม่ได้`);
          }

          const { postedAt, periodClosed } = await this.resolvePostingDate(tx, movedAt, now, shopCompanyId);
          const row = await tx.shopPettyCashMovement.create({
            data: { kind, amount, bankAccountCode, movedAt, postedAt, note, evidenceKey, requestId, createdById: actor.id },
          });
          const je = await this.template.execute(
            { idempotencyKey: `petty-cash:${row.id}`, kind, movementId: row.id, amount, bankAccountCode, postedAt },
            tx,
          );
          const saved = await tx.shopPettyCashMovement.update({ where: { id: row.id }, data: { journalEntryId: je.journalEntryId } });
          return { row: saved, journalEntryNo: je.entryNo, duplicate: false, periodClosed };
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      if (evidenceKey) await this.storage.delete(evidenceKey).catch(() => undefined);
      throw error;
    }

    if (outcome.duplicate && evidenceKey) {
      // คำขอเดิม — รูปที่เพิ่งอัปโหลดไม่ได้ผูกกับรายการ ลบทิ้ง
      await this.storage.delete(evidenceKey).catch(() => undefined);
    }

    let accountingNotified = false;
    if (!outcome.duplicate) {
      await this.audit.log({
        userId: actor.id,
        action: SHOP_PETTY_CASH_AUDIT[kind],
        entity: 'ShopPettyCashMovement',
        entityId: outcome.row.id,
        newValue: {
          kind,
          amount: amount.toFixed(2),
          bankAccountCode,
          movedAt: movedAt.toISOString(),
          postedAt: outcome.row.postedAt.toISOString(),
          periodClosed: outcome.periodClosed,
          journalEntryNo: outcome.journalEntryNo,
          hasEvidence: !!evidenceKey,
          note,
        },
      });
      if (outcome.periodClosed) accountingNotified = await this.notifyPeriodClosed(outcome.row, outcome.journalEntryNo, actor.id);
    }

    return {
      movement: this.toView(outcome.row, outcome.journalEntryNo),
      periodClosed: outcome.periodClosed,
      accountingNotified,
      duplicate: outcome.duplicate,
      summary: await this.getSummary(now),
    };
  }

  // ───────────────────────────── วงเงิน ─────────────────────────────

  async setLimit(limit: number, actor: ShopPettyCashActor): Promise<ShopPettyCashLimitView> {
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0) throw new BadRequestException('วงเงินต้องเป็นตัวเลข 0 ขึ้นไป');
    const value = new Decimal(limit);
    if (!value.toDecimalPlaces(2).equals(value)) throw new BadRequestException('วงเงินใส่ทศนิยมได้ไม่เกิน 2 ตำแหน่ง');
    if (value.gt(SHOP_PETTY_CASH_MAX_LIMIT)) throw new BadRequestException(`วงเงินต้องไม่เกิน ${money(new Decimal(SHOP_PETTY_CASH_MAX_LIMIT))} บาท`);
    const before = await this.limitOf(this.prisma);
    const saved = await this.prisma.systemConfig.upsert({
      where: { key: SHOP_PETTY_CASH_LIMIT_KEY },
      create: { key: SHOP_PETTY_CASH_LIMIT_KEY, value: value.toFixed(2), label: 'วงเงินเงินสดย่อยหน้าร้าน (S11-1106)' },
      update: { value: value.toFixed(2), deletedAt: null },
    });
    await this.audit.log({
      userId: actor.id,
      action: SHOP_PETTY_CASH_AUDIT.LIMIT,
      entity: 'SystemConfig',
      entityId: saved.id,
      oldValue: { limit: before.value.toFixed(2), source: before.source },
      newValue: { limit: value.toFixed(2), source: 'SET' },
    });
    return { value: value.toFixed(2), source: 'SET', updatedAt: saved.updatedAt.toISOString() };
  }

  // ───────────────────────────── ภายใน ─────────────────────────────

  private async balanceOf(client: Prisma.TransactionClient | PrismaService, shopCompanyId: string, entryDate?: { lt: Date }): Promise<Decimal> {
    const agg = await client.journalLine.aggregate({
      where: {
        accountCode: SHOP_PETTY_CASH_ACCOUNT,
        deletedAt: null,
        journalEntry: { status: 'POSTED', deletedAt: null, companyId: shopCompanyId, ...(entryDate ? { entryDate } : {}) },
      },
      _sum: { debit: true, credit: true },
    });
    return new Decimal((agg._sum.debit ?? 0).toString()).sub((agg._sum.credit ?? 0).toString());
  }

  private async linesIn(client: Prisma.TransactionClient | PrismaService, shopCompanyId: string, start: Date, end: Date): Promise<LedgerLineRow[]> {
    return client.journalLine.findMany({
      where: {
        accountCode: SHOP_PETTY_CASH_ACCOUNT,
        deletedAt: null,
        journalEntry: { status: 'POSTED', deletedAt: null, companyId: shopCompanyId, entryDate: { gte: start, lt: end } },
      },
      select: LINE_SELECT,
      orderBy: [{ journalEntry: { entryDate: 'asc' } }, { createdAt: 'asc' }],
    });
  }

  private async limitOf(client: Prisma.TransactionClient | PrismaService): Promise<{ value: Decimal; source: 'DEFAULT' | 'SET'; updatedAt: Date | null }> {
    const row = await client.systemConfig.findFirst({ where: { key: SHOP_PETTY_CASH_LIMIT_KEY, deletedAt: null }, select: { value: true, updatedAt: true } });
    const resolved = resolveLimit(row?.value ?? null);
    return { ...resolved, updatedAt: resolved.source === 'SET' ? (row?.updatedAt ?? null) : null };
  }

  private async resolvePostingDate(tx: Prisma.TransactionClient, wanted: Date, now: Date, shopCompanyId: string) {
    const periodClosed = await isPeriodClosedForBackdating(tx, wanted, shopCompanyId);
    const postedAt = periodClosed ? now : wanted;
    await validatePeriodOpen(tx, postedAt, shopCompanyId);
    return { postedAt, periodClosed };
  }

  private async userNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  private async notifyPeriodClosed(row: MovementRow, journalEntryNo: string | null, userId: string): Promise<boolean> {
    try {
      const month = `${formatMonthName(row.movedAt)} ${bangkokCalendarParts(row.movedAt).year + 543}`;
      const verb = row.kind === 'TOP_UP' ? 'ถอน' : 'ฝาก';
      await this.prisma.todo.create({
        data: {
          title: `${KIND_LABEL[row.kind]} ${row.amount.toFixed(2)} บาท ลงบัญชีวันที่บันทึกแทนวันที่${verb} (งวด${month}ปิดแล้ว)`,
          description:
            `${KIND_LABEL[row.kind]} ${row.amount.toFixed(2)} บาท ${row.kind === 'TOP_UP' ? 'จาก' : 'เข้า'} ${shopPettyCashBankLabel(row.bankAccountCode)} ` +
            `วันที่${verb} ${formatDateShort(row.movedAt)} อยู่ในงวดบัญชีที่ปิดแล้ว — ระบบลงบัญชีด้วยวันที่บันทึก ${formatDateShort(row.postedAt)} แทน ` +
            `และเก็บวันที่${verb}ไว้ตามจริง · รายการบัญชี ${journalEntryNo ?? '-'}\n` +
            'ตรวจว่าต้องปรับปรุงรายการหรือไม่ — ระบบไม่ลงรายการปรับปรุงให้อัตโนมัติ',
          priority: 'MEDIUM',
          tags: [SHOP_PETTY_CASH_PERIOD_TODO_TAG, `petty-cash:${row.id}`],
          createdById: userId,
        },
      });
      return true;
    } catch (error) {
      this.logger.error(`สร้างงานแจ้งฝ่ายบัญชีไม่สำเร็จ (เงินสดย่อย ${row.id} งวดของวันที่เลือกปิดแล้ว)`, error instanceof Error ? error.stack : String(error));
      Sentry.captureException(error, { tags: { subsystem: 'shop-petty-cash-period' }, extra: { movementId: row.id } });
      return false;
    }
  }

  private toView(row: MovementRow, journalEntryNo: string | null): ShopPettyCashMovementView {
    return {
      id: row.id,
      kind: row.kind,
      amount: row.amount.toFixed(2),
      bankAccountCode: row.bankAccountCode,
      bankLabel: shopPettyCashBankLabel(row.bankAccountCode),
      movedAt: row.movedAt.toISOString(),
      postedAt: row.postedAt.toISOString(),
      note: row.note,
      hasEvidence: !!row.evidenceKey,
      journalEntryNo,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

type MovementRow = Prisma.ShopPettyCashMovementGetPayload<Record<string, never>>;

const bucket = () => ({ amount: ZERO as Decimal, count: 0 });

const toLedgerLine = (line: LedgerLineRow): PettyCashLedgerLine => ({
  id: line.id,
  debit: new Decimal(line.debit.toString()),
  credit: new Decimal(line.credit.toString()),
  entry: {
    id: line.journalEntry.id,
    entryNumber: line.journalEntry.entryNumber,
    entryDate: line.journalEntry.entryDate,
    description: line.journalEntry.description,
    metadata: line.journalEntry.metadata,
    createdById: line.journalEntry.createdById,
  },
});
