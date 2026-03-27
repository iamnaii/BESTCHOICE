import { UseMutationResult } from '@tanstack/react-query';

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
        className="flex items-center gap-2 px-4 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-sm font-medium text-yellow-800 hover:bg-yellow-100 transition-colors"
      >
        รอตรวจ QC
        <span className="px-2 py-0.5 bg-yellow-200 text-yellow-900 rounded-full text-xs font-bold">{qcPendingItems.length}</span>
      </button>
      {showQcPanel && (
        <div className="mt-2 border border-yellow-200 rounded-lg bg-yellow-50/50 p-4">
          <h3 className="text-sm font-semibold mb-3 text-yellow-900">รายการรอตรวจ QC</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {qcPendingItems.map((item) => (
              <div key={item.productId} className="flex items-center gap-3 bg-white p-3 rounded-lg border">
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
                  className="px-3 py-1 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700"
                >
                  ผ่าน
                </button>
                <button
                  onClick={() => qcConfirmMutation.mutate({ items: [{ productId: item.productId, passed: false, notes: qcNotes[item.productId] || undefined }] })}
                  className="px-3 py-1 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700"
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
