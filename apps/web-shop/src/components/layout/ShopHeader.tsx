import { Link } from 'react-router';
import { Search, ShoppingCart, User } from 'lucide-react';

export default function ShopHeader() {
  return (
    <header className="sticky top-0 z-40 bg-background border-b border-border">
      <div className="container mx-auto px-4 py-3 flex items-center gap-4">
        <Link to="/" className="text-xl font-bold text-primary">BESTCHOICE</Link>
        <nav className="hidden md:flex gap-4 text-sm">
          <Link to="/products" className="hover:text-primary">สินค้าทั้งหมด</Link>
          <Link to="/how-it-works" className="hover:text-primary">วิธีซื้อ</Link>
          <Link to="/about" className="hover:text-primary">เกี่ยวกับเรา</Link>
          <Link to="/contact" className="hover:text-primary">ติดต่อ</Link>
        </nav>
        <div className="flex-1" />
        <button aria-label="ค้นหา" className="p-2 hover:bg-muted rounded">
          <Search className="w-5 h-5" />
        </button>
        <Link to="/cart" aria-label="ตะกร้า" className="p-2 hover:bg-muted rounded relative">
          <ShoppingCart className="w-5 h-5" />
        </Link>
        <Link to="/account" aria-label="บัญชี" className="p-2 hover:bg-muted rounded">
          <User className="w-5 h-5" />
        </Link>
      </div>
    </header>
  );
}
