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
const InspectionDetailPage = lazy(() => import('@/pages/InspectionDetailPage'));
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
const CreditChecksPage = lazy(() => import('@/pages/CreditChecksPage'));
const InventoryWorkflowPage = lazy(() => import('@/pages/InventoryWorkflowPage'));

const PageLoader = () => (
  <div className="flex items-center justify-center py-20">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
  </div>
);

function App() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-3 text-sm text-gray-500">กำลังตรวจสอบผู้ใช้...</p>
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
          {/* Inventory Workflow (unified page) */}
          <Route path="/inventory" element={<InventoryWorkflowPage />} />

          {/* Redirect old inventory routes to unified page */}
          <Route path="/stock" element={<Navigate to="/inventory?tab=stock" replace />} />
          <Route path="/suppliers" element={<Navigate to="/inventory?tab=suppliers" replace />} />
          <Route path="/purchase-orders" element={<Navigate to="/inventory?tab=purchase-orders" replace />} />
          <Route path="/inspections" element={<Navigate to="/inventory?tab=inspections" replace />} />
          <Route path="/products" element={<Navigate to="/inventory?tab=products" replace />} />
          <Route path="/stock/transfers" element={<Navigate to="/inventory?tab=transfers" replace />} />

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
          <Route path="/inspections/:id" element={<InspectionDetailPage />} />
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
            path="/audit-logs"
            element={
              <ProtectedRoute roles={['OWNER']}>
                <AuditLogsPage />
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
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;
