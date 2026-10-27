import { BadRequestException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AfterSalesController } from '../after-sales/after-sales.controller';
import { LookupDto } from '../after-sales/dto/lookup.dto';
import { ListCasesDto } from '../after-sales/dto/list-cases.dto';
import { ExchangePreviewDto } from '../after-sales/dto/exchange-preview.dto';
import { ReplacementProductsDto } from '../after-sales/dto/replacement-products.dto';
import { AccessResourceService } from './access-resource.service';
import { AccessAfterSalesQueryService } from './access-after-sales-query.service';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { requestedAccessCompany } from './access-shop-boundaries';
import { currentDomainAccess } from './access-execution-context';
export const AFTER_SALES_READ_ROUTES = [
  'lookup',
  'list',
  'byTicket',
  'previewExchange',
  'replacementProducts',
  'get',
].map((method) => `AfterSalesController.${method}`);
interface Request {
  query?: Record<string, string>;
  params?: Record<string, string>;
  user: { id: string; role: string; branchId?: string | null };
}
@Injectable()
export class AccessAfterSalesBoundaries implements OnModuleInit {
  constructor(
    private readonly modules: ModuleRef,
    private readonly resources: AccessResourceService,
    private readonly query: AccessAfterSalesQueryService,
  ) {}
  onModuleInit() {
    for (const route of AFTER_SALES_READ_ROUTES)
      ACCESS_BOUNDARIES.set(route, async (req: Request, snapshot, permission) => {
        const method = route.split('.')[1];
        if (requestedAccessCompany(req) !== 'SHOP')
          throw new ForbiddenException('งานหลังการขายอยู่ใน SHOP');
        const execute = async () =>
          (
            await this.resources.execute(
              snapshot.userId,
              permission,
              'SHOP',
              undefined,
              async () => {
                const ctx = currentDomainAccess()!;
                if (
                  !ctx.scope.tuples.some(
                    (tuple) =>
                      tuple.scope === 'COMPANY' ||
                      (tuple.scope === 'BRANCHES' && tuple.branchIds.length),
                  )
                )
                  throw new ForbiddenException('เคสไม่มีผู้รับมอบหมาย');
                const actor = await ctx.client.user.findUniqueOrThrow({
                  where: { id: snapshot.userId },
                });
                req.user.role = actor.role;
                if (method === 'get') return this.query.get(req.params!.id);
                if (method === 'byTicket') return this.query.byTicket(req.params!.ticketId);
                const q = { ...req.query };
                delete q.company;
                const types = {
                  lookup: LookupDto,
                  list: ListCasesDto,
                  previewExchange: ExchangePreviewDto,
                  replacementProducts: ReplacementProductsDto,
                };
                const Type = types[method as keyof typeof types];
                if (Object.values(q).some((value) => typeof value !== 'string'))
                  throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
                const dto = plainToInstance(Type as typeof ListCasesDto, q);
                if ((await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).length)
                  throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
                if (method === 'list') return this.query.list(dto);
                const controller = this.modules.get(AfterSalesController, { strict: false });
                if (method === 'lookup') return controller.lookup(dto as LookupDto, req.user);
                if (method === 'previewExchange')
                  return controller.previewExchange(dto as ExchangePreviewDto, req.user);
                return controller.replacementProducts(dto as ReplacementProductsDto, req.user);
              },
              false,
              { isolationLevel: 'Serializable', maxAttempts: 3 },
            )
          ).result;
        return method === 'get' || method === 'byTicket'
          ? { kind: 'selection', company: 'SHOP', execute }
          : { kind: 'collection', company: 'SHOP', execute };
      });
  }
}
