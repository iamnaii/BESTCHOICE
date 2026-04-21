import { Link } from 'react-router';

export default function CartEmpty() {
  return (
    <div className="text-center py-16 leading-snug">
      <div className="text-muted-foreground">ตะกร้าของคุณว่างเปล่า</div>
      <Link
        to="/products"
        className="mt-4 inline-block text-primary underline-offset-4 hover:underline"
      >
        ไปเลือกซื้อสินค้า
      </Link>
    </div>
  );
}
