import { BadRequestException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { isISO8601, isUUID, validate } from 'class-validator';
import { DefectExchangeService } from '../defect-exchange/defect-exchange.service';
import { ExecuteDefectExchangeDto } from '../defect-exchange/dto/defect-exchange.dto';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService } from './access-resource.service';
import { currentDomainAccess } from './access-execution-context';
import { requestedAccessCompany } from './access-shop-boundaries';

export const DEFECT_BOUNDARY_ROUTES = ['getEligibility', 'execute', 'list'].map(
  (method) => `DefectExchangeController.${method}`,
);

@Injectable()
export class AccessDefectBoundaries implements OnModuleInit {
  constructor(
    private readonly modules: ModuleRef,
    private readonly resources: AccessResourceService,
  ) {}

  onModuleInit() {
    for (const route of DEFECT_BOUNDARY_ROUTES)
      ACCESS_BOUNDARIES.set(route, async (req, snapshot, permission) => {
        const company = requestedAccessCompany(req);
        if (company !== 'SHOP') throw new ForbiddenException('งานเปลี่ยนเครื่องอยู่ใน SHOP');
        const execute = async () =>
          (
            await this.resources.execute(
              snapshot.userId,
              permission,
              company,
              undefined,
              async () => {
                const ctx = currentDomainAccess()!;
                const actor = await ctx.client.user.findUniqueOrThrow({
                  where: { id: ctx.snapshot.userId },
                  select: { id: true, role: true, branchId: true },
                });
                const service = this.modules.get(DefectExchangeService, { strict: false });
                if (route === 'DefectExchangeController.execute') {
                  const dto = plainToInstance(ExecuteDefectExchangeDto, req.body ?? {});
                  if ((await validate(dto, { whitelist: true })).length)
                    throw new BadRequestException('ข้อมูลการเปลี่ยนเครื่องไม่ถูกต้อง');
                  // Raw URLs have no verified document producer. Other canonical
                  // repair/after-sales callers retain their separately reviewed contract.
                  if (dto.photoUrls?.length)
                    throw new BadRequestException('ยังไม่รองรับรูปแนบในการเปลี่ยนเครื่องโดยตรง');
                  return service.execute(dto, actor);
                }
                const q = req.query ?? {};
                if (route === 'DefectExchangeController.getEligibility') {
                  if (
                    typeof req.params?.contractId !== 'string' ||
                    (q.newProductId !== undefined && typeof q.newProductId !== 'string')
                  )
                    throw new BadRequestException('ข้อมูลการตรวจสอบไม่ถูกต้อง');
                  return service.checkEligibility(req.params.contractId, q.newProductId, actor);
                }
                for (const key of ['branchId', 'from', 'to']) {
                  if (
                    q[key] !== undefined &&
                    (typeof q[key] !== 'string' ||
                      (key === 'branchId' ? !isUUID(q[key]) : !isISO8601(q[key])))
                  )
                    throw new BadRequestException('ตัวกรองประวัติไม่ถูกต้อง');
                }
                if (q.from && q.to && new Date(q.from) > new Date(q.to))
                  throw new BadRequestException('ช่วงวันที่ไม่ถูกต้อง');
                return service.list({ branchId: q.branchId, from: q.from, to: q.to }, actor, true);
              },
              false,
              { isolationLevel: 'Serializable', maxAttempts: 3 },
            )
          ).result;
        return route === 'DefectExchangeController.list'
          ? { kind: 'collection', company, execute }
          : { kind: 'selection', company, execute };
      });
  }
}
