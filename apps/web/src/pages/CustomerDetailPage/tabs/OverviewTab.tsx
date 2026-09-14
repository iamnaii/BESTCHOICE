import { ChevronRight } from 'lucide-react';
import ChannelBadge from '@/components/chat/ChannelBadge';
import LineLinkInvite from '@/components/customer/LineLinkInvite';
import { Card, CardContent } from '@/components/ui/card';
import { isChatVisibleForRole } from '@/config/menu';
import { customerCreditStatusMap } from '@/lib/status-badges';
import { formatDateShort } from '@/utils/formatters';
import ActiveContractCard from '../components/ActiveContractCard';
import type { CustomerDetail } from '../types';
import { customerKind } from '../utils/customerKind';
import { SalesTable } from './SalesTab';

function SectionHead({ title, count, action }: { title: string; count?: number; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-[15px] font-semibold leading-snug">{title}</span>
        {count !== undefined && <span className="text-[13px] text-muted-foreground">({count})</span>}
      </div>
      {action && (
        <button type="button" onClick={action.onClick} className="inline-flex items-center gap-0.5 text-[13px] text-primary hover:underline">
          {action.label}<ChevronRight className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export default function OverviewTab({ customer, role, onOpenTab }: { customer: CustomerDetail; role: string; onOpenTab: (tab: string) => void }) {
  const kind = customerKind(customer);
  const sales = customer.sales ?? [];
  const closedCount = customer.contracts.length - customer.openContracts.length;

  return (
    <div className="flex flex-col gap-5">
      {customer.openContracts.length > 0 && (
        <Card><CardContent className="p-5">
          <SectionHead title="สัญญาที่กำลังผ่อน" count={customer.openContracts.length} action={{ label: 'ดูสัญญาทั้งหมด', onClick: () => onOpenTab('contracts') }} />
          <div className="flex flex-col gap-2.5">
            {customer.openContracts.map((contract) => <ActiveContractCard key={contract.id} contract={contract} />)}
          </div>
          {closedCount > 0 && <div className="mt-2.5 text-xs leading-snug text-muted-foreground">สัญญาอื่นที่ไม่ได้ผ่อนอยู่ {closedCount} ใบ อยู่ในแท็บสัญญา</div>}
        </CardContent></Card>
      )}

      {kind === 'CASH' && <LineLinkInvite lineIdShop={customer.lineIdShop} customerName={customer.name} />}

      {sales.length > 0 && (
        <Card><CardContent className="p-5">
          {/* Task 6 จะเปลี่ยนชื่อแท็บ purchases → sales — ตอนนี้ค่าแท็บที่มีจริงคือ 'purchases' */}
          <SectionHead title="ใบขายเงินสด / ไฟแนนซ์นอก" count={sales.length} action={sales.length > 3 ? { label: 'ดูทั้งหมด', onClick: () => onOpenTab('purchases') } : undefined} />
          <SalesTable sales={sales} limit={3} />
        </CardContent></Card>
      )}

      {kind === 'PROSPECT' && (
        <Card><CardContent className="p-5">
          <SectionHead title="ขั้นต่อไป" />
          <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 p-4 text-[13px] leading-snug">
            {customer.chatPlaceholder
              ? 'ยังไม่มีเบอร์ — เปิดสัญญา / ใบขาย / ใบจองได้เมื่อมีเบอร์'
              : `ยังไม่เคยซื้อกับเรา · เครดิต: ${(customerCreditStatusMap[customer.creditCheckStatus] ?? customerCreditStatusMap.NONE).label}`}
          </div>
          {customer.chatRooms.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] leading-snug text-muted-foreground">
              <span>แชท</span>
              {customer.chatRooms.map((room) => (
                <ChannelBadge key={room.roomId} channel={room.channel} variant="logo" roomId={isChatVisibleForRole(role) ? room.roomId : null} />
              ))}
              {customer.lastContactAt && <span>· ติดต่อล่าสุด {formatDateShort(customer.lastContactAt)}</span>}
            </div>
          )}
        </CardContent></Card>
      )}

      {kind !== 'PROSPECT' && customer.openContracts.length === 0 && sales.length === 0 && (
        <div className="py-6 text-center text-sm text-muted-foreground">ยังไม่มีสัญญาหรือใบขาย</div>
      )}
    </div>
  );
}
