import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import CollectionsKpiStrip from './components/CollectionsKpiStrip';
import CollectionsTabs from './components/CollectionsTabs';
import CollectionsFilters from './components/CollectionsFilters';
import ContactLogDialog from './components/ContactLogDialog';
import Customer360Panel from './components/Customer360Panel';
import QueueTab from './tabs/QueueTab';
import FollowUpTab from './tabs/FollowUpTab';
import PromiseTab from './tabs/PromiseTab';
import AllTab from './tabs/AllTab';
import ApprovalTab from './tabs/ApprovalTab';
import type { ContractRow } from './types';

export type CollectionsTabKey = 'today' | 'followup' | 'promise' | 'approval' | 'all';

export default function CollectionsPage() {
  useDocumentTitle('ติดตามหนี้');
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<CollectionsTabKey>('today');
  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState('');
  const [dialogContract, setDialogContract] = useState<ContractRow | null>(null);
  const [panelContract, setPanelContract] = useState<ContractRow | null>(null);

  const canSeeApproval = user?.role === 'OWNER' || user?.role === 'FINANCE_MANAGER';
  const showBranchFilter = user?.role === 'OWNER' || user?.role === 'FINANCE_MANAGER';

  const showFilters = activeTab === 'today' || activeTab === 'followup' || activeTab === 'promise';

  const openContactDialog = (c: ContractRow) => setDialogContract(c);
  const openPanel = (c: ContractRow) => setPanelContract(c);
  const closePanel = () => setPanelContract(null);

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
        <QueueTab
          search={search}
          branchId={branchId}
          onLogContact={openContactDialog}
          onOpen360={openPanel}
        />
      )}

      {activeTab === 'followup' && (
        <FollowUpTab
          search={search}
          branchId={branchId}
          onLogContact={openContactDialog}
          onOpen360={openPanel}
        />
      )}

      {activeTab === 'promise' && (
        <PromiseTab
          search={search}
          branchId={branchId}
          onLogContact={openContactDialog}
          onOpen360={openPanel}
        />
      )}

      {activeTab === 'approval' && canSeeApproval && <ApprovalTab />}

      {activeTab === 'all' && <AllTab />}

      <ContactLogDialog
        open={!!dialogContract}
        contract={dialogContract}
        onClose={() => setDialogContract(null)}
      />

      <Customer360Panel contract={panelContract} onClose={closePanel} />
    </div>
  );
}
