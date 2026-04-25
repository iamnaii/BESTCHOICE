import { Phone, Clock, Calendar, ClipboardCheck, List, BarChart3 } from 'lucide-react';
import type { CollectionsTabKey } from '../index';

interface Props {
  active: CollectionsTabKey;
  onChange: (key: CollectionsTabKey) => void;
  canSeeApproval: boolean;
  canSeeAnalytics?: boolean;
  counts?: Partial<Record<CollectionsTabKey, number>>;
}

const TAB_CONFIG: Array<{
  key: CollectionsTabKey;
  label: string;
  Icon: React.ElementType;
}> = [
  { key: 'today', label: 'คิววันนี้', Icon: Phone },
  { key: 'followup', label: 'ตามต่อ', Icon: Clock },
  { key: 'promise', label: 'นัดชำระ', Icon: Calendar },
  { key: 'approval', label: 'อนุมัติ', Icon: ClipboardCheck },
  { key: 'all', label: 'ทั้งหมด', Icon: List },
  { key: 'analytics', label: 'วิเคราะห์', Icon: BarChart3 },
];

export default function CollectionsTabs({
  active,
  onChange,
  canSeeApproval,
  canSeeAnalytics = canSeeApproval,
  counts,
}: Props) {
  const visibleTabs = TAB_CONFIG.filter((t) => {
    if (t.key === 'approval') return canSeeApproval;
    if (t.key === 'analytics') return canSeeAnalytics;
    return true;
  });

  return (
    <div className="flex gap-0 border-b border-border mb-4 overflow-x-auto">
      {visibleTabs.map(({ key, label, Icon }) => {
        const count = counts?.[key];
        const isActive = active === key;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 transition-colors whitespace-nowrap ${
              isActive
                ? 'border-primary text-primary font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="size-4 shrink-0" />
            {label}
            {count != null && count > 0 && (
              <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-2xs tabular-nums leading-none">
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
