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
        subtitle="ขนาดม้วนและ QR ของสติกเกอร์ติดเครื่อง — มีผลกับหน้าพิมพ์สติกเกอร์ทันที"
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
