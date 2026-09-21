import { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { inputClass, labelClass, MIN_PASSWORD_LENGTH } from '../types';

interface ResetPasswordDialogProps {
  /** ผู้ใช้ที่กำลังจะถูกรีเซ็ต — `null` = ปิด dialog */
  user: { id: string; name: string; email: string } | null;
  /** กำลังรีเซ็ตบัญชีของตัวเอง — คำเตือนต้องบอกว่า "คุณ" จะหลุดจากระบบ ไม่ใช่คนอื่น */
  isSelf?: boolean;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (password: string) => void;
}

export default function ResetPasswordDialog({
  user,
  isSelf = false,
  isPending,
  onClose,
  onSubmit,
}: ResetPasswordDialogProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);

  // ล้างค่าทุกครั้งที่เปลี่ยนคน — กันรหัสของคนก่อนหน้าค้างอยู่ในช่อง
  useEffect(() => {
    setPassword('');
    setConfirm('');
    setReveal(false);
  }, [user?.id]);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = password.length >= MIN_PASSWORD_LENGTH && confirm === password;

  // ป้ายปุ่มตอนกำลังบันทึกมาจาก ConfirmDialog เอง (loading → "กำลังดำเนินการ...")
  return (
    <ConfirmDialog
      open={!!user}
      onOpenChange={(open) => !open && onClose()}
      title="รีเซ็ตรหัสผ่าน"
      description={
        user ? `ตั้งรหัสผ่านใหม่ให้ "${user.name}" (${user.email})` : ''
      }
      confirmLabel="ตั้งรหัสผ่านใหม่"
      confirmDisabled={!canSubmit || isPending}
      loading={isPending}
      closeOnConfirm={false}
      onConfirm={() => canSubmit && onSubmit(password)}
    >
      <div className="space-y-4">
        <div>
          <label className={labelClass} htmlFor="reset-password">
            รหัสผ่านใหม่ *
          </label>
          <div className="relative">
            <input
              id="reset-password"
              className={`${inputClass} pr-10`}
              type={reveal ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setReveal((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground transition-colors"
              aria-label={reveal ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
            >
              {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <p
            className={`text-[11px] mt-1 leading-snug ${
              tooShort ? 'text-destructive' : 'text-muted-foreground'
            }`}
          >
            อย่างน้อย {MIN_PASSWORD_LENGTH} ตัวอักษร
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor="reset-password-confirm">
            ยืนยันรหัสผ่านใหม่ *
          </label>
          <input
            id="reset-password-confirm"
            className={inputClass}
            type={reveal ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {mismatch && (
            <p className="text-[11px] mt-1 leading-snug text-destructive">รหัสผ่านไม่ตรงกัน</p>
          )}
        </div>

        <div className="flex gap-2 rounded-lg border border-warning/20 bg-warning/5 p-3">
          <KeyRound className="size-4 shrink-0 text-warning-strong mt-0.5" />
          <p className="text-[11px] leading-snug text-muted-foreground">
            {/* ถ้อยคำต้องตรงกับที่ระบบทำจริง: การรีเซ็ตเพิกถอน refresh token ทันที แต่
                access token ที่ค้างอยู่ในหน้าจอยังใช้ได้จนหมดอายุ (JWT_EXPIRATION = 15 นาที)
                จึงเขียนว่า "ทันที" ไม่ได้ */}
            {isSelf ? (
              <>
                นี่คือบัญชีของคุณเอง — เมื่อบันทึกแล้วหน้าจอที่เปิดค้างอยู่จะใช้ต่อได้
                <span className="font-medium text-foreground">อีกไม่เกิน 15 นาที</span>
                จากนั้นต้องเข้าสู่ระบบใหม่ด้วยรหัสผ่านที่เพิ่งตั้ง
              </>
            ) : (
              <>
                เมื่อบันทึกแล้ว อุปกรณ์ทุกเครื่องที่ผู้ใช้คนนี้ค้างไว้จะหลุดจากระบบ
                <span className="font-medium text-foreground">ภายใน 15 นาที</span>
                และต้องเข้าสู่ระบบใหม่ด้วยรหัสผ่านที่ตั้งให้ — อย่าลืมแจ้งรหัสใหม่ให้เขาทราบ
              </>
            )}
          </p>
        </div>
      </div>
    </ConfirmDialog>
  );
}
