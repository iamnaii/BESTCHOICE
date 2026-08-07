import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateShort } from '@/utils/formatters';

interface ActivePromotion {
  id: string;
  name: string;
  description: string | null;
  endDate: string;
}

export default function ActivePromotionsCard() {
  const { data } = useQuery<ActivePromotion[]>({
    queryKey: ['promotions', 'active'],
    queryFn: async () => {
      const res = await api.get('/promotions/active');
      return res.data;
    },
    retry: false,
  });

  const promotions = data ?? [];
  if (promotions.length === 0) return null;

  return (
    <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
      <CardHeader>
        <CardTitle>โปรที่ใช้ได้ตอนนี้ ({promotions.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {promotions.map((p) => (
            <li key={p.id} className="text-sm leading-snug">
              <span className="font-medium text-foreground">{p.name}</span>
              {p.description && (
                <span className="block text-xs text-muted-foreground">{p.description}</span>
              )}
              <span className="block text-xs text-muted-foreground">
                ถึง {formatDateShort(p.endDate)}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground leading-snug">
          ยังไม่กรองรายเครื่อง (มาใน B3)
        </p>
      </CardContent>
    </Card>
  );
}
