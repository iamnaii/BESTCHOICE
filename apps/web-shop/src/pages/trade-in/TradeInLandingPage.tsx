import { Link } from 'react-router';
import ShopLayout from '@/components/layout/ShopLayout';
import { Button } from '@/components/ui/button';

const STEPS: Array<{ n: number; title: string; desc: string }> = [
  { n: 1, title: 'บอกข้อมูลเครื่องเก่า', desc: 'รุ่น ความจุ สภาพเครื่อง' },
  { n: 2, title: 'ถ่ายรูปเครื่อง', desc: 'หน้า หลัง ข้าง จอ กล่อง (ถ้ามี)' },
  { n: 3, title: 'รับราคาภายใน 24 ชม.', desc: 'ทีมงานตอบกลับทาง LINE' },
];

export default function TradeInLandingPage() {
  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-8 max-w-xl space-y-6 leading-snug">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold">เก่าแลกใหม่</h1>
          <p className="text-muted-foreground">
            แลกเครื่องเก่าของคุณเป็นส่วนลดซื้อเครื่องใหม่ — ได้ราคาดีกว่าขายต่อเอง
            ไม่ต้องเจอมิจฉาชีพ ไม่ต้องรอคนซื้อ
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

        <Button asChild size="lg" className="w-full">
          <Link to="/trade-in/submit">เริ่มทำเรื่อง</Link>
        </Button>

        <p className="text-xs text-muted-foreground text-center">
          หรือสอบถามก่อนผ่าน LINE @bestchoice
        </p>
      </div>
    </ShopLayout>
  );
}
