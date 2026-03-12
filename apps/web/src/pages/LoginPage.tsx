import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

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
    <div className="min-h-screen flex">
      {/* Left Side - Metronic-style Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#111827] relative overflow-hidden">
        <div className="relative z-10 flex flex-col justify-center px-16">
          <Link to="/landing" className="flex items-center gap-3 mb-14">
            <div className="w-11 h-11 rounded-lg bg-primary-600 flex items-center justify-center">
              <span className="text-white font-bold text-xl">B</span>
            </div>
            <span className="text-2xl font-bold text-white tracking-tight">
              BEST<span className="text-primary-400">CHOICE</span>
            </span>
          </Link>

          <h1 className="text-4xl font-bold text-white leading-tight tracking-tight">
            ระบบจัดการร้าน
            <br />
            <span className="text-primary-400">ครบวงจร</span>
          </h1>
          <p className="mt-4 text-[15px] text-slate-400 max-w-md leading-relaxed">
            จัดการสินค้า ลูกค้า สัญญาผ่อนชำระ และติดตามยอดขาย
            ทั้งหมดในที่เดียว
          </p>

          <div className="mt-12 grid grid-cols-2 gap-4">
            <div className="bg-white/[0.05] border border-white/[0.07] rounded-xl p-5">
              <div className="text-2xl font-bold text-white">500+</div>
              <div className="text-[13px] text-slate-500 mt-1">สินค้าในระบบ</div>
            </div>
            <div className="bg-white/[0.05] border border-white/[0.07] rounded-xl p-5">
              <div className="text-2xl font-bold text-white">1,000+</div>
              <div className="text-[13px] text-slate-500 mt-1">ลูกค้าทั้งหมด</div>
            </div>
          </div>
        </div>

        {/* Decorative elements */}
        <div className="absolute top-20 right-20 w-72 h-72 bg-primary-600/5 rounded-full blur-3xl" />
        <div className="absolute bottom-20 left-20 w-56 h-56 bg-primary-500/5 rounded-full blur-3xl" />
      </div>

      {/* Right Side - Metronic-style Login Form */}
      <div className="flex-1 flex items-center justify-center px-6 bg-[#f9fafb] dark:bg-[#0f1623]">
        <div className="max-w-[380px] w-full">
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <div className="w-9 h-9 rounded-lg bg-primary-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">B</span>
            </div>
            <span className="text-xl font-bold text-foreground tracking-tight">
              BEST<span className="text-primary-600">CHOICE</span>
            </span>
          </div>

          <div className="mb-7">
            <h2 className="text-xl font-semibold text-foreground tracking-tight">เข้าสู่ระบบ</h2>
            <p className="text-[13px] text-muted-foreground mt-1.5">ยินดีต้อนรับกลับมา เข้าสู่ระบบเพื่อจัดการร้านของคุณ</p>
          </div>

          <div className="bg-card rounded-xl shadow-card border border-border p-7">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-[13px] font-medium text-foreground mb-1.5">
                  อีเมล
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-border rounded-lg text-[13px] focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-all bg-secondary/50 focus:bg-card text-foreground placeholder:text-muted-foreground"
                  placeholder="email@example.com"
                  required
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-[13px] font-medium text-foreground mb-1.5">
                  รหัสผ่าน
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-border rounded-lg text-[13px] focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-all bg-secondary/50 focus:bg-card text-foreground placeholder:text-muted-foreground"
                  placeholder="รหัสผ่าน"
                  required
                  minLength={6}
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-primary-600 text-white py-2.5 px-4 rounded-lg font-semibold text-[13px] hover:bg-primary-700 focus:ring-4 focus:ring-primary-200/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    กำลังเข้าสู่ระบบ...
                  </span>
                ) : (
                  'เข้าสู่ระบบ'
                )}
              </button>
            </form>

            {import.meta.env.DEV && (
              <div className="mt-5 p-3.5 bg-primary-50 dark:bg-primary-900/20 rounded-lg border border-primary-100 dark:border-primary-800/30">
                <p className="font-medium text-primary-700 dark:text-primary-400 text-[12px] mb-0.5">บัญชีทดสอบ:</p>
                <p className="text-primary-600 dark:text-primary-400/80 text-[12px]">admin@bestchoice.com / admin1234</p>
              </div>
            )}
          </div>

          <p className="mt-5 text-center text-[13px] text-muted-foreground">
            <Link to="/landing" className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium">
              กลับหน้าแรก
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
