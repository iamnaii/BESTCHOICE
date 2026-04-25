import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import CollectionsKpiStrip from './components/CollectionsKpiStrip';
import CollectionsTabs from './components/CollectionsTabs';
import CollectionsFilters from './components/CollectionsFilters';
import ContactLogDialog from './components/ContactLogDialog';
import Customer360Panel from './components/Customer360Panel';
import MigrationBanner from './components/MigrationBanner';
import SendLineAdHocDialog from './components/SendLineAdHocDialog';
import QueueTab from './tabs/QueueTab';
import FollowUpTab from './tabs/FollowUpTab';
import PromiseTab from './tabs/PromiseTab';
import AllTab from './tabs/AllTab';
import ApprovalTab from './tabs/ApprovalTab';
import AnalyticsTab from './tabs/AnalyticsTab';
import type { ContractRow } from './types';

export type CollectionsTabKey = 'today' | 'followup' | 'promise' | 'approval' | 'all' | 'analytics';

/**
 * Role-based access for tabs. Empty array = all authenticated roles.
 * Previously SALES/ACCOUNTANT could click Approval/Analytics and get silent
 * 403s — now gated at the tab bar so the tab never renders.
 */
const TAB_ROLE_ACCESS: Record<CollectionsTabKey, string[]> = {
  today: [],
  followup: [],
  promise: [],
  all: [],
  approval: ['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER'],
  analytics: ['OWNER', 'FINANCE_MANAGER'],
};

function canAccessTab(key: CollectionsTabKey, role: string | undefined): boolean {
  const allowed = TAB_ROLE_ACCESS[key];
  if (!allowed || allowed.length === 0) return true;
  return !!role && allowed.includes(role);
}

export default function CollectionsPage() {
  useDocumentTitle('ติดตามหนี้');
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<CollectionsTabKey>('today');
  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState('');
  const [dialogContract, setDialogContract] = useState<ContractRow | null>(null);
  const [panelContract, setPanelContract] = useState<ContractRow | null>(null);
  const [lineDialogContract, setLineDialogContract] = useState<ContractRow | null>(null);

  const canSeeApproval = canAccessTab('approval', user?.role);
  const canSeeAnalytics = canAccessTab('analytics', user?.role);
  const showBranchFilter = user?.role === 'OWNER' || user?.role === 'FINANCE_MANAGER';

  // Safety net: if the active tab is role-gated and user lost access mid-session,
  // fall back to the default tab instead of rendering nothing.
  const effectiveTab: CollectionsTabKey = canAccessTab(activeTab, user?.role) ? activeTab : 'today';

  const showFilters = effectiveTab === 'today' || effectiveTab === 'followup' || effectiveTab === 'promise';

  const openContactDialog = (c: ContractRow) => setDialogContract(c);
  const openPanel = (c: ContractRow) => setPanelContract(c);
  const closePanel = () => setPanelContract(null);

  return (
    <div>
      <PageHeader title="ติดตามหนี้" subtitle="คิวงานของผู้ติดตามหนี้รายวัน" />

      <MigrationBanner />

      <CollectionsKpiStrip />

      <CollectionsTabs
        active={effectiveTab}
        onChange={(key) => {
          setActiveTab(key);
          setSearch('');
          setBranchId('');
        }}
        canSeeApproval={canSeeApproval}
        canSeeAnalytics={canSeeAnalytics}
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

      {effectiveTab === 'today' && (
        <QueueTab
          search={search}
          branchId={branchId}
          onLogContact={openContactDialog}
          onOpen360={openPanel}
          onSendLine={setLineDialogContract}
          onSwitchTab={(tab) => setActiveTab(tab as CollectionsTabKey)}
        />
      )}

      {effectiveTab === 'followup' && (
        <FollowUpTab
          search={search}
          branchId={branchId}
          onLogContact={openContactDialog}
          onOpen360={openPanel}
          onSendLine={setLineDialogContract}
        />
      )}

      {effectiveTab === 'promise' && (
        <PromiseTab
          search={search}
          branchId={branchId}
          onLogContact={openContactDialog}
          onOpen360={openPanel}
          onSendLine={setLineDialogContract}
        />
      )}

      {effectiveTab === 'approval' && canSeeApproval && <ApprovalTab />}

      {effectiveTab === 'all' && <AllTab />}

      {effectiveTab === 'analytics' && canSeeAnalytics && <AnalyticsTab />}

      <ContactLogDialog
        open={!!dialogContract}
        contract={dialogContract}
        onClose={() => setDialogContract(null)}
      />

      <SendLineAdHocDialog
        open={!!lineDialogContract}
        contract={lineDialogContract}
        onClose={() => setLineDialogContract(null)}
      />

      <Customer360Panel
        contract={panelContract}
        onClose={closePanel}
        onRequestSendLine={setLineDialogContract}
      />
    </div>
  );
}
