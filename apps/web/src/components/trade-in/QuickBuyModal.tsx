import { isAxiosError } from 'axios';
import {
  TRADE_IN_DECLARATION_VERSION,
  tradeInEvidenceError,
  tradeInSellerEvidenceError,
  tradeInDeviceEvidenceError,
  type BuybackQuestionsResponse,
  type BuybackQuoteResult,
} from '@installment/shared';
import SellerDeclaration from './SellerDeclaration';
import { useState, useRef, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DeviceDisclosureFields } from '@/components/product/DeviceDisclosureFields';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { readSmartCard } from '@/lib/cardReader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Upload,
  AlertTriangle,
  ShoppingBag,
  Check,
  Smartphone,
  X,
} from 'lucide-react';
import InspectionQuestions, { isQuestionAnswered } from './InspectionQuestions';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogPortal,
  DialogOverlay,
} from '@/components/ui/dialog';
import SignaturePadFull from '@/components/signing/SignaturePadFull';
import AddressForm, {
  type AddressData,
  emptyAddress,
  composeAddress,
} from '@/components/ui/AddressForm';
import SellerPaymentFields from './SellerPaymentFields';
import { ContactCombobox } from '@/components/contacts/ContactCombobox';
import { contactsApi } from '@/lib/api/contacts';
import { getModels } from '@/data/productCatalog';
import PurchaseSelect from './PurchaseSelect';

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
  lastSeller: {
    sellerName: string;
    sellerPhone: string | null;
    sellerAddress: string | null;
  } | null;
  history: Array<{ id: string; device: string; amount: number; date: string; status: string }>;
}

interface BuybackCatalog {
  models: Array<{ model: string; storages: Array<{ storage: string; maxPrice: string }> }>;
}
type PurchaseQuote = BuybackQuoteResult & { previewToken?: string };
const purchaseSteps = ['เลือกเครื่อง', 'ตรวจสภาพ + ราคา', 'ผู้ขาย', 'จ่ายเงิน + เซ็น'];
const purchaseActionClass =
  'min-h-11 rounded-lg px-5 text-sm bg-[color-mix(in_srgb,var(--color-primary)_85%,var(--color-foreground))] hover:bg-[color-mix(in_srgb,var(--color-primary)_75%,var(--color-foreground))] dark:bg-primary dark:text-background dark:hover:bg-primary/90';
const money = (value: string | number) =>
  `฿${Number(value).toLocaleString('th-TH', { maximumFractionDigits: 2 })}`;

export default function QuickBuyModal({
  open,
  onClose,
  onSuccess,
  onIncomplete,
}: QuickBuyModalProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
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
    if (!pending) {
      setRecovering(false);
      return;
    }
    setRecovering(true);
    api
      .get(`/trade-ins/quick-buy/requests/${pending}`)
      .then(({ data }) => {
        if (cancelled) return;
        if (data.found) {
          recoveryHandlers.current.onIncomplete(data.id);
          sessionStorage.removeItem(storageKey);
          requestId.current = null;
          recoveryHandlers.current.onClose();
        }
      })
      .catch(() => {
        if (!cancelled) setRecoveryError(true);
      })
      .finally(() => {
        if (!cancelled) setRecovering(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, storageKey, recoveryAttempt]);
  const [step, setStep] = useState(1);
  const bodyRef = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [deviceEligibilityConfirmed, setDeviceEligibilityConfirmed] = useState(false);
  useEffect(() => {
    bodyRef.current?.scrollTo?.({ top: 0 });
  }, [step]);
  const [branchId, setBranchId] = useState<string>(user?.branchId ?? '');
  const [imeiCheckResult, setImeiCheckResult] = useState<{
    result: 'clean' | 'duplicate';
    count: number;
  } | null>(null);
  const [sellerHistory, setSellerHistory] = useState<SellerHistoryResponse | null>(null);

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
    enabled: open,
  });

  const [form, setForm] = useState({
    deviceOrigin: '', shopWarrantyDays: '', warrantyTerms: '',
    // Step 3: seller (address ใช้ AddressForm แยก state)
    sellerContactId: '', // contact FK (party master)
    sellerName: '',
    sellerPhone: '',
    sellerIdCardNumber: '',
    idCardPhotoBase64: '',
    idCardSource: '' as '' | 'card_reader' | 'upload',
    // Step 1: device
    deviceBrand: 'Apple',
    deviceModel: '',
    deviceStorage: '',
    deviceColor: '',
    imei: '',
    serialNumber: '',
    imeiMissingReason: '',
    serialNumberMissingReason: '',
    // Step 4: confirm
    paymentMethod: 'CASH' as 'CASH' | 'TRANSFER',
    transferBankName: '',
    transferAccountNumber: '',
    transferAccountName: '',
    sellerSignatureBase64: '',
    idCardVerified: false,
    sellerConsentSigned: false,
  });
  const [address, setAddress] = useState<AddressData>({ ...emptyAddress });

  const catalog = useQuery<BuybackCatalog>({
    queryKey: ['quick-buy-catalog'],
    queryFn: ({ signal }) =>
      api.get('/trade-ins/quick-buy/catalog', { signal }).then((r) => r.data),
    enabled: open,
    staleTime: 0,
    retry: false,
  });
  const modelOptions = catalog.data?.models ?? [];
  const storageOptions =
    modelOptions.find((entry) => entry.model === form.deviceModel)?.storages ?? [];
  const colorOptions =
    getModels(form.deviceBrand).find(
      (model) => model.name.toLowerCase() === form.deviceModel.trim().toLowerCase(),
    )?.colors ?? [];
  const questionnaire = useQuery<BuybackQuestionsResponse>({
    queryKey: ['quick-buy-questions', form.deviceModel, form.deviceStorage],
    queryFn: ({ signal }) =>
      api
        .get('/trade-ins/quick-buy/questions', {
          params: { model: form.deviceModel, storage: form.deviceStorage },
          signal,
        })
        .then((r) => r.data),
    enabled: open && !!form.deviceModel && !!form.deviceStorage,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const questions = questionnaire.data?.questions ?? [];
  const completed = questions.filter((question) => isQuestionAnswered(question, selected)).length;
  const inspectionComplete =
    questions.length > 0 &&
    completed === questions.length &&
    (!questionnaire.data?.eligibilityRequired || deviceEligibilityConfirmed);
  const answers = questions.map((question) => ({
    questionKey: question.key,
    choiceIds: [...(selected[question.key] ?? [])].sort(),
  }));
  const eligibility = questionnaire.data?.eligibilityRequired ? { deviceEligibilityConfirmed } : {};
  const preview = useQuery<PurchaseQuote>({
    queryKey: [
      'quick-buy-preview',
      form.deviceModel,
      form.deviceStorage,
      questionnaire.data,
      answers,
      eligibility,
    ],
    queryFn: ({ signal }) =>
      api
        .post(
          '/trade-ins/quick-buy/preview',
          {
            deviceBrand: 'Apple',
            deviceModel: form.deviceModel,
            deviceStorage: form.deviceStorage,
            answers,
            ...eligibility,
          },
          { signal },
        )
        .then((r) => r.data),
    enabled:
      open &&
      step >= 2 &&
      inspectionComplete &&
      !questionnaire.isFetching &&
      !questionnaire.isError,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const quote =
    inspectionComplete &&
    !preview.isFetching &&
    !preview.isError &&
    !questionnaire.isFetching &&
    !questionnaire.isError
      ? preview.data
      : undefined;
  const priceReady = !!(
    quote?.available &&
    quote.previewToken &&
    quote.grade &&
    Number.isFinite(Number(quote.cashPrice)) &&
    Number(quote.cashPrice) > 0
  );
  const clearInspection = () => {
    setSelected({});
    setDeviceEligibilityConfirmed(false);
  };

  function reset() {
    sellerEpoch.current++;
    sending.current = false;
    clearInspection();
    setStep(1);
    setBranchId(user?.branchId ?? '');
    setImeiCheckResult(null);
    setSellerHistory(null);
    setAddress({ ...emptyAddress });
    setForm({
      deviceOrigin: '', shopWarrantyDays: '', warrantyTerms: '',
      sellerContactId: '',
      sellerName: '',
      sellerPhone: '',
      sellerIdCardNumber: '',
      idCardPhotoBase64: '',
      idCardSource: '',
      deviceBrand: 'Apple',
      deviceModel: '',
      deviceStorage: '',
      deviceColor: '',
      imei: '',
      serialNumber: '',
      imeiMissingReason: '',
      serialNumberMissingReason: '',
      paymentMethod: 'CASH',
      transferBankName: '',
      transferAccountNumber: '',
      transferAccountName: '',
      sellerSignatureBase64: '',
      idCardVerified: false,
      sellerConsentSigned: false,
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
        deviceOrigin: form.deviceOrigin || null,
        shopWarrantyDays: form.shopWarrantyDays === '' ? null : Number(form.shopWarrantyDays),
        warrantyTerms: form.warrantyTerms.trim() || null,
        deviceBrand: form.deviceBrand,
        deviceModel: form.deviceModel,
        deviceStorage: form.deviceStorage || undefined,
        deviceColor: form.deviceColor || undefined,
        deviceCondition: quote!.grade,
        imei: form.imei || undefined,
        serialNumber: form.serialNumber.trim() || undefined,
        imeiMissingReason: form.imei ? undefined : form.imeiMissingReason.trim(),
        serialNumberMissingReason: form.serialNumber.trim()
          ? undefined
          : form.serialNumberMissingReason.trim(),
        agreedPrice: Number(quote!.cashPrice),
        answers,
        ...eligibility,
        previewToken: quote!.previewToken,
        idCardVerified: form.idCardVerified,
        sellerConsentSigned: form.sellerConsentSigned,
        declarationVersion: TRADE_IN_DECLARATION_VERSION,
        sellerSignatureBase64: form.sellerSignatureBase64 || undefined,
        paymentMethod: form.paymentMethod,
        transferBankName: form.paymentMethod === 'TRANSFER' ? form.transferBankName : undefined,
        transferAccountNumber:
          form.paymentMethod === 'TRANSFER' ? form.transferAccountNumber : undefined,
        transferAccountName:
          form.paymentMethod === 'TRANSFER' ? form.transferAccountName : undefined,
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
    onSettled: () => {
      sending.current = false;
    },
    onError: (err) => {
      toast.error(getErrorMessage(err));
      const id = isAxiosError(err) ? err.response?.data?.tradeInId : undefined;
      if (
        isAxiosError(err) &&
        typeof id !== 'string' &&
        (err.response?.status === 400 || err.response?.data?.code === 'QUICK_BUY_QUOTE_CHANGED')
      ) {
        setForm((f) => ({
          ...f,
          idCardVerified: false,
          sellerConsentSigned: false,
          sellerSignatureBase64: '',
        }));
        setStep(2);
        void questionnaire.refetch();
        void queryClient.invalidateQueries({ queryKey: ['quick-buy-preview'] });
      }
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
      toast.error(
        err instanceof Error ? err.message : 'ไม่พบเครื่องอ่านบัตร — ตรวจสอบว่า service รันอยู่',
      );
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
          sellerName: f.sellerContactId
            ? f.sellerName
            : f.sellerName || data.lastSeller!.sellerName || '',
          sellerPhone: f.sellerContactId
            ? f.sellerPhone
            : f.sellerPhone || data.lastSeller!.sellerPhone || '',
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
    setForm((f) => ({
      ...f,
      sellerContactId: contactId,
      sellerName: name,
      sellerPhone: '',
      sellerIdCardNumber: '',
      idCardPhotoBase64: '',
      idCardSource: '',
      idCardVerified: false,
      sellerConsentSigned: false,
      sellerSignatureBase64: '',
    }));
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
    if (sending.current || recovering || recoveryError) return;
    if (step === 1) {
      if (
        !modelOptions.some((entry) => entry.model === form.deviceModel) ||
        !storageOptions.some((entry) => entry.storage === form.deviceStorage)
      ) {
        return toast.error('กรุณาเลือกรุ่น iPhone และความจุที่มีราคารับซื้อ');
      }
      const error = tradeInDeviceEvidenceError(form);
      if (error) return toast.error(error);
    }
    if (step === 2 && !priceReady) return toast.error('กรุณาตรวจเครื่องให้ครบและรอราคาประเมินก่อน');
    if (step === 3) {
      if (!priceReady) {
        setStep(2);
        return toast.error('กรุณาตรวจราคาประเมินอีกครั้ง');
      }
      if (!branchId) return toast.error('กรุณาเลือกสาขาที่รับซื้อ');
      if (!form.sellerContactId) return toast.error('กรุณาเลือกผู้ขายจากรายชื่อผู้ติดต่อ');
      const error = tradeInSellerEvidenceError({ ...form, sellerAddress: composeAddress(address) });
      if (error) return toast.error(error);
      sellerEpoch.current++; // Ignore late card/contact reads after moving to confirmation.
    }
    setStep(Math.min(step + 1, 4));
  }
  function prev() {
    // Identity/device/price edits require a fresh check and seller signature.
    setForm((f) => ({
      ...f,
      idCardVerified: false,
      sellerConsentSigned: false,
      sellerSignatureBase64: '',
    }));
    setStep(Math.max(step - 1, 1));
  }

  function submit() {
    if (recovering || recoveryError || sending.current) return;
    if (!priceReady) {
      setStep(2);
      return toast.error('กรุณาตรวจราคาประเมินอีกครั้ง');
    }
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
    sending.current = true;
    quickBuyMutation.mutate();
  }

  if (!open) return null;

  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value && !sending.current) close();
      }}
    >
      <DialogPortal>
        <DialogOverlay className="bg-black/55 backdrop-blur-[2px] dark:bg-black/70" />
      </DialogPortal>
      <DialogContent
        overlay={false}
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (sending.current) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (sending.current) event.preventDefault();
        }}
        className="flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-4xl flex-col gap-0 overflow-hidden rounded-2xl bg-card p-0 text-sm leading-snug shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:rounded-2xl [&_[data-slot=input]]:mt-2 [&_[data-slot=input]]:h-11 [&_[data-slot=input]]:rounded-lg [&_[data-slot=input]]:text-base [&_[data-slot=input]]:shadow-none sm:[&_[data-slot=input]]:text-sm [&_[data-slot=button]]:min-h-11 [&_[data-slot=label]]:text-sm [&_[role=combobox]]:min-h-11 [&_[role=combobox]]:rounded-lg"
      >
        {/* Header — sticky */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border bg-card px-4 py-4 sm:items-center sm:px-7 sm:py-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ShoppingBag className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-lg font-semibold leading-snug text-foreground">
                รับซื้อมือถือมือสอง
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm leading-snug">
                ตรวจเครื่องและดูราคาก่อน แล้วจึงกรอกผู้ขายและยืนยันรับซื้อ
              </DialogDescription>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!sending.current) close();
            }}
            disabled={quickBuyMutation.isPending}
            aria-label="ปิด"
            className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <ol
          aria-label="ขั้นตอนรับซื้อ"
          className="grid shrink-0 grid-cols-4 gap-1 border-b border-border bg-card px-3 sm:gap-3 sm:px-7"
        >
          {purchaseSteps.map((label, index) => (
            <li
              key={label}
              aria-current={step === index + 1 ? 'step' : undefined}
              className={cn(
                'flex min-w-0 flex-col items-center gap-2 border-b-2 px-1 py-3 text-center sm:flex-row sm:gap-3 sm:py-4 sm:text-start',
                step === index + 1 ? 'border-primary' : 'border-transparent',
              )}
            >
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  index + 1 === step
                    ? 'bg-foreground text-background'
                    : index + 1 < step
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground',
                )}
              >
                {index + 1 < step ? <Check className="size-4" aria-hidden="true" /> : index + 1}
              </span>
              <span
                className={`text-xs leading-snug sm:text-sm ${index + 1 === step ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
              >
                {label}
              </span>
            </li>
          ))}
        </ol>

        {/* Body */}
        <div
          ref={bodyRef}
          data-testid="quick-buy-body"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background/50 p-4 sm:p-7"
        >
          {recovering && <p role="status">กำลังตรวจรายการที่ส่งไว้ก่อนหน้า…</p>}
          {recoveryError && (
            <div role="alert" className="mb-4 text-destructive">
              ยังตรวจสถานะรายการเดิมไม่ได้ กรุณาตรวจอีกครั้งก่อนรับซื้อใหม่{' '}
              <Button variant="outline" onClick={() => setRecoveryAttempt((n) => n + 1)}>
                ตรวจอีกครั้ง
              </Button>
            </div>
          )}
          {/* ─── STEP 3: SELLER ─── */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:p-5">
                <div>
                  <p className="font-semibold">
                    {form.deviceModel} · {form.deviceStorage}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    ตรวจเครื่องแล้ว กรอกผู้ขายเพื่อดำเนินการรับซื้อ
                  </p>
                </div>
                <p className="text-2xl font-semibold tracking-tight tabular-nums">
                  {priceReady ? money(quote!.cashPrice!) : 'กำลังตรวจราคา...'}
                </p>
              </div>
              <div>
                <Label htmlFor="quick-buy-branch" className="text-sm font-semibold">
                  สาขาที่รับซื้อ *
                </Label>
                <PurchaseSelect
                  id="quick-buy-branch"
                  value={branchId}
                  onValueChange={setBranchId}
                  placeholder="เลือกสาขา"
                  options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
                <h3 className="text-base font-semibold leading-snug">ข้อมูลผู้ขาย</h3>
                <Button
                  type="button"
                  variant="outline"
                  onClick={readFromCardReader}
                  className="min-h-11 gap-2 rounded-lg px-4 text-sm"
                >
                  <CreditCard className="size-4" aria-hidden="true" />
                  อ่านบัตรประชาชน
                </Button>
              </div>

              {sellerHistory?.found && (
                <div
                  className={`flex gap-3 rounded-xl p-4 text-sm leading-snug text-foreground ${
                    sellerHistory.warning
                      ? 'bg-destructive/10 border border-destructive/20'
                      : 'bg-muted/50 border border-border'
                  }`}
                >
                  <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                  <div>
                    {sellerHistory.warning ? (
                      <>
                        <div className="font-semibold mb-1 flex items-center gap-1.5">
                          <AlertTriangle className="size-4" /> ผู้ขายรายนี้มีประวัติผิดปกติ
                        </div>
                        <div>
                          ขายมาแล้ว {sellerHistory.recentCount} ครั้งใน 30 วันล่าสุด — รวมทั้งหมด{' '}
                          {sellerHistory.totalCount} ครั้ง — โปรดตรวจสอบที่มาให้ละเอียดก่อนรับซื้อ
                        </div>
                      </>
                    ) : (
                      <>
                        เคยขายมาแล้ว {sellerHistory.totalCount} ครั้ง — ข้อมูลถูก auto-fill
                        จากครั้งล่าสุด
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* ลำดับเหมือนฟอร์มข้อมูลลูกค้า: ผู้ขาย (picker) → เลขบัตร → ที่อยู่ → แนบบัตร */}
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label>ผู้ขาย *</Label>
                  <div className="mt-2">
                    <ContactCombobox
                      roleNeeded="TRADE_IN_SELLER"
                      value={form.sellerName}
                      onSelect={handleSellerSelect}
                      placeholder="ค้นหาหรือสร้างผู้ขาย"
                    />
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="buy-seller-name">ชื่อผู้ขายตามบัตรประชาชน *</Label>
                  <Input
                    id="buy-seller-name"
                    value={form.sellerName}
                    onChange={(e) => setForm((f) => ({ ...f, sellerName: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="buy-seller-phone">เบอร์โทรผู้ขาย *</Label>
                  <Input
                    id="buy-seller-phone"
                    inputMode="tel"
                    maxLength={10}
                    value={form.sellerPhone}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, sellerPhone: e.target.value.replace(/\D/g, '') }))
                    }
                  />
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
                <div className="border-t border-border pt-5 sm:col-span-2 [&_input]:h-11 [&_input]:rounded-lg [&_input]:text-base sm:[&_input]:text-sm">
                  <AddressForm value={address} onChange={setAddress} label="ที่อยู่ตามบัตร" />
                </div>
                <div className="sm:col-span-2">
                  <Label>แนบรูปบัตรประชาชน</Label>
                  <label className="mt-2 flex min-h-16 cursor-pointer items-center justify-center gap-3 rounded-xl border border-dashed border-input bg-card p-4 text-sm transition-colors hover:border-primary/60 hover:bg-primary/5 has-focus-visible:ring-2 has-focus-visible:ring-ring">
                    {form.idCardPhotoBase64 ? (
                      <>
                        <CheckCircle className="size-5 shrink-0 text-primary" />
                        <span className="font-medium">อัปโหลดแล้ว — คลิกเพื่อเปลี่ยน</span>
                      </>
                    ) : (
                      <>
                        <Upload className="size-5 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          คลิกเพื่อเลือกไฟล์รูปบัตรประชาชน
                        </span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={handleIdCardUpload}
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* ─── STEP 1: DEVICE ─── */}
          {step === 1 && (
            <section
              className="grid gap-6 md:grid-cols-[minmax(0,1fr)_15rem]"
              aria-label="เลือกเครื่องที่รับซื้อ"
            >
              <div className="md:col-span-2">
                <h3 className="text-lg font-semibold leading-snug">เริ่มจากเครื่องที่ต้องการขาย</h3>
                <p className="mt-2 text-sm leading-snug text-muted-foreground">
                  รับซื้อเฉพาะ iPhone เลือกรุ่นและความจุ แล้วตรวจสภาพเพื่อดูราคา
                </p>
              </div>
              <DeviceDisclosureFields value={form} onChange={(key, value) => setForm(f => ({ ...f, [key]: value }))} />
              {catalog.isPending ? (
                <p role="status" className="md:col-span-2">
                  กำลังโหลดรุ่นและราคารับซื้อ...
                </p>
              ) : catalog.isError ? (
                <div role="alert" className="space-y-2 text-sm md:col-span-2">
                  <p>{getErrorMessage(catalog.error)}</p>
                  <Button variant="outline" onClick={() => catalog.refetch()}>
                    โหลดรุ่นใหม่
                  </Button>
                </div>
              ) : modelOptions.length === 0 ? (
                <p role="alert" className="md:col-span-2">
                  ยังไม่มีรุ่นที่เปิดราคารับซื้อ
                </p>
              ) : null}
              <div className="grid min-w-0 content-start gap-5 sm:grid-cols-2">
                <div>
                  <Label htmlFor="quick-buy-model">รุ่น iPhone *</Label>
                  <PurchaseSelect
                    id="quick-buy-model"
                    value={form.deviceModel}
                    disabled={catalog.isPending || catalog.isError}
                    placeholder="เลือกรุ่น iPhone"
                    options={modelOptions.map((entry) => ({
                      value: entry.model,
                      label: entry.model,
                    }))}
                    onValueChange={(value) => {
                      clearInspection();
                      setForm((f) => ({
                        ...f,
                        deviceModel: value,
                        deviceStorage: '',
                        deviceColor: '',
                      }));
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="quick-buy-storage">ความจุ *</Label>
                  <PurchaseSelect
                    id="quick-buy-storage"
                    value={form.deviceStorage}
                    disabled={!form.deviceModel}
                    placeholder="เลือกความจุ"
                    options={storageOptions.map((entry) => ({
                      value: entry.storage,
                      label: entry.storage,
                    }))}
                    onValueChange={(value) => {
                      clearInspection();
                      setForm((f) => ({ ...f, deviceStorage: value }));
                    }}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="quick-buy-color">สีเครื่อง</Label>
                  <PurchaseSelect
                    id="quick-buy-color"
                    value={form.deviceColor}
                    disabled={!colorOptions.length}
                    onValueChange={(value) => setForm((f) => ({ ...f, deviceColor: value }))}
                    placeholder={
                      !form.deviceModel
                        ? 'เลือกรุ่น iPhone ก่อน'
                        : colorOptions.length
                          ? 'เลือกสีเครื่อง'
                          : 'ยังไม่มีข้อมูลสีรุ่นนี้ในระบบ'
                    }
                    options={colorOptions.map((color) => ({ value: color, label: color }))}
                    clearLabel="ยังไม่ระบุสี"
                  />
                </div>
              </div>
              <div className="flex flex-col justify-center rounded-xl border border-primary/20 bg-primary/5 p-5">
                <Smartphone
                  className="mb-4 hidden size-7 text-primary md:block"
                  aria-hidden="true"
                />
                <p className="text-sm text-muted-foreground">ราคารับซื้อสูงสุดก่อนตรวจสภาพ</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">
                  {storageOptions.find((entry) => entry.storage === form.deviceStorage)
                    ? money(
                        storageOptions.find((entry) => entry.storage === form.deviceStorage)!
                          .maxPrice,
                      )
                    : '—'}
                </p>
                <p className="mt-3 text-xs leading-snug text-muted-foreground">
                  ราคาจริงคำนวณจากผลตรวจในขั้นตอนถัดไป
                </p>
              </div>
              <div className="space-y-5 border-t border-border pt-6 md:col-span-2">
                <h3 className="text-base font-semibold leading-snug">หมายเลขประจำเครื่อง</h3>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="quick-buy-imei">IMEI</Label>
                    <Input
                      id="quick-buy-imei"
                      className="mt-1 font-mono"
                      inputMode="numeric"
                      maxLength={15}
                      placeholder="15 หลัก"
                      value={form.imei}
                      onChange={(event) => {
                        clearInspection();
                        setForm((f) => ({ ...f, imei: event.target.value.replace(/\D/g, '') }));
                        setImeiCheckResult(null);
                      }}
                      onBlur={checkImei}
                    />
                    {imeiCheckResult && (
                      <p
                        className={`mt-1 text-xs leading-snug ${imeiCheckResult.result === 'clean' ? 'text-muted-foreground' : 'text-destructive'}`}
                      >
                        {imeiCheckResult.result === 'clean'
                          ? 'ไม่พบ IMEI ซ้ำ'
                          : `พบ IMEI นี้ในระบบ ${imeiCheckResult.count} ครั้ง`}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="quick-buy-serial">Serial Number</Label>
                    <Input
                      id="quick-buy-serial"
                      className="mt-1 font-mono"
                      maxLength={100}
                      placeholder="หมายเลขเครื่อง"
                      value={form.serialNumber}
                      onChange={(event) => {
                        clearInspection();
                        setForm((f) => ({ ...f, serialNumber: event.target.value }));
                      }}
                    />
                  </div>
                </div>
                {(!form.imei || !form.serialNumber.trim()) && (
                  <details className="rounded-lg bg-muted/50 px-4 text-sm leading-snug">
                    <summary className="min-h-11 cursor-pointer py-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      กรณีอ่านหมายเลขเครื่องไม่ได้
                    </summary>
                    <p className="mb-4 text-xs text-muted-foreground">
                      ต้องมีอย่างน้อยหนึ่งหมายเลข และระบุเหตุผลสำหรับหมายเลขที่ขาด
                    </p>
                    {!form.imei && (
                      <div className="mb-3">
                        <Label htmlFor="buy-imei-reason">เหตุผลที่ไม่มี IMEI *</Label>
                        <Input
                          id="buy-imei-reason"
                          className="mt-1"
                          maxLength={300}
                          value={form.imeiMissingReason}
                          onChange={(event) =>
                            setForm((f) => ({ ...f, imeiMissingReason: event.target.value }))
                          }
                        />
                      </div>
                    )}
                    {!form.serialNumber.trim() && (
                      <div>
                        <Label htmlFor="buy-serial-reason">เหตุผลที่ไม่มี Serial Number *</Label>
                        <Input
                          id="buy-serial-reason"
                          className="mt-1"
                          maxLength={300}
                          value={form.serialNumberMissingReason}
                          onChange={(event) =>
                            setForm((f) => ({
                              ...f,
                              serialNumberMissingReason: event.target.value,
                            }))
                          }
                        />
                      </div>
                    )}
                  </details>
                )}
              </div>
            </section>
          )}

          {/* ─── STEP 2: INSPECTION + PRICE ─── */}
          {step === 2 && (
            <section className="space-y-6" aria-label="ตรวจสภาพและดูราคารับซื้อ">
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold leading-snug">
                      {form.deviceModel} · {form.deviceStorage}
                    </h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      ตรวจครบแล้วราคาจะแสดงอัตโนมัติ
                    </p>
                  </div>
                  <p className="rounded-full bg-muted px-3 py-1.5 text-xs font-medium tabular-nums">
                    ตรวจแล้ว {completed}/{questions.length} ข้อ
                  </p>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none"
                    style={{
                      width: `${questions.length ? (completed / questions.length) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
              {questionnaire.isPending || questionnaire.isFetching ? (
                <p role="status">กำลังโหลดแบบตรวจ...</p>
              ) : questionnaire.isError ? (
                <div role="alert" className="space-y-2 text-sm">
                  <p>{getErrorMessage(questionnaire.error)}</p>
                  <Button variant="outline" onClick={() => questionnaire.refetch()}>
                    โหลดแบบตรวจใหม่
                  </Button>
                </div>
              ) : questionnaire.data?.questions.length ? (
                <InspectionQuestions
                  questionnaire={questionnaire.data}
                  selected={selected}
                  onChange={setSelected}
                  deviceEligibilityConfirmed={deviceEligibilityConfirmed}
                  onEligibilityChange={setDeviceEligibilityConfirmed}
                />
              ) : (
                <p role="alert">ยังไม่มีแบบตรวจสำหรับรุ่นและความจุนี้</p>
              )}
              {preview.isError && inspectionComplete && (
                <div role="alert" className="space-y-2 text-sm">
                  <p className="text-destructive">{getErrorMessage(preview.error)}</p>
                  <Button variant="outline" onClick={() => preview.refetch()}>
                    คำนวณราคาใหม่
                  </Button>
                </div>
              )}
              {priceReady && quote?.breakdown && (
                <section
                  aria-label="รายละเอียดราคารับซื้อ"
                  className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-5 text-sm"
                >
                  <h3 className="text-base font-semibold leading-snug">ราคาตามผลตรวจ</h3>
                  <dl className="space-y-3">
                    <div className="flex justify-between gap-4">
                      <dt>ราคาสูงสุด</dt>
                      <dd className="font-medium tabular-nums">
                        {money(quote.breakdown.maxPrice)}
                      </dd>
                    </div>
                    {quote.breakdown.lines
                      .filter((line) => Number(line.amount) > 0)
                      .map((line, index) => (
                        <div key={index} className="flex justify-between gap-4">
                          <dt className="min-w-0 text-muted-foreground wrap-anywhere">
                            {line.label}
                          </dt>
                          <dd className="shrink-0 tabular-nums">−{money(line.amount)}</dd>
                        </div>
                      ))}
                    <div className="flex items-center justify-between gap-4 border-t border-primary/20 pt-4 font-semibold">
                      <dt>ราคารับซื้อเงินสด</dt>
                      <dd className="text-2xl tracking-tight tabular-nums">
                        {money(quote.cashPrice!)}
                      </dd>
                    </div>
                  </dl>
                  <p className="text-xs text-muted-foreground">เกรด {quote.grade} จากผลตรวจ</p>
                </section>
              )}
              {quote && !priceReady && (
                <p role="alert" className="text-sm text-destructive">
                  ผลตรวจนี้ยังไม่มีราคารับซื้อที่ยืนยันได้ กรุณาตรวจคำตอบและราคากลาง
                </p>
              )}
            </section>
          )}

          {/* ─── STEP 4: CONFIRM + SIGN ─── */}
          {step === 4 && (
            <div className="space-y-6">
              <div className="flex items-start gap-3 rounded-xl border border-warning/25 bg-warning/10 p-4 text-sm text-foreground">
                <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                <div>กรุณายืนยันขั้นตอนป้องกันการรับซื้อของโจรก่อนกดบันทึก</div>
              </div>

              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-primary/5 p-5">
                  <div>
                    <p className="text-xs text-muted-foreground">รับซื้อ — จ่ายเงินให้ผู้ขาย</p>
                    <h3 className="mt-1 text-base font-semibold leading-snug">
                      {form.deviceBrand} {form.deviceModel} {form.deviceStorage}
                    </h3>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">ราคารับซื้อ</p>
                    <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
                      {priceReady ? money(quote!.cashPrice!) : 'กำลังตรวจราคา...'}
                    </p>
                  </div>
                </div>
                <dl className="grid gap-4 p-5 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-muted-foreground">ผู้ขาย</dt>
                    <dd className="mt-1 font-medium wrap-anywhere">{form.sellerName}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">IMEI</dt>
                    <dd className="mt-1 font-mono wrap-anywhere">{form.imei || 'ไม่ระบุ'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Serial Number</dt>
                    <dd className="mt-1 font-mono wrap-anywhere">
                      {form.serialNumber.trim() || 'ไม่ระบุ'}
                    </dd>
                  </div>
                </dl>
              </div>

              <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/50 has-checked:border-primary/40 has-checked:bg-primary/5 has-focus-visible:ring-2 has-focus-visible:ring-ring">
                <input
                  type="checkbox"
                  disabled={quickBuyMutation.isPending}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={form.idCardVerified}
                  onChange={(e) => setForm((f) => ({ ...f, idCardVerified: e.target.checked }))}
                />
                <span className="text-sm">ตรวจบัตรประชาชนผู้ขายแล้วและตรงกับใบหน้า</span>
              </label>
              <SellerDeclaration />
              <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/50 has-checked:border-primary/40 has-checked:bg-primary/5 has-focus-visible:ring-2 has-focus-visible:ring-ring">
                <input
                  type="checkbox"
                  disabled={quickBuyMutation.isPending}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={form.sellerConsentSigned}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, sellerConsentSigned: e.target.checked }))
                  }
                />
                <span className="text-sm">ผู้ขายได้อ่านและยอมรับคำรับรองผู้ขายทุกข้อ</span>
              </label>

              <div className="[&>fieldset]:space-y-4 [&>fieldset]:pt-5 [&_legend]:text-base [&_legend]:font-semibold [&_label:has(input[type=radio])]:flex-1 [&_label:has(input[type=radio])]:cursor-pointer [&_label:has(input[type=radio])]:rounded-lg [&_label:has(input[type=radio])]:border [&_label:has(input[type=radio])]:border-border [&_label:has(input[type=radio])]:bg-card [&_label:has(input[type=radio])]:px-4 [&_label:has(input:checked)]:border-primary/40 [&_label:has(input:checked)]:bg-primary/5 [&_input[type=radio]]:accent-primary">
                <SellerPaymentFields
                  value={form}
                  disabled={quickBuyMutation.isPending}
                  onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
                />
              </div>

              <div className="border-t border-border pt-6 [&_canvas]:bg-primary-foreground">
                <Label className="block text-base font-semibold">ลายเซ็นผู้ขาย *</Label>
                <p className="mb-5 mt-2 text-sm text-muted-foreground">
                  ลงนามยืนยันรายการรับเครื่องและคำรับรองผู้ขายข้างต้น
                </p>
                <SignaturePadFull
                  isPending={quickBuyMutation.isPending}
                  initialImage={form.sellerSignatureBase64}
                  onSign={() => {
                    /* submit ผ่านปุ่มล่าง */
                  }}
                  onDraftChange={(d) => setForm((f) => ({ ...f, sellerSignatureBase64: d || '' }))}
                  buttonText=""
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer — sticky */}
        <div className="shrink-0 border-t border-border bg-card px-4 py-4 sm:px-7">
          {step === 2 && (
            <div className="mb-4 flex items-center justify-between gap-4" aria-live="polite">
              <div>
                <p className="text-xs text-muted-foreground">ราคารับซื้อเงินสด</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
                  {priceReady
                    ? money(quote!.cashPrice!)
                    : inspectionComplete && preview.isFetching
                      ? 'กำลังคำนวณ...'
                      : '—'}
                </p>
              </div>
              {!inspectionComplete && (
                <p className="max-w-40 text-right text-xs leading-snug text-muted-foreground">
                  ตรวจให้ครบและยืนยันเงื่อนไขรับซื้อ
                </p>
              )}
            </div>
          )}
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 sm:grid-cols-[1fr_auto_1fr]">
            <p className="col-span-2 text-center text-xs text-muted-foreground sm:col-span-1 sm:col-start-2 sm:row-start-1">
              ขั้นที่ {step} / 4
            </p>
            <Button
              variant="outline"
              className="min-h-11 rounded-lg px-4 text-sm sm:col-start-1 sm:row-start-1 sm:justify-self-start"
              onClick={prev}
              disabled={step === 1 || quickBuyMutation.isPending}
            >
              <ChevronLeft className="size-4 mr-1" /> ย้อนกลับ
            </Button>
            {step < 4 ? (
              <Button
                onClick={next}
                className={cn(
                  purchaseActionClass,
                  'sm:col-start-3 sm:row-start-1 sm:justify-self-end',
                )}
                disabled={recovering || recoveryError || (step === 2 && !priceReady)}
              >
                ถัดไป <ChevronRight className="size-4 ml-1" />
              </Button>
            ) : (
              <Button
                onClick={submit}
                disabled={quickBuyMutation.isPending || recovering || recoveryError || !priceReady}
                className={cn(
                  purchaseActionClass,
                  'h-auto min-w-0 whitespace-normal sm:col-start-3 sm:row-start-1 sm:justify-self-end',
                )}
              >
                {quickBuyMutation.isPending ? (
                  'กำลังบันทึก...'
                ) : (
                  <>
                    <Check className="size-4 mr-1.5 inline" />
                    บันทึก + ออกใบสำคัญ
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
