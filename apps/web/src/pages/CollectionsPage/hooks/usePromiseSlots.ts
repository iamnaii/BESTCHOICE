import { useState, useCallback } from 'react';

export interface PromiseSlot {
  id: string; // local UUID for React key (not server-side)
  settlementDate: string; // YYYY-MM-DD
  settlementAmount: string; // number string
}

const newSlot = (): PromiseSlot => ({
  id: crypto.randomUUID(),
  settlementDate: '',
  settlementAmount: '',
});

export function usePromiseSlots(initial?: PromiseSlot[]) {
  const [slots, setSlots] = useState<PromiseSlot[]>(initial ?? [newSlot()]);

  const addSlot = useCallback(() => {
    setSlots((prev) => [...prev, newSlot()]);
  }, []);

  const removeSlot = useCallback((id: string) => {
    setSlots((prev) => (prev.length > 1 ? prev.filter((s) => s.id !== id) : prev));
  }, []);

  const updateSlot = useCallback((id: string, patch: Partial<PromiseSlot>) => {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const reset = useCallback((next?: PromiseSlot[]) => {
    setSlots(next ?? [newSlot()]);
  }, []);

  return { slots, addSlot, removeSlot, updateSlot, reset, setSlots };
}
