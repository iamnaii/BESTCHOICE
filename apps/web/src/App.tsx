import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import MainLayout from '@/components/layout/MainLayout';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import BranchesPage from '@/pages/BranchesPage';
// Supplier Management (Phase 2) pages
import SuppliersPage from '@/pages/SuppliersPage';
import SupplierDetailPage from '@/pages/SupplierDetailPage';
import ProductsPage from '@/pages/ProductsPage';
import ProductCreatePage from '@/pages/ProductCreatePage';
import ProductDetailPage from '@/pages/ProductDetailPage';
import StockPage from '@/pages/StockPage';
import InspectionPage from '@/pages/InspectionPage';
import InspectionDetailPage from '@/pages/InspectionDetailPage';
import StickerPrintPage from '@/pages/StickerPrintPage';
import CustomersPage from '@/pages/CustomersPage';
import CustomerDetailPage from '@/pages/CustomerDetailPage';
import ContractsPage from '@/pages/ContractsPage';
import ContractCreatePage from '@/pages/ContractCreatePage';
import ContractDetailPage from '@/pages/ContractDetailPage';
import ContractSignPage from '@/pages/ContractSignPage';
import ContractTemplatesPage from '@/pages/ContractTemplatesPage';
import PaymentsPage from '@/pages/PaymentsPage';
import OverduePage from '@/pages/OverduePage';
// MASTER-only pages
import RepossessionsPage from '@/pages/RepossessionsPage';
import PurchaseOrdersPage from '@/pages/PurchaseOrdersPage';
import NotificationsPage from '@/pages/NotificationsPage';
import ReportsPage from '@/pages/ReportsPage';
import MigrationPage from '@/pages/MigrationPage';
import UsersPage from '@/pages/UsersPage';
import SettingsPage from '@/pages/SettingsPage';
import ExchangePage from '@/pages/ExchangePage';

function App() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
      />
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
        {/* Supplier Management (Phase 2) routes */}
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/suppliers/:id" element={<SupplierDetailPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/products/create" element={<ProductCreatePage />} />
        <Route path="/products/:id" element={<ProductDetailPage />} />
        <Route path="/stock" element={<StockPage />} />
        <Route path="/inspections" element={<InspectionPage />} />
        <Route path="/inspections/:id" element={<InspectionDetailPage />} />
        <Route path="/stickers" element={<StickerPrintPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/customers/:id" element={<CustomerDetailPage />} />
        <Route path="/contracts" element={<ContractsPage />} />
        <Route path="/contracts/create" element={<ContractCreatePage />} />
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
        {/* MASTER-only routes */}
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
          path="/purchase-orders"
          element={
            <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER']}>
              <PurchaseOrdersPage />
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
  );
}

export default App;
