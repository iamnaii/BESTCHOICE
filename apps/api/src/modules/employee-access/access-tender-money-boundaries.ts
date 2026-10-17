import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PermissionKey } from '@installment/shared';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService } from './access-resource.service';
import { currentDomainAccess } from './access-execution-context';
import { procurementPreparation } from './access-preparation-context';
import { requestedAccessCompany } from './access-shop-boundaries';
import { projectTenderRead } from './access-tender-projection';
import { tenderAccess, TenderSourcePlan } from './access-tender-source';

export const TENDER_MONEY_METHODS = {
  countCashClose: 'shop-tenders.count',
  confirmCashClose: 'shop-tenders.confirm',
  sendBackCashClose: 'shop-tenders.confirm',
  attachDepositSlip: 'shop-tenders.confirm',
  createCashDeposit: 'shop-tenders.deposit',
  getCloseDepositSlip: 'shop-tenders.read',
  getCashDepositSlip: 'shop-tenders.read',
} as const satisfies Record<string, PermissionKey>;

export function assertCountingNote(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 5 || value.trim().length > 500)
    throw new BadRequestException('กรอกบันทึกการนับเงิน 5–500 ตัวอักษร');
  return value.trim();
}
@Injectable()
export class AccessTenderMoneyBoundaries implements OnModuleInit {
  constructor(private readonly resources: AccessResourceService) {}
  onModuleInit() {
    for (const [method, permission] of Object.entries(TENDER_MONEY_METHODS)) {
      ACCESS_BOUNDARIES.set(`ShopTendersController.${method}`, async (req, snapshot) => {
        if (requestedAccessCompany(req) !== 'SHOP')
          throw new ForbiddenException('ข้อมูลนี้เป็นเงินหน้าร้าน');
        const upload = ['attachDepositSlip', 'createCashDeposit'].includes(method);
        const read = permission === 'shop-tenders.read';
        const run = async <T>(handler: () => Promise<T>) =>
          (
            await this.resources
              .execute(
                snapshot.userId,
                permission,
                'SHOP',
                undefined,
                async () => {
                  const ctx = currentDomainAccess()!;
                  // Validate before source plan/expected-value queries. Nest DTOs still validate money.
                  if (method === 'countCashClose')
                    req.body.varianceReason = assertCountingNote(req.body?.varianceReason);
                  const id = req.params?.id;
                  let branchId = req.body?.branchId;
                  if (id) {
                    if (method === 'getCashDepositSlip') {
                      await ctx.client
                        .$queryRaw`SELECT id FROM shop_cash_deposits WHERE id=${id} FOR UPDATE`;
                      branchId = (await ctx.client.shopCashDeposit.findUnique({ where: { id } }))
                        ?.branchId;
                    } else {
                      await ctx.client
                        .$queryRaw`SELECT id FROM shop_cash_closes WHERE id=${id} FOR UPDATE`;
                      const row = await ctx.client.shopCashClose.findUnique({ where: { id } });
                      branchId = row?.branchId;
                    }
                  }
                  if (typeof branchId !== 'string' || !branchId)
                    throw new ForbiddenException('ไม่พบแหล่งเงินหน้าร้าน');
                  await ctx.client
                    .$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'shop-cash-close:' + branchId}))`;
                  const plan = await TenderSourcePlan.create(ctx.client, branchId, permission);
                  plan.assertComplete(branchId, permission, method !== 'countCashClose');
                  if (id && !read) {
                    const row = await ctx.client.shopCashClose.findUniqueOrThrow({ where: { id } });
                    if (row.countedById === ctx.snapshot.userId)
                      throw new ForbiddenException('ผู้นับต้องไม่เป็นผู้ยืนยันรายการเดียวกัน');
                    if (row.status !== 'PENDING_CONFIRM')
                      throw new ConflictException('สถานะการปิดยอดเปลี่ยนแล้ว');
                  }
                  if (
                    (upload && !plan.allows('documents.create', branchId)) ||
                    (read && !plan.allows('documents.read', branchId))
                  )
                    throw new ForbiddenException('ไม่มีสิทธิ์เอกสารของสาขานี้');
                  if (
                    method === 'createCashDeposit' &&
                    req.body?.source === 'OWNER_HOLD' &&
                    !plan.allows('shop-tenders.deposit-owner-hold', branchId)
                  )
                    throw new ForbiddenException('ไม่มีสิทธิ์นำฝากเงินที่เจ้าของเก็บ');
                  const actor = await ctx.client.user.findUniqueOrThrow({
                    where: { id: snapshot.userId },
                    select: { id: true, role: true, branchId: true },
                  });
                  req.user = { ...req.user, ...actor, access: ctx.snapshot };
                  return tenderAccess.run(plan, async () => {
                    const result = await handler();
                    if (
                      method === 'countCashClose' &&
                      result &&
                      typeof result === 'object' &&
                      'id' in result
                    )
                      return { id: result.id, status: 'PENDING_CONFIRM' } as T;
                    return (
                      ['confirmCashClose', 'sendBackCashClose', 'createCashDeposit'].includes(
                        method,
                      )
                        ? projectTenderRead(plan, method, result)
                        : result
                    ) as T;
                  });
                },
                false,
                { isolationLevel: 'Serializable', maxAttempts: 3 },
              )
              .catch((error) => {
                if (error instanceof HttpException) throw error;
                throw new ServiceUnavailableException('ไม่สามารถทำรายการเงินหน้าร้านได้');
              })
          ).result;
        return {
          kind: 'selection',
          company: 'SHOP',
          execute: upload
            ? (handler) =>
                procurementPreparation.run(
                  {
                    source: 'shop-cash-slip',
                    execute: run,
                    authorize: async () => {
                      await run(async () => undefined);
                    },
                  },
                  handler,
                )
            : run,
        };
      });
    }
  }
}
