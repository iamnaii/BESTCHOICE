import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';

export type CollectionsTabKey = 'today' | 'followup' | 'promise' | 'approval' | 'all';

export default function CollectionsPage() {
  useDocumentTitle('ติดตามหนี้');
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<CollectionsTabKey>('today');

  const canSeeApproval = user?.role === 'OWNER' || user?.role === 'FINANCE_MANAGER';

  const tabs: Array<{ key: CollectionsTabKey; label: string; visible: boolean }> = [
    { key: 'today', label: 'คิววันนี้', visible: true },
    { key: 'followup', label: 'ตามต่อ', visible: true },
    { key: 'promise', label: 'นัดชำระ', visible: true },
    { key: 'approval', label: 'อนุมัติ', visible: canSeeApproval },
    { key: 'all', label: 'ทั้งหมด', visible: true },
  ];

  return (
    <div>
      <PageHeader title="ติดตามหนี้" subtitle="คิวงานของผู้ติดตามหนี้รายวัน" />

      {/* KPI strip placeholder — Task 6 replaces with CollectionsKpiStrip */}
      <div className="mb-6 rounded-xl border border-border/50 bg-muted/30 p-5 text-sm text-muted-foreground">
        KPI strip จะอยู่ที่นี่ (Task 6)
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border mb-4 overflow-x-auto">
        {tabs
          .filter((t) => t.visible)
          .map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === t.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
      </div>

      {/* Tab content placeholder — later tasks replace */}
      <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        <div className="mb-2 font-medium text-foreground">
          {tabs.find((t) => t.key === activeTab)?.label}
        </div>
        <div>Tab content จะถูกเพิ่มใน Task 9-14</div>
      </div>
    </div>
  );
}
