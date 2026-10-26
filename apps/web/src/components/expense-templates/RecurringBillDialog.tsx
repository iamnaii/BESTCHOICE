import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  RECURRING_BILL_DEFAULT_LEAD_DAYS,
  RECURRING_BILL_LEAD_DAYS_MAX,
  RECURRING_BILL_STARTS_ON_MAX_FUTURE_DAYS,
  RECURRING_BILL_STARTS_ON_MAX_PAST_DAYS,
  addCalendarDays,
  bkkCalendarDate,
  compareCalendarDate,
  type RecurrenceKind,
} from '@installment/shared';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useCoaGroups } from '@/hooks/useCoa';
import { accountDisplayName } from '@/utils/accountName';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { CashAccountSelect } from '@/components/CashAccountSelect';
import { VendorCombobox } from '@/components/expense-form-v4/VendorCombobox';
import { MONTH_NAMES_TH, QUARTER_MONTHS_TH, calendarKey, calendarOfIso, recurringPreviewText, ruleOfTemplate } from './recurring-template.util';

/** แถวแม่แบบจาก GET /expense-templates (ฟิลด์บิลประจำตาม schema Task 2) */
export interface ExpenseTemplate {
  id: string;
  name: string;
  documentType: 'EXPENSE' | 'CREDIT_NOTE' | 'PAYROLL' | 'VENDOR_SETTLEMENT';
  branchId: string;
  prefilledData: Record<string, unknown>;
  isRecurring: boolean;
  recurringDay: number | null;
  recurrence: RecurrenceKind | null;
  recurringMonth: number | null;
  reminderLeadDays: number;
  startsOn: string | null;
  branch: { id: string; name: string };
  createdBy: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface RecurringBillDialogProps {
  open: boolean;
  onClose: () => void;
  /** โหมดแก้ไข — ส่งแถวมาเลย หรือส่ง `templateId` ให้กล่องโหลดเอง */
  template?: ExpenseTemplate | null;
  templateId?: string | null;
  /** สำหรับเทส/พรีวิว — ค่าเริ่มต้น = ตอนนี้ */
  now?: Date;
}

/** วิธีจ่ายที่ร่างบิลประจำรับ (ตรง RECURRING_PAYMENT_METHODS ฝั่ง API) */
const PAYMENT_METHODS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'CASH', label: 'เงินสด' },
  { value: 'BANK_TRANSFER', label: 'โอนเงิน' },
  { value: 'QR_EWALLET', label: 'QR/E-Wallet' },
  { value: 'CARD', label: 'บัตร (EDC)' },
];

interface FormState {
  name: string;
  vendorName: string;
  vendorSupplierId: string;
  branchId: string;
  category: string;
  sampleAmount: string;
  paymentMethod: string;
  depositAccountCode: string;
  recurrence: RecurrenceKind;
  recurringDay: string;
  recurringMonth: string;
  reminderLeadDays: string;
  startsOn: string;
  isRecurring: boolean;
}

type ErrorKey = keyof FormState | 'payment';
type Errors = Partial<Record<ErrorKey, string>>;

/** id ของช่องกรอก — ใช้ผูก label, aria-describedby ของข้อความผิดพลาด และโฟกัสช่องแรกที่ผิด */
const FIELD_IDS: Record<ErrorKey, string> = {
  name: 'rb-name',
  vendorName: 'rb-vendor',
  vendorSupplierId: 'rb-vendor',
  branchId: 'rb-branch',
  category: 'rb-category',
  sampleAmount: 'rb-amount',
  paymentMethod: 'rb-payment',
  depositAccountCode: 'rb-deposit',
  payment: 'rb-payment',
  recurrence: 'rb-recurrence',
  recurringDay: 'rb-day',
  recurringMonth: 'rb-month',
  reminderLeadDays: 'rb-lead',
  startsOn: 'rb-starts',
  isRecurring: 'rb-enabled',
};
const FIELD_ORDER: ErrorKey[] = ['name', 'branchId', 'category', 'sampleAmount', 'payment', 'recurrence', 'recurringDay', 'recurringMonth', 'reminderLeadDays', 'startsOn'];

function initialState(tpl: ExpenseTemplate | null, lockedBranchId: string | null, now: Date): FormState {
  const pf = (tpl?.prefilledData ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (v == null ? '' : String(v));
  return {
    name: tpl?.name ?? '',
    vendorName: str(pf.vendorName),
    vendorSupplierId: str(pf.vendorSupplierId),
    branchId: tpl?.branchId ?? lockedBranchId ?? '',
    category: str(pf.category),
    sampleAmount: str(pf.sampleAmount),
    paymentMethod: str(pf.paymentMethod),
    depositAccountCode: str(pf.depositAccountCode),
    recurrence: tpl?.recurrence ?? 'MONTHLY',
    recurringDay: tpl?.recurringDay ? String(tpl.recurringDay) : '',
    recurringMonth: tpl?.recurringMonth ? String(tpl.recurringMonth) : '',
    reminderLeadDays: String(tpl?.reminderLeadDays ?? RECURRING_BILL_DEFAULT_LEAD_DAYS),
    startsOn: calendarKey(calendarOfIso(tpl?.startsOn) ?? bkkCalendarDate(now)),
    isRecurring: tpl ? tpl.isRecurring : true,
  };
}

/**
 * ข้อความเดียวกับ assertRecurringRule / normalizeStartsOn ฝั่ง API (Task 4)
 * `startsOnUnchanged` = โหมดแก้ไขที่ไม่ได้แตะวันเริ่ม — ไม่ตรวจเพดานย้อนหลัง ไม่งั้นบิลเก่าเกิน 90 วันแก้อะไรไม่ได้ (รีวิว I2)
 */
export function validateRecurringForm(f: FormState, now: Date, opts: { startsOnUnchanged?: boolean } = {}): Errors {
  const e: Errors = {};
  if (!f.name.trim()) e.name = 'กรุณาระบุชื่อบิล';
  if (!f.branchId) e.branchId = 'กรุณาเลือกสาขา';
  if (f.sampleAmount !== '' && !(Number(f.sampleAmount) >= 0)) e.sampleAmount = 'ยอดประมาณต้องเป็นตัวเลข 0 ขึ้นไป';
  if (f.paymentMethod && !f.depositAccountCode) e.payment = 'ตั้งวิธีจ่ายแล้วต้องเลือกบัญชีที่จ่ายด้วย';
  if (!f.paymentMethod && f.depositAccountCode) e.payment = 'เลือกบัญชีที่จ่ายแล้วต้องตั้งวิธีจ่ายด้วย';
  if (!f.recurrence) e.recurrence = 'บิลประจำต้องระบุความถี่ (รายเดือน / ราย 3 เดือน / รายปี)';
  const day = Number(f.recurringDay);
  if (!Number.isInteger(day) || day < 1 || day > 31) e.recurringDay = 'บิลประจำต้องระบุวันครบกำหนด 1-31';
  const month = f.recurringMonth === '' ? null : Number(f.recurringMonth);
  if (f.recurrence === 'QUARTERLY' && (month == null || month < 1 || month > 3)) e.recurringMonth = 'ราย 3 เดือนต้องระบุว่าเป็นเดือนที่ 1-3 ของไตรมาส';
  if (f.recurrence === 'YEARLY' && (month == null || month < 1 || month > 12)) e.recurringMonth = 'รายปีต้องระบุเดือน 1-12';
  const lead = Number(f.reminderLeadDays);
  if (!Number.isInteger(lead) || lead < 0 || lead > RECURRING_BILL_LEAD_DAYS_MAX) e.reminderLeadDays = `เตือนล่วงหน้าได้ 0-${RECURRING_BILL_LEAD_DAYS_MAX} วัน`;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f.startsOn);
  if (!m) e.startsOn = 'วันเริ่มนับงวดต้องเป็นรูปแบบ YYYY-MM-DD';
  else if (!opts.startsOnUnchanged) {
    const today = bkkCalendarDate(now);
    const start = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
    if (compareCalendarDate(start, addCalendarDays(today, -RECURRING_BILL_STARTS_ON_MAX_PAST_DAYS)) < 0) e.startsOn = `วันเริ่มนับงวดย้อนหลังได้ไม่เกิน ${RECURRING_BILL_STARTS_ON_MAX_PAST_DAYS} วัน`;
    if (compareCalendarDate(start, addCalendarDays(today, RECURRING_BILL_STARTS_ON_MAX_FUTURE_DAYS)) > 0) e.startsOn = 'วันเริ่มนับงวดล่วงหน้าได้ไม่เกิน 1 ปี';
  }
  return e;
}

function buildPrefilledData(f: FormState, base: Record<string, unknown>): Record<string, unknown> {
  const pf: Record<string, unknown> = { ...base };
  const put = (key: string, value: unknown, keep: boolean) => {
    if (keep) pf[key] = value;
    else delete pf[key];
  };
  put('vendorName', f.vendorName.trim(), !!f.vendorName.trim());
  put('vendorSupplierId', f.vendorSupplierId, !!f.vendorSupplierId);
  put('category', f.category, !!f.category);
  put('description', f.name.trim(), true);
  put('sampleAmount', Number(f.sampleAmount), f.sampleAmount !== '');
  put('paymentMethod', f.paymentMethod, !!f.paymentMethod);
  put('depositAccountCode', f.depositAccountCode, !!f.depositAccountCode);
  return pf;
}

/**
 * กล่อง "ตั้งบิลประจำ" (mockup กระดาน 3 + สเปก §15: วิธีจ่าย/บัญชีที่จ่าย · โหมดแก้ไขสาขาอ่านอย่างเดียว · BM ล็อกสาขาตนเอง)
 * บันทึกแล้ว API ขั้น A สร้างงวด/ร่างทันทีถ้าหน้าต่างเตือนเปิดอยู่ (Task 7) — จึง invalidate ทั้งแม่แบบและหน้าบิลประจำ
 */
export function RecurringBillDialog({ open, onClose, template = null, templateId = null, now }: RecurringBillDialogProps) {
  const clock = useMemo(() => now ?? new Date(), [now]);
  const qc = useQueryClient();
  const { user } = useAuth();
  const lockedBranchId = user?.role === 'BRANCH_MANAGER' ? (user.branchId ?? null) : null;
  const { data: fetched, isLoading: loadingTemplate } = useQuery<ExpenseTemplate>({
    queryKey: ['expense-templates', 'one', templateId],
    queryFn: async () => (await api.get(`/expense-templates/${templateId}`)).data,
    enabled: open && !template && !!templateId,
  });
  const tpl = template ?? (templateId ? fetched ?? null : null);
  const editing = !!(template || templateId);
  const initial = useMemo(() => initialState(tpl, lockedBranchId, clock), [tpl, lockedBranchId, clock]);
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Errors>({});
  useEffect(() => {
    if (open) {
      setForm(initial);
      setErrors({});
    }
  }, [open, initial]);

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
    enabled: open,
  });
  const { data: coa } = useCoaGroups({ type: 'ค่าใช้จ่าย' });
  const groups = coa?.groups ?? [];

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((s) => ({ ...s, [key]: value }));
  const onRecurrence = (value: RecurrenceKind) => setForm((s) => ({ ...s, recurrence: value, recurringMonth: value === 'MONTHLY' ? '' : s.recurringMonth }));

  const rule = ruleOfTemplate({
    recurrence: form.recurrence,
    recurringDay: Number(form.recurringDay) || null,
    recurringMonth: form.recurringMonth === '' ? null : Number(form.recurringMonth),
  });
  const leadDays = Number(form.reminderLeadDays);
  const startsOnCal = /^\d{4}-\d{2}-\d{2}$/.test(form.startsOn)
    ? { year: Number(form.startsOn.slice(0, 4)), month: Number(form.startsOn.slice(5, 7)), day: Number(form.startsOn.slice(8, 10)) }
    : null;
  const preview = rule && Number.isInteger(leadDays) && leadDays >= 0 && leadDays <= RECURRING_BILL_LEAD_DAYS_MAX && Number(form.recurringDay) <= 31
    ? recurringPreviewText(rule, leadDays, startsOnCal, clock)
    : null;
  // โหมดแก้ไขที่ไม่แตะวันเริ่ม = ไม่ส่ง startsOn (API จะเลื่อนให้เองเมื่อเปลี่ยนรอบ) — รีวิว I2
  const startsOnUnchanged = !!tpl && form.startsOn === initial.startsOn;

  const save = useMutation({
    mutationFn: async () => {
      const common = {
        name: form.name.trim(),
        prefilledData: buildPrefilledData(form, (tpl?.prefilledData as Record<string, unknown> | undefined) ?? {}),
        isRecurring: form.isRecurring,
        recurrence: form.recurrence,
        recurringDay: Number(form.recurringDay),
        recurringMonth: form.recurrence === 'MONTHLY' ? null : Number(form.recurringMonth),
        reminderLeadDays: Number(form.reminderLeadDays),
        ...(startsOnUnchanged ? {} : { startsOn: form.startsOn }),
      };
      if (tpl) return (await api.patch(`/expense-templates/${tpl.id}`, common)).data as { ruleChanged?: boolean };
      return (await api.post('/expense-templates', { documentType: 'EXPENSE', branchId: form.branchId, ...common })).data as { ruleChanged?: boolean };
    },
    onSuccess: (data) => {
      toast.success(tpl ? 'บันทึกบิลประจำแล้ว' : 'ตั้งบิลประจำแล้ว — ระบบจะสร้างร่างและเตือนก่อนครบกำหนด');
      if (data?.ruleChanged) toast.info('เปลี่ยนรอบแล้ว — งวดที่ยังไม่ถึงถูกปรับตามรอบใหม่ งวดที่ครบกำหนดแล้วยังคงอยู่');
      void qc.invalidateQueries({ queryKey: ['expense-templates'] });
      void qc.invalidateQueries({ queryKey: ['recurring-bills'] });
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const submit = () => {
    const e = validateRecurringForm(form, clock, { startsOnUnchanged });
    setErrors(e);
    const first = FIELD_ORDER.find((k) => e[k]);
    if (first) {
      document.getElementById(FIELD_IDS[first])?.focus();
      return;
    }
    save.mutate();
  };

  const branchLocked = editing || !!lockedBranchId;
  const monthOptions =
    form.recurrence === 'QUARTERLY'
      ? QUARTER_MONTHS_TH.map((months, i) => ({ value: String(i + 1), label: `เดือนที่ ${i + 1} ของไตรมาส (${months.join('/')})` }))
      : form.recurrence === 'YEARLY'
        ? MONTH_NAMES_TH.map((name, i) => ({ value: String(i + 1), label: name }))
        : [];
  const a11y = (key: ErrorKey) => (errors[key] ? { 'aria-invalid': true as const, 'aria-describedby': `${FIELD_IDS[key]}-error` } : {});
  const err = (key: ErrorKey) =>
    errors[key] ? (
      <p id={`${FIELD_IDS[key]}-error`} className="text-xs text-destructive" role="alert">{errors[key]}</p>
    ) : null;
  const hint = (text: string) => <p className="text-xs text-muted-foreground">{text}</p>;
  const req = <span aria-hidden="true" className="ml-0.5 text-destructive">*</span>;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tpl ? `แก้ไขบิลประจำ — ${tpl.name}` : 'ตั้งบิลประจำ'}</DialogTitle>
          <DialogDescription>ระบบจะสร้างร่างใบรายจ่าย + งานใน /todos + แจ้งเตือนก่อนครบกำหนด — ไม่โพสต์/ไม่จ่ายให้เอง · * = ต้องกรอก</DialogDescription>
        </DialogHeader>
        {editing && !tpl && loadingTemplate ? (
          <p className="py-6 text-center text-sm text-muted-foreground">กำลังโหลดแม่แบบ…</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1 md:col-span-2">
              <div className="flex items-center"><Label htmlFor="rb-name">ชื่อบิล</Label>{req}</div>
              <Input id="rb-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="เช่น ค่าเช่าร้าน สาขาลาดพร้าว" required {...a11y('name')} />
              {err('name')}
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="rb-vendor">ผู้รับเงิน / เจ้าหนี้</Label>
              <VendorCombobox id="rb-vendor" value={form.vendorName} onSelectSupplier={(s) => setForm((f) => ({ ...f, vendorName: s.name, vendorSupplierId: s.supplierId }))} />
              {hint('พิมพ์เองหรือเลือกจากรายชื่อผู้จัดจำหน่าย')}
            </div>
            <div className="space-y-1">
              <div className="flex items-center"><Label htmlFor="rb-branch">สาขา</Label>{req}</div>
              <NativeSelect id="rb-branch" value={form.branchId} disabled={branchLocked} onChange={(e) => set('branchId', e.target.value)} required {...a11y('branchId')}>
                <option value="">— เลือก —</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                {tpl && !branches.some((b) => b.id === tpl.branchId) && <option value={tpl.branchId}>{tpl.branch?.name ?? tpl.branchId}</option>}
              </NativeSelect>
              {editing ? hint('ย้ายสาขา = ปิดบิลนี้แล้วตั้งใหม่') : err('branchId')}
            </div>
            <div className="space-y-1">
              <Label htmlFor="rb-category">บัญชีค่าใช้จ่าย</Label>
              <NativeSelect id="rb-category" value={form.category} onChange={(e) => set('category', e.target.value)} {...a11y('category')}>
                <option value="">— เลือก —</option>
                {groups.flatMap((g) => g.accounts.map((a) => <option key={a.code} value={a.code}>{a.code} {accountDisplayName(a.name)}</option>))}
              </NativeSelect>
              {hint('ไปอยู่ในบรรทัดของร่างใบรายจ่าย — แก้ในร่างได้')}
            </div>
            <div className="space-y-1">
              <Label htmlFor="rb-amount">ยอดประมาณ (บาท)</Label>
              <Input id="rb-amount" type="number" min={0} step="0.01" inputMode="decimal" value={form.sampleAmount} onChange={(e) => set('sampleAmount', e.target.value)} {...a11y('sampleAmount')} />
              {err('sampleAmount') ?? hint('ใช้เป็นยอดตั้งต้นของร่าง และคำนวณ "ยังต้องจ่ายเดือนนี้"')}
            </div>
            <div className="space-y-1">
              <Label htmlFor="rb-payment">วิธีจ่าย</Label>
              <NativeSelect id="rb-payment" value={form.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value)} {...a11y('payment')}>
                <option value="">ไม่ตั้ง — ร่างจะลงเป็นตั้งหนี้ ต้องทำใบจ่ายเจ้าหนี้ต่อ</option>
                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </NativeSelect>
              {err('payment')}
            </div>
            <div className="space-y-1">
              <Label htmlFor="rb-deposit">บัญชีที่จ่าย</Label>
              <CashAccountSelect id="rb-deposit" value={form.depositAccountCode} onChange={(code) => set('depositAccountCode', code)} placeholder="— เลือกบัญชีเงินสด/ธนาคาร —" />
              {hint('ตั้งทั้งสองช่อง = ร่างโพสต์เป็นจ่ายทันที ระบบปิดงวดให้เอง')}
            </div>
            <div className="space-y-1">
              <div className="flex items-center"><Label htmlFor="rb-recurrence">ความถี่</Label>{req}</div>
              <NativeSelect id="rb-recurrence" value={form.recurrence} onChange={(e) => onRecurrence(e.target.value as RecurrenceKind)} required {...a11y('recurrence')}>
                <option value="MONTHLY">รายเดือน</option>
                <option value="QUARTERLY">ราย 3 เดือน</option>
                <option value="YEARLY">รายปี</option>
              </NativeSelect>
              {err('recurrence')}
            </div>
            <div className="space-y-1">
              <div className="flex items-center"><Label htmlFor="rb-day">วันครบกำหนด (วันที่ของเดือน)</Label>{req}</div>
              <Input id="rb-day" type="number" min={1} max={31} inputMode="numeric" value={form.recurringDay} onChange={(e) => set('recurringDay', e.target.value)} required {...a11y('recurringDay')} />
              {err('recurringDay') ?? hint('1–31 · เดือนที่มีไม่ถึงวันนั้น ใช้วันสุดท้ายของเดือน (เช่น 31 → 28 ก.พ.)')}
            </div>
            <div className="space-y-1">
              <div className="flex items-center"><Label htmlFor="rb-month">เดือน</Label>{form.recurrence !== 'MONTHLY' && req}</div>
              <NativeSelect id="rb-month" value={form.recurringMonth} disabled={form.recurrence === 'MONTHLY'} onChange={(e) => set('recurringMonth', e.target.value)} {...a11y('recurringMonth')}>
                <option value="">{form.recurrence === 'MONTHLY' ? '— ทุกเดือน —' : '— เลือก —'}</option>
                {monthOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </NativeSelect>
              {err('recurringMonth') ?? hint('เปิดเมื่อเลือก ราย 3 เดือน (เดือนที่ 1/2/3 ของไตรมาส) หรือ รายปี (ม.ค.–ธ.ค.)')}
            </div>
            <div className="space-y-1">
              <Label htmlFor="rb-lead">เตือนล่วงหน้า (วัน)</Label>
              <Input id="rb-lead" type="number" min={0} max={RECURRING_BILL_LEAD_DAYS_MAX} inputMode="numeric" value={form.reminderLeadDays} onChange={(e) => set('reminderLeadDays', e.target.value)} {...a11y('reminderLeadDays')} />
              {err('reminderLeadDays') ?? hint(`ระบบสร้างร่าง + งาน + แจ้งเตือนก่อนครบกำหนดกี่วัน (0–${RECURRING_BILL_LEAD_DAYS_MAX}) · ค่าเริ่มต้น ${RECURRING_BILL_DEFAULT_LEAD_DAYS}`)}
            </div>
            <div className="space-y-1">
              <Label htmlFor="rb-starts">เริ่มนับงวดแรกตั้งแต่</Label>
              <Input id="rb-starts" type="date" value={form.startsOn} onChange={(e) => set('startsOn', e.target.value)} {...a11y('startsOn')} />
              {err('startsOn') ?? hint('งวดที่ครบกำหนดก่อนวันนี้เกิน 7 วันจะถูกบันทึกเป็น "งวดหลุด" ไม่สร้างร่างย้อนหลัง')}
            </div>
            <div className="md:col-span-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm" data-testid="recurring-preview">
              {preview ?? <span className="text-muted-foreground">กรอกความถี่และวันครบกำหนดเพื่อดูงวดถัดไป</span>}
            </div>
            {editing && (
              <div className="md:col-span-2 flex items-start gap-2">
                <Checkbox id="rb-enabled" checked={form.isRecurring} onCheckedChange={(v) => set('isRecurring', v === true)} />
                <div>
                  <Label htmlFor="rb-enabled">เปิดใช้บิลประจำ</Label>
                  {hint('ติ๊กออก = หยุดสร้างงวดใหม่ งวดที่ค้างยังอยู่จนกว่าจะจ่าย/ข้าม')}
                </div>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>ยกเลิก</Button>
          <Button variant="primary" onClick={submit} disabled={save.isPending || (editing && !tpl)}>บันทึกบิลประจำ</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
