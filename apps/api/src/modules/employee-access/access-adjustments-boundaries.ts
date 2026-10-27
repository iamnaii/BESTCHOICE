import { AccessResource, AccessSnapshot, Company, PermissionKey } from '@installment/shared';
import { AccessClient } from './access-snapshot.service';
import { BadRequestException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { StockAdjustmentsController } from '../inventory/stock-adjustments.controller';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService, PersistedAccessResolver } from './access-resource.service';
import { requestedAccessCompany } from './access-shop-boundaries';
import { currentDomainAccess } from './access-execution-context';
import { procurementPreparation } from './access-preparation-context';
import { adjustmentAllows, adjustmentJournalAllows } from './access-adjustments-scope';
import { resolveBookedInventory } from '../inventory/booked-inventory.util';

export const ADJUSTMENT_BOUNDARY_ROUTES = [
  'createRequest',
  'findAll',
  'getSummary',
  'pendingCount',
  'lookup',
  'preview',
  'findOne',
  'approve',
  'reject',
  'cancel',
].map((method) => `StockAdjustmentsController.${method}`);
interface Request {
  query?: Record<string, string>;
  params?: Record<string, string>;
  body?: { productId?: string; reason?: string };
  user?: { id: string; role: string; branchId?: string | null };
}
@Injectable()
export class AccessAdjustmentsBoundaries implements OnModuleInit {
  constructor(
    private readonly modules: ModuleRef,
    private readonly resources: AccessResourceService,
  ) {}
  onModuleInit() {
    for (const route of ADJUSTMENT_BOUNDARY_ROUTES)
      ACCESS_BOUNDARIES.set(route, async (req, snapshot, permission) => {
        const company = requestedAccessCompany(req);
        const method = route.split('.')[1];
        const collection = ['findAll', 'getSummary', 'pendingCount', 'lookup', 'preview'].includes(
          method,
        );
        const resolver = this.resolver(method, req, company, permission);
        const run = async <T>(handler: () => Promise<T>): Promise<T> =>
          (
            await this.resources.execute(
              snapshot.userId,
              permission,
              company,
              resolver,
              async () =>
                this.project(
                  await handler(),
                  req.query?.productId,
                  method === 'lookup',
                  method === 'preview' ? req.query?.reason : undefined,
                ),
              false,
              { domain: 'adjustments', isolationLevel: 'Serializable', maxAttempts: 3 },
            )
          ).result;
        if (collection)
          return {
            kind: 'collection',
            company,
            execute: () => run(() => this.collection(method, req)),
          };
        if (method === 'createRequest')
          return {
            kind: 'selection',
            company,
            execute: (handler) =>
              procurementPreparation.run(
                {
                  execute: run,
                  authorize: async () => {
                    await this.resources.execute(
                      snapshot.userId,
                      permission,
                      company,
                      resolver,
                      async () => undefined,
                      false,
                      { domain: 'adjustments', isolationLevel: 'Serializable', maxAttempts: 3 },
                    );
                  },
                },
                handler,
              ),
          };
        const resolved = await this.resources.preflight(snapshot, permission, resolver!);
        return { kind: 'resource', resource: resolved.resources[0], execute: run };
      });
  }
  private resolver(
    method: string,
    req: Request,
    company: Company,
    permission: PermissionKey,
  ): PersistedAccessResolver | undefined {
    const readsCollection = ['findAll', 'getSummary', 'pendingCount', 'lookup'].includes(method);
    if (readsCollection) return undefined;
    return async (tx, _snapshot, lock) => {
      const id = req.params?.id;
      if (id && lock)
        await tx.$queryRaw`SELECT id FROM stock_adjustments WHERE id = ${id} FOR UPDATE`;
      const row = id ? await tx.stockAdjustment.findUnique({ where: { id } }) : null;
      if (id && (!row || row.deletedAt)) throw new ForbiddenException('ไม่พบคำขอ');
      const productId = row?.productId ?? req.body?.productId ?? req.query?.productId;
      const reason = row?.reason ?? req.body?.reason ?? req.query?.reason;
      // Existing evidence remains readable after approved soft deletion. Only
      // FOUND may create/preview against a deleted product.
      const recovery = !!row || reason === 'FOUND';
      const source = recovery
        ? await this.resources.adjustmentProduct(tx, productId ?? '', lock)
        : await this.resources.product(tx, productId ?? '', lock);
      if (source.company !== company)
        throw new ForbiddenException('สินค้าไม่อยู่ในส่วนงานที่เลือก');
      const sources: AccessResource[] = [source];
      if (row) {
        await this.resources.branch(tx, row.branchId, lock);
        sources.push({ company: source.company, branchId: row.branchId });
      }
      this.resources.assert(_snapshot, permission, { company, resources: sources, productIds: [] });
      if (lock && ['createRequest', 'preview', 'approve'].includes(method)) {
        await this.assertSupportedFinancialSources(
          tx,
          _snapshot,
          permission,
          company,
          productId!,
          reason,
          source,
          sources,
        );
      }
      return { company, resources: sources, productIds: [] };
    };
  }

  /** Financial evidence is read only after current source authorization, inside
   * the locked transaction. These checks never infer a FINANCE posting policy. */
  private async assertSupportedFinancialSources(
    tx: AccessClient,
    snapshot: AccessSnapshot,
    permission: PermissionKey,
    company: Company,
    productId: string,
    reason: string | undefined,
    source: AccessResource,
    sources: AccessResource[],
  ): Promise<void> {
    const exitsInventory = ['LOST', 'WRITE_OFF'].includes(reason ?? '');
    if (exitsInventory && source.company !== 'SHOP') {
      // Even the zero/unbooked path persists SHOP account codes and Todo text.
      throw new BadRequestException('ยังไม่รองรับการตัดสินค้าของ FINANCE ในขั้นตอนบัญชี SHOP');
    }
    const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
    const booked = exitsInventory ? await resolveBookedInventory(tx, product.id) : null;
    if (booked?.booked && product.costPrice.gt(0)) {
      if (booked.journalEntryNo) {
        await tx.$queryRaw`SELECT id FROM journal_entries WHERE entry_number = ${booked.journalEntryNo} FOR SHARE`;
      }
      const evidence = booked.journalEntryNo
        ? await tx.journalEntry.findUnique({
            where: { entryNumber: booked.journalEntryNo },
            include: { company: true },
          })
        : null;
      if (
        !evidence ||
        evidence.deletedAt ||
        evidence.status !== 'POSTED' ||
        evidence.company.companyCode !== 'SHOP'
      )
        throw new BadRequestException('หลักฐานบัญชีรับสินค้าไม่ตรงกับส่วนงาน SHOP');
    }
    if (reason === 'FOUND') {
      const original = await tx.stockAdjustment.findFirst({
        where: {
          productId,
          deletedAt: null,
          status: 'APPROVED',
          reason: { in: ['LOST', 'WRITE_OFF'] },
          journalEntryId: { not: null },
        },
        orderBy: { approvedAt: 'desc' },
      });
      const reversed =
        original &&
        (await tx.stockAdjustment.findFirst({
          where: { reversesAdjustmentId: original.id, status: 'APPROVED', deletedAt: null },
        }));
      if (original?.journalEntryId && !reversed) {
        await tx.$queryRaw`SELECT id FROM stock_adjustments WHERE id = ${original.id} FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM journal_entries WHERE id = ${original.journalEntryId} FOR UPDATE`;
        const journal = await tx.journalEntry.findUnique({
          where: { id: original.journalEntryId },
          include: { company: true },
        });
        const meta = journal?.metadata as Record<string, unknown> | null;
        const matchesOriginalWriteOff =
          journal?.company.companyCode === 'SHOP' &&
          !journal.deletedAt &&
          journal.status === 'POSTED' &&
          meta?.tag === 'SHOP_STOCK_WRITEOFF' &&
          meta.productId === productId &&
          meta.adjustmentId === original.id &&
          typeof meta.branchId === 'string' &&
          meta.reversed !== true;
        if (source.company !== 'SHOP' || !matchesOriginalWriteOff) {
          throw new BadRequestException('แหล่งบัญชีเดิมไม่รองรับการกลับรายการสินค้าในส่วนงานนี้');
        }
        for (const branchId of [...new Set([original.branchId, meta!.branchId as string])].sort()) {
          await this.resources.branch(tx, branchId, true);
          sources.push({ company: source.company, branchId });
        }
        this.resources.assert(snapshot, permission, {
          company,
          resources: sources,
          productIds: [],
        });
      }
      if (
        source.company !== 'SHOP' &&
        ['LOST', 'DAMAGED', 'WRITTEN_OFF'].includes(product.status) &&
        (await tx.goodsReceivingItem.findFirst({
          where: { productId, deletedAt: null, journalEntryId: null },
        }))
      )
        throw new BadRequestException('ยังไม่รองรับการลงบัญชีรับคืนสินค้าของ FINANCE');
    }
  }

  private async collection(method: string, req: Request): Promise<unknown> {
    const q = req.query ?? {};
    const allowed = [
      'company',
      'branchId',
      'reason',
      'status',
      'mine',
      'productId',
      'search',
      'imei',
      'startDate',
      'endDate',
      'page',
      'limit',
    ];
    if (
      Object.keys(q).some((k) => !allowed.includes(k)) ||
      Object.values(q).some((v) => typeof v !== 'string')
    )
      throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
    for (const key of ['page', 'limit'])
      if (
        q[key] &&
        (!/^\d+$/.test(q[key]) ||
          !Number.isSafeInteger(+q[key]) ||
          +q[key] < 1 ||
          (key === 'limit' && +q[key] > 200))
      )
        throw new BadRequestException('หน้าหรือจำนวนรายการไม่ถูกต้อง');
    const skip = (Number(q.page ?? 1) - 1) * Math.min(100, Number(q.limit ?? 50));
    if (!Number.isSafeInteger(skip) || skip > 2147483647) {
      throw new BadRequestException('หน้าหรือจำนวนรายการไม่ถูกต้อง');
    }
    for (const key of ['startDate', 'endDate'])
      if (q[key] && !Number.isFinite(Date.parse(q[key])))
        throw new BadRequestException('วันที่ไม่ถูกต้อง');
    if (
      (q.reason &&
        !['DAMAGED', 'LOST', 'FOUND', 'CORRECTION', 'WRITE_OFF', 'OTHER'].includes(q.reason)) ||
      (q.status && !['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELED'].includes(q.status)) ||
      (q.mine && !['true', 'false', '1', '0'].includes(q.mine))
    )
      throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
    const controller = this.modules.get(StockAdjustmentsController, { strict: false });
    const actor = req.user!;
    switch (method) {
      case 'findAll':
        return controller.findAll(
          actor,
          q.branchId,
          q.reason,
          q.status,
          q.mine,
          q.productId,
          q.search,
          q.startDate,
          q.endDate,
          q.page,
          q.limit,
        );
      case 'getSummary':
        return controller.getSummary(q.branchId, q.startDate, q.endDate);
      case 'pendingCount':
        return controller.pendingCount(actor);
      case 'lookup':
        return controller.lookup(q.imei, q.search, q.reason, actor);
      case 'preview':
        return controller.preview(q.productId, q.reason, actor);
      default:
        throw new ForbiddenException('ไม่พบตัวอ่านข้อมูล');
    }
  }
  /** All external expansions are independently authorized. Internal accounting
   * evidence deliberately uses the raw joined transaction, never these views. */
  private async project<T>(
    value: T,
    previewProductId?: string,
    lookup = false,
    previewReason?: string,
  ): Promise<T> {
    const walk = async (input: unknown): Promise<unknown> => {
      if (Array.isArray(input)) return Promise.all(input.map(walk));
      if (!input || typeof input !== 'object' || input instanceof Date) return input;
      const row = input as Record<string, unknown>;
      const out = { ...row };
      const productId =
        typeof row.productId === 'string'
          ? row.productId
          : lookup && typeof row.id === 'string'
            ? row.id
            : previewProductId;
      if (productId) {
        const branchId = typeof row.branchId === 'string' ? row.branchId : undefined;
        const ctx = currentDomainAccess()!;
        const ownJournal =
          typeof row.journalEntryId === 'string' ? { id: row.journalEntryId } : null;
        const bookedView = row.booked as Record<string, unknown> | null;
        const bookedJournal =
          typeof bookedView?.journalEntryNo === 'string'
            ? { number: bookedView.journalEntryNo }
            : null;
        const originalId =
          typeof row.reversesAdjustmentId === 'string' ? row.reversesAdjustmentId : undefined;
        const original = originalId
          ? await ctx.client.stockAdjustment.findFirst({
              where: { id: originalId, productId, deletedAt: null },
            })
          : previewReason === 'FOUND'
            ? await ctx.client.stockAdjustment.findFirst({
                where: {
                  productId,
                  deletedAt: null,
                  status: 'APPROVED',
                  reason: { in: ['LOST', 'WRITE_OFF'] },
                  journalEntryId: { not: null },
                },
                orderBy: { approvedAt: 'desc' },
              })
            : null;
        const originalJournal = original?.journalEntryId ? { id: original.journalEntryId } : null;
        let cost = await adjustmentAllows(productId, 'sensitive.cost.read', branchId);
        if (ownJournal)
          cost = cost && (await adjustmentJournalAllows(ownJournal, 'sensitive.cost.read'));
        if (originalId && !original) cost = false;
        if (original)
          cost =
            cost &&
            (await adjustmentAllows(original.productId, 'sensitive.cost.read', original.branchId));
        if (originalJournal)
          cost = cost && (await adjustmentJournalAllows(originalJournal, 'sensitive.cost.read'));
        let journal = cost && (await adjustmentAllows(productId, 'journal.read', branchId));
        for (const reference of [ownJournal, bookedJournal, originalJournal])
          if (reference)
            journal = journal && (await adjustmentJournalAllows(reference, 'journal.read'));
        if (original)
          journal =
            journal && (await adjustmentAllows(productId, 'journal.read', original.branchId));
        if (originalId) {
          const canReadOriginal =
            !!original &&
            (await adjustmentAllows(
              original.productId,
              'stock-adjustments.read',
              original.branchId,
            ));
          if (!canReadOriginal) out.reversesAdjustmentId = null;
        }
        const bookedCost =
          cost &&
          (!bookedJournal || (await adjustmentJournalAllows(bookedJournal, 'sensitive.cost.read')));
        if (!cost)
          for (const key of ['costPrice', 'costAmount', 'bookedAmount', 'totalValue'])
            if (key in out) out[key] = null;
        if (!journal)
          for (const key of [
            'journalEntryId',
            'journalEntryNo',
            'inventoryAccountCode',
            'bookedSource',
            'journalNote',
            'reversesAdjustmentId',
          ])
            if (key in out) out[key] = null;
        if (!journal && 'journalLines' in out) out.journalLines = [];
        // GR numbers expose procurement-origin evidence; no expansion is needed
        // by this workflow. Leave that navigation to its authorized receipt route.
        if (out.booked && typeof out.booked === 'object') {
          const booked = out.booked as Record<string, unknown>;
          out.booked = {
            booked: booked.booked,
            source: journal ? booked.source : null,
            bookedAmount: bookedCost ? booked.bookedAmount : null,
            journalEntryNo: journal ? booked.journalEntryNo : null,
            grNumber: null,
          };
        }
        if ('product' in out) {
          if (!(await adjustmentAllows(productId, 'products.read'))) out.product = null;
          else if (!cost && out.product)
            out.product = { ...(out.product as object), costPrice: null };
        }
        if (!(await adjustmentAllows(productId, 'documents.read', branchId))) {
          if ('photos' in out) out.photos = [];
          if ('photoUrls' in out) out.photoUrls = [];
        }
      }
      if (out.data) out.data = await walk(out.data);
      if (out.adjustment) {
        out.adjustment = await walk(out.adjustment);
        const a = out.adjustment as Record<string, unknown>;
        if (a.journalEntryId === null) out.journalEntryNo = null;
      }
      return out;
    };
    if (!currentDomainAccess()) return value;
    return (await walk(value)) as T;
  }
}
