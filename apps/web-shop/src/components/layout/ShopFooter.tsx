import { Link } from 'react-router';
import { Facebook, MessageCircle, Music2, MapPin, Phone } from 'lucide-react';
import { shopInfo } from '@/lib/copy';

const SERVICE_LINKS = [
  { to: '/products', label: 'สินค้าทั้งหมด' },
  { to: '/sell', label: 'ขาย/เทิร์น iPhone' },
  { to: '/promotions', label: 'โปรโมชัน' },
  { to: '/how-it-works', label: 'วิธีผ่อน' },
  { to: '/apply/status', label: 'เช็คสถานะใบสมัคร' },
];

const POLICY_LINKS = [
  { to: '/installment-terms', label: 'เงื่อนไขการผ่อน' },
  { to: '/shipping', label: 'การจัดส่ง' },
  { to: '/returns', label: 'การคืนสินค้า' },
  { to: '/about', label: 'เกี่ยวกับเรา' },
];

const socialCls =
  'size-11 rounded-full bg-white/10 ring-1 ring-inset ring-white/15 grid place-items-center ' +
  'text-white/60 transition-colors';

export default function ShopFooter() {
  return (
    <footer className="mt-12 bg-ink text-white/70">
      <div className="container mx-auto max-w-7xl px-4 md:px-6 pt-12 pb-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2">
              <span className="size-9 rounded-xl bg-white grid place-items-center overflow-hidden">
                <img src="/logo-icon.svg" alt="" className="size-7" aria-hidden />
              </span>
              <span className="font-brand text-base font-extrabold text-white">
                BESTCHOICE
              </span>
            </div>
            <p className="mt-4 text-sm leading-snug text-white/50">
              ร้านขาย iPhone มือ 1 และมือสองที่ลพบุรี ผ่อนได้ด้วยบัตรประชาชนใบเดียว
              เครื่องผ่านตรวจ 30 จุดทุกเครื่อง
            </p>
            <div className="mt-5 flex gap-2.5">
              <a
                href="https://www.facebook.com/bestchoicephone"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Facebook"
                className={`${socialCls} hover:bg-[#1877F2] hover:text-white hover:ring-[#1877F2]`}
              >
                <Facebook className="size-5" aria-hidden />
              </a>
              <a
                href={shopInfo.lineUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="LINE"
                className={`${socialCls} hover:bg-[#06C755] hover:text-white hover:ring-[#06C755]`}
              >
                <MessageCircle className="size-5" aria-hidden />
              </a>
              <a
                href="https://www.tiktok.com/@bestchoicephone"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="TikTok"
                className={`${socialCls} hover:bg-white hover:text-ink hover:ring-white`}
              >
                <Music2 className="size-5" aria-hidden />
              </a>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-white">บริการ</h3>
            <ul className="mt-4 space-y-2.5 text-sm leading-snug">
              {SERVICE_LINKS.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="text-white/50 hover:text-white transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-white">ข้อมูล</h3>
            <ul className="mt-4 space-y-2.5 text-sm leading-snug">
              {POLICY_LINKS.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="text-white/50 hover:text-white transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-white">ติดต่อเรา</h3>
            <ul className="mt-4 space-y-3 text-sm leading-snug text-white/50">
              <li className="flex gap-2.5">
                <Phone className="size-4 mt-0.5 shrink-0" aria-hidden />
                <a href={shopInfo.phoneHref} className="hover:text-white transition-colors">
                  {shopInfo.phoneDisplay}
                </a>
              </li>
              <li className="flex gap-2.5">
                <MessageCircle className="size-4 mt-0.5 shrink-0" aria-hidden />
                <a
                  href={shopInfo.lineUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors"
                >
                  LINE {shopInfo.lineHandle}
                </a>
              </li>
              <li className="flex gap-2.5">
                <MapPin className="size-4 mt-0.5 shrink-0" aria-hidden />
                <span>{shopInfo.hours}</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-white/10 pt-6 text-center text-xs text-white/40 leading-snug">
          © 2026 BESTCHOICE Phone Shop — ลพบุรี
        </div>
      </div>
    </footer>
  );
}
