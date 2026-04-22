interface Props {
  productPrice: number;
  shippingFee: number;
  promoDiscount: number;
  loyaltyDiscount: number;
}

export default function OrderSummaryCard(p: Props) {
  const total = Math.max(0, p.productPrice + p.shippingFee - p.promoDiscount - p.loyaltyDiscount);
  return (
    <div className="rounded-xl border border-border p-4 space-y-2 text-sm leading-snug">
      <div className="flex justify-between">
        <span>ราคาสินค้า</span>
        <span>฿{p.productPrice.toLocaleString()}</span>
      </div>
      <div className="flex justify-between">
        <span>ค่าจัดส่ง</span>
        <span>฿{p.shippingFee.toLocaleString()}</span>
      </div>
      {p.promoDiscount > 0 && (
        <div className="flex justify-between text-primary">
          <span>ส่วนลดโค้ด</span>
          <span>-฿{p.promoDiscount.toLocaleString()}</span>
        </div>
      )}
      {p.loyaltyDiscount > 0 && (
        <div className="flex justify-between text-primary">
          <span>ส่วนลดแต้ม</span>
          <span>-฿{p.loyaltyDiscount.toLocaleString()}</span>
        </div>
      )}
      <div className="border-t pt-2 flex justify-between font-bold text-base">
        <span>รวมที่ต้องชำระ</span>
        <span>฿{total.toLocaleString()}</span>
      </div>
    </div>
  );
}
