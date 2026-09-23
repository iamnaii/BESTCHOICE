import type { LookupResult } from './after-sales';

type PurchasePhotoAngle = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

const ANGLES: PurchasePhotoAngle[] = ['front', 'back', 'left', 'right', 'top', 'bottom'];
const ANGLE_LABEL: Record<PurchasePhotoAngle, string> = {
  front: 'หน้า',
  back: 'หลัง',
  left: 'ซ้าย',
  right: 'ขวา',
  top: 'บน',
  bottom: 'ล่าง',
};

interface PurchasePhotoStripProps {
  photos: LookupResult['purchasePhotos'];
}

/** รูปตอนซื้อ 6 มุม — ระบบบันทึกจากตอนรับเข้าสต๊อกให้อัตโนมัติ ใช้เทียบกับสภาพเครื่องตอนรับฝากซ่อม */
export default function PurchasePhotoStrip({ photos }: PurchasePhotoStripProps) {
  const allEmpty = !photos || ANGLES.every((angle) => !photos[angle]);

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold leading-snug text-muted-foreground">
        รูปตอนซื้อ — 6 มุมที่ถ่ายตอนรับเข้าสต๊อก (ระบบบันทึกติดเคสให้)
      </div>
      {allEmpty ? (
        <p className="text-sm leading-snug text-muted-foreground">
          ไม่มีรูปตอนซื้อ (เช่น เครื่องใหม่ซีล) — เทียบไม่ได้
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {ANGLES.map((angle) => {
            const src = photos?.[angle] ?? null;
            return (
              <div key={angle} className="space-y-1 text-center">
                {src ? (
                  <img
                    src={src}
                    alt={`รูปตอนซื้อ มุม${ANGLE_LABEL[angle]}`}
                    className="h-16 w-full rounded-lg border border-border object-cover"
                  />
                ) : (
                  <div className="flex h-16 w-full items-center justify-center rounded-lg border border-dashed border-border bg-muted text-xs leading-snug text-muted-foreground">
                    ไม่มี
                  </div>
                )}
                <div className="text-xs leading-snug text-muted-foreground">
                  {ANGLE_LABEL[angle]}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
