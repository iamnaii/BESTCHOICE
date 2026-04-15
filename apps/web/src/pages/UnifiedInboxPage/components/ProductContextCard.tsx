import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Smartphone, Tag, BadgePercent } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface ProductContextCardProps {
  roomId: string;
}

export default function ProductContextCard({ roomId }: ProductContextCardProps) {
  const { data: products, isLoading } = useQuery<any[]>({
    queryKey: ['chat-products', roomId],
    queryFn: () =>
      api.get(`/staff-chat/rooms/${roomId}/products`).then((r: any) => r.data?.data ?? r.data),
    enabled: !!roomId,
    staleTime: 60_000,
  });

  if (isLoading || !products || products.length === 0) return null;

  return (
    <div className="border-t border-gray-200 pt-3">
      <div className="flex items-center gap-2 mb-2 px-4">
        <Smartphone className="size-3.5 text-primary opacity-60" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/60">
          สินค้าที่กำลังคุย
        </span>
      </div>

      <div className="space-y-2 px-4">
        {products.map((product: any) => (
          <div key={product.id} className="bg-muted/40 rounded-lg p-3 text-[12px]">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-[13px]">{product.name}</p>
                <p className="text-muted-foreground">
                  {product.brand} {product.model}
                </p>
              </div>
              <Badge
                variant={product.stock > 0 ? 'success' : 'destructive'}
                className="text-[10px]"
              >
                {product.stock > 0 ? `${product.stock} เครื่อง` : 'หมด'}
              </Badge>
            </div>

            <p className="text-primary font-bold mt-1.5">
              ฿{product.price?.toLocaleString() ?? '0'}
            </p>

            {product.pricingOptions?.length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {product.pricingOptions.slice(0, 2).map((opt: any, i: number) => (
                  <p key={i} className="text-muted-foreground flex items-center gap-1">
                    <Tag className="size-3 opacity-40" />
                    ผ่อน {opt.installments} งวด {opt.monthlyPayment?.toLocaleString() ?? '?'} บ./ด.
                    (ดาวน์ {opt.downPaymentMin}%)
                  </p>
                ))}
              </div>
            )}

            {product.activePromotions?.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {product.activePromotions.map((promo: any) => (
                  <Badge key={promo.id} variant="secondary" className="text-[10px]">
                    <BadgePercent className="size-2.5 mr-0.5" />
                    {promo.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
