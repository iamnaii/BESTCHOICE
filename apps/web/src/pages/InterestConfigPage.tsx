import { NumberInput } from '@/components/ui/NumberInput';
import { formLabelClass } from '@/components/ui/form-styles';
import { ReadOnlyField } from '@/components/ui/readonly-field';
import { useId as useUiFieldId, useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import QueryBoundary from '@/components/QueryBoundary';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import Decimal from 'decimal.js';
import { calcBcInstallment } from '@installment/shared';
import RateRowsEditor from './interest-config/RateRowsEditor';
import {
  hasUsableRateRows,
  previewBcConfig,
  previewMonths,
  validateRateRows,
  type RateRowForm,
} from './interest-config/rate-rows';
import { getStatusBadgeProps, enabledStatusMap } from '@/lib/status-badges';
import { Link } from 'react-router';
import { installmentVat, type CompanyVatRow } from '@/utils/installmentVat';

interface ConfigItem {
  id: string;
  key: string;
  value: string;
  label: string | null;
}

interface InterestConfig {
  id: string;
  name: string;
  productCategories: string[];
  interestRate: string;
  minDownPaymentPct: string;
  storeCommissionPct: string;
  vatPct: string;
  minInstallmentMonths: number;
  maxInstallmentMonths: number;
  isActive: boolean;
  createdAt: string;
  rates?: { months: number; ratePct: string }[];
}

const PREVIEW_PRICE = 12900;
const money2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

const CATEGORIES = [
  { value: 'PHONE_NEW', label: 'มือถือมือ 1' },
  { value: 'PHONE_USED', label: 'มือถือมือ 2' },
  { value: 'TABLET', label: 'แท็บเล็ต' },
  { value: 'ACCESSORY', label: 'อุปกรณ์เสริม' },
];

const defaultForm = {
  name: '',
  productCategories: [] as string[],
  interestRate: 8.0,
  minDownPaymentPct: 15,
  storeCommissionPct: 10,
  minInstallmentMonths: 6,
  maxInstallmentMonths: 12,
  rates: [] as RateRowForm[],
};

type FormErrors = Partial<Record<keyof typeof defaultForm, string>>;

function validateForm(form: typeof defaultForm): FormErrors {
  const errors: FormErrors = {};
  if (!form.name.trim()) errors.name = 'กรุณากรอกชื่อ';
  if (form.productCategories.length === 0) errors.productCategories = 'กรุณาเลือกประเภทสินค้าอย่างน้อย 1 รายการ';
  // มีตารางรายงวดที่ใช้ได้ = สัญญาใช้แถวทั้งหมด ดอกเบี้ยต่อเดือนเว้นเป็น 0 ได้ (ช่องว่าง = 0)
  const termRatesUsable = hasUsableRateRows(form.rates, form.minInstallmentMonths, form.maxInstallmentMonths);
  if (!(form.interestRate >= 0)) errors.interestRate = 'ดอกเบี้ยต่อเดือนต้องไม่ติดลบ';
  else if (form.interestRate === 0 && !termRatesUsable) {
    errors.interestRate = 'ดอกเบี้ยต่อเดือนต้องมากกว่า 0 — หรือใส่ตารางดอกเบี้ยรายงวดอย่างน้อย 1 แถว';
  }
  if (form.minDownPaymentPct <= 0 || form.minDownPaymentPct > 100) errors.minDownPaymentPct = 'ดาวน์ขั้นต่ำต้องอยู่ระหว่าง 0-100%';
  if (form.storeCommissionPct < 0 || form.storeCommissionPct > 100) errors.storeCommissionPct = 'ค่าคอมต้องอยู่ระหว่าง 0-100%';
  if (form.minInstallmentMonths < 1) errors.minInstallmentMonths = 'งวดต่ำสุดต้อง >= 1';
  if (form.maxInstallmentMonths < 1) errors.maxInstallmentMonths = 'งวดสูงสุดต้อง >= 1';
  if (form.minInstallmentMonths >= form.maxInstallmentMonths) {
    errors.minInstallmentMonths = 'งวดต่ำสุดต้องน้อยกว่างวดสูงสุด';
    errors.maxInstallmentMonths = 'งวดสูงสุดต้องมากกว่างวดต่ำสุด';
  }
  const rateError = validateRateRows(form.rates, form.minInstallmentMonths, form.maxInstallmentMonths);
  if (rateError) errors.rates = rateError;
  return errors;
}

/**
 * Owner decision #22 (2026-10-31): this page no longer edits any VAT — the installment VAT is the FINANCE company's
 * (read-only here, edited at ตั้งค่า › บริษัท & สาขา › บริษัทในเครือ). `VAT_RATE` is still hydrated below (legacy
 * decimal form → percent) only as the display fallback when no FINANCE rate exists; it is edited at
 * ตั้งค่า › บัญชี & ภาษี › VAT.
 *
 * Other keys (`interest_rate`, `min_down_payment_pct`, `store_commission_pct`)
 * remain in decimal form — those don't have a canonical-key counterpart yet.
 */
const defaultKeys = [
  { key: 'interest_rate', label: "อัตราดอกเบี้ยต่อเดือน (แบบคงที่)", step: '0.01' },
  { key: 'min_down_payment_pct', label: 'เงินดาวน์ขั้นต่ำ (%)', step: '0.01' },
  { key: 'store_commission_pct', label: 'ค่าคอมหน้าร้าน (เช่น 0.10 = 10%)', step: '0.01' },
  // VAT_RATE ไม่อยู่ในตัวแก้ของหน้านี้แล้ว (คำตัดสินเจ้าของ #22): VAT ของการผ่อนอ่านจากบริษัท FINANCE —
  // ค่า VAT_RATE ของระบบยังแก้ได้ที่ ตั้งค่า › บัญชี & ภาษี › VAT
];

/**
 * Mirror of `parseVatValue` from `apps/api/src/utils/vat-rate.util.ts` —
 * converts a raw SystemConfig VAT value into the percent-form string used
 * by this editor. `"7"` stays "7", `"0.07"` becomes "7", malformed → "7".
 */
function toVatPercentString(raw: string | null | undefined): string {
  if (raw == null || String(raw).trim() === '') return '7';
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) return '7';
  // Values < 1 are decimal form ("0.07") → multiply by 100.
  // Values >= 1 are percent form ("7") → unchanged.
  return String(n < 1 ? n * 100 : n);
}

/** ที่มาของ VAT + ที่แก้ (เมนูที่มีจริง: settings-registry — บริษัทในเครือ / VAT · OWNER ทั้งคู่ เหมือนหน้านี้) */
function VatSourceHint({ source }: { source: 'FINANCE' | 'SYSTEM' }) {
  return source === 'FINANCE' ? (
    <p className="text-xs text-muted-foreground mt-1 leading-snug">
      ตามบริษัท FINANCE · แก้ที่{' '}
      <Link to="/settings/company/entities" className="text-primary hover:underline">
        ตั้งค่า › บริษัท &amp; สาขา › บริษัทในเครือ
      </Link>
    </p>
  ) : (
    <p className="text-xs text-muted-foreground mt-1 leading-snug">
      ยังไม่ได้ตั้ง VAT ของบริษัท FINANCE จึงใช้ค่า VAT ของระบบ · ตั้งที่{' '}
      <Link to="/settings/company/entities" className="text-primary hover:underline">
        ตั้งค่า › บริษัท &amp; สาขา › บริษัทในเครือ
      </Link>
    </p>
  );
}

export default function InterestConfigPage() {
  const uiFieldId = useUiFieldId();
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState(false);

  // Default interest config (system-wide fallback)
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [defaultsChanged, setDefaultsChanged] = useState(false);
  const defaultsChangedRef = useRef(false);
  const [editingDefaults, setEditingDefaults] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string; action: () => void }>({ open: false, message: '', action: () => {} });

  const { data: systemConfigs = [] } = useQuery<ConfigItem[]>({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });

  useEffect(() => {
    if (systemConfigs.length > 0 && !defaultsChangedRef.current) {
      const map: Record<string, string> = {};
      systemConfigs.forEach((c) => { map[c.key] = c.value; });
      // D1.1.3.1 follow-up — VAT_RATE editor stores percentage form ("7"),
      // but legacy `vat_pct` rows may still contain decimal form ("0.07").
      // If canonical key absent + legacy present, hydrate the editor with
      // the canonical key's value derived from the legacy form so the
      // user sees the expected percent in the input.
      if (!map['VAT_RATE'] && (map['vat_pct'] || map['vat_rate'])) {
        map['VAT_RATE'] = toVatPercentString(map['vat_pct'] || map['vat_rate']);
      }
      setDefaults(map);
    }
  }, [systemConfigs]);

  const saveDefaultsMutation = useMutation({
    mutationFn: async (items: { key: string; value: string }[]) =>
      api.patch('/settings', { items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success("บันทึกค่าเริ่มต้นสำเร็จ");
      setDefaultsChanged(false);
      defaultsChangedRef.current = false;
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const handleDefaultChange = (key: string, value: string) => {
    setDefaults((prev) => ({ ...prev, [key]: value }));
    setDefaultsChanged(true);
    defaultsChangedRef.current = true;
  };

  const handleSaveDefaults = () => {
    const items = defaultKeys.map(({ key }) => ({ key, value: defaults[key] || '' }));
    saveDefaultsMutation.mutate(items);
  };

  // #22: VAT ของตั้งค่าดอกเบี้ย = บริษัท FINANCE (แสดงอย่างเดียว · แก้ที่ บริษัทในเครือ) — key เดียวกับหน้าบริษัทในเครือ
  const { data: companies } = useQuery<CompanyVatRow[]>({
    queryKey: ['companies'],
    queryFn: async () => (await api.get('/companies')).data,
  });
  const vat = installmentVat(companies, defaults['VAT_RATE']);

  const { data: configs = [], isLoading, isError, error, refetch } = useQuery<InterestConfig[]>({
    queryKey: ['interest-configs'],
    queryFn: async () => { const { data } = await api.get('/interest-configs'); return data; },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        productCategories: form.productCategories,
        interestRate: form.interestRate / 100,
        minDownPaymentPct: form.minDownPaymentPct / 100,
        storeCommissionPct: form.storeCommissionPct / 100,
        minInstallmentMonths: form.minInstallmentMonths,
        maxInstallmentMonths: form.maxInstallmentMonths,
        rates: form.rates.map((r) => ({ months: r.months, ratePct: Number((r.ratePct / 100).toFixed(4)) })),
      };
      if (editId) {
        const { data } = await api.put(`/interest-configs/${editId}`, payload);
        return data;
      }
      const { data } = await api.post('/interest-configs', payload);
      return data;
    },
    onSuccess: () => {
      toast.success(editId ? 'อัปเดตสำเร็จ' : 'สร้างสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['interest-configs'] });
      closeModal();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/interest-configs/${id}`); },
    onSuccess: () => {
      toast.success('ลบสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['interest-configs'] });
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'ลบไม่สำเร็จ'),
  });

  const openCreate = () => {
    setEditId(null);
    setForm(defaultForm);
    setErrors({});
    setTouched(false);
    setShowModal(true);
  };

  const openEdit = (config: InterestConfig) => {
    setEditId(config.id);
    setForm({
      name: config.name,
      productCategories: config.productCategories,
      interestRate: parseFloat(config.interestRate) * 100,
      minDownPaymentPct: parseFloat(config.minDownPaymentPct) * 100,
      storeCommissionPct: parseFloat(config.storeCommissionPct) * 100,
      minInstallmentMonths: config.minInstallmentMonths,
      maxInstallmentMonths: config.maxInstallmentMonths,
      rates: (config.rates ?? []).map((r) => ({ months: r.months, ratePct: Number((parseFloat(r.ratePct) * 100).toFixed(2)) })),
    });
    setErrors({});
    setTouched(false);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditId(null);
    setForm(defaultForm);
    setErrors({});
    setTouched(false);
  };

  const toggleCategory = (cat: string) => {
    setForm((prev) => ({
      ...prev,
      productCategories: prev.productCategories.includes(cat)
        ? prev.productCategories.filter((c) => c !== cat)
        : [...prev.productCategories, cat],
    }));
  };

  const handleSave = () => {
    setTouched(true);
    const validationErrors = validateForm(form);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;
    saveMutation.mutate();
  };

  const getCategoryLabel = (cat: string) => CATEGORIES.find((c) => c.value === cat)?.label || cat;

  // Simulation calculation for preview
  const simulateCalc = (config: InterestConfig) => {
    const rate = parseFloat(config.interestRate);
    const rows = (config.rates ?? []).map((r) => ({ months: r.months, ratePct: parseFloat(r.ratePct) * 100 }));
    const months = previewMonths(rows, config.maxInstallmentMonths);
    // ตัวเลขเดียวกับสัญญา/หน้าราคา: ดาวน์ปัดขึ้นร้อย + เครื่องคิดเลขกลาง (vatPct = VAT ของ FINANCE — #22)
    const out = calcBcInstallment({
      installmentPrice: new Decimal(PREVIEW_PRICE),
      months,
      config: previewBcConfig({
        minDownPct: parseFloat(config.minDownPaymentPct) * 100,
        commissionPct: parseFloat(config.storeCommissionPct) * 100,
        vatPct: parseFloat(config.vatPct),
        monthlyRatePct: rate * 100,
        rows,
        months,
      }),
    });
    return {
      down: out.downAmount.toNumber(),
      loan: out.financedAmount.toNumber(),
      interest: out.interestAmount.toNumber(),
      commission: out.commissionAmount.toNumber(),
      vatAmount: out.vatAmount.toNumber(),
      total: out.totalWithVat.toNumber(),
      monthly: out.monthlyPayment.toNumber(),
      months,
    };
  };

  const inputClass = 'w-full px-3 py-2 border rounded-lg text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background';
  const errorInputClass = 'w-full px-3 py-2 border border-destructive rounded-lg text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-destructive';

  return (
    <div>
      <PageHeader
        title="ตั้งค่าดอกเบี้ย"
        subtitle="กำหนดอัตราดอกเบี้ยและเงื่อนไขตามประเภทสินค้า"
        action={
          <button data-ui-control="button" onClick={openCreate} className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
            + สร้าง การตั้งค่า
          </button>
        }
      />

      {/* Default fallback config — card style */}
      <div className="rounded-xl border border-warning/30 bg-card shadow-sm p-5 mb-5 lg:mb-7.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 basis-full sm:basis-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h3 className="text-lg font-semibold text-foreground">ค่าเริ่มต้น</h3>
              <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-warning/20 text-warning-strong">ใช้เมื่อไม่มี การตั้งค่า ตามประเภท</span>
            </div>
            {!editingDefaults ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-xs text-muted-foreground">ดอกเบี้ย/เดือน</div>
                    <div className="text-lg font-bold text-primary">{defaults['interest_rate'] || '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">ดาวน์ขั้นต่ำ</div>
                    <div className="text-lg font-bold">{defaults['min_down_payment_pct'] || '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">ค่าคอมหน้าร้าน</div>
                    <div className="text-lg font-bold">{defaults['store_commission_pct'] || '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">VAT</div>
                    {/* #22 — VAT ของการผ่อนอ่านจากบริษัท FINANCE (ไม่ใช่ VAT_RATE ของระบบ เว้นแต่ไม่มีบริษัท FINANCE) */}
                    <div className="text-lg font-bold" data-testid="interest-default-vat">{vat.percentText}</div>
                    <VatSourceHint source={vat.source} />
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-3 mt-2">
                {defaultKeys.map((item) => (
                  <div key={item.key} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                    <label className="min-w-0 flex-1 text-sm text-foreground">{item.label}</label>
                    <div className="w-full sm:w-48 sm:shrink-0">
                      <NumberInput unstyled
                        step={item.step}
                        value={defaults[item.key] ?? ''}
                        onChange={(e) => handleDefaultChange(item.key, e.target.value)}
                        className="w-full px-3 py-2 border border-input rounded-lg text-sm text-right focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
                      />
                    </div>
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <button data-ui-control="button"
                    onClick={() => { handleSaveDefaults(); setEditingDefaults(false); }}
                    disabled={saveDefaultsMutation.isPending}
                    className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
                  >
                    {saveDefaultsMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
                  </button>
                  <button data-ui-control="button"
                    onClick={() => { setEditingDefaults(false); setDefaultsChanged(false); defaultsChangedRef.current = false; }}
                    className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                  >
                    ยกเลิก
                  </button>
                </div>
              </div>
            )}
          </div>
          {!editingDefaults && (
            <button onClick={() => setEditingDefaults(true)} className="inline-flex items-center text-xs text-primary hover:underline px-2 py-1 ml-4 max-lg:min-h-11 lg:min-h-8 max-lg:-my-2.25 lg:-my-0.75">แก้ไข</button>
          )}
        </div>
      </div>

      <h3 className="text-lg font-semibold text-foreground mb-4">ตามประเภทสินค้า</h3>

      <QueryBoundary
        isLoading={isLoading && configs.length === 0}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดการตั้งค่าดอกเบี้ยได้"
      >
      {configs.length === 0 ? (
        <div className="text-center py-12 rounded-xl border border-border/50 bg-card shadow-sm">
          <div className="text-muted-foreground text-sm mb-3">ยังไม่มีการตั้งค่าดอกเบี้ย</div>
          {/* hit area 44px mobile / 32px desktop; negative margins keep the empty state's height */}
          <button onClick={openCreate} className="inline-flex items-center text-sm text-primary hover:underline max-lg:min-h-11 lg:min-h-8 max-lg:-my-3 lg:-my-1.5">สร้างตั้งค่าแรก</button>
        </div>
      ) : (
        <div className="grid gap-5 lg:gap-7.5">
          {configs.map((config) => {
            const sim = simulateCalc(config);
            return (
              <div key={config.id} className={`rounded-xl border border-border/50 bg-card shadow-sm p-5 ${!config.isActive ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-lg font-semibold text-foreground">{config.name}</h3>
                      {!config.isActive && (() => { const cfg = getStatusBadgeProps('false', enabledStatusMap); return <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">{cfg.label}</Badge>; })()}
                    </div>
                    <div className="flex flex-wrap gap-1 mb-3">
                      {config.productCategories.map((cat) => (
                        <span key={cat} className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-primary/10 text-primary dark:bg-primary/15">
                          {getCategoryLabel(cat)}
                        </span>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                      <div>
                        <div className="text-xs text-muted-foreground">ดอกเบี้ย</div>
                        <div className="text-lg font-bold text-primary">
                          {config.rates && config.rates.length > 0
                            ? 'ตามตารางรายงวด'
                            : `${(parseFloat(config.interestRate) * 100).toFixed(2)}%`}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">ดาวน์ขั้นต่ำ</div>
                        <div className="text-lg font-bold">{(parseFloat(config.minDownPaymentPct) * 100).toFixed(0)}%</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">ค่าคอมหน้าร้าน</div>
                        <div className="text-lg font-bold">{(parseFloat(config.storeCommissionPct) * 100).toFixed(0)}%</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">VAT</div>
                        <div className="text-lg font-bold">{(parseFloat(config.vatPct) * 100).toFixed(0)}%</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">งวดต่ำสุด</div>
                        <div className="text-lg font-bold">{config.minInstallmentMonths} เดือน</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">งวดสูงสุด</div>
                        <div className="text-lg font-bold">{config.maxInstallmentMonths} เดือน</div>
                      </div>
                    </div>
                    {config.rates && config.rates.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {config.rates.map((r) => (
                          <span
                            key={r.months}
                            className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary dark:bg-primary/15"
                          >
                            {`${r.months} งวด ${Number((parseFloat(r.ratePct) * 100).toFixed(2))}%`}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Simulation */}
                    <div className="mt-3 bg-muted rounded-lg p-3">
                      <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ตัวอย่างคำนวณ (ราคา 12,900 บาท / {sim.months} งวด)</div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        <div><span className="text-muted-foreground">ดาวน์:</span> <span className="font-medium">{sim.down.toLocaleString()} ฿</span></div>
                        <div><span className="text-muted-foreground">ยอดปล่อย:</span> <span className="font-medium">{sim.loan.toLocaleString()} ฿</span></div>
                        <div><span className="text-muted-foreground">ดอกเบี้ย:</span> <span className="font-medium">{sim.interest.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span></div>
                        <div><span className="text-muted-foreground">ค่าคอม:</span> <span className="font-medium">{sim.commission.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span></div>
                        <div><span className="text-muted-foreground">VAT:</span> <span className="font-medium">{sim.vatAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span></div>
                        <div><span className="text-muted-foreground">รวมจัดไฟแนนซ์:</span> <span className="font-medium">{sim.total.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span></div>
                        <div className="col-span-2"><span className="text-muted-foreground">ค่างวด/เดือน:</span> <span className="font-bold text-primary">{sim.monthly.toLocaleString(undefined, money2)} ฿</span></div>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <button onClick={() => openEdit(config)} className="text-xs text-primary hover:underline px-2 py-1">แก้ไข</button>
                    <button
                      onClick={() => setConfirmDialog({ open: true, message: 'ต้องการลบ?', action: () => deleteMutation.mutate(config.id) })}
                      className="text-xs text-destructive hover:underline px-2 py-1"
                    >
                      ลบ
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      </QueryBoundary>

      {/* Create/Edit Modal */}
      {showModal && (
        <Modal isOpen title={editId ? 'แก้ไขตั้งค่าดอกเบี้ย' : 'สร้างตั้งค่าดอกเบี้ย'} onClose={closeModal}>
          <div className="space-y-4">
            {/* ชื่อ */}
            <div>
              <label htmlFor={`${uiFieldId}-1`} className={formLabelClass}>ชื่อ</label>
              <input id={`${uiFieldId}-1`}
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="เช่น มือ 1, มือ 2..."
                className={touched && errors.name ? errorInputClass : `${inputClass} border-input`}
              />
              {touched && errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
            </div>

            {/* ประเภทสินค้า */}
            <div>
              <label className={formLabelClass}>ประเภทสินค้า</label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((cat) => (
                  <button data-ui-control="button"
                    key={cat.value}
                    type="button"
                    onClick={() => toggleCategory(cat.value)}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                      form.productCategories.includes(cat.value)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card text-foreground border-input hover:border-primary/50'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
              {touched && errors.productCategories && <p className="text-xs text-destructive mt-1">{errors.productCategories}</p>}
            </div>

            {/* ดอกเบี้ย + ดาวน์ขั้นต่ำ */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor={`${uiFieldId}-2`} className={formLabelClass}>ดอกเบี้ยต่อเดือน (%)</label>
                <NumberInput unstyled id={`${uiFieldId}-2`}
                  value={form.interestRate}
                  onChange={(e) => setForm((f) => ({ ...f, interestRate: Number(e.target.value) }))}
                  step="0.1"
                  min="0"
                  max="100"
                  className={touched && errors.interestRate ? errorInputClass : `${inputClass} border-input`}
                />
                <p className="mt-1 text-xs leading-snug text-muted-foreground">ใช้เมื่อไม่มีตารางดอกเบี้ยรายงวด · มีตารางแล้วเว้นเป็น 0 ได้</p>
                {touched && errors.interestRate && <p className="text-xs text-destructive mt-1">{errors.interestRate}</p>}
              </div>
              <div>
                <label htmlFor={`${uiFieldId}-3`} className={formLabelClass}>ดาวน์ขั้นต่ำ (%)</label>
                <NumberInput unstyled id={`${uiFieldId}-3`}
                  value={form.minDownPaymentPct}
                  onChange={(e) => setForm((f) => ({ ...f, minDownPaymentPct: Number(e.target.value) }))}
                  step="1"
                  min="0"
                  max="100"
                  className={touched && errors.minDownPaymentPct ? errorInputClass : `${inputClass} border-input`}
                />
                {touched && errors.minDownPaymentPct && <p className="text-xs text-destructive mt-1">{errors.minDownPaymentPct}</p>}
              </div>
            </div>

            {/* ค่าคอม + VAT */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor={`${uiFieldId}-4`} className={formLabelClass}>ค่าคอมหน้าร้าน (%)</label>
                <NumberInput unstyled id={`${uiFieldId}-4`}
                  value={form.storeCommissionPct}
                  onChange={(e) => setForm((f) => ({ ...f, storeCommissionPct: Number(e.target.value) }))}
                  step="1"
                  min="0"
                  max="100"
                  className={touched && errors.storeCommissionPct ? errorInputClass : `${inputClass} border-input`}
                />
                {touched && errors.storeCommissionPct && <p className="text-xs text-destructive mt-1">{errors.storeCommissionPct}</p>}
              </div>
              <div>
                {/* #22 — อ่านอย่างเดียว: VAT ของการผ่อนมาจากบริษัท FINANCE (ช่องนี้ไม่ถูกบันทึก) · S1-03 สูงเท่าช่องข้าง ๆ */}
                <label htmlFor={`${uiFieldId}-vat`} className={formLabelClass}>VAT (%)</label>
                <ReadOnlyField
                  id={`${uiFieldId}-vat`}
                  data-testid="interest-vat-readonly"
                  value={vat.percentText}
                />
                <VatSourceHint source={vat.source} />
              </div>
            </div>

            {/* งวดต่ำสุด + สูงสุด */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor={`${uiFieldId}-6`} className={formLabelClass}>งวดต่ำสุด (เดือน)</label>
                <NumberInput unstyled id={`${uiFieldId}-6`}
                  value={form.minInstallmentMonths}
                  onChange={(e) => setForm((f) => ({ ...f, minInstallmentMonths: Number(e.target.value) }))}
                  min="1"
                  className={touched && errors.minInstallmentMonths ? errorInputClass : `${inputClass} border-input`}
                />
                {touched && errors.minInstallmentMonths && <p className="text-xs text-destructive mt-1">{errors.minInstallmentMonths}</p>}
              </div>
              <div>
                <label htmlFor={`${uiFieldId}-7`} className={formLabelClass}>งวดสูงสุด (เดือน)</label>
                <NumberInput unstyled id={`${uiFieldId}-7`}
                  value={form.maxInstallmentMonths}
                  onChange={(e) => setForm((f) => ({ ...f, maxInstallmentMonths: Number(e.target.value) }))}
                  min="1"
                  className={touched && errors.maxInstallmentMonths ? errorInputClass : `${inputClass} border-input`}
                />
                {touched && errors.maxInstallmentMonths && <p className="text-xs text-destructive mt-1">{errors.maxInstallmentMonths}</p>}
              </div>
            </div>

            <RateRowsEditor
              rows={form.rates}
              onChange={(rates) => setForm((f) => ({ ...f, rates }))}
              minMonths={form.minInstallmentMonths}
              maxMonths={form.maxInstallmentMonths}
              error={touched ? errors.rates : undefined}
            />

            {/* Preview Calculation */}
            {(() => {
              if (!form.name || !(form.minDownPaymentPct > 0)) return null;
              if (
                !(form.interestRate > 0) &&
                !hasUsableRateRows(form.rates, form.minInstallmentMonths, form.maxInstallmentMonths)
              ) return null;
              if (validateRateRows(form.rates, form.minInstallmentMonths, form.maxInstallmentMonths) !== null) return null;
              const months = previewMonths(form.rates, form.maxInstallmentMonths);
              if (!Number.isFinite(months) || months < 1) return null;
              const out = calcBcInstallment({
                installmentPrice: new Decimal(PREVIEW_PRICE),
                months,
                config: previewBcConfig({
                  minDownPct: form.minDownPaymentPct,
                  commissionPct: form.storeCommissionPct,
                  vatPct: vat.fraction,
                  monthlyRatePct: form.interestRate,
                  rows: form.rates,
                  months,
                }),
              });
              const baht0 = (d: Decimal) => d.toNumber().toLocaleString(undefined, { maximumFractionDigits: 0 });
              return (
                <div className="bg-muted rounded-lg p-3 border border-border">
                  <div className="text-xs font-medium leading-snug text-muted-foreground mb-2">ตัวอย่างคำนวณ (ราคาสินค้า 12,900 บาท / {months} งวด)</div>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    <div>เงินดาวน์: <span className="font-medium">{out.downAmount.toNumber().toLocaleString()} ฿</span></div>
                    <div>ยอดปล่อย: <span className="font-medium">{out.financedAmount.toNumber().toLocaleString()} ฿</span></div>
                    <div>ดอกเบี้ย: <span className="font-medium">{baht0(out.interestAmount)} ฿</span></div>
                    <div>ค่าคอม {form.storeCommissionPct}%: <span className="font-medium">{baht0(out.commissionAmount)} ฿</span></div>
                    <div>VAT: <span className="font-medium">{baht0(out.vatAmount)} ฿</span></div>
                    <div>รวมจัดไฟแนนซ์: <span className="font-medium">{baht0(out.totalWithVat)} ฿</span></div>
                    <div className="col-span-2 pt-1 border-t border-border">
                      <span className="text-muted-foreground">ค่างวด/เดือน:</span> <span className="font-bold text-primary">{out.monthlyPayment.toNumber().toLocaleString(undefined, money2)} ฿</span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Buttons */}
            <div className="flex gap-3 pt-2">
              <button data-ui-control="button" onClick={closeModal} className="flex-1 px-4 py-2 text-sm border border-input rounded-lg hover:bg-muted/50">ยกเลิก</button>
              <button data-ui-control="button"
                onClick={handleSave}
                disabled={saveMutation.isPending}
                className="flex-1 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      <ConfirmDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))} description={confirmDialog.message} variant="destructive" onConfirm={confirmDialog.action} />
    </div>
  );
}
