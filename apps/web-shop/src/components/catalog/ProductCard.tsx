import { Link } from 'react-router';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface ProductGroup {
  brand: string;
  model: string;
  minPrice: number;
  stockCount: number;
  thumbnailUrl?: string;
  monthlyPaymentFrom: number;
  conditionGrades?: string[];
  stock: { display: string; tone: string };
}

interface Props {
  product: ProductGroup;
}

function conditionVariant(g: string) {
  return g === 'A' ? 'condition-a' : g === 'B' ? 'condition-b' : 'condition-c';
}

export function ProductCard({ product: p }: Props) {
  const to = `/products?brand=${p.brand}&model=${encodeURIComponent(p.model)}`;
  const grades = p.conditionGrades ?? [];
  return (
    <Card variant="interactive" className="flex flex-col">
      <Link to={to} className="flex flex-col h-full">
        <div className="relative bg-zinc-50 aspect-square flex items-center justify-center">
          {p.thumbnailUrl ? (
            <img
              src={p.thumbnailUrl}
              alt={`${p.brand} ${p.model}`}
              className="max-h-full max-w-full object-contain"
              loading="lazy"
            />
          ) : (
            <div className="text-zinc-400 text-sm leading-snug">ไม่มีรูป</div>
          )}
          {grades.length > 0 && (
            <div className="absolute top-3 left-3 flex gap-1">
              {grades.map((g) => (
                <Badge key={g} variant={conditionVariant(g)} size="sm">
                  {g}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="p-4 flex-1 flex flex-col gap-1 leading-snug">
          <div className="font-semibold text-zinc-900">
            {p.brand} {p.model}
          </div>
          <div className="text-emerald-600 font-bold text-lg">
            เริ่มต้น ฿{p.minPrice.toLocaleString()}
          </div>
          <div className="text-xs text-muted-foreground">
            ผ่อนเริ่ม ฿{p.monthlyPaymentFrom.toLocaleString()}/เดือน
          </div>
          <div
            className={cn(
              'text-xs mt-auto pt-2',
              p.stock.tone === 'urgent' ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {p.stock.display}
          </div>
        </div>
      </Link>
    </Card>
  );
}
