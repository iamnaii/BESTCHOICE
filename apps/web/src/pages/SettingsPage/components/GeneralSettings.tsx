import { configGroups, SettingsCard } from './shared';

// Groups rendered before the company card.
// NOTE: 'penalty' moved to the dedicated LateFeeSettingsCard (registry: finance ›
// late-fee) which adds late_fee_mode + PER_DAY fields. Keep it OUT of here so
// there's a single editor for those keys.
const PRE_COMPANY_KEYS = ['pdpa'];
// Groups rendered after the company card
const POST_COMPANY_KEYS = ['banking', 'payment_link'];

interface GeneralSettingsProps {
  values: Record<string, string>;
  editingSection: string | null;
  onEdit: (sectionKey: string) => void;
  onSave: (items: { key: string; value: string }[]) => void;
  onCancel: () => void;
  isSaving: boolean;
  /** 'pre' renders pdpa; 'post' renders banking+payment_link */
  slot: 'pre' | 'post';
}

// ── GeneralSettings: PDPA, banking, payment gateway configs ──
// (late-fee / installment-terms moved to LateFeeSettingsCard — finance › late-fee)

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
