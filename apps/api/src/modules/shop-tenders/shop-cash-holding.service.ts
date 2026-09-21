import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as Sentry from '@sentry/node';
import { Prisma, ShopCashDestination } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { validatePeriodOpen } from '../../utils/period-lock.util';
import { bangkokDateString } from '../../utils/date.util';
import { assertEvidenceImage, evidenceImageExtension } from '../../utils/upload-image.util';
import { CashCloseActor, canConfirmBranch, canViewBranch } from './shop-cash-access';
import { CASH_CLOSE_DESTINATION_ACCOUNT, SHOP_CASH_DEPOSIT_FLOW, SHOP_DEPOSIT_BANK_ACCOUNT } from './shop-cash-accounts';
import { HoldingClose, allocateDeposits, postedPortion } from './shop-cash-holding.util';
import { CASH_DEPOSIT_SOURCES, CashDepositSource } from './dto/cash-close.dto';

type Db = Prisma.TransactionClient | PrismaService;
const CENT = new Prisma.Decimal('0.005');
const ZERO = new Prisma.Decimal(0);

export const HOLDING_SOURCE_LABEL: Record<CashDepositSource, string> = { BRANCH_SAFE: 'ตู้เซฟสาขา', OWNER_HOLD: 'เจ้าของเก็บไว้' };

const DEPOSIT_INCLUDE = {
  branch: { select: { id: true, name: true } },
  depositedBy: { select: { id: true, name: true } },
} satisfies Prisma.ShopCashDepositInclude;
type DepositRow = Prisma.ShopCashDepositGetPayload<{ include: typeof DEPOSIT_INCLUDE }>;

interface Ledger { branchId: string; source: CashDepositSource; closes: HoldingClose[]; deposited: Prisma.Decimal }

/**
 * เงินที่รับจากการปิดยอดแล้วแต่ยังไม่เข้าธนาคาร (ตู้เซฟสาขา / เจ้าของเก็บไว้) + "บันทึกนำฝาก" —
 * คำตัดสินเจ้าของ 2026-09-21 (mockup กระดาน 10–11): ตู้เซฟสาขา = เงิน **ยังไม่ถึงบริษัท** จนกว่าจะบันทึกนำฝากพร้อมสลิป;
 * เงินที่เจ้าของเก็บไว้ถือว่าถึงบริษัทแล้ว แต่บันทึกนำฝากได้เช่นกันเพื่อให้สมุดย้ายเงินเข้าธนาคาร (เดิมต้องลง JV เอง)
 */
@Injectable()
export class ShopCashHoldingService {
  private readonly logger = new Logger(ShopCashHoldingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly journal: JournalAutoService,
    private readonly companies: CompanyResolverService,
  ) {}

  private static key = (branchId: string, source: string) => `${branchId}|${source}`;

  /** กองปิดยอด (เก่า → ใหม่) + ยอดนำฝากสะสม ต่อ (สาขา, แหล่งเก็บ) */
  private async loadLedgers(db: Db, branchIds?: string[]): Promise<Map<string, Ledger>> {
    const branchWhere = branchIds ? { branchId: { in: branchIds } } : {};
    const closes = await db.shopCashClose.findMany({
      where: { ...branchWhere, status: 'CONFIRMED', destination: { in: [...CASH_DEPOSIT_SOURCES] } },
      select: { id: true, branchId: true, destination: true, confirmedAt: true, countedAt: true, receivedAmount: true, journalEntryId: true },
      orderBy: [{ confirmedAt: 'asc' }, { id: 'asc' }],
    });
    const deposits = await db.shopCashDeposit.groupBy({ by: ['branchId', 'source'], where: branchWhere, _sum: { amount: true } });
    const ledgers = new Map<string, Ledger>();
    const ledgerOf = (branchId: string, source: CashDepositSource) => {
      const key = ShopCashHoldingService.key(branchId, source);
      let ledger = ledgers.get(key);
      if (!ledger) { ledger = { branchId, source, closes: [], deposited: ZERO }; ledgers.set(key, ledger); }
      return ledger;
    };
    for (const row of closes) {
      ledgerOf(row.branchId, row.destination as CashDepositSource).closes.push({
        id: row.id, confirmedAt: row.confirmedAt ?? row.countedAt, amount: row.receivedAmount ?? ZERO, posted: !!row.journalEntryId });
    }
    for (const row of deposits) ledgerOf(row.branchId, row.source as CashDepositSource).deposited = row._sum.amount ?? ZERO;
    return ledgers;
  }

  /** การปิดยอดที่เงินเข้าธนาคารครบแล้วผ่านการนำฝาก — ใช้ตัดสินว่า "ตู้เซฟสาขา" ครั้งนั้นถึงบริษัทแล้วหรือยัง */
  async settledCloseIds(branchIds?: string[], db: Db = this.prisma): Promise<Set<string>> {
    const settled = new Set<string>();
    for (const ledger of (await this.loadLedgers(db, branchIds)).values()) {
      for (const id of allocateDeposits(ledger.closes, ledger.deposited).settledCloseIds) settled.add(id);
    }
    return settled;
  }

  /** รายการ "เงินที่ยังไม่ได้นำฝาก" ต่อ (สาขา, แหล่งเก็บ) — เฉพาะที่ยังมียอดค้าง */
  async getHoldings(actor: CashCloseActor, branchIds?: string[]) {
    const ledgers = [...(await this.loadLedgers(this.prisma, branchIds)).values()];
    const names = await this.prisma.branch.findMany({ where: { id: { in: ledgers.map((l) => l.branchId) } }, select: { id: true, name: true } });
    const nameOf = new Map(names.map((b) => [b.id, b.name]));
    return ledgers
      .map((ledger) => ({ ledger, allocation: allocateDeposits(ledger.closes, ledger.deposited) }))
      .filter(({ allocation }) => allocation.outstanding.gte(CENT))
      .map(({ ledger, allocation }) => ({
        branchId: ledger.branchId, branchName: nameOf.get(ledger.branchId) ?? '-', source: ledger.source,
        sourceLabel: HOLDING_SOURCE_LABEL[ledger.source], reachedCompany: ledger.source === 'OWNER_HOLD',
        outstanding: Number(allocation.outstanding), closeCount: allocation.openCloses.length,
        oldestConfirmedAt: allocation.openCloses[0]?.confirmedAt ?? null,
        openCloses: allocation.openCloses.map((row) => ({ id: row.id, confirmedAt: row.confirmedAt, outstanding: Number(row.outstanding) })),
        canDeposit: this.canDeposit(actor, ledger.branchId, ledger.source),
      }))
      .sort((a, b) => Number(a.reachedCompany) - Number(b.reachedCompany) || a.branchName.localeCompare(b.branchName, 'th'));
  }

  /** ตู้เซฟสาขา = เจ้าของ/ผจก.การเงิน/ผจก.สาขาของสาขานั้น · เงินที่เจ้าของเก็บ = เจ้าของ/ผจก.การเงิน (ผจก.สาขาไม่ได้ถือเงินก้อนนั้น) */
  private canDeposit(actor: CashCloseActor, branchId: string, source: CashDepositSource) {
    if (source === 'OWNER_HOLD') return actor.role === 'OWNER' || actor.role === 'FINANCE_MANAGER';
    return canConfirmBranch(actor, branchId);
  }

  private present(row: DepositRow) {
    return {
      id: row.id, branchId: row.branchId, branchName: row.branch.name, source: row.source,
      sourceLabel: HOLDING_SOURCE_LABEL[row.source as CashDepositSource] ?? row.source,
      amount: Number(row.amount), reference: row.reference, note: row.note, depositedBy: row.depositedBy,
      depositedAt: row.depositedAt, journalPosted: !!row.journalEntryId,
    };
  }

  async listDeposits(range: { gte: Date; lt: Date }, branchId?: string) {
    const rows = await this.prisma.shopCashDeposit.findMany({
      where: { ...(branchId ? { branchId } : {}), depositedAt: range }, include: DEPOSIT_INCLUDE, orderBy: { depositedAt: 'desc' }, take: 200,
    });
    return rows.map((row) => this.present(row));
  }

  async createDeposit(actor: CashCloseActor,
    input: { branchId: string; source: CashDepositSource; amount: number; reference: string; note?: string | null },
    file: Express.Multer.File | undefined) {
    if (!this.canDeposit(actor, input.branchId, input.source)) {
      throw new ForbiddenException(input.source === 'OWNER_HOLD'
        ? 'บันทึกนำฝากเงินที่เจ้าของเก็บไว้ได้เฉพาะเจ้าของหรือผู้จัดการการเงิน'
        : 'บันทึกนำฝากเงินในตู้เซฟสาขาได้เฉพาะเจ้าของ ผู้จัดการการเงิน หรือผู้จัดการสาขาของสาขานั้น');
    }
    assertEvidenceImage(file, 'สลิปฝากเงิน');
    const amount = new Prisma.Decimal(input.amount).toDecimalPlaces(2);
    const reference = input.reference.trim();
    const note = input.note?.trim() || null;

    const slipKey = `shop-cash-deposits/${input.branchId}/${Date.now()}-${randomUUID()}.${evidenceImageExtension(file.mimetype)}`;
    await this.storage.upload(slipKey, file.buffer, file.mimetype);

    let journal: { entryNumber: string | null; skipped: string | null; postedAmount: Prisma.Decimal } = { entryNumber: null, skipped: null, postedAmount: ZERO };
    let created: DepositRow;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        // ล็อกเดียวกับการนับ/ยืนยันรับเงินของสาขา ⇒ ยอดค้างที่อ่านไม่ขยับระหว่างทาง และกดซ้ำสองครั้งไม่ฝากเกิน
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'shop-cash-close:' + input.branchId}))`;
        const branch = await tx.branch.findFirst({ where: { id: input.branchId, deletedAt: null }, select: { id: true, name: true } });
        if (!branch) throw new NotFoundException('ไม่พบสาขา');
        const ledger = (await this.loadLedgers(tx, [input.branchId])).get(ShopCashHoldingService.key(input.branchId, input.source));
        const closes = ledger?.closes ?? [];
        const deposited = ledger?.deposited ?? ZERO;
        const outstanding = allocateDeposits(closes, deposited).outstanding;
        if (amount.minus(outstanding).gte(CENT)) {
          throw new BadRequestException(outstanding.lt(CENT)
            ? `ไม่มีเงินค้างใน${HOLDING_SOURCE_LABEL[input.source]}ของสาขานี้ให้นำฝาก`
            : `ยอดนำฝาก ${amount.toFixed(2)} เกินเงินที่ค้างใน${HOLDING_SOURCE_LABEL[input.source]} (${outstanding.toFixed(2)})`);
        }
        const depositedAt = new Date();
        const row = await tx.shopCashDeposit.create({
          data: { branchId: input.branchId, source: input.source as ShopCashDestination, amount, reference, slipKey, note,
            depositedById: actor.id, depositedAt },
          include: DEPOSIT_INCLUDE,
        });
        const posted = await this.postDepositJournal(tx, row, postedPortion(closes, deposited, amount), depositedAt);
        journal = posted;
        if (!posted.entryId) return row;
        return tx.shopCashDeposit.update({ where: { id: row.id }, data: { journalEntryId: posted.entryId }, include: DEPOSIT_INCLUDE });
      });
    } catch (error) {
      await this.storage.delete(slipKey).catch(() => undefined);
      throw error;
    }

    if (journal.skipped || amount.minus(journal.postedAmount).gte(CENT)) {
      Sentry.captureMessage('[shop-cash-deposit] recorded without a full journal entry', {
        level: 'warning', tags: { subsystem: 'shop-cash-close' },
        extra: { depositId: created.id, reason: journal.skipped, amount: amount.toFixed(2), postedAmount: journal.postedAmount.toFixed(2) } });
    }
    await this.audit.log({ userId: actor.id, action: 'SHOP_CASH_DEPOSIT_RECORDED', entity: 'shop_cash_deposit', entityId: created.id,
      newValue: { branchId: created.branchId, source: created.source, amount: created.amount, reference: created.reference,
        journalEntryNumber: journal.entryNumber, journalAmount: journal.postedAmount.toFixed(2), journalSkipped: journal.skipped } });
    return this.present(created);
  }

  /**
   * Dr S11-1201 ธนาคารของร้าน / Cr <บัญชีแหล่งเก็บ> (S11-1105 ตู้เซฟ · S11-1104 เจ้าของเก็บ) — ใน tx เดียวกับการบันทึกนำฝาก.
   * ลงเฉพาะส่วนที่การปิดยอดต้นทางเคยลงบัญชีไว้ (`postedPortion`) — ต้นทางที่ข้ามการลงบัญชีไม่มียอดให้ล้าง เครดิตไปจะทำให้บัญชีแหล่งเก็บติดลบ
   */
  private async postDepositJournal(tx: Prisma.TransactionClient, row: DepositRow, postable: Prisma.Decimal, depositedAt: Date) {
    const none = { entryId: null as string | null, entryNumber: null as string | null, skipped: null as string | null, postedAmount: ZERO };
    if (postable.lt(CENT)) return { ...none, skipped: 'SOURCE_NOT_POSTED' };
    const sourceAccount = CASH_CLOSE_DESTINATION_ACCOUNT[row.source];
    const codes = [SHOP_DEPOSIT_BANK_ACCOUNT, sourceAccount];
    const known = await tx.chartOfAccount.findMany({ where: { code: { in: codes }, deletedAt: null }, select: { code: true } });
    if (known.length !== codes.length) return { ...none, skipped: 'ACCOUNTS_NOT_IN_CHART' };

    const companyId = await this.companies.getShopCompanyId(tx);
    await validatePeriodOpen(tx, depositedAt, companyId);
    const label = HOLDING_SOURCE_LABEL[row.source as CashDepositSource];
    const entry = await this.journal.createAndPost({
      description: `นำฝากเงินปิดยอด ${row.branch.name} จาก${label} ${postable.toFixed(2)} — อ้างอิง ${row.reference} (${bangkokDateString(depositedAt)})`,
      reference: `shop-cash-deposit:${row.id}`,
      metadata: { flow: SHOP_CASH_DEPOSIT_FLOW, idempotencyKey: `${SHOP_CASH_DEPOSIT_FLOW}:${row.id}`, shopCashDepositId: row.id,
        branchId: row.branchId, source: row.source, amount: row.amount.toFixed(2), postedAmount: postable.toFixed(2), depositReference: row.reference },
      postedAt: depositedAt, companyId,
      lines: [
        { accountCode: SHOP_DEPOSIT_BANK_ACCOUNT, dr: postable, cr: ZERO, description: 'นำฝากเข้าธนาคารของร้าน' },
        { accountCode: sourceAccount, dr: ZERO, cr: postable, description: `ย้ายออกจาก${label}` },
      ],
    }, tx);
    return { entryId: entry.id, entryNumber: entry.entryNumber, skipped: null, postedAmount: postable };
  }

  /** รูปสลิปของการนำฝาก — สิทธิ์ดูตามขอบเขตสาขา (route จำกัด role แล้ว) */
  async getDepositSlip(actor: CashCloseActor, id: string) {
    const row = await this.prisma.shopCashDeposit.findUnique({ where: { id }, select: { branchId: true, slipKey: true } });
    if (!row) throw new NotFoundException('ไม่พบรายการนำฝาก');
    if (!canViewBranch(actor, row.branchId)) throw new ForbiddenException('ดูสลิปได้เฉพาะสาขาของตัวเอง');
    return { key: row.slipKey, stream: await this.storage.getStream(row.slipKey) };
  }
}
