import { DEFAULT_RECEIPT_WARRANTY_TERMS, RECEIPT_WARRANTY_TERMS_KEY } from '@installment/shared';
import PageHeader from '@/components/ui/PageHeader';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { SettingsCard } from './components/shared';
import type { ConfigGroup } from './components/shared';
import { useSettingsEditor } from './hooks/useSettingsEditor';

const SECTION_KEY = 'receipts';

/**
 * ใบเสร็จขายสด (ก้อน 4 · 2026-10-23): ข้อความเงื่อนไขประกันร้านท้ายใบเสร็จ A4 — เจ้าของแก้เองได้
 * (คำตัดสินเจ้าของ 23/10) · ค่าเริ่มต้นและคีย์อยู่ใน `@installment/shared` ตัวเดียวกับที่ API ใช้พิมพ์ PDF
 */
const receiptGroup: ConfigGroup = {
  key: SECTION_KEY,
  title: 'ข้อความท้ายใบเสร็จรับเงินขายสด',
  subtitle: 'พิมพ์ใต้บรรทัด "ประกันร้าน N วัน" บนใบเสร็จขายสดและใบเสร็จเงินดาวน์ไฟแนนซ์ภายนอก',
  items: [
    {
      key: RECEIPT_WARRANTY_TERMS_KEY,
      label: 'เงื่อนไขประกันร้านท้ายใบเสร็จ',
      shortLabel: 'เงื่อนไขประกัน',
      suffix: '',
      type: 'text',
      step: '',
      desc: `ค่าเริ่มต้น: ${DEFAULT_RECEIPT_WARRANTY_TERMS}`,
    },
  ],
};

export default function ReceiptsSettingsPage() {
  useDocumentTitle('ตั้งค่าใบเสร็จขายสด');
  const { values, editingSection, setEditingSection, saveMutation } = useSettingsEditor();

  return (
    <div>
      <PageHeader
        title="ตั้งค่าใบเสร็จขายสด"
        subtitle="ใบเสร็จรับเงิน A4 ของการขายสดและขายผ่านไฟแนนซ์ภายนอก — เว้นว่างเพื่อใช้ข้อความเริ่มต้น"
      />
      <SettingsCard
        group={receiptGroup}
        values={values}
        isEditing={editingSection === SECTION_KEY}
        onEdit={() => setEditingSection(SECTION_KEY)}
        onSave={(items) => saveMutation.mutate(items)}
        onCancel={() => setEditingSection(null)}
        isSaving={saveMutation.isPending}
      />
    </div>
  );
}
