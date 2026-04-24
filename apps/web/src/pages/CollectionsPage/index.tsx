import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import CollectionsKpiStrip from './components/CollectionsKpiStrip';
import CollectionsTabs from './components/CollectionsTabs';
import CollectionsFilters from './components/CollectionsFilters';

export type CollectionsTabKey = 'today' | 'followup' | 'promise' | 'approval' | 'all';

export default function CollectionsPage() {
  useDocumentTitle('ติดตามหนี้');
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<CollectionsTabKey>('today');
  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState('');

  const canSeeApproval = user?.role === 'OWNER' || user?.role === 'FINANCE_MANAGER';
  const showBranchFilter = user?.role === 'OWNER' || user?.role === 'FINANCE_MANAGER';

  const showFilters = activeTab === 'today' || activeTab === 'followup' || activeTab === 'promise';

  return (
    <div>
      <PageHeader title="ติดตามหนี้" subtitle="คิวงานของผู้ติดตามหนี้รายวัน" />

      <CollectionsKpiStrip />

      <CollectionsTabs
        active={activeTab}
        onChange={(key) => {
          setActiveTab(key);
          setSearch('');
          setBranchId('');
        }}
        canSeeApproval={canSeeApproval}
      />

      {showFilters && (
        <CollectionsFilters
          search={search}
          onSearchChange={setSearch}
          branchId={branchId}
          onBranchChange={setBranchId}
          showBranchFilter={showBranchFilter}
        />
      )}

      {/* Tab content placeholder — later tasks replace */}
      <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        <div className="mb-2 font-medium text-foreground">
          {activeTab === 'today' && 'คิววันนี้'}
          {activeTab === 'followup' && 'ตามต่อ'}
          {activeTab === 'promise' && 'นัดชำระ'}
          {activeTab === 'approval' && 'อนุมัติ'}
          {activeTab === 'all' && 'ทั้งหมด'}
        </div>
        <div>Tab content จะถูกเพิ่มใน Task 9-14</div>
      </div>
    </div>
  );
}
