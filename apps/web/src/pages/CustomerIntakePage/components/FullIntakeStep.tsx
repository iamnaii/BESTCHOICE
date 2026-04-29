import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Save } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';
import { THAI_NAME_PREFIXES, RELATIONSHIP_OPTIONS } from '@/lib/constants';
import AddressForm, {
  type AddressData,
  serializeAddress,
  deserializeAddress,
} from '@/components/ui/AddressForm';
import type { FullIntakeForm } from '../types';

const OCCUPATION_OPTIONS = [
  'พนักงานบริษัท',
  'รับจ้างทั่วไป',
  'ค้าขาย/ธุรกิจส่วนตัว',
  'พนักงานโรงงาน',
  'เกษตรกร',
  'ข้าราชการ/รัฐวิสาหกิจ',
  'ขับรถ/ส่งของ',
  'ช่างซ่อม/ช่างเทคนิค',
  'ก่อสร้าง',
  'ร้านอาหาร/บริการ',
  'Freelance/อิสระ',
  'นักศึกษา',
  'แม่บ้าน/ไม่ได้ทำงาน',
  'อื่นๆ',
];

const ADDRESS_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'OWN', label: 'บ้านตัวเอง' },
  { value: 'RELATIVE', label: 'บ้านญาติ' },
  { value: 'RENT', label: 'เช่าอาศัย' },
];

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring';

interface Props {
  customerId: string;
  initial: FullIntakeForm;
  onDone: () => void;
}

export default function FullIntakeStep({ customerId, initial, onDone }: Props) {
  const [form, setForm] = useState<FullIntakeForm>(initial);
  const [addressIdCard, setAddressIdCard] = useState<AddressData>(() =>
    deserializeAddress(initial.addressIdCard),
  );
  const [addressCurrent, setAddressCurrent] = useState<AddressData>(() =>
    deserializeAddress(initial.addressCurrent),
  );
  const [addressWork, setAddressWork] = useState<AddressData>(() =>
    deserializeAddress(initial.addressWork),
  );
  const [sameAddress, setSameAddress] = useState(false);

  useEffect(() => {
    setForm(initial);
    setAddressIdCard(deserializeAddress(initial.addressIdCard));
    setAddressCurrent(deserializeAddress(initial.addressCurrent));
    setAddressWork(deserializeAddress(initial.addressWork));
  }, [initial]);

  useEffect(() => {
    if (sameAddress) setAddressCurrent(addressIdCard);
  }, [sameAddress, addressIdCard]);

  const patch = (p: Partial<FullIntakeForm>) => setForm((prev) => ({ ...prev, ...p }));
  const patchRef = (idx: number, p: Partial<FullIntakeForm['references'][number]>) =>
    setForm((prev) => ({
      ...prev,
      references: prev.references.map((r, i) => (i === idx ? { ...r, ...p } : r)),
    }));

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        name: `${form.firstName} ${form.lastName}`.trim(),
      };
      if (form.prefix) payload.prefix = form.prefix;
      if (form.nickname) payload.nickname = form.nickname;
      if (form.birthDate) payload.birthDate = new Date(form.birthDate).toISOString();
      if (form.phoneSecondary) payload.phoneSecondary = form.phoneSecondary;
      if (form.email) payload.email = form.email;
      if (form.lineIdFinance) payload.lineIdFinance = form.lineIdFinance;
      if (form.lineIdShop) payload.lineIdShop = form.lineIdShop;
      if (form.facebookLink) payload.facebookLink = form.facebookLink;
      if (form.facebookName) payload.facebookName = form.facebookName;
      if (form.occupation) payload.occupation = form.occupation;
      if (form.salary && !isNaN(parseFloat(form.salary))) payload.salary = parseFloat(form.salary);
      if (form.workplace) payload.workplace = form.workplace;
      if (form.addressCurrentType) payload.addressCurrentType = form.addressCurrentType;
      if (form.googleMapLink) payload.googleMapLink = form.googleMapLink;

      const idCard = serializeAddress(addressIdCard);
      const current = sameAddress ? idCard : serializeAddress(addressCurrent);
      const work = serializeAddress(addressWork);
      if (idCard) payload.addressIdCard = idCard;
      if (current) payload.addressCurrent = current;
      if (work) payload.addressWork = work;

      const validRefs = form.references.filter((r) => r.firstName || r.lastName || r.phone);
      if (validRefs.length > 0) payload.references = validRefs;
      await api.patch(`/customers/${customerId}`, payload);
    },
    onSuccess: () => {
      toast.success('บันทึกข้อมูลลูกค้าสำเร็จ');
      onDone();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const canSave = form.firstName.trim().length > 0 && form.lastName.trim().length > 0;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-semibold text-foreground">ข้อมูลส่วนตัว</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">ชื่อเล่น</label>
            <Input
              value={form.nickname || ''}
              onChange={(e) => patch({ nickname: e.target.value })}
              placeholder="ไม่บังคับ"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">วันเกิด</label>
            <Input
              type="date"
              value={form.birthDate || ''}
              onChange={(e) => patch({ birthDate: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-semibold text-foreground">ข้อมูลติดต่อเพิ่มเติม</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">เบอร์โทรสำรอง</label>
            <Input
              value={form.phoneSecondary || ''}
              onChange={(e) => patch({ phoneSecondary: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">อีเมล</label>
            <Input
              type="email"
              value={form.email || ''}
              onChange={(e) => patch({ email: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">LINE ID (Finance / น้องเบส)</label>
            <Input
              value={form.lineIdFinance || ''}
              onChange={(e) => patch({ lineIdFinance: e.target.value })}
              placeholder="U1234567890abcdef..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">LINE ID (Shop / ร้าน)</label>
            <Input
              value={form.lineIdShop || ''}
              onChange={(e) => patch({ lineIdShop: e.target.value })}
              placeholder="U1234567890abcdef..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Facebook (ชื่อ)</label>
            <Input
              value={form.facebookName || ''}
              onChange={(e) => patch({ facebookName: e.target.value })}
              placeholder="ชื่อโปรไฟล์"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-foreground mb-1">Facebook (ลิงก์)</label>
            <Input
              type="url"
              value={form.facebookLink || ''}
              onChange={(e) => patch({ facebookLink: e.target.value })}
              placeholder="https://facebook.com/..."
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-semibold text-foreground">ที่อยู่</h3>
        <div>
          <h4 className="text-xs font-medium text-foreground mb-2">ที่อยู่ตามบัตรประชาชน</h4>
          <AddressForm value={addressIdCard} onChange={setAddressIdCard} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-medium text-foreground">ที่อยู่ปัจจุบัน</h4>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={sameAddress}
                onChange={(e) => setSameAddress(e.target.checked)}
                className="rounded border-input text-primary focus-visible:ring-ring/30"
              />
              <span className="text-xs text-muted-foreground">เหมือนที่อยู่ตามบัตร</span>
            </label>
          </div>
          <div className="mb-3">
            <label className="block text-xs font-medium text-foreground mb-1">ประเภทที่อยู่</label>
            <select
              value={form.addressCurrentType || ''}
              onChange={(e) => patch({ addressCurrentType: e.target.value })}
              className={selectClass}
            >
              <option value="">-- เลือก --</option>
              {ADDRESS_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {sameAddress ? (
            <p className="text-xs text-muted-foreground italic">ใช้ที่อยู่เดียวกับที่อยู่ตามบัตรประชาชน</p>
          ) : (
            <AddressForm value={addressCurrent} onChange={setAddressCurrent} />
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground mb-1">ลิงก์ Google Map</label>
          <Input
            type="url"
            value={form.googleMapLink || ''}
            onChange={(e) => patch({ googleMapLink: e.target.value })}
            placeholder="https://maps.google.com/..."
          />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-semibold text-foreground">อาชีพ</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">อาชีพ</label>
            <select
              value={form.occupation || ''}
              onChange={(e) => patch({ occupation: e.target.value })}
              className={selectClass}
            >
              <option value="">-- เลือก --</option>
              {OCCUPATION_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">เงินเดือน (บาท)</label>
            <Input
              type="number"
              value={form.salary || ''}
              onChange={(e) => patch({ salary: e.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-foreground mb-1">ชื่อที่ทำงาน</label>
            <Input
              value={form.workplace || ''}
              onChange={(e) => patch({ workplace: e.target.value })}
              placeholder="ชื่อบริษัท/สถานที่"
            />
          </div>
        </div>
        <div>
          <h4 className="text-xs font-medium text-foreground mb-2">ที่อยู่ที่ทำงาน</h4>
          <AddressForm value={addressWork} onChange={setAddressWork} />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-semibold text-foreground">ผู้อ้างอิง (4 คน)</h3>
        {form.references.map((ref, i) => (
          <div
            key={i}
            className="grid grid-cols-2 md:grid-cols-6 gap-2 pb-3 border-b border-border last:border-0"
          >
            <select
              value={ref.prefix || ''}
              onChange={(e) => patchRef(i, { prefix: e.target.value })}
              className={selectClass}
              aria-label="คำนำหน้า"
            >
              <option value="">คำนำหน้า</option>
              {THAI_NAME_PREFIXES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <Input
              placeholder="ชื่อ"
              value={ref.firstName}
              onChange={(e) => patchRef(i, { firstName: e.target.value })}
            />
            <Input
              placeholder="นามสกุล"
              value={ref.lastName}
              onChange={(e) => patchRef(i, { lastName: e.target.value })}
            />
            <Input
              placeholder="เบอร์"
              value={ref.phone}
              onChange={(e) =>
                patchRef(i, { phone: e.target.value.replace(/\D/g, '').slice(0, 10) })
              }
            />
            <select
              value={ref.relationship}
              onChange={(e) => patchRef(i, { relationship: e.target.value })}
              className={`${selectClass} col-span-2`}
              aria-label="ความสัมพันธ์"
            >
              <option value="">ความสัมพันธ์</option>
              {RELATIONSHIP_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <Button
          variant="primary"
          size="lg"
          onClick={() => saveMut.mutate()}
          disabled={!canSave || saveMut.isPending}
        >
          {saveMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          บันทึก
        </Button>
      </div>
    </div>
  );
}
