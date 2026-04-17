import { useState, FormEvent } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router';
import { toast } from 'sonner';
import api from '@/lib/api';
import AuthLayout from '@/components/layout/AuthLayout';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

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
      await api.post('/auth/reset-password', { token, newPassword });
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
      <AuthLayout>
        <div className="text-center py-8">
          <h2 className="text-xl font-bold text-foreground mb-2">ลิงก์ไม่ถูกต้อง</h2>
          <p className="text-sm text-muted-foreground mb-4">กรุณาขอลิงก์รีเซ็ตรหัสผ่านใหม่</p>
          <Link to="/forgot-password" className="text-primary hover:text-primary/80 font-medium text-sm">
            ขอลิงก์ใหม่
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="mb-7">
        <h2 className="text-2xl font-bold text-foreground">ตั้งรหัสผ่านใหม่</h2>
        <p className="text-sm text-muted-foreground mt-2">กรอกรหัสผ่านใหม่ที่ต้องการใช้</p>
      </div>

      <div className="bg-card rounded-xl shadow-card border border-border/60 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="size-10 rounded-lg bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg shadow-primary/20">
            <span className="text-primary-foreground text-lg font-bold">B</span>
          </div>
          <div>
            <div className="text-lg font-bold text-foreground">BESTCHOICE</div>
            <div className="text-xs text-muted-foreground">Finance Management</div>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="newPassword">รหัสผ่านใหม่</Label>
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="รหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)"
              required
              minLength={6}
            />
          </div>
          <div>
            <Label htmlFor="confirmPassword">ยืนยันรหัสผ่านใหม่</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="ยืนยันรหัสผ่านใหม่"
              required
              minLength={6}
            />
          </div>
          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full"
            variant="primary"
            size="lg"
          >
            {isSubmitting ? 'กำลังรีเซ็ต...' : 'รีเซ็ตรหัสผ่าน'}
          </Button>
        </form>
      </div>

      <p className="mt-5 text-center text-sm text-muted-foreground">
        <Link to="/login" className="text-primary hover:text-primary/80 font-medium">
          กลับไปหน้าเข้าสู่ระบบ
        </Link>
      </p>
    </AuthLayout>
  );
}
