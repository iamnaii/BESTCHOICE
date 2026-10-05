import FacebookCommentPageSettings from './FacebookCommentPageSettings';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useChatWorkSettings } from '../hooks/useChatWork';
export default function FacebookCommentList({ onOpen }: { onOpen: (id: string) => void }) {
  const { key, scope } = useChatWorkSettings();
  const [status, setStatus] = useState('OPEN');
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: [...key, 'facebook-comments', status, page],
    queryFn: () =>
      api
        .get<{
          data: {
            id: string;
            rootDeleted: boolean;
            records: { authorName: string | null; text: string | null; deletedAt: string | null }[];
          }[];
          total: number;
        }>('/staff-chat/facebook-comments', { params: { ...scope, status, page, limit: 30 } })
        .then((r) => r.data),
    retry: false,
    refetchInterval: 30_000,
  });
  return (
    <div className="min-h-0 space-y-3 overflow-y-auto p-4">
      <FacebookCommentPageSettings />
      <div className="flex flex-wrap gap-2">
        {[
          ['OPEN', 'รอตอบ'],
          ['RESPONDED', 'ตอบแล้ว'],
          ['RESOLVED', 'ปิดงาน'],
        ].map(([value, label]) => (
          <Button
            key={value}
            variant={status === value ? 'primary' : 'outline'}
            aria-pressed={status === value}
            onClick={() => {
              setStatus(value);
              setPage(1);
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      {query.isError ? (
        <div role="alert">
          โหลดคอมเมนต์ไม่ได้{' '}
          <Button variant="outline" onClick={() => query.refetch()}>
            ลองใหม่
          </Button>
        </div>
      ) : query.isLoading ? (
        <p role="status">กำลังโหลด…</p>
      ) : (
        <>
          {!query.data?.data.length && (
            <p className="py-8 text-center text-muted-foreground">ไม่มีคอมเมนต์ในรายการนี้</p>
          )}
          {query.data?.data.map((row) => (
            <button
              type="button"
              key={row.id}
              onClick={() => onOpen(row.id)}
              className="block w-full min-w-0 space-y-1 rounded-lg border p-4 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span className="block font-medium">
                {row.records[0]?.authorName || 'คอมเมนต์สาธารณะ'}
              </span>
              <span className="block line-clamp-2 [overflow-wrap:anywhere] text-muted-foreground">
                {row.rootDeleted || row.records[0]?.deletedAt
                  ? 'คอมเมนต์ถูกลบ'
                  : row.records[0]?.text || 'ไม่มีข้อความ'}
              </span>
            </button>
          ))}
          <div className="flex items-center justify-between">
            <Button variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              ก่อนหน้า
            </Button>
            <span>หน้า {page}</span>
            <Button
              variant="outline"
              disabled={page * 30 >= (query.data?.total ?? 0)}
              onClick={() => setPage((p) => p + 1)}
            >
              ถัดไป
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
