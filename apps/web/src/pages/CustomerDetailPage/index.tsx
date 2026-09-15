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
import JourneyStageStrip from './components/JourneyStageStrip';
import KpiTiles from './components/KpiTiles';
import RiskBanner from './components/RiskBanner';
import { useCustomerDetailData } from './hooks/useCustomerDetailData';
import { useJourneySummaryRedirect } from './hooks/useCustomerJourney';
import ContractsTab from './tabs/ContractsTab';
import CreditTab from './tabs/CreditTab';
import JourneyTab from './tabs/JourneyTab';
import LoyaltyTab from './tabs/LoyaltyTab';
import OverviewTab from './tabs/OverviewTab';
import SalesTab from './tabs/SalesTab';
import { canViewJourney } from './utils/journeyGroups';
import { kpiTiles } from './utils/kpiTiles';

export const DEFAULT_TAB = 'overview';
export const LEGACY_TAB_REDIRECT: Record<string, string> = { info: DEFAULT_TAB, contact: DEFAULT_TAB, work: DEFAULT_TAB, purchases: 'sales' };
const TAB_VALUES = ['overview', 'contracts', 'sales', 'credit', 'loyalty'];

/** ?tab= → แท็บที่มีจริง: ลิงก์เก่าผ่าน LEGACY_TAB_REDIRECT · แท็บการเดินทางเฉพาะบทบาทที่เห็น · ค่าที่ไม่รู้จักกลับไปแท็บเริ่มต้น (ไม่ปล่อยให้หน้าว่าง) */
function resolveTab(raw: string | null, journeyVisible: boolean): string {
  if (!raw) return DEFAULT_TAB;
  const mapped = LEGACY_TAB_REDIRECT[raw] ?? raw;
  if (mapped === 'journey') return journeyVisible ? mapped : DEFAULT_TAB;
  return TAB_VALUES.includes(mapped) ? mapped : DEFAULT_TAB;
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const journeyVisible = canViewJourney(user?.role ?? '');
  // ต้องอยู่ก่อน early return: id ของผู้สนใจที่ถูกรวมแล้ว GET /customers/:id/detail ตอบ 404 แต่ summary ตอบ redirectToCustomerId
  const journeySummary = useJourneySummaryRedirect(id ?? '', journeyVisible);

  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(resolveTab(rawTab, journeyVisible));
  const [showCreditDialog, setShowCreditDialog] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  useEffect(() => {
    const mapped = resolveTab(searchParams.get('tab'), journeyVisible);
    if (mapped !== activeTab) setActiveTab(mapped);
  }, [searchParams, journeyVisible]);

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

  const tabs = [
    { value: 'overview', label: 'ภาพรวม', count: null as number | null },
    { value: 'contracts', label: 'สัญญา', count: customer.contracts.length },
    { value: 'sales', label: 'ใบขาย', count: (customer.sales ?? []).length },
    { value: 'credit', label: 'เครดิต', count: creditChecks.length },
  ];

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

      <RiskBanner customer={customer} />

      <KpiTiles tiles={kpiTiles(customer, loyaltyPoints?.balance ?? null)} />

      {journeySummary && <JourneyStageStrip summary={journeySummary} />}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <Tabs value={activeTab} onValueChange={handleTabChange} className="min-w-0">
            <div className="mb-5 max-w-full overflow-x-auto">
              <TabsList variant="line" className="min-w-max">
                {tabs.map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    data-empty={tab.count === 0 ? 'true' : undefined}
                    className="data-[empty=true]:text-muted-foreground/55"
                  >
                    {tab.label}{tab.count !== null && ` (${tab.count})`}
                  </TabsTrigger>
                ))}
                <TabsTrigger value="loyalty" data-empty={!loyaltyPoints?.balance ? 'true' : undefined} className="data-[empty=true]:text-muted-foreground/55">
                  แต้มสะสม
                  {!!loyaltyPoints?.balance && (
                    <span className="ml-1.5 rounded-md bg-primary/10 px-1.5 py-0.5 text-2xs font-bold text-primary">{loyaltyPoints.balance.toLocaleString()}</span>
                  )}
                </TabsTrigger>
                {journeyVisible && <TabsTrigger value="journey">การเดินทาง</TabsTrigger>}
              </TabsList>
            </div>

            <TabsContent className="min-w-0" value="overview">
              <OverviewTab customer={customer} role={user?.role ?? ''} onOpenTab={handleTabChange} />
            </TabsContent>

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

            {/* ─── Sales Tab (ขายสด / ไฟแนนซ์นอก) ───────────────────────────── */}
            <TabsContent className="min-w-0" value="sales">
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

            {journeyVisible && (
              <TabsContent className="min-w-0" value="journey">
                <JourneyTab customerId={customer.id} role={user?.role ?? ''} />
              </TabsContent>
            )}
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
