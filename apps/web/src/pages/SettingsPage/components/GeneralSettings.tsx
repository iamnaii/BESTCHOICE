import { configGroups, SettingsCard } from './shared';

// Groups rendered before the company card
const PRE_COMPANY_KEYS = ['penalty', 'pdpa'];
// Groups rendered after the company card
const POST_COMPANY_KEYS = ['banking', 'payment_link'];

interface GeneralSettingsProps {
  values: Record<string, string>;
  editingSection: string | null;
  onEdit: (sectionKey: string) => void;
  onSave: (items: { key: string; value: string }[]) => void;
  onCancel: () => void;
  isSaving: boolean;
  /** 'pre' renders penalty+pdpa; 'post' renders banking+payment_link */
  slot: 'pre' | 'post';
}

// ── GeneralSettings: penalty, PDPA, banking, payment gateway configs ──

export default function GeneralSettings({
  values,
  editingSection,
  onEdit,
  onSave,
  onCancel,
  isSaving,
  slot,
}: GeneralSettingsProps) {
  const keys = slot === 'pre' ? PRE_COMPANY_KEYS : POST_COMPANY_KEYS;
  const groups = configGroups.filter((g) => keys.includes(g.key));

  return (
    <>
      {groups.map((group) => (
        <SettingsCard
          key={group.key}
          group={group}
          values={values}
          isEditing={editingSection === group.key}
          onEdit={() => onEdit(group.key)}
          onSave={onSave}
          onCancel={onCancel}
          isSaving={isSaving}
        />
      ))}
    </>
  );
}
