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
    <div className="grid lg:grid-cols-2 grow min-h-screen">
      {/* Left Side - Login Form (Metronic branded auth pattern) */}
      <div className="flex justify-center items-center p-8 lg:p-10 order-2 lg:order-1">
        <div className="w-full max-w-[400px]">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <div className="size-9 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-white font-bold text-sm">B</span>
            </div>
            <span className="text-xl font-bold text-foreground tracking-tight">
              BEST<span className="text-primary">CHOICE</span>
            </span>
          </div>

          <div className="mb-7">
            <h2 className="text-2xl font-semibold text-foreground">เข้าสู่ระบบ</h2>
            <p className="text-sm text-muted-foreground mt-2">ยินดีต้อนรับกลับมา เข้าสู่ระบบเพื่อจัดการร้านของคุณ</p>
          </div>

          <div className="bg-card rounded-xl shadow-xs shadow-black/5 border border-border p-6">
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
                  className="w-full h-10 px-3.5 border border-input rounded-lg text-sm outline-none transition-all bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background"
                  placeholder="email@example.com"
                  required
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-2sm font-medium text-foreground mb-1.5">
                  รหัสผ่าน
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-10 px-3.5 border border-input rounded-lg text-sm outline-none transition-all bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background"
                  placeholder="รหัสผ่าน"
                  required
                  minLength={6}
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-primary text-primary-foreground h-10 px-4 rounded-lg font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xs shadow-black/5"
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
              </button>
            </form>

            {import.meta.env.DEV && (
              <div className="mt-5 p-3.5 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800/30">
                <p className="font-medium text-blue-700 dark:text-blue-400 text-xs mb-0.5">บัญชีทดสอบ:</p>
                <p className="text-blue-600 dark:text-blue-400/80 text-xs">admin@bestchoice.com / admin1234</p>
              </div>
            )}
          </div>

          <p className="mt-5 text-center text-sm text-muted-foreground">
            <Link to="/landing" className="text-primary hover:text-primary/80 font-medium">
              กลับหน้าแรก
            </Link>
          </p>
        </div>
      </div>

      {/* Right Side - Branded panel (Metronic branded auth pattern) */}
      <div className="hidden lg:flex lg:rounded-xl lg:border lg:border-border lg:m-5 order-1 lg:order-2 bg-zinc-950 relative overflow-hidden flex-col p-16 gap-4 justify-center">
        <Link to="/landing" className="flex items-center gap-3 mb-8">
          <div className="size-10 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-white font-bold text-lg">B</span>
          </div>
          <span className="text-2xl font-bold text-white tracking-tight">
            BEST<span className="text-blue-400">CHOICE</span>
          </span>
        </Link>

        <h3 className="text-2xl font-semibold text-white">
          ระบบจัดการร้านครบวงจร
        </h3>
        <div className="text-base font-medium text-zinc-400">
          จัดการสินค้า ลูกค้า สัญญาผ่อนชำระ และติดตามยอดขาย
          <br />ทั้งหมดในที่เดียว ด้วย{' '}
          <span className="text-white font-semibold">BESTCHOICE</span>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-4">
          <div className="bg-white/[0.05] border border-white/[0.07] rounded-xl p-5">
            <div className="text-2xl font-bold text-white">500+</div>
            <div className="text-sm text-zinc-500 mt-1">สินค้าในระบบ</div>
          </div>
          <div className="bg-white/[0.05] border border-white/[0.07] rounded-xl p-5">
            <div className="text-2xl font-bold text-white">1,000+</div>
            <div className="text-sm text-zinc-500 mt-1">ลูกค้าทั้งหมด</div>
          </div>
        </div>

        {/* Decorative */}
        <div className="absolute top-20 right-20 w-72 h-72 bg-blue-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-20 left-20 w-56 h-56 bg-blue-400/5 rounded-full blur-3xl" />
      </div>
    </div>
  );
}
