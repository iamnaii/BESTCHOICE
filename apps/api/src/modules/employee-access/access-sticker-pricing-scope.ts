import { Prisma } from '@prisma/client';
import { currentDomainAccess, currentPermissionScope } from './access-execution-context';
import { productScopeWhere } from './access-query-scope';
/** Both actions keep their own original company/branch tuples. */
export function stickerProductWhere(): Prisma.ProductWhereInput {
  if (!currentDomainAccess()) return {};
  return {
    AND: ['stickers.create', 'products.read'].map((key) =>
      productScopeWhere(currentPermissionScope(key as 'stickers.create' | 'products.read')!),
    ),
  };
}
