import { PartyMergeSources } from './access-party-merge-source';
import { ModuleRef } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { CustomersController } from '../customers/customers.controller';
import { ContactsController } from '../contacts/contacts.controller';
import { CustomersListQueryDto } from '../customers/dto/customers-list-query.dto';
import { ListContactsDto } from '../contacts/dto/list-contacts.dto';
import { PartyQueryPlan, withPartyQuery } from './access-party-query-plan';
import { AccessPartySourceService } from './access-party-source.service';
import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService } from './access-resource.service';
import { currentDomainAccess } from './access-execution-context';
import { requestedAccessCompany } from './access-shop-boundaries';

export const PARTY_WRITE_ROUTES = [
  'CustomersController.create',
  'CustomersController.update',
  'CustomersController.remove',
  'CustomersController.fillContact',
  'CustomersController.updateContact',
  'ContactsController.ensureRole',
  'CustomersController.absorbInto',
  'ContactsController.merge',
] as const;
export const PARTY_QUERY_ROUTES = [
  'CustomersController.findAll',
  'CustomersController.findOne',
  'CustomersController.findDetail',
  'CustomersController.search',
  'ContactsController.list',
  'ContactsController.findOne',
] as const;
export const PARTY_DERIVED_ROUTES = [
  'CustomersController.exportRows',
  'CustomersController.getChatSummary',
  'CustomersController.getContracts',
  'CustomersController.getInsights',
  'CustomersController.getReferrals',
  'CustomersController.getReferralStats',
  'CustomersController.getRiskFlag',
  'CustomersController.getSummary',
  'CustomersController.getTier',
  'CustomersController.getUpsellCandidates',
  'CustomersController.getWatchList',
] as const;
@Injectable()
export class AccessPartyBoundaries implements OnModuleInit {
  constructor(
    private readonly resources: AccessResourceService,
    private readonly sources: AccessPartySourceService,
    private readonly modules: ModuleRef,
  ) {}
  onModuleInit() {
    for (const route of [...PARTY_QUERY_ROUTES, ...PARTY_DERIVED_ROUTES])
      ACCESS_BOUNDARIES.set(route, async (req, snapshot, permission) => {
        const company = requestedAccessCompany(req);
        const run = async (handler: () => Promise<unknown>) =>
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
                  select: { id: true, role: true },
                });
                req.user = { ...req.user, id: actor.id, role: actor.role, access: ctx.snapshot };
                const plan = await PartyQueryPlan.create(
                  ctx.client,
                  this.sources,
                  route === 'CustomersController.exportRows'
                    ? 'customers.export'
                    : 'customers.read',
                );
                return withPartyQuery(plan, handler);
              },
              false,
              {
                domain: 'parties',
                isolationLevel: 'Serializable',
                maxAttempts: 3,
                ...(route === 'CustomersController.exportRows'
                  ? { timeoutMs: 60000 as const }
                  : {}),
              },
            )
          ).result;
        if (
          route === 'CustomersController.findAll' ||
          route === 'CustomersController.search' ||
          route === 'ContactsController.list' ||
          [
            'exportRows',
            'getChatSummary',
            'getContracts',
            'getReferralStats',
            'getSummary',
            'getUpsellCandidates',
            'getWatchList',
          ].some((method) => route === `CustomersController.${method}`)
        )
          return {
            kind: 'collection',
            company,
            execute: () =>
              run(async () => {
                const controller = this.modules.get(CustomersController, { strict: false });
                const id = String(req.params?.id ?? '');
                const limit = req.query?.limit === undefined ? undefined : String(req.query.limit);
                const branchId =
                  req.query?.branchId === undefined ? undefined : String(req.query.branchId);
                if (route === 'CustomersController.getChatSummary')
                  return controller.getChatSummary(id, req);
                if (route === 'CustomersController.getContracts')
                  return controller.getContracts(id);
                if (route === 'CustomersController.getSummary') return controller.getSummary(id);
                if (route === 'CustomersController.getReferralStats')
                  return controller.getReferralStats(limit);
                if (route === 'CustomersController.getUpsellCandidates')
                  return controller.getUpsellCandidates(branchId, limit);
                if (route === 'CustomersController.getWatchList')
                  return controller.getWatchList(branchId, limit);
                if (route === 'CustomersController.search')
                  return this.modules
                    .get(CustomersController, { strict: false })
                    .search(String(req.query?.q ?? ''), req);
                if (
                  route === 'CustomersController.findAll' ||
                  route === 'CustomersController.exportRows'
                ) {
                  const dto = plainToInstance(CustomersListQueryDto, req.query ?? {});
                  if ((await validate(dto, { whitelist: true })).length)
                    throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
                  return route === 'CustomersController.exportRows'
                    ? controller.exportRows(dto, req)
                    : controller.findAll(dto, req);
                }
                const dto = plainToInstance(ListContactsDto, req.query ?? {});
                if ((await validate(dto, { whitelist: true })).length)
                  throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
                return this.modules.get(ContactsController, { strict: false }).list(dto);
              }),
          };
        return { kind: 'selection', company, execute: run };
      });
    for (const route of PARTY_WRITE_ROUTES)
      ACCESS_BOUNDARIES.set(route, async (req, snapshot, permission) => {
        const company = requestedAccessCompany(req);
        return {
          kind: 'selection',
          company,
          execute: async (handler) => {
            try {
              return (
                await this.resources.execute(
                  snapshot.userId,
                  permission,
                  company,
                  undefined,
                  async () => {
                    const ctx = currentDomainAccess()!;
                    const actor = await ctx.client.user.findUniqueOrThrow({
                      where: { id: ctx.snapshot.userId },
                    });
                    req.user = {
                      ...req.user,
                      id: actor.id,
                      role: actor.role,
                      access: ctx.snapshot,
                    };
                    if (route === 'CustomersController.absorbInto')
                      await new PartyMergeSources(this.sources, this.resources).absorb(
                        String(req.params?.id ?? ''),
                        String(req.params?.targetId ?? ''),
                      );
                    if (route === 'ContactsController.merge')
                      await new PartyMergeSources(this.sources, this.resources).mergeContacts(
                        String(req.body?.primaryId ?? ''),
                        String(req.body?.duplicateId ?? ''),
                      );
                    const result = (await handler()) as Record<string, unknown>;
                    if (
                      route === 'CustomersController.fillContact' ||
                      route === 'CustomersController.updateContact'
                    )
                      return {
                        id: result.id,
                        changedFields: result.changedFields,
                        ...(route === 'CustomersController.updateContact'
                          ? { phoneStoredAs: result.phoneStoredAs }
                          : {}),
                      };
                    if (route === 'CustomersController.absorbInto')
                      return { placeholderId: result.placeholderId, targetId: result.targetId };
                    if (route === 'ContactsController.merge')
                      return { primaryId: result.primaryId, duplicateId: req.body?.duplicateId };
                    // Mutation acknowledgement never doubles as a broad party/history read.
                    return route === 'ContactsController.ensureRole'
                      ? {
                          contactId: result.contactId,
                          role: result.role,
                          ...(result.customerId ? { customerId: result.customerId } : {}),
                          ...(result.supplierId ? { supplierId: result.supplierId } : {}),
                          provisioned: result.provisioned,
                        }
                      : { id: result.id };
                  },
                  false,
                  {
                    domain: 'parties',
                    isolationLevel: 'Serializable',
                    maxAttempts: 3,
                    retryUniqueConflict: true,
                  },
                )
              ).result;
            } catch (error) {
              if (
                error instanceof ConflictException ||
                (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
              )
                throw new ConflictException('ข้อมูลซ้ำหรือเปลี่ยนแปลง กรุณาตรวจสอบแล้วลองใหม่');
              throw error;
            }
          },
        };
      });
  }
}
