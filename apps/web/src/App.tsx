import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import MainLayout from '@/components/layout/MainLayout';

// Lazy-load all pages (separate chunks, loaded on demand)
const LandingPage = lazy(() => import('@/pages/LandingPage'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));
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
const SystemStatusPage = lazy(() => import('@/pages/SystemStatusPage'));
const DocumentDashboardPage = lazy(() => import('@/pages/DocumentDashboardPage'));
const PDPAPage = lazy(() => import('@/pages/PDPAPage'));
const ReceiptsPage = lazy(() => import('@/pages/ReceiptsPage'));
const CustomerPortalPage = lazy(() => import('@/pages/CustomerPortalPage'));
const SlipReviewPage = lazy(() => import('@/pages/SlipReviewPage'));
const LiffPayment = lazy(() => import('@/pages/liff/LiffPayment'));
const LiffContract = lazy(() => import('@/pages/liff/LiffContract'));
const LiffRegister = lazy(() => import('@/pages/liff/LiffRegister'));
const LiffHistory = lazy(() => import('@/pages/liff/LiffHistory'));
const LiffProfile = lazy(() => import('@/pages/liff/LiffProfile'));
const LiffEarlyPayoff = lazy(() => import('@/pages/liff/LiffEarlyPayoff'));
const LineOaSettingsPage = lazy(() => import('@/pages/LineOaSettingsPage'));

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

        {/* Public Customer Portal (token-based access, no auth) */}
        <Route path="/customer-access/:token" element={<CustomerPortalPage />} />

        {/* LIFF Pages (public, opened from LINE) */}
        <Route path="/pay/:token" element={<LiffPayment />} />
        <Route path="/liff/contract" element={<LiffContract />} />
        <Route path="/liff/register" element={<LiffRegister />} />
        <Route path="/liff/history" element={<LiffHistory />} />
        <Route path="/liff/profile" element={<LiffProfile />} />
            <Route path="/liff/early-payoff" element={<LiffEarlyPayoff />} />

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
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES']}>
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
          <Route path="/stock/branch-receiving" element={<Navigate to="/stock/transfers?view=incoming" replace />} />

          <Route
            path="/suppliers"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER']}>
                <SuppliersPage />
              </ProtectedRoute>
            }
          />

          {/* Detail pages still need their own routes */}
          <Route path="/suppliers/:id" element={<SupplierDetailPage />} />
          <Route
            path="/products/create"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER']}>
                <ProductCreatePage />
              </ProtectedRoute>
            }
          />
          <Route path="/products/:id" element={<ProductDetailPage />} />

          <Route path="/stickers" element={<StickerPrintPage />} />
          <Route path="/pos" element={<POSPage />} />
          <Route path="/sales" element={<SalesHistoryPage />} />
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
            path="/document-dashboard"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER']}>
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
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT']}>
                <ReceiptsPage />
              </ProtectedRoute>
            }
          />
          <Route path="/overdue" element={<OverduePage />} />
          <Route
            path="/exchange"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER']}>
                <ExchangePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/repossessions"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER']}>
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
          <Route
            path="/slip-review"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT']}>
                <SlipReviewPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT']}>
                <ReportsPage />
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
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;
