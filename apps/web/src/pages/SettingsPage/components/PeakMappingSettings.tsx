import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Upload, Search, Save, RotateCcw, Info } from 'lucide-react';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebounce } from '@/hooks/useDebounce';

/**
 * P3-SP3: PEAK code mapping editor.
 * Each ChartOfAccount can be tagged with its PEAK external code so the
 * `/accounting/journal/export-peak` CSV can be uploaded into peakaccount.com.
 *
 * Editable cells use lightweight controlled inputs (no react-hook-form) — the
 * "dirty" map below tracks which rows changed so the Save button enables only
 * when there's something to persist.
 */
interface PeakMappingRow {
  id: string;
  code: string;
  name: string;
  type: string;
  peakCode: string | null;
}

const PEAK_CODE_RE = /^[A-Za-z0-9\-_.]{0,20}$/;

function isValidPeakCode(v: string): boolean {
  return PEAK_CODE_RE.test(v);
}

export default function PeakMappingSettings() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 200);
  // Map of accountId -> new peakCode (string | null). Null means "clear".
  const [dirty, setDirty] = useState<Record<string, string | null>>({});
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');

  const { data: rows = [], isLoading } = useQuery<PeakMappingRow[]>({
    queryKey: ['chart-of-accounts', 'peak-mapping'],
    queryFn: async () => (await api.get('/chart-of-accounts/peak-mapping')).data,
  });

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.code.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        (r.peakCode ?? '').toLowerCase().includes(q),
    );
  }, [rows, debouncedSearch]);

  const mappedCount = useMemo(() => rows.filter((r) => r.peakCode).length, [rows]);
  const dirtyCount = useMemo(() => Object.keys(dirty).length, [dirty]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const mappings = Object.entries(dirty).map(([id, peakCode]) => ({
        id,
        peakCode,
      }));
      return api.put('/chart-of-accounts/peak-mapping', { mappings });
    },
    onSuccess: (res: { data: { updated: number } }) => {
      toast.success(`บันทึก ${res.data.updated} รายการสำเร็จ`);
      setDirty({});
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts', 'peak-mapping'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  function effectiveValue(row: PeakMappingRow): string {
    const next = dirty[row.id];
    if (next !== undefined) return next ?? '';
    return row.peakCode ?? '';
  }

  function onCellChange(row: PeakMappingRow, raw: string) {
    const trimmed = raw.trim();
    if (!isValidPeakCode(trimmed)) {
      // Surface invalid input but still update local state so user sees what they typed.
      toast.error('รหัส PEAK ต้องเป็น A-Z 0-9 - _ . และยาวไม่เกิน 20');
    }
    // Map empty -> null so server stores null (unmapped) rather than empty string.
    const next: string | null = trimmed.length === 0 ? null : trimmed;
    // If the new value equals the original DB value, remove from dirty map.
    setDirty((prev) => {
      const copy = { ...prev };
      const original = row.peakCode ?? null;
      if ((next ?? null) === original) {
        delete copy[row.id];
      } else {
        copy[row.id] = next;
      }
      return copy;
    });
  }

  function resetChanges() {
    setDirty({});
  }

  async function downloadCsv() {
    try {
      const res = await api.get('/chart-of-accounts/peak-mapping/csv', { responseType: 'blob' });
      const blob = res.data as Blob;
      // Use the server's Content-Disposition filename as the single source of truth.
      // The server already stamps the filename with the Asia/Bangkok date — building
      // a stamp client-side would drift to UTC between 17:00–24:00 UTC each day.
      const contentDisp = (res.headers?.['content-disposition'] as string | undefined) || '';
      const match = contentDisp.match(/filename="?([^";]+)"?/);
      // Fallback uses a BKK-shifted date (UTC + 7h) so the offline fallback also
      // aligns with the server's BKK date rather than the browser's local zone.
      const fallbackBkk = new Date(Date.now() + 7 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)
        .replace(/-/g, '');
      const filename = match?.[1] || `peak-mapping-${fallbackBkk}.csv`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  }

  function applyBulk() {
    // Parse "internal_code,peak_code" per line. Skip header rows and blanks.
    const codeIndex = new Map(rows.map((r) => [r.code, r.id]));
    const next: Record<string, string | null> = { ...dirty };
    let matched = 0;
    let invalid = 0;
    for (const line of bulkText.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.toLowerCase().startsWith('code')) continue;
      const [codeRaw, peakRaw] = trimmed.split(',').map((s) => s.trim());
      const id = codeIndex.get(codeRaw);
      if (!id) {
        invalid++;
        continue;
      }
      const peak = peakRaw && peakRaw.length > 0 ? peakRaw : null;
      if (peak && !isValidPeakCode(peak)) {
        invalid++;
        continue;
      }
      next[id] = peak;
      matched++;
    }
    setDirty(next);
    setBulkOpen(false);
    setBulkText('');
    toast.success(`นำเข้า ${matched} รายการ${invalid > 0 ? `, ข้าม ${invalid} รายการที่ไม่ถูกต้อง` : ''}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="leading-snug">การจับคู่ผังบัญชี → PEAK</CardTitle>
        <CardDescription className="leading-snug">
          ระบุรหัสบัญชีในระบบ PEAK สำหรับแต่ละบัญชีของระบบ เพื่อใช้ส่งออกเข้าโปรแกรม PEAK ของฝ่ายบัญชี
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="size-4" aria-hidden />
          <AlertDescription className="leading-snug">
            จับคู่แล้ว <strong>{mappedCount}</strong> จาก <strong>{rows.length}</strong> รายการ
            {dirtyCount > 0 && (
              <>
                {' '}— มีการแก้ไขที่ยังไม่บันทึก <Badge variant="warning">{dirtyCount}</Badge>
              </>
            )}
          </AlertDescription>
        </Alert>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="size-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              placeholder="ค้นหารหัส/ชื่อ/รหัส PEAK"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
              aria-label="ค้นหารหัสบัญชี"
            />
          </div>
          <Button variant="outline" onClick={() => setBulkOpen(true)} aria-label="นำเข้าจาก CSV">
            <Upload className="size-4 mr-1" aria-hidden />
            นำเข้า
          </Button>
          <Button variant="outline" onClick={downloadCsv} aria-label="ดาวน์โหลด CSV">
            <Download className="size-4 mr-1" aria-hidden />
            ดาวน์โหลด CSV
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
        ) : (
          <div className="border border-border rounded-md overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">รหัสบัญชี</TableHead>
                  <TableHead>ชื่อบัญชี</TableHead>
                  <TableHead className="w-[200px]">รหัส PEAK</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-4">
                      ไม่พบรายการ
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((row) => {
                    const value = effectiveValue(row);
                    const isDirty = dirty[row.id] !== undefined;
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono">{row.code}</TableCell>
                        <TableCell className="leading-snug">{row.name}</TableCell>
                        <TableCell>
                          <Input
                            value={value}
                            onChange={(e) => onCellChange(row, e.target.value)}
                            placeholder="—"
                            maxLength={20}
                            aria-label={`รหัส PEAK สำหรับ ${row.code}`}
                            className={isDirty ? 'border-warning' : ''}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          {dirtyCount > 0 && (
            <Button variant="ghost" onClick={resetChanges} disabled={saveMutation.isPending}>
              <RotateCcw className="size-4 mr-1" aria-hidden />
              ยกเลิกการแก้ไข
            </Button>
          )}
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={dirtyCount === 0 || saveMutation.isPending}
          >
            <Save className="size-4 mr-1" aria-hidden />
            บันทึก {dirtyCount > 0 && `(${dirtyCount})`}
          </Button>
        </div>
      </CardContent>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>นำเข้ารหัส PEAK จาก CSV</DialogTitle>
            <DialogDescription className="leading-snug">
              วางรายการในรูปแบบ <code>รหัสบัญชี,รหัส PEAK</code> บรรทัดละหนึ่งรายการ
              (ละเว้นรายการที่ไม่มีรหัสบัญชีตรงกัน)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="bulk-text">รายการ</Label>
            <Textarea
              id="bulk-text"
              rows={10}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={'11-1101,1110-01\n11-1102,1110-02'}
              className="font-mono text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>ยกเลิก</Button>
            <Button onClick={applyBulk} disabled={!bulkText.trim()}>นำไปแก้ไข</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
