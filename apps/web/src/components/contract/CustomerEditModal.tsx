import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import Modal from '@/components/ui/Modal';
import AddressForm, { AddressData, emptyAddress, serializeAddress, deserializeAddress } from '@/components/ui/AddressForm';
import { toast } from 'sonner';
import { THAI_NAME_PREFIXES, RELATIONSHIP_OPTIONS } from '@/lib/constants';
import ThaiDateInput from '@/components/ui/ThaiDateInput';

interface CustReferenceData {
  prefix?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  relationship?: string;
}

interface CustomerSnapshot {
  name?: string;
  phone?: string;
  prefix?: string;
  nickname?: string;
  occupation?: string;
  salary?: string;
}

interface Props {
  customerId: string;
  customerSnapshot: CustomerSnapshot | null;
  customerBasic: { name: string; phone: string };
  onClose: () => void;
  onSuccess: () => void;
}


export default function CustomerEditModal({ customerId, customerSnapshot, customerBasic, onClose, onSuccess }: Props) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    prefix: '', name: '', nickname: '', birthDate: '',
    phone: '', phoneSecondary: '', email: '', lineId: '',
    facebookLink: '', facebookName: '', facebookFriends: '', googleMapLink: '',
    occupation: '', occupationDetail: '', salary: '', workplace: '',
  });
  const [addrIdCard, setAddrIdCard] = useState<AddressData>(emptyAddress);
  const [addrCurrent, setAddrCurrent] = useState<AddressData>(emptyAddress);
  const [addrWork, setAddrWork] = useState<AddressData>(emptyAddress);
  const [sameAddress, setSameAddress] = useState(false);
  const [references, setReferences] = useState<CustReferenceData[]>([{}, {}, {}, {}]);

  const addrIdCardJson = JSON.stringify(addrIdCard);
  useEffect(() => {
    if (sameAddress) setAddrCurrent(JSON.parse(addrIdCardJson));
  }, [sameAddress, addrIdCardJson]);

  useEffect(() => {
    (async () => {
      try {
        const { data: fc } = await api.get(`/customers/${customerId}`);
        setForm({
          prefix: fc.prefix || '', name: fc.name || '', nickname: fc.nickname || '',
          birthDate: fc.birthDate ? fc.birthDate.split('T')[0] : '',
          phone: fc.phone || '', phoneSecondary: fc.phoneSecondary || '',
          email: fc.email || '', lineId: fc.lineId || '',
          facebookLink: fc.facebookLink || '', facebookName: fc.facebookName || '',
          facebookFriends: fc.facebookFriends || '', googleMapLink: fc.googleMapLink || '',
          occupation: fc.occupation || '', occupationDetail: fc.occupationDetail || '',
          salary: fc.salary || '', workplace: fc.workplace || '',
        });
        setAddrIdCard(deserializeAddress(fc.addressIdCard));
        setAddrCurrent(deserializeAddress(fc.addressCurrent));
        setAddrWork(deserializeAddress(fc.addressWork));
        setSameAddress(fc.addressIdCard != null && fc.addressIdCard === fc.addressCurrent);
        const existingRefs = (fc.references || []) as CustReferenceData[];
        const refs = [...existingRefs];
        while (refs.length < 4) refs.push({});
        setReferences(refs);
      } catch {
        toast.error('ไม่สามารถโหลดข้อมูลลูกค้าเต็มได้ ใช้ข้อมูล snapshot แทน');
        const snap = customerSnapshot;
        setForm({
          prefix: snap?.prefix || '', name: snap?.name || customerBasic.name || '',
          nickname: snap?.nickname || '', birthDate: '',
          phone: snap?.phone || customerBasic.phone || '', phoneSecondary: '',
          email: '', lineId: '', facebookLink: '', facebookName: '',
          facebookFriends: '', googleMapLink: '',
          occupation: snap?.occupation || '', occupationDetail: '',
          salary: snap?.salary || '', workplace: '',
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [customerId, customerSnapshot, customerBasic]);

  const mutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      return api.patch(`/customers/${customerId}`, data);
    },
    onSuccess: () => {
      toast.success('แก้ไขข้อมูลลูกค้าสำเร็จ');
      onClose();
      onSuccess();
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  const updateRef = (index: number, field: keyof CustReferenceData, value: string) => {
    setReferences(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      prefix: form.prefix || null,
      name: form.name || null,
      nickname: form.nickname || null,
      phone: form.phone || null,
      phoneSecondary: form.phoneSecondary || null,
      email: form.email || null,
      lineId: form.lineId || null,
      facebookLink: form.facebookLink || null,
      facebookName: form.facebookName || null,
      facebookFriends: form.facebookFriends || null,
      googleMapLink: form.googleMapLink || null,
      occupation: form.occupation || null,
      occupationDetail: form.occupationDetail || null,
      salary: form.salary && !isNaN(parseFloat(form.salary)) ? parseFloat(form.salary) : null,
      workplace: form.workplace || null,
      birthDate: form.birthDate ? form.birthDate + 'T00:00:00.000Z' : null,
    };

    const a1 = serializeAddress(addrIdCard);
    const a2 = serializeAddress(addrCurrent);
    const a3 = serializeAddress(addrWork);
    if (a1) payload.addressIdCard = a1;
    if (a2) payload.addressCurrent = a2;
    if (a3) payload.addressWork = a3;

    const validRefs = references.filter(r => r.firstName || r.lastName || r.phone);
    payload.references = validRefs.length > 0 ? validRefs : [];

    mutation.mutate(payload);
  };

  return (
    <Modal isOpen title="แก้ไขข้อมูลลูกค้า" onClose={onClose} size="lg">
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">
          <div className="border border-border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">ข้อมูลส่วนตัว</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">คำนำหน้า</label>
                <select value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background">
                  <option value="">-- เลือก --</option>
                  {THAI_NAME_PREFIXES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">ชื่อ-นามสกุล *</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" required />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">ชื่อเล่น</label>
                <input type="text" value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">วันเกิด</label>
                <ThaiDateInput value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
            </div>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">ที่อยู่ตามบัตรประชาชน</h3>
            <AddressForm value={addrIdCard} onChange={setAddrIdCard} />
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">ที่อยู่ปัจจุบัน</h3>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={sameAddress} onChange={(e) => setSameAddress(e.target.checked)} className="rounded border-input text-primary focus-visible:ring-2 focus-visible:ring-ring/30" />
                <span className="text-xs text-muted-foreground">เหมือนที่อยู่ตามบัตร</span>
              </label>
            </div>
            {sameAddress ? (
              <p className="text-xs text-muted-foreground italic">ใช้ที่อยู่เดียวกับที่อยู่ตามบัตรประชาชน</p>
            ) : (
              <AddressForm value={addrCurrent} onChange={setAddrCurrent} />
            )}
            <div className="mt-3">
              <label className="block text-xs text-muted-foreground mb-1">Link Google Map</label>
              <input type="url" value={form.googleMapLink} onChange={(e) => setForm({ ...form, googleMapLink: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" placeholder="https://maps.google.com/..." />
            </div>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">ข้อมูลติดต่อ</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">เบอร์หลัก *</label>
                <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" required />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">เบอร์สำรอง</label>
                <input type="tel" value={form.phoneSecondary} onChange={(e) => setForm({ ...form, phoneSecondary: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">อีเมล</label>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">LINE ID</label>
                <input type="text" value={form.lineId} onChange={(e) => setForm({ ...form, lineId: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">ลิงก์ Facebook</label>
                <input type="url" value={form.facebookLink} onChange={(e) => setForm({ ...form, facebookLink: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">ชื่อ Facebook</label>
                <input type="text" value={form.facebookName} onChange={(e) => setForm({ ...form, facebookName: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">จำนวนเพื่อน Facebook</label>
                <input type="text" value={form.facebookFriends} onChange={(e) => setForm({ ...form, facebookFriends: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
            </div>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">ข้อมูลที่ทำงาน</h3>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">ชื่อที่ทำงาน</label>
                <input type="text" value={form.workplace} onChange={(e) => setForm({ ...form, workplace: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">อาชีพ</label>
                <input type="text" value={form.occupation} onChange={(e) => setForm({ ...form, occupation: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">รายละเอียดอาชีพ</label>
                <input type="text" value={form.occupationDetail} onChange={(e) => setForm({ ...form, occupationDetail: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">เงินเดือน</label>
                <input type="number" value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" placeholder="0.00" />
              </div>
            </div>
            <div className="mt-2">
              <label className="block text-xs text-muted-foreground mb-1">ที่อยู่ที่ทำงาน</label>
              <AddressForm value={addrWork} onChange={setAddrWork} />
            </div>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">รายชื่อบุคคลอ้างอิง</h3>
            <div className="space-y-4">
              {references.map((ref, idx) => (
                <div key={idx}>
                  <div className="text-xs font-medium text-muted-foreground mb-2">บุคคลอ้างอิง {idx + 1}</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">คำนำหน้า</label>
                      <select value={ref.prefix || ''} onChange={(e) => updateRef(idx, 'prefix', e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background">
                        <option value="">-- เลือก --</option>
                        {THAI_NAME_PREFIXES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">ชื่อ</label>
                      <input type="text" value={ref.firstName || ''} onChange={(e) => updateRef(idx, 'firstName', e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">นามสกุล</label>
                      <input type="text" value={ref.lastName || ''} onChange={(e) => updateRef(idx, 'lastName', e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">เบอร์โทร</label>
                      <input type="tel" value={ref.phone || ''} onChange={(e) => updateRef(idx, 'phone', e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">ความสัมพันธ์</label>
                      <select value={ref.relationship || ''} onChange={(e) => updateRef(idx, 'relationship', e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background">
                        <option value="">-- เลือก --</option>
                        {RELATIONSHIP_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2 sticky bottom-0 bg-background py-3 border-t">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground border border-input rounded-lg">ยกเลิก</button>
            <button type="submit" disabled={mutation.isPending || !form.name.trim() || !form.phone.trim()} className="px-6 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
              {mutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
