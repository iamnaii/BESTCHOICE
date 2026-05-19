import { Store, Wallet } from 'lucide-react';
import { useEntityScope } from '@/contexts/EntityScopeContext';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';

/**
 * SP7.3 — Dual-entity pill switcher.
 * Renders two toggle pills (หน้าร้าน / ไฟแนนซ์) for users who have access
 * to both SHOP and FINANCE. Invisible for single-entity users.
 * Switching scope invalidates all React Query caches so data re-fetches
 * with the new ?company= query param injected by the axios interceptor.
 */
export function CompanyPillSwitcher() {
  const { scope, setScope, canSwitch, accessibleCompanies } = useEntityScope();
  const queryClient = useQueryClient();

  if (!canSwitch) return null;

  const handleSwitch = (next: 'SHOP' | 'FINANCE') => {
    if (next === scope) return;
    setScope(next);
    // Invalidate ALL queries — entity scope determines API responses
    queryClient.invalidateQueries();
  };

  return (
    <div
      className="inline-flex items-center gap-1 rounded-full bg-muted p-1 leading-snug"
      role="tablist"
      aria-label="สลับบริษัท"
    >
      {accessibleCompanies.includes('SHOP') && (
        <button
          type="button"
          role="tab"
          aria-selected={scope === 'SHOP'}
          onClick={() => handleSwitch('SHOP')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition leading-snug',
            scope === 'SHOP'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Store className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          หน้าร้าน
        </button>
      )}
      {accessibleCompanies.includes('FINANCE') && (
        <button
          type="button"
          role="tab"
          aria-selected={scope === 'FINANCE'}
          onClick={() => handleSwitch('FINANCE')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition leading-snug',
            scope === 'FINANCE'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Wallet className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          ไฟแนนซ์
        </button>
      )}
    </div>
  );
}
