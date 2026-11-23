import { ForbiddenException } from '@nestjs/common';
import { consumeContractEvidenceCapture, contractEvidenceRequest, admitContractEvidenceTransaction } from './contract-evidence-capture-context';
import { namedExecution } from '../../promotions/contract-promotion-source';
import { lockEmployeeAccess } from '../../employee-access/access-snapshot.service';
import { createHash } from 'node:crypto';
import { ContractDocumentType, Prisma } from '@prisma/client';
import { currentDomainAccess } from '../../employee-access/access-execution-context';
import { EVIDENCE_PHOTO_KEYS } from '../../quality-control/photo-angles.util';
import { validateEvidencePhoto } from '../../quality-control/evidence-photo.util';

export const PRODUCT_EVIDENCE_SELECT = {
  imeiScreen: true, regulatory: true, batteryScreen: true, partsHistoryScreen: true, deletedAt: true,
} as const;
const DOCUMENTS: Record<typeof EVIDENCE_PHOTO_KEYS[number], { type: ContractDocumentType; name: string }> = {
  imeiScreen: { type: 'DEVICE_IMEI_PHOTO', name: 'หน้า IMEI' },
  regulatory: { type: 'DEVICE_REGULATORY_PHOTO', name: 'ตราครุฑ' },
  batteryScreen: { type: 'DEVICE_BATTERY_PHOTO', name: 'หน้า % แบต' },
  partsHistoryScreen: { type: 'DEVICE_PARTS_HISTORY_PHOTO', name: 'ประวัติการเปลี่ยนอะไหล่' },
};

/** Acquire authority before customer/product locks, matching managed request lock order. */
export async function authorizeContractEvidenceCapture(tx: Prisma.TransactionClient, actorId: string) {
  const request = contractEvidenceRequest();
  if (!request) return;
  if (request.actorId !== actorId) throw new ForbiddenException('ผู้สร้างหลักฐานไม่ตรงกับคำขอ');
  const managed = currentDomainAccess();
  if (managed) {
    const ctx = namedExecution(actorId, tx);
    if (ctx.scope.company !== 'SHOP' || ctx.scope.permission !== 'contracts.create') {
      throw new ForbiddenException('หลักฐานต้องมาจากการสร้างสัญญา');
    }
  } else {
    await lockEmployeeAccess(tx);
    await tx.$queryRaw`SELECT id FROM users WHERE id=${actorId} FOR SHARE`;
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    if (!actor || actor.accessManaged || !actor.isActive || actor.deletedAt || actor.isSystemUser ||
        !['OWNER', 'BRANCH_MANAGER', 'SALES'].includes(actor.role) ||
        (actor.role !== 'OWNER' && actor.branchId !== request.branchId)) {
      throw new ForbiddenException('ไม่มีสิทธิ์สร้างหลักฐานสัญญา');
    }
  }
  admitContractEvidenceTransaction(tx);
}

/** Called only inside canonical contract creation, after its product/customer authorization.
 * Copies bytes, hashes and original parent identity in the SAME transaction as the contract.
 * These types are staff attachments; PDF generation selects DEVICE_PHOTO only.
 */
export async function snapshotProductEvidence(
  tx: Prisma.TransactionClient,
  contractId: string,
  actorId: string,
) {
  const request = consumeContractEvidenceCapture(tx, contractId);
  // Internal/context-free service callers do not gain trusted document provenance.
  if (!request) return;
  if (request.actorId !== actorId) throw new ForbiddenException('ผู้สร้างหลักฐานไม่ตรงกับคำขอ');
  const managed = currentDomainAccess();
  const contract = await tx.contract.findUnique({ where: { id: contractId } });
  if (!contract || contract.deletedAt || contract.status !== 'DRAFT' || contract.workflowStatus !== 'CREATING' ||
      contract.salespersonId !== actorId || contract.productId !== request.productId ||
      contract.customerId !== request.customerId || contract.branchId !== request.branchId) throw new ForbiddenException('ต้นทางหลักฐานไม่ตรงกับสัญญาที่สร้าง');
  const product = await tx.product.findFirst({
    where: { id: contract.productId, branchId: contract.branchId, deletedAt: null },
    select: { productPhotos: { select: PRODUCT_EVIDENCE_SELECT } },
  });
  if (!product) throw new ForbiddenException('ต้นทางหลักฐานไม่ตรงกับสินค้า');
  const photos = product.productPhotos;
  if (!photos || photos.deletedAt) return;
  for (const key of EVIDENCE_PHOTO_KEYS) {
    const fileUrl = photos[key];
    if (!fileUrl) continue;
    const { bytes, mime } = validateEvidencePhoto(fileUrl);
    const fileHash = createHash('sha256').update(bytes).digest('hex');
    const definition = DOCUMENTS[key];
    const fileName = `${definition.name}.${mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]}`;
    const doc = await tx.contractDocument.create({ data: {
      contractId: contract.id, documentType: definition.type, fileName, originalName: fileName,
      fileUrl, mimeType: mime, fileSize: bytes.length, fileHash, uploadedById: actorId,
      notes: 'สำเนาหลักฐานจากสินค้า ณ วันสร้างสัญญา · ใช้ภายในเท่านั้น',
    } });
    await tx.uploadedContractDocumentIdentity.create({ data: {
      documentId: doc.id, contractId: contract.id, customerId: contract.customerId, branchId: contract.branchId,
      producerKind: managed ? 'MANAGED_SOURCE' : 'LEGACY_CURRENT_ROLE',
      creationCompany: managed ? managed.scope.company : null,
      mimeType: mime, fileSize: bytes.length, fileHash,
      inlineValueHash: createHash('sha256').update(fileUrl).digest('hex'),
    } });
    await tx.documentAuditLog.create({ data: {
      documentId: doc.id, contractId: contract.id, action: 'UPLOAD', userId: actorId,
      details: { source: 'PRODUCT_EVIDENCE', slot: key, version: 1 },
    } });
  }
}
