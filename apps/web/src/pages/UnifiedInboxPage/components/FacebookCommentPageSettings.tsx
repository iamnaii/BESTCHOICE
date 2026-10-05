import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useChatWorkSettings } from '../hooks/useChatWork';
export default function FacebookCommentPageSettings() {
  const { user } = useAuth();
  const { scope, key } = useChatWorkSettings();
  const [open, setOpen] = useState(false);
  const [branchId, setBranchId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const query = useQuery({
    queryKey: [...key, 'comment-page-config'],
    queryFn: () =>
      api
        .get<{
          pageId: string;
          binding: { branchId: string; enabled: boolean } | null;
          branches: { id: string; name: string }[];
          capabilities: { reason: string | null };
        }>('/staff-chat/facebook-comments/page-config', { params: scope })
        .then((r) => r.data),
    enabled: open && user?.role === 'OWNER',
    retry: false,
  });
  if (user?.role !== 'OWNER') return null;
  const row = query.isError ? null : query.data;
  const save = async (enabled: boolean) => {
    if (!row || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(
        '/staff-chat/facebook-comments/page-config',
        { branchId: branchId || row.binding?.branchId, enabled },
        { params: scope },
      );
      await query.refetch();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details
      className="rounded-lg border p-3"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm font-medium">ตั้งค่า Page และสาขา</summary>
      <div className="mt-3 space-y-3 text-sm">
        {query.isError ? (
          <p role="alert">
            ยังอ่านการตั้งค่า Page ไม่ได้ ตรวจการเชื่อมต่อ Facebook ในตั้งค่าระบบก่อน{' '}
            <Button variant="ghost" onClick={() => query.refetch()}>
              ลองใหม่
            </Button>
          </p>
        ) : !row ? (
          <p>กำลังโหลด…</p>
        ) : (
          <>
            <p className="break-all">Page: {row.pageId}</p>
            <label className="block space-y-1">
              <span>สาขาที่ดูแลงานคอมเมนต์</span>
              <select
                className="h-11 w-full rounded-md border bg-background px-2"
                value={branchId || row.binding?.branchId || ''}
                onChange={(e) => setBranchId(e.target.value)}
              >
                <option value="">เลือกสาขา</option>
                {row.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <p>
              การรับและตอบจริงยังขึ้นกับสิทธิ์ที่ยืนยันจาก Meta การบันทึกนี้ไม่เปลี่ยนการสมัคร
              webhook
            </p>
            {row.capabilities.reason && (
              <p className="text-muted-foreground">{row.capabilities.reason}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || !(branchId || row.binding?.branchId)}
                onClick={() => void save(true)}
              >
                บันทึกและเปิดคิวของ Page
              </Button>
              {row.binding?.enabled && (
                <Button variant="outline" disabled={busy} onClick={() => void save(false)}>
                  ปิดรับคิวของ Page
                </Button>
              )}
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
