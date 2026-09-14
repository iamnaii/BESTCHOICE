import { ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const SALE_ROLES = ['OWNER', 'BRANCH_MANAGER', 'SALES']; // ตรง ProtectedRoute ของ /contracts/create และ /pos ใน App.tsx
const BOOKING_ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES']; // ตรง /bookings

export default function ActionsMenu({ customerId, role, chatPlaceholder, canStartCredit, onStartCredit, payContractId }: {
  customerId: string;
  role: string;
  chatPlaceholder: boolean;
  canStartCredit: boolean;
  onStartCredit: () => void;
  payContractId: string | null;
}) {
  const navigate = useNavigate();
  // ผู้สนใจที่ยังไม่มีเบอร์: API กันเปิดสัญญา/ใบขาย/ใบจอง (assertCustomerHasPhone) ⇒ ไม่เสนอทางที่ทำไม่ได้
  const canSell = SALE_ROLES.includes(role) && !chatPlaceholder;
  const items = [
    canStartCredit && { key: 'credit', label: 'ตรวจเครดิตใหม่', run: onStartCredit },
    canSell && { key: 'contract', label: 'สร้างสัญญาผ่อน', run: () => navigate(`/contracts/create?customerId=${customerId}`) },
    canSell && { key: 'pos', label: 'เปิดหน้าขาย', run: () => navigate('/pos') },
    BOOKING_ROLES.includes(role) && !chatPlaceholder && { key: 'booking', label: 'เปิดหน้าจอง / มัดจำ', run: () => navigate('/bookings') },
    payContractId && { key: 'pay', label: 'รับชำระ', run: () => navigate(`/payments?contractId=${payContractId}`) },
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
