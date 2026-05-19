import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Play, Database, ShieldAlert } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface OffsiteBackupRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';
  filesCount: number;
  totalBytes: number;
  errorMessage: string | null;
  triggeredBy: string;
  triggeredByUser: { id: string; name: string } | null;
  destBucket: string | null;
}

interface OffsiteBackupStatus {
  enabled: boolean;
  destBucket: string | null;
  retentionDays: number;
  sqlSourceBucket: string | null;
  runs: OffsiteBackupRun[];
}

const STATUS_LABELS: Record<OffsiteBackupRun['status'], { label: string; variant: 'success' | 'destructive' | 'secondary' | 'outline' | 'info' }> = {
  RUNNING: { label: 'กำลังทำงาน', variant: 'info' },
  SUCCESS: { label: 'สำเร็จ', variant: 'success' },
  FAILED: { label: 'ล้มเหลว', variant: 'destructive' },
  SKIPPED: { label: 'ข้าม (ปิดอยู่)', variant: 'outline' },
};

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return '-';
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} วิ`;
  return `${(ms / 60_000).toFixed(1)} นาที`;
}

function formatThaiDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('th-TH', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  });
}

function formatTrigger(run: OffsiteBackupRun): string {
  if (run.triggeredBy === 'cron') return 'cron';
  // W3/C2: prefer joined user name; fall back to category label (no UUID slice).
  return run.triggeredByUser?.name || 'manual';
}

export function OffsiteBackupTab() {
  const queryClient = useQueryClient();
  // W4 — replaces 2-click toast confirm. Modal dialog before enabling.
  const [showEnableConfirm, setShowEnableConfirm] = useState(false);

  const { data, isLoading } = useQuery<OffsiteBackupStatus>({
    queryKey: ['backup', 'offsite-status'],
    queryFn: async () => (await api.get('/backup/offsite-status')).data,
    // W3 — auto-refresh every 5s while the topmost run is still RUNNING so
    // the UI reflects progress without manual refresh. Once the top row
    // leaves RUNNING the interval stops (returns false).
    refetchInterval: (query) => {
      const status = query.state.data as OffsiteBackupStatus | undefined;
      const top = status?.runs?.[0];
      return top?.status === 'RUNNING' ? 5_000 : false;
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (enabled: boolean) =>
      (await api.put('/backup/offsite-enabled', { enabled })).data,
    onSuccess: (resp: { enabled: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ['backup', 'offsite-status'] });
      toast.success(resp.enabled ? 'เปิด Off-site Backup แล้ว' : 'ปิด Off-site Backup แล้ว');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const runNowMutation = useMutation({
    mutationFn: async () => (await api.post('/backup/offsite-now')).data,
    onSuccess: (resp: { status: string; filesCount: number; totalBytes: number; durationMs: number; errorMessage: string | null }) => {
      queryClient.invalidateQueries({ queryKey: ['backup', 'offsite-status'] });
      if (resp.status === 'SUCCESS') {
        toast.success(`สำรองข้อมูลสำเร็จ — ${resp.filesCount} ไฟล์ / ${formatBytes(resp.totalBytes)} / ${(resp.durationMs / 1000).toFixed(1)} วิ`);
      } else if (resp.status === 'SKIPPED') {
        toast.warning('Off-site Backup ถูกปิดอยู่ — เปิดสวิตช์ก่อนแล้วลองอีกครั้ง');
      } else {
        toast.error(`สำรองข้อมูลล้มเหลว: ${resp.errorMessage || 'ไม่ทราบสาเหตุ'}`);
      }
    },
    // W3 — combined with server-side advisory lock (C1). A 409 ConflictException
    // from concurrent runs (cron + manual click) surfaces here with a friendly
    // Thai message instead of a generic axios error.
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground leading-snug">กำลังโหลด...</p>;
  }

  if (!data) {
    return <p className="text-sm text-muted-foreground leading-snug">ไม่สามารถโหลดสถานะได้</p>;
  }

  return (
    <div className="space-y-4">
      <ConfirmDialog
        open={showEnableConfirm}
        onOpenChange={setShowEnableConfirm}
        title="เปิดใช้งาน Off-site Backup?"
        description="ต้องสร้าง destination bucket + grant IAM ก่อน — กรุณาตรวจสอบใน docs/guides/OFFSITE-BACKUP.md ก่อนเปิดใช้งาน"
        confirmLabel="ยืนยัน"
        cancelLabel="ยกเลิก"
        loading={toggleMutation.isPending}
        onConfirm={() => toggleMutation.mutate(true)}
      />

      {/* Enable toggle + config */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="size-5" />
            Off-site Backup Replication
          </CardTitle>
          <CardDescription className="leading-snug">
            สำเนาข้อมูลสำคัญ (Cloud SQL dumps + เอกสารใน GCS) ไปยัง bucket อีก
            ภูมิภาคหนึ่งวันละครั้ง (03:30 น. ตามเวลาไทย) เพื่อป้องกันเหตุการณ์
            ภูมิภาคหลักล่ม / ลบข้อมูลโดยไม่ตั้งใจ
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-muted p-4">
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground leading-snug">เปิดใช้งาน Off-site Backup</p>
              <p className="text-xs text-muted-foreground leading-snug mt-1">
                เมื่อเปิดอยู่ cron จะรันทุกวัน 03:30 น. และเขียนประวัติการรันลงตาราง
                ด้านล่าง — ก่อนเปิดต้องให้ owner สร้าง destination bucket
                และ grant สิทธิ์ให้ Cloud Run service account ก่อน
                (ดู <code className="text-foreground">docs/guides/OFFSITE-BACKUP.md</code>)
              </p>
            </div>
            <Switch
              checked={data.enabled}
              disabled={toggleMutation.isPending}
              onCheckedChange={(v) => {
                // W4 — modal confirm for ON (destructive surface);
                // OFF is a one-click action.
                if (v) {
                  setShowEnableConfirm(true);
                } else {
                  toggleMutation.mutate(false);
                }
              }}
              aria-label="เปิดปิด Off-site Backup"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs text-muted-foreground leading-snug">Destination Bucket</p>
              <p className="text-sm font-mono text-foreground mt-1 break-all">
                {data.destBucket || <span className="text-muted-foreground italic">— ปกปิดสำหรับ role นี้</span>}
              </p>
            </div>
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs text-muted-foreground leading-snug">ระยะเก็บข้อมูล (Retention)</p>
              <p className="text-sm font-semibold text-foreground mt-1">{data.retentionDays} วัน</p>
            </div>
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs text-muted-foreground leading-snug">SQL Source Bucket</p>
              <p className="text-sm font-mono text-foreground mt-1 break-all">
                {data.sqlSourceBucket === null ? (
                  <span className="text-muted-foreground italic leading-snug">— ปกปิด / ไม่ได้ตั้งค่า</span>
                ) : (
                  data.sqlSourceBucket
                )}
              </p>
            </div>
          </div>

          {data.destBucket !== null && !data.sqlSourceBucket && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-3 text-sm">
              <ShieldAlert className="size-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-amber-900 dark:text-amber-200 leading-snug">
                ตั้งค่า <code>OFFSITE_BACKUP_SQL_SOURCE_BUCKET</code> เพื่อสำรอง SQL dump ด้วย
                หากไม่ตั้ง จะมีเฉพาะเอกสาร (GCS) เท่านั้น
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              onClick={() => runNowMutation.mutate()}
              disabled={runNowMutation.isPending}
              variant="outline"
              className="gap-2"
            >
              <Play className="size-4" />
              {runNowMutation.isPending ? 'กำลังสำรอง...' : 'สำรองข้อมูลตอนนี้'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* History table */}
      <Card>
        <CardHeader>
          <CardTitle>ประวัติการสำรองข้อมูล (7 ครั้งล่าสุด)</CardTitle>
          <CardDescription className="leading-snug">
            แสดงการรันทั้งจาก cron และ manual trigger — รวมรอบที่ถูกข้ามเพราะ
            Off-site Backup ปิดอยู่ ณ ขณะที่ cron ตื่น
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.runs.length === 0 ? (
            <p className="text-sm text-muted-foreground leading-snug">ยังไม่มีประวัติการสำรองข้อมูล</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เวลาเริ่ม</TableHead>
                    <TableHead>สถานะ</TableHead>
                    <TableHead className="text-right">ไฟล์</TableHead>
                    <TableHead className="text-right">ขนาด</TableHead>
                    <TableHead className="text-right">ระยะเวลา</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead>หมายเหตุ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.runs.map((run) => {
                    const status = STATUS_LABELS[run.status];
                    return (
                      <TableRow key={run.id}>
                        <TableCell className="font-mono text-xs">{formatThaiDateTime(run.startedAt)}</TableCell>
                        <TableCell>
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{run.filesCount.toLocaleString('th-TH')}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatBytes(run.totalBytes)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatDuration(run.startedAt, run.finishedAt)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground leading-snug">
                          {formatTrigger(run)}
                        </TableCell>
                        <TableCell className="text-xs text-destructive max-w-[18rem] truncate leading-snug" title={run.errorMessage || ''}>
                          {run.errorMessage || ''}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
