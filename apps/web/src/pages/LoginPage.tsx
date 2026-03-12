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
      {/* Left Side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-hero-gradient relative overflow-hidden">
        <div className="relative z-10 flex flex-col justify-center px-16">
          <Link to="/landing" className="flex items-center gap-2 mb-12">
            <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
              <span className="text-white font-bold text-lg">B</span>
            </div>
            <span className="text-2xl font-bold text-white">
              best<span className="text-primary-300">choice</span>
            </span>
          </Link>

          <h1 className="text-4xl font-bold text-white leading-tight">
            ระบบจัดการร้าน
            <br />
            <span className="text-primary-300">ครบวงจร</span>
          </h1>
          <p className="mt-4 text-lg text-gray-300 max-w-md leading-relaxed">
            จัดการสินค้า ลูกค้า สัญญาผ่อนชำระ และติดตามยอดขาย
            ทั้งหมดในที่เดียว
          </p>

          <div className="mt-12 grid grid-cols-2 gap-6">
            <div className="bg-white/10 rounded-xl p-4">
              <div className="text-2xl font-bold text-white">500+</div>
              <div className="text-sm text-gray-300 mt-1">สินค้าในระบบ</div>
            </div>
            <div className="bg-white/10 rounded-xl p-4">
              <div className="text-2xl font-bold text-white">1,000+</div>
              <div className="text-sm text-gray-300 mt-1">ลูกค้าทั้งหมด</div>
            </div>
          </div>
        </div>

        {/* Decorative elements */}
        <div className="absolute top-20 right-20 w-64 h-64 bg-primary-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-20 left-20 w-48 h-48 bg-primary-400/10 rounded-full blur-3xl" />
      </div>

      {/* Right Side - Login Form */}
      <div className="flex-1 flex items-center justify-center px-6 bg-gray-50">
        <div className="max-w-md w-full">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">B</span>
            </div>
            <span className="text-xl font-bold text-gray-900">
              best<span className="text-primary-600">choice</span>
            </span>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900">เข้าสู่ระบบ</h2>
            <p className="text-gray-500 mt-2">ยินดีต้อนรับกลับมา เข้าสู่ระบบเพื่อจัดการร้านของคุณ</p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
                  อีเมล
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all bg-gray-50 focus:bg-white"
                  placeholder="email@example.com"
                  required
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">
                  รหัสผ่าน
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all bg-gray-50 focus:bg-white"
                  placeholder="รหัสผ่าน"
                  required
                  minLength={6}
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-primary-600 text-white py-3 px-4 rounded-xl font-semibold text-sm hover:bg-primary-700 focus:ring-4 focus:ring-primary-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:shadow-lg hover:shadow-primary-600/20"
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
              <div className="mt-6 p-4 bg-primary-50 rounded-xl text-sm">
                <p className="font-medium text-primary-700 mb-1">บัญชีทดสอบ:</p>
                <p className="text-primary-600">admin@bestchoice.com / admin1234</p>
              </div>
            )}
          </div>

          <p className="mt-6 text-center text-sm text-gray-500">
            <Link to="/landing" className="text-primary-600 hover:text-primary-700 font-medium">
              กลับหน้าแรก
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
