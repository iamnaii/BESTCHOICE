import { useState, useEffect } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import SystemSettings from './components/SystemSettings';
import CompanySettings from './components/CompanySettings';
import GeneralSettings from './components/GeneralSettings';
import type { ConfigItem } from './components/shared';

export default function SettingsPage() {
  useDocumentTitle('ตั้งค่า');
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [editingSection, setEditingSection] = useState<string | null>(null);

  const [draftSignatureImage, setDraftSignatureImage] = useState('');
  const [draftSignerName, setDraftSignerName] = useState('');

  const { data: configs = [], isLoading } = useQuery<ConfigItem[]>({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });

  useEffect(() => {
    if (configs.length > 0 && !editingSection) {
      const map: Record<string, string> = {};
      configs.forEach((c) => {
        map[c.key] = c.value;
      });
      setValues(map);
    }
  }, [configs]);

  const saveMutation = useMutation({
    mutationFn: async (items: { key: string; value: string }[]) =>
      api.patch('/settings', { items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('บันทึกสำเร็จ');
      setEditingSection(null);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const handleEdit = (sectionKey: string) => {
    if (editingSection && editingSection !== sectionKey) {
      toast.error('กรุณาบันทึกหรือยกเลิกการแก้ไขก่อน');
      return;
    }
    setEditingSection(sectionKey);
    if (sectionKey === 'company') {
      setDraftSignatureImage(values['lessor_signature_image'] || '');
      setDraftSignerName(values['lessor_signer_name'] || '');
    }
  };

  const handleCancel = () => setEditingSection(null);

  const handleSave = (items: { key: string; value: string }[]) => {
    let finalItems = items;
    if (editingSection === 'company') {
      finalItems = [
        ...items,
        { key: 'lessor_signature_image', value: draftSignatureImage },
        { key: 'lessor_signer_name', value: draftSignerName },
      ];
    }
    saveMutation.mutate(finalItems);
    const updated = { ...values };
    finalItems.forEach(({ key, value }) => {
      updated[key] = value;
    });
    setValues(updated);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="ตั้งค่าระบบ" subtitle="กำหนดพารามิเตอร์การทำงานของระบบ" />

      <div className="flex flex-col gap-5 lg:gap-7.5">
        <SystemSettings />

        {/* penalty + pdpa (match original configGroups order: penalty → pdpa → company → banking → payment_link) */}
        <GeneralSettings
          slot="pre"
          values={values}
          editingSection={editingSection}
          onEdit={handleEdit}
          onSave={handleSave}
          onCancel={handleCancel}
          isSaving={saveMutation.isPending}
        />

        <CompanySettings
          values={values}
          editingSection={editingSection}
          onEdit={handleEdit}
          onSave={handleSave}
          onCancel={handleCancel}
          isSaving={saveMutation.isPending}
          draftSignatureImage={draftSignatureImage}
          draftSignerName={draftSignerName}
          setDraftSignatureImage={setDraftSignatureImage}
          setDraftSignerName={setDraftSignerName}
        />

        {/* banking + payment_link */}
        <GeneralSettings
          slot="post"
          values={values}
          editingSection={editingSection}
          onEdit={handleEdit}
          onSave={handleSave}
          onCancel={handleCancel}
          isSaving={saveMutation.isPending}
        />
      </div>
    </div>
  );
}
