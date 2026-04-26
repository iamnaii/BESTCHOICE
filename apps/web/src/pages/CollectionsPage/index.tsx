import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import CollectionsHeader from './components/CollectionsHeader';
import CollectionsTabs from './components/CollectionsTabs';
import CollectionsFilters from './components/CollectionsFilters';
import ContactLogDialog from './components/ContactLogDialog';
import Customer360Panel from './components/Customer360Panel';
import MigrationBanner from './components/MigrationBanner';
import SendLineAdHocDialog from './components/SendLineAdHocDialog';
import SkipTracingWizard from './components/SkipTracingWizard';
import QueueTab from './tabs/QueueTab';
import FollowUpTab from './tabs/FollowUpTab';
import PromiseTab from './tabs/PromiseTab';
import AllTab from './tabs/AllTab';
import ApprovalTab from './tabs/ApprovalTab';
import AnalyticsTab from './tabs/AnalyticsTab';
import SessionView from './session/SessionView';
import { useViewToggle } from './hooks/useViewToggle';
import type { ContractRow, CollectionsTabKey } from './types';

export type { CollectionsTabKey };

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
  const navigate = useNavigate();
  const { view, setView } = useViewToggle();

  // Default OWNER/MANAGER to /collections/manage unless they've explicitly
  // chosen a view via the toggle (preferences.collectionsDefaultView).
  useEffect(() => {
    const isManager =
      user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER' || user?.role === 'FINANCE_MANAGER';
    const explicitChoice = (user?.preferences as { collectionsDefaultView?: string } | undefined)
      ?.collectionsDefaultView;
    if (isManager && !explicitChoice) {
      navigate('/collections/manage', { replace: true });
    }
  }, [user, navigate]);

  const [activeTab, setActiveTab] = useState<CollectionsTabKey>('today');
  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState('');
  const [dialogContract, setDialogContract] = useState<ContractRow | null>(null);
  const [panelContract, setPanelContract] = useState<ContractRow | null>(null);
  const [lineDialogContract, setLineDialogContract] = useState<ContractRow | null>(null);
  const [skipTraceContract, setSkipTraceContract] = useState<ContractRow | null>(null);

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
      <PageHeader
        title="ติดตามหนี้"
        subtitle={view === 'SESSION' ? 'คิวงานวันนี้ของคุณ' : 'รายการสัญญาทั้งหมด'}
        action={
          <div className="inline-flex items-center rounded-lg border border-border/50 bg-card p-0.5">
            <Button
              type="button"
              size="sm"
              variant={view === 'SESSION' ? 'primary' : 'ghost'}
              className="h-7 px-3 text-xs"
              onClick={() => setView('SESSION')}
            >
              Session
            </Button>
            <Button
              type="button"
              size="sm"
              variant={view === 'LIBRARY' ? 'primary' : 'ghost'}
              className="h-7 px-3 text-xs"
              onClick={() => setView('LIBRARY')}
            >
              Library
            </Button>
          </div>
        }
      />

      <MigrationBanner />

      {view === 'SESSION' ? (
        <SessionView />
      ) : (
        <>
          <CollectionsHeader onSwitchToToday={() => setActiveTab('today')} />

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
              onSkipTrace={setSkipTraceContract}
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
              onSkipTrace={setSkipTraceContract}
            />
          )}

          {effectiveTab === 'promise' && (
            <PromiseTab
              search={search}
              branchId={branchId}
              onLogContact={openContactDialog}
              onOpen360={openPanel}
              onSendLine={setLineDialogContract}
              onSkipTrace={setSkipTraceContract}
            />
          )}

          {effectiveTab === 'approval' && canSeeApproval && <ApprovalTab />}

          {effectiveTab === 'all' && <AllTab />}

          {effectiveTab === 'analytics' && canSeeAnalytics && <AnalyticsTab />}
        </>
      )}

      {/* Dialogs stay outside conditional — they may be opened from either mode */}
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

      <SkipTracingWizard
        open={!!skipTraceContract}
        contract={skipTraceContract}
        onClose={() => setSkipTraceContract(null)}
      />
    </div>
  );
}
