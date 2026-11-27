import { Prisma, PrismaClient } from '@prisma/client';
import { PHOTO_ANGLES, PhotoAngle } from '../modules/quality-control/photo-angles.util';
import { shopBaseUrl } from './shop-base-url.util';

export function listingPhotoUrl(id: string, angle: PhotoAngle, revision: string): string {
  const base = shopBaseUrl() ?? (process.env.NODE_ENV === 'production' ? 'https://www.bestchoicephone.com' : '');
  return `${base}/api/shop/products/${encodeURIComponent(id)}/photos/${angle}?v=${encodeURIComponent(revision)}`;
}

/** Same photo eligibility in SQL and checklist; private evidence is never considered. */
export const listingPhotoWhere = (): Prisma.ProductWhereInput => ({
  OR: [
    { gallery: { isEmpty: false } },
    { productPhotos: { is: { deletedAt: null, OR: PHOTO_ANGLES.map(angle => ({ [angle]: { not: null, notIn: [''] } })) } } },
  ],
});

/**
 * Cover when staff have not picked one (`products.online_cover_angle` null): the BACK,
 * because the back is what shows the phone's colour (owner brief 2026-11-27, B1).
 * A cover staff picked still wins. A picked cover whose photo is gone falls back to the back too
 * (not to the front by angle order), and only with no back does angle order decide.
 * Admin `OnlineListingPanel` mirrors this rule for its "รูปปก" marker — change both together.
 */
export const DEFAULT_LISTING_COVER: PhotoAngle = 'back';

type GalleryProduct = { id: string; gallery: string[] };
type PhotoMetadata = { product_id: string; angles: string[]; cover: string | null; revision: string };

/** One bounded metadata-only query. Never load photo blobs into catalog/card responses. */
export async function hydrateListingGalleries<T extends GalleryProduct>(
  client: Pick<PrismaClient, '$queryRaw'>,
  products: T[],
): Promise<Array<T & { usesAutomaticPhotos: boolean; listingPhotoAngles: PhotoAngle[] }>> {
  const ids = [...new Set(products.map(p => p.id))];
  if (!ids.length) return [];
  const rows = await client.$queryRaw<PhotoMetadata[]>`
    SELECT pp.product_id, p.online_cover_angle AS cover, pp.updated_at::text AS revision,
      array_remove(ARRAY[
        CASE WHEN pp.front IS NOT NULL AND pp.front <> '' THEN 'front' END,
        CASE WHEN pp.back IS NOT NULL AND pp.back <> '' THEN 'back' END,
        CASE WHEN pp."left" IS NOT NULL AND pp."left" <> '' THEN 'left' END,
        CASE WHEN pp."right" IS NOT NULL AND pp."right" <> '' THEN 'right' END,
        CASE WHEN pp.top IS NOT NULL AND pp.top <> '' THEN 'top' END,
        CASE WHEN pp.bottom IS NOT NULL AND pp.bottom <> '' THEN 'bottom' END
      ], NULL) AS angles
    FROM product_photos pp JOIN products p ON p.id = pp.product_id
    WHERE pp.deleted_at IS NULL AND pp.product_id IN (${Prisma.join(ids)})`;
  const metadata = new Map(rows.map(row => [row.product_id, row]));
  return products.map(p => {
    const row = metadata.get(p.id);
    const angles = PHOTO_ANGLES.filter(angle => row?.angles.includes(angle));
    const cover = [row?.cover, DEFAULT_LISTING_COVER].find(c => angles.some(angle => angle === c));
    const coverIndex = cover ? angles.findIndex(angle => angle === cover) : -1;
    if (coverIndex > 0) angles.unshift(...angles.splice(coverIndex, 1));
    return {
      ...p,
      gallery: angles.length ? angles.map(angle => listingPhotoUrl(p.id, angle, row!.revision)) : p.gallery,
      usesAutomaticPhotos: angles.length > 0,
      listingPhotoAngles: angles,
    };
  });
}
