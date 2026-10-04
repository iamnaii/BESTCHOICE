import { useSettingsEditor } from '../hooks/useSettingsEditor';
import { useState } from 'react';
import CompanySettings from '../components/CompanySettings';

export function CompanyTab() {
  const { values, editingSection, setEditingSection, saveMutation } = useSettingsEditor();
  const [draftSignatureImage, setDraftSignatureImage] = useState('');
  const [draftSignerName, setDraftSignerName] = useState('');

  const handleSave = (items: { key: string; value: string }[]) => {
    const finalItems = [
      ...items,
      { key: 'lessor_signature_image', value: draftSignatureImage },
      { key: 'lessor_signer_name', value: draftSignerName },
    ];
    saveMutation.mutate(finalItems);
  };

  const handleEdit = (sectionKey: string) => {
    setEditingSection(sectionKey);
    setDraftSignatureImage(values['lessor_signature_image'] || '');
    setDraftSignerName(values['lessor_signer_name'] || '');
  };

  return (
    <CompanySettings
      values={values}
      editingSection={editingSection}
      onEdit={handleEdit}
      onSave={handleSave}
      onCancel={() => setEditingSection(null)}
      isSaving={saveMutation.isPending}
      draftSignatureImage={draftSignatureImage}
      draftSignerName={draftSignerName}
      setDraftSignatureImage={setDraftSignatureImage}
      setDraftSignerName={setDraftSignerName}
    />
  );
}
