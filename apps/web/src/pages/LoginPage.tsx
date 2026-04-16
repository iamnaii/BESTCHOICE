import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import AuthLayout from '@/components/layout/AuthLayout';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      await login(email, password);
      toast.success('เข้าสู่ระบบสำเร็จ');
      navigate('/');
    } catch (error: unknown) {
      const err = error as { response?: { status?: number; data?: { message?: string } }; code?: string };
      if (err.code === 'ECONNABORTED') {
        toast.error('เซิร์ฟเวอร์ไม่ตอบสนอง กรุณาลองใหม่');
      } else if (!err.response) {
        toast.error('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
      } else if (err.response.status === 429) {
        toast.error('ลองเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่');
      } else if (err.response.status === 401) {
        toast.error('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
      } else {
        toast.error(err.response.data?.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout>
          <div className="mb-7">
            <h2 className="text-2xl font-bold text-foreground">เข้าสู่ระบบ</h2>
            <p className="text-sm text-muted-foreground mt-2">ยินดีต้อนรับกลับมา เข้าสู่ระบบเพื่อจัดการร้านของคุณ</p>
          </div>

          <div className="bg-card rounded-xl shadow-card border border-border/60 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="size-10 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <span className="text-white text-lg font-bold">B</span>
              </div>
              <div>
                <div className="text-lg font-bold text-foreground">BESTCHOICE</div>
                <div className="text-xs text-muted-foreground">Finance Management</div>
              </div>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="email">อีเมล</Label>
                <Input
                  id="email"
                  type="email"
                  data-testid="login-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@example.com"
                  autoComplete="email"
                  required
                />
              </div>

              <div>
                <Label htmlFor="password">รหัสผ่าน</Label>
                <Input
                  id="password"
                  type="password"
                  data-testid="login-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="รหัสผ่าน"
                  autoComplete="current-password"
                  required
                  minLength={6}
                />
              </div>

              <Button
                type="submit"
                data-testid="login-submit"
                disabled={isSubmitting}
                className="w-full"
                variant="primary"
                size="lg"
              >
                {isSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin size-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    กำลังเข้าสู่ระบบ...
                  </span>
                ) : (
                  'เข้าสู่ระบบ'
                )}
              </Button>
            </form>

            {import.meta.env.DEV && (
              <div className="mt-5 p-3.5 bg-muted rounded-lg border border-border">
                <p className="font-medium text-foreground text-xs mb-2">เข้าสู่ระบบด่วน:</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Admin', email: 'admin@bestchoice.com', pw: 'admin1234', role: 'OWNER' },
                    { label: 'ผจก.สาขา', email: 'manager1@bestchoice.com', pw: 'password123', role: 'MANAGER' },
                    { label: 'พนง.ขาย', email: 'sales1@bestchoice.com', pw: 'password123', role: 'SALES' },
                    { label: 'บัญชี', email: 'accountant@bestchoice.com', pw: 'password123', role: 'ACCOUNTANT' },
                    { label: 'ผจก.การเงิน', email: 'finance@bestchoice.com', pw: 'admin1234', role: 'FINANCE_MANAGER' },
                  ].map((acc) => (
                    <Button
                      key={acc.email}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isSubmitting}
                      onClick={async () => {
                        setIsSubmitting(true);
                        try {
                          setEmail(acc.email);
                          setPassword(acc.pw);
                          await login(acc.email, acc.pw);
                          toast.success(`เข้าสู่ระบบเป็น ${acc.label}`);
                          navigate('/');
                        } catch {
                          toast.error('เข้าสู่ระบบไม่สำเร็จ');
                        } finally {
                          setIsSubmitting(false);
                        }
                      }}
                      className="flex flex-col items-center gap-0.5 h-auto py-2"
                    >
                      <span className="font-semibold text-foreground">{acc.label}</span>
                      <span className="text-muted-foreground text-[10px]">{acc.role}</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-5 flex items-center justify-between text-sm">
            <Link to="/forgot-password" className="text-muted-foreground hover:text-primary transition-colors">
              ลืมรหัสผ่าน?
            </Link>
            <Link to="/landing" className="text-primary hover:text-primary/80 font-medium">
              กลับหน้าแรก
            </Link>
          </div>
    </AuthLayout>
  );
}
