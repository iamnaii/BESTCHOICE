import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ShopProductPhotoController } from './shop-product-photo.controller';

describe('public product angle images', () => {
  const prisma = { product: { findFirst: jest.fn() }, systemConfig: { findFirst: jest.fn() } };
  const controller = new ShopProductPhotoController(prisma as never);
  const response = { setHeader: jest.fn(), removeHeader: jest.fn(), type: jest.fn().mockReturnThis(), send: jest.fn() };
  beforeEach(() => { jest.clearAllMocks(); });
  it('never queries a staff evidence key', async () => {
    await expect(controller.photo('p1', 'imeiScreen', response as never)).rejects.toThrow('ไม่พบรูปสินค้า');
    expect(prisma.product.findFirst).not.toHaveBeenCalled();
  });
  it('serves a valid recorded angle only after eligibility, cached privately (the URL carries ?v=revision)', async () => {
    prisma.product.findFirst.mockResolvedValue({ productPhotos: { deletedAt: null, front: 'data:image/png;base64,iVBORw0KGgo=' } });
    await controller.photo('p1', 'front', response as never);
    expect(prisma.product.findFirst.mock.calls[0][0].where.AND).toContainEqual({ isOnlineVisible: true });
    expect(response.type).toHaveBeenCalledWith('image/png');
    expect(response.send).toHaveBeenCalledWith(Buffer.from('iVBORw0KGgo=', 'base64'));
    // `private`: only the browser that already saw the photo keeps it — no shared CDN copy of a product
    // that is later hidden. The global no-store headers (Pragma/Expires) are stripped so caches obey it.
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=86400');
    expect(response.setHeader).not.toHaveBeenCalledWith('Cache-Control', expect.stringContaining('public'));
    expect(response.removeHeader).toHaveBeenCalledWith('Pragma');
    expect(response.removeHeader).toHaveBeenCalledWith('Expires');
  });
  // Firebase Hosting stamps `no-store` on every path (`**` rule) and overrides the API's header,
  // so the photo route needs its own later rule with the SAME value — or the cache never happens.
  it('hosting keeps the same private cache header for photo URLs (after the catch-all rule)', () => {
    const { hosting } = JSON.parse(readFileSync(resolve(__dirname, '../../../../../firebase.json'), 'utf8'));
    const shop = hosting.find((site: { target: string }) => site.target === 'shop');
    const sources = shop.headers.map((rule: { source: string }) => rule.source);
    const photoRule = shop.headers.find((rule: { source: string }) => rule.source === '/api/shop/products/*/photos/*');
    expect(photoRule.headers).toEqual([{ key: 'Cache-Control', value: 'private, max-age=86400' }]);
    expect(sources.indexOf('/api/shop/products/*/photos/*')).toBeGreaterThan(sources.indexOf('**'));
  });
  it.each([null, { productPhotos: { deletedAt: new Date(), front: 'data:image/png;base64,iVBORw0KGgo=' } }, { productPhotos: { deletedAt: null, front: 'data:image/svg+xml;base64,aGVsbG8=' } }])('rejects unavailable, deleted or unsupported photos', async result => {
    prisma.product.findFirst.mockResolvedValue(result);
    await expect(controller.photo('p1', 'front', response as never)).rejects.toThrow('ไม่พบรูปสินค้า');
    expect(response.send).not.toHaveBeenCalled();
  });
});
