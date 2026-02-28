import { useState } from 'react';
import { Link } from 'react-router-dom';

interface LandingNavProps {
  onScrollTo?: (section: string) => void;
}

export default function LandingNav({ onScrollTo }: LandingNavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const menuItems = [
    { label: 'หน้าแรก', section: 'hero' },
    { label: 'สินค้า', section: 'products' },
    { label: 'บริการ', section: 'services' },
    { label: 'ติดต่อเรา', section: 'contact' },
  ];

  const handleClick = (section: string) => {
    onScrollTo?.(section);
    setMobileOpen(false);
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-primary-950/95 backdrop-blur-md border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-400 to-purple-500 flex items-center justify-center">
              <span className="text-white font-bold text-sm">B</span>
            </div>
            <span className="text-xl font-bold text-white">
              best<span className="text-primary-400">choice</span>
            </span>
          </div>

          {/* Desktop Menu */}
          <div className="hidden md:flex items-center gap-8">
            {menuItems.map((item) => (
              <button
                key={item.section}
                onClick={() => handleClick(item.section)}
                className="text-sm text-gray-300 hover:text-white transition-colors font-medium"
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Login Button */}
          <div className="hidden md:flex items-center gap-3">
            <Link
              to="/login"
              className="px-5 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 rounded-lg transition-colors"
            >
              เข้าสู่ระบบ
            </Link>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-2 text-gray-300 hover:text-white"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {mobileOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div className="md:hidden bg-primary-950/98 border-t border-white/10">
          <div className="px-4 py-3 space-y-1">
            {menuItems.map((item) => (
              <button
                key={item.section}
                onClick={() => handleClick(item.section)}
                className="block w-full text-left px-3 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              >
                {item.label}
              </button>
            ))}
            <Link
              to="/login"
              className="block w-full text-center mt-2 px-5 py-2.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 rounded-lg transition-colors"
            >
              เข้าสู่ระบบ
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
