import { MAX_CONTRACT_BUNDLES } from '../contracts/services/contract-bundle.util';
import { BadRequestException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { canAccess, ContractPreparationAcknowledgement } from '@installment/shared';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService } from './access-resource.service';
import { AccessPartySourceService } from './access-party-source.service';
import { currentDomainAccess } from './access-execution-context';
import { currentPreparationSource } from './access-contract-preparation-source';
import { requestedAccessCompany } from './access-shop-boundaries';
import { customerPartyWhere } from './access-party-scope';
import { preparationScope } from './access-contract-preparation-source';

export const CONTRACT_PREPARATION_ROUTES = [
  'quote',
  'create',
  'update',
  'updateBundles',
  'validateForSubmit',
].map((method) => `ContractsController.${method}`);
@Injectable()
export class AccessContractPreparationActions implements OnModuleInit {
  constructor(
    private readonly resources: AccessResourceService,
    private readonly parties: AccessPartySourceService,
  ) {}
  onModuleInit() {
    for (const route of CONTRACT_PREPARATION_ROUTES)
      ACCESS_BOUNDARIES.set(route, async (req, snapshot, permission) => {
        if (requestedAccessCompany(req) !== 'SHOP')
          throw new ForbiddenException('คำขอนี้อยู่ในงานหน้าร้าน');
        const method = route.split('.')[1];
        return {
          kind: 'selection',
          company: 'SHOP',
          execute: async (handler) =>
            (
              await this.resources.execute(
                snapshot.userId,
                permission,
                'SHOP',
                undefined,
                async () => {
                  const ctx = currentDomainAccess()!,
                    tx = ctx.client;
                  const input = ['quote', 'create'].includes(method)
                    ? req.body
                    : await currentPreparationSource(String(req.params?.id ?? ''), [
                        'contracts.update',
                      ]);
                  if (
                    !input ||
                    typeof input.customerId !== 'string' ||
                    typeof input.productId !== 'string' ||
                    typeof input.branchId !== 'string'
                  )
                    throw new BadRequestException('ข้อมูลต้นทางไม่ถูกต้อง');
                  const destination = await this.resources.branch(tx, input.branchId, true);
                  if (
                    destination.company !== 'SHOP' ||
                    !canAccess(ctx.snapshot, permission, destination)
                  )
                    throw new ForbiddenException('ไม่มีสิทธิ์เตรียมสัญญาที่สาขานี้');
                  // Genuine pre-parent Customer evidence, independent of the destination.
                  // Lock every current contributing identity source before querying the predicate.
                  await this.parties.customer(tx, input.customerId, true, false, true);
                  const liveCompanies = await tx.companyInfo.findMany({
                    where: {
                      companyCode: { in: ['SHOP', 'FINANCE'] },
                      isActive: true,
                      deletedAt: null,
                    },
                    select: { companyCode: true },
                  });
                  if (
                    !(await tx.customer.count({
                      where: {
                        id: input.customerId,
                        mergedIntoId: null,
                        OR: (['SHOP', 'FINANCE'] as const)
                          .filter((company) =>
                            liveCompanies.some((row) => row.companyCode === company),
                          )
                          .map((company) =>
                            customerPartyWhere(
                              preparationScope(ctx.snapshot, 'customers.read', company),
                            ),
                          ),
                      },
                    }))
                  )
                    throw new ForbiddenException('ไม่มีสิทธิ์อ่านลูกค้าต้นทาง');
                  if (
                    input.bundleProductIds != null &&
                    (!Array.isArray(input.bundleProductIds) ||
                      input.bundleProductIds.some((id: unknown) => typeof id !== 'string'))
                  )
                    throw new BadRequestException('สินค้าของแถมไม่ถูกต้อง');
                  const next = method === 'updateBundles' ? req.body?.bundleProductIds : [];
                  if (
                    next != null &&
                    (!Array.isArray(next) || next.some((id: unknown) => typeof id !== 'string'))
                  )
                    throw new BadRequestException('สินค้าของแถมไม่ถูกต้อง');
                  if (
                    (input.bundleProductIds?.length ?? 0) > MAX_CONTRACT_BUNDLES ||
                    (next?.length ?? 0) > MAX_CONTRACT_BUNDLES
                  )
                    throw new BadRequestException('ของแถมต่อสัญญาได้ไม่เกิน 10 ชิ้น');
                  const ids = [
                    ...new Set<string>([
                      input.productId,
                      ...(input.bundleProductIds ?? []),
                      ...(next ?? []),
                    ]),
                  ].sort();
                  for (const id of ids) {
                    const source = await this.resources.product(tx, id, true);
                    if (
                      source.company !== 'SHOP' ||
                      source.branchId !== input.branchId ||
                      !canAccess(ctx.snapshot, 'products.read', source)
                    )
                      throw new ForbiddenException('ไม่มีสิทธิ์อ่านสินค้าต้นทาง');
                  }
                  const result = await handler();
                  if (['quote', 'validateForSubmit'].includes(method)) return result;
                  const id = method === 'create' ? (result as { id: string }).id : input.id;
                  await tx.auditLog.create({
                    data: {
                      userId: ctx.snapshot.userId,
                      action: 'CONTRACT_PREPARATION_' + method.toUpperCase(),
                      entity: 'contract',
                      entityId: id,
                      newValue: {
                        operation: method,
                        source: 'SHOP',
                        outcome: 'SUCCESS',
                        ...(method === 'create'
                          ? {
                              activeContractOverrideRequested:
                                req.body.overrideActiveContractCheck === true,
                              previouslyDamagedAcknowledged:
                                req.body.previouslyDamagedAcknowledged === true,
                            }
                          : {}),
                      },
                    },
                  });
                  // A successful write is not a read grant. Reload is a separate explicit mode.
                  return {
                    id,
                    view: 'SHOP_PREPARATION',
                    applicationState: 'PRE_ACTIVATION',
                  } satisfies ContractPreparationAcknowledgement;
                },
                false,
                { isolationLevel: 'Serializable', maxAttempts: 3, retryUniqueConflict: true },
              )
            ).result,
        };
      });
  }
}
