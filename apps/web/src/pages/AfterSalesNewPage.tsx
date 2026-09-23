import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ContactCombobox, type ContactPickResult } from '@/components/contacts/ContactCombobox';
import { RepairCenterCombobox } from '@/pages/insurance/components/RepairCenterCombobox';
import StepBar from './after-sales/StepBar';
import OutcomePicker from './after-sales/OutcomePicker';
import IntakePhotos from './after-sales/IntakePhotos';
import PurchasePhotoStrip from './after-sales/PurchasePhotoStrip';
import {
  afterSalesKeys,
  dayOf,
  OUTCOME_LABEL,
  PAYER_LABEL,
  SOURCE_LABEL,
  WARRANTY_LABEL,
  WARRANTY_TILE,
  type AfterSalesOutcome,
  type LookupResult,
  type Payer,
} from './after-sales/after-sales';

const inputClass =
  'h-11 w-full rounded-lg border border-input bg-background px-3.5 text-sm leading-snug text-foreground placeholder:text-muted-foreground/70';
const areaClass =
  'w-full resize-none rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm leading-snug text-foreground placeholder:text-muted-foreground/70';
const checkboxClass = 'mt-0.5 h-[18px] w-[18px] accent-primary';

interface Accessories {
  box: boolean;
  charger: boolean;
  case: boolean;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5">
      <h3 className="text-base font-semibold leading-snug">{title}</h3>
      {children}
    </section>
  );
}

export default function AfterSalesNewPage() {
  useDocumentTitle('แจ้งปัญหาเครื่อง');
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const imei = searchParams.get('imei') ?? '';

  const [imeiInput, setImeiInput] = useState('');
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [deviceBrand, setDeviceBrand] = useState('');
  const [deviceModel, setDeviceModel] = useState('');
  const [deviceSerial, setDeviceSerial] = useState('');
  const [symptom, setSymptom] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [accessories, setAccessories] = useState<Accessories>({
    box: false,
    charger: false,
    case: false,
  });
  const [otherEnabled, setOtherEnabled] = useState(false);
  const [otherText, setOtherText] = useState('');
  const [unlockConfirmed, setUnlockConfirmed] = useState(false);
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState<AfterSalesOutcome | null>(null);
  const [payer, setPayer] = useState<Payer | ''>('');
  const [estimatedCost, setEstimatedCost] = useState('');
  const [repairSupplier, setRepairSupplier] = useState<{ id: string; name: string } | null>(null);
  const [branchId, setBranchId] = useState(user?.branchId ?? '');

  // mirror ของ CROSS_BRANCH_ROLES ฝั่ง API — ใช้ตัดสินว่าต้องเลือกสาขาเองหรือไม่ (route นี้อนุญาต
  // เฉพาะ OWNER/BRANCH_MANAGER/SALES แต่ user.branchId เป็นตัวชี้ขาดจริง — ให้ตรงกับ AfterSalesPage)
  const branchRequired = !user?.branchId;
  const branches = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
    enabled: branchRequired,
    staleTime: 60_000,
  });

  const lookup = useQuery<LookupResult>({
    queryKey: afterSalesKeys.lookup(imei),
    queryFn: async () => (await api.get('/after-sales/lookup', { params: { imei } })).data,
    enabled: !!imei,
    staleTime: 0,
  });

  // ตั้งทางออกเริ่มต้น = ตัวแรกที่ enabled+implemented (PR นี้มีแค่ "ซ่อม" — เปลี่ยนเครื่องยังปิดอยู่)
  useEffect(() => {
    if (!lookup.data) return;
    const first = lookup.data.outcomes.find((o) => o.enabled && o.implemented);
    setOutcome(first?.outcome ?? null);
    const defaultPayer = lookup.data.outcomes.find(
      (o) => o.outcome === first?.outcome,
    )?.payerDefault;
    if (defaultPayer) setPayer(defaultPayer);
  }, [lookup.data]);

  const create = useMutation({
    mutationFn: async (form: FormData) =>
      (await api.post('/after-sales', form, { headers: { 'Content-Type': 'multipart/form-data' } }))
        .data as { id: string; caseNumber: string; repairTicketId: string },
    onSuccess: (data) => {
      toast.success(`เปิดเคส ${data.caseNumber}`);
      queryClient.invalidateQueries({ queryKey: afterSalesKeys.all });
      navigate(`/after-sales/${data.id}`);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  if (!imei) {
    return (
      <div className="space-y-4">
        <PageHeader title="แจ้งปัญหาเครื่อง" onBack={() => navigate('/after-sales')} />
        <form
          className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-4 sm:flex-row sm:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = imeiInput.trim();
            if (trimmed) setSearchParams({ imei: trimmed });
          }}
        >
          <input
            aria-label="เลข IMEI หรือเลขเครื่อง"
            value={imeiInput}
            onChange={(e) => setImeiInput(e.target.value)}
            placeholder="กรอกเลข IMEI 15 หลัก"
            className={`${inputClass} h-14 flex-1 text-lg`}
          />
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="h-14"
            disabled={!imeiInput.trim()}
          >
            ค้นหา
          </Button>
        </form>
      </div>
    );
  }

  const found = lookup.data?.found ?? false;
  const walkIn = !!lookup.data && !found;
  const canSubmit = !create.isPending && !lookup.data?.openCase;

  const buildSummary = () => {
    const parts: string[] = [];
    const customerName = found ? lookup.data?.customer?.name : customer?.name;
    if (customerName) parts.push(`ลูกค้า ${customerName}`);
    const deviceName = found
      ? [lookup.data?.product?.brand, lookup.data?.product?.model].filter(Boolean).join(' ')
      : [deviceBrand, deviceModel].filter(Boolean).join(' ');
    if (deviceName) parts.push(`เครื่อง ${deviceName}`);
    parts.push(`รูป ${photos.length} รูป`);
    if (outcome) parts.push(`ทางออก ${OUTCOME_LABEL[outcome]}`);
    return parts.join(' · ') || 'กรอกข้อมูลด้านบนก่อนบันทึก';
  };

  const handleSubmit = () => {
    if (photos.length === 0) {
      toast.error('ต้องมีรูปตอนรับฝากอย่างน้อย 1 รูป');
      return;
    }
    if (symptom.trim().length < 5) {
      toast.error('อาการต้องมีอย่างน้อย 5 ตัวอักษร');
      return;
    }
    if (walkIn && !customer) {
      toast.error('ต้องเลือกลูกค้าก่อนบันทึก');
      return;
    }
    if (branchRequired && !branchId) {
      toast.error('ต้องเลือกสาขาก่อนบันทึก');
      return;
    }
    if (!outcome) {
      toast.error('ต้องเลือกทางออกก่อนบันทึก');
      return;
    }

    const form = new FormData();
    form.append('imei', imei);
    if (walkIn && customer) form.append('customerId', customer.id);
    if (deviceBrand.trim()) form.append('deviceBrand', deviceBrand.trim());
    if (deviceModel.trim()) form.append('deviceModel', deviceModel.trim());
    if (deviceSerial.trim()) form.append('deviceSerial', deviceSerial.trim());
    form.append('symptom', symptom.trim());
    form.append(
      'accessories',
      JSON.stringify({
        ...accessories,
        ...(otherEnabled && otherText.trim() ? { other: otherText.trim() } : {}),
      }),
    );
    form.append('unlockConfirmed', unlockConfirmed ? 'true' : 'false');
    if (note.trim()) form.append('note', note.trim());
    form.append('outcome', outcome);
    if (outcome === 'REPAIR') {
      if (payer) form.append('payer', payer);
      if (estimatedCost.trim()) form.append('estimatedCost', estimatedCost.trim());
      if (repairSupplier) form.append('repairSupplierId', repairSupplier.id);
    }
    form.append('branchId', branchId);
    photos.forEach((file) => form.append('photos', file));

    create.mutate(form);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="แจ้งปัญหาเครื่อง"
        subtitle={`IMEI ${imei}`}
        onBack={() => navigate('/after-sales')}
      />

      <QueryBoundary
        isLoading={lookup.isLoading}
        isError={lookup.isError}
        error={lookup.error}
        onRetry={lookup.refetch}
      >
        {lookup.data && (
          <>
            <StepBar
              ariaLabel="ขั้นตอนแจ้งปัญหาเครื่อง"
              steps={[
                { tone: 'done', title: 'เครื่องและลูกค้า' },
                { tone: 'done', title: 'สภาพและอาการ' },
                { tone: 'now', title: 'สิทธิ์และทางออก' },
              ]}
            />

            <Card title="เครื่องและลูกค้า">
              {found ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-snug ${
                        WARRANTY_TILE[lookup.data.warranty.status] ?? WARRANTY_TILE.WALK_IN
                      }`}
                    >
                      {WARRANTY_LABEL[lookup.data.warranty.status] ?? lookup.data.warranty.status}
                    </span>
                    <span className="text-sm font-semibold leading-snug">
                      {lookup.data.customer?.name ?? 'ไม่ทราบชื่อลูกค้า'}
                    </span>
                  </div>
                  <p className="text-sm leading-snug text-foreground">
                    {[
                      lookup.data.product?.brand,
                      lookup.data.product?.model,
                      lookup.data.product?.storage,
                    ]
                      .filter(Boolean)
                      .join(' ') || 'ไม่ทราบรุ่นเครื่อง'}
                    {' · '}
                    {SOURCE_LABEL[lookup.data.source]}
                  </p>
                  {lookup.data.warranty.purchasedAt && (
                    <p className="text-xs leading-snug text-muted-foreground">
                      ลูกค้ารับเครื่องไปเมื่อ {dayOf(lookup.data.warranty.purchasedAt)}
                    </p>
                  )}
                  <PurchasePhotoStrip photos={lookup.data.purchasePhotos} />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <span className="block text-xs leading-snug text-muted-foreground">
                      ลูกค้า <span className="text-destructive">*</span>
                    </span>
                    <ContactCombobox
                      roleNeeded="CUSTOMER"
                      value={customer?.name ?? ''}
                      onSelect={(result: ContactPickResult) =>
                        setCustomer({ id: result.childId, name: result.name })
                      }
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <label
                        htmlFor="as-brand"
                        className="block text-xs leading-snug text-muted-foreground"
                      >
                        ยี่ห้อ
                      </label>
                      <input
                        id="as-brand"
                        value={deviceBrand}
                        onChange={(e) => setDeviceBrand(e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div className="space-y-1">
                      <label
                        htmlFor="as-model"
                        className="block text-xs leading-snug text-muted-foreground"
                      >
                        รุ่น
                      </label>
                      <input
                        id="as-model"
                        value={deviceModel}
                        onChange={(e) => setDeviceModel(e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div className="space-y-1">
                      <label
                        htmlFor="as-serial"
                        className="block text-xs leading-snug text-muted-foreground"
                      >
                        เลขเครื่อง
                      </label>
                      <input
                        id="as-serial"
                        value={deviceSerial}
                        onChange={(e) => setDeviceSerial(e.target.value)}
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>
              )}
            </Card>

            <Card title="สภาพและอาการ">
              <div className="space-y-1">
                <label
                  htmlFor="as-symptom"
                  className="block text-xs leading-snug text-muted-foreground"
                >
                  อาการที่ลูกค้าแจ้ง <span className="text-destructive">*</span> (อย่างน้อย 5
                  ตัวอักษร)
                </label>
                <textarea
                  id="as-symptom"
                  rows={3}
                  minLength={5}
                  maxLength={2000}
                  value={symptom}
                  onChange={(e) => setSymptom(e.target.value)}
                  className={areaClass}
                />
              </div>

              <div className="space-y-1">
                <span className="block text-xs leading-snug text-muted-foreground">
                  รูปตอนรับฝาก <span className="text-destructive">*</span> (อย่างน้อย 1 รูป)
                </span>
                <IntakePhotos files={photos} onChange={setPhotos} max={6} />
              </div>

              <fieldset className="space-y-2">
                <legend className="mb-1 text-xs leading-snug text-muted-foreground">
                  อุปกรณ์ที่แนบมาด้วย
                </legend>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm leading-snug">
                    <input
                      type="checkbox"
                      checked={accessories.box}
                      onChange={(e) =>
                        setAccessories((prev) => ({ ...prev, box: e.target.checked }))
                      }
                      className={checkboxClass}
                    />
                    กล่อง
                  </label>
                  <label className="flex items-center gap-2 text-sm leading-snug">
                    <input
                      type="checkbox"
                      checked={accessories.charger}
                      onChange={(e) =>
                        setAccessories((prev) => ({ ...prev, charger: e.target.checked }))
                      }
                      className={checkboxClass}
                    />
                    สายชาร์จ
                  </label>
                  <label className="flex items-center gap-2 text-sm leading-snug">
                    <input
                      type="checkbox"
                      checked={accessories.case}
                      onChange={(e) =>
                        setAccessories((prev) => ({ ...prev, case: e.target.checked }))
                      }
                      className={checkboxClass}
                    />
                    เคส
                  </label>
                  <label className="flex items-center gap-2 text-sm leading-snug">
                    <input
                      type="checkbox"
                      checked={otherEnabled}
                      onChange={(e) => setOtherEnabled(e.target.checked)}
                      className={checkboxClass}
                    />
                    อื่นๆ
                  </label>
                </div>
                {otherEnabled && (
                  <input
                    aria-label="อุปกรณ์อื่นๆ ที่แนบมาด้วย"
                    value={otherText}
                    onChange={(e) => setOtherText(e.target.value)}
                    placeholder="ระบุอุปกรณ์อื่นๆ"
                    className={inputClass}
                  />
                )}
              </fieldset>

              <label className="flex items-start gap-2.5 rounded-lg border border-border p-3 leading-snug">
                <input
                  type="checkbox"
                  checked={unlockConfirmed}
                  onChange={(e) => setUnlockConfirmed(e.target.checked)}
                  className={checkboxClass}
                />
                <span className="text-sm">ลูกค้าปิด Find My / ปลดล็อกเครื่องให้แล้ว</span>
              </label>

              <div className="space-y-1">
                <label
                  htmlFor="as-note"
                  className="block text-xs leading-snug text-muted-foreground"
                >
                  หมายเหตุ
                </label>
                <textarea
                  id="as-note"
                  rows={2}
                  maxLength={1000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className={areaClass}
                />
              </div>
            </Card>

            <Card title="สิทธิ์และทางออก">
              <div className="rounded-lg border border-primary/20 bg-primary/10 p-3 text-sm leading-snug text-primary">
                <p className="font-semibold">
                  {WARRANTY_LABEL[lookup.data.warranty.status] ?? lookup.data.warranty.status}
                </p>
                {lookup.data.warranty.status === 'IN_7DAY_DEFECT' && (
                  <p>เหลืออีก {lookup.data.warranty.daysRemainingIn7Day} วัน</p>
                )}
                {lookup.data.warranty.shopWarrantyEndDate && (
                  <p>ประกันร้านถึง {dayOf(lookup.data.warranty.shopWarrantyEndDate)}</p>
                )}
                {lookup.data.warranty.manufacturerWarrantyEndDate && (
                  <p>ประกันศูนย์ถึง {dayOf(lookup.data.warranty.manufacturerWarrantyEndDate)}</p>
                )}
              </div>

              {lookup.data.openCase && (
                <div className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm leading-snug text-warning-strong">
                  <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    เครื่องนี้มีเคสที่ยังไม่ปิด {lookup.data.openCase.caseNumber} —
                    บันทึกเคสใหม่ไม่ได้ ·{' '}
                    <Link
                      to={`/after-sales/${lookup.data.openCase.id}`}
                      className="font-semibold underline"
                    >
                      เปิดดูเคสนี้
                    </Link>
                  </p>
                </div>
              )}

              <OutcomePicker options={lookup.data.outcomes} value={outcome} onChange={setOutcome} />

              {outcome === 'REPAIR' && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <label
                      htmlFor="as-payer"
                      className="block text-xs leading-snug text-muted-foreground"
                    >
                      ผู้จ่ายค่าซ่อม
                    </label>
                    <select
                      id="as-payer"
                      value={payer}
                      onChange={(e) => setPayer(e.target.value as Payer)}
                      className={inputClass}
                    >
                      <option value="">— เลือก —</option>
                      {(['SHOP', 'CUSTOMER', 'SUPPLIER_CLAIM'] as const).map((p) => (
                        <option key={p} value={p}>
                          {PAYER_LABEL[p]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor="as-estimated-cost"
                      className="block text-xs leading-snug text-muted-foreground"
                    >
                      ค่าซ่อมประมาณ
                    </label>
                    <input
                      id="as-estimated-cost"
                      inputMode="decimal"
                      value={estimatedCost}
                      onChange={(e) => setEstimatedCost(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="block text-xs leading-snug text-muted-foreground">
                      ศูนย์ซ่อม (ว่าง = ซ่อมที่ร้าน)
                    </span>
                    <RepairCenterCombobox
                      value={repairSupplier?.id ?? ''}
                      displayName={repairSupplier?.name}
                      onSelect={(s) => setRepairSupplier(s)}
                    />
                  </div>
                </div>
              )}

              {branchRequired && (
                <div className="space-y-1">
                  <label
                    htmlFor="as-branch"
                    className="block text-xs leading-snug text-muted-foreground"
                  >
                    สาขา <span className="text-destructive">*</span>
                  </label>
                  <select
                    id="as-branch"
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">— เลือกสาขา —</option>
                    {branches.data?.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </Card>

            <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div>
                <div className="text-xs font-semibold leading-snug text-muted-foreground">
                  สรุปก่อนบันทึก
                </div>
                <div className="text-sm leading-snug text-foreground">{buildSummary()}</div>
              </div>
              <div className="flex gap-2.5">
                <Button variant="outline" size="lg" onClick={() => navigate('/after-sales')}>
                  ยกเลิก
                </Button>
                <Button variant="primary" size="lg" disabled={!canSubmit} onClick={handleSubmit}>
                  {create.isPending ? 'กำลังบันทึก…' : 'บันทึกและเปิดเคส'}
                </Button>
              </div>
            </div>
          </>
        )}
      </QueryBoundary>
    </div>
  );
}
