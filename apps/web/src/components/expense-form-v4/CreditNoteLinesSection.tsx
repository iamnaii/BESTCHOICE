import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Search, FileText, AlertCircle, Link2, FilePlus2 } from 'lucide-react';
import { ExpenseFormState, ExpenseLineForm } from './types';
import { ItemLinesSection } from './ItemLinesSection';
import { formatNumberDecimal } from '@/utils/formatters';

interface OriginalDoc {
  id: string;
  number: string;
  vendorName: string | null;
  totalAmount: string;
  status: string;
  documentDate: string;
  expenseDetail: { lines: { category: string; amountBeforeVat: string }[] } | null;
  branch: { id: string; name: string };
}

interface Props {
  state: ExpenseFormState;
  onChange: (patch: Partial<ExpenseFormState>) => void;
  onLinesChange: (lines: ExpenseLineForm[]) => void;
}

/**
 * C4 · 2-Mode CN section. Mockup v5 page 02D.
 *
 * Mode LINKED (default) — pick source EX, auto-load lines, cap-capped by server.
 * Mode STANDALONE — free-form supplier + free-form lines, no source FK.
 */
export function CreditNoteLinesSection({ state, onChange, onLinesChange }: Props) {
  const [search, setSearch] = useState('');
  const isStandalone = state.cnMode === 'STANDALONE';

  const { data: searchResults } = useQuery<{ data: OriginalDoc[] }>({
    queryKey: ['cn-search', search, state.branchId],
    queryFn: async () => {
      if (!search.trim()) return { data: [] };
      const { data } = await api.get(
        `/expense-documents?type=EXPENSE&search=${encodeURIComponent(search)}&limit=10`,
      );
      return data;
    },
    enabled: !isStandalone && search.trim().length >= 3,
  });

  const selectedDoc = searchResults?.data.find((d) => d.id === state.originalDocumentId);

  const { data: capInfo } = useQuery<{
    originalTotal: string;
    usedTotal: string;
    remainingCap: string;
  }>({
    queryKey: ['cn-cap', state.originalDocumentId],
    queryFn: async () => {
      const { data } = await api.get(`/expense-documents/${state.originalDocumentId}/cn-cap`);
      return data;
    },
    enabled: !isStandalone && !!state.originalDocumentId,
  });

  // Compute totals to check cap (LINKED only)
  const lineTotal = state.lines
    .filter((l) => l.category && parseFloat(l.unitPrice) > 0)
    .reduce((s, l) => {
      const q = parseFloat(l.quantity) || 1;
      const u = parseFloat(l.unitPrice) || 0;
      const d = parseFloat(l.discount) || 0;
      return s + Math.max(0, q * u - d);
    }, 0);
  const remaining = capInfo ? parseFloat(capInfo.remainingCap) : Infinity;
  const exceedsCap = !isStandalone && !!capInfo && lineTotal > remaining;

  const switchMode = (mode: 'LINKED' | 'STANDALONE') => {
    if (state.cnMode === mode) return;
    onChange({
      cnMode: mode,
      // Switching modes wipes the cross-mode-specific fields so server validation
      // doesn't see stale values from the other branch.
      originalDocumentId: '',
      vendorName: mode === 'STANDALONE' ? state.vendorName : '',
      vendorTaxId: mode === 'STANDALONE' ? state.vendorTaxId : '',
    });
    setSearch('');
  };

  return (
    <div className="space-y-4">
      {/* C4.1 — Mode selector (radio-style chip cards) */}
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-2">โหมดใบลดหนี้</div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => switchMode('LINKED')}
            className={`flex items-start gap-2 rounded-lg border p-3 text-left transition ${
              !isStandalone
                ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
                : 'border-border bg-card hover:bg-accent'
            }`}
            aria-pressed={!isStandalone}
          >
            <Link2 className={`size-4 mt-0.5 ${!isStandalone ? 'text-primary' : 'text-muted-foreground'}`} />
            <div className="space-y-0.5">
              <div className="text-sm font-medium">อ้างอิงใบเดิม</div>
              <div className="text-xs text-muted-foreground leading-snug">
                ลด/คืนจากเอกสาร EX ต้นทาง · ภ.30 link อัตโนมัติ
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => switchMode('STANDALONE')}
            className={`flex items-start gap-2 rounded-lg border p-3 text-left transition ${
              isStandalone
                ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
                : 'border-border bg-card hover:bg-accent'
            }`}
            aria-pressed={isStandalone}
          >
            <FilePlus2 className={`size-4 mt-0.5 ${isStandalone ? 'text-primary' : 'text-muted-foreground'}`} />
            <div className="space-y-0.5">
              <div className="text-sm font-medium">Standalone (ไม่มีใบเดิม)</div>
              <div className="text-xs text-muted-foreground leading-snug">
                ผู้ขายคืนเงินโดยไม่มีใบกำกับเดิม · ระบุผู้ขายเอง
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* LINKED — source doc picker */}
      {!isStandalone && (
        <div className="rounded-xl border border-border bg-card">
          <div className="px-4 py-2 border-b border-border flex items-center gap-2">
            <FileText className="size-4 text-primary" />
            <span className="text-sm font-medium">เอกสารต้นฉบับ</span>
            <span className="text-xs text-muted-foreground ml-1">
              เลือกเอกสาร EX ที่ต้องการลดหนี้
            </span>
          </div>
          <div className="p-4 space-y-3">
            {state.originalDocumentId && selectedDoc ? (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 flex items-center justify-between">
                <div>
                  <div className="font-mono text-sm">{selectedDoc.number}</div>
                  <div className="text-sm">
                    {selectedDoc.vendorName ?? '—'} · ยอด{' '}
                    {formatNumberDecimal(selectedDoc.totalAmount)} ฿
                  </div>
                  {capInfo && (
                    <div className="text-xs text-muted-foreground mt-1">
                      เหลือลดได้: {formatNumberDecimal(capInfo.remainingCap)} ฿ (ใช้ไปแล้ว{' '}
                      {formatNumberDecimal(capInfo.usedTotal)} ฿)
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onChange({ originalDocumentId: '' });
                    setSearch('');
                  }}
                  className="text-xs text-destructive hover:underline"
                >
                  เปลี่ยน
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="ค้นหาเลข EX-... / ผู้ขาย (3 ตัวขึ้นไป)"
                    className="w-full pl-10 pr-3 py-2 border border-input rounded-lg text-sm bg-background"
                  />
                </div>
                {(searchResults?.data ?? []).length > 0 && (
                  <div className="rounded-lg border border-border max-h-48 overflow-y-auto">
                    {searchResults!.data
                      .filter((d) => ['POSTED', 'ACCRUAL'].includes(d.status))
                      .map((doc) => (
                        <button
                          type="button"
                          key={doc.id}
                          onClick={() => {
                            onChange({ originalDocumentId: doc.id });
                            // Pre-populate CN lines from original doc if available
                            const sourceLines = doc.expenseDetail?.lines ?? [];
                            if (sourceLines.length > 0) {
                              onLinesChange(
                                sourceLines.map((l, idx) => ({
                                  uid: `cn-${idx}-${Math.random().toString(36).slice(2)}`,
                                  category: l.category,
                                  description: '',
                                  quantity: '1',
                                  unitPrice: l.amountBeforeVat,
                                  discount: '0',
                                  vatPercent: '7',
                                  whtPercent: '0',
                                })),
                              );
                            }
                          }}
                          className="w-full flex items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent border-b border-border last:border-b-0"
                        >
                          <div>
                            <div className="font-mono">{doc.number}</div>
                            <div className="text-xs text-muted-foreground">
                              {doc.vendorName ?? '—'} · {doc.status}
                            </div>
                          </div>
                          <div className="font-mono text-sm">
                            {formatNumberDecimal(doc.totalAmount)}
                          </div>
                        </button>
                      ))}
                  </div>
                )}
              </>
            )}

            <div>
              <label className="block text-xs font-medium mb-1">
                เหตุผลลดหนี้ <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={state.cnReason}
                onChange={(e) => onChange({ cnReason: e.target.value })}
                placeholder="เช่น สินค้าคืน, ปรับราคา, ส่วนลดหลังการขาย"
                className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
              />
            </div>
          </div>
        </div>
      )}

      {/* STANDALONE — vendor inputs + reason */}
      {isStandalone && (
        <div className="rounded-xl border border-border bg-card">
          <div className="px-4 py-2 border-b border-border flex items-center gap-2">
            <FilePlus2 className="size-4 text-primary" />
            <span className="text-sm font-medium">ข้อมูลผู้ขาย</span>
            <span className="text-xs text-muted-foreground ml-1">
              ระบุเอง — ไม่มีเอกสารต้นฉบับ
            </span>
          </div>
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">
                  ชื่อผู้ขาย <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={state.vendorName}
                  onChange={(e) => onChange({ vendorName: e.target.value })}
                  placeholder="เช่น บจก. แอลฟ่า เซอร์วิส"
                  maxLength={255}
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  เลขผู้เสียภาษี (ทางเลือก)
                </label>
                <input
                  type="text"
                  value={state.vendorTaxId}
                  onChange={(e) => onChange({ vendorTaxId: e.target.value })}
                  placeholder="13 หลัก"
                  maxLength={20}
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">
                เหตุผลลดหนี้ <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={state.cnReason}
                onChange={(e) => onChange({ cnReason: e.target.value })}
                placeholder="เช่น คืนเงินมัดจำ, ส่วนลดพิเศษ, ปรับยอด AP"
                className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
              />
            </div>

            <div className="rounded-lg border border-warning/30 bg-warning/5 p-2 text-xs text-warning flex items-start gap-2">
              <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
              <span>
                ใบลดหนี้แบบ Standalone ไม่ถูก cap ด้วยยอดของเอกสารต้นฉบับ
                — โปรดตรวจสอบยอดให้ถูกต้องก่อนกด POST
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Credit lines — shown for STANDALONE always, LINKED only after source picked */}
      {(isStandalone || state.originalDocumentId) && (
        <div>
          <div className="text-xs text-muted-foreground mb-2">รายการที่จะลด</div>
          <ItemLinesSection
            lines={state.lines}
            onChange={onLinesChange}
            priceTypeLabel={state.priceType === 'INCLUSIVE' ? 'ราคารวม VAT' : 'ราคาไม่รวม VAT'}
          />
          {exceedsCap && (
            <div className="flex items-start gap-2 text-destructive text-sm mt-2">
              <AlertCircle className="size-4 mt-0.5 shrink-0" />
              <span>ยอดรายการเกินที่ลดได้สูงสุด {formatNumberDecimal(remaining)} ฿</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
