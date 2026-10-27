import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Logger,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { currentDomainAccess } from '../employee-access/access-execution-context';
import { procurementPreparation } from '../employee-access/access-preparation-context';
import { tenderAccess } from '../employee-access/access-tender-source';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import {
  assertEvidenceImage,
  evidenceImageExtension,
  EVIDENCE_IMAGE_MAX_BYTES,
} from '../../utils/upload-image.util';

export interface StagedCashSlip {
  key: string;
  operationId: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
}
const logger = new Logger('ShopCashSlip');
function cleanupWarning(reason: string) {
  try {
    logger.warn({ event: 'CASH_SLIP_CLEANUP_RETAINED', reason });
  } catch {
    /* Preserve primary failure. */
  }
}
/** One owned upload outside all authority fences/retries. Cleanup is terminal only. */
export async function stageCashSlip<T>(
  storage: StorageService,
  namespace: string,
  file: Express.Multer.File | undefined,
  persist: (staged: StagedCashSlip) => Promise<T>,
): Promise<T> {
  const preparation = procurementPreparation.getStore();
  if (preparation?.source !== 'shop-cash-slip' || !preparation.authorize || currentDomainAccess())
    throw new ForbiddenException('ต้องตรวจสิทธิ์ก่อนแนบหลักฐาน');
  assertEvidenceImage(file, 'สลิปฝากเงิน');
  if (file.buffer.length > EVIDENCE_IMAGE_MAX_BYTES)
    throw new BadRequestException('รูปมีขนาดเกิน 5MB');
  await preparation.authorize();
  const staged = {
    key: `${namespace}/${Date.now()}-${randomUUID()}.${evidenceImageExtension(file.mimetype)}`,
    operationId: randomUUID(),
    mimeType: file.mimetype,
    fileSize: file.buffer.length,
    sha256: createHash('sha256').update(file.buffer).digest('hex'),
  };
  try {
    await storage.uploadOwned(staged.key, file.buffer, staged.mimeType, staged.operationId);
    return await preparation.execute(() => persist(staged));
  } catch (error) {
    try {
      const outcome = await storage.deleteOwned(staged.key, staged.operationId);
      if (outcome.status === 'retained') cleanupWarning(outcome.reason);
    } catch {
      cleanupWarning('cleanup-failed');
    }
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException('ไม่สามารถบันทึกหลักฐานเงินหน้าร้านได้');
  }
}
export async function recordCashSlip(
  staged: StagedCashSlip,
  sourceKind: 'CLOSE' | 'DEPOSIT',
  sourceId: string,
) {
  const ctx = currentDomainAccess()!;
  await ctx.client.shopCashSlipEvidence.create({
    data: {
      sourceKind,
      sourceId,
      storageKey: staged.key,
      mimeType: staged.mimeType,
      fileSize: staged.fileSize,
      sha256: staged.sha256,
      operationId: staged.operationId,
      createdById: ctx.snapshot.userId,
    },
  });
}
/** Persisted source/key only. Bounded verified bytes stay inside the transaction until commit. */
export async function readCashSlip(
  storage: StorageService,
  audit: AuditService,
  sourceKind: 'CLOSE' | 'DEPOSIT',
  id: string,
  branchId: string,
  key: string | null,
): Promise<StreamableFile> {
  const ctx = currentDomainAccess()!,
    plan = tenderAccess.getStore();
  if (!ctx || !plan) throw new ForbiddenException('ไม่มีขอบเขตหลักฐาน');
  plan.assertComplete(branchId, 'shop-tenders.read', true);
  if (!plan.allows('documents.read', branchId) || !key)
    throw new ForbiddenException('ไม่มีสิทธิ์อ่านหลักฐาน');
  const evidence = await ctx.client.shopCashSlipEvidence.findUnique({ where: { storageKey: key } });
  const prefix =
    sourceKind === 'CLOSE' ? `shop-cash-close/${id}/` : `shop-cash-deposits/${branchId}/`;
  if (
    !key.startsWith(prefix) ||
    !/^\d+-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|png|webp)$/.test(
      key.slice(prefix.length),
    ) ||
    (evidence && (evidence.sourceKind !== sourceKind || evidence.sourceId !== id))
  )
    throw new ForbiddenException('ไม่พบแหล่งหลักฐานที่ตรวจสอบได้');
  const mimeType =
    evidence?.mimeType ??
    { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[key.split('.').pop()!]!;
  let bytes: Buffer;
  try {
    const stream = await storage.getStream(key),
      chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => stream.destroy(new Error('read timeout')), 10000);
    try {
      for await (const chunk of stream) {
        const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += part.length;
        if (size > EVIDENCE_IMAGE_MAX_BYTES || (evidence && size > evidence.fileSize))
          throw new Error('size');
        chunks.push(part);
      }
    } finally {
      clearTimeout(timer);
      stream.destroy();
    }
    bytes = Buffer.concat(chunks);
    assertEvidenceImage(
      { buffer: bytes, mimetype: mimeType } as Express.Multer.File,
      'สลิปฝากเงิน',
    );
    if (
      evidence &&
      (bytes.length !== evidence.fileSize ||
        createHash('sha256').update(bytes).digest('hex') !== evidence.sha256)
    )
      throw new Error('integrity');
  } catch {
    throw new ServiceUnavailableException('ไม่สามารถอ่านหลักฐานที่ตรวจสอบได้');
  }
  await audit.log(
    {
      userId: ctx.snapshot.userId,
      action: 'SHOP_CASH_SLIP_READ_AUTHORIZED',
      entity: sourceKind === 'CLOSE' ? 'shop_cash_close' : 'shop_cash_deposit',
      entityId: id,
      newValue: { branchId },
    },
    ctx.client,
  );
  return new StreamableFile(bytes, {
    type: mimeType,
    length: bytes.length,
    disposition: 'inline; filename="cash-slip"',
  });
}
