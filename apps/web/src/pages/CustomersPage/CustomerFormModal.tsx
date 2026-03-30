/* eslint-disable @typescript-eslint/no-explicit-any */
import type { UseMutationResult } from '@tanstack/react-query';
import { THAI_NAME_PREFIXES, RELATIONSHIP_OPTIONS } from '@/lib/constants';
import Modal from '@/components/ui/Modal';
import AddressForm, { type AddressData } from '@/components/ui/AddressForm';
import type { CustomerForm, ReferenceData } from './types';

interface CustomerFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  form: CustomerForm;
  setForm: React.Dispatch<React.SetStateAction<CustomerForm>>;
  addressIdCard: AddressData;
  setAddressIdCard: React.Dispatch<React.SetStateAction<AddressData>>;
  addressCurrent: AddressData;
  setAddressCurrent: React.Dispatch<React.SetStateAction<AddressData>>;
  sameAddress: boolean;
  setSameAddress: React.Dispatch<React.SetStateAction<boolean>>;
  addressWork: AddressData;
  setAddressWork: React.Dispatch<React.SetStateAction<AddressData>>;
  references: ReferenceData[];
  updateRef: (index: number, field: keyof ReferenceData, value: string) => void;
  createMutation: UseMutationResult<any, unknown, void, unknown>;
  ocrFileRef: any;
  handleOcrScan: (e: React.ChangeEvent<HTMLInputElement>) => void;
  ocrLoading: boolean;
  handleSmartCardRead: () => void;
  cardReaderLoading: boolean;
}

export default function CustomerFormModal({
  isOpen,
  onClose,
  form,
  setForm,
  addressIdCard,
  setAddressIdCard,
  addressCurrent,
  setAddressCurrent,
  sameAddress,
  setSameAddress,
  addressWork,
  setAddressWork,
  references,
  updateRef,
  createMutation,
  ocrFileRef,
  handleOcrScan,
  ocrLoading,
  handleSmartCardRead,
  cardReaderLoading,
}: CustomerFormModalProps) {
  const inputClass = 'w-full px-3 py-2 border border-input rounded-lg text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background';
  const selectClass = `${inputClass}`;
  const sectionClass = 'border border-border rounded-lg p-4';
  const sectionTitle = 'text-sm font-semibold text-foreground mb-3';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="เพิ่มลูกค้าใหม่" size="lg">
      <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(); }} className="flex flex-col gap-5 lg:gap-7.5 max-h-[75vh] overflow-y-auto pr-1">

        {/* ===== Smart Card + OCR (always visible) ===== */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleSmartCardRead}
            disabled={cardReaderLoading || ocrLoading}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            {cardReaderLoading ? (
              <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> กำลังอ่านบัตร...</>
            ) : (
              <><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" /></svg> อ่านบัตร Smart Card</>
            )}
          </button>
          <input ref={ocrFileRef} type="file" accept="image/*" capture="environment" onChange={handleOcrScan} className="hidden" />
          <button
            type="button"
            onClick={() => ocrFileRef.current?.click()}
            disabled={ocrLoading}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {ocrLoading ? (
              <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> กำลังอ่าน...</>
            ) : (
              <><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg> สแกนบัตร OCR</>
            )}
          </button>
        </div>

        {/* ===== Section 1: ข้อมูลหลัก (always open) ===== */}
        <div className={sectionClass}>
          <h3 className={sectionTitle}>ข้อมูลหลัก *</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">คำนำหน้า</label>
              <select value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value })} className={selectClass}>
                <option value="">-- เลือก --</option>
                {THAI_NAME_PREFIXES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">ชื่อ *</label>
              <input type="text" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className={inputClass} required />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">นามสกุล *</label>
              <input type="text" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className={inputClass} required />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">เลขบัตรประชาชน (13 หลัก) *</label>
              <input type="text" maxLength={13} value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value.replace(/\D/g, '') })} className={`${inputClass} font-mono`} required />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">เบอร์โทร *</label>
              <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputClass} required />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">ชื่อเล่น</label>
              <input type="text" value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} className={inputClass} />
            </div>
          </div>
        </div>

        {/* ===== Section 2: ข้อมูลส่วนตัวเพิ่มเติม (collapsed) ===== */}
        <details className={sectionClass}>
          <summary className="cursor-pointer select-none text-sm font-semibold text-foreground flex items-center gap-2">
            <svg className="h-4 w-4 transition-transform [details[open]>summary>&]:rotate-90" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            ข้อมูลส่วนตัวเพิ่มเติม
            <span className="text-xs text-muted-foreground font-normal">(วันเกิด, ต่างด้าว)</span>
          </summary>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">วันเกิด</label>
              <input type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} className={inputClass} />
            </div>
            <div className="flex items-end gap-3">
              <div className="flex items-center gap-2 pb-2">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={form.isForeigner} onChange={(e) => setForm({ ...form, isForeigner: e.target.checked })} className="sr-only peer" />
                  <div className="w-9 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-input after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                  <span className="ml-2 text-xs text-muted-foreground">ต่างด้าว</span>
                </label>
              </div>
            </div>
          </div>
        </details>

        {/* ===== Section 3: ที่อยู่ (collapsed) ===== */}
        <details className={sectionClass}>
          <summary className="cursor-pointer select-none text-sm font-semibold text-foreground flex items-center gap-2">
            <svg className="h-4 w-4 transition-transform [details[open]>summary>&]:rotate-90" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            ที่อยู่
            <span className="text-xs text-muted-foreground font-normal">(ตามบัตร + ปัจจุบัน)</span>
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2">ที่อยู่ตามบัตรประชาชน</h4>
              <AddressForm value={addressIdCard} onChange={setAddressIdCard} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-muted-foreground">ที่อยู่ปัจจุบัน</h4>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={sameAddress} onChange={(e) => setSameAddress(e.target.checked)} className="rounded border-input text-primary focus-visible:ring-ring/30" />
                  <span className="text-xs text-muted-foreground">เหมือนที่อยู่ตามบัตร</span>
                </label>
              </div>
              {sameAddress ? (
                <p className="text-xs text-muted-foreground italic">ใช้ที่อยู่เดียวกับที่อยู่ตามบัตรประชาชน</p>
              ) : (
                <AddressForm value={addressCurrent} onChange={setAddressCurrent} />
              )}
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Link Google Map</label>
              <input type="url" value={form.googleMapLink} onChange={(e) => setForm({ ...form, googleMapLink: e.target.value })} className={inputClass} placeholder="https://maps.google.com/..." />
            </div>
          </div>
        </details>

        {/* ===== Section 4: ข้อมูลติดต่อเพิ่มเติม (collapsed) ===== */}
        <details className={sectionClass}>
          <summary className="cursor-pointer select-none text-sm font-semibold text-foreground flex items-center gap-2">
            <svg className="h-4 w-4 transition-transform [details[open]>summary>&]:rotate-90" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            ข้อมูลติดต่อเพิ่มเติม
            <span className="text-xs text-muted-foreground font-normal">(LINE, Facebook, เบอร์สำรอง)</span>
          </summary>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">เบอร์สำรอง</label>
              <input type="tel" value={form.phoneSecondary} onChange={(e) => setForm({ ...form, phoneSecondary: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">อีเมล</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">LINE ID</label>
              <input type="text" value={form.lineId} onChange={(e) => setForm({ ...form, lineId: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">ลิงก์ Facebook</label>
              <input type="url" value={form.facebookLink} onChange={(e) => setForm({ ...form, facebookLink: e.target.value })} className={inputClass} placeholder="https://facebook.com/..." />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">ชื่อ Facebook</label>
              <input type="text" value={form.facebookName} onChange={(e) => setForm({ ...form, facebookName: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">จำนวนเพื่อน Facebook</label>
              <input type="text" value={form.facebookFriends} onChange={(e) => setForm({ ...form, facebookFriends: e.target.value })} className={inputClass} />
            </div>
          </div>
        </details>

        {/* ===== Section 5: ข้อมูลที่ทำงาน (collapsed) ===== */}
        <details className={sectionClass}>
          <summary className="cursor-pointer select-none text-sm font-semibold text-foreground flex items-center gap-2">
            <svg className="h-4 w-4 transition-transform [details[open]>summary>&]:rotate-90" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            ข้อมูลที่ทำงาน
            <span className="text-xs text-muted-foreground font-normal">(อาชีพ, เงินเดือน)</span>
          </summary>
          <div className="mt-3">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">ชื่อที่ทำงาน</label>
                <input type="text" value={form.workplace} onChange={(e) => setForm({ ...form, workplace: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">อาชีพ</label>
                <input type="text" value={form.occupation} onChange={(e) => setForm({ ...form, occupation: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">รายละเอียดอาชีพ</label>
                <input type="text" value={form.occupationDetail} onChange={(e) => setForm({ ...form, occupationDetail: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">เงินเดือน</label>
                <input type="number" value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} className={inputClass} placeholder="0.00" />
              </div>
            </div>
            <div className="mt-2">
              <label className="block text-xs text-muted-foreground mb-1">ที่อยู่ที่ทำงาน</label>
              <AddressForm value={addressWork} onChange={setAddressWork} />
            </div>
          </div>
        </details>

        {/* ===== Section 6: บุคคลอ้างอิง (collapsed) ===== */}
        <details className={sectionClass}>
          <summary className="cursor-pointer select-none text-sm font-semibold text-foreground flex items-center gap-2">
            <svg className="h-4 w-4 transition-transform [details[open]>summary>&]:rotate-90" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            บุคคลอ้างอิง
            <span className="text-xs text-muted-foreground font-normal">(2 คน)</span>
          </summary>
          <div className="flex flex-col gap-5 lg:gap-7.5 mt-3">
            {references.map((ref, idx) => (
              <div key={idx}>
                <div className="text-xs font-medium text-muted-foreground mb-2">บุคคลอ้างอิง {idx + 1}</div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">คำนำหน้า</label>
                    <select value={ref.prefix} onChange={(e) => updateRef(idx, 'prefix', e.target.value)} className={selectClass}>
                      <option value="">-- เลือก --</option>
                      {THAI_NAME_PREFIXES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">ชื่อ</label>
                    <input type="text" value={ref.firstName} onChange={(e) => updateRef(idx, 'firstName', e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">นามสกุล</label>
                    <input type="text" value={ref.lastName} onChange={(e) => updateRef(idx, 'lastName', e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">เบอร์หลัก</label>
                    <input type="tel" value={ref.phone} onChange={(e) => updateRef(idx, 'phone', e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">ความสัมพันธ์</label>
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

        {/* ===== Submit ===== */}
        <div className="flex justify-end gap-3 pt-2 sticky bottom-0 bg-background py-3 border-t border-border">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground border border-input rounded-lg">ยกเลิก</button>
          <button type="submit" disabled={createMutation.isPending} className="px-6 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50">
            {createMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
