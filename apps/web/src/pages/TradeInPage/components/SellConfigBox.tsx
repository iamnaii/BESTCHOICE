import { SELL_EXCHANGE_BONUS_POLICY } from '@installment/shared';

/** Current fixed-bonus policy; legacy percentage configuration is retired. */
export default function SellConfigBox() {
  const policy = SELL_EXCHANGE_BONUS_POLICY;
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-4 leading-snug">
      <p className="font-medium">โบนัสเทิร์นตามราคาประเมินเงินสด</p>
      <p className="text-sm">ไม่เกิน {policy.threshold.toLocaleString('th-TH')} บาท เพิ่ม {policy.lowerBonus.toLocaleString('th-TH')} บาท · เกิน {policy.threshold.toLocaleString('th-TH')} บาท เพิ่ม {policy.upperBonus.toLocaleString('th-TH')} บาท</p>
      <p className="text-xs text-muted-foreground">ใช้ราคาหลังหักสภาพ · ราคา 0 บาทไม่มีโบนัส · เครดิตใช้ซื้อเครื่องในร้าน ไม่จ่ายเป็นเงินสด · รายการเดิมคงราคาที่บันทึกไว้</p>
    </div>
  );
}
