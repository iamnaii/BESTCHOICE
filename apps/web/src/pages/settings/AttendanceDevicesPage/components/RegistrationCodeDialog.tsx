import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Loader2 } from 'lucide-react';
import { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/native-select';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { useIssueRegistrationCode } from '@/hooks/useAttendance';
import { hhmm } from '@/pages/attendance/attendance.util';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branches: Array<{ branchId: string; branchName: string }>;
}

/** เพิ่มเครื่อง (mockup บอร์ด 4) — ออกรหัส 8 ตัว ใช้ครั้งเดียว อายุ 10 นาที ให้กรอกบนแท็บเล็ตที่หน้า /kiosk */
export default function RegistrationCodeDialog({ open, onOpenChange, branches }: Props) {
  const issue = useIssueRegistrationCode();
  const { copy, copied } = useCopyToClipboard();
  const [branchId, setBranchId] = useState('');
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!open) return;
    setBranchId((current) => current || branches[0]?.branchId || '');
    setIssued(null);
  }, [open, branches]);

  useEffect(() => {
    if (!issued) return;
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(tick);
  }, [issued]);

  const expired = !!issued && new Date(issued.expiresAt).getTime() <= now;
  const kioskUrl = `${window.location.origin}/kiosk`;

  const issueCode = () =>
    issue.mutate(branchId, {
      onSuccess: (res) => {
        setIssued(res);
        setNow(Date.now());
      },
      onError: (err: unknown) => toast.error(getErrorMessage(err)),
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>เพิ่มเครื่อง — รหัสลงทะเบียน</DialogTitle>
          <DialogDescription>เปิด {kioskUrl} บนแท็บเล็ตของสาขา แล้วกรอกรหัสภายใน 10 นาที · รหัสใช้ได้ครั้งเดียว</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="reg-branch" className="text-sm font-medium">สาขาของเครื่อง</label>
            <NativeSelect id="reg-branch" value={branchId} onChange={(e) => { setBranchId(e.target.value); setIssued(null); }}>
              {branches.map((b) => <option key={b.branchId} value={b.branchId}>{b.branchName}</option>)}
            </NativeSelect>
          </div>
          {issued && (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-4" role="status">
              <output className="font-mono text-3xl font-semibold tracking-[0.4em] tabular-nums">{issued.code}</output>
              <span className={`text-sm ${expired ? 'text-destructive' : 'text-muted-foreground'}`}>
                {expired ? 'รหัสหมดอายุแล้ว — ออกรหัสใหม่' : `หมดอายุ ${hhmm(issued.expiresAt)}`}
              </span>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          {issued ? (
            <>
              <Button variant="outline" className="max-lg:min-h-11" onClick={() => void copy(issued.code)} disabled={expired}>
                <Copy className="size-4" aria-hidden="true" />{copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
              </Button>
              <Button variant="outline" className="max-lg:min-h-11" onClick={issueCode} disabled={issue.isPending || !branchId}>ออกรหัสใหม่</Button>
            </>
          ) : (
            <Button className="max-lg:min-h-11" onClick={issueCode} disabled={issue.isPending || !branchId}>
              {issue.isPending ? <><Loader2 className="size-4 animate-spin" aria-hidden="true" />กำลังออกรหัส…</> : 'ออกรหัส'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
