import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import api, { getErrorMessage } from '@/lib/api';
import { EditField, StatCard, type ConfigItem, type ConfigGroupItem } from './shared';

/**
 * ค่าปรับ & เงื่อนไขผ่อน — self-contained settings card (registry `inline` item,
 * rendered as `<C />` with no props by CategoryPage). Owns its own GET/PATCH
 * `/settings` round-trip, mirroring TestModeToggle.
 *
 * Backing keys map 1:1 onto the SystemConfig keys consumed by the API
 * `resolveLateFee` / `loadLateFeeConfig` (apps/api/src/utils/late-fee.util.ts).
 * `late_fee_mode` switches which branch is live:
 *   PER_DAY → min(days × per_day_rate, max_amount, cap_pct% × installmentGross)
 *   BRACKET → flat tier1 (1..min-1 days) / tier2 (>= min days)
 * Defaults below mirror BUSINESS_RULES in apps/api/src/utils/config.util.ts so
 * the form reflects what the backend actually uses when a key is not yet stored
 * (e.g. a fresh DB with no per-day rows).
 */

type Mode = 'BRACKET' | 'PER_DAY';

// Mirrors BUSINESS_RULES.* in apps/api/src/utils/config.util.ts (keep in sync)
// so the form reflects what the backend actually uses when a key is not yet stored.
const DEFAULTS: Record<string, string> = {
  late_fee_mode: 'PER_DAY',
  late_fee_tier1_amount: '50',
  late_fee_tier2_amount: '100',
  late_fee_tier2_min_days: '3',
  late_fee_per_day_rate: '20',
  late_fee_max_amount: '500',
  late_fee_cap_pct: '5',
  min_installment_months: '6',
  max_installment_months: '12',
  overdue_days_threshold: '7',
};

// These flow through loadLateFeeConfig, which reads a stored '' as Number('')=0
// (NOT the default) — so a blank must never be persisted for them. Guarded both
// in validate() below and server-side in settings-write.service.ts.
const LATE_FEE_NUMERIC = new Set([
  'late_fee_per_day_rate',
  'late_fee_max_amount',
  'late_fee_cap_pct',
  'late_fee_tier1_amount',
  'late_fee_tier2_amount',
  'late_fee_tier2_min_days',
]);

const PER_DAY_FIELDS: ConfigGroupItem[] = [
  { key: 'late_fee_per_day_rate', label: 'ค่าปรับต่อวัน (บาท/วัน)', shortLabel: 'ค่าปรับ/วัน', suffix: ' บาท/วัน', type: 'number', step: '1', desc: 'คิดค่าปรับ = ฿/วัน × จำนวนวันที่ค้าง (ก่อนเพดาน)' },
  { key: 'late_fee_max_amount', label: 'เพดานค่าปรับสูงสุด (บาท)', shortLabel: 'เพดาน (บาท)', suffix: ' บาท', type: 'number', step: '1', desc: 'ค่าปรับต่องวดไม่เกินจำนวนนี้' },
  { key: 'late_fee_cap_pct', label: 'เพดาน % ของค่างวด', shortLabel: 'เพดาน %', suffix: ' %', type: 'number', step: '0.1', desc: 'ค่าปรับต่องวดไม่เกิน x% ของค่างวด (รวม VAT)' },
];

const BRACKET_FIELDS: ConfigGroupItem[] = [
  { key: 'late_fee_tier1_amount', label: 'ค่าปรับ tier1 (บาท) — ช้า 1 ถึง (วันเริ่ม tier2 − 1) วัน', shortLabel: 'ค่าปรับ tier1', suffix: ' บาท', type: 'number', step: '1', desc: 'ค่าปรับคงที่เมื่อช้าไม่ถึงขั้นที่ 2' },
  { key: 'late_fee_tier2_amount', label: 'ค่าปรับ tier2 (บาท) — ตั้งแต่วันเริ่ม tier2 ขึ้นไป', shortLabel: 'ค่าปรับ tier2', suffix: ' บาท', type: 'number', step: '1', desc: 'ค่าปรับคงที่ (ไม่สะสมต่อวัน)' },
  { key: 'late_fee_tier2_min_days', label: 'วันเริ่มต้น tier2', shortLabel: 'tier2 เริ่มวันที่', suffix: ' วัน', type: 'number', step: '1', desc: 'ช้ากี่วันถึงเริ่มคิดค่าปรับขั้นที่ 2' },
];

// NOTE: `early_payoff_discount` is intentionally NOT here — it is a dead
// SystemConfig key (no backend reader; early-payoff math uses its own input),
// so surfacing it as an editable control would mislead the owner into thinking
// it changes behavior. Kept out until it is actually wired.
const TERMS_FIELDS: ConfigGroupItem[] = [
  { key: 'min_installment_months', label: 'จำนวนงวดขั้นต่ำ (เดือน)', shortLabel: 'งวดขั้นต่ำ', suffix: ' เดือน', type: 'number', step: '1', desc: 'จำนวนงวดต่ำสุดที่เลือกได้' },
  { key: 'max_installment_months', label: 'จำนวนงวดสูงสุด (เดือน)', shortLabel: 'งวดสูงสุด', suffix: ' เดือน', type: 'number', step: '1', desc: 'จำนวนงวดสูงสุดที่เลือกได้' },
];

const COLLECTIONS_FIELDS: ConfigGroupItem[] = [
  { key: 'overdue_days_threshold', label: 'จำนวนวันก่อนเปลี่ยนสถานะ OVERDUE', shortLabel: 'เกณฑ์ OVERDUE', suffix: ' วัน', type: 'number', step: '1', desc: 'ค้างกี่วันถึงเปลี่ยนสถานะเป็น OVERDUE' },
];

const ALL_KEYS = [
  'late_fee_mode',
  ...PER_DAY_FIELDS.map((f) => f.key),
  ...BRACKET_FIELDS.map((f) => f.key),
  ...TERMS_FIELDS.map((f) => f.key),
  ...COLLECTIONS_FIELDS.map((f) => f.key),
];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Client-side mirror of resolveLateFee — estimate only (display), not authoritative. */
function estimateLateFee(mode: Mode, v: Record<string, string>, days: number, gross: number): number {
  const d = Math.max(0, Math.floor(days));
  if (mode === 'PER_DAY') {
    if (d < 1) return 0;
    const byDay = Number(v.late_fee_per_day_rate || 0) * d;
    const byMax = Number(v.late_fee_max_amount || 0);
    const byPct = round2((Number(v.late_fee_cap_pct || 0) / 100) * gross);
    return Math.min(byDay, byMax, byPct);
  }
  if (d <= 0) return 0;
  return d >= Number(v.late_fee_tier2_min_days || 0)
    ? Number(v.late_fee_tier2_amount || 0)
    : Number(v.late_fee_tier1_amount || 0);
}

// The ACTIVE mode's fee fields must carry a concrete number — an empty value
// would persist as '' and resolve to 0 downstream (see LATE_FEE_NUMERIC note).
// Months go through config.util getValue which falls back safely on '', so they
// may stay blank; we only guard NaN + the min<max relationship.
function validate(v: Record<string, string>): string | null {
  const mode = v.late_fee_mode;
  if (mode !== 'BRACKET' && mode !== 'PER_DAY') return 'โหมดค่าปรับต้องเป็น BRACKET หรือ PER_DAY';
  const num = (k: string) => Number(v[k]);
  const reqNonNeg = (k: string) => v[k] !== '' && Number.isFinite(num(k)) && num(k) >= 0;
  if (mode === 'PER_DAY') {
    if (!reqNonNeg('late_fee_per_day_rate')) return 'ค่าปรับต่อวันต้องเป็นตัวเลข ≥ 0';
    if (!reqNonNeg('late_fee_max_amount')) return 'เพดานค่าปรับต้องเป็นตัวเลข ≥ 0';
    if (!reqNonNeg('late_fee_cap_pct') || num('late_fee_cap_pct') > 100)
      return 'เพดาน % ของค่างวดต้องเป็นตัวเลข 0–100';
  } else {
    if (!reqNonNeg('late_fee_tier1_amount')) return 'ค่าปรับ tier1 ต้องเป็นตัวเลข ≥ 0';
    if (!reqNonNeg('late_fee_tier2_amount')) return 'ค่าปรับ tier2 ต้องเป็นตัวเลข ≥ 0';
    if (!Number.isFinite(num('late_fee_tier2_min_days')) || num('late_fee_tier2_min_days') < 1)
      return 'วันเริ่ม tier2 ต้องเป็นจำนวน ≥ 1';
  }
  if (v.min_installment_months !== '' && v.max_installment_months !== '') {
    const minM = num('min_installment_months');
    const maxM = num('max_installment_months');
    if (!Number.isFinite(minM) || !Number.isFinite(maxM)) return 'จำนวนงวดต้องเป็นตัวเลข';
    if (minM >= maxM) return 'งวดขั้นต่ำต้องน้อยกว่างวดสูงสุด';
  }
  return null;
}

export function LateFeeSettingsCard() {
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [previewDays, setPreviewDays] = useState('10');
  const [previewGross, setPreviewGross] = useState('1515.83');

  const { data: configs = [], isLoading, isError, refetch } = useQuery<ConfigItem[]>({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });

  const serverValues = useMemo(() => {
    const map: Record<string, string> = {};
    for (const k of ALL_KEYS) map[k] = DEFAULTS[k] ?? '';
    for (const c of configs) if (ALL_KEYS.includes(c.key)) map[c.key] = c.value;
    return map;
  }, [configs]);

  const saveMutation = useMutation({
    mutationFn: (items: { key: string; value: string }[]) => api.patch('/settings', { items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('บันทึกสำเร็จ');
      setEditing(false);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const current = editing ? draft : serverValues;
  const mode = (current.late_fee_mode === 'BRACKET' ? 'BRACKET' : 'PER_DAY') as Mode;
  const activeFeeFields = mode === 'PER_DAY' ? PER_DAY_FIELDS : BRACKET_FIELDS;

  const startEdit = () => {
    if (!isOwner) return;
    // Normalise a legacy/corrupt stored mode so the draft matches what the
    // <select> displays — otherwise save would block on a value the UI can't show.
    setDraft({
      ...serverValues,
      late_fee_mode: serverValues.late_fee_mode === 'BRACKET' ? 'BRACKET' : 'PER_DAY',
    });
    setEditing(true);
  };

  const setField = (key: string, val: string) =>
    setDraft((prev) => ({ ...prev, [key]: val }));

  const handleSave = () => {
    const err = validate(draft);
    if (err) {
      toast.error(err);
      return;
    }
    const items = ALL_KEYS.filter((k) => draft[k] !== serverValues[k])
      // Defense-in-depth: never persist a blank late-fee number (would resolve
      // to 0). validate() already blocks this, but guard the payload too.
      .filter((k) => !(LATE_FEE_NUMERIC.has(k) && (draft[k] ?? '').trim() === ''))
      .map((k) => ({ key: k, value: draft[k] ?? '' }));
    if (items.length === 0) {
      setEditing(false);
      return;
    }
    saveMutation.mutate(items);
  };

  const previewResult = estimateLateFee(
    mode,
    current,
    Number(previewDays) || 0,
    Number(previewGross) || 0,
  );

  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
      <div className="flex">
        <div className="w-1 shrink-0 bg-primary" />
        <div className="p-5 flex-1">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-bold text-foreground leading-snug">ค่าปรับ &amp; เงื่อนไขผ่อน</h3>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                กำหนดค่าปรับล่าช้า จำนวนงวด และเกณฑ์ติดตามหนี้สำหรับสัญญาผ่อนชำระ
              </p>
            </div>
            {!editing && isOwner && !isLoading && !isError && (
              <button onClick={startEdit} className="text-xs text-primary hover:underline px-2 py-1 shrink-0">
                แก้ไข
              </button>
            )}
          </div>

          {!isOwner && (
            <p className="text-xs text-muted-foreground mt-3 leading-snug">เฉพาะ OWNER เท่านั้นที่แก้ไขได้</p>
          )}

          {isLoading ? (
            <p className="text-sm text-muted-foreground mt-4">กำลังโหลด...</p>
          ) : isError ? (
            <div className="mt-4 flex items-center gap-3">
              <p className="text-sm text-destructive">โหลดการตั้งค่าไม่สำเร็จ</p>
              <button onClick={() => refetch()} className="text-xs text-primary hover:underline">
                ลองใหม่
              </button>
            </div>
          ) : !editing ? (
            <ViewMode values={serverValues} mode={mode} activeFeeFields={activeFeeFields} />
          ) : (
            <div className="mt-4 flex flex-col gap-5">
              {/* Section 1 — late fee mode + fields */}
              <section className="flex flex-col gap-4">
                <SectionTitle>ค่าปรับล่าช้า</SectionTitle>
                <div>
                  <div className="flex items-center gap-4">
                    <label htmlFor="late_fee_mode" className="flex-1 text-sm text-foreground">
                      โหมดคิดค่าปรับ
                    </label>
                    <div className="w-48">
                      <select
                        id="late_fee_mode"
                        value={mode}
                        onChange={(e) => setField('late_fee_mode', e.target.value)}
                        className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
                      >
                        <option value="PER_DAY">ต่อวัน (PER_DAY)</option>
                        <option value="BRACKET">ขั้นบันได (BRACKET)</option>
                      </select>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground/70 mt-1 ml-0.5 leading-snug">
                    {mode === 'PER_DAY'
                      ? 'คิด ฿/วัน × จำนวนวันที่ค้าง แล้วจำกัดด้วยเพดานบาท และเพดาน % ของค่างวด (อันที่น้อยสุดชนะ)'
                      : 'คิดค่าปรับคงที่เป็นขั้น: tier1 เมื่อช้าไม่ถึงเกณฑ์, tier2 เมื่อช้าตั้งแต่วันที่กำหนด'}
                  </p>
                </div>
                {activeFeeFields.map((item) => (
                  <EditField key={item.key} item={item} value={draft[item.key] ?? ''} onChange={(val) => setField(item.key, val)} />
                ))}
                <FeePreview
                  days={previewDays}
                  gross={previewGross}
                  onDays={setPreviewDays}
                  onGross={setPreviewGross}
                  result={previewResult}
                  mode={mode}
                />
              </section>

              {/* Section 2 — installment terms */}
              <section className="flex flex-col gap-4 border-t border-border/50 pt-4">
                <SectionTitle>เงื่อนไขผ่อน</SectionTitle>
                {TERMS_FIELDS.map((item) => (
                  <EditField key={item.key} item={item} value={draft[item.key] ?? ''} onChange={(val) => setField(item.key, val)} />
                ))}
              </section>

              {/* Section 3 — collections */}
              <section className="flex flex-col gap-4 border-t border-border/50 pt-4">
                <SectionTitle>ติดตามหนี้</SectionTitle>
                {COLLECTIONS_FIELDS.map((item) => (
                  <EditField key={item.key} item={item} value={draft[item.key] ?? ''} onChange={(val) => setField(item.key, val)} />
                ))}
              </section>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
                >
                  {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground leading-snug">{children}</h4>;
}

function ViewMode({
  values,
  mode,
  activeFeeFields,
}: {
  values: Record<string, string>;
  mode: Mode;
  activeFeeFields: ConfigGroupItem[];
}) {
  return (
    <div className="mt-4 flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <SectionTitle>ค่าปรับล่าช้า</SectionTitle>
          <span className="text-xs font-medium rounded-md bg-primary/10 text-primary px-2 py-0.5">
            {mode === 'PER_DAY' ? 'โหมด: ต่อวัน' : 'โหมด: ขั้นบันได'}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {activeFeeFields.map((item) => (
            <StatCard key={item.key} label={item.shortLabel} value={values[item.key] || ''} suffix={item.suffix} desc={item.desc} />
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-2 border-t border-border/50 pt-4">
        <SectionTitle>เงื่อนไขผ่อน</SectionTitle>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {TERMS_FIELDS.map((item) => (
            <StatCard key={item.key} label={item.shortLabel} value={values[item.key] || ''} suffix={item.suffix} desc={item.desc} />
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-2 border-t border-border/50 pt-4">
        <SectionTitle>ติดตามหนี้</SectionTitle>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {COLLECTIONS_FIELDS.map((item) => (
            <StatCard key={item.key} label={item.shortLabel} value={values[item.key] || ''} suffix={item.suffix} desc={item.desc} />
          ))}
        </div>
      </section>
    </div>
  );
}

function FeePreview({
  days,
  gross,
  onDays,
  onGross,
  result,
  mode,
}: {
  days: string;
  gross: string;
  onDays: (v: string) => void;
  onGross: (v: string) => void;
  result: number;
  mode: Mode;
}) {
  return (
    <div className="rounded-lg bg-muted p-3">
      <div className="text-xs font-semibold text-foreground leading-snug">ทดลองคำนวณ (ประมาณการ)</div>
      <div className="flex flex-wrap items-end gap-3 mt-2">
        <label className="text-xs text-muted-foreground">
          วันที่ค้าง
          <input
            type="number"
            step="1"
            value={days}
            onChange={(e) => onDays(e.target.value)}
            className="mt-1 block w-24 px-2 py-1 border border-input rounded-md text-sm text-right bg-background text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 outline-hidden"
          />
        </label>
        {mode === 'PER_DAY' && (
          <label className="text-xs text-muted-foreground">
            ค่างวด (รวม VAT)
            <input
              type="number"
              step="0.01"
              value={gross}
              onChange={(e) => onGross(e.target.value)}
              className="mt-1 block w-32 px-2 py-1 border border-input rounded-md text-sm text-right bg-background text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 outline-hidden"
            />
          </label>
        )}
        <div className="text-sm">
          <span className="text-muted-foreground">ค่าปรับ ≈ </span>
          <span className="font-bold text-foreground">{result.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground/70 mt-2 leading-snug">
        ประมาณการฝั่งหน้าจอ — ยอดจริงคิดจากระบบหลังบ้าน (resolveLateFee)
      </p>
    </div>
  );
}
