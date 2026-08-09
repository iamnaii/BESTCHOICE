import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, productStatusMap } from '@/lib/status-badges';
import { formatBaht } from '../utils/buildCustomerSummary';
import { getPositiveDisplayPrices, type ProductPriceRow } from '@/utils/getDisplayPrices';

interface SameModelProduct {
  id: string;
  color: string | null;
  storage: string | null;
  status: string;
  // ราคาต้องผ่าน getPositiveDisplayPrices เสมอ (ห้ามอ่าน cashPrice/installmentPrice ดิบ —
  // บั๊ก class นี้โดน REJECT มาแล้วใน Task 9 review round 1 / C1) — ต้องประกาศ 3 ฟิลด์นี้ให้ครบ
  // เพื่อให้ SameModelProduct ตรงกับ ProductForDisplay ที่ helper ต้องการ
  cashPrice: string | null;
  installmentPrice: string | null;
  prices: ProductPriceRow[];
  branch: { name: string };
}

interface Props {
  productId: string;
  model: string;
  storage: string | null;
}

export default function SameModelCard({ productId, model, storage }: Props) {
  const { data } = useQuery<{ data: SameModelProduct[] }>({
    queryKey: ['products', 'same-model', model, storage],
    queryFn: async () => {
      const res = await api.get('/products', {
        params: {
          model,
          ...(storage ? { storage } : {}),
          // comma string: ไม่ต้องพึ่ง paramsSerializer ของ axios (service split ให้)
          status: 'IN_STOCK,RESERVED',
          limit: 20,
        },
      });
      return res.data;
    },
    enabled: !!model,
  });

  const others = (data?.data ?? []).filter((p) => p.id !== productId);
  if (others.length === 0) return null;

  return (
    <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
      <CardHeader>
        <CardTitle>เครื่องอื่นรุ่นเดียวกัน ({others.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {others.map((p) => {
            const cfg = getStatusBadgeProps(p.status, productStatusMap);
            // prices[] มาจาก Prisma include เสมอเป็น array (ไม่มีวัน undefined ใน production)
            // แต่กันไว้เผื่อ endpoint sibling อนาคตส่ง shape ที่ไม่มี prices[] — ป้องกัน
            // pickFromPrices ข้างใน helper พัง ('.find' ของ undefined)
            const { cash } = getPositiveDisplayPrices({ ...p, prices: p.prices ?? [] });
            return (
              <li key={p.id}>
                <Link
                  to={`/products/${p.id}`}
                  className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg hover:bg-muted/50 min-h-11"
                >
                  <span className="text-sm text-foreground leading-snug">
                    {[p.color, p.storage].filter(Boolean).join(' · ') || 'ไม่ระบุสี'}
                    <span className="block text-xs text-muted-foreground">{p.branch?.name}</span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-semibold tabular-nums">
                      {cash != null ? `${formatBaht(cash)} ฿` : '-'}
                    </span>
                    <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">
                      {cfg.label}
                    </Badge>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
