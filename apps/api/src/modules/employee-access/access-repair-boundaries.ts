import { BadRequestException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RepairTicketsController } from '../repair-tickets/repair-tickets.controller';
import { ListRepairTicketsDto } from '../repair-tickets/dto/list-repair-tickets.dto';
import { WarrantyPreviewDto } from '../repair-tickets/dto/warranty-preview.dto';
import { WarrantyLookupDto } from '../repair-tickets/dto/warranty-lookup.dto';
import { LookupByImeiDto } from '../repair-tickets/dto/lookup-by-imei.dto';
import { AccessResourceService } from './access-resource.service';
import { AccessRepairSourceService } from './access-repair-source.service';
import { AccessRepairProjectionService } from './access-repair-projection.service';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { currentDomainAccess } from './access-execution-context';
import { requestedAccessCompany } from './access-shop-boundaries';

export const REPAIR_BOUNDARY_ROUTES = [
  'create',
  'list',
  'warrantyPreview',
  'warrantyLookup',
  'lookupByImei',
  'findOne',
  'update',
  'send',
  'markRepaired',
  'sendBack',
  'returnToCustomer',
  'cancel',
  'replace',
  'recalcWarranty',
  'softDelete',
].map((m) => `RepairTicketsController.${m}`);
interface Request {
  query?: Record<string, string>;
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  user: { id: string; role: string; branchId?: string | null };
}
@Injectable()
export class AccessRepairBoundaries implements OnModuleInit {
  constructor(
    private readonly modules: ModuleRef,
    private readonly resources: AccessResourceService,
    private readonly sources: AccessRepairSourceService,
    private readonly projection: AccessRepairProjectionService,
  ) {}
  onModuleInit() {
    for (const route of REPAIR_BOUNDARY_ROUTES)
      ACCESS_BOUNDARIES.set(route, async (req: Request, snapshot, permission) => {
        const method = route.split('.')[1],
          company = requestedAccessCompany(req);
        if (company !== 'SHOP') throw new ForbiddenException('งานซ่อมอยู่ใน SHOP');
        const collection = ['list', 'warrantyPreview', 'warrantyLookup', 'lookupByImei'].includes(
          method,
        );
        const run = async (handler: () => Promise<unknown>) =>
          (
            await this.resources.execute(
              snapshot.userId,
              permission,
              'SHOP',
              collection
                ? undefined
                : (tx, s, lock) =>
                    this.sources.resolve(
                      tx,
                      s,
                      permission,
                      method,
                      req.params?.id,
                      req.body ?? {},
                      lock,
                    ),
              async () => {
                const ctx = currentDomainAccess()!;
                if (
                  !ctx.scope.tuples.some(
                    (t) => t.scope === 'COMPANY' || (t.scope === 'BRANCHES' && t.branchIds.length),
                  )
                )
                  throw new ForbiddenException('งานซ่อมไม่มีผู้รับมอบหมาย');
                const actor = await ctx.client.user.findUniqueOrThrow({
                  where: { id: snapshot.userId },
                });
                req.user.role = actor.role;
                return this.projection.project(await handler(), req.params?.id);
              },
              false,
              { isolationLevel: 'Serializable', maxAttempts: 3, retryUniqueConflict: true },
            )
          ).result;
        if (collection)
          return {
            kind: 'collection',
            company,
            execute: () => run(() => this.collection(method, req)),
          };
        return { kind: 'selection', company, execute: run };
      });
  }
  private async collection(method: string, req: Request) {
    const q = { ...req.query };
    delete q.company;
    const types = {
      list: ListRepairTicketsDto,
      warrantyPreview: WarrantyPreviewDto,
      warrantyLookup: WarrantyLookupDto,
      lookupByImei: LookupByImeiDto,
    };
    const Type = types[method as keyof typeof types];
    if (Object.values(q).some((v) => typeof v !== 'string'))
      throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
    const dto = plainToInstance(Type as typeof ListRepairTicketsDto, q);
    if ((await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).length)
      throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
    if (method === 'list' && (+(q.page ?? 1) - 1) * +(q.limit ?? 50) > 2147483647)
      throw new BadRequestException('หน้าไม่ถูกต้อง');
    const controller = this.modules.get(RepairTicketsController, { strict: false });
    if (method === 'list') return controller.list(dto, req);
    if (method === 'warrantyPreview')
      return controller.warrantyPreview(dto as WarrantyPreviewDto, req);
    if (method === 'warrantyLookup')
      return controller.warrantyLookup(dto as WarrantyLookupDto, req);
    return controller.lookupByImei(dto as unknown as LookupByImeiDto, req);
  }
}
