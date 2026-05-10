import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { ArrowLeft, FileText, Search, AlertCircle } from 'lucide-react';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { Button } from '@/components/ui/button';

interface OriginalDoc {
  id: string;
  number: string;
  vendorName: string | null;
  totalAmount: string;
  status: string;
  documentDate: string;
  expenseDetail: { category: string } | null;
  branch: { id: string; name: string };
}

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

export function CreditNoteForm({ onClose, onSaved }: Props) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [original, setOriginal] = useState<OriginalDoc | null>(null);
  const [reason, setReason] = useState('');
  const [subtotal, setSubtotal] = useState('');
  const [vatAmount, setVatAmount] = useState('0');
  const [documentDate, setDocumentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');

  // Search original EX docs (POSTED/ACCRUAL only)
  const { data: searchResults } = useQuery<{ data: OriginalDoc[] }>({
    queryKey: ['expense-search', search],
    queryFn: async () => {
      if (!search.trim()) return { data: [] };
      const { data } = await api.get(
        `/expense-documents?type=EXPENSE&search=${encodeURIComponent(search)}&limit=10`,
      );
      return data;
    },
    enabled: search.trim().length >= 3,
  });

  // Fetch creditedAmount for selected original
  const { data: capInfo } = useQuery<{ remainingCap: number }>({
    queryKey: ['cn-cap', original?.id],
    queryFn: async () => {
      if (!original) return { remainingCap: 0 };
      // For PR-2: rely on submit-time validation; we approximate cap as totalAmount.
      // Future: dedicated /:id/cn-cap endpoint
      return { remainingCap: parseFloat(original.totalAmount) };
    },
    enabled: !!original,
  });

  const mutation = useMutation({
    mutationFn: async (andPost: boolean) => {
      const { data } = await api.post('/expense-documents/credit-note', {
        branchId: original!.branch?.id ?? '',
        documentDate,
        originalDocumentId: original!.id,
        reason,
        subtotal: parseFloat(subtotal),
        vatAmount: parseFloat(vatAmount) || 0,
        note: note || undefined,
      });
      if (andPost) {
        await api.post(`/expense-documents/${data.id}/post`);
      }
      return data;
    },
    onSuccess: () => {
      toast.success('สร้างใบลดหนี้สำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expenses-summary'] });
      onSaved();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const total = (parseFloat(subtotal) || 0) + (parseFloat(vatAmount) || 0);
  const remaining = capInfo?.remainingCap ?? 0;
  const exceedsCap = total > remaining;
  const canSubmit = original && reason.trim().length >= 3 && parseFloat(subtotal) > 0 && !exceedsCap;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8">
      <div className="w-full max-w-3xl bg-background rounded-xl shadow-2xl overflow-y-auto max-h-[calc(100vh-4rem)]">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> กลับ
          </button>
          <h2 className="text-lg font-semibold text-foreground">สร้างใบลดหนี้ (CN)</h2>
          <div className="w-16" />
        </div>

        <div className="p-6 space-y-5">
          {/* Section: Original document picker */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                <FileText className="size-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">เอกสารต้นฉบับ</h3>
                <p className="text-xs text-muted-foreground">เลือกเอกสาร EX ที่ต้องการลดหนี้</p>
              </div>
            </div>
            {original ? (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 flex items-center justify-between">
                <div>
                  <div className="font-mono text-warning text-sm">{original.number}</div>
                  <div className="text-sm">
                    {original.vendorName ?? '–'} · ยอด {original.totalAmount} ฿
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {original.expenseDetail?.category} · {original.status}
                  </div>
                </div>
                <button
                  onClick={() => setOriginal(null)}
                  className="text-xs text-destructive hover:underline"
                >
                  เปลี่ยน
                </button>
              </div>
            ) : (
              <div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="ค้นหาเลข EX-... / ผู้ขาย"
                    className="w-full pl-10 pr-3 py-2.5 border border-input rounded-lg text-sm outline-hidden bg-background"
                  />
                </div>
                {searchResults && searchResults.data.length > 0 && (
                  <div className="mt-2 space-y-1 max-h-60 overflow-y-auto">
                    {searchResults.data
                      .filter((d) => ['POSTED', 'ACCRUAL'].includes(d.status))
                      .map((d) => (
                        <button
                          key={d.id}
                          onClick={() => setOriginal(d)}
                          className="w-full text-left rounded-lg border border-border p-2 hover:bg-muted"
                        >
                          <div className="font-mono text-warning text-sm">{d.number}</div>
                          <div className="text-sm">
                            {d.vendorName ?? '–'} · {d.totalAmount} ฿ · {d.status}
                          </div>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Section: CN amount + reason */}
          {original && (
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">รายละเอียดการลดหนี้</h3>
              <div>
                <label className="block text-xs font-medium mb-1.5">วันที่</label>
                <ThaiDateInput
                  value={documentDate}
                  onChange={(e) => setDocumentDate(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5">
                  เหตุผลลดหนี้ <span className="text-destructive">*</span>
                </label>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="เช่น สินค้าคืน, ปรับราคา"
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm outline-hidden bg-background"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1.5">
                    จำนวนเงิน (ก่อน VAT) <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={subtotal}
                    onChange={(e) => setSubtotal(e.target.value)}
                    className="w-full px-3 py-2 border border-input rounded-lg text-sm outline-hidden bg-background"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5">VAT</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={vatAmount}
                    onChange={(e) => setVatAmount(e.target.value)}
                    className="w-full px-3 py-2 border border-input rounded-lg text-sm outline-hidden bg-background"
                  />
                </div>
              </div>
              <div className="rounded-lg bg-muted p-3 text-sm flex justify-between">
                <span>รวม</span>
                <span className="font-semibold">{total.toFixed(2)} ฿</span>
              </div>
              {exceedsCap && (
                <div className="flex items-start gap-2 text-destructive text-sm">
                  <AlertCircle className="size-4 mt-0.5" />
                  <span>เกินยอดที่ลดได้สูงสุด {remaining.toFixed(2)} ฿</span>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium mb-1.5">หมายเหตุ</label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm outline-hidden bg-background resize-none"
                />
              </div>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-background border-t px-6 py-4 flex items-center justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button
            variant="outline"
            onClick={() => mutation.mutate(false)}
            disabled={!canSubmit || mutation.isPending}
          >
            บันทึกร่าง
          </Button>
          <Button
            variant="primary"
            onClick={() => mutation.mutate(true)}
            disabled={!canSubmit || mutation.isPending}
          >
            {mutation.isPending ? 'กำลังบันทึก...' : 'บันทึก + โพสต์'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
