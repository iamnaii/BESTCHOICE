import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import {
  ShoppingCart,
  FileCheck,
  DollarSign,
  Users,
  Warehouse,
  BarChart3,
  AlertTriangle,
  Settings,
  Home,
  CreditCard,
  Receipt,
  Bell,
  Building2,
  UserCog,
  Shield,
  FileText,
  Search,
  Plus,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

/* ─── Navigation Items ─── */

interface NavEntry {
  label: string;
  path: string;
  icon: LucideIcon;
  keywords?: string;
  roles?: string[];
}

const pages: NavEntry[] = [
  { label: 'หน้าหลัก', path: '/', icon: Home, keywords: 'dashboard home' },
  { label: 'POS ขายสินค้า', path: '/pos', icon: ShoppingCart, keywords: 'pos sale ขาย' },
  { label: 'ประวัติการขาย', path: '/sales', icon: Receipt, keywords: 'sales history' },
  { label: 'ลูกค้า', path: '/customers', icon: Users, keywords: 'customer ลูกค้า' },
  { label: 'ตรวจเครดิต', path: '/credit-checks', icon: CreditCard, keywords: 'credit check' },
  { label: 'สัญญาผ่อน', path: '/contracts', icon: FileCheck, keywords: 'contract สัญญา ผ่อน' },
  { label: 'ชำระเงิน', path: '/payments', icon: DollarSign, keywords: 'payment ชำระ จ่าย' },
  { label: 'ใบเสร็จรับเงิน', path: '/receipts', icon: Receipt, keywords: 'receipt ใบเสร็จ', roles: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT'] },
  { label: 'ตรวจสอบสลิป', path: '/payments?tab=slip-review', icon: FileCheck, keywords: 'slip review สลิป', roles: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT'] },
  { label: 'ติดตามหนี้', path: '/overdue', icon: AlertTriangle, keywords: 'overdue หนี้ ค้าง ติดตาม' },
  { label: 'คลังสินค้า', path: '/stock', icon: Warehouse, keywords: 'stock inventory สต็อก คลัง' },
  { label: 'สั่งซื้อ', path: '/purchase-orders', icon: Warehouse, keywords: 'purchase order PO สั่งซื้อ', roles: ['OWNER', 'BRANCH_MANAGER'] },
  { label: 'รายงาน', path: '/reports', icon: BarChart3, keywords: 'report รายงาน', roles: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT'] },
  { label: 'งบกำไรขาดทุน', path: '/profit-loss', icon: DollarSign, keywords: 'profit loss กำไร ขาดทุน', roles: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT'] },
  { label: 'แจ้งเตือน', path: '/notifications', icon: Bell, keywords: 'notification แจ้งเตือน', roles: ['OWNER', 'BRANCH_MANAGER'] },
  { label: 'สาขา', path: '/branches', icon: Building2, keywords: 'branch สาขา', roles: ['OWNER'] },
  { label: 'จัดการผู้ใช้', path: '/users', icon: UserCog, keywords: 'user ผู้ใช้', roles: ['OWNER'] },
  { label: 'ตั้งค่าระบบ', path: '/settings', icon: Settings, keywords: 'settings ตั้งค่า', roles: ['OWNER'] },
  { label: 'สถานะเอกสาร', path: '/document-dashboard', icon: FileText, keywords: 'document เอกสาร', roles: ['OWNER', 'BRANCH_MANAGER'] },
  { label: 'PDPA', path: '/pdpa', icon: Shield, keywords: 'pdpa privacy', roles: ['OWNER', 'BRANCH_MANAGER'] },
];

const quickActions: NavEntry[] = [
  { label: 'สร้างสัญญาใหม่', path: '/contracts/create', icon: Plus, keywords: 'new contract สร้าง สัญญา' },
  { label: 'เพิ่มลูกค้าใหม่', path: '/customers?action=new', icon: Plus, keywords: 'new customer เพิ่ม ลูกค้า' },
  { label: 'ขายสินค้า (POS)', path: '/pos', icon: ShoppingCart, keywords: 'sell ขาย pos' },
  { label: 'บันทึกชำระเงิน', path: '/payments', icon: DollarSign, keywords: 'record payment บันทึก ชำระ' },
];

/* ─── Component ─── */

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  // Ctrl+K / Cmd+K to open
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleSelect = useCallback(
    (path: string) => {
      setOpen(false);
      navigate(path);
    },
    [navigate],
  );

  const filterByRole = useCallback(
    (items: NavEntry[]) =>
      items.filter((item) => !item.roles || (user && item.roles.includes(user.role))),
    [user],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in-0 duration-150"
        onClick={() => setOpen(false)}
      />

      {/* Command Dialog */}
      <div className="fixed left-1/2 top-[20%] z-50 w-full max-w-lg -translate-x-1/2 animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150">
        <Command
          className="rounded-xl border border-border bg-popover shadow-2xl"
          loop
        >
          <CommandInput placeholder="ค้นหาหน้า, สัญญา, ลูกค้า..." />
          <CommandList>
            <CommandEmpty>
              <div className="flex flex-col items-center gap-2">
                <Search className="size-8 text-muted-foreground/40" />
                <span>ไม่พบผลลัพธ์</span>
              </div>
            </CommandEmpty>

            {/* Quick Actions */}
            <CommandGroup heading="ดำเนินการด่วน">
              {filterByRole(quickActions).map((item) => (
                <CommandItem
                  key={item.path}
                  value={`${item.label} ${item.keywords || ''}`}
                  onSelect={() => handleSelect(item.path)}
                >
                  <item.icon />
                  <span>{item.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandSeparator />

            {/* Pages */}
            <CommandGroup heading="ไปยังหน้า">
              {filterByRole(pages).map((item) => (
                <CommandItem
                  key={item.path}
                  value={`${item.label} ${item.keywords || ''}`}
                  onSelect={() => handleSelect(item.path)}
                >
                  <item.icon />
                  <span>{item.label}</span>
                  {item.path === '/' && <CommandShortcut>Home</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>

          {/* Footer hint */}
          <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
            <div className="flex items-center gap-3 text-2xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <kbd className="pointer-events-none rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">↑↓</kbd>
                เลื่อน
              </span>
              <span className="flex items-center gap-1">
                <kbd className="pointer-events-none rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">↵</kbd>
                เลือก
              </span>
              <span className="flex items-center gap-1">
                <kbd className="pointer-events-none rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd>
                ปิด
              </span>
            </div>
          </div>
        </Command>
      </div>
    </div>
  );
}

/** Hook for external components to open the palette */
export function useCommandPalette() {
  const open = useCallback(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
  }, []);
  return { open };
}
