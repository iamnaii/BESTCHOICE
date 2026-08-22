import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Menu, Search, ShoppingCart, User, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { to: '/', label: 'หน้าหลัก' },
  { to: '/products', label: 'สินค้าทั้งหมด' },
  { to: '/sell', label: 'ขาย/เทิร์น iPhone' },
  { to: '/promotions', label: 'โปรโมชัน' },
  { to: '/how-it-works', label: 'วิธีผ่อน' },
  { to: '/contact', label: 'ติดต่อ' },
];

/**
 * Solid brand-green bar across the full width, mirroring the reference
 * storefront's solid gold bar. Everything sitting on it is white; the one
 * ink-black capsule on the right is the only high-contrast element, so it
 * reads as THE action without competing with the product cards below.
 */
export default function ShopHeader() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const location = useLocation();

  // Close both overlays whenever the route changes.
  useEffect(() => {
    setSearchOpen(false);
    setMenuOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen && !menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setMenuOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [searchOpen, menuOpen]);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    // Backend ListProductsDto caps search at 60 chars — clamp instead of 400.
    const q = query.trim().slice(0, 60);
    if (!q) return;
    setSearchOpen(false);
    setQuery('');
    nav(`/products?search=${encodeURIComponent(q)}#catalog`);
  }

  const iconBtn =
    'p-2 rounded-full text-foreground/70 hover:bg-foreground/10 hover:text-foreground transition-colors';

  return (
    <header className="sticky top-0 z-40 bg-primary">
      <div className="container mx-auto max-w-7xl px-4 md:px-6 py-2.5 flex items-center gap-3 md:gap-5">
        <button
          type="button"
          aria-label={menuOpen ? 'ปิดเมนู' : 'เปิดเมนู'}
          aria-expanded={menuOpen}
          className={cn(iconBtn, 'lg:hidden')}
          onClick={() => {
            setMenuOpen((o) => !o);
            setSearchOpen(false);
          }}
        >
          {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>

        <Link to="/" className="flex items-center gap-2 shrink-0" aria-label="BESTCHOICE หน้าหลัก">
          <span className="size-8 rounded-xl bg-white grid place-items-center overflow-hidden">
            <img src="/logo-icon.svg" alt="" className="size-6" aria-hidden />
          </span>
          <span className="font-brand text-[15px] font-extrabold text-foreground">
            BESTCHOICE
          </span>
        </Link>

        {/* Underline grows on hover — the reference's nav signature. */}
        <nav className="hidden lg:flex items-center gap-5 text-[13.5px]">
          {NAV_LINKS.map((l) => {
            const active = l.to === '/' ? location.pathname === '/' : location.pathname.startsWith(l.to);
            return (
              <Link
                key={l.to}
                to={l.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative py-1 leading-snug transition-colors',
                  'after:absolute after:left-0 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-foreground after:transition-all after:duration-200',
                  active
                    ? 'text-foreground font-medium after:w-full'
                    : 'text-foreground/70 hover:text-foreground after:w-0 hover:after:w-full',
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        <button
          type="button"
          aria-label="ค้นหา"
          aria-expanded={searchOpen}
          className={iconBtn}
          onClick={() => {
            setSearchOpen((o) => !o);
            setMenuOpen(false);
          }}
        >
          <Search className="w-5 h-5" />
        </button>
        <Link to="/cart" aria-label="ตะกร้า" className={iconBtn}>
          <ShoppingCart className="w-5 h-5" />
        </Link>
        <Link to="/account" aria-label="บัญชี" className={cn(iconBtn, 'hidden sm:inline-flex')}>
          <User className="w-5 h-5" />
        </Link>

        <Link
          to="/how-it-works"
          className="hidden md:inline-flex h-9 items-center rounded-full bg-ink px-5 text-[13px] font-semibold text-ink-foreground hover:bg-zinc-800 transition-colors whitespace-nowrap leading-snug"
        >
          เช็คยอดผ่อนทันที
        </Link>
      </div>

      {searchOpen && (
        <div className="border-t border-foreground/10 bg-primary">
          <form
            onSubmit={submitSearch}
            className="container mx-auto max-w-7xl px-4 md:px-6 py-3 flex gap-2"
          >
            <label htmlFor="shop-header-search" className="sr-only">
              ค้นหาสินค้า
            </label>
            <input
              id="shop-header-search"
              ref={searchInputRef}
              type="search"
              value={query}
              maxLength={60}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหารุ่น เช่น iPhone 15"
              className="flex-1 h-10 px-4 rounded-full bg-white border-0 text-sm leading-snug text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-foreground/40"
            />
            <button
              type="submit"
              className="h-10 px-5 rounded-full bg-ink text-ink-foreground text-sm font-semibold hover:bg-zinc-800 transition-colors leading-snug"
            >
              ค้นหา
            </button>
          </form>
        </div>
      )}

      {menuOpen && (
        <nav aria-label="เมนูหลัก" className="lg:hidden border-t border-foreground/10 bg-primary">
          <ul className="container mx-auto max-w-7xl px-4 md:px-6 py-1">
            {NAV_LINKS.map((l) => (
              <li key={l.to}>
                <Link
                  to={l.to}
                  className="block py-3 text-[15px] leading-snug text-foreground/80 hover:text-foreground border-b border-foreground/10 last:border-0"
                  onClick={() => setMenuOpen(false)}
                >
                  {l.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                to="/how-it-works"
                onClick={() => setMenuOpen(false)}
                className="my-3 flex h-11 items-center justify-center rounded-full bg-ink text-ink-foreground text-[15px] font-semibold leading-snug"
              >
                เช็คยอดผ่อนทันที
              </Link>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}
