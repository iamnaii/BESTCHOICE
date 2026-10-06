import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useChatWorkSettings } from '../hooks/useChatWork';

type PageConfig = {
  pageId: string;
  binding: { branchId: string; enabled: boolean } | null;
  branches: { id: string; name: string }[];
  capabilities: {
    receive: boolean;
    publicReply: boolean;
    privateReply: boolean;
    reason: string | null;
    checks?: { key: string; label: string; passed: boolean }[];
  };
};
export default function FacebookCommentPageSettings() {
  const { user } = useAuth();
  const { scope, key, settings } = useChatWorkSettings();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [branchId, setBranchId] = useState('');
  const query = useQuery({
    queryKey: [...key, 'comment-page-config'],
    queryFn: () =>
      api
        .get<PageConfig>('/staff-chat/facebook-comments/page-config', { params: scope })
        .then((r) => r.data),
    enabled: open && user?.role === 'OWNER' && scope.company === 'SHOP',
    retry: false,
    refetchOnWindowFocus: false,
  });
  const save = useMutation({
    mutationFn: (enabled: boolean) =>
      api.patch(
        '/staff-chat/facebook-comments/page-config',
        { branchId: branchId || query.data?.binding?.branchId, enabled },
        { params: scope },
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
  const subscribe = useMutation({
    mutationFn: () =>
      api.post('/staff-chat/facebook-comments/page-config/subscribe-feed', {}, { params: scope }),
    onSettled: () => client.invalidateQueries({ queryKey: [...key, 'comment-page-config'] }),
  });
  if (user?.role !== 'OWNER' || scope.company !== 'SHOP') return null;
  const row = query.isError ? null : query.data;
  const busy = save.isPending || subscribe.isPending;
  const error = save.error || subscribe.error;
  const feed = row?.capabilities.checks?.find((check) => check.key === 'feed');
  const metadata = row?.capabilities.checks?.find((check) => check.key === 'pages_manage_metadata');
  const receiving =
    !!settings.data?.flags.chat_facebook_comments_enabled &&
    !!row?.binding?.enabled &&
    !!row?.capabilities.receive;
  return (
    <details
      className="rounded-lg border p-3"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm font-medium">ตั้งค่า Page และสาขา</summary>
      <div className="mt-3 space-y-3 text-sm leading-snug">
        <Button asChild variant="outline" size="sm">
          <Link to="/settings/integrations/hub">ตั้งค่าการเชื่อมต่อ Facebook</Link>
        </Button>
        {query.isError ? (
          <div role="alert">
            ยังอ่านการตั้งค่า Page ไม่ได้ ตรวจการเชื่อมต่อ Facebook ในตั้งค่าระบบก่อน{' '}
            <Button variant="ghost" onClick={() => query.refetch()}>
              ลองใหม่
            </Button>
          </div>
        ) : !row ? (
          <p role="status">กำลังโหลด…</p>
        ) : (
          <>
            <p className="break-all">Page: {row.pageId}</p>
            <div className="space-y-2 rounded-md bg-muted p-3" aria-label="สถานะคอมเมนต์">
              <p>
                รับคอมเมนต์: <strong>{receiving ? 'พร้อมรับเหตุการณ์ใหม่' : 'ยังไม่พร้อม'}</strong>
              </p>
              <p>
                ตอบสาธารณะ:{' '}
                <strong>
                  {receiving && row.capabilities.publicReply ? 'พร้อมตอบ' : 'ยังไม่พร้อม'}
                </strong>
              </p>
              <p className="text-muted-foreground">
                ตอบเป็นข้อความใต้โพสต์ของ Page · ยังไม่รองรับตอบส่วนตัว
              </p>
              <p className="text-muted-foreground">
                สถานะนี้ตรวจการตั้งค่าและสิทธิ์
                ยังต้องทดสอบรับและตอบบนเพจทดสอบเพื่อยืนยันการทำงานจริง
              </p>
            </div>
            <ul className="space-y-2" aria-label="รายการตรวจความพร้อม">
              {[
                {
                  key: 'enabled',
                  label: 'เปิดฟีเจอร์คอมเมนต์ในตั้งค่างานแชทแล้ว',
                  passed: !!settings.data?.flags.chat_facebook_comments_enabled,
                },
                {
                  key: 'branch',
                  label: 'เลือกสาขาและเปิดรับคิวของ Page แล้ว',
                  passed: !!row.binding?.enabled,
                },
                ...(row.capabilities.checks ?? []),
              ].map((check) => (
                <li key={check.key} className="flex items-start gap-2">
                  {check.passed ? (
                    <CheckCircle2
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-primary"
                    />
                  ) : (
                    <CircleAlert
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-warning-strong"
                    />
                  )}
                  <span>
                    <span className="sr-only">{check.passed ? 'ผ่าน: ' : 'ยังไม่ผ่าน: '}</span>
                    {check.label}
                  </span>
                </li>
              ))}
            </ul>
            {row.capabilities.reason && (
              <p className="text-muted-foreground">{row.capabilities.reason}</p>
            )}
            <Button
              variant="outline"
              disabled={busy || query.isFetching}
              onClick={() => query.refetch()}
            >
              {query.isFetching ? 'กำลังตรวจ…' : 'ตรวจสิทธิ์กับ Meta อีกครั้ง'}
            </Button>
            {feed && !feed.passed && (
              <div className="space-y-2 rounded-md border p-3">
                <p>
                  สมัครรับเหตุการณ์คอมเมนต์ของแอปนี้ โดยเก็บการรับข้อความ Messenger และรายการเดิมไว้
                </p>
                <Button
                  className="whitespace-normal"
                  variant="outline"
                  disabled={busy || !metadata?.passed}
                  onClick={() => subscribe.mutate()}
                >
                  {subscribe.isPending ? 'กำลังสมัคร…' : 'สมัครรับคอมเมนต์จาก Facebook'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  ต้องตั้งค่า webhook ของแอปใน Meta ให้ชี้มาที่ระบบนี้และเลือก Page / feed ด้วย
                </p>
              </div>
            )}
            <label className="block space-y-1">
              <span>สาขาที่ดูแลงานคอมเมนต์</span>
              <select
                className="h-11 w-full rounded-md border bg-background px-2"
                disabled={busy}
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
            <p className="text-muted-foreground">
              การบันทึกสาขาไม่เปลี่ยนการสมัครรับเหตุการณ์จาก Facebook
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || !(branchId || row.binding?.branchId)}
                onClick={() => save.mutate(true)}
              >
                บันทึกและเปิดคิวของ Page
              </Button>
              {row.binding?.enabled && (
                <Button variant="outline" disabled={busy} onClick={() => save.mutate(false)}>
                  ปิดรับคิวของ Page
                </Button>
              )}
            </div>
            {save.isSuccess && <p role="status">บันทึกสาขาแล้ว</p>}
            {subscribe.isSuccess && (
              <p role="status">ดำเนินการสมัครแล้ว ตรวจผลล่าสุดในรายการความพร้อมด้านบน</p>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {getErrorMessage(error)}
          </p>
        )}
      </div>
    </details>
  );
}
