import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Camera, X, CreditCard } from 'lucide-react';
import { compressImageForOcr } from '@/lib/compressImage';
import { checkCardReaderStatus, readSmartCard } from '@/lib/cardReader';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { User, roleLabels, inputClass, labelClass, emptyForm } from '../types';

type FormState = typeof emptyForm;

interface UserFormProps {
  editingUser: User | null;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  isSaving: boolean;
  branches: { id: string; name: string }[];
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export default function UserForm({
  editingUser,
  form,
  setForm,
  isSaving,
  branches,
  onClose,
  onSubmit,
}: UserFormProps) {
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [isReadingCard, setIsReadingCard] = useState(false);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageForOcr(file, 200, 0.8);
      setForm((prev) => ({ ...prev, avatarUrl: compressed }));
    } catch {
      toast.error('ไม่สามารถอ่านรูปภาพได้');
    }
    e.target.value = '';
  };

  const handleReadCard = async () => {
    setIsReadingCard(true);
    try {
      const status = await checkCardReaderStatus();
      if (!status) {
        toast.error('ไม่พบเครื่องอ่านบัตร กรุณาตรวจสอบว่าเปิดโปรแกรมอ่านบัตรแล้ว');
        return;
      }
      if (status.status === 'no_reader') {
        toast.error('ไม่พบเครื่องอ่านบัตร กรุณาเสียบเครื่องอ่านบัตร');
        return;
      }
      if (status.status === 'waiting') {
        toast.error('กรุณาเสียบบัตรประชาชนก่อน');
        return;
      }
      const card = await readSmartCard();
      setForm((prev) => ({
        ...prev,
        name: `${card.prefix}${card.firstName} ${card.lastName}`,
        nationalId: card.nationalId,
        birthDate: card.birthDate,
        address: card.address,
      }));
      toast.success('อ่านบัตรประชาชนสำเร็จ');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'อ่านบัตรไม่สำเร็จ');
    } finally {
      setIsReadingCard(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8"
      role="dialog"
      aria-modal="true"
      aria-label={editingUser ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้ใหม่'}
    >
      <div className="w-full max-w-2xl bg-background rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-4rem)]">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            กลับ
          </button>
          <h2 className="text-lg font-semibold text-foreground">
            {editingUser ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้ใหม่'}
          </h2>
          <div className="w-16" />
        </div>
        <form onSubmit={onSubmit} className="flex-1 overflow-y-auto flex flex-col">
          <div className="p-6 space-y-5 flex-1">
            {/* Avatar upload + Card reader */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="relative">
                  {form.avatarUrl ? (
                    <img
                      src={form.avatarUrl}
                      alt="รูปโปรไฟล์"
                      className="size-16 rounded-full object-cover"
                    />
                  ) : (
                    <div className="size-16 rounded-full bg-muted flex items-center justify-center">
                      <Camera className="size-6 text-muted-foreground" />
                    </div>
                  )}
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarChange}
                    className="hidden"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    className="text-sm text-primary hover:text-primary/80 font-medium"
                  >
                    {form.avatarUrl ? 'เปลี่ยนรูป' : 'อัพโหลดรูปโปรไฟล์'}
                  </button>
                  {form.avatarUrl && (
                    <button
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, avatarUrl: '' }))}
                      className="text-sm text-destructive hover:text-destructive/80 flex items-center gap-1"
                    >
                      <X className="size-3" /> ลบรูป
                    </button>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={handleReadCard}
                disabled={isReadingCard}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium border border-input rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
              >
                <CreditCard className="size-4" />
                {isReadingCard ? 'กำลังอ่าน...' : 'อ่านบัตรประชาชน'}
              </button>
            </div>

            {/* Email (create only) */}
            {!editingUser && (
              <div>
                <label className={labelClass}>อีเมล *</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                  className={inputClass}
                />
              </div>
            )}

            {/* Name + Nickname */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>ชื่อ-นามสกุล *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>ชื่อเล่น</label>
                <input
                  type="text"
                  value={form.nickname}
                  onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                  placeholder="เช่น นุ๊ก, เอ"
                  className={inputClass}
                />
              </div>
            </div>

            {/* Employee ID + Start Date */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>รหัสพนักงาน</label>
                <input
                  type="text"
                  value={form.employeeId}
                  onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
                  placeholder="EMP-001"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>วันเริ่มงาน</label>
                <ThaiDateInput
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>

            {/* National ID + Birth Date */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>เลขบัตรประชาชน</label>
                <input
                  type="text"
                  value={form.nationalId}
                  onChange={(e) => setForm({ ...form, nationalId: e.target.value })}
                  placeholder="x-xxxx-xxxxx-xx-x"
                  maxLength={13}
                  pattern="\d{13}"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>วันเกิด</label>
                <ThaiDateInput
                  value={form.birthDate}
                  onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className={labelClass}>
                {editingUser ? 'รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่าน *'}
              </label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required={!editingUser}
                minLength={6}
                className={inputClass}
              />
            </div>

            {/* Role + Branch */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>ตำแหน่ง *</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className={inputClass}
                >
                  {Object.entries(roleLabels).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>สาขา</label>
                <select
                  value={form.branchId}
                  onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                  className={inputClass}
                >
                  <option value="">ไม่ระบุ (ทุกสาขา)</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Contact info section */}
            <div className="border-t border-border pt-4">
              <p className="text-sm font-medium text-muted-foreground mb-3">ข้อมูลติดต่อ</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>เบอร์โทรศัพท์</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="0xx-xxx-xxxx"
                    pattern="0[0-9]{9}"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>LINE ID</label>
                  <input
                    type="text"
                    value={form.lineId}
                    onChange={(e) => setForm({ ...form, lineId: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="mt-4">
                <label className={labelClass}>ที่อยู่</label>
                <textarea
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  rows={2}
                  className={inputClass}
                />
              </div>
            </div>
          </div>
          <div className="sticky bottom-0 bg-background/95 backdrop-blur-xs border-t px-6 py-4 flex justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 text-sm border border-input rounded-lg hover:bg-muted transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm"
            >
              {isSaving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
