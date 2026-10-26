import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckSquare } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import EmptyState from '@/components/ui/EmptyState';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import api from '@/lib/api';
import type { TodosResponse, TodoStatus } from '@/pages/TodosPage/types';

const TASK_STATUS: Record<TodoStatus, string> = {
  TODO: 'ยังไม่ได้เริ่ม',
  DOING: 'กำลังทำ',
  REVIEW: 'รอตรวจทาน',
  CANCELLED: 'ยกเลิก',
  DONE: 'เสร็จแล้ว',
};
export const TODAY_TASKS_PATH = '/todos?view=today&assigneeId=me';

/** การ์ด "งานของฉันวันนี้" — ใช้ร่วมกันระหว่างหน้าเริ่มงาน (StaffHome) และหน้าหลักหน้าร้าน (SALES) */
export default function MyTodayTasksCard() {
  const { user } = useAuth();
  const tasks = useQuery<TodosResponse>({
    queryKey: ['todos', 'staff-home', user?.id],
    queryFn: async () => (await api.get('/todos?view=today&assigneeId=me&limit=5')).data,
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  return (
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
  );
}
