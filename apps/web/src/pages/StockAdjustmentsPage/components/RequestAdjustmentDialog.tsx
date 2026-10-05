import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Search, X } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import Modal from '@/components/ui/Modal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getStatusBadgeProps, productStatusMap } from '@/lib/status-badges';
import type { AdjustmentReason, ProductLookupRow, StockAdjustmentRow } from '../types';
import {
  NOTES_MAX,
  REASON_OPTIONS,
  buildRequestFormData,
  deviceLabel,
  formatBaht,
  reasonOption,
  requestFormErrors,
} from '../stock-adjustment.util';
import { useAdjustmentMutations, useAdjustmentPreview, useProductLookup } from '../hooks/useStockAdjustments';
import JournalPreviewBox from './JournalPreviewBox';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (row: StockAdjustmentRow) => void;
  /** เปิดจากหน้าสินค้า — ข้ามขั้นค้นเครื่อง */
  initialProduct?: ProductLookupRow | null;
}

const MAX_PHOTOS = 6;
const INPUT_CLS =
  'w-full px-3 py-2 border border-input rounded-lg text-sm bg-background focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';

/** ฟอร์มคำขอตัดสินค้า (ก้อน 3): ค้นเครื่อง → เหตุผล → รูป (บังคับเมื่อเสียหาย) → หมายเหตุ → preview บัญชี → ส่งให้เจ้าของอนุมัติ */
export default function RequestAdjustmentDialog({ open, onClose, onCreated, initialProduct = null }: Props) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [product, setProduct] = useState<ProductLookupRow | null>(initialProduct);
  const [reason, setReason] = useState<AdjustmentReason | ''>('');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const { createRequest } = useAdjustmentMutations();

  useEffect(() => {
    if (open) {
      setProduct(initialProduct);
      setSearch('');
      setReason('');
      setNotes('');
      setFiles([]);
    }
  }, [open, initialProduct]);

  const isImei = /^\d{6,}$/.test(debouncedSearch.trim());
  const lookup = useProductLookup(
    isImei ? { imei: debouncedSearch.trim() } : { search: debouncedSearch.trim() },
    reason,
    open && !product,
  );
  const preview = useAdjustmentPreview(product?.id ?? null, reason);
  const option = reasonOption(reason);
  const errors = useMemo(
    () => requestFormErrors({ productId: product?.id ?? '', reason, photoCount: files.length, notes }),
    [product, reason, files.length, notes],
  );
  const previewHolds = preview.data?.holdsProduct ?? option?.holdsProduct ?? false;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (errors.length || !product) return;
    createRequest.mutate(buildRequestFormData({ productId: product.id, reason, photoCount: files.length, notes }, files), {
      onSuccess: (row) => {
        onCreated?.(row);
        onClose();
      },
    });
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files, ...Array.from(list)].slice(0, MAX_PHOTOS);
    setFiles(next);
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="ขอตัดสินค้า" size="lg">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-xs text-muted-foreground leading-snug">
          คำขอจะส่งให้เจ้าของพิจารณา — เหตุผล สูญหาย / เสียหาย / ตัดจำหน่าย จะพักขายเครื่องทันทีจนกว่าเจ้าของจะอนุมัติหรือไม่อนุมัติ
        </p>

        {/* 1. เครื่อง */}
        <div>
          <label htmlFor="sa-search" className="block text-sm font-medium text-foreground mb-1">
            เครื่อง
          </label>
          {product ? (
            <div className="rounded-lg border border-border p-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm leading-snug">{deviceLabel(product)}</div>
                <div className="text-xs text-muted-foreground leading-snug mt-0.5">
                  {product.name} · {product.branch.name} · ต้นทุน {formatBaht(product.costPrice)}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  {(() => {
                    const cfg = getStatusBadgeProps(product.status, productStatusMap);
                    return (
                      <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">
                        {cfg.label}
                      </Badge>
                    );
                  })()}
                  {product.deletedAt && <span className="text-xs text-muted-foreground">ถูกลบออกจากระบบแล้ว</span>}
                  {product.pendingRequestNumber && (
                    <span className="text-xs text-warning-strong leading-snug">มีคำขอ {product.pendingRequestNumber} รออนุมัติอยู่</span>
                  )}
                </div>
              </div>
              {!initialProduct && (
                <button type="button" onClick={() => setProduct(null)} className="text-muted-foreground hover:text-foreground" aria-label="เปลี่ยนเครื่อง">
                  <X className="size-4" />
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="sa-search"
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className={`${INPUT_CLS} pl-9`}
                  placeholder="พิมพ์ IMEI / Serial หรือชื่อรุ่น"
                  autoFocus
                />
              </div>
              {debouncedSearch.trim().length >= 2 && (
                <div className="mt-1 border border-border rounded-lg max-h-48 overflow-y-auto">
                  {lookup.isLoading ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">กำลังค้นหา...</div>
                  ) : lookup.data && lookup.data.length > 0 ? (
                    lookup.data.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setProduct(p)}
                        className="w-full text-left px-3 py-2 hover:bg-accent text-sm border-b border-border/60 last:border-0"
                      >
                        <span className="font-medium">
                          {p.brand} {p.model}
                        </span>
                        {p.imeiSerial && <span className="text-xs text-muted-foreground ml-2 font-mono">{p.imeiSerial}</span>}
                        <span className="text-xs text-muted-foreground ml-2">
                          {getStatusBadgeProps(p.status, productStatusMap).label} · {p.branch.name}
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-xs text-muted-foreground leading-snug">
                      ไม่พบเครื่องในสาขาของคุณ — เหตุผล "พบของคืน" ค้นได้เฉพาะเครื่องที่หาย/เสียหาย/ตัดจำหน่าย (เลือกเหตุผลก่อนค้น)
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* 2. เหตุผล */}
        <fieldset>
          <legend className="block text-sm font-medium text-foreground mb-1">เหตุผล</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {REASON_OPTIONS.map((o) => (
              <label
                key={o.value}
                className={`flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer ${
                  reason === o.value ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'
                }`}
              >
                <input
                  type="radio"
                  name="sa-reason"
                  value={o.value}
                  checked={reason === o.value}
                  onChange={() => setReason(o.value)}
                  className="mt-1"
                  aria-label={o.label}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-snug">{o.label}</span>
                  <span className="block text-xs text-muted-foreground leading-snug">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* 3. รูปหลักฐาน */}
        <div>
          <label htmlFor="sa-photos" className="block text-sm font-medium text-foreground mb-1">
            รูปหลักฐาน {option?.requiresPhoto ? <span className="text-destructive">*</span> : <span className="text-muted-foreground font-normal">(ไม่บังคับ)</span>}
          </label>
          <input
            id="sa-photos"
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(e) => addFiles(e.target.files)}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-accent"
          />
          <div className="mt-1 text-xs text-muted-foreground leading-snug">
            JPEG / PNG / WebP ไม่เกิน 5MB ต่อรูป สูงสุด {MAX_PHOTOS} รูป
            {option?.requiresPhoto && files.length === 0 && (
              <span className="text-warning-strong"> — เหตุผล "เสียหาย" ต้องแนบรูปอย่างน้อย 1 รูป</span>
            )}
          </div>
          {files.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">
                  <span className="max-w-[160px] truncate">{f.name}</span>
                  <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`ลบรูป ${f.name}`} className="text-muted-foreground hover:text-foreground">
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 4. หมายเหตุ */}
        <div>
          <label htmlFor="sa-notes" className="block text-sm font-medium text-foreground mb-1">
            หมายเหตุ
          </label>
          <textarea
            id="sa-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={NOTES_MAX}
            className={INPUT_CLS}
            placeholder="เช่น หาไม่พบตอนนับสต๊อกวันที่ 5 ต.ค."
          />
        </div>

        {/* 5. ผลเมื่ออนุมัติ */}
        {product && reason && (
          <>
            <JournalPreviewBox preview={preview.data} isLoading={preview.isLoading} />
            {previewHolds && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning-strong leading-snug">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <span>ส่งคำขอแล้วเครื่องนี้จะถูกพักขายทันที (ขาย/จอง/โอนไม่ได้) จนกว่าเจ้าของจะพิจารณา</span>
              </div>
            )}
          </>
        )}

        {errors.length > 0 && product && reason && (
          <ul className="text-xs text-destructive leading-snug list-disc pl-4">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            ปิด
          </Button>
          <Button type="submit" disabled={errors.length > 0 || createRequest.isPending}>
            {createRequest.isPending ? 'กำลังส่ง...' : 'ส่งคำขอ'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
