import { categoryOptions } from '@/lib/constants';

const ORIGIN_LABEL: Record<string, string> = { THAI: 'เครื่องไทย', IMPORTED: 'เครื่องนอก' };

function Pill({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs leading-snug text-foreground">
      {children}
    </span>
  );
}

/** สรุปเครื่องที่กำลังจะบันทึก — คอลัมน์ขวา (จอคอม) ให้เห็นตลอดไม่ต้องเลื่อนขึ้นไปดู */
export default function CreateSummary({
  name,
  category,
  deviceOrigin,
  batteryHealth,
  shopWarrantyDays,
}: {
  name: string;
  category: string;
  deviceOrigin: string;
  batteryHealth: string;
  shopWarrantyDays: string;
}) {
  const accessory = category === 'ACCESSORY';
  const pills: string[] = [categoryOptions.find((o) => o.value === category)?.label ?? category];
  if (!accessory && ORIGIN_LABEL[deviceOrigin]) pills.push(ORIGIN_LABEL[deviceOrigin]);
  if (category === 'PHONE_USED' && batteryHealth) pills.push(`แบต ${batteryHealth}%`);
  if (!accessory) {
    const days = Number(shopWarrantyDays);
    pills.push(days > 0 ? `ประกันร้าน ${days} วัน` : 'ไม่มีประกันร้าน');
  }
  return (
    <section
      aria-label="สรุปสินค้า"
      className="rounded-xl bg-card p-5 text-card-foreground shadow-sm shadow-black/5 dark:border dark:border-border"
    >
      <p className="text-xs leading-snug text-muted-foreground">สินค้าที่จะบันทึก</p>
      <p className="mt-1 text-lg font-semibold leading-snug text-foreground">
        {name || <span className="font-normal text-muted-foreground">ยังไม่ได้เลือกรุ่น</span>}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {pills.map((p) => (
          <Pill key={p}>{p}</Pill>
        ))}
      </div>
    </section>
  );
}
