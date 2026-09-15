import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import AddressForm, { AddressData, deserializeAddress, emptyAddress, serializeAddress } from '@/components/ui/AddressForm';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { RELATIONSHIP_OPTIONS, THAI_NAME_PREFIXES } from '@/lib/constants';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';
import { invalidateCustomerJourney } from '../hooks/useCustomerJourney';
import type { CustomerDetail, ReferenceData } from '../types';

interface EditCustomerDialogProps {
  customer: CustomerDetail;
  open: boolean;
  onClose: () => void;
}

export default function EditCustomerDialog({ customer, open, onClose }: EditCustomerDialogProps) {
  const queryClient = useQueryClient();

  const [editForm, setEditForm] = useState({
    prefix: '', name: '', nickname: '', phone: '', phoneSecondary: '',
    email: '', lineIdFinance: '', lineIdShop: '', facebookLink: '', facebookName: '', facebookFriends: '',
    googleMapLink: '', occupation: '', occupationDetail: '', salary: '', workplace: '',
    birthDate: '',
  });
  const [editAddrIdCard, setEditAddrIdCard] = useState<AddressData>(emptyAddress);
  const [editAddrCurrent, setEditAddrCurrent] = useState<AddressData>(emptyAddress);
  const [editAddrWork, setEditAddrWork] = useState<AddressData>(emptyAddress);
  const [editRefs, setEditRefs] = useState<ReferenceData[]>([]);
  const [editSameAddress, setEditSameAddress] = useState(false);

  useEffect(() => {
    if (editSameAddress) setEditAddrCurrent({ ...editAddrIdCard });
  }, [editSameAddress, editAddrIdCard]);

  // ตั้งฟอร์มจาก customer ใหม่ทุกครั้งที่เปิดโมดัล (ตรงกับ startEdit() เดิมที่ถูกเรียกตอนคลิกปุ่ม
  // แก้ไขข้อมูล เท่านั้น) — ตั้งใจ depend แค่ open ไม่ใส่ customer กันฟอร์มรีเซ็ตระหว่างพิมพ์ถ้ามี refetch
  useEffect(() => {
    if (open) {
      setEditForm({
        prefix: customer.prefix || '',
        name: customer.name,
        nickname: customer.nickname || '',
        phone: customer.phone || '',
        phoneSecondary: customer.phoneSecondary || '',
        email: customer.email || '',
        lineIdFinance: customer.lineIdFinance || '',
        lineIdShop: customer.lineIdShop || '',
        facebookLink: customer.facebookLink || '',
        facebookName: customer.facebookName || '',
        facebookFriends: customer.facebookFriends || '',
        googleMapLink: customer.googleMapLink || '',
        occupation: customer.occupation || '',
        occupationDetail: customer.occupationDetail || '',
        salary: customer.salary || '',
        workplace: customer.workplace || '',
        birthDate: customer.birthDate ? customer.birthDate.split('T')[0] : '',
      });
      const idCardAddr = deserializeAddress(customer.addressIdCard);
      const currentAddr = deserializeAddress(customer.addressCurrent);
      setEditAddrIdCard(idCardAddr);
      setEditAddrCurrent(currentAddr);
      setEditAddrWork(deserializeAddress(customer.addressWork));
      setEditSameAddress(
        customer.addressIdCard != null && customer.addressIdCard === customer.addressCurrent
      );
      // Initialize references with 4 slots (sanitize: drop non-object garbage like null/strings/nested arrays)
      const existingRefs = Array.isArray(customer.references)
        ? customer.references.filter(
            (r): r is ReferenceData => r !== null && typeof r === 'object' && !Array.isArray(r),
          )
        : [];
      const refs = [...existingRefs];
      while (refs.length < 4) refs.push({});
      setEditRefs(refs);
    }
  }, [open]);

  const updateEditRef = (index: number, field: keyof ReferenceData, value: string) => {
    setEditRefs(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
  };

  const updateCustomerMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {};
      if (editForm.prefix) payload.prefix = editForm.prefix;
      if (editForm.name) payload.name = editForm.name;
      if (editForm.nickname) payload.nickname = editForm.nickname;
      if (editForm.phone) payload.phone = editForm.phone;
      if (editForm.phoneSecondary) payload.phoneSecondary = editForm.phoneSecondary;
      if (editForm.email) payload.email = editForm.email;
      if (editForm.lineIdFinance) payload.lineIdFinance = editForm.lineIdFinance;
      if (editForm.lineIdShop) payload.lineIdShop = editForm.lineIdShop;
      if (editForm.facebookLink) payload.facebookLink = editForm.facebookLink;
      if (editForm.facebookName) payload.facebookName = editForm.facebookName;
      if (editForm.facebookFriends) payload.facebookFriends = editForm.facebookFriends;
      if (editForm.googleMapLink) payload.googleMapLink = editForm.googleMapLink;
      if (editForm.occupation) payload.occupation = editForm.occupation;
      if (editForm.occupationDetail) payload.occupationDetail = editForm.occupationDetail;
      if (editForm.salary && !isNaN(parseFloat(editForm.salary))) payload.salary = parseFloat(editForm.salary);
      if (editForm.workplace) payload.workplace = editForm.workplace;
      if (editForm.birthDate) payload.birthDate = new Date(editForm.birthDate).toISOString();

      const addrIdCard = serializeAddress(editAddrIdCard);
      const addrCurrent = serializeAddress(editAddrCurrent);
      const addrWork = serializeAddress(editAddrWork);
      if (addrIdCard) payload.addressIdCard = addrIdCard;
      if (addrCurrent) payload.addressCurrent = addrCurrent;
      if (addrWork) payload.addressWork = addrWork;

      const validRefs = editRefs.filter(r => r.firstName || r.lastName || r.phone);
      payload.references = validRefs.length > 0 ? validRefs : [];

      const { data } = await api.patch(`/customers/${customer.id}`, payload);
      return data;
    },
    onSuccess: () => {
      toast.success('แก้ไขข้อมูลลูกค้าสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['customer', customer.id] });
      invalidateCustomerJourney(queryClient, customer.id);
      onClose();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  if (!open) return null;

  return (
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8" role="dialog" aria-modal="true" aria-label="แก้ไขข้อมูลลูกค้า">
        <div className="w-full max-w-3xl bg-background rounded-xl shadow-modal overflow-hidden flex flex-col max-h-[calc(100vh-4rem)]">
          <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between shrink-0">
            <button type="button" onClick={onClose} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              กลับ
            </button>
            <h2 className="text-lg font-semibold text-foreground">แก้ไขข้อมูลลูกค้า</h2>
            <div className="w-16" />
          </div>
        <form onSubmit={(e) => { e.preventDefault(); updateCustomerMutation.mutate(); }} className="flex-1 overflow-y-auto flex flex-col">
          <div className="p-6 space-y-5 flex-1">

          {/* ข้อมูลส่วนตัว */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">ข้อมูลส่วนตัว</h3>
                <p className="text-xs text-muted-foreground">ชื่อ, คำนำหน้า, วันเกิด</p>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">คำนำหน้า</label>
                <select value={editForm.prefix} onChange={(e) => setEditForm({ ...editForm, prefix: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20">
                  <option value="">-- เลือก --</option>
                  {THAI_NAME_PREFIXES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">ชื่อ-นามสกุล <span className="text-destructive">*</span></label>
                <input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" required />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">ชื่อเล่น</label>
                <input type="text" value={editForm.nickname} onChange={(e) => setEditForm({ ...editForm, nickname: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">วันเกิด</label>
                <ThaiDateInput value={editForm.birthDate} onChange={(e) => setEditForm({ ...editForm, birthDate: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
              </div>
            </div>
          </div>

          {/* ที่อยู่ */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">ที่อยู่ตามบัตรประชาชน</h3>
                <p className="text-xs text-muted-foreground">ที่อยู่ในบัตรประชาชน</p>
              </div>
            </div>
            <AddressForm value={editAddrIdCard} onChange={setEditAddrIdCard} />
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center justify-center size-8 rounded-lg bg-muted text-muted-foreground">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9 12 2l9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">ที่อยู่ปัจจุบัน</h3>
                  <p className="text-xs text-muted-foreground">ที่พักอาศัยจริง</p>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={editSameAddress} onChange={(e) => setEditSameAddress(e.target.checked)} className="rounded border-input text-primary focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background" />
                <span className="text-xs text-muted-foreground">เหมือนที่อยู่ตามบัตร</span>
              </label>
            </div>
            {editSameAddress ? (
              <p className="text-xs text-muted-foreground italic">ใช้ที่อยู่เดียวกับที่อยู่ตามบัตรประชาชน</p>
            ) : (
              <AddressForm value={editAddrCurrent} onChange={setEditAddrCurrent} />
            )}
            <div className="mt-3">
              <label className="block text-xs font-medium text-foreground mb-1.5">Link Google Map</label>
              <input type="url" value={editForm.googleMapLink} onChange={(e) => setEditForm({ ...editForm, googleMapLink: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" placeholder="https://maps.google.com/..." />
            </div>
          </div>

          {/* ข้อมูลติดต่อ */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-warning/10 text-warning">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">ข้อมูลติดต่อ</h3>
                <p className="text-xs text-muted-foreground">เบอร์โทร, อีเมล, LINE, Facebook</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                {/* R41: ผู้สนใจจากแชทยังไม่มีเบอร์ — ช่องนี้ไม่ required สำหรับเขา ดาวจึงต้องหายไปด้วย ไม่ใช่ค้างอยู่ */}
                <label className="block text-xs font-medium text-foreground mb-1.5">เบอร์หลัก{!customer?.chatPlaceholder && <span className="text-destructive"> *</span>}</label>
                <input type="tel" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" required={!customer?.chatPlaceholder} />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">เบอร์สำรอง</label>
                <input type="tel" value={editForm.phoneSecondary} onChange={(e) => setEditForm({ ...editForm, phoneSecondary: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">อีเมล</label>
                <input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">LINE ID (Finance / น้องเบส)</label>
                <input type="text" value={editForm.lineIdFinance} onChange={(e) => setEditForm({ ...editForm, lineIdFinance: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" placeholder="U1234567890abcdef..." />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">LINE ID (Shop / ร้าน)</label>
                <input type="text" value={editForm.lineIdShop} onChange={(e) => setEditForm({ ...editForm, lineIdShop: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" placeholder="U1234567890abcdef..." />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">ลิงก์ Facebook</label>
                <input type="url" value={editForm.facebookLink} onChange={(e) => setEditForm({ ...editForm, facebookLink: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">ชื่อ Facebook</label>
                <input type="text" value={editForm.facebookName} onChange={(e) => setEditForm({ ...editForm, facebookName: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">จำนวนเพื่อน Facebook</label>
                <input type="text" value={editForm.facebookFriends} onChange={(e) => setEditForm({ ...editForm, facebookFriends: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
              </div>
            </div>
          </div>

          {/* ข้อมูลที่ทำงาน */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-info/10 text-info">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">ข้อมูลที่ทำงาน</h3>
                <p className="text-xs text-muted-foreground">อาชีพ, ที่ทำงาน, รายได้</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">ชื่อที่ทำงาน</label>
                <input type="text" value={editForm.workplace} onChange={(e) => setEditForm({ ...editForm, workplace: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">อาชีพ</label>
                <input type="text" value={editForm.occupation} onChange={(e) => setEditForm({ ...editForm, occupation: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">รายละเอียดอาชีพ</label>
                <input type="text" value={editForm.occupationDetail} onChange={(e) => setEditForm({ ...editForm, occupationDetail: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">เงินเดือน</label>
                <input type="number" value={editForm.salary} onChange={(e) => setEditForm({ ...editForm, salary: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" placeholder="0.00" />
              </div>
            </div>
            <div className="mt-2">
              <label className="block text-xs font-medium text-foreground mb-1.5">ที่อยู่ที่ทำงาน</label>
              <AddressForm value={editAddrWork} onChange={setEditAddrWork} />
            </div>
          </div>

          {/* รายชื่อบุคคลอ้างอิง */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-warning/10 text-warning">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">รายชื่อบุคคลอ้างอิง</h3>
                <p className="text-xs text-muted-foreground">ข้อมูลผู้อ้างอิง</p>
              </div>
            </div>
            <div className="space-y-4">
              {editRefs.map((ref, idx) => (
                <div key={idx}>
                  <div className="text-xs font-medium text-muted-foreground mb-2">บุคคลอ้างอิง {idx + 1}</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">คำนำหน้า</label>
                      <select value={ref.prefix || ''} onChange={(e) => updateEditRef(idx, 'prefix', e.target.value)} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20">
                        <option value="">-- เลือก --</option>
                        {THAI_NAME_PREFIXES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">ชื่อ</label>
                      <input type="text" value={ref.firstName || ''} onChange={(e) => updateEditRef(idx, 'firstName', e.target.value)} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">นามสกุล</label>
                      <input type="text" value={ref.lastName || ''} onChange={(e) => updateEditRef(idx, 'lastName', e.target.value)} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">เบอร์โทร</label>
                      <input type="tel" value={ref.phone || ''} onChange={(e) => updateEditRef(idx, 'phone', e.target.value)} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">ความสัมพันธ์</label>
                      <select value={ref.relationship || ''} onChange={(e) => updateEditRef(idx, 'relationship', e.target.value)} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20">
                        <option value="">-- เลือก --</option>
                        {RELATIONSHIP_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Warning about existing contracts */}
          {customer.contracts.length > 0 && (
            <div className="bg-warning/10 border border-warning/30 rounded-lg p-3">
              <div className="text-xs text-warning">
                การแก้ไขข้อมูลลูกค้าจะไม่กระทบสัญญาที่สร้างไปแล้ว ({customer.contracts.length} สัญญา)
              </div>
            </div>
          )}

          </div>
          <div className="sticky bottom-0 bg-background/95 backdrop-blur-xs border-t px-6 py-4 flex justify-end gap-3 shrink-0">
            <button type="button" onClick={onClose} className="px-6 py-2.5 text-sm border border-input rounded-lg hover:bg-muted transition-colors">ยกเลิก</button>
            <button type="submit" disabled={updateCustomerMutation.isPending} className="px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm">
              {updateCustomerMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
        </div>
      </div>
  );
}
