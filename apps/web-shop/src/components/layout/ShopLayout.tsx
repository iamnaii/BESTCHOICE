import type { ReactNode } from 'react';
import ShopHeader from './ShopHeader';
import ShopFooter from './ShopFooter';
import FloatingLineButton from './FloatingLineButton';
import PromoBar from './PromoBar';

export default function ShopLayout({ children, mobileFloatingContact = true }: { children: ReactNode; mobileFloatingContact?: boolean }) {
  return (
    <div className="min-h-screen flex flex-col pb-[var(--cookie-banner-offset,0px)]">
      {/* ข้ามเมนูหัวเว็บ — ซ่อนจนกด Tab ถึง (คนใช้แป้นพิมพ์/โปรแกรมอ่านหน้าจอไม่ต้องไล่ผ่านเมนูทุกหน้า) */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-[max(1rem,env(safe-area-inset-left))] focus:top-[max(0.5rem,env(safe-area-inset-top))] focus:z-[60] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2.5 focus:font-head focus:text-sm focus:font-semibold focus:text-ink-foreground focus:leading-snug"
      >
        ข้ามไปเนื้อหาหลัก
      </a>
      <PromoBar />
      <ShopHeader />
      {/* scroll-mt เท่าความสูงหัวเว็บที่ติดด้านบน (≈65px) — กระโดดมาแล้วหัวเว็บไม่บังต้นเนื้อหา */}
      <main id="main" tabIndex={-1} className="flex-1 scroll-mt-17 outline-none">
        {children}
      </main>
      <ShopFooter clearFloatingContact={mobileFloatingContact} />
      <FloatingLineButton showOnMobile={mobileFloatingContact} />
    </div>
  );
}
