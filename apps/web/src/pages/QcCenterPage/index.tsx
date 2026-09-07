import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Camera, X, Search, Image as ImageIcon } from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import { useIsMobile } from '@/hooks/useIsMobile';
import { formatDateTime } from '@/utils/formatters';
import { PHOTO_ANGLES } from '@/constants/photo-angles';
import { useQcCenter, type QcSource } from './useQcCenter';
import {
  SOURCE_FILTER_OPTIONS,
  canRejectFromQueue,
  filterByPoNumber,
  filterBySource,
  headerCheckState,
  primaryActionLabel,
  sourceClasses,
  sourceLabels,
} from './qcLabels';

interface Branch {
  id: string;
  name: string;
}

/** six tiny slots — how many of the angles are shot */
function AngleDots({ shot }: { shot: number }) {
  return (
    <span className="inline-flex items-center gap-[3px]" aria-label={`ถ่ายแล้ว ${shot}/6 มุม`}>
      {PHOTO_ANGLES.map((a, i) => (
        <span key={a} className={cn('size-2.5 rounded-[2px]', i < shot ? 'bg-info' : 'bg-muted')} />
      ))}
      <span className="ml-1.5 text-[11px] text-muted-foreground">{shot}/6 มุม</span>
    </span>
  );
}

/**
 * "รอถ่ายรูป" (owner-approved mockup 2026-09-07): the queue of used phones that cannot go on sale
 * until their six angles are shot — from a PO, a trade-in or a repossession. The QC step is gone:
 * nothing creates QC_PENDING any more and the old "ยืนยัน" button bypassed the price gate. What is
 * left is the way to the camera (the product page) and "ไม่รับเข้าคลัง" for units that came from a
 * supplier or a customer.
 */
export default function QcCenterPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  // BranchGuard 403s a branch-scoped role (BRANCH_MANAGER) that passes another
  // branch's id. Only cross-branch roles (here: OWNER) may pick a branch; BM
  // sends no branchId and sees the queue exactly as the legacy panel did.
  const canPickBranch = user?.role === 'OWNER';
  const [branchId, setBranchId] = useState('');
  const [source, setSource] = useState<QcSource | ''>('');
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

  const { products, total, isLoading, isError, error, refetch, rejectMutation } = useQcCenter({
    branchId: branchId || undefined,
  });

  const visible = useMemo(
    () => filterBySource(filterByPoNumber(products, debouncedSearch), source),
    [products, debouncedSearch, source],
  );
  // only rows that can be rejected are selectable — a repossessed device has no supplier to send it back to
  const selectableIds = useMemo(() => visible.filter(canRejectFromQueue).map((p) => p.id), [visible]);
  const checkState = headerCheckState(selectableIds, selected);
  const selectedVisible = selectableIds.filter((id) => selected.has(id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected((prev) => {
      if (checkState === 'all') {
        const next = new Set(prev);
        selectableIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...selectableIds]);
    });
  const clearSelection = () => setSelected(new Set());

  const onRejectConfirm = () => {
    if (selectedVisible.length === 0) return;
    if (!rejectReason.trim()) {
      toast.error('กรุณาระบุเหตุผลที่ไม่รับเข้าคลัง');
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

  const selectCls =
    'px-3 py-2 text-sm rounded-lg border border-input bg-background leading-snug focus:outline-none focus:ring-2 focus:ring-ring';

  return (
    <div className="pb-24">
      <PageHeader
        title="รอถ่ายรูป"
        subtitle="มือถือมือสองทุกทาง จาก PO · รับซื้อมือสอง · ยึดเครื่องคืน ต้องถ่ายรูป 6 มุมก่อนขึ้นขาย · มือถือใหม่และอุปกรณ์เสริมเข้าคลังพร้อมขายตั้งแต่ตอนรับของ ไม่ผ่านหน้านี้"
        icon={<Camera className="size-5" />}
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
            placeholder="ค้นหาเลข PO / เลขสัญญา / ชื่อสินค้า / IMEI"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-input bg-background leading-snug focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        {canPickBranch && (
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={selectCls} aria-label="สาขา">
            <option value="">ทุกสาขา</option>
            {(branches ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as QcSource | '')}
          className={selectCls}
          aria-label="ที่มา"
        >
          {SOURCE_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <QueryBoundary
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดคิวรอถ่ายรูปได้"
      >
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Camera className="size-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-foreground leading-snug">ไม่มีเครื่องรอถ่ายรูป</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-md leading-snug">
              {debouncedSearch || branchId || source
                ? 'ลองล้างตัวกรอง'
                : 'มือสองที่ถ่ายครบ 6 มุมตั้งแต่ตอนรับสินค้าจะเข้าคลังพร้อมขายเลย ไม่ผ่านหน้านี้'}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {/* Header row (select-all) */}
            <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-muted/40">
              <Checkbox
                checked={checkState === 'all' ? true : checkState === 'some' ? 'indeterminate' : false}
                onCheckedChange={toggleAll}
                disabled={selectableIds.length === 0}
                aria-label="เลือกทั้งหมด"
              />
              <span className="text-xs font-semibold text-muted-foreground leading-snug">
                {selectedVisible.length > 0 ? `เลือก ${selectedVisible.length} ชิ้น` : `${visible.length} รายการ`}
              </span>
              <span className="ml-auto text-xs text-muted-foreground leading-snug">เรียงจากรับเข้าล่าสุด</span>
            </div>

            <ul className="divide-y divide-border">
              {visible.map((p) => {
                const rejectable = canRejectFromQueue(p);
                const checked = rejectable && selected.has(p.id);
                const ref = p.source === 'REPOSSESSION' ? p.repossession?.contractNumber : p.po?.poNumber;
                const party =
                  p.source === 'REPOSSESSION' ? 'เครื่องยึดคืนจากสัญญา' : p.supplier?.name;
                return (
                  <li
                    key={p.id}
                    className={`flex ${isMobile ? 'flex-col' : 'items-center'} gap-3 px-4 py-3 ${checked ? 'bg-primary/5' : ''}`}
                  >
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggle(p.id)}
                        disabled={!rejectable}
                        aria-label={`เลือก ${p.name}`}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-foreground truncate leading-snug">{p.name}</p>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold leading-snug ${sourceClasses[p.source] ?? sourceClasses.OTHER}`}
                          >
                            {sourceLabels[p.source] ?? sourceLabels.OTHER}
                          </span>
                          {p.photos.length > 0 && (
                            <span
                              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
                              title="รูปหลักฐานจากตอนรับ (ไม่ใช่รูป 6 มุม)"
                            >
                              <ImageIcon className="size-3" />
                              {p.photos.length}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                          {p.imeiSerial ? `IMEI: ${p.imeiSerial}` : 'ไม่มี IMEI'}
                          {ref ? ` · ${ref}` : ''}
                          {p.branch?.name ? ` · ${p.branch.name}` : ''}
                        </p>
                        <p className="text-[11px] text-muted-foreground/80 mt-0.5 leading-snug">
                          {party ? `${party} · ` : ''}
                          {p.source === 'REPOSSESSION' ? 'พร้อมขายเมื่อ ' : 'รับเข้า '}
                          {formatDateTime(p.createdAt)}
                        </p>
                      </div>
                    </div>
                    <div className={`flex items-center gap-3 ${isMobile ? 'w-full flex-wrap' : 'shrink-0'}`}>
                      <AngleDots shot={p.photoAngles} />
                      <div className={`flex gap-2 ${isMobile ? 'w-full' : ''}`}>
                        <button
                          onClick={() => navigate(`/products/${p.id}`)}
                          title="ถ่ายรูป 6 มุมที่หน้ารายละเอียดสินค้า — ครบแล้วกดยืนยันรูป เครื่องจะขึ้นขายเอง"
                          className={`inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors ${isMobile ? 'flex-1' : ''}`}
                        >
                          <Camera className="size-3.5" /> {primaryActionLabel(p)}
                        </button>
                        {rejectable && (
                          <button
                            onClick={() => {
                              setSelected(new Set([p.id]));
                              setRejectOpen(true);
                            }}
                            className={`inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors ${isMobile ? 'flex-1' : ''}`}
                          >
                            <X className="size-3.5" /> ไม่รับเข้าคลัง
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </QueryBoundary>

      {/* Sticky bulk action bar — reject only (the QC confirm is gone) */}
      {selectedVisible.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 lg:left-[var(--sidebar-w,264px)] z-30 border-t border-border bg-card/95 backdrop-blur px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-foreground leading-snug">เลือก {selectedVisible.length} ชิ้น</span>
          <div className="flex gap-2">
            <button
              onClick={clearSelection}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border border-border hover:bg-muted transition-colors"
            >
              ยกเลิกการเลือก
            </button>
            <button
              onClick={() => setRejectOpen(true)}
              disabled={rejectMutation.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
            >
              <X className="size-4" /> ไม่รับเข้าคลัง {selectedVisible.length} ชิ้น
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
        title={`ไม่รับเข้าคลัง (${selectedVisible.length} ชิ้น)`}
        description="ระบุเหตุผลที่ไม่ผ่าน — สินค้าจะถูกตัดออกจากคลัง"
        variant="destructive"
        confirmLabel="บันทึกไม่รับเข้าคลัง"
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
