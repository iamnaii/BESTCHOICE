import { useSettingsEditor } from './hooks/useSettingsEditor';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import GeneralSettings from './components/GeneralSettings';

export default function GeneralSettingsPage() {
  useDocumentTitle('ตั้งค่าทั่วไป');
  const { values, editingSection, setEditingSection, saveMutation } = useSettingsEditor();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="ตั้งค่าทั่วไป"
        subtitle="บัญชีธนาคาร, PDPA และ payment gateway"
      />
      {/* pdpa */}
      <GeneralSettings
        values={values}
        editingSection={editingSection}
        onEdit={setEditingSection}
        onSave={(items) => saveMutation.mutate(items)}
        onCancel={() => setEditingSection(null)}
        isSaving={saveMutation.isPending}
        slot="pre"
      />
      {/* banking + payment_link */}
      <GeneralSettings
        values={values}
        editingSection={editingSection}
        onEdit={setEditingSection}
        onSave={(items) => saveMutation.mutate(items)}
        onCancel={() => setEditingSection(null)}
        isSaving={saveMutation.isPending}
        slot="post"
      />
    </div>
  );
}
