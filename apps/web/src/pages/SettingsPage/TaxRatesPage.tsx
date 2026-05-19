import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Plus, Trash2, Lock, AlertTriangle } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import api, { getErrorMessage } from '@/lib/api';
import { useUiFlags, type UiFlags } from '@/hooks/useUiFlags';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface EditingEntry {
  /** -1 when adding a new row, otherwise index into the active list. */
  index: number;
  rate: string;
  label: string;
  effectiveDate: string;
}

const BLANK_ENTRY: EditingEntry = { index: -1, rate: '', label: '', effectiveDate: '' };

/**
 * D1.1.3.6 — Admin UI for tax rates.
 *
 * Drives the SystemConfig key `wht_rates` (JSON array). Optimistic update
 * via react-query — invalidates `['settings-ui-flags']` after a successful
 * PATCH. SSO rate displayed as a locked card (D1.1.3.3 — fixed by law).
 *
 * OWNER-only — App.tsx wraps the route in `<ProtectedRoute roles={['OWNER']}>`.
 */
export default function TaxRatesPage() {
  useDocumentTitle('ตั้งค่าอัตราภาษี');
  const queryClient = useQueryClient();
  const flags = useUiFlags();
  // D1.1.3.2 — `whtRates` flag is supplied by sibling PR #934. The TS type
  // says it's always present, but at runtime the API may return a partial
  // payload (e.g. older Cloud Run revision still serving the response shape
  // from before #934 merged). The `?? []` fallback keeps this page
  // functional with an empty rate list until #934 ships, then auto-picks
  // up the real list as soon as the API revision is updated.
  const whtRates: UiFlags['whtRates'] = (flags?.whtRates ?? []);
  // D1.1.3.3 — SSO rate is locked at 5%. `ssoRateLocked` flag is supplied
  // by a separate PR (D1.1.3.3); fall back to '5%' if not yet present so
  // this page renders cleanly even before that PR merges.
  const ssoRateLocked = (flags as UiFlags & { ssoRateLocked?: string }).ssoRateLocked ?? '5%';

  const [editing, setEditing] = useState<EditingEntry | null>(null);
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (nextList: UiFlags['whtRates']) =>
      api.patch('/settings', {
        items: [{ key: 'wht_rates', value: JSON.stringify(nextList) }],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-ui-flags'] });
      toast.success('บันทึกอัตราภาษีเรียบร้อย');
      setEditing(null);
      setDeletingIndex(null);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  /** Build the updated list from the dialog's editing state. */
  const buildNextList = (e: EditingEntry): UiFlags['whtRates'] | null => {
    const rate = Number(e.rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 30) {
      toast.error('อัตราต้องเป็นเลขระหว่าง 0–30');
      return null;
    }
    if (!e.label.trim()) {
      toast.error('กรุณากรอกคำอธิบาย');
      return null;
    }
    if (e.effectiveDate && Number.isNaN(Date.parse(e.effectiveDate))) {
      toast.error('วันที่มีผลไม่ถูกต้อง');
      return null;
    }
    const entry = {
      rate,
      label: e.label.trim(),
      ...(e.effectiveDate ? { effectiveDate: e.effectiveDate } : {}),
    };
    const next = [...whtRates];
    if (e.index === -1) next.push(entry);
    else next[e.index] = entry;
    return next;
  };

  const handleSave = () => {
    if (!editing) return;
    const next = buildNextList(editing);
    if (next) saveMutation.mutate(next);
  };

  const handleDelete = () => {
    if (deletingIndex == null) return;
    const next = whtRates.filter((_, i) => i !== deletingIndex);
    if (next.length === 0) {
      toast.error('ต้องเหลืออัตราอย่างน้อย 1 รายการ');
      setDeletingIndex(null);
      return;
    }
    saveMutation.mutate(next);
  };

  const sortedView = useMemo(
    () =>
      whtRates
        .map((r, i) => ({ ...r, _i: i }))
        .sort((a, b) => a.rate - b.rate),
    [whtRates],
  );

  return (
    <div>
      <PageHeader
        title="ตั้งค่าอัตราภาษี"
        subtitle="อัตราภาษีหัก ณ ที่จ่าย (WHT) และข้อมูลอัตราที่ถูกล็อกตามกฎหมาย"
      />

      <div className="space-y-6">
        {/* D1.1.3.2 / D1.1.3.5 — WHT rates table (editable) */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base">อัตราภาษีหัก ณ ที่จ่าย</CardTitle>
            <Button
              size="sm"
              type="button"
              onClick={() => setEditing({ ...BLANK_ENTRY })}
              aria-label="เพิ่มอัตราใหม่"
            >
              <Plus className="size-4" /> เพิ่มอัตรา
            </Button>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground leading-snug">
              อัตราที่กำหนดที่นี่จะปรากฏใน dropdown ของฟอร์มค่าใช้จ่าย/Other Income.
              วันที่มีผล (ถ้ามี) จะกรองรายการอัตราในอนาคตออกอัตโนมัติ.
            </p>
            <div className="rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">อัตรา (%)</TableHead>
                    <TableHead>คำอธิบาย</TableHead>
                    <TableHead className="w-[160px]">วันที่มีผล</TableHead>
                    <TableHead className="w-[120px] text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedView.map((r) => (
                    <TableRow key={`${r._i}-${r.rate}`}>
                      <TableCell className="font-mono">{r.rate}%</TableCell>
                      <TableCell>{r.label}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.effectiveDate ?? '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          type="button"
                          onClick={() =>
                            setEditing({
                              index: r._i,
                              rate: String(r.rate),
                              label: r.label,
                              effectiveDate: r.effectiveDate ?? '',
                            })
                          }
                          aria-label={`แก้ไขอัตรา ${r.rate}%`}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          type="button"
                          onClick={() => setDeletingIndex(r._i)}
                          aria-label={`ลบอัตรา ${r.rate}%`}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* D1.1.3.3 — SSO rate locked card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Lock className="size-4 text-muted-foreground" />
              อัตราเงินสมทบประกันสังคม (SSO)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-2xl">{ssoRateLocked}</span>
              <span className="text-sm text-muted-foreground">
                ปกติคิด 5% (ตามกฎหมาย)
              </span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground leading-snug flex items-start gap-2">
              <AlertTriangle className="size-4 mt-0.5 text-amber-500" />
              <span>
                อัตราถูกล็อกที่ 5% ตามพระราชบัญญัติประกันสังคม พ.ศ. 2533 มาตรา 46
                ประกอบกฎกระทรวง — ห้ามแก้ไขผ่านระบบ. หากต้องการเปลี่ยนแปลง
                ต้องรอกฎหมายแก้ไข.
              </span>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Add/Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing && editing.index === -1 ? 'เพิ่มอัตราภาษี' : 'แก้ไขอัตราภาษี'}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="rate">อัตรา (%) — 0 ถึง 30</Label>
                <Input
                  id="rate"
                  type="number"
                  step="0.01"
                  min="0"
                  max="30"
                  value={editing.rate}
                  onChange={(e) => setEditing({ ...editing, rate: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="label">คำอธิบาย</Label>
                <Input
                  id="label"
                  type="text"
                  value={editing.label}
                  onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                  placeholder="3% — ค่าบริการ"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="effectiveDate">วันที่มีผล (เลือกไม่ก็ได้)</Label>
                <Input
                  id="effectiveDate"
                  type="date"
                  value={editing.effectiveDate}
                  onChange={(e) =>
                    setEditing({ ...editing, effectiveDate: e.target.value })
                  }
                />
                <p className="text-xs text-muted-foreground leading-snug">
                  หากกำหนดวันที่ในอนาคต อัตรานี้จะยังไม่ปรากฏใน dropdown
                  จนกว่าจะถึงวันที่ระบุ.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditing(null)}
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? 'กำลังบันทึก…' : 'บันทึก'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <ConfirmDialog
        open={deletingIndex !== null}
        onOpenChange={(o) => !o && setDeletingIndex(null)}
        title="ลบอัตราภาษี?"
        description={
          deletingIndex !== null && whtRates[deletingIndex]
            ? `จะลบอัตรา ${whtRates[deletingIndex].rate}% — ${whtRates[deletingIndex].label} ออกจาก dropdown ทั้งหมด.`
            : ''
        }
        confirmLabel="ลบ"
        variant="destructive"
        loading={saveMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
