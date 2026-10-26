import { HelpCircle, Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useCommandPalette } from '@/components/CommandPalette';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import DashboardMySales from './DashboardMySales';
import HomeActionsGrid from './HomeActionsGrid';
import MyTodayTasksCard from './MyTodayTasksCard';

export default function StaffHome() {
  useDocumentTitle('เริ่มงานวันนี้');
  const { user } = useAuth();
  const { open: openSearch } = useCommandPalette();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="เริ่มงานวันนี้"
        subtitle={`สวัสดี ${user?.name ?? ''}${user?.branchName ? ` · ${user.branchName}` : ''}`}
        action={
          <Button variant="outline" className="min-h-11" onClick={openSearch}>
            <Search className="size-4" aria-hidden="true" />
            ค้นหาลูกค้าหรือสัญญา
          </Button>
        }
      />

      <HomeActionsGrid role={user?.role ?? ''} />

      <MyTodayTasksCard />

      <details className="rounded-xl border border-border bg-card p-4">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md text-sm font-medium leading-snug focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
          <HelpCircle className="size-4 text-primary" aria-hidden="true" />
          เริ่มใช้งานครั้งแรก · ดูคำแนะนำ
        </summary>
        <div className="mt-3 space-y-3 text-sm text-muted-foreground leading-snug">
          <p>
            <strong className="text-foreground">หาลูกค้าก่อน:</strong> ใช้ช่องค้นหาด้านบนด้วยชื่อ
            เบอร์โทร หรือเลขที่สัญญา
          </p>
          <p>
            <strong className="text-foreground">ทำสัญญาผ่อน:</strong> เตรียมข้อมูลสินค้าและลูกค้า
            แล้วทำตามขั้นตอนที่แสดงบนหน้าจอ หากเครดิตยังไม่ผ่าน ให้ตรวจสถานะและสิ่งที่ต้องทำต่อก่อน
          </p>
          <p>
            <strong className="text-foreground">ใช้คำตอบจาก AI:</strong>{' '}
            อ่านร่างและตรวจข้อมูลลูกค้าก่อนส่ง ตรวจข้อความยืนยันบนหน้าจอว่ารายการบันทึกแล้ว
          </p>
          <p>งานอื่นยังอยู่ในเมนูด้านข้าง เปิดคำแนะนำนี้ดูซ้ำได้ทุกเมื่อ</p>
        </div>
      </details>

      <DashboardMySales />
    </div>
  );
}
