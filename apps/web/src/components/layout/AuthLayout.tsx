import { ReactNode } from 'react';
import { Link } from 'react-router';

interface AuthLayoutProps {
  children: ReactNode;
}

/**
 * Shared branded auth layout — Metronic split pattern
 * Left: form content (children), Right: branded dark panel
 */
export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="grid lg:grid-cols-2 grow min-h-screen bg-background">
      {/* Left Side — Form */}
      <div className="flex justify-center items-center p-8 lg:p-10 order-2 lg:order-1">
        <div className="w-full max-w-[440px]">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <img src="/logo-icon.svg" alt="BESTCHOICE" className="size-9 shrink-0" />
            <span className="text-xl font-extrabold text-foreground tracking-tight">
              BEST<span className="text-primary">CHOICE</span>
            </span>
          </div>

          {children}
        </div>
      </div>

      {/* Right Side — Branded panel (explicit dark, does not flip with theme) */}
      <div className="hidden lg:flex lg:rounded-2xl lg:m-5 order-1 lg:order-2 bg-zinc-900 relative overflow-hidden flex-col p-16 gap-5 justify-center text-white">
        <Link to="/landing" className="flex items-center gap-3 mb-6">
          <img src="/logo-icon.svg" alt="BESTCHOICE" className="size-11 shrink-0" />
          <span className="text-2xl font-extrabold tracking-tight text-white">
            BEST<span className="text-primary">CHOICE</span>
          </span>
        </Link>

        <h3 className="text-3xl font-bold leading-tight text-white">
          ระบบจัดการร้าน<br />ครบวงจร
        </h3>
        <div className="text-base text-white/70 leading-relaxed max-w-md">
          จัดการสินค้า ลูกค้า สัญญาผ่อนชำระ และติดตามยอดขาย
          ทั้งหมดในที่เดียว ด้วย{' '}
          <span className="text-white font-semibold">BESTCHOICE</span>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-4">
          <div className="bg-white/10 backdrop-blur-xs border border-white/15 rounded-xl p-5">
            <div className="text-2xl font-bold text-white">500+</div>
            <div className="text-sm text-white/70 mt-1">สินค้าในระบบ</div>
          </div>
          <div className="bg-white/10 backdrop-blur-xs border border-white/15 rounded-xl p-5">
            <div className="text-2xl font-bold text-white">1,000+</div>
            <div className="text-sm text-white/70 mt-1">ลูกค้าทั้งหมด</div>
          </div>
          <div className="bg-white/10 backdrop-blur-xs border border-white/15 rounded-xl p-5">
            <div className="text-2xl font-bold text-white">99.9%</div>
            <div className="text-sm text-white/70 mt-1">Uptime</div>
          </div>
        </div>

        {/* Decorative orbs */}
        <div className="absolute -top-20 -right-20 w-96 h-96 bg-primary/20 rounded-full blur-[100px]" />
        <div className="absolute -bottom-20 -left-20 w-80 h-80 bg-primary/15 rounded-full blur-[80px]" />
        <div className="absolute top-1/2 right-1/4 w-48 h-48 bg-primary/10 rounded-full blur-[60px]" />
      </div>
    </div>
  );
}
