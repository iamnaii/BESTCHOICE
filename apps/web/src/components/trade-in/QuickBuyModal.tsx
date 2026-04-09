import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { readSmartCard } from '@/lib/cardReader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Upload,
  AlertTriangle,
  ShoppingBag,
} from 'lucide-react';
import { brands, getModels } from '@/data/productCatalog';
import SignaturePadFull from '@/components/signing/SignaturePadFull';
import AddressForm, { type AddressData, emptyAddress, composeAddress } from '@/components/ui/AddressForm';

interface QuickBuyModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (id: string, voucherNumber: string) => void;
}

interface SellerHistoryResponse {
  found: boolean;
  totalCount: number;
  recentCount: number;
  warning: boolean;
  lastSeller: { sellerName: string; sellerPhone: string | null; sellerAddress: string | null } | null;
  history: Array<{ id: string; device: string; amount: number; date: string; status: string }>;
}

const conditionOptions = [
  { value: 'A', label: 'A — ดีเยี่ยม' },
  { value: 'B', label: 'B — ดี' },
  { value: 'C', label: 'C — พอใช้' },
  { value: 'D', label: 'D — ใช้งานหนัก' },
];

export default function QuickBuyModal({ open, onClose, onSuccess }: QuickBuyModalProps) {
  const [step, setStep] = useState(1);
  const [imeiCheckResult, setImeiCheckResult] = useState<{ result: 'clean' | 'duplicate'; count: number } | null>(null);
  const [sellerHistory, setSellerHistory] = useState<SellerHistoryResponse | null>(null);

  const [form, setForm] = useState({
    // Step 1: seller (address ใช้ AddressForm แยก state)
    sellerName: '',
    sellerPhone: '',
    sellerIdCardNumber: '',
    idCardPhotoBase64: '',
    idCardSource: '' as '' | 'card_reader' | 'upload',
    // Step 2: device
    deviceBrand: '',
    deviceModel: '',
    deviceStorage: '',
    deviceColor: '',
    deviceCondition: 'B',
    imei: '',
    agreedPrice: '',
    // Step 3: confirm
    paymentMethod: 'CASH' as 'CASH' | 'TRANSFER',
    transferBankName: '',
    transferAccountNumber: '',
    transferAccountName: '',
    sellerSignatureBase64: '',
    idCardVerified: false,
    sellerConsentSigned: false,
  });
  const [address, setAddress] = useState<AddressData>({ ...emptyAddress });

  function reset() {
    setStep(1);
    setImeiCheckResult(null);
    setSellerHistory(null);
    setAddress({ ...emptyAddress });
    setForm({
      sellerName: '', sellerPhone: '', sellerIdCardNumber: '',
      idCardPhotoBase64: '', idCardSource: '',
      deviceBrand: '', deviceModel: '', deviceStorage: '', deviceColor: '',
      deviceCondition: 'B', imei: '', agreedPrice: '',
      paymentMethod: 'CASH', transferBankName: '', transferAccountNumber: '', transferAccountName: '',
      sellerSignatureBase64: '', idCardVerified: false, sellerConsentSigned: false,
    });
  }

  function close() {
    reset();
    onClose();
  }

  const quickBuyMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        sellerName: form.sellerName,
        sellerPhone: form.sellerPhone || undefined,
        sellerIdCardNumber: form.sellerIdCardNumber || undefined,
        sellerAddress: composeAddress(address) || undefined,
        idCardPhotoBase64: form.idCardPhotoBase64 || undefined,
        idCardSource: form.idCardSource || undefined,
        deviceBrand: form.deviceBrand,
        deviceModel: form.deviceModel,
        deviceStorage: form.deviceStorage || undefined,
        deviceColor: form.deviceColor || undefined,
        deviceCondition: form.deviceCondition,
        imei: form.imei || undefined,
        agreedPrice: parseFloat(form.agreedPrice),
        idCardVerified: form.idCardVerified,
        sellerConsentSigned: form.sellerConsentSigned,
        sellerSignatureBase64: form.sellerSignatureBase64 || undefined,
        paymentMethod: form.paymentMethod,
        transferBankName: form.paymentMethod === 'TRANSFER' ? form.transferBankName : undefined,
        transferAccountNumber: form.paymentMethod === 'TRANSFER' ? form.transferAccountNumber : undefined,
        transferAccountName: form.paymentMethod === 'TRANSFER' ? form.transferAccountName : undefined,
      };
      return api.post('/trade-ins/quick-buy', payload);
    },
    onSuccess: (res) => {
      const { id, voucherNumber, imeiWarning } = res.data;
      if (imeiWarning) {
        toast.warning(`รับซื้อสำเร็จ — แต่พบ IMEI ซ้ำในระบบ โปรดตรวจสอบ`);
      } else {
        toast.success(`รับซื้อสำเร็จ — เลขที่ ${voucherNumber}`);
      }
      onSuccess(id, voucherNumber);
      close();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // ─── Card reader ─────────────────────────────────────
  async function readFromCardReader() {
    try {
      const d = await readSmartCard();
      const fullName = `${d.prefix || ''}${d.firstName || ''} ${d.lastName || ''}`.trim();
      setForm((f) => ({
        ...f,
        sellerName: fullName,
        sellerIdCardNumber: d.nationalId || '',
        idCardSource: 'card_reader',
      }));
      // Card-reader คืน addressStructured (field map ตรงกับ AddressData) → fill ตรง ๆ
      // postalCode จะถูก auto-complete โดย AddressForm effect เมื่อ province+district+subdistrict ครบ
      if (d.addressStructured) {
        setAddress({
          houseNo: d.addressStructured.houseNo || '',
          moo: d.addressStructured.moo || '',
          village: d.addressStructured.village || '',
          soi: d.addressStructured.soi || '',
          road: d.addressStructured.road || '',
          // Strip prefix ออกจาก subdistrict/district/province เพราะ dropdown ใช้ชื่อล้วน
          subdistrict: (d.addressStructured.subdistrict || '').replace(/^(ตำบล|แขวง|ต\.)\s*/g, ''),
          district: (d.addressStructured.district || '').replace(/^(อำเภอ|เขต|อ\.)\s*/g, ''),
          province: (d.addressStructured.province || '').replace(/^(จังหวัด|จ\.)\s*/g, ''),
          postalCode: '',
        });
      }
      // Auto-trigger seller history lookup
      if (d.nationalId) await fetchSellerHistory(d.nationalId);
      toast.success('อ่านบัตรเรียบร้อย');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ไม่พบเครื่องอ่านบัตร — ตรวจสอบว่า service รันอยู่');
    }
  }

  function handleIdCardUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast.error('ไฟล์ต้องไม่เกิน 5MB');
    const reader = new FileReader();
    reader.onload = () => {
      setForm((f) => ({
        ...f,
        idCardPhotoBase64: reader.result as string,
        idCardSource: 'upload',
      }));
      toast.success('อัปโหลดรูปบัตรเรียบร้อย');
    };
    reader.readAsDataURL(file);
  }

  // ─── Seller history (auto-fill) ──────────────────────
  async function fetchSellerHistory(idCard: string) {
    if (idCard.length !== 13) return;
    try {
      const res = await api.get(`/trade-ins/seller-history/${idCard}`);
      const data = res.data as SellerHistoryResponse;
      setSellerHistory(data);
      if (data.found && data.lastSeller) {
        // Auto-fill name + phone จากครั้งล่าสุด
        // หมายเหตุ: address ของ legacy เก็บเป็น composed string จะไม่ auto-fill ลง AddressForm structured fields
        // (พนักงานยังเห็นชื่อเดิม → กรอก address ใหม่ทับเองได้ หรืออ่านบัตรใหม่)
        setForm((f) => ({
          ...f,
          sellerName: f.sellerName || data.lastSeller!.sellerName || '',
          sellerPhone: f.sellerPhone || data.lastSeller!.sellerPhone || '',
        }));
        if (data.warning) {
          toast.warning(
            `⚠️ ผู้ขายรายนี้ขายมาแล้ว ${data.recentCount} ครั้งใน 30 วัน — โปรดตรวจสอบที่มาให้ละเอียด`,
            { duration: 8000 },
          );
        } else {
          toast.info(`พบประวัติผู้ขาย — เคยขายมาแล้ว ${data.totalCount} ครั้ง`);
        }
      }
    } catch {
      // silent
    }
  }

  // ─── IMEI check ──────────────────────────────────────
  async function checkImei() {
    if (!form.imei || !/^\d{15}$/.test(form.imei)) return setImeiCheckResult(null);
    try {
      const res = await api.get(`/trade-ins/check-imei/${form.imei}`);
      setImeiCheckResult({
        result: res.data.result,
        count: res.data.occurrences?.length ?? 0,
      });
      if (res.data.result === 'duplicate') {
        toast.error(`⚠️ IMEI นี้เคยถูกรับซื้อแล้ว — โปรดตรวจสอบ`);
      }
    } catch {
      // silent
    }
  }

  // ─── Step navigation ────────────────────────────────
  function next() {
    if (step === 1) {
      if (!form.sellerName.trim()) return toast.error('กรุณาระบุชื่อผู้ขาย');
      if (form.sellerIdCardNumber && form.sellerIdCardNumber.length !== 13) {
        return toast.error('เลขบัตรประชาชนต้อง 13 หลัก');
      }
    }
    if (step === 2) {
      if (!form.deviceBrand || !form.deviceModel) return toast.error('กรุณาเลือกยี่ห้อ + รุ่น');
      if (!form.agreedPrice || parseFloat(form.agreedPrice) <= 0) {
        return toast.error('กรุณาระบุราคารับซื้อ');
      }
      if (form.imei && !/^\d{15}$/.test(form.imei)) return toast.error('IMEI ต้องเป็น 15 หลัก');
    }
    setStep(step + 1);
  }
  function prev() { setStep(step - 1); }

  function submit() {
    if (!form.idCardVerified || !form.sellerConsentSigned) {
      return toast.error('กรุณายืนยันการตรวจบัตรและความยินยอม');
    }
    if (!form.sellerSignatureBase64) {
      return toast.error('กรุณาให้ผู้ขายลงลายเซ็น');
    }
    if (form.paymentMethod === 'TRANSFER') {
      if (!form.transferBankName || !form.transferAccountNumber || !form.transferAccountName) {
        return toast.error('กรุณากรอกข้อมูลการโอนให้ครบ');
      }
    }
    quickBuyMutation.mutate();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md flex items-start justify-center pt-6 pb-6"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-3xl bg-white dark:bg-slate-950 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-3rem)] ring-1 ring-slate-200 dark:ring-slate-800">
        {/* Header — sticky */}
        <div className="sticky top-0 z-10 bg-gradient-to-b from-emerald-50 to-white dark:from-emerald-950/30 dark:to-slate-950 border-b border-emerald-200/60 dark:border-emerald-900/40 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-sm">
              <ShoppingBag className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">รับซื้อมือถือมือสอง</h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">กรอกข้อมูลผู้ขาย เครื่อง และยืนยันการรับซื้อ</p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-50 text-sm font-medium"
          >
            ปิด ✕
          </button>
        </div>

        {/* Stepper */}
        <div className="px-6 py-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between max-w-md mx-auto">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center flex-1 last:flex-initial">
                <div
                  className={`size-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    s < step
                      ? 'bg-emerald-500 text-white'
                      : s === step
                      ? 'bg-emerald-600 text-white ring-4 ring-emerald-200 dark:ring-emerald-900/40'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                  }`}
                >
                  {s < step ? '✓' : s}
                </div>
                <div className="ml-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                  {s === 1 ? 'ผู้ขาย' : s === 2 ? 'เครื่อง + ราคา' : 'ยืนยัน + เซ็น'}
                </div>
                {s < 3 && <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800 mx-3" />}
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* ─── STEP 1: SELLER ─── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">ข้อมูลผู้ขาย</Label>
                <button
                  type="button"
                  onClick={readFromCardReader}
                  className="px-3 py-2 rounded-lg bg-sky-500 text-white text-xs font-semibold hover:bg-sky-600 flex items-center gap-1.5"
                >
                  <CreditCard className="size-3.5" />
                  อ่านบัตรประชาชน
                </button>
              </div>

              {sellerHistory?.found && (
                <div className={`rounded-lg p-3 text-xs flex gap-2 ${
                  sellerHistory.warning
                    ? 'bg-red-50 border border-red-200 text-red-800'
                    : 'bg-blue-50 border border-blue-200 text-blue-800'
                }`}>
                  <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                  <div>
                    {sellerHistory.warning ? (
                      <>
                        <div className="font-semibold mb-1">⚠️ ผู้ขายรายนี้มีประวัติผิดปกติ</div>
                        <div>ขายมาแล้ว {sellerHistory.recentCount} ครั้งใน 30 วันล่าสุด — รวมทั้งหมด {sellerHistory.totalCount} ครั้ง — โปรดตรวจสอบที่มาให้ละเอียดก่อนรับซื้อ</div>
                      </>
                    ) : (
                      <>เคยขายมาแล้ว {sellerHistory.totalCount} ครั้ง — ข้อมูลถูก auto-fill จากครั้งล่าสุด</>
                    )}
                  </div>
                </div>
              )}

              {/* ลำดับเหมือนฟอร์มข้อมูลลูกค้า: ชื่อ → เลขบัตร → เบอร์ → ที่อยู่ → แนบบัตร */}
              <div className="space-y-4">
                <div>
                  <Label>ชื่อ-นามสกุล *</Label>
                  <Input
                    className="mt-1"
                    placeholder="ชื่อ นามสกุล"
                    value={form.sellerName}
                    onChange={(e) => setForm((f) => ({ ...f, sellerName: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>เลขบัตรประชาชน</Label>
                  <Input
                    className="mt-1 font-mono"
                    maxLength={13}
                    placeholder="1234567890123"
                    value={form.sellerIdCardNumber}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '');
                      setForm((f) => ({ ...f, sellerIdCardNumber: v }));
                      if (v.length === 13) fetchSellerHistory(v);
                      else setSellerHistory(null);
                    }}
                  />
                </div>
                <div>
                  <Label>เบอร์โทร</Label>
                  <Input
                    className="mt-1"
                    type="tel"
                    placeholder="0812345678"
                    value={form.sellerPhone}
                    onChange={(e) => setForm((f) => ({ ...f, sellerPhone: e.target.value }))}
                  />
                </div>
                <AddressForm value={address} onChange={setAddress} label="ที่อยู่ตามบัตร" />
                <div>
                  <Label>แนบรูปบัตรประชาชน</Label>
                  <label className="mt-1 flex items-center justify-center gap-2 h-12 px-3 rounded-lg border border-dashed border-input bg-background text-sm cursor-pointer hover:border-sky-400 hover:bg-sky-50/50 transition-colors">
                    {form.idCardPhotoBase64 ? (
                      <>
                        <CheckCircle className="size-5 text-emerald-500" />
                        <span className="text-emerald-600 font-medium">อัปโหลดแล้ว — คลิกเพื่อเปลี่ยน</span>
                      </>
                    ) : (
                      <>
                        <Upload className="size-5 text-muted-foreground" />
                        <span className="text-muted-foreground">คลิกเพื่อเลือกไฟล์รูปบัตรประชาชน</span>
                      </>
                    )}
                    <input type="file" accept="image/*" className="hidden" onChange={handleIdCardUpload} />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* ─── STEP 2: DEVICE + PRICE ─── */}
          {step === 2 && (
            <div className="space-y-4">
              <Label className="text-sm font-semibold">ข้อมูลเครื่องและราคา</Label>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>ยี่ห้อ *</Label>
                  <select
                    className="mt-1 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm"
                    value={form.deviceBrand}
                    onChange={(e) => setForm((f) => ({ ...f, deviceBrand: e.target.value, deviceModel: '', deviceStorage: '', deviceColor: '' }))}
                  >
                    <option value="">-- เลือก --</option>
                    {brands.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <Label>รุ่น *</Label>
                  <select
                    className="mt-1 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-50"
                    value={form.deviceModel}
                    onChange={(e) => setForm((f) => ({ ...f, deviceModel: e.target.value, deviceStorage: '', deviceColor: '' }))}
                    disabled={!form.deviceBrand}
                  >
                    <option value="">-- เลือก --</option>
                    {form.deviceBrand && getModels(form.deviceBrand).map((m) => (
                      <option key={m.name} value={m.name}>{m.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>ความจุ</Label>
                  <select
                    className="mt-1 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-50"
                    value={form.deviceStorage}
                    onChange={(e) => setForm((f) => ({ ...f, deviceStorage: e.target.value }))}
                    disabled={!form.deviceModel}
                  >
                    <option value="">-- เลือก --</option>
                    {form.deviceBrand && form.deviceModel &&
                      (getModels(form.deviceBrand).find((m) => m.name === form.deviceModel)?.storage || []).map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                  </select>
                </div>
                <div>
                  <Label>สี</Label>
                  <select
                    className="mt-1 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-50"
                    value={form.deviceColor}
                    onChange={(e) => setForm((f) => ({ ...f, deviceColor: e.target.value }))}
                    disabled={!form.deviceModel}
                  >
                    <option value="">-- เลือก --</option>
                    {form.deviceBrand && form.deviceModel &&
                      (getModels(form.deviceBrand).find((m) => m.name === form.deviceModel)?.colors || []).map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                  </select>
                </div>
                <div>
                  <Label>สภาพเครื่อง</Label>
                  <select
                    className="mt-1 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm"
                    value={form.deviceCondition}
                    onChange={(e) => setForm((f) => ({ ...f, deviceCondition: e.target.value }))}
                  >
                    {conditionOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <Label>IMEI</Label>
                  <Input
                    className="mt-1 font-mono"
                    maxLength={15}
                    placeholder="15 หลัก"
                    value={form.imei}
                    onChange={(e) => { setForm((f) => ({ ...f, imei: e.target.value.replace(/\D/g, '') })); setImeiCheckResult(null); }}
                    onBlur={checkImei}
                  />
                  {imeiCheckResult && (
                    <div className={`mt-1 flex items-center gap-1.5 text-xs ${
                      imeiCheckResult.result === 'clean' ? 'text-emerald-600' : 'text-red-600'
                    }`}>
                      {imeiCheckResult.result === 'clean' ? (
                        <><CheckCircle className="size-3" /> ไม่พบ IMEI ซ้ำ</>
                      ) : (
                        <><AlertTriangle className="size-3" /> พบ IMEI นี้ในระบบ {imeiCheckResult.count} ครั้ง</>
                      )}
                    </div>
                  )}
                </div>
                <div className="col-span-2">
                  <Label>ราคารับซื้อ (บาท) *</Label>
                  <Input
                    className="mt-1 text-lg font-bold"
                    type="number"
                    placeholder="0"
                    value={form.agreedPrice}
                    onChange={(e) => setForm((f) => ({ ...f, agreedPrice: e.target.value }))}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ─── STEP 3: CONFIRM + SIGN ─── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 flex gap-2">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <div>กรุณายืนยันขั้นตอนป้องกันการรับซื้อของโจรก่อนกดบันทึก</div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-4 text-sm space-y-1">
                <div><strong>ผู้ขาย:</strong> {form.sellerName}</div>
                <div><strong>เครื่อง:</strong> {form.deviceBrand} {form.deviceModel} {form.deviceStorage}</div>
                <div><strong>ราคารับซื้อ:</strong> <span className="text-lg font-bold text-emerald-600">฿{Number(form.agreedPrice || 0).toLocaleString()}</span></div>
              </div>

              <label className="flex items-start gap-2 cursor-pointer p-2 rounded-lg hover:bg-muted">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={form.idCardVerified}
                  onChange={(e) => setForm((f) => ({ ...f, idCardVerified: e.target.checked }))}
                />
                <span className="text-sm">ตรวจบัตรประชาชนผู้ขายแล้วและตรงกับใบหน้า</span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer p-2 rounded-lg hover:bg-muted">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={form.sellerConsentSigned}
                  onChange={(e) => setForm((f) => ({ ...f, sellerConsentSigned: e.target.checked }))}
                />
                <span className="text-sm">ผู้ขายเซ็นยืนยันว่าเป็นเจ้าของเครื่องโดยชอบด้วยกฎหมาย</span>
              </label>

              <div className="border-t pt-3">
                <Label>วิธีชำระเงิน *</Label>
                <div className="flex gap-2 mt-1.5">
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, paymentMethod: 'CASH' }))}
                    className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                      form.paymentMethod === 'CASH'
                        ? 'bg-emerald-500 text-white border-emerald-500'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-emerald-300'
                    }`}
                  >เงินสด</button>
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, paymentMethod: 'TRANSFER' }))}
                    className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                      form.paymentMethod === 'TRANSFER'
                        ? 'bg-sky-500 text-white border-sky-500'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-sky-300'
                    }`}
                  >โอน</button>
                </div>
                {form.paymentMethod === 'TRANSFER' && (
                  <div className="space-y-2 mt-3">
                    <Input placeholder="ธนาคาร เช่น กสิกรไทย" value={form.transferBankName} onChange={(e) => setForm((f) => ({ ...f, transferBankName: e.target.value }))} />
                    <Input placeholder="เลขบัญชี" value={form.transferAccountNumber} onChange={(e) => setForm((f) => ({ ...f, transferAccountNumber: e.target.value.replace(/[^\d-]/g, '') }))} />
                    <Input placeholder="ชื่อบัญชี" value={form.transferAccountName} onChange={(e) => setForm((f) => ({ ...f, transferAccountName: e.target.value }))} />
                  </div>
                )}
              </div>

              <div className="border-t pt-3">
                <Label>ลายเซ็นผู้ขาย *</Label>
                <p className="text-xs text-muted-foreground mb-2">ผู้ขายลงนามยืนยันการขายและความเป็นเจ้าของ</p>
                <SignaturePadFull
                  onSign={() => { /* submit ผ่านปุ่มล่าง */ }}
                  onDraftChange={(d) => setForm((f) => ({ ...f, sellerSignatureBase64: d || '' }))}
                  buttonText=""
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer — sticky */}
        <div className="sticky bottom-0 bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 px-6 py-4 flex justify-between gap-3">
          <Button variant="outline" onClick={prev} disabled={step === 1}>
            <ChevronLeft className="size-4 mr-1" /> ย้อนกลับ
          </Button>
          <Badge variant="outline" className="text-xs self-center">
            ขั้นที่ {step} / 3
          </Badge>
          {step < 3 ? (
            <Button onClick={next}>
              ถัดไป <ChevronRight className="size-4 ml-1" />
            </Button>
          ) : (
            <Button
              onClick={submit}
              disabled={quickBuyMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
            >
              {quickBuyMutation.isPending ? 'กำลังบันทึก...' : '✓ บันทึก + ออกใบสำคัญ'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
