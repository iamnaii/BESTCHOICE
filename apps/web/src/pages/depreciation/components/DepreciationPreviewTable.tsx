// Depreciation module — preview table (Phase 2)
// Per-asset rows with monthly depreciation + Dr/Cr account codes.

import Decimal from 'decimal.js';
import { formatNumberDecimal } from '@/utils/formatters';
import type { DepreciationPreview } from '../types';

export function DepreciationPreviewTable({ preview }: { preview: DepreciationPreview }) {
  if (preview.lines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        ไม่มีสินทรัพย์ที่ต้องคิดค่าเสื่อมในงวดนี้
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 px-2">รหัสสินทรัพย์</th>
            <th className="text-left py-2 px-2">ชื่อ</th>
            <th className="text-right py-2 px-2">ค่าเสื่อม/เดือน</th>
            <th className="text-left py-2 px-2">Dr</th>
            <th className="text-left py-2 px-2">Cr</th>
          </tr>
        </thead>
        <tbody>
          {preview.lines.map((l) => (
            <tr key={l.assetId} className="border-b border-border">
              <td className="py-2 px-2 font-mono">{l.assetCode}</td>
              <td className="py-2 px-2">{l.assetName}</td>
              <td className="py-2 px-2 text-right tabular-nums">
                {formatNumberDecimal(new Decimal(l.monthlyDepr).toNumber())}
              </td>
              <td className="py-2 px-2 font-mono text-xs">{l.drAccount}</td>
              <td className="py-2 px-2 font-mono text-xs">{l.crAccount}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td colSpan={2} className="py-2 px-2">
              รวม ({preview.assetCount} สินทรัพย์)
            </td>
            <td className="py-2 px-2 text-right tabular-nums">
              {formatNumberDecimal(new Decimal(preview.totalAmount).toNumber())}
            </td>
            <td colSpan={2} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
