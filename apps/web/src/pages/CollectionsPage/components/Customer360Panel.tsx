import { useEffect, useState } from 'react';
import {
  X,
  Phone,
  MessageCircle,
  MapPin,
  Loader2,
  Receipt,
  RefreshCw,
  Tag,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import type { PaymentScheduleItem } from '../hooks/useCustomer360';
import { useCustomer360 } from '../hooks/useCustomer360';
import { useCustomerInsights } from '../hooks/useCustomerInsights';
import {
  useCustomerTags,
  useRecomputeCustomerTags,
} from '../hooks/useCustomerTags';
import Customer360Timeline from './Customer360Timeline';
import Customer360Actions from './Customer360Actions';
import SmartCustomerPanel from './SmartCustomerPanel';
import RelatedContractsTab from './RelatedContractsTab';
import LegalCaseBanner from './LegalCaseBanner';
import LegalCaseDialog from './LegalCaseDialog';
import LineChatPanel from './LineChatPanel';
import LateFeeWaiverDialog from './LateFeeWaiverDialog';
import CustomerTagChips from './CustomerTagChips';
import CustomerTagDialog from './CustomerTagDialog';
import type { ContractRow } from '../types';
import { formatThaiDateShort } from '@/lib/date';

interface Props {
  contract: ContractRow | null;
  onClose: () => void;
  onRequestSendLine?: (c: ContractRow) => void; // Task 8 wires this
  onSelectContract?: (contractId: string) => void;
}

type Tab = 'overview' | 'related' | 'line';

export default function Customer360Panel({
  contract,
  onClose,
  onRequestSendLine,
  onSelectContract,
}: Props) {
  const { user } = useAuth();
  const { data, isLoading, isError } = useCustomer360(contract?.id ?? null);
  const customerId = data?.detail.customer.id ?? contract?.customer.id ?? null;
  const { data: insights } = useCustomerInsights(customerId);
  const { data: tags = [] } = useCustomerTags(customerId);
  const recompute = useRecomputeCustomerTags();
  const canManageTags = user?.role === 'OWNER';

  const [tab, setTab] = useState<Tab>('overview');
  const [legalCaseOpen, setLegalCaseOpen] = useState(false);
  const [waiverOpen, setWaiverOpen] = useState(false);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);

  // LINE tab is only meaningful when the customer has a LINE ID. If they
  // don't, hide the tab entirely and snap back to overview if the user was
  // on LINE for a previously selected customer.
  const hasLineId = !!(data?.detail.customer.lineId ?? contract?.customer.lineId);

  useEffect(() => {
    setTab('overview');
    setLegalCaseOpen(false);
    setWaiverOpen(false);
    setTagDialogOpen(false);
  }, [contract?.id]);

  useEffect(() => {
    if (tab === 'line' && !hasLineId) setTab('overview');
  }, [tab, hasLineId]);

  // Close on Escape
  useEffect(() => {
    if (!contract) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [contract, onClose]);

  // Block body scroll while open
  useEffect(() => {
    if (!contract) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [contract]);

  const open = !!contract;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-background/60 backdrop-blur-sm transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />

      {/* Slide-over */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="ข้อมูลลูกค้า 360"
        className={`fixed inset-y-0 right-0 z-50 w-full md:w-[480px] bg-card border-l border-border shadow-2xl transform transition-transform duration-200 flex flex-col ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between px-5 py-4 border-b border-border bg-card z-10">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Customer 360
            </div>
            <div className="text-sm font-mono tabular-nums text-primary">
              {contract?.contractNumber}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            aria-label="ปิด"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Body (scrollable) */}
        <div className="flex-1 overflow-y-auto">
          {!contract ? null : isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="size-6 animate-spin mb-2" />
              <div className="text-sm leading-snug">กำลังโหลด...</div>
            </div>
          ) : isError ? (
            <div className="p-5 text-sm text-destructive leading-snug">
              ไม่สามารถโหลดข้อมูลลูกค้าได้
            </div>
          ) : (
            <>
              {/* Customer header */}
              <section className="p-5 border-b border-border">
                <div className="text-lg font-semibold leading-snug mb-1">
                  {data?.detail.customer.name ?? contract.customer.name}
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {contract.customer.phone && (
                    <a
                      href={`tel:${contract.customer.phone}`}
                      className="inline-flex items-center gap-1 font-mono tabular-nums text-primary hover:underline"
                    >
                      <Phone className="size-3" />
                      {contract.customer.phone}
                    </a>
                  )}
                  {(data?.detail.customer.lineId ?? contract.customer.lineId) && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success/10 text-success px-2 py-0.5">
                      <MessageCircle className="size-3" />
                      LINE
                    </span>
                  )}
                  {data?.detail.customer.address && (
                    <span className="inline-flex items-center gap-1 max-w-full">
                      <MapPin className="size-3 shrink-0" />
                      <span className="truncate leading-snug">{data.detail.customer.address}</span>
                    </span>
                  )}
                </div>
                <SmartCustomerPanel insights={insights} />

                {/* Customer tags (P3 Task 8 — C1 frontend). Chip row + a
                  per-customer "Recompute" button that triggers the auto-tag
                  rules immediately, plus a "จัดการ Tags" dialog opener gated
                  to OWNER (manual create/delete are OWNER + FINANCE_MANAGER
                  on the backend; we surface the UI only to OWNER per spec). */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <CustomerTagChips
                    tags={tags.length > 0 ? tags : undefined}
                    emptyLabel="ยังไม่มี tag"
                  />
                  <button
                    type="button"
                    onClick={() => customerId && recompute.mutate(customerId)}
                    disabled={!customerId || recompute.isPending}
                    className="inline-flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground transition-colors leading-snug"
                    title="คำนวณ auto tag ใหม่"
                  >
                    <RefreshCw
                      className={`size-3 ${recompute.isPending ? 'animate-spin' : ''}`}
                    />
                    Recompute tags
                  </button>
                  {canManageTags && (
                    <button
                      type="button"
                      onClick={() => setTagDialogOpen(true)}
                      className="inline-flex items-center gap-1 text-2xs text-primary hover:underline leading-snug"
                    >
                      <Tag className="size-3" />
                      จัดการ Tags
                    </button>
                  )}
                </div>

                <div className="mt-2 text-xs text-muted-foreground leading-snug">
                  สาขา {contract.branch.name}
                </div>
              </section>

              {/* Tabs */}
              <div className="flex border-b border-border bg-card sticky top-[73px] z-10">
                <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>
                  ภาพรวม
                </TabButton>
                <TabButton active={tab === 'related'} onClick={() => setTab('related')}>
                  สัญญาทั้งหมด
                </TabButton>
                {hasLineId && (
                  <TabButton active={tab === 'line'} onClick={() => setTab('line')}>
                    LINE chat
                  </TabButton>
                )}
              </div>

              {tab === 'related' ? (
                <section className="p-5">
                  <RelatedContractsTab
                    customerId={customerId}
                    currentContractId={contract.id}
                    onSelectContract={(id) => {
                      if (onSelectContract) onSelectContract(id);
                    }}
                  />
                </section>
              ) : tab === 'line' ? (
                <LineChatPanel customerId={customerId} />
              ) : (
                <>
              <section className="px-5 pt-3">
                <LegalCaseBanner
                  contractId={contract.id}
                  contractStatus={data?.detail.status ?? contract.status}
                  onOpen={() => setLegalCaseOpen(true)}
                />
              </section>

              {/* Contract summary */}
              <section className="p-5 border-b border-border">
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
                  สัญญา
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1 leading-snug">ค้างชำระ</div>
                    <div className="text-xl font-bold tabular-nums text-destructive">
                      {contract.outstanding.toLocaleString()} ฿
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1 leading-snug">เลยกำหนด</div>
                    <div className="text-xl font-bold tabular-nums">
                      {contract.daysOverdue}{' '}
                      <span className="text-xs text-muted-foreground font-normal">วัน</span>
                    </div>
                  </div>
                </div>

                {/* Installment progress bar */}
                {data?.detail.payments && data.detail.payments.length > 0 && (() => {
                  const payments = data.detail.payments as PaymentScheduleItem[];
                  const paid = payments.filter((p) => p.status === 'PAID' || p.status === 'WAIVED').length;
                  const total = payments.length;
                  const percent = total > 0 ? Math.round((paid / total) * 100) : 0;
                  const nextDue = payments.find((p) =>
                    ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'].includes(p.status),
                  );
                  return (
                    <div className="mt-4 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground leading-snug">ความคืบหน้าการผ่อน</span>
                        <span className="tabular-nums font-medium">
                          {paid} / {total} งวด ({percent}%)
                        </span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all duration-500"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      {nextDue && (
                        <div className="text-xs text-muted-foreground leading-snug">
                          งวดถัดไป: งวด{' '}
                          <span className="tabular-nums font-medium">{nextDue.installmentNo}</span>{' '}
                          ครบกำหนด {formatThaiDateShort(nextDue.dueDate)}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </section>

              {/* Timeline */}
              <section className="p-5 border-b border-border">
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
                  กิจกรรม
                </div>
                <Customer360Timeline events={data?.timeline ?? []} />
              </section>

              {/* Actions */}
              <section className="p-5">
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
                  การดำเนินการ
                </div>
                <Customer360Actions
                  contract={contract}
                  onSendLine={
                    onRequestSendLine ? () => onRequestSendLine(contract) : undefined
                  }
                />

                {/* Late fee waiver entry — only meaningful when there's
                    something owed. The dialog itself filters to payments
                    with a non-zero late fee, so the button can stay enabled
                    even when no individual installment is overdue yet. */}
                <button
                  type="button"
                  onClick={() => setWaiverOpen(true)}
                  className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-lg border border-input px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
                >
                  <Receipt className="size-4" />
                  ขอ waive ค่าปรับ
                </button>
              </section>
                </>
              )}
            </>
          )}
        </div>

        <LegalCaseDialog
          open={legalCaseOpen}
          onClose={() => setLegalCaseOpen(false)}
          contractId={contract?.id ?? null}
        />

        <LateFeeWaiverDialog
          open={waiverOpen}
          onClose={() => setWaiverOpen(false)}
          contract={
            contract
              ? {
                  id: contract.id,
                  contractNumber: contract.contractNumber,
                  customer: { name: contract.customer.name },
                }
              : null
          }
          payments={data?.detail.payments}
        />

        <CustomerTagDialog
          open={tagDialogOpen}
          onClose={() => setTagDialogOpen(false)}
          customerId={customerId}
        />
      </aside>
    </>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-4 py-2 text-sm leading-snug border-b-2 transition-colors ${
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
