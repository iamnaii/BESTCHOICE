import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle2, Copy, Edit, History, Printer, RotateCcw, Receipt, FileText } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { ReverseModal } from './components/ReverseModal';
import { AutoJournalPreview } from './components/AutoJournalPreview';
import { otherIncomeApi } from '@/lib/otherIncome';
import type { OtherIncome, OtherIncomeStatus, OtherIncomeReverseReason } from '@/lib/otherIncome.types';
import { useAuth } from '@/contexts/AuthContext';
import { formatThaiDateLong } from '@/lib/date';

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

const STATUS_LABELS: Record<OtherIncomeStatus, string> = {
  DRAFT: 'ร่าง',
  POSTED: 'บันทึกแล้ว',
  REVERSED: 'กลับรายการแล้ว',
};

const STATUS_COLORS: Record<OtherIncomeStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  POSTED: 'bg-success/10 text-success',
  REVERSED: 'bg-destructive/10 text-destructive',
};

function StatusBadge({ status }: { status: OtherIncomeStatus }) {
  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${STATUS_COLORS[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function fmt(v: string | number | undefined | null) {
  if (v === undefined || v === null) return '—';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (isNaN(n)) return '—';
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return formatThaiDateLong(d);
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-1.5 border-b border-border last:border-b-0">
      <span className="text-muted-foreground text-sm w-40 shrink-0">{label}</span>
      <span className="text-sm font-medium flex-1">{value ?? '—'}</span>
    </div>
  );
}

// Reconstruct JE preview from posted doc (read-only; mirrors AutoJournalService)
interface JeLine {
  accountCode: string;
  debit: number;
  credit: number;
  description?: string;
}

function buildJeFromDoc(doc: OtherIncome): JeLine[] {
  const lines: JeLine[] = [];

  for (const item of doc.items) {
    const amtBeforeVat = parseFloat(item.amountBeforeVat) || 0;
    if (amtBeforeVat > 0) {
      lines.push({
        accountCode: item.accountCode,
        debit: 0,
        credit: amtBeforeVat,
        description: item.description ?? undefined,
      });
    }
  }

  const totalVat = parseFloat(doc.vatAmount) || 0;
  if (totalVat > 0) {
    lines.push({ accountCode: '21-2101', debit: 0, credit: totalVat, description: 'ภาษีขาย' });
  }

  // B6: WHT is Dr 11-4103 (WHT receivable) per AutoJournalService — not Cr 21-3101
  const totalWht = parseFloat(doc.whtAmount) || 0;
  if (totalWht > 0) {
    lines.push({ accountCode: '11-4103', debit: totalWht, credit: 0, description: 'ภาษีหัก ณ ที่จ่าย' });
  }

  for (const adj of doc.adjustments) {
    const amt = parseFloat(adj.amount) || 0;
    if (amt > 0 && adj.accountCode) {
      const netExpected = parseFloat(doc.netReceived) || 0;
      const received = parseFloat(doc.amountReceived) || 0;
      const diff = received - netExpected;
      if (diff > 0) {
        lines.push({ accountCode: adj.accountCode, debit: 0, credit: amt, description: adj.note ?? undefined });
      } else {
        lines.push({ accountCode: adj.accountCode, debit: amt, credit: 0, description: adj.note ?? undefined });
      }
    }
  }

  const received = parseFloat(doc.amountReceived) || 0;
  if (received > 0) {
    lines.push({
      accountCode: doc.paymentAccountCode,
      debit: received,
      credit: 0,
      description: 'รับเงิน',
    });
  }

  return lines;
}

// Roles that can reverse a POSTED document
// B9: ACCOUNTANT removed — backend @Roles only allows OWNER/FINANCE_MANAGER on POST :id/reverse
const REVERSE_ROLES = ['OWNER', 'FINANCE_MANAGER'];

// ------------------------------------------------------------------
// Main component
// ------------------------------------------------------------------

export default function OtherIncomeViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [showReverseModal, setShowReverseModal] = useState(false);

  const auditQuery = useQuery({
    queryKey: ['other-income', id, 'audit'],
    queryFn: () => otherIncomeApi.getAuditTrail(id!),
    enabled: !!id,
  });

  const docQuery = useQuery({
    queryKey: ['other-income', id],
    queryFn: () => otherIncomeApi.findOne(id!),
    enabled: !!id,
  });

  const reverseMutation = useMutation({
    mutationFn: ({ reason, note }: { reason: OtherIncomeReverseReason; note: string }) =>
      otherIncomeApi.reverse(id!, reason, note),
    onSuccess: (reversingDoc) => {
      toast.success(`สร้าง Reversing Entry ${reversingDoc.docNumber} แล้ว`);
      setShowReverseModal(false);
      queryClient.invalidateQueries({ queryKey: ['other-income'] });
      navigate(`/other-income/${reversingDoc.id}`);
    },
    onError: () => toast.error('ไม่สามารถกลับรายการได้'),
  });

  const copyMutation = useMutation({
    mutationFn: () => otherIncomeApi.copy(id!),
    onSuccess: (newDoc) => {
      toast.success(`คัดลอกเป็น ${newDoc.docNumber} แล้ว`);
      queryClient.invalidateQueries({ queryKey: ['other-income'] });
      navigate(`/other-income/${newDoc.id}/edit`);
    },
    onError: () => toast.error('ไม่สามารถคัดลอกเอกสารได้'),
  });

  const canReverse =
    user?.role && REVERSE_ROLES.includes(user.role) && docQuery.data?.status === 'POSTED';

  const doc = docQuery.data;
  const jeLines = doc ? buildJeFromDoc(doc) : [];

  const isActionLoading = reverseMutation.isPending || copyMutation.isPending;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="รายละเอียดเอกสารรายได้อื่น"
        icon={<Receipt size={20} />}
        onBack={() => navigate('/other-income')}
        badge={doc ? <StatusBadge status={doc.status} /> : undefined}
        action={
          doc ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isActionLoading}
                onClick={() => copyMutation.mutate()}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border rounded-lg hover:bg-accent disabled:opacity-50"
              >
                <Copy size={14} />
                คัดลอก
              </button>
              {doc.status === 'POSTED' && doc.customerId && (
                <button
                  type="button"
                  onClick={() => navigate(`/other-income/${doc.id}/receipt`)}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border rounded-lg hover:bg-accent"
                >
                  <Printer size={14} />
                  พิมพ์ใบเสร็จ
                </button>
              )}
              {doc.status === 'DRAFT' && (
                <button
                  type="button"
                  onClick={() => navigate(`/other-income/${doc.id}/edit`)}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border rounded-lg hover:bg-accent"
                >
                  <Edit size={14} />
                  แก้ไข
                </button>
              )}
              {canReverse && (
                <button
                  type="button"
                  disabled={isActionLoading}
                  onClick={() => setShowReverseModal(true)}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold border border-destructive text-destructive rounded-lg hover:bg-destructive/10 disabled:opacity-50"
                >
                  <RotateCcw size={14} />
                  กลับรายการ
                </button>
              )}
            </div>
          ) : undefined
        }
      />

      <QueryBoundary
        isLoading={docQuery.isLoading}
        isError={docQuery.isError}
        error={docQuery.error}
        onRetry={docQuery.refetch}
      >
        {doc && (
          <div>
          {doc.postedAt && Date.now() - new Date(doc.postedAt).getTime() < 60_000 && (
            <div className="rounded-xl border-2 border-success bg-success/10 px-5 py-4 mb-4 flex items-center gap-4">
              <CheckCircle2 size={24} className="text-success" />
              <div className="flex-1">
                <p className="font-bold text-success">บันทึกและ POST เรียบร้อยแล้ว</p>
                <p className="text-xs text-success/80">
                  เอกสาร {doc.docNumber} ลงบัญชีเรียบร้อย
                </p>
              </div>
              {doc.customerId && (
                <button
                  onClick={() => navigate(`/other-income/${doc.id}/receipt`)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold bg-primary text-primary-foreground rounded-md animate-pulse"
                >
                  <Printer size={16} /> พิมพ์ใบเสร็จ
                </button>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* Left / Main column */}
            <div className="xl:col-span-2 space-y-6">
              {/* --- Document header info --- */}
              <div className="rounded-xl border bg-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    ข้อมูลเอกสาร
                  </h2>
                  <span className="font-mono font-bold text-lg text-primary">{doc.docNumber}</span>
                </div>
                <div>
                  <InfoRow label="วันที่เอกสาร" value={fmtDate(doc.issueDate)} />
                  <InfoRow label="วันครบกำหนด" value={fmtDate(doc.dueDate)} />
                  <InfoRow label="วันที่รับเงิน" value={fmtDate(doc.paymentDate)} />
                  <InfoRow label="ประเภทราคา" value={doc.priceType === 'INCLUSIVE' ? 'รวม VAT' : 'ไม่รวม VAT'} />
                  <InfoRow label="ช่องทางรับเงิน" value={doc.paymentAccountCode} />
                  {doc.receiptNo && <InfoRow label="เลขที่ใบเสร็จ" value={doc.receiptNo} />}
                  {doc.postedAt && (
                    <InfoRow label="วันที่ POST" value={fmtDate(doc.postedAt)} />
                  )}
                </div>
              </div>

              {/* --- Counterparty --- */}
              <div className="rounded-xl border bg-card p-5">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  คู่ค้า / ลูกค้า
                </h2>
                <InfoRow
                  label="ชื่อ"
                  value={doc.counterpartyName ?? doc.customer?.name ?? (
                    <span className="text-muted-foreground">—</span>
                  )}
                />
                {doc.counterpartyTaxId && (
                  <InfoRow label="เลขที่ผู้เสียภาษี" value={doc.counterpartyTaxId} />
                )}
                {doc.counterpartyPhone && (
                  <InfoRow label="เบอร์โทร" value={doc.counterpartyPhone} />
                )}
                {doc.counterpartyAddress && (
                  <InfoRow label="ที่อยู่" value={doc.counterpartyAddress} />
                )}
              </div>

              {/* --- Items table --- */}
              <div className="rounded-xl border bg-card p-5">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  รายการรายได้
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 pr-3 text-xs text-muted-foreground font-medium">#</th>
                        <th className="text-left py-2 pr-3 text-xs text-muted-foreground font-medium">บัญชี</th>
                        <th className="text-left py-2 pr-3 text-xs text-muted-foreground font-medium">คำอธิบาย</th>
                        <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">จำนวน</th>
                        <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">ราคา</th>
                        <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">ส่วนลด</th>
                        <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">VAT%</th>
                        <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">WHT%</th>
                        <th className="text-right py-2 text-xs text-muted-foreground font-medium">ก่อนภาษี</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doc.items.map((item) => (
                        <tr key={item.id} className="border-b hover:bg-muted/20">
                          <td className="py-2 pr-3 text-muted-foreground text-xs">{item.lineNo}</td>
                          <td className="py-2 pr-3 font-mono text-xs font-semibold">{item.accountCode}</td>
                          <td className="py-2 pr-3 text-xs">{item.description ?? '—'}</td>
                          <td className="py-2 pr-3 text-right font-mono">{fmt(item.quantity)}</td>
                          <td className="py-2 pr-3 text-right font-mono">{fmt(item.unitAmount)}</td>
                          <td className="py-2 pr-3 text-right font-mono text-muted-foreground">
                            {fmt(item.discountAmount)}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono">{item.vatPct}%</td>
                          <td className="py-2 pr-3 text-right font-mono">{item.whtPct}%</td>
                          <td className="py-2 text-right font-mono font-semibold">
                            {fmt(item.amountBeforeVat)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Adjustments */}
                {doc.adjustments.length > 0 && (
                  <div className="mt-4 pt-3 border-t">
                    <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">บัญชีปรับผลต่าง</p>
                    {doc.adjustments.map((adj) => (
                      <div key={adj.id} className="flex justify-between text-sm py-1">
                        <span className="font-mono text-xs">{adj.accountCode}</span>
                        <span className="text-muted-foreground text-xs">{adj.note ?? '—'}</span>
                        <span className="font-mono">{fmt(adj.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* --- Reverse info --- */}
              {doc.status === 'REVERSED' && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
                  <h2 className="text-sm font-semibold text-destructive uppercase tracking-wide mb-3 flex items-center gap-2">
                    <RotateCcw size={14} />
                    ข้อมูลการกลับรายการ
                  </h2>
                  <InfoRow label="ประเภทเหตุผล" value={doc.reverseReason ?? '—'} />
                  <InfoRow label="รายละเอียด" value={doc.reverseNote ?? '—'} />
                  {doc.reversedById && (
                    <InfoRow label="เอกสาร Reversing" value={
                      <button
                        type="button"
                        onClick={() => navigate(`/other-income/${doc.reversedById}`)}
                        className="font-mono text-primary hover:underline"
                      >
                        ดูเอกสาร Reversing Entry
                      </button>
                    } />
                  )}
                </div>
              )}

              {/* --- Copied from --- */}
              {doc.copiedFromId && (
                <div className="rounded-xl border bg-card p-5">
                  <p className="text-xs text-muted-foreground">
                    คัดลอกจากเอกสาร{' '}
                    <button
                      type="button"
                      onClick={() => navigate(`/other-income/${doc.copiedFromId}`)}
                      className="font-mono text-primary hover:underline"
                    >
                      ดูต้นฉบับ
                    </button>
                  </p>
                </div>
              )}

              {/* --- Customer note --- */}
              {doc.customerNote && (
                <div className="rounded-xl border bg-card p-5">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    หมายเหตุ
                  </h2>
                  <p className="text-sm">{doc.customerNote}</p>
                </div>
              )}

              {/* --- Attachments --- */}
              {doc.attachments.length > 0 && (
                <div className="rounded-xl border bg-card p-5">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                    เอกสารแนบ
                  </h2>
                  <div className="space-y-2">
                    {doc.attachments.map((att) => (
                      <div key={att.id} className="flex items-center gap-3 text-sm">
                        <FileText size={14} className="text-muted-foreground shrink-0" />
                        <span className="flex-1 truncate">{att.filename}</span>
                        <span className="text-xs text-muted-foreground">
                          {(att.size / 1024).toFixed(1)} KB
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right column — summary + JE preview */}
            <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
              {/* Summary */}
              <div className="rounded-xl border bg-card p-5">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  สรุปยอด
                </h2>
                <div className="space-y-2 font-mono text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">รายได้ก่อนภาษี</span>
                    <span className="font-semibold">{fmt(doc.incomeGross)} ฿</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">VAT</span>
                    <span>{fmt(doc.vatAmount)} ฿</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">WHT</span>
                    <span>-{fmt(doc.whtAmount)} ฿</span>
                  </div>
                  <div className="flex justify-between border-t pt-2 font-bold">
                    <span>สุทธิที่คาดรับ</span>
                    <span>{fmt(doc.netReceived)} ฿</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ได้รับจริง</span>
                    <span
                      className={
                        Math.abs(parseFloat(doc.amountReceived) - parseFloat(doc.netReceived)) > 0.01
                          ? 'text-warning'
                          : 'text-success'
                      }
                    >
                      {fmt(doc.amountReceived)} ฿
                    </span>
                  </div>
                  {doc.isOverridden && (
                    <p className="text-xs text-warning pt-1">
                      * JE ถูก override โดยผู้ใช้
                    </p>
                  )}
                </div>
              </div>

              {/* JE Preview — only when POSTED */}
              {doc.status === 'POSTED' && <AutoJournalPreview lines={jeLines} />}

              {/* Draft action shortcut */}
              {doc.status === 'DRAFT' && (
                <div className="rounded-xl border bg-card p-5 space-y-2">
                  <p className="text-sm text-muted-foreground">เอกสารนี้ยังเป็นร่าง — ยังไม่มี Journal Entry</p>
                  <button
                    type="button"
                    onClick={() => navigate(`/other-income/${doc.id}/edit`)}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90"
                  >
                    <Edit size={14} />
                    แก้ไขและ POST
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Audit trail */}
          <section className="rounded-xl border bg-card p-5 mt-6">
            <h3 className="font-bold mb-3 flex items-center gap-2">
              <History size={16} /> ประวัติการแก้ไข
            </h3>
            {auditQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
            ) : !auditQuery.data || auditQuery.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">— ไม่มีประวัติ —</p>
            ) : (
              <ul className="space-y-2">
                {auditQuery.data.map((log) => (
                  <li key={log.id} className="border-l-2 pl-3 py-1.5 border-border">
                    <div className="flex items-center gap-2 text-xs flex-wrap">
                      <span className="px-2 py-0.5 rounded bg-muted font-mono text-xs">
                        {log.action}
                      </span>
                      <span className="text-muted-foreground">{fmtDate(log.createdAt)}</span>
                      {log.user && (
                        <span>โดย <strong>{log.user.name}</strong></span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          </div>
        )}
      </QueryBoundary>

      {/* Back button at bottom */}
      <div className="mt-8 flex justify-start">
        <button
          type="button"
          onClick={() => navigate('/other-income')}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border rounded-lg hover:bg-accent"
        >
          <ArrowLeft size={14} />
          กลับรายการ
        </button>
      </div>

      {/* Reverse modal */}
      {showReverseModal && doc && (
        <ReverseModal
          docNumber={doc.docNumber}
          onCancel={() => setShowReverseModal(false)}
          onConfirm={(reason, note) => reverseMutation.mutate({ reason, note })}
          isLoading={reverseMutation.isPending}
        />
      )}
    </div>
  );
}
