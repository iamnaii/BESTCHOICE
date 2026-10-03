import { useSettingsEditor } from './hooks/useSettingsEditor';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import StickerSettings from './components/StickerSettings';

export default function StickersPage() {
  useDocumentTitle('ตั้งค่าสติกเกอร์');
  const { values, editingSection, setEditingSection, saveMutation } = useSettingsEditor();

  return (
    <div>
      <PageHeader
        title="ตั้งค่าสติกเกอร์"
        subtitle="ค่า default สติกเกอร์ติดเครื่องเมื่อ PricingTemplate ไม่ได้ override"
      />
      <StickerSettings
        values={values}
        editingSection={editingSection}
        onEdit={setEditingSection}
        onSave={(items) => saveMutation.mutate(items)}
        onCancel={() => setEditingSection(null)}
        isSaving={saveMutation.isPending}
      />
    </div>
  );
}
