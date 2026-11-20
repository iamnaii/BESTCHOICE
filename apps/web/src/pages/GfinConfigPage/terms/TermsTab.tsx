import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, TriangleAlert, Upload } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { importFromExcel } from '@/utils/excel.util';
import { ImportBatchError } from '@/utils/excel-cell.util';
import { useGfinTables } from '@/pages/ProductDetailPage/hooks/useGfinTables';
import { GFIN_QUERY_KEYS } from '../gfinQueryKeys';
import { buildGfinImportReview, type GfinImportReview } from '../gfinPriceListImport';
import {
  buildImportTermsReview,
  buildRuleUpsertBatches,
  findMissingPrices,
  runGfinImport,
  type GfinImportSender,
  type ImportTermsReview,
  type MissingPrices,
  type RuleChange,
} from '../import/gfinImportTerms';
import { GfinImportDialog } from '../import/GfinImportDialog';
import { downloadGfinTemplate } from '../import/gfinTemplate';
import { CentralTermsCard } from './CentralTermsCard';
import { ModelTermsCards } from './ModelTermsCards';
import { ModelTermsTable } from './ModelTermsTable';
import { RuleEditDialog } from './RuleEditDialog';
import { SheetVersionCard } from './SheetVersionCard';
import {
  ALL_FAMILIES,
  HAND_LABEL,
  buildModelTermsView,
  filterFamilies,
  selectionSummary,
  type Hand,
  type ModelTermsFamily,
  type ModelTermsRow,
  type TermsFilter,
} from './modelTerms';

interface ImportState {
  fileName: string;
  prices: GfinImportReview;
  missing: MissingPrices;
  terms: ImportTermsReview;
}

const sender: GfinImportSender = {
  importPrices: async (body) => (await api.post('/gfin-config/max-prices/import', body)).data,
  closePrices: async (ids) => (await api.post('/gfin-config/max-prices/close', { ids })).data,
  upsertRules: async (body) => (await api.post('/gfin-config/overprice-rules/bulk-upsert', body)).data,
};

const Chip = (p: { pressed: boolean; onClick: () => void; children: string }) => (
  <Button variant={p.pressed ? 'primary' : 'outline'} size="sm" aria-pressed={p.pressed} onClick={p.onClick}>
    {p.children}
  </Button>
);

/** แท็บ "เงื่อนไข & ราคา" (สเปก §6.2) */
export function TermsTab() {
  const { user } = useAuth();
  const canEdit = user?.role === 'OWNER';
  const qc = useQueryClient();
  const { tables, isLoading, isError, retry } = useGfinTables();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = useMemo(() => (tables ? buildModelTermsView(tables) : null), [tables]);
  const [filter, setFilter] = useState<TermsFilter>({ search: '', family: ALL_FAMILIES, hand: 'ALL', onlyAttention: false });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editKeys, setEditKeys] = useState<string[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importState, setImportState] = useState<ImportState | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const editParam = canEdit ? searchParams.get('edit') : null;
  const editing = editKeys ?? (editParam ? [editParam] : null);
  const editRows: ModelTermsRow[] =
    view && editing ? editing.map((k) => view.rows.find((r) => r.key === k)).filter((r): r is ModelTermsRow => !!r) : [];

  const closeEdit = () => {
    setEditKeys(null);
    if (searchParams.has('edit')) {
      const next = new URLSearchParams(searchParams);
      next.delete('edit');
      setSearchParams(next, { replace: true });
    }
  };

  const runImport = useMutation({
    mutationFn: (d: { closeIds: string[]; changes: RuleChange[] }) =>
      runGfinImport(
        sender,
        { prices: importState!.prices.toSend, closeIds: d.closeIds, ruleBatches: buildRuleUpsertBatches(d.changes) },
        (done, total) => setProgress(`บันทึกแล้ว ${done}/${total} ชุด`),
        getErrorMessage,
      ),
    onSuccess: (out) => {
      toast.success(
        `นำเข้าใบราคาแล้ว — เพิ่ม ${out.prices.created} · แก้ ${out.prices.updated} · เท่าเดิม ${out.prices.unchanged} · ปิด ${out.closed} · เงื่อนไข ${out.rulesSaved} รุ่น`,
      );
      setImportState(null);
    },
    onError: (err) => toast.error(err instanceof ImportBatchError ? err.message : getErrorMessage(err)),
    onSettled: () => {
      setProgress(null);
      for (const key of Object.values(GFIN_QUERY_KEYS)) void qc.invalidateQueries({ queryKey: key });
    },
  });

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file || !tables) return;
    try {
      const rows = await importFromExcel(file);
      const prices = buildGfinImportReview(rows, tables.mappings);
      if (prices.rows.length === 0) {
        toast.error('ไม่พบข้อมูลที่ถูกต้อง กรุณาตรวจสอบหัวคอลัมน์ (รุ่น · ความจุ · มือ 1/มือ 2 · ราคา)');
        return;
      }
      setImportState({
        fileName: file.name,
        prices,
        missing: findMissingPrices(rows, tables.mappings),
        terms: buildImportTermsReview(rows, tables.mappings, tables.rules),
      });
    } catch {
      toast.error('ไม่สามารถอ่านไฟล์ได้ กรุณาใช้ไฟล์ .xlsx');
    }
  };

  if (isLoading) return <div className="p-4 text-muted-foreground leading-snug">กำลังโหลด...</div>;
  if (isError || !tables || !view)
    return (
      <div className="space-y-2 p-4">
        <p className="text-destructive leading-snug">โหลดข้อมูล GFIN ไม่สำเร็จ</p>
        <Button variant="outline" onClick={retry}>
          ลองใหม่
        </Button>
      </div>
    );

  const families = filterFamilies(view, filter);
  const familyKeys = view.families.map((f) => f.family);
  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };
  const selectFamilyHand = (fam: ModelTermsFamily, hand: Hand) =>
    setSelected((s) => {
      const next = new Set(s);
      for (const r of fam.rows) if (r.condition === hand) next.add(r.key);
      return next;
    });
  const selectedRows = view.rows.filter((r) => selected.has(r.key));
  const listProps = {
    families,
    storageColumns: view.storageColumns,
    selected,
    collapsed,
    canEdit,
    onToggleRow: (key: string) => setSelected((s) => toggle(s, key)),
    onSelectFamilyHand: selectFamilyHand,
    onToggleFamily: (family: string) => setCollapsed((s) => toggle(s, family)),
    onEdit: (keys: string[]) => setEditKeys(keys),
  };

  return (
    <div className="space-y-4">
      <SheetVersionCard settings={tables.settings} canEdit={canEdit} />
      <CentralTermsCard tables={tables} canEdit={canEdit} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold leading-snug">ราคาและเงื่อนไขรายรุ่น</h2>
            <p className="text-sm text-muted-foreground leading-snug">
              1 แถว = 1 รุ่น 1 สภาพ · ราคาส่ง GFIN = ราคาในตาราง + OVER ของแถวนั้น · กดราคาเพื่อแก้หรือปิด · ดาวน์ตัวหนา = ตั้งเฉพาะรุ่น ·
              สีเทา = ใช้ค่ากลาง · — = ไม่มีราคา (GFIN ไม่รับ)
            </p>
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => downloadGfinTemplate().catch(() => toast.error('สร้างไฟล์แบบฟอร์มไม่สำเร็จ กรุณาลองใหม่'))}>
                <Download className="size-4" aria-hidden="true" />
                ดาวน์โหลดแบบฟอร์ม
              </Button>
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={runImport.isPending}>
                <Upload className="size-4" aria-hidden="true" />
                นำเข้าใบราคาจาก GFIN (Excel)
              </Button>
              <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={onFile} />
            </div>
          )}
        </div>

        {view.needsRuleRows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
            <div className="flex items-start gap-2 text-sm text-warning-strong leading-snug">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-medium">
                  {view.needsRuleRows.length} แถวมีราคาแต่ยังไม่ตั้งเงื่อนไข —{' '}
                  {view.needsRuleRows.map((r) => `${r.series} ${HAND_LABEL[r.condition]}`).join(', ')}
                </p>
                <p>แถวนี้ยังคิดผ่อน GFIN ไม่ได้จนกว่าจะตั้ง · ตั้งเงื่อนไข หรือปิดราคาที่ GFIN ไม่รับแล้ว</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              aria-pressed={filter.onlyAttention}
              onClick={() => setFilter((f) => ({ ...f, onlyAttention: !f.onlyAttention }))}
            >
              ดูเฉพาะแถวที่ต้องดู
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="ค้นหารุ่น"
            placeholder="ค้นหารุ่น..."
            className="max-w-xs"
            value={filter.search}
            onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
          />
          <div className="flex flex-wrap gap-1" role="group" aria-label="ตระกูล">
            <Chip pressed={filter.family === ALL_FAMILIES} onClick={() => setFilter((f) => ({ ...f, family: ALL_FAMILIES }))}>
              ทั้งหมด
            </Chip>
            {familyKeys.map((fk) => (
              <Chip key={fk} pressed={filter.family === fk} onClick={() => setFilter((f) => ({ ...f, family: fk }))}>
                {view.families.find((f) => f.family === fk)!.label.replace(/^iPhone /, '')}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="สภาพ">
            <Chip pressed={filter.hand === 'ALL'} onClick={() => setFilter((f) => ({ ...f, hand: 'ALL' }))}>
              ทั้ง 2 มือ
            </Chip>
            <Chip pressed={filter.hand === 'HAND_1'} onClick={() => setFilter((f) => ({ ...f, hand: 'HAND_1' }))}>
              มือ 1
            </Chip>
            <Chip pressed={filter.hand === 'HAND_2'} onClick={() => setFilter((f) => ({ ...f, hand: 'HAND_2' }))}>
              มือ 2
            </Chip>
          </div>
        </div>

        {families.length === 0 ? (
          <p className="text-sm text-muted-foreground leading-snug">ไม่พบรุ่นที่ตรงกับตัวกรอง</p>
        ) : (
          <>
            <div className="hidden md:block" data-testid="terms-table">
              <ModelTermsTable {...listProps} />
            </div>
            <div className="md:hidden" data-testid="terms-cards">
              <ModelTermsCards {...listProps} />
            </div>
          </>
        )}

        {canEdit && selectedRows.length > 0 && (
          <div
            role="region"
            aria-label="แถวที่เลือก"
            className="sticky bottom-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-foreground px-4 py-2 text-background"
          >
            <span className="text-sm leading-snug">{selectionSummary(selectedRows)}</span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setEditKeys(selectedRows.map((r) => r.key))}>
                แก้เงื่อนไขพร้อมกัน
              </Button>
              <Button variant="ghost" size="sm" className="text-background hover:text-foreground" onClick={() => setSelected(new Set())}>
                ล้างที่เลือก
              </Button>
            </div>
          </div>
        )}
      </section>

      {canEdit && editRows.length > 0 && (
        <RuleEditDialog
          rows={editRows}
          tables={tables}
          onRemove={(key) => {
            const remaining = editRows.filter((r) => r.key !== key).map((r) => r.key);
            if (remaining.length === 0) closeEdit();
            else setEditKeys(remaining);
          }}
          onClose={() => {
            closeEdit();
            setSelected(new Set());
          }}
        />
      )}

      {importState && (
        <GfinImportDialog
          fileName={importState.fileName}
          prices={importState.prices}
          missing={importState.missing}
          terms={importState.terms}
          pending={runImport.isPending}
          progress={progress}
          onCancel={() => setImportState(null)}
          onConfirm={(d) => runImport.mutate(d)}
        />
      )}
    </div>
  );
}
