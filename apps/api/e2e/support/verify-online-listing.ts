/** Runs only against the managed disposable preview; leaves one synthetic phone to review. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ProductsService } from '../../src/modules/products/products.service';
import { ProductsOnlineListingService } from '../../src/modules/products/products-online-listing.service';
import { ShopCatalogService } from '../../src/modules/shop-catalog/shop-catalog.service';
import { ProductPhotosService } from '../../src/modules/quality-control/product-photos.service';
import { isIsolatedPreview } from './preview-database';

async function main() {
  const repo = resolve(__dirname, '../../../..');
  mkdirSync(resolve(repo, '.tmp/online-listing'), { recursive: true });
  const state = JSON.parse(readFileSync(resolve(repo, '.tmp/local-preview/state.json'), 'utf8'));
  process.env.DATABASE_URL = `postgresql://credit_test@localhost:55476/bc_chat_credit_test?host=${state.dataDir}/socket&schema=public`;
  assert(isIsolatedPreview(state.dataDir, process.env.DATABASE_URL), 'Only disposable preview DB allowed');
  const base = `http://localhost:${state.port}`;
  process.env.SHOP_BASE_URL = base;
  const db = new PrismaService();
  await db.$connect();
  try {
    const branch = await db.branch.findFirstOrThrow({ where: { deletedAt: null } });
    const owner = await db.user.findFirstOrThrow({ where: { role: 'OWNER', deletedAt: null } });
    const id = 'preview-online-listing-phone';
    const data = { name: 'iPhone 14 — ตัวอย่างหน้าขึ้นเว็บ', brand: 'Apple', model: 'iPhone 14', storage: '128GB', color: 'Midnight', category: 'PHONE_USED' as const, status: 'IN_STOCK' as const, costPrice: 9000, cashPrice: 12900, installmentPrice: 14900, conditionGrade: null, branchId: branch.id, ownedByCompanyId: branch.companyId, gallery: [], photos: [], isOnlineVisible: true, onlineCoverAngle: null, deletedAt: null, shopWarrantyDays: 30 };
    await db.product.upsert({ where: { id }, create: { id, ...data }, update: data });
    // This historical .jpg placeholder contains PNG bytes; use its actual MIME.
    const picture = 'data:image/png;base64,' + readFileSync(resolve(repo, 'apps/web-shop/public/media/product-placeholder.jpg')).toString('base64');
    const angles = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
    const recorded = Object.fromEntries(angles.map(angle => [angle, picture]));
    await db.productPhoto.upsert({ where: { productId: id }, create: { productId: id, ...recorded, uploadedById: owner.id, isCompleted: true }, update: { ...recorded, deletedAt: null, isCompleted: true } });
    const products = new ProductsService(db);
    const catalog = new ShopCatalogService(db);
    const listing = new ProductsOnlineListingService(db, {} as never);
    const photos = new ProductPhotosService(db);
    assert.equal((await products.getReadiness(id)).isReady, true);
    assert.equal((await products.getReadiness(id)).checks.some(c => c.key === 'conditionGrade'), false);
    let detail = await catalog.getProductDetail(id);
    assert(detail);
    assert.equal(detail.gallery.length, 6);
    assert(detail.gallery[0].includes('/front?'));
    const cards = await catalog.listGroupedByModel({ search: 'iPhone 14' });
    assert(cards.data.some(card => card.id === id && card.images?.[0]?.includes('/front?')));
    assert.equal((await fetch(detail.gallery[0])).status, 200);
    assert.equal((await fetch(`${base}/api/shop/products/${id}/photos/imeiScreen`)).status, 404);
    await listing.updateOnlineListing(id, { onlineCoverAngle: 'back' });
    detail = await catalog.getProductDetail(id);
    assert(detail?.gallery[0].includes('/back?'));
    const previous = detail!.gallery[1];
    await photos.uploadPhoto(id, 'front', picture, owner.id);
    detail = await catalog.getProductDetail(id);
    assert.equal(detail?.gallery.length, 6);
    assert.notEqual(detail!.gallery[1], previous);
    await photos.deletePhoto(id, 'back');
    detail = await catalog.getProductDetail(id);
    assert.equal(detail?.gallery.length, 5);
    assert(detail?.gallery[0].includes('/front?'));
    assert.equal((await fetch(`${base}/api/shop/products/${id}/photos/back`)).status, 404);
    await photos.uploadPhoto(id, 'back', picture, owner.id);
    for (const patch of [{ isOnlineVisible: false }, { cashPrice: 0 }, { deletedAt: new Date() }]) {
      await db.product.update({ where: { id }, data: patch });
      assert.equal(await catalog.getProductDetail(id), null);
      assert.equal((await fetch(`${base}/api/shop/products/${id}/photos/front`)).status, 404);
      await db.product.update({ where: { id }, data: { isOnlineVisible: true, cashPrice: 12900, deletedAt: null } });
    }
    await db.product.update({ where: { id }, data: { status: 'RESERVED' } });
    assert.equal((await products.getReadiness(id)).isReady, false);
    assert(!(await catalog.listGroupedByModel({ search: 'iPhone 14' })).data.some(p => p.id === id));
    await db.product.update({ where: { id }, data: { status: 'IN_STOCK', onlineCoverAngle: null } });
    // Soft-deleted angles never make a product eligible.
    await db.productPhoto.update({ where: { productId: id }, data: { deletedAt: new Date() } });
    assert.equal((await products.getReadiness(id)).isReady, false);
    assert.equal(await catalog.getProductDetail(id), null);
    await db.productPhoto.update({ where: { productId: id }, data: { deletedAt: null } });
    const result = { status: 'PASS', base, productId: id, url: `${base}/products/${id}?zone=shop`, checks: ['null grade + existing angle-only stock', 'catalog + detail six public URLs', 'cover persistence', 'replacement version, no duplicates', 'deleted angle fallback', 'evidence route 404', 'hidden/zero-price/deleted image 404', 'reserved stock excluded', 'soft-deleted photos excluded'] };
    writeFileSync(resolve(repo, '.tmp/online-listing/integration.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
