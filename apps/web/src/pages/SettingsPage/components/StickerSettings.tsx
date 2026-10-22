import { useId } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { DEFAULT_STICKER_SIZE, STICKER_SIZES, type StickerSize } from '@/pages/StickerPrintPage/StickerCard';
import { SettingsCard, StatCard } from './shared';
import type { ConfigGroup } from './shared';

const SECTION_KEY = 'sticker';
/** SystemConfig keys — อ่านกลับผ่าน GET /settings/ui-flags (`stickerSize` / `stickerShowQr`) */
const SIZE_KEY = 'sticker_size';
const QR_KEY = 'sticker_show_qr';

/**
 * ก้อน 3 A5 (2026-10-22): การ์ดนี้แทนค่าเริ่มต้นเรท 1/2 เดิม (`sticker.rate*`) ซึ่งไม่มีผลกับสติกเกอร์แล้ว
 * ตั้งแต่สติกเกอร์อ่านราคาจากตัวเครื่อง (PR #1575) — คีย์เดิมยังอยู่ในฐานข้อมูลให้บอทขายอ่าน ไม่ลบ
 */
const stickerGroup: ConfigGroup = {
  key: SECTION_KEY,
  title: 'สติกเกอร์ติดเครื่อง',
  subtitle: 'ขนาดม้วนที่หน้าพิมพ์สติกเกอร์ใช้ตั้งหน้ากระดาษ และ QR ของ IMEI/รหัสสินค้าบนดวง',
  items: [
    {
      key: SIZE_KEY,
      label: 'ขนาดม้วน',
      shortLabel: 'ขนาดม้วน',
      suffix: '',
      type: 'text',
      step: '',
      desc: 'ต้องตรงกับม้วนที่ใส่ในเครื่องพิมพ์ฉลาก',
    },
    {
      key: QR_KEY,
      label: 'พิมพ์ QR บนดวง',
      shortLabel: 'QR บนดวง',
      suffix: '',
      type: 'text',
      step: '',
      desc: 'เครื่องยิง 2D อ่าน IMEI หรือรหัสสินค้าได้ทันที',
    },
  ],
};

const normalizeSize = (raw: string | undefined): StickerSize =>
  raw && raw in STICKER_SIZES ? (raw as StickerSize) : DEFAULT_STICKER_SIZE;
/** ค่าว่าง (ยังไม่เคยตั้ง) = เปิด — กติกาเดียวกับ ui-flags ฝั่งเซิร์ฟเวอร์ */
const normalizeQr = (raw: string | undefined): boolean => raw !== 'false';

interface StickerSettingsProps {
  values: Record<string, string>;
  editingSection: string | null;
  onEdit: (sectionKey: string) => void;
  onSave: (items: { key: string; value: string }[]) => void;
  onCancel: () => void;
  isSaving: boolean;
}

export default function StickerSettings({
  values,
  editingSection,
  onEdit,
  onSave,
  onCancel,
  isSaving,
}: StickerSettingsProps) {
  const { user } = useAuth();
  const sizeId = useId();
  if (user?.role !== 'OWNER') return null;

  return (
    <SettingsCard
      group={stickerGroup}
      values={values}
      isEditing={editingSection === SECTION_KEY}
      onEdit={() => onEdit(SECTION_KEY)}
      // บันทึกเป็นค่าจริงเสมอ (ไม่ใช่ค่าว่าง) แม้เจ้าของไม่ได้แตะช่องนั้น
      onSave={(items) =>
        onSave(
          items.map((item) =>
            item.key === SIZE_KEY
              ? { key: SIZE_KEY, value: normalizeSize(item.value) }
              : item.key === QR_KEY
                ? { key: QR_KEY, value: normalizeQr(item.value) ? 'true' : 'false' }
                : item,
          ),
        )
      }
      onCancel={onCancel}
      isSaving={isSaving}
      renderView={(current) => {
        const size = normalizeSize(current[SIZE_KEY]);
        return (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <StatCard label="ขนาดม้วน" value={STICKER_SIZES[size].label} suffix="" desc={STICKER_SIZES[size].hint} />
            <StatCard
              label="QR บนดวง"
              value={normalizeQr(current[QR_KEY]) ? 'เปิด' : 'ปิด'}
              suffix=""
              desc="QR = IMEI ของเครื่อง หรือรหัสสินค้าของอุปกรณ์เสริม"
            />
          </div>
        );
      }}
      renderEdit={(draft, setDraft) => {
        const size = normalizeSize(draft[SIZE_KEY]);
        const qr = normalizeQr(draft[QR_KEY]);
        return (
          <>
            <div>
              <div className="flex items-center gap-4">
                <label htmlFor={sizeId} className="flex-1 text-sm text-foreground">
                  ขนาดม้วน
                </label>
                <select
                  id={sizeId}
                  value={size}
                  onChange={(e) => setDraft((prev) => ({ ...prev, [SIZE_KEY]: e.target.value }))}
                  className="w-48 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background"
                >
                  {(Object.keys(STICKER_SIZES) as StickerSize[]).map((key) => (
                    <option key={key} value={key}>
                      {STICKER_SIZES[key].label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ml-0.5 mt-1 text-xs text-muted-foreground/70 leading-snug">{STICKER_SIZES[size].hint}</div>
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={qr}
                  onChange={(e) => setDraft((prev) => ({ ...prev, [QR_KEY]: e.target.checked ? 'true' : 'false' }))}
                  className="size-4 accent-primary"
                />
                พิมพ์ QR บนดวง
              </label>
              <div className="ml-0.5 mt-1 text-xs text-muted-foreground/70 leading-snug">
                QR = IMEI ของเครื่อง หรือรหัสสินค้าของอุปกรณ์เสริม — ใช้กับเครื่องยิง 2D ที่หน้าขาย
              </div>
            </div>
          </>
        );
      }}
    />
  );
}
