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
  const { user, refresh } = useAuth();
  const stored = (user?.preferences as { collectionsDefaultView?: CollectionsView } | null)
    ?.collectionsDefaultView;
  const initial: CollectionsView = stored ?? ROLE_DEFAULTS[user?.role ?? ''] ?? 'LIBRARY';
  const [view, setView] = useState<CollectionsView>(initial);

  useEffect(() => {
    if (stored && stored !== view) setView(stored);
    // Intentional: only re-sync when the persisted preference changes,
    // not when local `view` updates (that path is handled by setAndPersist).
    // eslint-plugin-react-hooks is not configured in this project so the
    // exhaustive-deps disable directive cannot be used here.
  }, [stored]); // eslint-disable-line

  const persist = useMutation({
    mutationFn: (next: CollectionsView) =>
      api.patch('/auth/me/preferences', { collectionsDefaultView: next }),
    onSuccess: () => refresh(),
  });

  const setAndPersist = (next: CollectionsView) => {
    setView(next);
    persist.mutate(next);
  };

  return { view, setView: setAndPersist };
}
