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
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
