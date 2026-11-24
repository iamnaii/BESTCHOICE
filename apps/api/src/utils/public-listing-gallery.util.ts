import { PrismaClient } from '@prisma/client';
import { readBoolFlag } from './config.util';
import { hydrateListingGalleries } from './product-listing-gallery.util';
import { productReadinessWhere } from './product-readiness.util';

/** Unfiltered staff/bot/order searches must not advertise a gated image URL that returns 404. */
export async function hydratePublicListingGalleries<T extends { id: string; gallery: string[] }>(
  client: Pick<PrismaClient, '$queryRaw' | 'product' | 'systemConfig'>,
  products: T[],
) {
  const listings = await hydrateListingGalleries(client, products);
  const automatic = listings.filter(p => p.usesAutomaticPhotos);
  if (!automatic.length) return listings;
  const excludeDemo = await readBoolFlag(client, 'shop_hide_demo_products', false);
  const allowed = await client.product.findMany({
    where: { id: { in: automatic.map(p => p.id) }, ...productReadinessWhere({ requireInStock: false, excludeDemo }) },
    select: { id: true },
  });
  const ids = new Set(allowed.map(p => p.id));
  return listings.map(p => p.usesAutomaticPhotos && !ids.has(p.id) ? { ...p, gallery: [] } : p);
}
