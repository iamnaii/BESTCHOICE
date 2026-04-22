import { Link } from 'react-router';
import ShopLayout from '../../components/layout/ShopLayout';
import { Button } from '../../components/ui/button';

export default function SavingPlanLandingPage() {
  const steps = [
    {
      n: 1,
      title: 'ตั้งเป้าหมายเงินดาวน์',
      desc: 'เลือกรุ่นที่อยากได้ และกำหนดยอดเงินดาวน์ที่ต้องการ',
    },
    {
      n: 2,
      title: 'ออมทีละน้อยทุกเดือน',
      desc: 'เลือกออม 2-12 เดือน เริ่มต้น 500 บาท/เดือน ผ่าน QR PaySolutions',
    },
    {
      n: 3,
      title: 'ใช้เป็นเงินดาวน์ได้ทันที',
      desc: 'เมื่อออมครบ นำยอดสะสมไปใช้ดาวน์เครื่องที่อยากได้ได้เลย',
    },
  ];
  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-8 max-w-xl space-y-6 leading-snug">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">ออมดาวน์</h1>
          <p className="text-muted-foreground">
            ออมดาวน์ให้เครื่องที่คุณอยากได้ — เก็บเงินทีละน้อย เริ่ม 500 บาท/เดือน
          </p>
        </div>

        <div className="space-y-3">
          {steps.map((s) => (
            <div key={s.n} className="rounded-xl border border-border p-4 flex gap-3">
              <div className="flex-shrink-0 w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                {s.n}
              </div>
              <div>
                <div className="font-semibold">{s.title}</div>
                <div className="text-sm text-muted-foreground">{s.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <Link to="/saving-plan/create" className="block">
          <Button className="w-full">สร้างแผน</Button>
        </Link>

        <Link
          to="/account/saving-plans"
          className="block text-center text-sm text-primary underline-offset-4 hover:underline"
        >
          ดูแผนออมของฉัน
        </Link>
      </div>
    </ShopLayout>
  );
}
