import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeftRight, FileText, MoreHorizontal, Pencil } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import CustomerSummaryActions from './CustomerSummaryActions';
import type { ActiveContractSummary } from './ContractSummaryCard';

interface Props {
  product: { id: string; status: string; activeContract?: ActiveContractSummary | null };
  /** OWNER / BRANCH_MANAGER */
  isManager: boolean;
  /** เครื่องขึ้นเว็บแล้ว → ปุ่มคัดลอกลิงก์ใช้ได้ */
  isReady: boolean;
  summaryText: string;
  shareUrl: string;
  canTransfer: boolean;
  onEdit: () => void;
  onTransfer: () => void;
  /** ปุ่ม "นำเข้าคลังพร้อมขาย" (ReturnToStockAction — โผล่เองเฉพาะ REFURBISHED) แสดงเป็นปุ่มหลัก */
  returnToStock?: ReactNode;
}

const OUTLINE =
  'inline-flex items-center gap-1.5 px-4 py-2 text-sm text-foreground border border-input rounded-lg hover:bg-muted/50 leading-snug min-h-11';

/**
 * ปุ่มหัวหน้าตามสถานะเครื่อง — ปุ่มหลักปุ่มเดียว ที่เหลือ outline + เมนู ⋯ · ไม่มีปุ่ม "กลับ"
 * (breadcrumb ทำหน้าที่แทน — ปุ่มเดิมพาไป /products ทั้งที่ breadcrumb ไป /stock)
 */
export default function ProductHeaderActions({
  product,
  isManager,
  isReady,
  summaryText,
  shareUrl,
  canTransfer,
  onEdit,
  onTransfer,
  returnToStock,
}: Props) {
  const soldWithContract = product.status === 'SOLD_INSTALLMENT' && !!product.activeContract;
  const menuItems: Array<{ key: string; label: string; icon: ReactNode; onClick: () => void }> = [];
  if (canTransfer) {
    menuItems.push({
      key: 'transfer',
      label: 'โอนสาขา',
      icon: <ArrowLeftRight className="size-4" aria-hidden />,
      onClick: onTransfer,
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {returnToStock}
      {soldWithContract && product.activeContract ? (
        <Link
          to={`/contracts/${product.activeContract.id}`}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 leading-snug min-h-11"
        >
          <FileText className="size-4" aria-hidden />
          เปิดสัญญา {product.activeContract.contractNumber}
        </Link>
      ) : (
        <CustomerSummaryActions summaryText={summaryText} shareUrl={shareUrl} isReady={isReady} />
      )}
      {isManager && (
        <button type="button" onClick={onEdit} className={OUTLINE}>
          <Pencil className="size-4" aria-hidden />
          แก้ไขข้อมูล
        </button>
      )}
      {menuItems.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="เมนูเพิ่มเติม" className={`${OUTLINE} px-2.5`}>
              <MoreHorizontal className="size-5" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {menuItems.map((item) => (
              <DropdownMenuItem key={item.key} onSelect={item.onClick}>
                {item.icon}
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
