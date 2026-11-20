import { useQuery } from '@tanstack/react-query';
import type { GfinDeviceOrigin } from '@installment/shared';
import api from '@/lib/api';
import type { PriceListCategory, PriceQuoteList } from './types';

export interface PriceQuoteParams {
  category: PriceListCategory;
  origin: GfinDeviceOrigin;
  /** คำค้นที่ trim แล้ว · ว่าง = ไม่ส่ง q */
  q: string;
}

/** `GET /pricing-templates/quotes` — คงแถวชุดเดิมไว้ระหว่างโหลดชุดใหม่ (สลับปุ่ม/พิมพ์ค้นแล้วหน้าไม่กระพริบ) */
export function usePriceQuotes({ category, origin, q }: PriceQuoteParams) {
  return useQuery({
    queryKey: ['price-quotes', category, origin, q],
    queryFn: async ({ signal }) =>
      (
        await api.get<PriceQuoteList>('/pricing-templates/quotes', {
          params: { category, origin, ...(q ? { q } : {}) },
          signal,
        })
      ).data,
    // เก็บแถวเดิมไว้เฉพาะตอนพิมพ์ค้น — สลับมือ 1/2 หรือไทย/นอก ต้องไม่เห็นราคาชุดเก่า
    placeholderData: (prev, prevQuery) =>
      prevQuery?.queryKey[1] === category && prevQuery?.queryKey[2] === origin ? prev : undefined,
    staleTime: 60_000,
  });
}
