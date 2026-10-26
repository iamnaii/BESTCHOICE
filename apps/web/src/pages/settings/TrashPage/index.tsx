import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Search, Trash2 } from 'lucide-react';
import { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import {
  trashRowKey,
  useRestoreTrash,
  useRestoreTrashBulk,
  useTrashList,
  useTrashTypes,
  type TrashBulkResultItem,
  type TrashDays,
  type TrashRow,
} from '@/hooks/useTrash';
import TypeChips from './components/TypeChips';
import TrashRows from './components/TrashRows';
import RestoreConfirmDialog, { type RestoreTarget } from './components/RestoreConfirmDialog';
import BulkResultDialog from './components/BulkResultDialog';

/**
 * ตั้งค่า › ระบบ & ความปลอดภัย › ถังขยะ (ก้อน 8 · A10 · mockup กระดาน 1–2) — OWNER เท่านั้น (settings-registry)
 * ของที่ถูก soft-delete ตาม allow-list ของ API · กู้คืนทีละรายการหรือหลายรายการ · ไม่มีการลบถาวร
 */

const RANGES: Array<{ days: TrashDays; label: string }> = [
  { days: 30, label: '30 วัน' },
  { days: 90, label: '90 วัน' },
  { days: 0, label: 'ทั้งหมด' },
];
const PAGE_SIZE = 50;
const SEG = 'min-h-11 lg:min-h-9 px-3 text-sm border border-input first:rounded-l-lg last:rounded-r-lg -ml-px first:ml-0';

export default function TrashPage() {
  useDocumentTitle('ถังขยะ');
  const navigate = useNavigate();
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 300);
  const [days, setDays] = useState<TrashDays>(90);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<RestoreTarget | null>(null);
  const [bulkResults, setBulkResults] = useState<TrashBulkResultItem[] | null>(null);

  const types = useTrashTypes(days);
  const list = useTrashList({ type, q, days, page, pageSize: PAGE_SIZE });
  const restore = useRestoreTrash();
  const restoreBulk = useRestoreTrashBulk();

  const rows = useMemo(() => list.data?.data ?? [], [list.data]);
  const rowsByKey = useMemo(() => new Map(rows.map((r) => [trashRowKey(r), r])), [rows]);
  const selectedRows = useMemo(() => [...selected].map((k) => rowsByKey.get(k)).filter((r): r is TrashRow => !!r && r.restorable), [selected, rowsByKey]);
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  const reset = () => {
    setPage(1);
    setSelected(new Set());
  };
  const changeType = (next: string) => {
    setType(next);
    reset();
  };
  const changeDays = (next: TrashDays) => {
    setDays(next);
    reset();
  };

  const toggle = (row: TrashRow, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(trashRowKey(row));
      else next.delete(trashRowKey(row));
      return next;
    });
  const toggleAll = (checked: boolean) => setSelected(checked ? new Set(rows.filter((r) => r.restorable).map(trashRowKey)) : new Set());

  const confirm = () => {
    if (!target) return;
    if (target.kind === 'single') {
      const row = target.row;
      restore.mutate(row, {
        onSuccess: (res) => {
          setTarget(null);
          const link = res.link ?? row.link;
          toast.success(`กู้คืน "${row.title}" แล้ว`, link ? { action: { label: 'เปิด', onClick: () => navigate(link) } } : undefined);
          for (const w of res.warnings ?? []) toast.warning(w);
          setSelected((prev) => {
            const next = new Set(prev);
            next.delete(trashRowKey(row));
            return next;
          });
        },
        onError: (err: unknown) => toast.error(getErrorMessage(err)),
      });
      return;
    }
    restoreBulk.mutate(target.rows, {
      onSuccess: (res) => {
        setTarget(null);
        setSelected(new Set());
        setBulkResults(res.results);
      },
      onError: (err: unknown) => toast.error(getErrorMessage(err)),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="ถังขยะ" subtitle="ของที่ถูกลบ กู้คืนได้ที่นี่ · เฉพาะเจ้าของ · ไม่มีการลบถาวร" icon={<Trash2 className="size-5" aria-hidden="true" />} />

      <TypeChips types={types.data ?? []} value={type} onChange={changeType} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            aria-label="ค้นหา"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="ค้นหาชื่อ / เลขที่ / เบอร์"
            className="h-11 lg:h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </div>
        <div className="flex" role="group" aria-label="ช่วงเวลาที่ลบ">
          {RANGES.map((r) => (
            <button key={r.days} type="button" data-ui-control="button" aria-pressed={days === r.days} onClick={() => changeDays(r.days)} className={`${SEG} ${days === r.days ? 'bg-primary/10 text-primary border-primary/40 relative z-10' : 'bg-background text-foreground hover:bg-muted'}`}>
              {r.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">ลบโดย = จากประวัติการดำเนินการ (ลบด้วยสคริปต์/ระบบ = ไม่ทราบ)</span>
      </div>

      <QueryBoundary isLoading={list.isLoading && !list.data} isError={list.isError} error={list.error} onRetry={list.refetch} errorTitle="โหลดถังขยะไม่สำเร็จ">
        {list.data && (
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                <Trash2 className="size-10 text-muted-foreground/60" aria-hidden="true" />
                <div className="font-semibold">{days === 0 ? 'ไม่มีของที่ถูกลบ' : `ไม่มีของที่ถูกลบในช่วง ${days} วันล่าสุด`}</div>
                <div className="text-sm text-muted-foreground">ของที่ลบก่อนหน้านั้นยังอยู่ — ไม่มีการลบถาวร</div>
                {days !== 0 && (
                  <Button variant="outline" size="sm" onClick={() => changeDays(0)}>ดูทั้งหมด</Button>
                )}
              </div>
            ) : (
              <>
                <TrashRows rows={rows} selected={selected} onToggle={toggle} onToggleAll={toggleAll} onRestore={(row) => setTarget({ kind: 'single', row })} />
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2 text-xs text-muted-foreground">
                  <span>
                    {list.data.capped ? 'เมื่อดูรวมทุกประเภท แสดงล่าสุด 50 รายการต่อประเภท — เลือกประเภทเพื่อดูทั้งหมด' : `ทั้งหมด ${list.data.total} รายการ`}
                  </span>
                  {totalPages > 1 && (
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>ก่อนหน้า</Button>
                      <span className="tabular-nums">หน้า {page} / {totalPages}</span>
                      <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>ถัดไป</Button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </QueryBoundary>

      {selectedRows.length > 0 && (
        <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 shadow-lg">
          <span className="text-sm font-medium text-primary">เลือก {selectedRows.length} รายการ — กู้ทีละรายการ รายการที่ล้มไม่หยุดรายการอื่น</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="max-lg:min-h-11" onClick={() => setSelected(new Set())}>ล้างการเลือก</Button>
            <Button size="sm" className="max-lg:min-h-11" onClick={() => setTarget({ kind: 'bulk', rows: selectedRows })}>{`กู้คืนที่เลือก (${selectedRows.length})`}</Button>
          </div>
        </div>
      )}

      <RestoreConfirmDialog target={target} loading={restore.isPending || restoreBulk.isPending} onConfirm={confirm} onCancel={() => setTarget(null)} />
      <BulkResultDialog results={bulkResults} rowsByKey={rowsByKey} onClose={() => setBulkResults(null)} />
    </div>
  );
}
