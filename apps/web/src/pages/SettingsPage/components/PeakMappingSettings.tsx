import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Upload, Search, Save, RotateCcw, Info, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
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
 * FINANCE mapping v5 (ฝ่ายบัญชี 19/10/2569 · mockup เจ้าของเคาะ 2026-10-20): two more
 * columns per row — "แหล่งรหัสย่อย" (where the PEAK sub-account code comes from)
 * and "รหัสย่อย PEAK" (the code itself, only for a fixed source). The dirty map
 * now holds the FULL triple of every edited row, and Save always sends the
 * triple, so the API never mistakes an omitted field for "clear it".
 *
 * Editable cells use lightweight controlled inputs (no react-hook-form) — the
 * "dirty" map below tracks which rows changed so the Save button enables only
 * when there's something to persist.
 */
export type PeakSubCodeSource = 'none' | 'fixed' | 'contact' | 'bank' | 'cashbox';

interface PeakMappingRow {
  id: string;
  code: string;
  name: string;
  type: string;
  peakCode: string | null;
  // Optional for rows served before mapping v5 (and older fixtures) — read as none/null.
  peakSubCode?: string | null;
  peakSubCodeSource?: PeakSubCodeSource | null;
}

/** The three editable fields of one row, as they will be sent to the API. */
interface PeakMapping {
  peakCode: string | null;
  peakSubCode: string | null;
  peakSubCodeSource: PeakSubCodeSource;
}

const SUB_CODE_SOURCES: { value: PeakSubCodeSource; label: string; placeholder: string }[] = [
  { value: 'none', label: 'ไม่มี', placeholder: '—' },
  { value: 'fixed', label: 'คงที่', placeholder: 'เช่น ADV001' },
  { value: 'contact', label: 'ตามผู้ติดต่อ', placeholder: 'ระบบหาจากผู้ติดต่อ' },
  { value: 'bank', label: 'ตามบัญชีธนาคาร', placeholder: 'ระบบหาจากบัญชีธนาคาร' },
  { value: 'cashbox', label: 'ตามผู้ถือเงินสด', placeholder: 'ระบบหาจากผู้ถือเงินสด' },
];
const SOURCE_VALUES = new Set<string>(SUB_CODE_SOURCES.map((s) => s.value));
const FIXED_WITHOUT_CODE_MSG = 'ต้องระบุเมื่อแหล่งเป็น "คงที่"';

const PEAK_CODE_RE = /^[A-Za-z0-9\-_.]{0,20}$/;

function isValidPeakCode(v: string): boolean {
  return PEAK_CODE_RE.test(v);
}

function isSource(v: string): v is PeakSubCodeSource {
  return SOURCE_VALUES.has(v);
}

/** What the server currently holds for this row (defaults for pre-v5 rows). */
function storedMapping(row: PeakMappingRow): PeakMapping {
  return {
    peakCode: row.peakCode ?? null,
    peakSubCode: row.peakSubCode ?? null,
    peakSubCodeSource: row.peakSubCodeSource ?? 'none',
  };
}

/** A sub-code only exists for a fixed source — every other source stores null. */
function normaliseMapping(m: PeakMapping): PeakMapping {
  return { ...m, peakSubCode: m.peakSubCodeSource === 'fixed' ? m.peakSubCode : null };
}

function sameMapping(a: PeakMapping, b: PeakMapping): boolean {
  return (
    (a.peakCode ?? null) === (b.peakCode ?? null) &&
    (a.peakSubCode ?? null) === (b.peakSubCode ?? null) &&
    a.peakSubCodeSource === b.peakSubCodeSource
  );
}

function trimOrNull(v: string): string | null {
  const t = v.trim();
  return t.length === 0 ? null : t;
}

/** Minimal CSV line splitter — the downloaded file quotes names that contain commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export default function PeakMappingSettings({ canEdit = false }: { canEdit?: boolean }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 200);
  // Map of accountId -> the row's full edited mapping (absent = unchanged).
  const [dirty, setDirty] = useState<Record<string, PeakMapping>>({});
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');

  const { data: rows = [], isLoading } = useQuery<PeakMappingRow[]>({
    queryKey: ['chart-of-accounts', 'peak-mapping'],
    queryFn: async () => (await api.get('/chart-of-accounts/peak-mapping')).data,
  });

  function effective(row: PeakMappingRow): PeakMapping {
    return dirty[row.id] ?? storedMapping(row);
  }

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const m = dirty[r.id] ?? storedMapping(r);
      return (
        r.code.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        (m.peakCode ?? '').toLowerCase().includes(q) ||
        (m.peakSubCode ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, dirty, debouncedSearch]);

  const stats = useMemo(() => {
    let mapped = 0;
    let fixed = 0;
    let contact = 0;
    for (const r of rows) {
      const m = dirty[r.id] ?? storedMapping(r);
      if (m.peakCode) mapped++;
      if (m.peakSubCodeSource === 'fixed') fixed++;
      if (m.peakSubCodeSource === 'contact') contact++;
    }
    return { mapped, fixed, contact };
  }, [rows, dirty]);

  const dirtyCount = useMemo(() => Object.keys(dirty).length, [dirty]);

  // Rows whose effective state the API would reject (fixed source without a code).
  const errorCodes = useMemo(
    () =>
      rows
        .filter((r) => {
          const m = dirty[r.id] ?? storedMapping(r);
          return m.peakSubCodeSource === 'fixed' && !m.peakSubCode;
        })
        .map((r) => r.code),
    [rows, dirty],
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!canEdit) throw new Error('ไม่มีสิทธิ์แก้ไขรหัส PEAK');
      const mappings = Object.entries(dirty).map(([id, m]) => ({ id, ...m }));
      return api.put('/chart-of-accounts/peak-mapping', { mappings });
    },
    onSuccess: (res: { data: { updated: number } }) => {
      toast.success(`บันทึก ${res.data.updated} รายการสำเร็จ`);
      setDirty({});
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts', 'peak-mapping'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  function setRow(row: PeakMappingRow, patch: Partial<PeakMapping>) {
    setDirty((prev) => {
      const current = prev[row.id] ?? storedMapping(row);
      const next = normaliseMapping({ ...current, ...patch });
      const copy = { ...prev };
      if (sameMapping(next, storedMapping(row))) {
        delete copy[row.id];
      } else {
        copy[row.id] = next;
      }
      return copy;
    });
  }

  function onPeakCodeChange(row: PeakMappingRow, raw: string) {
    const trimmed = raw.trim();
    if (!isValidPeakCode(trimmed)) {
      // Surface invalid input but still update local state so user sees what they typed.
      toast.error('รหัส PEAK ต้องเป็น A-Z 0-9 - _ . และยาวไม่เกิน 20');
    }
    // Map empty -> null so server stores null (unmapped) rather than empty string.
    setRow(row, { peakCode: trimOrNull(trimmed) });
  }

  function onSubCodeChange(row: PeakMappingRow, raw: string) {
    const trimmed = raw.trim();
    if (!isValidPeakCode(trimmed)) {
      toast.error('รหัสย่อย PEAK ต้องเป็น A-Z 0-9 - _ . และยาวไม่เกิน 20');
    }
    setRow(row, { peakSubCode: trimOrNull(trimmed) });
  }

  function onSourceChange(row: PeakMappingRow, raw: string) {
    if (!isSource(raw)) return;
    setRow(row, { peakSubCodeSource: raw });
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

  /**
   * Parse pasted lines. Three shapes are accepted:
   *  - the downloaded CSV (header `code,name,peakCode,peakSubCode,peakSubCodeSource`) —
   *    columns are located by header name, `name` is ignored;
   *  - positional `รหัสบัญชี,รหัส PEAK,รหัสย่อย,แหล่ง` (3–4 cells);
   *  - the old `รหัสบัญชี,รหัส PEAK` (2 cells) — keeps the row's stored sub-code/source.
   * A line is skipped (counted as invalid) when the account code is unknown, a code
   * fails the PEAK pattern, the source is not one of the five, or a fixed source has
   * no sub-code.
   */
  function applyBulk() {
    const rowByCode = new Map(rows.map((r) => [r.code, r]));
    const next: Record<string, PeakMapping> = { ...dirty };
    let matched = 0;
    let invalid = 0;
    const lines = bulkText
      .replace(/^ /, '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    let header: string[] | null = null;
    if (lines.length > 0 && /^"?code\b/i.test(lines[0])) {
      header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
      lines.shift();
    }
    const col = (name: string) => (header ? header.indexOf(name.toLowerCase()) : -1);
    for (const line of lines) {
      const cells = splitCsvLine(line);
      let codeRaw: string;
      let peakRaw: string;
      let subRaw: string | undefined;
      let srcRaw: string | undefined;
      // A downloaded-CSV line has exactly as many cells as the header; a shorter
      // line under the header is an old positional paste (2 cells) and is read as such.
      if (header && cells.length === header.length) {
        codeRaw = cells[col('code')] ?? '';
        peakRaw = cells[col('peakCode')] ?? '';
        subRaw = col('peakSubCode') >= 0 ? cells[col('peakSubCode')] : undefined;
        srcRaw = col('peakSubCodeSource') >= 0 ? cells[col('peakSubCodeSource')] : undefined;
      } else {
        [codeRaw, peakRaw] = [cells[0] ?? '', cells[1] ?? ''];
        subRaw = cells.length >= 3 ? (cells[2] ?? '') : undefined;
        srcRaw = cells.length >= 3 ? (cells[3] ?? '') : undefined;
      }
      const row = rowByCode.get(codeRaw);
      if (!row) {
        invalid++;
        continue;
      }
      const peak = trimOrNull(peakRaw);
      if (peak && !isValidPeakCode(peak)) {
        invalid++;
        continue;
      }
      const base = next[row.id] ?? storedMapping(row);
      let mapping: PeakMapping = { ...base, peakCode: peak };
      if (subRaw !== undefined || srcRaw !== undefined) {
        const src = (srcRaw ?? '').trim() || 'none';
        if (!isSource(src)) {
          invalid++;
          continue;
        }
        const sub = trimOrNull(subRaw ?? '');
        if (src === 'fixed' && (!sub || !isValidPeakCode(sub))) {
          invalid++;
          continue;
        }
        mapping = normaliseMapping({ peakCode: peak, peakSubCode: sub, peakSubCodeSource: src });
      }
      if (sameMapping(mapping, storedMapping(row))) {
        delete next[row.id];
      } else {
        next[row.id] = mapping;
      }
      matched++;
    }
    setDirty(next);
    setBulkOpen(false);
    setBulkText('');
    toast.success(`นำเข้า ${matched} รายการ${invalid > 0 ? `, ข้าม ${invalid} รายการที่ไม่ถูกต้อง` : ''}`);
  }

  const canSave = canEdit && dirtyCount > 0 && errorCodes.length === 0 && !saveMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="leading-snug">การจับคู่ผังบัญชี → PEAK</CardTitle>
        <CardDescription className="leading-snug">
          ระบุรหัสบัญชีในระบบ PEAK สำหรับแต่ละบัญชีของระบบ และบอกว่าบรรทัดของบัญชีนั้นใช้บัญชีย่อยของ PEAK จากไหน
          เพื่อใช้ส่งออกเข้าโปรแกรม PEAK ของฝ่ายบัญชี
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="size-4" aria-hidden />
          <AlertDescription className="leading-snug">
            จับคู่แล้ว <strong>{stats.mapped}</strong> จาก <strong>{rows.length}</strong> รายการ · รหัสย่อยคงที่{' '}
            <strong>{stats.fixed}</strong> · ตามผู้ติดต่อ <strong>{stats.contact}</strong>
            {dirtyCount > 0 && (
              <>
                {' '}— มีการแก้ไขที่ยังไม่บันทึก <Badge variant="warning">{dirtyCount}</Badge>
              </>
            )}
          </AlertDescription>
        </Alert>

        {errorCodes.length > 0 && (
          <Alert variant="destructive" appearance="light">
            <AlertTriangle className="size-4" aria-hidden />
            <AlertDescription className="leading-snug">
              <strong>บันทึกไม่ได้ {errorCodes.length} รายการ</strong> — บัญชี {errorCodes.join(', ')} เลือกแหล่งรหัสย่อย
              "คงที่" แต่ยังไม่ได้ใส่รหัสย่อย PEAK (เช่น ADV001) ระบบบันทึกทั้งชุดหรือไม่บันทึกเลย
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="size-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              placeholder="ค้นหารหัส/ชื่อ/รหัส PEAK/รหัสย่อย"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
              aria-label="ค้นหารหัสบัญชี"
            />
          </div>
          {canEdit && <Button variant="outline" onClick={() => setBulkOpen(true)} aria-label="นำเข้าจาก CSV">
            <Upload className="size-4 mr-1" aria-hidden />
            นำเข้า
          </Button>}
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
                  <TableHead className="w-[160px]">รหัส PEAK</TableHead>
                  <TableHead className="w-[190px]">แหล่งรหัสย่อย</TableHead>
                  <TableHead className="w-[180px]">รหัสย่อย PEAK</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-4">
                      ไม่พบรายการ
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((row) => {
                    const m = effective(row);
                    const isDirty = dirty[row.id] !== undefined;
                    const source = SUB_CODE_SOURCES.find((s) => s.value === m.peakSubCodeSource) ?? SUB_CODE_SOURCES[0];
                    const subMissing = m.peakSubCodeSource === 'fixed' && !m.peakSubCode;
                    const subErrorId = `peak-sub-error-${row.id}`;
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono align-top pt-3.5">{row.code}</TableCell>
                        <TableCell className="leading-snug align-top pt-3.5">{row.name}</TableCell>
                        <TableCell className="align-top">
                          <Input
                            value={m.peakCode ?? ''}
                            readOnly={!canEdit}
                            disabled={saveMutation.isPending}
                            onChange={(e) => onPeakCodeChange(row, e.target.value)}
                            placeholder="—"
                            maxLength={20}
                            aria-label={`รหัส PEAK สำหรับ ${row.code}`}
                            className={isDirty ? 'border-warning' : ''}
                          />
                        </TableCell>
                        <TableCell className="align-top">
                          <NativeSelect
                            value={m.peakSubCodeSource}
                            disabled={!canEdit || saveMutation.isPending}
                            onChange={(e) => onSourceChange(row, e.target.value)}
                            aria-label={`แหล่งรหัสย่อย สำหรับ ${row.code}`}
                            className={isDirty ? 'border-warning' : ''}
                          >
                            {SUB_CODE_SOURCES.map((s) => (
                              <option key={s.value} value={s.value}>
                                {s.label}
                              </option>
                            ))}
                          </NativeSelect>
                        </TableCell>
                        <TableCell className="align-top">
                          <Input
                            value={m.peakSubCode ?? ''}
                            readOnly={!canEdit}
                            disabled={m.peakSubCodeSource !== 'fixed' || saveMutation.isPending}
                            onChange={(e) => onSubCodeChange(row, e.target.value)}
                            placeholder={source.placeholder}
                            maxLength={20}
                            aria-label={`รหัสย่อย PEAK สำหรับ ${row.code}`}
                            aria-invalid={subMissing || undefined}
                            aria-describedby={subMissing ? subErrorId : undefined}
                            className={subMissing ? 'border-destructive' : isDirty ? 'border-warning' : ''}
                          />
                          {subMissing && (
                            <p id={subErrorId} className="mt-1 text-xs leading-snug text-destructive">
                              {FIXED_WITHOUT_CODE_MSG}
                            </p>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {canEdit && <div className="flex flex-wrap justify-end items-center gap-2 pt-2">
          {errorCodes.length > 0 && (
            <span className="text-sm text-warning-strong leading-snug">แก้ให้ครบก่อน แล้วปุ่มบันทึกจะเปิด</span>
          )}
          {dirtyCount > 0 && (
            <Button variant="ghost" onClick={resetChanges} disabled={saveMutation.isPending}>
              <RotateCcw className="size-4 mr-1" aria-hidden />
              ยกเลิกการแก้ไข
            </Button>
          )}
          <Button onClick={() => saveMutation.mutate()} disabled={!canSave}>
            <Save className="size-4 mr-1" aria-hidden />
            บันทึก {dirtyCount > 0 && `(${dirtyCount})`}
          </Button>
        </div>}
      </CardContent>

      <Dialog open={canEdit && bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>นำเข้ารหัส PEAK จาก CSV</DialogTitle>
            <DialogDescription className="leading-snug">
              วางรายการบรรทัดละหนึ่งบัญชีในรูปแบบ <code>รหัสบัญชี,รหัส PEAK,รหัสย่อย,แหล่ง</code> (แหล่ง = none / fixed /
              contact / bank / cashbox) ใส่แค่ <code>รหัสบัญชี,รหัส PEAK</code> ก็ได้ (ไม่แตะรหัสย่อยเดิม)
              ไฟล์ที่ดาวน์โหลดจากปุ่ม "ดาวน์โหลด CSV" วางกลับได้ทั้งไฟล์ (ละเว้นรายการที่ไม่มีรหัสบัญชีตรงกัน)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="bulk-text">รายการ</Label>
            <Textarea
              id="bulk-text"
              rows={10}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={'11-6101,212203,ADV001,fixed\n11-2101,113101,,contact\n53-1306,530215'}
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
