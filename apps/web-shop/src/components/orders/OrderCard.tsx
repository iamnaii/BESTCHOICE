import { Link } from 'react-router';
import OrderStatusBadge from './OrderStatusBadge';

interface Props {
  order: {
    id: string;
    orderNumber: string;
    status: string;
    totalAmount: number | string;
    product: { name: string; gallery: string[] };
  };
}

export default function OrderCard({ order }: Props) {
  return (
    <Link
      to={`/orders/${order.orderNumber}`}
      className="block rounded-xl border border-border p-4 hover:border-primary transition-colors leading-snug"
    >
      <div className="flex justify-between items-start">
        <div>
          <div className="font-semibold">{order.orderNumber}</div>
          <div className="text-sm text-muted-foreground">{order.product.name}</div>
        </div>
        <OrderStatusBadge status={order.status} />
      </div>
      <div className="mt-2 text-right font-bold">
        ฿{Number(order.totalAmount).toLocaleString()}
      </div>
    </Link>
  );
}
