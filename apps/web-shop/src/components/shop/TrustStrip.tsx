import { ShieldCheck, Wallet, MessageCircle, BadgeCheck } from 'lucide-react';

interface Item {
  icon: React.ReactNode;
  title: string;
  description: string;
}

const DEFAULT_ITEMS: Item[] = [
  {
    icon: <BadgeCheck className="size-6" />,
    title: 'บัตรประชาชนใบเดียว',
    description: 'ไม่เช็กบูโร ไม่ต้องใช้บัตรเครดิต',
  },
  {
    icon: <Wallet className="size-6" />,
    title: 'ดาวน์เริ่ม 900 บาท',
    description: 'ผ่อนสูงสุด 12 งวด',
  },
  {
    icon: <ShieldCheck className="size-6" />,
    title: 'รับประกันร้าน 60 วัน',
    description: 'ครอบคลุมปัญหาการใช้งานปกติ',
  },
  {
    icon: <MessageCircle className="size-6" />,
    title: 'ผ่อนได้ทุกอาชีพ',
    description: 'ค้าขาย โรงงาน นักศึกษา ก็ผ่อนได้',
  },
];

interface Props {
  items?: Item[];
  className?: string;
}

export function TrustStrip({ items = DEFAULT_ITEMS, className }: Props) {
  return (
    <div className={className}>
      <ul className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-3 leading-snug">
            {/* Guide USP tile: mint-tint box, deep-green icon. */}
            <span className="size-10 rounded-xl bg-muted text-primary grid place-items-center shrink-0">
              {item.icon}
            </span>
            <div className="space-y-0.5">
              <div className="font-head text-sm font-semibold">{item.title}</div>
              <div className="text-xs text-muted-foreground">{item.description}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
