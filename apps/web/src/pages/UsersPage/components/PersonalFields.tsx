import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Camera, X, CreditCard } from 'lucide-react';
import { compressImageForOcr } from '@/lib/compressImage';
import { checkCardReaderStatus, readSmartCard } from '@/lib/cardReader';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { inputClass, labelClass } from '../types';

export interface PersonalForm {
  name: string;
  nickname: string;
  employeeId: string;
  startDate: string;
  nationalId: string;
  birthDate: string;
  phone: string;
  lineId: string;
  address: string;
  avatarUrl: string;
}

interface Props {
  form: PersonalForm;
  setForm: <K extends keyof PersonalForm>(key: K, value: PersonalForm[K]) => void;
  setMany: (patch: Partial<PersonalForm>) => void;
}

export default function PersonalFields({ form, setForm, setMany }: Props) {
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [isReadingCard, setIsReadingCard] = useState(false);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageForOcr(file, 200, 0.8);
      setForm('avatarUrl', compressed);
    } catch {
      toast.error('ไม่สามารถอ่านรูปภาพได้');
    }
    e.target.value = '';
  };

  const handleReadCard = async () => {
    setIsReadingCard(true);
    try {
      const status = await checkCardReaderStatus();
      if (!status) return toast.error('ไม่พบเครื่องอ่านบัตร กรุณาตรวจสอบว่าเปิดโปรแกรมอ่านบัตรแล้ว');
      if (status.status === 'no_reader') return toast.error('ไม่พบเครื่องอ่านบัตร กรุณาเสียบเครื่องอ่านบัตร');
      if (status.status === 'waiting') return toast.error('กรุณาเสียบบัตรประชาชนก่อน');
      const card = await readSmartCard();
      setMany({
        name: `${card.prefix}${card.firstName} ${card.lastName}`,
        nationalId: card.nationalId,
        birthDate: card.birthDate,
        address: card.address,
      });
      toast.success('อ่านบัตรประชาชนสำเร็จ');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'อ่านบัตรไม่สำเร็จ');
    } finally {
      setIsReadingCard(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="relative">
            {form.avatarUrl ? (
              <img src={form.avatarUrl} alt="รูปโปรไฟล์" className="size-16 rounded-full object-cover" />
            ) : (
              <div className="size-16 rounded-full bg-muted flex items-center justify-center">
                <Camera className="size-6 text-muted-foreground" />
              </div>
            )}
            <input ref={avatarInputRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
          </div>
          <div className="flex flex-col gap-1">
            <button type="button" onClick={() => avatarInputRef.current?.click()} className="text-sm text-primary hover:text-primary/80 font-medium">
              {form.avatarUrl ? 'เปลี่ยนรูป' : 'อัพโหลดรูปโปรไฟล์'}
            </button>
            {form.avatarUrl && (
              <button type="button" onClick={() => setForm('avatarUrl', '')} className="text-sm text-destructive hover:text-destructive/80 flex items-center gap-1">
                <X className="size-3" /> ลบรูป
              </button>
            )}
          </div>
        </div>
        <button type="button" onClick={handleReadCard} disabled={isReadingCard} className="flex items-center gap-2 px-3 py-2 text-sm font-medium border border-input rounded-lg hover:bg-muted transition-colors disabled:opacity-50">
          <CreditCard className="size-4" />
          {isReadingCard ? 'กำลังอ่าน...' : 'อ่านบัตรประชาชน'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div><label className={labelClass}>ชื่อ-นามสกุล *</label>
          <input className={inputClass} value={form.name} onChange={(e) => setForm('name', e.target.value)} required /></div>
        <div><label className={labelClass}>ชื่อเล่น</label>
          <input className={inputClass} value={form.nickname} onChange={(e) => setForm('nickname', e.target.value)} placeholder="เช่น นุ๊ก, เอ" /></div>
        <div><label className={labelClass}>รหัสพนักงาน</label>
          <input className={inputClass} value={form.employeeId} onChange={(e) => setForm('employeeId', e.target.value)} placeholder="EMP-001" /></div>
        <div><label className={labelClass}>วันเริ่มงาน</label>
          <ThaiDateInput className={inputClass} value={form.startDate} onChange={(e) => setForm('startDate', e.target.value)} /></div>
        <div><label className={labelClass}>เลขบัตรประชาชน</label>
          <input className={inputClass} value={form.nationalId} onChange={(e) => setForm('nationalId', e.target.value)} maxLength={13} pattern="\d{13}" placeholder="x-xxxx-xxxxx-xx-x" /></div>
        <div><label className={labelClass}>วันเกิด</label>
          <ThaiDateInput className={inputClass} value={form.birthDate} onChange={(e) => setForm('birthDate', e.target.value)} /></div>
        <div><label className={labelClass}>เบอร์โทรศัพท์</label>
          <input className={inputClass} type="tel" value={form.phone} onChange={(e) => setForm('phone', e.target.value)} pattern="0[0-9]{9}" placeholder="0xx-xxx-xxxx" /></div>
        <div><label className={labelClass}>LINE ID</label>
          <input className={inputClass} value={form.lineId} onChange={(e) => setForm('lineId', e.target.value)} /></div>
        <div className="col-span-2"><label className={labelClass}>ที่อยู่</label>
          <textarea className={inputClass} rows={2} value={form.address} onChange={(e) => setForm('address', e.target.value)} /></div>
      </div>
    </div>
  );
}
