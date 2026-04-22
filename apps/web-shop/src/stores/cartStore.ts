import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CartState {
  reservationId: string | null;
  productId: string | null;
  addedAt: number | null;
  setItem: (r: string, p: string) => void;
  clear: () => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      reservationId: null,
      productId: null,
      addedAt: null,
      setItem: (r, p) => set({ reservationId: r, productId: p, addedAt: Date.now() }),
      clear: () => set({ reservationId: null, productId: null, addedAt: null }),
    }),
    { name: 'shop_cart' },
  ),
);
