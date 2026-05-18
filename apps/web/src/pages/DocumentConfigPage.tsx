import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileText } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import { Input } from '@/components/ui/input';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import api, { getErrorMessage } from '@/lib/api';

/**
 * P2-SP2 — Document Number Config UI.
 *
 * OWNER-only page that exposes the 3 SystemConfig keys shipped under D1.1.2.x:
 *   - `doc_prefix_per_type` (JSON object of doc-type → 2-4 letter prefix)
 *   - `doc_number_format` (enum)
 *   - `doc_number_reset_cycle` (enum)
 *
 * Live preview calls `GET /settings/doc-config/preview` per row as the OWNER
 * edits. "บันทึก" triggers a confirmation dialog then PATCH /settings/ which
 * writes all 3 keys atomically via the existing bulkUpdate audit pipeline
 * (action = SYSTEM_CONFIG_UPDATE — same audit string D1.1.2.x already emits).
 */

const FORMAT_OPTIONS = [
  { value: 'PREFIX-YYMM-NNN', label: 'PREFIX-YYMM-NNN (default — YY+เดือน, 3 หลัก)' },
  { value: 'PREFIX-YYYYMMDD-NNNN', label: 'PREFIX-YYYYMMDD-NNNN (เลขรายวัน, 4 หลัก)' },
  { value: 'PREFIX-YYYYMM-NNNNN', label: 'PREFIX-YYYYMM-NNNNN (รายเดือน, 5 หลัก)' },
  { value: 'PREFIX-YYYY-NNNNNN', label: 'PREFIX-YYYY-NNNNNN (รายปี, 6 หลัก)' },
] as const;

const RESET_CYCLE_OPTIONS = [
  { value: 'DAILY', label: 'รายวัน' },
  { value: 'MONTHLY', label: 'รายเดือน' },
  { value: 'YEARLY', label: 'รายปี (default)' },
] as const;

const DOC_TYPE_ROWS: { key: string; label: string; defaultPrefix: string }[] = [
  { key: 'EXPENSE', label: 'รายจ่าย (Expense)', defaultPrefix: 'EX' },
  { key: 'CREDIT_NOTE', label: 'ใบลดหนี้ (Credit Note)', defaultPrefix: 'CN' },
  { key: 'PAYROLL', label: 'เงินเดือน (Payroll)', defaultPrefix: 'PR' },
  { key: 'VENDOR_SETTLEMENT', label: 'จ่ายเจ้าหนี้ (Vendor Settlement)', defaultPrefix: 'SE' },
  { key: 'OTHER_INCOME', label: 'รายได้อื่น (Other Income)', defaultPrefix: 'OI' },
  { key: 'RECEIPT', label: 'ใบเสร็จรับเงิน (Receipt)', defaultPrefix: 'RT' },
  { key: 'PETTY_CASH_REIMBURSEMENT', label: 'เงินสดย่อย (Petty Cash)', defaultPrefix: 'PC' },
  { key: 'CONTRACT', label: 'สัญญาผ่อน (Contract)', defaultPrefix: 'CT' },
];

const PREFIX_REGEX = /^[A-Z]{2,4}$/;

type SystemConfigItem = { id?: string; key: string; value: string };

type RowState = {
  prefix: string;
  error: string | null;
};

export default function DocumentConfigPage() {
  useDocumentTitle('ตั้งค่าเลขที่/รูปแบบเอกสาร');
  const queryClient = useQueryClient();
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [format, setFormat] = useState<string>('PREFIX-YYMM-NNN');
  const [resetCycle, setResetCycle] = useState<string>('YEARLY');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [initialised, setInitialised] = useState(false);

  // Pull the existing SystemConfig dump — the existing /settings GET endpoint
  // returns the whole row set so we don't need a doc-config-only fetch.
  const { data: configs = [], isLoading } = useQuery<SystemConfigItem[]>({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });

  // Hydrate row state + global format/cycle from the loaded SystemConfig dump
  // exactly once per load so OWNER edits aren't clobbered by a refetch.
  useEffect(() => {
    if (initialised || configs.length === 0) return;
    const next: Record<string, RowState> = {};
    let prefixMap: Record<string, string> = {};
    const prefixRow = configs.find((c) => c.key === 'doc_prefix_per_type');
    if (prefixRow) {
      try {
        const parsed = JSON.parse(prefixRow.value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          prefixMap = parsed as Record<string, string>;
        }
      } catch {
        // malformed → ignore, fall back to defaults
      }
    }
    for (const row of DOC_TYPE_ROWS) {
      const candidate = prefixMap[row.key];
      const value =
        typeof candidate === 'string' && PREFIX_REGEX.test(candidate)
          ? candidate
          : row.defaultPrefix;
      next[row.key] = { prefix: value, error: null };
    }
    const fmt = configs.find((c) => c.key === 'doc_number_format')?.value;
    const cyc = configs.find((c) => c.key === 'doc_number_reset_cycle')?.value;
    if (fmt && FORMAT_OPTIONS.some((o) => o.value === fmt)) setFormat(fmt);
    if (cyc) {
      const upper = cyc.toUpperCase();
      if (RESET_CYCLE_OPTIONS.some((o) => o.value === upper)) setResetCycle(upper);
    }
    setRowState(next);
    setInitialised(true);
  }, [configs, initialised]);

  // Per-row preview — re-fetch when prefix/format/resetCycle changes for that
  // row. React Query handles deduping + caching across rapid typing.
  const previewKeysHash = useMemo(() => JSON.stringify(rowState), [rowState]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Compose the JSON object of prefix overrides — include only entries
      // matching the regex. Server-side validation will reject otherwise.
      const prefixMap: Record<string, string> = {};
      for (const row of DOC_TYPE_ROWS) {
        const s = rowState[row.key];
        if (!s) continue;
        if (PREFIX_REGEX.test(s.prefix)) {
          prefixMap[row.key] = s.prefix;
        }
      }
      const items = [
        { key: 'doc_prefix_per_type', value: JSON.stringify(prefixMap) },
        { key: 'doc_number_format', value: format },
        { key: 'doc_number_reset_cycle', value: resetCycle.toLowerCase() },
      ];
      return api.patch('/settings', { items });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('บันทึกการตั้งค่าเลขที่เอกสารสำเร็จ');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const hasError = Object.values(rowState).some((s) => s.error);

  const handlePrefixChange = (docType: string, raw: string) => {
    const next = raw.toUpperCase();
    const error = PREFIX_REGEX.test(next)
      ? null
      : 'ต้องเป็นตัวอักษรพิมพ์ใหญ่ A-Z จำนวน 2-4 ตัว';
    setRowState((prev) => ({
      ...prev,
      [docType]: { prefix: next, error },
    }));
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="ตั้งค่าเลขที่/รูปแบบเอกสาร"
        subtitle="กำหนด prefix, รูปแบบเลขที่ และรอบการรีเซ็ตเลขที่ต่อประเภทเอกสาร"
        icon={<FileText className="size-5" aria-hidden="true" />}
      />

      {/* Global format + reset cycle */}
      <Card>
        <CardHeader>
          <CardTitle>รูปแบบเลขที่และรอบการรีเซ็ต</CardTitle>
          <CardDescription>
            ใช้กับทุกประเภทเอกสารพร้อมกัน — ปรับแล้วเลขที่ในใบใหม่ทั้งหมดจะใช้รูปแบบนี้
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="doc-number-format"
              className="text-sm font-medium text-foreground"
            >
              รูปแบบเลขที่ (Format)
            </label>
            <Select value={format} onValueChange={setFormat}>
              <SelectTrigger id="doc-number-format" aria-label="รูปแบบเลขที่">
                <SelectValue placeholder="เลือกรูปแบบ" />
              </SelectTrigger>
              <SelectContent>
                {FORMAT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="doc-reset-cycle"
              className="text-sm font-medium text-foreground"
            >
              รอบการรีเซ็ต (Reset Cycle)
            </label>
            <Select value={resetCycle} onValueChange={setResetCycle}>
              <SelectTrigger id="doc-reset-cycle" aria-label="รอบการรีเซ็ต">
                <SelectValue placeholder="เลือกรอบ" />
              </SelectTrigger>
              <SelectContent>
                {RESET_CYCLE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Per-doc-type table */}
      <Card>
        <CardHeader>
          <CardTitle>Prefix และ Preview ต่อประเภทเอกสาร</CardTitle>
          <CardDescription>
            ปรับ prefix 2-4 ตัวอักษร พิมพ์ใหญ่ A-Z เท่านั้น — preview จะอัปเดตอัตโนมัติ
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground py-4">กำลังโหลดข้อมูล...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ประเภทเอกสาร</TableHead>
                  <TableHead className="w-40">Prefix</TableHead>
                  <TableHead>ตัวอย่างเลขที่ถัดไป</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {DOC_TYPE_ROWS.map((row) => {
                  const state = rowState[row.key] ?? {
                    prefix: row.defaultPrefix,
                    error: null,
                  };
                  return (
                    <DocConfigRow
                      key={row.key}
                      docType={row.key}
                      label={row.label}
                      state={state}
                      format={format}
                      resetCycle={resetCycle}
                      onPrefixChange={handlePrefixChange}
                      hashKey={previewKeysHash}
                    />
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          variant="primary"
          disabled={hasError || saveMutation.isPending || !initialised}
          onClick={() => setConfirmOpen(true)}
        >
          {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="ยืนยันการบันทึก"
        description="การเปลี่ยนรูปแบบเลขที่หรือ prefix จะมีผลกับเอกสารใหม่ทั้งหมดทันที — เอกสารเดิมไม่ถูกแก้ไข ต้องการบันทึกหรือไม่?"
        confirmLabel="บันทึก"
        cancelLabel="ยกเลิก"
        loading={saveMutation.isPending}
        onConfirm={() => saveMutation.mutate()}
      />
    </div>
  );
}

interface DocConfigRowProps {
  docType: string;
  label: string;
  state: RowState;
  format: string;
  resetCycle: string;
  onPrefixChange: (docType: string, value: string) => void;
  // Re-renders the preview whenever any row's prefix changes so a single
  // table row refetches when only its own state moves. React Query's key
  // already does the work; this hash is a safety net for the docType-scoped
  // cache, not a true dep.
  hashKey: string;
}

function DocConfigRow({
  docType,
  label,
  state,
  format,
  resetCycle,
  onPrefixChange,
  hashKey: _hashKey,
}: DocConfigRowProps) {
  // Only fetch preview when prefix is valid — otherwise show error inline.
  const enabled = !state.error && PREFIX_REGEX.test(state.prefix);
  const { data, isFetching } = useQuery<{
    sample: string;
    format: string;
    resetCycle: string;
    prefix: string;
  }>({
    queryKey: ['doc-config-preview', docType, state.prefix, format, resetCycle],
    queryFn: async () => {
      const params = new URLSearchParams({
        docType,
        format,
        prefix: state.prefix,
        resetCycle,
      });
      return (await api.get(`/settings/doc-config/preview?${params.toString()}`)).data;
    },
    enabled,
    // Cache short — preview should feel live but doesn't need to refire on focus.
    staleTime: 30_000,
  });

  return (
    <TableRow>
      <TableCell className="font-medium text-foreground">{label}</TableCell>
      <TableCell>
        <Input
          aria-label={`prefix สำหรับ ${label}`}
          value={state.prefix}
          maxLength={4}
          onChange={(e) => onPrefixChange(docType, e.target.value)}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? `${docType}-error` : undefined}
        />
        {state.error && (
          <p
            id={`${docType}-error`}
            className="text-xs text-destructive mt-1 leading-snug"
          >
            {state.error}
          </p>
        )}
      </TableCell>
      <TableCell>
        {state.error ? (
          <span className="text-sm text-muted-foreground">—</span>
        ) : isFetching ? (
          <span className="text-sm text-muted-foreground">กำลังคำนวณ...</span>
        ) : (
          <code className="text-sm font-mono text-foreground">
            {data?.sample ?? '—'}
          </code>
        )}
      </TableCell>
    </TableRow>
  );
}
