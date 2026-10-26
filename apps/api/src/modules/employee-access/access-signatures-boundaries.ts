import { AsyncLocalStorage } from 'node:async_hooks';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { AccessSnapshot, canAccess, PermissionKey } from '@installment/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessResourceService } from './access-resource.service';
import { AccessPartySourceService } from './access-party-source.service';
import { AccessSnapshotService, lockEmployeeAccess } from './access-snapshot.service';
import { currentDomainAccess, domainAccessExecution } from './access-execution-context';
import { currentPreparationSource } from './access-contract-preparation-source';
import { currentFinanceReadWhere } from './access-contract-read-scope';
import { requestedAccessCompany } from './access-shop-boundaries';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { hasCrossBranchAccess } from '../auth/branch-access.util';
import { GeneratedRequest, generatedSensitive } from './access-generated-documents-context';

export const SIGNATURE_OPERATIONS = ['signContract', 'getSignatures', 'deleteSignature'] as const;
export type SignatureOperation = (typeof SIGNATURE_OPERATIONS)[number];
export const signatureHandlers = new WeakMap<object, ReadonlyMap<object, SignatureOperation>>();
export const signatureDenied = () => new ForbiddenException('ไม่มีสิทธิ์เข้าถึงลายเซ็น');
export interface SignatureAuthority {
  tx: Prisma.TransactionClient;
  actorId: string;
  snapshot: AccessSnapshot;
  managed: boolean;
  owner: boolean;
  company: 'SHOP' | 'FINANCE';
  parent: {
    id: string;
    customerId: string;
    branchId: string;
    productId: string;
    bundleProductIds: string[];
    salespersonId: string;
  };
  visible: boolean;
  privateVisible: boolean;
  operation: SignatureOperation;
}
const genuine = new WeakSet<SignatureAuthority>();
const execution = new AsyncLocalStorage<SignatureAuthority>();
export function currentSignatureAuthority(operation: SignatureOperation) {
  const proof = execution.getStore();
  if (!proof || proof.operation !== operation) throw signatureDenied();
  assertSignatureAuthority(proof);
  return proof;
}
export function assertSignatureAuthority(proof: SignatureAuthority) {
  const ctx = currentDomainAccess();
  if (
    !genuine.has(proof) ||
    ctx?.client !== proof.tx ||
    ctx.snapshot.userId !== proof.actorId ||
    ctx.isolationLevel !== 'Serializable' ||
    !ctx.effects
  )
    throw signatureDenied();
}
const permission = (op: SignatureOperation): PermissionKey =>
  op === 'getSignatures' ? 'documents.read' : 'contract-documents.update';
@Injectable()
export class AccessSignaturesBoundaries implements OnModuleInit {
  private readonly preflights = new WeakSet<object>();
  private readonly admitted = new WeakMap<
    object,
    { operation: SignatureOperation; actorId: string; company: string }
  >();
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: AccessResourceService,
    private readonly parties: AccessPartySourceService,
    private readonly snapshots: AccessSnapshotService,
  ) {}
  onModuleInit() {
    for (const op of SIGNATURE_OPERATIONS)
      ACCESS_BOUNDARIES.set(`DocumentsController.${op}`, async (req) => ({
        kind: 'selection',
        company: requestedAccessCompany(req),
        execute: (handler) => handler(),
      }));
  }
  async preflight(op: SignatureOperation, req: GeneratedRequest) {
    this.preflights.add(req);
    try {
      await this.current(op, req, async () => undefined);
    } finally {
      this.preflights.delete(req);
    }
    this.admitted.set(req, {
      operation: op,
      actorId: req.user!.id!,
      company: requestedAccessCompany(req),
    });
  }
  async current<T>(
    op: SignatureOperation,
    req: GeneratedRequest,
    work: (proof: SignatureAuthority) => Promise<T>,
  ): Promise<T> {
    this.validate(op, req);
    if (!this.preflights.has(req)) {
      const admission = this.admitted.get(req);
      if (
        !admission ||
        admission.operation !== op ||
        admission.actorId !== req.user?.id ||
        admission.company !== requestedAccessCompany(req)
      )
        throw signatureDenied();
    }
    const actorId = req.user?.id;
    if (!actorId) throw signatureDenied();
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { accessManaged: true },
    });
    if (!actor) throw signatureDenied();
    const company = requestedAccessCompany(req);
    const run = async (tx: Prisma.TransactionClient, snapshot: AccessSnapshot) => {
      const live = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
      if (
        !live.isActive ||
        live.deletedAt ||
        live.isSystemUser ||
        live.accessManaged !== snapshot.managed
      )
        throw signatureDenied();
      const mutation = op !== 'getSignatures';
      if (
        !snapshot.managed &&
        !(
          mutation
            ? ['OWNER', 'BRANCH_MANAGER', 'SALES']
            : ['OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT']
        ).includes(live.role)
      )
        throw signatureDenied();
      await tx.$queryRaw`SELECT id FROM contracts WHERE id=${String(req.params.id)} FOR UPDATE`;
      const parent = await tx.contract.findUnique({
        where: { id: String(req.params.id), deletedAt: null },
        select: {
          id: true,
          customerId: true,
          branchId: true,
          productId: true,
          bundleProductIds: true,
          salespersonId: true,
        },
      });
      if (!parent) throw new NotFoundException('ไม่พบสัญญา');
      let visible = true,
        privateVisible = true;
      if (!snapshot.managed) {
        if (!hasCrossBranchAccess(live) && live.branchId !== parent.branchId)
          throw signatureDenied();
      } else {
        if (mutation && company !== 'SHOP') throw signatureDenied();
        const source =
          company === 'SHOP'
            ? (
                await currentPreparationSource(
                  parent.id,
                  mutation ? ['contracts.read', 'contracts.update'] : ['contracts.read'],
                )
              ).source
            : await this.parties.financeContract(tx, parent.id, true);
        if (
          company === 'FINANCE' &&
          !(await tx.contract.count({
            where: { id: parent.id, AND: await currentFinanceReadWhere('contracts.read') },
          }))
        )
          throw signatureDenied();
        if (!canAccess(snapshot, permission(op), source)) throw signatureDenied();
        const customerSources = await this.parties.customer(
          tx,
          parent.customerId,
          true,
          false,
          true,
        );
        if (company === 'FINANCE') customerSources.push(source);
        visible = customerSources.some((s) => canAccess(snapshot, 'customers.read', s));
        if (mutation && !visible) throw signatureDenied();
        privateVisible =
          visible &&
          generatedSensitive.every((k) => canAccess(snapshot, k, source)) &&
          customerSources.some(
            (s) =>
              canAccess(snapshot, 'customers.read', s) &&
              generatedSensitive.every((k) => canAccess(snapshot, k, s)),
          );
        if (mutation) {
          const ids = [...new Set([parent.productId, ...parent.bundleProductIds])].sort();
          if (ids.length > 30) throw new BadRequestException('สินค้ามากเกินขอบเขต');
          for (const id of ids) {
            const product = await this.resources.product(tx, id, true);
            if (
              product.company !== 'SHOP' ||
              product.branchId !== parent.branchId ||
              !canAccess(snapshot, 'products.read', product)
            )
              throw signatureDenied();
          }
        }
      }
      const proof: SignatureAuthority = {
        tx,
        actorId,
        snapshot,
        managed: snapshot.managed,
        owner: snapshot.isOwner,
        company,
        parent,
        visible,
        privateVisible,
        operation: op,
      };
      genuine.add(proof);
      try {
        return await execution.run(proof, () => work(proof));
      } finally {
        genuine.delete(proof);
      }
    };
    const outer = currentDomainAccess();
    if (outer) {
      if (
        outer.snapshot.userId !== actorId ||
        outer.scope.company !== company ||
        outer.scopeReads ||
        outer.isolationLevel !== 'Serializable' ||
        !outer.effects ||
        outer.snapshot.managed !== actor.accessManaged
      )
        throw signatureDenied();
      return run(outer.client, outer.snapshot);
    }
    if (actor.accessManaged)
      return (
        await this.resources.execute(
          actorId,
          permission(op),
          company,
          undefined,
          () => run(currentDomainAccess()!.client, currentDomainAccess()!.snapshot),
          false,
          { domain: 'parties', isolationLevel: 'Serializable', maxAttempts: 3 },
        )
      ).result;
    // Legacy admission still owns a genuine outer transaction and its effects.
    for (let attempt = 1; ; attempt++) {
      const effects = {
        commit: [] as Array<() => Promise<void>>,
        rollback: [] as Array<() => Promise<void>>,
      };
      let result: T;
      try {
        result = await this.prisma.$transaction(
          async (tx) => {
            await lockEmployeeAccess(tx);
            await tx.$queryRaw`SELECT id FROM users WHERE id=${actorId} FOR SHARE`;
            const snapshot = await this.snapshots.forUserInTransaction(tx, actorId);
            if (snapshot.managed) throw signatureDenied();
            return domainAccessExecution.run(
              {
                client: tx,
                snapshot,
                scope: { userId: actorId, company, permission: permission(op), tuples: [] },
                scopeReads: false,
                isolationLevel: 'Serializable',
                effects,
              },
              () => run(tx, snapshot),
            );
          },
          { isolationLevel: 'Serializable', timeout: 30000 },
        );
      } catch (e) {
        await Promise.all(effects.rollback.map((f) => f()));
        if (attempt < 3 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034')
          continue;
        throw e;
      }
      for (const effect of effects.commit) {
        try {
          await effect();
        } catch {
          /* capture remains committed */
        }
      }
      return result;
    }
  }
  async evidence(proof: SignatureAuthority, action: string) {
    assertSignatureAuthority(proof);
    await proof.tx.auditLog.create({
      data: {
        userId: proof.actorId,
        entity: 'contract_signature',
        entityId: proof.parent.id,
        action,
        newValue: { outcome: 'SUCCESS', company: proof.company },
      },
    });
  }
  private validate(op: SignatureOperation, req: GeneratedRequest) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        String(req.params.id),
      )
    )
      throw new BadRequestException('รหัสสัญญาไม่ถูกต้อง');
    const allowed = op === 'getSignatures' ? ['company', 'page', 'limit', 'view'] : ['company'];
    if (
      Object.entries(req.query ?? {}).some(
        ([k, v]) => !allowed.includes(k) || typeof v !== 'string',
      )
    )
      throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
    for (const [k, max] of [
      ['page', 1000000],
      ['limit', 100],
    ] as const)
      if (
        req.query[k] !== undefined &&
        (!/^[1-9]\d*$/.test(String(req.query[k])) || Number(req.query[k]) > max)
      )
        throw new BadRequestException('หน้าหรือจำนวนรายการไม่ถูกต้อง');
    if (req.query.view !== undefined && !['PRESENCE', 'EVIDENCE'].includes(String(req.query.view)))
      throw new BadRequestException('มุมมองไม่ถูกต้อง');
    if (
      op === 'deleteSignature' &&
      !/^(CUSTOMER|COMPANY|STAFF|WITNESS_1|WITNESS_2|GUARDIAN)$/.test(String(req.params.signerType))
    )
      throw new BadRequestException('ผู้ลงนามไม่ถูกต้อง');
  }
}
