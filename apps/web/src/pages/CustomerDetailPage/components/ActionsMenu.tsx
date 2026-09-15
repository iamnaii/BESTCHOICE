import { ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const SALE_ROLES = ['OWNER', 'BRANCH_MANAGER', 'SALES']; // ตรง ProtectedRoute ของ /contracts/create และ /pos ใน App.tsx
const BOOKING_ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES']; // ตรง /bookings

export default function ActionsMenu({ customerId, role, hasPhone, canStartCredit, onStartCredit, paymentSearch }: {
  customerId: string;
  role: string;
  hasPhone: boolean;
  canStartCredit: boolean;
  onStartCredit: () => void;
  /** ค่า ?search= ของหน้ารับชำระ — ดู utils/paymentTarget.ts */
  paymentSearch: string | null;
}) {
  const navigate = useNavigate();
  // API กันเปิดสัญญา/ใบขาย/ใบจองเมื่อลูกค้าไม่มีเบอร์ (assertCustomerHasPhone เช็คเบอร์อย่างเดียว ไม่ดู chatPlaceholder)
  // ⇒ ลูกค้าที่มีเลขบัตรแต่ไม่มีเบอร์ (chatPlaceholder=false) ก็ต้องไม่เห็นทางที่ทำไม่ได้
  const canSell = SALE_ROLES.includes(role) && hasPhone;
  const items = [
    canStartCredit && { key: 'credit', label: 'ตรวจเครดิตใหม่', run: onStartCredit },
    canSell && { key: 'contract', label: 'สร้างสัญญาผ่อน', run: () => navigate(`/contracts/create?customerId=${customerId}`) },
    canSell && { key: 'pos', label: 'เปิดหน้าขาย', run: () => navigate('/pos') },
    BOOKING_ROLES.includes(role) && hasPhone && { key: 'booking', label: 'เปิดหน้าจอง / มัดจำ', run: () => navigate('/bookings') },
    // R6: /payments อ่านแค่ ?search= (ไม่มีที่ไหนอ่าน ?contractId=)
    paymentSearch && { key: 'pay', label: 'รับชำระ', run: () => navigate(`/payments?search=${encodeURIComponent(paymentSearch)}`) },
  ].filter((item): item is { key: string; label: string; run: () => void } => Boolean(item));
  if (items.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="primary" size="md">
          ดำเนินการ
          <ChevronDown className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <DropdownMenuItem key={item.key} onSelect={item.run}>{item.label}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
