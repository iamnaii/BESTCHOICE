import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useCartStore } from '../stores/cartStore';
import { getSessionId } from '../lib/session';

export function useCart() {
  const store = useCartStore();
  const q = useQuery({
    queryKey: ['cart', store.reservationId],
    queryFn: async () => {
      const res = await api.get('/api/shop/cart', {
        headers: { 'x-shop-session': getSessionId() },
      });
      return res.data as {
        items: Array<{
          reservationId: string;
          productId: string;
          expiresAt: string;
          secondsRemaining: number;
          product: {
            id: string;
            name: string;
            sellingPrice: number;
            gallery: string[];
            conditionGrade: string | null;
          };
        }>;
        subtotal: number;
      };
    },
    enabled: !!store.reservationId,
    refetchInterval: 5000,
  });
  return { ...q, clear: store.clear };
}
