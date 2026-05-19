import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ShieldCheck, ShieldAlert, KeyRound, PlayCircle, Lock, Unlock } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
// W8 — shared formatter returns พ.ศ. ("8 เม.ย. 69 14:30") instead of the
// local helper's ค.ศ. output. Removes the date-format drift across pages.
import { formatThaiDateTime } from '@/lib/date';

/**
 * Phase 3 SP4 — PDPA strict-mode + backfill console.
 *
 * Three concerns rendered top-to-bottom:
 *   1. Status card — strict-mode toggle + ready/not-ready badge + env-var
 *      configuration hints.
 *   2. Backfill card — encrypted/plaintext counts, progress bar, "Run
 *      Backfill" button (polls every 3s while the topmost run is RUNNING).
 *   3. History table — last 7 backfill runs with status + duration.
 *
 * Important: this tab NEVER renders raw PII. The backend `/pdpa-encryption/status`
 * endpoint only returns aggregate counts — there is no field on the page
 * that could leak a customer's name, phone, etc.
 */

interface PiiColumnPlaintextCount {
  column: string;
  plaintextCount: number;
}

interface PdpaStatus {
  strictMode: boolean;
  totalCustomers: number;
  encryptedCount: number;
  plaintextCount: number;
  /** W3 — per-column breakdown so the UI can surface which exact field is missing.
   *  Optional for forward compat with older API responses that pre-date this field. */
  plaintextByColumn?: PiiColumnPlaintextCount[];
  readyForStrictMode: boolean;
  encryptionKeyConfigured: boolean;
  hashSaltConfigured: boolean;
}

interface PdpaBackfillRun {
  id: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  totalRecords: number;
  processedRecords: number;
  skippedRecords: number;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
  triggeredBy: string;
  triggeredByUser: { id: string; name: string } | null;
  hostname: string | null;
}

const STATUS_LABELS: Record<PdpaBackfillRun['status'], { label: string; variant: 'success' | 'destructive' | 'info' }> = {
  RUNNING: { label: 'กำลังทำงาน', variant: 'info' },
  COMPLETED: { label: 'สำเร็จ', variant: 'success' },
  FAILED: { label: 'ล้มเหลว', variant: 'destructive' },
};

function formatDuration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return '-';
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} วิ`;
  return `${(ms / 60_000).toFixed(1)} นาที`;
}

function formatTrigger(run: PdpaBackfillRun): string {
  if (run.triggeredBy === 'cli') return 'cli';
  return run.triggeredByUser?.name || 'manual';
}

export function PdpaTab() {
  const queryClient = useQueryClient();
  const [showStrictConfirm, setShowStrictConfirm] = useState(false);
  const [showBackfillConfirm, setShowBackfillConfirm] = useState(false);

  const statusQuery = useQuery<PdpaStatus>({
    queryKey: ['pdpa', 'status'],
    queryFn: async () => (await api.get('/pdpa-encryption/status')).data,
  });

  const runsQuery = useQuery<PdpaBackfillRun[]>({
    queryKey: ['pdpa', 'backfill-runs'],
    queryFn: async () => (await api.get('/pdpa-encryption/backfill-runs')).data,
    // Auto-refresh every 3s while the topmost run is still RUNNING — gives a
    // live progress bar without forcing the user to click refresh.
    refetchInterval: (query) => {
      const runs = query.state.data as PdpaBackfillRun[] | undefined;
      return runs?.[0]?.status === 'RUNNING' ? 3_000 : false;
    },
  });

  const toggleStrictMutation = useMutation({
    mutationFn: async (enabled: boolean) =>
      (await api.put('/pdpa-encryption/strict-mode', { enabled })).data,
    onSuccess: (resp: { strictMode: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ['pdpa', 'status'] });
      toast.success(resp.strictMode ? 'เปิด PDPA strict mode แล้ว' : 'ปิด PDPA strict mode แล้ว');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const runBackfillMutation = useMutation({
    mutationFn: async () => (await api.post('/pdpa-encryption/backfill')).data,
    onSuccess: (resp: { status: string; processedRecords: number; skippedRecords: number; durationMs: number; errorMessage?: string }) => {
      queryClient.invalidateQueries({ queryKey: ['pdpa', 'status'] });
      queryClient.invalidateQueries({ queryKey: ['pdpa', 'backfill-runs'] });
      if (resp.status === 'COMPLETED') {
        toast.success(
          `Backfill สำเร็จ — เข้ารหัส ${resp.processedRecords} แถว / ข้าม ${resp.skippedRecords} / ${(resp.durationMs / 1000).toFixed(1)} วิ`,
        );
      } else {
        toast.error(`Backfill ล้มเหลว: ${resp.errorMessage || 'ไม่ทราบสาเหตุ'}`);
      }
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  if (statusQuery.isLoading) {
    return <p className="text-sm text-muted-foreground leading-snug">กำลังโหลด...</p>;
  }

  if (!statusQuery.data) {
    return <p className="text-sm text-muted-foreground leading-snug">ไม่สามารถโหลดสถานะได้</p>;
  }

  const status = statusQuery.data;
  const runs = runsQuery.data || [];
  const topRun = runs[0];
  const isRunning = topRun?.status === 'RUNNING';
  const progressPct = status.totalCustomers > 0
    ? Math.round((status.encryptedCount * 100) / status.totalCustomers)
    : 100;

  const envReady = status.encryptionKeyConfigured && status.hashSaltConfigured;

  return (
    <div className="space-y-4">
      {/* Confirm dialogs */}
      <ConfirmDialog
        open={showStrictConfirm}
        onOpenChange={setShowStrictConfirm}
        title="เปิด PDPA strict mode?"
        description="เมื่อเปิดแล้ว ระบบจะปฏิเสธการอ่านข้อมูลลูกค้าที่ยังไม่ได้เข้ารหัส กรุณายืนยันว่ารัน Backfill เรียบร้อย และคอลัมน์ทุกตัวอยู่ในสถานะ encrypted แล้ว"
        confirmLabel="ยืนยันเปิด"
        cancelLabel="ยกเลิก"
        loading={toggleStrictMutation.isPending}
        onConfirm={() => toggleStrictMutation.mutate(true)}
      />
      <ConfirmDialog
        open={showBackfillConfirm}
        onOpenChange={setShowBackfillConfirm}
        title="เริ่ม Backfill เลย?"
        description={`จะเข้ารหัสข้อมูลลูกค้าที่ยังไม่ได้เข้ารหัส ${status.plaintextCount.toLocaleString('th-TH')} คน — ใช้เวลาประมาณ ${Math.max(1, Math.ceil(status.plaintextCount / 500))} นาที (batch 100 แถว)`}
        confirmLabel="เริ่ม"
        cancelLabel="ยกเลิก"
        loading={runBackfillMutation.isPending}
        onConfirm={() => runBackfillMutation.mutate()}
      />

      {/* Status card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {status.strictMode ? (
              <ShieldCheck className="size-5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <ShieldAlert className="size-5 text-amber-600 dark:text-amber-400" />
            )}
            PDPA Strict Mode (PII column-level encryption)
          </CardTitle>
          <CardDescription className="leading-snug">
            เมื่อเปิด strict mode ระบบจะอ่านข้อมูลส่วนบุคคล (เลขบัตรประชาชน,
            เบอร์โทร, อีเมล, ที่อยู่) จากคอลัมน์ encrypted เท่านั้น —
            ป้องกันการรั่วไหลของข้อมูลแม้ DB ถูกขโมย (PDPA พ.ร.บ. 2562)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-muted p-4">
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground leading-snug">เปิดใช้งาน Strict Mode</p>
              <p className="text-xs text-muted-foreground leading-snug mt-1">
                ก่อนเปิด — ต้องรัน Backfill ให้คอลัมน์ encrypted ครบทุกแถวก่อน
                ไม่อย่างนั้นทุก API ที่อ่าน Customer จะ 400
              </p>
            </div>
            <Switch
              checked={status.strictMode}
              disabled={toggleStrictMutation.isPending || (!status.strictMode && (!status.readyForStrictMode || !envReady))}
              onCheckedChange={(v) => {
                if (v) {
                  setShowStrictConfirm(true);
                } else {
                  toggleStrictMutation.mutate(false);
                }
              }}
              aria-label="เปิดปิด PDPA strict mode"
            />
          </div>

          {/* Env-var configuration hints */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg bg-muted p-3 flex items-center gap-3">
              <KeyRound className="size-5 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-xs text-muted-foreground leading-snug">PII_ENCRYPTION_KEY</p>
                <p className="text-sm font-medium text-foreground leading-snug">
                  {status.encryptionKeyConfigured ? (
                    <Badge variant="success">ตั้งค่าแล้ว</Badge>
                  ) : (
                    <Badge variant="destructive">ยังไม่ได้ตั้ง</Badge>
                  )}
                </p>
              </div>
            </div>
            <div className="rounded-lg bg-muted p-3 flex items-center gap-3">
              <KeyRound className="size-5 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-xs text-muted-foreground leading-snug">PII_HASH_SALT</p>
                <p className="text-sm font-medium text-foreground leading-snug">
                  {status.hashSaltConfigured ? (
                    <Badge variant="success">ตั้งค่าแล้ว</Badge>
                  ) : (
                    <Badge variant="destructive">ยังไม่ได้ตั้ง</Badge>
                  )}
                </p>
              </div>
            </div>
          </div>

          {!envReady && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-3 text-sm">
              <ShieldAlert className="size-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-amber-900 dark:text-amber-200 leading-snug">
                ตั้ง <code className="font-mono">PII_ENCRYPTION_KEY</code> (64
                hex chars) และ <code className="font-mono">PII_HASH_SALT</code> (≥32
                chars) ใน env vars ก่อน — สร้างด้วย{' '}
                <code className="font-mono">openssl rand -hex 32</code>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Backfill card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {status.readyForStrictMode ? (
              <Lock className="size-5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Unlock className="size-5 text-amber-600 dark:text-amber-400" />
            )}
            Backfill PII Encryption
          </CardTitle>
          <CardDescription className="leading-snug">
            เข้ารหัสคอลัมน์ PII (nationalId, phone, email, address) สำหรับ
            ลูกค้าที่ยังไม่ได้เข้ารหัส — รันได้หลายครั้ง (idempotent)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Encryption progress */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground leading-snug">
                เข้ารหัสไปแล้ว{' '}
                <span className="tabular-nums">{status.encryptedCount.toLocaleString('th-TH')}</span>
                {' / '}
                <span className="tabular-nums">{status.totalCustomers.toLocaleString('th-TH')}</span>
                {' '}คน ({progressPct}%)
              </p>
              {status.readyForStrictMode ? (
                <Badge variant="success">พร้อมเปิด Strict Mode</Badge>
              ) : (
                <Badge variant="outline">
                  ยังเหลือ {status.plaintextCount.toLocaleString('th-TH')} คน
                </Badge>
              )}
            </div>
            <Progress value={progressPct} aria-label="ความคืบหน้าการเข้ารหัส" />
          </div>

          {/* Live progress when a run is in flight */}
          {isRunning && topRun && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900 p-3">
              <p className="text-sm font-medium text-blue-900 dark:text-blue-200 leading-snug">
                กำลังรัน — เข้ารหัสไปแล้ว{' '}
                {topRun.processedRecords.toLocaleString('th-TH')} /
                {' '}{topRun.totalRecords.toLocaleString('th-TH')} แถว
                {topRun.skippedRecords > 0 ? ` (ข้าม ${topRun.skippedRecords})` : ''}
              </p>
            </div>
          )}

          {/* Plaintext warning when strict mode is OFF but we have plaintext rows */}
          {!status.readyForStrictMode && !isRunning && envReady && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-3 text-sm">
              <div className="flex items-start gap-2">
                <ShieldAlert className="size-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <p className="text-amber-900 dark:text-amber-200 leading-snug">
                  ลูกค้า {status.plaintextCount.toLocaleString('th-TH')} คน
                  ยังไม่ได้เข้ารหัส — รัน Backfill ก่อนเปิด Strict Mode
                </p>
              </div>
              {/* W3 — per-column breakdown so the operator knows which
                  exact columns still need backfilling. Falls back gracefully
                  when the API response pre-dates this field. */}
              {status.plaintextByColumn && status.plaintextByColumn.some((c) => c.plaintextCount > 0) && (
                <ul className="mt-2 ml-6 list-disc text-xs text-amber-900 dark:text-amber-200 leading-snug">
                  {status.plaintextByColumn
                    .filter((c) => c.plaintextCount > 0)
                    .map((c) => (
                      <li key={c.column}>
                        <span className="font-mono">{c.column}</span> —{' '}
                        {c.plaintextCount.toLocaleString('th-TH')} แถว
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              onClick={() => setShowBackfillConfirm(true)}
              disabled={runBackfillMutation.isPending || isRunning || !envReady || status.plaintextCount === 0}
              variant="outline"
              className="gap-2"
            >
              <PlayCircle className="size-4" />
              {isRunning ? 'กำลังรัน...' : runBackfillMutation.isPending ? 'กำลังเริ่ม...' : 'เริ่ม Backfill'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle>ประวัติ Backfill (7 ครั้งล่าสุด)</CardTitle>
          <CardDescription className="leading-snug">
            ทั้งจาก CLI (npm run backfill:encrypt-pii) และจากการคลิกปุ่มใน
            หน้านี้
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground leading-snug">ยังไม่มีประวัติ Backfill</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เวลาเริ่ม</TableHead>
                    <TableHead>สถานะ</TableHead>
                    <TableHead className="text-right">เข้ารหัส</TableHead>
                    <TableHead className="text-right">ข้าม</TableHead>
                    <TableHead className="text-right">ระยะเวลา</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead>หมายเหตุ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => {
                    const label = STATUS_LABELS[run.status];
                    return (
                      <TableRow key={run.id}>
                        <TableCell className="font-mono text-xs">{formatThaiDateTime(run.startedAt)}</TableCell>
                        <TableCell>
                          <Badge variant={label.variant}>{label.label}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {run.processedRecords.toLocaleString('th-TH')}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {run.skippedRecords.toLocaleString('th-TH')}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatDuration(run.startedAt, run.finishedAt)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground leading-snug">
                          {formatTrigger(run)}
                        </TableCell>
                        <TableCell
                          className="text-xs text-destructive max-w-[18rem] truncate leading-snug"
                          title={run.errorMessage || ''}
                        >
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
