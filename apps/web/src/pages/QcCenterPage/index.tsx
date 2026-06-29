import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClipboardCheck, Check, X, Search, Image as ImageIcon } from 'lucide-react';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import { useIsMobile } from '@/hooks/useIsMobile';
import { formatDateTime } from '@/utils/formatters';
import { useQcCenter } from './useQcCenter';
import { qcStatusLabels, qcStatusClasses, filterByPoNumber, headerCheckState } from './qcLabels';

interface Branch {
  id: string;
  name: string;
}

export default function QcCenterPage() {
  const { user } = useAuth();
  // BranchGuard 403s a branch-scoped role (BRANCH_MANAGER) that passes another
  // branch's id. Only cross-branch roles (here: OWNER) may pick a branch; BM
  // sends no branchId and sees the queue exactly as the legacy panel did
  // (per-branch BM scoping is a backend follow-up, out of B4 scope).
  const canPickBranch = user?.role === 'OWNER';
  const [branchId, setBranchId] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const isMobile = useIsMobile();

  const { data: branches } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
    enabled: canPickBranch,
  });

  const { products, total, isLoading, isError, error, refetch, confirmMutation, rejectMutation } =
    useQcCenter({ branchId: branchId || undefined });

  const visible = useMemo(
    () => filterByPoNumber(products, debouncedSearch),
    [products, debouncedSearch],
  );
  const visibleIds = useMemo(() => visible.map((p) => p.id), [visible]);
  const checkState = headerCheckState(visibleIds, selected);
  const selectedVisible = visibleIds.filter((id) => selected.has(id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected((prev) => {
      if (checkState === 'all') {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...visibleIds]);
    });
  const clearSelection = () => setSelected(new Set());

  const onConfirm = () => {
    if (selectedVisible.length === 0) return;
    confirmMutation.mutate(selectedVisible, { onSuccess: clearSelection });
  };
  const onRejectConfirm = () => {
    if (selectedVisible.length === 0) return;
    if (!rejectReason.trim()) {
      toast.error('กรุณาระบุเหตุผลที่ไม่ผ่าน QC');
      return;
    }
    rejectMutation.mutate(
      { productIds: selectedVisible, reason: rejectReason },
      {
        onSuccess: () => {
          clearSelection();
          setRejectReason('');
          setRejectOpen(false);
        },
      },
    );
  };

  return (
    <div className="pb-24">
      <PageHeader
        title="ศูนย์ตรวจ QC"
        subtitle="ยืนยันหรือปฏิเสธสินค้าที่รอตรวจคุณภาพก่อนเข้าคลัง"
        icon={<ClipboardCheck className="size-5" />}
        badge={
          total > 0 ? (
            <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 rounded-full text-xs font-bold bg-warning/10 text-warning dark:bg-warning/15 leading-snug">
              {total}
            </span>
          ) : undefined
        }
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาเลข PO / ชื่อสินค้า / IMEI"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-input bg-background leading-snug focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        {canPickBranch && (
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-input bg-background leading-snug"
          >
            <option value="">ทุกสาขา</option>
            {(branches ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <QueryBoundary
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดรายการรอตรวจ QC ได้"
      >
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <ClipboardCheck className="size-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-foreground leading-snug">ไม่มีสินค้ารอตรวจ QC</p>
            <p className="text-xs text-muted-foreground mt-1 leading-snug">
              {debouncedSearch || branchId ? 'ลองล้างตัวกรอง' : 'รายการที่รับเข้าจะปรากฏที่นี่'}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {/* Header row (select-all) */}
            <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-muted/40">
              <Checkbox
                checked={
                  checkState === 'all' ? true : checkState === 'some' ? 'indeterminate' : false
                }
                onCheckedChange={toggleAll}
                aria-label="เลือกทั้งหมด"
              />
              <span className="text-xs font-semibold text-muted-foreground leading-snug">
                {selectedVisible.length > 0
                  ? `เลือก ${selectedVisible.length} ชิ้น`
                  : `${visible.length} รายการ`}
              </span>
            </div>

            <ul className="divide-y divide-border">
              {visible.map((p) => {
                const checked = selected.has(p.id);
                return (
                  <li
                    key={p.id}
                    className={`flex ${isMobile ? 'flex-col' : 'items-center'} gap-3 px-4 py-3 ${checked ? 'bg-primary/5' : ''}`}
                  >
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggle(p.id)}
                        aria-label={`เลือก ${p.name}`}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-foreground truncate leading-snug">
                            {p.name}
                          </p>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold leading-snug ${qcStatusClasses[p.status] ?? 'bg-muted text-foreground'}`}
                          >
                            {qcStatusLabels[p.status] ?? p.status}
                          </span>
                          {p.photos.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                              <ImageIcon className="size-3" />
                              {p.photos.length}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                          {p.imeiSerial ? `IMEI: ${p.imeiSerial}` : 'ไม่มี IMEI'}
                          {p.po?.poNumber ? ` · ${p.po.poNumber}` : ''}
                          {p.branch?.name ? ` · ${p.branch.name}` : ''}
                        </p>
                        <p className="text-[11px] text-muted-foreground/80 mt-0.5 leading-snug">
                          {p.supplier?.name ? `${p.supplier.name} · ` : ''}
                          {formatDateTime(p.createdAt)}
                        </p>
                      </div>
                    </div>
                    <div className={`flex gap-2 ${isMobile ? 'w-full' : 'shrink-0'}`}>
                      <button
                        onClick={() =>
                          confirmMutation.mutate([p.id], { onSuccess: () => toggle(p.id) })
                        }
                        className={`inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-success text-success-foreground hover:bg-success/90 transition-colors ${isMobile ? 'flex-1' : ''}`}
                      >
                        <Check className="size-3.5" /> ผ่าน
                      </button>
                      <button
                        onClick={() => {
                          setSelected(new Set([p.id]));
                          setRejectOpen(true);
                        }}
                        className={`inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors ${isMobile ? 'flex-1' : ''}`}
                      >
                        <X className="size-3.5" /> ไม่ผ่าน
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </QueryBoundary>

      {/* Sticky bulk action bar */}
      {selectedVisible.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 lg:left-[var(--sidebar-w,264px)] z-30 border-t border-border bg-card/95 backdrop-blur px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-foreground leading-snug">
            เลือก {selectedVisible.length} ชิ้น
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setRejectOpen(true)}
              disabled={rejectMutation.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
            >
              <X className="size-4" /> ไม่ผ่าน
            </button>
            <button
              onClick={onConfirm}
              disabled={confirmMutation.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-success text-success-foreground hover:bg-success/90 transition-colors disabled:opacity-50"
            >
              <Check className="size-4" /> ยืนยันผ่านทั้งหมด
            </button>
          </div>
        </div>
      )}

      {/* Reject reason dialog */}
      <ConfirmDialog
        open={rejectOpen}
        onOpenChange={(open) => {
          setRejectOpen(open);
          if (!open) setRejectReason('');
        }}
        title={`ไม่ผ่าน QC (${selectedVisible.length} ชิ้น)`}
        description="ระบุเหตุผลที่ไม่ผ่าน — สินค้าจะถูกตัดออกจากคลัง"
        variant="destructive"
        confirmLabel="บันทึกไม่ผ่าน"
        loading={rejectMutation.isPending}
        closeOnConfirm={false}
        onConfirm={onRejectConfirm}
      >
        <Textarea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="เช่น จอแตก / IMEI ถูกบล็อก / ไม่ตรงรุ่น"
          className="mt-1 leading-snug"
          rows={3}
        />
      </ConfirmDialog>
    </div>
  );
}
