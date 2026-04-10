import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import MainLayout from '@/components/layout/MainLayout';

// Lazy-load all pages (separate chunks, loaded on demand)
const LandingPage = lazy(() => import('@/pages/LandingPage'));
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
const OverduePage = lazy(() => import('@/pages/OverduePage'));
const RepossessionsPage = lazy(() => import('@/pages/RepossessionsPage'));
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage'));
const ReportsPage = lazy(() => import('@/pages/ReportsPage'));
const MigrationPage = lazy(() => import('@/pages/MigrationPage'));
const UsersPage = lazy(() => import('@/pages/UsersPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const ExchangePage = lazy(() => import('@/pages/ExchangePage'));
const AuditLogsPage = lazy(() => import('@/pages/AuditLogsPage'));
const FinancialAuditPage = lazy(() => import('@/pages/FinancialAuditPage'));
const PaymentCsvImportPage = lazy(() => import('@/pages/PaymentCsvImportPage'));
const POSPage = lazy(() => import('@/pages/POSPage'));
const SalesHistoryPage = lazy(() => import('@/pages/SalesHistoryPage'));
const InterestConfigPage = lazy(() => import('@/pages/InterestConfigPage'));
const PricingTemplatesPage = lazy(() => import('@/pages/PricingTemplatesPage'));
const CreditChecksPage = lazy(() => import('@/pages/CreditChecksPage'));
const SuppliersPage = lazy(() => import('@/pages/SuppliersPage'));
const StockPage = lazy(() => import('@/pages/StockPage'));
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
const ReceiptsPage = lazy(() => import('@/pages/ReceiptsPage'));
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
const LineOaSettingsPage = lazy(() => import('@/pages/LineOaSettingsPage'));
const SmsSettingsPage = lazy(() => import('@/pages/SmsSettingsPage'));
const FinanceReceivablePage = lazy(() => import('@/pages/FinanceReceivablePage'));
const FinancePortfolioPage = lazy(() => import('@/pages/FinancePortfolioPage'));
const ExpensesPage = lazy(() => import('@/pages/ExpensesPage'));
const ProfitLossPage = lazy(() => import('@/pages/ProfitLossPage'));
const CompanySettingsPage = lazy(() => import('@/pages/CompanySettingsPage'));
const TaxReportsPage = lazy(() => import('@/pages/TaxReportsPage'));
const CommissionsPage = lazy(() => import('@/pages/CommissionsPage'));
const TradeInPage = lazy(() => import('@/pages/TradeInPage'));
const PromotionsPage = lazy(() => import('@/pages/PromotionsPage'));
const AssetManagementPage = lazy(() => import('@/pages/AssetManagementPage'));
const ChartOfAccountsPage = lazy(() => import('@/pages/ChartOfAccountsPage'));
const TodosPage = lazy(() => import('@/pages/TodosPage'));
const ChatbotFinanceAnalyticsPage = lazy(() => import('@/pages/ChatbotFinanceAnalyticsPage'));
const ChatbotFinanceSessionsPage = lazy(() => import('@/pages/ChatbotFinanceSessionsPage'));
const ChatbotFinanceKnowledgePage = lazy(() => import('@/pages/ChatbotFinanceKnowledgePage'));
const ChatbotFinanceLearningPage = lazy(() => import('@/pages/ChatbotFinanceLearningPage'));
const AnalyticsPage = lazy(() => import('@/pages/AnalyticsPage'));
const WebhooksPage = lazy(() => import('@/pages/WebhooksPage'));

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
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/register" element={<RegisterInvitePage />} />

        {/* Public Customer Portal (token-based access, no auth) */}
        <Route path="/customer-access/:token" element={<CustomerPortalPage />} />
        <Route path="/verify/:id" element={<ContractVerifyPage />} />

        {/* LIFF Pages (public, opened from LINE) */}
        <Route path="/pay/:token" element={<LiffPayment />} />
        <Route path="/liff/contract" element={<LiffContract />} />
        <Route path="/liff/register" element={<LiffRegister />} />
        <Route path="/liff/history" element={<LiffHistory />} />
        <Route path="/liff/profile" element={<LiffProfile />} />
            <Route path="/liff/early-payoff" element={<LiffEarlyPayoff />} />
        <Route path="/liff/finance-verify" element={<LiffFinanceVerify />} />

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
                <StockPage />
              </ProtectedRoute>
            }
          />
          <Route path="/products" element={<Navigate to="/stock?tab=list" replace />} />
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
          <Route path="/chatbot-finance" element={<ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER']}><ChatbotFinanceAnalyticsPage /></ProtectedRoute>} />
          <Route path="/chatbot-finance/sessions" element={<ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}><ChatbotFinanceSessionsPage /></ProtectedRoute>} />
          <Route path="/chatbot-finance/knowledge" element={<ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER']}><ChatbotFinanceKnowledgePage /></ProtectedRoute>} />
          <Route path="/chatbot-finance/learning" element={<ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER']}><ChatbotFinanceLearningPage /></ProtectedRoute>} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/customers/:id" element={<CustomerDetailPage />} />
          <Route path="/credit-checks" element={<CreditChecksPage />} />
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
          <Route
            path="/receipts"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <ReceiptsPage />
              </ProtectedRoute>
            }
          />
          <Route path="/verify/:receiptNumber" element={<ReceiptVerifyPage />} />
          <Route path="/overdue" element={<OverduePage />} />
          <Route
            path="/exchange"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER']}>
                <ExchangePage />
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
            path="/settings/sms"
            element={
              <ProtectedRoute roles={['OWNER']}>
                <SmsSettingsPage />
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
            path="/trade-in"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'SALES']}>
                <TradeInPage />
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
                <AssetManagementPage />
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
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;
