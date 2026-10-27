import { BadRequestException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AccessResource, PermissionKey, canAccess } from '@installment/shared';
import { TradeInController } from '../trade-in/trade-in.controller';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService, PersistedAccessResolver } from './access-resource.service';
import { requestedAccessCompany } from './access-shop-boundaries';
import { procurementPreparation } from './access-preparation-context';
import { tradeInSource } from './access-trade-in-scope';
import { AccessTradeInProjectionService } from './access-trade-in-projection.service';

const collections = ['findAll', 'sellerHistory', 'checkImei', 'availableCredits'];
const referenceReads = [
  'quickBuyCatalog',
  'quickBuyQuestions',
  'quickBuyPreview',
  'lookupValuation',
  'listValuations',
  'getValuationBrands',
  'getValuationModels',
  'listBuybackQuestions',
  'getSellConfig',
];
const referenceWrites = [
  'upsertValuation',
  'deleteValuation',
  'createBuybackQuestion',
  'updateBuybackQuestion',
  'deleteBuybackQuestion',
  'createBuybackChoice',
  'updateBuybackChoice',
  'deleteBuybackChoice',
  'updateSellConfig',
];
export const TRADE_IN_BOUNDARY_ROUTES = [
  ...collections,
  ...referenceReads,
  ...referenceWrites,
  'create',
  'quickBuy',
  'quickBuyStatus',
  'verifyVoucher',
  'appraisalQuestions',
  'appraisalPreview',
  'findOne',
  'update',
  'appraise',
  'appraiseOnline',
  'accept',
  'reject',
  'complete',
  'uploadIdCardPhoto',
  'generateVoucher',
  'downloadVoucher',
].map((method) => `TradeInController.${method}`);
interface Request {
  query?: Record<string, string>;
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  user?: { id: string; role: string; branchId?: string | null };
}
@Injectable()
export class AccessTradeInBoundaries implements OnModuleInit {
  constructor(
    private readonly modules: ModuleRef,
    private readonly resources: AccessResourceService,
    private readonly projection: AccessTradeInProjectionService,
  ) {}
  onModuleInit() {
    for (const route of TRADE_IN_BOUNDARY_ROUTES)
      ACCESS_BOUNDARIES.set(route, async (req, snapshot, permission) => {
        const company = requestedAccessCompany(req);
        if (company !== 'SHOP') throw new ForbiddenException('รายการรับซื้ออยู่ใน SHOP');
        const method = route.split('.')[1];
        const resolver = this.resolver(method, req, permission);
        const run = async (handler: () => Promise<unknown>) =>
          (
            await this.resources.execute(
              snapshot.userId,
              permission,
              company,
              resolver,
              async () => {
                this.validateQuery(req.query ?? {});
                return this.projection.project(
                  await handler(),
                  req.params?.id ?? req.query?.tradeInId,
                  referenceReads.includes(method) || referenceWrites.includes(method),
                );
              },
              false,
              {
                domain: 'trade-in',
                isolationLevel: 'Serializable',
                maxAttempts: 3,
                retryUniqueConflict: true,
              },
            )
          ).result;
        if (collections.includes(method))
          return {
            kind: 'collection',
            company,
            execute: () => run(() => this.collection(method, req)),
          };
        if (['create', 'quickBuy', 'uploadIdCardPhoto'].includes(method))
          return {
            kind: 'selection',
            company,
            execute: (handler) =>
              procurementPreparation.run(
                {
                  execute: run as <T>(h: () => Promise<T>) => Promise<T>,
                  authorize: async () => {
                    await this.resources.execute(
                      snapshot.userId,
                      permission,
                      company,
                      resolver,
                      async () => undefined,
                      false,
                      { domain: 'trade-in', isolationLevel: 'Serializable', maxAttempts: 3 },
                    );
                  },
                },
                handler,
              ),
          };
        const resolved = await this.resources.preflight(snapshot, permission, resolver!);
        if (resolved.reference) return { kind: 'reference', company, execute: run };
        return { kind: 'resource', resource: resolved.resources[0], execute: run };
      });
  }
  private resolver(
    method: string,
    req: Request,
    permission: PermissionKey,
  ): PersistedAccessResolver | undefined {
    return async (tx, snapshot, lock) => {
      if (
        !(await tx.companyInfo.findFirst({
          where: { companyCode: 'SHOP', isActive: true, deletedAt: null },
        }))
      )
        throw new ForbiddenException('ไม่พบส่วนงาน SHOP');
      const result = (sources: AccessResource[]) => ({
        company: 'SHOP' as const,
        resources: sources,
        productIds: [],
      });
      if (referenceWrites.includes(method)) return result([{ company: 'SHOP' }]);
      if (
        (collections.includes(method) && method !== 'availableCredits') ||
        referenceReads.includes(method) ||
        (method === 'appraisalQuestions' && !req.query?.tradeInId)
      )
        return { ...result([]), reference: 'TRADE_IN_REFERENCE' as const };
      let id = req.params?.id ?? req.query?.tradeInId;
      if (method === 'quickBuy' && typeof req.body?.requestId === 'string')
        id = (await tx.tradeIn.findUnique({ where: { quickBuyRequestId: req.body.requestId } }))
          ?.id;
      if (method === 'quickBuyStatus')
        id = (await tx.tradeIn.findUnique({ where: { quickBuyRequestId: req.params?.requestId } }))
          ?.id;
      if (method === 'verifyVoucher')
        id = (await tx.tradeIn.findUnique({ where: { voucherNumber: req.params?.voucherNumber } }))
          ?.id;
      const sources: AccessResource[] = [];
      if (id) sources.push(await tradeInSource(tx, id, lock));
      else if (!['create', 'quickBuy', 'availableCredits'].includes(method))
        throw new ForbiddenException('ไม่พบรายการรับซื้อ');
      const branchId =
        req.body?.branchId ?? (method === 'availableCredits' ? req.query?.branchId : undefined);
      if (branchId !== undefined) {
        if (typeof branchId !== 'string') throw new BadRequestException('สาขาไม่ถูกต้อง');
        const branch = await this.resources.branch(tx, branchId, lock);
        if (branch.company !== 'SHOP') throw new ForbiddenException('สาขารับซื้อต้องเป็น SHOP');
        sources.push(branch);
      }
      if (!id && !sources.length) throw new BadRequestException('กรุณาระบุสาขารับซื้อ');
      this.resources.assert(snapshot, permission, result(sources));
      const productId = req.body?.productId;
      if (productId !== undefined) {
        if (typeof productId !== 'string') throw new BadRequestException('สินค้าไม่ถูกต้อง');
        const product = await this.resources.product(tx, productId, lock);
        if (
          !canAccess(snapshot, 'products.read', product) ||
          !canAccess(snapshot, permission, product)
        )
          throw new ForbiddenException('ไม่มีสิทธิ์เลือกสินค้า');
      }
      for (const [field, capability] of [
        ['customerId', 'customers.read'],
        ['sellerContactId', 'contacts.read'],
      ] as const) {
        const partyId =
          req.body?.[field] ??
          (method === 'availableCredits' && field === 'customerId'
            ? req.query?.customerId
            : undefined);
        if (partyId !== undefined) {
          if (
            typeof partyId !== 'string' ||
            !(await this.projection.partyAllows(tx, snapshot, partyId, field, capability))
          )
            throw new ForbiddenException('ไม่มีสิทธิ์เลือกรายชื่อ');
        }
      }
      if (['generateVoucher', 'downloadVoucher', 'uploadIdCardPhoto'].includes(method)) {
        const required: PermissionKey[] = ['documents.read'];
        if (method === 'downloadVoucher') required.push('sensitive.cost.read');
        for (const key of required) this.resources.assert(snapshot, key, result(sources));
      }
      return result(sources);
    };
  }
  private validateQuery(q: Record<string, string>) {
    const allowed = [
      'company',
      'customerId',
      'branchId',
      'status',
      'search',
      'submissionSource',
      'flow',
      'page',
      'limit',
      'brand',
      'model',
      'storage',
      'condition',
      'tradeInId',
    ];
    if (
      Object.keys(q).some((k) => !allowed.includes(k)) ||
      Object.values(q).some((v) => typeof v !== 'string')
    )
      throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
    for (const k of ['page', 'limit'])
      if (
        q[k] &&
        (!/^\d+$/.test(q[k]) ||
          !Number.isSafeInteger(+q[k]) ||
          +q[k] < 1 ||
          (k === 'limit' && +q[k] > 200))
      )
        throw new BadRequestException('หน้าหรือจำนวนรายการไม่ถูกต้อง');
    if ((Number(q.page ?? 1) - 1) * Number(q.limit ?? 50) > 2147483647)
      throw new BadRequestException('หน้าหรือจำนวนรายการไม่ถูกต้อง');
    if (
      (q.status &&
        !['PENDING_APPRAISAL', 'APPRAISED', 'ACCEPTED', 'REJECTED', 'COMPLETED'].includes(
          q.status,
        )) ||
      (q.flow && !['BUYBACK', 'EXCHANGE'].includes(q.flow)) ||
      (q.submissionSource && !['ONLINE', 'OFFLINE'].includes(q.submissionSource))
    )
      throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
  }
  private collection(method: string, req: Request): Promise<unknown> {
    const c = this.modules.get(TradeInController, { strict: false });
    const q = req.query ?? {};
    switch (method) {
      case 'findAll':
        return c.findAll(
          { page: Number(q.page ?? 1), limit: Number(q.limit ?? 50) },
          q.customerId,
          q.branchId,
          q.status,
          q.search,
          q.submissionSource,
          q.flow,
          req as never,
        );
      case 'sellerHistory':
        return c.sellerHistory(req.params!.idCard);
      case 'checkImei':
        return c.checkImei(req.params!.imei);
      case 'availableCredits':
        return c.availableCredits(q.customerId, q.branchId);
      default:
        throw new ForbiddenException('ไม่พบตัวอ่านรายการ');
    }
  }
}
