import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import AuthLayout from '@/components/layout/AuthLayout';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import TotpInput from '@/components/TotpInput';
import { ShieldCheck, ShieldAlert, ArrowLeft } from 'lucide-react';
import api from '@/lib/api';

type LoginState = 'PASSWORD' | 'OTP' | 'SETUP_REQUIRED';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginState, setLoginState] = useState<LoginState>('PASSWORD');
  const [otp, setOtp] = useState('');
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);

  const { login, pendingTwoFa, completeOtpPhase, clearTempToken } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const result = await login(email, password);

      if (result.state === 'AUTHENTICATED') {
        toast.success('เข้าสู่ระบบสำเร็จ');
        navigate('/');
      } else if (result.state === 'OTP_REQUIRED') {
        setLoginState('OTP');
      } else if (result.state === '2FA_SETUP_REQUIRED') {
        setLoginState('SETUP_REQUIRED');
      }
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

  async function handleOtpSubmit(code: string) {
    if (code.length < 6) return;
    const token = pendingTwoFa?.tempToken;
    if (!token) {
      toast.error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
      handleBackToPassword();
      return;
    }
    setIsVerifyingOtp(true);
    try {
      const { data } = await api.post<{ accessToken: string }>('/auth/login/2fa', {
        tempToken: token,
        otp: code,
      });
      completeOtpPhase(data.accessToken);
      toast.success('เข้าสู่ระบบสำเร็จ');
      navigate('/');
    } catch (err: unknown) {
      const e = err as { response?: { status?: number } };
      if (e.response?.status === 401) {
        toast.error('รหัส OTP ไม่ถูกต้อง หรือหมดอายุ');
      } else {
        toast.error('เกิดข้อผิดพลาด กรุณาลองใหม่');
      }
      setOtp('');
    } finally {
      setIsVerifyingOtp(false);
    }
  }

  function handleBackToPassword() {
    setLoginState('PASSWORD');
    setOtp('');
    clearTempToken();
  }

  async function quickLogin(emailVal: string, pw: string, label: string) {
    setIsSubmitting(true);
    try {
      setEmail(emailVal);
      setPassword(pw);
      const result = await login(emailVal, pw);
      if (result.state === 'AUTHENTICATED') {
        toast.success(`เข้าสู่ระบบเป็น ${label}`);
        navigate('/');
      } else if (result.state === 'OTP_REQUIRED') {
        setLoginState('OTP');
      } else if (result.state === '2FA_SETUP_REQUIRED') {
        setLoginState('SETUP_REQUIRED');
      }
    } catch {
      toast.error('เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      {/* ===== PASSWORD STATE ===== */}
      {loginState === 'PASSWORD' && (
        <>
          <div className="mb-7">
            <h2 className="text-2xl font-bold text-foreground">เข้าสู่ระบบ</h2>
            <p className="text-sm text-muted-foreground mt-2">ยินดีต้อนรับกลับมา เข้าสู่ระบบเพื่อจัดการร้านของคุณ</p>
          </div>

          <div className="bg-card rounded-xl shadow-card border border-border/60 p-6">
            <div className="flex items-center gap-3 mb-6">
              <img src="/logo-icon.svg" alt="BESTCHOICE" className="size-10 shrink-0" />
              <div>
                <div className="text-lg font-extrabold text-foreground">
                  BEST<span className="text-primary">CHOICE</span>
                </div>
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
                      onClick={() => quickLogin(acc.email, acc.pw, acc.label)}
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
        </>
      )}

      {/* ===== OTP STATE ===== */}
      {loginState === 'OTP' && (
        <>
          <div className="mb-7">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="size-6 text-primary" />
              <h2 className="text-2xl font-bold text-foreground">ยืนยันตัวตน 2 ขั้น</h2>
            </div>
            <p className="text-sm text-muted-foreground leading-snug">
              กรอกรหัส 6 หลักจาก Google Authenticator
            </p>
          </div>

          <div className="bg-card rounded-xl shadow-card border border-border/60 p-6 space-y-5">
            <TotpInput
              value={otp}
              onChange={setOtp}
              onComplete={handleOtpSubmit}
              disabled={isVerifyingOtp}
              className="py-2"
            />

            <Button
              type="button"
              variant="primary"
              className="w-full"
              disabled={otp.length < 6 || isVerifyingOtp}
              onClick={() => handleOtpSubmit(otp)}
            >
              {isVerifyingOtp ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin size-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  กำลังตรวจสอบ...
                </span>
              ) : (
                'ยืนยัน'
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={handleBackToPassword}
            >
              <ArrowLeft className="size-4 mr-1" />
              ย้อนกลับ
            </Button>
          </div>
        </>
      )}

      {/* ===== SETUP_REQUIRED STATE ===== */}
      {loginState === 'SETUP_REQUIRED' && (
        <>
          <div className="mb-7">
            <div className="flex items-center gap-2 mb-2">
              <ShieldAlert className="size-6 text-amber-500" />
              <h2 className="text-2xl font-bold text-foreground">ต้องตั้งค่า 2FA</h2>
            </div>
            <p className="text-sm text-muted-foreground leading-snug">
              บัญชีนี้ต้องตั้งค่ายืนยันตัวตน 2 ขั้นก่อนเข้าใช้งาน
            </p>
          </div>

          <div className="bg-card rounded-xl shadow-card border border-border/60 p-6 space-y-5">
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700 leading-snug">
              <p className="font-semibold mb-1">จำเป็นต้องตั้งค่า 2FA</p>
              <p>
                ผู้ดูแลระบบกำหนดให้บัญชีนี้ต้องใช้การยืนยันตัวตน 2 ขั้น
                กรุณาตั้งค่าก่อนดำเนินการต่อ
              </p>
            </div>

            <Button
              type="button"
              variant="primary"
              className="w-full"
              onClick={() => navigate('/setup-2fa')}
            >
              <ShieldCheck className="size-4 mr-2" />
              ตั้งค่า 2FA ทันที
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={handleBackToPassword}
            >
              <ArrowLeft className="size-4 mr-1" />
              ย้อนกลับ
            </Button>
          </div>
        </>
      )}
    </AuthLayout>
  );
}
