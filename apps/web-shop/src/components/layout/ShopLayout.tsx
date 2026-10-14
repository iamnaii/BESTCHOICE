import type { ReactNode } from 'react';
import ShopHeader from './ShopHeader';
import ShopFooter from './ShopFooter';
import FloatingLineButton from './FloatingLineButton';

export default function ShopLayout({ children, mobileFloatingContact = true }: { children: ReactNode; mobileFloatingContact?: boolean }) {
  return (
    <div className="min-h-screen flex flex-col">
      <ShopHeader />
      <main className="flex-1">{children}</main>
      <ShopFooter />
      <FloatingLineButton showOnMobile={mobileFloatingContact} />
    </div>
  );
}
