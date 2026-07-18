import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Menu, Search, ShoppingCart, User, X } from 'lucide-react';

const NAV_LINKS = [
  { to: '/products', label: 'สินค้าทั้งหมด' },
  { to: '/sell', label: 'ขาย/เทิร์น iPhone' },
  { to: '/promotions', label: 'โปรโมชัน' },
  { to: '/how-it-works', label: 'วิธีซื้อ' },
  { to: '/about', label: 'เกี่ยวกับเรา' },
  { to: '/contact', label: 'ติดต่อ' },
];

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

  return (
    <header className="sticky top-0 z-40 bg-background border-b border-border">
      <div className="container mx-auto px-4 py-3 flex items-center gap-4">
        <button
          type="button"
          aria-label={menuOpen ? 'ปิดเมนู' : 'เปิดเมนู'}
          aria-expanded={menuOpen}
          className="p-2 hover:bg-muted rounded lg:hidden"
          onClick={() => {
            setMenuOpen((o) => !o);
            setSearchOpen(false);
          }}
        >
          {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
        <Link to="/" className="text-xl font-bold text-primary">BESTCHOICE</Link>
        <nav className="hidden lg:flex gap-4 text-sm">
          {NAV_LINKS.map((l) => (
            <Link key={l.to} to={l.to} className="hover:text-primary">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex-1" />
        <button
          type="button"
          aria-label="ค้นหา"
          aria-expanded={searchOpen}
          className="p-2 hover:bg-muted rounded"
          onClick={() => {
            setSearchOpen((o) => !o);
            setMenuOpen(false);
          }}
        >
          <Search className="w-5 h-5" />
        </button>
        <Link to="/cart" aria-label="ตะกร้า" className="p-2 hover:bg-muted rounded relative">
          <ShoppingCart className="w-5 h-5" />
        </Link>
        <Link to="/account" aria-label="บัญชี" className="p-2 hover:bg-muted rounded">
          <User className="w-5 h-5" />
        </Link>
      </div>

      {searchOpen && (
        <div className="border-t border-border bg-background">
          <form onSubmit={submitSearch} className="container mx-auto px-4 py-3 flex gap-2">
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
              className="flex-1 h-10 px-3 rounded-lg border border-border bg-background text-sm leading-snug focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <button
              type="submit"
              className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              ค้นหา
            </button>
          </form>
        </div>
      )}

      {menuOpen && (
        <nav
          aria-label="เมนูหลัก"
          className="lg:hidden border-t border-border bg-background"
        >
          <ul className="container mx-auto px-4 py-2">
            {NAV_LINKS.map((l) => (
              <li key={l.to}>
                <Link
                  to={l.to}
                  className="block py-3 text-[15px] leading-snug border-b border-border/60 last:border-0 hover:text-primary"
                  onClick={() => setMenuOpen(false)}
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
