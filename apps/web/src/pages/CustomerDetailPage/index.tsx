import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import ContractReturnNotice from '@/components/credit-check/ContractReturnNotice';
import CreditCheckCreateDialog from '@/components/credit-check/CreditCheckCreateDialog';
import QueryBoundary from '@/components/QueryBoundary';
import { DetailPageSkeleton } from '@/components/ui/page-skeletons';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import CustomerSidePanel from './components/CustomerSidePanel';
import DetailHeader from './components/DetailHeader';
import EditCustomerDialog from './components/EditCustomerDialog';
import KpiTiles from './components/KpiTiles';
import RiskBanner from './components/RiskBanner';
import { useCustomerDetailData } from './hooks/useCustomerDetailData';
import ContractsTab from './tabs/ContractsTab';
import CreditTab from './tabs/CreditTab';
import LoyaltyTab from './tabs/LoyaltyTab';
import SalesTab from './tabs/SalesTab';
import { kpiTiles } from './utils/kpiTiles';

export const DEFAULT_TAB = 'contracts';
export const LEGACY_TAB_REDIRECT: Record<string, string> = { info: DEFAULT_TAB, contact: DEFAULT_TAB, work: DEFAULT_TAB };

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(rawTab ? (LEGACY_TAB_REDIRECT[rawTab] ?? rawTab) : DEFAULT_TAB);
  const [showCreditDialog, setShowCreditDialog] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  useEffect(() => {
    const tab = searchParams.get('tab');
    const mapped = tab ? (LEGACY_TAB_REDIRECT[tab] ?? tab) : DEFAULT_TAB;
    if (mapped !== activeTab) setActiveTab(mapped);
  }, [searchParams]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    const next = new URLSearchParams(searchParams);
    if (value === DEFAULT_TAB) next.delete('tab');
    else next.set('tab', value);
    setSearchParams(next, { replace: true });
  };

  const canEdit = !!user && ['OWNER', 'BRANCH_MANAGER'].includes(user.role);
  const canStartCredit = ['OWNER', 'BRANCH_MANAGER', 'SALES'].includes(user?.role ?? '');
  const canUploadDocuments = ['OWNER', 'BRANCH_MANAGER', 'SALES'].includes(user?.role ?? '');
  const canReviewCredit = !!user && ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER'].includes(user.role);

  const {
    customer,
    isLoading,
    customerError,
    customerErrorDetail,
    refetchCustomer,
    creditChecks,
    tierData,
    loyaltyPoints,
    loyaltyHistory,
    referralStats,
    activityLogs,
  } = useCustomerDetailData(id);

  if (customerError) {
    return (
      <QueryBoundary
        isLoading={false}
        isError={true}
        error={customerErrorDetail}
        onRetry={refetchCustomer}
        errorTitle="ไม่สามารถโหลดข้อมูลลูกค้าได้"
      >
        <div />
      </QueryBoundary>
    );
  }

  if (isLoading || !customer) {
    return <DetailPageSkeleton />;
  }

  const purchases = customer.sales ?? [];

  return (
    <div className="min-w-0">
      <DetailHeader
        customer={customer}
        tier={tierData?.tier ?? null}
        role={user?.role ?? ''}
        canEdit={canEdit}
        canStartCredit={canStartCredit}
        onEdit={() => setShowEditModal(true)}
        onStartCredit={() => setShowCreditDialog(true)}
      />

      <ContractReturnNotice customerId={id} />

      <RiskBanner contracts={customer.openContracts} />

      <KpiTiles tiles={kpiTiles(customer, loyaltyPoints?.balance ?? null)} />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <Tabs value={activeTab} onValueChange={handleTabChange} className="min-w-0">
            <div className="mb-5 max-w-full overflow-x-auto">
              <TabsList variant="line" className="min-w-max">
                <TabsTrigger value="credit">เครดิต ({creditChecks.length})</TabsTrigger>
                <TabsTrigger value="contracts">สัญญา ({customer.contracts.length})</TabsTrigger>
                <TabsTrigger value="purchases">การซื้อ ({purchases.length})</TabsTrigger>
                <TabsTrigger value="loyalty">
                  แต้มสะสม
                  {loyaltyPoints && loyaltyPoints.balance > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded-md text-2xs font-bold bg-primary/10 text-primary">
                      {loyaltyPoints.balance.toLocaleString()}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent className="min-w-0" value="credit">
              <CreditTab
                customer={customer}
                creditChecks={creditChecks}
                canStartCredit={canStartCredit}
                canReviewCredit={canReviewCredit}
                onOpenCreate={() => setShowCreditDialog(true)}
              />
            </TabsContent>

            <TabsContent className="min-w-0" value="contracts">
              <ContractsTab customer={customer} isOwner={user?.role === 'OWNER'} activityLogs={activityLogs} />
            </TabsContent>

            {/* ─── Purchases Tab (ขายสด / ไฟแนนซ์นอก) ───────────────────────── */}
            <TabsContent className="min-w-0" value="purchases">
              <SalesTab customer={customer} />
            </TabsContent>

            {/* ─── Loyalty Tab ────────────────────────────────────────────── */}
            <TabsContent className="min-w-0" value="loyalty">
              <LoyaltyTab
                customerId={id}
                canEdit={canEdit}
                loyaltyPoints={loyaltyPoints}
                loyaltyHistory={loyaltyHistory}
                referralStats={referralStats}
              />
            </TabsContent>
          </Tabs>
        </div>

        <CustomerSidePanel
          customer={customer}
          role={user?.role ?? ''}
          canEdit={canEdit}
          canUploadDocuments={canUploadDocuments}
          onEdit={() => setShowEditModal(true)}
        />
      </div>

      <EditCustomerDialog customer={customer} open={showEditModal} onClose={() => setShowEditModal(false)} />

      <CreditCheckCreateDialog
        open={showCreditDialog}
        onClose={() => setShowCreditDialog(false)}
        preselectedCustomer={customer ? {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          chatPlaceholder: customer.chatPlaceholder,
          nationalId: customer.nationalId,
          salary: customer.salary,
          occupation: customer.occupation,
          addressCurrentType: null,
          salaryPayDay: null,
        } : null}
      />
    </div>
  );
}
