import { cn } from '@/lib/utils';

/** หนึ่งทางผ่อนบนการ์ด: วางดาวน์เท่าไร ผ่อนเดือนละเท่าไร กี่งวด */
export interface PlanQuote {
  down: number;
  monthly: number;
  months: number | null;
}

/**
 * กล่องล่างมีไว้บอก "ทางที่ใช้เงินดาวน์น้อยกว่า" (เจ้าของ 2026-11-25 ข้อ ก1) —
 * ดาวน์เท่ากันหรือมากกว่ากล่องบนจึงไม่ขึ้น (เทียบค่างวดได้ในหน้ารายละเอียด)
 */
export function showsRate2Tile(rate1: PlanQuote | null, rate2: PlanQuote | null): boolean {
  if (!rate2) return false;
  return !rate1 || rate2.down < rate1.down;
}

// px-1.5 บนมือถือ: ที่จอ 360px กล่องกว้าง 126px — ค่างวดห้าหลัก ("ผ่อน ฿12,345 × 12 งวด")
// กว้าง 120px ต้องได้พื้นที่ครบจึงไม่ยื่นออกนอกกล่อง
const TILE = 'rounded-2xl px-1.5 py-2 sm:px-3';
const BIG = 'num text-xl md:text-2xl font-bold whitespace-nowrap';
const BIG_NUM = 'leading-tight';

function InstallmentLine({ plan }: { plan: PlanQuote }) {
  return (
    // บรรทัดเดียวตั้งแต่จอ 360px ขึ้นไป (สเปคหัวข้อ 4) · จอแคบกว่านั้นกล่องกว้างไม่พอ
    // จึงยอมตัดได้ที่เดียว — ระหว่าง "ผ่อน ฿X" กับ "× N งวด" — แทนการยื่นออกนอกกล่อง
    <p
      data-plan-line
      className="num mt-0.5 text-xs text-muted-foreground leading-snug min-[360px]:whitespace-nowrap"
    >
      <span className="whitespace-nowrap">
        ผ่อน <span className="font-semibold text-primary">฿{plan.monthly.toLocaleString()}</span>
      </span>{' '}
      <span className="whitespace-nowrap">
        {plan.months ? `× ${plan.months} งวด` : 'ต่อเดือน'}
      </span>
    </p>
  );
}

function DownTile({ plan, kind }: { plan: PlanQuote; kind: 'rate1' | 'rate2' }) {
  return (
    <div data-plan={kind} className={cn(TILE, 'bg-muted')}>
      <div className="font-head text-xs font-medium text-muted-foreground leading-snug">ดาวน์</div>
      <div className={cn(BIG, BIG_NUM, 'text-primary')}>฿{plan.down.toLocaleString()}</div>
      <InstallmentLine plan={plan} />
    </div>
  );
}

interface Props {
  /** ทางที่ลูกค้าตั้งดาวน์เอง (เรท 1) — null = คิดไม่ได้ */
  rate1: PlanQuote | null;
  /** แผนเรท 2 ที่ค่าตั้งต้นของเครื่อง — null = คิดไม่ได้ */
  rate2: PlanQuote | null;
  /** ลูกค้าติ๊กฟรีดาวน์: ไม่มีเงินดาวน์ จึงไม่แสดงกล่องเรท 1 */
  freeDownOnly?: boolean;
}

/** กล่องราคาโหมดผ่อนของการ์ดหน้ารวม — บนการ์ดไม่มีคำว่า "เรท" และไม่มี % (สเปค 2026-11-25 หัวข้อ 4) */
export function PlanTiles({ rate1, rate2, freeDownOnly = false }: Props) {
  const top = freeDownOnly ? null : rate1;
  const bottom = showsRate2Tile(top, rate2) ? rate2 : null;

  if (!top && !bottom) {
    return <span className="text-sm font-medium text-muted-foreground">สอบถามค่างวด</span>;
  }

  return (
    <div className="space-y-1.5">
      {top && <DownTile plan={top} kind="rate1" />}
      {bottom &&
        (bottom.down === 0 ? (
          // เหลืองสงวนให้โปรจริง — ฟรีดาวน์เข้าข่าย · มีคำกำกับเสมอ ไม่บอกด้วยสีอย่างเดียว
          <div
            data-plan="free-down"
            className={cn(TILE, 'bg-sand-50 ring-1 ring-inset ring-promo/60')}
          >
            <div className={cn(BIG, 'font-head leading-snug text-sand-900')}>ฟรีดาวน์</div>
            <InstallmentLine plan={bottom} />
          </div>
        ) : (
          <DownTile plan={bottom} kind="rate2" />
        ))}
    </div>
  );
}
