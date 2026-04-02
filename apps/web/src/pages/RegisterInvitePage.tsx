import { useState, useEffect, FormEvent } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import api from '@/lib/api';

const roleLabels: Record<string, string> = {
  OWNER: 'เจ้าของร้าน',
  BRANCH_MANAGER: 'ผู้จัดการสาขา',
  SALES: 'พนักงานขาย',
  ACCOUNTANT: 'ฝ่ายบัญชี',
};

const inputClass =
  'w-full h-10 px-3.5 border border-input rounded-lg text-sm outline-none transition-all bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background';

interface VerifyResult {
  valid: boolean;
  email?: string;
  role?: string;
  branchName?: string | null;
}

export default function RegisterInvitePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();

  const [verifying, setVerifying] = useState(true);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [nickname, setNickname] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setVerifying(false);
      return;
    }

    api
      .get<VerifyResult>(`/invite/verify?token=${encodeURIComponent(token)}`)
      .then(({ data }) => setVerifyResult(data))
      .catch(() => setVerifyResult({ valid: false }))
      .finally(() => setVerifying(false));
  }, [token]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast.error('รหัสผ่านไม่ตรงกัน');
      return;
    }

    if (password.length < 8) {
      toast.error('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
      return;
    }

    setIsSubmitting(true);

    try {
      await api.post('/invite/register', {
        token,
        password,
        name,
        phone: phone || undefined,
        nickname: nickname || undefined,
      });
      toast.success('ลงทะเบียนสำเร็จ กรุณาเข้าสู่ระบบ');
      navigate('/login');
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } };
      toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Loading state
  if (verifying) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-3 text-sm text-muted-foreground">กำลังตรวจสอบลิงก์...</p>
        </div>
      </div>
    );
  }

  // Invalid or no token
  if (!token || !verifyResult?.valid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="text-center">
          <div className="size-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <svg className="size-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-foreground mb-2">ลิงก์หมดอายุหรือถูกใช้งานแล้ว</h2>
          <p className="text-sm text-muted-foreground mb-4">กรุณาติดต่อผู้ดูแลระบบเพื่อขอลิงก์ใหม่</p>
          <Link to="/login" className="text-primary hover:text-primary/80 font-medium text-sm">
            กลับไปหน้าเข้าสู่ระบบ
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-[440px]">
        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-8">
          <div className="size-9 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-white font-bold text-sm">B</span>
          </div>
          <span className="text-xl font-bold text-foreground tracking-tight">
            BEST<span className="text-primary">CHOICE</span>
          </span>
        </div>

        <div className="mb-7">
          <h2 className="text-2xl font-semibold text-foreground">ลงทะเบียนเข้าใช้งาน</h2>
          <p className="text-sm text-muted-foreground mt-2">กรอกข้อมูลเพื่อสร้างบัญชีของคุณ</p>
        </div>

        <div className="bg-card rounded-xl shadow-xs shadow-black/5 border border-border p-6">
          {/* Read-only invite info */}
          <div className="mb-5 p-3 bg-primary/5 rounded-lg border border-primary/10">
            <div className="text-sm text-muted-foreground mb-1">อีเมล</div>
            <div className="font-medium text-foreground">{verifyResult.email}</div>
            <div className="flex gap-4 mt-2">
              <div>
                <span className="text-sm text-muted-foreground">ตำแหน่ง: </span>
                <span className="text-sm font-medium text-foreground">
                  {roleLabels[verifyResult.role || ''] || verifyResult.role}
                </span>
              </div>
              {verifyResult.branchName && (
                <div>
                  <span className="text-sm text-muted-foreground">สาขา: </span>
                  <span className="text-sm font-medium text-foreground">{verifyResult.branchName}</span>
                </div>
              )}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name */}
            <div>
              <label htmlFor="name" className="block text-2sm font-medium text-foreground mb-1.5">
                ชื่อ-นามสกุล *
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
                placeholder="ชื่อ-นามสกุล"
                required
              />
            </div>

            {/* Nickname */}
            <div>
              <label htmlFor="nickname" className="block text-2sm font-medium text-foreground mb-1.5">
                ชื่อเล่น
              </label>
              <input
                id="nickname"
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className={inputClass}
                placeholder="เช่น นุ๊ก, เอ"
              />
            </div>

            {/* Phone */}
            <div>
              <label htmlFor="phone" className="block text-2sm font-medium text-foreground mb-1.5">
                เบอร์โทรศัพท์
              </label>
              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={inputClass}
                placeholder="0xx-xxx-xxxx"
              />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-2sm font-medium text-foreground mb-1.5">
                รหัสผ่าน *
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                placeholder="อย่างน้อย 8 ตัวอักษร"
                required
                minLength={8}
              />
            </div>

            {/* Confirm Password */}
            <div>
              <label htmlFor="confirmPassword" className="block text-2sm font-medium text-foreground mb-1.5">
                ยืนยันรหัสผ่าน *
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputClass}
                placeholder="ยืนยันรหัสผ่าน"
                required
                minLength={8}
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-primary text-primary-foreground h-10 px-4 rounded-lg font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xs shadow-black/5"
            >
              {isSubmitting ? 'กำลังลงทะเบียน...' : 'ลงทะเบียน'}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          มีบัญชีอยู่แล้ว?{' '}
          <Link to="/login" className="text-primary hover:text-primary/80 font-medium">
            เข้าสู่ระบบ
          </Link>
        </p>
      </div>
    </div>
  );
}
