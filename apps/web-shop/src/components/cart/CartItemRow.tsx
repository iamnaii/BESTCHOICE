import ReservationCountdownBadge from './ReservationCountdownBadge';

interface Props {
  item: {
    reservationId: string;
    productId: string;
    expiresAt: string;
    product: {
      id: string;
      name: string;
      sellingPrice: number;
      gallery: string[];
      conditionGrade: string | null;
    };
  };
}

export default function CartItemRow({ item }: Props) {
  return (
    <div className="flex gap-4 rounded-xl border border-border p-4">
      {item.product.gallery?.[0] && (
        <img
          src={item.product.gallery[0]}
          alt={item.product.name}
          className="h-24 w-24 rounded-lg object-cover bg-muted"
        />
      )}
      <div className="flex-1 space-y-1 leading-snug">
        <div className="font-semibold">{item.product.name}</div>
        {item.product.conditionGrade && (
          <div className="text-xs text-muted-foreground">เกรด {item.product.conditionGrade}</div>
        )}
        <ReservationCountdownBadge expiresAt={item.expiresAt} />
      </div>
      <div className="text-right font-bold leading-snug">
        ฿{Number(item.product.sellingPrice).toLocaleString()}
      </div>
    </div>
  );
}
