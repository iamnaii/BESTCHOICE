import { ShieldCheck, Wallet, MessageCircle, BadgeCheck } from 'lucide-react';

interface Item {
  icon: React.ReactNode;
  title: string;
  description: string;
}

const DEFAULT_ITEMS: Item[] = [
  {
    icon: <ShieldCheck className="size-6" />,
    title: 'รับประกันร้าน 30 วัน',
    description: 'ครอบคลุมปัญหาการใช้งานปกติ',
  },
  {
    icon: <BadgeCheck className="size-6" />,
    title: 'ตรวจสอบ 30 จุด',
    description: 'เครื่องทุกเครื่องผ่านเช็คมาตรฐาน',
  },
  {
    icon: <Wallet className="size-6" />,
    title: 'ผ่อนได้บัตร ปชช. ใบเดียว',
    description: '3-12 งวด ไม่ต้องใช้บัตรเครดิต',
  },
  {
    icon: <MessageCircle className="size-6" />,
    title: 'ติดต่อผ่าน LINE',
    description: 'ทีมงานตอบไวในเวลาทำการ',
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
            <span className="text-emerald-500 shrink-0">{item.icon}</span>
            <div className="space-y-0.5">
              <div className="text-sm font-semibold">{item.title}</div>
              <div className="text-xs text-muted-foreground">{item.description}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
