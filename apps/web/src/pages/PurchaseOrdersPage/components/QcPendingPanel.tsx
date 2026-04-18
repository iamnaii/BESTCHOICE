import { UseMutationResult } from '@tanstack/react-query';
import { ClipboardCheck, ChevronDown, ChevronRight } from 'lucide-react';

export interface QcPendingPanelProps {
  qcPendingItems: { productId: string; productName: string; imeiSerial?: string }[];
  showQcPanel: boolean;
  setShowQcPanel: (value: boolean) => void;
  qcNotes: Record<string, string>;
  setQcNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  qcConfirmMutation: UseMutationResult<unknown, unknown, { items: { productId: string; passed: boolean; notes?: string }[] }, unknown>;
}

export function QcPendingPanel({
  qcPendingItems,
  showQcPanel,
  setShowQcPanel,
  qcNotes,
  setQcNotes,
  qcConfirmMutation,
}: QcPendingPanelProps) {
  if (qcPendingItems.length === 0) return null;

  return (
    <div className="mb-4">
      <button
        onClick={() => setShowQcPanel(!showQcPanel)}
        className="flex items-center gap-2 px-4 py-2 bg-warning/5 dark:bg-warning/10 border border-warning/20 rounded-xl text-sm font-medium text-warning hover:bg-warning/10 dark:hover:bg-warning/15 transition-colors"
        aria-expanded={showQcPanel}
      >
        <ClipboardCheck className="size-4" />
        รอตรวจ QC
        <span className="px-2 py-0.5 bg-warning/10 text-warning dark:bg-warning/15 rounded-full text-xs font-bold">{qcPendingItems.length}</span>
        {showQcPanel ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
      </button>
      {showQcPanel && (
        <div className="mt-2 border border-warning/20 rounded-xl bg-warning/5 dark:bg-warning/10 p-4">
          <h3 className="text-sm font-semibold mb-3 text-warning">รายการรอตรวจ QC</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {qcPendingItems.map((item) => (
              <div key={item.productId} className="flex items-center gap-3 bg-card p-3 rounded-xl border border-border/60">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.productName}</p>
                  {item.imeiSerial && <p className="text-xs text-muted-foreground">IMEI: {item.imeiSerial}</p>}
                </div>
                <input
                  type="text"
                  placeholder="หมายเหตุ"
                  value={qcNotes[item.productId] || ''}
                  onChange={(e) => setQcNotes((prev) => ({ ...prev, [item.productId]: e.target.value }))}
                  className="px-2 py-1 border border-input rounded text-xs w-32"
                />
                <button
                  onClick={() => qcConfirmMutation.mutate({ items: [{ productId: item.productId, passed: true, notes: qcNotes[item.productId] || undefined }] })}
                  className="px-3 py-1 bg-success text-success-foreground rounded text-xs font-medium hover:bg-success/90"
                >
                  ผ่าน
                </button>
                <button
                  onClick={() => qcConfirmMutation.mutate({ items: [{ productId: item.productId, passed: false, notes: qcNotes[item.productId] || undefined }] })}
                  className="px-3 py-1 bg-destructive text-destructive-foreground rounded text-xs font-medium hover:bg-destructive/90"
                >
                  ไม่ผ่าน
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
