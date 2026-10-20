import { ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { canAccess, PermissionKey } from '@installment/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { hasCrossBranchAccess } from '../auth/branch-access.util';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService, retryable } from './access-resource.service';
import { AccessPartySourceService } from './access-party-source.service';
import { currentDomainAccess, isCurrentDomainClient } from './access-execution-context';
import { currentPreparationSource } from './access-contract-preparation-source';
import { PreparationReadProjection } from './access-contract-preparation-projection';
import { requestedAccessCompany } from './access-shop-boundaries';

export type ConsentOperation =
  | 'getQrData'
  | 'getPdpaConsent'
  | 'recordPdpaConsent'
  | 'generateAccessToken';
const permissions: Record<ConsentOperation, PermissionKey> = {
  getQrData: 'contracts.read',
  getPdpaConsent: 'contracts.read',
  recordPdpaConsent: 'contracts.update',
  generateAccessToken: 'documents.share',
};
const roles: Record<ConsentOperation, readonly string[]> = {
  getQrData: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES'],
  getPdpaConsent: ['OWNER', 'BRANCH_MANAGER', 'SALES'],
  recordPdpaConsent: ['OWNER', 'BRANCH_MANAGER', 'SALES'],
  generateAccessToken: ['OWNER', 'BRANCH_MANAGER', 'SALES'],
};
const select = {
  id: true,
  contractNumber: true,
  contractHash: true,
  branchId: true,
  customerId: true,
  productId: true,
  pdpaConsentId: true,
  status: true,
  workflowStatus: true,
  salespersonId: true,
} satisfies Prisma.ContractSelect;
type Contract = Prisma.ContractGetPayload<{ select: typeof select }>;
const denied = () => new ForbiddenException('ไม่มีสิทธิ์ดำเนินการกับสัญญานี้');

/** Four finite adapters; canonical methods repeat the exact action/source proof for direct callers. */
@Injectable()
export class AccessContractConsentAuthority implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: AccessResourceService,
    private readonly parties: AccessPartySourceService,
  ) {}
  onModuleInit() {
    for (const operation of Object.keys(permissions) as ConsentOperation[]) {
      const controller =
        operation === 'generateAccessToken' ? 'CustomerAccessController' : 'ContractsController';
      ACCESS_BOUNDARIES.set(`${controller}.${operation}`, async (req, snapshot) => {
        const company = requestedAccessCompany(req);
        if (
          !company ||
          (operation === 'recordPdpaConsent' && company !== 'SHOP') ||
          (operation === 'generateAccessToken' && company !== 'FINANCE')
        )
          throw denied();
        return {
          kind: 'selection',
          company,
          execute: async (handler) =>
            (
              await this.resources.execute(
                snapshot.userId,
                permissions[operation],
                company,
                undefined,
                handler,
                false,
                { domain: 'parties', isolationLevel: 'Serializable', maxAttempts: 3 },
              )
            ).result,
        };
      });
    }
  }
  async run<T>(
    id: string,
    operation: ConsentOperation,
    actorId: string | undefined,
    handler: (tx: Prisma.TransactionClient, row: Contract, actor: string) => Promise<T>,
  ): Promise<T> {
    const ctx = currentDomainAccess();
    if (ctx) {
      if (
        ctx.scopeReads ||
        ctx.isolationLevel !== 'Serializable' ||
        !isCurrentDomainClient(ctx.client) ||
        !ctx.snapshot.managed ||
        (actorId !== undefined && actorId !== ctx.snapshot.userId) ||
        ctx.scope.permission !== permissions[operation]
      )
        throw denied();
      const tx = ctx.client;
      await tx.$queryRaw`SELECT id FROM contracts WHERE id=${id} FOR UPDATE`;
      const source =
        ctx.scope.company === 'SHOP'
          ? (
              await currentPreparationSource(
                id,
                operation === 'recordPdpaConsent'
                  ? ['contracts.update']
                  : ['contracts.read', 'contracts.update'],
              )
            ).source
          : await this.parties.financeContract(tx, id, true);
      if (
        (operation === 'recordPdpaConsent' && source.company !== 'SHOP') ||
        (operation === 'generateAccessToken' && source.company !== 'FINANCE')
      )
        throw denied();
      const required: PermissionKey[] =
        operation === 'recordPdpaConsent'
          ? ['contracts.update', 'documents.create']
          : operation === 'generateAccessToken'
            ? [
                'contracts.read',
                'documents.share',
                'payments.read',
                'receipts.read',
                'documents.read',
                'contract-documents.read',
              ]
            : operation === 'getQrData'
              ? ['contracts.read', 'documents.share', 'documents.read', 'contract-documents.read']
              : ['contracts.read', 'documents.read'];
      if (required.some((permission) => !canAccess(ctx.snapshot, permission, source)))
        throw denied();
      const row = await tx.contract.findFirst({ where: { id, deletedAt: null }, select });
      if (!row) throw denied();
      if (operation === 'recordPdpaConsent' || operation === 'generateAccessToken') {
        await tx.$queryRaw`SELECT id FROM customers WHERE id=${row.customerId} FOR SHARE`;
        if (
          !(await tx.customer.count({
            where: { id: row.customerId, deletedAt: null, mergedIntoId: null },
          }))
        )
          throw denied();
        // R112/R122: exact-parent identity lanes, never sibling-history traversal.
        const projection = await new PreparationReadProjection().initialize();
        if (!(await tx.contract.count({ where: { id, AND: projection.customerWhere() } })))
          throw denied();
        if (operation === 'generateAccessToken') {
          const product = await this.resources.product(tx, row.productId, true);
          if (!canAccess(ctx.snapshot, 'products.read', product)) throw denied();
        }
      }
      if (operation === 'getQrData' && source.company === 'SHOP') {
        await tx.$queryRaw`SELECT id FROM signatures WHERE contract_id=${id} ORDER BY id FOR SHARE`;
        const signatures = await tx.signature.findMany({
          where: { contractId: id, deletedAt: null },
          select: { signerType: true },
        });
        if (
          !signatures.some((s) => s.signerType === 'CUSTOMER') ||
          !signatures.some((s) => s.signerType === 'COMPANY' || s.signerType === 'STAFF')
        )
          throw denied();
      }
      return handler(tx, row, ctx.snapshot.userId);
    }
    // Explicit compatibility lane only: no actorless or managed-user fallback.
    if (!actorId) throw denied();
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM users WHERE id=${actorId} FOR SHARE`;
            const actor = await tx.user.findUnique({ where: { id: actorId } });
            if (
              !actor ||
              actor.accessManaged ||
              !actor.isActive ||
              actor.deletedAt ||
              actor.isSystemUser ||
              !roles[operation].includes(actor.role)
            )
              throw denied();
            await tx.$queryRaw`SELECT id FROM contracts WHERE id=${id} FOR UPDATE`;
            const row = await tx.contract.findFirst({ where: { id, deletedAt: null }, select });
            if (
              !row ||
              (!hasCrossBranchAccess(actor) && (!actor.branchId || actor.branchId !== row.branchId))
            )
              throw denied();
            if (operation === 'generateAccessToken') {
              await this.parties.financeContract(tx, id, true);
              await tx.$queryRaw`SELECT id FROM customers WHERE id=${row.customerId} FOR SHARE`;
              if (
                !(await tx.customer.count({
                  where: { id: row.customerId, deletedAt: null, mergedIntoId: null },
                }))
              )
                throw denied();
            }
            return handler(tx, row, actor.id);
          },
          { isolationLevel: 'Serializable', timeout: 30000 },
        );
      } catch (error) {
        if (attempt < 3 && retryable(error, false)) continue;
        throw error;
      }
    }
  }
}
