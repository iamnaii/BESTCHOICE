import React from 'react';
import Modal from '@/components/ui/Modal';
import AddressForm, { AddressData } from '@/components/ui/AddressForm';
import { THAI_NAME_PREFIXES, RELATIONSHIP_OPTIONS } from '@/lib/constants';
import type { UseMutationResult } from '@tanstack/react-query';
import type { CustReferenceData } from '../types';
import type { emptyCustForm } from '../constants';

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
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="เพิ่มลูกค้าใหม่" size="lg">
      <form onSubmit={(e) => { e.preventDefault(); createCustomerMutation.mutate(); }} className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">

        {/* Smart Card Reader - pre-fill form */}
        <div className="bg-success/5 dark:bg-success/10 border border-success/20 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-success">อ่านบัตรประชาชน (Smart Card)</h3>
              <p className="text-xs text-success mt-0.5">เสียบบัตรเข้าเครื่องอ่าน — กรอกข้อมูลให้อัตโนมัติ</p>
            </div>
            <button
              type="button"
              onClick={handleSmartCardForModal}
              disabled={cardReaderLoading}
              className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {cardReaderLoading ? 'กำลังอ่าน...' : 'อ่านบัตร'}
            </button>
          </div>
          {cardReaderLoading && (
            <div className="flex items-center gap-3 pt-2">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-green-600" />
              <div className="text-sm text-success">กำลังอ่านข้อมูลจาก Smart Card...</div>
            </div>
          )}
        </div>

        {/* ข้อมูลส่วนตัว */}
        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">ข้อมูลส่วนตัว</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">คำนำหน้า</label>
              <select value={custForm.prefix} onChange={(e) => setCustForm({ ...custForm, prefix: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background">
                <option value="">-- เลือก --</option>
                {THAI_NAME_PREFIXES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ชื่อ *</label>
              <input type="text" value={custForm.firstName} onChange={(e) => setCustForm({ ...custForm, firstName: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" required />
            </div>
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">นามสกุล *</label>
              <input type="text" value={custForm.lastName} onChange={(e) => setCustForm({ ...custForm, lastName: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" required />
            </div>
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ชื่อเล่น</label>
              <input type="text" value={custForm.nickname} onChange={(e) => setCustForm({ ...custForm, nickname: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เลขบัตรประชาชน (13 หลัก) *</label>
              <input type="text" maxLength={13} value={custForm.nationalId} onChange={(e) => setCustForm({ ...custForm, nationalId: e.target.value.replace(/\D/g, '') })} className="w-full px-3 py-2 border border-input rounded-lg text-sm font-mono" required />
            </div>
            <div className="flex items-end gap-3">
              <div className="flex items-center gap-2 pb-2">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={custForm.isForeigner} onChange={(e) => setCustForm({ ...custForm, isForeigner: e.target.checked })} className="sr-only peer" />
                  <div className="w-9 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-input after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                  <span className="ml-2 text-xs text-muted-foreground">ต่างด้าว</span>
                </label>
              </div>
            </div>
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">วันเกิด</label>
              <input type="date" value={custForm.birthDate} onChange={(e) => setCustForm({ ...custForm, birthDate: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
            </div>
          </div>
        </div>

        {/* ที่อยู่ตามบัตรประชาชน */}
        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">ที่อยู่ตามบัตรประชาชน</h3>
          <AddressForm value={custAddrIdCard} onChange={setCustAddrIdCard} />
        </div>

        {/* ที่อยู่ปัจจุบัน */}
        <div className="border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">ที่อยู่ปัจจุบัน</h3>
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
            <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Link Google Map</label>
            <input type="url" value={custForm.googleMapLink} onChange={(e) => setCustForm({ ...custForm, googleMapLink: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" placeholder="https://maps.google.com/..." />
          </div>
        </div>

        {/* ข้อมูลติดต่อ */}
        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">ข้อมูลติดต่อ</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เบอร์หลัก *</label>
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

        {/* ข้อมูลที่ทำงาน */}
        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">ข้อมูลที่ทำงาน</h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ชื่อที่ทำงาน</label>
              <input type="text" value={custForm.workplace} onChange={(e) => setCustForm({ ...custForm, workplace: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">อาชีพ</label>
              <input type="text" value={custForm.occupation} onChange={(e) => setCustForm({ ...custForm, occupation: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
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

        {/* รายชื่อบุคคลอ้างอิง */}
        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">รายชื่อบุคคลอ้างอิง</h3>
          <div className="space-y-4">
            {custReferences.map((ref, idx) => (
              <div key={idx}>
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

        {/* Submit */}
        <div className="flex justify-end gap-3 pt-2 sticky bottom-0 bg-background py-3 border-t">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground border border-input rounded-lg">ยกเลิก</button>
          <button type="submit" disabled={createCustomerMutation.isPending} className="px-6 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50">
            {createCustomerMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
