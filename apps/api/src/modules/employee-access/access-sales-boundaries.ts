import { BadRequestException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AccessResource, canAccess, PermissionKey } from '@installment/shared';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SalesController } from '../sales/sales.controller';
import { BookingsController } from '../bookings/bookings.controller';
import { SalesListQueryDto } from '../sales/dto/sales-list-query.dto';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService, PersistedAccessResolver } from './access-resource.service';
import { requestedAccessCompany } from './access-shop-boundaries';
import { saleSource, bookingSource } from './access-sales-scope';
import { tradeInSource } from './access-trade-in-scope';
import { AccessTradeInProjectionService } from './access-trade-in-projection.service';
import { AccessSalesProjectionService } from './access-sales-projection.service';
import { currentDomainAccess } from './access-execution-context';

export const SALES_BOUNDARY_ROUTES = [
  'findAll',
  'exportRows',
  'getSalespersons',
  'getPosConfig',
  'getTopProducts',
  'getDailySummary',
  'findOne',
  'create',
  'voidSale',
].map((m) => `SalesController.${m}`);
export const BOOKINGS_BOUNDARY_ROUTES = [
  'findAll',
  'summary',
  'findOne',
  'create',
  'update',
  'payDeposit',
  'cancel',
  'convert',
  'remove',
].map((m) => `BookingsController.${m}`);
interface Request {
  query?: Record<string, string>;
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  user: { id: string; role: string; branchId?: string | null };
}
const salesCollections = [
  'findAll',
  'exportRows',
  'getSalespersons',
  'getPosConfig',
  'getTopProducts',
  'getDailySummary',
];
@Injectable()
export class AccessSalesBoundaries implements OnModuleInit {
  constructor(
    private readonly modules: ModuleRef,
    private readonly resources: AccessResourceService,
    private readonly parties: AccessTradeInProjectionService,
    private readonly projection: AccessSalesProjectionService,
  ) {}
  onModuleInit() {
    for (const route of [...SALES_BOUNDARY_ROUTES, ...BOOKINGS_BOUNDARY_ROUTES])
      ACCESS_BOUNDARIES.set(route, async (req: Request, snapshot, permission) => {
        const sale = route.startsWith('SalesController.'),
          method = route.split('.')[1];
        const company = requestedAccessCompany(req);
        if (company !== 'SHOP') throw new ForbiddenException('รายการหน้าร้านอยู่ใน SHOP');
        const collection = sale
          ? salesCollections.includes(method)
          : ['findAll', 'summary'].includes(method);
        const resolver = collection ? undefined : this.resolver(sale, method, req, permission);
        const run = async (handler: () => Promise<unknown>) =>
          (
            await this.resources.execute(
              snapshot.userId,
              permission,
              'SHOP',
              resolver,
              async () => {
                const ctx = currentDomainAccess()!;
                if (
                  !(await ctx.client.companyInfo.findFirst({
                    where: { companyCode: 'SHOP', isActive: true, deletedAt: null },
                  }))
                )
                  throw new ForbiddenException('ไม่พบ SHOP');
                if (
                  !sale &&
                  !ctx.scope.tuples.some(
                    (t) => t.scope === 'COMPANY' || (t.scope === 'BRANCHES' && t.branchIds.length),
                  )
                )
                  throw new ForbiddenException('ใบจองไม่มีผู้รับมอบหมาย');
                await this.validateQuery(req.query ?? {}, sale);
                if (
                  req.query?.customerId &&
                  !(await this.parties.partyAllows(
                    ctx.client,
                    ctx.snapshot,
                    req.query.customerId,
                    'customerId',
                    'customers.read',
                  ))
                )
                  throw new ForbiddenException('ไม่มีสิทธิ์กรองลูกค้า');
                const actor = await ctx.client.user.findUniqueOrThrow({
                  where: { id: snapshot.userId },
                });
                req.user.role = actor.role;
                return this.projection.project(
                  await handler(),
                  sale ? 'sale' : 'booking',
                  req.params?.id,
                );
              },
              false,
              { isolationLevel: 'Serializable', maxAttempts: 3, retryUniqueConflict: true },
            )
          ).result;
        if (collection)
          return {
            kind: 'collection',
            company,
            execute: () => run(() => this.collection(sale, method, req)),
          };
        // Handler/DTO pipes execute inside the same current-authority transaction.
        return { kind: 'selection', company, execute: run };
      });
  }
  private resolver(
    sale: boolean,
    method: string,
    req: Request,
    permission: PermissionKey,
  ): PersistedAccessResolver {
    return async (tx, snapshot, lock) => {
      const body = req.body ?? {},
        id = req.params?.id;
      const sources: AccessResource[] = [];
      const productIds = new Set<string>();
      let customerId = body.customerId;
      let creditId = body.tradeInCreditId;
      if (id) {
        sources.push(await (sale ? saleSource(tx, id, lock) : bookingSource(tx, id, lock)));
        if (sale && method === 'voidSale') {
          const row = await tx.sale.findUniqueOrThrow({ where: { id } });
          for (const pid of [row.productId, ...row.bundleProductIds]) if (pid) productIds.add(pid);
          const credit = row.tradeInCreditSnapshot as { tradeInId?: string } | null;
          creditId = credit?.tradeInId;
        }
        if (!sale && !['findOne', 'remove'].includes(method)) {
          const row = await tx.booking.findUniqueOrThrow({
            where: { id },
            include: { items: true },
          });
          customerId = customerId ?? row.customerId;
          for (const item of row.items) if (item.productId) productIds.add(item.productId);
          if (row.lockedProductId) productIds.add(row.lockedProductId);
        }
      }
      if (method === 'create' || body.branchId !== undefined) {
        if (typeof body.branchId !== 'string') throw new BadRequestException('กรุณาระบุสาขา');
        const source = await this.resources.branch(tx, body.branchId, lock);
        if (source.company !== 'SHOP') throw new ForbiddenException('สาขาต้องอยู่ใน SHOP');
        sources.push(sale ? { ...source, assignedUserIds: [snapshot.userId] } : source);
      }
      const result = { company: 'SHOP' as const, resources: sources, productIds: [] };
      this.resources.assert(snapshot, permission, result);
      if (!sale && method === 'cancel' && !snapshot.isOwner)
        throw new ForbiddenException('เจ้าของเท่านั้นที่อนุมัติยกเลิกและคืนเงิน');
      if (!sale && method === 'convert')
        this.resources.assert(snapshot, 'sales.create', {
          ...result,
          resources: sources.map((s) => ({ ...s, assignedUserIds: [snapshot.userId] })),
        });
      if (typeof body.productId === 'string') productIds.add(body.productId);
      if (body.bundleProductIds !== undefined) {
        if (
          !Array.isArray(body.bundleProductIds) ||
          body.bundleProductIds.some((p) => typeof p !== 'string')
        )
          throw new BadRequestException('สินค้าไม่ถูกต้อง');
        for (const p of body.bundleProductIds) productIds.add(p as string);
      }
      if (body.items !== undefined) {
        if (!Array.isArray(body.items)) throw new BadRequestException('รายการสินค้าไม่ถูกต้อง');
        for (const item of body.items as { productId?: unknown }[]) {
          if (!item || typeof item !== 'object')
            throw new BadRequestException('รายการสินค้าไม่ถูกต้อง');
          if (item.productId !== undefined && typeof item.productId !== 'string')
            throw new BadRequestException('สินค้าไม่ถูกต้อง');
          if (typeof item.productId === 'string') productIds.add(item.productId);
        }
      }
      for (const pid of [...productIds].sort()) {
        const source = await this.resources.product(tx, pid, lock);
        const primary = { ...source, ...(sale ? { assignedUserIds: [snapshot.userId] } : {}) };
        if (
          source.company !== 'SHOP' ||
          !canAccess(snapshot, permission, primary) ||
          !canAccess(snapshot, 'products.read', source)
        )
          throw new ForbiddenException('ไม่มีสิทธิ์เลือกสินค้า');
      }
      if (
        customerId !== undefined &&
        (typeof customerId !== 'string' ||
          !(await this.parties.partyAllows(
            tx,
            snapshot,
            customerId,
            'customerId',
            'customers.read',
          )))
      )
        throw new ForbiddenException('ไม่มีสิทธิ์เลือกลูกค้า');
      if (creditId !== undefined) {
        if (typeof creditId !== 'string') throw new BadRequestException('เครดิตไม่ถูกต้อง');
        const source = await tradeInSource(tx, creditId, lock);
        if (
          !canAccess(snapshot, 'trade-in.read', source) ||
          !canAccess(snapshot, permission, source)
        )
          throw new ForbiddenException('ไม่มีสิทธิ์เลือกเครดิต');
      }
      return result;
    };
  }
  private async validateQuery(q: Record<string, string>, sale: boolean) {
    const allowed = sale
      ? [
          'company',
          'saleType',
          'branchId',
          'search',
          'startDate',
          'endDate',
          'paymentMethod',
          'salespersonId',
          'contractStatus',
          'includeVoided',
          'page',
          'limit',
          'date',
        ]
      : [
          'company',
          'page',
          'limit',
          'status',
          'open',
          'expiring',
          'branchId',
          'customerId',
          'search',
          'from',
          'to',
          'sort',
          'order',
        ];
    if (
      Object.keys(q).some((k) => !allowed.includes(k)) ||
      Object.values(q).some((v) => typeof v !== 'string')
    )
      throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
    for (const key of ['page', 'limit', 'expiring'])
      if (
        q[key] !== undefined &&
        (!/^\d+$/.test(q[key]) ||
          !Number.isSafeInteger(+q[key]) ||
          +q[key] < (key === 'expiring' ? 0 : 1) ||
          (key === 'limit' && +q[key] > 200) ||
          (key === 'expiring' && +q[key] > 30))
      )
        throw new BadRequestException('หน้าหรือจำนวนไม่ถูกต้อง');
    if ((+(q.page ?? 1) - 1) * +(q.limit ?? 50) > 2147483647)
      throw new BadRequestException('หน้าไม่ถูกต้อง');
    for (const key of ['date', 'from', 'to', 'startDate', 'endDate'])
      if (
        q[key] !== undefined &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(q[key]) ||
          Number.isNaN(Date.parse(q[key])) ||
          new Date(q[key]).toISOString().slice(0, 10) !== q[key])
      )
        throw new BadRequestException('วันที่ไม่ถูกต้อง');
    if (sale) {
      const filters = { ...q };
      delete filters.company;
      delete filters.date;
      if (q.contractStatus) throw new ForbiddenException('ตัวกรองสัญญาต้องใช้ขอบเขตงานการเงิน');
      if ((await validate(plainToInstance(SalesListQueryDto, filters))).length)
        throw new BadRequestException('ตัวกรองการขายไม่ถูกต้อง');
    } else if (
      (q.open && !['1', '0', 'true', 'false'].includes(q.open)) ||
      (q.sort && !['expireDate', 'createdAt'].includes(q.sort)) ||
      (q.order && !['asc', 'desc'].includes(q.order))
    )
      throw new BadRequestException('ตัวกรองใบจองไม่ถูกต้อง');
  }
  private collection(sale: boolean, method: string, req: Request): Promise<unknown> {
    const q = req.query ?? {};
    if (sale) {
      const c = this.modules.get(SalesController, { strict: false });
      const raw = { ...q };
      delete raw.company;
      delete raw.date;
      const filters = plainToInstance(SalesListQueryDto, raw);
      switch (method) {
        case 'findAll':
          return c.findAll(req.user, filters);
        case 'exportRows':
          return c.exportRows(filters, req.user);
        case 'getSalespersons':
          return c.getSalespersons(req.user);
        case 'getPosConfig':
          return c.getPosConfig();
        case 'getTopProducts':
          return c.getTopProducts(req.user);
        case 'getDailySummary':
          return c.getDailySummary(req.user, q.date, q.branchId);
      }
    } else {
      const c = this.modules.get(BookingsController, { strict: false });
      if (method === 'summary') return c.summary(req as never, q.branchId, q.from, q.to);
      return c.findAll(
        req as never,
        q.page,
        q.limit,
        q.status,
        q.open,
        q.expiring,
        q.branchId,
        q.customerId,
        q.search,
        q.from,
        q.to,
        q.sort,
        q.order,
      );
    }
    throw new ForbiddenException('ไม่พบตัวอ่านรายการ');
  }
}
