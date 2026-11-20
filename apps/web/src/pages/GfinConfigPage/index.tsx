import { useSearchParams } from 'react-router';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { GfinPrecheckSettingsPanel } from './GfinPrecheckSettingsPanel';
import { TermsTab } from './terms/TermsTab';
import { CalcTab } from './calc/CalcTab';

type TabKey = 'terms' | 'calc' | 'line';
const OWNER_TABS: TabKey[] = ['terms', 'calc', 'line'];
const OTHER_TABS: TabKey[] = ['line'];

/** ตั้งค่า GFIN — 3 แท็บผูกกับ ?tab= (ลิงก์ตรงได้ · กดย้อนกลับได้ — สเปก §6.1) */
export default function GfinConfigPage() {
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const [searchParams, setSearchParams] = useSearchParams();
  const allowed = isOwner ? OWNER_TABS : OTHER_TABS;
  const requested = searchParams.get('tab') as TabKey | null;
  const tab: TabKey = requested && allowed.includes(requested) ? requested : allowed[0];

  const onTab = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', value);
    next.delete('edit');
    setSearchParams(next);
  };

  return (
    <div className="container mx-auto space-y-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold leading-snug">ตั้งค่า GFIN</h1>
        <p className="text-sm text-muted-foreground leading-snug">
          {isOwner
            ? 'ราคาและเงื่อนไขตามใบ G Finn รายรุ่น · ทดลองคำนวณด้วยสูตรเดียวกับหน้าสินค้า · กลุ่มไลน์และแม่แบบชุดเช็ค'
            : 'กลุ่มไลน์ที่รับชุดเช็ค GFIN และแม่แบบข้อความ 12 ข้อ'}
        </p>
      </div>
      <Tabs value={tab} onValueChange={onTab}>
        <TabsList>
          {isOwner && <TabsTrigger value="terms">เงื่อนไข &amp; ราคา</TabsTrigger>}
          {isOwner && <TabsTrigger value="calc">ทดลองคำนวณ</TabsTrigger>}
          <TabsTrigger value="line">กลุ่มไลน์ &amp; ข้อความ</TabsTrigger>
        </TabsList>
        {isOwner && (
          <TabsContent value="terms" className="mt-4">
            <TermsTab />
          </TabsContent>
        )}
        {isOwner && (
          <TabsContent value="calc" className="mt-4">
            <CalcTab />
          </TabsContent>
        )}
        <TabsContent value="line" className="mt-4">
          <GfinPrecheckSettingsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
