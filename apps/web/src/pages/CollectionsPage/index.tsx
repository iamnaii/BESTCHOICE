import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import CollectionsKpiStrip from './components/CollectionsKpiStrip';
import CollectionsTabs from './components/CollectionsTabs';
import CollectionsFilters from './components/CollectionsFilters';
import ContactLogDialog from './components/ContactLogDialog';
import QueueTab from './tabs/QueueTab';
import FollowUpTab from './tabs/FollowUpTab';
import PromiseTab from './tabs/PromiseTab';
import AllTab from './tabs/AllTab';
import type { ContractRow } from './types';

export type CollectionsTabKey = 'today' | 'followup' | 'promise' | 'approval' | 'all';

export default function CollectionsPage() {
  useDocumentTitle('ติดตามหนี้');
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<CollectionsTabKey>('today');
  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState('');
  const [dialogContract, setDialogContract] = useState<ContractRow | null>(null);

  const canSeeApproval = user?.role === 'OWNER' || user?.role === 'FINANCE_MANAGER';
  const showBranchFilter = user?.role === 'OWNER' || user?.role === 'FINANCE_MANAGER';

  const showFilters = activeTab === 'today' || activeTab === 'followup' || activeTab === 'promise';

  const openContactDialog = (c: ContractRow) => setDialogContract(c);

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

      {activeTab === 'today' && (
        <QueueTab search={search} branchId={branchId} onLogContact={openContactDialog} />
      )}

      {activeTab === 'followup' && (
        <FollowUpTab search={search} branchId={branchId} onLogContact={openContactDialog} />
      )}

      {activeTab === 'promise' && (
        <PromiseTab search={search} branchId={branchId} onLogContact={openContactDialog} />
      )}

      {activeTab === 'approval' && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          <div className="mb-2 font-medium text-foreground">อนุมัติ</div>
          <div>Tab content จะถูกเพิ่มใน Task 12-13</div>
        </div>
      )}

      {activeTab === 'all' && <AllTab />}

      <ContactLogDialog
        open={!!dialogContract}
        contract={dialogContract}
        onClose={() => setDialogContract(null)}
      />
    </div>
  );
}
