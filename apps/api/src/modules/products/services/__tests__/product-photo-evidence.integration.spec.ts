import { defer, lastValueFrom } from 'rxjs';
import { bindCreatedContractEvidence, ContractEvidenceCaptureInterceptor, registerContractEvidenceCapture } from '../../../contracts/services/contract-evidence-capture-context';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { isDisposablePreviewDatabase } from '../../../../../e2e/support/preview-database';
import { ProductsService } from '../../products.service';
import { ProductPhotosService } from '../../../quality-control/product-photos.service';
import { ProductsOnlineListingService } from '../../products-online-listing.service';
import { authorizeContractEvidenceCapture, snapshotProductEvidence } from '../../../contracts/services/snapshot-product-evidence';
import { PHOTO_ANGLES, EVIDENCE_PHOTO_KEYS } from '../../../quality-control/photo-angles.util';

// This suite writes only to the existing disposable PostgreSQL harness.
if (!isDisposablePreviewDatabase()) throw new Error('Run in the isolated local preview PostgreSQL harness');
const db = new PrismaClient();
const products = new ProductsService(db as never);
const photos = new ProductPhotosService(db as never);
const captureHandler = () => undefined;
registerContractEvidenceCapture(captureHandler);
async function capture<T>(body: { productId: string; customerId: string; branchId: string }, work: () => Promise<T>) {
  const execution = { getHandler: () => captureHandler, switchToHttp: () => ({ getRequest: () => ({ user: { id: userId }, body }) }) };
  return lastValueFrom(new ContractEvidenceCaptureInterceptor().intercept(execution as never, { handle: () => defer(work) })) as Promise<T>;
}
const marker = `PHOTO-EVIDENCE-${randomUUID()}`;
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOioAAAAASUVORK5CYII=';
const allAngles = Object.fromEntries(PHOTO_ANGLES.map(key => [key, image]));
const allEvidence = Object.fromEntries(EVIDENCE_PHOTO_KEYS.map(key => [key, image]));
let branchId: string;
let userId: string;
beforeAll(async () => {
  branchId = (await db.branch.create({ data: { name: marker } })).id;
  userId = (await db.user.create({ data: { name: marker, email: `${marker}@test.invalid`, password: 'unused', role: 'OWNER', branchId } })).id;
});
afterAll(async () => {
  // Keep fixture rows: document identities/audits are immutable. This isolated DB is disposable.
  await db.$disconnect();
});
const create = (category: string, extra = {}) => products.create({ name: marker, brand: 'Test', model: marker, category, branchId, costPrice: 100, cashPrice: 200, ...extra });

describe('product angle photos and internal contract evidence', () => {
  it.each(['PHONE_NEW', 'PHONE_USED', 'TABLET'])('persists named slots atomically for %s, separate from public photos', async category => {
    const product = await create(category, { anglePhotos: { front: image, bottom: image }, evidencePhotos: allEvidence });
    const loaded = await photos.getPhotos(product!.id);
    expect(loaded).toMatchObject({ completedCount: 2, totalCount: 6, photos: { front: image, bottom: image, back: null }, evidencePhotos: allEvidence });
    expect(product!.photos).toEqual([]);
    expect(product!.gallery).toEqual([]);
    expect(loaded.photos).not.toHaveProperty('imeiScreen');
  });
  it('four evidence images alone never complete six angles; removal leaves six-angle completion intact', async () => {
    const product = await create('PHONE_USED', { evidencePhotos: allEvidence });
    expect(await photos.getPhotos(product!.id)).toMatchObject({ completedCount: 0, isCompleted: false });
    await expect(photos.completePhotos(product!.id, userId)).rejects.toThrow('ยังขาดรูป');
    for (const angle of PHOTO_ANGLES) await photos.uploadPhoto(product!.id, angle, image, userId);
    await photos.completePhotos(product!.id, userId);
    await photos.deletePhoto(product!.id, 'batteryScreen');
    expect(await photos.getPhotos(product!.id)).toMatchObject({ completedCount: 6, isCompleted: true, evidencePhotos: { batteryScreen: null } });
    await photos.deletePhoto(product!.id, 'front');
    expect(await photos.getPhotos(product!.id)).toMatchObject({ completedCount: 5, isCompleted: false });
  });
  it('rejects evidence promotion even when the DTO is bypassed', async () => {
    const product = await create('PHONE_NEW', { evidencePhotos: allEvidence });
    const listing = new ProductsOnlineListingService(db as never, {} as never);
    for (const angle of EVIDENCE_PHOTO_KEYS) {
      await expect(listing.promotePhoto(product!.id, { source: 'ANGLE', angle } as never)).rejects.toThrow('ไม่สามารถนำขึ้นเว็บ');
    }
    expect((await db.product.findUniqueOrThrow({ where: { id: product!.id } })).gallery).toEqual([]);
  });
  it('rejects invalid evidence and rolls back photo rows when creation fails its existing price gate', async () => {
    await expect(create('PHONE_NEW', { evidencePhotos: { imeiScreen: 'data:image/png;base64,YQ==' } })).rejects.toThrow('รูปหลักฐานไม่สมบูรณ์');
    await expect(create('ACCESSORY', { anglePhotos: allAngles })).rejects.toThrow('มือถือ/แท็บเล็ต');
    const before = await db.productPhoto.count({ where: { product: { branchId } } });
    await expect(create('PHONE_NEW', { cashPrice: null, installmentPrice: null, financePrice: null, anglePhotos: allAngles, evidencePhotos: allEvidence })).rejects.toThrow();
    expect(await db.productPhoto.count({ where: { product: { branchId } } })).toBe(before);
  });
  it('copies evidence to private typed contract attachments; editing inventory never changes the originals', async () => {
    const product = await create('PHONE_NEW', { anglePhotos: allAngles, evidencePhotos: allEvidence });
    const customer = await db.customer.create({ data: { name: marker, phone: '0800000000' } });
    const contract = await capture({ productId: product!.id, customerId: customer.id, branchId }, () => db.$transaction(async tx => {
      await authorizeContractEvidenceCapture(tx, userId);
      const created = await tx.contract.create({ data: {
        contractNumber: marker, productId: product!.id, customerId: customer.id, branchId, salespersonId: userId,
        planType: 'STORE_DIRECT', sellingPrice: 200, downPayment: 0, interestRate: 0, totalMonths: 1,
        interestTotal: 0, financedAmount: 200, monthlyPayment: 200,
      } });
      // An unbound helper cannot mint identities for arbitrary drafts.
      await snapshotProductEvidence(tx, created.id, userId);
      expect(await tx.contractDocument.count({ where: { contractId: created.id } })).toBe(0);
      bindCreatedContractEvidence(tx, created.id);
      await snapshotProductEvidence(tx, created.id, userId);
      return created;
    }));
    const documents = await db.contractDocument.findMany({ where: { contractId: contract.id }, include: { uploadIdentity: true } });
    expect(documents.map(doc => doc.documentType).sort()).toEqual(['DEVICE_IMEI_PHOTO', 'DEVICE_REGULATORY_PHOTO', 'DEVICE_BATTERY_PHOTO', 'DEVICE_PARTS_HISTORY_PHOTO'].sort());
    for (const doc of documents) {
      expect(doc.fileUrl).toBe(image);
      expect(doc.uploadIdentity).toMatchObject({ contractId: contract.id, customerId: customer.id, branchId, fileHash: doc.fileHash });
    }
    await photos.deletePhoto(product!.id, 'imeiScreen');
    expect((await db.contractDocument.findFirstOrThrow({ where: { contractId: contract.id, documentType: 'DEVICE_IMEI_PHOTO' } })).fileUrl).toBe(image);
    // Both PDF producer paths use this explicit type; none of the evidence is a DEVICE_PHOTO.
    expect(await db.contractDocument.count({ where: { contractId: contract.id, documentType: 'DEVICE_PHOTO' } })).toBe(0);
  });
  it('does not admit a context-free or unbound transaction, and rejects another actor', async () => {
    const product = await create('PHONE_NEW', { evidencePhotos: allEvidence });
    const customer = await db.customer.create({ data: { name: marker, phone: '0800000001' } });
    await db.$transaction(async tx => {
      await authorizeContractEvidenceCapture(tx, userId);
      bindCreatedContractEvidence(tx, 'not-an-admitted-contract');
      await snapshotProductEvidence(tx, 'not-an-admitted-contract', userId);
    });
    await expect(capture({ productId: product!.id, customerId: customer.id, branchId }, () => db.$transaction(async tx => {
      await authorizeContractEvidenceCapture(tx, randomUUID());
    }))).rejects.toThrow('ผู้สร้างหลักฐานไม่ตรง');
  });
  it('rolls back the new contract and partially copied attachments together on evidence failure', async () => {
    const product = await create('PHONE_NEW', { evidencePhotos: allEvidence });
    const customer = await db.customer.create({ data: { name: marker, phone: '0800000002' } });
    // Simulate corrupt stored evidence: first slot is copied, second fails real file validation.
    await db.productPhoto.update({ where: { productId: product!.id }, data: { regulatory: 'invalid' } });
    const contractNumber = `${marker}-rollback`;
    await expect(capture({ productId: product!.id, customerId: customer.id, branchId }, () => db.$transaction(async tx => {
      await authorizeContractEvidenceCapture(tx, userId);
      const created = await tx.contract.create({ data: {
        contractNumber, productId: product!.id, customerId: customer.id, branchId, salespersonId: userId,
        planType: 'STORE_DIRECT', sellingPrice: 200, downPayment: 0, interestRate: 0, totalMonths: 1,
        interestTotal: 0, financedAmount: 200, monthlyPayment: 200,
      } });
      bindCreatedContractEvidence(tx, created.id);
      await snapshotProductEvidence(tx, created.id, userId);
    }))).rejects.toThrow('รูปหลักฐานต้องเป็น');
    expect(await db.contract.count({ where: { contractNumber } })).toBe(0);
    expect(await db.contractDocument.count({ where: { uploadIdentity: { customerId: customer.id } } })).toBe(0);
  });

});
