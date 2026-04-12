import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import api from '@/lib/api';
import AuthLayout from '@/components/layout/AuthLayout';

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
              <label htmlFor="email" className="block text-2sm font-medium text-foreground mb-1.5">
                อีเมล
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-10 px-3.5 border border-input rounded-lg text-sm outline-hidden transition-all bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background"
                placeholder="email@example.com"
                autoComplete="email"
                required
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-primary text-primary-foreground h-10 px-4 rounded-lg font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-card"
            >
              {isSubmitting ? 'กำลังส่ง...' : 'ส่งลิงก์รีเซ็ตรหัสผ่าน'}
            </button>
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
