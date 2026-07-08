import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import { contactKeys } from '@/lib/api/contacts';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import AddressForm, {
  type AddressData,
  emptyAddress,
  serializeAddress,
} from '@/components/ui/AddressForm';
import { THAI_NAME_PREFIXES } from '@/lib/constants';
import { formatIdNumberInput, formatPhoneInput } from '@/utils/mask.util';

// ── Types ──────────────────────────────────────────────────────────────────

type ContactType = 'INDIVIDUAL' | 'JURISTIC';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which create endpoint to hit */
  role: 'SUPPLIER' | 'CUSTOMER';
  /** Prefill ชื่อ from the combobox search term */
  initialName?: string;
  onCreated: (r: { contactId: string; childId: string; name: string; taxId: string }) => void;
}

// Suppliers are mostly companies (Prisma SupplierType @default(JURISTIC));
// customers are persons only (Customer model has nationalId, no taxId).
const defaultTypeFor = (role: 'SUPPLIER' | 'CUSTOMER'): ContactType =>
  role === 'SUPPLIER' ? 'JURISTIC' : 'INDIVIDUAL';

// Supplier.titleName accepts คุณ as well (mirrors SupplierForm TITLE_OPTIONS)
const SUPPLIER_TITLE_OPTIONS = [...THAI_NAME_PREFIXES, 'คุณ'];

// ── Component ──────────────────────────────────────────────────────────────

export default function CreateContactModal({
  open,
  onOpenChange,
  role,
  initialName = '',
  onCreated,
}: Props) {
  const [contactType, setContactType] = useState<ContactType>(defaultTypeFor(role));
  const [prefix, setPrefix] = useState(''); // คำนำหน้า — persons only
  const [name, setName] = useState(initialName);
  const [idNumber, setIdNumber] = useState(''); // taxId (JURISTIC) or nationalId (INDIVIDUAL)
  const [phone, setPhone] = useState('');
  // Owner report 2026-07-08: live dash-insertion WHILE typing made some
  // environments (mobile/tablet IME keyboards, autofill, slow devices) drop
  // keystrokes — the controlled re-format rewrote the DOM value mid-input and
  // เลขบัตร/เบอร์โทร could not be entered completely. Show RAW digits while the
  // field is focused (nothing ever rewrites what the user is typing) and apply
  // the dashed format only on blur.
  const [idFocused, setIdFocused] = useState(false);
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [address, setAddress] = useState<AddressData>({ ...emptyAddress });
  const [hasVat, setHasVat] = useState(false);

  // Focus ชื่อ without scrolling — the default autofocus scroll-into-view pushes
  // the body down and hides the ประเภท toggle on shorter screens.
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Reset on every open — works both when the parent keeps the modal mounted
  // (ContactCombobox) and when it conditionally renders it (ContactsPage).
  useEffect(() => {
    if (!open) return;
    setContactType(defaultTypeFor(role));
    setPrefix('');
    setName(initialName);
    setIdNumber('');
    setPhone('');
    setAddress({ ...emptyAddress });
    setHasVat(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── Payload builders ────────────────────────────────────────────────────

  const buildSupplierPayload = () => {
    const payload: Record<string, unknown> = {
      // Map UI toggle to SupplierType enum
      type: contactType === 'JURISTIC' ? 'JURISTIC' : 'INDIVIDUAL',
      name: name.trim(),
      phone: phone.trim(),
    };
    if (contactType === 'INDIVIDUAL' && prefix) payload.titleName = prefix;
    const serialized = serializeAddress(address);
    if (serialized) payload.address = serialized;
    if (idNumber.trim()) {
      payload.taxId = idNumber.trim();
    }
    payload.hasVat = hasVat;
    return payload;
  };

  const buildCustomerPayload = () => {
    const payload: Record<string, unknown> = {
      name: name.trim(),
      phone: phone.trim(),
    };
    if (prefix) payload.prefix = prefix;
    if (idNumber.trim()) {
      payload.nationalId = idNumber.trim();
    }
    const serialized = serializeAddress(address);
    if (serialized) payload.addressCurrent = serialized;
    return payload;
  };

  // ── Mutation ────────────────────────────────────────────────────────────

  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      if (role === 'SUPPLIER') {
        const { data } = await api.post('/suppliers', buildSupplierPayload());
        return data as {
          id: string;
          contactId: string | null;
          name: string;
          taxId?: string | null;
        };
      } else {
        const { data } = await api.post('/customers', buildCustomerPayload());
        return data as {
          id: string;
          contactId: string | null;
          name: string;
          nationalId?: string | null;
        };
      }
    },
    onSuccess: (data) => {
      const childId = data.id;
      const returnedName = data.name;
      const taxId =
        role === 'SUPPLIER'
          ? ((data as { taxId?: string | null }).taxId ?? '')
          : ((data as { taxId?: string | null }).taxId ?? '');

      // Fix #4: guard against missing contactId — an empty string would cause
      // contactsApi.detail('') to make a malformed request. Treat it as an error.
      if (!data.contactId) {
        toast.error('สร้างผู้ติดต่อไม่สำเร็จ — ไม่พบ contactId จาก API');
        return;
      }

      queryClient.invalidateQueries({ queryKey: contactKeys.all });
      // Close before onCreated: parents may navigate on create (e.g. ContactsPage),
      // which unmounts this modal — closing first keeps the open-state ordering sane.
      onOpenChange(false);
      onCreated({ contactId: data.contactId, childId, name: returnedName, taxId });
      toast.success('สร้างผู้ติดต่อสำเร็จ');
    },
    onError: (err: unknown) => {
      const msg =
        err &&
        typeof err === 'object' &&
        'response' in err &&
        (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(`สร้างผู้ติดต่อไม่สำเร็จ — ${msg || 'กรุณาลองใหม่อีกครั้ง'}`);
    },
  });

  // ── Validation ──────────────────────────────────────────────────────────

  const phoneValid = role === 'CUSTOMER' ? /^0[0-9]{9}$/.test(phone) : phone.trim().length > 0;

  // taxId/nationalId is the natural key for contact dedup — a partial number
  // would silently break duplicate matching, so require all 13 digits if filled.
  const idValid = idNumber === '' || idNumber.length === 13;

  const canSubmit = name.trim().length > 0 && phoneValid && idValid && !mutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) mutation.mutate();
  };

  // ── Labels ──────────────────────────────────────────────────────────────

  const idLabel =
    role === 'SUPPLIER' && contactType === 'JURISTIC'
      ? 'เลขผู้เสียภาษี (13 หลัก)'
      : 'เลขบัตรประชาชน (13 หลัก)';

  const titleLabel = role === 'SUPPLIER' ? 'เพิ่มผู้จัดจำหน่าย' : 'เพิ่มลูกค้าใหม่';

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-xl max-h-[90vh] flex flex-col p-0 gap-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          nameInputRef.current?.focus({ preventScroll: true });
        }}
      >
        <DialogHeader className="px-6 pt-4 pb-3 mb-0 shrink-0 border-b border-border">
          <DialogTitle className="leading-snug">{titleLabel}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-3 space-y-3">
            {/* ── ประเภท toggle — SUPPLIER only (customers are persons; the
                 Customer model has no taxId so a juristic customer isn't
                 representable and the entered number would be dropped) ── */}
            {role === 'SUPPLIER' && (
              <div className="flex items-center gap-3">
                <Label className="shrink-0 leading-snug">ประเภท</Label>
                <div className="flex flex-1 gap-2">
                  {(['JURISTIC', 'INDIVIDUAL'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setContactType(t);
                        setIdNumber('');
                        setPrefix('');
                        if (t === 'INDIVIDUAL') setHasVat(false);
                      }}
                      className={[
                        'flex-1 rounded-lg border px-3 py-1.5 text-sm leading-snug transition-colors',
                        contactType === t
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background text-foreground hover:bg-accent',
                      ].join(' ')}
                    >
                      {t === 'INDIVIDUAL' ? 'บุคคลธรรมดา' : 'นิติบุคคล'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── คำนำหน้า + ชื่อ (required) — คำนำหน้าเฉพาะบุคคลธรรมดา ── */}
            <div className="space-y-1.5">
              <Label htmlFor="ccm-name" className="leading-snug">
                ชื่อ <span className="text-destructive">*</span>
              </Label>
              <div className="flex gap-2">
                {contactType === 'INDIVIDUAL' && (
                  <select
                    aria-label="คำนำหน้า"
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                    className="h-9 w-28 shrink-0 rounded-md border border-input bg-background px-2 text-sm outline-hidden focus:ring-2 focus:ring-ring/30"
                  >
                    <option value="">คำนำหน้า</option>
                    {(role === 'SUPPLIER' ? SUPPLIER_TITLE_OPTIONS : THAI_NAME_PREFIXES).map(
                      (p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ),
                    )}
                  </select>
                )}
                <Input
                  id="ccm-name"
                  ref={nameInputRef}
                  className="flex-1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    role === 'SUPPLIER' && contactType === 'JURISTIC'
                      ? 'ชื่อบริษัท'
                      : 'ชื่อ-นามสกุล'
                  }
                  autoComplete="off"
                />
              </div>
            </div>

            {/* ── เลขประจำตัว (optional) + เบอร์โทร (required) — แถวเดียวกันบนจอกว้าง ── */}
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ccm-idnumber" className="leading-snug">
                  {idLabel}
                </Label>
                <Input
                  id="ccm-idnumber"
                  value={idFocused ? idNumber : formatIdNumberInput(idNumber)}
                  onChange={(e) => setIdNumber(e.target.value.replace(/\D/g, '').slice(0, 13))}
                  onFocus={() => setIdFocused(true)}
                  onBlur={() => setIdFocused(false)}
                  maxLength={17}
                  placeholder="1-2345-67890-12-3"
                  inputMode="numeric"
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                />
                {!idValid && (
                  <p className="text-xs text-destructive leading-snug">
                    ต้องเป็นตัวเลขครบ 13 หลัก (กรอกแล้ว {idNumber.length} หลัก)
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ccm-phone" className="leading-snug">
                  เบอร์โทร <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="ccm-phone"
                  value={phoneFocused ? phone : formatPhoneInput(phone)}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  onFocus={() => setPhoneFocused(true)}
                  onBlur={() => setPhoneFocused(false)}
                  maxLength={12}
                  placeholder="081-234-5678"
                  inputMode="tel"
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                />
                {role === 'CUSTOMER' && phone && !/^0[0-9]{9}$/.test(phone) && (
                  <p className="text-xs text-destructive leading-snug">
                    เบอร์โทรต้องเป็นเลข 10 หลัก ขึ้นต้นด้วย 0
                  </p>
                )}
              </div>
            </div>

            {/* ── ที่อยู่ (optional) — โครงสร้างเดียวกับหน้าลูกค้า/ผู้จัดจำหน่าย ── */}
            <AddressForm value={address} onChange={setAddress} label="ที่อยู่ (ไม่บังคับ)" />
          </DialogBody>

          <DialogFooter className="px-6 py-3 border-t border-border shrink-0 items-center sm:justify-between">
            {/* ── จด VAT — เฉพาะนิติบุคคล (mirror SupplierForm: บุคคลธรรมดาไม่มีจด VAT) ── */}
            {role === 'SUPPLIER' && contactType === 'JURISTIC' ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="ccm-hasvat"
                  checked={hasVat}
                  onCheckedChange={(v) => setHasVat(v === true)}
                />
                <Label htmlFor="ccm-hasvat" className="cursor-pointer leading-snug">
                  จด VAT
                </Label>
              </div>
            ) : (
              <span aria-hidden />
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:gap-2.5">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={mutation.isPending}
              >
                ยกเลิก
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {mutation.isPending ? 'กำลังสร้าง...' : 'สร้าง'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
