import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Search, FileText, AlertCircle } from 'lucide-react';
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

export function CreditNoteLinesSection({ state, onChange, onLinesChange }: Props) {
  const [search, setSearch] = useState('');

  const { data: searchResults } = useQuery<{ data: OriginalDoc[] }>({
    queryKey: ['cn-search', search, state.branchId],
    queryFn: async () => {
      if (!search.trim()) return { data: [] };
      const { data } = await api.get(
        `/expense-documents?type=EXPENSE&search=${encodeURIComponent(search)}&limit=10`,
      );
      return data;
    },
    enabled: search.trim().length >= 3,
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
    enabled: !!state.originalDocumentId,
  });

  // Compute totals to check cap
  const lineTotal = state.lines
    .filter((l) => l.category && parseFloat(l.unitPrice) > 0)
    .reduce((s, l) => {
      const q = parseFloat(l.quantity) || 1;
      const u = parseFloat(l.unitPrice) || 0;
      const d = parseFloat(l.discount) || 0;
      return s + Math.max(0, q * u - d);
    }, 0);
  const remaining = capInfo ? parseFloat(capInfo.remainingCap) : Infinity;
  const exceedsCap = !!capInfo && lineTotal > remaining;

  return (
    <div className="space-y-4">
      {/* Original document picker */}
      <div className="rounded-xl border border-border bg-card">
        <div className="px-4 py-2 border-b border-border flex items-center gap-2">
          <FileText className="size-4 text-primary" />
          <span className="text-sm font-medium">เอกสารต้นฉบับ</span>
          <span className="text-xs text-muted-foreground ml-1">เลือกเอกสาร EX ที่ต้องการลดหนี้</span>
        </div>
        <div className="p-4 space-y-3">
          {state.originalDocumentId && selectedDoc ? (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 flex items-center justify-between">
              <div>
                <div className="font-mono text-sm">{selectedDoc.number}</div>
                <div className="text-sm">
                  {selectedDoc.vendorName ?? '—'} · ยอด {formatNumberDecimal(selectedDoc.totalAmount)} ฿
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
                        <div className="font-mono text-sm">{formatNumberDecimal(doc.totalAmount)}</div>
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

      {/* Credit lines — only shown when original doc selected */}
      {state.originalDocumentId && (
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
