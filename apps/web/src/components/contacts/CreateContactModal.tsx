import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

// ── Types ──────────────────────────────────────────────────────────────────

type ContactType = 'INDIVIDUAL' | 'JURISTIC';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which create endpoint to hit */
  role: 'SUPPLIER' | 'CUSTOMER';
  /** Prefill ชื่อ from the combobox search term */
  initialName?: string;
  onCreated: (r: {
    contactId: string;
    childId: string;
    name: string;
    taxId: string;
  }) => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function CreateContactModal({
  open,
  onOpenChange,
  role,
  initialName = '',
  onCreated,
}: Props) {
  const [contactType, setContactType] = useState<ContactType>('INDIVIDUAL');
  const [name, setName] = useState(initialName);
  const [idNumber, setIdNumber] = useState(''); // taxId (JURISTIC) or nationalId (INDIVIDUAL)
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [hasVat, setHasVat] = useState(false);

  // Sync initialName when modal opens with a new value
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setName(initialName);
      setContactType('INDIVIDUAL');
      setIdNumber('');
      setPhone('');
      setAddress('');
      setHasVat(false);
    }
    onOpenChange(next);
  };

  // ── Payload builders ────────────────────────────────────────────────────

  const buildSupplierPayload = () => {
    const payload: Record<string, unknown> = {
      // Map UI toggle to SupplierType enum
      type: contactType === 'JURISTIC' ? 'JURISTIC' : 'INDIVIDUAL',
      name: name.trim(),
      phone: phone.trim(),
    };
    if (address.trim()) payload.address = address.trim();
    if (contactType === 'JURISTIC' && idNumber.trim()) {
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
    if (contactType === 'INDIVIDUAL' && idNumber.trim()) {
      payload.nationalId = idNumber.trim();
    }
    if (address.trim()) payload.addressCurrent = address.trim();
    return payload;
  };

  // ── Mutation ────────────────────────────────────────────────────────────

  const mutation = useMutation({
    mutationFn: async () => {
      if (role === 'SUPPLIER') {
        const { data } = await api.post('/suppliers', buildSupplierPayload());
        return data as { id: string; contactId: string | null; name: string; taxId?: string | null };
      } else {
        const { data } = await api.post('/customers', buildCustomerPayload());
        return data as { id: string; contactId: string | null; name: string; nationalId?: string | null };
      }
    },
    onSuccess: (data) => {
      const childId = data.id;
      const contactId = data.contactId ?? '';
      const returnedName = data.name;
      const taxId =
        role === 'SUPPLIER'
          ? ((data as { taxId?: string | null }).taxId ?? idNumber.trim())
          : idNumber.trim();

      onCreated({ contactId, childId, name: returnedName, taxId });
      toast.success('สร้างผู้ติดต่อสำเร็จ');
      onOpenChange(false);
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

  const canSubmit = name.trim().length > 0 && phone.trim().length > 0 && !mutation.isPending;

  // ── Labels ──────────────────────────────────────────────────────────────

  const idLabel =
    contactType === 'JURISTIC' ? 'เลขผู้เสียภาษี (13 หลัก)' : 'เลขบัตรประชาชน (13 หลัก)';

  const titleLabel =
    role === 'SUPPLIER' ? 'เพิ่มผู้จัดจำหน่าย' : 'เพิ่มลูกค้าใหม่';

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="leading-snug">{titleLabel}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* ── ประเภท toggle ── */}
          <div>
            <Label className="mb-2 block leading-snug">ประเภท</Label>
            <div className="flex gap-2">
              {(['INDIVIDUAL', 'JURISTIC'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setContactType(t);
                    setIdNumber('');
                    if (t === 'INDIVIDUAL') setHasVat(false);
                  }}
                  className={[
                    'flex-1 rounded-lg border px-3 py-2 text-sm leading-snug transition-colors',
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

          {/* ── ชื่อ (required) ── */}
          <div className="space-y-1.5">
            <Label htmlFor="ccm-name" className="leading-snug">
              ชื่อ <span className="text-destructive">*</span>
            </Label>
            <Input
              id="ccm-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ชื่อบริษัท หรือ ชื่อ-นามสกุล"
              autoFocus
            />
          </div>

          {/* ── เลขประจำตัว (optional) ── */}
          <div className="space-y-1.5">
            <Label htmlFor="ccm-idnumber" className="leading-snug">
              {idLabel}
            </Label>
            <Input
              id="ccm-idnumber"
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value.replace(/\D/g, '').slice(0, 13))}
              placeholder="ตัวเลข 13 หลัก"
              inputMode="numeric"
            />
          </div>

          {/* ── เบอร์โทร (required) ── */}
          <div className="space-y-1.5">
            <Label htmlFor="ccm-phone" className="leading-snug">
              เบอร์โทร <span className="text-destructive">*</span>
            </Label>
            <Input
              id="ccm-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0812345678"
              inputMode="tel"
            />
            {role === 'CUSTOMER' && phone && !/^0[0-9]{9}$/.test(phone) && (
              <p className="text-xs text-destructive leading-snug">
                เบอร์โทรต้องเป็นเลข 10 หลัก ขึ้นต้นด้วย 0
              </p>
            )}
          </div>

          {/* ── ที่อยู่ (optional) ── */}
          <div className="space-y-1.5">
            <Label htmlFor="ccm-address" className="leading-snug">
              ที่อยู่
            </Label>
            <Input
              id="ccm-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="ที่อยู่ (ไม่บังคับ)"
            />
          </div>

          {/* ── จด VAT — SUPPLIER only ── */}
          {role === 'SUPPLIER' && (
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
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            ยกเลิก
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
          >
            {mutation.isPending ? 'กำลังสร้าง...' : 'สร้าง'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
