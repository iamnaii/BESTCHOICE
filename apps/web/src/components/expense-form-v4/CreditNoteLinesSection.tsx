import { useEffect, useId as useUiFieldId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Search, AlertCircle, Link2, FilePlus2 } from 'lucide-react';
import { ExpenseFormState, ExpenseLineForm } from './types';
import { ItemLinesSection } from './ItemLinesSection';
import { FormRow } from './layout/FormRow';
import { formControlClass, formLabelClass } from '@/components/ui/form-styles';
import { CashAccountSelect } from '@/components/CashAccountSelect';
import { formatNumberDecimal } from '@/utils/formatters';
import { cn } from '@/lib/utils';

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
 * คืน FormRow ของตัวเอง สูงสุดสามแถว (อ้างอิงเอกสาร / รายการที่จะลด / รับเงินคืนเข้า) — ผู้เรียกไม่ต้องห่อ FormRow
 */
export function CreditNoteLinesSection({ state, onChange, onLinesChange }: Props) {
  const uiFieldId = useUiFieldId();
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

  // เอกสารที่ผู้ใช้เลือกเก็บไว้เอง — ผลค้นหาโหลดใหม่ (กลับมาที่หน้าต่าง) แล้วไม่มีเอกสารนั้น การ์ดและแถว "รับเงินคืนเข้า" ต้องไม่หาย
  const [pickedDoc, setPickedDoc] = useState<OriginalDoc | null>(null);
  const selectedDoc =
    pickedDoc && pickedDoc.id === state.originalDocumentId
      ? pickedDoc
      : searchResults?.data.find((d) => d.id === state.originalDocumentId);

  // ปุ่มที่ผู้ใช้กดหายไปหลังเลือก/เปลี่ยนเอกสาร — ย้ายโฟกัสไปที่สิ่งที่เพิ่งขึ้นมา ไม่ให้หลุดไปที่ body
  const selectedCardRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const focusAfterRender = useRef<'selected' | 'search' | null>(null);
  useEffect(() => {
    const target =
      focusAfterRender.current === 'selected'
        ? selectedCardRef.current
        : focusAfterRender.current === 'search'
          ? searchInputRef.current
          : null;
    if (!target) return;
    focusAfterRender.current = null;
    target.focus();
  });

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
    setPickedDoc(null);
  };

  const validCount = state.lines.filter((l) => l.category && parseFloat(l.unitPrice) > 0).length;
  const referenceComplete =
    !!state.cnReason.trim() && (isStandalone ? !!state.vendorName.trim() : !!state.originalDocumentId);
  const modeCard = (active: boolean) =>
    cn(
      'flex min-h-11 items-start gap-2 rounded-lg border p-3 text-left transition',
      active ? 'border-primary bg-primary/5 ring-1 ring-primary/40' : 'border-border bg-card hover:bg-accent',
    );

  return (
    <>
      <FormRow title="อ้างอิงเอกสาร" complete={referenceComplete}>
        <div className="space-y-4">
          {/* C4.1 — เลือกโหมด */}
          <div role="group" aria-labelledby={`${uiFieldId}-mode`}>
            <span id={`${uiFieldId}-mode`} className={formLabelClass}>โหมดใบลดหนี้</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => switchMode('LINKED')} className={modeCard(!isStandalone)} aria-pressed={!isStandalone}>
                <Link2 className={cn('mt-0.5 size-4 shrink-0', !isStandalone ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />
                <div className="space-y-0.5">
                  <div className="text-sm font-medium leading-snug">อ้างอิงใบเดิม</div>
                  <div className="text-xs leading-snug text-muted-foreground">
                    ลด/คืนจากเอกสาร EX ต้นทาง · ภ.30 link อัตโนมัติ
                  </div>
                </div>
              </button>
              <button type="button" onClick={() => switchMode('STANDALONE')} className={modeCard(isStandalone)} aria-pressed={isStandalone}>
                <FilePlus2 className={cn('mt-0.5 size-4 shrink-0', isStandalone ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />
                <div className="space-y-0.5">
                  <div className="text-sm font-medium leading-snug">ไม่มีเอกสารต้นทาง</div>
                  <div className="text-xs leading-snug text-muted-foreground">
                    ผู้ขายคืนเงินโดยไม่มีใบกำกับเดิม · ระบุผู้ขายเอง
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* โหมดอ้างอิง — เลือกเอกสารต้นฉบับ */}
          {!isStandalone && (
            <div>
              <span className={formLabelClass}>เอกสารต้นฉบับ</span>
              {state.originalDocumentId && selectedDoc ? (
                <div
                  ref={selectedCardRef}
                  tabIndex={-1}
                  role="group"
                  aria-label={`เอกสารต้นฉบับที่เลือก ${selectedDoc.number}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3"
                >
                  <div className="min-w-0 leading-snug">
                    <div className="font-mono text-sm">{selectedDoc.number}</div>
                    <div className="text-sm">
                      {selectedDoc.vendorName ?? '—'} · ยอด {formatNumberDecimal(selectedDoc.totalAmount)} ฿
                    </div>
                    {capInfo && (
                      <div className="mt-1 text-xs text-muted-foreground">
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
                      setPickedDoc(null);
                      focusAfterRender.current = 'search';
                    }}
                    className="min-h-11 px-2 text-sm leading-snug text-destructive hover:underline"
                  >
                    เปลี่ยน
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <input ref={searchInputRef} aria-label="ค้นหาเลข EX-... / ผู้ขาย (3 ตัวขึ้นไป)"
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="ค้นหาเลข EX-... / ผู้ขาย (3 ตัวขึ้นไป)"
                      className={cn(formControlClass, 'pl-10')}
                    />
                  </div>
                  <p className="text-xs leading-snug text-muted-foreground">เลือกเอกสาร EX ที่ต้องการลดหนี้</p>
                  {(searchResults?.data ?? []).length > 0 && (
                    <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
                      {searchResults!.data
                        .filter((d) => ['POSTED', 'ACCRUAL'].includes(d.status))
                        .map((doc) => (
                          <button
                            type="button"
                            key={doc.id}
                            onClick={() => {
                              setPickedDoc(doc);
                              focusAfterRender.current = 'selected';
                              onChange({ originalDocumentId: doc.id });
                              // เติมรายการจากเอกสารต้นฉบับ (ถ้ามี)
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
                            className="flex min-h-11 w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left text-sm leading-snug last:border-b-0 hover:bg-accent"
                          >
                            <div className="min-w-0">
                              <div className="font-mono">{doc.number}</div>
                              <div className="text-xs text-muted-foreground">
                                {doc.vendorName ?? '—'} · {doc.status}
                              </div>
                            </div>
                            <div className="shrink-0 font-mono text-sm">{formatNumberDecimal(doc.totalAmount)}</div>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* โหมดไม่มีเอกสารต้นทาง — ระบุผู้ขายเอง */}
          {isStandalone && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={`${uiFieldId}-2`} className={formLabelClass}>
                    ชื่อผู้ขาย <span className="text-destructive">*</span>
                  </label>
                  <input id={`${uiFieldId}-2`}
                    type="text"
                    value={state.vendorName}
                    onChange={(e) => onChange({ vendorName: e.target.value })}
                    placeholder="เช่น บจก. แอลฟ่า เซอร์วิส"
                    maxLength={255}
                    className={formControlClass}
                  />
                </div>
                <div>
                  <label htmlFor={`${uiFieldId}-3`} className={formLabelClass}>เลขผู้เสียภาษี (ทางเลือก)</label>
                  <input id={`${uiFieldId}-3`}
                    type="text"
                    value={state.vendorTaxId}
                    onChange={(e) => onChange({ vendorTaxId: e.target.value })}
                    placeholder="13 หลัก"
                    maxLength={20}
                    className={cn(formControlClass, 'font-mono')}
                  />
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-2 text-xs leading-snug text-warning-strong">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>ใบลดหนี้ที่ไม่มีเอกสารต้นทางไม่จำกัดยอดตามเอกสารเดิม โปรดตรวจยอดก่อนลงบัญชี</span>
              </div>
            </div>
          )}

          <div>
            <label htmlFor={`${uiFieldId}-1`} className={formLabelClass}>
              เหตุผลลดหนี้ <span className="text-destructive">*</span>
            </label>
            <input id={`${uiFieldId}-1`}
              type="text"
              value={state.cnReason}
              onChange={(e) => onChange({ cnReason: e.target.value })}
              placeholder={
                isStandalone
                  ? 'เช่น คืนเงินมัดจำ, ส่วนลดพิเศษ, ปรับยอด AP'
                  : 'เช่น สินค้าคืน, ปรับราคา, ส่วนลดหลังการขาย'
              }
              className={formControlClass}
            />
          </div>
        </div>
      </FormRow>

      {/* รายการ — โหมดไม่มีเอกสารต้นทางแสดงเสมอ · โหมดอ้างอิงแสดงหลังเลือกเอกสาร */}
      {(isStandalone || state.originalDocumentId) && (
        <FormRow title="รายการที่จะลด" layout="stacked" complete={validCount > 0}>
          <ItemLinesSection
            lines={state.lines}
            onChange={onLinesChange}
            priceTypeLabel={state.priceType === 'INCLUSIVE' ? 'ราคารวม VAT' : 'ราคาไม่รวม VAT'}
          />
          {exceedsCap && (
            <div role="alert" className="mt-2 flex items-start gap-2 text-sm leading-snug text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>ยอดรายการเกินที่ลดได้สูงสุด {formatNumberDecimal(remaining)} ฿</span>
            </div>
          )}
        </FormRow>
      )}

      {/* เอกสารต้นฉบับที่จ่ายแล้ว (POSTED) — server ลง Dr บัญชีนี้ · ต้นฉบับที่ยังตั้งหนี้ลดเจ้าหนี้ ไม่ใช้บัญชีเงิน */}
      {!isStandalone && selectedDoc?.status === 'POSTED' && (
        <FormRow title="รับเงินคืนเข้า" complete={!!state.depositAccountCode}>
          <div className="w-full sm:max-w-md">
            <label htmlFor={`${uiFieldId}-refund`} className="sr-only">รับเงินคืนเข้า</label>
            <CashAccountSelect
              id={`${uiFieldId}-refund`}
              placeholder="รับเงินคืนเข้า"
              value={state.depositAccountCode}
              onChange={(code) => onChange({ depositAccountCode: code })}
            />
          </div>
        </FormRow>
      )}
    </>
  );
}
