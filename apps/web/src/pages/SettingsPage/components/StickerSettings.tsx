import { useAuth } from '@/contexts/AuthContext';
import { SettingsCard } from './shared';
import type { ConfigGroup } from './shared';

const SECTION_KEY = 'sticker';

const stickerGroup: ConfigGroup = {
  key: SECTION_KEY,
  title: "ค่าเริ่มต้น สติกเกอร์ติดเครื่อง",
  subtitle: "ใช้เมื่อรุ่นสินค้ายังไม่ได้กำหนดเงินดาวน์หรือจำนวนงวดเฉพาะ",
  items: [
    {
      key: 'sticker.rate1.defaultDown',
      label: "ดาวน์เรทที่ 1 ค่าเริ่มต้น (บาท)",
      shortLabel: 'ดาวน์ เรท 1',
      suffix: ' บาท',
      type: 'number',
      step: '1',
      desc: 'ยอดดาวน์ default สำหรับเรทที่ 1',
    },
    {
      key: 'sticker.rate1.defaultTerm',
      label: "จำนวนเดือนเรทที่ 1 ค่าเริ่มต้น",
      shortLabel: 'เดือน เรท 1',
      suffix: ' เดือน',
      type: 'number',
      step: '1',
      desc: 'จำนวนงวด default สำหรับเรทที่ 1',
    },
    {
      key: 'sticker.rate2.defaultDown',
      label: "ดาวน์เรทที่ 2 ค่าเริ่มต้น (บาท)",
      shortLabel: 'ดาวน์ เรท 2',
      suffix: ' บาท',
      type: 'number',
      step: '1',
      desc: 'ยอดดาวน์ default สำหรับเรทที่ 2',
    },
    {
      key: 'sticker.rate2.defaultTerm',
      label: "จำนวนเดือนเรทที่ 2 ค่าเริ่มต้น",
      shortLabel: 'เดือน เรท 2',
      suffix: ' เดือน',
      type: 'number',
      step: '1',
      desc: 'จำนวนงวด default สำหรับเรทที่ 2',
    },
  ],
};

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
  if (user?.role !== 'OWNER') return null;

  return (
    <SettingsCard
      group={stickerGroup}
      values={values}
      isEditing={editingSection === SECTION_KEY}
      onEdit={() => onEdit(SECTION_KEY)}
      onSave={onSave}
      onCancel={onCancel}
      isSaving={isSaving}
    />
  );
}
