import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckSquare, HelpCircle, Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { homeActionsForRole } from '@/config/work-navigation';
import { useCommandPalette } from '@/components/CommandPalette';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import api from '@/lib/api';
import type { TodosResponse, TodoStatus } from '@/pages/TodosPage/types';
import DashboardMySales from './DashboardMySales';

const TASK_STATUS: Record<TodoStatus, string> = {
  TODO: 'ยังไม่ได้เริ่ม',
  DOING: 'กำลังทำ',
  REVIEW: 'รอตรวจทาน',
  DONE: 'เสร็จแล้ว',
};
const TODAY_TASKS_PATH = '/todos?view=today&assigneeId=me';

export default function StaffHome() {
  useDocumentTitle('เริ่มงานวันนี้');
  const { user } = useAuth();
  const { open: openSearch } = useCommandPalette();
  const actions = homeActionsForRole(user?.role ?? '');
  const tasks = useQuery<TodosResponse>({
    queryKey: ['todos', 'staff-home', user?.id],
    queryFn: async () => (await api.get('/todos?view=today&assigneeId=me&limit=5')).data,
    enabled: user?.role === 'SALES',
    staleTime: 30_000,
  });

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

      <section aria-labelledby="start-work-title">
        <h2 id="start-work-title" className="text-base font-semibold leading-snug">
          เริ่มงาน
        </h2>
        <p className="mt-1 text-sm text-muted-foreground leading-snug">
          เลือกงานที่ต้องการทำ ระบบจะพาไปยังหน้าที่เกี่ยวข้อง
        </p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {actions.map(({ id, label, description, path, icon: Icon }) => (
            <Link
              key={id}
              to={path}
              className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span className="flex items-center justify-between">
                <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <ArrowRight
                  className="size-4 text-muted-foreground group-hover:text-primary"
                  aria-hidden="true"
                />
              </span>
              <span className="text-base font-semibold leading-snug">{label}</span>
              <span className="text-sm text-muted-foreground leading-snug">{description}</span>
            </Link>
          ))}
        </div>
      </section>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>งานของฉันวันนี้</CardTitle>
          <Button variant="ghost" className="min-h-11" asChild>
            <Link to={TODAY_TASKS_PATH}>
              ดูงานวันนี้ทั้งหมด <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          <QueryBoundary
            isLoading={tasks.isLoading}
            isError={tasks.isError}
            error={tasks.error}
            errorTitle="โหลดงานวันนี้ไม่สำเร็จ"
            errorMessage="ลองโหลดอีกครั้ง หรือเปิดหน้างานของทีมจากเมนูได้"
            onRetry={() => {
              void tasks.refetch();
            }}
          >
            {tasks.data?.data.length ? (
              <ul className="divide-y divide-border">
                {tasks.data.data.map((task) => (
                  <li key={task.id} className="flex items-start justify-between gap-3 py-3">
                    <span className="flex min-w-0 items-start gap-3">
                      <CheckSquare
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="break-words text-sm leading-snug">{task.title}</span>
                    </span>
                    <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground leading-snug">
                      {TASK_STATUS[task.status]}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                className="py-6"
                icon={CheckSquare}
                title="ยังไม่มีงานที่มอบหมายให้คุณครบกำหนดวันนี้"
                description="เริ่มงานจากปุ่มด้านบน หรือเปิดหน้างานของทีมเพื่อดูงานวันอื่น"
              />
            )}
          </QueryBoundary>
        </CardContent>
      </Card>

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
