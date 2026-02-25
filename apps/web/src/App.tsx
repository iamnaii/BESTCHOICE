import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import MainLayout from '@/components/layout/MainLayout';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import BranchesPage from '@/pages/BranchesPage';
import OverduePage from '@/pages/OverduePage';
import RepossessionsPage from '@/pages/RepossessionsPage';
import PurchaseOrdersPage from '@/pages/PurchaseOrdersPage';
import NotificationsPage from '@/pages/NotificationsPage';
import ReportsPage from '@/pages/ReportsPage';
import MigrationPage from '@/pages/MigrationPage';
import ProductsPage from '@/pages/ProductsPage';
import CustomersPage from '@/pages/CustomersPage';
import ContractsPage from '@/pages/ContractsPage';
import PaymentsPage from '@/pages/PaymentsPage';

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
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/contracts" element={<ContractsPage />} />
        <Route path="/payments" element={<PaymentsPage />} />
        <Route path="/overdue" element={<OverduePage />} />
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
