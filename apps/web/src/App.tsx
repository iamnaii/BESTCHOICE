import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import MainLayout from '@/components/layout/MainLayout';

// Redirect to a non-router URL (used for static HTML pages served from /public).
function ExternalRedirect({ to }: { to: string }) {
  useEffect(() => {
    window.location.replace(to);
  }, [to]);
  return null;
}

// Lazy-load all pages (separate chunks, loaded on demand)
const LandingPage = lazy(() => import('@/pages/LandingPage'));
const PrivacyPolicyPage = lazy(() => import('@/pages/PrivacyPolicyPage'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage'));
const RegisterInvitePage = lazy(() => import('@/pages/RegisterInvitePage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const BranchesPage = lazy(() => import('@/pages/BranchesPage'));
const SupplierDetailPage = lazy(() => import('@/pages/SupplierDetailPage'));
const ProductCreatePage = lazy(() => import('@/pages/ProductCreatePage'));
const ProductDetailPage = lazy(() => import('@/pages/ProductDetailPage'));

const StickerPrintPage = lazy(() => import('@/pages/StickerPrintPage'));
const CustomersPage = lazy(() => import('@/pages/CustomersPage'));
const CustomerDetailPage = lazy(() => import('@/pages/CustomerDetailPage'));
const ContractsPage = lazy(() => import('@/pages/ContractsPage'));
const ContractCreatePage = lazy(() => import('@/pages/ContractCreatePage'));
const ContractDetailPage = lazy(() => import('@/pages/ContractDetailPage'));
const ContractSignPage = lazy(() => import('@/pages/ContractSignPage'));
const ContractTemplatesPage = lazy(() => import('@/pages/ContractTemplatesPage'));
const PaymentsPage = lazy(() => import('@/pages/PaymentsPage'));
const RepossessionsPage = lazy(() => import('@/pages/RepossessionsPage'));
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage'));
const ReportsPage = lazy(() => import('@/pages/ReportsPage'));
const MigrationPage = lazy(() => import('@/pages/MigrationPage'));
const UsersPage = lazy(() => import('@/pages/UsersPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const PaymentMethodSettingsPage = lazy(() => import('@/pages/PaymentMethodSettingsPage'));
const DefectExchangePage = lazy(() => import('@/pages/DefectExchangePage'));
const AuditLogsPage = lazy(() => import('@/pages/AuditLogsPage'));
const FinancialAuditPage = lazy(() => import('@/pages/FinancialAuditPage'));
const PaymentCsvImportPage = lazy(() => import('@/pages/PaymentCsvImportPage'));
const POSPage = lazy(() => import('@/pages/POSPage'));
const SalesHistoryPage = lazy(() => import('@/pages/SalesHistoryPage'));
const InterestConfigPage = lazy(() => import('@/pages/InterestConfigPage'));
const PricingTemplatesPage = lazy(() => import('@/pages/PricingTemplatesPage'));
const SuppliersPage = lazy(() => import('@/pages/SuppliersPage'));
const StockOverviewPage = lazy(() => import('@/pages/StockPage/OverviewPage'));
const StockProductsPage = lazy(() => import('@/pages/StockPage/ProductsPage'));
const PurchaseOrdersPage = lazy(() => import('@/pages/PurchaseOrdersPage'));

const StockTransfersPage = lazy(() => import('@/pages/StockTransfersPage'));
const StockAlertsPage = lazy(() => import('@/pages/StockAlertsPage'));
const StockAdjustmentsPage = lazy(() => import('@/pages/StockAdjustmentsPage'));
const StockCountPage = lazy(() => import('@/pages/StockCountPage'));
const InventoryWorkflowPage = lazy(() => import('@/pages/InventoryWorkflowPage'));
const InspectionPage = lazy(() => import('@/pages/InspectionPage'));
const InspectionDetailPage = lazy(() => import('@/pages/InspectionDetailPage'));
const SystemStatusPage = lazy(() => import('@/pages/SystemStatusPage'));
const DocumentDashboardPage = lazy(() => import('@/pages/DocumentDashboardPage'));
const PDPAPage = lazy(() => import('@/pages/PDPAPage'));
const ReceiptVerifyPage = lazy(() => import('@/pages/ReceiptVerifyPage'));
const CustomerPortalPage = lazy(() => import('@/pages/CustomerPortalPage'));
const ContractVerifyPage = lazy(() => import('@/pages/ContractVerifyPage'));
const LiffPayment = lazy(() => import('@/pages/liff/LiffPayment'));
const LiffContract = lazy(() => import('@/pages/liff/LiffContract'));
const LiffRegister = lazy(() => import('@/pages/liff/LiffRegister'));
const LiffHistory = lazy(() => import('@/pages/liff/LiffHistory'));
const LiffProfile = lazy(() => import('@/pages/liff/LiffProfile'));
const LiffEarlyPayoff = lazy(() => import('@/pages/liff/LiffEarlyPayoff'));
const LiffFinanceVerify = lazy(() => import('@/pages/liff/LiffFinanceVerify'));
const LiffBranches = lazy(() => import('@/pages/liff/LiffBranches'));
const LiffReceipts = lazy(() => import('@/pages/liff/LiffReceipts'));
const LiffNotificationSettings = lazy(() => import('@/pages/liff/LiffNotificationSettings'));
const LineOaSettingsPage = lazy(() => import('@/pages/LineOaSettingsPage'));
const FinanceReceivablePage = lazy(() => import('@/pages/FinanceReceivablePage'));
const FinancePortfolioPage = lazy(() => import('@/pages/FinancePortfolioPage'));
const ExpensesPage = lazy(() => import('@/pages/ExpensesPage'));
const ExpenseDocumentNewPage = lazy(() => import('@/pages/ExpenseDocumentNewPage'));
const ExpenseFavoritesPage = lazy(() => import('@/pages/ExpenseFavoritesPage'));
const ExpenseDailySummaryPage = lazy(() => import('@/pages/ExpenseDailySummaryPage'));
const ProfitLossPage = lazy(() => import('@/pages/ProfitLossPage'));
const CompanySettingsPage = lazy(() => import('@/pages/CompanySettingsPage'));
const TaxReportsPage = lazy(() => import('@/pages/TaxReportsPage'));
const CommissionsPage = lazy(() => import('@/pages/CommissionsPage'));
const TradeInPage = lazy(() => import('@/pages/TradeInPage'));
const PromotionsPage = lazy(() => import('@/pages/PromotionsPage'));
const AssetsListPage = lazy(() => import('@/pages/assets/AssetsListPage'));
const AssetEntryPage = lazy(() => import('@/pages/assets/AssetEntryPage'));
const AssetDetailPage = lazy(() => import('@/pages/assets/AssetDetailPage'));
const AssetDisposePage = lazy(() => import('@/pages/assets/AssetDisposePage'));
const AssetSchedulePage = lazy(() => import('@/pages/assets/AssetSchedulePage'));
const AssetAuditPage = lazy(() => import('@/pages/assets/AssetAuditPage'));
const AssetRegisterPage = lazy(() => import('@/pages/assets/AssetRegisterPage'));
const AssetJournalPage = lazy(() => import('@/pages/assets/AssetJournalPage'));
const AssetSummaryReportPage = lazy(() => import('@/pages/assets/AssetSummaryReportPage'));
const AssetTransfersListPage = lazy(() => import('@/pages/transfers/AssetTransfersListPage'));
const DepreciationPage = lazy(() => import('@/pages/depreciation/DepreciationPage'));
const ChartOfAccountsPage = lazy(() => import('@/pages/ChartOfAccountsPage'));
const TodosPage = lazy(() => import('@/pages/TodosPage'));
const UnifiedInboxPage = lazy(() => import('@/pages/UnifiedInboxPage'));
const ChatInboxPage = lazy(() => import('@/pages/chat/ChatInboxPage'));
const CrmPipelinePage = lazy(() => import('@/pages/CrmPipelinePage'));
const AdsTrackingPage = lazy(() => import('@/pages/AdsTrackingPage'));
const ChannelSettingsPage = lazy(() => import('@/pages/ChannelSettingsPage'));
const ChatbotFinanceAnalyticsPage = lazy(() => import('@/pages/ChatbotFinanceAnalyticsPage'));
const ChatbotFinanceSessionsPage = lazy(() => import('@/pages/ChatbotFinanceSessionsPage'));
const ChatbotFinanceKnowledgePage = lazy(() => import('@/pages/ChatbotFinanceKnowledgePage'));
const ChatbotFinanceLearningPage = lazy(() => import('@/pages/ChatbotFinanceLearningPage'));
const AnalyticsPage = lazy(() => import('@/pages/AnalyticsPage'));
const WebhooksPage = lazy(() => import('@/pages/WebhooksPage'));
const ChatAnalyticsPage = lazy(() => import('@/pages/ChatAnalyticsPage'));
const CannedResponseAdminPage = lazy(() => import('@/pages/CannedResponseAdminPage'));
const CollectionDashboardPage = lazy(() => import('@/pages/CollectionDashboardPage'));
const CollectionsPage = lazy(() => import('@/pages/CollectionsPage'));
const DunningSettingsPage = lazy(() => import('@/pages/DunningSettingsPage'));
const SmsTemplatesPage = lazy(() => import('@/pages/SmsTemplatesPage'));
const MonthlyClosePage = lazy(() => import('@/pages/MonthlyClosePage'));
const IntercompanySettlementPage = lazy(() => import('@/pages/IntercompanySettlementPage'));
const PeakSyncPage = lazy(() => import('@/pages/PeakSyncPage'));
const AiSettingsPage = lazy(() => import('@/pages/AiSettingsPage'));
const AiTrainingPage = lazy(() => import('@/pages/AiTrainingPage'));
const AiPerformancePage = lazy(() => import('@/pages/AiPerformancePage'));
const AiAdminPage = lazy(() => import('@/pages/AiAdminPage'));
const IntegrationHubPage = lazy(() => import('@/pages/IntegrationHubPage'));
const MdmTestPage = lazy(() => import('@/pages/MdmTestPage'));
const MdmDashboardPage = lazy(() => import('@/pages/MdmDashboardPage'));
const BroadcastPage = lazy(() => import('@/pages/BroadcastPage'));
const RichMenuPage = lazy(() => import('@/pages/RichMenuPage'));
const LineGreetingPage = lazy(() => import('@/pages/LineGreetingPage'));
const SetupTwoFactorPage = lazy(() => import('@/pages/SetupTwoFactorPage'));
const CustomerIntakePage = lazy(() => import('@/pages/CustomerIntakePage'));
const OnlineOrdersPage = lazy(() => import('@/pages/OnlineOrdersPage'));
const InstallmentApplicationsPage = lazy(() => import('@/pages/InstallmentApplicationsPage'));
const SavingPlansAdminPage = lazy(() => import('@/pages/SavingPlansAdminPage'));
const ReviewsModerationPage = lazy(() => import('@/pages/ReviewsModerationPage'));
const UserProfilePage = lazy(() => import('@/pages/UserProfilePage'));
const OtherIncomeListPage = lazy(() => import('@/pages/other-income/OtherIncomeListPage'));
const OtherIncomeEntryPage = lazy(() => import('@/pages/other-income/OtherIncomeEntryPage'));
const OtherIncomeViewPage = lazy(() => import('@/pages/other-income/OtherIncomeViewPage'));
const OtherIncomeReceiptPage = lazy(() => import('@/pages/other-income/OtherIncomeReceiptPage'));
const OtherIncomeDailySheetPage = lazy(() => import('@/pages/other-income/OtherIncomeDailySheetPage'));
const PeriodClosePage = lazy(() => import('@/pages/accounting/PeriodClosePage'));

const PageLoader = () => (
  <div className="flex items-center justify-center py-20">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
  </div>
);

function App() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-3 text-[13px] text-muted-foreground">กำลังตรวจสอบผู้ใช้...</p>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Public Routes */}
        <Route
          path="/landing"
          element={<LandingPage />}
        />
        <Route
          path="/login"
          element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
        />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        {/* /terms — static HTML in apps/web/public/terms.html (Meta-readable).
            Route here only handles direct user nav; redirects to static file. */}
        <Route
          path="/terms"
          element={<ExternalRedirect to="/terms.html" />}
        />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/register" element={<RegisterInvitePage />} />

        {/* Public Customer Portal (token-based access, no auth) */}
        <Route path="/customer-access/:token" element={<CustomerPortalPage />} />
        <Route path="/verify/:id" element={<ContractVerifyPage />} />

        {/* LIFF Pages (public, opened from LINE) */}
        <Route path="/pay/:token" element={<LiffPayment />} />
        {/* Bare /liff and unknown /liff/* → redirect to primary LIFF page.
            Guards against Endpoint URL mis-configs and catch-all "*→/" hijacking
            LIFF traffic into ProtectedRoute. */}
        <Route path="/liff" element={<Navigate to="/liff/contract" replace />} />
        {/* Shorthand aliases for rich-menu LIFF URIs (https://liff.line.me/<id>/contract).
            LINE rewrites them via liff.state so the landing pathname is the bare sub-path. */}
        <Route path="/contract" element={<Navigate to="/liff/contract" replace />} />
        <Route path="/history" element={<Navigate to="/liff/history" replace />} />
        <Route path="/early-payoff" element={<Navigate to="/liff/early-payoff" replace />} />
        <Route path="/liff/contract" element={<LiffContract />} />
        <Route path="/liff/register" element={<LiffRegister />} />
        <Route path="/liff/history" element={<LiffHistory />} />
        <Route path="/liff/profile" element={<LiffProfile />} />
            <Route path="/liff/early-payoff" element={<LiffEarlyPayoff />} />
        <Route path="/liff/finance-verify" element={<LiffFinanceVerify />} />
        <Route path="/liff/branches" element={<LiffBranches />} />
        <Route path="/liff/receipts" element={<LiffReceipts />} />
        <Route path="/liff/notifications" element={<LiffNotificationSettings />} />
        <Route path="/liff/debug" element={<div style={{padding:20,fontFamily:'monospace'}}>
          <h2>LIFF Debug</h2>
          <p>pathname: {window.location.pathname}</p>
          <p>search: {window.location.search}</p>
          <p>href: {window.location.href}</p>
          <p>time: {new Date().toISOString()}</p>
        </div>} />
        {/* Unknown /liff/* sub-paths fall back to primary LIFF page (not catch-all "*→/"). */}
        <Route path="/liff/*" element={<Navigate to="/liff/contract" replace />} />

        {/* 2FA Setup — authenticated, no main layout */}
        <Route
          path="/setup-2fa"
          element={
            <ProtectedRoute>
              <SetupTwoFactorPage />
            </ProtectedRoute>
          }
        />

        {/* Protected Admin Routes */}
        <Route
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route
            path="/branches"
            element={
              <ProtectedRoute roles={['OWNER']}>
                <BranchesPage />
              </ProtectedRoute>
            }
          />
          {/* Redirect old unified inventory page */}
          <Route path="/inventory" element={<Navigate to="/stock" replace />} />

          {/* จัดซื้อ (Purchasing) */}
          <Route
            path="/purchase-orders"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER']}>
                <PurchaseOrdersPage />
              </ProtectedRoute>
            }
          />
          {/* คลังสินค้า (Warehouse) */}
          <Route
            path="/stock"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES']}>
                <StockOverviewPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/stock/products"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES']}>
                <StockProductsPage />
              </ProtectedRoute>
            }
          />
          <Route path="/products" element={<Navigate to="/stock/products" replace />} />
          <Route
            path="/stock/transfers"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER']}>
                <StockTransfersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/stock/alerts"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER']}>
                <StockAlertsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/stock/adjustments"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER']}>
                <StockAdjustmentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/stock/count"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER']}>
                <StockCountPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/stock/workflow"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'SALES']}>
                <InventoryWorkflowPage />
              </ProtectedRoute>
            }
          />
          <Route path="/stock/branch-receiving" element={<Navigate to="/stock/transfers?view=incoming" replace />} />

          {/* ตรวจสอบสินค้า (Inspections) */}
          <Route
            path="/inspections"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'SALES']}>
                <InspectionPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/inspections/:id"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'SALES']}>
                <InspectionDetailPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/suppliers"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER']}>
                <SuppliersPage />
              </ProtectedRoute>
            }
          />

          {/* Detail pages with role-based access */}
          <Route
            path="/suppliers/:id"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER']}>
                <SupplierDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/products/create"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER']}>
                <ProductCreatePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/products/:id"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'SALES']}>
                <ProductDetailPage />
              </ProtectedRoute>
            }
          />

          <Route path="/stickers" element={<StickerPrintPage />} />
          <Route path="/pos" element={<ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'SALES']}><POSPage /></ProtectedRoute>} />
          <Route path="/sales" element={<SalesHistoryPage />} />
          <Route path="/todos" element={<TodosPage />} />
          <Route path="/inbox" element={<ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES']}><UnifiedInboxPage /></ProtectedRoute>} />
          <Route path="/chat" element={<ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES']}><ChatInboxPage /></ProtectedRoute>} />
          <Route path="/crm" element={<ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES']}><CrmPipelinePage /></ProtectedRoute>} />
          <Route path="/ads" element={<ProtectedRoute roles={['OWNER']}><AdsTrackingPage /></ProtectedRoute>} />
          <Route path="/settings/channels" element={<ProtectedRoute roles={['OWNER']}><ChannelSettingsPage /></ProtectedRoute>} />
          <Route path="/settings/payment-methods" element={<ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER']}><PaymentMethodSettingsPage /></ProtectedRoute>} />
          <Route path="/chatbot-finance" element={<ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER']}><ChatbotFinanceAnalyticsPage /></ProtectedRoute>} />
          <Route path="/chatbot-finance/sessions" element={<ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}><ChatbotFinanceSessionsPage /></ProtectedRoute>} />
          <Route path="/chatbot-finance/knowledge" element={<ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER']}><ChatbotFinanceKnowledgePage /></ProtectedRoute>} />
          <Route path="/chatbot-finance/learning" element={<ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER']}><ChatbotFinanceLearningPage /></ProtectedRoute>} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/customers/:id" element={<CustomerDetailPage />} />
          <Route path="/customer-intake" element={<CustomerIntakePage />} />
          <Route path="/contracts" element={<ContractsPage />} />
          <Route
            path="/contracts/create"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'SALES']}>
                <ContractCreatePage />
              </ProtectedRoute>
            }
          />
          <Route path="/contracts/:id" element={<ContractDetailPage />} />
          <Route path="/contracts/:id/sign" element={<ContractSignPage />} />
          <Route
            path="/contract-templates"
            element={
              <ProtectedRoute roles={['OWNER']}>
                <ContractTemplatesPage />
              </ProtectedRoute>
            }
          />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route
            path="/finance-receivable"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <FinanceReceivablePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/finance-portfolio"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <FinancePortfolioPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/expenses/new"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <ExpenseDocumentNewPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/expenses/favorites"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <ExpenseFavoritesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/expenses/daily-summary"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <ExpenseDailySummaryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/expenses"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <ExpensesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/commissions"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'SALES']}>
                <CommissionsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/payments/import-csv"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <PaymentCsvImportPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/document-dashboard"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER']}>
                <DocumentDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/pdpa"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER']}>
                <PDPAPage />
              </ProtectedRoute>
            }
          />
          <Route path="/receipts" element={<Navigate to="/payments?tab=receipts" replace />} />
          <Route path="/verify/:receiptNumber" element={<ReceiptVerifyPage />} />
          {/* /overdue → /collections (Task 18 of 2026-04-25-collections-ui-p1).
              Old route kept as a redirect so external bookmarks/LINE links keep
              working. MigrationBanner on /collections nudges users to update. */}
          <Route path="/overdue" element={<Navigate to="/collections" replace />} />
          <Route path="/overdue/*" element={<Navigate to="/collections" replace />} />
          <Route
            path="/collections"
            element={
              <ProtectedRoute
                roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES']}
              >
                <CollectionsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/collection-dashboard"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER']}>
                <CollectionDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/defect-exchange"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES']}>
                <DefectExchangePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/repossessions"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER']}>
                <RepossessionsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/notifications"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER']}>
                <NotificationsPage />
              </ProtectedRoute>
            }
          />
          <Route path="/slip-review" element={<Navigate to="/payments?tab=slip-review" replace />} />
          <Route
            path="/reports"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <ReportsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profit-loss"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <ProfitLossPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/users"
            element={
              <ProtectedRoute roles={['OWNER']}>
                <UsersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute roles={['OWNER']}>
                <SettingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/interest-config"
            element={
              <ProtectedRoute roles={['OWNER']}>
                <InterestConfigPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/pricing-templates"
            element={
              <ProtectedRoute roles={['OWNER']}>
                <PricingTemplatesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/audit-logs"
            element={
              <ProtectedRoute roles={['OWNER']}>
                <AuditLogsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/financial-audit"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <FinancialAuditPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/monthly-close"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <MonthlyClosePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/accounting/intercompany"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <IntercompanySettlementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/system-status"
            element={
              <ProtectedRoute roles={['OWNER']}>
                <SystemStatusPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/migration"
            element={
              <ProtectedRoute roles={['OWNER']}>
                <MigrationPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/line-oa"
            element={
              <ProtectedRoute roles={['OWNER']}>
                <LineOaSettingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/tax-reports"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <TaxReportsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/companies"
            element={
              <ProtectedRoute roles={['OWNER']}>
                <CompanySettingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/dunning"
            element={
              <ProtectedRoute roles={['OWNER']}>
                <DunningSettingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/sms-templates"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER']}>
                <SmsTemplatesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/peak-sync"
            element={
              <ProtectedRoute roles={['OWNER', 'ACCOUNTANT']}>
                <PeakSyncPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/trade-in"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'SALES']}>
                <TradeInPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/online-orders"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER']}>
                <OnlineOrdersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/installment-applications"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER']}>
                <InstallmentApplicationsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/saving-plans"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER']}>
                <SavingPlansAdminPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reviews"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER']}>
                <ReviewsModerationPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/promotions"
            element={
              <ProtectedRoute roles={['OWNER']}>
                <PromotionsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/assets"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <AssetsListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/assets/new"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <AssetEntryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/assets/:id/edit"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <AssetEntryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/assets/transfers"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <AssetTransfersListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/assets/register"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <AssetRegisterPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/assets/journal"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <AssetJournalPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/assets/summary-report"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <AssetSummaryReportPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/assets/:id"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <AssetDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/assets/:id/dispose"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER']}>
                <AssetDisposePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/assets/:id/schedule"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <AssetSchedulePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/assets/:id/audit"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <AssetAuditPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/depreciation"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <DepreciationPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/chart-of-accounts"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <ChartOfAccountsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/analytics"
            element={
              <ProtectedRoute roles={['OWNER']}>
                <AnalyticsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/webhooks"
            element={
              <ProtectedRoute roles={['OWNER']}>
                <WebhooksPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/chat-analytics"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER']}>
                <ChatAnalyticsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/canned-responses"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER']}>
                <CannedResponseAdminPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/ai-chat"
            element={
              <ProtectedRoute roles={['OWNER']}>
                <AiSettingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/ai-training"
            element={
              <ProtectedRoute roles={['OWNER']}>
                <AiTrainingPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/ai-performance"
            element={
              <ProtectedRoute roles={['OWNER']}>
                <AiPerformancePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/ai-admin"
            element={
              <ProtectedRoute roles={['OWNER']}>
                <AiAdminPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/integrations"
            element={
              <ProtectedRoute roles={['OWNER', 'ACCOUNTANT']}>
                <IntegrationHubPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/mdm-test"
            element={
              <ProtectedRoute roles={['OWNER']}>
                <MdmTestPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/mdm"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER']}>
                <MdmDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/broadcast"
            element={
              <ProtectedRoute roles={['OWNER']}>
                <BroadcastPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/rich-menu"
            element={
              <ProtectedRoute roles={['OWNER']}>
                <RichMenuPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/line-greeting"
            element={
              <ProtectedRoute roles={['OWNER']}>
                <LineGreetingPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute
                roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES']}
              >
                <UserProfilePage />
              </ProtectedRoute>
            }
          />

          {/* รายได้อื่น (Other Income) — CRITICAL: /daily-sheet BEFORE /:id */}
          <Route
            path="/other-income"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <OtherIncomeListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/other-income/new"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <OtherIncomeEntryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/other-income/daily-sheet"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <OtherIncomeDailySheetPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/other-income/:id"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <OtherIncomeViewPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/other-income/:id/edit"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <OtherIncomeEntryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/other-income/:id/receipt"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <OtherIncomeReceiptPage />
              </ProtectedRoute>
            }
          />

          {/* งวดบัญชี (Accounting Periods) */}
          <Route
            path="/accounting/periods"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <PeriodClosePage />
              </ProtectedRoute>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;
