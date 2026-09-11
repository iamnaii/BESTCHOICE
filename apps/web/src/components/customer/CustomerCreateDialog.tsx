import { useRef, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { compressImageForOcr } from '@/lib/compressImage';
import { checkCardReaderStatus, readSmartCard, type SmartCardData } from '@/lib/cardReader';
import { THAI_NAME_PREFIXES, RELATIONSHIP_OPTIONS } from '@/lib/constants';
import { customerSchema, type CustomerFormData } from '@/lib/schemas';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import AddressForm, { type AddressData, emptyAddress, serializeAddress } from '@/components/ui/AddressForm';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ChevronDown, CreditCard, Camera, User, MapPin, Phone, Briefcase, Users, Link2 } from 'lucide-react';
import type { OcrResult } from '@/types/ocr';

/**
 * ฟอร์ม "เพิ่มลูกค้าใหม่" ตัวเดียวของระบบ — ย้ายมาจาก modal ที่เคยฝังใน CustomersPage
 * เปิดได้จากหน้าลูกค้า และจากแผงขวาห้องแชท (RoomDossier) โดยไม่ต้องออกจากห้อง
 *
 * หน้าที่ของไฟล์นี้จบที่ "สร้างลูกค้าสำเร็จ" (`POST /customers`) แล้วส่ง `onCreated(customer)`
 * ให้ผู้เรียกตัดสินเองว่าจะไปไหนต่อ (หน้าลูกค้า → เปิดโปรไฟล์ · ห้องแชท → ผูกห้อง)
 *
 * เลขซ้ำ (409 จาก customer-write.service dedup เบอร์/อีเมล) ไม่ใช่แค่ error:
 * ถ้าผู้เรียกส่ง `onUseExisting` มา จะเสนอปุ่ม "ใช้ลูกค้าเดิมคนนี้แทน" ในฟอร์มเลย
 * (ในแชท = ผูกห้องกับคนเดิม แทนที่จะสร้างซ้ำหรือติดตาย)
 *
 * state ทั้งหมดอยู่ใน `CustomerCreateForm` ซึ่ง mount เฉพาะตอน `open` — ปิดแล้วเปิดใหม่ได้ฟอร์มเปล่า
 * (ของเดิมมี resetForm แต่ไม่มีใครเรียก ค่าเก่าจึงค้างข้ามรอบ)
 */

export interface CreatedCustomer {
  id: string;
  name: string;
  phone?: string | null;
  [key: string]: unknown;
}

export interface ExistingCustomerRef {
  id: string;
  name: string;
}

interface ReferenceData {
  prefix: string;
  firstName: string;
  lastName: string;
  phone: string;
  relationship: string;
}

const emptyReference: ReferenceData = { prefix: '', firstName: '', lastName: '', phone: '', relationship: '' };

const emptyForm: CustomerFormData = {
  prefix: '',
  firstName: '',
  lastName: '',
  nickname: '',
  nationalId: '',
  isForeigner: false,
  birthDate: '',
  phone: '',
  phoneSecondary: '',
  email: '',
  lineIdFinance: '',
  lineIdShop: '',
  facebookLink: '',
  facebookName: '',
  occupation: '',
  occupationDetail: '',
  salary: '',
  workplace: '',
};

/** แยก "ชื่อ นามสกุล" จากชื่อห้องแชท/ชื่อโปรไฟล์ — คำแรก = ชื่อ ที่เหลือ = นามสกุล (ตรรกะเดิมของ ?new=1) */
export function splitDisplayName(displayName: string | null | undefined): Pick<CustomerFormData, 'firstName' | 'lastName'> {
  const parts = (displayName ?? '').trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

export interface CustomerCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** ค่าตั้งต้นของช่องในฟอร์ม (เช่น ชื่อจากห้องแชท) — แก้ต่อได้ */
  initialValues?: Partial<CustomerFormData>;
  /** แถบบริบทใต้หัว เช่น "บันทึกแล้วจะผูกกับห้องแชท …" */
  context?: ReactNode;
  submitLabel?: string;
  /** สร้างสำเร็จ — dialog ปิดตัวเองหลังเรียก */
  onCreated: (customer: CreatedCustomer) => void;
  /** เจอลูกค้าเดิม (409) แล้วผู้ใช้เลือก "ใช้คนเดิม" — ถ้าไม่ส่งมา จะโชว์แค่ข้อความ */
  onUseExisting?: (customer: ExistingCustomerRef) => void;
}

export default function CustomerCreateDialog({ open, onOpenChange, ...formProps }: CustomerCreateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-8 max-h-[calc(100vh-4rem)] w-full max-w-2xl translate-y-0 gap-0 overflow-hidden rounded-xl p-0"
        showCloseButton={false}
        aria-label="เพิ่มลูกค้าใหม่"
      >
        {open && <CustomerCreateForm onClose={() => onOpenChange(false)} {...formProps} />}
      </DialogContent>
    </Dialog>
  );
}

type FormProps = Omit<CustomerCreateDialogProps, 'open' | 'onOpenChange'> & { onClose: () => void };

function CustomerCreateForm({ initialValues, context, submitLabel = 'บันทึก', onCreated, onUseExisting, onClose }: FormProps) {
  const form = useForm<CustomerFormData>({
    resolver: standardSchemaResolver(customerSchema),
    defaultValues: { ...emptyForm, ...initialValues },
  });
  // Extra fields not in customerSchema (managed as separate state)
  const [formExtra, setFormExtra] = useState({ facebookFriends: '', googleMapLink: '', addressCurrentType: '' });
  const [addressIdCard, setAddressIdCard] = useState<AddressData>(emptyAddress);
  const [addressCurrent, setAddressCurrent] = useState<AddressData>(emptyAddress);
  const [sameAddress, setSameAddress] = useState(false);
  const [addressWork, setAddressWork] = useState<AddressData>(emptyAddress);
  const [references, setReferences] = useState<ReferenceData[]>([{ ...emptyReference }, { ...emptyReference }]);
  const [existing, setExisting] = useState<ExistingCustomerRef | null>(null);

  // OCR state
  const ocrFileRef = useRef<HTMLInputElement>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  // Smart Card reader state
  const [cardReaderLoading, setCardReaderLoading] = useState(false);

  const createMutation = useMutation({
    mutationFn: async (data: CustomerFormData) => {
      const name = `${data.firstName} ${data.lastName}`.trim();
      const payload: Record<string, unknown> = {
        nationalId: data.nationalId,
        name,
        phone: data.phone,
      };
      if (data.prefix) payload.prefix = data.prefix;
      if (data.nickname) payload.nickname = data.nickname;
      if (data.isForeigner) payload.isForeigner = true;
      if (data.birthDate) payload.birthDate = new Date(data.birthDate).toISOString();
      if (data.phoneSecondary) payload.phoneSecondary = data.phoneSecondary;
      if (data.email) payload.email = data.email;
      if (data.lineIdFinance) payload.lineIdFinance = data.lineIdFinance;
      if (data.lineIdShop) payload.lineIdShop = data.lineIdShop;
      if (data.facebookLink) payload.facebookLink = data.facebookLink;
      if (data.facebookName) payload.facebookName = data.facebookName;
      if (formExtra.facebookFriends) payload.facebookFriends = formExtra.facebookFriends;
      if (formExtra.googleMapLink) payload.googleMapLink = formExtra.googleMapLink;
      if (data.occupation) payload.occupation = data.occupation;
      if (data.occupationDetail) payload.occupationDetail = data.occupationDetail;
      if (data.salary && !isNaN(parseFloat(data.salary))) payload.salary = parseFloat(data.salary);
      if (data.workplace) payload.workplace = data.workplace;
      if (formExtra.addressCurrentType) payload.addressCurrentType = formExtra.addressCurrentType;

      // "เหมือนที่อยู่ตามบัตร" = ส่งที่อยู่ตามบัตรเป็นที่อยู่ปัจจุบัน (ของเดิม sync ผ่าน useEffect ตอนติ๊ก)
      const addrIdCard = serializeAddress(addressIdCard);
      const addrCurrent = serializeAddress(sameAddress ? addressIdCard : addressCurrent);
      const addrWork = serializeAddress(addressWork);
      if (addrIdCard) payload.addressIdCard = addrIdCard;
      if (addrCurrent) payload.addressCurrent = addrCurrent;
      if (addrWork) payload.addressWork = addrWork;

      // Filter out empty references
      const validRefs = references.filter(r => r.firstName || r.lastName || r.phone);
      if (validRefs.length > 0) payload.references = validRefs;

      return api.post<CreatedCustomer>('/customers', payload);
    },
    onSuccess: (res) => {
      toast.success('เพิ่มลูกค้าสำเร็จ');
      onCreated(res.data);
      onClose();
    },
    onError: (err: unknown) => {
      const axiosErr = err as { response?: { status?: number; data?: { existingCustomer?: ExistingCustomerRef } } };
      const dup = axiosErr.response?.status === 409 ? axiosErr.response.data?.existingCustomer : undefined;
      if (dup?.id) {
        setExisting(dup);
        return;
      }
      toast.error(getErrorMessage(err));
    },
  });

  const handleOcrScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (ocrFileRef.current) ocrFileRef.current.value = '';
    if (file.size > 10 * 1024 * 1024) {
      toast.error('ไฟล์ต้องมีขนาดไม่เกิน 10MB');
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error('กรุณาเลือกไฟล์รูปภาพ');
      return;
    }

    setOcrLoading(true);
    try {
      const imageBase64 = await compressImageForOcr(file);
      const { data } = await api.post<OcrResult>('/ocr/id-card', { imageBase64 }, { timeout: 90000 });

      // Auto-fill form fields via react-hook-form setValue
      if (data.nationalId) {
        if (/^\d{13}$/.test(data.nationalId)) {
          form.setValue('nationalId', data.nationalId, { shouldValidate: true });
        }
        if (!data.nationalIdValid) {
          toast.error('เลขบัตรประชาชนที่อ่านได้ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
        }
      }
      if (data.prefix) form.setValue('prefix', data.prefix);
      if (data.firstName) form.setValue('firstName', data.firstName.trim());
      if (data.lastName) form.setValue('lastName', data.lastName.trim());
      if (!data.firstName && !data.lastName && data.fullName) {
        const parts = data.fullName.trim().split(/\s+/);
        form.setValue('firstName', parts[0] || '');
        form.setValue('lastName', parts.slice(1).join(' ') || '');
      }
      if (data.birthDate) {
        const match = data.birthDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (match) {
          const [, y, m, d] = match.map(Number);
          const dateObj = new Date(y, m - 1, d);
          if (dateObj.getFullYear() === y && dateObj.getMonth() === m - 1 && dateObj.getDate() === d) {
            form.setValue('birthDate', data.birthDate);
          }
        }
      }

      // Use structured address from backend if available, fallback to regex parsing
      if (data.addressStructured) {
        const a = data.addressStructured;
        setAddressIdCard({
          houseNo: a.houseNo || '',
          moo: a.moo || '',
          village: a.village || '',
          soi: a.soi || '',
          road: a.road || '',
          subdistrict: a.subdistrict || '',
          district: a.district || '',
          province: a.province || '',
          postalCode: a.postalCode || '',
        });
      } else if (data.address) {
        const addr = { ...emptyAddress };
        const raw = data.address;
        const zipMatch = raw.match(/(\d{5})\s*$/);
        if (zipMatch) addr.postalCode = zipMatch[1];
        const houseMatch = raw.match(/^(\d+(?:\/\d+)?)\s/);
        if (houseMatch) addr.houseNo = houseMatch[1];
        const mooMatch = raw.match(/(?:หมู่(?:ที่)?|ม\.)\s*(\d+)/);
        if (mooMatch) addr.moo = mooMatch[1];
        const soiMatch = raw.match(/(?:ซอย|ซ\.)\s*([^\s,]+)/);
        if (soiMatch) addr.soi = soiMatch[1];
        const roadMatch = raw.match(/(?:ถนน|ถ\.)\s*([^\s,]+)/);
        if (roadMatch) addr.road = roadMatch[1];
        const villageMatch = raw.match(/(?:หมู่บ้าน|ม\.บ\.|คอนโด)\s*([^\s,]+)/);
        if (villageMatch) addr.village = villageMatch[1];
        const subdistrictMatch = raw.match(/((?:ตำบล|ต\.|แขวง)\s*[^\s,]+)/);
        if (subdistrictMatch) addr.subdistrict = subdistrictMatch[1];
        const districtMatch = raw.match(/((?:อำเภอ|อ\.|เขต)\s*[^\s,]+)/);
        if (districtMatch) addr.district = districtMatch[1];
        const provinceMatch = raw.match(/(?:จังหวัด|จ\.)\s*([^\s,\d]+)/);
        if (provinceMatch) addr.province = provinceMatch[1];
        setAddressIdCard(addr);
      }

      const pct = (data.confidence * 100).toFixed(0);
      if (data.confidence < 0.5) {
        toast.error(`อ่านบัตรได้ แต่ความมั่นใจต่ำมาก (${pct}%) กรุณาตรวจสอบข้อมูลทุกช่อง`);
      } else if (data.confidence < 0.7) {
        toast.warning(`อ่านบัตรสำเร็จ แต่ความมั่นใจค่อนข้างต่ำ (${pct}%) กรุณาตรวจสอบข้อมูล`);
      } else {
        toast.success(`อ่านบัตรสำเร็จ (ความมั่นใจ ${pct}%)`);
      }
    } catch (err: unknown) {
      const axiosErr = err as { code?: string; response?: unknown };
      if (axiosErr.code === 'ECONNABORTED' || !axiosErr.response) {
        toast.error('OCR ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง');
      } else {
        toast.error(getErrorMessage(err));
      }
    } finally {
      setOcrLoading(false);
    }
  };

  const handleSmartCardRead = async () => {
    setCardReaderLoading(true);
    try {
      // Check if card reader service is available
      const status = await checkCardReaderStatus();
      if (!status || status.status === 'no_pcsc') {
        toast.error('ไม่พบเครื่องอ่านบัตร — กรุณาติดตั้ง BESTCHOICE Card Reader Service');
        return;
      }
      if (status.status === 'no_reader') {
        toast.error('ไม่พบเครื่องอ่านบัตร — กรุณาเสียบเครื่องอ่านบัตร USB');
        return;
      }
      if (status.status === 'waiting') {
        toast.error('กรุณาเสียบบัตรประชาชนเข้าเครื่องอ่านบัตร');
        return;
      }
      const data: SmartCardData = await readSmartCard();

      // Auto-fill form fields from Smart Card data via react-hook-form setValue
      if (data.nationalId) form.setValue('nationalId', data.nationalId, { shouldValidate: true });
      if (data.prefix) form.setValue('prefix', data.prefix);
      if (data.firstName) form.setValue('firstName', data.firstName);
      if (data.lastName) form.setValue('lastName', data.lastName);
      if (data.birthDate) form.setValue('birthDate', data.birthDate);

      // Fill address from Smart Card
      if (data.addressStructured) {
        const a = data.addressStructured;
        setAddressIdCard({
          houseNo: a.houseNo || '',
          moo: a.moo || '',
          village: a.village || '',
          soi: a.soi || '',
          road: a.road || '',
          subdistrict: a.subdistrict || '',
          district: a.district || '',
          province: a.province || '',
          postalCode: '',
        });
      }

      toast.success('อ่านบัตรประชาชนสำเร็จ (Smart Card — ข้อมูลแม่นยำ 100%)');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'ไม่สามารถอ่านบัตรได้');
    } finally {
      setCardReaderLoading(false);
    }
  };

  const updateRef = (index: number, field: keyof ReferenceData, value: string) => {
    setReferences(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
  };

  const inputClass = 'w-full px-3 py-2 border border-input rounded-lg text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background';
  const selectClass = `${inputClass}`;

  return (
    <>
      {/* Sticky Header */}
      <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b bg-background/95 px-6 py-4 backdrop-blur-xs">
        <button type="button" onClick={onClose} className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          ปิด
        </button>
        <DialogTitle className="text-lg font-semibold text-foreground">เพิ่มลูกค้าใหม่</DialogTitle>
        <DialogDescription className="sr-only">กรอกข้อมูลลูกค้าใหม่ หรืออ่านจากบัตรประชาชน</DialogDescription>
        <div className="w-16" />
      </div>
      {context}
      <Form {...form}>
        <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="flex flex-col gap-4 p-6">

          {existing && (
            <div role="alert" className="rounded-xl border border-warning bg-warning/10 p-4 text-sm">
              <p className="m-0 font-semibold">มีลูกค้าเบอร์นี้หรืออีเมลนี้อยู่แล้ว: {existing.name}</p>
              <p className="m-0 mt-0.5 text-xs text-muted-foreground">ระบบไม่สร้างซ้ำ — ใช้คนเดิม หรือแก้เบอร์/อีเมลแล้วบันทึกใหม่</p>
              {onUseExisting && (
                <button
                  type="button"
                  onClick={() => { onUseExisting(existing); onClose(); }}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
                >
                  <Link2 className="size-4" strokeWidth={1.5} /> ใช้ลูกค้าเดิมคนนี้แทน
                </button>
              )}
            </div>
          )}

          {/* ===== Smart Card + OCR (always visible) ===== */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleSmartCardRead}
              disabled={cardReaderLoading || ocrLoading}
              className="inline-flex items-center justify-center gap-2 py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold shadow-sm hover:bg-primary/90 disabled:opacity-50 transition-all"
            >
              {cardReaderLoading ? (
                <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground" /> กำลังอ่านบัตร...</>
              ) : (
                <><CreditCard className="h-4 w-4" strokeWidth={1.5} /> อ่านบัตร Smart Card</>
              )}
            </button>
            <input ref={ocrFileRef} type="file" accept="image/*" capture="environment" onChange={handleOcrScan} className="hidden" />
            <button
              type="button"
              onClick={() => ocrFileRef.current?.click()}
              disabled={ocrLoading}
              className="inline-flex items-center justify-center gap-2 py-3 bg-secondary text-secondary-foreground rounded-xl text-sm font-semibold shadow-sm hover:bg-secondary/80 disabled:opacity-50 transition-all"
            >
              {ocrLoading ? (
                <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" /> กำลังอ่าน...</>
              ) : (
                <><Camera className="h-4 w-4" strokeWidth={1.5} /> สแกนบัตร OCR</>
              )}
            </button>
          </div>

          {/* ===== Section 1: ข้อมูลหลัก (always open) ===== */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <User className="size-4 text-primary" strokeWidth={1.5} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">ข้อมูลหลัก</h3>
                <p className="text-xs text-muted-foreground">ชื่อ, เลขบัตร, เบอร์ติดต่อ</p>
              </div>
            </div>
            <div className="grid grid-cols-6 gap-3">
              <div className="col-span-2">
                <FormField
                  control={form.control}
                  name="prefix"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium">คำนำหน้า</FormLabel>
                      <FormControl>
                        <select {...field} className={selectClass}>
                          <option value="">-- เลือก --</option>
                          {THAI_NAME_PREFIXES.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>
              <div className="col-span-2">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium">ชื่อ <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <input type="text" {...field} className={inputClass} placeholder="กรอกชื่อ" autoComplete="given-name" />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>
              <div className="col-span-2">
                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium">นามสกุล <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <input type="text" {...field} className={inputClass} placeholder="กรอกนามสกุล" autoComplete="family-name" />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>
              <div className="col-span-3">
                <FormField
                  control={form.control}
                  name="nationalId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium">เลขบัตรประชาชน (13 หลัก) <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <input
                          type="text"
                          maxLength={13}
                          {...field}
                          onChange={(e) => field.onChange(e.target.value.replace(/\D/g, ''))}
                          className={`${inputClass} font-mono`}
                          placeholder="X-XXXX-XXXXX-XX-X"
                        />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>
              <div className="col-span-2">
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium">เบอร์โทร <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <input type="tel" {...field} className={inputClass} placeholder="0XX-XXX-XXXX" autoComplete="tel" />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>
              <div className="col-span-1">
                <FormField
                  control={form.control}
                  name="nickname"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium">ชื่อเล่น</FormLabel>
                      <FormControl>
                        <input type="text" {...field} className={inputClass} placeholder="ชื่อเล่น" />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>
              <div className="col-span-2">
                <FormField
                  control={form.control}
                  name="birthDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium">วันเกิด</FormLabel>
                      <FormControl>
                        <ThaiDateInput value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value)} className={inputClass} />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>
              <div className="col-span-1 flex items-end pb-1">
                {form.watch('birthDate') && (() => {
                  const bd = new Date(form.watch('birthDate') as string);
                  const today = new Date();
                  let age = today.getFullYear() - bd.getFullYear();
                  if (today.getMonth() < bd.getMonth() || (today.getMonth() === bd.getMonth() && today.getDate() < bd.getDate())) age--;
                  return <span className="inline-flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 px-2.5 py-1.5 rounded-lg">อายุ {age} ปี</span>;
                })()}
              </div>
            </div>
          </div>

          {/* ===== ที่อยู่ (collapsible) ===== */}
          <details className="group rounded-xl border border-border bg-card">
            <summary className="list-none flex items-center gap-2.5 p-5 cursor-pointer select-none hover:bg-accent/50 transition-colors [&::-webkit-details-marker]:hidden">
              <div className="size-8 rounded-lg bg-muted flex items-center justify-center">
                <MapPin className="size-4 text-muted-foreground" strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-foreground">ที่อยู่</h3>
                <p className="text-xs text-muted-foreground">ตามบัตร + ปัจจุบัน</p>
              </div>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-5 pb-5 border-t border-border pt-4 flex flex-col gap-4">
              <div>
                <h4 className="text-xs font-medium text-foreground mb-2">ที่อยู่ตามบัตรประชาชน</h4>
                <AddressForm value={addressIdCard} onChange={setAddressIdCard} />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-medium text-foreground">ที่อยู่ปัจจุบัน</h4>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={sameAddress} onChange={(e) => setSameAddress(e.target.checked)} className="rounded border-input text-primary focus-visible:ring-ring/30" />
                    <span className="text-xs text-muted-foreground">เหมือนที่อยู่ตามบัตร</span>
                  </label>
                </div>
                <div className="mb-3">
                  <label className="block text-xs font-medium text-foreground mb-1.5">ประเภทที่อยู่</label>
                  <select value={formExtra.addressCurrentType} onChange={(e) => setFormExtra(prev => ({ ...prev, addressCurrentType: e.target.value }))} className={inputClass}>
                    <option value="">-- เลือก --</option>
                    <option value="OWN">บ้านตัวเอง</option>
                    <option value="RELATIVE">บ้านญาติ</option>
                    <option value="RENT">เช่าอาศัย</option>
                  </select>
                </div>
                {sameAddress ? (
                  <p className="text-xs text-muted-foreground italic">ใช้ที่อยู่เดียวกับที่อยู่ตามบัตรประชาชน</p>
                ) : (
                  <AddressForm value={addressCurrent} onChange={setAddressCurrent} />
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">ลิงก์ Google Map</label>
                <input type="url" value={formExtra.googleMapLink} onChange={(e) => setFormExtra(prev => ({ ...prev, googleMapLink: e.target.value }))} className={inputClass} placeholder="https://maps.google.com/..." />
              </div>
            </div>
          </details>

          {/* ===== ข้อมูลติดต่อเพิ่มเติม (collapsible) ===== */}
          <details className="group rounded-xl border border-border bg-card">
            <summary className="list-none flex items-center gap-2.5 p-5 cursor-pointer select-none hover:bg-accent/50 transition-colors [&::-webkit-details-marker]:hidden">
              <div className="size-8 rounded-lg bg-muted flex items-center justify-center">
                <Phone className="size-4 text-muted-foreground" strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-foreground">ข้อมูลติดต่อเพิ่มเติม</h3>
                <p className="text-xs text-muted-foreground">LINE, Facebook, เบอร์สำรอง</p>
              </div>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-5 pb-5 border-t border-border pt-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FormField
                    control={form.control}
                    name="phoneSecondary"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium">เบอร์สำรอง</FormLabel>
                        <FormControl>
                          <input type="tel" {...field} className={inputClass} placeholder="0XX-XXX-XXXX" />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>
                <div>
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium">อีเมล</FormLabel>
                        <FormControl>
                          <input type="email" {...field} className={inputClass} placeholder="email@example.com" autoComplete="email" />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>
                <div>
                  <FormField
                    control={form.control}
                    name="lineIdFinance"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium">LINE ID (Finance / น้องเบส)</FormLabel>
                        <FormControl>
                          <input type="text" {...field} className={inputClass} placeholder="U1234567890abcdef..." />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>
                <div>
                  <FormField
                    control={form.control}
                    name="lineIdShop"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium">LINE ID (Shop / ร้าน)</FormLabel>
                        <FormControl>
                          <input type="text" {...field} className={inputClass} placeholder="U1234567890abcdef..." />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>
                <div>
                  <FormField
                    control={form.control}
                    name="facebookLink"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium">ลิงก์ Facebook</FormLabel>
                        <FormControl>
                          <input type="url" {...field} className={inputClass} placeholder="https://facebook.com/..." />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>
                <div>
                  <FormField
                    control={form.control}
                    name="facebookName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium">ชื่อ Facebook</FormLabel>
                        <FormControl>
                          <input type="text" {...field} className={inputClass} placeholder="ชื่อบน Facebook" />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">จำนวนเพื่อน Facebook</label>
                  <input type="text" value={formExtra.facebookFriends} onChange={(e) => setFormExtra(prev => ({ ...prev, facebookFriends: e.target.value }))} className={inputClass} placeholder="จำนวนเพื่อน" />
                </div>
              </div>
            </div>
          </details>

          {/* ===== ข้อมูลที่ทำงาน (collapsible) ===== */}
          <details className="group rounded-xl border border-border bg-card">
            <summary className="list-none flex items-center gap-2.5 p-5 cursor-pointer select-none hover:bg-accent/50 transition-colors [&::-webkit-details-marker]:hidden">
              <div className="size-8 rounded-lg bg-muted flex items-center justify-center">
                <Briefcase className="size-4 text-muted-foreground" strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-foreground">ข้อมูลที่ทำงาน</h3>
                <p className="text-xs text-muted-foreground">อาชีพ, เงินเดือน</p>
              </div>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-5 pb-5 border-t border-border pt-4">
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <FormField
                    control={form.control}
                    name="workplace"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium">ชื่อที่ทำงาน</FormLabel>
                        <FormControl>
                          <input type="text" {...field} className={inputClass} placeholder="ชื่อบริษัท/สถานที่ทำงาน" />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>
                <div>
                  <FormField
                    control={form.control}
                    name="occupation"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium">อาชีพ</FormLabel>
                        <FormControl>
                          <select {...field} className={inputClass}>
                            <option value="">-- เลือก --</option>
                            <option value="พนักงานบริษัท">พนักงานบริษัท</option>
                            <option value="รับจ้างทั่วไป">รับจ้างทั่วไป</option>
                            <option value="ค้าขาย/ธุรกิจส่วนตัว">ค้าขาย/ธุรกิจส่วนตัว</option>
                            <option value="พนักงานโรงงาน">พนักงานโรงงาน</option>
                            <option value="เกษตรกร">เกษตรกร</option>
                            <option value="ข้าราชการ/รัฐวิสาหกิจ">ข้าราชการ/รัฐวิสาหกิจ</option>
                            <option value="ขับรถ/ส่งของ">ขับรถ/ส่งของ</option>
                            <option value="ช่างซ่อม/ช่างเทคนิค">ช่างซ่อม/ช่างเทคนิค</option>
                            <option value="ก่อสร้าง">ก่อสร้าง</option>
                            <option value="ร้านอาหาร/บริการ">ร้านอาหาร/บริการ</option>
                            <option value="Freelance/อิสระ">Freelance/อิสระ</option>
                            <option value="นักศึกษา">นักศึกษา</option>
                            <option value="แม่บ้าน/ไม่ได้ทำงาน">แม่บ้าน/ไม่ได้ทำงาน</option>
                            <option value="อื่นๆ">อื่นๆ</option>
                          </select>
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>
                <div>
                  <FormField
                    control={form.control}
                    name="occupationDetail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium">รายละเอียดอาชีพ</FormLabel>
                        <FormControl>
                          <input type="text" {...field} className={inputClass} placeholder="รายละเอียดเพิ่มเติม" />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>
                <div>
                  <FormField
                    control={form.control}
                    name="salary"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium">เงินเดือน</FormLabel>
                        <FormControl>
                          <input type="number" {...field} className={inputClass} placeholder="0.00" />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
              <div className="mt-2">
                <label className="block text-xs font-medium text-foreground mb-1.5">ที่อยู่ที่ทำงาน</label>
                <AddressForm value={addressWork} onChange={setAddressWork} />
              </div>
            </div>
          </details>

          {/* ===== บุคคลอ้างอิง (collapsible) ===== */}
          <details className="group rounded-xl border border-border bg-card">
            <summary className="list-none flex items-center gap-2.5 p-5 cursor-pointer select-none hover:bg-accent/50 transition-colors [&::-webkit-details-marker]:hidden">
              <div className="size-8 rounded-lg bg-muted flex items-center justify-center">
                <Users className="size-4 text-muted-foreground" strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-foreground">บุคคลอ้างอิง</h3>
                <p className="text-xs text-muted-foreground">2 คน</p>
              </div>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-5 pb-5 border-t border-border pt-4 flex flex-col gap-4">
              {references.map((ref, idx) => (
                <div key={idx} className="rounded-lg border border-dashed border-border p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="size-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs font-semibold">{idx + 1}</span>
                    <span className="text-xs font-medium text-foreground">บุคคลอ้างอิง {idx + 1}</span>
                  </div>
                  <div className="grid grid-cols-6 gap-3">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-foreground mb-1.5">คำนำหน้า</label>
                      <select value={ref.prefix} onChange={(e) => updateRef(idx, 'prefix', e.target.value)} className={selectClass}>
                        <option value="">-- เลือก --</option>
                        {THAI_NAME_PREFIXES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-foreground mb-1.5">ชื่อ</label>
                      <input type="text" value={ref.firstName} onChange={(e) => updateRef(idx, 'firstName', e.target.value)} className={inputClass} placeholder="กรอกชื่อ" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-foreground mb-1.5">นามสกุล</label>
                      <input type="text" value={ref.lastName} onChange={(e) => updateRef(idx, 'lastName', e.target.value)} className={inputClass} placeholder="กรอกนามสกุล" />
                    </div>
                    <div className="col-span-3">
                      <label className="block text-xs font-medium text-foreground mb-1.5">เบอร์หลัก</label>
                      <input type="tel" value={ref.phone} onChange={(e) => updateRef(idx, 'phone', e.target.value)} className={inputClass} placeholder="0XX-XXX-XXXX" />
                    </div>
                    <div className="col-span-3">
                      <label className="block text-xs font-medium text-foreground mb-1.5">ความสัมพันธ์</label>
                      <select value={ref.relationship} onChange={(e) => updateRef(idx, 'relationship', e.target.value)} className={selectClass}>
                        <option value="">-- เลือก --</option>
                        {RELATIONSHIP_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </details>

          </div>
          {/* Sticky Footer */}
          <div className="sticky bottom-0 flex shrink-0 justify-end gap-3 border-t bg-background/95 px-6 py-4 backdrop-blur-xs">
            <button type="button" onClick={onClose} className="rounded-lg border border-input px-6 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent">ยกเลิก</button>
            <button type="submit" disabled={createMutation.isPending} className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50">
              {createMutation.isPending ? (
                <span className="inline-flex items-center gap-2"><div className="h-4 w-4 animate-spin rounded-full border-b-2 border-primary-foreground" /> กำลังบันทึก...</span>
              ) : submitLabel}
            </button>
          </div>
        </form>
      </Form>
    </>
  );
}
