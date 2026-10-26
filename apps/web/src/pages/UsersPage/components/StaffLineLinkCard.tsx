import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleCheck, Loader2 } from 'lucide-react';
import { getErrorMessage } from '@/lib/api';
import { userKeys } from '@/lib/api/users';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { maskLineUserId, useIssueStaffLineCode, useStaffLineTest, useUnlinkStaffLine } from '@/hooks/useStaffNotify';

/**
 * บล็อก "ไลน์พนักงาน (แจ้งเตือนภายใน)" บนหน้าผู้ใช้ — OWNER เท่านั้น (ก้อน 7 A16 · สเปก §13.1)
 * ยังไม่ผูก → สร้างรหัส 6 หลัก (หมดอายุ 15 นาที) → พนักงานส่งรหัสในแชท Staff OA → webhook ผูก `lineStaffUserId` → หน้านี้ poll จนเห็นสถานะ
 * ผูกแล้ว → ส่งข้อความทดสอบ / ยกเลิกการผูก
 */

const POLL_MS = 5_000;

interface Props {
  userId: string;
  userName: string;
  lineStaffUserId: string | null;
  linkCode?: string | null;
  linkCodeExpiresAt?: string | null;
}

const formatRemaining = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

export default function StaffLineLinkCard({ userId, userName, lineStaffUserId, linkCode, linkCodeExpiresAt }: Props) {
  const headingId = useId();
  const queryClient = useQueryClient();
  const issue = useIssueStaffLineCode(userId);
  const sendTest = useStaffLineTest(userId);
  const unlink = useUnlinkStaffLine(userId);
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const active = issued ?? (linkCode && linkCodeExpiresAt ? { code: linkCode, expiresAt: linkCodeExpiresAt } : null);
  const remainingMs = active ? new Date(active.expiresAt).getTime() - now : 0;
  const codeLive = !lineStaffUserId && !!active && remainingMs > 0;

  useEffect(() => {
    if (!codeLive) return;
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    const poll = setInterval(() => queryClient.invalidateQueries({ queryKey: userKeys.detail(userId) }), POLL_MS);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [codeLive, queryClient, userId]);

  useEffect(() => {
    if (lineStaffUserId) setIssued(null);
  }, [lineStaffUserId]);

  const issueCode = () =>
    issue.mutate(undefined, {
      onSuccess: (res) => {
        setIssued(res);
        setNow(Date.now());
      },
      onError: (err: unknown) => toast.error(getErrorMessage(err)),
    });
  const handleTest = () =>
    sendTest.mutate(undefined, {
      onSuccess: () => toast.success(`ส่งข้อความทดสอบถึง ${userName} แล้ว — ให้พนักงานยืนยันว่าได้รับ`),
      onError: (err: unknown) => toast.error(getErrorMessage(err)),
    });
  const handleUnlink = () =>
    unlink.mutate(undefined, {
      onSuccess: () => {
        toast.success('ยกเลิกการผูก LINE แล้ว');
        setConfirmUnlink(false);
      },
      onError: (err: unknown) => toast.error(getErrorMessage(err)),
    });

  return (
    <section aria-labelledby={headingId} className="bg-card rounded-xl border border-border/50 shadow-sm p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-base font-semibold">ไลน์พนักงาน (แจ้งเตือนภายใน)</h2>
        {lineStaffUserId ? (
          <Badge variant="primary" appearance="light" size="sm">
            <CircleCheck className="size-3.5" aria-hidden="true" />
            ผูกแล้ว ({maskLineUserId(lineStaffUserId)})
          </Badge>
        ) : (
          <Badge variant="secondary" appearance="light" size="sm">ยังไม่ผูก</Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        ใช้ส่งแจ้งเตือนภายใน (บิลประจำ ใบรออนุมัติ แชทลูกค้า ฯลฯ) ถึง {userName} ทาง LINE — ผูกครั้งเดียวด้วยรหัส 6 หลักผ่านไลน์พนักงาน (Staff OA)
      </p>

      {lineStaffUserId ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleTest} disabled={sendTest.isPending}>
            {sendTest.isPending ? <><Loader2 className="size-4 animate-spin" aria-hidden="true" />กำลังส่ง…</> : 'ส่งข้อความทดสอบ'}
          </Button>
          <Button variant="outline" size="sm" className="text-destructive" onClick={() => setConfirmUnlink(true)} disabled={unlink.isPending}>
            ยกเลิกการผูก
          </Button>
        </div>
      ) : codeLive && active ? (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <div className="text-xs text-muted-foreground">รหัสผูก LINE</div>
              <div className="font-mono text-3xl font-semibold tracking-[0.3em] tabular-nums">{active.code}</div>
            </div>
            <div className="text-sm text-muted-foreground">
              หมดอายุใน <span className="font-medium tabular-nums text-foreground">{formatRemaining(remainingMs)}</span>
            </div>
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>
              ให้ {userName} เพิ่มเพื่อนไลน์พนักงาน (QR / ลิงก์อยู่ที่{' '}
              <Link to="/settings/integrations/hub" className="text-primary underline-offset-2 hover:underline">Integration Hub › ไลน์พนักงาน</Link>)
            </li>
            <li>ส่งรหัสนี้ในแชทกับไลน์พนักงาน</li>
            <li>รอข้อความ "ผูกสำเร็จ" ใน LINE — หน้านี้จะอัปเดตสถานะเอง</li>
          </ol>
          <Button variant="outline" size="sm" onClick={issueCode} disabled={issue.isPending}>สร้างรหัสใหม่</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={issueCode} disabled={issue.isPending}>
            {issue.isPending ? <><Loader2 className="size-4 animate-spin" aria-hidden="true" />กำลังสร้าง…</> : 'สร้างรหัสผูก LINE'}
          </Button>
          {active && remainingMs <= 0 && <span className="text-sm text-muted-foreground">รหัสเดิมหมดอายุแล้ว — สร้างใหม่ได้</span>}
        </div>
      )}

      <ConfirmDialog
        open={confirmUnlink}
        onOpenChange={setConfirmUnlink}
        title="ยกเลิกการผูก LINE"
        description={`${userName} จะไม่ได้รับแจ้งเตือนภายในทาง LINE จนกว่าจะผูกใหม่`}
        variant="destructive"
        onConfirm={handleUnlink}
      />
    </section>
  );
}
