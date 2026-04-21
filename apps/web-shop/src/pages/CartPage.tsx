import { useNavigate } from 'react-router';
import { useCart } from '../hooks/useCart';
import ShopLayout from '../components/layout/ShopLayout';
import CartItemRow from '../components/cart/CartItemRow';
import CartEmpty from '../components/cart/CartEmpty';
import CartSummary from '../components/cart/CartSummary';

export default function CartPage() {
  const nav = useNavigate();
  const { data, isLoading } = useCart();

  if (isLoading) {
    return (
      <ShopLayout>
        <div className="p-8 text-muted-foreground leading-snug">กำลังโหลด...</div>
      </ShopLayout>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <ShopLayout>
        <CartEmpty />
      </ShopLayout>
    );
  }

  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-6 grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-3">
          <h1 className="text-2xl font-bold mb-4 leading-snug">ตะกร้าของคุณ</h1>
          {data.items.map((i) => (
            <CartItemRow key={i.reservationId} item={i} />
          ))}
        </div>
        <CartSummary subtotal={data.subtotal} onCheckout={() => nav('/checkout')} />
      </div>
    </ShopLayout>
  );
}
