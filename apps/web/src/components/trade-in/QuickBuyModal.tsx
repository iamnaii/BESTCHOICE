import { isAxiosError } from 'axios';
import { TRADE_IN_DECLARATION_VERSION, tradeInEvidenceError, tradeInSellerEvidenceError } from '@installment/shared';
import SellerDeclaration from './SellerDeclaration';
import { useState, useRef, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
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
  Check,
} from 'lucide-react';
import { brands, getModels } from '@/data/productCatalog';
import SignaturePadFull from '@/components/signing/SignaturePadFull';
import AddressForm, { type AddressData, emptyAddress, composeAddress } from '@/components/ui/AddressForm';
import SellerPaymentFields from './SellerPaymentFields';
import { ContactCombobox } from '@/components/contacts/ContactCombobox';
import { contactsApi } from '@/lib/api/contacts';

export interface QuickBuyResult {
  id: string;
  productId: string;
  productStatus: string;
  voucherNumber: string;
}

interface QuickBuyModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (result: QuickBuyResult) => void;
  onIncomplete: (id: string) => void;
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

export default function QuickBuyModal({ open, onClose, onSuccess, onIncomplete }: QuickBuyModalProps) {
  const { user } = useAuth();
  const storageKey = `bc:quick-buy:pending:${user?.id}`;
  const requestId = useRef<string | null>(null);
  const sellerEpoch = useRef(0);
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState(false);
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const recoveryHandlers = useRef({ onIncomplete, onClose });
  recoveryHandlers.current = { onIncomplete, onClose: close };
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const pending = sessionStorage.getItem(storageKey);
    requestId.current = pending;
    setRecoveryError(false);
    if (!pending) { setRecovering(false); return; }
    setRecovering(true);
    api.get(`/trade-ins/quick-buy/requests/${pending}`).then(({ data }) => {
      if (cancelled) return;
      if (data.found) {
        recoveryHandlers.current.onIncomplete(data.id);
        sessionStorage.removeItem(storageKey);
        requestId.current = null;
        recoveryHandlers.current.onClose();
      }
    }).catch(() => { if (!cancelled) setRecoveryError(true); })
      .finally(() => { if (!cancelled) setRecovering(false); });
    return () => { cancelled = true; };
  }, [open, storageKey, recoveryAttempt]);
  const [step, setStep] = useState(1);
  const [branchId, setBranchId] = useState<string>(user?.branchId ?? '');
  const [imeiCheckResult, setImeiCheckResult] = useState<{ result: 'clean' | 'duplicate'; count: number } | null>(null);
  const [sellerHistory, setSellerHistory] = useState<SellerHistoryResponse | null>(null);

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
    enabled: open,
  });

  const [form, setForm] = useState({
    // Step 1: seller (address ใช้ AddressForm แยก state)
    sellerContactId: '',  // contact FK (party master)
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
    serialNumber: '',
    imeiMissingReason: '',
    serialNumberMissingReason: '',
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
    sellerEpoch.current++;
    setStep(1);
    setBranchId(user?.branchId ?? '');
    setImeiCheckResult(null);
    setSellerHistory(null);
    setAddress({ ...emptyAddress });
    setForm({
      sellerContactId: '', sellerName: '', sellerPhone: '', sellerIdCardNumber: '',
      idCardPhotoBase64: '', idCardSource: '',
      deviceBrand: '', deviceModel: '', deviceStorage: '', deviceColor: '',
      deviceCondition: 'B', imei: '', serialNumber: '', imeiMissingReason: '', serialNumberMissingReason: '', agreedPrice: '',
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
      requestId.current ??= crypto.randomUUID();
      // Store only the request key. Never persist identity, card images or signatures.
      sessionStorage.setItem(storageKey, requestId.current);
      const payload = {
        requestId: requestId.current,
        branchId: branchId || undefined,
        sellerContactId: form.sellerContactId || undefined,
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
        serialNumber: form.serialNumber.trim() || undefined,
        imeiMissingReason: form.imei ? undefined : form.imeiMissingReason.trim(),
        serialNumberMissingReason: form.serialNumber.trim() ? undefined : form.serialNumberMissingReason.trim(),
        agreedPrice: parseFloat(form.agreedPrice),
        idCardVerified: form.idCardVerified,
        sellerConsentSigned: form.sellerConsentSigned,
        declarationVersion: TRADE_IN_DECLARATION_VERSION,
        sellerSignatureBase64: form.sellerSignatureBase64 || undefined,
        paymentMethod: form.paymentMethod,
        transferBankName: form.paymentMethod === 'TRANSFER' ? form.transferBankName : undefined,
        transferAccountNumber: form.paymentMethod === 'TRANSFER' ? form.transferAccountNumber : undefined,
        transferAccountName: form.paymentMethod === 'TRANSFER' ? form.transferAccountName : undefined,
      };
      return api.post('/trade-ins/quick-buy', payload);
    },
    onSuccess: (res) => {
      sessionStorage.removeItem(storageKey);
      requestId.current = null;
      const { voucherNumber, imeiWarning } = res.data;
      if (imeiWarning) {
        toast.warning(`รับซื้อสำเร็จ — แต่พบ IMEI ซ้ำในระบบ โปรดตรวจสอบ`);
      } else {
        toast.success(`รับซื้อสำเร็จ — เลขที่ ${voucherNumber}`);
      }
      onSuccess(res.data);
      close();
    },
    onError: (err) => {
      toast.error(getErrorMessage(err));
      const id = isAxiosError(err) ? err.response?.data?.tradeInId : undefined;
      if (typeof id === 'string') {
        onIncomplete(id);
        sessionStorage.removeItem(storageKey);
        requestId.current = null;
        close();
      }
    },
  });

  // ─── Card reader ─────────────────────────────────────
  async function readFromCardReader() {
    const epoch = sellerEpoch.current;
    try {
      const d = await readSmartCard();
      if (epoch !== sellerEpoch.current) return;
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
    const epoch = sellerEpoch.current;
    reader.onload = () => {
      if (epoch !== sellerEpoch.current) return;
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
    const epoch = sellerEpoch.current;
    try {
      const res = await api.get(`/trade-ins/seller-history/${idCard}`);
      if (epoch !== sellerEpoch.current) return;
      const data = res.data as SellerHistoryResponse;
      setSellerHistory(data);
      if (data.found && data.lastSeller) {
        // Auto-fill name + phone จากครั้งล่าสุด เฉพาะกรณีที่ contact picker ยังไม่ถูกเลือก
        // หมายเหตุ: address ของ legacy เก็บเป็น composed string จะไม่ auto-fill ลง AddressForm structured fields
        setForm((f) => ({
          ...f,
          sellerName: f.sellerContactId ? f.sellerName : (f.sellerName || data.lastSeller!.sellerName || ''),
          sellerPhone: f.sellerContactId ? f.sellerPhone : (f.sellerPhone || data.lastSeller!.sellerPhone || ''),
        }));
        if (data.warning) {
          toast.warning(
            `ผู้ขายรายนี้ขายมาแล้ว ${data.recentCount} ครั้งใน 30 วัน — โปรดตรวจสอบที่มาให้ละเอียด`,
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

  // ─── Seller contact picker ───────────────────────────
  async function handleSellerSelect({ contactId, name }: { contactId: string; name: string }) {
    const epoch = ++sellerEpoch.current;
    setAddress({ ...emptyAddress });
    setSellerHistory(null);
    setForm((f) => ({ ...f, sellerContactId: contactId, sellerName: name, sellerPhone: '',
      sellerIdCardNumber: '', idCardPhotoBase64: '', idCardSource: '',
      idCardVerified: false, sellerConsentSigned: false, sellerSignatureBase64: '' }));
    // Fetch the contact detail to populate phone (best-effort; non-blocking)
    try {
      const detail = await contactsApi.detail(contactId);
      if (epoch !== sellerEpoch.current) return;
      if (detail.phone) {
        setForm((f) => ({ ...f, sellerPhone: detail.phone ?? '' }));
      }
    } catch {
      // The operator can enter the phone manually.
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
        toast.error(`IMEI นี้เคยถูกรับซื้อแล้ว — โปรดตรวจสอบ`);
      }
    } catch {
      // silent
    }
  }

  // ─── Step navigation ────────────────────────────────
  function next() {
    if (step === 1) {
      if (!branchId) return toast.error('กรุณาเลือกสาขาที่รับซื้อ');
      if (!form.sellerContactId) return toast.error('กรุณาเลือกผู้ขายจากรายชื่อผู้ติดต่อ');
      const error = tradeInSellerEvidenceError({ ...form, sellerAddress: composeAddress(address) });
      if (error) return toast.error(error);
    }
    if (step === 2) {
      if (!form.deviceBrand || !form.deviceModel) return toast.error('กรุณาเลือกยี่ห้อ + รุ่น');
      if (!form.agreedPrice || parseFloat(form.agreedPrice) <= 0) {
        return toast.error('กรุณาระบุราคารับซื้อ');
      }
      if (form.imei && !/^\d{15}$/.test(form.imei)) return toast.error('IMEI ต้องเป็น 15 หลัก');
      const error = tradeInEvidenceError({ ...form, sellerAddress: composeAddress(address) });
      if (error) return toast.error(error);
    }
    setStep(step + 1);
  }
  function prev() {
    // Identity/device/price edits require a fresh check and seller signature.
    setForm((f) => ({ ...f, idCardVerified: false, sellerConsentSigned: false, sellerSignatureBase64: '' }));
    setStep(step - 1);
  }

  function submit() {
    if (recovering || recoveryError) return;
    const evidenceError = tradeInEvidenceError({ ...form, sellerAddress: composeAddress(address) });
    if (evidenceError) return toast.error(evidenceError);
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
      className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-md flex items-start justify-center pt-6 pb-6"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-3xl bg-card rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-3rem)] ring-1 ring-border">
        {/* Header — sticky */}
        <div className="sticky top-0 z-10 bg-linear-to-b from-success/10 to-card border-b border-success/30 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-success text-success-foreground flex items-center justify-center shadow-sm">
              <ShoppingBag className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">รับซื้อมือถือมือสอง</h2>
              <p className="text-xs text-muted-foreground">รับเครื่องและจ่ายเงินให้ผู้ขาย แล้วเตรียมรูปและราคาขาย</p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={quickBuyMutation.isPending}
            className="text-muted-foreground hover:text-foreground text-sm font-medium"
          >
            ปิด
          </button>
        </div>

        {/* Stepper */}
        <div className="px-6 py-3 bg-muted/50 border-b border-border">
          <div className="flex items-center justify-between max-w-md mx-auto">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center flex-1 last:flex-initial">
                <div
                  className={`size-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    s < step
                      ? 'bg-success text-success-foreground'
                      : s === step
                      ? 'bg-success text-success-foreground ring-4 ring-success/20'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {s < step ? <Check className="size-4" /> : s}
                </div>
                <div className="ml-2 text-xs font-medium text-foreground">
                  {s === 1 ? 'ผู้ขาย' : s === 2 ? 'ตรวจเครื่อง + ราคา' : 'จ่ายเงิน + เซ็น'}
                </div>
                {s < 3 && <div className="flex-1 h-px bg-border mx-3" />}
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {recovering && <p role="status">กำลังตรวจรายการที่ส่งไว้ก่อนหน้า…</p>}
          {recoveryError && <div role="alert" className="mb-4 text-destructive">ยังตรวจสถานะรายการเดิมไม่ได้ กรุณาตรวจอีกครั้งก่อนรับซื้อใหม่ <Button variant="outline" onClick={() => setRecoveryAttempt((n) => n + 1)}>ตรวจอีกครั้ง</Button></div>}
          {/* ─── STEP 1: SELLER ─── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-semibold">สาขาที่รับซื้อ *</Label>
                <select
                  className="mt-1 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm"
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                >
                  <option value="">-- เลือกสาขา --</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">ข้อมูลผู้ขาย</Label>
                <button
                  type="button"
                  onClick={readFromCardReader}
                  className="px-3 py-2 rounded-lg bg-info text-info-foreground text-xs font-semibold hover:bg-info/90 flex items-center gap-1.5"
                >
                  <CreditCard className="size-3.5" />
                  อ่านบัตรประชาชน
                </button>
              </div>

              {sellerHistory?.found && (
                <div className={`rounded-lg p-3 text-xs flex gap-2 ${
                  sellerHistory.warning
                    ? 'bg-destructive/10 border border-destructive/20 text-destructive'
                    : 'bg-info/10 border border-info/20 text-info'
                }`}>
                  <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                  <div>
                    {sellerHistory.warning ? (
                      <>
                        <div className="font-semibold mb-1 flex items-center gap-1.5"><AlertTriangle className="size-4" /> ผู้ขายรายนี้มีประวัติผิดปกติ</div>
                        <div>ขายมาแล้ว {sellerHistory.recentCount} ครั้งใน 30 วันล่าสุด — รวมทั้งหมด {sellerHistory.totalCount} ครั้ง — โปรดตรวจสอบที่มาให้ละเอียดก่อนรับซื้อ</div>
                      </>
                    ) : (
                      <>เคยขายมาแล้ว {sellerHistory.totalCount} ครั้ง — ข้อมูลถูก auto-fill จากครั้งล่าสุด</>
                    )}
                  </div>
                </div>
              )}

              {/* ลำดับเหมือนฟอร์มข้อมูลลูกค้า: ผู้ขาย (picker) → เลขบัตร → ที่อยู่ → แนบบัตร */}
              <div className="space-y-4">
                <div>
                  <Label>ผู้ขาย *</Label>
                  <div className="mt-1">
                    <ContactCombobox
                      roleNeeded="TRADE_IN_SELLER"
                      value={form.sellerName}
                      onSelect={handleSellerSelect}
                      placeholder="ค้นหาหรือสร้างผู้ขาย"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="buy-seller-name">ชื่อผู้ขายตามบัตรประชาชน *</Label>
                  <Input id="buy-seller-name" value={form.sellerName} onChange={(e) => setForm((f) => ({ ...f, sellerName: e.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="buy-seller-phone">เบอร์โทรผู้ขาย *</Label>
                  <Input id="buy-seller-phone" inputMode="tel" maxLength={10} value={form.sellerPhone} onChange={(e) => setForm((f) => ({ ...f, sellerPhone: e.target.value.replace(/\D/g, '') }))} />
                </div>
                <div>
                  <Label htmlFor="buy-seller-id">เลขบัตรประชาชน *</Label>
                  <Input
                    id="buy-seller-id"
                    className="mt-1 font-mono"
                    maxLength={13}
                    placeholder="1234567890123"
                    value={form.sellerIdCardNumber}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '');
                      sellerEpoch.current++;
                      setForm((f) => ({ ...f, sellerIdCardNumber: v }));
                      if (v.length === 13) fetchSellerHistory(v);
                      else setSellerHistory(null);
                    }}
                  />
                </div>
                <AddressForm value={address} onChange={setAddress} label="ที่อยู่ตามบัตร" />
                <div>
                  <Label>แนบรูปบัตรประชาชน</Label>
                  <label className="mt-1 flex items-center justify-center gap-2 h-12 px-3 rounded-lg border border-dashed border-input bg-background text-sm cursor-pointer hover:border-info/60 hover:bg-info/5 transition-colors">
                    {form.idCardPhotoBase64 ? (
                      <>
                        <CheckCircle className="size-5 text-success" />
                        <span className="text-success font-medium">อัปโหลดแล้ว — คลิกเพื่อเปลี่ยน</span>
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
              <p className="text-xs text-muted-foreground">บันทึกหมายเลขจากตัวเครื่องอย่างน้อยหนึ่งรายการ หากไม่มีอีกหมายเลข ให้ระบุเหตุผล</p>
              {!form.imei && <div><Label htmlFor="buy-imei-reason">เหตุผลที่ไม่มี IMEI *</Label><Input id="buy-imei-reason" maxLength={300} value={form.imeiMissingReason} onChange={(e) => setForm((f) => ({ ...f, imeiMissingReason: e.target.value }))} placeholder="เช่น รุ่น Wi-Fi ไม่มี IMEI" /></div>}
              {!form.serialNumber.trim() && <div><Label htmlFor="buy-serial-reason">เหตุผลที่ไม่มี Serial Number *</Label><Input id="buy-serial-reason" maxLength={300} value={form.serialNumberMissingReason} onChange={(e) => setForm((f) => ({ ...f, serialNumberMissingReason: e.target.value }))} /></div>}
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
                  <Label htmlFor="quick-buy-imei">IMEI</Label>
                  <Input
                    className="mt-1 font-mono"
                    id="quick-buy-imei"
                    inputMode="numeric"
                    maxLength={15}
                    placeholder="15 หลัก"
                    value={form.imei}
                    onChange={(e) => { setForm((f) => ({ ...f, imei: e.target.value.replace(/\D/g, '') })); setImeiCheckResult(null); }}
                    onBlur={checkImei}
                  />
                  {imeiCheckResult && (
                    <div className={`mt-1 flex items-center gap-1.5 text-xs ${
                      imeiCheckResult.result === 'clean' ? 'text-success' : 'text-destructive'
                    }`}>
                      {imeiCheckResult.result === 'clean' ? (
                        <><CheckCircle className="size-3" /> ไม่พบ IMEI ซ้ำ</>
                      ) : (
                        <><AlertTriangle className="size-3" /> พบ IMEI นี้ในระบบ {imeiCheckResult.count} ครั้ง</>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <Label htmlFor="quick-buy-serial">Serial Number</Label>
                  <Input id="quick-buy-serial" className="mt-1 font-mono" maxLength={100}
                    placeholder="หมายเลขเครื่องจากตัวเครื่องหรือการตั้งค่า"
                    value={form.serialNumber}
                    onChange={(e) => setForm((f) => ({ ...f, serialNumber: e.target.value }))} />
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
              <div className="rounded-lg bg-warning/10 border border-warning/20 p-3 text-xs text-warning flex gap-2">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <div>กรุณายืนยันขั้นตอนป้องกันการรับซื้อของโจรก่อนกดบันทึก</div>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-1">
                <div><strong>ประเภท:</strong> รับซื้อ — จ่ายเงินให้ผู้ขาย</div>
                <div><strong>ผู้ขาย:</strong> {form.sellerName}</div>
                <div className="break-all"><strong>IMEI:</strong> {form.imei || 'ไม่ระบุ'}</div>
                <div className="break-all"><strong>Serial Number:</strong> {form.serialNumber.trim() || 'ไม่ระบุ'}</div>
                <div><strong>เครื่อง:</strong> {form.deviceBrand} {form.deviceModel} {form.deviceStorage}</div>
                <div><strong>ราคารับซื้อ:</strong> <span className="text-lg font-bold text-success">฿{Number(form.agreedPrice || 0).toLocaleString()}</span></div>
              </div>

              <label className="flex items-start gap-2 cursor-pointer p-2 rounded-lg hover:bg-muted">
                <input
                  type="checkbox"
                  disabled={quickBuyMutation.isPending}
                  className="mt-1"
                  checked={form.idCardVerified}
                  onChange={(e) => setForm((f) => ({ ...f, idCardVerified: e.target.checked }))}
                />
                <span className="text-sm">ตรวจบัตรประชาชนผู้ขายแล้วและตรงกับใบหน้า</span>
              </label>
              <SellerDeclaration />
              <label className="flex items-start gap-2 cursor-pointer p-2 rounded-lg hover:bg-muted">
                <input
                  type="checkbox"
                  disabled={quickBuyMutation.isPending}
                  className="mt-1"
                  checked={form.sellerConsentSigned}
                  onChange={(e) => setForm((f) => ({ ...f, sellerConsentSigned: e.target.checked }))}
                />
                <span className="text-sm">ผู้ขายได้อ่านและยอมรับคำรับรองผู้ขายทุกข้อ</span>
              </label>

              <SellerPaymentFields value={form} disabled={quickBuyMutation.isPending}
                onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />

              <div className="border-t pt-3">
                <Label className="mt-3 block">ลายเซ็นผู้ขาย *</Label>
                <p className="text-xs text-muted-foreground mb-2">ลงนามยืนยันรายการรับเครื่องและคำรับรองผู้ขายข้างต้น</p>
                <SignaturePadFull
                  isPending={quickBuyMutation.isPending}
                  initialImage={form.sellerSignatureBase64}
                  onSign={() => { /* submit ผ่านปุ่มล่าง */ }}
                  onDraftChange={(d) => setForm((f) => ({ ...f, sellerSignatureBase64: d || '' }))}
                  buttonText=""
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer — sticky */}
        <div className="sticky bottom-0 bg-card border-t border-border px-6 py-4 flex justify-between gap-3">
          <Button variant="outline" onClick={prev} disabled={step === 1 || quickBuyMutation.isPending}>
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
              disabled={quickBuyMutation.isPending || recovering || recoveryError}
              className="bg-success hover:bg-success/90 text-success-foreground font-bold"
            >
              {quickBuyMutation.isPending ? 'กำลังบันทึก...' : <><Check className="size-4 mr-1.5 inline" />บันทึก + ออกใบสำคัญ</>}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
