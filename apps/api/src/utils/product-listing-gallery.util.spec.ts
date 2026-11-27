import { hydrateListingGalleries, listingPhotoUrl } from './product-listing-gallery.util';

describe('automatic listing gallery', () => {
  const base = { id: 'p1', gallery: ['https://cdn/legacy.jpg'] };
  const prisma = { $queryRaw: jest.fn() };
  beforeEach(() => { jest.clearAllMocks(); });
  it('uses six recorded angles instead of manually promoted copies', async () => {
    prisma.$queryRaw.mockResolvedValue([{ product_id: 'p1', angles: ['front', 'back', 'left', 'right', 'top', 'bottom'], cover: null, revision: '123' }]);
    const [result] = await hydrateListingGalleries(prisma as never, [base]);
    expect(result.gallery).toHaveLength(6);
    // No cover picked → the back leads (it shows the colour), the rest keep angle order.
    expect(result.gallery[0]).toBe(listingPhotoUrl('p1', 'back', '123'));
    expect(result.gallery[1]).toBe(listingPhotoUrl('p1', 'front', '123'));
    expect(result.gallery[5]).toBe(listingPhotoUrl('p1', 'bottom', '123'));
    expect(result.usesAutomaticPhotos).toBe(true);
    expect(base.gallery).toEqual(['https://cdn/legacy.jpg']);
  });
  it('moves an available cover first and versions replacement photos', async () => {
    prisma.$queryRaw.mockResolvedValue([{ product_id: 'p1', angles: ['front', 'back'], cover: 'back', revision: '456' }]);
    const [result] = await hydrateListingGalleries(prisma as never, [base]);
    expect(result.gallery).toEqual([listingPhotoUrl('p1', 'back', '456'), listingPhotoUrl('p1', 'front', '456')]);
  });
  it('keeps a cover staff picked even when a back photo exists', async () => {
    prisma.$queryRaw.mockResolvedValue([{ product_id: 'p1', angles: ['front', 'back', 'left'], cover: 'left', revision: '9' }]);
    const [result] = await hydrateListingGalleries(prisma as never, [base]);
    expect(result.gallery[0]).toBe(listingPhotoUrl('p1', 'left', '9'));
  });
  it('leads with the front when there is no back photo and no cover', async () => {
    prisma.$queryRaw.mockResolvedValue([{ product_id: 'p1', angles: ['front', 'left'], cover: null, revision: '3' }]);
    const [result] = await hydrateListingGalleries(prisma as never, [base]);
    expect(result.gallery[0]).toBe(listingPhotoUrl('p1', 'front', '3'));
  });
  it('keeps legacy gallery if no active angles exist', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    const [result] = await hydrateListingGalleries(prisma as never, [base]);
    expect(result.gallery).toEqual(base.gallery);
    expect(result.usesAutomaticPhotos).toBe(false);
  });
  it('never includes evidence and falls back from a removed cover', async () => {
    prisma.$queryRaw.mockResolvedValue([{ product_id: 'p1', angles: ['front', 'imeiScreen'], cover: 'back', revision: '7' }]);
    const [result] = await hydrateListingGalleries(prisma as never, [base]);
    expect(result.gallery).toEqual([listingPhotoUrl('p1', 'front', '7')]);
  });
  it('falls back to the back when the cover staff picked was removed', async () => {
    prisma.$queryRaw.mockResolvedValue([{ product_id: 'p1', angles: ['front', 'back', 'right'], cover: 'left', revision: '8' }]);
    const [result] = await hydrateListingGalleries(prisma as never, [base]);
    expect(result.gallery).toEqual([
      listingPhotoUrl('p1', 'back', '8'),
      listingPhotoUrl('p1', 'front', '8'),
      listingPhotoUrl('p1', 'right', '8'),
    ]);
  });
  it('does not query empty batches', async () => {
    expect(await hydrateListingGalleries(prisma as never, [])).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
