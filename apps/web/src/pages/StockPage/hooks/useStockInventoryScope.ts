import { useCallback, useEffect } from 'react';
import { isStockInventoryScope, type StockInventoryScope } from '@installment/shared';
import { useLatestSearchParams } from '@/hooks/useLatestSearchParams';

export function useStockInventoryScope(
  defaultScope: StockInventoryScope,
  [params, update]: ReturnType<typeof useLatestSearchParams>,
) {
  const raw = params.get('inventoryScope');
  const inventoryScope = isStockInventoryScope(raw) ? raw : defaultScope;
  useEffect(() => {
    if (raw !== null && !isStockInventoryScope(raw))
      update((next) => next.set('inventoryScope', defaultScope));
  }, [raw, defaultScope, update]);
  const setInventoryScope = useCallback(
    (value: StockInventoryScope) => {
      update(
        (next) => {
          next.set('inventoryScope', value);
          if (value === 'accessories') next.delete('deviceOrigin');
          ['page', 'category', 'accessoryGroupId'].forEach((key) => next.delete(key));
        },
        { replace: false },
      );
    },
    [update],
  );
  return { inventoryScope, setInventoryScope };
}
