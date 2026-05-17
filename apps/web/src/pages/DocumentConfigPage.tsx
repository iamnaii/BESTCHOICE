import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, FileText } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export interface DocNumberConfig {
  id: string;
  docType: string;
  description: string;
  prefix: string;
  format: string;
  resetCadence: 'DAILY' | 'MONTHLY' | 'YEARLY' | 'NEVER';
  digitCount: number;
  active: boolean;
  notes: string | null;
  updatedAt: string;
  updatedBy: { id: string; name: string; email: string } | null;
}

interface PreviewResponse {
  sample: string;
  nextSeq: number;
  format: string;
  prefix: string;
  resetCadence: string;
  digitCount: number;
}

const CADENCE_LABEL: Record<string, string> = {
  DAILY: 'รายวัน',
  MONTHLY: 'รายเดือน',
  YEARLY: 'รายปี',
  NEVER: 'ไม่รีเซ็ต',
};

const TOKEN_HELP: { token: string; label: string }[] = [
  { token: '{prefix}', label: 'อักษรนำ' },
  { token: '{YYYY}', label: 'ปี ค.ศ. 4 หลัก' },
  { token: '{MM}', label: 'เดือน 2 หลัก' },
  { token: '{DD}', label: 'วัน 2 หลัก' },
  { token: '{YYYYMMDD}', label: 'ปี+เดือน+วัน' },
  { token: '{YYYYMM}', label: 'ปี+เดือน' },
  { token: '{NNNN}', label: 'เลขรัน 4 หลัก' },
  { token: '{NN}', label: 'เลขรัน 2 หลัก' },
];

export default function DocumentConfigPage() {
  useDocumentTitle('ตั้งค่าเลขที่/รูปแบบเอกสาร');
  const queryClient = useQueryClient();

  const query = useQuery<DocNumberConfig[]>({
    queryKey: ['doc-config'],
    queryFn: async () => (await api.get('/settings/doc-config')).data,
  });

  const [editTarget, setEditTarget] = useState<DocNumberConfig | null>(null);
  // W5 (DEEP review): pendingDraft holds the in-flight edit while the confirm
  // dialog is open. We close the edit dialog FIRST (so the page doesn't show
  // two stacked overlays) and stash the draft + target here for the mutation.
  const [confirmTarget, setConfirmTarget] = useState<DocNumberConfig | null>(null);
  const [pendingDraft, setPendingDraft] = useState<Partial<DocNumberConfig> | null>(null);
  const [draft, setDraft] = useState<Partial<DocNumberConfig>>({});
  const [preview, setPreview] = useState<PreviewResponse | null>(null);

  // Reset draft + preview when opening edit dialog
  useEffect(() => {
    if (editTarget) {
      setDraft({
        prefix: editTarget.prefix,
        format: editTarget.format,
        resetCadence: editTarget.resetCadence,
        digitCount: editTarget.digitCount,
        notes: editTarget.notes ?? '',
        active: editTarget.active,
      });
      setPreview(null);
    } else {
      setDraft({});
      setPreview(null);
    }
  }, [editTarget]);

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!editTarget) return null;
      const body = {
        prefix: draft.prefix,
        format: draft.format,
        resetCadence: draft.resetCadence,
        digitCount: draft.digitCount,
      };
      const res = await api.post<PreviewResponse>(
        `/settings/doc-config/${encodeURIComponent(editTarget.docType)}/preview`,
        body,
      );
      return res.data;
    },
    onSuccess: (data) => {
      if (data) setPreview(data);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      // W5: use stashed pendingDraft + confirmTarget (edit dialog is already
      // closed by the time the user clicks confirm).
      const target = confirmTarget;
      const source = pendingDraft;
      if (!target || !source) return;
      await api.patch(
        `/settings/doc-config/${encodeURIComponent(target.docType)}`,
        {
          prefix: source.prefix,
          format: source.format,
          resetCadence: source.resetCadence,
          digitCount: source.digitCount,
          notes: source.notes,
          active: source.active,
        },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['doc-config'] });
      toast.success('บันทึกการตั้งค่าเรียบร้อย');
      setConfirmTarget(null);
      setPendingDraft(null);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const insertToken = (token: string) => {
    setDraft((d) => ({ ...d, format: `${d.format ?? ''}${token}` }));
  };

  const rows = query.data ?? [];

  const hasChanges = useMemo(() => {
    if (!editTarget) return false;
    return (
      draft.prefix !== editTarget.prefix ||
      draft.format !== editTarget.format ||
      draft.resetCadence !== editTarget.resetCadence ||
      draft.digitCount !== editTarget.digitCount ||
      (draft.notes ?? '') !== (editTarget.notes ?? '') ||
      draft.active !== editTarget.active
    );
  }, [draft, editTarget]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="ตั้งค่าเลขที่/รูปแบบเอกสาร"
        subtitle="กำหนด prefix รูปแบบ รอบรีเซ็ต และจำนวนหลักของเลขที่เอกสารแต่ละประเภท"
      />

      <QueryBoundary
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        <div className="rounded-md border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">รหัส</TableHead>
                <TableHead>ประเภทเอกสาร</TableHead>
                <TableHead>รูปแบบปัจจุบัน</TableHead>
                <TableHead>รอบรีเซ็ต</TableHead>
                <TableHead>จำนวนหลัก</TableHead>
                <TableHead>แก้ไขล่าสุด</TableHead>
                <TableHead className="w-24 text-right">เครื่องมือ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    ยังไม่มีการตั้งค่าเลขที่เอกสาร — กรุณารัน migration ก่อน
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-sm">{row.docType}</TableCell>
                    <TableCell className="leading-snug">{row.description}</TableCell>
                    <TableCell className="font-mono text-xs">{row.format}</TableCell>
                    <TableCell>{CADENCE_LABEL[row.resetCadence] ?? row.resetCadence}</TableCell>
                    <TableCell className="text-center">{row.digitCount}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.updatedBy?.name ?? 'ระบบ'} {new Date(row.updatedAt).toLocaleString('th-TH')}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditTarget(row)}
                      >
                        <Pencil className="size-4" />
                        <span className="sr-only">แก้ไข {row.description}</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </QueryBoundary>

      <Dialog
        open={!!editTarget}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="leading-snug">
              แก้ไขรูปแบบเลขที่ — {editTarget?.description}
            </DialogTitle>
            <DialogDescription className="leading-snug">
              การเปลี่ยนแปลงจะมีผลกับเอกสารใหม่หลังจากนี้ (ไม่ย้อนหลัง)
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="doc-prefix">Prefix</Label>
              <Input
                id="doc-prefix"
                value={draft.prefix ?? ''}
                maxLength={20}
                onChange={(e) => setDraft((d) => ({ ...d, prefix: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="doc-format">รูปแบบ (format)</Label>
              <Input
                id="doc-format"
                value={draft.format ?? ''}
                maxLength={100}
                onChange={(e) => setDraft((d) => ({ ...d, format: e.target.value }))}
                className="font-mono"
              />
              <div className="flex flex-wrap gap-1">
                {TOKEN_HELP.map((t) => (
                  <button
                    key={t.token}
                    type="button"
                    onClick={() => insertToken(t.token)}
                    className="rounded border border-border bg-muted px-2 py-0.5 text-xs hover:bg-accent"
                    title={t.label}
                  >
                    {t.token}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="doc-cadence">รอบรีเซ็ต</Label>
                <Select
                  value={draft.resetCadence}
                  onValueChange={(v) =>
                    setDraft((d) => ({ ...d, resetCadence: v as DocNumberConfig['resetCadence'] }))
                  }
                >
                  <SelectTrigger id="doc-cadence">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DAILY">รายวัน (DAILY)</SelectItem>
                    <SelectItem value="MONTHLY">รายเดือน (MONTHLY)</SelectItem>
                    <SelectItem value="YEARLY">รายปี (YEARLY)</SelectItem>
                    <SelectItem value="NEVER">ไม่รีเซ็ต (NEVER)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="doc-digits">จำนวนหลัก</Label>
                <Input
                  id="doc-digits"
                  type="number"
                  min={1}
                  max={10}
                  value={draft.digitCount ?? 4}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, digitCount: parseInt(e.target.value, 10) || 4 }))
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="doc-notes">หมายเหตุ (ไม่บังคับ)</Label>
              <Input
                id="doc-notes"
                value={draft.notes ?? ''}
                maxLength={200}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              />
            </div>

            <div className="rounded border border-border bg-muted/40 p-3 leading-snug">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <FileText className="size-4" />
                ตัวอย่างเลขที่ถัดไป
              </div>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => previewMutation.mutate()}
                  disabled={previewMutation.isPending}
                >
                  สร้างตัวอย่าง
                </Button>
                <span
                  className="font-mono text-base text-foreground"
                  data-testid="doc-config-preview"
                >
                  {preview?.sample ?? '—'}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              ยกเลิก
            </Button>
            <Button
              onClick={() => {
                if (!editTarget) return;
                // W5 (DEEP review): close the edit dialog first so the confirm
                // dialog is the only overlay on top. Stash the draft+target so
                // the confirm step + mutation still have what they need.
                const snapshot = editTarget;
                const draftSnapshot = { ...draft };
                setEditTarget(null);
                setPendingDraft(draftSnapshot);
                setConfirmTarget(snapshot);
              }}
              disabled={!hasChanges || saveMutation.isPending}
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmTarget}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmTarget(null);
            setPendingDraft(null);
          }
        }}
        title="ยืนยันการเปลี่ยนแปลง"
        description="การเปลี่ยนแปลงจะมีผลกับเอกสารใหม่หลังจากนี้ (ไม่ย้อนหลัง) — ยืนยันหรือไม่?"
        confirmLabel="บันทึก"
        cancelLabel="ยกเลิก"
        onConfirm={() => saveMutation.mutate()}
        loading={saveMutation.isPending}
      />
    </div>
  );
}
