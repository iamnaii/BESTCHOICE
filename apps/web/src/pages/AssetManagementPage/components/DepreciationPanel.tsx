import Modal from '@/components/ui/Modal';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, assetStatusMap } from '@/lib/status-badges';
import { Asset, categoryLabels, fmt } from '../types';

interface DetailRowProps {
  label: string;
  value: React.ReactNode;
}

function DetailRow({ label, value }: DetailRowProps) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

interface DepreciationPanelProps {
  asset: Asset | null;
  onClose: () => void;
}

export default function DepreciationPanel({ asset, onClose }: DepreciationPanelProps) {
  return (
    <Modal
      isOpen={!!asset}
      onClose={onClose}
      title="รายละเอียดสินทรัพย์"
      size="lg"
    >
      {asset && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <DetailRow label="รหัส" value={asset.assetCode} />
            <DetailRow label="ชื่อ" value={asset.name} />
            <DetailRow
              label="หมวดหมู่"
              value={categoryLabels[asset.category] ?? asset.category}
            />
            <DetailRow label="สาขา" value={asset.branch?.name ?? '-'} />
            <DetailRow label="ราคาทุน" value={`฿${fmt(asset.costValue)}`} />
            <DetailRow label="มูลค่าซาก" value={`฿${fmt(asset.salvageValue)}`} />
            <DetailRow label="อายุใช้งาน" value={`${asset.usefulLife} ปี`} />
            <DetailRow
              label="ค่าเสื่อมสะสม"
              value={`฿${fmt(asset.accumulatedDepreciation)}`}
            />
            <DetailRow
              label="มูลค่าสุทธิ"
              value={`฿${fmt(Number(asset.costValue) - Number(asset.accumulatedDepreciation))}`}
            />
            <DetailRow
              label="วันที่ซื้อ"
              value={asset.purchaseDate?.split('T')[0] ?? '-'}
            />
            <DetailRow
              label="สถานะ"
              value={(() => {
                const cfg = getStatusBadgeProps(asset.status, assetStatusMap);
                return (
                  <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">
                    {cfg.label}
                  </Badge>
                );
              })()}
            />
          </div>
          {asset.description && (
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">รายละเอียด</p>
              <p className="text-sm">{asset.description}</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
