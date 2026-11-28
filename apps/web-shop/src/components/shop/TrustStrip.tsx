import { ShieldCheck, Wallet, MessageCircle, BadgeCheck } from '@/lib/icons';
import { type DownFloor, downFloorText, useKnownDownFloor } from '@/hooks/useDownFloor';

interface Item {
  icon: React.ReactNode;
  title: string;
  description: string;
}

/**
 * การ์ดดาวน์เปลี่ยนตามสต๊อก (เจ้าของ 2026-11-27 "ใช้หัวพาดกับการ์ด ตามสต๊อค"):
 * รู้ยอด = "ดาวน์เริ่ม X บาท" · ยังไม่รู้ (โหลด / API ล่ม) = ไม่บอกตัวเลขดาวน์
 */
function downTrustItem(floor: DownFloor | null): Item {
  return floor
    ? {
        icon: <Wallet className="size-6" />,
        title: downFloorText(floor),
        description: 'ผ่อนสูงสุด 15 งวด',
      }
    : {
        icon: <Wallet className="size-6" />,
        title: 'ผ่อนสูงสุด 15 งวด',
        description: 'ดาวน์ตามที่หน้าเครื่องแสดง',
      };
}

const defaultItems = (floor: DownFloor | null): Item[] => [
  {
    icon: <BadgeCheck className="size-6" />,
    title: 'บัตรประชาชนใบเดียว',
    description: 'ไม่เช็กบูโร ไม่ต้องใช้บัตรเครดิต',
  },
  downTrustItem(floor),
  {
    icon: <ShieldCheck className="size-6" />,
    title: 'มือ 2 ประกันร้าน 60 วัน',
    description: 'เครื่องใหม่ใช้ประกันศูนย์',
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

export function TrustStrip({ items, className }: Props) {
  const downFloor = useKnownDownFloor();
  const shown = items ?? defaultItems(downFloor);
  return (
    <div className={className}>
      <ul className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6">
        {shown.map((item, i) => (
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
