import { useState } from 'react';
import { FileText, Download, CheckCircle, RotateCcw, Loader2, Upload } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import Modal from '@/components/ui/Modal';
import { cn } from '@/lib/utils';
import { useLetterQueue, type LetterRow, type LetterType, type LetterStatus } from '../hooks/useLetterQueue';
import { useLetterActions } from '../hooks/useLetterActions';
import LetterDispatchDialog from './LetterDispatchDialog';
import BulkSlipUploadDialog from './BulkSlipUploadDialog';

// ── Helpers ────────────────────────────────────────────────────────────────────

function letterTypeLabel(t: LetterType): string {
  return t === 'RETURN_DEVICE_45D' ? 'ทวงถาม 45 วัน' : 'บอกเลิก 60 วัน';
}

function letterTypeStyle(t: LetterType): string {
  return t === 'CONTRACT_TERMINATION_60D'
    ? 'bg-destructive/10 text-destructive'
    : 'bg-warning/10 text-warning';
}

function letterStatusLabel(s: LetterStatus): string {
  const map: Record<LetterStatus, string> = {
    PENDING_DISPATCH: 'รอสร้าง PDF',
    PDF_GENERATED: 'รอส่งไปรษณีย์',
    DISPATCHED: 'ส่งแล้ว · รอรับ',
    DELIVERED: 'รับแล้ว',
    UNDELIVERABLE: 'ส่งไม่ถึง',
    CANCELLED: 'ยกเลิก',
  };
  return map[s];
}

function letterStatusDot(s: LetterStatus): string {
  const map: Record<LetterStatus, string> = {
    PENDING_DISPATCH: 'bg-muted-foreground',
    PDF_GENERATED: 'bg-warning',
    DISPATCHED: 'bg-primary',
    DELIVERED: 'bg-success',
    UNDELIVERABLE: 'bg-destructive',
    CANCELLED: 'bg-muted-foreground',
  };
  return map[s];
}

function daysAgoLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return days === 0 ? 'วันนี้' : `${days} วันที่แล้ว`;
}

function urgencyStrip(letter: LetterRow): string {
  const days = Math.floor((Date.now() - new Date(letter.triggeredAt).getTime()) / 86400000);
  if (days >= 5) return 'bg-destructive';
  if (days >= 2) return 'bg-warning';
  return 'bg-primary';
}

// ── Row Skeleton ───────────────────────────────────────────────────────────────

function RowSkeleton() {
  return <div className="bg-muted animate-pulse h-24 rounded-lg" />;
}

// ── Letter Row ─────────────────────────────────────────────────────────────────

interface LetterRowCardProps {
  letter: LetterRow;
  onOpenGenerate: (l: LetterRow) => void;
  onOpenDispatch: (l: LetterRow) => void;
  onDelivered: (l: LetterRow) => void;
  onUndeliverable: (l: LetterRow) => void;
  deliveredPending: boolean;
  undeliverablePending: boolean;
}

function LetterRowCard({
  letter,
  onOpenGenerate,
  onOpenDispatch,
  onDelivered,
  onUndeliverable,
  deliveredPending,
  undeliverablePending,
}: LetterRowCardProps) {
  return (
    <div className="relative flex rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
      {/* Urgency heat strip */}
      <div className={cn('w-1 shrink-0', urgencyStrip(letter))} />

      <div className="flex-1 p-4 min-w-0">
        {/* Header row: badges + age */}
        <div className="flex items-start justify-between gap-3 mb-1.5">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <span
              className={cn(
                'inline-flex items-center rounded-full text-[10px] font-semibold px-2 py-0.5 leading-snug',
                letterTypeStyle(letter.letterType),
              )}
            >
              {letterTypeLabel(letter.letterType)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full text-[10px] font-medium px-2 py-0.5 leading-snug bg-muted text-muted-foreground">
              <span
                className={cn('inline-block size-1.5 rounded-full', letterStatusDot(letter.status))}
              />
              {letterStatusLabel(letter.status)}
            </span>
          </div>
          <div className="shrink-0 text-[10px] text-muted-foreground leading-snug whitespace-nowrap tabular-nums">
            {daysAgoLabel(letter.triggeredAt)}
          </div>
        </div>

        {/* Contract # + Customer */}
        <div className="font-mono text-xs text-primary font-medium mb-0.5">
          {letter.contract.contractNumber}
        </div>
        <div className="text-sm font-semibold leading-snug truncate mb-0.5">
          {letter.contract.customer.name}
        </div>
        <div className="text-[10px] text-muted-foreground leading-snug mb-3">
          {letter.letterNumber}
          {letter.trackingNumber && (
            <>
              {' · '}
              <span className="font-mono tabular-nums">{letter.trackingNumber}</span>
            </>
          )}
        </div>

        {/* CTAs per status */}
        <div className="flex items-center justify-end gap-2">
          {letter.status === 'PENDING_DISPATCH' && (
            <button
              type="button"
              onClick={() => onOpenGenerate(letter)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <FileText className="size-3.5" />
              สร้าง PDF
            </button>
          )}

          {letter.status === 'PDF_GENERATED' && (
            <>
              {letter.pdfUrl && (
                <a
                  href={letter.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <Download className="size-3.5" />
                  ดาวน์โหลด
                </a>
              )}
              <button
                type="button"
                onClick={() => onOpenDispatch(letter)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <CheckCircle className="size-3.5" />
                บันทึกส่งแล้ว
              </button>
            </>
          )}

          {letter.status === 'DISPATCHED' && (
            <>
              <button
                type="button"
                onClick={() => onUndeliverable(letter)}
                disabled={undeliverablePending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors"
              >
                <RotateCcw className="size-3.5" />
                คืน
              </button>
              <button
                type="button"
                onClick={() => onDelivered(letter)}
                disabled={deliveredPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {deliveredPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <CheckCircle className="size-3.5" />
                )}
                รับแล้ว
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── LetterQueueSection ────────────────────────────────────────────────────────

export default function LetterQueueSection() {
  const { data, isLoading } = useLetterQueue();
  const { markDelivered, markUndeliverable } = useLetterActions();

  const [dispatchLetter, setDispatchLetter] = useState<LetterRow | null>(null);
  const [dispatchMode, setDispatchMode] = useState<'generate' | 'dispatch'>('generate');
  const [bulkSlipOpen, setBulkSlipOpen] = useState(false);

  // Undeliverable reason dialog — replaces window.prompt
  const [undeliverableLetter, setUndeliverableLetter] = useState<LetterRow | null>(null);
  const [undeliverableReason, setUndeliverableReason] = useState<string>(
    'ย้ายที่อยู่ไม่ทราบที่อยู่ใหม่',
  );

  const openGenerate = (l: LetterRow) => {
    setDispatchLetter(l);
    setDispatchMode('generate');
  };

  const openDispatch = (l: LetterRow) => {
    setDispatchLetter(l);
    setDispatchMode('dispatch');
  };

  const handleUndeliverable = (letter: LetterRow) => {
    setUndeliverableLetter(letter);
    setUndeliverableReason('ย้ายที่อยู่ไม่ทราบที่อยู่ใหม่');
  };

  const closeUndeliverable = () => setUndeliverableLetter(null);

  const submitUndeliverable = () => {
    if (!undeliverableLetter) return;
    const trimmed = undeliverableReason.trim();
    if (trimmed.length < 5) return;
    markUndeliverable.mutate(
      { letterId: undeliverableLetter.id, reason: trimmed },
      { onSettled: () => closeUndeliverable() },
    );
  };

  const undeliverableValid = undeliverableReason.trim().length >= 5;

  const count = data?.length ?? 0;
  const dispatchedMissingEvidence = (data ?? []).filter(
    (l) => l.status === 'DISPATCHED' && !l.evidencePhotoUrl,
  );

  return (
    <>
      <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-primary" />
              <h3 className="text-sm font-semibold leading-snug">หนังสือทวงถาม / บอกเลิก</h3>
            </div>
            <span className="text-xs tabular-nums bg-muted text-muted-foreground rounded-full px-2 py-0.5">
              {count}
            </span>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              <RowSkeleton />
              <RowSkeleton />
            </div>
          ) : count === 0 ? (
            <div className="rounded-lg border border-dashed border-success/30 bg-success/5 py-8 text-center">
              <div className="text-sm font-medium text-success leading-snug">
                ไม่มีหนังสือรอดำเนินการ
              </div>
            </div>
          ) : (
            <>
              {/* Bulk slip upload trigger — show when 2+ dispatched letters missing evidence */}
              {dispatchedMissingEvidence.length >= 2 && (
                <div className="mb-3 flex justify-end">
                  <button
                    onClick={() => setBulkSlipOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-input hover:bg-muted text-muted-foreground transition-colors"
                  >
                    <Upload className="size-3.5" />
                    อัปโหลดสลิปชุด ({dispatchedMissingEvidence.length})
                  </button>
                </div>
              )}
              <div className="space-y-2">
                {data!.map((letter) => (
                  <LetterRowCard
                    key={letter.id}
                    letter={letter}
                    onOpenGenerate={openGenerate}
                    onOpenDispatch={openDispatch}
                    onDelivered={(l) => markDelivered.mutate(l.id)}
                    onUndeliverable={handleUndeliverable}
                    deliveredPending={markDelivered.isPending}
                    undeliverablePending={markUndeliverable.isPending}
                  />
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {dispatchLetter && (
        <LetterDispatchDialog
          open={!!dispatchLetter}
          letter={dispatchLetter}
          initialMode={dispatchMode}
          onClose={() => setDispatchLetter(null)}
        />
      )}

      {bulkSlipOpen && (
        <BulkSlipUploadDialog
          open={bulkSlipOpen}
          letters={dispatchedMissingEvidence}
          onClose={() => setBulkSlipOpen(false)}
        />
      )}

      {/* Undeliverable reason — replaces window.prompt */}
      <Modal
        isOpen={!!undeliverableLetter}
        onClose={closeUndeliverable}
        title="บันทึกเหตุผลที่ส่งไม่ถึง"
      >
        {undeliverableLetter && (
          <div className="space-y-4 p-1">
            <div className="rounded-lg bg-muted/40 border border-border p-3 text-xs space-y-1">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground leading-snug">ลูกค้า</span>
                <span className="font-semibold leading-snug text-right">
                  {undeliverableLetter.contract.customer.name}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground leading-snug">สัญญา</span>
                <span className="font-mono text-primary tabular-nums">
                  {undeliverableLetter.contract.contractNumber}
                </span>
              </div>
            </div>

            <div>
              <label
                htmlFor="undeliverable-reason"
                className="text-xs font-medium text-muted-foreground mb-1.5 block leading-snug"
              >
                เหตุผลที่ส่งไม่ถึง (≥ 5 ตัวอักษร) *
              </label>
              <textarea
                id="undeliverable-reason"
                value={undeliverableReason}
                onChange={(e) => setUndeliverableReason(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring leading-snug"
                autoFocus
              />
              {undeliverableReason.length > 0 && !undeliverableValid && (
                <p className="text-[10px] text-destructive mt-1 leading-snug">
                  ต้องกรอกอย่างน้อย 5 ตัวอักษร
                </p>
              )}
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={closeUndeliverable}
                className="px-4 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={submitUndeliverable}
                disabled={!undeliverableValid || markUndeliverable.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {markUndeliverable.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    กำลังบันทึก...
                  </>
                ) : (
                  'บันทึก'
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
