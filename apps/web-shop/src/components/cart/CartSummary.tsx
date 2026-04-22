import { Button } from '../ui/button';

interface Props {
  subtotal: number;
  onCheckout: () => void;
}

export default function CartSummary({ subtotal, onCheckout }: Props) {
  return (
    <div className="rounded-xl border border-border p-6 space-y-3 sticky top-4 leading-snug">
      <div className="flex justify-between text-sm">
        <span>ราคาสินค้า</span>
        <span>฿{subtotal.toLocaleString()}</span>
      </div>
      <div className="flex justify-between text-sm text-muted-foreground">
        <span>ค่าจัดส่ง</span>
        <span>คำนวณขั้นตอนถัดไป</span>
      </div>
      <div className="border-t pt-3 flex justify-between font-bold">
        <span>ยอดรวม</span>
        <span>฿{subtotal.toLocaleString()}</span>
      </div>
      <Button className="w-full" size="lg" onClick={onCheckout}>
        ดำเนินการชำระเงิน
      </Button>
    </div>
  );
}
