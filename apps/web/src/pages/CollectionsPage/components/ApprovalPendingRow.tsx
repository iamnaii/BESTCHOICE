import { useState } from 'react';
import { CheckCircle, XCircle, Unlock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useUnlockMdm } from '../hooks/useApprovalQueues';
import { WallpaperPreview } from './WallpaperPreview';
import type { PendingEscalation, PendingMdmRequest } from '../types';

/* ── helpers ─────────────────────────────────────────────────── */

function daysSince(iso: string): number {
  const diff = Date.now() - new Date(iso).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function heatStrip(proposedAt: string): string {
  const d = daysSince(proposedAt);
  if (d >= 2) return 'bg-destructive';
  if (d >= 1) return 'bg-warning';
  return 'bg-primary';
}

function staleLabel(iso: string): string {
  const d = daysSince(iso);
  if (d === 0) return 'วันนี้';
  if (d === 1) return 'เมื่อวาน';
  return `${d} วันที่แล้ว`;
}

/* ── Reject reason modal ─────────────────────────────────────── */

interface RejectDialogProps {
  open: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  pending: boolean;
}

function RejectDialog({ open, onConfirm, onCancel, pending }: RejectDialogProps) {
  const [reason, setReason] = useState('');
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-xl p-6 mx-4">
        <h3 className="text-sm font-semibold mb-3 leading-snug">ระบุเหตุผลการปฏิเสธ</h3>
        <textarea
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring leading-snug"
          rows={3}
          placeholder="เหตุผลอย่างน้อย 5 ตัวอักษร..."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
        />
        <div className="flex gap-2 mt-3 justify-end">
          <button
            onClick={onCancel}
            className="rounded-lg border border-input px-4 py-1.5 text-sm hover:bg-muted transition-colors"
          >
            ยกเลิก
          </button>
          <button
            disabled={reason.trim().length < 5 || pending}
            onClick={() => onConfirm(reason.trim())}
            className="rounded-lg bg-destructive px-4 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
          >
            {pending ? 'กำลังส่ง...' : 'ยืนยันปฏิเสธ'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Escalation Row ─────────────────────────────────────────── */

interface EscalationRowProps {
  item: PendingEscalation;
  onApprove: (contractId: string) => void;
  onReject: (contractId: string, reason: string) => void;
  approvePending: boolean;
  rejectPending: boolean;
}

export function EscalationRow({
  item,
  onApprove,
  onReject,
  approvePending,
  rejectPending,
}: EscalationRowProps) {
  const [showReject, setShowReject] = useState(false);

  const stageLabelMap: Record<string, string> = {
    FINAL_WARNING: 'อนุมัติเตือนครั้งสุดท้าย',
    LEGAL_ACTION: 'อนุมัติดำเนินคดี',
  };
  const stageLabel = stageLabelMap[item.pendingDunningStage] ?? item.pendingDunningStage;
  const chipVariant =
    item.pendingDunningStage === 'LEGAL_ACTION'
      ? 'bg-destructive/10 text-destructive'
      : 'bg-warning/10 text-warning';

  return (
    <>
      <div className="relative flex rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
        <div className={cn('w-1 shrink-0', heatStrip(item.pendingDunningSince))} />
        <div className="flex-1 p-4 min-w-0">
          {/* action chip + contract# */}
          <div className="flex items-start justify-between gap-3 mb-1.5">
            <div className="min-w-0">
              <span
                className={cn(
                  'inline-flex items-center rounded-full text-2xs font-semibold px-2 py-0.5 leading-snug mb-1',
                  chipVariant,
                )}
              >
                {stageLabel}
              </span>
              <div className="font-mono text-xs text-primary font-medium">
                {item.contractNumber}
              </div>
              <div className="text-sm font-semibold leading-snug truncate">{item.customer.name}</div>
            </div>
            <div className="text-right shrink-0 text-2xs text-muted-foreground leading-snug whitespace-nowrap">
              {staleLabel(item.pendingDunningSince)}
            </div>
          </div>

          {/* Stage transition */}
          <div className="text-2xs text-muted-foreground leading-snug mb-3">
            {item.dunningStage} <span className="mx-1">→</span>{' '}
            <span className="font-semibold text-foreground">{item.pendingDunningStage}</span>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setShowReject(true)}
              disabled={rejectPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
            >
              <XCircle className="size-3.5" /> ปฏิเสธ
            </button>
            <button
              onClick={() => onApprove(item.id)}
              disabled={approvePending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <CheckCircle className="size-3.5" /> อนุมัติ
            </button>
          </div>
        </div>
      </div>

      <RejectDialog
        open={showReject}
        pending={rejectPending}
        onCancel={() => setShowReject(false)}
        onConfirm={(reason) => {
          onReject(item.id, reason);
          setShowReject(false);
        }}
      />
    </>
  );
}

/* ── Unlock confirm dialog ───────────────────────────────────── */

interface UnlockDialogProps {
  open: boolean;
  customerName: string;
  contractNumber: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function UnlockDialog({
  open,
  customerName,
  contractNumber,
  pending,
  onConfirm,
  onCancel,
}: UnlockDialogProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-xl p-6 mx-4">
        <h3 className="text-sm font-semibold mb-2 leading-snug">ยืนยันปลดล็อคเครื่อง?</h3>
        <p className="text-xs text-muted-foreground leading-snug mb-4">
          ลูกค้า <span className="text-foreground font-medium">{customerName}</span>{' '}
          (สัญญา {contractNumber}) จะใช้เครื่องได้ทันที
        </p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="rounded-lg border border-input px-4 py-1.5 text-sm hover:bg-muted transition-colors"
          >
            ยกเลิก
          </button>
          <button
            disabled={pending}
            onClick={onConfirm}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {pending ? 'กำลังปลดล็อค...' : 'ยืนยันปลดล็อค'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── MDM Row ─────────────────────────────────────────────────── */

interface MdmRowProps {
  item: PendingMdmRequest;
  /**
   * Approver action. `opts.includeWallpaper` (optional) overrides the
   * proposer's choice. When omitted backend falls back to proposer's value.
   */
  onApprove: (requestId: string, opts?: { includeWallpaper?: boolean }) => void;
  onReject: (requestId: string, reason: string) => void;
  approvePending: boolean;
  rejectPending: boolean;
}

/**
 * Fetches the MDM wallpaper URL from SystemConfig for the approve dialog
 * preview. Returns null when the setting is not yet configured. Cached for
 * 5 minutes — the URL changes rarely.
 *
 * Uses the shared `/settings` endpoint (same source DunningSettingsPage writes
 * to) so preview matches what the OWNER configured.
 */
function useWallpaperUrl(enabled: boolean): string | null {
  const { data } = useQuery<Array<{ key: string; value: string | null }>>({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data ?? [],
    enabled,
    staleTime: 5 * 60 * 1000,
  });
  const entry = data?.find((s) => s.key === 'mdm_lock_wallpaper_url');
  return entry?.value && entry.value.length > 0 ? entry.value : null;
}

export function MdmRow({ item, onApprove, onReject, approvePending, rejectPending }: MdmRowProps) {
  const [showReject, setShowReject] = useState(false);
  const [showUnlockConfirm, setShowUnlockConfirm] = useState(false);
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [includeWallpaper, setIncludeWallpaper] = useState<boolean>(item.includeWallpaper);

  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const isLocked = item.status === 'EXECUTED_MANUAL' || item.status === 'EXECUTED_API' || item.status === 'LOCKED';
  const canUnlock = isOwner && isLocked;
  const unlock = useUnlockMdm();

  const wallpaperUrl = useWallpaperUrl(showApproveDialog);

  const actionLabel =
    'เสนอล็อคเครื่อง' + (item.includeWallpaper ? ' + wallpaper' : '');

  return (
    <>
      <div className="relative flex rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
        <div className={cn('w-1 shrink-0', heatStrip(item.proposedAt))} />
        <div className="flex-1 p-4 min-w-0">
          {/* action chip + contract# */}
          <div className="flex items-start justify-between gap-3 mb-1.5">
            <div className="min-w-0">
              <span className="inline-flex items-center rounded-full text-2xs font-semibold px-2 py-0.5 leading-snug mb-1 bg-destructive/10 text-destructive">
                {actionLabel}
              </span>
              <div className="font-mono text-xs text-primary font-medium">
                {item.contract.contractNumber}
              </div>
              <div className="text-sm font-semibold leading-snug truncate">
                {item.contract.customer.name}
              </div>
            </div>
            <div className="text-right shrink-0 text-2xs text-muted-foreground leading-snug whitespace-nowrap">
              {staleLabel(item.proposedAt)}
            </div>
          </div>

          {/* reason + proposer */}
          <div className="text-2xs text-muted-foreground leading-snug mb-1 line-clamp-2">
            {item.reason}
          </div>
          <div className="text-2xs text-muted-foreground leading-snug mb-3">
            เสนอโดย{' '}
            <span className="font-medium text-foreground">{item.proposedBy.name}</span>
            {' · '}
            {item.contract.branch.name}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2">
            {!isLocked && (
              <>
                <button
                  onClick={() => setShowReject(true)}
                  disabled={rejectPending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
                >
                  <XCircle className="size-3.5" /> ปฏิเสธ
                </button>
                <button
                  onClick={() => {
                    setIncludeWallpaper(item.includeWallpaper);
                    setShowApproveDialog(true);
                  }}
                  disabled={approvePending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
                >
                  <CheckCircle className="size-3.5" /> อนุมัติล็อค
                </button>
              </>
            )}
            {canUnlock && (
              <button
                onClick={() => setShowUnlockConfirm(true)}
                disabled={unlock.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted text-foreground disabled:opacity-50 transition-colors"
              >
                <Unlock className="size-3.5" />
                {unlock.isPending ? 'กำลังปลดล็อค...' : 'ปลดล็อค'}
              </button>
            )}
          </div>
        </div>
      </div>

      <RejectDialog
        open={showReject}
        pending={rejectPending}
        onCancel={() => setShowReject(false)}
        onConfirm={(reason) => {
          onReject(item.id, reason);
          setShowReject(false);
        }}
      />

      <UnlockDialog
        open={showUnlockConfirm}
        customerName={item.contract.customer.name}
        contractNumber={item.contract.contractNumber}
        pending={unlock.isPending}
        onCancel={() => setShowUnlockConfirm(false)}
        onConfirm={() => {
          unlock.mutate(item.id);
          setShowUnlockConfirm(false);
        }}
      />

      {showApproveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl p-6 mx-4">
            <h3 className="text-sm font-semibold mb-1 leading-snug">อนุมัติล็อคเครื่อง</h3>
            <p className="text-xs text-muted-foreground leading-snug mb-4">
              สัญญา {item.contract.contractNumber} • ลูกค้า{' '}
              <span className="text-foreground">{item.contract.customer.name}</span>
            </p>

            <div className="mb-4">
              <WallpaperPreview
                wallpaperUrl={wallpaperUrl}
                checked={includeWallpaper && !!wallpaperUrl}
                onChange={setIncludeWallpaper}
              />
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowApproveDialog(false)}
                className="rounded-lg border border-input px-4 py-1.5 text-sm hover:bg-muted transition-colors"
              >
                ยกเลิก
              </button>
              <button
                disabled={approvePending}
                onClick={() => {
                  const effective = includeWallpaper && !!wallpaperUrl;
                  onApprove(item.id, { includeWallpaper: effective });
                  setShowApproveDialog(false);
                }}
                className="rounded-lg bg-destructive px-4 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
              >
                {approvePending ? 'กำลังอนุมัติ...' : 'ยืนยันอนุมัติ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
