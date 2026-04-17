import React from 'react';
import AddressForm, { AddressData } from '@/components/ui/AddressForm';
import { THAI_NAME_PREFIXES, RELATIONSHIP_OPTIONS } from '@/lib/constants';
import type { UseMutationResult } from '@tanstack/react-query';
import type { CustReferenceData } from '../types';
import type { emptyCustForm } from '../constants';
import ThaiDateInput from '@/components/ui/ThaiDateInput';

export interface CustomerCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  custForm: typeof emptyCustForm;
  setCustForm: React.Dispatch<React.SetStateAction<typeof emptyCustForm>>;
  custAddrIdCard: AddressData;
  setCustAddrIdCard: React.Dispatch<React.SetStateAction<AddressData>>;
  custAddrCurrent: AddressData;
  setCustAddrCurrent: React.Dispatch<React.SetStateAction<AddressData>>;
  custSameAddress: boolean;
  setCustSameAddress: React.Dispatch<React.SetStateAction<boolean>>;
  custAddrWork: AddressData;
  setCustAddrWork: React.Dispatch<React.SetStateAction<AddressData>>;
  custReferences: CustReferenceData[];
  updateCustRef: (index: number, field: keyof CustReferenceData, value: string) => void;
  createCustomerMutation: UseMutationResult<any, unknown, void, unknown>;
  handleSmartCardForModal: () => void;
  cardReaderLoading: boolean;
}

export function CustomerCreateModal({
  isOpen,
  onClose,
  custForm,
  setCustForm,
  custAddrIdCard,
  setCustAddrIdCard,
  custAddrCurrent,
  setCustAddrCurrent,
  custSameAddress,
  setCustSameAddress,
  custAddrWork,
  setCustAddrWork,
  custReferences,
  updateCustRef,
  createCustomerMutation,
  handleSmartCardForModal,
  cardReaderLoading,
}: CustomerCreateModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8" role="dialog" aria-modal="true" aria-label="เพิ่มลูกค้าใหม่">
      <div className="w-full max-w-2xl bg-background rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-4rem)]">

        {/* Sticky Header */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between shrink-0">
          <button type="button" onClick={onClose} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            กลับ
          </button>
          <h2 className="text-lg font-semibold text-foreground">เพิ่มลูกค้าใหม่</h2>
          <div className="w-16" />
        </div>

        {/* Scrollable Content */}
        <form
          onSubmit={(e) => { e.preventDefault(); createCustomerMutation.mutate(); }}
          className="flex-1 overflow-y-auto"
        >
          <div className="p-6 space-y-5">

            {/* Section 1: Smart Card Reader */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="flex items-center justify-center size-8 rounded-lg bg-success/10 text-success">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-foreground">อ่านบัตรประชาชน (Smart Card)</h3>
                  <p className="text-xs text-muted-foreground">เสียบบัตรเข้าเครื่องอ่าน — กรอกข้อมูลให้อัตโนมัติ</p>
                </div>
                <button
                  type="button"
                  onClick={handleSmartCardForModal}
                  disabled={cardReaderLoading}
                  className="px-4 py-2 text-sm bg-success text-success-foreground rounded-lg hover:bg-success/90 disabled:opacity-50 font-medium transition-colors"
                >
                  {cardReaderLoading ? 'กำลังอ่าน...' : 'อ่านบัตร'}
                </button>
              </div>
              {cardReaderLoading && (
                <div className="flex items-center gap-3">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-success" />
                  <div className="text-sm text-success">กำลังอ่านข้อมูลจาก Smart Card...</div>
                </div>
              )}
            </div>

            {/* Section 2: ข้อมูลส่วนตัว */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">ข้อมูลส่วนตัว</h3>
                  <p className="text-xs text-muted-foreground">ชื่อ นามสกุล เลขบัตรประชาชน</p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">คำนำหน้า</label>
                  <select value={custForm.prefix} onChange={(e) => setCustForm({ ...custForm, prefix: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background">
                    <option value="">-- เลือก --</option>
                    {THAI_NAME_PREFIXES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ชื่อ <span className="text-destructive">*</span></label>
                  <input type="text" value={custForm.firstName} onChange={(e) => setCustForm({ ...custForm, firstName: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" required />
                </div>
                <div>
                  <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">นามสกุล <span className="text-destructive">*</span></label>
                  <input type="text" value={custForm.lastName} onChange={(e) => setCustForm({ ...custForm, lastName: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" required />
                </div>
                <div>
                  <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ชื่อเล่น</label>
                  <input type="text" value={custForm.nickname} onChange={(e) => setCustForm({ ...custForm, nickname: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เลขบัตรประชาชน (13 หลัก) <span className="text-destructive">*</span></label>
                  <input type="text" maxLength={13} value={custForm.nationalId} onChange={(e) => setCustForm({ ...custForm, nationalId: e.target.value.replace(/\D/g, '') })} className="w-full px-3 py-2 border border-input rounded-lg text-sm font-mono" required />
                </div>
                <div>
                  <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">วันเกิด</label>
                  <ThaiDateInput value={custForm.birthDate} onChange={(e) => setCustForm({ ...custForm, birthDate: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                </div>
                <div className="flex items-end pb-2">
                  {custForm.birthDate && (() => {
                    const bd = new Date(custForm.birthDate);
                    const today = new Date();
                    let age = today.getFullYear() - bd.getFullYear();
                    if (today.getMonth() < bd.getMonth() || (today.getMonth() === bd.getMonth() && today.getDate() < bd.getDate())) age--;
                    return <span className="text-sm text-muted-foreground">อายุ <span className="font-semibold text-foreground">{age}</span> ปี</span>;
                  })()}
                </div>
              </div>
            </div>

            {/* Section 3: ที่อยู่ตามบัตรประชาชน */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">ที่อยู่ตามบัตรประชาชน</h3>
                </div>
              </div>
              <AddressForm value={custAddrIdCard} onChange={setCustAddrIdCard} />
            </div>

            {/* Section 4: ที่อยู่ปัจจุบัน */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-foreground">ที่อยู่ปัจจุบัน</h3>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={custSameAddress} onChange={(e) => setCustSameAddress(e.target.checked)} className="rounded border-input text-primary focus-visible:ring-2 focus-visible:ring-ring/30" />
                  <span className="text-xs text-muted-foreground">เหมือนที่อยู่ตามบัตร</span>
                </label>
              </div>
              {custSameAddress ? (
                <p className="text-xs text-muted-foreground italic">ใช้ที่อยู่เดียวกับที่อยู่ตามบัตรประชาชน</p>
              ) : (
                <AddressForm value={custAddrCurrent} onChange={setCustAddrCurrent} />
              )}
              <div className="mt-3">
                <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ลิงก์ Google Map</label>
                <input type="url" value={custForm.googleMapLink} onChange={(e) => setCustForm({ ...custForm, googleMapLink: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" placeholder="https://maps.google.com/..." />
              </div>
            </div>

            {/* Section 5: ข้อมูลติดต่อ */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="flex items-center justify-center size-8 rounded-lg bg-warning/10 text-warning">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">ข้อมูลติดต่อ</h3>
                  <p className="text-xs text-muted-foreground">เบอร์โทร อีเมล LINE Facebook</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เบอร์หลัก <span className="text-destructive">*</span></label>
                  <input type="tel" value={custForm.phone} onChange={(e) => setCustForm({ ...custForm, phone: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" required />
                </div>
                <div>
                  <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เบอร์สำรอง</label>
                  <input type="tel" value={custForm.phoneSecondary} onChange={(e) => setCustForm({ ...custForm, phoneSecondary: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">อีเมล</label>
                  <input type="email" value={custForm.email} onChange={(e) => setCustForm({ ...custForm, email: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">LINE ID</label>
                  <input type="text" value={custForm.lineId} onChange={(e) => setCustForm({ ...custForm, lineId: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ลิงก์ Facebook</label>
                  <input type="url" value={custForm.facebookLink} onChange={(e) => setCustForm({ ...custForm, facebookLink: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" placeholder="https://facebook.com/..." />
                </div>
                <div>
                  <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ชื่อ Facebook</label>
                  <input type="text" value={custForm.facebookName} onChange={(e) => setCustForm({ ...custForm, facebookName: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">จำนวนเพื่อน Facebook</label>
                  <input type="text" value={custForm.facebookFriends} onChange={(e) => setCustForm({ ...custForm, facebookFriends: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                </div>
              </div>
            </div>

            {/* Section 6: ข้อมูลที่ทำงาน */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="flex items-center justify-center size-8 rounded-lg bg-info/10 text-info">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">ข้อมูลที่ทำงาน</h3>
                  <p className="text-xs text-muted-foreground">อาชีพ เงินเดือน ที่อยู่ที่ทำงาน</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ชื่อที่ทำงาน</label>
                  <input type="text" value={custForm.workplace} onChange={(e) => setCustForm({ ...custForm, workplace: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">อาชีพ</label>
                  <select value={custForm.occupation} onChange={(e) => setCustForm({ ...custForm, occupation: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm">
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
                </div>
                <div>
                  <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">รายละเอียดอาชีพ</label>
                  <input type="text" value={custForm.occupationDetail} onChange={(e) => setCustForm({ ...custForm, occupationDetail: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เงินเดือน</label>
                  <input type="number" value={custForm.salary} onChange={(e) => setCustForm({ ...custForm, salary: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" placeholder="0.00" />
                </div>
              </div>
              <div className="mt-2">
                <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ที่อยู่ที่ทำงาน</label>
                <AddressForm value={custAddrWork} onChange={setCustAddrWork} />
              </div>
            </div>

            {/* Section 7: รายชื่อบุคคลอ้างอิง */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="flex items-center justify-center size-8 rounded-lg bg-warning/10 text-warning">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">รายชื่อบุคคลอ้างอิง</h3>
                  <p className="text-xs text-muted-foreground">บุคคลที่สามารถติดต่อได้</p>
                </div>
              </div>
              <div className="space-y-4">
                {custReferences.map((ref, idx) => (
                  <div key={idx} className="border border-border/50 rounded-lg p-3">
                    <div className="text-xs font-medium text-muted-foreground mb-2">บุคคลอ้างอิง {idx + 1}</div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">คำนำหน้า</label>
                        <select value={ref.prefix} onChange={(e) => updateCustRef(idx, 'prefix', e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background">
                          <option value="">-- เลือก --</option>
                          {THAI_NAME_PREFIXES.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ชื่อ</label>
                        <input type="text" value={ref.firstName} onChange={(e) => updateCustRef(idx, 'firstName', e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                      </div>
                      <div>
                        <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">นามสกุล</label>
                        <input type="text" value={ref.lastName} onChange={(e) => updateCustRef(idx, 'lastName', e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                      </div>
                      <div>
                        <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เบอร์หลัก</label>
                        <input type="tel" value={ref.phone} onChange={(e) => updateCustRef(idx, 'phone', e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                      </div>
                      <div>
                        <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ความสัมพันธ์</label>
                        <select value={ref.relationship} onChange={(e) => updateCustRef(idx, 'relationship', e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background">
                          <option value="">-- เลือก --</option>
                          {RELATIONSHIP_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* Sticky Footer */}
          <div className="sticky bottom-0 bg-background/95 backdrop-blur-xs border-t px-6 py-4 flex justify-end gap-3 shrink-0">
            <button type="button" onClick={onClose} className="px-6 py-2.5 text-sm border border-input rounded-lg hover:bg-muted transition-colors">
              ยกเลิก
            </button>
            <button type="submit" disabled={createCustomerMutation.isPending} className="px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm">
              {createCustomerMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกลูกค้า'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
