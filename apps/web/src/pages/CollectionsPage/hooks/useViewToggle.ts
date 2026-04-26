import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

export type CollectionsView = 'SESSION' | 'LIBRARY';

const ROLE_DEFAULTS: Record<string, CollectionsView> = {
  SALES: 'SESSION',
  ACCOUNTANT: 'LIBRARY',
  OWNER: 'LIBRARY',
  BRANCH_MANAGER: 'LIBRARY',
  FINANCE_MANAGER: 'LIBRARY',
};

export function useViewToggle() {
  const auth = useAuth();
  const user = auth.user;
  const stored = (
    (user as unknown as { preferences?: { collectionsDefaultView?: CollectionsView } } | null)
      ?.preferences
  )?.collectionsDefaultView;
  const initial: CollectionsView = stored ?? ROLE_DEFAULTS[user?.role ?? ''] ?? 'LIBRARY';
  const [view, setView] = useState<CollectionsView>(initial);

  useEffect(() => {
    if (stored && stored !== view) setView(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);

  const persist = useMutation({
    mutationFn: (next: CollectionsView) =>
      api.patch('/auth/me/preferences', { collectionsDefaultView: next }),
    onSuccess: () => {
      // Best-effort refresh user — auth.refresh may or may not exist.
      const maybeRefresh = (auth as any).refresh;
      if (typeof maybeRefresh === 'function') maybeRefresh();
    },
  });

  const setAndPersist = (next: CollectionsView) => {
    setView(next);
    persist.mutate(next);
  };

  return { view, setView: setAndPersist };
}
