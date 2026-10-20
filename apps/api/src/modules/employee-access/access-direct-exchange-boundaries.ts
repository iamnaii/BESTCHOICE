import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { isUUID, validate } from 'class-validator';
import { ContractExchangeService } from '../contract-exchange/contract-exchange.service';
import { ExchangeCancelService } from '../contract-exchange/contract-exchange-cancel.service';
import { SubmitExchangeRequestDto } from '../contract-exchange/dto/submit-exchange-request.dto';
import { ApproveExchangeRequestDto } from '../contract-exchange/dto/approve-exchange-request.dto';
import { CancelExchangeRequestDto } from '../contract-exchange/dto/cancel-exchange-request.dto';
import { RejectExchangeRequestDto } from '../contract-exchange/dto/reject-exchange-request.dto';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService } from './access-resource.service';
import { AccessExchangeSourceService } from './access-exchange-source.service';
import { currentDomainAccess } from './access-execution-context';
import { requestedAccessCompany } from './access-shop-boundaries';
import { directExchangeProjection } from './access-direct-exchange-projection';

export const DIRECT_EXCHANGE_ROUTES = [
  'submit',
  'preview',
  'listPending',
  'listRecent',
  'approve',
  'reject',
  'cancel',
].map((method) => `ContractExchangeController.${method}`);
@Injectable()
export class AccessDirectExchangeBoundaries implements OnModuleInit {
  constructor(
    private readonly modules: ModuleRef,
    private readonly resources: AccessResourceService,
    private readonly sources: AccessExchangeSourceService,
  ) {}
  onModuleInit() {
    for (const route of DIRECT_EXCHANGE_ROUTES)
      ACCESS_BOUNDARIES.set(route, async (req, snapshot, permission) => {
        if (requestedAccessCompany(req) !== 'SHOP')
          throw new ForbiddenException('งานเปลี่ยนเครื่องอยู่ใน SHOP');
        const method = route.split('.')[1];
        const execute = async () =>
          (
            await this.resources.execute(
              snapshot.userId,
              permission,
              'SHOP',
              undefined,
              async () => {
                const ctx = currentDomainAccess()!;
                const actor = await ctx.client.user.findUniqueOrThrow({
                  where: { id: ctx.snapshot.userId },
                  select: { id: true, role: true, branchId: true },
                });
                const service = this.modules.get(ContractExchangeService, { strict: false });
                try {
                  if (method === 'listPending' || method === 'listRecent') {
                    const rows = await service[method](actor);
                    const output: Array<Awaited<ReturnType<typeof directExchangeProjection>>> = [];
                    for (const row of rows)
                      output.push(
                        await directExchangeProjection(row.id, this.sources, this.resources),
                      );
                    return output;
                  }
                  if (method === 'preview') {
                    const q = req.query ?? {};
                    if (
                      typeof q.oldContractId !== 'string' ||
                      !isUUID(q.oldContractId) ||
                      (q.newProductId !== undefined &&
                        (typeof q.newProductId !== 'string' || !isUUID(q.newProductId))) ||
                      (q.newTotalMonths !== undefined &&
                        (typeof q.newTotalMonths !== 'string' ||
                          !/^\d+$/.test(q.newTotalMonths) ||
                          +q.newTotalMonths < 1 ||
                          +q.newTotalMonths > 48)) ||
                      [q.buybackPrice, q.newInterestRate].some(
                        (v) =>
                          v !== undefined && (typeof v !== 'string' || !/^\d+(\.\d+)?$/.test(v)),
                      ) ||
                      (q.buybackPrice !== undefined &&
                        (!Number.isFinite(+q.buybackPrice) || +q.buybackPrice <= 0)) ||
                      (q.newInterestRate !== undefined &&
                        (!Number.isFinite(+q.newInterestRate) || +q.newInterestRate > 0.15)) ||
                      (q.deviceCondition !== undefined &&
                        !['A', 'B', 'C', 'D'].includes(q.deviceCondition))
                    )
                      throw new BadRequestException('ข้อมูลการตรวจสอบไม่ถูกต้อง');
                    return service.buildPreview(
                      {
                        oldContractId: q.oldContractId,
                        newProductId: q.newProductId,
                        buybackPrice: q.buybackPrice,
                        deviceCondition: q.deviceCondition,
                        newTotalMonths:
                          q.newTotalMonths === undefined ? undefined : +q.newTotalMonths,
                        newInterestRate: q.newInterestRate,
                      },
                      actor,
                    );
                  }
                  let id: string;
                  if (method === 'submit') {
                    const dto = plainToInstance(SubmitExchangeRequestDto, req.body ?? {});
                    if ((await validate(dto, { whitelist: true })).length)
                      throw new BadRequestException('ข้อมูลการเปลี่ยนเครื่องไม่ถูกต้อง');
                    if (dto.conditionPhotos?.length)
                      throw new BadRequestException('ยังไม่รองรับรูปแนบในการเปลี่ยนเครื่องโดยตรง');
                    id = (await service.submit(dto, actor)).id;
                  } else {
                    id = req.params?.id;
                    if (typeof id !== 'string' || !isUUID(id))
                      throw new BadRequestException('คำขอไม่ถูกต้อง');
                    if (method === 'approve') {
                      const dto = plainToInstance(ApproveExchangeRequestDto, req.body ?? {});
                      if ((await validate(dto, { whitelist: true })).length)
                        throw new BadRequestException('ข้อมูลอนุมัติไม่ถูกต้อง');
                      await service.approve(id, actor, dto);
                    } else if (method === 'reject') {
                      const dto = plainToInstance(RejectExchangeRequestDto, req.body ?? {});
                      if ((await validate(dto, { whitelist: true })).length)
                        throw new BadRequestException('เหตุผลไม่ถูกต้อง');
                      await service.reject(id, dto.reason, actor.id);
                    } else {
                      const dto = plainToInstance(CancelExchangeRequestDto, req.body ?? {});
                      if ((await validate(dto, { whitelist: true })).length)
                        throw new BadRequestException('เหตุผลไม่ถูกต้อง');
                      await this.modules
                        .get(ExchangeCancelService, { strict: false })
                        .cancel(id, dto.reason, actor);
                    }
                  }
                  return directExchangeProjection(id, this.sources, this.resources, true);
                } catch (error) {
                  if (error instanceof HttpException && [400, 409].includes(error.getStatus()))
                    throw new HttpException(
                      'ไม่สามารถดำเนินการตามสถานะหรือเงื่อนไขปัจจุบัน',
                      error.getStatus(),
                    );
                  throw error;
                }
              },
              false,
              { isolationLevel: 'Serializable', maxAttempts: 3 },
            )
          ).result;
        return ['preview', 'listPending', 'listRecent'].includes(method)
          ? { kind: 'collection', company: 'SHOP', execute }
          : { kind: 'selection', company: 'SHOP', execute };
      });
  }
}
