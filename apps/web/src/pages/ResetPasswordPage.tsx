import { useState, FormEvent } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import api from '@/lib/api';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      toast.error('รหัสผ่านไม่ตรงกัน');
      return;
    }

    if (newPassword.length < 6) {
      toast.error('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
      return;
    }

    setIsSubmitting(true);

    try {
      await api.post('/api/auth/reset-password', { token, newPassword });
      toast.success('รีเซ็ตรหัสผ่านสำเร็จ');
      navigate('/login');
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } };
      toast.error(err.response?.data?.message || 'ลิงก์รีเซ็ตไม่ถูกต้องหรือหมดอายุ');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-foreground mb-2">ลิงก์ไม่ถูกต้อง</h2>
          <p className="text-sm text-muted-foreground mb-4">กรุณาขอลิงก์รีเซ็ตรหัสผ่านใหม่</p>
          <Link to="/forgot-password" className="text-primary hover:text-primary/80 font-medium text-sm">
            ขอลิงก์ใหม่
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-[400px]">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="size-9 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-white font-bold text-sm">B</span>
          </div>
          <span className="text-xl font-bold text-foreground tracking-tight">
            BEST<span className="text-primary">CHOICE</span>
          </span>
        </div>

        <div className="mb-7">
          <h2 className="text-2xl font-semibold text-foreground">ตั้งรหัสผ่านใหม่</h2>
          <p className="text-sm text-muted-foreground mt-2">กรอกรหัสผ่านใหม่ที่ต้องการใช้</p>
        </div>

        <div className="bg-card rounded-xl shadow-xs shadow-black/5 border border-border p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="newPassword" className="block text-2sm font-medium text-foreground mb-1.5">
                รหัสผ่านใหม่
              </label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full h-10 px-3.5 border border-input rounded-lg text-sm outline-none transition-all bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background"
                placeholder="รหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)"
                required
                minLength={6}
              />
            </div>
            <div>
              <label htmlFor="confirmPassword" className="block text-2sm font-medium text-foreground mb-1.5">
                ยืนยันรหัสผ่านใหม่
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full h-10 px-3.5 border border-input rounded-lg text-sm outline-none transition-all bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background"
                placeholder="ยืนยันรหัสผ่านใหม่"
                required
                minLength={6}
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-primary text-primary-foreground h-10 px-4 rounded-lg font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xs shadow-black/5"
            >
              {isSubmitting ? 'กำลังรีเซ็ต...' : 'รีเซ็ตรหัสผ่าน'}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          <Link to="/login" className="text-primary hover:text-primary/80 font-medium">
            กลับไปหน้าเข้าสู่ระบบ
          </Link>
        </p>
      </div>
    </div>
  );
}
