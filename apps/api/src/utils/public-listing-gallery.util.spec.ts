import { hydratePublicListingGalleries } from './public-listing-gallery.util';

describe('public photos in unfiltered staff/bot searches', () => {
  it('does not hand an unavailable automatic image URL to messaging providers', async () => {
    const client = {
      $queryRaw: jest.fn().mockResolvedValue([{ product_id: 'hidden', angles: ['front'], cover: null, revision: '1' }, { product_id: 'visible', angles: ['front'], cover: null, revision: '1' }]),
      product: { findMany: jest.fn().mockResolvedValue([{ id: 'visible' }]) },
      systemConfig: { findFirst: jest.fn().mockResolvedValue({ value: 'true' }) },
    };
    const results = await hydratePublicListingGalleries(client as never, [{ id: 'hidden', gallery: [] }, { id: 'visible', gallery: [] }, { id: 'legacy', gallery: ['https://cdn/legacy.jpg'] }]);
    expect(results[0].gallery).toEqual([]);
    expect(results[1].gallery).toHaveLength(1);
    expect(results[2].gallery).toEqual(['https://cdn/legacy.jpg']);
    expect(client.product.findMany.mock.calls[0][0].where.AND).toContainEqual({ isOnlineVisible: true });
    expect(client.product.findMany.mock.calls[0][0].where.AND).toContainEqual({ NOT: { name: { startsWith: '[DEMO]' } } });
  });
});
