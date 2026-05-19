/**
 * P4-SP3 — DocTypeConfigForm
 *
 * Reusable per-doc-type config form rendered inside each tab of DocumentConfigPage.
 * Reads/writes SystemConfig key `doc_config_<typeKey>` (or `doc_number_format`,
 * `doc_prefix_per_type`, `doc_number_reset_cycle` for the 'numbering' tab via
 * the parent page).
 *
 * For the 8 doc-type tabs, the persisted value is a JSON object:
 *   {
 *     prefix: string (2-4 uppercase letters),
 *     pattern: 'PREFIX-YYYYMMDD-NNNN' | 'PREFIX-YYMM-NNNN' | 'PREFIX-YYYY-NNNN',
 *     resetCycle: 'daily' | 'monthly' | 'yearly' | 'never',
 *     startNumber: number,
 *     footerNote: string,
 *     requiresApproval: boolean,
 *     attachmentRequired: boolean,
 *   }
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import api, { getErrorMessage } from '@/lib/api';

const PATTERN_OPTIONS = [
  { value: 'PREFIX-YYYYMMDD-NNNN', label: 'PREFIX-YYYYMMDD-NNNN (รายวัน, 4 หลัก)' },
  { value: 'PREFIX-YYMM-NNNN', label: 'PREFIX-YYMM-NNNN (YY+เดือน, 4 หลัก)' },
  { value: 'PREFIX-YYYY-NNNN', label: 'PREFIX-YYYY-NNNN (รายปี, 4 หลัก)' },
] as const;

const RESET_CYCLE_OPTIONS = [
  { value: 'daily', label: 'รายวัน' },
  { value: 'monthly', label: 'รายเดือน' },
  { value: 'yearly', label: 'รายปี' },
  { value: 'never', label: 'ไม่รีเซ็ต' },
] as const;

const PREFIX_REGEX = /^[A-Z]{2,4}$/;

interface DocTypeConfig {
  prefix: string;
  pattern: string;
  resetCycle: string;
  startNumber: number;
  footerNote: string;
  requiresApproval: boolean;
  attachmentRequired: boolean;
}

const DEFAULT_CONFIG: DocTypeConfig = {
  prefix: '',
  pattern: 'PREFIX-YYYYMMDD-NNNN',
  resetCycle: 'monthly',
  startNumber: 1,
  footerNote: '',
  requiresApproval: false,
  attachmentRequired: false,
};

type ConfigKey = keyof DocTypeConfig;

interface DocTypeConfigFormProps {
  typeKey: string;
  label: string;
  category: 'general' | 'revenue' | 'expense';
}

export default function DocTypeConfigForm({ typeKey, label }: DocTypeConfigFormProps) {
  const queryClient = useQueryClient();

  // For 'numbering' tab we delegate to the parent DocumentConfigPage
  // (the existing P2-SP2 form). This component only handles the 8 doc-type tabs.
  const configKey = `doc_config_${typeKey}`;

  const [form, setForm] = useState<DocTypeConfig>(DEFAULT_CONFIG);
  const [prefixError, setPrefixError] = useState<string | null>(null);
  const [initialised, setInitialised] = useState(false);

  const { data: rawValue, isLoading } = useQuery<string | null>({
    queryKey: ['system-config', configKey],
    queryFn: async () => {
      const res = await api.get('/settings');
      const items: { key: string; value: string }[] = res.data;
      return items.find((i) => i.key === configKey)?.value ?? null;
    },
    staleTime: 30_000,
  });

  // Hydrate form from persisted JSON exactly once per key
  useEffect(() => {
    if (initialised) return;
    if (rawValue === undefined) return; // still loading
    if (rawValue !== null) {
      try {
        const parsed = JSON.parse(rawValue) as Partial<DocTypeConfig>;
        setForm({
          prefix: typeof parsed.prefix === 'string' ? parsed.prefix : DEFAULT_CONFIG.prefix,
          pattern: typeof parsed.pattern === 'string' ? parsed.pattern : DEFAULT_CONFIG.pattern,
          resetCycle:
            typeof parsed.resetCycle === 'string' ? parsed.resetCycle : DEFAULT_CONFIG.resetCycle,
          startNumber:
            typeof parsed.startNumber === 'number'
              ? parsed.startNumber
              : DEFAULT_CONFIG.startNumber,
          footerNote:
            typeof parsed.footerNote === 'string' ? parsed.footerNote : DEFAULT_CONFIG.footerNote,
          requiresApproval:
            typeof parsed.requiresApproval === 'boolean'
              ? parsed.requiresApproval
              : DEFAULT_CONFIG.requiresApproval,
          attachmentRequired:
            typeof parsed.attachmentRequired === 'boolean'
              ? parsed.attachmentRequired
              : DEFAULT_CONFIG.attachmentRequired,
        });
      } catch {
        // malformed — keep defaults
      }
    }
    setInitialised(true);
  }, [rawValue, initialised]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const items = [{ key: configKey, value: JSON.stringify(form) }];
      return api.patch('/settings', { items });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-config', configKey] });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success(`บันทึกการตั้งค่า "${label}" สำเร็จ`);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  function setField<K extends ConfigKey>(field: K, value: DocTypeConfig[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (field === 'prefix') {
      const v = value as string;
      const upper = v.toUpperCase();
      setPrefixError(
        PREFIX_REGEX.test(upper) ? null : 'ต้องเป็นตัวอักษรพิมพ์ใหญ่ A-Z จำนวน 2-4 ตัว',
      );
      setForm((prev) => ({ ...prev, prefix: upper }));
    }
  }

  const canSave =
    !prefixError && initialised && !isLoading && !saveMutation.isPending;

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-base">{label}</CardTitle>
        <CardDescription>ตั้งค่ารูปแบบเลขที่และตัวเลือกสำหรับ{label}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4">กำลังโหลดข้อมูล...</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Prefix */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${typeKey}-prefix`}>Prefix (2-4 ตัวอักษร)</Label>
              <Input
                id={`${typeKey}-prefix`}
                aria-label={`prefix สำหรับ ${label}`}
                value={form.prefix}
                maxLength={4}
                onChange={(e) => setField('prefix', e.target.value)}
                aria-invalid={prefixError ? true : undefined}
                aria-describedby={prefixError ? `${typeKey}-prefix-error` : undefined}
                placeholder="เช่น EX, RT, CT"
              />
              {prefixError && (
                <p
                  id={`${typeKey}-prefix-error`}
                  className="text-xs text-destructive leading-snug"
                >
                  {prefixError}
                </p>
              )}
            </div>

            {/* Pattern */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${typeKey}-pattern`}>รูปแบบเลขที่</Label>
              <Select
                value={form.pattern}
                onValueChange={(v) => setField('pattern', v)}
              >
                <SelectTrigger id={`${typeKey}-pattern`} aria-label={`รูปแบบเลขที่สำหรับ ${label}`}>
                  <SelectValue placeholder="เลือกรูปแบบ" />
                </SelectTrigger>
                <SelectContent>
                  {PATTERN_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Reset Cycle */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${typeKey}-reset-cycle`}>รอบการรีเซ็ตเลขที่</Label>
              <Select
                value={form.resetCycle}
                onValueChange={(v) => setField('resetCycle', v)}
              >
                <SelectTrigger
                  id={`${typeKey}-reset-cycle`}
                  aria-label={`รอบการรีเซ็ตสำหรับ ${label}`}
                >
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

            {/* Start Number */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${typeKey}-start-number`}>เลขที่เริ่มต้น</Label>
              <Input
                id={`${typeKey}-start-number`}
                aria-label={`เลขที่เริ่มต้นสำหรับ ${label}`}
                type="number"
                min={1}
                value={form.startNumber}
                onChange={(e) => setField('startNumber', Math.max(1, parseInt(e.target.value) || 1))}
              />
            </div>

            {/* Footer Note — full width */}
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor={`${typeKey}-footer-note`}>หมายเหตุท้ายเอกสาร</Label>
              <Textarea
                id={`${typeKey}-footer-note`}
                aria-label={`หมายเหตุท้ายเอกสารสำหรับ ${label}`}
                value={form.footerNote}
                onChange={(e) => setField('footerNote', e.target.value)}
                placeholder="ข้อความที่แสดงท้ายเอกสาร (ถ้ามี)"
                rows={2}
                maxLength={500}
              />
            </div>

            {/* Toggles */}
            <div className="flex items-center justify-between rounded-lg border border-border p-3 sm:col-span-2">
              <div className="space-y-0.5">
                <Label htmlFor={`${typeKey}-requires-approval`} className="text-sm font-medium">
                  ต้องการอนุมัติก่อนสร้าง
                </Label>
                <p className="text-xs text-muted-foreground leading-snug">
                  เอกสารจะอยู่ในสถานะ PENDING_APPROVAL จนกว่าผู้มีสิทธิ์จะอนุมัติ
                </p>
              </div>
              <Switch
                id={`${typeKey}-requires-approval`}
                checked={form.requiresApproval}
                onCheckedChange={(v) => setField('requiresApproval', v)}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3 sm:col-span-2">
              <div className="space-y-0.5">
                <Label
                  htmlFor={`${typeKey}-attachment-required`}
                  className="text-sm font-medium"
                >
                  บังคับแนบไฟล์
                </Label>
                <p className="text-xs text-muted-foreground leading-snug">
                  ผู้ใช้ต้องแนบไฟล์อย่างน้อย 1 ไฟล์ก่อนบันทึก
                </p>
              </div>
              <Switch
                id={`${typeKey}-attachment-required`}
                checked={form.attachmentRequired}
                onCheckedChange={(v) => setField('attachmentRequired', v)}
              />
            </div>
          </div>
        )}

        {/* Save button */}
        <div className="flex justify-end mt-4">
          <Button
            variant="primary"
            disabled={!canSave}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
