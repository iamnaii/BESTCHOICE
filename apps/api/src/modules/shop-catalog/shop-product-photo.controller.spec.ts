import { ShopProductPhotoController } from './shop-product-photo.controller';

describe('public product angle images', () => {
  const prisma = { product: { findFirst: jest.fn() }, systemConfig: { findFirst: jest.fn() } };
  const controller = new ShopProductPhotoController(prisma as never);
  const response = { setHeader: jest.fn(), type: jest.fn().mockReturnThis(), send: jest.fn() };
  beforeEach(() => { jest.clearAllMocks(); });
  it('never queries a staff evidence key', async () => {
    await expect(controller.photo('p1', 'imeiScreen', response as never)).rejects.toThrow('ไม่พบรูปสินค้า');
    expect(prisma.product.findFirst).not.toHaveBeenCalled();
  });
  it('serves a valid recorded angle only after eligibility and prevents stale caching', async () => {
    prisma.product.findFirst.mockResolvedValue({ productPhotos: { deletedAt: null, front: 'data:image/png;base64,iVBORw0KGgo=' } });
    await controller.photo('p1', 'front', response as never);
    expect(prisma.product.findFirst.mock.calls[0][0].where.AND).toContainEqual({ isOnlineVisible: true });
    expect(response.type).toHaveBeenCalledWith('image/png');
    expect(response.send).toHaveBeenCalledWith(Buffer.from('iVBORw0KGgo=', 'base64'));
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
  it.each([null, { productPhotos: { deletedAt: new Date(), front: 'data:image/png;base64,iVBORw0KGgo=' } }, { productPhotos: { deletedAt: null, front: 'data:image/svg+xml;base64,aGVsbG8=' } }])('rejects unavailable, deleted or unsupported photos', async result => {
    prisma.product.findFirst.mockResolvedValue(result);
    await expect(controller.photo('p1', 'front', response as never)).rejects.toThrow('ไม่พบรูปสินค้า');
    expect(response.send).not.toHaveBeenCalled();
  });
});
