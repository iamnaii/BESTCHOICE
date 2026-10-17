import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { AccessResource, AccessSnapshot, PermissionKey, canAccess } from '@installment/shared';
import { AccessClient } from './access-snapshot.service';
import { AccessResourceService, ResolvedAccessResources } from './access-resource.service';
import { AccessTradeInProjectionService } from './access-trade-in-projection.service';
import { AccessProcurementSourceService } from './access-procurement-source.service';
import { contractWarrantySource, repairSource } from './access-repair-scope';

@Injectable()
export class AccessRepairSourceService {
  constructor(
    private readonly resources: AccessResourceService,
    private readonly parties: AccessTradeInProjectionService,
    private readonly procurement: AccessProcurementSourceService,
  ) {}
  async customer(tx: AccessClient, snapshot: AccessSnapshot, id: string) {
    if (
      !(await tx.customer.count({ where: { id, deletedAt: null } })) ||
      !(await this.parties.partyAllows(tx, snapshot, id, 'customerId', 'customers.read'))
    )
      throw new ForbiddenException('ไม่มีสิทธิ์เลือกลูกค้า');
  }
  async supplier(tx: AccessClient, snapshot: AccessSnapshot, id: string, lock = false) {
    const result = await this.procurement.supplier(
      tx,
      id,
      'SHOP',
      snapshot,
      'suppliers.read',
      lock,
    );
    this.resources.assert(snapshot, 'suppliers.read', result);
  }
  async linked(
    tx: AccessClient,
    snapshot: AccessSnapshot,
    input: {
      customerId?: unknown;
      contractId?: unknown;
      productId?: unknown;
      repairSupplierId?: unknown;
      replacementContractId?: unknown;
    },
    lock = false,
  ) {
    for (const value of Object.values(input))
      if (value != null && typeof value !== 'string')
        throw new BadRequestException('ข้อมูลอ้างอิงไม่ถูกต้อง');
    const ids = input as {
      customerId?: string;
      contractId?: string;
      productId?: string;
      repairSupplierId?: string;
      replacementContractId?: string;
    };
    if (ids.customerId) await this.customer(tx, snapshot, ids.customerId);
    if (ids.repairSupplierId) await this.supplier(tx, snapshot, ids.repairSupplierId, lock);
    const productIds = new Set(ids.productId ? [ids.productId] : []);
    for (const id of [ids.contractId, ids.replacementContractId]
      .filter((v): v is string => !!v)
      .sort()) {
      const source = await contractWarrantySource(tx, id, lock);
      if (!canAccess(snapshot, 'contracts.read', source))
        throw new ForbiddenException('ไม่มีสิทธิ์อ่านข้อมูลประกัน');
      const contract = await tx.contract.findUniqueOrThrow({
        where: { id },
        select: { customerId: true, productId: true },
      });
      await this.customer(tx, snapshot, contract.customerId);
      if (ids.customerId && contract.customerId !== ids.customerId)
        throw new ForbiddenException('ลูกค้าไม่ตรงกับสัญญา');
      if (id === ids.contractId && ids.productId && contract.productId !== ids.productId)
        throw new ForbiddenException('สินค้าไม่ตรงกับสัญญา');
      if (contract.productId) productIds.add(contract.productId);
    }
    for (const id of [...productIds].sort()) {
      const source = await this.resources.product(tx, id, lock);
      if (!canAccess(snapshot, 'products.read', source))
        throw new ForbiddenException('ไม่มีสิทธิ์อ่านสินค้า');
    }
  }
  async warrantySelection(
    tx: AccessClient,
    snapshot: AccessSnapshot,
    input: { customerId?: unknown; contractId?: unknown; productId?: unknown },
    lock = false,
  ) {
    await this.linked(tx, snapshot, input, lock);
    const sources: AccessResource[] = [];
    if (typeof input.contractId === 'string')
      sources.push(await contractWarrantySource(tx, input.contractId, lock));
    if (typeof input.productId === 'string' && !input.contractId) {
      const p = await tx.product.findUniqueOrThrow({ where: { id: input.productId } });
      sources.push(await this.resources.branch(tx, p.branchId, lock));
    }
    if (sources.length)
      this.resources.assert(snapshot, 'repair-tickets.read', {
        company: 'SHOP',
        resources: sources,
        productIds: [],
      });
  }
  async resolve(
    tx: AccessClient,
    snapshot: AccessSnapshot,
    permission: PermissionKey,
    method: string,
    id: string | undefined,
    body: Record<string, unknown>,
    lock = false,
  ): Promise<ResolvedAccessResources> {
    const source = id
      ? await repairSource(tx, id, lock)
      : await this.resources.branch(tx, String(body.branchId ?? ''), lock);
    if (source.company !== 'SHOP') throw new ForbiddenException('งานซ่อมต้องอยู่ใน SHOP');
    const result = { company: 'SHOP' as const, resources: [source], productIds: [] };
    this.resources.assert(snapshot, permission, result);
    if (method === 'softDelete' && !snapshot.isOwner)
      throw new ForbiddenException('เจ้าของเท่านั้นที่ลบใบซ่อม');
    // Reads can expose a scoped ticket with unavailable linked fields redacted.
    if (method === 'findOne' || method === 'softDelete') return result;
    const existing = id ? await tx.repairTicket.findUniqueOrThrow({ where: { id } }) : undefined;
    if (id && ['branchId', 'customerId', 'productId', 'contractId'].some((k) => k in body))
      throw new BadRequestException('เปลี่ยนแหล่งเดิมของใบซ่อมไม่ได้');
    await this.linked(
      tx,
      snapshot,
      {
        customerId: existing?.customerId ?? body.customerId,
        contractId: existing?.contractId ?? body.contractId,
        productId: existing?.productId ?? body.productId,
        repairSupplierId: body.repairSupplierId ?? existing?.repairSupplierId,
        replacementContractId: body.replacementContractId,
      },
      lock,
    );
    return result;
  }
}
