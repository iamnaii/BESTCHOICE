import { useState } from 'react';

export function useBulkSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = (ids: string[]) =>
    setSelected((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      return allSelected ? new Set<string>() : new Set(ids);
    });

  const clear = () => setSelected(new Set<string>());

  return {
    selectedIds: selected,
    isSelected: (id: string) => selected.has(id),
    toggle,
    toggleAll,
    clear,
    count: selected.size,
  };
}
