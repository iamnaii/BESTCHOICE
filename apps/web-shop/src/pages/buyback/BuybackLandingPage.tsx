import { Link } from 'react-router';
import ShopLayout from '@/components/layout/ShopLayout';
import { Button } from '@/components/ui/button';

const STEPS: Array<{ n: number; title: string; desc: string }> = [
  { n: 1, title: 'บอกข้อมูลเครื่อง', desc: 'รุ่น ความจุ สภาพ — ใช้เวลา 30 วินาที' },
  { n: 2, title: 'รับราคาประเมินทันที', desc: 'เห็นช่วงราคาก่อนตัดสินใจ' },
  { n: 3, title: 'ส่งรูป รับราคาจริง 24 ชม.', desc: 'ทีมงานยืนยันราคาและนัดรับเครื่อง' },
];

export default function BuybackLandingPage() {
  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-8 max-w-xl space-y-6 leading-snug">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold">ขายมือถือเก่า</h1>
          <p className="text-muted-foreground">
            รับซื้อมือถือเก่าของคุณในราคายุติธรรม — จ่ายเงินสด ไม่ต้องเจอมิจฉาชีพ
            ไม่ต้องลงประกาศ ไม่ต้องรอคนซื้อ
          </p>
        </header>

        <ol className="grid gap-4">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-xl border border-border p-4 flex gap-4">
              <div
                className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold"
                aria-hidden
              >
                {s.n}
              </div>
              <div>
                <div className="font-semibold">{s.title}</div>
                <div className="text-sm text-muted-foreground">{s.desc}</div>
              </div>
            </li>
          ))}
        </ol>

        <div className="grid gap-2">
          <Button asChild size="lg" className="w-full">
            <Link to="/buyback/quote">เช็คราคาทันที</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="w-full">
            <Link to="/buyback/submit">ข้ามไปส่งข้อมูลเลย</Link>
          </Button>
        </div>

        <p className="text-xs text-muted-foreground text-center">
          หรือสอบถามก่อนผ่าน LINE @bestchoice
        </p>
      </div>
    </ShopLayout>
  );
}
