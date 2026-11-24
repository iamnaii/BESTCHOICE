import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ShieldCheck } from '@/lib/icons';
import { EmployeesTab } from './EmployeesTab';
import { HistoryTab } from './HistoryTab';
import { PositionsTab } from './PositionsTab';

export default function EmployeeAccessPage() {
  return (
    <div className="min-w-0">
      <PageHeader
        title="ตำแหน่งและสิทธิ์"
        subtitle="ตั้งสิทธิ์ให้แต่ละตำแหน่ง แล้วมอบหมายตำแหน่งและสาขาให้พนักงาน"
        icon={<ShieldCheck aria-hidden="true" className="size-5" />}
      />
      <p className="mb-3 rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm leading-snug text-muted-foreground">
        บางขั้นตอนยังใช้กติกาสิทธิ์เดิม ข้อมูลหน้านี้แสดงสิทธิ์ในระบบตำแหน่ง ควรตรวจสอบการใช้งานในแต่ละขั้นตอน
      </p>
      <Tabs defaultValue="positions">
        <TabsList variant="line" size="sm" aria-label="จัดการตำแหน่งและสิทธิ์" className="w-full max-sm:gap-3">
          <TabsTrigger value="positions">ตำแหน่ง</TabsTrigger>
          <TabsTrigger value="employees">มอบหมายพนักงาน</TabsTrigger>
          <TabsTrigger value="history">ประวัติการเปลี่ยนแปลง</TabsTrigger>
        </TabsList>
        <TabsContent value="positions" className="pt-2">
          <PositionsTab />
        </TabsContent>
        <TabsContent value="employees" className="pt-2">
          <EmployeesTab />
        </TabsContent>
        <TabsContent value="history" className="pt-2">
          <HistoryTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
