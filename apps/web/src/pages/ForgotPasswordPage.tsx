import { useState, FormEvent } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import api from '@/lib/api';
import AuthLayout from '@/components/layout/AuthLayout';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      await api.post('/auth/forgot-password', { email });
      setSubmitted(true);
      toast.success('ส่งลิงก์รีเซ็ตรหัสผ่านเรียบร้อยแล้ว');
    } catch {
      toast.error('เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <div className="mb-7">
        <h2 className="text-2xl font-bold text-foreground">ลืมรหัสผ่าน</h2>
        <p className="text-sm text-muted-foreground mt-2">
          กรอกอีเมลที่ใช้ลงทะเบียน เราจะส่งลิงก์สำหรับรีเซ็ตรหัสผ่านให้
        </p>
      </div>

      <div className="bg-card rounded-xl shadow-card border border-border/60 p-6">
        <div className="flex items-center gap-3 mb-6">
          <img src="/logo-icon.svg" alt="BESTCHOICE" className="size-10 shrink-0" />
          <div>
            <div className="text-lg font-extrabold text-foreground">BEST<span className="text-primary">CHOICE</span></div>
            <div className="text-xs text-muted-foreground">Finance Management</div>
          </div>
        </div>
        {submitted ? (
          <div className="text-center py-4">
            <div className="size-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
              <svg className="size-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm text-foreground font-medium mb-1">ตรวจสอบอีเมลของคุณ</p>
            <p className="text-xs text-muted-foreground">
              หากอีเมล <strong>{email}</strong> มีอยู่ในระบบ คุณจะได้รับลิงก์สำหรับรีเซ็ตรหัสผ่าน
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">อีเมล</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                autoComplete="email"
                required
              />
            </div>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full"
              variant="primary"
              size="lg"
            >
              {isSubmitting ? 'กำลังส่ง...' : 'ส่งลิงก์รีเซ็ตรหัสผ่าน'}
            </Button>
          </form>
        )}
      </div>

      <p className="mt-5 text-center text-sm text-muted-foreground">
        <Link to="/login" className="text-primary hover:text-primary/80 font-medium">
          กลับไปหน้าเข้าสู่ระบบ
        </Link>
      </p>
    </AuthLayout>
  );
}
